/**
 * GET /api/stripe/status
 * Retorna se Stripe esta em TEST mode ou LIVE mode (sem expor a chave).
 * Frontend usa pra mostrar banner amarelo "Modo teste" se necessario.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const key = process.env.STRIPE_SECRET_KEY || ''
  const configured = key.startsWith('sk_test_') || key.startsWith('sk_live_')

  return res.status(200).json({
    configured,
    mode: key.startsWith('sk_test_') ? 'test' : (key.startsWith('sk_live_') ? 'live' : 'none'),
    has_starter: !!process.env.STRIPE_PRICE_STARTER,
    has_pro:     !!process.env.STRIPE_PRICE_PRO,
    has_premium:   !!process.env.STRIPE_PRICE_PREMIUM,
    has_webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
  })
}
