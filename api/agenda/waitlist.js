/**
 * Lista de espera da profissional (tabela ag_waitlist, recurso 'waitlist' do plano Pro).
 *
 * GET  /api/agenda/waitlist   com JWT
 *      ?status=  waiting (padrao) | active (esperando + avisadas) | notified | booked | removed | all
 *      ?count=1  so o numero de quem ainda espera (waiting + notified) → { count }
 *      → { entries: [...] }  mais antigas primeiro (quem chegou antes, ganha antes)
 * POST /api/agenda/waitlist   com JWT
 *      Body: { action, ... }
 *        create  { client_id? | client_name + client_whatsapp?, service_id?, preferred_days?: [0-6],
 *                  preferred_period?: manha|tarde|noite|qualquer, date_from?, date_to?, notes? }
 *        update  { id, ...mesmos campos, status?: waiting|notified|booked|removed }
 *        delete  { id }
 *        match   { date: 'YYYY-MM-DD', time?: 'HH:MM' }
 *                quem ainda espera e combina com o dia da semana, o periodo e o prazo
 *
 * Criar, editar e excluir exigem o plano com lista de espera. Ler e combinar, nao.
 * Periodos: manha antes de 12:00, tarde 12:00–17:59, noite a partir de 18:00.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'
import { normalizePhone, wallNowIso } from './clients.js'

const COLS = 'id, client_id, client_name, client_whatsapp, service_id, preferred_days, preferred_period, date_from, date_to, notes, status, notified_at, created_at, updated_at, ag_services(name), ag_clients(name, whatsapp, language)'
const PERIODS = ['manha', 'tarde', 'noite', 'qualquer']
const STATUSES = ['waiting', 'notified', 'booked', 'removed']
const ACTIVE = ['waiting', 'notified']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const MAX_ACTIVE = 300

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
const validDate = (s) => DATE_RE.test(s) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s

// ── Funcoes puras (exportadas pra testes) ──────────────────────────────────

/** 'HH:MM' → 'manha' | 'tarde' | 'noite'. */
export function periodOf(hhmm) {
  const h = Number(String(hhmm).slice(0, 2))
  if (h < 12) return 'manha'
  if (h < 18) return 'tarde'
  return 'noite'
}

/** Dias da semana: lista de 0–6, sem repetir, em ordem. */
export function normalizeDays(v) {
  const list = Array.isArray(v) ? v : []
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
}

/** A entrada combina com o horario que abriu? (dia da semana, periodo e prazo) */
export function matchesSlot(entry, dateKey, hhmm) {
  const wd = new Date(dateKey + 'T12:00:00Z').getUTCDay()
  const days = Array.isArray(entry.preferred_days) ? entry.preferred_days : []
  if (days.length && !days.includes(wd)) return false
  if (hhmm && entry.preferred_period && entry.preferred_period !== 'qualquer' && entry.preferred_period !== periodOf(hhmm)) return false
  if (entry.date_from && dateKey < String(entry.date_from).slice(0, 10)) return false
  if (entry.date_to && dateKey > String(entry.date_to).slice(0, 10)) return false
  return true
}

function shape(e, todayKey) {
  const linked = e.ag_clients || null
  return {
    id: e.id,
    client_id: e.client_id || null,
    client_name: linked?.name || e.client_name,
    client_whatsapp: linked?.whatsapp || e.client_whatsapp || null,
    client_language: linked?.language || 'pt',
    service_id: e.service_id || null,
    service_name: e.ag_services?.name || null,
    preferred_days: normalizeDays(e.preferred_days),
    preferred_period: PERIODS.includes(e.preferred_period) ? e.preferred_period : 'qualquer',
    date_from: e.date_from || null,
    date_to: e.date_to || null,
    notes: e.notes || null,
    status: e.status,
    notified_at: e.notified_at || null,
    created_at: e.created_at,
    updated_at: e.updated_at || null,
    expired: !!(e.date_to && String(e.date_to).slice(0, 10) < todayKey),
  }
}

