/**
 * GET /api/flights/airlines
 *
 * Lista companhias aéreas que voam Brasil ⇄ USA com metadata pro frontend.
 * Não chama API externa — lê do registry.
 *
 * Query:
 *   route_origin?       — filtra cias que servem essa origem (IATA)
 *   route_destination?  — filtra cias que servem esse destino (IATA)
 *   alliance?           — oneworld | star_alliance | skyteam
 *
 * Resposta:
 *   {
 *     count, airlines: [{
 *       iata, id, name, name_pt, logo, country, alliance,
 *       hubs_us, hubs_br, direct_routes, deep_link_pattern
 *     }]
 *   }
 */

import { AIRLINES } from '../_lib/partners-airlines.js'

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const origin = (req.query.route_origin || '').toUpperCase().trim()
  const destination = (req.query.route_destination || '').toUpperCase().trim()
  const alliance = (req.query.alliance || '').toLowerCase().trim()

  let airlines = AIRLINES

  if (origin) {
    airlines = airlines.filter(a =>
      a.hubs_us.includes(origin) ||
      a.hubs_br.includes(origin) ||
      a.direct_routes.some(([o]) => o === origin),
    )
  }
  if (destination) {
    airlines = airlines.filter(a =>
      a.hubs_us.includes(destination) ||
      a.hubs_br.includes(destination) ||
      a.direct_routes.some(([, dst]) => dst === destination),
    )
  }
  if (alliance) {
    airlines = airlines.filter(a => a.has_alliance === alliance)
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')

  return res.status(200).json({
    success: true,
    count: airlines.length,
    filters: { origin: origin || null, destination: destination || null, alliance: alliance || null },
    airlines: airlines.map(a => ({
      iata: a.iata,
      icao: a.icao,
      id: a.id,
      name: a.name,
      name_pt: a.name_pt,
      logo: a.logo,
      country: a.country,
      alliance: a.has_alliance,
      hubs_us: a.hubs_us,
      hubs_br: a.hubs_br,
      direct_routes: a.direct_routes,
      booking_classes: a.booking_class_pt,
      notes: a.notes || null,
    })),
  })
}
