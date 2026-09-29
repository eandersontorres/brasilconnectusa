/**
 * POST /api/restaurant/onboard
 * Header: Authorization: Bearer <JWT>  (precisa ser o dono do negocio)
 * Body: { business_id }
 * Cria/recupera Stripe Express account pro negocio + retorna URL de onboarding.
 *
 * Antes bastava mandar um owner_email no body: num negocio sem owner_email,
 * qualquer pessoa virava dona e ligava a propria conta Stripe. Agora o dono
 * vem do token (requireBusinessAuth).
 */
import { createClient } from '@supabase/supabase-js'
import { requireBusinessAuth } from '../_lib/businessAuth.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe nao configurado' })
  }

  const { business_id } = req.body || {}
  if (!business_id) {
    return res.status(400).json({ error: 'business_id obrigatorio' })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const auth = await requireBusinessAuth(req, supabase, business_id)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const biz = auth.business
    const ownerEmail = String(auth.user.email || '').toLowerCase().trim()

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    let accountId = biz.stripe_account_id

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: ownerEmail,
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
