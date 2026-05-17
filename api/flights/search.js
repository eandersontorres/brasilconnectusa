/**
 * GET /api/flights/search   (v2 — supersede de /api/flights)
 *
 * Busca voos USA ⇄ Brasil agregando múltiplas fontes.
 *
 * Query:
 *   origin           — IATA (ex: MIA)
 *   destination      — IATA (ex: GRU)
 *   depart_date      — YYYY-MM-DD
 *   return_date?     — YYYY-MM-DD (opcional, one-way se omitido)
 *   adults?          — default 1
 *   cabin?           — economy | premium_economy | business | first
 *   currency?        — default USD
 *
 * Fontes (tentadas em ordem):
 *   1. Amadeus Self-Service API (live shopping)  → tem preço real
 *   2. Travelpayouts Cheap (cached month price)  → fallback histórico
 *   3. Deeplinks só (sem preço)                  → último recurso
 *
 * Resposta:
 *   {
 *     source, results: [{
 *       airline_iata, airline_name, airline_logo,
 *       price_usd, currency, stops, duration_minutes,
 *       depart_at, arrive_at, deep_links: [{ provider, url }]
 *     }],
 *     deep_links_per_airline: [...],
 *     cheapest: { price_usd, airline_iata }
 *   }
 */

import { AIRLINE_BY_IATA, lookupAirline, buildAirlineDeepLink } from '../_lib/partners-airlines.js'

/* ─────────────────────────────────────────────────────────────────
 * Amadeus Self-Service — OAuth2 client_credentials + flight-offers
 * Docs: https://developers.amadeus.com/self-service/category/flights
 * ───────────────────────────────────────────────────────────────── */

let cachedAmadeusToken = null
let cachedAmadeusExpiry = 0

async function getAmadeusToken() {
  const id = process.env.AMADEUS_CLIENT_ID
  const secret = process.env.AMADEUS_CLIENT_SECRET
  if (!id || !secret) return null

  // Reaproveita token cached por até 25min
  if (cachedAmadeusToken && Date.now() < cachedAmadeusExpiry) {
    return cachedAmadeusToken
  }

  const host = process.env.AMADEUS_HOST || 'test.api.amadeus.com' // test ou production
  try {
    const r = await fetch(`https://${host}/v1/security/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) {
      console.error('Amadeus auth fail', r.status)
      return null
    }
    const d = await r.json()
    cachedAmadeusToken = d.access_token
    // d.expires_in normalmente é 1799s. Cacheamos por 25min com margem.
    cachedAmadeusExpiry = Date.now() + Math.max(60_000, (d.expires_in - 300) * 1000)
    return cachedAmadeusToken
  } catch (e) {
    console.error('Amadeus token error:', e.message)
    return null
  }
}

async function searchAmadeus({ origin, destination, departDate, returnDate, adults, cabin, currency }) {
  const token = await getAmadeusToken()
  if (!token) return null

  const host = process.env.AMADEUS_HOST || 'test.api.amadeus.com'
  const params = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: departDate,
    adults: String(adults || 1),
    max: '15',
    currencyCode: currency || 'USD',
    nonStop: 'false',
  })
  if (returnDate) params.set('returnDate', returnDate)
  if (cabin) {
    const map = {
      economy: 'ECONOMY',
      premium_economy: 'PREMIUM_ECONOMY',
      business: 'BUSINESS',
      first: 'FIRST',
    }
    if (map[cabin]) params.set('travelClass', map[cabin])
  }

  try {
    const r = await fetch(`https://${host}/v2/shopping/flight-offers?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(9000),
    })
    if (!r.ok) {
      console.error('Amadeus search HTTP', r.status, (await r.text().catch(() => '')).slice(0, 300))
      return null
    }
    const d = await r.json()
    if (!d.data?.length) return []

    return d.data.slice(0, 10).map(offer => {
      const seg0 = offer.itineraries?.[0]?.segments?.[0] || {}
      const segLast = offer.itineraries?.[0]?.segments?.slice(-1)[0] || {}
      const iata = seg0.carrierCode || offer.validatingAirlineCodes?.[0] || ''
      const airline = lookupAirline(iata)
      const stops = (offer.itineraries?.[0]?.segments?.length || 1) - 1
      return {
        airline_iata: iata,
        airline_name: airline.name_pt || airline.name || iata,
        airline_logo: airline.logo,
        price_usd: parseFloat(offer.price?.grandTotal || offer.price?.total || 0),
        currency: offer.price?.currency || 'USD',
        stops,
        depart_at: seg0.departure?.at || null,
        arrive_at: segLast.arrival?.at || null,
        duration: offer.itineraries?.[0]?.duration || null,
        deep_links: [
          {
            provider: airline.name_pt || iata,
            url: buildAirlineDeepLink(iata, origin, destination, departDate, returnDate),
          },
        ].filter(l => l.url),
      }
    })
  } catch (e) {
    console.error('Amadeus search error:', e.message)
    return null
  }
}

