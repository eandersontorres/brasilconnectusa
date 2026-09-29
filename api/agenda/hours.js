/**
 * Horario de atendimento da profissional (tabela ag_availability).
 *
 * GET  /api/agenda/hours   com JWT: minhas janelas de atendimento
 * POST /api/agenda/hours   com JWT: substitui todas as janelas
 *      Body: { hours: [{ day_of_week: 0-6 (0 = domingo), start_time: 'HH:MM', end_time: 'HH:MM' }] }
 *
 * Sem janelas cadastradas, a pagina publica nao oferece nenhum horario.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const providerId = auth.provider.id

    if (req.method === 'POST') {
      const input = Array.isArray(req.body?.hours) ? req.body.hours : null
      if (!input) return res.status(400).json({ error: 'hours deve ser uma lista' })
      if (input.length > 21) return res.status(400).json({ error: 'No máximo 3 janelas por dia' })

      const rows = []
      const perDay = {}
      for (const h of input) {
        const day = Number(h.day_of_week)
        const start = String(h.start_time || '').slice(0, 5)
        const end = String(h.end_time || '').slice(0, 5)
        if (!Number.isInteger(day) || day < 0 || day > 6) return res.status(400).json({ error: 'Dia da semana inválido' })
        if (!HHMM.test(start) || !HHMM.test(end)) return res.status(400).json({ error: 'Horário inválido. Use HH:MM' })
        if (start >= end) return res.status(400).json({ error: 'O horário de início precisa ser antes do fim' })
        perDay[day] = (perDay[day] || 0) + 1
        if (perDay[day] > 3) return res.status(400).json({ error: 'No máximo 3 janelas por dia' })
        rows.push({ provider_id: providerId, day_of_week: day, start_time: start, end_time: end, active: true })
      }

      const del = await supabase.from('ag_availability').delete().eq('provider_id', providerId)
      if (del.error) return res.status(500).json({ error: del.error.message })
      if (rows.length > 0) {
        const ins = await supabase.from('ag_availability').insert(rows)
        if (ins.error) return res.status(500).json({ error: ins.error.message })
      }
    }

    const { data, error } = await supabase.from('ag_availability')
      .select('id, day_of_week, start_time, end_time, active')
      .eq('provider_id', providerId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })

    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({
      hours: (data || []).map(h => ({
        day_of_week: h.day_of_week,
        start_time: String(h.start_time).slice(0, 5),
        end_time: String(h.end_time).slice(0, 5),
      })),
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
