/**
 * POST /api/stripe/webhook
 * Recebe eventos do Stripe.
 * Importante: bodyParser deve ficar OFF pra signature verification funcionar.
 *
 * Segredos: STRIPE_WEBHOOK_SECRET (endpoint da plataforma) e
 * STRIPE_CONNECT_WEBHOOK_SECRET (endpoint "Events on connected accounts" que
 * aponta para esta mesma URL; obrigatorio para a Store). A assinatura e
 * conferida com um e depois com o outro.
 *
 * Eventos que o endpoint da PLATAFORMA precisa ter selecionados para a Store
 * (o Stripe so entrega o que foi selecionado):
 *   checkout.session.completed, checkout.session.expired,
 *   checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
 *   charge.dispute.created, charge.dispute.closed
 * Endpoint CONNECT (mesma URL): account.updated.
 *
 * BrasilConnect Store (bloco no fim do arquivo), com idempotencia em
 * bc_store_stripe_events (processed_at gravado ao terminar; evento registrado
 * sem processed_at ha mais de 5 min e refeito no reenvio do Stripe):
 *   checkout.session.completed / async_payment_succeeded (store_checkout, pago) -> markCheckoutPaid
 *   checkout.session.expired / async_payment_failed (store_checkout)           -> expireCheckout
 *   charge.dispute.created / closed                                             -> contestacao no cartao
 * account.updated tambem atualiza bc_store_sellers.
 * Rede de seguranca: o cron da Store (api/cron/store.js) confere as disputas no
 * Stripe e chama reconcileStoreDispute() para evento perdido; o releaseOrder
 * confere a cobranca (status de cada disputa, reembolso externo) antes de cada
 * repasse. Contestacao perdida com repasse em 'releasing': acerta o repasse antes
 * (recoverRelease) ou, se estiver em andamento agora, falha para o evento ser refeito.
 */
import { createClient } from '@supabase/supabase-js'
import { applyListingSubscription, endListingSubscription } from '../_lib/listingWebhook.js'

export const config = { api: { bodyParser: false } }

async function getRawBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks)
}

/** Confere a assinatura com o segredo da plataforma e, se falhar, com o do Connect. */
function constructEventAnySecret(stripe, buf, sig) {
  try {
    return stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    if (!connectSecret) throw e
    try {
      return stripe.webhooks.constructEvent(buf, sig, connectSecret)
    } catch (_) {
      throw e
    }
  }
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
    event = constructEventAnySecret(stripe, buf, sig)
  } catch (e) {
    console.error('Webhook signature failed:', e.message)
    return res.status(400).send(`Webhook Error: ${e.message}`)
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  // BrasilConnect Store: ramo proprio, com idempotencia. Eventos que nao sao da
  // Store seguem para o switch abaixo, sem mudanca.
  let storeTarget = null
  try {
    storeTarget = await resolveStoreEvent(supabase, stripe, event)
  } catch (e) {
    console.error('[store webhook] nao consegui identificar o evento:', event.type, e.message)
    return res.status(500).json({ error: 'store: ' + e.message })
  }
  if (storeTarget) return handleStoreEvent(res, supabase, stripe, event, storeTarget)

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
        // BrasilConnect Store: conta de recebimento da loja
        await syncStoreSellerAccount(supabase, acc)
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

// ═════════════════════════════════════════════════════════════════════════════
// BrasilConnect Store
// ═════════════════════════════════════════════════════════════════════════════
const STORE_PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])
const STORE_DEAD_EVENTS = new Set(['checkout.session.expired', 'checkout.session.async_payment_failed'])
const STORE_DISPUTE_EVENTS = new Set(['charge.dispute.created', 'charge.dispute.closed'])

// Motivo da contestacao (dispute.reason do Stripe) em PT-BR
const CHARGEBACK_REASON_PT = {
  fraudulent: 'o titular diz que não fez a compra',
  unrecognized: 'compra não reconhecida',
  product_not_received: 'produto não recebido',
  product_unacceptable: 'produto com defeito ou diferente do anúncio',
  duplicate: 'cobrança duplicada',
  credit_not_processed: 'reembolso prometido e não feito',
  subscription_canceled: 'cobrança depois de cancelamento',
  general: 'outro motivo',
}
const chargebackReason = (r) => CHARGEBACK_REASON_PT[r] || 'outro motivo'

