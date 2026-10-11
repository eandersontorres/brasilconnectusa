/**
 * GET /api/cron/store
 *
 * Rotina de hora em hora da BrasilConnect Store (vercel.json: "0 * * * *").
 * Roda as etapas em sequencia, com orcamento de tempo (~50s) e limite por etapa:
 *
 *   1. checkouts vencidos (expires_at + 10 min): confere a sessao no Stripe.
 *      paga -> markCheckoutPaid · aberta -> expira no Stripe e devolve o estoque ·
 *      expirada (ou sem sessao) -> devolve o estoque
 *   2. reparo de pagamento: checkout 'paid' que ainda tem pedido 'pending_payment'
 *      (webhook interrompido no meio) -> markCheckoutPaid de novo (retomavel)
 *   3. etiqueta travada em 'purchasing' ha 10 min+: confere a transacao na Shippo
 *      (SUCCESS -> marca enviado com a etiqueta · ERROR -> 'failed'). Sem o id da
 *      transacao (timeout no POST), procura pela metadata 'order:<id>' ou pela rate
 *      (findTransaction) antes de liberar como 'failed'.
 *   4. contestacoes no cartao sem evento registrado (rede de seguranca do webhook)
 *   5. rastreio parado ha 6h+: consulta a Shippo e aplica a mudanca (applyTracking).
 *      Roda antes do aviso e do cancelamento: pacote ja escaneado nao e cancelado.
 *   6. aviso de prazo (so entre 8h e 22h de Nova York, para nao avisar de madrugada):
 *      pedidos pagos cujo prazo vence nas proximas 24h e pacotes com etiqueta da
 *      Store que a transportadora ainda nao leu. Um aviso por prazo (data.deadline).
 *   7. cancelamento automatico: prazo + auto_cancel_grace_days dias uteis vencido
 *      (orderAutoCancelAt). Inclui pacote com etiqueta da Store que a transportadora
 *      nunca escaneou, com +2 dias uteis de carencia e consulta ao vivo do rastreio
 *      antes: o pedido volta para 'paid' e e cancelado (etiqueta reembolsada).
 *   8. repasse travado em 'releasing' ha 10 min+ (a rodada morreu no meio):
 *      releaseOrder confere no Stripe e grava o transfer ou destrava
 *   9. repasses vencidos: releaseOrder
 *
 * Prazo de entrega local: o maior entre ship_by e paid_at + est_days_max da regiao.
 * Retirada/entrega combinada com o comprador: a loja registra no painel e o
 * ship_by passa a ser a data combinada.
 *
 * Erro num item nao para os outros. Responde um resumo em JSON.
 *
 * Autenticacao (igual a api/cron/moderation.js): Vercel Cron manda
 * `Authorization: Bearer <CRON_SECRET>`; x-cron-secret ou ?secret= para chamada manual.
 */
import crypto from 'node:crypto'
import {
  getSupabase, getStripe, getConfig, addBusinessDays, autoCancelAt, orderDeadline, orderAutoCancelAt,
  logEvent, notify, notifyAdmin, esc, APP_URL,
} from '../_lib/store.js'
import {
  ACTIVE_DISPUTES, markCheckoutPaid, expireCheckout, cancelOrder, releaseOrder, releaseDueAt, isNewSeller,
  applyTracking, markShipped, sellerOrderUrl,
} from '../_lib/storeOrders.js'
import { shippoEnabled, shippo, getTrack, getRate, refundLabel, findTransaction, normalizeCarrier, trackingUrlFor } from '../_lib/shippo.js'

const BUDGET_MS = 50_000          // a funcao tem 60s (vercel.json)
const MIN_LEFT_MS = 4_000         // abaixo disso nao comeca item novo
const LIMITS = { checkouts: 50, repairs: 20, labels: 20, disputes: 30, warnings: 100, cancels: 30, tracking: 40, stuck: 20, payouts: 100 }
const STALE_CHECKOUT_MS = 10 * 60_000
const ORPHAN_CHECKOUT_MS = 25 * 3600_000   // sessao do Stripe vive no maximo 24h
const PAID_REPAIR_AFTER_MS = 5 * 60_000    // da tempo ao webhook em andamento
const LABEL_STALE_MS = 10 * 60_000         // compra de etiqueta "em processamento" ha mais que isso
const DISPUTE_LOOKBACK_MS = 3 * 86400_000
const TRACK_STALE_MS = 6 * 3600_000
const TRACK_TIMEOUT_MS = 8_000
const TRACK_RESERVE_MS = 15_000            // o rastreio deixa este tempo para aviso, cancelamento e repasse
const LIVE_TRACK_TIMEOUT_MS = 5_000        // consulta ao vivo antes de cancelar etiqueta nunca escaneada
const UNSCANNED_EXTRA_BUSINESS_DAYS = 2    // carencia extra de pedido com etiqueta comprada pela Store
const LABEL_LOOKUP_GIVEUP_MS = 24 * 3600_000 // busca da etiqueta sem id falhando ha 24h: libera com aviso ao admin
const RELEASE_STALE_MS = 10 * 60_000       // repasse em 'releasing' ha mais que isso: a rodada morreu no meio
const STRIPE_TIMEOUT_MS = 10_000
const TRACK_CONCURRENCY = 4
const MAX_ERRORS = 25
const TRACK_STATUSES = new Set(['PRE_TRANSIT', 'TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'])
// A transportadora ja leu o pacote: nao e mais "etiqueta nunca escaneada"
const SCANNED_STATUSES = new Set(['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'])
// Rastreio suspeito (outro pacote, data ou endereco errados): fica com o admin, o cron nao insiste
const SUSPECT_HOLDS = new Set(['tracking_date_invalid', 'tracking_address_mismatch'])

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' })
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars ausentes' })
  }
  res.setHeader('Cache-Control', 'private, no-store')

  const started = Date.now()
  const left = () => BUDGET_MS - (Date.now() - started)
  const supabase = getSupabase()

  // Antes da migration bc_store_schema o cron nao tem o que fazer
  const probe = await supabase.from('bc_store_orders').select('id').limit(1)
  if (probe.error && isMissingTable(probe.error)) {
    return res.status(200).json({ ok: true, skipped: 'Tabelas da Store ainda não foram criadas.' })
  }

  const stripe = await getStripe()
  const cfg = await getConfig(supabase)
  const summary = { ok: true, partial: false, steps: {}, errors: [] }
  const ctx = { supabase, stripe, cfg, left, summary }

  const steps = [
    ['checkouts', stepCheckouts],
    ['paid_repair', stepPaidRepair],
    ['labels', stepLabelReconcile],
    ['disputes', stepDisputes],
    // Rastreio antes do aviso e do cancelamento: pacote ja lido pela transportadora nao e cancelado
    ['tracking', stepTracking],
    ['ship_warnings', stepShipWarnings],
    ['auto_cancel', stepAutoCancel],
    ['stuck_payouts', stepStuckPayouts],
    ['payouts', stepPayouts],
  ]
  for (const [name, fn] of steps) {
    if (left() < MIN_LEFT_MS) {
      summary.partial = true
      summary.steps[name] = { skipped: 'sem tempo nesta rodada' }
      continue
    }
    try {
      summary.steps[name] = await fn(ctx)
    } catch (e) {
      console.error(`[cron store] etapa ${name} falhou:`, e.message)
      summary.ok = false
      summary.steps[name] = { failed: true }
      pushErr(summary, name, null, e)
    }
  }
  summary.ms = Date.now() - started
  return res.status(200).json(summary)
}

