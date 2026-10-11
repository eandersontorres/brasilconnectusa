/**
 * /api/store/buyer — area do comprador da BrasilConnect Store (login obrigatorio).
 *
 *   GET  ?action=orders                 lista (sem pending_payment/expired)
 *   GET  ?action=order&id=              detalhe (BuyerOrderDetail)
 *   POST ?action=cancel                 { order_id, reason }       pago e sem etiqueta
 *   POST ?action=confirm                { order_id }               recebi: libera o repasse
 *   POST ?action=dispute                { order_id, reason, details }  Garantia BrasilConnect
 *   POST ?action=escalate               { order_id }               pedir ajuda a BrasilConnect
 *   POST ?action=close-dispute          { order_id }               problema resolvido
 *   POST ?action=message                { order_id, body }
 *   POST ?action=review                 { order_id, product_id, rating, body }
 *   POST ?action=report                 { product_id, reason, details }
 *
 * Contrato: docs/store/ARQUITETURA.md (secao 6.4). So o dono do pedido
 * (buyer_user_id) acessa. Nada de repasse, comissao, etiqueta, Stripe ou
 * Shippo sai daqui.
 */
import {
  getSupabase, getStripe, getConfig, err, isUuid, cleanText, requireUser, logEvent, notify, notifyAdmin,
  esc, APP_URL, ORDER_STATUS_PT, DISPUTE_REASON_PT, addBusinessDays, addDays, autoCancelAt, orderAutoCancelAt, orderDeadline, hasContactInfo,
} from '../_lib/store.js'
import {
  ACTIVE_DISPUTES, loadOrder, cancelOrder, markDelivered, releaseOrder, notifyOrderParties, sellerOrderUrl, TRACKING_PT,
} from '../_lib/storeOrders.js'
import { rateLimit } from '../_lib/rateLimit.js'

const VISIBLE_STATUSES = ['paid', 'shipped', 'delivered', 'completed', 'canceled', 'refunded']
// Eventos internos (repasse, comissao, custo de etiqueta, retencao, falhas
// operacionais): o comprador nao ve. Os 6 primeiros sao os do contrato; os
// demais sao gravados por admin/store.js, cron/store.js, seller.js e
// stripe/webhook.js e tambem sao so para a loja/admin (ship_by_warning e o
// lembrete de prazo que o cron manda a loja).
const HIDDEN_EVENT_KINDS = [
  'payout', 'payout_failed', 'admin_note', 'hold', 'unhold', 'label_purchased_cost',
  'payout_held', 'payout_unheld', 'auto_cancel_failed', 'label_failed', 'label_refund', 'note',
  'ship_by_warning',
]
// Qualquer evento de repasse (payout, payout_failed, payout_held...) ou de retencao e interno
const isHiddenEvent = (kind) => HIDDEN_EVENT_KINDS.includes(kind) || /^payout/.test(String(kind || '')) || /^hold/.test(String(kind || ''))
const TRACKING_PT_VALUES = new Set(Object.values(TRACKING_PT))
// Texto proprio para o comprador em eventos cuja mensagem fala do repasse/etiqueta
const BUYER_EVENT_TEXT = {
  completed: 'Pedido concluído',
  label_purchased: 'Etiqueta de envio criada',
}
const REPORT_REASONS = {
  prohibited: 'Produto proibido',
  counterfeit: 'Falsificado ou réplica',
  misleading: 'Anúncio enganoso',
  offensive: 'Conteúdo ofensivo',
  scam: 'Golpe',
  other: 'Outro motivo',
}
const MAIL_QUIET_MS = 30 * 60 * 1000       // depois de uma mensagem, as seguintes nao avisam a loja por 30 min
const MSG_DAY_MAX = 30                      // mensagens do comprador por pedido em 24 h
const CHAT_CLOSED_AFTER_MS = 30 * 24 * 3600 * 1000 // conversa fecha 30 dias depois de cancelado/reembolsado/concluido

// ─────────────────────────────────────────────────────────────────────────────
// Utilitarios
// ─────────────────────────────────────────────────────────────────────────────
function hitLimit(req, res, name, max, windowMs = 60000) {
  const hit = rateLimit({ headers: req.headers || {}, url: '/api/store/buyer/' + name }, { windowMs, max })
  if (!hit) return false
  res.setHeader('Retry-After', String(hit.retryAfter))
  err(res, 429, 'Muitas tentativas seguidas. Espere um pouco e tente de novo.')
  return true
}

const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null)

/** Pedido do comprador (ou null). Nunca devolve pedido de outra pessoa. */
async function ownOrder(supabase, id, userId) {
  if (!isUuid(id)) return null
  const { data, error } = await supabase.from('bc_store_orders').select('*')
    .eq('id', id).eq('buyer_user_id', userId).maybeSingle()
  if (error) throw new Error('pedido: ' + error.message)
  return data || null
}

