/**
 * POST /api/stripe/listing
 * Header: Authorization: Bearer <JWT>  (dono do negocio)
 * Body: { business_id, action, plan?, confirm? }
 *
 * action:
 *   subscribe  → abre o checkout do Stripe pro plano (pro|premium)
 *   change     → troca o plano de quem ja assina. Cobra/credita a diferenca
 *                proporcional no cartao cadastrado, por isso exige confirm: true.
 *   portal     → portal de cobranca (cartao, faturas, cancelar)
 *
 * Precos: tabela de api/_lib/listingPlans.js. Opcionalmente um Price do Stripe por
 * env var STRIPE_PRICE_LISTING_<MODULO>_<PLANO> (ex.: STRIPE_PRICE_LISTING_RESTAURANT_PRO).
 */
import { createClient } from '@supabase/supabase-js'
import { requireBusinessAuth } from '../_lib/businessAuth.js'
import { PLAN_COLS, moduleConfig, isPaid, effectivePlan, hasLiveSubscription, priceCents } from '../_lib/listingPlans.js'
import { applyListingSubscription } from '../_lib/listingWebhook.js'

const PLAN_LABEL = { pro: 'Pro', premium: 'Premium' }
const usd = c => '$' + (c / 100).toFixed(c % 100 === 0 ? 0 : 2)

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  const { business_id, action, plan, confirm } = req.body || {}
  if (!business_id || !action) return res.status(400).json({ error: 'business_id e action são obrigatórios' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const auth = await requireBusinessAuth(req, supabase, business_id)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

    const { data: biz } = await supabase.from('bc_businesses').select(PLAN_COLS).eq('id', business_id).single()
    if (!biz) return res.status(404).json({ error: 'Negócio não encontrado' })

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'

    // ── portal ───────────────────────────────────────────────────────────
    if (action === 'portal') {
      if (!biz.stripe_customer_id) return res.status(400).json({ error: 'Esse negócio ainda não tem assinatura.' })
      const session = await stripe.billingPortal.sessions.create({
        customer: biz.stripe_customer_id,
        return_url: `${baseUrl}/assinante`,
      })
      return res.status(200).json({ portal_url: session.url })
    }

    // ── subscribe / change ───────────────────────────────────────────────
    const cfg = moduleConfig(biz.module)
    if (!cfg) {
      return res.status(400).json({
        error: String(biz.module) === 'agenda_pro'
          ? 'O plano do AgendaPro é assinado na aba Profissional.'
          : 'Esse módulo não tem plano pago.',
      })
    }
    if (!isPaid(plan)) return res.status(400).json({ error: 'plan deve ser pro ou premium' })

    const amount = priceCents(biz.module, plan)
    const productName = `BrasilConnect · ${cfg.label} ${PLAN_LABEL[plan]}`
    const meta = { type: 'listing', business_id: biz.id, listing_plan: plan, module: String(biz.module) }
    const priceEnv = process.env[`STRIPE_PRICE_LISTING_${String(biz.module).toUpperCase()}_${plan.toUpperCase()}`]

    if (action === 'subscribe') {
      if (hasLiveSubscription(biz)) {
        return res.status(409).json({ use_change: true, error: 'Esse negócio já tem assinatura. Use a troca de plano.' })
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: biz.stripe_customer_id || undefined,
        customer_email: biz.stripe_customer_id ? undefined : String(auth.user.email || biz.owner_email || '').toLowerCase(),
        line_items: [priceEnv
          ? { price: priceEnv, quantity: 1 }
          : {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              recurring: { interval: 'month' },
              product_data: { name: productName },
            },
          }],
        subscription_data: { metadata: meta },
        metadata: meta,
        success_url: `${baseUrl}/assinante?plano=ok`,
        cancel_url: `${baseUrl}/assinante?plano=cancelado`,
      })
      return res.status(200).json({ checkout_url: session.url })
    }

    if (action === 'change') {
      if (!hasLiveSubscription(biz)) {
        return res.status(409).json({ use_subscribe: true, error: 'Esse negócio não tem assinatura ativa.' })
      }
      const current = effectivePlan(biz)
      if (current === plan) return res.status(400).json({ error: `O negócio já está no plano ${PLAN_LABEL[plan]}.` })

      if (confirm !== true) {
        return res.status(409).json({
          needs_confirm: true,
          error: `Trocar para ${PLAN_LABEL[plan]} por ${usd(amount)}/mês? A diferença do mês atual é cobrada ou creditada no cartão cadastrado.`,
        })
      }

      const sub = await stripe.subscriptions.retrieve(biz.stripe_subscription_id)
      const item = sub.items?.data?.[0]
      if (!item) return res.status(500).json({ error: 'Assinatura sem item. Fale com o suporte.' })

      let newItem
      if (priceEnv) {
        newItem = { id: item.id, price: priceEnv }
      } else {
        const product = await stripe.products.create({ name: productName, metadata: { module: String(biz.module), listing_plan: plan } })
        newItem = {
          id: item.id,
          price_data: { currency: 'usd', unit_amount: amount, recurring: { interval: 'month' }, product: product.id },
        }
      }

      const updated = await stripe.subscriptions.update(sub.id, {
        items: [newItem],
        metadata: meta,
        proration_behavior: 'create_prorations',
      })

      // Aplica ja (o webhook customer.subscription.updated confirma depois)
      await applyListingSubscription(supabase, { businessId: biz.id, sub: updated, plan })
      return res.status(200).json({ ok: true, plan })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    console.error('stripe/listing error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
