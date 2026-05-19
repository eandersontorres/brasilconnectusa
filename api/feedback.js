/**
 * POST /api/feedback
 *
 * Recebe feedback in-app (botão flutuante "Reportar problema").
 * Diferente de /api/contact (Fale Conosco do site público) — esta rota
 * sempre captura contexto da tela do user.
 *
 * Body: { user_id?, user_email?, type, message, url?, user_agent? }
 *   type: 'bug' | 'suggestion' | 'question'   (default 'bug')
 *   message: string, mínimo 5 caracteres
 *
 * Não exige auth (anônimo permitido pra reportar bugs de tela de login).
 */

import { createClient } from '@supabase/supabase-js'

const VALID_TYPES = new Set(['bug', 'suggestion', 'question'])
const MAX_MESSAGE = 4000
const MAX_URL     = 500
const MAX_UA      = 300

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars ausentes' })
  }

  let { user_id, user_email, type, message, url, user_agent } = req.body || {}

  // Validação
  message = (message || '').trim()
  if (message.length < 5)        return res.status(400).json({ error: 'Mensagem muito curta (mínimo 5 caracteres).' })
  if (message.length > MAX_MESSAGE) message = message.slice(0, MAX_MESSAGE)

  type = (type || 'bug').toLowerCase().trim()
  if (!VALID_TYPES.has(type)) type = 'bug'

  // Truncates defensivos
  if (url && url.length > MAX_URL)             url = url.slice(0, MAX_URL)
  if (user_agent && user_agent.length > MAX_UA) user_agent = user_agent.slice(0, MAX_UA)

  // Email só se válido (caso o user esteja deslogado e queira incluir)
  if (user_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email)) user_email = null

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    const { data, error } = await sb.from('bc_feedback').insert({
      user_id: user_id || null,
      user_email: user_email || null,
      type,
      message,
      url: url || null,
      user_agent: user_agent || null,
    }).select('id').single()

    if (error) throw error
    return res.status(200).json({ success: true, id: data.id })
  } catch (e) {
    console.error('feedback error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