function canDispute(order, cfg, now = new Date()) {
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) return false
  if (['shipped', 'delivered'].includes(order.status)) return true
  if (order.status === 'completed') {
    // A janela conta do mais recente entre entrega e conclusao: uma data de
    // entrega antiga (rastreio de outro pacote) nao fecha a Garantia antes da hora
    const times = [order.delivered_at, order.completed_at].map(d => (d ? new Date(d).getTime() : NaN)).filter(t => !isNaN(t))
    if (!times.length) return false
    return addDays(new Date(Math.max(...times)), cfg.dispute_window_days) >= now
  }
  return false
}

/** Quando a conversa de um pedido encerrado fecha (null = aberta). */
function chatClosedAt(order, lastRefundAt = null) {
  // Com problema aberto (Garantia ou contestacao no cartao) a conversa segue aberta,
  // como no painel da loja: os dois lados precisam conseguir responder
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) return null
  let base = null
  if (order.status === 'canceled') base = order.canceled_at
  else if (order.status === 'completed') base = order.completed_at
  else if (order.status === 'refunded') base = lastRefundAt || order.completed_at || order.delivered_at || order.shipped_at
  if (!base) return null
  return new Date(new Date(base).getTime() + CHAT_CLOSED_AFTER_MS)
}

/** Mensagem de rastreio sempre em portugues (codigo cru ou texto da transportadora viram PT). */
function trackingMessage(msg) {
  const m = String(msg || '').trim()
  if (TRACKING_PT[m.toUpperCase()]) return TRACKING_PT[m.toUpperCase()]
  if (TRACKING_PT_VALUES.has(m)) return m
  return 'Atualização do rastreio'
}

function escalateFrom(order, cfg) {
  return addBusinessDays(order.dispute_opened_at, cfg.seller_response_days)
}

function canEscalate(order, messages, cfg, now = new Date()) {
  if (order.dispute_status !== 'open' || !order.dispute_opened_at) return false
  if (escalateFrom(order, cfg) <= now) return true
  const opened = new Date(order.dispute_opened_at).getTime()
  return messages.some(m => m.sender_role === 'seller' && new Date(m.created_at).getTime() > opened)
}

/**
 * Mensagem de evento sem informacao do repasse da loja. refundOrder e o
 * webhook de contestacao juntam na mesma mensagem o que aconteceu com o
 * comprador e o estorno/retencao do repasse ("... . Estornado $X do repasse
 * da loja."). A primeira frase fica; as seguintes que falam de repasse,
 * estorno ou comissao saem.
 */
const INTERNAL_SENTENCE = /repasse|estorn|comiss[aã]o|cobriu|etiqueta.*\$\d/i
function buyerEventMessage(e) {
  if (BUYER_EVENT_TEXT[e.kind]) return BUYER_EVENT_TEXT[e.kind]
  if (e.kind === 'tracking') return trackingMessage(e.message)
  const msg = e.message ? String(e.message) : ''
  if (!msg) return null
  const parts = msg.split(/(?<=\.)\s+/)
  const kept = [parts[0], ...parts.slice(1).filter(p => !INTERNAL_SENTENCE.test(p))]
  // A primeira frase tambem sai se for so sobre o repasse (ex.: retencao)
  if (INTERNAL_SENTENCE.test(kept[0]) && !/reembolso|cancelad|contesta|problema/i.test(kept[0])) kept.shift()
  // cancelOrder escreve "Cancelado por o comprador"/"por a loja"
  const out = kept.join(' ').trim().replace(/\bpor o\b/g, 'pelo').replace(/\bpor a\b/g, 'pela')
  return out || null
}

async function recalcRating(supabase, table, column, id) {
  const { data, error } = await supabase.from('bc_store_reviews').select('rating')
    .eq(column, id).eq('status', 'visible').limit(5000)
  if (error) { console.error('[store/buyer] media de avaliacoes:', error.message); return }
  const n = (data || []).length
  const avg = n ? Math.round((data.reduce((s, r) => s + (r.rating || 0), 0) / n) * 100) / 100 : null
  const { error: uErr } = await supabase.from(table).update({ rating_avg: avg, rating_count: n }).eq('id', id)
  if (uErr) console.error('[store/buyer] gravar media:', table, uErr.message)
}

