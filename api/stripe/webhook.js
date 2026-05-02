/**
 * POST /api/stripe/webhook
 * Recebe eventos do Stripe.
 * Importante: bodyParser deve ficar OFF pra signature verification funcionar.
 */
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).end()

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

  const sig = req.headers['stripe-signature']
  let event
  try {
    const buf = await getRawBody(req)
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    console.error('Webhook signature failed:', e.message)
    return res.status(400).send(`Webhook Error: ${e.message}`)
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const meta = session.metadata || {}

        if (meta.type === 'deposit' && meta.appointment_id) {
          // Marca depósito pago e confirma agendamento
          await supabase.from('ag_appointments').update({
            deposit_paid: true,
            stripe_payment_id: session.payment_intent,
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
          }).eq('id', meta.appointment_id)

          await supabase.from('ag_payments').update({
            status: 'paid',
            stripe_payment_intent_id: session.payment_intent,
            paid_at: new Date().toISOString(),
          }).eq('stripe_session_id', session.id)
        } else if (meta.type === 'subscription' && meta.provider_id) {
          // Assinatura ativada
          await supabase.from('ag_providers').update({
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan: meta.plan || 'starter',
            plan_status: 'active',
          }).eq('id', meta.provider_id)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object
        const planId = sub.items?.data?.[0]?.price?.id
        let plan = 'starter'
        if (planId === process.env.STRIPE_PRICE_PRO) plan = 'pro'
        else if (planId === process.env.STRIPE_PRICE_SALON) plan = 'salao'

        await supabase.from('ag_providers').update({
          plan,
          plan_status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq('stripe_subscription_id', sub.id)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await supabase.from('ag_providers').update({
          plan_status: 'canceled',
        }).eq('stripe_subscription_id', sub.id)
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        if (invoice.subscription) {
          await supabase.from('ag_providers').update({
            plan_status: 'past_due',
          }).eq('stripe_subscription_id', invoice.subscription)
        }
        break
      }
    }
    return res.status(200).json({ received: true })
  } catch (e) {
    console.error('Webhook handler error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
