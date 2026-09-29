/**
 * POST /api/stripe/subscribe
 * Header: Authorization: Bearer <JWT>  (a profissional assina o PROPRIO perfil)
 * Body: { plan: 'starter'|'pro'|'premium' }
 * Cria Checkout Session de assinatura recorrente com trial de 14 dias.
 *
 * Quem ja tem assinatura troca de plano pelo portal (/api/stripe/portal):
 * abrir outro checkout criaria uma segunda assinatura.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth, planActive } from '../_lib/providerAuth.js'

const PLAN_TO_PRICE = {
  starter: 'STRIPE_PRICE_STARTER',
  pro:     'STRIPE_PRICE_PRO',
  premium: 'STRIPE_PRICE_PREMIUM',
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  const { plan } = req.body || {}
  if (!plan || !PLAN_TO_PRICE[plan]) {
    return res.status(400).json({ error: 'plan (starter/pro/premium) obrigatório' })
  }

  const priceId = process.env[PLAN_TO_PRICE[plan]]
  if (!priceId) return res.status(500).json({ error: `Price ID do plano ${plan} não configurado` })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider

    if (provider.stripe_subscription_id && planActive(provider)) {
      return res.status(409).json({
        use_portal: true,
        error: 'Você já tem uma assinatura. Troque de plano pelo portal de cobrança.',
      })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'
    const meta = { provider_id: provider.id, plan, type: 'subscription' }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: provider.stripe_customer_id || undefined,
      customer_email: provider.stripe_customer_id ? undefined : provider.email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14, metadata: meta },
      metadata: meta,
      success_url: `${baseUrl}/assinante?subscribed=1`,
      cancel_url: `${baseUrl}/agenda/planos`,
    })

    return res.status(200).json({ checkout_url: session.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