async function sellerContact(supabase, sellerId) {
  const { data, error } = await supabase.from('bc_store_sellers').select('id, user_id, email, name').eq('id', sellerId).maybeSingle()
  if (error) console.error('[store/buyer] loja:', error.message)
  return data || null
}

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────
async function listOrders(req, res, supabase, user) {
  const { data: orders, error } = await supabase.from('bc_store_orders')
    .select('id, order_number, status, fulfillment, created_at, total_cents, seller_id, tracking_number, tracking_url, carrier, dispute_status')
    .eq('buyer_user_id', user.id).in('status', VISIBLE_STATUSES)
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error('pedidos: ' + error.message)
  const list = orders || []
  if (!list.length) return res.status(200).json({ orders: [] })

  const ids = list.map(o => o.id)
  const sellerIds = [...new Set(list.map(o => o.seller_id))]
  const [iRes, sRes] = await Promise.all([
    supabase.from('bc_store_order_items').select('order_id, title, image_url, quantity, created_at').in('order_id', ids).order('created_at'),
    supabase.from('bc_store_sellers').select('id, slug, name, logo_url').in('id', sellerIds),
  ])
  if (iRes.error) throw new Error('itens: ' + iRes.error.message)
  if (sRes.error) throw new Error('lojas: ' + sRes.error.message)
  const sMap = new Map((sRes.data || []).map(s => [s.id, s]))
  const byOrder = new Map()
  for (const it of iRes.data || []) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, [])
    byOrder.get(it.order_id).push({ title: it.title, image_url: it.image_url || null, quantity: it.quantity })
  }

  return res.status(200).json({
    orders: list.map(o => {
      const s = sMap.get(o.seller_id)
      return {
        id: o.id, order_number: o.order_number, status: o.status, status_label: ORDER_STATUS_PT[o.status] || o.status,
        fulfillment: o.fulfillment, created_at: o.created_at, total_cents: o.total_cents,
        seller: s ? { slug: s.slug, name: s.name, logo_url: s.logo_url || null } : { slug: null, name: 'Loja', logo_url: null },
        items: byOrder.get(o.id) || [],
        tracking_number: o.tracking_number || null, tracking_url: httpUrl(o.tracking_url), carrier: o.carrier || null,
        dispute_status: o.dispute_status,
      }
    }),
  })
}

