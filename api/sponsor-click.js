/**
 * GET /go/sponsor/:id (rewritten para /api/sponsor-click?id=:id)
 *
 * Registra um click no patrocinador + redireciona pra website_url dele.
 * Fire-and-forget no log pra nao atrasar o redirect.
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const sponsor_id = req.query.id
  if (!sponsor_id) return res.status(400).json({ error: 'id obrigatorio' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const { data: sponsor, error } = await supabase
      .from('bc_sponsors')
      .select('id, website_url, active, status, clicks_count')
      .eq('id', sponsor_id)
      .maybeSingle()
    if (error || !sponsor) {
      return res.redirect(302, '/')
    }
    if (!sponsor.active || sponsor.status !== 'approved') {
      return res.redirect(302, '/')
    }

    // Tracking fire-and-forget
    const placement = req.query.placement || null
    const user_id = req.query.user_id || null
    const ua = req.headers['user-agent'] || null
    const referer = req.headers['referer'] || null

    supabase.from('bc_sponsor_events').insert({
      sponsor_id, event_type: 'click', user_id, placement,
      user_agent: ua, referer,
    }).then(() => {})

    supabase.from('bc_sponsors')
      .update({ clicks_count: (sponsor.clicks_count || 0) + 1 })
      .eq('id', sponsor_id)
      .then(() => {})

    // Apendar UTM pra fácil identificação no destino
    let finalUrl = sponsor.website_url
    try {
      const u = new URL(sponsor.website_url)
      if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'brasilconnect')
      if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'sponsor')
      u.searchParams.set('utm_campaign', placement || 'sidebar')
      finalUrl = u.toString()
    } catch (_) {}

    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(302, finalUrl)
  } catch (e) {
    console.error('sponsor-click error:', e.message)
    return res.redirect(302, '/')
  }
}
