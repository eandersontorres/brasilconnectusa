/**
 * POST /api/stripe/portal
 * Header: Authorization: Bearer <JWT>
 * Abre o portal de cobranca do Stripe pra profissional trocar de plano,
 * atualizar o cartao ou cancelar.
 *
 * Requer o Customer Portal ativado no painel do Stripe
 * (Settings → Billing → Customer portal).
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

    if (!auth.provider.stripe_customer_id) {
      return res.status(400).json({ error: 'Você ainda não tem assinatura. Escolha um plano primeiro.' })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'

    const session = await stripe.billingPortal.sessions.create({
      customer: auth.provider.stripe_customer_id,
      return_url: `${baseUrl}/assinante`,
    })
    return res.status(200).json({ portal_url: session.url })
  } catch (e) {
    console.error('stripe/portal error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