async function orderDetail(req, res, supabase, user) {
  const order = await ownOrder(supabase, String((req.query && req.query.id) || ''), user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  const cfg = await getConfig(supabase)

  const [iRes, sRes, eRes, mRes] = await Promise.all([
    supabase.from('bc_store_order_items')
      .select('id, product_id, title, image_url, unit_price_cents, quantity, subtotal_cents, reviewed, created_at')
      .eq('order_id', order.id).order('created_at'),
    supabase.from('bc_store_sellers')
      .select('slug, name, logo_url, city, state, accepts_returns, return_window_days, return_policy, warranty_policy')
      .eq('id', order.seller_id).maybeSingle(),
    supabase.from('bc_store_order_events')
      .select('kind, actor, message, created_at')
      .eq('order_id', order.id).not('kind', 'in', `(${HIDDEN_EVENT_KINDS.join(',')})`)
      .order('created_at', { ascending: true }).limit(300),
    supabase.from('bc_store_messages')
      .select('id, sender_role, sender_user_id, body, created_at')
      .eq('order_id', order.id).order('created_at', { ascending: false }).limit(300),
  ])
  if (iRes.error) throw new Error('itens: ' + iRes.error.message)
  if (sRes.error) throw new Error('loja: ' + sRes.error.message)
  if (eRes.error) throw new Error('eventos: ' + eRes.error.message)
  if (mRes.error) throw new Error('mensagens: ' + mRes.error.message)

  const items = iRes.data || []
  const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))]
  const slugs = {}
  if (productIds.length) {
    const { data: prods, error: pErr } = await supabase.from('bc_store_products').select('id, slug').in('id', productIds)
    if (pErr) throw new Error('produtos: ' + pErr.message)
    for (const p of prods || []) slugs[p.id] = p.slug
  }
  const messages = (mRes.data || []).slice().reverse()
  const s = sRes.data || null
  const z = order.zone_snapshot || {}
  const paidLike = !['pending_payment', 'expired'].includes(order.status)
  const events = (eRes.data || []).filter(e => !isHiddenEvent(e.kind))
  const lastRefund = events.filter(e => e.kind === 'refunded').pop()
  const chatClosed = chatClosedAt(order, lastRefund ? lastRefund.created_at : null)
  const trackingStatus = order.tracking_status ? String(order.tracking_status).toUpperCase() : null

  return res.status(200).json({
    order: {
      id: order.id, order_number: order.order_number, status: order.status,
      status_label: ORDER_STATUS_PT[order.status] || order.status, fulfillment: order.fulfillment,
      created_at: order.created_at, paid_at: order.paid_at, ship_by: order.ship_by, shipped_at: order.shipped_at,
      // Prazo efetivo (mesma regra do cron: na entrega local vale o maior entre o
      // prazo da loja e o prazo anunciado pela regiao). So enquanto aguarda envio.
      deadline_at: order.status === 'paid' ? (orderDeadline(order)?.toISOString() || null) : null,
      // Quando o cron cancela se a loja nao enviar/entregar (prazo + carencia em dias uteis)
      auto_cancel_at: orderAutoCancelAt(order, cfg)?.toISOString() || null,
      handoff_scheduled_at: order.handoff_scheduled_at || null,
      delivered_at: order.delivered_at, completed_at: order.completed_at, canceled_at: order.canceled_at,
      cancel_reason: order.cancel_reason || null,
      items_cents: order.items_cents, shipping_cents: order.shipping_cents, tax_cents: order.tax_cents,
      total_cents: order.total_cents, refunded_cents: order.refunded_cents,
      carrier: order.carrier || null, service: order.service || null,
      tracking_number: order.tracking_number || null, tracking_url: httpUrl(order.tracking_url),
      tracking_status: order.tracking_status || null,
      tracking_status_label: trackingStatus ? (TRACKING_PT[trackingStatus] || null) : null,
      dispute_status: order.dispute_status, dispute_reason: order.dispute_reason || null,
      dispute_details: order.dispute_details || null, dispute_opened_at: order.dispute_opened_at || null,
      buyer_confirmed_at: order.buyer_confirmed_at || null,
      ship_to: order.ship_to || null,
      zone: {
        name: z.name || null, method: z.method || order.fulfillment,
        est_days_min: z.est_days_min ?? null, est_days_max: z.est_days_max ?? null,
        // Instrucoes de retirada/entrega so depois do pagamento
        pickup_note: paidLike ? (z.pickup_note || null) : null,
      },
    },
    items: items.map(i => ({
      id: i.id, product_id: i.product_id, product_slug: i.product_id ? (slugs[i.product_id] || null) : null,
      title: i.title, image_url: i.image_url || null, unit_price_cents: i.unit_price_cents,
      quantity: i.quantity, subtotal_cents: i.subtotal_cents, reviewed: !!i.reviewed,
    })),
    seller: s ? {
      slug: s.slug, name: s.name, logo_url: s.logo_url || null, city: s.city || null, state: s.state || null,
      accepts_returns: !!s.accepts_returns, return_window_days: s.return_window_days,
      return_policy: s.return_policy || null, warranty_policy: s.warranty_policy || null,
    } : null,
    events: events
      .map(e => ({ kind: e.kind, actor: e.actor, message: buyerEventMessage(e), created_at: e.created_at })),
    messages: messages.map(m => ({
      id: m.id, sender_role: m.sender_role, body: m.body, created_at: m.created_at,
      mine: m.sender_role === 'buyer' && m.sender_user_id === user.id,
    })),
    can: {
      cancel: order.status === 'paid' && ['none', 'failed'].includes(order.label_status),
      confirm: ['shipped', 'delivered'].includes(order.status) && !ACTIVE_DISPUTES.includes(order.dispute_status) && !order.buyer_confirmed_at,
      dispute: canDispute(order, cfg),
      escalate: canEscalate(order, messages, cfg),
      close_dispute: ['open', 'escalated'].includes(order.dispute_status),
      review: ['delivered', 'completed'].includes(order.status) && !ACTIVE_DISPUTES.includes(order.dispute_status)
        && items.some(i => i.product_id && !i.reviewed),
      message: paidLike && !(chatClosed && chatClosed <= new Date()),
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────
async function cancelAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'cancel', 10)) return
  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  if (order.status !== 'paid' || !['none', 'failed'].includes(order.label_status)) {
    return err(res, 409, 'Esse pedido não pode mais ser cancelado por aqui. Fale com a loja pela conversa do pedido.')
  }
  const stripe = await getStripe()
  if (!stripe) return err(res, 503, 'O reembolso está indisponível agora. Tente de novo mais tarde.')
  const full = await loadOrder(supabase, order.id)
  if (!full) return err(res, 404, 'Pedido não encontrado.')
  const reason = cleanText(body.reason, 300)
  const r = await cancelOrder(supabase, stripe, full, { by: 'buyer', reason, actor_id: user.id })
  if (!r.ok) return err(res, 409, r.error || 'Não foi possível cancelar agora.')
  return res.status(200).json({ ok: true })
}

