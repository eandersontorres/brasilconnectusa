/**
 * GET /api/flights/search   (v2 — supersede de /api/flights)
 *
 * Busca voos USA <-> Brasil agregando multiplas fontes.
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
 *   1. Travelpayouts Cheap (cached month price) -> tem preco aproximado
 *   2. Deeplinks por cia                        -> ultimo recurso, sem preco
 *
 * Nota: Amadeus Self-Service foi removido em 2026-05 (portal sera desligado
 * em 2026-07-17). Reavaliar Duffel/Kiwi quando houver volume.
 *
 * Resposta:
 *   {
 *     source, results: [{
 *       airline_iata, airline_name, airline_logo,
 *       price_usd, currency, stops, duration_minutes,
 *       depart_at, arrive_at, deep_links: [{ provider, url }]
 *     }],
 *     cheapest: { price_usd, airline_iata }
 *   }
 */

import { AIRLINE_BY_IATA, lookupAirline, buildAirlineDeepLink } from '../_lib/partners-airlines.js'

/* ─────────────────────────────────────────────────────────────────
 * Travelpayouts Cheap — preco agregado por mes
 * Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163
 * ───────────────────────────────────────────────────────────────── */

async function searchTravelpayouts({ origin, destination, departDate, returnDate }) {
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
          price_is_monthly_low: true, // Travelpayouts retorna o mais barato do mes, nao do dia
          deep_links: [
            {
              provider: airline.name_pt || iata,
              url: buildAirlineDeepLink(iata, origin, destination, departDate, returnDate),
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

  // 1a tentativa: Travelpayouts (preco aproximado, agregado mensal)
  const tp = await searchTravelpayouts({ origin: o, destination: d, departDate: depart_date, returnDate: return_date })
  if (tp && tp.length > 0) {
    results = tp
    source = 'travelpayouts'
  }

  // 2a: so deeplinks por cia — pelo menos o usuario consegue ir comparar
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
