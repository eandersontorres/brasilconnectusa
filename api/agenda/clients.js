/**
 * Clientes da profissional (CRM do app AgendaPro).
 *
 * GET  /api/agenda/clients   com JWT
 *      ?q=        busca por nome, WhatsApp ou e-mail
 *      ?filter=   all (padrao) | inactive (sumidas, recurso 'reactivation') | birthday | archived
 *      ?sort=     recent (ultima visita) | name | top (quem mais gastou)
 *      ?days=     sumidas: dias sem vir (padrao app_settings.reactivation_days ou 45)
 *      ?window=   aniversariantes: proximos N dias (padrao 30)
 *      ?limit=    ate 500
 *      → { clients: [...], total, truncated, days?, window? }
 * GET  /api/agenda/clients?id=UUID
 *      → { client, appointments: [...ultimos 50], stats: { visits, spent_cents,
 *          avg_ticket_cents, no_shows, cancellations, next_appointment, ... } }
 * POST /api/agenda/clients   com JWT (recurso 'clients' do plano)
 *      Body: { action, ... }
 *        create     { name, whatsapp?, email?, language?, birthday_md?, tags?, address_line?,
 *                     city?, state?, zip?, home_notes?, notes? }
 *        update     { id, ...mesmos campos }   so as chaves enviadas mudam
 *        archive    { id }  ·  unarchive { id }
 *        delete     { id }  com horario marcado → arquiva em vez de excluir
 *
 * WhatsApp gravado sempre como '+' + digitos (normalizePhone): 10 digitos = EUA.
 * Numeros da cliente (visitas, gasto, ultima visita) vem da agenda pela funcao
 * ag_client_activity (supabase/ag_app_clients.sql): visita = realizado, ou
 * confirmado com horario ja passado. Sem a funcao, usa os totais da ficha.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'
import { normalizePhone } from '../_lib/phone.js'

export const CLIENT_COLS = 'id, name, whatsapp, email, language, birthday_md, tags, address_line, city, state, zip, home_notes, notes, total_visits, total_spent_cents, first_visit_at, last_visit_at, archived, created_at, updated_at'

const LANGS = ['pt', 'en', 'es']
const FILTERS = ['all', 'inactive', 'birthday', 'archived']
const SORTS = ['recent', 'name', 'top']
const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86400e3
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const VISIT = (a, now) => a.status === 'completed' || (a.status === 'confirmed' && Date.parse(a.scheduled_for) < now)

const int = (v, min, max, def) => {
  const n = Math.round(Number(v))
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

// ── Funcoes puras (exportadas pra outras rotas e testes) ───────────────────

export { normalizePhone }

/** Agora no relogio da profissional, no formato de parede ('...T10:00:00.000Z'). */
export function wallNowIso(tz = 'America/New_York', now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now)
    const g = (t) => parts.find((p) => p.type === t)?.value
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:00.000Z`
  } catch (_) {
    return now.toISOString()
  }
}

const addDaysKey = (key, n) => {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diffDays = (fromKey, toKey) => Math.round((Date.parse(toKey + 'T12:00:00Z') - Date.parse(fromKey + 'T12:00:00Z')) / DAY_MS)

/** 'MM-DD' valido (29/02 aceito) → 'MM-DD'; vazio → null; invalido → false. So hifen: '05/10' seria ambiguo. */
export function parseBirthday(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})-(\d{1,2})$/)
  if (!m) return false
  const mm = Number(m[1]), dd = Number(m[2])
  if (mm < 1 || mm > 12 || dd < 1 || dd > MONTH_DAYS[mm - 1]) return false
  return `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** Dias ate o proximo aniversario ('MM-DD') a partir de 'YYYY-MM-DD' (0 = hoje). 29/02 vira 01/03 em ano comum. */
export function daysUntilBirthday(md, todayKey) {
  if (!md || !todayKey) return null
  const year = Number(todayKey.slice(0, 4))
  const at = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    return md === '02-29' && !leap ? `${y}-03-01` : `${y}-${md}`
  }
  let next = at(year)
  if (next < todayKey) next = at(year + 1)
  return diffDays(todayKey, next)
}

