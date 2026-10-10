/**
 * AgendaPro — notificacao push no celular da profissional (app Expo).
 * NAO e rota (subdir _lib nao vira endpoint Vercel).
 *
 *   import { sendPushToProvider } from '../_lib/agendaPush.js'
 *   await sendPushToProvider(supabase, providerId, {
 *     kind: 'new_booking', title: 'Novo agendamento', body: 'Ana · Escova · ter 13/10 às 10:00',
 *     data: { type: 'appointment', id },
 *   })
 *
 * Best effort: nunca lanca, devolve { sent, ... } so pra log. Respeita:
 *   - o plano (recurso 'push_notifications');
 *   - as preferencias do app (app_settings.notify_*), por tipo de aviso:
 *       new_booking → notify_new_booking (padrao ligado)
 *       cancellation → notify_cancellation (padrao ligado)
 *       review → notify_review (padrao ligado)
 *       daily_summary → notify_daily_summary (padrao DESLIGADO)
 *       documents → notify_documents (padrao ligado): orcamento aberto/aprovado/recusado,
 *                   fatura paga e pedido de orcamento novo (WorkPro)
 *     Outros tipos (ex.: 'billing', aviso de cobranca) nao tem chave e sempre vao.
 * Envia pela API da Expo em lotes de 100; token com DeviceNotRegistered e desativado.
 * AgendaPro e WorkPro sao projetos Expo diferentes e a Expo recusa a requisicao inteira quando
 * mistura tokens dos dois (PUSH_TOO_MANY_EXPERIENCE_IDS). Por isso agrupa pela coluna `app` de
 * ag_push_tokens (quando existe) e, se ainda vier misturado (token antigo sem app), reenvia
 * separado pelos grupos que a Expo devolve em errors[0].details.
 * EXPO_ACCESS_TOKEN (opcional): exigido se a "push security" estiver ligada no projeto Expo.
 */
import { hasFeature } from './agendaPlans.js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH = 100
const TIMEOUT_MS = 8000
const MAX_TOKENS = 50

export const KIND_SETTINGS = {
  new_booking:   { key: 'notify_new_booking',   def: true },
  cancellation:  { key: 'notify_cancellation',  def: true },
  review:        { key: 'notify_review',        def: true },
  daily_summary: { key: 'notify_daily_summary', def: false },
  documents:     { key: 'notify_documents',     def: true },
}

const PLAN_COLS = 'id, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at'

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const pad = (n) => String(n).padStart(2, '0')
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * Motivo pra NAO mandar (ou null = pode mandar). Funcao pura: testavel sem banco.
 * `provider` precisa das colunas de plano + app_settings.
 */
export function pushBlockedReason(provider, kind, now = new Date()) {
  if (!provider) return 'no_provider'
  if (!hasFeature(provider, 'push_notifications', now)) return 'plan'
  const rule = KIND_SETTINGS[kind]
  if (rule) {
    const v = (provider.app_settings || {})[rule.key]
    const on = v === undefined || v === null ? rule.def : v !== false
    if (!on) return 'muted'
  }
  return null
}

/**
 * Hora de parede (scheduled_for gravado como UTC sem fuso) → 'ter 13/10 às 10:00'.
 * Le com getters UTC, igual ao app e ao mailer.
 */
