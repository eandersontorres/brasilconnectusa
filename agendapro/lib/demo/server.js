// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — "servidor" em memória no lugar das APIs do site.
//
//   lib/api.js (só com EXPO_PUBLIC_DEMO=1) chama demo.fetch(path, init) em vez do
//   fetch de verdade. Aqui respondem as MESMAS rotas, métodos, query, actions e
//   formatos de api/agenda/*.js, api/stripe/*.js e api/upload.js (nomes de campo
//   copiados de lá). O estado muda de verdade (criar, cancelar, pagar…) e vive só
//   na memória: recarregar a página volta aos dados de exemplo. Plano sem o
//   recurso → 402 igual ao servidor (lib/demo/plans.js é cópia da matriz).
//
//   JS puro, sem react-native: dá pra testar no node.
//     const demo = createDemoServer({ plan: 'trial', vertical: 'services' })
//     const r = await demo.request('/api/agenda/me')   // → { status, body }
// ════════════════════════════════════════════════════════════════════════════
import { entitlementsFor, hasFeature, limitFor, requireFeature, requireLimit } from './plans.js'
import { buildFixtures, DEMO_USER, placeholderImage } from './fixtures.js'
import { financeRoute, HttpError } from './finance.js'
import {
  addDays, clip, clone, diffDays, EMAIL_RE, fold, has, hhmmOf, int, keyOf, localNowWall, localToday,
  normalizePhone, pad, toMin, toWall, uid, weekdayOf,
} from './util.js'

const DAY_MS = 86400e3
const ACTIVE = ['pending', 'confirmed']
const METHODS = ['zelle', 'cash', 'card', 'venmo', 'cashapp', 'check', 'other']
const STATUS_PT = { pending: 'aguardando sinal', confirmed: 'confirmado', completed: 'realizado', canceled: 'cancelado', no_show: 'faltou' }
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const LANGS = ['pt', 'en', 'es']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (body, status = 200) => ({ status, body })
const fail = (status, error, extra = {}) => { throw new HttpError(status, { error, ...extra }) }
const notAllowed = () => ok({ error: 'Method not allowed' }, 405)
function gate(provider, key) {
  const g = requireFeature(provider, key)
  if (!g.ok) throw new HttpError(g.status, g.body)
}
function limitGate(provider, key, count) {
  const g = requireLimit(provider, key, count)
  if (!g.ok) throw new HttpError(g.status, g.body)
}
const validDate = (s) => DATE_RE.test(String(s || '')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s
const asc = (x, y) => x.scheduled_for.localeCompare(y.scheduled_for)
const desc = (x, y) => y.scheduled_for.localeCompare(x.scheduled_for)
const endOf = (a) => Date.parse(a.scheduled_for) + (Number(a.duration_min) || 0) * 60e3
const pickKeys = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] === undefined ? null : o[k]]))

function parseQuery(qs) {
  const out = {}
  for (const part of String(qs || '').split('&')) {
    if (!part) continue
    const i = part.indexOf('=')
    const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch (_) { return s } }
    out[dec(i < 0 ? part : part.slice(0, i))] = i < 0 ? '' : dec(part.slice(i + 1))
  }
  return out
}

/** Igual a parseWall de api/agenda/appointments.js. */
function parseWall(v, { endOfDay = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z?)?$/.exec(String(v || '').trim())
  if (!m) return null
  const noTime = m[4] === undefined
  const h = noTime ? (endOfDay ? 23 : 0) : Number(m[4])
  const mi = noTime ? (endOfDay ? 59 : 0) : Number(m[5])
  const s = noTime ? (endOfDay ? 59 : 0) : Number(m[6] || 0)
  const ms = noTime ? (endOfDay ? 999 : 0) : Number(String(m[7] || '0').padEnd(3, '0'))
  if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31 || h > 23 || mi > 59 || s > 59) return null
  const iso = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, s, ms)).toISOString()
  return iso.slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? iso : null
}

function weekStartKey(key, mondayFirst) {
  const wd = weekdayOf(key)
  return addDays(key, -(mondayFirst ? (wd + 6) % 7 : wd))
}