/** Etiquetas: lista ou texto com virgulas → ate 12, sem repetir (ignora maiusculas). */
export function normalizeTags(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',')
  const out = []
  const seen = new Set()
  for (const t of list) {
    const tag = String(t ?? '').replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)
    const k = tag.toLowerCase()
    if (!tag || seen.has(k)) continue
    seen.add(k)
    out.push(tag)
    if (out.length >= 12) break
  }
  return out
}

/** Estatisticas da ficha a partir dos agendamentos da cliente (mesma regra da funcao SQL). */
export function computeStats(apts, nowWall) {
  const now = Date.parse(nowWall)
  const visits = apts.filter((a) => VISIT(a, now))
  const spent = visits.reduce((s, a) => s + (Number(a.total_cents) || 0), 0)
  const tips = visits.reduce((s, a) => s + (Number(a.tip_cents) || 0), 0)
  const upcoming = apts
    .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && Date.parse(a.scheduled_for) >= now)
    .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for))

  // Ritmo: mediana do intervalo entre visitas (dias distintos)
  const days = [...new Set(visits.map((a) => String(a.scheduled_for).slice(0, 10)))].sort()
  let every = null
  let expected = null
  if (days.length >= 2) {
    const gaps = []
    for (let i = 1; i < days.length; i++) gaps.push(diffDays(days[i - 1], days[i]))
    gaps.sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    every = gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2)
    if (every > 0) expected = addDaysKey(days[days.length - 1], every)
    else every = null
  }

  const count = {}
  for (const a of visits) {
    const n = serviceName(a)
    if (n) count[n] = (count[n] || 0) + 1
  }
  const favorite = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const next = upcoming[0] || null

  return {
    visits: visits.length,
    spent_cents: spent,
    avg_ticket_cents: visits.length ? Math.round(spent / visits.length) : 0,
    tips_cents: tips,
    no_shows: apts.filter((a) => a.status === 'no_show').length,
    cancellations: apts.filter((a) => a.status === 'canceled').length,
    next_appointment: next ? { id: next.id, scheduled_for: next.scheduled_for, status: next.status, service_name: serviceName(next) } : null,
    first_visit_at: days.length ? visits.reduce((m, a) => (!m || a.scheduled_for < m ? a.scheduled_for : m), null) : null,
    last_visit_at: days.length ? visits.reduce((m, a) => (!m || a.scheduled_for > m ? a.scheduled_for : m), null) : null,
    return_every_days: every,
    expected_return: expected,
    favorite_service: favorite,
  }
}

function serviceName(a) {
  return a.ag_services?.name || a.service_name || a.service_label || (a.ag_ical_feeds?.label ? `Limpeza · ${a.ag_ical_feeds.label}` : null)
}

// ── Leitura ──────────────────────────────────────────────────────────────

const EMPTY_ACT = { visits: 0, spent_cents: 0, first_visit_at: null, last_visit_at: null, next_at: null, no_shows: 0, cancellations: 0 }

function shapeClient(c, act, nowWall) {
  const visits = act ? act.visits : (c.total_visits || 0)
  const spent = act ? Number(act.spent_cents) || 0 : (c.total_spent_cents || 0)
  const last = act ? act.last_visit_at : c.last_visit_at
  return {
    id: c.id,
    name: c.name,
    whatsapp: c.whatsapp || null,
    email: c.email || null,
    language: LANGS.includes(c.language) ? c.language : 'pt',
    birthday_md: c.birthday_md || null,
    tags: Array.isArray(c.tags) ? c.tags : [],
    address_line: c.address_line || null,
    city: c.city || null,
    state: c.state || null,
    zip: c.zip || null,
    home_notes: c.home_notes || null,
    notes: c.notes || null,
    total_visits: visits,
    total_spent_cents: spent,
    avg_ticket_cents: visits ? Math.round(spent / visits) : 0,
    first_visit_at: act ? act.first_visit_at : c.first_visit_at,
    last_visit_at: last || null,
    days_since_visit: last ? Math.max(0, Math.floor((Date.parse(nowWall) - Date.parse(last)) / DAY_MS)) : null,
    next_appointment_at: act ? act.next_at : null,
    no_shows: act ? act.no_shows : 0,
    archived: !!c.archived,
    created_at: c.created_at,
    updated_at: c.updated_at || null,
  }
}

