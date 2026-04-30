/**
 * POST /api/track
 * Registra um clique de afiliado no Supabase.
 * Body: { provider: string, amount_usd?: number }
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { provider, amount_usd } = req.body || {}

  if (!provider) {
    return res.status(400).json({ error: 'provider é obrigatório' })
  }

  // Metadata do request
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
  const userAgent = req.headers['user-agent'] || null
  const referer = req.headers['referer'] || null

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )

    await supabase.from('bc_affiliate_clicks').insert({
      provider,
      amount_usd: amount_usd || null,
      ip_address: ip,
      user_agent: userAgent,
      referer,
      clicked_at: new Date().toISOString(),
    })
  } catch (e) {
    // não bloquear o usuário se o tracking falhar
    console.error('Track error:', e.message)
  }

  return res.status(200).json({ ok: true })
}
