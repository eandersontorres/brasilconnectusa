/**
 * Agendamentos da profissional (app AgendaPro e painel web).
 *
 * GET  /api/agenda/appointments   com JWT
 *   ?scope=upcoming|past[&staff_id=]          proximos (olha 12h pra tras) / anteriores, ate 100
 *   ?scope=range&from=ISO&to=ISO[&staff_id=]  faixa em hora de parede (max 62 dias), ate 1000
 *                                             staff_id=none → so os sem profissional da equipe
 *   ?scope=stats[&today=YYYY-MM-DD&now=ISO]   numeros da tela Hoje (today/now = relogio do celular;
 *                                             sem eles, usa o fuso do perfil)
 *        month_completed_cents = recebido no mes, mesma conta das Financas (paid_cents ou total_cents)
 *        → { today_count, today_expected_cents, week_count, month_count, month_completed_cents,
 *            month_expected_cents, month_tips_cents, pending_deposits, unmarked_past,
 *            next_appointment, pending_list[], unmarked_list[], setup: { services, hours, has_online_booking } }
 *   ?id=UUID                                  { appointment, client, payments }
 *
 * POST /api/agenda/appointments   com JWT   Body: { action, id?, ... }
 *   create           { client_id | client_name+client_whatsapp?+client_email?, service_id | service_label,
 *                      scheduled_for, duration_min?, total_cents?, deposit_cents?, staff_id?, status?,
 *                      client_notes?, internal_notes?, allow_conflict? }
 *   update           { id, client_notes?, internal_notes?, total_cents?, deposit_cents?, duration_min?,
 *                      service_id?, service_label?, staff_id?, client_id?, client_name?, client_whatsapp?,
 *                      client_email?, allow_conflict? }
 *                    client_name sem client_id = outra pessoa: acha/cria a ficha como no create
 *                    (so o nome → client_id null). client_id: null solta a ficha.
 *   reschedule       { id, scheduled_for, duration_min?, staff_id?, allow_conflict? }  zera os lembretes
 *                    (mesmo horario, duracao e pessoa = nada muda)
 *   confirm | complete | no_show | cancel { id, reason? } | reopen { id, allow_conflict? }
 *   confirm_deposit  { id, method }   sinal recebido por fora → confirma
 *   mark_paid        { id, paid_cents, tip_cents?, method, complete? }
 *                    paid_cents = valor do servico recebido no total (conta o sinal ja pago; sem gorjeta).
 *                    Grava ag_payments 'service' (o que entrou agora) e 'tip'; registrar de novo substitui.
 *   unmark_paid      { id }
 *
 * Conflito de horario → 409 { code: 'conflict', conflict } (reenvie com allow_conflict: true pra encaixar).
 * create e reschedule devolvem tambem blocked: true|false — o horario cai numa folga (ag_is_blocked,
 * supabase/ag_app_setup.sql). So aviso: grava assim mesmo. Sem a funcao no banco → false.
 * Mudanca de status fica liberada mesmo sem plano; criar/editar exige 'agenda'; pagamento exige 'payments_log'.
 *
 * Horarios sao hora do relogio da profissional gravada como UTC (ver agendapro/CONTRACT.md):
 * aqui tudo se compara pela string ISO, nunca pelo fuso do servidor.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'
import { normalizePhone } from '../_lib/phone.js'

// Colunas que existem desde o schema original (+ turnover). Usadas se o SQL novo ainda nao foi aplicado.
const BASE_COLS = 'id, scheduled_for, duration_min, status, client_id, client_name, client_whatsapp, client_email, client_notes, service_id, total_cents, deposit_cents, deposit_paid, payment_method, review_requested, created_at, confirmed_at, completed_at, canceled_at, cancel_reason, external_uid, ical_next_checkin, ag_services(name), ag_ical_feeds(label, source, notes)'
// + ag_app_agenda.sql (source, pagamento, notas) e ag_app_team.sql (staff_id, recurring_id → ag_staff)
const FULL_COLS = BASE_COLS + ', service_label, paid_cents, tip_cents, paid_method, paid_at, internal_notes, source, staff_id, recurring_id, ag_staff!staff_id(name, color)'
const CLIENT_BASE = 'id, name, whatsapp, email, notes'
const CLIENT_FULL = CLIENT_BASE + ', language, home_notes, address_line, city, state, zip'
// Erro de coluna/relacao inexistente (SQL novo nao aplicado): tenta com as colunas antigas
const LEGACY_ERR = /column|relationship|schema cache|does not exist/i

const METHODS = ['zelle', 'cash', 'card', 'venmo', 'cashapp', 'check', 'other']
const ACTIVE = ['pending', 'confirmed']
const STATUS_PT = { pending: 'aguardando sinal', confirmed: 'confirmado', completed: 'realizado', canceled: 'cancelado', no_show: 'faltou' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/
const DAY_MS = 86400e3
const MAX_RANGE_DAYS = 62

const int = (v, min, max, def) => {
  if (v === null || v === undefined || v === '') return def
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const pad = (n) => String(n).padStart(2, '0')

export { normalizePhone }

/**
 * 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:MM[:SS[.mmm]][Z]' → ISO de parede normalizado.
 * Data sem hora vira 00:00 (ou 23:59:59.999 com endOfDay). Invalido → null.
 */