/** Campos editaveis. Em `partial`, so o que veio no body. */
function readFields(b, partial) {
  const out = {}
  const has = (k) => !partial || b[k] !== undefined

  if (has('client_name')) out.client_name = clip(b.client_name, 120)?.replace(/\s+/g, ' ') || null
  if (has('client_whatsapp')) {
    const raw = clip(b.client_whatsapp, 40)
    if (!raw) out.client_whatsapp = null
    else {
      const n = normalizePhone(raw)
      if (!n) return { error: 'WhatsApp inválido. Use o número com DDD, ex.: (512) 555-0101' }
      out.client_whatsapp = n
    }
  }
  if (has('preferred_days')) out.preferred_days = normalizeDays(b.preferred_days)
  if (has('preferred_period')) out.preferred_period = PERIODS.includes(b.preferred_period) ? b.preferred_period : 'qualquer'
  for (const k of ['date_from', 'date_to']) {
    if (!has(k)) continue
    const s = clip(b[k], 10)
    if (s && !validDate(s)) return { error: 'Data inválida. Use AAAA-MM-DD' }
    out[k] = s
  }
  if (has('notes')) out.notes = clip(b.notes, 500)
  return { fields: out }
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
    const todayKey = wallNowIso(provider.timezone).slice(0, 10)
    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      if (req.query.count) {
        const { count, error } = await supabase.from('ag_waitlist').select('id', { count: 'exact', head: true })
          .eq('provider_id', pid).in('status', ACTIVE)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ count: count || 0 })
      }
      const st = String(req.query.status || 'waiting')
      let q = supabase.from('ag_waitlist').select(COLS).eq('provider_id', pid)
      if (st === 'active') q = q.in('status', ACTIVE)
      else if (STATUSES.includes(st)) q = q.eq('status', st)
      else if (st !== 'all') return res.status(400).json({ error: 'Status inválido' })
      const { data, error } = await q.order('created_at', { ascending: st === 'all' ? false : true }).limit(300)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ entries: (data || []).map((e) => shape(e, todayKey)) })
    }

    const body = req.body || {}
    const action = body.action

    // Combinar e leitura: nao grava nada
    if (action === 'match') {
      const date = String(body.date || '').slice(0, 10)
      if (!validDate(date)) return res.status(400).json({ error: 'Escolha o dia que abriu (AAAA-MM-DD)' })
      const time = body.time ? String(body.time).slice(0, 5) : null
      if (time && !HHMM.test(time)) return res.status(400).json({ error: 'Horário inválido. Use HH:MM' })
      const { data, error } = await supabase.from('ag_waitlist').select(COLS)
        .eq('provider_id', pid).in('status', ACTIVE).order('created_at', { ascending: true }).limit(300)
      if (error) return res.status(500).json({ error: error.message })
      const entries = (data || []).filter((e) => matchesSlot(e, date, time)).map((e) => shape(e, todayKey))
      return res.status(200).json({
        entries,
        date,
        time,
        weekday: new Date(date + 'T12:00:00Z').getUTCDay(),
        period: time ? periodOf(time) : null,
      })
    }

    const gate = requireFeature(provider, 'waitlist')
    if (!gate.ok) return res.status(gate.status).json(gate.body)

    // Cliente e servico, quando vierem, tem que ser dela
    const loadClient = async (id) => {
      if (!UUID_RE.test(String(id))) return null
      const { data } = await supabase.from('ag_clients').select('id, name, whatsapp')
        .eq('id', id).eq('provider_id', pid).maybeSingle()
      return data || null
    }
    const checkService = async (id) => {
      if (!UUID_RE.test(String(id))) return false
      const { data } = await supabase.from('ag_services').select('id').eq('id', id).eq('provider_id', pid).maybeSingle()
      return !!data
    }

    if (action === 'create') {
      const read = readFields(body, false)
      if (read.error) return res.status(400).json({ error: read.error })
      const row = { provider_id: pid, ...read.fields, status: 'waiting' }

      if (body.client_id) {
        const c = await loadClient(body.client_id)
        if (!c) return res.status(404).json({ error: 'Cliente não encontrada' })
        row.client_id = c.id
        row.client_name = row.client_name || c.name
        row.client_whatsapp = row.client_whatsapp || c.whatsapp || null
      } else if (row.client_whatsapp) {
        // Ja e cliente? Liga a entrada a ficha pelo WhatsApp
        const { data: found } = await supabase.from('ag_clients').select('id, name')
          .eq('provider_id', pid).eq('whatsapp', row.client_whatsapp).limit(1)
        if (found?.[0]) row.client_id = found[0].id
      }
      if (!row.client_name) return res.status(400).json({ error: 'Diga o nome de quem está esperando' })

      if (body.service_id) {
        if (!(await checkService(body.service_id))) return res.status(404).json({ error: 'Serviço não encontrado' })
        row.service_id = body.service_id
      }
      if (row.date_from && row.date_to && row.date_to < row.date_from) {
        return res.status(400).json({ error: 'A data final precisa ser depois da inicial' })
      }

      const { count } = await supabase.from('ag_waitlist').select('id', { count: 'exact', head: true })
        .eq('provider_id', pid).in('status', ACTIVE)
      if ((count || 0) >= MAX_ACTIVE) return res.status(400).json({ error: `A lista já tem ${MAX_ACTIVE} pessoas esperando. Tire quem já foi atendida.` })

      const { data, error } = await supabase.from('ag_waitlist').insert(row).select(COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(201).json({ ok: true, entry: shape(data, todayKey) })
    }

    const id = String(body.id || '')
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Entrada inválida' })
    const { data: current } = await supabase.from('ag_waitlist').select('id, status, date_from, date_to, client_id')
      .eq('id', id).eq('provider_id', pid).maybeSingle()
    if (!current) return res.status(404).json({ error: 'Entrada não encontrada' })

    if (action === 'update') {
      const read = readFields(body, true)
      if (read.error) return res.status(400).json({ error: read.error })
      const patch = { ...read.fields }
      if (patch.client_name === null) return res.status(400).json({ error: 'Diga o nome de quem está esperando' })

      if (body.client_id !== undefined) {
        if (!body.client_id) patch.client_id = null
        else {
          const c = await loadClient(body.client_id)
          if (!c) return res.status(404).json({ error: 'Cliente não encontrada' })
          patch.client_id = c.id
        }
      }
      if (body.service_id !== undefined) {
        if (!body.service_id) patch.service_id = null
        else if (!(await checkService(body.service_id))) return res.status(404).json({ error: 'Serviço não encontrado' })
        else patch.service_id = body.service_id
      }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Status inválido' })
        patch.status = body.status
        if (body.status === 'notified') patch.notified_at = new Date().toISOString()
      }
      const from = patch.date_from !== undefined ? patch.date_from : current.date_from
      const to = patch.date_to !== undefined ? patch.date_to : current.date_to
      if (from && to && String(to) < String(from)) return res.status(400).json({ error: 'A data final precisa ser depois da inicial' })
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada pra salvar' })

      const { data, error } = await supabase.from('ag_waitlist')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).eq('provider_id', pid).select(COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, entry: shape(data, todayKey) })
    }

    if (action === 'delete') {
      const { error } = await supabase.from('ag_waitlist').delete().eq('id', id).eq('provider_id', pid)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