/* ─────────────────────────────────────────────────────────────────
 * Travelpayouts Cheap (fallback) — já existia em api/flights.js
 * ───────────────────────────────────────────────────────────────── */

async function searchTravelpayouts({ origin, destination, departDate }) {
  const token = process.env.TRAVELPAYOUTS_TOKEN
  if (!token) return null

  try {
    const monthYear = departDate.slice(0, 7)
    const url = `https://api.travelpayouts.com/v1/prices/cheap?origin=${origin}&destination=${destination}&depart_date=${monthYear}&currency=usd&token=${token}`
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) })
    if (!r.ok) return null
    const d = await r.json()
    if (!d.success || !d.data) return null

    const destData = d.data[destination] || {}
    return Object.values(destData)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5)
      .map(f => {
        const iata = f.airline || ''
        const airline = lookupAirline(iata)
        return {
          airline_iata: iata,
          airline_name: airline.name_pt || iata,
          airline_logo: airline.logo,
          price_usd: f.price,
          currency: 'USD',
          stops: f.transfers || 0,
          depart_at: f.departure_at || null,
          arrive_at: f.return_at || null,
          deep_links: [
            {
              provider: airline.name_pt || iata,
              url: buildAirlineDeepLink(iata, origin, destination, departDate),
            },
          ].filter(l => l.url),
        }
      })
  } catch (e) {
    console.error('Travelpayouts error:', e.message)
    return null
  }
}

/* ─────────────────────────────────────────────────────────────────
 * Handler
 * ───────────────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { origin, destination, depart_date, return_date, adults, cabin, currency } = req.query || {}
  if (!origin || !destination || !depart_date) {
    return res.status(400).json({ error: 'origin, destination, depart_date são obrigatórios' })
  }

  const o = String(origin).toUpperCase()
  const d = String(destination).toUpperCase()

  let source = null
  let results = []

  // 1ª tentativa: Amadeus
  const amadeus = await searchAmadeus({
    origin: o, destination: d,
    departDate: depart_date,
    returnDate: return_date,
    adults, cabin, currency,
  })
  if (amadeus && amadeus.length > 0) {
    results = amadeus
    source = 'amadeus'
  }

  // 2ª tentativa: Travelpayouts
  if (!results.length) {
    const tp = await searchTravelpayouts({ origin: o, destination: d, departDate: depart_date })
    if (tp && tp.length > 0) {
      results = tp
      source = 'travelpayouts'
    }
  }

  // 3ª: só deeplinks — pelo menos o usuário consegue ir comparar
  if (!results.length) {
    const candidateAirlines = ['LA', 'G3', 'AD', 'AA', 'UA', 'DL', 'CM', 'TP']
    results = candidateAirlines
      .map(iata => {
        const url = buildAirlineDeepLink(iata, o, d, depart_date, return_date)
        if (!url) return null
        const a = AIRLINE_BY_IATA[iata]
        return {
          airline_iata: iata,
          airline_name: a.name_pt,
          airline_logo: a.logo,
          price_usd: null,
          currency: 'USD',
          stops: null,
          deep_links: [{ provider: a.name_pt, url }],
        }
      })
      .filter(Boolean)
    source = 'deeplinks_only'
  }

  const priced = results.filter(r => r.price_usd != null)
  const cheapest = priced.length
    ? priced.reduce((a, b) => a.price_usd <= b.price_usd ? a : b)
    : null

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300')

  return res.status(200).json({
    success: true,
    source,
    origin: o,
    destination: d,
    depart_date,
    return_date: return_date || null,
    adults: Number(adults) || 1,
    cabin: cabin || 'economy',
    currency: currency || 'USD',
    cheapest: cheapest ? { price_usd: cheapest.price_usd, airline_iata: cheapest.airline_iata } : null,
    results,
    fetched_at: new Date().toISOString(),
  })
}