export function parseWall(v, { endOfDay = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z?)?$/.exec(String(v || '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const noTime = m[4] === undefined
  const h = noTime ? (endOfDay ? 23 : 0) : Number(m[4])
  const mi = noTime ? (endOfDay ? 59 : 0) : Number(m[5])
  const s = noTime ? (endOfDay ? 59 : 0) : Number(m[6] || 0)
  const ms = noTime ? (endOfDay ? 999 : 0) : Number(String(m[7] || '0').padEnd(3, '0'))
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms)
  const iso = new Date(t).toISOString()
  if (iso.slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null   // 31/02 etc.
  return iso
}

/** Hora de parede agora no fuso da profissional, como ISO 'Z'. */
export function wallNow(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
    const g = (t) => parts.find((p) => p.type === t)?.value
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:00.000Z`
  } catch (_) {
    return new Date(date).toISOString()
  }
}

export function addDaysKey(key, n) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function weekStartKey(key, mondayFirst) {
  const wd = new Date(key + 'T12:00:00Z').getUTCDay()
  return addDaysKey(key, -(mondayFirst ? (wd + 6) % 7 : wd))
}

const endOf = (a) => Date.parse(a.scheduled_for) + (Number(a.duration_min) || 0) * 60e3

/** Dinheiro que entrou pelo agendamento, sem gorjeta (mesma conta de api/agenda/finance.js). */
function incomeOf(a) {
  if (a.status === 'completed') return Math.max(0, a.paid_cents != null ? Number(a.paid_cents) : (Number(a.total_cents) || 0))
  if (a.status === 'no_show' || a.status === 'canceled') {
    if (a.paid_cents != null) return Math.max(0, Number(a.paid_cents) || 0)
    return a.status === 'no_show' && a.deposit_paid ? Math.max(0, Number(a.deposit_cents) || 0) : 0
  }
  return 0
}
const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
// O PostgREST devolve TIMESTAMPTZ como '...T10:00:00+00:00'; o app grava '...T10:00:00.000Z' (CONTRACT)
const isoOf = (v) => { const t = Date.parse(v); return v == null || Number.isNaN(t) ? v : new Date(t).toISOString() }

// Turnover (external_uid) traz a casa sincronizada no lugar do servico; staff vem do join com ag_staff
function shape(a) {
  if (!a) return null
  const { ag_services, ag_ical_feeds, ag_staff, ...rest } = a
  return {
    ...rest,
    scheduled_for: isoOf(a.scheduled_for),
    service_name: ag_services?.name || a.service_label || null,
    service_label: a.service_label ?? null,
    feed_label: ag_ical_feeds?.label || null,
    feed_source: ag_ical_feeds?.source || null,
    feed_notes: ag_ical_feeds?.notes || null,
    source: a.external_uid ? 'ical' : (a.source || 'online'),
    staff_id: a.staff_id ?? null,
    staff_name: ag_staff?.name || null,
    staff_color: ag_staff?.color || null,
    recurring_id: a.recurring_id ?? null,
    paid_cents: a.paid_cents ?? null,
    tip_cents: a.tip_cents ?? 0,
    paid_method: a.paid_method ?? null,
    paid_at: a.paid_at ?? null,
    internal_notes: a.internal_notes ?? null,
  }
}

function shapeClient(c) {
  if (!c) return null
  return {
    id: c.id, name: c.name, whatsapp: c.whatsapp || null, email: c.email || null,
    language: ['pt', 'en', 'es'].includes(c.language) ? c.language : 'pt',
    home_notes: c.home_notes || null, address_line: c.address_line || null,
    city: c.city || null, state: c.state || null, zip: c.zip || null, notes: c.notes || null,
  }
}

/** Roda a consulta com as colunas novas; se o SQL ainda nao foi aplicado, com as antigas. */
async function withCols(run, full = FULL_COLS, base = BASE_COLS) {
  const r = await run(full)
  if (r.error && LEGACY_ERR.test(r.error.message || '')) return run(base)
  return r
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    const pid = provider.id

    const fetchOne = async (id) => {
      const { data } = await withCols((cols) => supabase.from('ag_appointments').select(cols)
        .eq('id', id).eq('provider_id', pid).maybeSingle())
      return shape(data)
    }

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store')
      const q = req.query || {}

      // ── Um agendamento ────────────────────────────────────────────────
      if (q.id) {
        if (!UUID.test(String(q.id))) return res.status(400).json({ error: 'id inválido' })
        const { data: apt, error } = await withCols((cols) => supabase.from('ag_appointments').select(cols)
          .eq('id', q.id).eq('provider_id', pid).maybeSingle())
        if (error) return res.status(500).json({ error: error.message })
        if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' })

        let client = null
        if (apt.client_id) {
          const { data: c } = await withCols((cols) => supabase.from('ag_clients').select(cols)
            .eq('id', apt.client_id).eq('provider_id', pid).maybeSingle(), CLIENT_FULL, CLIENT_BASE)
          client = shapeClient(c)
        }
        const { data: pays } = await supabase.from('ag_payments')
          .select('id, amount_cents, type, status, paid_at, created_at, metadata')
          .eq('provider_id', pid).eq('appointment_id', apt.id).order('created_at', { ascending: true })

        return res.status(200).json({
          appointment: shape(apt),
          client,
          payments: (pays || []).map((p) => ({
            id: p.id, amount_cents: p.amount_cents, type: p.type, status: p.status,
            paid_at: p.paid_at || p.created_at, method: p.metadata?.method || null,
          })),
        })
      }

      // Filtro por equipe (uuid ou 'none')
      let staffFilter = null
      if (q.staff_id) {
        if (q.staff_id !== 'none' && !UUID.test(String(q.staff_id))) return res.status(400).json({ error: 'staff_id inválido' })
        staffFilter = q.staff_id
      }
      const byStaff = (qb) => (staffFilter === 'none' ? qb.is('staff_id', null) : staffFilter ? qb.eq('staff_id', staffFilter) : qb)

      // ── Números da tela Hoje ──────────────────────────────────────────
      if (q.scope === 'stats') return stats(req, res, supabase, provider)

      // ── Faixa de datas (agenda dia/semana) ────────────────────────────
      if (q.scope === 'range') {
        const from = parseWall(q.from)
        const to = parseWall(q.to, { endOfDay: true })
        if (!from || !to) return res.status(400).json({ error: 'from e to são obrigatórios (AAAA-MM-DD ou ISO)' })
        if (to < from) return res.status(400).json({ error: 'O fim precisa ser depois do início' })
        if (Date.parse(to) - Date.parse(from) > (MAX_RANGE_DAYS + 1) * DAY_MS) {
          return res.status(400).json({ error: `No máximo ${MAX_RANGE_DAYS} dias por consulta` })
        }
        const { data, error } = await withCols((cols) => byStaff(supabase.from('ag_appointments').select(cols)
          .eq('provider_id', pid).gte('scheduled_for', from).lte('scheduled_for', to))
          .order('scheduled_for', { ascending: true }).limit(1000))
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ appointments: (data || []).map(shape) })
      }

      // ── Próximos / anteriores ─────────────────────────────────────────
      const past = q.scope === 'past'
      const pivot = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
      const { data, error } = await withCols((cols) => {
        let qb = byStaff(supabase.from('ag_appointments').select(cols).eq('provider_id', pid))
        qb = past
          ? qb.lt('scheduled_for', pivot).order('scheduled_for', { ascending: false })
          : qb.gte('scheduled_for', pivot).order('scheduled_for', { ascending: true })
        return qb.limit(100)
      })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ appointments: (data || []).map(shape) })
    }

    // ═══ POST ═════════════════════════════════════════════════════════════
    const b = req.body || {}
    const action = String(b.action || '')
    const now = new Date().toISOString()

    // Conflito: com equipe, so entre agendamentos da mesma pessoa; sem, a regra do banco
    async function findConflict({ start, duration, staffId, excludeId }) {
      const startMs = Date.parse(start)
      const endMs = startMs + duration * 60e3
      const overlapJs = async (withStaff) => {
        let qb = supabase.from('ag_appointments').select('id, scheduled_for, duration_min, client_name')
          .eq('provider_id', pid).not('status', 'in', '(canceled,no_show)')
          .gte('scheduled_for', new Date(startMs - DAY_MS).toISOString())
          .lt('scheduled_for', new Date(endMs).toISOString())
        if (withStaff) qb = qb.eq('staff_id', staffId)
        if (excludeId) qb = qb.neq('id', excludeId)
        const { data, error } = await qb.limit(300)
        if (error) throw new Error(error.message)
        return (data || []).find((a) => Date.parse(a.scheduled_for) < endMs && endOf(a) > startMs) || null
      }
      if (staffId) return overlapJs(true)
      const { data: busy, error } = await supabase.rpc('ag_check_conflict', {
        p_provider_id: pid, p_start: start, p_duration_min: duration, p_exclude_appointment_id: excludeId || null,
      })
      if (error) return overlapJs(false)          // funcao indisponivel: confere aqui mesmo
      if (!busy) return null
      return (await overlapJs(false).catch(() => null)) || { id: null }
    }
    const conflictReply = (hit) => res.status(409).json({
      error: hit?.client_name
        ? `Já tem agendamento nesse horário (${hit.client_name}, ${hhmm(hit.scheduled_for)}).`
        : 'Já tem agendamento nesse horário.',
      code: 'conflict',
      conflict: hit?.id ? { id: hit.id, scheduled_for: hit.scheduled_for, client_name: hit.client_name, duration_min: hit.duration_min } : null,
    })

    // Folga no periodo? So aviso (nao impede). Funcao inexistente ou erro = nao bloqueado
    async function isBlocked(start, duration) {
      try {
        const { data, error } = await supabase.rpc('ag_is_blocked', { p_provider_id: pid, p_start: start, p_duration_min: duration })
        return !error && data === true
      } catch (_) {
        return false
      }
    }

    // Profissional da equipe precisa ser dela (e o plano precisa ter equipe)
    async function checkStaff(staffId) {
      if (staffId === null || staffId === '' || staffId === undefined) return { ok: true, id: null }
      if (!UUID.test(String(staffId))) return { ok: false, status: 400, body: { error: 'Profissional da equipe inválido' } }
      const gate = requireFeature(provider, 'team')
      if (!gate.ok) return { ok: false, status: gate.status, body: gate.body }
      const { data, error } = await supabase.from('ag_staff').select('id')
        .eq('id', staffId).eq('provider_id', pid).maybeSingle()
      if (error || !data) return { ok: false, status: 404, body: { error: 'Profissional da equipe não encontrado' } }
      return { ok: true, id: data.id }
    }

    async function loadService(serviceId) {
      if (!UUID.test(String(serviceId))) return null
      const { data } = await supabase.from('ag_services').select('id, name, duration_min, price_cents, deposit_cents')
        .eq('id', serviceId).eq('provider_id', pid).maybeSingle()
      return data || null
    }

    async function loadClient(clientId) {
      if (!UUID.test(String(clientId))) return null
      const { data } = await supabase.from('ag_clients').select('id, name, whatsapp, email')
        .eq('id', clientId).eq('provider_id', pid).maybeSingle()
      return data || null
    }

    /**
     * Cliente sem ficha escolhida (create, ou update com client_name sem client_id):
     * acha a ficha pelo WhatsApp (ou e-mail) ou cria uma. So o nome (cliente de passagem) → sem ficha.
     * → { ok, client|null, name, whatsapp, email } ou { ok: false, status, body }
     */
    async function resolveClient(input) {
      const fail = (status, error) => ({ ok: false, status, body: { error } })
      const name = clip(input.client_name, 120)
      if (!name) return fail(400, 'Informe o nome da cliente')
      let whatsapp = null, email = null
      if (input.client_whatsapp && String(input.client_whatsapp).trim()) {
        whatsapp = normalizePhone(input.client_whatsapp)
        if (!whatsapp) return fail(400, 'WhatsApp inválido. Use código de área + número.')
      }
      const e = input.client_email ? String(input.client_email).trim().toLowerCase().slice(0, 254) : ''
      if (e) {
        if (!EMAIL_RE.test(e)) return fail(400, 'E-mail inválido')
        email = e
      }
      // Ficha que ja existe: volta pra lista se estava arquivada e ganha o e-mail que faltava
      const reuse = async (c) => {
        const patch = {}
        if (c.archived === true) patch.archived = false
        if (email && !c.email) patch.email = email
        if (Object.keys(patch).length) await supabase.from('ag_clients').update(patch).eq('id', c.id).eq('provider_id', pid)
        return { id: c.id, name: c.name, whatsapp: c.whatsapp, email: c.email || email }
      }
      let client = null
      if (whatsapp) {
        // Fichas antigas (agendamento pelo site) podem ter o numero sem '+' ou formatado
        const raw = String(input.client_whatsapp).trim().slice(0, 30)
        const digits = whatsapp.slice(1)
        const variants = [...new Set([whatsapp, digits, raw, digits.startsWith('1') ? digits.slice(1) : digits])]
        const { data: found } = await supabase.from('ag_clients').select('*')
          .eq('provider_id', pid).in('whatsapp', variants).limit(1)
        if (found?.[0]) client = await reuse(found[0])
        else {
          const ins = await supabase.from('ag_clients')
            .upsert({ provider_id: pid, name, whatsapp, email }, { onConflict: 'provider_id,whatsapp', ignoreDuplicates: false })
            .select('id, name, whatsapp, email').single()
          if (ins.error) return fail(500, ins.error.message)
          client = ins.data
        }
      } else if (email) {
        const { data: found } = await supabase.from('ag_clients').select('*')
          .eq('provider_id', pid).eq('email', email).limit(1)
        if (found?.[0]) client = await reuse(found[0])
        else {
          const ins = await supabase.from('ag_clients').insert({ provider_id: pid, name, email })
            .select('id, name, whatsapp, email').single()
          if (ins.error) return fail(500, ins.error.message)
          client = ins.data
        }
      }
      return { ok: true, client, name, whatsapp, email }
    }

    // ── create ────────────────────────────────────────────────────────
    if (action === 'create') {
      const gate = requireFeature(provider, 'agenda')
      if (!gate.ok) return res.status(gate.status).json(gate.body)

      const scheduled = parseWall(b.scheduled_for)
      if (!scheduled || !/T/.test(String(b.scheduled_for))) return res.status(400).json({ error: 'Escolha o dia e o horário' })

      // Cliente: da ficha ou nova (acha/cria a ficha pelo WhatsApp ou e-mail)
      let client = null
      let name = null, whatsapp = null, email = null
      if (b.client_id) {
        client = await loadClient(b.client_id)
        if (!client) return res.status(404).json({ error: 'Cliente não encontrada' })
      } else {
        const r = await resolveClient(b)
        if (!r.ok) return res.status(r.status).json(r.body)
        ;({ client, name, whatsapp, email } = r)
      }

      // Serviço do catálogo ou avulso
      let service = null
      if (b.service_id) {
        service = await loadService(b.service_id)
        if (!service) return res.status(404).json({ error: 'Serviço não encontrado' })
      }
      const label = service ? null : clip(b.service_label, 120)
      if (!service && !label) return res.status(400).json({ error: 'Escolha um serviço ou escreva o nome do serviço avulso' })

      const duration = int(b.duration_min, 5, 720, service?.duration_min || 60)
      const total = int(b.total_cents, 0, 10000000, service?.price_cents || 0)
      const deposit = Math.min(int(b.deposit_cents, 0, 10000000, service?.deposit_cents || 0), total || 10000000)
      const status = b.status === 'pending' ? 'pending' : 'confirmed'

      const staff = await checkStaff(b.staff_id)
      if (!staff.ok) return res.status(staff.status).json(staff.body)

      if (b.allow_conflict !== true) {
        const hit = await findConflict({ start: scheduled, duration, staffId: staff.id })
        if (hit) return conflictReply(hit)
      }

      const row = {
        provider_id: pid,
        service_id: service?.id || null,
        service_label: label,
        client_id: client?.id || null,
        client_name: client?.name || name,
        client_whatsapp: client?.whatsapp || whatsapp,
        client_email: client?.email || email,
        client_notes: clip(b.client_notes, 1000),
        internal_notes: clip(b.internal_notes, 2000),
        scheduled_for: scheduled,
        duration_min: duration,
        total_cents: total,
        deposit_cents: deposit,
        deposit_paid: false,
        status,
        confirmed_at: status === 'confirmed' ? now : null,
        source: 'manual',
      }
      if (staff.id) row.staff_id = staff.id

      const { data: created, error } = await supabase.from('ag_appointments').insert(row).select('id').single()
      if (error) return res.status(500).json({ error: error.message })
      const blocked = await isBlocked(scheduled, duration)
      return res.status(201).json({ ok: true, appointment: await fetchOne(created.id), blocked })
    }

    // ── Ações sobre um agendamento existente ─────────────────────────────
    if (!b.id || !UUID.test(String(b.id))) return res.status(400).json({ error: 'id e action são obrigatórios' })
    const { data: apt } = await supabase.from('ag_appointments').select('*')
      .eq('id', b.id).eq('provider_id', pid).maybeSingle()
    if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' })

    // patch vazio = nada muda (ação repetida): só devolve o agendamento. extra vai junto na resposta
    const save = async (patch, extra = {}) => {
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('ag_appointments').update(patch).eq('id', apt.id).eq('provider_id', pid)
        if (error) return res.status(500).json({ error: error.message })
      }
      return res.status(200).json({ ok: true, appointment: await fetchOne(apt.id), ...extra })
    }
    const wrongStatus = () => res.status(400).json({
      error: `Esse agendamento está ${STATUS_PT[apt.status] || apt.status}. Use "Desfazer" antes, se precisar.`,
      code: 'invalid_status',
    })

    // ── update ────────────────────────────────────────────────────────
    if (action === 'update') {
      const gate = requireFeature(provider, 'agenda')
      if (!gate.ok) return res.status(gate.status).json(gate.body)

      const patch = {}
      if (has(b, 'client_notes')) patch.client_notes = clip(b.client_notes, 1000)
      if (has(b, 'internal_notes')) patch.internal_notes = clip(b.internal_notes, 2000)
      if (has(b, 'total_cents')) patch.total_cents = int(b.total_cents, 0, 10000000, apt.total_cents || 0)
      if (has(b, 'deposit_cents')) {
        if (apt.deposit_paid) return res.status(400).json({ error: 'O sinal já foi recebido; não dá pra mudar o valor.' })
        patch.deposit_cents = int(b.deposit_cents, 0, 10000000, apt.deposit_cents || 0)
      }
      if (has(b, 'duration_min')) patch.duration_min = int(b.duration_min, 5, 720, apt.duration_min)

      if (has(b, 'service_id') || has(b, 'service_label')) {
        if (b.service_id) {
          const service = await loadService(b.service_id)
          if (!service) return res.status(404).json({ error: 'Serviço não encontrado' })
          patch.service_id = service.id
          patch.service_label = null
        } else if (has(b, 'service_id')) {
          const label = clip(b.service_label, 120) || apt.service_label
          if (!label) return res.status(400).json({ error: 'Escreva o nome do serviço avulso' })
          patch.service_id = null
          patch.service_label = label
        } else if (!apt.service_id) {
          const label = clip(b.service_label, 120)
          if (!label) return res.status(400).json({ error: 'Escreva o nome do serviço avulso' })
          patch.service_label = label
        }
      }

      if (has(b, 'staff_id')) {
        const staff = await checkStaff(b.staff_id)
        if (!staff.ok) return res.status(staff.status).json(staff.body)
        patch.staff_id = staff.id
      }

      // Cliente: ficha escolhida (client_id) ou outra pessoa (client_name sem client_id = dados
      // completos, como no create: acha/cria a ficha pelo WhatsApp ou e-mail; só o nome → sem ficha).
      // Assim o agendamento nunca fica com os dados de uma pessoa e a ficha de outra.
      if (b.client_id) {
        const client = await loadClient(b.client_id)
        if (!client) return res.status(404).json({ error: 'Cliente não encontrada' })
        Object.assign(patch, { client_id: client.id, client_name: client.name, client_whatsapp: client.whatsapp, client_email: client.email })
      } else if (has(b, 'client_name')) {
        const r = await resolveClient(b)
        if (!r.ok) return res.status(r.status).json(r.body)
        Object.assign(patch, {
          client_id: r.client?.id || null,
          client_name: r.client?.name || r.name,
          client_whatsapp: r.client?.whatsapp || r.whatsapp,
          client_email: r.client?.email || r.email,
        })
      } else {
        // client_id: null solta a ficha; WhatsApp/e-mail sozinhos mudam só a cópia neste agendamento
        if (has(b, 'client_id') && b.client_id === null) patch.client_id = null
        if (has(b, 'client_whatsapp')) {
          const empty = !b.client_whatsapp || !String(b.client_whatsapp).trim()
          const w = empty ? null : normalizePhone(b.client_whatsapp)
          if (!empty && !w) return res.status(400).json({ error: 'WhatsApp inválido. Use código de área + número.' })
          patch.client_whatsapp = w
        }
        if (has(b, 'client_email')) {
          const e = b.client_email ? String(b.client_email).trim().toLowerCase().slice(0, 254) : null
          if (e && !EMAIL_RE.test(e)) return res.status(400).json({ error: 'E-mail inválido' })
          patch.client_email = e
        }
      }

      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada pra atualizar' })

      // Mais tempo ou outra pessoa da equipe pode bater com outro horário
      const durationChanged = has(patch, 'duration_min') && patch.duration_min !== apt.duration_min
      const staffChanged = has(patch, 'staff_id') && patch.staff_id !== (apt.staff_id ?? null)
      if ((durationChanged || staffChanged) && ACTIVE.includes(apt.status) && b.allow_conflict !== true) {
        const hit = await findConflict({
          start: apt.scheduled_for,
          duration: patch.duration_min ?? apt.duration_min,
          staffId: has(patch, 'staff_id') ? patch.staff_id : (apt.staff_id ?? null),
          excludeId: apt.id,
        })
        if (hit) return conflictReply(hit)
      }
      return save(patch)
    }

    // ── reschedule ────────────────────────────────────────────────────
    if (action === 'reschedule') {
      const gate = requireFeature(provider, 'agenda')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      if (apt.status === 'completed') {
        return res.status(400).json({ error: 'Esse atendimento já foi realizado. Use "Repetir" pra marcar outro.', code: 'invalid_status' })
      }
      const scheduled = parseWall(b.scheduled_for)
      if (!scheduled || !/T/.test(String(b.scheduled_for))) return res.status(400).json({ error: 'Escolha o novo dia e horário' })
      const duration = int(b.duration_min, 5, 720, apt.duration_min || 60)
      let staffId = apt.staff_id ?? null
      if (has(b, 'staff_id')) {
        const staff = await checkStaff(b.staff_id)
        if (!staff.ok) return res.status(staff.status).json(staff.body)
        staffId = staff.id
      }
      // Mesmo horário, duração e pessoa: nada muda (não reativa cancelado nem zera os lembretes)
      if (Date.parse(scheduled) === Date.parse(apt.scheduled_for) && duration === Number(apt.duration_min)
        && staffId === (apt.staff_id ?? null)) {
        return save({})
      }
      if (b.allow_conflict !== true) {
        const hit = await findConflict({ start: scheduled, duration, staffId, excludeId: apt.id })
        if (hit) return conflictReply(hit)
      }
      const patch = { scheduled_for: scheduled, duration_min: duration, reminder_24h_sent: false, reminder_1h_sent: false }
      if (has(b, 'staff_id')) patch.staff_id = staffId
      // Remarcar quem faltou/cancelou traz o agendamento de volta
      if (!ACTIVE.includes(apt.status)) {
        Object.assign(patch, { status: 'confirmed', confirmed_at: now, canceled_at: null, cancel_reason: null })
      }
      return save(patch, { blocked: await isBlocked(scheduled, duration) })
    }

    // ── Status (liberado mesmo sem plano) ─────────────────────────────
    if (action === 'confirm') {
      if (apt.status === 'confirmed') return save({})
      if (apt.status !== 'pending') return wrongStatus()
      return save({ status: 'confirmed', confirmed_at: now })
    }

    if (action === 'confirm_deposit') {
      if (!ACTIVE.includes(apt.status)) return wrongStatus()
      const m = METHODS.includes(b.method) ? b.method : 'zelle'
      if (!apt.deposit_paid && (apt.deposit_cents || 0) > 0) {
        const ins = await supabase.from('ag_payments').insert({
          provider_id: pid, appointment_id: apt.id, amount_cents: apt.deposit_cents,
          type: 'deposit', status: 'paid', paid_at: now, metadata: { method: m, confirmed_by: 'provider' },
        })
        if (ins.error) return res.status(500).json({ error: ins.error.message })
      }
      return save({ deposit_paid: true, payment_method: m, status: 'confirmed', confirmed_at: apt.confirmed_at || now })
    }

    if (action === 'complete') {
      if (apt.status === 'completed') return save({})
      if (!ACTIVE.includes(apt.status)) return wrongStatus()
      return save({ status: 'completed', completed_at: now })
    }

    if (action === 'no_show') {
      if (apt.status === 'no_show') return save({})
      if (!ACTIVE.includes(apt.status)) return wrongStatus()
      return save({ status: 'no_show' })
    }

    if (action === 'cancel') {
      if (apt.status === 'canceled') return save({})
      if (!ACTIVE.includes(apt.status)) return wrongStatus()
      return save({ status: 'canceled', canceled_at: now, cancel_reason: clip(b.reason, 300) })
    }

    // Desfazer "faltou" ou "cancelado"
    if (action === 'reopen') {
      if (ACTIVE.includes(apt.status)) return save({})
      if (apt.status === 'completed') return wrongStatus()
      if (b.allow_conflict !== true) {
        const hit = await findConflict({ start: apt.scheduled_for, duration: apt.duration_min, staffId: apt.staff_id ?? null, excludeId: apt.id })
        if (hit) return conflictReply(hit)
      }
      const waitingDeposit = (apt.deposit_cents || 0) > 0 && !apt.deposit_paid && !apt.confirmed_at
      return save({ status: waitingDeposit ? 'pending' : 'confirmed', canceled_at: null, cancel_reason: null })
    }

    // ── Pagamento no atendimento ──────────────────────────────────────
    if (action === 'mark_paid') {
      const gate = requireFeature(provider, 'payments_log')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      if (apt.status === 'canceled') return res.status(400).json({ error: 'Agendamento cancelado. Desfaça o cancelamento antes de registrar o pagamento.' })
      if (!METHODS.includes(b.method)) return res.status(400).json({ error: 'Escolha a forma de pagamento' })

      // paid_cents = valor do serviço recebido no total, já contando o sinal (é o que as Finanças somam).
      // Em ag_payments entra só o que chegou agora (o sinal já tem a linha 'deposit').
      const depositPaid = apt.deposit_paid ? (apt.deposit_cents || 0) : 0
      const paid = int(b.paid_cents, 0, 10000000, apt.total_cents || 0)
      const tip = int(b.tip_cents, 0, 1000000, 0)
      const nowPaid = Math.max(0, paid - depositPaid)

      // Registrar de novo substitui o registro anterior (não duplica no financeiro)
      const delOld = await supabase.from('ag_payments').delete()
        .eq('provider_id', pid).eq('appointment_id', apt.id).in('type', ['service', 'tip'])
      if (delOld.error) return res.status(500).json({ error: delOld.error.message })
      const meta = { method: b.method, recorded_by: 'provider' }
      if (apt.staff_id) meta.staff_id = apt.staff_id
      const rows = []
      if (nowPaid > 0) rows.push({ provider_id: pid, appointment_id: apt.id, amount_cents: nowPaid, type: 'service', status: 'paid', paid_at: now, metadata: meta })
      if (tip > 0) rows.push({ provider_id: pid, appointment_id: apt.id, amount_cents: tip, type: 'tip', status: 'paid', paid_at: now, metadata: meta })
      if (rows.length) {
        const ins = await supabase.from('ag_payments').insert(rows)
        if (ins.error) return res.status(500).json({ error: ins.error.message })
      }

      const patch = { paid_cents: paid, tip_cents: tip, paid_method: b.method, paid_at: now }
      if (b.complete === true && ACTIVE.includes(apt.status)) Object.assign(patch, { status: 'completed', completed_at: now })
      return save(patch)
    }

    if (action === 'unmark_paid') {
      const gate = requireFeature(provider, 'payments_log')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const delOld = await supabase.from('ag_payments').delete()
        .eq('provider_id', pid).eq('appointment_id', apt.id).in('type', ['service', 'tip'])
      if (delOld.error) return res.status(500).json({ error: delOld.error.message })
      return save({ paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// ── Tela Hoje ───────────────────────────────────────────────────────────────
async function stats(req, res, supabase, provider) {
  const pid = provider.id
  const q = req.query || {}
  const tzNow = wallNow(provider.timezone)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(q.today || '')) && parseWall(q.today) ? String(q.today) : tzNow.slice(0, 10)
  const nowIso = parseWall(q.now) || tzNow
  const mondayFirst = !!provider.app_settings?.week_starts_monday

  const weekStart = weekStartKey(today, mondayFirst)
  const weekEnd = addDaysKey(weekStart, 6)
  const monthStart = today.slice(0, 8) + '01'
  const monthEnd = addDaysKey(addDaysKey(monthStart, 32).slice(0, 8) + '01', -1)
  const aggFrom = weekStart < monthStart ? weekStart : monthStart
  const aggTo = weekEnd > monthEnd ? weekEnd : monthEnd
  const nowMs = Date.parse(nowIso)

  const listQuery = (build) => withCols((cols) => build(supabase.from('ag_appointments').select(cols).eq('provider_id', pid)))

  // Mês + semana em páginas de 1000 (limite do PostgREST)
  const aggregate = async () => {
    const rows = []
    for (let page = 0; page < 5; page++) {
      const r = await withCols((cols) => supabase.from('ag_appointments').select(cols).eq('provider_id', pid)
        .gte('scheduled_for', aggFrom + 'T00:00:00.000Z').lte('scheduled_for', aggTo + 'T23:59:59.999Z')
        .order('scheduled_for', { ascending: true }).range(page * 1000, page * 1000 + 999),
      'id, scheduled_for, status, total_cents, deposit_cents, deposit_paid, paid_cents, tip_cents',
      'id, scheduled_for, status, total_cents, deposit_cents, deposit_paid')
      if (r.error) return r
      rows.push(...(r.data || []))
      if ((r.data || []).length < 1000) break
    }
    return { data: rows, error: null }
  }

  const [agg, unmarked, pending, next, svc, hrs, online] = await Promise.all([
    aggregate(),
    // Confirmados que já passaram e ninguém marcou (últimos 30 dias)
    listQuery((qb) => qb.eq('status', 'confirmed')
      .gte('scheduled_for', addDaysKey(today, -30) + 'T00:00:00.000Z').lt('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: false }).limit(40)),
    // Aguardando sinal/confirmação, de hoje pra frente
    listQuery((qb) => qb.eq('status', 'pending').gte('scheduled_for', today + 'T00:00:00.000Z')
      .order('scheduled_for', { ascending: true }).limit(20)),
    listQuery((qb) => qb.in('status', ACTIVE).gte('scheduled_for', new Date(nowMs - 15 * 60e3).toISOString())
      .order('scheduled_for', { ascending: true }).limit(1)),
    supabase.from('ag_services').select('id', { count: 'exact', head: true }).eq('provider_id', pid).eq('active', true),
    supabase.from('ag_availability').select('id', { count: 'exact', head: true }).eq('provider_id', pid),
    supabase.from('ag_appointments').select('id', { count: 'exact', head: true }).eq('provider_id', pid)
      .is('external_uid', null).eq('source', 'online'),
  ])
  for (const r of [agg, unmarked, pending, next]) {
    if (r.error) return res.status(500).json({ error: r.error.message })
  }

  const out = {
    today, now: nowIso, week_start: weekStart,
    today_count: 0, today_expected_cents: 0, week_count: 0,
    month_count: 0, month_completed_cents: 0, month_expected_cents: 0, month_tips_cents: 0,
  }
  for (const a of agg.data || []) {
    const key = String(a.scheduled_for).slice(0, 10)
    const inMonth = key >= monthStart && key <= monthEnd
    const got = incomeOf(a)
    if (inMonth && got) out.month_completed_cents += got
    if (inMonth && a.status !== 'pending' && a.status !== 'confirmed') out.month_tips_cents += Number(a.tip_cents) || 0
    if (a.status === 'canceled' || a.status === 'no_show') continue
    const cents = Number(a.total_cents) || 0
    if (key === today) { out.today_count++; out.today_expected_cents += cents }
    if (key >= weekStart && key <= weekEnd) out.week_count++
    if (inMonth) {
      // Previsto = o que já entrou + o que ainda está marcado
      out.month_expected_cents += a.status === 'completed' ? got : cents
      if (a.status === 'completed') out.month_count++
    }
  }

  const unmarkedList = (unmarked.data || []).filter((a) => endOf(a) <= nowMs).map(shape)
  const pendingList = (pending.data || []).map(shape)
  out.unmarked_past = unmarkedList.length
  out.unmarked_list = unmarkedList.slice(0, 15)
  out.pending_deposits = pendingList.filter((a) => (a.deposit_cents || 0) > 0 && !a.deposit_paid).length
  out.pending_list = pendingList

  let nextApt = shape(next.data?.[0] || null)
  if (nextApt?.client_id) {
    const { data: c } = await supabase.from('ag_clients').select('language, address_line, city')
      .eq('id', nextApt.client_id).eq('provider_id', pid).maybeSingle()
    nextApt = { ...nextApt, client_language: ['pt', 'en', 'es'].includes(c?.language) ? c.language : 'pt', client_address: [c?.address_line, c?.city].filter(Boolean).join(', ') || null }
  }
  out.next_appointment = nextApt

  out.setup = {
    services: svc.error ? null : (svc.count || 0),
    hours: hrs.error ? null : (hrs.count || 0),
    has_online_booking: online.error ? null : (online.count || 0) > 0,
  }
  return res.status(200).json(out)
}
