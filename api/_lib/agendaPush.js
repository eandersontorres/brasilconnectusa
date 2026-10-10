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
 *     Outros tipos (ex.: 'billing', aviso de cobranca) nao tem chave e sempre vao.
 * Envia pela API da Expo em lotes de 100; token com DeviceNotRegistered e desativado.
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

    const { data: rows, error } = await supabase.from('ag_push_tokens')
      .select('token')
      .eq('provider_id', providerId)
      .is('disabled_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(MAX_TOKENS)
    if (error) {
      console.error('[agendaPush] tokens:', error.message)
      return { sent: 0, skipped: 'db_error' }
    }
    if (!rows?.length) return { sent: 0, skipped: 'no_tokens' }

    const payload = { ...(data && typeof data === 'object' ? data : {}), kind: kind || 'general' }
    const messages = rows.map((r) => ({
      to: r.token,
      title: clip(title, 100),
      body: clip(body, 240),
      data: payload,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }))

    let sent = 0
    const dead = []
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH)
      let res = null
      try { res = await postToExpo(batch) } catch (e) { console.error('[agendaPush] envio:', e.message) }
      const tickets = Array.isArray(res?.data) ? res.data : []
      tickets.forEach((t, j) => {
        if (t?.status === 'ok') sent++
        else if (t?.details?.error === 'DeviceNotRegistered' && batch[j]) dead.push(batch[j].to)
      })
    }

    if (dead.length) {
      const { error: dErr } = await supabase.from('ag_push_tokens')
        .update({ disabled_at: new Date().toISOString() })
        .in('token', dead)
      if (dErr) console.error('[agendaPush] desativar tokens:', dErr.message)
    }

    return { sent, total: messages.length, disabled: dead.length }
  } catch (e) {
    console.error('[agendaPush] erro:', e.message)
    return { sent: 0, error: e.message }
  }
}
