/**
 * POST /api/agenda/request-review
 * Header: Authorization: Bearer <JWT>  (a profissional dona do agendamento)
 * Body: { appointment_id }
 * Exige o recurso 'reviews' (Pro). So atendimento realizado (status 'completed').
 *
 * Gera (ou reaproveita, se ainda valido) o link unico de avaliacao e devolve a
 * mensagem pronta pro WhatsApp, no idioma da cliente quando o plano libera
 * (multilang_messages) e com o texto que a profissional personalizou no app.
 *   → { token, review_url, whatsapp_url, message, language, expires_at }
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { hasFeature, requireFeature } from '../_lib/agendaPlans.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_DAYS = 14

// Mesmos textos padrao do app (agendapro/lib/whatsapp.js → review)
const DEFAULT_MESSAGE = {
  pt: 'Oi {nome}, obrigada pela visita! Se puder, deixa sua avaliação aqui, me ajuda muito: {link}',
  en: 'Hi {nome}, thank you for coming! If you can, please leave a quick review here, it really helps: {link}',
  es: 'Hola {nome}, ¡gracias por tu visita! Si puedes, deja tu reseña aquí, me ayuda mucho: {link}',
}

function fill(text, vars) {
  return String(text || '')
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : ''))
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function waDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.length === 10) d = '1' + d   // numero dos EUA sem DDI
  return d.length >= 11 ? d : ''
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider

    const gate = requireFeature(provider, 'reviews')
    if (!gate.ok) return res.status(gate.status).json(gate.body)

    const appointmentId = String(req.body?.appointment_id || '')
    if (!UUID.test(appointmentId)) return res.status(400).json({ error: 'appointment_id obrigatório' })

    // So agendamento da propria profissional
    const { data: apt } = await supabase
      .from('ag_appointments')
      .select('id, provider_id, client_id, client_name, client_whatsapp, status')
      .eq('id', appointmentId)
      .eq('provider_id', provider.id)
      .maybeSingle()
    if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' })
    if (apt.status !== 'completed') return res.status(400).json({ error: 'Só dá pra pedir avaliação de atendimento já realizado. Marque como realizado primeiro.' })

    const { data: already } = await supabase.from('ag_reviews').select('id')
      .eq('provider_id', provider.id).eq('appointment_id', apt.id).limit(1).maybeSingle()
    if (already) return res.status(409).json({ error: 'Essa cliente já avaliou esse atendimento.', code: 'already_reviewed' })

    // Reaproveita o link ainda valido (pedir de novo nao gera link novo a cada toque)
    const nowIso = new Date().toISOString()
    const { data: open } = await supabase.from('ag_review_tokens').select('token, expires_at')
      .eq('appointment_id', apt.id).eq('provider_id', provider.id).eq('used', false)
      .gt('expires_at', new Date(Date.now() + 86400e3).toISOString())
      .order('expires_at', { ascending: false }).limit(1).maybeSingle()

    let token = open?.token || null
    let expires = open?.expires_at || null
    if (!token) {
      token = randomBytes(16).toString('hex')
      expires = new Date(Date.now() + TOKEN_DAYS * 86400e3).toISOString()
      const { error: tErr } = await supabase.from('ag_review_tokens').insert({
        token,
        appointment_id: apt.id,
        provider_id: provider.id,
        used: false,
        expires_at: expires,
      })
      if (tErr) return res.status(500).json({ error: tErr.message })
    }

    await supabase.from('ag_appointments').update({ review_requested: true })
      .eq('id', apt.id).eq('provider_id', provider.id)

    // Idioma da cliente (coluna da entrega clientes; sem ela, portugues)
    let lang = 'pt'
    if (apt.client_id && hasFeature(provider, 'multilang_messages')) {
      try {
        const { data: client, error } = await supabase.from('ag_clients').select('language')
          .eq('id', apt.client_id).eq('provider_id', provider.id).maybeSingle()
        if (!error && ['en', 'es'].includes(client?.language)) lang = client.language
      } catch (_) {}
    }

    const baseUrl = (process.env.APP_URL || 'https://brasilconnectusa.com').replace(/\/$/, '')
    const reviewUrl = `${baseUrl}/agenda/review/${token}`
    const custom = provider.app_settings?.message_templates?.review?.[lang]
    const firstName = String(apt.client_name || '').trim().split(/\s+/)[0] || ''
    const message = fill(typeof custom === 'string' && custom ? custom : DEFAULT_MESSAGE[lang], {
      nome: firstName,
      link: reviewUrl,
      profissional: provider.name,
    })
    // Texto personalizado sem {link}: o link vai no fim pra cliente conseguir avaliar
    const finalMessage = message.includes(reviewUrl) ? message : `${message} ${reviewUrl}`

    const digits = waDigits(apt.client_whatsapp)
    const whatsappUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(finalMessage)}` : null

    return res.status(200).json({
      token,
      review_url: reviewUrl,
      whatsapp_url: whatsappUrl,
      message: finalMessage,
      language: lang,
      expires_at: expires,
      requested_at: nowIso,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
