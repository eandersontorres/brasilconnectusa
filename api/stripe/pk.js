/**
 * GET /api/stripe/pk
 * Retorna a publishable key do Stripe (segura pra expor no frontend).
 * Frontend usa pra inicializar Stripe.js + Elements.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const pk = process.env.STRIPE_PUBLISHABLE_KEY || null
  if (!pk) return res.status(500).json({ error: 'STRIPE_PUBLISHABLE_KEY nao configurada no Vercel' })

  return res.status(200).json({
    publishable_key: pk,
    mode: pk.startsWith('pk_test_') ? 'test' : 'live',
  })
}
