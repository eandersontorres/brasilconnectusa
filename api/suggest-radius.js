/**
 * GET /api/suggest-radius?city=Boston&state=MA
 * Retorna raio sugerido em milhas baseado em densidade da comunidade brasileira.
 */
import { suggestRadius, radiusLabel } from './_lib/cityPresets.js'

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { city, state } = req.query
  const miles = suggestRadius(city, state)

  res.setHeader('Cache-Control', 'public, max-age=86400')
  return res.status(200).json({
    suggested_miles: miles,
    label: radiusLabel(miles),
    reason: miles === 10 ? 'Cidade muito densa — comunidade local em raio pequeno'
          : miles === 25 ? 'Cidade grande com suburbios ativos'
          : miles === 50 ? 'Cidade media — raio moderado pega comunidade'
          : 'Area menos densa — raio maior pra encontrar mais brasileiros',
  })
}
