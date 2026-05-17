/**
 * GET /api/remittance/providers
 *
 * Lista providers de remessa USA → Brasil com metadata pro frontend.
 * Não chama API externa — só lê do registry.
 *
 * Query:
 *   payout — filtro opcional (pix | bank_transfer | cash_pickup)
 *
 * Resposta:
 *   {
 *     providers: [
 *       { id, name, logo, fx_margin, flat_fee_usd, payout, payin,
 *         speed_hours, has_api, configured, go_url }, ...
 *     ]
 *   }
 */

import { getUsaToBrazilPartners } from '../_lib/partners-remittance.js'

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const payoutFilter = (req.query.payout || '').toLowerCase().trim()

  const partners = getUsaToBrazilPartners()
    .filter(p => !payoutFilter || p.payout.includes(payoutFilter))
    .map(p => ({
      id: p.id,
      name: p.name,
      logo: p.logo,
      fx_margin: p.fx_margin,
      flat_fee_usd: p.flat_fee_usd,
      pct_fee: p.pct_fee,
      payout: p.payout,
      payin: p.payin,
      speed_hours: p.speed_hours,
      has_api: p.api?.mode === 'live',
      configured: Boolean(process.env[p.env]) &&
                  !String(process.env[p.env] || '').includes('placeholder'),
      affiliate_program: p.affiliate_program,
      notes: p.notes || null,
      go_url: `/go/${p.id}?utm_source=providers_list&utm_medium=api`,
    }))

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300')

  return res.status(200).json({
    success: true,
    count: partners.length,
    payout_filter: payoutFilter || null,
    providers: partners,
  })
}
