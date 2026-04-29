/**
 * GET /api/rates
 * Retorna a taxa BRL/USD ao vivo + links de afiliado.
 * Usado pelo frontend para exibir a taxa e obter os links de afiliado.
 */

const FALLBACK_RATE = 5.10 // atualizar se a API falhar constantemente

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let midRate = null
  let source = 'fallback'

  // Tentar ExchangeRate-API
  const apiKey = process.env.EXCHANGE_RATE_API_KEY
  if (apiKey) {
    try {
      const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/BRL`
      const apiRes = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (apiRes.ok) {
        const data = await apiRes.json()
        if (data.result === 'success' && data.conversion_rate) {
          midRate = data.conversion_rate
          source = 'exchangerate-api'
        }
      }
    } catch (e) {
      console.error('ExchangeRate-API error:', e.message)
    }
  }

  // Fallback: taxa estimada
  if (!midRate) {
    midRate = FALLBACK_RATE
    source = 'fallback'
  }

  // Links de afiliado (retornados ao frontend para uso nos botões)
  const affiliateLinks = {
    AFFILIATE_WISE_LINK:    process.env.AFFILIATE_WISE_LINK    || null,
    AFFILIATE_REMITLY_LINK: process.env.AFFILIATE_REMITLY_LINK || null,
    AFFILIATE_WU_LINK:      process.env.AFFILIATE_WU_LINK      || null,
    AFFILIATE_KAYAK_LINK:   process.env.AFFILIATE_KAYAK_LINK   || null,
  }

  // Cache de 5 minutos
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  return res.status(200).json({
    success: true,
    mid_rate: midRate,
    source,
    timestamp: new Date().toISOString(),
    affiliate_links: affiliateLinks,
  })
}
