/**
 * GET /api/referral/status?email=X
 *
 * Retorna progresso de indicação para um email da waitlist.
 * Cria código se ainda não existir.
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const email = String(req.query.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email inválido' })
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Configuração ausente' })
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Verifica se o email está na waitlist
    const { data: waitlist } = await supabase
      .from('bc_waitlist')
      .select('email, city, created_at')
      .eq('email', email)
      .maybeSingle()

    if (!waitlist) {
      return res.status(404).json({ error: 'Email não encontrado. Cadastre-se primeiro.' })
    }

    // Garante que existe código (chama função SQL)
    const { data: codeResult, error: codeErr } = await supabase
      .rpc('bc_ensure_referral_code', { p_email: email })

    if (codeErr) {
      return res.status(500).json({ error: codeErr.message })
    }

    const code = codeResult

    // Busca contadores
    const { data: codeRow } = await supabase
      .from('bc_referral_codes')
      .select('code, total_clicks, total_signups, total_qualified, reward_status, rewarded_at')
      .eq('email', email)
      .single()

    return res.status(200).json({
      email,
      code,
      stats: {
        clicks: codeRow?.total_clicks || 0,
        signups: codeRow?.total_signups || 0,
        qualified: codeRow?.total_qualified || 0,
      },
      reward: {
        status: codeRow?.reward_status || 'pending',
        rewardedAt: codeRow?.rewarded_at || null,
        threshold: 3,
        remaining: Math.max(0, 3 - (codeRow?.total_qualified || 0)),
      }
    })
  } catch (e) {
    console.error('Referral status error:', e.message)
    return res.status(500).json({ error: 'Erro interno' })
  }
}