// ─────────────────────────────────────────────────────────────────────────────
// Prazos
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Prazo de entrega/postagem do pedido. Entrega local: o maior entre ship_by e
 * paid_at + est_days_max da regiao (23:59 de Nova York desse dia).
 */
// Prazo efetivo e data do cancelamento automatico vem do nucleo (mesma regra no painel e para o comprador)
export { orderDeadline }

const neverScanned = (o) => ['PRE_TRANSIT', 'UNKNOWN', ''].includes(String(o.tracking_status || '').toUpperCase())

/**
 * Pacote com etiqueta da Store que a transportadora ainda nao leu. `from` = quando
 * um pedido sem etiqueta ja seria cancelado (prazo + carencia); `cancelAt` = `from`
 * + 2 dias uteis de carencia extra (a etiqueta foi comprada; falta so a leitura).
 * Entre os dois a loja recebe o aviso.
 */
function unscannedWindow(o, cfg) {
  const from = autoCancelAt(orderDeadline(o), Math.max(0, cfg.auto_cancel_grace_days || 0))
  if (!from) return null
  return { from, cancelAt: addBusinessDays(from, UNSCANNED_EXTRA_BUSINESS_DAYS) }
}

/** Data do cancelamento automatico: pedido pago pela regra do nucleo; etiqueta da Store com a carencia extra. */
function cancelAtFor(o, cfg) {
  if (o.label_status === 'purchased') return unscannedWindow(o, cfg)?.cancelAt || null
  return orderAutoCancelAt(o, cfg)
}

/** Campos de applyTracking a partir da resposta de getTrack. */
function trackPatch(t, status) {
  return {
    status,
    substatus: typeof t?.substatus === 'string' ? t.substatus.slice(0, 60) : null,
    details: t?.details ? String(t.details).slice(0, 500) : null,
    date: t?.date || null,
    source: 'poll',
    address_to: t?.address_to || null,
  }
}

/**
 * Rastreio ao vivo (timeout curto). { checked:false } quando nao da para consultar
 * (Shippo desligada, transportadora desconhecida); { error } quando a consulta falhou.
 */
