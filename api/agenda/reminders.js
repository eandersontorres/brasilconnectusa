/**
 * GET /api/agenda/reminders
 * Cron diario (vercel.json, 17:00 UTC):
 *   1. Lembrete de 24h por E-MAIL pra cliente com agendamento amanha — so de
 *      profissional com o recurso 'email_reminders' no plano.
 *   2. Push pra profissional com o resumo de amanha ("Amanhã: 5 atendimentos,
 *      o primeiro às 09:00. Aniversariantes: Ana e Bia.") — so quem ligou
 *      notify_daily_summary no app. Aniversario = ag_clients.birthday_md ('MM-DD')
 *      de amanha; quem so tem aniversariante (sem atendimento) tambem recebe.
 *   3. E-mail pra profissional no teste gratis SEM assinatura (trialing, sem
 *      stripe_subscription_id): faltando 3 dias e no dia em que o teste acaba,
 *      com link pra /agenda/planos. Uma vez por marco: grava a data do fim do
 *      teste em app_settings.trial_mail_3d / trial_mail_0d. Pula quem esta em
 *      bc_email_optouts (o e-mail chama pra assinar). Sem push.
 *
 * - Lembretes: o banco ja filtra quem tem e-mail e profissional ativa com status
 *   de plano que pode valer (hasFeature confere no fim). Paginado por id (keyset)
 *   ate acabar ou ate ~40s; o que sobrar fica contado em `left`.
 * - So marca `reminder_24h_sent` quando o e-mail foi de fato enviado.
 * - Agendamento sem e-mail da cliente nao recebe lembrete (o lembrete por WhatsApp
 *   e manual, pelas mensagens prontas do app).
 * - `?summary=0` pula o resumo (re-execucao manual so dos e-mails).
 *
 * Autenticacao: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron),
 * header `x-cron-secret` ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'
import { sendTransactional, formatWhen } from '../_lib/mailer.js'
import { escapeHtml } from '../_lib/emailShell.js'
import { hasFeature, TRIAL_DAYS } from '../_lib/agendaPlans.js'
import { sendPushToProvider, pushBlockedReason, wallHHMM } from '../_lib/agendaPush.js'
import { loadOptOuts } from '../_lib/unsubscribe.js'
import { diffDays, wallNow } from '../_lib/recurring.js'

const PAGE_SIZE = 80
const REMINDER_BUDGET_MS = 40_000
const TOTAL_BUDGET_MS = 55_000
const MAX_SUMMARY_ROWS = 3000
const MAX_TRIAL_ROWS = 500
const PLAN_COLS = 'id, name, slug, whatsapp, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at'
const LIVE_STATUSES = ['trialing', 'active', 'past_due']
const TRIAL_COLS = 'id, name, email, active, plan_status, trial_ends_at, created_at, stripe_subscription_id, timezone, app_settings'
const PLANS_URL = 'https://brasilconnectusa.com/agenda/planos'

/**
 * Marco do aviso de fim do teste gratis pra uma profissional, ou null.
 * → { key: '3d'|'0d', field, endKey, daysLeft, ended, end }
 *   3d: faltam 1 a 3 dias (pega o dia perdido se o cron falhou);
 *   0d: acaba hoje ou acabou ontem. Datas no fuso da profissional.
 * Ja mandado pro mesmo fim de teste (app_settings[field] === endKey) → null.
 * Funcao pura.
 */
export function trialMilestone(provider, now = new Date()) {
  if (!provider || provider.active === false) return null
  if (String(provider.plan_status || '').toLowerCase() !== 'trialing' || provider.stripe_subscription_id) return null
  const end = provider.trial_ends_at
    ? new Date(provider.trial_ends_at)
    : provider.created_at ? new Date(new Date(provider.created_at).getTime() + TRIAL_DAYS * 86400e3) : null
  if (!end || Number.isNaN(end.getTime())) return null
  const tz = provider.timezone || 'America/New_York'
  const endKey = wallNow(tz, end).key
  const daysLeft = diffDays(wallNow(tz, now).key, endKey)
  let key = null
  if (daysLeft >= 1 && daysLeft <= 3) key = '3d'
  else if (daysLeft === 0 || daysLeft === -1) key = '0d'
  if (!key) return null
  const field = `trial_mail_${key}`
  if ((provider.app_settings || {})[field] === endKey) return null
  return { key, field, endKey, daysLeft, ended: end.getTime() <= now.getTime(), end }
}