// Situacao da contestacao (dispute.status do Stripe) em PT-BR
const DISPUTE_STATUS_PT = {
  warning_needs_response: 'consulta do banco aguardando resposta',
  warning_under_review: 'consulta do banco em análise',
  warning_closed: 'consulta do banco encerrada sem contestação',
  needs_response: 'aguardando resposta',
  under_review: 'em análise pelo banco',
  won: 'ganha pela Store',
  lost: 'perdida',
  charge_refunded: 'encerrada porque a cobrança foi reembolsada',
  prevented: 'evitada antes de virar contestação',
}
const disputeStatusPt = (s) => DISPUTE_STATUS_PT[s] || 'situação fora do comum'
const DISPUTE_OPEN = new Set(['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review'])

const DAY_MS = 86400000
const STALE_EVENT_MS = 5 * 60_000   // evento sem processed_at ha mais que isso pode ser refeito
const STORE_RELEASE_STALE_MS = 10 * 60_000 // repasse em 'releasing' ha mais que isso: a rodada morreu (igual a releaseOrder)

let _storeLib = null
/** Libs da Store carregadas so quando o evento e da Store (o resto do webhook nao depende delas). */
async function storeLib() {
  if (!_storeLib) {
    const [store, orders] = await Promise.all([import('../_lib/store.js'), import('../_lib/storeOrders.js')])
    _storeLib = { ...store, ...orders }
  }
  return _storeLib
}

const isDuplicateError = (error) => !!error && (error.code === '23505' || /duplicate|unique/i.test(error.message || ''))
const isMissingTable = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''))

function fmtWhenNY(date, withTime = false) {
  if (!date || isNaN(date)) return null
  const opts = { timeZone: 'America/New_York', day: '2-digit', month: 'long', year: 'numeric' }
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleString('pt-BR', opts)
}

/**
 * Diz se o evento e da Store e o que fazer. null = nao e da Store (segue o fluxo normal).
 * Pedido da Store e sempre cobrado na conta da plataforma: evento vindo de conta
 * conectada (event.account) com esse formato e ignorado.
 */
async function resolveStoreEvent(supabase, stripe, event) {
  const isCheckout = STORE_PAID_EVENTS.has(event.type) || STORE_DEAD_EVENTS.has(event.type)
  const isDispute = STORE_DISPUTE_EVENTS.has(event.type)
  if (!isCheckout && !isDispute) return null
  if (event.account) return null
  const obj = event.data?.object || {}

  if (isCheckout) {
    const meta = obj.metadata || {}
    if (meta.type !== 'store_checkout') return null
    const lib = await storeLib()
    if (!lib.isUuid(meta.checkout_id)) {
      console.error('[store webhook] checkout_id invalido na sessao', obj.id)
      return null
    }
    const paid = STORE_PAID_EVENTS.has(event.type)
    if (paid && obj.payment_status !== 'paid') {
      // Pagamento assincrono ainda em processamento: espera o async_payment_succeeded
      console.log('[store webhook] sessao concluida com pagamento pendente:', obj.id)
      return null
    }
    const { data: co, error } = await supabase.from('bc_store_checkouts')
      .select('id, status, stripe_session_id, stock_released')
      .eq('id', meta.checkout_id).maybeSingle()
    if (error) throw new Error('checkout: ' + error.message)
    if (!co) {
      console.error('[store webhook] checkout nao encontrado:', meta.checkout_id)
      return null
    }
    if (co.stripe_session_id && co.stripe_session_id !== obj.id) {
      console.error('[store webhook] sessao nao confere com o checkout:', meta.checkout_id, obj.id)
      return null
    }
    return { kind: paid ? 'paid' : 'dead', checkout: co, session: obj }
  }

  const co = await findDisputeCheckout(supabase, stripe, obj)
  if (!co) return null
  return { kind: event.type === 'charge.dispute.created' ? 'dispute_created' : 'dispute_closed', checkout: co, dispute: obj }
}

/** Checkout da Store dono da cobranca contestada (por charge, PaymentIntent ou metadata do PI). */
async function findDisputeCheckout(supabase, stripe, dispute) {
  const cols = 'id, status, total_cents, stripe_charge_id, stripe_payment_intent_id'
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  const piId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id

  const byColumn = async (column, value) => {
    const { data, error } = await supabase.from('bc_store_checkouts').select(cols).eq(column, value).limit(1)
    if (error) {
      // Sem as tabelas da Store (migration ainda nao aplicada): a contestacao e de outro produto
      if (isMissingTable(error)) return { none: true }
      throw new Error('checkout por ' + column + ': ' + error.message)
    }
    return { co: (data || [])[0] || null }
  }

  if (chargeId) {
    const r = await byColumn('stripe_charge_id', chargeId)
    if (r.none) return null
    if (r.co) return r.co
  }
  if (!piId) return null
  const r = await byColumn('stripe_payment_intent_id', piId)
  if (r.none) return null
  if (r.co) return r.co

  // Ultimo recurso: o PaymentIntent da Store carrega o checkout_id na metadata
  const pi = await stripe.paymentIntents.retrieve(piId)
  const meta = pi?.metadata || {}
  if (meta.type !== 'store_checkout') return null
  const lib = await storeLib()
  if (!lib.isUuid(meta.checkout_id)) return null
  const { data, error } = await supabase.from('bc_store_checkouts').select(cols).eq('id', meta.checkout_id).maybeSingle()
  if (error) throw new Error('checkout por metadata: ' + error.message)
  return data || null
}