async function confirmAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'confirm', 10)) return
  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  if (order.buyer_confirmed_at) return res.status(200).json({ ok: true })
  if (!['shipped', 'delivered'].includes(order.status)) return err(res, 409, 'Esse pedido ainda não foi enviado ou já foi concluído.')
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) return err(res, 409, 'Há um problema aberto neste pedido. Marque como resolvido antes de confirmar o recebimento.')

  const now = new Date().toISOString()
  const { data: claimed, error } = await supabase.from('bc_store_orders')
    .update({ buyer_confirmed_at: now })
    .eq('id', order.id).eq('buyer_user_id', user.id)
    .in('status', ['shipped', 'delivered']).is('buyer_confirmed_at', null)
    .not('dispute_status', 'in', `(${ACTIVE_DISPUTES.join(',')})`)
    .select('id')
  if (error) throw new Error('confirmar: ' + error.message)
  if (!claimed || !claimed.length) return err(res, 409, 'O pedido mudou de situação. Atualize a página.')
  await logEvent(supabase, order.id, 'buyer_confirmed', { actor: 'buyer', actor_id: user.id, message: 'Comprador confirmou o recebimento' })

  if (order.status === 'shipped') {
    const d = await markDelivered(supabase, { ...order, buyer_confirmed_at: now }, { actor: 'buyer', actor_id: user.id, message: 'Recebimento confirmado pelo comprador' })
    if (!d.ok) console.error('[store/buyer] markDelivered:', order.id, d.error)
  }

  // Com buyer_confirmed_at o repasse vence na hora. Se falhar, o cron tenta de novo.
  let released = false
  const stripe = await getStripe()
  const fresh = await loadOrder(supabase, order.id)
  if (stripe && fresh) {
    try {
      const r = await releaseOrder(supabase, stripe, fresh, { actor: 'buyer', actor_id: user.id })
      released = !!r.ok
      if (!r.ok) console.error('[store/buyer] repasse ficou para depois:', order.id, r.error)
    } catch (e) {
      console.error('[store/buyer] releaseOrder:', order.id, e.message)
    }
  }

  const seller = await sellerContact(supabase, order.seller_id)
  if (seller) {
    await notify({
      user_id: seller.user_id, type: 'store_order_confirmed', icon: '✅',
      title: `Pedido #${order.order_number}: recebimento confirmado`,
      body: 'O comprador confirmou que recebeu tudo certo.',
      url: sellerOrderUrl(order), metadata: { order_id: order.id },
    })
  }
  return res.status(200).json({ ok: true, released })
}

async function disputeAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'dispute', 5)) return
  const reason = String(body.reason || '')
  if (!Object.prototype.hasOwnProperty.call(DISPUTE_REASON_PT, reason)) return err(res, 400, 'Escolha o motivo do problema.')
  const details = cleanText(body.details, 2000)
  if (!details || details.length < 10) return err(res, 400, 'Conte em poucas palavras o que aconteceu (pelo menos 10 caracteres).')

  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  const cfg = await getConfig(supabase)
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) return err(res, 409, 'Já existe um problema aberto neste pedido.')
  if (!canDispute(order, cfg)) {
    return err(res, 409, order.status === 'completed'
      ? `O prazo para abrir um problema (${cfg.dispute_window_days} dias depois da entrega) já terminou.`
      : 'Esse pedido não aceita abrir problema agora.')
  }

  const now = new Date().toISOString()
  const { data: claimed, error } = await supabase.from('bc_store_orders')
    .update({
      dispute_status: 'open', dispute_reason: reason, dispute_details: details, dispute_opened_at: now,
      dispute_escalated_at: null, dispute_resolved_at: null, dispute_resolution: null,
    })
    .eq('id', order.id).eq('buyer_user_id', user.id).eq('status', order.status)
    .not('dispute_status', 'in', `(${ACTIVE_DISPUTES.join(',')})`)
    .select('id')
  if (error) throw new Error('disputa: ' + error.message)
  if (!claimed || !claimed.length) return err(res, 409, 'O pedido mudou de situação. Atualize a página.')

  const label = DISPUTE_REASON_PT[reason]
  await logEvent(supabase, order.id, 'dispute_opened', { actor: 'buyer', actor_id: user.id, message: `Problema aberto: ${label}` })
  await notifyOrderParties(supabase, order, {
    type: 'store_dispute_opened', icon: '⚠️',
    sellerTitle: `Problema aberto no pedido #${order.order_number}`,
    sellerBody: `O comprador relatou: ${label}. Responda pela conversa do pedido em até ${cfg.seller_response_days} dias úteis. O repasse fica retido até resolver.`,
    reason: details.slice(0, 500),
    skipBuyer: true,
  })
  if (order.status === 'completed') {
    await notifyAdmin(`Store: problema aberto depois do repasse · pedido #${order.order_number}`, [
      `O comprador abriu um problema (<strong>${esc(label)}</strong>) no pedido <strong>#${esc(order.order_number)}</strong>, que já teve o repasse enviado à loja.`,
      esc(details),
      'Se for o caso de reembolso, o valor sai do saldo da plataforma e precisa ser estornado da loja.',
    ])
  }
  return res.status(200).json({ ok: true })
}