// ════════════════════════════════════════════════════════════════════════════
export function createDemoServer({ plan = 'trial', vertical = 'services', siteUrl = 'https://brasilconnectusa.com', latency = [150, 300] } = {}) {
  const site = String(siteUrl || 'https://brasilconnectusa.com').replace(/\/$/, '')
  let db = null
  let uploads = 0
  const state = () => {
    if (!db) db = buildFixtures({ today: localToday(), nowWall: localNowWall(), plan, vertical })
    return db
  }

  /** → { status, body } (body é objeto, ou texto no CSV). */
  async function request(path, { method = 'GET', body = null } = {}) {
    const [min, max] = latency || [0, 0]
    if (max > 0) await sleep(min + Math.random() * (max - min))
    let b = body
    if (typeof b === 'string') { try { b = JSON.parse(b) } catch (_) { b = {} } }
    try {
      const r = route(String(path || ''), String(method || 'GET').toUpperCase(), b && typeof b === 'object' ? b : {})
      return { status: r.status, body: typeof r.body === 'string' ? r.body : clone(r.body) }
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: e.body }
      console.warn('[demo]', path, e)
      return { status: 500, body: { error: e.message || 'Erro na demonstração' } }
    }
  }

  /** Mesmo contrato do fetch que lib/api.js usa (ok, status, text()). */
  async function fetchLike(path, init = {}) {
    const r = await request(path, init)
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text }
  }

  function route(path, method, body) {
    const [pathname, qs] = path.split('?')
    const S = state()
    const c = { S, q: parseQuery(qs), body, method, today: localToday(), nowWall: localNowWall(), site }
    if (method === 'OPTIONS') return ok({})
    switch (pathname.replace(/\/$/, '')) {
      case '/api/agenda/me': return meRoute(c)
      case '/api/agenda/appointments': return appointmentsRoute(c)
      case '/api/agenda/clients': return clientsRoute(c)
      case '/api/agenda/waitlist': return waitlistRoute(c)
      case '/api/agenda/services': return servicesRoute(c)
      case '/api/agenda/hours': return hoursRoute(c)
      case '/api/agenda/blocked': return blockedRoute(c)
      case '/api/agenda/ical': return icalRoute(c)
      case '/api/agenda/connect': return connectRoute(c)
      case '/api/agenda/provider': return providerRoute(c)
      case '/api/agenda/reviews': return reviewsRoute(c)
      case '/api/agenda/request-review': return requestReviewRoute(c)
      case '/api/agenda/finance': return financeRoute(S, c, method, c.q, body)
      case '/api/agenda/staff': return staffRoute(c)
      case '/api/agenda/recurring': return recurringRoute(c)
      case '/api/agenda/push-token': return pushRoute(c)
      case '/api/upload': return uploadRoute(c)
      case '/api/stripe/subscribe': return subscribeRoute(c)
      case '/api/stripe/portal': return portalRoute(c)
      default: return ok({ error: 'Essa tela ainda não tem dados na demonstração.' }, 404)
    }
  }

  // ── /api/agenda/me ────────────────────────────────────────────────────────
  const PROVIDER_COLS = ['id', 'name', 'email', 'slug', 'city', 'state', 'owner_user_id', 'plan', 'plan_status', 'current_period_end', 'trial_ends_at', 'active',
    'stripe_customer_id', 'stripe_subscription_id', 'stripe_account_id', 'stripe_onboarded', 'stripe_charges_enabled', 'deposit_instructions', 'created_at',
    'vertical', 'timezone', 'app_settings', 'whatsapp', 'specialty', 'avatar_url', 'cover_color']
  function publicSafe(p) {
    const { stripe_customer_id, stripe_subscription_id, stripe_account_id, ...rest } = pickKeys(p, PROVIDER_COLS)
    return { ...rest, has_subscription: !!stripe_subscription_id, stripe_connected: !!stripe_account_id, app_settings: p.app_settings || {} }
  }
  const clampInt = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min }
  const SETTINGS = {
    monthly_goal_cents: (v) => clampInt(v, 0, 100000000),
    tax_reserve_pct: (v) => clampInt(v, 0, 60),
    default_language: (v) => (LANGS.includes(v) ? v : 'pt'),
    message_templates: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? cleanTemplates(v) : {}),
    reactivation_days: (v) => clampInt(v, 14, 365),
    mileage_rate_cents: (v) => clampInt(v, 0, 500),
    week_starts_monday: (v) => !!v,
    calendar_sync: (v) => !!v,
    notify_new_booking: (v) => v !== false,
    notify_cancellation: (v) => v !== false,
    notify_review: (v) => v !== false,
    notify_daily_summary: (v) => !!v,
  }
  function cleanTemplates(obj) {
    const out = {}
    for (const [key, val] of Object.entries(obj).slice(0, 30)) {
      if (!/^[a-z0-9_]{1,40}$/.test(key) || !val || typeof val !== 'object') continue
      const t = {}
      for (const lang of LANGS) if (typeof val[lang] === 'string') t[lang] = val[lang].slice(0, 1000)
      if (Object.keys(t).length) out[key] = t
    }
    return out
  }
  function meRoute({ S, method, body: b }) {
    const P = S.provider
    if (method === 'GET') return ok({ user: { id: S.user.id, email: S.user.email }, provider: publicSafe(P), entitlements: entitlementsFor(P) })
    if (method !== 'POST') return notAllowed()
    if (b.action === 'delete_account') {
      if (b.confirm !== 'EXCLUIR') fail(400, 'Digite EXCLUIR para confirmar.')
      const deleted = { ag_appointments: S.appointments.length, ag_clients: S.clients.length, ag_services: S.services.length, ag_expenses: S.expenses.length, ag_providers: 1 }
      const hadSub = !!P.stripe_subscription_id
      db = null   // demo: volta pros dados de exemplo na próxima entrada
      return ok({ ok: true, subscription_canceled: hadSub, deleted, files_deleted: 0, login_deleted: b.also_login === true, warnings: [] })
    }
    if (b.action === 'settings') {
      const input = b.settings && typeof b.settings === 'object' ? b.settings : {}
      const next = { ...(P.app_settings || {}) }
      for (const [k, fn] of Object.entries(SETTINGS)) if (has(input, k)) next[k] = fn(input[k])
      P.app_settings = next
      return ok({ ok: true, provider: publicSafe(P), entitlements: entitlementsFor(P) })
    }
    if (b.action === 'vertical') {
      if (['services', 'cleaning'].includes(b.vertical)) P.vertical = b.vertical
      if (typeof b.timezone === 'string' && /^(America|Pacific)\/[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(b.timezone)) P.timezone = b.timezone
      return ok({ ok: true, provider: publicSafe(P), entitlements: entitlementsFor(P) })
    }
    fail(400, 'Ação inválida')
  }

  // ── Agendamentos ──────────────────────────────────────────────────────────
  function shapeApt(S, a) {
    if (!a) return null
    const svc = a.service_id ? S.services.find((s) => s.id === a.service_id) : null
    const feed = a.ical_feed_id ? S.feeds.find((f) => f.id === a.ical_feed_id) : null
    const st = a.staff_id ? S.staff.find((s) => s.id === a.staff_id) : null
    return {
      id: a.id, scheduled_for: a.scheduled_for, duration_min: a.duration_min, status: a.status,
      client_id: a.client_id, client_name: a.client_name, client_whatsapp: a.client_whatsapp, client_email: a.client_email, client_notes: a.client_notes,
      service_id: a.service_id, total_cents: a.total_cents, deposit_cents: a.deposit_cents, deposit_paid: a.deposit_paid, payment_method: a.payment_method,
      review_requested: !!a.review_requested, created_at: a.created_at, confirmed_at: a.confirmed_at, completed_at: a.completed_at,
      canceled_at: a.canceled_at, cancel_reason: a.cancel_reason, external_uid: a.external_uid, ical_next_checkin: a.ical_next_checkin,
      service_name: svc?.name || a.service_label || null,
      service_label: a.service_label ?? null,
      feed_label: feed?.label || null, feed_source: feed?.source || null, feed_notes: feed?.notes || null,
      source: a.external_uid ? 'ical' : (a.source || 'online'),
      staff_id: a.staff_id ?? null, staff_name: st?.name || null, staff_color: st?.color || null,
      recurring_id: a.recurring_id ?? null,
      paid_cents: a.paid_cents ?? null, tip_cents: a.tip_cents ?? 0, paid_method: a.paid_method ?? null, paid_at: a.paid_at ?? null,
      internal_notes: a.internal_notes ?? null,
    }
  }
  function shapeAptClient(cl) {
    if (!cl) return null
    return {
      id: cl.id, name: cl.name, whatsapp: cl.whatsapp || null, email: cl.email || null, language: LANGS.includes(cl.language) ? cl.language : 'pt',
      home_notes: cl.home_notes || null, address_line: cl.address_line || null, city: cl.city || null, state: cl.state || null, zip: cl.zip || null, notes: cl.notes || null,
    }
  }
  // ag_payments: derivado dos campos do agendamento (sinal, serviço, gorjeta)
  function paymentsOf(a) {
    const out = []
    const depositPaid = a.deposit_paid ? (a.deposit_cents || 0) : 0
    if (depositPaid > 0) out.push({ id: a.id + '-d', amount_cents: depositPaid, type: 'deposit', status: 'paid', paid_at: a.confirmed_at || a.created_at, method: a.payment_method || null })
    if (a.paid_cents != null) {
      const now = Math.max(0, a.paid_cents - depositPaid)
      if (now > 0) out.push({ id: a.id + '-s', amount_cents: now, type: 'service', status: 'paid', paid_at: a.paid_at, method: a.paid_method })
      if (a.tip_cents > 0) out.push({ id: a.id + '-t', amount_cents: a.tip_cents, type: 'tip', status: 'paid', paid_at: a.paid_at, method: a.paid_method })
    }
    return out
  }
  /** Folga no período? (ag_is_blocked) */
  function isBlockedAt(S, startIso, duration) {
    const day = keyOf(startIso)
    const s = toMin(hhmmOf(startIso))
    const e = s + (Number(duration) || 60)
    return S.blocked.some((b) => (b.date === day && (b.full_day || (s < toMin(b.end_time) && e > toMin(b.start_time))))
      || (e > 1440 && b.date === addDays(day, 1) && (b.full_day || toMin(b.start_time) < e - 1440)))
  }
  /** Conflito: com equipe, só a mesma pessoa; sem, qualquer horário dela (ag_check_conflict). */
  function findConflict(S, { start, duration, staffId, excludeId }) {
    const s = Date.parse(start)
    const e = s + duration * 60e3
    return S.appointments.find((a) => a.id !== excludeId && !['canceled', 'no_show'].includes(a.status)
      && (!staffId || a.staff_id === staffId) && Date.parse(a.scheduled_for) < e && endOf(a) > s) || null
  }
  function conflictReply(hit) {
    throw new HttpError(409, {
      error: hit?.client_name ? `Já tem agendamento nesse horário (${hit.client_name}, ${hhmmOf(hit.scheduled_for)}).` : 'Já tem agendamento nesse horário.',
      code: 'conflict',
      conflict: hit ? { id: hit.id, scheduled_for: hit.scheduled_for, client_name: hit.client_name, duration_min: hit.duration_min } : null,
    })
  }
  function checkStaff(S, staffId) {
    if (staffId === null || staffId === '' || staffId === undefined) return null
    gate(S.provider, 'team')
    const st = S.staff.find((x) => x.id === String(staffId))
    if (!st) fail(404, 'Profissional da equipe não encontrado')
    return st.id
  }
  function newClient(S, fields) {
    const now = new Date().toISOString()
    const row = {
      id: uid(), provider_id: S.provider.id, name: null, whatsapp: null, email: null, language: 'pt', birthday_md: null, tags: [],
      address_line: null, city: null, state: null, zip: null, home_notes: null, notes: null,
      total_visits: 0, total_spent_cents: 0, first_visit_at: null, last_visit_at: null, archived: false, created_at: now, updated_at: now, ...fields,
    }
    S.clients.push(row)
    return row
  }

  function appointmentsRoute(c) {
    const { S, q, method, body: b } = c
    const P = S.provider
    if (method === 'GET') {
      if (q.id) {
        const a = S.appointments.find((x) => x.id === String(q.id))
        if (!a) fail(404, 'Agendamento não encontrado')
        const cl = a.client_id ? S.clients.find((x) => x.id === a.client_id) : null
        return ok({ appointment: shapeApt(S, a), client: shapeAptClient(cl), payments: paymentsOf(a) })
      }
      const staffFilter = q.staff_id || null
      const byStaff = (a) => (staffFilter === 'none' ? !a.staff_id : staffFilter ? a.staff_id === staffFilter : true)
      if (q.scope === 'stats') return stats(c)
      if (q.scope === 'range') {
        const from = parseWall(q.from)
        const to = parseWall(q.to, { endOfDay: true })
        if (!from || !to) fail(400, 'from e to são obrigatórios (AAAA-MM-DD ou ISO)')
        if (to < from) fail(400, 'O fim precisa ser depois do início')
        if (Date.parse(to) - Date.parse(from) > 63 * DAY_MS) fail(400, 'No máximo 62 dias por consulta')
        const list = S.appointments.filter((a) => byStaff(a) && a.scheduled_for >= from && a.scheduled_for <= to).sort(asc).slice(0, 1000)
        return ok({ appointments: list.map((a) => shapeApt(S, a)) })
      }
      const pivot = new Date(Date.parse(c.nowWall) - 12 * 3600e3).toISOString()
      const list = q.scope === 'past'
        ? S.appointments.filter((a) => byStaff(a) && a.scheduled_for < pivot).sort(desc)
        : S.appointments.filter((a) => byStaff(a) && a.scheduled_for >= pivot).sort(asc)
      return ok({ appointments: list.slice(0, 100).map((a) => shapeApt(S, a)) })
    }
    if (method !== 'POST') return notAllowed()

    const action = String(b.action || '')
    const now = new Date().toISOString()

    /** Cliente sem ficha escolhida: acha pelo WhatsApp (ou e-mail) ou cria; só o nome → sem ficha. */
    const resolveClient = (input) => {
      const name = clip(input.client_name, 120)
      if (!name) fail(400, 'Informe o nome da cliente')
      let whatsapp = null, email = null
      if (input.client_whatsapp && String(input.client_whatsapp).trim()) {
        whatsapp = normalizePhone(input.client_whatsapp)
        if (!whatsapp) fail(400, 'WhatsApp inválido. Use código de área + número.')
      }
      const e = input.client_email ? String(input.client_email).trim().toLowerCase().slice(0, 254) : ''
      if (e) {
        if (!EMAIL_RE.test(e)) fail(400, 'E-mail inválido')
        email = e
      }
      const reuse = (found) => { if (found.archived) found.archived = false; if (email && !found.email) found.email = email; return found }
      let client = null
      if (whatsapp) {
        const found = S.clients.find((x) => x.whatsapp === whatsapp)
        client = found ? reuse(found) : newClient(S, { name, whatsapp, email })
      } else if (email) {
        const found = S.clients.find((x) => x.email === email)
        client = found ? reuse(found) : newClient(S, { name, email })
      }
      return { client, name, whatsapp, email }
    }

    if (action === 'create') {
      gate(P, 'agenda')
      const scheduled = parseWall(b.scheduled_for)
      if (!scheduled || !/T/.test(String(b.scheduled_for))) fail(400, 'Escolha o dia e o horário')
      let client = null
      let name = null, whatsapp = null, email = null
      if (b.client_id) {
        client = S.clients.find((x) => x.id === String(b.client_id))
        if (!client) fail(404, 'Cliente não encontrada')
      } else {
        ;({ client, name, whatsapp, email } = resolveClient(b))
      }
      let service = null
      if (b.service_id) {
        service = S.services.find((x) => x.id === String(b.service_id))
        if (!service) fail(404, 'Serviço não encontrado')
      }
      const label = service ? null : clip(b.service_label, 120)
      if (!service && !label) fail(400, 'Escolha um serviço ou escreva o nome do serviço avulso')
      const duration = int(b.duration_min, 5, 720, service?.duration_min || 60)
      const total = int(b.total_cents, 0, 10000000, service?.price_cents || 0)
      const deposit = Math.min(int(b.deposit_cents, 0, 10000000, service?.deposit_cents || 0), total || 10000000)
      const status = b.status === 'pending' ? 'pending' : 'confirmed'
      const staffId = checkStaff(S, b.staff_id)
      if (b.allow_conflict !== true) {
        const hit = findConflict(S, { start: scheduled, duration, staffId })
        if (hit) conflictReply(hit)
      }
      const row = {
        id: uid(), provider_id: P.id, service_id: service?.id || null, service_label: label,
        client_id: client?.id || null, client_name: client?.name || name, client_whatsapp: client?.whatsapp || whatsapp, client_email: client?.email || email,
        client_notes: clip(b.client_notes, 1000), internal_notes: clip(b.internal_notes, 2000),
        scheduled_for: scheduled, duration_min: duration, total_cents: total, deposit_cents: deposit, deposit_paid: false, payment_method: null,
        status, confirmed_at: status === 'confirmed' ? now : null, source: 'manual', staff_id: staffId, recurring_id: null, occurrence_date: null,
        paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null, review_requested: false, external_uid: null, ical_feed_id: null,
        ical_next_checkin: null, created_at: now, completed_at: null, canceled_at: null, cancel_reason: null,
      }
      S.appointments.push(row)
      return ok({ ok: true, appointment: shapeApt(S, row), blocked: isBlockedAt(S, scheduled, duration) }, 201)
    }

    if (!b.id) fail(400, 'id e action são obrigatórios')
    const apt = S.appointments.find((x) => x.id === String(b.id))
    if (!apt) fail(404, 'Agendamento não encontrado')
    const save = (patch, extra = {}) => { Object.assign(apt, patch); return ok({ ok: true, appointment: shapeApt(S, apt), ...extra }) }
    const wrongStatus = () => fail(400, `Esse agendamento está ${STATUS_PT[apt.status] || apt.status}. Use "Desfazer" antes, se precisar.`, { code: 'invalid_status' })

    if (action === 'update') {
      gate(P, 'agenda')
      const patch = {}
      if (has(b, 'client_notes')) patch.client_notes = clip(b.client_notes, 1000)
      if (has(b, 'internal_notes')) patch.internal_notes = clip(b.internal_notes, 2000)
      if (has(b, 'total_cents')) patch.total_cents = int(b.total_cents, 0, 10000000, apt.total_cents || 0)
      if (has(b, 'deposit_cents')) {
        if (apt.deposit_paid) fail(400, 'O sinal já foi recebido; não dá pra mudar o valor.')
        patch.deposit_cents = int(b.deposit_cents, 0, 10000000, apt.deposit_cents || 0)
      }
      if (has(b, 'duration_min')) patch.duration_min = int(b.duration_min, 5, 720, apt.duration_min)
      if (has(b, 'service_id') || has(b, 'service_label')) {
        if (b.service_id) {
          const s = S.services.find((x) => x.id === String(b.service_id))
          if (!s) fail(404, 'Serviço não encontrado')
          patch.service_id = s.id
          patch.service_label = null
        } else if (has(b, 'service_id')) {
          const label = clip(b.service_label, 120) || apt.service_label
          if (!label) fail(400, 'Escreva o nome do serviço avulso')
          patch.service_id = null
          patch.service_label = label
        } else if (!apt.service_id) {
          const label = clip(b.service_label, 120)
          if (!label) fail(400, 'Escreva o nome do serviço avulso')
          patch.service_label = label
        }
      }
      if (has(b, 'staff_id')) patch.staff_id = checkStaff(S, b.staff_id)
      // Ficha escolhida, ou outra pessoa (client_name sem client_id: acha/cria a ficha como no create)
      if (b.client_id) {
        const cl = S.clients.find((x) => x.id === String(b.client_id))
        if (!cl) fail(404, 'Cliente não encontrada')
        Object.assign(patch, { client_id: cl.id, client_name: cl.name, client_whatsapp: cl.whatsapp, client_email: cl.email })
      } else if (has(b, 'client_name')) {
        const r = resolveClient(b)
        Object.assign(patch, { client_id: r.client?.id || null, client_name: r.client?.name || r.name, client_whatsapp: r.client?.whatsapp || r.whatsapp, client_email: r.client?.email || r.email })
      } else {
        if (has(b, 'client_id') && b.client_id === null) patch.client_id = null
        if (has(b, 'client_whatsapp')) {
          const empty = !b.client_whatsapp || !String(b.client_whatsapp).trim()
          const w = empty ? null : normalizePhone(b.client_whatsapp)
          if (!empty && !w) fail(400, 'WhatsApp inválido. Use código de área + número.')
          patch.client_whatsapp = w
        }
        if (has(b, 'client_email')) {
          const e = b.client_email ? String(b.client_email).trim().toLowerCase().slice(0, 254) : null
          if (e && !EMAIL_RE.test(e)) fail(400, 'E-mail inválido')
          patch.client_email = e
        }
      }
      if (!Object.keys(patch).length) fail(400, 'Nada pra atualizar')
      const durationChanged = has(patch, 'duration_min') && patch.duration_min !== apt.duration_min
      const staffChanged = has(patch, 'staff_id') && patch.staff_id !== (apt.staff_id ?? null)
      if ((durationChanged || staffChanged) && ACTIVE.includes(apt.status) && b.allow_conflict !== true) {
        const hit = findConflict(S, { start: apt.scheduled_for, duration: patch.duration_min ?? apt.duration_min, staffId: has(patch, 'staff_id') ? patch.staff_id : apt.staff_id, excludeId: apt.id })
        if (hit) conflictReply(hit)
      }
      return save(patch)
    }

    if (action === 'reschedule') {
      gate(P, 'agenda')
      if (apt.status === 'completed') fail(400, 'Esse atendimento já foi realizado. Use "Repetir" pra marcar outro.', { code: 'invalid_status' })
      const scheduled = parseWall(b.scheduled_for)
      if (!scheduled || !/T/.test(String(b.scheduled_for))) fail(400, 'Escolha o novo dia e horário')
      const duration = int(b.duration_min, 5, 720, apt.duration_min || 60)
      const staffId = has(b, 'staff_id') ? checkStaff(S, b.staff_id) : (apt.staff_id ?? null)
      if (b.allow_conflict !== true) {
        const hit = findConflict(S, { start: scheduled, duration, staffId, excludeId: apt.id })
        if (hit) conflictReply(hit)
      }
      const patch = { scheduled_for: scheduled, duration_min: duration }
      if (has(b, 'staff_id')) patch.staff_id = staffId
      if (!ACTIVE.includes(apt.status)) Object.assign(patch, { status: 'confirmed', confirmed_at: now, canceled_at: null, cancel_reason: null })
      return save(patch, { blocked: isBlockedAt(S, scheduled, duration) })
    }

    if (action === 'confirm') {
      if (apt.status === 'confirmed') return save({})
      if (apt.status !== 'pending') wrongStatus()
      return save({ status: 'confirmed', confirmed_at: now })
    }
    if (action === 'confirm_deposit') {
      if (!ACTIVE.includes(apt.status)) wrongStatus()
      const m = METHODS.includes(b.method) ? b.method : 'zelle'
      return save({ deposit_paid: true, payment_method: m, status: 'confirmed', confirmed_at: apt.confirmed_at || now })
    }
    if (action === 'complete') {
      if (apt.status === 'completed') return save({})
      if (!ACTIVE.includes(apt.status)) wrongStatus()
      return save({ status: 'completed', completed_at: now })
    }
    if (action === 'no_show') {
      if (apt.status === 'no_show') return save({})
      if (!ACTIVE.includes(apt.status)) wrongStatus()
      return save({ status: 'no_show' })
    }
    if (action === 'cancel') {
      if (apt.status === 'canceled') return save({})
      if (!ACTIVE.includes(apt.status)) wrongStatus()
      return save({ status: 'canceled', canceled_at: now, cancel_reason: clip(b.reason, 300) })
    }
    if (action === 'reopen') {
      if (ACTIVE.includes(apt.status)) return save({})
      if (apt.status === 'completed') wrongStatus()
      if (b.allow_conflict !== true) {
        const hit = findConflict(S, { start: apt.scheduled_for, duration: apt.duration_min, staffId: apt.staff_id ?? null, excludeId: apt.id })
        if (hit) conflictReply(hit)
      }
      const waitingDeposit = (apt.deposit_cents || 0) > 0 && !apt.deposit_paid && !apt.confirmed_at
      return save({ status: waitingDeposit ? 'pending' : 'confirmed', canceled_at: null, cancel_reason: null })
    }
    if (action === 'mark_paid') {
      gate(P, 'payments_log')
      if (apt.status === 'canceled') fail(400, 'Agendamento cancelado. Desfaça o cancelamento antes de registrar o pagamento.')
      if (!METHODS.includes(b.method)) fail(400, 'Escolha a forma de pagamento')
      const patch = { paid_cents: int(b.paid_cents, 0, 10000000, apt.total_cents || 0), tip_cents: int(b.tip_cents, 0, 1000000, 0), paid_method: b.method, paid_at: now }
      if (b.complete === true && ACTIVE.includes(apt.status)) Object.assign(patch, { status: 'completed', completed_at: now })
      return save(patch)
    }
    if (action === 'unmark_paid') {
      gate(P, 'payments_log')
      return save({ paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null })
    }
    fail(400, 'Ação inválida')
  }

  function incomeOf(a) {
    if (a.status === 'completed') return Math.max(0, a.paid_cents != null ? Number(a.paid_cents) : (Number(a.total_cents) || 0))
    if (a.status === 'no_show' || a.status === 'canceled') {
      if (a.paid_cents != null) return Math.max(0, Number(a.paid_cents) || 0)
      return a.status === 'no_show' && a.deposit_paid ? Math.max(0, Number(a.deposit_cents) || 0) : 0
    }
    return 0
  }

  // Números da tela Hoje (scope=stats)
  function stats(c) {
    const { S, q } = c
    const P = S.provider
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(q.today || '')) && parseWall(q.today) ? String(q.today) : c.today
    const nowIso = parseWall(q.now) || c.nowWall
    const weekStart = weekStartKey(today, !!P.app_settings?.week_starts_monday)
    const weekEnd = addDays(weekStart, 6)
    const monthStart = today.slice(0, 8) + '01'
    const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1)
    const nowMs = Date.parse(nowIso)
    const out = {
      today, now: nowIso, week_start: weekStart,
      today_count: 0, today_expected_cents: 0, week_count: 0,
      month_count: 0, month_completed_cents: 0, month_expected_cents: 0, month_tips_cents: 0,
    }
    for (const a of S.appointments) {
      const key = keyOf(a.scheduled_for)
      const inWeek = key >= weekStart && key <= weekEnd
      const inMonth = key >= monthStart && key <= monthEnd
      if (!inWeek && !inMonth) continue
      const got = incomeOf(a)
      if (inMonth && got) out.month_completed_cents += got
      if (inMonth && a.status !== 'pending' && a.status !== 'confirmed') out.month_tips_cents += Number(a.tip_cents) || 0
      if (a.status === 'canceled' || a.status === 'no_show') continue
      const cents = Number(a.total_cents) || 0
      if (key === today) { out.today_count++; out.today_expected_cents += cents }
      if (inWeek) out.week_count++
      if (inMonth) {
        out.month_expected_cents += a.status === 'completed' ? got : cents
        if (a.status === 'completed') out.month_count++
      }
    }
    const unmarked = S.appointments
      .filter((a) => a.status === 'confirmed' && a.scheduled_for >= addDays(today, -30) + 'T00:00:00.000Z' && a.scheduled_for < nowIso)
      .sort(desc).slice(0, 40).filter((a) => endOf(a) <= nowMs).map((a) => shapeApt(S, a))
    const pending = S.appointments.filter((a) => a.status === 'pending' && a.scheduled_for >= today + 'T00:00:00.000Z').sort(asc).slice(0, 20).map((a) => shapeApt(S, a))
    out.unmarked_past = unmarked.length
    out.unmarked_list = unmarked.slice(0, 15)
    out.pending_deposits = pending.filter((a) => (a.deposit_cents || 0) > 0 && !a.deposit_paid).length
    out.pending_list = pending
    const nextRow = S.appointments.filter((a) => ACTIVE.includes(a.status) && a.scheduled_for >= new Date(nowMs - 15 * 60e3).toISOString()).sort(asc)[0]
    let next = shapeApt(S, nextRow || null)
    if (next?.client_id) {
      const cl = S.clients.find((x) => x.id === next.client_id)
      next = { ...next, client_language: LANGS.includes(cl?.language) ? cl.language : 'pt', client_address: [cl?.address_line, cl?.city].filter(Boolean).join(', ') || null }
    }
    out.next_appointment = next
    out.setup = {
      services: S.services.filter((s) => s.active).length,
      hours: S.hours.length,
      has_online_booking: S.appointments.some((a) => !a.external_uid && a.source === 'online'),
    }
    return ok(out)
  }

  // ── Clientes ──────────────────────────────────────────────────────────────
  const EMPTY_ACT = { visits: 0, spent_cents: 0, first_visit_at: null, last_visit_at: null, next_at: null, no_shows: 0, cancellations: 0 }
  /** ag_client_activity: visita = realizado, ou confirmado com horário que já passou. */
  function activity(S, nowWall) {
    const now = Date.parse(nowWall)
    const m = new Map()
    for (const a of S.appointments) {
      if (!a.client_id) continue
      let r = m.get(a.client_id)
      if (!r) { r = { ...EMPTY_ACT }; m.set(a.client_id, r) }
      if (a.status === 'completed' || (a.status === 'confirmed' && Date.parse(a.scheduled_for) < now)) {
        r.visits++
        r.spent_cents += a.total_cents || 0
        if (!r.first_visit_at || a.scheduled_for < r.first_visit_at) r.first_visit_at = a.scheduled_for
        if (!r.last_visit_at || a.scheduled_for > r.last_visit_at) r.last_visit_at = a.scheduled_for
      }
      if (ACTIVE.includes(a.status) && Date.parse(a.scheduled_for) >= now && (!r.next_at || a.scheduled_for < r.next_at)) r.next_at = a.scheduled_for
      if (a.status === 'no_show') r.no_shows++
      if (a.status === 'canceled') r.cancellations++
    }
    return m
  }
  function shapeClient(cl, act, nowWall) {
    const visits = act ? act.visits : (cl.total_visits || 0)
    const spent = act ? Number(act.spent_cents) || 0 : (cl.total_spent_cents || 0)
    const last = act ? act.last_visit_at : cl.last_visit_at
    return {
      id: cl.id, name: cl.name, whatsapp: cl.whatsapp || null, email: cl.email || null,
      language: LANGS.includes(cl.language) ? cl.language : 'pt', birthday_md: cl.birthday_md || null, tags: Array.isArray(cl.tags) ? cl.tags : [],
      address_line: cl.address_line || null, city: cl.city || null, state: cl.state || null, zip: cl.zip || null,
      home_notes: cl.home_notes || null, notes: cl.notes || null,
      total_visits: visits, total_spent_cents: spent, avg_ticket_cents: visits ? Math.round(spent / visits) : 0,
      first_visit_at: act ? act.first_visit_at : cl.first_visit_at, last_visit_at: last || null,
      days_since_visit: last ? Math.max(0, Math.floor((Date.parse(nowWall) - Date.parse(last)) / DAY_MS)) : null,
      next_appointment_at: act ? act.next_at : null, no_shows: act ? act.no_shows : 0,
      archived: !!cl.archived, created_at: cl.created_at, updated_at: cl.updated_at || null,
    }
  }
  function serviceName(S, a) {
    const svc = a.service_id ? S.services.find((s) => s.id === a.service_id) : null
    const feed = a.ical_feed_id ? S.feeds.find((f) => f.id === a.ical_feed_id) : null
    return svc?.name || a.service_label || (feed?.label ? `Limpeza · ${feed.label}` : null)
  }
  function computeStats(S, apts, nowWall) {
    const now = Date.parse(nowWall)
    const visits = apts.filter((a) => a.status === 'completed' || (a.status === 'confirmed' && Date.parse(a.scheduled_for) < now))
    const spent = visits.reduce((s, a) => s + (Number(a.total_cents) || 0), 0)
    const tips = visits.reduce((s, a) => s + (Number(a.tip_cents) || 0), 0)
    const upcoming = apts.filter((a) => ACTIVE.includes(a.status) && Date.parse(a.scheduled_for) >= now).sort(asc)
    const days = [...new Set(visits.map((a) => keyOf(a.scheduled_for)))].sort()
    let every = null
    let expected = null
    if (days.length >= 2) {
      const gaps = []
      for (let i = 1; i < days.length; i++) gaps.push(diffDays(days[i - 1], days[i]))
      gaps.sort((x, y) => x - y)
      const mid = Math.floor(gaps.length / 2)
      every = gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2)
      if (every > 0) expected = addDays(days[days.length - 1], every)
      else every = null
    }
    const count = {}
    for (const a of visits) { const n = serviceName(S, a); if (n) count[n] = (count[n] || 0) + 1 }
    const next = upcoming[0] || null
    return {
      visits: visits.length, spent_cents: spent, avg_ticket_cents: visits.length ? Math.round(spent / visits.length) : 0, tips_cents: tips,
      no_shows: apts.filter((a) => a.status === 'no_show').length, cancellations: apts.filter((a) => a.status === 'canceled').length,
      next_appointment: next ? { id: next.id, scheduled_for: next.scheduled_for, status: next.status, service_name: serviceName(S, next) } : null,
      first_visit_at: days.length ? visits.reduce((m, a) => (!m || a.scheduled_for < m ? a.scheduled_for : m), null) : null,
      last_visit_at: days.length ? visits.reduce((m, a) => (!m || a.scheduled_for > m ? a.scheduled_for : m), null) : null,
      return_every_days: every, expected_return: expected,
      favorite_service: Object.entries(count).sort((x, y) => y[1] - x[1])[0]?.[0] || null,
    }
  }
  function shapeClientApt(S, a) {
    return {
      id: a.id, scheduled_for: a.scheduled_for, duration_min: a.duration_min, status: a.status, service_id: a.service_id || null,
      service_name: serviceName(S, a), total_cents: a.total_cents || 0, deposit_cents: a.deposit_cents || 0, deposit_paid: !!a.deposit_paid,
      paid_cents: a.paid_cents ?? null, tip_cents: a.tip_cents ?? null, paid_method: a.paid_method || a.payment_method || null,
      client_notes: a.client_notes || null, internal_notes: a.internal_notes || null, staff_id: a.staff_id || null,
      recurring_id: a.recurring_id || null, source: a.source || (a.external_uid ? 'ical' : null), cancel_reason: a.cancel_reason || null,
    }
  }
  function daysUntilBirthday(md, todayKey) {
    if (!md || !todayKey) return null
    const year = Number(todayKey.slice(0, 4))
    const at = (y) => (md === '02-29' && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? `${y}-03-01` : `${y}-${md}`)
    let next = at(year)
    if (next < todayKey) next = at(year + 1)
    return diffDays(todayKey, next)
  }
  function sortClients(list, sort) {
    const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
    if (sort === 'name') return list.sort(byName)
    if (sort === 'top') return list.sort((a, b) => (b.total_spent_cents - a.total_spent_cents) || (b.total_visits - a.total_visits) || byName(a, b))
    return list.sort((a, b) => {
      if (a.last_visit_at && b.last_visit_at) return Date.parse(b.last_visit_at) - Date.parse(a.last_visit_at)
      if (a.last_visit_at) return -1
      if (b.last_visit_at) return 1
      return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
    })
  }
  const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  function parseBirthday(v) {
    const s = String(v ?? '').trim()
    if (!s) return null
    const m = s.match(/^(\d{1,2})-(\d{1,2})$/)
    if (!m) return false
    const mm = Number(m[1]), dd = Number(m[2])
    if (mm < 1 || mm > 12 || dd < 1 || dd > MONTH_DAYS[mm - 1]) return false
    return `${pad(mm)}-${pad(dd)}`
  }
  function normalizeTags(v) {
    const list = Array.isArray(v) ? v : String(v ?? '').split(',')
    const out = []
    const seen = new Set()
    for (const t of list) {
      const tag = String(t ?? '').replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)
      if (!tag || seen.has(tag.toLowerCase())) continue
      seen.add(tag.toLowerCase())
      out.push(tag)
      if (out.length >= 12) break
    }
    return out
  }
  function readClientFields(b, partial) {
    const out = {}
    const want = (k) => !partial || b[k] !== undefined
    if (want('name')) {
      const name = clip(b.name, 120)
      if (!name) return { error: 'Diga o nome da cliente' }
      out.name = name.replace(/\s+/g, ' ')
    }
    if (want('whatsapp')) {
      const raw = clip(b.whatsapp, 40)
      if (!raw) out.whatsapp = null
      else {
        const n = normalizePhone(raw)
        if (!n) return { error: 'WhatsApp inválido. Use o número com DDD, ex.: (512) 555-0101. Do Brasil: +55 11 98765-4321' }
        out.whatsapp = n
      }
    }
    if (want('email')) {
      const e = clip(b.email, 254)?.toLowerCase() || null
      if (e && !EMAIL_RE.test(e)) return { error: 'E-mail inválido' }
      out.email = e
    }
    if (want('language')) out.language = LANGS.includes(b.language) ? b.language : 'pt'
    if (want('birthday_md')) {
      const bd = parseBirthday(b.birthday_md)
      if (bd === false) return { error: 'Aniversário inválido. Use dia e mês, ex.: 14/10' }
      out.birthday_md = bd
    }
    if (want('tags')) out.tags = normalizeTags(b.tags)
    if (want('address_line')) out.address_line = clip(b.address_line, 200)
    if (want('city')) out.city = clip(b.city, 80)
    if (want('state')) { const st = clip(b.state, 30); out.state = st && st.length <= 3 ? st.toUpperCase() : st }
    if (want('zip')) {
      const z = clip(b.zip, 12)
      if (z && !/^[0-9A-Za-z -]{3,12}$/.test(z)) return { error: 'ZIP code inválido' }
      out.zip = z
    }
    if (want('home_notes')) out.home_notes = clip(b.home_notes, 1000)
    if (want('notes')) out.notes = clip(b.notes, 2000)
    return { fields: out }
  }
  function duplicateReply(dup) {
    throw new HttpError(409, { error: `Já existe uma cliente com esse WhatsApp: ${dup.name}${dup.archived ? ' (arquivada)' : ''}.`, code: 'duplicate', client_id: dup.id })
  }

  function clientsRoute(c) {
    const { S, q, method, body: b, nowWall } = c
    const P = S.provider
    if (method === 'GET') {
      if (q.id) {
        const cl = S.clients.find((x) => x.id === String(q.id))
        if (!cl) fail(404, 'Cliente não encontrada')
        const list = S.appointments.filter((a) => a.client_id === cl.id).sort(desc)
        const st = computeStats(S, list, nowWall)
        const act = { visits: st.visits, spent_cents: st.spent_cents, first_visit_at: st.first_visit_at, last_visit_at: st.last_visit_at, next_at: st.next_appointment?.scheduled_for || null, no_shows: st.no_shows, cancellations: st.cancellations }
        return ok({ client: shapeClient(cl, act, nowWall), appointments: list.slice(0, 50).map((a) => shapeClientApt(S, a)), stats: st })
      }
      const filter = ['all', 'inactive', 'birthday', 'archived'].includes(q.filter) ? q.filter : 'all'
      const sort = ['recent', 'name', 'top'].includes(q.sort) ? q.sort : 'recent'
      const limit = int(q.limit, 1, 500, 500)
      const term = String(q.q ?? '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
      const matches = (cl) => {
        if (!term) return true
        const t = fold(term)
        const digits = term.replace(/\D/g, '')
        return fold(cl.name).includes(t) || fold(cl.email).includes(t) || (digits.length >= 3 && String(cl.whatsapp || '').includes(digits))
      }
      const act = activity(S, nowWall)
      if (filter === 'inactive') {
        gate(P, 'reactivation')
        const days = int(q.days, 14, 365, int(P.app_settings?.reactivation_days, 14, 365, 45))
        const goneBefore = new Date(Date.parse(nowWall) - days * DAY_MS).toISOString()
        const rows = S.clients.filter((cl) => {
          const r = act.get(cl.id)
          return !cl.archived && r && r.last_visit_at && r.last_visit_at < goneBefore && !r.next_at
        })
        const clients = sortClients(rows.filter(matches).map((cl) => shapeClient(cl, act.get(cl.id) || EMPTY_ACT, nowWall)), sort).slice(0, limit)
        return ok({ clients, total: clients.length, truncated: rows.length > limit, days })
      }
      let rows = S.clients.filter((cl) => !!cl.archived === (filter === 'archived') && matches(cl))
      if (filter === 'birthday') rows = rows.filter((cl) => cl.birthday_md)
      rows = rows.slice(0, limit)
      let clients = rows.map((cl) => shapeClient(cl, act.get(cl.id) || EMPTY_ACT, nowWall))
      if (filter === 'birthday') {
        const windowDays = int(q.window, 1, 366, 30)
        clients = clients
          .map((x) => ({ ...x, birthday_in_days: daysUntilBirthday(x.birthday_md, nowWall.slice(0, 10)) }))
          .filter((x) => x.birthday_in_days != null && x.birthday_in_days <= windowDays)
          .sort((x, y) => x.birthday_in_days - y.birthday_in_days || x.name.localeCompare(y.name, 'pt-BR'))
        return ok({ clients, total: clients.length, truncated: rows.length >= limit, window: windowDays })
      }
      clients = sortClients(clients, sort)
      return ok({ clients, total: clients.length, truncated: rows.length >= limit })
    }
    if (method !== 'POST') return notAllowed()
    gate(P, 'clients')
    const now = new Date().toISOString()

    if (b.action === 'create') {
      const read = readClientFields(b, false)
      if (read.error) fail(400, read.error)
      if (read.fields.whatsapp) {
        const dup = S.clients.find((x) => x.whatsapp === read.fields.whatsapp)
        if (dup) duplicateReply(dup)
      }
      const row = newClient(S, read.fields)
      return ok({ ok: true, client: shapeClient(row, null, nowWall) }, 201)
    }
    const cur = S.clients.find((x) => x.id === String(b.id || ''))
    if (!cur) fail(404, 'Cliente não encontrada')
    if (b.action === 'update') {
      const read = readClientFields(b, true)
      if (read.error) fail(400, read.error)
      const f = read.fields
      if (!Object.keys(f).length) fail(400, 'Nada pra salvar')
      if (f.whatsapp && f.whatsapp !== cur.whatsapp) {
        const dup = S.clients.find((x) => x.id !== cur.id && x.whatsapp === f.whatsapp)
        if (dup) duplicateReply(dup)
      }
      // Nome/contato novos valem pros horários marcados
      const apt = {}
      if (f.name !== undefined && f.name !== cur.name) apt.client_name = f.name
      if (f.whatsapp !== undefined && f.whatsapp !== cur.whatsapp) apt.client_whatsapp = f.whatsapp
      if (f.email !== undefined && f.email !== cur.email) apt.client_email = f.email
      Object.assign(cur, f, { updated_at: now })
      if (Object.keys(apt).length) {
        const since = new Date(Date.parse(nowWall) - 12 * 3600e3).toISOString()
        for (const a of S.appointments) if (a.client_id === cur.id && ACTIVE.includes(a.status) && a.scheduled_for >= since) Object.assign(a, apt)
      }
      return ok({ ok: true, client: shapeClient(cur, null, nowWall) })
    }
    if (b.action === 'archive' || b.action === 'unarchive') {
      Object.assign(cur, { archived: b.action === 'archive', updated_at: now })
      return ok({ ok: true, client: shapeClient(cur, null, nowWall) })
    }
    if (b.action === 'delete') {
      const archiveInstead = (message) => {
        Object.assign(cur, { archived: true, updated_at: now })
        return ok({ ok: true, archived: true, message, client: shapeClient(cur, null, nowWall) })
      }
      if (S.appointments.some((a) => a.client_id === cur.id && ACTIVE.includes(a.status) && a.scheduled_for >= nowWall)) {
        return archiveInstead('Ela tem horário marcado, então arquivamos a ficha em vez de excluir. O histórico continua salvo.')
      }
      if (S.recurring.some((r) => r.client_id === cur.id)) {
        return archiveInstead('Essa ficha ainda está ligada a outros registros (como cliente fixa), então arquivamos em vez de excluir.')
      }
      for (const a of S.appointments) if (a.client_id === cur.id) a.client_id = null
      for (const w of S.waitlist) if (w.client_id === cur.id) w.client_id = null
      S.clients.splice(S.clients.indexOf(cur), 1)
      return ok({ ok: true, deleted: true })
    }
    fail(400, 'Ação inválida')
  }

  // ── Lista de espera ───────────────────────────────────────────────────────
  const PERIODS = ['manha', 'tarde', 'noite', 'qualquer']
  const WL_STATUSES = ['waiting', 'notified', 'booked', 'removed']
  const periodOf = (t) => { const h = Number(String(t).slice(0, 2)); return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite' }
  const normalizeDays = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((x, y) => x - y)
  function matchesSlot(e, dateKey, time) {
    const wd = weekdayOf(dateKey)
    const days = Array.isArray(e.preferred_days) ? e.preferred_days : []
    if (days.length && !days.includes(wd)) return false
    if (time && e.preferred_period && e.preferred_period !== 'qualquer' && e.preferred_period !== periodOf(time)) return false
    if (e.date_from && dateKey < String(e.date_from).slice(0, 10)) return false
    if (e.date_to && dateKey > String(e.date_to).slice(0, 10)) return false
    return true
  }
  function shapeEntry(S, e, today) {
    const linked = e.client_id ? S.clients.find((x) => x.id === e.client_id) : null
    const svc = e.service_id ? S.services.find((x) => x.id === e.service_id) : null
    return {
      id: e.id, client_id: e.client_id || null, client_name: linked?.name || e.client_name, client_whatsapp: linked?.whatsapp || e.client_whatsapp || null,
      client_language: linked?.language || 'pt', service_id: e.service_id || null, service_name: svc?.name || null,
      preferred_days: normalizeDays(e.preferred_days), preferred_period: PERIODS.includes(e.preferred_period) ? e.preferred_period : 'qualquer',
      date_from: e.date_from || null, date_to: e.date_to || null, notes: e.notes || null, status: e.status, notified_at: e.notified_at || null,
      created_at: e.created_at, updated_at: e.updated_at || null, expired: !!(e.date_to && String(e.date_to).slice(0, 10) < today),
    }
  }
  function readWaitFields(b, partial) {
    const out = {}
    const want = (k) => !partial || b[k] !== undefined
    if (want('client_name')) out.client_name = clip(b.client_name, 120)?.replace(/\s+/g, ' ') || null
    if (want('client_whatsapp')) {
      const raw = clip(b.client_whatsapp, 40)
      if (!raw) out.client_whatsapp = null
      else {
        const n = normalizePhone(raw)
        if (!n) return { error: 'WhatsApp inválido. Use o número com DDD, ex.: (512) 555-0101' }
        out.client_whatsapp = n
      }
    }
    if (want('preferred_days')) out.preferred_days = normalizeDays(b.preferred_days)
    if (want('preferred_period')) out.preferred_period = PERIODS.includes(b.preferred_period) ? b.preferred_period : 'qualquer'
    for (const k of ['date_from', 'date_to']) {
      if (!want(k)) continue
      const s = clip(b[k], 10)
      if (s && !validDate(s)) return { error: 'Data inválida. Use AAAA-MM-DD' }
      out[k] = s
    }
    if (want('notes')) out.notes = clip(b.notes, 500)
    return { fields: out }
  }
  function waitlistRoute(c) {
    const { S, q, method, body: b, today } = c
    const P = S.provider
    const activeList = () => S.waitlist.filter((e) => e.status === 'waiting' || e.status === 'notified')
    if (method === 'GET') {
      if (q.count) return ok({ count: activeList().length })
      const st = String(q.status || 'waiting')
      let list
      if (st === 'active') list = activeList()
      else if (WL_STATUSES.includes(st)) list = S.waitlist.filter((e) => e.status === st)
      else if (st === 'all') list = S.waitlist.slice()
      else fail(400, 'Status inválido')
      list.sort((x, y) => (st === 'all' ? y.created_at.localeCompare(x.created_at) : x.created_at.localeCompare(y.created_at)))
      return ok({ entries: list.map((e) => shapeEntry(S, e, today)) })
    }
    if (method !== 'POST') return notAllowed()
    if (b.action === 'match') {
      const date = String(b.date || '').slice(0, 10)
      if (!validDate(date)) fail(400, 'Escolha o dia que abriu (AAAA-MM-DD)')
      const time = b.time ? String(b.time).slice(0, 5) : null
      if (time && !HHMM.test(time)) fail(400, 'Horário inválido. Use HH:MM')
      const entries = activeList().sort((x, y) => x.created_at.localeCompare(y.created_at)).filter((e) => matchesSlot(e, date, time)).map((e) => shapeEntry(S, e, today))
      return ok({ entries, date, time, weekday: weekdayOf(date), period: time ? periodOf(time) : null })
    }
    gate(P, 'waitlist')
    const now = new Date().toISOString()
    if (b.action === 'create') {
      const read = readWaitFields(b, false)
      if (read.error) fail(400, read.error)
      const row = { id: uid(), provider_id: P.id, client_id: null, service_id: null, ...read.fields, status: 'waiting', notified_at: null, created_at: now, updated_at: now }
      if (b.client_id) {
        const cl = S.clients.find((x) => x.id === String(b.client_id))
        if (!cl) fail(404, 'Cliente não encontrada')
        row.client_id = cl.id
        row.client_name = row.client_name || cl.name
        row.client_whatsapp = row.client_whatsapp || cl.whatsapp || null
      } else if (row.client_whatsapp) {
        const found = S.clients.find((x) => x.whatsapp === row.client_whatsapp)
        if (found) row.client_id = found.id
      }
      if (!row.client_name) fail(400, 'Diga o nome de quem está esperando')
      if (b.service_id) {
        if (!S.services.some((x) => x.id === String(b.service_id))) fail(404, 'Serviço não encontrado')
        row.service_id = String(b.service_id)
      }
      if (row.date_from && row.date_to && row.date_to < row.date_from) fail(400, 'A data final precisa ser depois da inicial')
      S.waitlist.push(row)
      return ok({ ok: true, entry: shapeEntry(S, row, today) }, 201)
    }
    const cur = S.waitlist.find((e) => e.id === String(b.id || ''))
    if (!cur) fail(404, 'Entrada não encontrada')
    if (b.action === 'update') {
      const read = readWaitFields(b, true)
      if (read.error) fail(400, read.error)
      const patch = { ...read.fields }
      if (patch.client_name === null) fail(400, 'Diga o nome de quem está esperando')
      if (b.client_id !== undefined) {
        if (!b.client_id) patch.client_id = null
        else {
          const cl = S.clients.find((x) => x.id === String(b.client_id))
          if (!cl) fail(404, 'Cliente não encontrada')
          patch.client_id = cl.id
        }
      }
      if (b.service_id !== undefined) {
        if (!b.service_id) patch.service_id = null
        else if (!S.services.some((x) => x.id === String(b.service_id))) fail(404, 'Serviço não encontrado')
        else patch.service_id = String(b.service_id)
      }
      if (b.status !== undefined) {
        if (!WL_STATUSES.includes(b.status)) fail(400, 'Status inválido')
        patch.status = b.status
        if (b.status === 'notified') patch.notified_at = now
      }
      const from = patch.date_from !== undefined ? patch.date_from : cur.date_from
      const to = patch.date_to !== undefined ? patch.date_to : cur.date_to
      if (from && to && String(to) < String(from)) fail(400, 'A data final precisa ser depois da inicial')
      if (!Object.keys(patch).length) fail(400, 'Nada pra salvar')
      Object.assign(cur, patch, { updated_at: now })
      return ok({ ok: true, entry: shapeEntry(S, cur, today) })
    }
    if (b.action === 'delete') {
      S.waitlist.splice(S.waitlist.indexOf(cur), 1)
      return ok({ ok: true })
    }
    fail(400, 'Ação inválida')
  }

  // ── Serviços ──────────────────────────────────────────────────────────────
  const SVC_COLS = ['id', 'provider_id', 'name', 'category', 'description', 'duration_min', 'price_cents', 'deposit_cents', 'active', 'display_order', 'created_at']
  const svcOut = (s) => pickKeys(s, SVC_COLS)
  const mineServices = (S) => S.services.slice().sort((x, y) => (x.display_order - y.display_order) || String(x.created_at).localeCompare(String(y.created_at)))
  function readService(b, existing) {
    const name = clip(b.name, 120)
    if (!name) return { error: 'Dê um nome pro serviço' }
    if (b.price_cents == null || b.price_cents === '') return { error: 'Informe o preço' }
    const price = int(b.price_cents, 0, 1000000, 0)
    const out = {
      name, category: clip(b.category, 60), description: clip(b.description, 600),
      duration_min: int(b.duration_min, 5, 600, existing?.duration_min ?? 60), price_cents: price,
      deposit_cents: Math.min(int(b.deposit_cents, 0, 1000000, 0), price),
    }
    if (typeof b.active === 'boolean') out.active = b.active
    else if (!existing) out.active = true
    if (b.display_order != null && b.display_order !== '') out.display_order = int(b.display_order, 0, 999, 0)
    return { fields: out }
  }
  const depositAllowed = (P) => hasFeature(P, 'deposit_offline') || hasFeature(P, 'deposit_stripe')
  function servicesRoute(c) {
    const { S, q, method, body: b } = c
    const P = S.provider
    if (method === 'GET') {
      if (q.mine) return ok({ services: mineServices(S).map(svcOut) })
      return ok({ services: mineServices(S).filter((s) => s.active).map(svcOut) })
    }
    if (method === 'DELETE') {
      gate(P, 'services')
      const s = S.services.find((x) => x.id === String(q.id || ''))
      if (!q.id) fail(400, 'id obrigatório')
      if (!s) return ok({ ok: true })
      if (S.appointments.some((a) => a.service_id === s.id)) { s.active = false; return ok({ ok: true, paused: true }) }
      S.services.splice(S.services.indexOf(s), 1)
      return ok({ ok: true })
    }
    if (method !== 'POST' && method !== 'PUT') return notAllowed()
    gate(P, 'services')
    const action = b.action || null
    if (action === 'reorder') {
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : null
      if (!ids || !ids.length) fail(400, 'Lista de serviços vazia')
      const order = [...new Set(ids.filter((id) => S.services.some((s) => s.id === id)))]
      for (const s of mineServices(S)) if (!order.includes(s.id)) order.push(s.id)
      order.forEach((id, i) => { S.services.find((s) => s.id === id).display_order = i })
      return ok({ ok: true, services: mineServices(S).map(svcOut) })
    }
    if (action === 'set_active') {
      if (typeof b.active !== 'boolean') fail(400, 'active deve ser true ou false')
      const s = S.services.find((x) => x.id === String(b.id || ''))
      if (!s) fail(404, 'Serviço não encontrado')
      s.active = b.active
      return ok({ service: svcOut(s) })
    }
    if (action === 'create_many') {
      const input = Array.isArray(b.services) ? b.services.slice(0, 10) : []
      if (!input.length) fail(400, 'Nenhum serviço pra criar')
      if (S.services.length + input.length > 60) fail(400, 'Limite de 60 serviços atingido')
      const start = S.services.length
      const rows = input.map((x, i) => {
        const r = readService(x || {}, null)
        if (r.error) fail(400, r.error)
        if (r.fields.deposit_cents > 0 && !depositAllowed(P)) r.fields.deposit_cents = 0
        return { id: uid(), provider_id: P.id, ...r.fields, display_order: start + i, created_at: new Date().toISOString() }
      })
      S.services.push(...rows)
      return ok({ ok: true, services: rows.map(svcOut) })
    }
    if (action) fail(400, 'Ação inválida')
    let existing = null
    if (b.id) {
      existing = S.services.find((x) => x.id === String(b.id))
      if (!existing) fail(404, 'Serviço não encontrado')
    }
    const read = readService(b, existing)
    if (read.error) fail(400, read.error)
    if (read.fields.deposit_cents > 0 && !depositAllowed(P)) gate(P, 'deposit_offline')
    if (existing) {
      Object.assign(existing, read.fields)
      return ok({ service: svcOut(existing) })
    }
    if (S.services.length >= 60) fail(400, 'Limite de 60 serviços atingido')
    const row = { id: uid(), provider_id: P.id, display_order: S.services.length, ...read.fields, created_at: new Date().toISOString() }
    S.services.push(row)
    return ok({ service: svcOut(row) })
  }

  // ── Horário de atendimento ────────────────────────────────────────────────
  const ON_DAY = ['No domingo', 'Na segunda', 'Na terça', 'Na quarta', 'Na quinta', 'Na sexta', 'No sábado']
  function hoursRoute(c) {
    const { S, method, body: b } = c
    if (method === 'POST') {
      gate(S.provider, 'hours')
      const input = Array.isArray(b.hours) ? b.hours : null
      if (!input) fail(400, 'hours deve ser uma lista')
      if (input.length > 21) fail(400, 'No máximo 3 janelas por dia')
      const rows = []
      const perDay = {}
      for (const h of input) {
        const day = Number(h?.day_of_week)
        const start = String(h?.start_time || '').slice(0, 5)
        const end = String(h?.end_time || '').slice(0, 5)
        if (!Number.isInteger(day) || day < 0 || day > 6) fail(400, 'Dia da semana inválido')
        if (!HHMM.test(start) || !HHMM.test(end)) fail(400, 'Horário inválido. Use HH:MM')
        if (start >= end) fail(400, `${ON_DAY[day]}, o início precisa ser antes do fim`)
        perDay[day] = perDay[day] || []
        perDay[day].push([start, end])
        if (perDay[day].length > 3) fail(400, 'No máximo 3 janelas por dia')
        rows.push({ id: uid(), day_of_week: day, start_time: start, end_time: end, active: true })
      }
      for (const [day, list] of Object.entries(perDay)) {
        const sorted = list.slice().sort((x, y) => (x[0] < y[0] ? -1 : 1))
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i][0] < sorted[i - 1][1]) fail(400, `${ON_DAY[day]}, os horários se sobrepõem (${sorted[i - 1][0]}–${sorted[i - 1][1]} e ${sorted[i][0]}–${sorted[i][1]})`)
        }
      }
      S.hours = rows
    } else if (method !== 'GET') return notAllowed()
    const hours = S.hours.slice().sort((x, y) => x.day_of_week - y.day_of_week || x.start_time.localeCompare(y.start_time))
      .map((h) => ({ day_of_week: h.day_of_week, start_time: h.start_time, end_time: h.end_time }))
    return ok({ hours })
  }

  // ── Folgas ────────────────────────────────────────────────────────────────
  const publicBlock = (x) => ({ id: x.id, date: x.date, full_day: x.full_day !== false, start_time: x.start_time || null, end_time: x.end_time || null, reason: x.reason || null })
  function blockConflicts(S, blocks) {
    const out = { byBlock: {}, dates: [], count: 0 }
    const hit = new Set()
    const dates = new Set()
    for (const x of blocks) {
      let n = 0
      for (const a of S.appointments) {
        if (!ACTIVE.includes(a.status) || keyOf(a.scheduled_for) !== x.date) continue
        const s = toMin(hhmmOf(a.scheduled_for))
        const e = s + (Number(a.duration_min) || 60)
        if (x.full_day !== false || (s < toMin(x.end_time) && e > toMin(x.start_time))) { n++; hit.add(a.id); dates.add(x.date) }
      }
      out.byBlock[x.id] = n
    }
    out.count = hit.size
    out.dates = [...dates].sort()
    return out
  }
  function listBlocks(S, today) {
    const blocks = S.blocked.filter((x) => x.date >= addDays(today, -30))
      .sort((x, y) => x.date.localeCompare(y.date) || String(x.start_time || '').localeCompare(String(y.start_time || '')))
      .map(publicBlock)
    const cf = blockConflicts(S, blocks.filter((x) => x.date >= today))
    return blocks.map((x) => ({ ...x, appointments_count: cf.byBlock[x.id] || 0 }))
  }
  function blockedRoute(c) {
    const { S, method, body: b, today } = c
    if (method === 'GET') return ok({ blocks: listBlocks(S, today) })
    if (method !== 'POST') return notAllowed()
    if (b.action === 'create') {
      gate(S.provider, 'hours')
      const date = String(b.date || '').slice(0, 10)
      const dateTo = b.date_to ? String(b.date_to).slice(0, 10) : date
      if (!validDate(date)) fail(400, 'Data inválida. Use AAAA-MM-DD')
      if (!validDate(dateTo)) fail(400, 'Data final inválida. Use AAAA-MM-DD')
      if (dateTo < date) fail(400, 'A data final precisa ser depois da inicial')
      const span = diffDays(date, dateTo) + 1
      if (span > 60) fail(400, 'No máximo 60 dias de uma vez. Divida em duas partes.')
      if (dateTo < addDays(today, -1)) fail(400, 'Essa data já passou')
      if (date > addDays(today, 730)) fail(400, 'Data muito distante (até 2 anos)')
      const fullDay = b.full_day !== false
      let start = null
      let end = null
      if (!fullDay) {
        start = String(b.start_time || '').slice(0, 5)
        end = String(b.end_time || '').slice(0, 5)
        if (!HHMM.test(start) || !HHMM.test(end)) fail(400, 'Horário inválido. Use HH:MM')
        if (start >= end) fail(400, 'O início precisa ser antes do fim')
      }
      const reason = b.reason == null ? null : (String(b.reason).trim().slice(0, 120) || null)
      const days = []
      for (let i = 0; i < span; i++) { const k = addDays(date, i); if (k >= addDays(today, -1)) days.push(k) }
      let created = 0, updated = 0, skipped = 0
      for (const k of days) {
        const list = S.blocked.filter((x) => x.date === k)
        const full = list.find((x) => x.full_day !== false)
        if (fullDay) {
          if (full) {
            if (reason && reason !== full.reason) { full.reason = reason; updated++ } else skipped++
            S.blocked = S.blocked.filter((x) => x.date !== k || x.id === full.id)
            continue
          }
          S.blocked = S.blocked.filter((x) => x.date !== k)
          S.blocked.push({ id: uid(), date: k, full_day: true, start_time: null, end_time: null, reason, created_at: new Date().toISOString() })
          created++
        } else {
          if (full) { skipped++; continue }
          const same = list.find((x) => x.start_time === start)
          if (same) { Object.assign(same, { end_time: end, reason }); updated++ }
          else { S.blocked.push({ id: uid(), date: k, full_day: false, start_time: start, end_time: end, reason, created_at: new Date().toISOString() }); created++ }
        }
      }
      const probe = days.filter((k) => k >= today).map((k, i) => ({ id: 'd' + i, date: k, full_day: fullDay, start_time: start, end_time: end }))
      const cf = blockConflicts(S, probe)
      return ok({ ok: true, created, updated, skipped, conflicts: { count: cf.count, dates: cf.dates, first_date: cf.dates[0] || null }, blocks: listBlocks(S, today) }, 201)
    }
    if (b.action === 'delete') {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map((v) => String(v || '')).filter(Boolean)
      if (!ids.length) fail(400, 'id inválido')
      const before = S.blocked.length
      S.blocked = S.blocked.filter((x) => !ids.includes(x.id))
      if (S.blocked.length === before) fail(404, 'Bloqueio não encontrado')
      return ok({ ok: true, deleted: before - S.blocked.length })
    }
    fail(400, 'Ação inválida')
  }

  // ── Turnover (iCal) ───────────────────────────────────────────────────────
  function maskUrl(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(String(url || ''))
    if (!m) return ''
    const tail = m[2].split('/').filter(Boolean).pop() || ''
    return m[1] + '/…/' + (tail.length > 14 ? '…' + tail.slice(-12) : tail)
  }
  function detectSource(url) {
    const host = (/^https?:\/\/([^/?#:]+)/i.exec(String(url || '')) || [])[1] || ''
    if (/(^|\.)airbnb\./i.test(host)) return 'airbnb'
    if (/(^|\.)(vrbo|homeaway|abritel|fewo-direkt|stayz|bookabach)\./i.test(host)) return 'vrbo'
    if (/(^|\.)booking\.com$/i.test(host)) return 'booking'
    return 'outro'
  }
  function normalizeIcsUrl(raw) {
    let s = String(raw || '').trim()
    if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://')
    const m = /^([a-z]+):\/\/([^/?#@:]+)(:\d+)?([/?#].*)?$/i.exec(s)
    if (!m) return { ok: false, error: 'Link inválido. Copie o link completo do calendário.' }
    if (m[1].toLowerCase() !== 'https') return { ok: false, error: 'O link do calendário precisa começar com https://' }
    if (!m[2].includes('.') || /^[\d.]+$/.test(m[2])) return { ok: false, error: 'Esse endereço não é aceito. Use o link exportado pelo Airbnb, Vrbo ou Booking.' }
    return { ok: true, url: s.replace(/#.*$/, '') }
  }
  const FEED_COLS = ['id', 'label', 'source', 'checkout_time', 'duration_min', 'price_cents', 'notes', 'active', 'last_synced_at', 'last_status', 'last_error', 'reservations_count', 'created_at']
  const feedOut = (f) => ({ ...pickKeys(f, FEED_COLS), checkout_time: String(f.checkout_time || '11:00').slice(0, 5), url_hint: maskUrl(f.url) })
  function readFeed(b, partial) {
    const out = {}
    if (!partial || b.label !== undefined) {
      const label = clip(b.label, 80)
      if (!label) return { error: 'Dê um nome pra casa (ex.: Casa do lago, Kissimmee)' }
      out.label = label
    }
    if (!partial || b.checkout_time !== undefined) {
      const t = String(b.checkout_time || '11:00').slice(0, 5)
      if (!HHMM.test(t)) return { error: 'Horário do checkout inválido. Use HH:MM' }
      out.checkout_time = t
    }
    if (!partial || b.duration_min !== undefined) out.duration_min = int(b.duration_min, 15, 720, 180)
    if (!partial || b.price_cents !== undefined) out.price_cents = int(b.price_cents, 0, 1000000, 0)
    if (!partial || b.notes !== undefined) out.notes = clip(b.notes, 500)
    return { fields: out }
  }
  /** "Sincroniza": a casa nova ganha 2 reservas de exemplo; as limpezas por vir seguem horário/valor da casa. */
  function syncFeed(S, feed, today, { fresh = false } = {}) {
    let created = 0, updated = 0
    if (fresh) {
      for (const n of [3, 8]) {
        const d = addDays(today, n)
        S.appointments.push({
          id: uid(), provider_id: S.provider.id, scheduled_for: toWall(d, feed.checkout_time), duration_min: feed.duration_min, status: 'confirmed',
          client_id: null, client_name: feed.label, client_whatsapp: null, client_email: null, client_notes: null, service_id: null, service_label: null,
          total_cents: feed.price_cents, deposit_cents: 0, deposit_paid: false, payment_method: null, paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null,
          internal_notes: null, source: 'ical', staff_id: null, recurring_id: null, occurrence_date: null, review_requested: false,
          external_uid: `demo-${d}-${feed.id.slice(-4)}@${feed.source}.com`, ical_feed_id: feed.id, ical_next_checkin: null,
          created_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), completed_at: null, canceled_at: null, cancel_reason: null,
        })
        created++
      }
    } else {
      for (const a of S.appointments) {
        if (a.ical_feed_id !== feed.id || !ACTIVE.includes(a.status) || keyOf(a.scheduled_for) <= today) continue
        a.scheduled_for = toWall(keyOf(a.scheduled_for), feed.checkout_time)
        a.duration_min = feed.duration_min
        a.total_cents = feed.price_cents
        a.client_name = feed.label
        updated++
      }
    }
    const reservations = S.appointments.filter((a) => a.ical_feed_id === feed.id && ACTIVE.includes(a.status) && keyOf(a.scheduled_for) >= today).length
    Object.assign(feed, { last_synced_at: new Date().toISOString(), last_status: 'ok', last_error: null, reservations_count: reservations || feed.reservations_count })
    return { ok: true, created, updated, canceled: 0, reservations: reservations || feed.reservations_count }
  }
  function icalRoute(c) {
    const { S, method, body: b, today } = c
    const P = S.provider
    if (method === 'GET') return ok({ feeds: S.feeds.slice().sort((x, y) => String(x.created_at).localeCompare(String(y.created_at))).map(feedOut), max_feeds: limitFor(P, 'ical_feeds') })
    if (method !== 'POST') return notAllowed()
    if (b.action === 'create') {
      gate(P, 'turnover_ical')
      const read = readFeed(b, false)
      if (read.error) fail(400, read.error)
      const n = normalizeIcsUrl(b.url)
      if (!n.ok) fail(400, n.error)
      limitGate(P, 'ical_feeds', S.feeds.length)
      if (S.feeds.some((f) => f.url === n.url)) fail(409, 'Esse calendário já está cadastrado')
      const feed = { id: uid(), provider_id: P.id, url: n.url, source: detectSource(n.url), ...read.fields, active: true, last_synced_at: null, last_status: null, last_error: null, reservations_count: 0, created_at: new Date().toISOString() }
      S.feeds.push(feed)
      const sync = syncFeed(S, feed, today, { fresh: true })
      return ok({ ok: true, feed: feedOut(feed), sync }, 201)
    }
    const feed = S.feeds.find((f) => f.id === String(b.id || ''))
    if (!feed) fail(404, 'Casa não encontrada')
    if (b.action === 'update') {
      const read = readFeed(b, true)
      if (read.error) fail(400, read.error)
      if (b.url && String(b.url).trim()) {
        const n = normalizeIcsUrl(b.url)
        if (!n.ok) fail(400, n.error)
        if (n.url !== feed.url) {
          if (S.feeds.some((f) => f.id !== feed.id && f.url === n.url)) fail(409, 'Esse calendário já está cadastrado em outra casa')
          read.fields.url = n.url
          read.fields.source = detectSource(n.url)
        }
      }
      Object.assign(feed, read.fields)
      const sync = hasFeature(P, 'turnover_ical') && feed.active ? syncFeed(S, feed, today) : null
      return ok({ ok: true, feed: feedOut(feed), sync })
    }
    if (b.action === 'sync') {
      gate(P, 'turnover_ical')
      if (feed.last_synced_at && Date.now() - Date.parse(feed.last_synced_at) < 60e3) fail(429, 'Essa casa acabou de sincronizar. Espere um minuto.')
      return ok({ ok: true, feed: feedOut(feed), sync: syncFeed(S, feed, today) })
    }
    if (b.action === 'delete') {
      const now = new Date().toISOString()
      for (const a of S.appointments) {
        if (a.ical_feed_id === feed.id && ACTIVE.includes(a.status) && a.scheduled_for > c.nowWall) Object.assign(a, { status: 'canceled', canceled_at: now, cancel_reason: 'Casa removida da sincronização' })
        if (a.ical_feed_id === feed.id) a.ical_feed_id = null
      }
      S.feeds.splice(S.feeds.indexOf(feed), 1)
      return ok({ ok: true })
    }
    fail(400, 'Ação inválida')
  }

  // ── Stripe Connect (sinal com cartão) ─────────────────────────────────────
  function connectRoute(c) {
    const { S, method, body: b, site } = c
    const P = S.provider
    if (method === 'GET') {
      const on = !!P.stripe_account_id
      return ok({ connected: on, onboarded: on && !!P.stripe_onboarded, charges_enabled: on && !!P.stripe_charges_enabled, payouts_enabled: on, requirements_due: [], stripe_available: true })
    }
    if (method !== 'POST') return notAllowed()
    gate(P, 'deposit_stripe')
    if (b.action === 'dashboard') {
      if (!P.stripe_account_id) fail(400, 'Conecte sua conta Stripe primeiro.')
      return ok({ url: `${site}/agenda/planos?app=1` })
    }
    if (b.action) fail(400, 'Ação inválida')
    P.stripe_account_id = P.stripe_account_id || 'acct_demo'
    P.stripe_onboarded = true
    P.stripe_charges_enabled = true
    const url = `${site}/agenda/planos?app=1&stripe=done`
    return ok({ onboarding_url: url, url, expires_at: Math.floor(Date.now() / 1000) + 300 })
  }

  // ── Perfil ────────────────────────────────────────────────────────────────
  const FULL_COLS = ['id', 'name', 'email', 'slug', 'specialty', 'bio', 'city', 'state', 'avatar_url', 'cover_color', 'cover_url', 'gallery_urls', 'video_url',
    'instagram', 'whatsapp', 'plan', 'plan_status', 'current_period_end', 'trial_ends_at', 'active', 'stripe_onboarded', 'stripe_charges_enabled', 'deposit_instructions']
  const RESERVED = new Set(['review', 'reviews', 'planos', 'profile', 'index', 'equipe', 'admin', 'api', 'assinante', 'agenda', 'agendapro', 'login', 'entrar',
    'cadastro', 'novo', 'new', 'app', 'para', 'suporte', 'ajuda', 'termos', 'privacidade', 'brasilconnect', 'checkout', 'pagamento'])
  const slugify = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '')
  function normUrl(v) {
    let s = clip(v, 500)
    if (!s) return null
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = 'https://' + s
    return /^https?:\/\/[^\s]+$/i.test(s) ? s : false
  }
  function providerRoute(c) {
    const { S, q, method, body: b } = c
    const P = S.provider
    if (method === 'GET') {
      if (q.slug && !q.mine) {
        return ok({
          provider: { ...pickKeys(P, ['id', 'name', 'slug', 'specialty', 'bio', 'city', 'state', 'avatar_url', 'cover_color', 'cover_url', 'video_url', 'instagram', 'whatsapp', 'deposit_instructions']),
            gallery_urls: hasFeature(P, 'gallery') ? P.gallery_urls : [], booking_enabled: hasFeature(P, 'online_booking'),
            accepts_card: hasFeature(P, 'deposit_stripe') && !!P.stripe_charges_enabled, show_branding: !hasFeature(P, 'no_branding') },
          services: mineServices(S).filter((s) => s.active).map(svcOut),
          reviews: { enabled: hasFeature(P, 'reviews'), count: S.reviews.length, average: avg(S.reviews), items: [] },
        })
      }
      return ok({ provider: pickKeys(P, FULL_COLS) })
    }
    if (method !== 'POST') return notAllowed()
    const out = {}
    if (has(b, 'name')) { const n = clip(b.name, 120); if (!n) fail(400, 'Nome é obrigatório'); out.name = n }
    if (has(b, 'specialty')) out.specialty = clip(b.specialty, 120)
    if (has(b, 'bio')) out.bio = clip(b.bio, 2000)
    if (has(b, 'city')) out.city = clip(b.city, 80)
    if (has(b, 'state')) {
      const st = String(b.state || '').trim().toUpperCase()
      if (st && !/^[A-Z]{2}$/.test(st)) fail(400, 'Estado: use a sigla de 2 letras (ex.: MA, FL, TX)')
      out.state = st || null
    }
    if (has(b, 'whatsapp')) {
      const w = clip(b.whatsapp, 30)
      if (w && w.replace(/\D/g, '').length < 10) fail(400, 'WhatsApp incompleto. Coloque o número com o código de área.')
      out.whatsapp = w
    }
    if (has(b, 'instagram')) {
      let s = String(b.instagram == null ? '' : b.instagram).trim()
      const m = s.match(/instagram\.com\/([^/?#\s]+)/i)
      if (m) s = m[1]
      s = s.replace(/^@+/, '').replace(/\/+$/, '')
      if (s && !/^[A-Za-z0-9._]{1,30}$/.test(s)) fail(400, 'Instagram inválido. Use só o @ do perfil (ex.: @anahair)')
      out.instagram = s || null
    }
    if (has(b, 'deposit_instructions')) out.deposit_instructions = clip(b.deposit_instructions, 300)
    const URL_ERR = { avatar_url: 'Foto de perfil inválida', cover_url: 'Foto de capa inválida', video_url: 'Link do vídeo inválido. Cole o endereço que começa com https://' }
    for (const k of Object.keys(URL_ERR)) {
      if (!has(b, k)) continue
      const u = normUrl(b[k])
      if (u === false) fail(400, URL_ERR[k])
      out[k] = u
    }
    if (has(b, 'cover_color')) {
      const col = String(b.cover_color || '').trim()
      if (col && !/^#[0-9a-f]{6}$/i.test(col)) fail(400, 'Cor da capa inválida')
      if (col) out.cover_color = col
    }
    if (has(b, 'gallery_urls')) {
      if (b.gallery_urls != null && !Array.isArray(b.gallery_urls)) fail(400, 'A galeria deve ser uma lista de fotos')
      const list = []
      for (const raw of (b.gallery_urls || []).slice(0, 50)) { const u = normUrl(raw); if (u && !list.includes(u)) list.push(u) }
      if (list.length > 10) fail(400, 'No máximo 10 fotos na galeria')
      const current = new Set(P.gallery_urls || [])
      if (list.some((u) => !current.has(u))) gate(P, 'gallery')
      out.gallery_urls = list
    }
    if (has(b, 'slug')) {
      const s = slugify(b.slug)
      if (s.length < 3) fail(400, 'O link precisa ter pelo menos 3 letras ou números')
      if (RESERVED.has(s)) fail(400, 'Esse link é reservado. Escolha outro.')
      out.slug = s
    }
    Object.assign(P, out)
    return ok({ ok: true, provider: pickKeys(P, FULL_COLS) })
  }

  // ── Avaliações ────────────────────────────────────────────────────────────
  const avg = (list) => (list.length ? Math.round((list.reduce((s, r) => s + (Number(r.rating) || 0), 0) / list.length) * 10) / 10 : null)
  function reviewOut(S, r) {
    const a = r.appointment_id ? S.appointments.find((x) => x.id === r.appointment_id) : null
    const svc = a?.service_id ? S.services.find((s) => s.id === a.service_id) : null
    return {
      ...pickKeys(r, ['id', 'appointment_id', 'client_name', 'rating', 'comment', 'provider_response', 'responded_at', 'is_published', 'created_at']),
      client_id: a?.client_id || null, service_name: svc?.name || null, appointment_at: a?.scheduled_for || null,
    }
  }
  function reviewsRoute(c) {
    const { S, q, method, body: b } = c
    if (method === 'GET') {
      const filter = ['all', 'unanswered', 'hidden'].includes(q.filter) ? q.filter : 'all'
      const all = S.reviews.slice().sort((x, y) => y.created_at.localeCompare(x.created_at))
      const list = filter === 'unanswered' ? all.filter((r) => !r.provider_response) : filter === 'hidden' ? all.filter((r) => r.is_published === false) : all
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      for (const r of all) { const n = Math.round(Number(r.rating)); if (n >= 1 && n <= 5) distribution[n]++ }
      const published = all.filter((r) => r.is_published !== false)
      return ok({
        filter,
        stats: { count: all.length, published: published.length, hidden: all.length - published.length, unanswered: all.filter((r) => !r.provider_response).length, average: avg(all), public_average: avg(published), distribution },
        reviews: list.map((r) => reviewOut(S, r)),
      })
    }
    if (method !== 'POST') return notAllowed()
    gate(S.provider, 'reviews')
    const action = String(b.action || '')
    if (!['respond', 'hide', 'publish'].includes(action)) fail(400, 'Ação inválida')
    const r = S.reviews.find((x) => x.id === String(b.id || ''))
    if (!r) fail(404, 'Avaliação não encontrada')
    if (action === 'respond') {
      if (b.response != null && typeof b.response !== 'string') fail(400, 'Resposta inválida')
      const text = String(b.response || '').trim()
      if (text.length > 1000) fail(400, 'A resposta pode ter até 1000 caracteres')
      Object.assign(r, text ? { provider_response: text, responded_at: new Date().toISOString() } : { provider_response: null, responded_at: null })
    } else r.is_published = action === 'publish'
    return ok({ ok: true, review: reviewOut(S, r) })
  }

  const REVIEW_MSG = {
    pt: 'Oi {nome}, obrigada pela visita! Se puder, deixa sua avaliação aqui, me ajuda muito: {link}',
    en: 'Hi {nome}, thank you for coming! If you can, please leave a quick review here, it really helps: {link}',
    es: 'Hola {nome}, ¡gracias por tu visita! Si puedes, deja tu reseña aquí, me ayuda mucho: {link}',
  }
  function requestReviewRoute(c) {
    const { S, method, body: b, site } = c
    const P = S.provider
    if (method !== 'POST') return notAllowed()
    gate(P, 'reviews')
    const apt = S.appointments.find((x) => x.id === String(b.appointment_id || ''))
    if (!b.appointment_id) fail(400, 'appointment_id obrigatório')
    if (!apt) fail(404, 'Agendamento não encontrado')
    if (apt.status !== 'completed') fail(400, 'Só dá pra pedir avaliação de atendimento já realizado. Marque como realizado primeiro.')
    if (S.reviews.some((r) => r.appointment_id === apt.id)) fail(409, 'Essa cliente já avaliou esse atendimento.', { code: 'already_reviewed' })
    apt.review_requested = true
    if (!apt._review_token) apt._review_token = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)
    let lang = 'pt'
    const cl = apt.client_id ? S.clients.find((x) => x.id === apt.client_id) : null
    if (cl && hasFeature(P, 'multilang_messages') && ['en', 'es'].includes(cl.language)) lang = cl.language
    const reviewUrl = `${site}/agenda/review/${apt._review_token}`
    const custom = P.app_settings?.message_templates?.review?.[lang]
    const first = String(apt.client_name || '').trim().split(/\s+/)[0] || ''
    const vars = { nome: first, link: reviewUrl, profissional: P.name }
    const message = String(typeof custom === 'string' && custom ? custom : REVIEW_MSG[lang])
      .replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : '')).replace(/\s+([.,!?])/g, '$1').replace(/ {2,}/g, ' ').trim()
    const finalMessage = message.includes(reviewUrl) ? message : `${message} ${reviewUrl}`
    let d = String(apt.client_whatsapp || '').replace(/\D/g, '')
    if (d.length === 10) d = '1' + d
    return ok({
      token: apt._review_token, review_url: reviewUrl,
      whatsapp_url: d.length >= 11 ? `https://wa.me/${d}?text=${encodeURIComponent(finalMessage)}` : null,
      message: finalMessage, language: lang, expires_at: new Date(Date.now() + 14 * DAY_MS).toISOString(), requested_at: new Date().toISOString(),
    })
  }

  // ── Equipe ────────────────────────────────────────────────────────────────
  function staffOut(P, s) {
    const canLink = hasFeature(P, 'team_day_link')
    return {
      id: s.id, name: s.name, color: s.color, whatsapp: s.whatsapp, email: s.email, role: s.role, members: Array.isArray(s.members) ? s.members : [],
      active: s.active, display_order: s.display_order, day_link_url: canLink && s.day_link_token ? `${site}/agenda/equipe?t=${s.day_link_token}` : null, created_at: s.created_at,
    }
  }
  function readStaff(b, partial) {
    const out = {}
    if (!partial || b.name !== undefined) {
      const name = clip(b.name, 60)
      if (!name) return { error: 'Escreva o nome (ex.: Ana ou Equipe da Maria)' }
      out.name = name
    }
    if (!partial || b.color !== undefined) {
      const color = String(b.color || '#1F4D3F').trim()
      if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return { error: 'Cor inválida' }
      out.color = color.toUpperCase()
    }
    if (!partial || b.whatsapp !== undefined) {
      const d = String(b.whatsapp || '').replace(/\D/g, '').slice(0, 15)
      if (d && d.length < 10) return { error: 'WhatsApp incompleto. Coloque o número com DDD.' }
      out.whatsapp = d ? (d.length === 10 ? '1' + d : d) : null
    }
    if (!partial || b.email !== undefined) {
      const email = clip(b.email, 120)
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'E-mail inválido' }
      out.email = email ? email.toLowerCase() : null
    }
    if (!partial || b.role !== undefined) out.role = ['profissional', 'equipe'].includes(b.role) ? b.role : 'profissional'
    if (!partial || b.members !== undefined) {
      const list = Array.isArray(b.members) ? b.members : []
      out.members = list.map((m) => clip(typeof m === 'object' && m ? m.name : m, 40)).filter(Boolean).slice(0, 12)
    }
    if (!partial || b.active !== undefined) out.active = b.active !== false
    if (out.role === 'profissional') out.members = []
    return { fields: out }
  }
  const newToken = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
  function staffRoute(c) {
    const { S, method, body: b, nowWall } = c
    const P = S.provider
    const list = () => S.staff.slice().sort((x, y) => (x.display_order - y.display_order) || String(x.created_at).localeCompare(String(y.created_at)))
    const activeCount = (except) => S.staff.filter((s) => s.active && s.id !== except).length
    if (method === 'GET') {
      gate(P, 'team')
      const rows = list()
      return ok({ staff: rows.map((s) => staffOut(P, s)), limit: limitFor(P, 'staff'), active_count: rows.filter((s) => s.active).length, can_day_link: hasFeature(P, 'team_day_link') })
    }
    if (method !== 'POST') return notAllowed()
    const now = new Date().toISOString()
    if (b.action === 'create') {
      gate(P, 'team')
      const read = readStaff(b, false)
      if (read.error) fail(400, read.error)
      if (read.fields.active) limitGate(P, 'staff', activeCount())
      if (S.staff.some((s) => s.name.toLowerCase() === read.fields.name.toLowerCase())) fail(409, 'Já existe alguém com esse nome na equipe')
      const row = { id: uid(), provider_id: P.id, ...read.fields, display_order: S.staff.reduce((m, s) => Math.max(m, s.display_order || 0), 0) + 1, day_link_token: newToken(), created_at: now }
      S.staff.push(row)
      return ok({ ok: true, staff: staffOut(P, row) }, 201)
    }
    if (!b.id) fail(400, 'id é obrigatório')
    const m = S.staff.find((s) => s.id === String(b.id))
    if (!m) fail(404, 'Pessoa da equipe não encontrada')
    if (b.action === 'update') {
      gate(P, 'team')
      const read = readStaff(b, true)
      if (read.error) fail(400, read.error)
      if (read.fields.members && read.fields.role === undefined && m.role === 'profissional') read.fields.members = []
      if (read.fields.active === true && !m.active) limitGate(P, 'staff', activeCount(m.id))
      if (read.fields.name && read.fields.name.toLowerCase() !== m.name.toLowerCase() && S.staff.some((s) => s.id !== m.id && s.name.toLowerCase() === read.fields.name.toLowerCase())) {
        fail(409, 'Já existe alguém com esse nome na equipe')
      }
      if (b.display_order !== undefined && Number.isFinite(Math.round(Number(b.display_order)))) read.fields.display_order = Math.min(Math.max(Math.round(Number(b.display_order)), 0), 1000)
      Object.assign(m, read.fields)
      return ok({ ok: true, staff: staffOut(P, m) })
    }
    if (b.action === 'rotate_token') {
      gate(P, 'team_day_link')
      m.day_link_token = newToken()
      return ok({ ok: true, staff: staffOut(P, m) })
    }
    if (b.action === 'delete') {
      const pivot = new Date(Date.parse(nowWall) - 12 * 3600e3).toISOString()
      const count = S.appointments.filter((a) => a.staff_id === m.id && ACTIVE.includes(a.status) && a.scheduled_for >= pivot).length
      if (count > 0) { m.active = false; return ok({ ok: true, staff: staffOut(P, m), deactivated: true, future_count: count }) }
      S.staff.splice(S.staff.indexOf(m), 1)
      return ok({ ok: true, deleted: true })
    }
    fail(400, 'Ação inválida')
  }

  // ── Clientes fixas (recorrência) ──────────────────────────────────────────
  const FREQUENCIES = { weekly: 1, biweekly: 2, every3weeks: 3, every4weeks: 4 }
  const HORIZON_DAYS = 42
  const alignToWeekday = (key, dow) => addDays(key, (Number(dow) - weekdayOf(key) + 7) % 7)
  function occurrences(rule, fromKey, toKey, max = 400) {
    const step = FREQUENCIES[rule?.frequency]
    if (!step || !validDate(rule.anchor_date) || !validDate(fromKey) || !validDate(toKey)) return []
    const dow = Number.isInteger(Number(rule.day_of_week)) ? Number(rule.day_of_week) : weekdayOf(rule.anchor_date)
    const first = alignToWeekday(rule.anchor_date, dow)
    const end = rule.end_date && validDate(rule.end_date) && rule.end_date < toKey ? rule.end_date : toKey
    const skip = new Set((rule.skip_dates || []).map((s) => String(s).slice(0, 10)))
    const period = step * 7
    const k = fromKey > first ? Math.ceil(diffDays(first, fromKey) / period) : 0
    const out = []
    for (let d = addDays(first, k * period); d <= end && out.length < max; d = addDays(d, period)) if (!skip.has(d)) out.push(d)
    return out
  }
  const ruleBlocked = (S, d, time, dur) => isBlockedAt(S, toWall(d, time), dur)
  function nextDates(S, rule, today, n = 3) {
    if (!rule || rule.active === false) return []
    // Igual ao servidor (api/_lib/recurring.js): hoje sai da lista depois do horário
    const t = new Date(); const nowHHMM = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
    const time = String(rule.start_time).slice(0, 5)
    return occurrences(rule, today, addDays(today, 7 * 4 * (n + 2)), n + 20)
      .filter((d) => d !== today || time >= nowHHMM)
      .filter((d) => !ruleBlocked(S, d, rule.start_time, rule.duration_min)).slice(0, n)
  }
  function ruleOut(S, r, today) {
    const cl = S.clients.find((x) => x.id === r.client_id)
    const svc = r.service_id ? S.services.find((x) => x.id === r.service_id) : null
    const st = r.staff_id ? S.staff.find((x) => x.id === r.staff_id) : null
    const rule = {
      id: r.id, client_id: r.client_id, client_name: cl?.name || 'Cliente', client_whatsapp: cl?.whatsapp || null,
      service_id: r.service_id, service_name: svc?.name || null, staff_id: r.staff_id, staff_name: st?.name || null, staff_color: st?.color || null,
      staff_active: st ? st.active !== false : null, frequency: r.frequency, day_of_week: r.day_of_week, start_time: String(r.start_time).slice(0, 5),
      duration_min: r.duration_min, price_cents: r.price_cents, anchor_date: r.anchor_date, end_date: r.end_date || null,
      skip_dates: (r.skip_dates || []).filter((d) => d >= today).sort(), active: r.active, notes: r.notes, generated_until: r.generated_until, created_at: r.created_at,
    }
    rule.next_dates = nextDates(S, rule, today, 3)
    rule.ended = !!(rule.end_date && rule.end_date < today)
    return rule
  }
  const hasMoney = (a) => !!a.deposit_paid || Number(a.paid_cents || 0) > 0 || Number(a.tip_cents || 0) > 0 || !!a.paid_at
  function generateForRule(S, rule, c) {
    if (!rule || rule.active === false) return { ok: true, created: 0 }
    const until = addDays(c.today, HORIZON_DAYS)
    const time = String(rule.start_time).slice(0, 5)
    const nowHHMM = hhmmOf(c.nowWall)
    const cl = S.clients.find((x) => x.id === rule.client_id)
    let created = 0
    for (const d of occurrences(rule, c.today, until)) {
      if (d === c.today && time < nowHHMM) continue
      if (ruleBlocked(S, d, time, rule.duration_min)) continue
      if (S.appointments.some((a) => a.recurring_id === rule.id && a.occurrence_date === d)) continue
      const stamp = new Date().toISOString()
      S.appointments.push({
        id: uid(), provider_id: S.provider.id, client_id: cl?.id || null, client_name: cl?.name || 'Cliente', client_whatsapp: cl?.whatsapp || null, client_email: cl?.email || null,
        client_notes: rule.notes || null, service_id: rule.service_id || null, service_label: null, staff_id: rule.staff_id || null, recurring_id: rule.id, occurrence_date: d,
        scheduled_for: toWall(d, time), duration_min: rule.duration_min || 60, total_cents: rule.price_cents || 0, deposit_cents: 0, deposit_paid: false, payment_method: null,
        status: 'confirmed', confirmed_at: stamp, source: 'recurring', paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null, internal_notes: null,
        review_requested: false, external_uid: null, ical_feed_id: null, ical_next_checkin: null, created_at: stamp, completed_at: null, canceled_at: null, cancel_reason: null,
      })
      created++
    }
    rule.generated_until = until
    return { ok: true, created }
  }
  function clearFutureOpen(S, rule, c, onlyDate = null) {
    const from = toWall(c.today, hhmmOf(c.nowWall))
    const open = S.appointments.filter((a) => a.recurring_id === rule.id && ACTIVE.includes(a.status) && (onlyDate ? a.occurrence_date === onlyDate : a.scheduled_for >= from))
    const drop = open.filter((a) => !hasMoney(a))
    S.appointments = S.appointments.filter((a) => !drop.includes(a))
    return { ok: true, deleted: drop.length, kept: open.length - drop.length }
  }
  function updateFutureOpen(S, rule, changes, c) {
    const from = toWall(c.today, hhmmOf(c.nowWall))
    let updated = 0
    for (const a of S.appointments) {
      if (a.recurring_id !== rule.id || !ACTIVE.includes(a.status) || a.scheduled_for < from || hasMoney(a)) continue
      if (changes.start_time) a.scheduled_for = toWall(keyOf(a.scheduled_for), changes.start_time)
      if (changes.duration_min !== undefined) a.duration_min = changes.duration_min
      if (changes.price_cents !== undefined) a.total_cents = changes.price_cents
      if (changes.service_id !== undefined) a.service_id = changes.service_id
      if (changes.staff_id !== undefined) a.staff_id = changes.staff_id
      if (changes.notes !== undefined) a.client_notes = changes.notes
      updated++
    }
    return { ok: true, updated }
  }
  function ruleConflicts(S, rule, c) {
    if (!rule.active) return []
    const dates = new Set(occurrences(rule, c.today, addDays(c.today, HORIZON_DAYS)))
    const start = toMin(rule.start_time)
    const end = start + (Number(rule.duration_min) || 60)
    const out = []
    for (const a of S.appointments) {
      const d = keyOf(a.scheduled_for)
      if (!dates.has(d) || a.recurring_id === rule.id || !ACTIVE.includes(a.status)) continue
      if (rule.staff_id && a.staff_id && rule.staff_id !== a.staff_id) continue
      const s = toMin(hhmmOf(a.scheduled_for))
      if (s < end && start < s + (Number(a.duration_min) || 60)) out.push({ date: d, time: hhmmOf(a.scheduled_for), client_name: a.client_name || '', appointment_id: a.id })
    }
    return out.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time)).slice(0, 10)
  }
  function readRule(S, b, partial, current, today) {
    const P = S.provider
    const out = {}
    let service = null
    if (!partial || b.client_id !== undefined) {
      const cl = S.clients.find((x) => x.id === String(b.client_id || ''))
      if (!b.client_id) return { error: 'Escolha a cliente' }
      if (!cl) return { error: 'Cliente não encontrada' }
      out.client_id = cl.id
    }
    if (!partial || b.service_id !== undefined) {
      if (b.service_id) {
        service = S.services.find((x) => x.id === String(b.service_id))
        if (!service) return { error: 'Serviço não encontrado' }
        out.service_id = service.id
      } else out.service_id = null
    }
    if (!partial || b.staff_id !== undefined) {
      if (b.staff_id && b.staff_id === current?.staff_id) out.staff_id = current.staff_id
      else if (b.staff_id) {
        if (!hasFeature(P, 'team')) gate(P, 'team')
        const st = S.staff.find((x) => x.id === String(b.staff_id))
        if (!st) return { error: 'Pessoa da equipe não encontrada' }
        if (!st.active) return { error: 'Essa pessoa está desativada na equipe' }
        out.staff_id = st.id
      } else out.staff_id = null
    }
    if (!partial || b.frequency !== undefined) {
      if (!FREQUENCIES[b.frequency]) return { error: 'Escolha a frequência' }
      out.frequency = b.frequency
    }
    if (!partial || b.start_time !== undefined) {
      const t = String(b.start_time || '').slice(0, 5)
      if (!HHMM.test(t)) return { error: 'Horário inválido. Use HH:MM' }
      out.start_time = t
    }
    if (!partial || b.duration_min !== undefined) {
      const def = service?.duration_min || current?.duration_min || 60
      out.duration_min = b.duration_min == null || b.duration_min === '' ? def : int(b.duration_min, 5, 720, def)
    }
    if (!partial || b.price_cents !== undefined) {
      const def = service?.price_cents ?? current?.price_cents ?? 0
      out.price_cents = b.price_cents == null || b.price_cents === '' ? def : int(b.price_cents, 0, 1000000, def)
    }
    if (!partial || b.anchor_date !== undefined) {
      const a = b.anchor_date ? String(b.anchor_date).slice(0, 10) : today
      if (!validDate(a)) return { error: 'Primeira data inválida' }
      if (a < addDays(today, -730) || a > addDays(today, 365)) return { error: 'Primeira data fora do intervalo' }
      out.anchor_date = a
    }
    if (!partial || b.day_of_week !== undefined) {
      if (b.day_of_week == null || b.day_of_week === '') out.day_of_week = weekdayOf(out.anchor_date || current?.anchor_date || today)
      else {
        const d = Number(b.day_of_week)
        if (!Number.isInteger(d) || d < 0 || d > 6) return { error: 'Dia da semana inválido' }
        out.day_of_week = d
      }
    }
    if (!partial || b.end_date !== undefined) {
      if (b.end_date) {
        const e = String(b.end_date).slice(0, 10)
        if (!validDate(e)) return { error: 'Data final inválida' }
        out.end_date = e
      } else out.end_date = null
    }
    if (!partial || b.notes !== undefined) out.notes = clip(b.notes, 500)
    const merged = { ...(current || {}), ...out }
    if (out.anchor_date !== undefined || out.day_of_week !== undefined) {
      const anchor = alignToWeekday(String(merged.anchor_date).slice(0, 10), merged.day_of_week)
      out.anchor_date = anchor
      merged.anchor_date = anchor
    }
    if (merged.end_date && merged.end_date < merged.anchor_date) return { error: 'A data final precisa ser depois da primeira data' }
    return { fields: out }
  }
  function recurringRoute(c) {
    const { S, q, method, body: b, today } = c
    const P = S.provider
    const reply = (rule, status = 200, extra = {}) => ok({ ok: true, rule: rule ? ruleOut(S, rule, today) : null, ...extra }, status)
    if (method === 'GET') {
      if (q.id) {
        const r = S.recurring.find((x) => x.id === String(q.id))
        if (!r) fail(404, 'Cliente fixa não encontrada')
        const apts = S.appointments.filter((a) => a.recurring_id === r.id && a.scheduled_for >= toWall(today, '00:00')).sort(asc).slice(0, 12)
          .map((a) => ({ id: a.id, scheduled_for: a.scheduled_for, duration_min: a.duration_min, status: a.status, occurrence_date: a.occurrence_date, staff_id: a.staff_id }))
        return ok({ rule: ruleOut(S, r, today), appointments: apts })
      }
      const rules = S.recurring.slice().sort((x, y) => x.day_of_week - y.day_of_week || String(x.start_time).localeCompare(String(y.start_time)))
      return ok({ rules: rules.map((r) => ruleOut(S, r, today)), limit: limitFor(P, 'recurring'), can_team: hasFeature(P, 'team'), today })
    }
    if (method !== 'POST') return notAllowed()
    const activeCount = (except) => S.recurring.filter((r) => r.active && r.id !== except).length
    const now = new Date().toISOString()
    if (b.action === 'create') {
      gate(P, 'recurring')
      limitGate(P, 'recurring', activeCount())
      const read = readRule(S, b, false, null, today)
      if (read.error) fail(400, read.error)
      const rule = { id: uid(), provider_id: P.id, ...read.fields, skip_dates: [], active: true, generated_until: null, created_at: now, updated_at: now }
      S.recurring.push(rule)
      const gen = generateForRule(S, rule, c)
      return reply(rule, 201, { created: gen.created, conflicts: ruleConflicts(S, rule, c), warning: null })
    }
    const cur = S.recurring.find((x) => x.id === String(b.id || ''))
    if (!b.id) fail(400, 'id é obrigatório')
    if (!cur) fail(404, 'Cliente fixa não encontrada')
    if (b.action === 'update') {
      gate(P, 'recurring')
      const read = readRule(S, b, true, cur, today)
      if (read.error) fail(400, read.error)
      const changed = Object.keys(read.fields).filter((k) => (read.fields[k] ?? null) !== (cur[k] ?? null))
      if (!changed.length) return reply(cur, 200, { created: 0, updated: 0, conflicts: [] })
      for (const k of changed) cur[k] = read.fields[k]
      cur.updated_at = now
      let result = { created: 0, updated: 0, deleted: 0 }
      if (cur.active) {
        if (changed.some((k) => ['client_id', 'frequency', 'day_of_week', 'anchor_date', 'end_date'].includes(k))) {
          const cl = clearFutureOpen(S, cur, c)
          const gen = generateForRule(S, cur, c)
          result = { created: gen.created, updated: 0, deleted: cl.deleted }
        } else {
          const inplace = {}
          for (const k of changed) if (['start_time', 'duration_min', 'price_cents', 'service_id', 'staff_id', 'notes'].includes(k)) inplace[k] = cur[k]
          const up = updateFutureOpen(S, cur, inplace, c)
          const gen = generateForRule(S, cur, c)
          result = { created: gen.created, updated: up.updated, deleted: 0 }
        }
      }
      return reply(cur, 200, { ...result, conflicts: ruleConflicts(S, cur, c), warning: null })
    }
    if (b.action === 'pause') {
      if (!cur.active) return reply(cur)
      cur.active = false
      cur.updated_at = now
      const cl = clearFutureOpen(S, cur, c)
      return reply(cur, 200, { deleted: cl.deleted, kept: cl.kept, warning: null })
    }
    if (b.action === 'resume') {
      gate(P, 'recurring')
      if (cur.active) return reply(cur)
      limitGate(P, 'recurring', activeCount(cur.id))
      cur.active = true
      cur.updated_at = now
      const gen = generateForRule(S, cur, c)
      return reply(cur, 200, { created: gen.created, conflicts: ruleConflicts(S, cur, c), warning: null })
    }
    if (b.action === 'skip' || b.action === 'unskip') {
      const date = String(b.date || '').slice(0, 10)
      if (!validDate(date)) fail(400, 'Data inválida')
      if (date < today) fail(400, 'Essa data já passou')
      if (!occurrences({ ...cur, skip_dates: [] }, date, date).length) fail(400, 'Essa data não faz parte da recorrência')
      const keep = (cur.skip_dates || []).filter((d) => d >= today && d !== date)
      cur.skip_dates = b.action === 'skip' ? [...keep, date].sort().slice(-60) : keep.sort()
      cur.updated_at = now
      if (b.action === 'skip') {
        const cl = clearFutureOpen(S, cur, c, date)
        return reply(cur, 200, { deleted: cl.deleted, kept: cl.kept, warning: null })
      }
      const gen = cur.active && hasFeature(P, 'recurring') ? generateForRule(S, cur, c) : { created: 0 }
      return reply(cur, 200, { created: gen.created })
    }
    if (b.action === 'delete') {
      const cl = clearFutureOpen(S, cur, c)
      for (const a of S.appointments) if (a.recurring_id === cur.id) a.recurring_id = null
      S.recurring.splice(S.recurring.indexOf(cur), 1)
      return ok({ ok: true, deleted: cl.deleted, kept: cl.kept })
    }
    fail(400, 'Ação inválida')
  }

  // ── Push, upload e Stripe (sem efeito fora da memória) ────────────────────
  function pushRoute({ S, method, body: b }) {
    if (method !== 'POST') return notAllowed()
    if (b.action === 'test') { gate(S.provider, 'push_notifications'); return ok({ ok: true, sent: 0 }) }
    const token = String(b.token || '').trim()
    if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(token)) fail(400, 'Token de notificação inválido')
    if (b.action === 'unregister') { S.pushTokens = S.pushTokens.filter((t) => t !== token); return ok({ ok: true }) }
    if (b.action && b.action !== 'register') fail(400, 'Ação inválida')
    if (!S.pushTokens.includes(token)) S.pushTokens.push(token)
    return ok({ ok: true })
  }
  function uploadRoute({ method, body: b }) {
    if (method !== 'POST') return notAllowed()
    if (!b.file_data) fail(400, 'file_data obrigatorio')
    const m = String(b.file_data).match(/^data:(image\/[a-z]+);base64,/)
    if (!m) fail(400, 'Formato invalido. Esperado data:image/...')
    uploads++
    const folder = String(b.folder || 'misc').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'misc'
    const url = placeholderImage(`Foto ${uploads}`, folder === 'receipts' ? 'F5EFE0' : 'E8F0E9', folder === 'receipts' ? '8C6D3D' : '1F4D3F', '1200x900')
    return ok({ success: true, url, path: `${folder}/demo/${Date.now()}_${uploads}.png`, size_kb: Math.round((String(b.file_data).length * 3) / 4 / 1024), mime: m[1] })
  }
  function subscribeRoute({ S, method, body: b, site }) {
    if (method !== 'POST') return notAllowed()
    if (!['starter', 'pro', 'premium'].includes(b.plan)) fail(400, 'plan (starter/pro/premium) obrigatório')
    const P = S.provider
    if (P.stripe_subscription_id && ['active', 'past_due', 'trialing'].includes(P.plan_status)) {
      throw new HttpError(409, { use_portal: true, error: 'Você já tem uma assinatura. Troque de plano pelo portal de cobrança.' })
    }
    const trial = P.plan_status === 'trialing' && P.trial_ends_at && Date.parse(P.trial_ends_at) - Date.now() > 48 * 3600e3
    return ok({ checkout_url: `${site}/agenda/planos?app=1&plan=${b.plan}`, trial_end: trial ? P.trial_ends_at : null })
  }
  function portalRoute({ S, method, site }) {
    if (method !== 'POST') return notAllowed()
    if (!S.provider.stripe_customer_id) fail(400, 'Você ainda não tem assinatura. Escolha um plano primeiro.')
    return ok({ portal_url: `${site}/agenda/planos?app=1` })
  }

  return {
    request,
    fetch: fetchLike,
    /** Volta aos dados de exemplo (próxima chamada recria tudo). */
    reset: () => { db = null },
    /** Estado atual (testes). */
    state,
    user: DEMO_USER,
  }
}