/**
 * Registra o evento antes de processar (trava de idempotencia). Retorna:
 *   'claimed' processar agora · 'done' ja processado · 'busy' outro processamento
 *   em andamento (recente) · 'error' banco indisponivel.
 * Registro sem processed_at ha mais de 5 min = processamento interrompido (a funcao
 * morreu no maxDuration): renova a trava e processa de novo (tudo e retomavel).
 */
async function claimStoreEvent(supabase, eventId, type) {
  const { error } = await supabase.from('bc_store_stripe_events').insert({ event_id: eventId, type })
  if (!error) return 'claimed'
  if (!isDuplicateError(error)) {
    console.error('[store webhook] idempotencia falhou:', error.message)
    return 'error'
  }
  const { data: row, error: rErr } = await supabase.from('bc_store_stripe_events')
    .select('processed_at, created_at').eq('event_id', eventId).maybeSingle()
  if (rErr) {
    // Sem a coluna processed_at (schema antigo): comportamento antigo, duplicado = feito
    console.error('[store webhook] leitura do evento falhou:', rErr.message)
    return 'done'
  }
  if (!row) return 'busy' // apagado agora por um erro: o Stripe reenvia
  if (row.processed_at) return 'done'
  const staleBefore = new Date(Date.now() - STALE_EVENT_MS)
  if (row.created_at && new Date(row.created_at) > staleBefore) return 'busy'
  const { data: again, error: uErr } = await supabase.from('bc_store_stripe_events')
    .update({ created_at: new Date().toISOString() })
    .eq('event_id', eventId).is('processed_at', null).lt('created_at', staleBefore.toISOString())
    .select('event_id')
  if (uErr) {
    console.error('[store webhook] retomada do evento falhou:', uErr.message)
    return 'error'
  }
  if (again?.length) console.log('[store webhook] retomando evento interrompido:', eventId)
  return again?.length ? 'claimed' : 'busy'
}

async function markStoreEventDone(supabase, eventId) {
  const { error } = await supabase.from('bc_store_stripe_events').update({ processed_at: new Date().toISOString() }).eq('event_id', eventId)
  if (error) console.error('[store webhook] processed_at:', error.message)
}

/**
 * Processa o evento da Store uma unica vez. Duplicado ja processado -> 200 sem processar.
 * Duplicado ainda em processamento -> 409 (o Stripe reenvia depois e, se a primeira
 * tentativa tiver morrido, a reenviada refaz).
 * Erro -> apaga o registro do evento e devolve 500 para o Stripe reenviar.
 */
async function handleStoreEvent(res, supabase, stripe, event, target) {
  const claim = await claimStoreEvent(supabase, event.id, event.type)
  if (claim === 'done') return res.status(200).json({ received: true, duplicate: true })
  if (claim === 'busy') return res.status(409).json({ error: 'store: evento em processamento; o Stripe reenvia depois' })
  if (claim !== 'claimed') return res.status(500).json({ error: 'store: idempotencia indisponivel' })

  try {
    const lib = await storeLib()
    if (target.kind === 'paid') {
      if (['expired', 'canceled'].includes(target.checkout.status)) await reopenLateCheckout(supabase, target.checkout, lib)
      const r = await lib.markCheckoutPaid(supabase, stripe, { checkoutId: target.checkout.id, session: target.session })
      if (!r?.ok) console.error('[store webhook] markCheckoutPaid nao concluiu:', target.checkout.id)
    } else if (target.kind === 'dead') {
      await lib.expireCheckout(supabase, target.checkout.id)
    } else if (target.kind === 'dispute_created') {
      await storeDisputeCreated(supabase, target.checkout, target.dispute, lib)
    } else if (target.kind === 'dispute_closed') {
      await storeDisputeClosed(supabase, stripe, target.checkout, target.dispute, lib)
    }
    await markStoreEventDone(supabase, event.id)
    if (target.kind === 'dispute_created' || target.kind === 'dispute_closed') {
      // O reparo do cron nao repete o que o webhook ja fez
      await markDisputeSwept(supabase, target.kind, target.dispute)
    }
    return res.status(200).json({ received: true })
  } catch (e) {
    console.error('[store webhook] erro em', event.type, event.id, e.message)
    const { error: delErr } = await supabase.from('bc_store_stripe_events').delete().eq('event_id', event.id)
    if (delErr) console.error('[store webhook] nao consegui liberar o evento para reenvio:', delErr.message)
    return res.status(500).json({ error: 'store: ' + e.message })
  }
}