async function escalateAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'escalate', 5)) return
  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  if (order.dispute_status !== 'open' || !order.dispute_opened_at) return err(res, 409, 'Não há problema aberto para encaminhar.')
  const cfg = await getConfig(supabase)

  const from = escalateFrom(order, cfg)
  let allowed = from <= new Date()
  if (!allowed) {
    const { data: replies, error: mErr } = await supabase.from('bc_store_messages').select('id')
      .eq('order_id', order.id).eq('sender_role', 'seller').gt('created_at', order.dispute_opened_at).limit(1)
    if (mErr) throw new Error('mensagens: ' + mErr.message)
    allowed = !!(replies && replies.length)
  }
  if (!allowed) {
    const when = from.toLocaleDateString('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: 'long' })
    return err(res, 409, `A loja tem até ${cfg.seller_response_days} dias úteis para responder. Se ela não resolver, você pode pedir ajuda a partir de ${when}.`)
  }

  const now = new Date().toISOString()
  const { data: claimed, error } = await supabase.from('bc_store_orders')
    .update({ dispute_status: 'escalated', dispute_escalated_at: now })
    .eq('id', order.id).eq('buyer_user_id', user.id).eq('dispute_status', 'open')
    .select('id')
  if (error) throw new Error('escalar: ' + error.message)
  if (!claimed || !claimed.length) return err(res, 409, 'O pedido mudou de situação. Atualize a página.')

  await logEvent(supabase, order.id, 'dispute_escalated', { actor: 'buyer', actor_id: user.id, message: 'Comprador pediu ajuda à BrasilConnect' })
  const label = DISPUTE_REASON_PT[order.dispute_reason] || 'Problema'
  await notifyAdmin(`Store: comprador pediu ajuda · pedido #${order.order_number}`, [
    `Problema: <strong>${esc(label)}</strong>, aberto em ${esc(new Date(order.dispute_opened_at).toLocaleDateString('pt-BR', { timeZone: 'America/New_York' }))}.`,
    order.dispute_details ? esc(order.dispute_details) : '',
    'Leia a conversa do pedido, o rastreio e decida (reembolso ou repasse) na aba Store do admin.',
  ].filter(Boolean))
  await notifyOrderParties(supabase, order, {
    type: 'store_dispute_escalated', icon: '⚖️',
    sellerTitle: `A BrasilConnect vai analisar o pedido #${order.order_number}`,
    sellerBody: 'O comprador pediu ajuda. Responda pela conversa do pedido e mande rastreio ou fotos se tiver. O repasse segue retido até a decisão.',
    skipBuyer: true,
  })
  return res.status(200).json({ ok: true })
}

async function closeDisputeAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'close-dispute', 10)) return
  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  if (!['open', 'escalated'].includes(order.dispute_status)) return err(res, 409, 'Não há problema aberto neste pedido.')

  const now = new Date().toISOString()
  const { data: claimed, error } = await supabase.from('bc_store_orders')
    .update({ dispute_status: 'resolved_release', dispute_resolved_at: now, dispute_resolution: 'Resolvido com a loja (encerrado pelo comprador)' })
    .eq('id', order.id).eq('buyer_user_id', user.id).in('dispute_status', ['open', 'escalated'])
    .select('id')
  if (error) throw new Error('encerrar: ' + error.message)
  if (!claimed || !claimed.length) return err(res, 409, 'O pedido mudou de situação. Atualize a página.')

  await logEvent(supabase, order.id, 'dispute_resolved', { actor: 'buyer', actor_id: user.id, message: 'Comprador marcou o problema como resolvido' })
  await notifyOrderParties(supabase, order, {
    type: 'store_dispute_resolved', icon: '🤝',
    sellerTitle: `Problema resolvido no pedido #${order.order_number}`,
    sellerBody: 'O comprador marcou o problema como resolvido. O repasse volta a seguir o prazo normal.',
    skipBuyer: true,
  })
  if (order.dispute_status === 'escalated') {
    await notifyAdmin(`Store: comprador encerrou o problema · pedido #${order.order_number}`, [
      'O comprador marcou como resolvido um problema que estava com a BrasilConnect. Nenhuma decisão é necessária.',
    ])
  }
  return res.status(200).json({ ok: true })
}

