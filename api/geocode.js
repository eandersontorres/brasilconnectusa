/**
 * GET /api/geocode?city=Boston&state=MA
 * Retorna { latitude, longitude } com cache no Supabase.
 * Source: OpenStreetMap Nominatim (free, sem key, rate-limit 1/s).
 *
 * POST /api/geocode (interno) — pre-popula cache em batch
 * Body: { cities: [{ city, state }] }
 */
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from './_lib/rateLimit.js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

function normalize(s) {
  return String(s || '').trim().toLowerCase()
}

async function geocodeNominatim(city, state) {
  const q = encodeURIComponent(city + ', ' + state + ', United States')
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&countrycodes=us&limit=1`

  const r = await fetch(url, {
    headers: {
      'User-Agent': 'BrasilConnectUSA/1.0 (oi@brasilconnectusa.com)',
      'Accept-Language': 'en',
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error('Nominatim status ' + r.status)
  const data = await r.json()
  if (!Array.isArray(data) || data.length === 0) return null
  const hit = data[0]
  return {
    latitude:  parseFloat(hit.lat),
    longitude: parseFloat(hit.lon),
    display:   hit.display_name,
  }
}

export async function geocodeWithCache(city, state) {
  if (!city || !state) return null
  const cityNorm = normalize(city)
  const stateNorm = String(state).toUpperCase().trim().slice(0, 2)
  if (!cityNorm || !stateNorm) return null

  const supabase = getSupabase()

  // 1. Tenta cache
  const { data: cached } = await supabase
    .from('bc_geocode_cache')
    .select('latitude, longitude, display')
    .eq('city_norm', cityNorm)
    .eq('state_norm', stateNorm)
    .eq('country', 'USA')
    .maybeSingle()

  if (cached?.latitude != null) {
    // bump hit counter (best effort, no await)
    supabase.rpc('increment_geocode_hits', { city_in: cityNorm, state_in: stateNorm }).catch(() => {})
    return { latitude: cached.latitude, longitude: cached.longitude, display: cached.display, cached: true }
  }

  // 2. Geocoding live
  const result = await geocodeNominatim(city, stateNorm)
  if (!result) return null

  // 3. Salva no cache (best effort)
  await supabase.from('bc_geocode_cache').upsert({
    city_norm: cityNorm,
    state_norm: stateNorm,
    country: 'USA',
    display: result.display,
    latitude: result.latitude,
    longitude: result.longitude,
    source: 'nominatim',
  }, { onConflict: 'city_norm,state_norm,country' })

  return { ...result, cached: false }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const _rl = rateLimit(req, { windowMs: 60000, max: 30 })
  if (_rl) return res.status(429).json({ error: 'Muitas requisicoes. Tenta de novo em ' + _rl.retryAfter + 's.' })

  if (req.method === 'GET') {
    const { city, state } = req.query
    if (!city || !state) return res.status(400).json({ error: 'city e state obrigatorios' })

    try {
      const result = await geocodeWithCache(city, state)
      if (!result) return res.status(404).json({ error: 'Nao foi possivel geocodificar' })

      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      return res.status(200).json({ success: true, ...result })
    } catch (e) {
      console.error('geocode error:', e.message)
      return res.status(500).json({ error: 'Erro: ' + e.message })
    }
  }

  if (req.method === 'POST') {
    // Batch geocoding (interno, admin only)
    const adminSecret = req.headers['x-admin-secret']
    if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { cities = [] } = req.body || {}
    const results = []
    for (const c of cities.slice(0, 50)) {
      try {
        const r = await geocodeWithCache(c.city, c.state)
        results.push({ city: c.city, state: c.state, ...r })
        // Respeitar rate-limit 1/s do Nominatim
        if (!r?.cached) await new Promise(r => setTimeout(r, 1100))
      } catch (e) {
        results.push({ city: c.city, state: c.state, error: e.message })
      }
    }
    return res.status(200).json({ success: true, results })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
