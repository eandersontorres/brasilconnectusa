/**
 * POST /api/agenda/request-review
 * Body: { appointment_id }
 * Gera token único, retorna link pronto pro WhatsApp.
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { appointment_id } = req.body || {}
  if (!appointment_id) return res.status(400).json({ error: 'appointment_id obrigatório' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: apt } = await supabase
      .from('ag_appointments')
      .select('*, ag_providers(slug, name)')
      .eq('id', appointment_id)
      .single()
    if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' })
    if (apt.status !== 'completed') return res.status(400).json({ error: 'Apenas agendamentos completos' })

    const token = randomBytes(16).toString('hex')
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await supabase.from('ag_review_tokens').insert({
      token,
      appointment_id,
      provider_id: apt.provider_id,
      expires_at: expires,
    })

    await supabase.from('ag_appointments').update({ review_requested: true }).eq('id', appointment_id)

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'
    const reviewUrl = `${baseUrl}/agenda/review/${token}`
    const message = `Oi ${apt.client_name}! Tudo bem? Que bom ter atendido você. Pode deixar uma avaliação rápida? ${reviewUrl}`

    let whatsappUrl = null
    if (apt.client_whatsapp) {
      const cleaned = apt.client_whatsapp.replace(/\D/g, '')
      whatsappUrl = `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`
    }

    return res.status(200).json({ token, review_url: reviewUrl, whatsapp_url: whatsappUrl, message })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
