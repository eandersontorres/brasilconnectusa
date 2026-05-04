/**
 * GET /api/restaurant/status?business_id=UUID
 * Retorna status do Stripe Connect do negocio + capabilities.
 * Auto-sincroniza com Stripe se ja tem account_id.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { business_id } = req.query
  if (!business_id) return res.status(400).json({ error: 'business_id obrigatorio' })

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { data: biz, error } = await supabase
      .from('bc_businesses')
      .select('id, name, slug, stripe_account_id, stripe_onboarded, stripe_charges_enabled, stripe_payouts_enabled, accepts_orders')
      .eq('id', business_id)
      .single()

    if (error || !biz) return res.status(404).json({ error: 'Negocio nao encontrado' })

    let liveStatus = null

    // Se tem account_id, busca status atualizado da Stripe
    if (biz.stripe_account_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
        const acc = await stripe.accounts.retrieve(biz.stripe_account_id)

        liveStatus = {
          charges_enabled: acc.charges_enabled,
          payouts_enabled: acc.payouts_enabled,
          details_submitted: acc.details_submitted,
          requirements_disabled_reason: acc.requirements?.disabled_reason || null,
          requirements_pending: (acc.requirements?.currently_due || []).length,
        }

        // Sincroniza com nosso DB se mudou
        if (
          acc.charges_enabled !== biz.stripe_charges_enabled ||
          acc.payouts_enabled !== biz.stripe_payouts_enabled ||
          acc.details_submitted !== biz.stripe_onboarded
        ) {
          await supabase.from('bc_businesses').update({
            stripe_onboarded: acc.details_submitted,
            stripe_charges_enabled: acc.charges_enabled,
            stripe_payouts_enabled: acc.payouts_enabled,
          }).eq('id', business_id)
        }
      } catch (e) {
        console.error('stripe retrieve error:', e.message)
      }
    }

    return res.status(200).json({
      success: true,
      business: {
        id: biz.id,
        name: biz.name,
        slug: biz.slug,
        accepts_orders: biz.accepts_orders,
        has_stripe_account: !!biz.stripe_account_id,
        stripe_onboarded: liveStatus?.details_submitted ?? biz.stripe_onboarded,
        ready_for_orders: !!(liveStatus?.charges_enabled ?? biz.stripe_charges_enabled),
      },
      live: liveStatus,
    })
  } catch (e) {
    console.error('restaurant/status error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
