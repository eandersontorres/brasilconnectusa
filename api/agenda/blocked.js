/**
 * Folgas, ferias e horarios bloqueados da profissional (tabela ag_blocked_dates).
 *
 * GET  /api/agenda/blocked   com JWT: bloqueios de 30 dias atras em diante, por data
 *      → { blocks: [{ id, date, full_day, start_time, end_time, reason, appointments_count }] }
 *        appointments_count = agendamentos ativos que caem no bloqueio (pra remarcar)
 * POST /api/agenda/blocked   com JWT
 *      { action: 'create', date, date_to?, full_day, start_time?, end_time?, reason? }
 *        um dia ou ferias de/ate (ate 60 dias: uma linha por dia). Recurso 'hours'.
 *        Dia inteiro em cima de bloqueios parciais do dia substitui os parciais.
 *        → { ok, created, updated, skipped, conflicts: { count, dates, first_date }, blocks }
 *      { action: 'delete', id } ou { action: 'delete', ids: [...] }   (ferias inteiras de uma vez)
 *
 * Datas e horas sao "de parede" (relogio da profissional), como scheduled_for.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RANGE_DAYS = 60
const COLS = 'id, date, full_day, start_time, end_time, reason, created_at'
const ACTIVE = ['pending', 'confirmed']

// ── Datas 'YYYY-MM-DD' ────────────────────────────────────────────────────
const validKey = (k) => DATE.test(k) && !Number.isNaN(new Date(k + 'T12:00:00Z').getTime()) && new Date(k + 'T12:00:00Z').toISOString().slice(0, 10) === k
function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400e3)

/** Hoje no fuso da profissional (cai pro UTC se o fuso for invalido). */
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch (_) {
    return new Date().toISOString().slice(0, 10)
  }
}

const hhmm = (t) => (t == null ? null : String(t).slice(0, 5))
const minutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }

function publicBlock(b) {
  return { id: b.id, date: b.date, full_day: b.full_day !== false, start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), reason: b.reason || null }
}

/**
 * Quantos agendamentos ativos caem em cada bloqueio.
 * Devolve { [blockId]: n } e a lista de datas com conflito.
 */
async function conflictsFor(supabase, providerId, blocks) {
  const out = { byBlock: {}, dates: [], count: 0 }
  if (!blocks.length) return out
  const keys = blocks.map(b => b.date).sort()
  const { data, error } = await supabase.from('ag_appointments')
    .select('id, scheduled_for, duration_min')
    .eq('provider_id', providerId)
    .in('status', ACTIVE)
    .gte('scheduled_for', `${keys[0]}T00:00:00.000Z`)
    .lte('scheduled_for', `${keys[keys.length - 1]}T23:59:59.999Z`)
    .limit(3000)
  if (error) throw new Error(error.message)

  const byDate = {}
  for (const a of data || []) {
    const d = new Date(a.scheduled_for)
    if (Number.isNaN(d.getTime())) continue
    const key = String(a.scheduled_for).slice(0, 10)
    const start = d.getUTCHours() * 60 + d.getUTCMinutes()
    ;(byDate[key] = byDate[key] || []).push({ id: a.id, start, end: start + (Number(a.duration_min) || 60) })
  }

  const hit = new Set()
  const dates = new Set()
  for (const b of blocks) {
    const list = byDate[b.date] || []
    let n = 0
    for (const a of list) {
      const overlaps = b.full_day !== false || (a.start < minutes(hhmm(b.end_time)) && a.end > minutes(hhmm(b.start_time)))
      if (overlaps) { n++; hit.add(a.id); dates.add(b.date) }
    }
    out.byBlock[b.id] = n
  }
  out.count = hit.size
  out.dates = [...dates].sort()
  return out
}

