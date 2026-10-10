/**
 * GET /api/cron/agenda-documents
 *
 * Cron diário (vercel.json, 15:00 UTC) dos orçamentos e faturas (WorkPro / AgendaPro):
 *   1. Fatura vencida: due_date antes de hoje (fuso da profissional), saldo > 0 e status
 *      sent/viewed/partial → 'overdue' + evento 'overdue'.
 *   2. Orçamento vencido: sent/viewed com valid_until antes de hoje → 'expired' + evento.
 *   3. Cobrança automática (só profissional com 'payment_reminders' no plano e cliente com
 *      e-mail; só fatura que já foi enviada, com sent_at): e-mail no 1º, 7º e 14º dia de atraso
 *      (no máximo 3 automáticos). O atraso conta do vencimento, nunca de antes do dia em que a
 *      fatura saiu. Atrasou a execução? Manda o que ficou devendo, mas nunca dois lembretes com
 *      menos de 5 dias de distância (conta também a cobrança manual) e nunca dois no mesmo dia:
 *      rodar duas vezes no mesmo dia não repete. Respeita o teto diário de e-mails de documento
 *      da profissional (docEmailDailyCap, o mesmo do envio manual). Grava last_reminder_at,
 *      reminders_sent e evento 'reminder' (channel 'cron', detail.email_sent = true).
 *   4. Push de resumo pra profissional (faturas que venceram, lembretes enviados), se ela não
 *      desligou notify_documents.
 *
 * Paginado por id (keyset), dentro de ~50s; o que sobrar fica pra próxima execução (left).
 * Autenticação: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron), header `x-cron-secret`
 * ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'
import { hasFeature } from '../_lib/agendaPlans.js'
import { sendPushToProvider } from '../_lib/agendaPush.js'
import {
  addEvent, sendDocEmail, shapeDoc, dateKeyIn, addDaysKey, diffDaysKey, balanceOf, isEmail,
  docEmailDailyCap, countDocEmails,
} from '../_lib/documents.js'

const PAGE_SIZE = 500
const REMINDER_PAGE = 100
const BUDGET_MS = 50_000
const MAX_SCAN = 20000
export const REMINDER_DAYS = [1, 7, 14]   // dias de atraso de cada lembrete automático
export const MIN_GAP_DAYS = 5              // distância mínima entre dois lembretes
const LIVE_STATUSES = ['trialing', 'active', 'past_due']

const PROV_COLS = 'id, name, email, slug, whatsapp, timezone, app_settings, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at, stripe_account_id, stripe_charges_enabled'
const REM_COLS = 'id, provider_id, kind, number, status, client_name, client_email, title, language, issue_date, due_date, total_cents, amount_paid_cents, payment_instructions, public_token, sent_at, viewed_at, last_reminder_at, reminders_sent'

/**
 * Lembrete automático hoje? Função pura.
 * doc: { due_date, sent_at, last_reminder_at }, autoSent = lembretes automáticos já mandados,
 * today = 'YYYY-MM-DD' e tz da profissional.
 * O atraso conta do vencimento; se a fatura saiu depois dele, conta do dia do envio (fatura que
 * já chegou vencida não recebe o lote de lembretes atrasados de uma vez).
 * → { send: true, n, daysLate } | { send: false, reason }
 */
export function reminderDecision(doc, autoSent, today, tz) {
  const dueKey = doc?.due_date ? String(doc.due_date).slice(0, 10) : null
  const sentKey = doc?.sent_at ? dateKeyIn(tz, doc.sent_at) : null
  const due = dueKey && sentKey && sentKey > dueKey ? sentKey : dueKey
  if (!due || !today || due >= today) return { send: false, reason: 'not_due' }
  const daysLate = diffDaysKey(due, today)
  const owed = REMINDER_DAYS.filter((d) => daysLate >= d).length
  const sent = Math.max(0, Number(autoSent) || 0)
  if (sent >= REMINDER_DAYS.length) return { send: false, reason: 'max' }
  if (sent >= owed) return { send: false, reason: 'not_yet' }
  if (doc.last_reminder_at) {
    const lastKey = dateKeyIn(tz, doc.last_reminder_at)
    if (lastKey === today) return { send: false, reason: 'today' }
    if (lastKey && diffDaysKey(lastKey, today) < MIN_GAP_DAYS) return { send: false, reason: 'gap' }
  }
  return { send: true, n: sent + 1, daysLate }
}