function shapeAppointment(a) {
  return {
    id: a.id,
    scheduled_for: a.scheduled_for,
    duration_min: a.duration_min,
    status: a.status,
    service_id: a.service_id || null,
    service_name: serviceName(a),
    total_cents: a.total_cents || 0,
    deposit_cents: a.deposit_cents || 0,
    deposit_paid: !!a.deposit_paid,
    paid_cents: a.paid_cents ?? null,
    tip_cents: a.tip_cents ?? null,
    paid_method: a.paid_method || a.payment_method || null,
    client_notes: a.client_notes || null,
    internal_notes: a.internal_notes || null,
    staff_id: a.staff_id || null,
    recurring_id: a.recurring_id || null,
    source: a.source || (a.external_uid ? 'ical' : null),
    cancel_reason: a.cancel_reason || null,
  }
}

/** Atividade (visitas, gasto, proximo horario) de cada cliente. null = funcao indisponivel. */
async function loadActivity(supabase, providerId, nowWall, { ids = null, goneBefore = null } = {}) {
  if (ids && !ids.length) return new Map()
  const { data, error } = await supabase.rpc('ag_client_activity', {
    p_provider_id: providerId,
    p_now: nowWall,
    p_client_ids: ids,
    p_gone_before: goneBefore,
  })
  if (error) {
    console.error('ag_client_activity:', error.message)
    return null
  }
  return new Map((data || []).map((r) => [r.client_id, r]))
}

/** Busca segura pro filtro .or() do PostgREST (sem virgula, parenteses, curinga). */
function cleanQuery(q) {
  return String(q ?? '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}
function orFilter(q) {
  const parts = [`name.ilike.%${q}%`, `email.ilike.%${q}%`]
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 3) parts.push(`whatsapp.ilike.%${digits}%`)
  return parts.join(',')
}

async function fetchByIds(supabase, providerId, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('ag_clients').select(CLIENT_COLS)
      .eq('provider_id', providerId).eq('archived', false).in('id', ids.slice(i, i + 150))
    if (error) throw new Error(error.message)
    out.push(...(data || []))
  }
  return out
}

function sortClients(list, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  if (sort === 'name') return list.sort(byName)
  if (sort === 'top') return list.sort((a, b) => (b.total_spent_cents - a.total_spent_cents) || (b.total_visits - a.total_visits) || byName(a, b))
  // recent: ultima visita mais nova primeiro; quem nunca veio vai pro fim (cadastro mais novo antes)
  return list.sort((a, b) => {
    if (a.last_visit_at && b.last_visit_at) return Date.parse(b.last_visit_at) - Date.parse(a.last_visit_at)
    if (a.last_visit_at) return -1
    if (b.last_visit_at) return 1
    return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
  })
}