async function liveTrack(o) {
  const carrier = normalizeCarrier(o.carrier)
  if (!shippoEnabled() || !carrier || !o.tracking_number) return { checked: false }
  try {
    const t = await withTimeout(getTrack(carrier, o.tracking_number), LIVE_TRACK_TIMEOUT_MS)
    return { checked: true, status: String(t?.status || 'UNKNOWN').toUpperCase(), t }
  } catch (e) {
    // Numero que a Shippo nao conhece (400/404/422): conta como nao lido. Autenticacao,
    // limite de taxa, 5xx e timeout: nao da para saber agora
    if ([400, 404, 422].includes(e?.status)) return { checked: true, status: 'UNKNOWN', t: null }
    return { checked: false, error: e }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Checkouts vencidos
// ─────────────────────────────────────────────────────────────────────────────
async function stepCheckouts({ supabase, stripe, left, summary }) {
  const out = { found: 0, paid: 0, expired: 0, waiting: 0, skipped: 0, errors: 0 }
  const cutoff = new Date(Date.now() - STALE_CHECKOUT_MS).toISOString()
  const { data: due, error } = await supabase.from('bc_store_checkouts')
    .select('id, status, stripe_session_id')
    .eq('status', 'pending').lt('expires_at', cutoff)
    .order('expires_at', { ascending: true }).limit(LIMITS.checkouts)
  if (error) throw new Error('checkouts: ' + error.message)

  // Checkout sem expires_at (criacao interrompida) e velho: a sessao ja nao existe
  const orphanCutoff = new Date(Date.now() - ORPHAN_CHECKOUT_MS).toISOString()
  const { data: orphans, error: oErr } = await supabase.from('bc_store_checkouts')
    .select('id, status, stripe_session_id')
    .eq('status', 'pending').is('expires_at', null).lt('created_at', orphanCutoff)
    .order('created_at', { ascending: true }).limit(LIMITS.checkouts)
  if (oErr) throw new Error('checkouts sem prazo: ' + oErr.message)

  const list = [...(due || []), ...(orphans || [])].slice(0, LIMITS.checkouts)
  out.found = list.length
  for (const co of list) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    try {
      const result = await settleCheckout(supabase, stripe, co)
      out[result] = (out[result] || 0) + 1
    } catch (e) {
      out.errors++
      pushErr(summary, 'checkouts', co.id, e)
    }
  }
  return out
}

/** Destino de um checkout vencido: 'paid' | 'expired' | 'waiting' | 'skipped'. */
async function settleCheckout(supabase, stripe, co) {
  if (!co.stripe_session_id) {
    await expireCheckout(supabase, co.id)
    return 'expired'
  }
  if (!stripe) return 'skipped'

  let s
  try {
    s = await stripe.checkout.sessions.retrieve(co.stripe_session_id)
  } catch (e) {
    // Sessao inexistente nesta conta/modo (ex.: troca de chave teste -> producao): nunca vai ser paga
    if (e?.code === 'resource_missing' || e?.statusCode === 404) {
      await expireCheckout(supabase, co.id)
      return 'expired'
    }
    throw e
  }
  if (s.metadata?.checkout_id && s.metadata.checkout_id !== co.id) {
    throw new Error('sessão do Stripe não confere com o checkout')
  }
  if (s.status === 'open') {
    try {
      s = await stripe.checkout.sessions.expire(s.id)
    } catch (e) {
      // Pode ter sido paga entre a leitura e o expire: le de novo
      s = await stripe.checkout.sessions.retrieve(co.stripe_session_id)
      if (s.status === 'open') throw e
    }
  }

  if (s.status === 'complete') {
    if (s.payment_status === 'paid') {
      await markCheckoutPaid(supabase, stripe, { checkoutId: co.id, session: s })
      return 'paid'
    }
    // Pagamento assincrono: so desiste se o PaymentIntent ja falhou de vez
    const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id
    if (piId) {
      const pi = await stripe.paymentIntents.retrieve(piId)
      if (pi.status === 'canceled' || pi.status === 'requires_payment_method') {
        await expireCheckout(supabase, co.id)
        return 'expired'
      }
    }
    return 'waiting'
  }
  if (s.status === 'expired') {
    await expireCheckout(supabase, co.id)
    return 'expired'
  }
  return 'skipped'
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reparo: checkout pago com pedido ainda em 'pending_payment'
// ─────────────────────────────────────────────────────────────────────────────
async function stepPaidRepair({ supabase, stripe, left, summary }) {
  const out = { found: 0, repaired: 0, errors: 0 }
  if (!stripe) return { ...out, skipped: 'Stripe não configurado' }

  const { data: pend, error } = await supabase.from('bc_store_orders')
    .select('id, checkout_id, order_number').eq('status', 'pending_payment')
    .order('created_at', { ascending: true }).limit(500)
  if (error) throw new Error('pedidos: ' + error.message)
  const byCheckout = new Map()
  for (const o of pend || []) if (o.checkout_id && !byCheckout.has(o.checkout_id)) byCheckout.set(o.checkout_id, o)
  if (!byCheckout.size) return out

  const cutoff = new Date(Date.now() - PAID_REPAIR_AFTER_MS).toISOString()
  const { data: cos, error: cErr } = await supabase.from('bc_store_checkouts')
    .select('id, stripe_payment_intent_id, total_cents, paid_at')
    .in('id', [...byCheckout.keys()].slice(0, 200)).eq('status', 'paid').lt('paid_at', cutoff)
    .limit(LIMITS.repairs)
  if (cErr) throw new Error('checkouts: ' + cErr.message)
  out.found = (cos || []).length

  for (const co of cos || []) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    const first = byCheckout.get(co.id)
    try {
      const r = await markCheckoutPaid(supabase, stripe, {
        checkoutId: co.id,
        session: { payment_intent: co.stripe_payment_intent_id, amount_total: co.total_cents },
      })
      if (r?.ok && !r.already) {
        out.repaired++
        await notifyAdmin('Store: pagamento concluído pelo reparo automático', [
          `O checkout <strong>${esc(co.id)}</strong> estava pago, mas o pedido <strong>#${esc(first?.order_number)}</strong> (e talvez outros do mesmo carrinho) ainda não tinha sido liberado para a loja. O cron terminou o processamento e avisou as partes.`,
        ])
      }
    } catch (e) {
      out.errors++
      pushErr(summary, 'paid_repair', co.id, e)
      if (first) {
        await reportOnce(supabase, first.id, 'paid_repair_failed',
          'O pagamento foi confirmado, mas o pedido ainda não foi liberado. A BrasilConnect já foi avisada.',
          `Store: pagamento do checkout ${co.id} não foi concluído`,
          [
            `O checkout <strong>${esc(co.id)}</strong> está pago no Stripe, mas o pedido <strong>#${esc(first.order_number)}</strong> continua aguardando pagamento: ${esc(e?.message || 'erro desconhecido')}.`,
            'O cron tenta de novo a cada hora. Se continuar falhando, confira o PaymentIntent no Stripe.',
          ], e)
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Etiqueta travada em 'purchasing'
// ─────────────────────────────────────────────────────────────────────────────
async function stepLabelReconcile({ supabase, left, summary }) {
  const out = { found: 0, shipped: 0, failed: 0, refunded: 0, waiting: 0, skipped: 0, errors: 0 }
  const { data, error } = await supabase.from('bc_store_orders').select('*')
    .eq('label_status', 'purchasing')
    .order('updated_at', { ascending: true }).limit(LIMITS.labels * 3)
  if (error) throw new Error('pedidos: ' + error.message)
  const cutoff = Date.now() - LABEL_STALE_MS
  const list = (data || [])
    .filter(o => new Date(o.label_locked_at || o.updated_at || 0).getTime() < cutoff)
    .slice(0, LIMITS.labels)
  out.found = list.length
  if (list.length && !shippoEnabled()) return { ...out, skipped: 'Shippo não configurada' }

  for (const o of list) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    try {
      const r = await reconcileLabel(supabase, o, { actor: 'system' })
      out[r.result] = (out[r.result] || 0) + 1
    } catch (e) {
      out.errors++
      pushErr(summary, 'labels', o.id, e)
    }
  }
  return out
}

/**
 * Resolve uma compra de etiqueta que ficou em 'purchasing' (funcao morta, timeout,
 * transacao QUEUED). Usada pelo cron e pela acao 'unlock_label' do admin.
 * Retorna { result: shipped|failed|refunded|waiting|skipped, message }.
 */
export async function reconcileLabel(supabase, order, { actor = 'system', actor_id = null } = {}) {
  if (!order || order.label_status !== 'purchasing') {
    return { result: 'skipped', message: 'A etiqueta deste pedido não está em processamento.' }
  }
  const { data: seller } = await supabase.from('bc_store_sellers')
    .select('id, user_id, email, name, shippo_account_id').eq('id', order.seller_id).maybeSingle()
  const accountId = seller?.shippo_account_id || null

  const release = async (message) => {
    const { data: done, error } = await supabase.from('bc_store_orders')
      .update({ label_status: 'failed', label_locked_at: null })
      .eq('id', order.id).eq('label_status', 'purchasing').select('id')
    if (error) throw new Error('etiqueta: ' + error.message)
    if (done?.length) await logEvent(supabase, order.id, 'label_failed', { actor, actor_id, message })
    return !!done?.length
  }

  let tx = null
  let lookupNote = null
  if (order.shippo_transaction_id) {
    try {
      tx = await shippo('/transactions/' + encodeURIComponent(order.shippo_transaction_id), { accountId })
    } catch (e) {
      if (e?.status !== 404) throw e
      tx = null // transacao inexistente na Shippo: trata como compra que nao aconteceu
    }
  } else {
    // O id se perdeu (timeout ou rede no POST): a transacao pode ter sido criada e cobrada
    // mesmo assim. Procura pela metadata 'order:<id>' ou pela rate antes de liberar.
    let found = null
    try {
      found = await findTransaction({ orderId: order.id, rateId: order.label_rate_id || null, accountId })
      // Etiqueta antiga do mesmo pedido (anulada antes desta compra) tem outra rate: nao
      // serve. Procura de novo so pela rate desta compra.
      if (found && order.label_rate_id && found.rate_id && found.rate_id !== order.label_rate_id) {
        found = await findTransaction({ orderId: '-', rateId: order.label_rate_id, accountId })
      }
    } catch (e) {
      found = null
      if (e?.status !== 404) {
        // Sem a busca nao da para saber se a etiqueta foi cobrada: tenta de novo depois.
        // Passadas 24h, libera com aviso ao admin para nao travar o pedido para sempre.
        const lockedAt = new Date(order.label_locked_at || order.updated_at || 0).getTime()
        if (Date.now() - lockedAt < LABEL_LOOKUP_GIVEUP_MS) throw e
        lookupNote = `A busca da etiqueta na Shippo falhou (${esc(e.message)}).`
      }
    }
    if (found?.transaction_id) {
      // Achou: grava o id e segue como se a compra tivesse devolvido a transacao
      const { error: idErr } = await supabase.from('bc_store_orders').update({ shippo_transaction_id: found.transaction_id })
        .eq('id', order.id).eq('label_status', 'purchasing').is('shippo_transaction_id', null)
      if (idErr) throw new Error('etiqueta: ' + idErr.message)
      await logEvent(supabase, order.id, 'note', {
        actor, actor_id, message: 'Etiqueta encontrada na Shippo depois de a compra perder a resposta.',
        data: { transaction_id: found.transaction_id, status: found.status },
      })
      order = { ...order, shippo_transaction_id: found.transaction_id, label_rate_id: order.label_rate_id || found.rate_id || null }
      tx = {
        object_id: found.transaction_id, status: found.status, label_url: found.label_url,
        tracking_number: found.tracking_number, tracking_url_provider: found.tracking_url, rate: found.rate_id,
      }
    }
  }

  // Sem transacao (a funcao morreu antes do POST /transactions, ou a Shippo nao a conhece)
  if (!tx) {
    const released = await release('A compra da etiqueta não terminou. A loja pode comprar outra ou informar o envio próprio.')
    if (released) {
      await notifyAdmin(`Store: compra de etiqueta interrompida no pedido #${order.order_number}`, [
        `A compra da etiqueta do pedido <strong>#${order.order_number}</strong> ficou travada sem transação válida na Shippo${order.shippo_transaction_id ? ` (${esc(order.shippo_transaction_id)} não encontrada)` : ' (nenhuma transação deste pedido nas últimas da conta)'}${order.label_rate_id ? ` · frete ${esc(order.label_rate_id)}` : ''}. O pedido foi liberado para a loja tentar de novo.`,
        lookupNote,
        'Confira na fatura da Shippo se alguma etiqueta foi cobrada para este pedido (metadata "order:' + esc(order.id) + '") e peça o reembolso se precisar.',
      ].filter(Boolean))
    }
    return { result: 'failed', message: 'Etiqueta liberada: não havia transação válida na Shippo. Confira a fatura da Shippo.' }
  }

  const st = String(tx?.status || '').toUpperCase()
  if (st === 'QUEUED' || st === 'WAITING') {
    return { result: 'waiting', message: 'A Shippo ainda está gerando a etiqueta. Tente de novo em alguns minutos.' }
  }
  if (st !== 'SUCCESS') {
    await release('A Shippo não gerou a etiqueta. A loja pode tentar de novo.')
    return { result: 'failed', message: 'A Shippo não gerou a etiqueta; o pedido foi liberado para nova compra.' }
  }

  // Etiqueta gerada (e cobrada pela Shippo): preco pela rate, para descontar do repasse
  const rateId = order.label_rate_id || (typeof tx.rate === 'string' ? tx.rate : tx.rate?.object_id) || null
  if (!rateId) throw new Error('etiqueta gerada sem rate conhecida (transação ' + order.shippo_transaction_id + ')')
  const rate = await getRate(rateId, accountId)
  const label = {
    label_status: 'purchased', label_url: tx.label_url || null, label_rate_id: rateId,
    shippo_transaction_id: order.shippo_transaction_id, label_cost_cents: rate.amount_cents, label_locked_at: null,
  }

  const { data: cur } = await supabase.from('bc_store_orders').select('status, label_status').eq('id', order.id).maybeSingle()
  if (cur?.status === 'paid' && cur?.label_status === 'purchasing') {
    const carrierCode = normalizeCarrier(rate.provider)
    const trackingUrl = tx.tracking_url_provider || trackingUrlFor(carrierCode, tx.tracking_number)
    const shipped = await markShipped(supabase, order, {
      carrier: rate.provider, service: rate.service, tracking_number: tx.tracking_number || null, tracking_url: trackingUrl,
      label, actor, actor_id,
    })
    if (shipped.ok) {
      await logEvent(supabase, order.id, 'label_purchased', {
        actor, actor_id,
        message: `Etiqueta comprada pela Store (${[rate.provider, rate.service].filter(Boolean).join(' ')})`,
        data: { label_cost_cents: rate.amount_cents, rate_id: rateId, transaction_id: order.shippo_transaction_id, reconciled: true },
      })
      if (seller) {
        await notify({
          user_id: seller.user_id, email: seller.email, type: 'store_label_ready', icon: '🏷️',
          title: `Etiqueta pronta · pedido #${order.order_number}`,
          body: 'A Shippo terminou de gerar a etiqueta. Imprima pelo painel e poste o pacote.',
          url: sellerOrderUrl(order), metadata: { order_id: order.id },
          mail: {
            subject: `Etiqueta do pedido #${order.order_number} pronta`,
            title: 'Etiqueta pronta',
            paragraphs: [
              `A etiqueta do pedido <strong>#${order.order_number}</strong> ficou pronta (${esc([rate.provider, rate.service].filter(Boolean).join(' '))}).`,
              'Imprima pelo painel e poste o pacote. O custo da etiqueta sai do repasse deste pedido.',
            ],
            ctaUrl: APP_URL + sellerOrderUrl(order), ctaLabel: 'Abrir o pedido',
          },
        })
      }
      return { result: 'shipped', message: 'Etiqueta encontrada na Shippo: pedido marcado como enviado.' }
    }
  }

  // O pedido mudou no meio (cancelado/reembolsado): devolve a etiqueta
  let refundNote = 'O reembolso da etiqueta foi pedido à Shippo.'
  try {
    await refundLabel({ transactionId: order.shippo_transaction_id, accountId })
  } catch (e) {
    refundNote = 'O pedido de reembolso da etiqueta falhou: peça manualmente na Shippo.'
    await notifyAdmin(`Store: etiqueta sem uso no pedido #${order.order_number}`, [
      `A etiqueta ${esc(order.shippo_transaction_id)} foi gerada, mas o pedido <strong>#${order.order_number}</strong> não está mais aguardando envio. O reembolso automático falhou: ${esc(e.message)}.`,
    ])
  }
  const { error: uErr } = await supabase.from('bc_store_orders').update({
    label_status: 'refund_requested', label_url: tx.label_url || null, label_rate_id: rateId, label_locked_at: null,
  }).eq('id', order.id).eq('label_status', 'purchasing')
  if (uErr) console.error('[cron store] etiqueta sem uso:', uErr.message)
  await logEvent(supabase, order.id, 'label_refund', { actor: 'system', message: 'Etiqueta não usada: o pedido mudou de situação durante a compra' })
  return { result: 'refunded', message: 'O pedido já não aguardava envio. ' + refundNote }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Contestacoes no cartao sem evento (rede de seguranca do webhook)
// ─────────────────────────────────────────────────────────────────────────────
async function stepDisputes({ supabase, stripe, left, summary }) {
  const out = { checked: 0, fixed: 0, errors: 0 }
  if (!stripe) return { ...out, skipped: 'Stripe não configurado' }
  if (typeof stripe.disputes?.list !== 'function') return { ...out, skipped: 'API de disputas indisponível' }
  const { reconcileStoreDispute } = await import('../stripe/webhook.js')

  const seen = new Set()
  const disputes = []
  const add = (list) => { for (const d of list?.data || []) if (d?.id && !seen.has(d.id)) { seen.add(d.id); disputes.push(d) } }

  // Disputas abertas nos ultimos 3 dias (evento charge.dispute.created perdido)
  try {
    add(await withTimeout(stripe.disputes.list({ created: { gte: Math.floor((Date.now() - DISPUTE_LOOKBACK_MS) / 1000) }, limit: 100 }), STRIPE_TIMEOUT_MS))
  } catch (e) {
    out.errors++
    pushErr(summary, 'disputes', null, e)
  }

  // Contestacoes ainda abertas aqui: confere se ja fecharam (evento charge.dispute.closed perdido)
  const { data: open, error } = await supabase.from('bc_store_orders')
    .select('checkout_id').eq('dispute_status', 'chargeback').limit(200)
  if (error) throw new Error('pedidos: ' + error.message)
  const coIds = [...new Set((open || []).map(o => o.checkout_id).filter(Boolean))].slice(0, LIMITS.disputes)
  if (coIds.length) {
    const { data: cos, error: cErr } = await supabase.from('bc_store_checkouts').select('id, stripe_charge_id').in('id', coIds)
    if (cErr) throw new Error('checkouts: ' + cErr.message)
    for (const co of cos || []) {
      if (!co.stripe_charge_id) continue
      if (left() < MIN_LEFT_MS) { summary.partial = true; break }
      try {
        add(await withTimeout(stripe.disputes.list({ charge: co.stripe_charge_id, limit: 10 }), STRIPE_TIMEOUT_MS))
      } catch (e) {
        out.errors++
        pushErr(summary, 'disputes', co.id, e)
      }
    }
  }

  for (const d of disputes.slice(0, LIMITS.disputes * 2)) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    out.checked++
    try {
      const r = await reconcileStoreDispute(supabase, stripe, d)
      if (r?.applied) out.fixed++
    } catch (e) {
      out.errors++
      pushErr(summary, 'disputes', d.id, e)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Aviso de prazo
// ─────────────────────────────────────────────────────────────────────────────
const WARN_COLS = 'id, order_number, seller_id, status, ship_by, fulfillment, paid_at, zone_snapshot, handoff_scheduled_at, label_status, carrier, tracking_number, tracking_status, buyer_confirmed_at, dispute_status'

/** data (jsonb) do evento como objeto. */
function eventData(e) {
  if (!e?.data) return null
  if (typeof e.data === 'object') return e.data
  try { return JSON.parse(e.data) } catch (_) { return null }
}

/**
 * Um aviso por prazo. O evento 'ship_by_warning' guarda em data o tipo (warn:
 * deadline|unscanned) e o prazo avisado (deadline, ISO): so avisa de novo se o
 * prazo mudar (ex.: data combinada registrada). Aviso antigo, sem o prazo gravado,
 * vale ate a loja registrar a data combinada (evento 'handoff_scheduled') depois dele.
 */
function alreadyWarned(c, evs) {
  const key = c.deadline.toISOString()
  const warns = evs.filter(e => e.kind === 'ship_by_warning')
  if (warns.some(e => { const d = eventData(e); return d?.deadline === key && (d.warn || 'deadline') === c.type })) return true
  if (c.type !== 'deadline') return false
  const legacy = warns.filter(e => !eventData(e)?.deadline).map(e => new Date(e.created_at).getTime())
  if (!legacy.length) return false
  const lastLegacy = Math.max(...legacy)
  return !evs.some(e => e.kind === 'handoff_scheduled' && new Date(e.created_at).getTime() > lastLegacy)
}

async function stepShipWarnings({ supabase, cfg, left, summary }) {
  const out = { found: 0, sent: 0, unscanned: 0, errors: 0 }
  const hour = nyHour()
  if (hour < 8 || hour >= 22) return { ...out, skipped: 'fora do horário de aviso (8h às 22h, Nova York)' }

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 3600_000)
  const oldest = new Date(now.getTime() - 95 * 86400_000).toISOString()
  const { data: soon, error } = await supabase.from('bc_store_orders').select(WARN_COLS)
    .eq('status', 'paid').gt('ship_by', now.toISOString()).lte('ship_by', in24h.toISOString())
    .order('ship_by', { ascending: true }).limit(LIMITS.warnings * 2)
  if (error) throw new Error('pedidos: ' + error.message)
  // Entrega local: o prazo real pode ser depois do ship_by (paid_at + est_days_max)
  const { data: local, error: lErr } = await supabase.from('bc_store_orders').select(WARN_COLS)
    .eq('status', 'paid').eq('fulfillment', 'local_delivery').lte('ship_by', now.toISOString())
    .gt('ship_by', oldest)
    .order('ship_by', { ascending: true }).limit(LIMITS.warnings * 2)
  if (lErr) throw new Error('pedidos (entrega local): ' + lErr.message)
  // Etiqueta da Store comprada, prazo de postagem vencido e o pacote ainda sem leitura
  // (pedido completo: a leitura ao vivo pode ir para applyTracking/markDelivered)
  const { data: noScan, error: nErr } = await supabase.from('bc_store_orders').select('*')
    .eq('status', 'shipped').eq('label_status', 'purchased').is('buyer_confirmed_at', null)
    .lte('ship_by', now.toISOString()).gt('ship_by', oldest)
    .order('ship_by', { ascending: true }).limit(LIMITS.warnings * 2)
  if (nErr) throw new Error('pedidos enviados: ' + nErr.message)

  // Candidatos: { o, type, deadline } (deadline = a data que o aviso promete)
  const cands = []
  const byId = new Map()
  for (const o of [...(soon || []), ...(local || [])]) byId.set(o.id, o)
  for (const o of byId.values()) {
    const d = orderDeadline(o)
    if (d && d > now && d <= in24h) cands.push({ o, type: 'deadline', deadline: d })
  }
  for (const o of noScan || []) {
    if (!neverScanned(o) || ACTIVE_DISPUTES.includes(o.dispute_status)) continue
    const w = unscannedWindow(o, cfg)
    if (w && now >= w.from && now < w.cancelAt) cands.push({ o, type: 'unscanned', deadline: w.cancelAt })
  }
  if (!cands.length) return out

  const { data: evs, error: wErr } = await supabase.from('bc_store_order_events')
    .select('order_id, kind, created_at, data').in('order_id', [...new Set(cands.map(c => c.o.id))])
    .in('kind', ['ship_by_warning', 'handoff_scheduled'])
  if (wErr) throw new Error('eventos: ' + wErr.message)
  const evsByOrder = new Map()
  for (const e of evs || []) {
    if (!evsByOrder.has(e.order_id)) evsByOrder.set(e.order_id, [])
    evsByOrder.get(e.order_id).push(e)
  }
  const todo = cands.filter(c => !alreadyWarned(c, evsByOrder.get(c.o.id) || [])).slice(0, LIMITS.warnings)
  out.found = todo.length
  if (!todo.length) return out

  const sellers = await loadSellers(supabase, todo.map(c => c.o.seller_id), 'id, user_id, email, name')

  for (const c of todo) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    const o = c.o
    try {
      if (c.type === 'unscanned') {
        // Confere ao vivo: se a transportadora ja leu o pacote, aplica a leitura e nao avisa
        const live = await liveTrack(o)
        if (live.checked && SCANNED_STATUSES.has(live.status)) {
          await applyTracking(supabase, o, trackPatch(live.t, live.status))
          continue
        }
      }
      // Registra antes de avisar (com checagem de erro): se o registro falhar,
      // nao avisa, para nao repetir o aviso a cada hora.
      const { error: evErr } = await supabase.from('bc_store_order_events').insert({
        order_id: o.id, kind: 'ship_by_warning', actor: 'system',
        message: c.type === 'unscanned' ? 'Aviso enviado à loja: pacote ainda sem leitura da transportadora' : 'Aviso de prazo enviado à loja',
        data: { warn: c.type, deadline: c.deadline.toISOString() },
      })
      if (evErr) throw new Error('evento: ' + evErr.message)

      const seller = sellers[o.seller_id]
      if (seller) {
        await notify({
          user_id: seller.user_id, email: seller.email,
          url: sellerOrderUrl(o), metadata: { order_id: o.id },
          ...(c.type === 'unscanned' ? unscannedWarning(o, c.deadline) : deadlineWarning(o, c.deadline, cfg)),
        })
      }
      out.sent++
      if (c.type === 'unscanned') out.unscanned++
    } catch (e) {
      out.errors++
      pushErr(summary, 'ship_warnings', o.id, e)
    }
  }
  return out
}

/** Texto do aviso de prazo de pedido pago (postar, entregar ou data combinada). */
function deadlineWarning(o, deadline, cfg) {
  const prazo = fmtNY(deadline, true)
  const cancelAt = fmtNY(orderAutoCancelAt(o, cfg) || deadline, false)
  const n = o.order_number
  const base = { type: 'store_ship_by_warning', icon: '⏰' }
  const tail = `Se o pedido não for ${o.fulfillment === 'ship' ? 'postado' : 'marcado como entregue'} até <strong>${esc(cancelAt)}</strong>, ele é cancelado automaticamente e o comprador recebe o reembolso.`

  if (o.fulfillment === 'ship') {
    return {
      ...base,
      title: `Prazo do pedido #${n} termina em breve`,
      body: `Poste até ${prazo}. Sem postagem, o pedido é cancelado em ${cancelAt} e o comprador reembolsado.`,
      mail: {
        subject: `Pedido #${n}: o prazo termina em breve`,
        kicker: 'BRASILCONNECT STORE · PRAZO',
        title: `Pedido #${n}: prazo até ${prazo}`,
        paragraphs: [
          `O prazo para postar o pedido <strong>#${n}</strong> termina <strong>${esc(prazo)}</strong> (horário de Nova York).`,
          tail,
          'Compre a etiqueta pelo painel ou informe o rastreio do seu envio.',
        ],
        ctaUrl: APP_URL + sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
      },
    }
  }
  if (o.handoff_scheduled_at) {
    // Data ja combinada (registro unico): lembra a data e o prazo, sem sugerir novo registro
    const what = o.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'
    const combinada = fmtNY(o.handoff_scheduled_at, false)
    return {
      ...base,
      title: `Pedido #${n}: ${what.toLowerCase()} combinada para ${combinada}`,
      body: `${what} combinada para ${combinada}: marque como entregue até ${prazo}. Sem isso, o pedido é cancelado em ${cancelAt}.`,
      mail: {
        subject: `Pedido #${n}: ${what.toLowerCase()} combinada para ${combinada}`,
        kicker: 'BRASILCONNECT STORE · PRAZO',
        title: `Pedido #${n}: ${what.toLowerCase()} combinada para ${combinada}`,
        paragraphs: [
          `${what} combinada para <strong>${esc(combinada)}</strong>: marque o pedido <strong>#${n}</strong> como entregue no painel até <strong>${esc(prazo)}</strong> (horário de Nova York).`,
          tail,
          'Se algo mudar com o comprador, avise pela conversa do pedido.',
        ],
        ctaUrl: APP_URL + sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
      },
    }
  }
  return {
    ...base,
    title: `Prazo do pedido #${n} termina em breve`,
    body: `Marque como entregue até ${prazo} ou registre no painel a data combinada com o comprador. Sem isso, o pedido é cancelado em ${cancelAt}.`,
    mail: {
      subject: `Pedido #${n}: o prazo termina em breve`,
      kicker: 'BRASILCONNECT STORE · PRAZO',
      title: `Pedido #${n}: prazo até ${prazo}`,
      paragraphs: [
        `O prazo para entregar o pedido <strong>#${n}</strong> termina <strong>${esc(prazo)}</strong> (horário de Nova York).`,
        tail,
        'Combinou outra data com o comprador? Registre a data combinada no painel do pedido. Depois de entregar, marque o pedido como entregue.',
      ],
      ctaUrl: APP_URL + sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
    },
  }
}

/** Texto do aviso de etiqueta comprada e pacote ainda sem leitura da transportadora. */
function unscannedWarning(o, cancelAt) {
  const ate = fmtNY(cancelAt, true)
  const n = o.order_number
  return {
    type: 'store_ship_by_warning', icon: '⏰',
    title: `Pedido #${n}: a transportadora ainda não registrou o pacote`,
    body: `A transportadora ainda não registrou seu pacote. Se não houver leitura até ${ate}, o pedido é cancelado e o comprador reembolsado.`,
    mail: {
      subject: `Pedido #${n}: pacote ainda sem leitura da transportadora`,
      kicker: 'BRASILCONNECT STORE · PRAZO',
      title: `Pedido #${n}: a transportadora ainda não registrou o pacote`,
      paragraphs: [
        `A etiqueta do pedido <strong>#${n}</strong> foi comprada, mas a transportadora ainda não registrou o pacote${o.tracking_number ? ` (rastreio <strong>${esc(o.tracking_number)}</strong>)` : ''}.`,
        `Se não houver leitura até <strong>${esc(ate)}</strong> (horário de Nova York), o pedido é cancelado, o comprador recebe o reembolso e a etiqueta é devolvida à Shippo.`,
        'Ainda não postou? Poste o quanto antes. Já postou? Guarde o comprovante de postagem; a leitura costuma aparecer em até um dia útil.',
      ],
      ctaUrl: APP_URL + sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cancelamento automatico (prazo vencido)
// ─────────────────────────────────────────────────────────────────────────────
async function stepAutoCancel({ supabase, stripe, cfg, left, summary }) {
  const out = { found: 0, canceled: 0, unscanned: 0, scanned: 0, deferred: 0, failed: 0, errors: 0 }
  if (!stripe) return { ...out, skipped: 'Stripe não configurado' }

  const now = new Date()
  const grace = Math.max(0, cfg.auto_cancel_grace_days || 0)
  // autoCancelAt(prazo) >= ship_by + grace dias corridos: filtro largo no banco, conta exata aqui.
  // Pedido com contestacao no cartao fica com o admin (reembolso duplicado).
  // Etiqueta em 'purchasing' espera o reparo de etiqueta (etapa 3).
  const rough = new Date(now.getTime() - grace * 86400_000).toISOString()
  const { data, error } = await supabase.from('bc_store_orders').select('*')
    .eq('status', 'paid').lt('ship_by', rough).neq('dispute_status', 'chargeback').neq('label_status', 'purchasing')
    .order('ship_by', { ascending: true }).limit(LIMITS.cancels * 2)
  if (error) throw new Error('pedidos: ' + error.message)
  // Mesma data que o painel e o comprador veem (orderAutoCancelAt); etiqueta da Store: +2 dias uteis
  const isLate = (o) => {
    const at = cancelAtFor(o, cfg)
    return !!at && now > at
  }
  const late = (data || []).filter(isLate)

  // Etiqueta da Store comprada e nunca escaneada pela transportadora
  const { data: shipped, error: sErr } = await supabase.from('bc_store_orders').select('*')
    .eq('status', 'shipped').eq('label_status', 'purchased').lt('ship_by', rough)
    .is('buyer_confirmed_at', null).in('payout_status', ['pending', 'blocked', 'held'])
    .order('ship_by', { ascending: true }).limit(LIMITS.cancels * 2)
  if (sErr) throw new Error('pedidos enviados: ' + sErr.message)
  const unscanned = (shipped || []).filter(o => neverScanned(o) && !ACTIVE_DISPUTES.includes(o.dispute_status) && isLate(o))

  const todo = [...late.map(o => ({ o, unscanned: false })), ...unscanned.map(o => ({ o, unscanned: true }))].slice(0, LIMITS.cancels)
  out.found = todo.length

  for (const { o, unscanned: wasShipped } of todo) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    try {
      let order = o
      if (wasShipped) {
        // O rastreio gravado pode ter horas: confere ao vivo antes de cancelar
        const live = await liveTrack(o)
        if (live.error) {
          // Sem como confirmar agora: nao cancela; tenta de novo na proxima rodada
          out.deferred++
          pushErr(summary, 'auto_cancel', o.id, 'rastreio ao vivo: ' + (live.error?.message || live.error))
          continue
        }
        if (live.checked && SCANNED_STATUSES.has(live.status)) {
          // A transportadora leu o pacote: aplica a leitura e o pedido segue
          out.scanned++
          await applyTracking(supabase, o, trackPatch(live.t, live.status))
          continue
        }
        const reverted = await revertUnscannedLabel(supabase, o)
        if (!reverted) continue // o rastreio mudou no meio: a transportadora recebeu o pacote
        out.unscanned++
        await logEvent(supabase, o.id, 'label_unused', {
          actor: 'system',
          message: 'A transportadora nunca recebeu o pacote da etiqueta comprada. O pedido foi cancelado por prazo vencido.',
          data: { tracking_number: o.tracking_number, tracking_status: o.tracking_status },
        })
        order = { ...o, status: 'paid', shipped_at: null, tracking_number: null, tracking_url: null, tracking_status: null, tracking_substatus: null, tracking_updated_at: null }
      }
      const reason = wasShipped
        ? 'a etiqueta foi comprada, mas a transportadora nunca recebeu o pacote'
        : o.fulfillment === 'ship' ? 'a loja não postou o pedido no prazo' : 'a loja não marcou a entrega no prazo'
      const r = await cancelOrder(supabase, stripe, order, { by: 'system', reason })
      if (r?.ok) {
        out.canceled++
      } else {
        out.failed++
        pushErr(summary, 'auto_cancel', o.id, r?.error || 'falhou')
        await reportCancelFailureOnce(supabase, o, r?.error)
      }
    } catch (e) {
      out.errors++
      pushErr(summary, 'auto_cancel', o.id, e)
    }
  }
  return out
}

/** Volta para 'paid' um pedido com etiqueta nunca escaneada (guarda: nada mudou desde a leitura). */
async function revertUnscannedLabel(supabase, o) {
  let q = supabase.from('bc_store_orders').update({
    status: 'paid', shipped_at: null,
    tracking_number: null, tracking_url: null, tracking_status: null, tracking_substatus: null, tracking_updated_at: null,
  }).eq('id', o.id).eq('status', 'shipped').eq('label_status', 'purchased').is('buyer_confirmed_at', null)
  q = o.tracking_status == null ? q.is('tracking_status', null) : q.eq('tracking_status', o.tracking_status)
  const { data, error } = await q.select('id')
  if (error) throw new Error('voltar o pedido para cancelamento: ' + error.message)
  return !!data?.length
}

/** Avisa o admin so na primeira falha de cancelamento automatico do pedido (o cron tenta de novo a cada hora). */
async function reportCancelFailureOnce(supabase, order, message) {
  await reportOnce(supabase, order.id, 'auto_cancel_failed',
    'O cancelamento automático não saiu; a BrasilConnect já foi avisada.',
    `Store: cancelamento automático do pedido #${order.order_number} falhou`,
    [
      `O prazo do pedido <strong>#${order.order_number}</strong> venceu, mas o cancelamento automático falhou: ${esc(message || 'erro desconhecido')}.`,
      'O cron tenta de novo a cada hora. Se continuar falhando, cancele e reembolse pelo admin.',
    ], message)
}

/** Registra um evento e avisa o admin uma vez por pedido e tipo de falha. */
async function reportOnce(supabase, orderId, kind, eventMessage, subject, paragraphs, error) {
  const { data: prev } = await supabase.from('bc_store_order_events')
    .select('id').eq('order_id', orderId).eq('kind', kind).limit(1)
  if (prev?.length) return
  await logEvent(supabase, orderId, kind, { actor: 'system', message: eventMessage, data: { error: String(error?.message || error || '').slice(0, 300) } })
  await notifyAdmin(subject, paragraphs)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Rastreio parado (antes do aviso e do cancelamento)
// ─────────────────────────────────────────────────────────────────────────────
async function stepTracking({ supabase, left: leftAll, summary }) {
  // Deixa tempo para as etapas seguintes (aviso, cancelamento, repasse)
  const left = () => leftAll() - TRACK_RESERVE_MS
  const out = { found: 0, checked: 0, changed: 0, unchanged: 0, errors: 0 }
  if (!shippoEnabled()) return { ...out, skipped: 'Shippo não configurada' }

  const stale = new Date(Date.now() - TRACK_STALE_MS).toISOString()
  const { data, error } = await supabase.from('bc_store_orders').select('*')
    .eq('status', 'shipped').not('tracking_number', 'is', null)
    .or(`tracking_updated_at.is.null,tracking_updated_at.lt."${stale}"`)
    .order('tracking_updated_at', { ascending: true, nullsFirst: true })
    .limit(LIMITS.tracking * 4)
  if (error) throw new Error('pedidos: ' + error.message)

  const rows = data || []
  const list = []
  const unknownCarrier = []
  for (const o of rows) {
    const carrier = normalizeCarrier(o.carrier)
    if (carrier) list.push({ o, carrier })
    else unknownCarrier.push(o.id)
  }
  // Transportadora que a Shippo nao conhece: marca como conferido para nao ocupar a fila
  if (unknownCarrier.length) {
    const { error: uErr } = await supabase.from('bc_store_orders')
      .update({ tracking_updated_at: new Date().toISOString() }).in('id', unknownCarrier)
    if (uErr) console.error('[cron store] rastreio sem transportadora:', uErr.message)
  }
  const todo = list.slice(0, LIMITS.tracking)
  out.found = todo.length

  await runPool(todo, TRACK_CONCURRENCY, left, summary, async ({ o, carrier }) => {
    try {
      const t = await withTimeout(getTrack(carrier, o.tracking_number), TRACK_TIMEOUT_MS)
      out.checked++
      const st = String(t?.status || 'UNKNOWN').toUpperCase()
      const prev = String(o.tracking_status || '').toUpperCase()
      // Entrega ja registrada no rastreio, mas o pedido segue 'shipped' (rodada interrompida): aplica de novo
      const stuckDelivered = st === 'DELIVERED' && prev === 'DELIVERED' && !SUSPECT_HOLDS.has(o.hold_reason)
      if (TRACK_STATUSES.has(st) && (st !== prev || stuckDelivered)) {
        await applyTracking(supabase, o, trackPatch(t, st))
        out.changed++
      } else {
        await touchTracking(supabase, o.id)
        out.unchanged++
      }
    } catch (e) {
      out.errors++
      pushErr(summary, 'tracking', o.id, e)
      // Conta como conferido para nao travar a fila (proxima tentativa em 6h)
      await touchTracking(supabase, o.id).catch(() => {})
    }
  })
  return out
}

async function touchTracking(supabase, orderId) {
  const { error } = await supabase.from('bc_store_orders').update({ tracking_updated_at: new Date().toISOString() }).eq('id', orderId)
  if (error) throw new Error('tracking_updated_at: ' + error.message)
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Repasse travado em 'releasing' (a rodada que fazia o transfer morreu no meio)
// ─────────────────────────────────────────────────────────────────────────────
async function stepStuckPayouts({ supabase, stripe, left, summary }) {
  const out = { found: 0, recovered: 0, released: 0, still: 0, errors: 0 }
  if (!stripe) return { ...out, skipped: 'Stripe não configurado' }

  const stale = new Date(Date.now() - RELEASE_STALE_MS).toISOString()
  const { data, error } = await supabase.from('bc_store_orders').select('*')
    .eq('payout_status', 'releasing')
    .or(`releasing_at.is.null,releasing_at.lt."${stale}"`)
    .order('releasing_at', { ascending: true, nullsFirst: true })
    .limit(LIMITS.stuck)
  if (error) throw new Error('pedidos: ' + error.message)
  const list = data || []
  out.found = list.length

  for (const o of list) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    try {
      // releaseOrder confere no Stripe: transfer feito -> grava; nao feito -> destrava
      // (devolve a divida abatida) e, se o repasse ja venceu, tenta de novo
      const r = await releaseOrder(supabase, stripe, o, { actor: 'system' })
      const { data: after, error: aErr } = await supabase.from('bc_store_orders')
        .select('payout_status, stripe_transfer_id').eq('id', o.id).maybeSingle()
      if (aErr) throw new Error(aErr.message)
      if (after?.payout_status === 'releasing') {
        out.still++
        pushErr(summary, 'stuck_payouts', o.id, r?.error || 'continua em processamento')
        await reportStuckOnce(supabase, o, r?.error)
        continue
      }
      out.recovered++
      if (after?.stripe_transfer_id || after?.payout_status === 'released') out.released++
    } catch (e) {
      out.errors++
      pushErr(summary, 'stuck_payouts', o.id, e)
      await reportStuckOnce(supabase, o, e?.message).catch(() => {})
    }
  }
  return out
}

/**
 * Avisa o admin uma vez por travamento (o mesmo releasing_at) quando o cron nao
 * consegue destravar o repasse. Evento 'payout_failed' (interno: loja e comprador nao veem).
 */
async function reportStuckOnce(supabase, o, message) {
  const mark = o.releasing_at ? new Date(o.releasing_at).toISOString() : 'sem-data'
  const { data: prev } = await supabase.from('bc_store_order_events')
    .select('data').eq('order_id', o.id).eq('kind', 'payout_failed').limit(50)
  if ((prev || []).some(e => eventData(e)?.stuck === mark)) return
  await logEvent(supabase, o.id, 'payout_failed', {
    actor: 'system', message: 'Repasse travado em processamento; a BrasilConnect já foi avisada.',
    data: { stuck: mark, error: String(message || '').slice(0, 300) },
  })
  await notifyAdmin(`Store: repasse travado no pedido #${o.order_number}`, [
    `O repasse do pedido <strong>#${o.order_number}</strong> está em processamento desde ${esc(o.releasing_at ? fmtNY(o.releasing_at, true) : 'data desconhecida')} e o cron não conseguiu conferir no Stripe: ${esc(message || 'erro desconhecido')}.`,
    'O cron tenta de novo a cada hora. Pelo admin, use "Destravar repasse" no pedido.',
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Repasses vencidos
// ─────────────────────────────────────────────────────────────────────────────
async function stepPayouts({ supabase, stripe, cfg, left, summary }) {
  const out = { found: 0, due: 0, released: 0, blocked: 0, failed: 0, skipped: 0, errors: 0 }
  if (!stripe) return { ...out, skipped: 'Stripe não configurado' }

  const { data, error } = await supabase.from('bc_store_orders').select('*')
    .in('status', ['shipped', 'delivered'])
    .in('payout_status', ['pending', 'blocked'])
    .in('dispute_status', ['none', 'resolved_release'])
    .is('stripe_transfer_id', null)
    .order('created_at', { ascending: true }).limit(500)
  if (error) throw new Error('pedidos: ' + error.message)
  const rows = data || []
  out.found = rows.length
  if (!rows.length) return out

  // Loja com repasse travado (Stripe incompleto) e que continua sem Stripe: nem tenta
  const sellers = await loadSellers(supabase, rows.map(o => o.seller_id), 'id, stripe_account_id, stripe_transfers_active')
  const newSeller = new Map()
  const now = new Date()
  const due = []
  for (const o of rows) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    const s = sellers[o.seller_id]
    if (o.payout_status === 'blocked' && !(s?.stripe_account_id && s?.stripe_transfers_active)) { out.blocked++; continue }
    if (!newSeller.has(o.seller_id)) newSeller.set(o.seller_id, await isNewSeller(supabase, o.seller_id, cfg))
    const at = releaseDueAt(o, cfg, { newSeller: newSeller.get(o.seller_id) })
    if (at && at <= now) due.push(o)
    if (due.length >= LIMITS.payouts) break
  }
  out.due = due.length

  for (const o of due) {
    if (left() < MIN_LEFT_MS) { summary.partial = true; break }
    try {
      // Le de novo: uma contestacao ou retencao pode ter chegado no meio da rodada
      const { data: fresh, error: fErr } = await supabase.from('bc_store_orders').select('*').eq('id', o.id).maybeSingle()
      if (fErr) throw new Error(fErr.message)
      if (!fresh || fresh.stripe_transfer_id
        || !['shipped', 'delivered'].includes(fresh.status)
        || !['pending', 'blocked'].includes(fresh.payout_status)
        || !['none', 'resolved_release'].includes(fresh.dispute_status)) {
        out.skipped++
        continue
      }
      const r = await releaseOrder(supabase, stripe, fresh, { actor: 'system' })
      if (r?.ok) out.released++
      else if (/conta de recebimento/i.test(r?.error || '')) out.blocked++
      else {
        out.failed++
        pushErr(summary, 'payouts', o.id, r?.error || 'falhou')
      }
    } catch (e) {
      out.errors++
      pushErr(summary, 'payouts', o.id, e)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitarios
// ─────────────────────────────────────────────────────────────────────────────
function cronAuthorized(req) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const auth = req.headers['authorization'] || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const given = bearer || req.headers['x-cron-secret'] || req.query?.secret
  if (!given || typeof given !== 'string') return false
  return safeEqual(given, expected)
}

/** Comparacao em tempo constante (hash para os dois lados terem o mesmo tamanho). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

const isMissingTable = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''))

function pushErr(summary, step, id, e) {
  if (summary.errors.length >= MAX_ERRORS) return
  summary.errors.push({ step, id: id || null, error: String(e?.message || e || 'erro').slice(0, 200) })
}

async function loadSellers(supabase, ids, cols) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data, error } = await supabase.from('bc_store_sellers').select(cols).in('id', uniq)
  if (error) throw new Error('lojas: ' + error.message)
  return Object.fromEntries((data || []).map(s => [s.id, s]))
}

/** Hora (0-23) em Nova York. */
function nyHour(d = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(d)
  return parseInt(h, 10) % 24
}

function fmtNY(date, withTime) {
  const d = new Date(date)
  const opts = { timeZone: 'America/New_York', weekday: 'long', day: '2-digit', month: 'long' }
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString('pt-BR', opts)
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('tempo esgotado')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Executa fn em ate `size` itens ao mesmo tempo, parando quando o tempo acaba. */
async function runPool(items, size, left, summary, fn) {
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      if (left() < MIN_LEFT_MS) { summary.partial = true; return }
      const item = items[i++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
}