function authorized(req) {
  const auth = req.headers?.authorization || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearer || req.headers?.['x-cron-secret'] || req.query?.secret
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const started = Date.now()
  const late = () => Date.now() - started > BUDGET_MS
  const totals = { overdue: 0, expired: 0, reminders_sent: 0, reminders_failed: 0, reminders_skipped_plan: 0, reminders_skipped_limit: 0, pushed: 0, left: false, errors: [] }
  // Resumo por profissional pro push
  const perProvider = new Map()
  const bump = (pid, key) => {
    const p = perProvider.get(pid) || { overdue: 0, reminders: 0, settings: null }
    p[key]++
    perProvider.set(pid, p)
    return p
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const now = new Date()
    // Nenhum fuso dos EUA está à frente do UTC: candidato = data UTC de amanhã (folga), e o
    // corte certo é refeito com a data no fuso de cada profissional.
    const maxKey = addDaysKey(now.toISOString().slice(0, 10), 1)

    // ── 1. Faturas vencidas ───────────────────────────────────────────────
    {
      let lastId = null
      let scanned = 0
      for (;;) {
        if (late() || scanned >= MAX_SCAN) { totals.left = true; break }
        let q = supabase.from('ag_documents')
          .select('id, provider_id, status, total_cents, amount_paid_cents, due_date, ag_providers!inner(timezone, app_settings)')
          .eq('kind', 'invoice').in('status', ['sent', 'viewed', 'partial']).lt('due_date', maxKey)
        if (lastId) q = q.gt('id', lastId)
        const { data, error } = await q.order('id', { ascending: true }).limit(PAGE_SIZE)
        if (error) { totals.errors.push(`overdue: ${error.message}`); break }
        if (!data?.length) break
        scanned += data.length
        lastId = data[data.length - 1].id
        for (const d of data) {
          const tz = d.ag_providers?.timezone || 'America/New_York'
          const today = dateKeyIn(tz, now)
          if (!(String(d.due_date).slice(0, 10) < today) || balanceOf({ ...d, kind: 'invoice' }) <= 0) continue
          const { data: upd, error: uErr } = await supabase.from('ag_documents')
            .update({ status: 'overdue', updated_at: now.toISOString() })
            .eq('id', d.id).eq('provider_id', d.provider_id).eq('status', d.status).select('id')
          if (uErr) { totals.errors.push(`overdue ${d.id}: ${uErr.message}`); continue }
          if (!upd?.length) continue
          totals.overdue++
          await addEvent(supabase, d, 'overdue', 'cron', { due_date: String(d.due_date).slice(0, 10) })
          bump(d.provider_id, 'overdue').settings = d.ag_providers?.app_settings || {}
        }
        if (data.length < PAGE_SIZE) break
      }
    }

    // ── 2. Orçamentos vencidos ────────────────────────────────────────────
    {
      let lastId = null
      let scanned = 0
      for (;;) {
        if (late() || scanned >= MAX_SCAN) { totals.left = true; break }
        let q = supabase.from('ag_documents')
          .select('id, provider_id, status, valid_until, ag_providers!inner(timezone)')
          .eq('kind', 'quote').in('status', ['sent', 'viewed']).lt('valid_until', maxKey)
        if (lastId) q = q.gt('id', lastId)
        const { data, error } = await q.order('id', { ascending: true }).limit(PAGE_SIZE)
        if (error) { totals.errors.push(`expired: ${error.message}`); break }
        if (!data?.length) break
        scanned += data.length
        lastId = data[data.length - 1].id
        for (const d of data) {
          const today = dateKeyIn(d.ag_providers?.timezone || 'America/New_York', now)
          if (!(String(d.valid_until).slice(0, 10) < today)) continue
          const { data: upd, error: uErr } = await supabase.from('ag_documents')
            .update({ status: 'expired', updated_at: now.toISOString() })
            .eq('id', d.id).eq('provider_id', d.provider_id).eq('status', d.status).select('id')
          if (uErr) { totals.errors.push(`expired ${d.id}: ${uErr.message}`); continue }
          if (!upd?.length) continue
          totals.expired++
          await addEvent(supabase, d, 'expired', 'cron', { valid_until: String(d.valid_until).slice(0, 10) })
        }
        if (data.length < PAGE_SIZE) break
      }
    }

    // ── 3. Cobrança automática ────────────────────────────────────────────
    {
      let lastId = null
      let scanned = 0
      // E-mails de documento por profissional nas últimas 24h (teto diário, igual ao envio manual)
      const since = new Date(now.getTime() - 24 * 3600e3).toISOString()
      const mailUsed = new Map()
      const underCap = async (prov) => {
        if (!mailUsed.has(prov.id)) {
          try { mailUsed.set(prov.id, await countDocEmails(supabase, prov.id, since)) } catch (e) {
            totals.errors.push(`reminders cap ${prov.id}: ${e.message}`)
            mailUsed.set(prov.id, Infinity)   // sem conseguir contar, não manda (fica pra amanhã)
          }
        }
        return mailUsed.get(prov.id) < docEmailDailyCap(prov, now)
      }
      for (;;) {
        if (late() || scanned >= MAX_SCAN) { totals.left = true; break }
        let q = supabase.from('ag_documents')
          .select(`${REM_COLS}, ag_providers!inner(${PROV_COLS})`)
          .eq('kind', 'invoice').eq('status', 'overdue')
          .not('client_email', 'is', null)
          .not('sent_at', 'is', null)
          .eq('ag_providers.active', true)
          .in('ag_providers.plan_status', LIVE_STATUSES)
        if (lastId) q = q.gt('id', lastId)
        const { data, error } = await q.order('id', { ascending: true }).limit(REMINDER_PAGE)
        if (error) { totals.errors.push(`reminders: ${error.message}`); break }
        if (!data?.length) break
        scanned += data.length
        lastId = data[data.length - 1].id

        const eligible = data.filter((d) => {
          if (!hasFeature(d.ag_providers, 'payment_reminders', now)) { totals.reminders_skipped_plan++; return false }
          return isEmail(d.client_email) && balanceOf(d) > 0
        })
        // Quantos lembretes automáticos cada fatura já recebeu
        const autoCount = new Map()
        if (eligible.length) {
          const { data: evs, error: eErr } = await supabase.from('ag_document_events').select('document_id')
            .in('document_id', eligible.map((d) => d.id)).eq('type', 'reminder').eq('channel', 'cron').limit(5000)
          if (eErr) { totals.errors.push(`reminders events: ${eErr.message}`); break }
          for (const e of evs || []) autoCount.set(e.document_id, (autoCount.get(e.document_id) || 0) + 1)
        }

        for (const d of eligible) {
          if (late()) { totals.left = true; break }
          const prov = d.ag_providers
          const tz = prov.timezone || 'America/New_York'
          const today = dateKeyIn(tz, now)
          const dec = reminderDecision(d, autoCount.get(d.id) || 0, today, tz)
          if (!dec.send) continue
          if (!(await underCap(prov))) { totals.reminders_skipped_limit++; continue }
          const { ag_providers, ...row } = d
          const r = await sendDocEmail(supabase, shapeDoc(row, { today }), prov, 'reminder')
          if (!r.ok) { totals.reminders_failed++; continue }
          mailUsed.set(prov.id, (mailUsed.get(prov.id) || 0) + 1)
          const { error: uErr } = await supabase.from('ag_documents')
            .update({ last_reminder_at: now.toISOString(), reminders_sent: (Number(d.reminders_sent) || 0) + 1 })
            .eq('id', d.id).eq('provider_id', d.provider_id)
          if (uErr) totals.errors.push(`reminder ${d.id}: ${uErr.message}`)
          await addEvent(supabase, d, 'reminder', 'cron', { auto: true, n: dec.n, days_late: dec.daysLate, email_sent: true })
          totals.reminders_sent++
          bump(d.provider_id, 'reminders').settings = prov.app_settings || {}
        }
        if (data.length < REMINDER_PAGE) break
      }
    }

    // ── 4. Push de resumo pra profissional ────────────────────────────────
    for (const [pid, p] of perProvider) {
      if (late()) break
      if ((p.settings || {}).notify_documents === false) continue
      const parts = []
      if (p.overdue) parts.push(p.overdue === 1 ? '1 fatura venceu' : `${p.overdue} faturas venceram`)
      if (p.reminders) parts.push(p.reminders === 1 ? '1 lembrete de pagamento enviado por e-mail' : `${p.reminders} lembretes de pagamento enviados por e-mail`)
      if (!parts.length) continue
      const r = await sendPushToProvider(supabase, pid, {
        kind: 'documents',
        title: p.reminders ? 'Cobrança automática' : 'Fatura vencida',
        body: parts.join(' · '),
        data: { type: 'documents', screen: 'vendas', filter: 'overdue' },
      })
      if (r?.sent) totals.pushed++
    }

    return res.status(200).json({ ok: true, ...totals, errors: totals.errors.slice(0, 20), ms: Date.now() - started })
  } catch (e) {
    return res.status(500).json({ error: e.message, ...totals })
  }
}
