/**
 * GET /api/agenda/review?token=...   → valida token e retorna info
 * POST /api/agenda/review             → submete review
 *   Body: { token, rating, comment? }
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    const { token } = req.query
    if (!token) return res.status(400).json({ error: 'token obrigatório' })
    const { data: t } = await supabase
      .from('ag_review_tokens')
      .select('*, ag_appointments(client_name, client_whatsapp), ag_providers(name, slug)')
      .eq('token', token).single()
    if (!t) return res.status(404).json({ error: 'Token inválido' })
    if (t.used) return res.status(410).json({ error: 'Token já utilizado' })
    if (new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'Token expirado' })
    return res.status(200).json({
      provider_name: t.ag_providers.name,
      provider_slug: t.ag_providers.slug,
      client_name: t.ag_appointments.client_name,
    })
  }

  if (req.method === 'POST') {
    const { token, rating, comment } = req.body || {}
    if (!token || !rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'token e rating (1-5) obrigatórios' })
    const { data: t } = await supabase
      .from('ag_review_tokens')
      .select('*, ag_appointments(client_name)')
      .eq('token', token).single()
    if (!t || t.used || new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'Token inválido ou expirado' })

    const { error: rErr } = await supabase.from('ag_reviews').insert({
      provider_id: t.provider_id,
      appointment_id: t.appointment_id,
      client_name: t.ag_appointments.client_name,
      rating,
      comment: comment || null,
    })
    if (rErr) return res.status(500).json({ error: rErr.message })

    await supabase.from('ag_review_tokens').update({ used: true }).eq('token', token)
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
