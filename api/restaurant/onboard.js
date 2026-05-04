/**
 * POST /api/restaurant/onboard
 * Body: { business_id, owner_email }
 * Cria/recupera Stripe Express account pro negocio + retorna URL de onboarding.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe nao configurado' })
  }

  const { business_id, owner_email } = req.body || {}
  if (!business_id || !owner_email) {
    return res.status(400).json({ error: 'business_id e owner_email obrigatorios' })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { data: biz, error: bizErr } = await supabase
      .from('bc_businesses')
      .select('id, name, slug, owner_email, stripe_account_id, stripe_onboarded, accepts_orders')
      .eq('id', business_id)
      .single()

    if (bizErr || !biz) return res.status(404).json({ error: 'Negocio nao encontrado' })

    const ownerOnRecord = (biz.owner_email || '').toLowerCase().trim()
    const requested = String(owner_email).toLowerCase().trim()
    if (ownerOnRecord && ownerOnRecord !== requested) {
      return res.status(403).json({ error: 'Email nao bate com o dono cadastrado' })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    let accountId = biz.stripe_account_id

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: requested,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'company',
        business_profile: {
          name: biz.name,
          product_description: 'Food and beverage orders via BrasilConnect platform',
          mcc: '5812',
          url: 'https://brasilconnectusa.com/negocio/' + biz.slug,
        },
        metadata: { business_id: biz.id, source: 'brasilconnect_restaurant' },
      })
      accountId = account.id
      await supabase.from('bc_businesses').update({
        stripe_account_id: accountId,
        owner_email: requested,
      }).eq('id', business_id)
    }

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: baseUrl + '/assinante?stripe_refresh=1',
      return_url:  baseUrl + '/assinante?stripe_done=1',
      type: 'account_onboarding',
    })

    return res.status(200).json({
      success: true,
      stripe_account_id: accountId,
      onboarding_url: accountLink.url,
      expires_at: accountLink.expires_at,
    })
  } catch (e) {
    console.error('restaurant/onboard error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
