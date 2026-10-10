/**
 * POST /api/stripe/subscribe
 * Header: Authorization: Bearer <JWT>  (a profissional assina o PROPRIO perfil)
 * Body: { plan: 'starter'|'pro'|'premium', source?: 'app', provider_id? }
 * Cria Checkout Session de assinatura recorrente.
 *
 * Teste gratis (alinhado com api/_lib/agendaPlans.js):
 *   - Todo perfil novo ja ganha 14 dias com tudo, sem cartao. Quem assina durante
 *     esse teste so e cobrada quando ele acaba (subscription_data.trial_end).
 *   - Faltando menos de 48h (minimo do Stripe) ou com o teste acabado: cobra ja,
 *     sem dar mais 14 dias.
 *
 * source 'app' (app AgendaPro): volta pra /agenda/planos?app=1, que pede pra
 * voltar ao app. provider_id, se vier, tem que ser o do login.
 *
 * Quem ja tem assinatura troca de plano pelo portal (/api/stripe/portal):
 * abrir outro checkout criaria uma segunda assinatura. Por isso o Customer do
 * Stripe e criado (ou reaproveitado) ANTES do checkout e gravado no perfil na
 * hora; se esse customer ja tem assinatura viva (o webhook ainda nao chegou, por
 * exemplo), responde 409 use_portal em vez de abrir outro checkout.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth, planActive } from '../_lib/providerAuth.js'
import { effectivePlan } from '../_lib/agendaPlans.js'

const PLAN_TO_PRICE = {
  starter: 'STRIPE_PRICE_STARTER',
  pro:     'STRIPE_PRICE_PRO',
  premium: 'STRIPE_PRICE_PREMIUM',
}

const MIN_TRIAL_MS = 48 * 3600e3

// Assinatura que ainda vale ou vai cobrar: com uma dessas, outro checkout duplicaria
export const LIVE_SUB_STATUSES = ['trialing', 'active', 'past_due']

const isMissingCustomer = (e) => e?.code === 'resource_missing' || /no such customer/i.test(e?.message || '')

/**
 * Customer do Stripe do perfil: o gravado ou um novo, gravado no perfil antes do
 * checkout. Clique duplo: a idempotency key devolve o mesmo customer e o update
 * so grava se o perfil ainda estiver sem customer.
 */
async function ensureCustomer(stripe, supabase, provider, { forceNew = false } = {}) {
  if (provider.stripe_customer_id && !forceNew) return provider.stripe_customer_id
  const email = String(provider.email || '').trim().toLowerCase()
  const customer = await stripe.customers.create(
    { email: email || undefined, metadata: { provider_id: provider.id, type: 'agenda' } },
    { idempotencyKey: `agenda-cus-${provider.id}-${email}${forceNew ? `-${provider.stripe_customer_id}` : ''}`.slice(0, 255) },
  )
  let q = supabase.from('ag_providers').update({ stripe_customer_id: customer.id }).eq('id', provider.id)
  q = forceNew ? q.eq('stripe_customer_id', provider.stripe_customer_id) : q.is('stripe_customer_id', null)
  const { data: saved, error } = await q.select('stripe_customer_id')
  if (error) throw new Error(error.message)
  if (saved?.length) return customer.id
  // Outra requisicao gravou um customer no meio tempo: usa o dela
  const { data: cur } = await supabase.from('ag_providers').select('stripe_customer_id').eq('id', provider.id).maybeSingle()
  return cur?.stripe_customer_id || customer.id
}

/** Assinaturas vivas do customer no Stripe (trialing, active, past_due). */
async function liveSubscriptions(stripe, customerId) {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 })
  return (list?.data || []).filter(s => LIVE_SUB_STATUSES.includes(s.status))
}

/**
 * Fim do teste sem cartao que ainda pode virar trial do Stripe, em segundos
 * (unix) — ou null (cobra na hora). Funcao pura.
 */
export function trialEndForCheckout(provider, now = new Date()) {
  if (!provider || provider.stripe_subscription_id) return null
  if (String(provider.plan_status || '').toLowerCase() !== 'trialing') return null
  const eff = effectivePlan(provider, now)
  if (!eff.trial || !eff.trial_ends_at) return null
  const end = new Date(eff.trial_ends_at).getTime()
  if (!Number.isFinite(end) || end - now.getTime() <= MIN_TRIAL_MS) return null
  return Math.floor(end / 1000)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  const { plan, source, provider_id } = req.body || {}
  if (!plan || !PLAN_TO_PRICE[plan]) {
    return res.status(400).json({ error: 'plan (starter/pro/premium) obrigatório' })
  }
  const fromApp = source === 'app'

  const priceId = process.env[PLAN_TO_PRICE[plan]]
  if (!priceId) return res.status(500).json({ error: `Price ID do plano ${plan} não configurado` })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    if (provider_id && provider_id !== provider.id) {
      return res.status(403).json({ error: 'Esse perfil não é o da sua conta. Entre de novo e tente outra vez.' })
    }

    if (provider.stripe_subscription_id && planActive(provider)) {
      return res.status(409).json({
        use_portal: true,
        error: 'Você já tem uma assinatura. Troque de plano pelo portal de cobrança.',
      })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    // Customer antes do checkout + trava pelo que o Stripe sabe (nao so pelo banco)
    let customerId = await ensureCustomer(stripe, supabase, provider)
    let live
    try {
      live = await liveSubscriptions(stripe, customerId)
    } catch (e) {
      if (!isMissingCustomer(e)) throw e
      // Customer gravado nao existe mais no Stripe: cria outro
      customerId = await ensureCustomer(stripe, supabase, provider, { forceNew: true })
      live = await liveSubscriptions(stripe, customerId)
    }
    if (live.length) {
      return res.status(409).json({
        use_portal: true,
        error: 'Você já tem uma assinatura. Troque de plano pelo portal de cobrança.',
      })
    }

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'
    const meta = { provider_id: provider.id, plan, type: 'subscription', source: fromApp ? 'app' : 'web' }

    const trialEnd = trialEndForCheckout(provider)
    const subscriptionData = { metadata: meta }
    if (trialEnd) subscriptionData.trial_end = trialEnd

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      metadata: meta,
      success_url: fromApp ? `${baseUrl}/agenda/planos?app=1&subscribed=1` : `${baseUrl}/assinante?subscribed=1`,
      cancel_url: fromApp ? `${baseUrl}/agenda/planos?app=1` : `${baseUrl}/agenda/planos`,
    })

    return res.status(200).json({
      checkout_url: session.url,
      trial_end: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
