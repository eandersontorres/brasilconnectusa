/**
 * GET /api/agenda/provider?slug=ana-torres   - publico (com servicos + reviews)
 * GET /api/agenda/provider?email=foo@bar.com - dono (basico, sem reviews; pra paineis)
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { slug, email } = req.query
  if (!slug && !email) return res.status(400).json({ error: 'slug ou email obrigatorio' })

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    if (email) {
      const { data: provider, error } = await supabase
        .from('ag_providers')
        .select('id, name, email, slug, specialty, bio, city, state, avatar_url, cover_color, cover_url, gallery_urls, video_url, instagram, whatsapp, plan, plan_status, current_period_end, active')
        .eq('email', String(email).toLowerCase())
        .maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ provider: provider || null })
    }

    const { data: provider, error } = await supabase
      .from('ag_providers')
      .select('id, name, slug, specialty, bio, city, state, avatar_url, cover_color, plan, plan_status')
      .eq('slug', slug.toLowerCase())
      .eq('active', true)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    if (!provider) return res.status(404).json({ error: 'Profissional nao encontrada' })

    const { data: services } = await supabase
      .from('ag_services')
      .select('id, name, category, description, duration_min, price_cents, deposit_cents')
      .eq('provider_id', provider.id)
      .eq('active', true)
      .order('display_order', { ascending: true })

    const { data: reviewAgg } = await supabase
      .from('ag_reviews')
      .select('rating')
      .eq('provider_id', provider.id)
      .eq('is_published', true)

    const reviews = reviewAgg || []
    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({
      provider,
      services: services || [],
      reviews: { count: reviews.length, average: avgRating },
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
