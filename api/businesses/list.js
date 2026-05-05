/**
 * GET /api/businesses/list
 * Query params:
 *   category, state, city, q, sort, owner_email, status
 *   user_id (opcional) — se presente, filtra por raio do user (usa lat/lng + radius_miles)
 *   limit (default 100)
 */
import { createClient } from '@supabase/supabase-js'

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const { category, state, city, q, sort, owner_email, status, user_id, limit = 100 } = req.query

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    // Se for filtro pra dono ver os proprios negocios (admin/painel), usa tabela direta
    const useTable = owner_email || status ? 'bc_businesses' : 'bc_businesses_public'
    let query = supabase.from(useTable).select('*')

    if (category)    query = query.eq('category', category)
    if (state)       query = query.eq('state', state)
    if (city)        query = query.ilike('city', `%${city}%`)
    if (q)           query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`)
    if (owner_email) query = query.eq('owner_email', String(owner_email).toLowerCase().trim())
    if (status)      query = query.eq('status', status)

    if (sort === 'rating')      query = query.order('rating_avg', { ascending: false, nullsFirst: false })
    else if (sort === 'newest') query = query.order('created_at', { ascending: false })

    const { data, error } = await query.limit(Number(limit))
    if (error) return res.status(500).json({ error: error.message })

    let businesses = data || []

    // === Filtro por raio (so se user_id fornecido) ===
    let userMeta = null
    if (user_id) {
      const { data: profile } = await supabase
        .from('bc_profiles')
        .select('latitude, longitude, radius_miles, state')
        .eq('user_id', user_id)
        .maybeSingle()

      if (profile) {
        userMeta = profile
        const radius = profile.radius_miles
        const userLat = profile.latitude != null ? Number(profile.latitude) : null
        const userLng = profile.longitude != null ? Number(profile.longitude) : null

        // 9999 ou null = nacional, sem filtro
        if (radius != null && radius !== 9999) {
          businesses = businesses.filter(b => {
            // 999 = estado todo
            if (radius === 999) {
              if (!profile.state || !b.state) return true
              return b.state === profile.state
            }
            // Raio em milhas
            if (userLat != null && userLng != null && b.latitude != null && b.longitude != null) {
              const dist = haversineMiles(userLat, userLng, Number(b.latitude), Number(b.longitude))
              return dist <= (radius || 25)
            }
            // Sem coords nos 2 lados: fallback estado
            if (profile.state && b.state) return b.state === profile.state
            return true
          })
        }
      }
    }

    res.setHeader('Cache-Control', user_id ? 'private, max-age=30' : 's-maxage=120')
    return res.status(200).json({
      businesses,
      filter: user_id ? {
        radius_miles: userMeta?.radius_miles,
        has_location: userMeta?.latitude != null,
        state: userMeta?.state,
      } : null,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