/**
 * Pagamento confirmado depois de o checkout ter expirado aqui. markCheckoutPaid so
 * promove pedidos em 'pending_payment', entao os pedidos expirados voltam para
 * esse estado antes (o estoque e reservado de novo dentro de markCheckoutPaid).
 */
async function reopenLateCheckout(supabase, co, lib) {
  const { data: reopened, error } = await supabase.from('bc_store_orders')
    .update({ status: 'pending_payment', payout_status: 'pending' })
    .eq('checkout_id', co.id).eq('status', 'expired')
    .select('id, order_number')
  if (error) throw new Error('reabrir pedidos: ' + error.message)
  if (reopened?.length) {
    await lib.notifyAdmin('Store: pagamento chegou depois do checkout expirar', [
      `O checkout <strong>${lib.esc(co.id)}</strong> estava expirado e o Stripe confirmou o pagamento. Os pedidos ${reopened.map(o => '#' + lib.esc(o.order_number)).join(', ')} foram reabertos e marcados como pagos.`,
      'Confira o estoque dos itens. Se faltar produto, cancele o pedido pelo admin (o comprador é reembolsado).',
    ])
  }
}

/** Devolve ao estoque os itens de um pedido (best effort: falha so vai para o log). */
async function releaseOrderStock(supabase, orderId) {
  const { data: items, error } = await supabase.from('bc_store_order_items').select('product_id, quantity').eq('order_id', orderId)
  if (error) { console.error('[store webhook] itens do pedido', orderId, error.message); return }
  for (const it of items || []) {
    if (!it.product_id || !(it.quantity > 0)) continue
    const { error: rpcErr } = await supabase.rpc('bc_store_release_stock', { p_product: it.product_id, p_qty: it.quantity })
    if (rpcErr) console.error('[store webhook] devolver estoque', it.product_id, rpcErr.message)
  }
}

async function loadStoreSellers(supabase, ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data, error } = await supabase.from('bc_store_sellers').select('id, user_id, email, name').in('id', uniq)
  if (error) console.error('[store webhook] lojas:', error.message)
  return Object.fromEntries((data || []).map(s => [s.id, s]))
}

function disputeDashboardUrl(dispute) {
  return `https://dashboard.stripe.com/${dispute.livemode ? '' : 'test/'}disputes/${encodeURIComponent(dispute.id)}`
}

