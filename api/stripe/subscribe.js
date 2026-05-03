/**
 * POST /api/stripe/subscribe
 * Body: { provider_id, plan: 'starter'|'pro'|'premium' }
 * Cria Checkout Session de assinatura recorrente com trial de 14 dias.
 */
import { createClient } from '@supabase/supabase-js'

const PLAN_TO_PRICE = {
  starter: 'STRIPE_PRICE_STARTER',
  pro:     'STRIPE_PRICE_PRO',
  premium:   'STRIPE_PRICE_PREMIUM',
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  const { provider_id, plan } = req.body || {}
  if (!provider_id || !plan || !PLAN_TO_PRICE[plan]) {
    return res.status(400).json({ error: 'provider_id e plan (starter/pro/premium) obrigatórios' })
  }

  const priceId = process.env[PLAN_TO_PRICE[plan]]
  if (!priceId) return res.status(500).json({ error: `Price ID do plano ${plan} não configurado` })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: provider } = await supabase.from('ag_providers').select('email,name,slug,stripe_customer_id').eq('id', provider_id).single()
    if (!provider) return res.status(404).json({ error: 'Profissional não encontrado' })

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: provider.stripe_customer_id || undefined,
      customer_email: provider.stripe_customer_id ? undefined : provider.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      metadata: { provider_id, plan, type: 'subscription' },
      success_url: `${baseUrl}/agenda/${provider.slug}?subscribed=1`,
      cancel_url: `${baseUrl}/agenda/${provider.slug}/planos`,
    })

    return res.status(200).json({ checkout_url: session.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