async function messageAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'message', 20)) return
  const raw = String(body.body ?? '')
  if (raw.trim().length > 2000) return err(res, 400, 'A mensagem pode ter até 2000 caracteres.')
  const text = cleanText(raw, 2000)
  if (!text) return err(res, 400, 'Escreva a mensagem.')

  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  if (['pending_payment', 'expired'].includes(order.status)) return err(res, 409, 'A conversa abre depois do pagamento.')

  // Pedido encerrado ha mais de 30 dias: a conversa fecha (menos com problema aberto)
  if (['canceled', 'refunded', 'completed'].includes(order.status)) {
    let lastRefundAt = null
    if (order.status === 'refunded') {
      const { data: ev, error: evErr } = await supabase.from('bc_store_order_events').select('created_at')
        .eq('order_id', order.id).eq('kind', 'refunded').order('created_at', { ascending: false }).limit(1)
      if (evErr) throw new Error('eventos: ' + evErr.message)
      lastRefundAt = ev && ev[0] ? ev[0].created_at : null
    }
    const closed = chatClosedAt(order, lastRefundAt)
    if (closed && closed <= new Date()) {
      return err(res, 409, 'A conversa deste pedido foi encerrada (o pedido terminou há mais de 30 dias). Se precisar de ajuda, escreva para oi@brasilconnectusa.com.')
    }
  }

  // Limite por pedido: 30 mensagens do comprador em 24 h
  const { count: dayCount, error: cErr } = await supabase.from('bc_store_messages').select('id', { count: 'exact', head: true })
    .eq('order_id', order.id).eq('sender_role', 'buyer').gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
  if (cErr) throw new Error('contagem de mensagens: ' + cErr.message)
  if ((dayCount || 0) >= MSG_DAY_MAX) {
    return err(res, 429, `Você mandou ${MSG_DAY_MAX} mensagens neste pedido nas últimas 24 horas. Espere a loja responder.`)
  }

  // Aviso (sino, push e e-mail) so se o comprador nao mandou mensagem nos ultimos
  // 30 min: as seguintes ficam na conversa sem disparar outro aviso para a loja
  const since = new Date(Date.now() - MAIL_QUIET_MS).toISOString()
  const { data: recent, error: rErr } = await supabase.from('bc_store_messages').select('id')
    .eq('order_id', order.id).eq('sender_role', 'buyer').gt('created_at', since).limit(1)
  if (rErr) console.error('[store/buyer] mensagens recentes:', rErr.message)
  const alertSeller = !rErr && !(recent && recent.length)

  const { data: msg, error } = await supabase.from('bc_store_messages')
    .insert({ order_id: order.id, sender_role: 'buyer', sender_user_id: user.id, body: text })
    .select('id, sender_role, body, created_at').single()
  if (error || !msg) throw new Error('mensagem: ' + (error ? error.message : 'sem retorno'))
  const { error: uErr } = await supabase.from('bc_store_orders').update({ last_message_at: msg.created_at }).eq('id', order.id)
  if (uErr) console.error('[store/buyer] last_message_at:', uErr.message)

  const seller = alertSeller ? await sellerContact(supabase, order.seller_id) : null
  if (seller) {
    const excerpt = text.length > 140 ? text.slice(0, 137) + '...' : text
    await notify({
      user_id: seller.user_id,
      email: seller.email,
      type: 'store_message', icon: '💬',
      title: `Nova mensagem no pedido #${order.order_number}`,
      body: excerpt,
      url: sellerOrderUrl(order), metadata: { order_id: order.id },
      mail: {
        subject: `Nova mensagem do comprador · pedido #${order.order_number}`,
        title: `Mensagem no pedido #${order.order_number}`,
        paragraphs: [esc(text).replace(/\n/g, '<br>'), 'Responda pela página do pedido no painel da loja.'],
        ctaUrl: APP_URL + sellerOrderUrl(order), ctaLabel: 'Responder',
      },
    })
  }
  if (order.dispute_status === 'escalated' && alertSeller) {
    await notifyAdmin(`Store: nova mensagem do comprador · pedido #${order.order_number}`, [esc(text).replace(/\n/g, '<br>')])
  }
  return res.status(200).json({ message: { id: msg.id, sender_role: 'buyer', body: msg.body, created_at: msg.created_at, mine: true } })
}

async function reviewAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'review', 10)) return
  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err(res, 400, 'Escolha de 1 a 5 estrelas.')
  if (!isUuid(body.product_id)) return err(res, 400, 'Produto inválido.')
  const productId = body.product_id.toLowerCase()
  const text = cleanText(body.body, 2000)
  // A avaliacao vai ao ar na pagina publica: nada de contato direto
  if (text && hasContactInfo(text)) return err(res, 400, 'A avaliação não pode ter telefone, e-mail, @ de rede social nem link.')

  const order = await ownOrder(supabase, body.order_id, user.id)
  if (!order) return err(res, 404, 'Pedido não encontrado.')
  if (!['delivered', 'completed'].includes(order.status)) return err(res, 409, 'Você pode avaliar depois de receber o pedido.')
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) return err(res, 409, 'Resolva o problema aberto antes de avaliar.')

  const { data: items, error: iErr } = await supabase.from('bc_store_order_items')
    .select('id, product_id, title, reviewed').eq('order_id', order.id).eq('product_id', productId).limit(1)
  if (iErr) throw new Error('itens: ' + iErr.message)
  const item = items && items[0]
  if (!item) return err(res, 400, 'Esse produto não faz parte do pedido.')
  if (item.reviewed) return err(res, 409, 'Você já avaliou esse produto.')

  // Trava o item antes de gravar (evita duas avaliacoes com clique duplo)
  const { data: locked, error: lErr } = await supabase.from('bc_store_order_items')
    .update({ reviewed: true }).eq('id', item.id).eq('reviewed', false).select('id')
  if (lErr) throw new Error('travar item: ' + lErr.message)
  if (!locked || !locked.length) return err(res, 409, 'Você já avaliou esse produto.')

  const { data: review, error: rErr } = await supabase.from('bc_store_reviews').insert({
    order_id: order.id, product_id: productId, seller_id: order.seller_id, buyer_user_id: user.id,
    rating, body: text, status: 'visible',
    // A moderacao por IA (cron) confere o texto; em caso grave, esconde
    agent_status: 'pending',
  }).select('id, product_id, rating, body, created_at').single()
  if (rErr || !review) {
    const dup = rErr && /duplicate|unique/i.test(rErr.message || '')
    if (!dup) await supabase.from('bc_store_order_items').update({ reviewed: false }).eq('id', item.id)
    if (dup) return err(res, 409, 'Você já avaliou esse produto.')
    throw new Error('avaliacao: ' + (rErr ? rErr.message : 'sem retorno'))
  }

  await recalcRating(supabase, 'bc_store_products', 'product_id', productId)
  await recalcRating(supabase, 'bc_store_sellers', 'seller_id', order.seller_id)
  await logEvent(supabase, order.id, 'review', { actor: 'buyer', actor_id: user.id, message: `Avaliação de ${rating} estrela${rating > 1 ? 's' : ''} para "${item.title}"` })

  const seller = await sellerContact(supabase, order.seller_id)
  if (seller) {
    await notify({
      user_id: seller.user_id, email: seller.email, type: 'store_review', icon: '⭐',
      title: `Nova avaliação: ${rating} de 5`,
      body: item.title,
      url: '/store/painel?aba=avaliacoes', metadata: { order_id: order.id, review_id: review.id },
      mail: {
        subject: `Nova avaliação na sua loja: ${rating} de 5`,
        title: 'Nova avaliação',
        paragraphs: [
          `<strong>${esc(item.title)}</strong> · ${rating} de 5 estrelas.`,
          text ? `“${esc(text)}”` : '',
          'Você pode responder publicamente pelo painel da loja.',
        ].filter(Boolean),
        ctaUrl: APP_URL + '/store/painel?aba=avaliacoes', ctaLabel: 'Ver avaliações',
      },
    })
  }
  return res.status(200).json({ review })
}

