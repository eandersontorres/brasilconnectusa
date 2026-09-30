/**
 * POST /api/admin/geocode-backfill
 * Header: x-admin-secret
 *
 * Encontra comunidades sem lat/lng (que tem geo_city + geo_state) e geocoda em batch.
 * Respeita rate-limit do Nominatim (1 req/s).
 *
 * Query: ?limit=20 (default 20, max 50 — pra evitar timeout)
 */
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '../_lib/adminAuth.js'
import { geocodeWithCache } from '../geocode.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const admin = await requireAdmin(req)
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error })

  const limit = Math.min(50, Number(req.query.limit) || 20)

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { data: pending, error } = await supabase
      .from('bc_communities')
      .select('id, slug, name, geo_city, geo_state')
      .is('latitude', null)
      .not('geo_city', 'is', null)
      .not('geo_state', 'is', null)
      .limit(limit)

    if (error) throw error
    if (!pending?.length) return res.status(200).json({ success: true, message: 'Nenhuma pendente.', processed: 0 })

    const results = []
    for (const c of pending) {
      try {
        const geo = await geocodeWithCache(c.geo_city, c.geo_state)
        if (geo) {
          await supabase
            .from('bc_communities')
            .update({ latitude: geo.latitude, longitude: geo.longitude })
            .eq('id', c.id)
          results.push({ slug: c.slug, name: c.name, ok: true, cached: geo.cached })
        } else {
          results.push({ slug: c.slug, name: c.name, ok: false, error: 'no result' })
        }
        // Rate limit Nominatim 1/s (so se nao foi cache hit)
        if (!geo?.cached) await new Promise(r => setTimeout(r, 1100))
      } catch (e) {
        results.push({ slug: c.slug, name: c.name, ok: false, error: e.message })
      }
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      ok_count: results.filter(r => r.ok).length,
      results,
    })
  } catch (e) {
    console.error('geocode-backfill error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