/** Assunto, titulo e paragrafos do aviso de fim do teste. Sem preco. Funcao pura. */
export function trialMailContent(provider, m) {
  const first = escapeHtml(String(provider?.name || '').trim().split(' ')[0] || '')
  let fim
  try {
    fim = m.end.toLocaleDateString('pt-BR', { timeZone: provider?.timezone || 'America/New_York', day: '2-digit', month: 'long' })
  } catch (_) {
    fim = m.end.toLocaleDateString('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: 'long' })
  }
  const depois = 'Sem um plano ativo, o app fica só para consulta: você continua vendo sua agenda e suas clientes, mas não cria agendamentos novos e sua página para de aceitar horários.'
  const oi = first ? `Oi, ${first}! ` : ''
  if (m.key === '3d') {
    const quando = m.daysLeft === 1 ? 'amanhã' : `em ${m.daysLeft} dias`
    return {
      subject: `Seu teste grátis do AgendaPro termina ${quando}`,
      title: `Seu teste termina ${quando}`,
      paragraphs: [
        `${oi}Seu teste grátis do AgendaPro termina em <strong>${escapeHtml(fim)}</strong>. Até lá, tudo do Premium continua liberado.`,
        depois,
        'Pra continuar sem interrupção, escolha seu plano na página de planos.',
      ],
    }
  }
  return m.ended
    ? {
      subject: 'Seu teste grátis do AgendaPro terminou',
      title: 'Seu teste grátis terminou',
      paragraphs: [
        m.daysLeft === 0
          ? `${oi}Seu teste grátis do AgendaPro terminou hoje.`
          : `${oi}Seu teste grátis do AgendaPro terminou em <strong>${escapeHtml(fim)}</strong>.`,
        depois,
        'Seus dados continuam guardados. Pra voltar a usar tudo, escolha seu plano na página de planos.',
      ],
    }
    : {
      subject: 'Seu teste grátis do AgendaPro termina hoje',
      title: 'Seu teste termina hoje',
      paragraphs: [
        `${oi}Hoje é o último dia do seu teste grátis do AgendaPro.`,
        depois,
        'Pra continuar sem interrupção, escolha seu plano na página de planos.',
      ],
    }
}

/**
 * Agrupa os agendamentos de amanha por profissional → { [provider_id]: { count, first } }.
 * `first` = menor scheduled_for (hora de parede). Funcao pura.
 */
export function summarizeByProvider(rows) {
  const out = {}
  for (const r of rows || []) {
    if (!r?.provider_id || !r.scheduled_for) continue
    const cur = out[r.provider_id] || (out[r.provider_id] = { count: 0, first: null })
    cur.count++
    if (!cur.first || String(r.scheduled_for) < String(cur.first)) cur.first = r.scheduled_for
  }
  return out
}

/** Aniversariantes por profissional → { [provider_id]: [nomes] }. Funcao pura. */
export function birthdaysByProvider(rows) {
  const out = {}
  for (const c of rows || []) {
    const name = String(c?.name || '').trim()
    if (!c?.provider_id || !name) continue
    ;(out[c.provider_id] || (out[c.provider_id] = [])).push(name)
  }
  return out
}

export function summaryText({ count, first, birthdays } = {}) {
  const n = Number(count) || 0
  let txt = n > 0
    ? `Amanhã: ${n} ${n === 1 ? 'atendimento' : 'atendimentos'}, o primeiro às ${wallHHMM(first)}.`
    : 'Amanhã: nenhum atendimento marcado.'
  const names = (birthdays || []).filter(Boolean)
  if (names.length) {
    const shown = names.slice(0, 3)
    const extra = names.length - shown.length
    const list = extra > 0 ? `${shown.join(', ')} e mais ${extra}`
      : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}`
      : shown[0]
    txt += ` ${names.length === 1 ? 'Aniversariante' : 'Aniversariantes'}: ${list}.`
  }
  return txt
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const started = Date.now()
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Horarios sao hora do relogio da profissional guardada sem fuso: "amanha" e pela data.
    const tomorrowStart = new Date(); tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1); tomorrowStart.setUTCHours(0, 0, 0, 0)
    const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setUTCHours(23, 59, 59, 999)

    // ── 1. Lembrete por e-mail pra cliente ────────────────────────────────
    // O banco ja tira o que seria pulado (sem e-mail, profissional inativa ou com
    // status de plano que nao vale), pra essas linhas nao ocuparem as paginas.
    // Keyset por id: as linhas marcadas como enviadas saem do filtro, entao
    // offset (range) pularia linhas.
    const pageQuery = (afterId) => {
      let q = supabase
        .from('ag_appointments')
        .select(`id, scheduled_for, client_name, client_email, ag_services(name), ag_providers!inner(${PLAN_COLS})`)
        .eq('status', 'confirmed')
        .eq('reminder_24h_sent', false)
        // Turnover (limpeza de Airbnb/Vrbo) nao tem cliente pra lembrar
        .is('external_uid', null)
        .not('client_email', 'is', null)
        .eq('ag_providers.active', true)
        .in('ag_providers.plan_status', LIVE_STATUSES)
        .gte('scheduled_for', tomorrowStart.toISOString())
        .lte('scheduled_for', tomorrowEnd.toISOString())
      if (afterId) q = q.gt('id', afterId)
      return q.order('id', { ascending: true }).limit(PAGE_SIZE)
    }

    let total = 0, sent = 0, failed = 0, semEmail = 0, semPlano = 0, left = false
    let remindersError = null
    let lastId = null
    for (;;) {
      if (Date.now() - started > REMINDER_BUDGET_MS) { left = true; break }
      const { data: page, error } = await pageQuery(lastId)
      if (error) {
        if (!total) return res.status(500).json({ error: error.message })
        remindersError = error.message
        break
      }
      if (!page?.length) break
      total += page.length
      lastId = page[page.length - 1].id

      for (const apt of page) {
        // Status pode valer mas o plano nao (teste vencido, periodo acabado)
        if (!apt.ag_providers || !hasFeature(apt.ag_providers, 'email_reminders')) { semPlano++; continue }
        if (!String(apt.client_email || '').trim()) { semEmail++; continue }

        const provName = apt.ag_providers?.name || 'sua profissional'
        const first = String(apt.client_name || '').trim().split(' ')[0]
        const r = await sendTransactional({
          to: apt.client_email,
          subject: `Lembrete: ${apt.ag_services?.name || 'seu horário'} amanhã com ${provName}`,
          kicker: 'LEMBRETE',
          title: 'Seu horário é amanhã',
          paragraphs: [
            `${first ? 'Oi, ' + escapeHtml(first) + '! ' : ''}Passando pra lembrar do seu agendamento.`,
            `<strong>${escapeHtml(apt.ag_services?.name || 'Atendimento')}</strong> com <strong>${escapeHtml(provName)}</strong>`,
            `Quando: <strong>${escapeHtml(formatWhen(apt.scheduled_for))}</strong>`,
            apt.ag_providers?.whatsapp ? `Precisa remarcar? Fale com ${escapeHtml(provName)} no WhatsApp: ${escapeHtml(apt.ag_providers.whatsapp)}` : '',
          ].filter(Boolean),
          ctaUrl: apt.ag_providers?.slug ? `https://brasilconnectusa.com/agenda/${apt.ag_providers.slug}` : undefined,
          ctaLabel: 'Ver perfil',
        })

        if (r.ok) {
          await supabase.from('ag_appointments').update({ reminder_24h_sent: true }).eq('id', apt.id)
          sent++
        } else {
          failed++
        }
      }
      if (page.length < PAGE_SIZE) break
    }

    // ── 2. Resumo de amanha (push pra profissional) ──────────────────────
    const summary = { providers: 0, pushed: 0, skipped: 0, birthdays: 0 }
    if (req.query?.summary !== '0') {
      try {
        const { data: rows, error: sErr } = await supabase
          .from('ag_appointments')
          .select('provider_id, scheduled_for')
          .in('status', ['pending', 'confirmed'])
          .gte('scheduled_for', tomorrowStart.toISOString())
          .lte('scheduled_for', tomorrowEnd.toISOString())
          .order('scheduled_for', { ascending: true })
          .limit(MAX_SUMMARY_ROWS)
        if (sErr) throw new Error(sErr.message)

        const byProvider = summarizeByProvider(rows)

        // Aniversariantes de amanha (best effort: sem a coluna birthday_md/archived, fica sem)
        let bdays = {}
        try {
          const md = tomorrowStart.toISOString().slice(5, 10)   // 'MM-DD'
          const base = () => supabase.from('ag_clients').select('provider_id, name').eq('birthday_md', md).limit(MAX_SUMMARY_ROWS)
          let q = await base().eq('archived', false)
          if (q.error && /archived/.test(q.error.message || '')) q = await base()
          if (!q.error) bdays = birthdaysByProvider(q.data)
        } catch (_) { /* segue so com os atendimentos */ }
        summary.birthdays = Object.values(bdays).reduce((s, l) => s + l.length, 0)

        const ids = [...new Set([...Object.keys(byProvider), ...Object.keys(bdays)])]
        summary.providers = ids.length
        if (ids.length) {
          // Uma consulta pra todas: plano + preferencias (o resumo vem desligado por padrao)
          let { data: provs, error: pErr } = await supabase.from('ag_providers')
            .select(PLAN_COLS + ', app_settings').in('id', ids)
          if (pErr) provs = []
          for (const p of provs || []) {
            if (pushBlockedReason(p, 'daily_summary')) { summary.skipped++; continue }
            const r = await sendPushToProvider(supabase, p.id, {
              provider: p,
              kind: 'daily_summary',
              title: 'Sua agenda de amanhã',
              body: summaryText({ ...(byProvider[p.id] || {}), birthdays: bdays[p.id] }),
              data: { type: 'agenda', date: tomorrowStart.toISOString().slice(0, 10) },
            })
            if (r.sent > 0) summary.pushed++
            else summary.skipped++
          }
        }
      } catch (sumErr) {
        console.error('resumo de amanha falhou:', sumErr.message)
        summary.error = sumErr.message
      }
    }

    // ── 3. Fim do teste gratis (e-mail pra profissional sem assinatura) ───
    const trial = { candidates: 0, sent: 0, failed: 0, optout: 0, left: 0 }
    try {
      const now = new Date()
      // Folga de 1 dia pros fusos: o marco exato sai de trialMilestone
      const lo = new Date(now.getTime() - 3 * 86400e3).toISOString()
      const hi = new Date(now.getTime() + 5 * 86400e3).toISOString()
      // Sem app_settings (ag_app_base.sql nao aplicado) nao da pra marcar o envio: pula
      const { data: provs, error: tErr } = await supabase.from('ag_providers')
        .select(TRIAL_COLS)
        .eq('plan_status', 'trialing')
        .is('stripe_subscription_id', null)
        .eq('active', true)
        .not('email', 'is', null)
        .gte('trial_ends_at', lo)
        .lte('trial_ends_at', hi)
        .order('trial_ends_at', { ascending: true })
        .limit(MAX_TRIAL_ROWS)
      if (tErr) throw new Error(tErr.message)

      const due = []
      for (const p of provs || []) {
        const m = trialMilestone(p, now)
        if (m && String(p.email || '').trim()) due.push({ p, m })
      }
      trial.candidates = due.length
      const optedOut = due.length ? await loadOptOuts(supabase, due.map(d => d.p.email)) : new Set()

      for (const { p, m } of due) {
        if (Date.now() - started > TOTAL_BUDGET_MS) { trial.left++; continue }
        const to = String(p.email).trim().toLowerCase()
        if (optedOut.has(to)) { trial.optout++; continue }
        const c = trialMailContent(p, m)
        const r = await sendTransactional({
          to,
          subject: c.subject,
          kicker: 'AGENDAPRO',
          title: c.title,
          paragraphs: c.paragraphs,
          ctaUrl: PLANS_URL,
          ctaLabel: 'Ver os planos',
        })
        if (!r.ok) { trial.failed++; continue }
        trial.sent++
        // Marca o marco com a data do fim do teste (nao repete se o cron rodar de novo)
        const next = { ...(p.app_settings || {}), [m.field]: m.endKey }
        const { error: uErr } = await supabase.from('ag_providers').update({ app_settings: next }).eq('id', p.id)
        if (uErr) console.error('aviso de fim do teste: marcar envio falhou', p.id, uErr.message)
      }
    } catch (trialErr) {
      console.error('aviso de fim do teste falhou:', trialErr.message)
      trial.error = trialErr.message
    }

    return res.status(200).json({
      ok: true, total, sent, failed, sem_email: semEmail, sem_plano: semPlano, left,
      ...(remindersError ? { reminders_error: remindersError } : {}),
      summary, trial,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
