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
          // Assinatura criada. Busca o status real no Stripe: durante os 14 dias de
          // teste e 'trialing', nao 'active'.
          let status = 'trialing', periodEnd = null, trialEnd = null
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription)
            status = sub.status
            periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
            trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null
          } catch (subErr) {
            console.error('subscription retrieve failed:', subErr.message)
          }
          await supabase.from('ag_providers').update({
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan: meta.plan || 'starter',
            plan_status: status,
            current_period_end: periodEnd,
            trial_ends_at: trialEnd,
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
        else if (planId === process.env.STRIPE_PRICE_PREMIUM) plan = 'premium'

        const subPatch = {
          plan,
          plan_status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        }
        if (sub.metadata?.provider_id) {
          // Esse evento pode chegar antes do checkout.session.completed
          await supabase.from('ag_providers').update({
            ...subPatch, stripe_subscription_id: sub.id, stripe_customer_id: sub.customer,
          }).eq('id', sub.metadata.provider_id)
        } else {
          await supabase.from('ag_providers').update(subPatch).eq('stripe_subscription_id', sub.id)
        }
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
      // Fim do teste em 3 dias: avisa a profissional (a pagina de planos promete esse aviso)
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object
        const { data: prov } = await supabase.from('ag_providers')
          .select('name, email, plan').eq('stripe_subscription_id', sub.id).maybeSingle()
        if (prov?.email) {
          try {
            const { sendTransactional } = await import('../_lib/mailer.js')
            const { escapeHtml } = await import('../_lib/emailShell.js')
            const fim = sub.trial_end
              ? new Date(sub.trial_end * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: 'long' })
              : 'em 3 dias'
            await sendTransactional({
              to: prov.email,
              subject: 'Seu teste grátis do AgendaPro termina em 3 dias',
              kicker: 'AGENDAPRO',
              title: 'Seu teste termina em 3 dias',
              paragraphs: [
                `Oi, ${escapeHtml(String(prov.name || '').split(' ')[0])}! O teste grátis do plano <strong>${escapeHtml(String(prov.plan || 'starter').toUpperCase())}</strong> termina em <strong>${escapeHtml(fim)}</strong>.`,
                'Depois dessa data a assinatura é cobrada no cartão cadastrado. Se não quiser continuar, cancele antes pelo painel, sem custo.',
              ],
              ctaUrl: 'https://brasilconnectusa.com/assinante',
              ctaLabel: 'Abrir meu painel',
            })
          } catch (mailErr) {
            console.error('email trial_will_end failed:', mailErr.message)
          }
        }
        break
      }
      // Stripe Connect Express: conta de um negocio (pedidos) ou de uma profissional (sinal)
      case 'account.updated': {
        const acc = event.data.object
        await supabase.from('ag_providers').update({
          stripe_onboarded: acc.details_submitted,
          stripe_charges_enabled: acc.charges_enabled,
        }).eq('stripe_account_id', acc.id)
        await supabase.from('bc_businesses').update({
          stripe_onboarded: acc.details_submitted,
          stripe_charges_enabled: acc.charges_enabled,
          stripe_payouts_enabled: acc.payouts_enabled,
        }).eq('stripe_account_id', acc.id)
        break
      }
      // Restaurant: pedido pago — atualiza order + notifica dono via push
      case 'payment_intent.succeeded': {
        const intent = event.data.object
        const meta = intent.metadata || {}
        if (meta.type === 'restaurant_order' && meta.order_id) {
          await supabase.from('bc_orders').update({
            payment_status: 'paid',
            status: 'confirmed',
            stripe_charge_id: intent.latest_charge,
            confirmed_at: new Date().toISOString(),
          }).eq('id', meta.order_id)

          // Push pro dono do restaurante (best effort, nao bloqueia webhook)
          try {
            const { data: order } = await supabase
              .from('bc_orders')
              .select('id, order_number, customer_name, total_cents, business_id')
              .eq('id', meta.order_id)
              .single()
            if (order) {
              const { data: biz } = await supabase
                .from('bc_businesses')
                .select('owner_email, name')
                .eq('id', order.business_id)
                .single()
              if (biz?.owner_email) {
                const { sendPushTo } = await import('../_lib/push.js')
                await sendPushTo({
                  user_email: biz.owner_email,
                  topic: 'orders',
                  title: '🔔 Novo pedido #' + order.order_number,
                  body: (order.customer_name || 'Cliente') + ' · $' + (order.total_cents / 100).toFixed(2),
                  url: '/assinante?tab=pedidos',
                  type: 'restaurant_order_new',
                  data: { order_id: order.id },
                })
              }
            }
          } catch (pushErr) {
            console.error('push order new failed:', pushErr.message)
          }

          // E-mail pro dono (o push so chega se ele ativou notificacoes no app)
          try {
            const { data: order } = await supabase
              .from('bc_orders')
              .select('order_number, customer_name, customer_phone, type, total_cents, business_id')
              .eq('id', meta.order_id)
              .single()
            const { data: biz } = order
              ? await supabase.from('bc_businesses').select('owner_email, name').eq('id', order.business_id).single()
              : { data: null }
            if (order && biz?.owner_email) {
              const { sendTransactional } = await import('../_lib/mailer.js')
              const { escapeHtml } = await import('../_lib/emailShell.js')
              await sendTransactional({
                to: biz.owner_email,
                subject: `Novo pedido #${order.order_number} · $${(order.total_cents / 100).toFixed(2)}`,
                kicker: 'NOVO PEDIDO',
                title: `Pedido #${order.order_number} pago`,
                paragraphs: [
                  `<strong>${escapeHtml(order.customer_name || 'Cliente')}</strong> fez um pedido em <strong>${escapeHtml(biz.name)}</strong>.`,
                  `Total: <strong>$${(order.total_cents / 100).toFixed(2)}</strong> · ${order.type === 'delivery' ? 'Entrega' : 'Retirada'}${order.customer_phone ? ' · ' + escapeHtml(order.customer_phone) : ''}`,
                  'O pagamento já foi confirmado. Os itens estão no painel.',
                ],
                ctaUrl: 'https://brasilconnectusa.com/assinante?tab=pedidos',
                ctaLabel: 'Abrir pedidos',
              })
            }
          } catch (mailErr) {
            console.error('email order new failed:', mailErr.message)
          }
        }
        break
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object
        const meta = intent.metadata || {}
        if (meta.type === 'restaurant_order' && meta.order_id) {
          await supabase.from('bc_orders').update({
            payment_status: 'failed',
          }).eq('id', meta.order_id)
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
