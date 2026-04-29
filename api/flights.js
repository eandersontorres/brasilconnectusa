/**
 * GET /api/flights
 * Busca preços de voos via Travelpayouts Data API.
 * Query: origin, destination, depart_date (YYYY-MM), return_date?
 *
 * Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163
 */

// Gera deep link de busca para cada plataforma
function buildFlightLinks(origin, destination, departDate, returnDate, marker, kayakBase) {
  const dep = departDate.slice(0, 7).replace('-', '') // YYYYMM
  const ret = returnDate ? returnDate.slice(0, 7).replace('-', '') : ''

  const links = []

  // Skyscanner via Travelpayouts
  if (marker) {
    const skyscannerBase = `https://www.skyscanner.net/transport/flights/${origin.toLowerCase()}/${destination.toLowerCase()}`
    const url = returnDate
      ? `${skyscannerBase}/${dep}/${ret}/?adultsv2=1&ref=home&associateID=SkyScanner_affiliates&utm_source=travelpayouts&utm_medium=affiliate&utm_campaign=${marker}`
      : `${skyscannerBase}/${dep}/?adultsv2=1&ref=home&utm_source=travelpayouts&utm_medium=affiliate&utm_campaign=${marker}`

    links.push({ provider: 'Skyscanner', url })
  }

  // Google Flights (sem afiliado, mas boa UX)
  const gfl = `https://www.google.com/travel/flights/search?tfs=CBwQAhooEgoyMDI1LTA3LTE1agcIARIDQVVTagcIARIDR1JVGgoyMDI1LTA3LTMwKABAAUgBcAGCAQsI____________AZABAg`
  // Gerar URL correta para Google Flights
  const gDep = departDate
  const gRet = returnDate || ''
  const googleUrl = returnDate
    ? `https://www.google.com/travel/flights/search?q=Flights+${origin}+to+${destination}+${gDep}+${gRet}`
    : `https://www.google.com/travel/flights/search?q=Flights+${origin}+to+${destination}+${gDep}`

  links.push({ provider: 'Google Flights', url: googleUrl })

  // KAYAK
  if (kayakBase) {
    const kayakUrl = returnDate
      ? `${kayakBase}flights/${origin}-${destination}/${departDate}/${returnDate}`
      : `${kayakBase}flights/${origin}-${destination}/${departDate}`
    links.push({ provider: 'KAYAK', url: kayakUrl })
  }

  return links
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { origin, destination, depart_date, return_date } = req.query || {}

  if (!origin || !destination || !depart_date) {
    return res.status(400).json({ error: 'origin, destination e depart_date são obrigatórios' })
  }

  const token = process.env.TRAVELPAYOUTS_TOKEN
  const marker = process.env.TRAVELPAYOUTS_MARKER
  const kayakBase = process.env.AFFILIATE_KAYAK_LINK || ''

  let results = []

  // Tentar Travelpayouts Prices API (month)
  if (token) {
    try {
      const monthYear = depart_date.slice(0, 7) // YYYY-MM
      const url = `https://api.travelpayouts.com/v1/prices/cheap?origin=${origin}&destination=${destination}&depart_date=${monthYear}&currency=usd&token=${token}`
      const apiRes = await fetch(url, { signal: AbortSignal.timeout(7000) })

      if (apiRes.ok) {
        const data = await apiRes.json()

        if (data.success && data.data) {
          const destData = data.data[destination] || {}
          const entries = Object.values(destData)

          results = entries
            .sort((a, b) => a.price - b.price)
            .slice(0, 5)
            .map(f => ({
              airline: f.airline || 'Diversas',
              price: f.price,
              stops: f.transfers || 0,
              depart_date: f.departure_at ? f.departure_at.split('T')[0] : depart_date,
              links: buildFlightLinks(origin, destination, depart_date, return_date, marker, kayakBase),
            }))
        }
      }
    } catch (e) {
      console.error('Travelpayouts error:', e.message)
    }
  }

  // Fallback: mostrar links para busca manual
  if (results.length === 0) {
    results = [
      {
        airline: 'Compare nos principais sites',
        price: null,
        stops: null,
        depart_date,
        links: buildFlightLinks(origin, destination, depart_date, return_date, marker, kayakBase),
      },
    ]
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300')

  return res.status(200).json({
    success: true,
    origin,
    destination,
    depart_date,
    return_date: return_date || null,
    results,
  })
}