/** charge.dispute.created: retém os repasses e pede evidencia as lojas. */
async function storeDisputeCreated(supabase, co, dispute, lib) {
  const { data: orders, error } = await supabase.from('bc_store_orders')
    .select('id, order_number, seller_id, status, payout_status, dispute_status')
    .eq('checkout_id', co.id).not('status', 'in', '(canceled,expired)')
  if (error) throw new Error('pedidos: ' + error.message)
  const list = orders || []
  const ids = list.map(o => o.id)

  if (ids.length) {
    // Primeiro a disputa (o repasse ja nao sai), depois a retencao
    const { error: e1 } = await supabase.from('bc_store_orders').update({ dispute_status: 'chargeback' }).in('id', ids)
    if (e1) throw new Error('marcar contestacao: ' + e1.message)
    const { error: e2 } = await supabase.from('bc_store_orders')
      .update({ payout_status: 'held', hold_reason: 'chargeback' })
      .in('id', ids).in('payout_status', ['pending', 'blocked'])
    if (e2) throw new Error('reter repasse: ' + e2.message)
    const { error: e3 } = await supabase.from('bc_store_orders')
      .update({ dispute_opened_at: new Date().toISOString() })
      .in('id', ids).is('dispute_opened_at', null)
    if (e3) console.error('[store webhook] dispute_opened_at:', e3.message)
  }

  const reasonPt = chargebackReason(dispute.reason)
  const dueBy = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null
  // Prazo da loja: 3 dias antes do prazo do Stripe (minimo 24h a partir de agora)
  const sellerDue = dueBy
    ? new Date(Math.max(Date.now() + DAY_MS, dueBy.getTime() - 3 * DAY_MS))
    : new Date(Date.now() + 5 * DAY_MS)
  const sellerDueStr = fmtWhenNY(sellerDue)
  const sellers = await loadStoreSellers(supabase, list.map(o => o.seller_id))

  for (const o of list) {
    await lib.logEvent(supabase, o.id, 'dispute_chargeback', {
      actor: 'stripe',
      message: `Contestação no cartão aberta (${reasonPt}). Repasse retido até o resultado.`,
      data: { dispute_id: dispute.id, amount_cents: dispute.amount, reason: dispute.reason, due_by: dueBy ? dueBy.toISOString() : null },
    })
    const seller = sellers[o.seller_id]
    if (!seller) continue
    await lib.notify({
      user_id: seller.user_id, email: seller.email,
      type: 'store_chargeback', icon: '⚠️',
      title: `Contestação no cartão · pedido #${o.order_number}`,
      body: `O comprador contestou a compra com o banco. Mande as provas de envio e entrega até ${sellerDueStr}. O repasse fica retido até o resultado.`,
      url: lib.sellerOrderUrl(o), metadata: { order_id: o.id },
      mail: {
        subject: `Contestação no cartão no pedido #${o.order_number}`,
        kicker: 'BRASILCONNECT STORE · CONTESTAÇÃO',
        title: `Pedido #${o.order_number}: o comprador contestou a compra`,
        paragraphs: [
          `O comprador abriu uma contestação com o banco do cartão (chargeback). Motivo informado: <strong>${lib.esc(reasonPt)}</strong>.`,
          `Para a BrasilConnect defender a venda, mande até <strong>${lib.esc(sellerDueStr)}</strong> para oi@brasilconnectusa.com, com o número do pedido no assunto: rastreio, comprovante de entrega ou de retirada, fotos do que foi enviado e as conversas com o comprador.`,
          'O repasse deste pedido fica retido até o banco decidir. Se a contestação for perdida, o valor volta para o comprador e sai do seu repasse.',
        ],
        ctaUrl: lib.APP_URL + lib.sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
      },
    })
  }

  const pedidos = list.length
    ? list.map(o => `#${lib.esc(o.order_number)} · ${lib.esc(sellers[o.seller_id]?.name || 'Loja')}`).join('<br>')
    : 'Nenhum pedido ativo neste checkout (todos cancelados ou expirados). Responda com o comprovante de reembolso.'
  await lib.notifyAdmin(`Store: contestação no cartão de ${lib.fmtUSD(dispute.amount)}`, [
    `Valor contestado: <strong>${lib.fmtUSD(dispute.amount)}</strong>. Motivo: <strong>${lib.esc(reasonPt)}</strong> (${lib.esc(dispute.reason || 'sem motivo')}).`,
    `Prazo para enviar a evidência no Stripe: <strong>${lib.esc(fmtWhenNY(dueBy, true) || 'não informado')}</strong>. As lojas foram avisadas para mandar as provas até ${lib.esc(sellerDueStr)}.`,
    `Pedidos do checkout <strong>${lib.esc(co.id)}</strong>:<br>${pedidos}`,
    'Os repasses pendentes foram retidos. Junte rastreio, comprovante de entrega e as conversas do pedido e responda no Stripe.',
    `<a href="${lib.esc(disputeDashboardUrl(dispute))}">Abrir a contestação ${lib.esc(dispute.id)} no Stripe</a>`,
  ])
}

