/**
 * BrasilConnect — API Contact (Fale Conosco)
 *
 * POST /api/contact
 *   body: { name, email, reason, message }
 */

import { createClient } from '@supabase/supabase-js'
import { rateLimit } from './_lib/rateLimit.js'

const VALID_REASONS = new Set([
  'sugestao', 'parceria', 'bug', 'negocio', 'agendapro', 'imprensa', 'outro',
])

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const _rl = rateLimit(req, { windowMs: 60000, max: 5 })
  if (_rl) return res.status(429).json({ error: 'Muitas requisicoes. Tenta de novo em ' + _rl.retryAfter + 's.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { name, email, reason, message } = req.body || {}

  if (!name || !email || !reason || !message) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' })
  }
  if (!VALID_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Motivo inválido' })
  }
  if (String(message).trim().length < 10) {
    return res.status(400).json({ error: 'Mensagem muito curta' })
  }

  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('bc_contact_messages')
      .insert({
        name:    String(name).trim().slice(0, 100),
        email:   String(email).toLowerCase().trim(),
        reason:  String(reason),
        message: String(message).trim().slice(0, 5000),
        ip:      req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null,
      })
      .select()
      .single()

    if (error) throw error

    // Opcional: envio de email de notificação via Resend (se configurado)
    if (process.env.RESEND_API_KEY && process.env.CONTACT_NOTIFY_EMAIL) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect <noreply@brasilconnectusa.com>',
          to: [process.env.CONTACT_NOTIFY_EMAIL],
          replyTo: email,
          subject: `[BrasilConnect] ${reason}: ${name}`,
          html: `
            <h2>Nova mensagem em Fale Conosco</h2>
            <p><strong>Nome:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Motivo:</strong> ${reason}</p>
            <p><strong>Mensagem:</strong></p>
            <p>${String(message).replace(/\n/g, '<br>')}</p>
          `,
        })
      } catch (e) { console.error('contact email error:', e.message) }
    }

    return res.status(201).json({ success: true, id: data.id })
  } catch (e) {
    console.error('contact api error:', e.message)
    return res.status(500).json({ error: 'Erro interno: ' + e.message })
  }
}
