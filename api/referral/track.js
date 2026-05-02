/**
 * GET /r/:code (via vercel rewrite → /api/referral/track?code=X)
 *
 * Registra clique no link de indicação, seta cookie 30 dias
 * e redireciona para a home.
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const code = String(req.query.code || '').trim().toUpperCase()
  if (!/^BRA-[A-Z0-9]{5}$/.test(code)) {
    return res.redirect(302, '/?invalid_referral=1')
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
  const userAgent = req.headers['user-agent'] || null

  // Verifica se o código existe
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

      const { data: codeData } = await supabase
        .from('bc_referral_codes')
        .select('code')
        .eq('code', code)
        .maybeSingle()

      if (!codeData) {
        return res.redirect(302, '/?invalid_referral=1')
      }

      // Registra o clique (fire and forget)
      supabase.from('bc_referral_uses').insert({
        code,
        ip_address: ip,
        user_agent: userAgent,
        status: 'click',
      }).then(({ error }) => {
        if (error) console.error('Referral track insert error:', error.message)
      })
    } catch (e) {
      console.error('Referral track error:', e.message)
    }
  }

  // Cookie 30 dias com o código
  const thirtyDays = 60 * 60 * 24 * 30
  res.setHeader('Set-Cookie', `bc_ref=${code}; Path=/; Max-Age=${thirtyDays}; SameSite=Lax`)
  res.setHeader('Cache-Control', 'no-store')

  return res.redirect(302, '/?ref=' + encodeURIComponent(code))
}