async function listBlocks(supabase, provider) {
  const from = addDays(todayIn(provider.timezone), -30)
  const { data, error } = await supabase.from('ag_blocked_dates').select(COLS)
    .eq('provider_id', provider.id)
    .gte('date', from)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
    .limit(1000)
  if (error) throw new Error(error.message)
  const blocks = (data || []).map(publicBlock)
  // Conflito so interessa daqui pra frente
  const today = todayIn(provider.timezone)
  const upcoming = blocks.filter(b => b.date >= today)
  const c = await conflictsFor(supabase, provider.id, upcoming)
  return blocks.map(b => ({ ...b, appointments_count: c.byBlock[b.id] || 0 }))
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      return res.status(200).json({ blocks: await listBlocks(supabase, provider) })
    }

    const body = req.body || {}
    const action = body.action

    if (action === 'create') {
      const gate = requireFeature(provider, 'hours')
      if (!gate.ok) return res.status(gate.status).json(gate.body)

      const date = String(body.date || '').slice(0, 10)
      const dateTo = body.date_to ? String(body.date_to).slice(0, 10) : date
      if (!validKey(date)) return res.status(400).json({ error: 'Data inválida. Use AAAA-MM-DD' })
      if (!validKey(dateTo)) return res.status(400).json({ error: 'Data final inválida. Use AAAA-MM-DD' })
      if (dateTo < date) return res.status(400).json({ error: 'A data final precisa ser depois da inicial' })
      const span = daysBetween(date, dateTo) + 1
      if (span > MAX_RANGE_DAYS) return res.status(400).json({ error: `No máximo ${MAX_RANGE_DAYS} dias de uma vez. Divida em duas partes.` })

      const today = todayIn(provider.timezone)
      if (dateTo < addDays(today, -1)) return res.status(400).json({ error: 'Essa data já passou' })
      if (date > addDays(today, 730)) return res.status(400).json({ error: 'Data muito distante (até 2 anos)' })

      const fullDay = body.full_day !== false
      let start = null
      let end = null
      if (!fullDay) {
        start = String(body.start_time || '').slice(0, 5)
        end = String(body.end_time || '').slice(0, 5)
        if (!HHMM.test(start) || !HHMM.test(end)) return res.status(400).json({ error: 'Horário inválido. Use HH:MM' })
        if (start >= end) return res.status(400).json({ error: 'O início precisa ser antes do fim' })
      }
      const reason = body.reason == null ? null : (String(body.reason).trim().slice(0, 120) || null)

      // Dias do intervalo (o que ja passou fica de fora)
      const days = []
      for (let i = 0; i < span; i++) {
        const k = addDays(date, i)
        if (k >= addDays(today, -1)) days.push(k)
      }

      const { data: existing, error: exErr } = await supabase.from('ag_blocked_dates').select(COLS)
        .eq('provider_id', provider.id).gte('date', days[0]).lte('date', days[days.length - 1])
      if (exErr) return res.status(500).json({ error: exErr.message })
      const byDate = {}
      for (const b of existing || []) (byDate[b.date] = byDate[b.date] || []).push(b)

      const inserts = []
      const updates = []
      const removeIds = []
      let skipped = 0
      for (const k of days) {
        const list = byDate[k] || []
        const full = list.find(b => b.full_day !== false)
        if (fullDay) {
          if (full) {
            // Ja estava bloqueado: so atualiza o motivo
            if (reason && reason !== full.reason) updates.push({ id: full.id, patch: { reason } })
            else skipped++
            removeIds.push(...list.filter(b => b.id !== full.id).map(b => b.id))
            continue
          }
          removeIds.push(...list.map(b => b.id))   // dia inteiro cobre os parciais
          inserts.push({ provider_id: provider.id, date: k, full_day: true, start_time: null, end_time: null, reason })
        } else {
          if (full) { skipped++; continue }         // o dia inteiro ja esta bloqueado
          const same = list.find(b => hhmm(b.start_time) === start)
          if (same) updates.push({ id: same.id, patch: { end_time: end, reason } })
          else inserts.push({ provider_id: provider.id, date: k, full_day: false, start_time: start, end_time: end, reason })
        }
      }

      if (removeIds.length) {
        const del = await supabase.from('ag_blocked_dates').delete().eq('provider_id', provider.id).in('id', removeIds)
        if (del.error) return res.status(500).json({ error: del.error.message })
      }
      for (const u of updates) {
        const up = await supabase.from('ag_blocked_dates').update(u.patch).eq('id', u.id).eq('provider_id', provider.id)
        if (up.error) return res.status(500).json({ error: up.error.message })
      }
      let created = []
      if (inserts.length) {
        const ins = await supabase.from('ag_blocked_dates').insert(inserts).select(COLS)
        if (ins.error) {
          if (ins.error.code === '23505') return res.status(409).json({ error: 'Esse bloqueio já existe' })
          return res.status(500).json({ error: ins.error.message })
        }
        created = ins.data || []
      }

      // Agendamentos que caem no periodo bloqueado (pra avisar e remarcar)
      const probe = days.map((k, i) => ({ id: 'd' + i, date: k, full_day: fullDay, start_time: start, end_time: end }))
      const c = await conflictsFor(supabase, provider.id, probe.filter(p => p.date >= today))

      return res.status(201).json({
        ok: true,
        created: created.length,
        updated: updates.length,
        skipped,
        conflicts: { count: c.count, dates: c.dates, first_date: c.dates[0] || null },
        blocks: await listBlocks(supabase, provider),
      })
    }

    if (action === 'delete') {
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(v => String(v || '')).filter(v => UUID.test(v)).slice(0, MAX_RANGE_DAYS + 10)
      if (ids.length === 0) return res.status(400).json({ error: 'id inválido' })
      const { data, error } = await supabase.from('ag_blocked_dates').delete()
        .eq('provider_id', provider.id).in('id', ids).select('id')
      if (error) return res.status(500).json({ error: error.message })
      if (!data || data.length === 0) return res.status(404).json({ error: 'Bloqueio não encontrado' })
      return res.status(200).json({ ok: true, deleted: data.length })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