async function listClients(req, res, supabase, provider, nowWall) {
  const pid = provider.id
  const filter = FILTERS.includes(req.query.filter) ? req.query.filter : 'all'
  const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'recent'
  const limit = int(req.query.limit, 1, 500, 500)
  const q = cleanQuery(req.query.q)

  // Sumidas: quem nao vem ha X dias e nao tem horario marcado (Pro)
  if (filter === 'inactive') {
    const gate = requireFeature(provider, 'reactivation')
    if (!gate.ok) return res.status(gate.status).json(gate.body)
    const days = int(req.query.days, 14, 365, int(provider.app_settings?.reactivation_days, 14, 365, 45))
    const goneBefore = new Date(Date.parse(nowWall) - days * DAY_MS).toISOString()

    const act = await loadActivity(supabase, pid, nowWall, { goneBefore })
    let rows
    if (act) {
      rows = await fetchByIds(supabase, pid, [...act.keys()].slice(0, 1500))
    } else {
      // Sem a funcao SQL: totais guardados na ficha
      const { data, error } = await supabase.from('ag_clients').select(CLIENT_COLS)
        .eq('provider_id', pid).eq('archived', false).lt('last_visit_at', goneBefore).limit(1000)
      if (error) return res.status(500).json({ error: error.message })
      rows = data || []
    }
    let clients = rows.map((c) => shapeClient(c, act ? act.get(c.id) || EMPTY_ACT : null, nowWall))
    if (q) {
      const fq = q.toLowerCase()
      const digits = q.replace(/\D/g, '')
      clients = clients.filter((c) => c.name.toLowerCase().includes(fq) || (c.email || '').includes(fq) || (digits.length >= 3 && (c.whatsapp || '').includes(digits)))
    }
    clients = sortClients(clients, sort).slice(0, limit)
    return res.status(200).json({ clients, total: clients.length, truncated: rows.length > limit, days })
  }

  let query = supabase.from('ag_clients').select(CLIENT_COLS)
    .eq('provider_id', pid).eq('archived', filter === 'archived')
  if (filter === 'birthday') query = query.not('birthday_md', 'is', null)
  if (q) query = query.or(orFilter(q))
  if (sort === 'name') query = query.order('name', { ascending: true })
  else if (sort === 'top') query = query.order('total_spent_cents', { ascending: false, nullsFirst: false })
  else query = query.order('last_visit_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  const { data, error } = await query.limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  const rows = data || []

  const act = await loadActivity(supabase, pid, nowWall, { ids: rows.map((c) => c.id) })
  let clients = rows.map((c) => shapeClient(c, act ? act.get(c.id) || EMPTY_ACT : null, nowWall))

  if (filter === 'birthday') {
    const windowDays = int(req.query.window, 1, 366, 30)
    const today = nowWall.slice(0, 10)
    clients = clients
      .map((c) => ({ ...c, birthday_in_days: daysUntilBirthday(c.birthday_md, today) }))
      .filter((c) => c.birthday_in_days != null && c.birthday_in_days <= windowDays)
      .sort((a, b) => a.birthday_in_days - b.birthday_in_days || a.name.localeCompare(b.name, 'pt-BR'))
    return res.status(200).json({ clients, total: clients.length, truncated: rows.length >= limit, window: windowDays })
  }

  clients = sortClients(clients, sort)
  return res.status(200).json({ clients, total: clients.length, truncated: rows.length >= limit })
}

async function getClient(req, res, supabase, provider, nowWall) {
  const id = String(req.query.id || '')
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cliente inválida' })

  const { data: c, error } = await supabase.from('ag_clients').select(CLIENT_COLS)
    .eq('id', id).eq('provider_id', provider.id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!c) return res.status(404).json({ error: 'Cliente não encontrada' })

  const { data: apts, error: aErr } = await supabase.from('ag_appointments')
    .select('*, ag_services(name), ag_ical_feeds(label)')
    .eq('provider_id', provider.id).eq('client_id', id)
    .order('scheduled_for', { ascending: false })
    .limit(1000)
  if (aErr) return res.status(500).json({ error: aErr.message })

  const list = apts || []
  const stats = computeStats(list, nowWall)
  const act = {
    visits: stats.visits, spent_cents: stats.spent_cents, first_visit_at: stats.first_visit_at,
    last_visit_at: stats.last_visit_at, next_at: stats.next_appointment?.scheduled_for || null,
    no_shows: stats.no_shows, cancellations: stats.cancellations,
  }
  return res.status(200).json({
    client: shapeClient(c, act, nowWall),
    appointments: list.slice(0, 50).map(shapeAppointment),
    stats,
  })
}

// ── Escrita ──────────────────────────────────────────────────────────────

/** Campos editaveis. Em `partial`, so o que veio no body. */
function readFields(b, partial) {
  const out = {}
  const has = (k) => !partial || b[k] !== undefined

  if (has('name')) {
    const name = clip(b.name, 120)
    if (!name) return { error: 'Diga o nome da cliente' }
    out.name = name.replace(/\s+/g, ' ')
  }
  if (has('whatsapp')) {
    const raw = clip(b.whatsapp, 40)
    if (!raw) out.whatsapp = null
    else {
      const n = normalizePhone(raw)
      if (!n) return { error: 'WhatsApp inválido. Use o número com DDD, ex.: (512) 555-0101. Do Brasil: +55 11 98765-4321' }
      out.whatsapp = n
    }
  }
  if (has('email')) {
    const e = clip(b.email, 254)?.toLowerCase() || null
    if (e && !EMAIL_RE.test(e)) return { error: 'E-mail inválido' }
    out.email = e
  }
  if (has('language')) out.language = LANGS.includes(b.language) ? b.language : 'pt'
  if (has('birthday_md')) {
    const bd = parseBirthday(b.birthday_md)
    if (bd === false) return { error: 'Aniversário inválido. Use dia e mês, ex.: 14/10' }
    out.birthday_md = bd
  }
  if (has('tags')) out.tags = normalizeTags(b.tags)
  if (has('address_line')) out.address_line = clip(b.address_line, 200)
  if (has('city')) out.city = clip(b.city, 80)
  if (has('state')) {
    const st = clip(b.state, 30)
    out.state = st && st.length <= 3 ? st.toUpperCase() : st
  }
  if (has('zip')) {
    const z = clip(b.zip, 12)
    if (z && !/^[0-9A-Za-z -]{3,12}$/.test(z)) return { error: 'ZIP code inválido' }
    out.zip = z
  }
  if (has('home_notes')) out.home_notes = clip(b.home_notes, 1000)
  if (has('notes')) out.notes = clip(b.notes, 2000)
  return { fields: out }
}

async function findByWhatsapp(supabase, providerId, whatsapp, exceptId = null) {
  let q = supabase.from('ag_clients').select('id, name, archived').eq('provider_id', providerId).eq('whatsapp', whatsapp)
  if (exceptId) q = q.neq('id', exceptId)
  const { data } = await q.limit(1)
  return data?.[0] || null
}

function duplicateReply(res, dup) {
  return res.status(409).json({
    error: `Já existe uma cliente com esse WhatsApp: ${dup.name}${dup.archived ? ' (arquivada)' : ''}.`,
    code: 'duplicate',
    client_id: dup.id,
  })
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
    const nowWall = wallNowIso(provider.timezone)
    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      if (req.query.id) return await getClient(req, res, supabase, provider, nowWall)
      return await listClients(req, res, supabase, provider, nowWall)
    }

    const body = req.body || {}
    const action = body.action

    // Toda escrita: plano com o recurso de clientes (plano inativo = so leitura)
    const gate = requireFeature(provider, 'clients')
    if (!gate.ok) return res.status(gate.status).json(gate.body)

    if (action === 'create') {
      const read = readFields(body, false)
      if (read.error) return res.status(400).json({ error: read.error })
      if (read.fields.whatsapp) {
        const dup = await findByWhatsapp(supabase, pid, read.fields.whatsapp)
        if (dup) return duplicateReply(res, dup)
      }
      const { data, error } = await supabase.from('ag_clients')
        .insert({ provider_id: pid, ...read.fields, updated_at: new Date().toISOString() })
        .select(CLIENT_COLS).single()
      if (error) {
        if (error.code === '23505') {
          const dup = await findByWhatsapp(supabase, pid, read.fields.whatsapp)
          if (dup) return duplicateReply(res, dup)
          return res.status(409).json({ error: 'Já existe uma cliente com esse WhatsApp.', code: 'duplicate' })
        }
        return res.status(500).json({ error: error.message })
      }
      return res.status(201).json({ ok: true, client: shapeClient(data, null, nowWall) })
    }

    // Demais acoes: cliente minha
    const id = String(body.id || '')
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cliente inválida' })
    const { data: current } = await supabase.from('ag_clients').select(CLIENT_COLS)
      .eq('id', id).eq('provider_id', pid).maybeSingle()
    if (!current) return res.status(404).json({ error: 'Cliente não encontrada' })

    if (action === 'update') {
      const read = readFields(body, true)
      if (read.error) return res.status(400).json({ error: read.error })
      const f = read.fields
      if (!Object.keys(f).length) return res.status(400).json({ error: 'Nada pra salvar' })
      if (f.whatsapp && f.whatsapp !== current.whatsapp) {
        const dup = await findByWhatsapp(supabase, pid, f.whatsapp, id)
        if (dup) return duplicateReply(res, dup)
      }
      const { data, error } = await supabase.from('ag_clients')
        .update({ ...f, updated_at: new Date().toISOString() })
        .eq('id', id).eq('provider_id', pid).select(CLIENT_COLS).single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Já existe uma cliente com esse WhatsApp.', code: 'duplicate' })
        return res.status(500).json({ error: error.message })
      }

      // Nome/contato novos valem pros horarios marcados (lembrete sai pro numero certo)
      const apt = {}
      if (f.name !== undefined && f.name !== current.name) apt.client_name = f.name
      if (f.whatsapp !== undefined && f.whatsapp !== current.whatsapp) apt.client_whatsapp = f.whatsapp
      if (f.email !== undefined && f.email !== current.email) apt.client_email = f.email
      if (Object.keys(apt).length) {
        const since = new Date(Date.parse(nowWall) - 12 * 3600e3).toISOString()
        const u = await supabase.from('ag_appointments').update(apt)
          .eq('provider_id', pid).eq('client_id', id).in('status', ['pending', 'confirmed']).gte('scheduled_for', since)
        if (u.error) console.error('clients update → appointments:', u.error.message)
      }
      return res.status(200).json({ ok: true, client: shapeClient(data, null, nowWall) })
    }

    if (action === 'archive' || action === 'unarchive') {
      const { data, error } = await supabase.from('ag_clients')
        .update({ archived: action === 'archive', updated_at: new Date().toISOString() })
        .eq('id', id).eq('provider_id', pid).select(CLIENT_COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, client: shapeClient(data, null, nowWall) })
    }

    if (action === 'delete') {
      const archiveInstead = async (message) => {
        const { data, error } = await supabase.from('ag_clients')
          .update({ archived: true, updated_at: new Date().toISOString() })
          .eq('id', id).eq('provider_id', pid).select(CLIENT_COLS).single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ ok: true, archived: true, message, client: shapeClient(data, null, nowWall) })
      }

      // Com horario marcado, nao exclui: arquiva
      const { count } = await supabase.from('ag_appointments').select('id', { count: 'exact', head: true })
        .eq('provider_id', pid).eq('client_id', id).in('status', ['pending', 'confirmed']).gte('scheduled_for', nowWall)
      if ((count || 0) > 0) {
        return archiveInstead('Ela tem horário marcado, então arquivamos a ficha em vez de excluir. O histórico continua salvo.')
      }

      let del = await supabase.from('ag_clients').delete().eq('id', id).eq('provider_id', pid)
      if (del.error && del.error.code === '23503') {
        // Atendimentos antigos apontam pra ficha: ficam na agenda sem o vinculo (o nome continua)
        const { data: linked } = await supabase.from('ag_appointments').select('id')
          .eq('provider_id', pid).eq('client_id', id).limit(5000)
        const linkedIds = (linked || []).map((r) => r.id)
        const un = await supabase.from('ag_appointments').update({ client_id: null }).eq('provider_id', pid).eq('client_id', id)
        if (un.error) return res.status(500).json({ error: un.error.message })
        del = await supabase.from('ag_clients').delete().eq('id', id).eq('provider_id', pid)
        if (del.error) {
          // Outra tabela ainda usa a ficha (ex.: cliente fixa): devolve o vinculo e arquiva
          for (let i = 0; i < linkedIds.length; i += 150) {
            await supabase.from('ag_appointments').update({ client_id: id }).eq('provider_id', pid).in('id', linkedIds.slice(i, i + 150))
          }
          return archiveInstead('Essa ficha ainda está ligada a outros registros (como cliente fixa), então arquivamos em vez de excluir.')
        }
      }
      if (del.error) return res.status(500).json({ error: del.error.message })
      return res.status(200).json({ ok: true, deleted: true })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
