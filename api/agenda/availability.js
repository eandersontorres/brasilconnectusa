/**
 * GET /api/agenda/availability?provider_id=...&date=YYYY-MM-DD&duration=60
 * Retorna slots disponíveis pra agendamento.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { provider_id, date, duration } = req.query
  if (!provider_id || !date) return res.status(400).json({ error: 'provider_id e date são obrigatórios' })

  const dur = parseInt(duration) || 60

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const { data, error } = await supabase.rpc('ag_get_available_slots', {
      p_provider_id: provider_id,
      p_date: date,
      p_duration_min: dur,
      p_slot_step_min: 30,
    })
    if (error) return res.status(500).json({ error: error.message })

    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json({
      provider_id,
      date,
      duration_min: dur,
      slots: (data || []).map(s => s.slot_time?.slice(0, 5)),
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
