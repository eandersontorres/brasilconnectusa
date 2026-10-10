/**
 * GET /api/agenda/availability?provider_id=...&date=YYYY-MM-DD&duration=60
 * Publico. Horarios livres pra agendamento online.
 *
 * Regras:
 * - So devolve horarios se o plano da profissional libera 'online_booking'
 *   (teste gratis ou assinatura ativa). Sem plano: slots vazios + booking_open false.
 * - Horario de atendimento, folgas (dia inteiro e parciais) e agendamentos vem
 *   da funcao ag_get_available_slots (supabase/ag_app_setup.sql).
 * - Hoje: so horarios que ainda nao passaram no fuso da profissional.
 */
import { createClient } from '@supabase/supabase-js'
import { hasFeature } from '../_lib/agendaPlans.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLAN_COLS = 'id, plan, plan_status, trial_ends_at, created_at, stripe_subscription_id, current_period_end, active'

/** Data e hora de parede agora no fuso ({ key: 'YYYY-MM-DD', hhmm: 'HH:MM' }). */
function nowIn(tz) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]))
    return { key: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` }
  } catch (_) {
    const iso = new Date().toISOString()
    return { key: iso.slice(0, 10), hhmm: iso.slice(11, 16) }
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { provider_id, date, duration } = req.query
  if (!provider_id || !date) return res.status(400).json({ error: 'provider_id e date são obrigatórios' })
  if (!UUID.test(String(provider_id))) return res.status(400).json({ error: 'provider_id inválido' })
  if (!DATE.test(String(date)) || Number.isNaN(new Date(date + 'T12:00:00Z').getTime())) {
    return res.status(400).json({ error: 'Data inválida. Use AAAA-MM-DD' })
  }

  const dur = Math.min(Math.max(parseInt(duration, 10) || 60, 5), 720)
  const empty = (extra) => res.status(200).json({ provider_id, date, duration_min: dur, slots: [], ...extra })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Plano da profissional (+ fuso, se a coluna ja existir)
    let { data: provider, error: pErr } = await supabase.from('ag_providers')
      .select(PLAN_COLS + ', timezone').eq('id', provider_id).maybeSingle()
    if (pErr) {
      const retry = await supabase.from('ag_providers').select(PLAN_COLS).eq('id', provider_id).maybeSingle()
      provider = retry.data
      pErr = retry.error
    }
    if (pErr) return res.status(500).json({ error: pErr.message })
    if (!provider || provider.active === false) return res.status(404).json({ error: 'Profissional não encontrada' })

    res.setHeader('Cache-Control', 's-maxage=30')
    if (!hasFeature(provider, 'online_booking')) return empty({ booking_open: false })

    // Dia que ja passou: nada. Muito longe: nada.
    const now = nowIn(provider.timezone)
    if (date < now.key) return empty({ booking_open: true })
    const max = new Date(now.key + 'T12:00:00Z')
    max.setUTCDate(max.getUTCDate() + 366)
    if (date > max.toISOString().slice(0, 10)) return empty({ booking_open: true })

    const { data, error } = await supabase.rpc('ag_get_available_slots', {
      p_provider_id: provider_id,
      p_date: date,
      p_duration_min: dur,
      p_slot_step_min: 30,
    })
    if (error) return res.status(500).json({ error: error.message })

    let slots = [...new Set((data || []).map(s => String(s.slot_time || '').slice(0, 5)).filter(Boolean))].sort()
    if (date === now.key) slots = slots.filter(s => s > now.hhmm)

    return res.status(200).json({
      provider_id,
      date,
      duration_min: dur,
      booking_open: true,
      slots,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