export function shortWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 'HH:MM' da hora de parede. */
export function wallHHMM(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

async function loadProvider(supabase, providerId) {
  const full = await supabase.from('ag_providers').select(PLAN_COLS + ', app_settings').eq('id', providerId).maybeSingle()
  if (!full.error) return full.data || null
  // Banco sem a coluna app_settings (ag_app_base.sql ainda nao aplicado): vale o padrao
  const basic = await supabase.from('ag_providers').select(PLAN_COLS).eq('id', providerId).maybeSingle()
  return basic.data || null
}

async function postToExpo(messages) {
  const headers = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  }
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages), signal: ctrl.signal })
    const json = await r.json().catch(() => null)
    // Tokens de projetos diferentes no mesmo envio: devolve os grupos pra reenviar separado
    const err = Array.isArray(json?.errors) ? json.errors.find((e) => e?.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS') : null
    if (err && err.details && typeof err.details === 'object') {
      return { mixed: Object.values(err.details).filter(Array.isArray) }
    }
    if (!r.ok) {
      console.error('[agendaPush] expo respondeu', r.status, JSON.stringify(json?.errors || json || {}).slice(0, 300))
      return null
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Manda um lote e devolve [{ to, ticket }] na ordem das mensagens. Lote com tokens de projetos
 * diferentes (AgendaPro + WorkPro) e reenviado uma vez, um envio por projeto.
 */
export async function deliver(batch, post = postToExpo, split = true) {
  let res = null
  try { res = await post(batch) } catch (e) { console.error('[agendaPush] envio:', e.message) }
  if (res?.mixed && split) {
    const done = new Set()
    const out = []
    const groups = res.mixed.map((tokens) => new Set(tokens))
    // O que a Expo nao listou em nenhum grupo vai num envio a parte
    groups.push(null)
    for (const g of groups) {
      const part = batch.filter((m) => !done.has(m.to) && (g ? g.has(m.to) : true))
      if (!part.length) continue
      part.forEach((m) => done.add(m.to))
      out.push(...await deliver(part, post, false))
    }
    return out
  }
  const tickets = Array.isArray(res?.data) ? res.data : []
  return batch.map((m, j) => ({ to: m.to, ticket: tickets[j] || null }))
}

const isSchemaError = (e) => ['42703', 'PGRST204'].includes(e?.code) || /column .* does not exist|could not find/i.test(e?.message || '')

/** Tokens ativos (com o app de cada um, se a coluna existir). */
async function loadTokens(supabase, providerId) {
  const run = (cols) => supabase.from('ag_push_tokens')
    .select(cols)
    .eq('provider_id', providerId)
    .is('disabled_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(MAX_TOKENS)
  let r = await run('token, app')
  if (r.error && isSchemaError(r.error)) r = await run('token')
  return r
}

/**
 * Manda o aviso pra todos os celulares ativos da profissional.
 * Opcional: `provider` (linha ja carregada com colunas de plano + app_settings) evita uma consulta.
 */
export async function sendPushToProvider(supabase, providerId, { title, body, data, kind, provider } = {}) {
  try {
    if (!supabase || !providerId || !title) return { sent: 0, skipped: 'invalid' }

    const prov = provider && provider.id === providerId && 'plan_status' in provider
      ? provider
      : await loadProvider(supabase, providerId)
    const blocked = pushBlockedReason(prov, kind)
    if (blocked) return { sent: 0, skipped: blocked }

    const { data: rows, error } = await loadTokens(supabase, providerId)
    if (error) {
      console.error('[agendaPush] tokens:', error.message)
      return { sent: 0, skipped: 'db_error' }
    }
    if (!rows?.length) return { sent: 0, skipped: 'no_tokens' }

    const payload = { ...(data && typeof data === 'object' ? data : {}), kind: kind || 'general' }
    // Um grupo por app (projeto Expo); token antigo sem app fica no grupo '' (deliver separa se misturar)
    const groups = new Map()
    for (const r of rows) {
      const key = r.app || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({
        to: r.token,
        title: clip(title, 100),
        body: clip(body, 240),
        data: payload,
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      })
    }

    let sent = 0
    let total = 0
    const dead = []
    for (const messages of groups.values()) {
      total += messages.length
      for (let i = 0; i < messages.length; i += BATCH) {
        const results = await deliver(messages.slice(i, i + BATCH))
        for (const { to, ticket } of results) {
          if (ticket?.status === 'ok') sent++
          else if (ticket?.details?.error === 'DeviceNotRegistered') dead.push(to)
        }
      }
    }

    if (dead.length) {
      const { error: dErr } = await supabase.from('ag_push_tokens')
        .update({ disabled_at: new Date().toISOString() })
        .in('token', dead)
      if (dErr) console.error('[agendaPush] desativar tokens:', dErr.message)
    }

    return { sent, total, disabled: dead.length }
  } catch (e) {
    console.error('[agendaPush] erro:', e.message)
    return { sent: 0, error: e.message }
  }
}
