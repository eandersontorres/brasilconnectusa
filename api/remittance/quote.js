/**
 * GET /api/remittance/quote
 *
 * Agregador de cotações USA → Brasil.
 *
 * Query params:
 *   amount_usd   — valor a enviar (number, default 500)
 *   payout       — método de saque preferido (pix | bank_transfer | cash_pickup)
 *   ttl_minutes  — cache TTL pro mid-rate (default 5)
 *
 * Resposta:
 *   {
 *     amount_usd, mid_rate, source,
 *     quotes: [
 *       { partner_id, name, logo, brl_received, effective_rate,
 *         fee_usd, fx_margin, speed_hours, source: 'live'|'estimated',
 *         go_url, payout_methods }, ...
 *     ],
 *     best: { partner_id, brl_received }
 *   }
 *
 * Estratégia por parceiro:
 *   - wise        → API pública (api.wise.com/v3/quotes)
 *   - resto       → mid-rate * (1 - fx_margin) - fee, conforme partner registry
 *
 * Em produção tudo é cacheado 5min via Cache-Control.
 */

import { getUsaToBrazilPartners, estimateQuote, PARTNER_BY_ID } from '../_lib/partners-remittance.js'

const FALLBACK_MID_RATE = 5.10

async function fetchMidRate() {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY
  if (!apiKey) return { rate: FALLBACK_MID_RATE, source: 'fallback' }

  try {
    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/BRL`
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = await r.json()
    if (d.result === 'success' && d.conversion_rate) {
      return { rate: d.conversion_rate, source: 'exchangerate-api' }
    }
  } catch (e) {
    console.error('mid rate fetch error:', e.message)
  }
  return { rate: FALLBACK_MID_RATE, source: 'fallback' }
}

/**
 * Wise tem API pública de quote (sem auth pra simulação simples).
 * Docs: https://docs.wise.com/api-docs/api-reference/quote
 * Endpoint não-autenticado: POST /v3/quotes (com sourceAmount, sourceCurrency, targetCurrency)
 * Retorna fee, rate, targetAmount real.
 */
async function fetchWiseQuote(amountUsd) {
  // Wise exige token mesmo pra simulação básica em produção.
  // Sem token, retornamos null e o caller usa fallback estimated.
  const token = process.env.WISE_API_TOKEN
  if (!token) return null

  try {
    const r = await fetch('https://api.wise.com/v3/quotes', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceAmount: amountUsd,
        sourceCurrency: 'USD',
        targetCurrency: 'BRL',
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) {
      console.error('Wise quote HTTP', r.status, await r.text().catch(() => ''))
      return null
    }
    const d = await r.json()
    // Wise retorna { rate, fee, targetAmount, ... }
    return {
      brl_received: d.targetAmount,
      effective_rate: d.rate,
      fee_usd: d.fee,
      source: 'live',
    }
  } catch (e) {
    console.error('Wise quote error:', e.message)
    return null
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const amountUsd = Math.max(10, Math.min(50000, Number(req.query.amount_usd) || 500))
  const payoutFilter = (req.query.payout || '').toLowerCase().trim()

  const { rate: midRate, source: rateSource } = await fetchMidRate()

  // Filtra parceiros que suportam o payout solicitado (se vier filtro)
  const partners = getUsaToBrazilPartners().filter(p => {
    if (!payoutFilter) return true
    return p.payout.includes(payoutFilter)
  })

  // Roda quotes em paralelo
  const quotes = await Promise.all(partners.map(async (p) => {
    let quote = null
    if (p.id === 'wise' && p.api?.mode === 'live') {
      quote = await fetchWiseQuote(amountUsd)
    }
    if (!quote) {
      quote = { ...estimateQuote(p, amountUsd, midRate), source: 'estimated' }
    }
    return {
      partner_id: p.id,
      name: p.name,
      logo: p.logo,
      brl_received: quote.brl_received,
      effective_rate: quote.effective_rate,
      fee_usd: quote.fee_usd,
      fx_margin: p.fx_margin,
      speed_hours: p.speed_hours,
      payout_methods: p.payout,
      payin_methods: p.payin,
      source: quote.source,
      go_url: `/go/${p.id}?utm_source=quote&utm_medium=api&amount=${amountUsd}`,
    }
  }))

  // Ordena por BRL recebido (maior é melhor)
  quotes.sort((a, b) => b.brl_received - a.brl_received)

  const best = quotes[0] ? { partner_id: quotes[0].partner_id, brl_received: quotes[0].brl_received } : null

  // Cache curto — taxa muda
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  return res.status(200).json({
    success: true,
    amount_usd: amountUsd,
    mid_rate: midRate,
    rate_source: rateSource,
    payout_filter: payoutFilter || null,
    quotes,
    best,
    fetched_at: new Date().toISOString(),
  })
}
