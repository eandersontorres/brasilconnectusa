/**
 * Horario de atendimento da profissional (tabela ag_availability).
 *
 * GET  /api/agenda/hours   com JWT: minhas janelas de atendimento
 * POST /api/agenda/hours   com JWT: substitui todas as janelas (recurso 'hours' do plano)
 *      Body: { hours: [{ day_of_week: 0-6 (0 = domingo), start_time: 'HH:MM', end_time: 'HH:MM' }] }
 *      Ate 3 janelas por dia, sem sobrepor (ex.: 09:00-12:00 e 13:00-18:00 = pausa pro almoco).
 *
 * Sem janelas cadastradas, a pagina publica nao oferece nenhum horario.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const ON_DAY = ['No domingo', 'Na segunda', 'Na terça', 'Na quarta', 'Na quinta', 'Na sexta', 'No sábado']

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const providerId = auth.provider.id

    if (req.method === 'POST') {
      const gate = requireFeature(auth.provider, 'hours')
      if (!gate.ok) return res.status(gate.status).json(gate.body)

      const input = Array.isArray(req.body?.hours) ? req.body.hours : null
      if (!input) return res.status(400).json({ error: 'hours deve ser uma lista' })
      if (input.length > 21) return res.status(400).json({ error: 'No máximo 3 janelas por dia' })

      const rows = []
      const perDay = {}
      for (const h of input) {
        const day = Number(h?.day_of_week)
        const start = String(h?.start_time || '').slice(0, 5)
        const end = String(h?.end_time || '').slice(0, 5)
        if (!Number.isInteger(day) || day < 0 || day > 6) return res.status(400).json({ error: 'Dia da semana inválido' })
        if (!HHMM.test(start) || !HHMM.test(end)) return res.status(400).json({ error: 'Horário inválido. Use HH:MM' })
        if (start >= end) return res.status(400).json({ error: `${ON_DAY[day]}, o início precisa ser antes do fim` })
        perDay[day] = perDay[day] || []
        perDay[day].push([start, end])
        if (perDay[day].length > 3) return res.status(400).json({ error: 'No máximo 3 janelas por dia' })
        rows.push({ provider_id: providerId, day_of_week: day, start_time: start, end_time: end, active: true })
      }

      // Janelas do mesmo dia nao podem se sobrepor (geraria horario repetido)
      for (const [day, list] of Object.entries(perDay)) {
        const sorted = list.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1))
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i][0] < sorted[i - 1][1]) {
            return res.status(400).json({ error: `${ON_DAY[day]}, os horários se sobrepõem (${sorted[i - 1][0]}–${sorted[i - 1][1]} e ${sorted[i][0]}–${sorted[i][1]})` })
          }
        }
      }

      // Grava as novas antes de apagar as antigas: se der erro no meio, nada se perde
      const { data: old, error: oldErr } = await supabase.from('ag_availability').select('id').eq('provider_id', providerId)
      if (oldErr) return res.status(500).json({ error: oldErr.message })
      if (rows.length > 0) {
        const ins = await supabase.from('ag_availability').insert(rows)
        if (ins.error) return res.status(500).json({ error: ins.error.message })
      }
      const oldIds = (old || []).map(r => r.id)
      if (oldIds.length > 0) {
        const del = await supabase.from('ag_availability').delete().eq('provider_id', providerId).in('id', oldIds)
        if (del.error) return res.status(500).json({ error: del.error.message })
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
      hours: (data || []).filter(h => h.active !== false).map(h => ({
        day_of_week: h.day_of_week,
        start_time: String(h.start_time).slice(0, 5),
        end_time: String(h.end_time).slice(0, 5),
      })),
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