async function reportAction(req, res, supabase, user, body) {
  if (hitLimit(req, res, 'report', 5, 10 * 60 * 1000)) return
  if (!isUuid(body.product_id)) return err(res, 400, 'Produto inválido.')
  const reason = String(body.reason || '')
  if (!Object.prototype.hasOwnProperty.call(REPORT_REASONS, reason)) return err(res, 400, 'Escolha o motivo da denúncia.')
  const details = cleanText(body.details, 2000)

  const { data: product, error: pErr } = await supabase.from('bc_store_products')
    .select('id, seller_id, slug, title').eq('id', body.product_id.toLowerCase()).maybeSingle()
  if (pErr) throw new Error('produto: ' + pErr.message)
  if (!product) return err(res, 404, 'Produto não encontrado.')

  // Mesma pessoa denunciando o mesmo produto de novo: conta uma vez so
  const { data: dup, error: dErr } = await supabase.from('bc_store_reports').select('id')
    .eq('product_id', product.id).eq('reporter_user_id', user.id).eq('status', 'pending').limit(1)
  if (dErr) throw new Error('denuncias: ' + dErr.message)
  if (dup && dup.length) return res.status(200).json({ ok: true })

  const { error } = await supabase.from('bc_store_reports').insert({
    product_id: product.id, seller_id: product.seller_id, reporter_user_id: user.id,
    reporter_email: user.email ? String(user.email).toLowerCase() : null, reason, details,
  })
  if (error) throw new Error('denuncia: ' + error.message)

  await notifyAdmin(`Store: denúncia de anúncio (${REPORT_REASONS[reason]})`, [
    `Produto: <strong>${esc(product.title)}</strong> · <a href="${esc(APP_URL + '/store/p/' + encodeURIComponent(product.slug))}">abrir anúncio</a>`,
    details ? esc(details) : 'Sem detalhes.',
    `Denunciado por ${esc(user.email || user.id)}.`,
  ])
  return res.status(200).json({ ok: true })
}

// ─────────────────────────────────────────────────────────────────────────────
const GET_ACTIONS = { orders: listOrders, order: orderDetail }
const POST_ACTIONS = {
  cancel: cancelAction,
  confirm: confirmAction,
  dispute: disputeAction,
  escalate: escalateAction,
  'close-dispute': closeDisputeAction,
  message: messageAction,
  review: reviewAction,
  report: reportAction,
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  res.setHeader('Cache-Control', 'private, no-store')
  const action = String((req.query && req.query.action) || '')
  const getFn = GET_ACTIONS[action]
  const postFn = POST_ACTIONS[action]
  if (!getFn && !postFn) return err(res, 400, 'Ação inválida.')
  if (getFn && req.method !== 'GET') return err(res, 405, 'Use GET.')
  if (postFn && req.method !== 'POST') return err(res, 405, 'Use POST.')

  try {
    const supabase = getSupabase()
    const auth = await requireUser(req, supabase)
    if (!auth.ok) return err(res, auth.status, auth.error)
    if (getFn) return await getFn(req, res, supabase, auth.user)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    return await postFn(req, res, supabase, auth.user, body)
  } catch (e) {
    console.error('[store/buyer]', action, e.message)
    if (res.headersSent) return
    return err(res, 500, 'Algo deu errado. Tente de novo em instantes.')
  }
}
