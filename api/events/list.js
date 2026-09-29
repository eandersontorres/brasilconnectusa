/**
 * GET /api/events/list?limit=5
 * Proximos eventos pra barra lateral do app.
 *
 * Mesma regra de visibilidade do feed (api/social.js action=feed):
 *   - logado  → eventos das comunidades que a pessoa segue
 *   - sem login ou sem comunidades → so a comunidade geral ("brasil")
 * Assim um evento de comunidade fechada nao vaza pra quem nao participa.
 *
 * Resposta: { events: [{ id, title, starts_at, city, state, community_id }] }
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from '../_lib/businessAuth.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20)

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    let communityIds = []
    const auth = await requireAuthOnly(req, supabase)
    if (auth.ok) {
      const { data: memberships } = await supabase
        .from('bc_community_members').select('community_id').eq('user_id', auth.user.id)
      communityIds = (memberships || []).map(m => m.community_id)
    }
    if (communityIds.length === 0) {
      const { data: general } = await supabase
        .from('bc_communities').select('id').eq('slug', 'brasil').maybeSingle()
      if (general) communityIds.push(general.id)
    }
    if (communityIds.length === 0) return res.status(200).json({ events: [] })

    const { data: posts, error } = await supabase
      .from('bc_posts')
      .select('id, community_id, title, event_date, event_location')
      .in('community_id', communityIds)
      .eq('type', 'event')
      .eq('is_deleted', false)
      .gte('event_date', new Date().toISOString())
      .order('event_date', { ascending: true })
      .limit(limit)
    if (error) throw error

    const { data: communities } = await supabase
      .from('bc_communities').select('id, geo_state').in('id', communityIds)
    const stateOf = {}
    for (const c of communities || []) stateOf[c.id] = c.geo_state || null

    res.setHeader('Cache-Control', 'private, max-age=60')
    return res.status(200).json({
      events: (posts || []).map(p => ({
        id: p.id,
        title: p.title,
        starts_at: p.event_date,
        city: p.event_location || null,
        state: stateOf[p.community_id] || null,
        community_id: p.community_id,
      })),
    })
  } catch (e) {
    console.error('events/list error:', e.message)
    return res.status(500).json({ error: 'Erro ao carregar eventos' })
  }
}
