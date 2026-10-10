/**
 * POST /api/stripe/webhook
 * Recebe eventos do Stripe.
 * Importante: bodyParser deve ficar OFF pra signature verification funcionar.
 */
import { createClient } from '@supabase/supabase-js'
import { applyListingSubscription, endListingSubscription } from '../_lib/listingWebhook.js'

export const config = { api: { bodyParser: false } }

const LIVE_STATUSES = ['trialing', 'active', 'past_due']

/**
 * O perfil ja tem OUTRA assinatura viva gravada? Devolve o id dela (ou null).
 * Evita que uma assinatura duplicada (dois checkouts antes do webhook) troque a
 * que vale: o portal so mostra o customer gravado e ela nao acharia a outra.
 */
async function otherLiveSubscription(supabase, providerId, subId) {
  const { data: cur } = await supabase.from('ag_providers')
    .select('stripe_subscription_id, plan_status').eq('id', providerId).maybeSingle()
  const curId = cur?.stripe_subscription_id
  if (!curId || curId === subId) return null
  return LIVE_STATUSES.includes(String(cur.plan_status || '').toLowerCase()) ? curId : null
}

/**
 * trial_ends_at vindo do Stripe. Sem trial na assinatura (assinou com menos de 48h
 * de teste, cobranca na hora) nao zera: o fim do teste gratis continua valendo.
 * → objeto pra espalhar no patch ({} = nao mexe).
 */
export function trialPatch(sub) {
  return sub?.trial_end ? { trial_ends_at: new Date(sub.trial_end * 1000).toISOString() } : {}
}

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
        } else if (meta.type === 'listing' && meta.business_id) {
          // Plano do diretorio (Pro/Premium) de um negocio
          const sub = await stripe.subscriptions.retrieve(session.subscription)
          await applyListingSubscription(supabase, { businessId: meta.business_id, sub, plan: meta.listing_plan })
        } else if (meta.type === 'subscription' && meta.provider_id) {
          // Assinatura criada. Grava o status real do Stripe: assinando durante o
          // teste gratis, fica 'trialing' ate trial_end (o fim do teste sem cartao).
          const dup = await otherLiveSubscription(supabase, meta.provider_id, session.subscription)
          if (dup) {
            console.error(`[stripe] assinatura duplicada ${session.subscription} do perfil ${meta.provider_id} (vale ${dup}): cancelar no Stripe`)
            break
          }
          const patch = {
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan: meta.plan || 'starter',
          }
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription)
            patch.plan_status = sub.status
            patch.current_period_end = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
            Object.assign(patch, trialPatch(sub))
          } catch (subErr) {
            // Sem o status real: libera o plano pago e deixa o customer.subscription.*
            // corrigir. Nao mexe no trial_ends_at (um 'trialing' com data vencida bloquearia tudo).
            console.error('subscription retrieve failed:', subErr.message)
            patch.plan_status = 'active'
          }
          await supabase.from('ag_providers').update(patch).eq('id', meta.provider_id)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object
        if (sub.metadata?.type === 'listing' && sub.metadata?.business_id) {
          await applyListingSubscription(supabase, { businessId: sub.metadata.business_id, sub, plan: sub.metadata.listing_plan })
          break
        }
        const planId = sub.items?.data?.[0]?.price?.id
        let plan = 'starter'
        if (planId === process.env.STRIPE_PRICE_PRO) plan = 'pro'
        else if (planId === process.env.STRIPE_PRICE_PREMIUM) plan = 'premium'

        const subPatch = {
          plan,
          plan_status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          ...trialPatch(sub),
        }
        if (sub.metadata?.provider_id) {
          // Outra assinatura viva ja gravada: nao troca (log pra cancelar a duplicada)
          const dup = await otherLiveSubscription(supabase, sub.metadata.provider_id, sub.id)
          if (dup) {
            console.error(`[stripe] assinatura duplicada ${sub.id} (${sub.status}) do perfil ${sub.metadata.provider_id} (vale ${dup}): cancelar no Stripe`)
            break
          }
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
        await endListingSubscription(supabase, sub.id)
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        if (invoice.subscription) {
          await supabase.from('ag_providers').update({
            plan_status: 'past_due',
          }).eq('stripe_subscription_id', invoice.subscription)
          await supabase.from('bc_businesses').update({
            listing_plan_status: 'past_due',
          }).eq('stripe_subscription_id', invoice.subscription)

          // Push no app AgendaPro (best effort): o app tambem mostra a faixa vermelha.
          // Texto neutro: no modo companion o app nao tem como mudar pagamento.
          try {
            const { data: prov } = await supabase.from('ag_providers')
              .select('id').eq('stripe_subscription_id', invoice.subscription).maybeSingle()
            if (prov?.id) {
              const { sendPushToProvider } = await import('../_lib/agendaPush.js')
              await sendPushToProvider(supabase, prov.id, {
                kind: 'billing',
                title: 'Aviso sobre o seu plano',
                body: 'Houve um problema com a cobrança do seu plano.',
                data: { type: 'plans' },
              })
            }
          } catch (pushErr) {
            console.error('push payment_failed failed:', pushErr.message)
          }
        }
        break
      }
      // Fim do teste em 3 dias: avisa a profissional (a pagina de planos promete esse aviso)
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object
        if (sub.metadata?.type === 'listing') break
        let { data: prov } = await supabase.from('ag_providers')
          .select('id, name, email, plan').eq('stripe_subscription_id', sub.id).maybeSingle()
        if (!prov && sub.metadata?.provider_id) {
          const byMeta = await supabase.from('ag_providers')
            .select('id, name, email, plan, stripe_subscription_id').eq('id', sub.metadata.provider_id).maybeSingle()
          // Perfil com outra assinatura gravada: esta e duplicada, nao avisa
          prov = byMeta.data && !byMeta.data.stripe_subscription_id ? byMeta.data : null
        }
        if (!prov) break
        const fim = sub.trial_end
          ? new Date(sub.trial_end * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: 'long' })
          : 'em 3 dias'
        const planName = String(prov.plan || 'starter').replace(/^\w/, (c) => c.toUpperCase())
        if (prov.email) {
          try {
            const { sendTransactional } = await import('../_lib/mailer.js')
            const { escapeHtml } = await import('../_lib/emailShell.js')
            await sendTransactional({
              to: prov.email,
              subject: 'Seu teste grátis do AgendaPro termina em 3 dias',
              kicker: 'AGENDAPRO',
              title: 'Seu teste termina em 3 dias',
              paragraphs: [
                `Oi, ${escapeHtml(String(prov.name || '').split(' ')[0])}! O teste grátis termina em <strong>${escapeHtml(fim)}</strong>. Depois disso começa a assinatura do plano <strong>${escapeHtml(planName)}</strong>.`,
                'A cobrança é feita no cartão cadastrado. Se não quiser continuar, cancele antes, sem custo, pelo seu painel em brasilconnectusa.com/assinante.',
              ],
              ctaUrl: 'https://brasilconnectusa.com/assinante',
              ctaLabel: 'Abrir meu painel',
            })
          } catch (mailErr) {
            console.error('email trial_will_end failed:', mailErr.message)
          }
        }
        try {
          const { sendPushToProvider } = await import('../_lib/agendaPush.js')
          await sendPushToProvider(supabase, prov.id, {
            kind: 'billing',
            title: 'Seu teste grátis termina em 3 dias',
            body: `Em ${fim} começa a assinatura do plano ${planName}.`,
            data: { type: 'plans' },
          })
        } catch (pushErr) {
          console.error('push trial_will_end failed:', pushErr.message)
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