/** charge.dispute.closed: ganhou -> libera o repasse; perdeu -> pedido reembolsado e repasse estornado. */
async function storeDisputeClosed(supabase, stripe, co, dispute, lib) {
  const { data: orders, error } = await supabase.from('bc_store_orders')
    .select('*').eq('checkout_id', co.id).not('status', 'in', '(canceled,expired)')
  if (error) throw new Error('pedidos: ' + error.message)
  const list = orders || []
  const sellers = await loadStoreSellers(supabase, list.map(o => o.seller_id))
  const now = new Date().toISOString()
  const status = dispute.status

  if (status === 'won' || status === 'warning_closed') {
    const won = list.filter(o => o.dispute_status === 'chargeback')
    for (const o of won) {
      const { error: e1 } = await supabase.from('bc_store_orders')
        .update({ dispute_status: 'resolved_release', dispute_resolved_at: now, dispute_resolution: 'chargeback_won' })
        .eq('id', o.id).eq('dispute_status', 'chargeback')
      if (e1) throw new Error('encerrar contestacao: ' + e1.message)
      const { error: e2 } = await supabase.from('bc_store_orders')
        .update({ payout_status: 'pending', hold_reason: null })
        .eq('id', o.id).eq('payout_status', 'held').eq('hold_reason', 'chargeback')
      if (e2) throw new Error('liberar repasse: ' + e2.message)
      await lib.logEvent(supabase, o.id, 'dispute_chargeback_won', {
        actor: 'stripe', message: 'Contestação no cartão encerrada a favor da loja. O repasse segue o prazo normal.',
        data: { dispute_id: dispute.id, status },
      })
      const seller = sellers[o.seller_id]
      if (seller) {
        await lib.notify({
          user_id: seller.user_id, email: seller.email,
          type: 'store_chargeback_closed', icon: '✅',
          title: `Contestação encerrada a seu favor · pedido #${o.order_number}`,
          body: 'O banco manteve a venda. O repasse deste pedido segue o prazo normal.',
          url: lib.sellerOrderUrl(o), metadata: { order_id: o.id },
          mail: {
            subject: `Pedido #${o.order_number}: contestação encerrada a seu favor`,
            title: 'Contestação encerrada a seu favor',
            paragraphs: [`O banco manteve a venda do pedido <strong>#${o.order_number}</strong>. O repasse segue o prazo normal da Store.`],
            ctaUrl: lib.APP_URL + lib.sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
          },
        })
      }
    }
    await lib.notifyAdmin(`Store: contestação de ${lib.fmtUSD(dispute.amount)} encerrada a favor da Store`, [
      `Contestação <strong>${lib.esc(dispute.id)}</strong> (${lib.esc(disputeStatusPt(status))}) do checkout <strong>${lib.esc(co.id)}</strong>.`,
      won.length ? `Repasses liberados para seguir o prazo normal: ${won.map(o => '#' + lib.esc(o.order_number)).join(', ')}.` : 'Nenhum pedido estava marcado com contestação.',
    ])
    return
  }

  if (status !== 'lost') {
    // Encerramento fora do comum (ex.: cobranca reembolsada): decisao manual
    const statusPt = disputeStatusPt(status)
    for (const o of list.filter(x => x.dispute_status === 'chargeback')) {
      await lib.logEvent(supabase, o.id, 'note', { actor: 'stripe', message: `Contestação no cartão encerrada (${statusPt}). A BrasilConnect vai decidir o repasse.`, data: { dispute_id: dispute.id, status } })
    }
    await lib.notifyAdmin(`Store: contestação encerrada (${statusPt})`, [
      `Contestação <strong>${lib.esc(dispute.id)}</strong> do checkout <strong>${lib.esc(co.id)}</strong> foi encerrada: <strong>${lib.esc(statusPt)}</strong> (código do Stripe: ${lib.esc(status)}).`,
      'Os pedidos continuam marcados com contestação e os repasses retidos. Decida pelo admin (liberar ou reembolsar).',
      `<a href="${lib.esc(disputeDashboardUrl(dispute))}">Abrir no Stripe</a>`,
    ])
    return
  }

  // Repasse em 'releasing' precisa ser acertado antes: senao a recuperacao do repasse
  // (cron/admin) grava depois um transfer sem estorno num pedido ja reembolsado.
  // Em andamento agora -> erro (o Stripe reenvia o evento; o cron refaz a varredura).
  // Travado ha 10 min+ -> recoverRelease: transfer feito vira 'released' (e e estornado
  // abaixo); nao feito volta para 'pending' (e vira 'none' abaixo).
  const releasing = list.filter(o => o.payout_status === 'releasing')
  if (releasing.length) {
    for (const o of releasing) {
      const fresh = o.releasing_at && Date.now() - new Date(o.releasing_at).getTime() < STORE_RELEASE_STALE_MS
      if (fresh) throw new Error(`repasse do pedido #${o.order_number} em andamento; o evento é refeito depois`)
      const rec = await lib.recoverRelease(supabase, stripe, o, { actor: 'stripe' })
      if (!rec?.ok) throw new Error(`repasse travado do pedido #${o.order_number}: ${rec?.error || 'falhou'}`)
    }
    const { data: again, error: aErr } = await supabase.from('bc_store_orders')
      .select('*').eq('checkout_id', co.id).not('status', 'in', '(canceled,expired)')
    if (aErr) throw new Error('pedidos: ' + aErr.message)
    list.splice(0, list.length, ...(again || []))
  }

  // Perdeu: o banco devolveu o dinheiro ao comprador e debitou a plataforma
  const failures = []
  for (const o of list) {
    // Ja resolvido (reenvio depois de falha parcial): nao repete estorno nem aviso
    if (o.dispute_status === 'resolved_refund' && o.status === 'refunded') continue
    const patch = {
      dispute_status: 'resolved_refund', dispute_resolved_at: now, dispute_resolution: 'chargeback_lost',
      status: 'refunded', refunded_cents: o.total_cents,
    }
    let note = null
    if (o.stripe_transfer_id && ['released', 'reversed'].includes(o.payout_status)) {
      // O que ainda esta com a loja: o repassado menos o que ja foi estornado (reembolsos anteriores)
      const amount = Math.max(0, (o.payout_cents || 0) - (o.reversed_cents || 0))
      if (amount > 0) {
        try {
          const rv = await stripe.transfers.createReversal(o.stripe_transfer_id,
            { amount, metadata: { type: 'store_chargeback', order_id: o.id, dispute_id: dispute.id } },
            { idempotencyKey: `store_chb_${o.id}_${o.reversed_cents || 0}` })
          patch.payout_status = 'reversed'
          patch.hold_reason = null
          patch.reversed_cents = (o.reversed_cents || 0) + amount
          patch.stripe_reversal_ids = [...(o.stripe_reversal_ids || []), rv.id]
          note = `${lib.fmtUSD(amount)} estornados do repasse da loja.`
        } catch (e) {
          // Sem saldo na conta da loja: o valor vira debito, abatido dos proximos repasses
          const { error: dErr } = await supabase.rpc('bc_store_add_debt', { p_seller: o.seller_id, p_cents: amount })
          if (dErr) console.error('[store webhook] debito da loja:', dErr.message)
          patch.hold_reason = 'reversal_failed'
          note = dErr
            ? 'O estorno do repasse não passou no Stripe. A BrasilConnect vai combinar a devolução do valor com você.'
            : `O estorno de ${lib.fmtUSD(amount)} não passou no Stripe. O valor ficou como débito da loja e sai dos próximos repasses.`
          failures.push(`#${lib.esc(o.order_number)}: estorno de ${lib.fmtUSD(amount)} falhou (${lib.esc(e.message)})${dErr ? '; o débito NÃO foi registrado, cobre a loja manualmente' : '; o valor virou débito da loja'}`)
        }
      }
    } else if (!['released', 'reversed', 'releasing'].includes(o.payout_status)) {
      patch.payout_status = 'none'
      patch.hold_reason = null
    }
    const { error: upErr } = await supabase.from('bc_store_orders').update(patch).eq('id', o.id)
    if (upErr) throw new Error('pedido ' + o.id + ': ' + upErr.message)

    // Pedido que ainda nao tinha sido enviado: o produto continua com a loja, o estoque volta
    // (como no cancelamento). Num reenvio do evento o pedido ja esta 'refunded' e e pulado acima.
    if (o.status === 'paid') await releaseOrderStock(supabase, o.id)

    await lib.logEvent(supabase, o.id, 'dispute_chargeback_lost', {
      actor: 'stripe',
      message: `Contestação no cartão perdida: valor devolvido ao comprador pelo banco.${note ? ' ' + note : ''}`,
      data: { dispute_id: dispute.id, amount_cents: dispute.amount },
    })
    const seller = sellers[o.seller_id]
    if (seller) {
      const naoEnviado = o.status === 'paid'
      await lib.notify({
        user_id: seller.user_id, email: seller.email,
        type: 'store_chargeback_closed', icon: '⚠️',
        title: `Contestação perdida · pedido #${o.order_number}`,
        body: `O banco devolveu o valor ao comprador.${note ? ' ' + note : ''}${naoEnviado ? ' Não envie este pedido.' : ''}`,
        url: lib.sellerOrderUrl(o), metadata: { order_id: o.id },
        mail: {
          subject: `Pedido #${o.order_number}: contestação no cartão perdida`,
          title: 'Contestação perdida',
          paragraphs: [
            `O banco do comprador decidiu a contestação do pedido <strong>#${o.order_number}</strong> a favor do comprador e devolveu o valor.`,
            note ? lib.esc(note) : 'Este pedido não terá repasse.',
            naoEnviado ? '<strong>Não envie este pedido.</strong> A quantidade voltou para o estoque do anúncio.' : '',
            'Dúvidas: oi@brasilconnectusa.com.',
          ].filter(Boolean),
          ctaUrl: lib.APP_URL + lib.sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
        },
      })
    }
  }

  await lib.notifyAdmin(`Store: contestação de ${lib.fmtUSD(dispute.amount)} perdida`, [
    `Contestação <strong>${lib.esc(dispute.id)}</strong> do checkout <strong>${lib.esc(co.id)}</strong> foi perdida. Pedidos marcados como reembolsados: ${list.map(o => '#' + lib.esc(o.order_number)).join(', ') || 'nenhum'}.`,
    failures.length ? `<strong>Estornos que falharam:</strong><br>${failures.join('<br>')}` : 'Repasses já enviados foram estornados das lojas.',
    'Pedidos que ainda não tinham sido enviados não devem ser enviados. Confira se há etiqueta comprada para reembolsar na Shippo.',
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// Reparo de contestacao sem evento (chamado pelo cron da Store)
// ─────────────────────────────────────────────────────────────────────────────
/** Marca de "ja tratado" em bc_store_stripe_events (criada: uma por disputa; encerrada: uma por situacao). */
function disputeMarker(kind, dispute) {
  return kind === 'dispute_created' ? `sweep_created_${dispute.id}` : `sweep_closed_${dispute.status}_${dispute.id}`
}

async function markDisputeSwept(supabase, kind, dispute) {
  if (!dispute?.id) return
  const now = new Date().toISOString()
  const { error } = await supabase.from('bc_store_stripe_events')
    .insert({ event_id: disputeMarker(kind, dispute), type: 'sweep.' + kind, processed_at: now })
  if (error && !isDuplicateError(error)) console.error('[store webhook] marca da disputa:', error.message)
}

/**
 * Aplica uma contestacao do Stripe que o webhook nao processou (evento nao assinado,
 * perdido ou falho). Confere o estado dos pedidos antes, para nao repetir o que o
 * webhook ja fez. Retorna { applied, kind? }.
 */
export async function reconcileStoreDispute(supabase, stripe, dispute) {
  if (!dispute?.id || !dispute.status) return { applied: false }
  const co = await findDisputeCheckout(supabase, stripe, dispute)
  if (!co) return { applied: false }
  const { data: orders, error } = await supabase.from('bc_store_orders')
    .select('id, status, dispute_status, dispute_resolution')
    .eq('checkout_id', co.id).not('status', 'in', '(canceled,expired)')
  if (error) throw new Error('pedidos: ' + error.message)
  const list = orders || []

  let kind = null
  if (DISPUTE_OPEN.has(dispute.status)) {
    const known = list.some(o => o.dispute_status === 'chargeback' || String(o.dispute_resolution || '').startsWith('chargeback_'))
    if (list.length && !known) kind = 'dispute_created'
  } else if (dispute.status === 'lost') {
    if (list.some(o => !(o.dispute_status === 'resolved_refund' && o.status === 'refunded'))) kind = 'dispute_closed'
  } else if (list.some(o => o.dispute_status === 'chargeback')) {
    kind = 'dispute_closed'
  }
  if (!kind) return { applied: false }

  const marker = disputeMarker(kind, dispute)
  const { error: cErr } = await supabase.from('bc_store_stripe_events').insert({ event_id: marker, type: 'sweep.' + kind })
  if (cErr) {
    if (isDuplicateError(cErr)) return { applied: false, duplicate: true }
    throw new Error('marca da disputa: ' + cErr.message)
  }
  const lib = await storeLib()
  try {
    if (kind === 'dispute_created') await storeDisputeCreated(supabase, co, dispute, lib)
    else await storeDisputeClosed(supabase, stripe, co, dispute, lib)
    await markStoreEventDone(supabase, marker)
  } catch (e) {
    await supabase.from('bc_store_stripe_events').delete().eq('event_id', marker)
    throw e
  }
  console.log('[store] contestacao reparada sem evento:', dispute.id, kind, dispute.status)
  return { applied: true, kind }
}

/** account.updated: espelha a conta de recebimento na loja. Nunca derruba o webhook. */
async function syncStoreSellerAccount(supabase, acc) {
  if (!acc?.id) return
  const rq = acc.requirements || {}
  try {
    const { error } = await supabase.from('bc_store_sellers').update({
      stripe_details_submitted: !!acc.details_submitted,
      stripe_payouts_enabled: !!acc.payouts_enabled,
      stripe_transfers_active: acc.capabilities?.transfers === 'active',
      stripe_requirements: {
        currently_due: Array.isArray(rq.currently_due) ? rq.currently_due : [],
        past_due: Array.isArray(rq.past_due) ? rq.past_due : [],
        disabled_reason: rq.disabled_reason || null,
      },
    }).eq('stripe_account_id', acc.id)
    // Tabela ausente (migration nao aplicada) nao e erro: o painel sincroniza no connect-status
    if (error && !isMissingTable(error)) console.error('[store webhook] account.updated em bc_store_sellers falhou:', error.message)
  } catch (e) {
    console.error('[store webhook] account.updated em bc_store_sellers falhou:', e.message)
  }
}
