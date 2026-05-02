/**
 * GET /api/agenda/provider?slug=ana-torres
 * Retorna dados públicos da profissional + serviços ativos.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { slug } = req.query
  if (!slug) return res.status(400).json({ error: 'slug obrigatório' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: provider, error } = await supabase
      .from('ag_providers')
      .select('id, name, slug, specialty, bio, city, state, avatar_url, cover_color, plan, plan_status')
      .eq('slug', slug.toLowerCase())
      .eq('active', true)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    if (!provider) return res.status(404).json({ error: 'Profissional não encontrada' })

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
    const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null

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
