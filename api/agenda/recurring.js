/**
 * Clientes fixas (recorrencia, plano Pro): a regra preenche a agenda sozinha
 * nas proximas 6 semanas. Geracao em api/_lib/recurring.js; o cron diario
 * api/cron/agenda-recurring empurra o horizonte pra frente.
 *
 * GET  /api/agenda/recurring        com JWT: { rules: [...], limit, can_team }
 * GET  /api/agenda/recurring?id=    com JWT: { rule, appointments: [proximos gerados] }
 * POST /api/agenda/recurring        com JWT
 *      Body: { action, ... }
 *        create   { client_id, service_id?, staff_id?, frequency, day_of_week, start_time,
 *                   duration_min?, price_cents?, anchor_date?, end_date?, notes? }
 *        update   { id, ...campos }   (so o que vier muda; datas novas refazem as futuras em aberto)
 *        delete   { id }              tira as futuras em aberto da agenda; historico fica
 *        pause    { id }              para de gerar e tira as futuras em aberto
 *        resume   { id }              volta a gerar (mesma quinzena de antes)
 *        skip     { id, date }        pula uma data (cliente viajou, feriado)
 *        unskip   { id, date }        desfaz o pulo
 *
 * Regra de cada item: client_name, service_name, staff_name/staff_color e
 * next_dates (proximas 3 datas, sem folga no horario). Agendamento com pagamento
 * registrado nunca e apagado nem alterado pela recorrencia.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature, requireLimit, hasFeature, limitFor } from '../_lib/agendaPlans.js'
import {
  FREQUENCIES, HORIZON_DAYS, OPEN, addDays, alignToWeekday, blockedDays, clearFutureOpen, conflictsFor,
  generateForRule, hhmm, isDateKey, nextDates, occurrences, regenerate, updateFutureOpen, wallIso, wallNow, weekdayOf,
} from '../_lib/recurring.js'

const RULE_COLS = 'id, provider_id, client_id, service_id, staff_id, frequency, day_of_week, start_time, duration_min, price_cents, anchor_date, end_date, skip_dates, active, notes, generated_until, created_at, updated_at'
const LIST_COLS = RULE_COLS + ', ag_clients(id, name, whatsapp), ag_services(id, name), ag_staff(id, name, color, active)'
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const MAX_RULES = 300
// Mudam as datas: refaz as futuras em aberto
const PATTERN_KEYS = ['client_id', 'frequency', 'day_of_week', 'anchor_date', 'end_date']
// Nao mudam as datas: aplica nas futuras em aberto sem apagar
const INPLACE_KEYS = ['start_time', 'duration_min', 'price_cents', 'service_id', 'staff_id', 'notes']

const int = (v, min, max, def) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
const isUuid = (v) => /^[0-9a-f-]{32,36}$/i.test(String(v || ''))

// nowHHMM: hora do relogio da profissional (hoje so conta como proxima se o horario nao passou)
function shape(r, today, blocked, nowHHMM = null) {
  const rule = {
    id: r.id,
    client_id: r.client_id,
    client_name: r.ag_clients?.name || 'Cliente',
    client_whatsapp: r.ag_clients?.whatsapp || null,
    service_id: r.service_id,
    service_name: r.ag_services?.name || null,
    staff_id: r.staff_id,
    staff_name: r.ag_staff?.name || null,
    staff_color: r.ag_staff?.color || null,
    staff_active: r.ag_staff ? r.ag_staff.active !== false : null,
    frequency: r.frequency,
    day_of_week: r.day_of_week,
    start_time: hhmm(r.start_time),
    duration_min: r.duration_min,
    price_cents: r.price_cents,
    anchor_date: String(r.anchor_date).slice(0, 10),
    end_date: r.end_date ? String(r.end_date).slice(0, 10) : null,
    skip_dates: (r.skip_dates || []).map((d) => String(d).slice(0, 10)).filter((d) => d >= today).sort(),
    active: r.active,
    notes: r.notes,
    generated_until: r.generated_until,
    created_at: r.created_at,
  }
  rule.next_dates = nextDates(rule, today, 3, blocked, nowHHMM)
  rule.ended = !!(rule.end_date && rule.end_date < today)
  return rule
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    const timezone = provider.timezone || 'America/New_York'
    const wall = wallNow(timezone)
    const today = wall.key
    const genOpts = { timezone, today, nowHHMM: wall.hhmm }
    res.setHeader('Cache-Control', 'private, no-store')

    // Folgas (dia inteiro e parciais) dos proximos meses (pra mostrar as proximas datas reais)
    const loadBlocked = async (until = addDays(today, 180)) => {
      try { return await blockedDays(supabase, provider.id, today, until) } catch (_) { return new Set() }
    }
    const loadRule = async (id) => {
      if (!isUuid(id)) return null
      const { data } = await supabase.from('ag_recurring').select(LIST_COLS)
        .eq('id', id).eq('provider_id', provider.id).maybeSingle()
      return data || null
    }

    // ── Leitura (liberada sem plano: a profissional nao perde o que cadastrou) ──
    if (req.method === 'GET') {
      const blocked = await loadBlocked()
      if (req.query.id) {
        const r = await loadRule(req.query.id)
        if (!r) return res.status(404).json({ error: 'Cliente fixa não encontrada' })
        const { data: apts, error } = await supabase.from('ag_appointments')
          .select('id, scheduled_for, duration_min, status, occurrence_date, staff_id')
          .eq('provider_id', provider.id).eq('recurring_id', r.id)
          .gte('scheduled_for', wallIso(today, '00:00'))
          .order('scheduled_for', { ascending: true })
          .limit(12)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ rule: shape(r, today, blocked, wall.hhmm), appointments: apts || [] })
      }

      const { data, error } = await supabase.from('ag_recurring').select(LIST_COLS)
        .eq('provider_id', provider.id)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(MAX_RULES)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({
        rules: (data || []).map((r) => shape(r, today, blocked, wall.hhmm)),
        limit: limitFor(provider, 'recurring'),
        can_team: hasFeature(provider, 'team'),
        today,
      })
    }

    const body = req.body || {}
    const action = body.action

    const activeCount = async (exceptId) => {
      let q = supabase.from('ag_recurring').select('id', { count: 'exact', head: true })
        .eq('provider_id', provider.id).eq('active', true)
      if (exceptId) q = q.neq('id', exceptId)
      const { count, error } = await q
      if (error) throw new Error(error.message)
      return count || 0
    }

    // Outros agendamentos no mesmo horario das proximas datas (aviso, nao bloqueia)
    const findConflicts = async (rule) => {
      if (!rule.active) return []
      const until = addDays(today, HORIZON_DAYS)
      const dates = occurrences(rule, today, until)
      if (!dates.length) return []
      const { data } = await supabase.from('ag_appointments')
        .select('id, scheduled_for, duration_min, client_name, staff_id, recurring_id, status')
        .eq('provider_id', provider.id).in('status', OPEN)
        .gte('scheduled_for', wallIso(today, '00:00')).lte('scheduled_for', `${until}T23:59:59.999Z`)
        .limit(1000)
      return conflictsFor(rule, dates, data || [])
    }

    const reply = async (id, status = 200, extra = {}) => {
      const r = await loadRule(id)
      return res.status(status).json({ ok: true, rule: r ? shape(r, today, await loadBlocked(), wall.hhmm) : null, ...extra })
    }

    /**
     * Le e valida os campos. Em `partial`, so o que veio no corpo.
     * Confere que cliente, servico e equipe sao da propria profissional.
     */
    const readFields = async (partial, current = null) => {
      const out = {}
      let service = null

      if (!partial || body.client_id !== undefined) {
        if (!isUuid(body.client_id)) return { error: 'Escolha a cliente' }
        const { data: c } = await supabase.from('ag_clients').select('id')
          .eq('id', body.client_id).eq('provider_id', provider.id).maybeSingle()
        if (!c) return { error: 'Cliente não encontrada' }
        out.client_id = c.id
      }
      if (!partial || body.service_id !== undefined) {
        if (body.service_id) {
          if (!isUuid(body.service_id)) return { error: 'Serviço inválido' }
          const { data: s } = await supabase.from('ag_services').select('id, duration_min, price_cents')
            .eq('id', body.service_id).eq('provider_id', provider.id).maybeSingle()
          if (!s) return { error: 'Serviço não encontrado' }
          service = s
          out.service_id = s.id
        } else out.service_id = null
      }
      if (!partial || body.staff_id !== undefined) {
        if (body.staff_id && body.staff_id === current?.staff_id) {
          // Mesma pessoa de antes: vale mesmo se o plano mudou
          out.staff_id = current.staff_id
        } else if (body.staff_id) {
          if (!hasFeature(provider, 'team')) {
            const gate = requireFeature(provider, 'team')
            return { gate }
          }
          if (!isUuid(body.staff_id)) return { error: 'Pessoa da equipe inválida' }
          const { data: st } = await supabase.from('ag_staff').select('id, active')
            .eq('id', body.staff_id).eq('provider_id', provider.id).maybeSingle()
          if (!st) return { error: 'Pessoa da equipe não encontrada' }
          if (!st.active && st.id !== current?.staff_id) return { error: 'Essa pessoa está desativada na equipe' }
          out.staff_id = st.id
        } else out.staff_id = null
      }
      if (!partial || body.frequency !== undefined) {
        if (!FREQUENCIES[body.frequency]) return { error: 'Escolha a frequência' }
        out.frequency = body.frequency
      }
      if (!partial || body.start_time !== undefined) {
        const t = String(body.start_time || '').slice(0, 5)
        if (!HHMM.test(t)) return { error: 'Horário inválido. Use HH:MM' }
        out.start_time = t
      }
      if (!partial || body.duration_min !== undefined) {
        const def = service?.duration_min || current?.duration_min || 60
        out.duration_min = body.duration_min == null || body.duration_min === '' ? def : int(body.duration_min, 5, 720, def)
      }
      if (!partial || body.price_cents !== undefined) {
        const def = service?.price_cents ?? current?.price_cents ?? 0
        out.price_cents = body.price_cents == null || body.price_cents === '' ? def : int(body.price_cents, 0, 1000000, def)
      }
      if (!partial || body.anchor_date !== undefined) {
        const a = body.anchor_date ? String(body.anchor_date).slice(0, 10) : today
        if (!isDateKey(a)) return { error: 'Primeira data inválida' }
        // Intervalo so vale pra data nova: a mesma de sempre (regra antiga) continua aceita
        const cur = current?.anchor_date ? String(current.anchor_date).slice(0, 10) : null
        if (a !== cur && (a < addDays(today, -365 * 2) || a > addDays(today, 365))) return { error: 'Primeira data fora do intervalo' }
        out.anchor_date = a
      }
      if (!partial || body.day_of_week !== undefined) {
        if (body.day_of_week == null || body.day_of_week === '') {
          out.day_of_week = weekdayOf(out.anchor_date || current?.anchor_date || today)
        } else {
          const d = Number(body.day_of_week)
          if (!Number.isInteger(d) || d < 0 || d > 6) return { error: 'Dia da semana inválido' }
          out.day_of_week = d
        }
      }
      if (!partial || body.end_date !== undefined) {
        if (body.end_date) {
          const e = String(body.end_date).slice(0, 10)
          if (!isDateKey(e)) return { error: 'Data final inválida' }
          out.end_date = e
        } else out.end_date = null
      }
      if (!partial || body.notes !== undefined) out.notes = clip(body.notes, 500)

      // Primeira data sempre cai no dia da semana escolhido
      const merged = { ...(current || {}), ...out }
      if (out.anchor_date !== undefined || out.day_of_week !== undefined) {
        const anchor = alignToWeekday(String(merged.anchor_date).slice(0, 10), merged.day_of_week)
        out.anchor_date = anchor
        merged.anchor_date = anchor
      }
      if (merged.end_date && String(merged.end_date).slice(0, 10) < String(merged.anchor_date).slice(0, 10)) {
        return { error: 'A data final precisa ser depois da primeira data' }
      }
      return { fields: out }
    }

    if (action === 'create') {
      const gate = requireFeature(provider, 'recurring')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const lim = requireLimit(provider, 'recurring', await activeCount())
      if (!lim.ok) return res.status(lim.status).json(lim.body)

      const { count: total } = await supabase.from('ag_recurring')
        .select('id', { count: 'exact', head: true }).eq('provider_id', provider.id)
      if ((total || 0) >= MAX_RULES) return res.status(400).json({ error: `Limite de ${MAX_RULES} clientes fixas atingido. Exclua as que não vêm mais.` })

      const read = await readFields(false)
      if (read.gate) return res.status(read.gate.status).json(read.gate.body)
      if (read.error) return res.status(400).json({ error: read.error })

      const { data: rule, error } = await supabase.from('ag_recurring')
        .insert({ provider_id: provider.id, ...read.fields, active: true })
        .select(RULE_COLS).single()
      if (error) return res.status(500).json({ error: error.message })

      const gen = await generateForRule(supabase, rule, genOpts)
      const conflicts = await findConflicts(rule)
      return reply(rule.id, 201, { created: gen.created, conflicts, warning: gen.ok ? null : gen.error })
    }

    if (!isUuid(body.id)) return res.status(400).json({ error: 'id é obrigatório' })
    const { data: current } = await supabase.from('ag_recurring').select(RULE_COLS)
      .eq('id', body.id).eq('provider_id', provider.id).maybeSingle()
    if (!current) return res.status(404).json({ error: 'Cliente fixa não encontrada' })
    const stamp = new Date().toISOString()

    if (action === 'update') {
      const gate = requireFeature(provider, 'recurring')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const read = await readFields(true, current)
      if (read.gate) return res.status(read.gate.status).json(read.gate.body)
      if (read.error) return res.status(400).json({ error: read.error })

      // So conta como mudanca o que de fato mudou
      const norm = (k, v) => (v == null ? null : k === 'start_time' ? hhmm(v) : (k === 'anchor_date' || k === 'end_date') ? String(v).slice(0, 10) : v)
      const changed = Object.keys(read.fields).filter((k) => norm(k, read.fields[k]) !== norm(k, current[k]))
      if (!changed.length) return reply(current.id, 200, { created: 0, updated: 0, conflicts: [] })

      const patch = {}
      for (const k of changed) patch[k] = read.fields[k]
      const { data: saved, error } = await supabase.from('ag_recurring')
        .update({ ...patch, updated_at: stamp })
        .eq('id', current.id).eq('provider_id', provider.id)
        .select(RULE_COLS).single()
      if (error) return res.status(500).json({ error: error.message })

      let result = { ok: true, created: 0, updated: 0, deleted: 0 }
      if (saved.active) {
        if (changed.some((k) => PATTERN_KEYS.includes(k))) {
          result = await regenerate(supabase, saved, genOpts)
        } else {
          const inplace = {}
          for (const k of changed) if (INPLACE_KEYS.includes(k)) inplace[k] = saved[k]
          const up = await updateFutureOpen(supabase, saved, inplace, genOpts)
          const gen = await generateForRule(supabase, saved, genOpts)
          result = { ok: up.ok && gen.ok, error: up.error || gen.error, created: gen.created, updated: up.updated }
        }
      }
      const conflicts = await findConflicts(saved)
      return reply(saved.id, 200, {
        created: result.created || 0, updated: result.updated || 0, deleted: result.deleted || 0,
        conflicts, warning: result.ok ? null : result.error,
      })
    }

    if (action === 'pause') {
      if (!current.active) return reply(current.id)
      const { error } = await supabase.from('ag_recurring').update({ active: false, updated_at: stamp })
        .eq('id', current.id).eq('provider_id', provider.id)
      if (error) return res.status(500).json({ error: error.message })
      const cleared = await clearFutureOpen(supabase, current, genOpts)
      return reply(current.id, 200, { deleted: cleared.deleted || 0, kept: cleared.kept || 0, warning: cleared.ok ? null : cleared.error })
    }

    if (action === 'resume') {
      const gate = requireFeature(provider, 'recurring')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      if (current.active) return reply(current.id)
      const lim = requireLimit(provider, 'recurring', await activeCount(current.id))
      if (!lim.ok) return res.status(lim.status).json(lim.body)
      const { data: saved, error } = await supabase.from('ag_recurring').update({ active: true, updated_at: stamp })
        .eq('id', current.id).eq('provider_id', provider.id).select(RULE_COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      const gen = await generateForRule(supabase, saved, genOpts)
      const conflicts = await findConflicts(saved)
      return reply(saved.id, 200, { created: gen.created, conflicts, warning: gen.ok ? null : gen.error })
    }

    if (action === 'skip' || action === 'unskip') {
      const date = String(body.date || '').slice(0, 10)
      if (!isDateKey(date)) return res.status(400).json({ error: 'Data inválida' })
      if (date < today) return res.status(400).json({ error: 'Essa data já passou' })
      // Hoje, com o horario ja passado: o atendimento de hoje fica no historico
      if (action === 'skip' && date === today && hhmm(current.start_time) < wall.hhmm) {
        return res.status(400).json({ error: 'O horário de hoje já passou. Pule a próxima data.' })
      }
      // So vale pra uma data que a regra realmente teria
      const plain = { ...current, anchor_date: String(current.anchor_date).slice(0, 10), skip_dates: [] }
      if (!occurrences(plain, date, date).length) return res.status(400).json({ error: 'Essa data não faz parte da recorrência' })

      const keep = (current.skip_dates || []).map((d) => String(d).slice(0, 10)).filter((d) => d >= today && d !== date)
      const skipDates = action === 'skip' ? [...keep, date].sort().slice(-60) : keep.sort()
      const { data: saved, error } = await supabase.from('ag_recurring').update({ skip_dates: skipDates, updated_at: stamp })
        .eq('id', current.id).eq('provider_id', provider.id).select(RULE_COLS).single()
      if (error) return res.status(500).json({ error: error.message })

      if (action === 'skip') {
        const cleared = await clearFutureOpen(supabase, saved, { ...genOpts, onlyDate: date })
        return reply(saved.id, 200, { deleted: cleared.deleted || 0, kept: cleared.kept || 0, warning: cleared.ok ? null : cleared.error })
      }
      // Desfez o pulo: recoloca na agenda (se ainda gera e esta dentro das 6 semanas)
      let created = 0
      if (saved.active && hasFeature(provider, 'recurring')) {
        const gen = await generateForRule(supabase, saved, genOpts)
        created = gen.created || 0
      }
      return reply(saved.id, 200, { created })
    }

    if (action === 'delete') {
      const cleared = await clearFutureOpen(supabase, current, genOpts)
      if (!cleared.ok) return res.status(500).json({ error: cleared.error })
      // Agendamentos que ficaram (passados, pagos) perdem o vinculo (ON DELETE SET NULL)
      const { error } = await supabase.from('ag_recurring').delete().eq('id', current.id).eq('provider_id', provider.id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, deleted: cleared.deleted, kept: cleared.kept })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
