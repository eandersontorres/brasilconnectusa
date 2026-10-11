/**
 * BrasilConnect Store — painel do vendedor (cadastro, catalogo, entregas,
 * pedidos, etiquetas, recebimentos e avaliacoes).
 *
 *   GET  /api/store/seller?action=me | slug-check | connect-status | products | product
 *                                | orders | order | payouts | reviews
 *   POST /api/store/seller?action=apply | update-shop | connect | stripe-login
 *                                | save-zone | delete-zone | save-product | product-status
 *                                | label-rates | label-buy | label-void | ship-manual | mark-delivered
 *                                | schedule-handoff | cancel | refund | message | reply-review
 *
 * Contrato: docs/store/ARQUITETURA.md (secao 6.5). Tudo exige JWT do Supabase.
 * Preco, frete, comissao, estoque e custo de etiqueta sao sempre conferidos aqui.
 * Nunca devolve buyer_email/buyer_user_id, agent_*, admin_notes, shippo_*, stripe_account_id.
 */
import crypto from 'node:crypto'
import {
  APP_URL, getSupabase, getStripe, getConfig, err, isUuid, normState, normZip, normalizeSearch,
  slugify, cleanText, RESERVED_SLUGS, hasContactInfo, isSafeImageUrl, cleanImages, computePayout,
  sellerFeeBps, requireUser, clientIp, logEvent, logModeration, notify, notifyAdmin, esc, fmtUSD,
  ORDER_STATUS_PT, CONDITION_PT, ORIGIN_PT, addDays, nyCivil, nyEndOfBusinessDay, autoCancelAt, orderAutoCancelAt,
  orderDeadline,
} from '../_lib/store.js'
import {
  ACTIVE_DISPUTES, loadOrder, cancelOrder, refundOrder, releaseDueAt, isNewSeller, markShipped,
  markDelivered, buyerOrderUrl, notifyOrderParties,
} from '../_lib/storeOrders.js'
import {
  shippoEnabled, shippoTestMode, validateAddress, ensureSellerAccount, toShippoAddress, getRates,
  getRate, buyLabel, refundLabel, registerTrack, normalizeCarrier, trackingUrlFor, getTrack,
} from '../_lib/shippo.js'
import { rateLimit } from '../_lib/rateLimit.js'

// ─────────────────────────────────────────────────────────────────────────────
// Erros de validacao: lancados e convertidos em { error } no handler
// ─────────────────────────────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
function bad(message, status = 400) {
  throw new HttpError(status, message)
}
function dbFail(where, error) {
  if (error) throw new Error(`${where}: ${error.message}`)
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('tempo esgotado')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const PRODUCT_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'paused', 'suspended', 'archived']
const ZONE_METHODS = ['ship', 'local_delivery', 'pickup']
const MAX_ZONES = 20
const MANUAL_CARRIERS = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL', outro: 'Outro' }
const HIDDEN_ORDER_STATUSES = '(pending_payment,expired)'
const OPEN_FILTER = 'status.in.(shipped,delivered),dispute_status.in.(' + ACTIVE_DISPUTES.join(',') + ')'
// Loja aprovada: nome/logo/capa novos esperam o admin (pending_changes); frase e texto vao direto, com revisao da IA
const HELD_SHOP_FIELDS = ['name', 'logo_url', 'banner_url']
const DIRECT_SHOP_FIELDS = ['tagline', 'bio']
// Etiqueta "livre": pode comprar outra ou informar envio proprio
const LABEL_OPEN = ['none', 'failed', 'refund_requested', 'refunded']
// Rastreio que ainda nao foi escaneado pela transportadora (etiqueta pode ser cancelada)
const VOIDABLE_TRACKING = ['', 'PRE_TRANSIT', 'UNKNOWN']
// Eventos internos que a loja nao ve
const HIDDEN_EVENT_KINDS = '(payout_failed,auto_cancel_failed,note,admin_note)'
const HANDOFF_MAX_DAYS = 14 // data combinada de retirada/entrega: ate 14 dias depois do pagamento
const MSG_CLOSED_DAYS = 30 // conversa fecha 30 dias depois de cancelado/reembolsado/concluido
const MSG_MAX_PER_DAY = 30 // mensagens da loja por pedido em 24 h
const MSG_QUIET_MS = 30 * 60000 // dentro de 30 min da ultima mensagem, grava sem avisar de novo
const LIVE_TRACK_TIMEOUT_MS = 8000 // consulta ao vivo do rastreio antes de cancelar etiqueta

// Limite por acao (janela em ms, maximo). Escritas e chamadas que custam (Stripe/Shippo).
const LIMITS = {
  apply: [10 * 60000, 10], // corrigir erro e reenviar algumas vezes e normal
  'update-shop': [60000, 20],
  connect: [60000, 10],
  'connect-status': [60000, 20],
  'stripe-login': [60000, 10],
  'save-zone': [60000, 30],
  'delete-zone': [60000, 30],
  'save-product': [60000, 30],
  'product-status': [60000, 30],
  'label-rates': [60000, 15],
  'label-buy': [60000, 6],
  'label-void': [60000, 6],
  'ship-manual': [60000, 10],
  'mark-delivered': [60000, 10],
  'schedule-handoff': [60000, 10],
  cancel: [60000, 10],
  refund: [60000, 10],
  message: [60000, 15],
  'reply-review': [60000, 15],
  'slug-check': [60000, 60],
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de validacao
// ─────────────────────────────────────────────────────────────────────────────
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1'

/** Texto opcional/obrigatorio com limite. Recusa texto acima do limite (nao corta calado). */
function textField(v, max, label, { min = 0, required = false } = {}) {
  const s = cleanText(v, max + 1)
  if (!s) {
    if (required) bad(`Preencha ${label}.`)
    return null
  }
  if (s.length > max) bad(`${cap(label)} pode ter no máximo ${max} caracteres.`)
  if (s.length < min) bad(`${cap(label)} precisa ter pelo menos ${min} caracteres.`)
  return s
}

function intIn(v, min, max) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

/** Numero opcional > 0 (peso, medidas). null se vazio. */
function optPositive(v, label, max) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) bad(`${cap(label)} precisa ser maior que zero.`)
  if (n > max) bad(`${cap(label)} está grande demais (máximo ${max}).`)
  return Math.round(n * 100) / 100
}

function noContact(value, label) {
  if (!value) return
  const hit = hasContactInfo(value)
  if (hit) bad(`Tire o ${hit} de ${label}: a venda e a conversa acontecem pela Store.`)
}

/** Telefone dos EUA: 10 digitos (aceita +1). Guarda como +1XXXXXXXXXX. */
function normPhone(v, label = 'o telefone') {
  let d = String(v || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length !== 10) bad(`Informe ${label} com DDD (10 dígitos, número dos EUA).`)
  return '+1' + d
}

/** Endereco {name, street1, street2, city, state, zip, phone}. kind: 'de postagem' | 'de devolução'. */
function cleanAddress(a, kind) {
  if (!a || typeof a !== 'object') bad(`Preencha o endereço ${kind}.`)
  const state = normState(a.state)
  if (!state) bad(`Escolha o estado (UF) do endereço ${kind}.`)
  const zip = normZip(a.zip)
  if (!zip) bad(`O ZIP code do endereço ${kind} precisa ter 5 dígitos.`)
  return {
    name: textField(a.name, 60, 'o nome de quem envia', { min: 2, required: true }),
    street1: textField(a.street1, 100, 'a rua e o número', { min: 3, required: true }),
    street2: textField(a.street2, 100, 'o complemento'),
    city: textField(a.city, 60, 'a cidade do endereço', { min: 2, required: true }),
    state,
    zip,
    phone: a.phone ? normPhone(a.phone, 'o telefone do endereço') : null,
  }
}

const sameAddress = (a, b) => !!a && !!b && ['name', 'street1', 'street2', 'city', 'state', 'zip', 'phone']
  .every(k => (a[k] || null) === (b[k] || null))

async function checkAddressWithShippo(addr, label) {
  if (!shippoEnabled()) return
  const v = await validateAddress(addr)
  if (v && v.result === 'invalid') {
    const why = (v.reasons || []).slice(0, 2).join(' · ')
    bad(`Não encontramos ${label} nos Correios dos EUA${why ? ' (' + why + ')' : ''}. Confira rua, cidade e ZIP code.`)
  }
}

function cleanTags(list) {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : []
  const out = []
  for (const t of arr) {
    const s = String(t ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/^#+/, '')
      .replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30).trim()
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= 10) break
  }
  return out
}

function randomSuffix(n = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(n)
  let s = ''
  for (let i = 0; i < n; i++) s += chars[bytes[i] % chars.length]
  return s
}

/** "Ana Souza" -> "Ana S." */
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Comprador'
  if (parts.length === 1) return parts[0].slice(0, 30)
  return parts[0].slice(0, 30) + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.'
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializacao privada (dono da loja)
// ─────────────────────────────────────────────────────────────────────────────
const SELLER_HIDDEN = new Set(['admin_notes', 'fee_bps_override', 'stripe_account_id'])
function privateSeller(s) {
  if (!s) return null
  const out = {}
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('agent_') || k.startsWith('shippo_') || SELLER_HIDDEN.has(k)) continue
    out[k] = v
  }
  return out
}

function privateProduct(p) {
  if (!p) return null
  const out = {}
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('agent_') || k === 'search_text') continue
    out[k] = v
  }
  return out
}

// hold_reason e interno (motivo da retencao pode revelar a checagem antifraude)
const ORDER_HIDDEN = new Set(['buyer_email', 'buyer_user_id', 'checkout_id', 'items', 'hold_reason'])

/**
 * Endereco do comprador que a loja ve: so o necessario e so enquanto precisa.
 * Retirada: nome, telefone, cidade/UF. Cancelado/reembolsado, ou concluido ha mais
 * que o prazo de devolucao + 30 dias: nome e cidade/UF.
 */
function shipToForSeller(o, seller) {
  const t = o.ship_to && typeof o.ship_to === 'object' ? o.ship_to : null
  if (!t) return o.ship_to ?? null
  const pick = (keys) => {
    const out = {}
    for (const k of keys) if (t[k] != null && t[k] !== '') out[k] = t[k]
    return out
  }
  const minimal = ['name', 'city', 'state']
  if (['canceled', 'refunded'].includes(o.status)) return pick(minimal)
  if (o.status === 'completed' && o.completed_at) {
    const keepDays = Math.max(0, Number(seller?.return_window_days) || 0) + 30
    if (Date.now() - new Date(o.completed_at).getTime() > keepDays * 86400000) return pick(minimal)
  }
  if (o.fulfillment === 'pickup') return pick(['name', 'phone', 'city', 'state'])
  return t
}

function privateOrder(o, seller) {
  const out = {}
  for (const [k, v] of Object.entries(o)) {
    if (ORDER_HIDDEN.has(k) || k.startsWith('stripe_') || k.startsWith('shippo_')) continue
    out[k] = v
  }
  out.ship_to = shipToForSeller(o, seller)
  out.status_label = ORDER_STATUS_PT[o.status] || o.status
  return out
}

/** Quando o pedido saiu do andamento (cancelado/reembolsado/concluido), ou null. */
function closedAt(o, refundedAt = null) {
  if (o.status === 'canceled') return o.canceled_at || o.updated_at || null
  if (o.status === 'completed') return o.completed_at || o.updated_at || null
  if (o.status === 'refunded') return refundedAt || o.completed_at || o.delivered_at || o.shipped_at || o.paid_at || null
  return null
}
/** Conversa encerrada: pedido fechado ha mais de 30 dias e sem problema aberto. */
function conversationClosed(o, refundedAt = null) {
  if (ACTIVE_DISPUTES.includes(o.dispute_status)) return false
  const at = closedAt(o, refundedAt)
  return !!at && Date.now() - new Date(at).getTime() > MSG_CLOSED_DAYS * 86400000
}

const fmtDayNY = (d, opts) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/New_York', ...(opts || { weekday: 'long', day: '2-digit', month: 'long' }) })

function stripeOf(s) {
  const req = (s && s.stripe_requirements) || {}
  const due = [...new Set([...(req.past_due || []), ...(req.currently_due || [])])]
  return {
    connected: !!s?.stripe_account_id,
    details_submitted: !!s?.stripe_details_submitted,
    payouts_enabled: !!s?.stripe_payouts_enabled,
    transfers_active: !!s?.stripe_transfers_active,
    requirements_due: due,
    disabled_reason: req.disabled_reason || null,
  }
}

function feeOf(seller, cfg) {
  return { fee_bps: sellerFeeBps(seller, cfg), fee_fixed_cents: cfg.fee_fixed_cents, fee_on_shipping: !!cfg.fee_on_shipping }
}

function policyOf(cfg) {
  return {
    release_days_after_delivery: cfg.release_days_after_delivery,
    release_days_new_seller: cfg.release_days_new_seller,
    auto_cancel_grace_days: cfg.auto_cancel_grace_days,
    dispute_window_days: cfg.dispute_window_days,
    agreement_version: cfg.agreement_version,
    // extras para o painel explicar o repasse
    new_seller_orders: cfg.new_seller_orders,
    local_release_days: cfg.local_release_days,
    safety_release_days: cfg.safety_release_days,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga de dados
// ─────────────────────────────────────────────────────────────────────────────
async function loadCategories(supabase) {
  const { data, error } = await supabase.from('bc_store_categories')
    .select('slug, name, description, gated, requirements').eq('active', true).order('sort')
  if (error) {
    console.error('[store/seller] categorias:', error.message)
    return []
  }
  return data || []
}

async function loadZones(supabase, sellerId) {
  const { data, error } = await supabase.from('bc_store_shipping_zones').select('*')
    .eq('seller_id', sellerId).order('created_at')
  dbFail('zones', error)
  return data || []
}

/** Vendedor logado. allowSuspended: loja suspensa ainda ve e atende pedidos ja pagos. */
async function sellerCtx(req, supabase, { allowSuspended = false } = {}) {
  const auth = await requireUser(req, supabase)
  if (!auth.ok) bad(auth.error, auth.status)
  const { data: seller, error } = await supabase.from('bc_store_sellers').select('*').eq('user_id', auth.user.id).maybeSingle()
  dbFail('seller', error)
  if (!seller) bad('Você ainda não tem uma loja na Store.', 404)
  if (seller.status === 'suspended' && !allowSuspended) bad('Sua loja está suspensa. Fale com oi@brasilconnectusa.com.', 403)
  return { user: auth.user, seller }
}

/** Pedido da propria loja (nunca pending_payment/expired). */
async function ownOrder(supabase, seller, id) {
  if (!isUuid(id)) bad('Pedido inválido.')
  const order = await loadOrder(supabase, id)
  if (!order || order.seller_id !== seller.id || ['pending_payment', 'expired'].includes(order.status)) bad('Pedido não encontrado.', 404)
  return order
}

// label_status, carrier e tracking_status entram em releaseDueAt; paid_at e zone_snapshot em orderDeadline
const PAYOUT_COLS = 'id, order_number, status, fulfillment, items_cents, shipping_cents, refunded_cents, fee_bps, fee_fixed_cents, fee_on_shipping, fee_cents, label_cost_cents, label_status, carrier, tracking_status, payout_status, payout_cents, dispute_status, stripe_transfer_id, buyer_confirmed_at, paid_at, zone_snapshot, shipped_at, delivered_at, completed_at, release_at, ship_by, created_at'
const isPendingPayout = (o) => ['shipped', 'delivered'].includes(o.status) && ['pending', 'blocked', 'held', 'releasing'].includes(o.payout_status)

/**
 * Prazo efetivo (ISO) de um pedido aguardando envio/entrega, ou null. Mesma regra
 * do cron, do aviso de prazo e do cancelamento automatico (orderDeadline): na
 * entrega local vale o maior entre ship_by e pago + prazo maximo da regiao.
 */
function deadlineIso(o) {
  if (!o || o.status !== 'paid') return null
  const d = orderDeadline(o)
  return d ? d.toISOString() : null
}
function isLate(o, now = Date.now()) {
  const d = deadlineIso(o)
  return !!d && new Date(d).getTime() < now
}

async function loadStats(supabase, seller) {
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString()
  const [prods, active, disputes, released] = await Promise.all([
    supabase.from('bc_store_products').select('status').eq('seller_id', seller.id),
    supabase.from('bc_store_orders').select(PAYOUT_COLS).eq('seller_id', seller.id).in('status', ['paid', 'shipped', 'delivered']),
    supabase.from('bc_store_orders').select('id, status').eq('seller_id', seller.id).in('dispute_status', ACTIVE_DISPUTES)
      .not('status', 'in', HIDDEN_ORDER_STATUSES),
    supabase.from('bc_store_orders').select('payout_cents').eq('seller_id', seller.id).eq('payout_status', 'released').gte('completed_at', since30),
  ])
  dbFail('stats products', prods.error)
  dbFail('stats orders', active.error)
  dbFail('stats disputes', disputes.error)
  dbFail('stats released', released.error)

  const products = Object.fromEntries(PRODUCT_STATUSES.map(s => [s, 0]))
  for (const p of prods.data || []) products[p.status] = (products[p.status] || 0) + 1
  const now = Date.now()
  const list = active.data || []
  const openIds = new Set(list.filter(o => ['shipped', 'delivered'].includes(o.status)).map(o => o.id))
  for (const d of disputes.data || []) openIds.add(d.id)
  return {
    products,
    products_total: (prods.data || []).filter(p => p.status !== 'archived').length,
    to_ship: list.filter(o => o.status === 'paid').length,
    late: list.filter(o => isLate(o, now)).length,
    open: openIds.size,
    disputes: (disputes.data || []).length,
    pending_payout_cents: list.filter(isPendingPayout).reduce((s, o) => s + computePayout(o).payout_cents, 0),
    released_cents_30d: (released.data || []).reduce((s, o) => s + (o.payout_cents || 0), 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  res.setHeader('Cache-Control', 'private, no-store')
  const action = String(req.query?.action || '')

  try {
    if (LIMITS[action] && (req.method === 'POST' || action === 'slug-check' || action === 'connect-status')) {
      const [windowMs, max] = LIMITS[action]
      // Um balde por acao (o rateLimit agrupa por IP + caminho)
      const limited = rateLimit({ headers: req.headers || {}, url: '/api/store/seller/' + action }, { windowMs, max })
      if (limited) return err(res, 429, `Muitas tentativas seguidas. Tente de novo em ${limited.retryAfter}s.`)
    }
    const supabase = getSupabase()

    if (req.method === 'GET') {
      const q = req.query || {}
      switch (action) {
        case 'me': return await actMe(req, res, supabase)
        case 'slug-check': return await actSlugCheck(req, res, supabase, q)
        case 'connect-status': return await actConnectStatus(req, res, supabase)
        case 'products': return await actProducts(req, res, supabase, q)
        case 'product': return await actProduct(req, res, supabase, q)
        case 'orders': return await actOrders(req, res, supabase, q)
        case 'order': return await actOrder(req, res, supabase, q)
        case 'payouts': return await actPayouts(req, res, supabase)
        case 'reviews': return await actReviews(req, res, supabase)
        default: return err(res, 400, 'Ação inválida.')
      }
    }

    if (req.method === 'POST') {
      let body = req.body
      if (typeof body === 'string') { try { body = JSON.parse(body) } catch (_) { body = {} } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {}
      switch (action) {
        case 'apply': return await actApply(req, res, supabase, body)
        case 'update-shop': return await actUpdateShop(req, res, supabase, body)
        case 'connect': return await actConnect(req, res, supabase)
        case 'stripe-login': return await actStripeLogin(req, res, supabase)
        case 'save-zone': return await actSaveZone(req, res, supabase, body)
        case 'delete-zone': return await actDeleteZone(req, res, supabase, body)
        case 'save-product': return await actSaveProduct(req, res, supabase, body)
        case 'product-status': return await actProductStatus(req, res, supabase, body)
        case 'label-rates': return await actLabelRates(req, res, supabase, body)
        case 'label-buy': return await actLabelBuy(req, res, supabase, body)
        case 'label-void': return await actLabelVoid(req, res, supabase, body)
        case 'ship-manual': return await actShipManual(req, res, supabase, body)
        case 'mark-delivered': return await actMarkDelivered(req, res, supabase, body)
        case 'schedule-handoff': return await actScheduleHandoff(req, res, supabase, body)
        case 'cancel': return await actCancel(req, res, supabase, body)
        case 'refund': return await actRefund(req, res, supabase, body)
        case 'message': return await actMessage(req, res, supabase, body)
        case 'reply-review': return await actReplyReview(req, res, supabase, body)
        default: return err(res, 400, 'Ação inválida.')
      }
    }

    return err(res, 405, 'Método não permitido.')
  } catch (e) {
    if (e instanceof HttpError) return err(res, e.status, e.message)
    if (e && typeof e.type === 'string' && e.type.startsWith('Stripe')) {
      console.error('[store/seller] stripe', action, e.message)
      return err(res, 502, 'O Stripe recusou a operação: ' + e.message)
    }
    console.error('[store/seller]', action, e?.message)
    return err(res, 500, 'Não deu certo agora. Tente de novo em instantes.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// me
// ─────────────────────────────────────────────────────────────────────────────
async function actMe(req, res, supabase) {
  const auth = await requireUser(req, supabase)
  if (!auth.ok) bad(auth.error, auth.status)
  const [cfg, categories, sel] = await Promise.all([
    getConfig(supabase),
    loadCategories(supabase),
    supabase.from('bc_store_sellers').select('*').eq('user_id', auth.user.id).maybeSingle(),
  ])
  dbFail('me seller', sel.error)
  const seller = sel.data
  const base = {
    fee: feeOf(seller, cfg),
    policy: policyOf(cfg),
    categories,
    shippo: { enabled: shippoEnabled(), test_mode: shippoTestMode() },
    // Pre-lancamento: o painel avisa que a vitrine/compras ainda nao abriram
    store: { public_enabled: !!cfg.public_enabled, checkout_enabled: !!cfg.checkout_enabled },
  }
  if (!seller) return res.status(200).json({ seller: null, zones: [], stats: null, stripe: stripeOf(null), ...base })
  const [zones, stats] = await Promise.all([loadZones(supabase, seller.id), loadStats(supabase, seller)])
  return res.status(200).json({ seller: privateSeller(seller), zones, stats, stripe: stripeOf(seller), ...base })
}

// ─────────────────────────────────────────────────────────────────────────────
// Endereco da loja (slug)
// ─────────────────────────────────────────────────────────────────────────────
async function slugStatus(supabase, raw, userId) {
  const slug = slugify(raw, 40)
  if (!SLUG_RE.test(slug)) return { available: false, slug, reason: 'invalid' }
  if (RESERVED_SLUGS.has(slug)) return { available: false, slug, reason: 'reserved' }
  const { data, error } = await supabase.from('bc_store_sellers').select('id, user_id').eq('slug', slug).maybeSingle()
  dbFail('slug', error)
  if (data && data.user_id !== userId) return { available: false, slug, reason: 'taken' }
  return { available: true, slug, reason: null }
}

async function actSlugCheck(req, res, supabase, q) {
  const auth = await requireUser(req, supabase)
  if (!auth.ok) bad(auth.error, auth.status)
  return res.status(200).json(await slugStatus(supabase, String(q.slug || '').slice(0, 80), auth.user.id))
}

// ─────────────────────────────────────────────────────────────────────────────
// Dados da loja (apply e update-shop usam as mesmas regras)
// ─────────────────────────────────────────────────────────────────────────────
/** Nome que se passa pela equipe da Store (BrasilConnect, oficial, suporte). Sem acento e sem caixa. */
function impersonatingName(name) {
  const n = normalizeSearch(name)
  if (n.replace(/ /g, '').includes('brasilconnect')) return true
  return /(^| )(oficial|oficiais|suporte|support)( |$)/.test(n)
}

async function validateShop(supabase, body, { existing, full, userId }) {
  const has = (k) => full || body[k] !== undefined
  const patch = {}

  if (has('name')) {
    patch.name = textField(body.name, 60, 'o nome da loja', { min: 2, required: true })
    // So confere nome novo (loja antiga com nome ja aprovado continua salvando o resto)
    if (patch.name !== (existing?.name || null) && impersonatingName(patch.name)) {
      bad('O nome da loja não pode usar "BrasilConnect", "oficial" ou "suporte": isso confunde o comprador com a equipe da Store.')
    }
  }

  if (full || (body.slug !== undefined && String(body.slug) !== existing?.slug)) {
    if (existing && !['pending', 'rejected'].includes(existing.status)) {
      bad('O endereço da loja não muda depois da aprovação.')
    }
    const st = await slugStatus(supabase, body.slug || body.name || '', userId)
    if (!st.available) {
      if (st.reason === 'taken') bad('Esse endereço de loja já está em uso. Escolha outro.', 409)
      if (st.reason === 'reserved') bad('Esse endereço é reservado pela Store. Escolha outro.')
      bad('O endereço da loja precisa ter de 3 a 40 letras, números ou hífens.')
    }
    patch.slug = st.slug
  }

  if (has('tagline')) patch.tagline = textField(body.tagline, 120, 'a frase curta')
  if (has('bio')) patch.bio = textField(body.bio, 2000, 'o texto sobre a loja')

  for (const [k, label] of [['logo_url', 'o logo'], ['banner_url', 'a capa']]) {
    if (!has(k)) continue
    const v = body[k]
    if (v === null || v === undefined || v === '') patch[k] = null
    else if (isSafeImageUrl(v)) patch[k] = String(v)
    else bad(`Envie ${label} pelo botão de foto do formulário.`)
  }

  if (has('city')) patch.city = textField(body.city, 60, 'a cidade da loja', { min: 2, required: true })
  if (has('state')) {
    const st = normState(body.state)
    if (!st) bad('Escolha o estado (UF) da loja.')
    patch.state = st
  }
  if (has('phone')) patch.phone = normPhone(body.phone)

  if (has('ship_from')) {
    const addr = cleanAddress(body.ship_from, 'de postagem')
    if (!sameAddress(addr, existing?.ship_from)) await checkAddressWithShippo(addr, 'o endereço de postagem')
    patch.ship_from = addr
  }
  if (body.return_address !== undefined) {
    const r = body.return_address
    if (!r || (typeof r === 'object' && !r.street1 && !r.zip)) patch.return_address = null
    else {
      const addr = cleanAddress(r, 'de devolução')
      if (!sameAddress(addr, existing?.return_address)) await checkAddressWithShippo(addr, 'o endereço de devolução')
      patch.return_address = addr
    }
  }

  if (has('handling_days')) {
    const n = intIn(body.handling_days ?? 2, 1, 30)
    if (n == null) bad('O prazo de postagem precisa ser de 1 a 30 dias úteis.')
    patch.handling_days = n
  }
  if (has('accepts_returns')) patch.accepts_returns = body.accepts_returns === undefined ? true : bool(body.accepts_returns)
  if (has('return_window_days')) {
    const n = intIn(body.return_window_days ?? 7, 0, 90)
    if (n == null) bad('O prazo de devolução precisa ser de 0 a 90 dias.')
    patch.return_window_days = n
  }
  if (has('return_policy')) patch.return_policy = textField(body.return_policy, 3000, 'a política de devolução')
  if (has('warranty_policy')) patch.warranty_policy = textField(body.warranty_policy, 3000, 'a garantia')

  // Contato direto fora da plataforma: so nos textos publicos
  noContact(patch.name, 'o nome da loja')
  noContact(patch.tagline, 'a frase curta')
  noContact(patch.bio, 'o texto sobre a loja')
  noContact(patch.return_policy, 'a política de devolução')
  noContact(patch.warranty_policy, 'a garantia')

  return patch
}

async function actApply(req, res, supabase, body) {
  const auth = await requireUser(req, supabase)
  if (!auth.ok) bad(auth.error, auth.status)
  const user = auth.user
  if (!user.email) bad('Sua conta não tem e-mail. Entre com um e-mail para abrir a loja.')
  if (body.agree !== true) bad('Para abrir a loja, aceite o Contrato do Vendedor.')

  const { data: existing, error: exErr } = await supabase.from('bc_store_sellers').select('*').eq('user_id', user.id).maybeSingle()
  dbFail('apply existing', exErr)
  if (existing && existing.status !== 'rejected') bad('Você já tem uma loja na Store. Abra o painel da loja.', 409)

  const cfg = await getConfig(supabase)
  const patch = await validateShop(supabase, body, { existing, full: true, userId: user.id })
  const now = new Date().toISOString()
  Object.assign(patch, {
    email: String(user.email).toLowerCase(),
    agreement_version: cfg.agreement_version,
    agreement_accepted_at: now,
    agreement_ip: clientIp(req),
    status: 'pending',
    submitted_at: now,
    rejection_reason: null,
    agent_status: 'pending',
  })

  let row
  if (existing) {
    const { data, error } = await supabase.from('bc_store_sellers').update(patch)
      .eq('id', existing.id).eq('status', 'rejected').select('*')
    if (error && error.code === '23505') bad('Esse endereço de loja já está em uso. Escolha outro.', 409)
    dbFail('apply update', error)
    if (!data || !data.length) bad('Sua loja mudou de situação. Atualize a página.', 409)
    row = data[0]
  } else {
    const { data, error } = await supabase.from('bc_store_sellers').insert({ user_id: user.id, ...patch }).select('*').single()
    if (error && error.code === '23505') {
      if (/slug/i.test(error.message || '')) bad('Esse endereço de loja já está em uso. Escolha outro.', 409)
      bad('Você já tem uma loja na Store. Abra o painel da loja.', 409)
    }
    dbFail('apply insert', error)
    row = data
  }

  await logModeration(supabase, {
    target_type: 'seller', target_id: row.id, action: existing ? 'resubmit' : 'apply',
    from_status: existing ? existing.status : null, to_status: 'pending', actor: 'seller:' + user.id,
  })
  await notifyAdmin(existing ? 'Store: loja reenviada para análise' : 'Store: nova loja para aprovar', [
    `<strong>${esc(row.name)}</strong> (${esc(row.city || '')}/${esc(row.state || '')}) ${existing ? 'corrigiu o cadastro e reenviou' : 'quer vender na Store'}.`,
    `Endereço: /store/loja/${esc(row.slug)} · ${esc(row.email)}`,
  ], APP_URL + '/admin/manage')

  return res.status(200).json({ seller: privateSeller(row) })
}

async function actUpdateShop(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase)
  const patch = await validateShop(supabase, body, { existing: seller, full: false, userId: user.id })
  if (body.vacation_mode !== undefined) patch.vacation_mode = bool(body.vacation_mode)
  if (!Object.keys(patch).length) return res.status(200).json({ seller: privateSeller(seller) })

  // Loja aprovada continua aprovada. Nome, logo e capa novos so vao ao ar depois
  // que o admin aprovar (pending_changes). Tirar logo/capa vale na hora.
  // Frase curta e texto vao direto, com revisao da IA (agent_status).
  let queued = null
  if (seller.status === 'approved') {
    const prevPending = seller.pending_changes && typeof seller.pending_changes === 'object' ? seller.pending_changes : {}
    const pending = { ...prevPending }
    for (const k of HELD_SHOP_FIELDS) {
      if (!(k in patch)) continue
      const v = patch[k] || null
      delete patch[k]
      if (v === (seller[k] || null)) { delete pending[k]; continue } // voltou ao que esta no ar: desiste da mudanca
      if (v === null && k !== 'name') { patch[k] = null; delete pending[k]; continue } // remover imagem nao precisa de aprovacao
      pending[k] = v
    }
    const changed = JSON.stringify(pending) !== JSON.stringify(prevPending)
    if (changed) {
      const any = Object.keys(pending).length > 0
      patch.pending_changes = any ? pending : null
      patch.pending_changes_at = any ? new Date().toISOString() : null
      if (any) queued = pending
    }
    if (DIRECT_SHOP_FIELDS.some(k => k in patch && (patch[k] || null) !== (seller[k] || null))) {
      patch.agent_status = 'pending'
    }
  }
  if (!Object.keys(patch).length) return res.status(200).json({ seller: privateSeller(seller) })

  const { data, error } = await supabase.from('bc_store_sellers').update(patch)
    .eq('id', seller.id).eq('status', seller.status).select('*')
  if (error && error.code === '23505') bad('Esse endereço de loja já está em uso. Escolha outro.', 409)
  dbFail('update-shop', error)
  if (!data || !data.length) bad('Sua loja mudou de situação. Atualize a página.', 409)

  if (queued) {
    const what = []
    if ('name' in queued) what.push(`nome: <strong>${esc(queued.name)}</strong> (hoje: ${esc(seller.name)})`)
    if ('logo_url' in queued) what.push('logo novo')
    if ('banner_url' in queued) what.push('capa nova')
    await notifyAdmin('Store: loja aprovada pediu mudança de nome/imagem', [
      `A loja <strong>${esc(seller.name)}</strong> (/store/loja/${esc(seller.slug)}) quer mudar: ${what.join(' · ')}.`,
      'A mudança só vai ao ar depois da sua aprovação na aba Store do admin.',
    ], APP_URL + '/admin/manage')
  }
  return res.status(200).json({ seller: privateSeller(data[0]), pending_changes: data[0].pending_changes || null })
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Connect (Express) para receber os repasses
// ─────────────────────────────────────────────────────────────────────────────
async function actConnect(req, res, supabase) {
  const { user, seller } = await sellerCtx(req, supabase)
  const stripe = await getStripe()
  if (!stripe) bad('Os recebimentos ainda não estão configurados na Store. Tente mais tarde.', 503)

  let accountId = seller.stripe_account_id
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: String(seller.email || user.email || '').toLowerCase() || undefined,
      capabilities: { transfers: { requested: true } },
      business_profile: {
        name: seller.name,
        product_description: 'Produtos vendidos na BrasilConnect Store',
        mcc: '5999',
        url: APP_URL + '/store/loja/' + seller.slug,
      },
      settings: {
        payouts: { schedule: { interval: 'weekly', weekly_anchor: 'friday' }, debit_negative_balances: true },
      },
      metadata: { seller_id: seller.id, source: 'brasilconnect_store' },
    }, { idempotencyKey: 'store_acct_' + seller.id })
    accountId = account.id
    const { data: saved, error } = await supabase.from('bc_store_sellers').update({ stripe_account_id: accountId })
      .eq('id', seller.id).is('stripe_account_id', null).select('stripe_account_id')
    dbFail('connect save', error)
    if (!saved || !saved.length) {
      // Outra aba salvou primeiro: usa a conta que ficou gravada
      const { data: fresh, error: fErr } = await supabase.from('bc_store_sellers').select('stripe_account_id').eq('id', seller.id).maybeSingle()
      dbFail('connect reload', fErr)
      accountId = fresh?.stripe_account_id || accountId
    }
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: APP_URL + '/store/painel?aba=recebimentos&store_stripe=done',
    refresh_url: APP_URL + '/store/painel?aba=recebimentos&store_stripe=refresh',
  })
  return res.status(200).json({ url: link.url })
}

async function actConnectStatus(req, res, supabase) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  if (!seller.stripe_account_id) return res.status(200).json({ stripe: stripeOf(seller) })
  const stripe = await getStripe()
  if (!stripe) return res.status(200).json({ stripe: stripeOf(seller) })

  const acc = await stripe.accounts.retrieve(seller.stripe_account_id)
  const patch = {
    stripe_details_submitted: !!acc.details_submitted,
    stripe_payouts_enabled: !!acc.payouts_enabled,
    stripe_transfers_active: acc.capabilities?.transfers === 'active',
    stripe_requirements: {
      currently_due: acc.requirements?.currently_due || [],
      past_due: acc.requirements?.past_due || [],
      disabled_reason: acc.requirements?.disabled_reason || null,
    },
  }
  const { error } = await supabase.from('bc_store_sellers').update(patch).eq('id', seller.id)
  dbFail('connect-status', error)
  return res.status(200).json({ stripe: stripeOf({ ...seller, ...patch }) })
}

async function actStripeLogin(req, res, supabase) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  if (!seller.stripe_account_id) bad('Ative os recebimentos primeiro.')
  const stripe = await getStripe()
  if (!stripe) bad('Os recebimentos ainda não estão configurados na Store.', 503)
  let link
  try {
    link = await stripe.accounts.createLoginLink(seller.stripe_account_id)
  } catch (e) {
    console.error('[store/seller] login link:', e.message)
    bad('Não deu para abrir o painel do Stripe. Termine o cadastro em "Ativar recebimentos" e tente de novo.', 409)
  }
  return res.status(200).json({ url: link.url })
}

// ─────────────────────────────────────────────────────────────────────────────
// Regioes de entrega
// ─────────────────────────────────────────────────────────────────────────────
function centsField(v, label, { required = true } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (required) return 0
    return null
  }
  const n = intIn(v, 0, 100000)
  if (n == null) bad(`${cap(label)}: use um valor de $0 a $1,000.`)
  return n
}

async function actSaveZone(req, res, supabase, body) {
  const { seller } = await sellerCtx(req, supabase)
  const id = body.id || null
  if (id && !isUuid(id)) bad('Região inválida.')

  const method = String(body.method || '')
  if (!ZONE_METHODS.includes(method)) bad('Escolha como você entrega: envio, entrega local ou retirada.')
  const name = textField(body.name, 60, 'o nome da região', { min: 1, required: true })
  noContact(name, 'o nome da região') // o nome aparece na pagina do produto

  const states = []
  for (const s of Array.isArray(body.states) ? body.states : []) {
    const st = normState(s)
    if (!st) bad('Tem um estado inválido na lista.')
    if (!states.includes(st)) states.push(st)
  }
  const rawZips = Array.isArray(body.zip_prefixes) ? body.zip_prefixes
    : typeof body.zip_prefixes === 'string' ? body.zip_prefixes.split(/[\s,;]+/) : []
  const zip_prefixes = []
  for (const z of rawZips) {
    const s = String(z ?? '').trim()
    if (!s) continue
    if (!/^\d{3,5}$/.test(s)) bad(`"${s.slice(0, 12)}" não é um começo de ZIP code válido (use de 3 a 5 números).`)
    if (!zip_prefixes.includes(s)) zip_prefixes.push(s)
  }
  if (zip_prefixes.length > 300) bad('Use no máximo 300 ZIP codes por região.')
  if ((method === 'ship' || method === 'pickup') && !states.length) bad('Marque pelo menos um estado.')
  if (method === 'local_delivery' && !zip_prefixes.length) bad('Informe os ZIP codes (ou o começo deles) onde você entrega.')

  let rate_first_cents = centsField(body.rate_first_cents, 'o frete do primeiro item')
  let rate_additional_cents = centsField(body.rate_additional_cents, 'o frete por item adicional')
  let free_over_cents = null
  if (body.free_over_cents !== '' && body.free_over_cents !== null && body.free_over_cents !== undefined && Number(body.free_over_cents) !== 0) {
    free_over_cents = intIn(body.free_over_cents, 1, 10000000)
    if (free_over_cents == null) bad('Frete grátis acima de: use um valor maior que zero.')
  }
  if (method === 'pickup') { rate_first_cents = 0; rate_additional_cents = 0; free_over_cents = null }

  const est_days_min = intIn(body.est_days_min, 0, 60)
  const est_days_max = intIn(body.est_days_max, 0, 90)
  if (body.est_days_min !== undefined && body.est_days_min !== '' && body.est_days_min !== null && est_days_min == null) bad('Prazo mínimo: use de 0 a 60 dias.')
  if (body.est_days_max !== undefined && body.est_days_max !== '' && body.est_days_max !== null && est_days_max == null) bad('Prazo máximo: use de 0 a 90 dias.')
  if (est_days_min != null && est_days_max != null && est_days_max < est_days_min) bad('O prazo máximo precisa ser maior ou igual ao mínimo.')

  // Retirada/entrega local precisam de endereco e horario: aqui contato e permitido
  const pickup_note = method === 'ship' ? null : textField(body.pickup_note, 500, 'as instruções de retirada')
  const active = body.active === undefined ? true : bool(body.active)

  const row = { name, method, states, zip_prefixes, rate_first_cents, rate_additional_cents, free_over_cents, est_days_min, est_days_max, pickup_note, active }
  let zone
  if (id) {
    const { data, error } = await supabase.from('bc_store_shipping_zones').update(row)
      .eq('id', id).eq('seller_id', seller.id).select('*')
    dbFail('save-zone update', error)
    if (!data || !data.length) bad('Região não encontrada.', 404)
    zone = data[0]
  } else {
    const { count, error: cErr } = await supabase.from('bc_store_shipping_zones').select('id', { count: 'exact', head: true }).eq('seller_id', seller.id)
    dbFail('save-zone count', cErr)
    if ((count || 0) >= MAX_ZONES) bad(`Cada loja pode ter até ${MAX_ZONES} regiões. Edite ou apague uma das que já existem.`)
    const { data, error } = await supabase.from('bc_store_shipping_zones').insert({ seller_id: seller.id, ...row }).select('*').single()
    dbFail('save-zone insert', error)
    zone = data
  }
  return res.status(200).json({ zone })
}

async function actDeleteZone(req, res, supabase, body) {
  const { seller } = await sellerCtx(req, supabase)
  if (!isUuid(body.id)) bad('Região inválida.')
  const { data, error } = await supabase.from('bc_store_shipping_zones').delete()
    .eq('id', body.id).eq('seller_id', seller.id).select('id')
  dbFail('delete-zone', error)
  if (!data || !data.length) bad('Região não encontrada.', 404)
  return res.status(200).json({ ok: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// Produtos
// ─────────────────────────────────────────────────────────────────────────────
async function actProducts(req, res, supabase, q) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  let query = supabase.from('bc_store_products').select('*').eq('seller_id', seller.id)
  if (q.status) {
    if (!PRODUCT_STATUSES.includes(String(q.status))) bad('Filtro inválido.')
    query = query.eq('status', String(q.status))
  }
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(500)
  dbFail('products', error)
  return res.status(200).json({ products: (data || []).map(privateProduct) })
}

async function actProduct(req, res, supabase, q) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  if (!isUuid(q.id)) bad('Produto inválido.')
  const { data, error } = await supabase.from('bc_store_products').select('*').eq('id', q.id).eq('seller_id', seller.id).maybeSingle()
  dbFail('product', error)
  if (!data) bad('Produto não encontrado.', 404)
  return res.status(200).json({ product: privateProduct(data) })
}

async function sellerShipsByCarrier(supabase, sellerId) {
  const { count, error } = await supabase.from('bc_store_shipping_zones').select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId).eq('method', 'ship').eq('active', true)
  dbFail('zones ship', error)
  return (count || 0) > 0
}

async function actSaveProduct(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase)
  const id = body.id || null
  if (id && !isUuid(id)) bad('Produto inválido.')

  let existing = null
  if (id) {
    const { data, error } = await supabase.from('bc_store_products').select('*').eq('id', id).eq('seller_id', seller.id).maybeSingle()
    dbFail('save-product load', error)
    if (!data) bad('Produto não encontrado.', 404)
    if (data.status === 'suspended') bad('Este produto foi suspenso pela BrasilConnect e não pode ser editado. Fale com oi@brasilconnectusa.com.', 403)
    existing = data
  }
  // Campo ausente no corpo = mantem o valor atual
  const pick = (k) => (body[k] !== undefined ? body[k] : existing ? existing[k] : undefined)

  const title = textField(pick('title'), 120, 'o título', { min: 3, required: true })
  const description = textField(pick('description'), 8000, 'a descrição') || ''

  const categories = await loadCategories(supabase)
  const category_slug = String(pick('category_slug') || '')
  const category = categories.find(c => c.slug === category_slug)
  if (!category) bad('Escolha uma categoria.')

  const condition = String(pick('condition') || 'new')
  if (!Object.prototype.hasOwnProperty.call(CONDITION_PT, condition)) bad('Condição inválida.')
  const origin = String(pick('origin') || 'other')
  if (!Object.prototype.hasOwnProperty.call(ORIGIN_PT, origin)) bad('Origem inválida.')

  const price_cents = intIn(pick('price_cents'), 50, 10000000)
  if (price_cents == null) bad('O preço precisa ficar entre $0.50 e $100,000.')
  let compare_at_cents = pick('compare_at_cents')
  if (compare_at_cents === '' || compare_at_cents === null || compare_at_cents === undefined || Number(compare_at_cents) === 0) {
    compare_at_cents = null
  } else {
    compare_at_cents = intIn(compare_at_cents, 1, 100000000)
    if (compare_at_cents == null || compare_at_cents <= price_cents) bad('O preço "de" precisa ser maior que o preço de venda.')
  }
  const stockRaw = pick('stock')
  const stock = intIn(stockRaw === undefined || stockRaw === null || stockRaw === '' ? 1 : stockRaw, 0, 9999)
  if (stock == null) bad('Estoque: use um número inteiro de 0 a 9999.')
  const sku = textField(pick('sku'), 60, 'o SKU')

  const weight_oz = optPositive(pick('weight_oz'), 'o peso', 2400)
  const length_in = optPositive(pick('length_in'), 'o comprimento', 120)
  const width_in = optPositive(pick('width_in'), 'a largura', 120)
  const height_in = optPositive(pick('height_in'), 'a altura', 120)

  const images = cleanImages(pick('images'), 8)
  const compliance_images = cleanImages(pick('compliance_images'), 8)
  const compliance_notes = textField(pick('compliance_notes'), 2000, 'as informações para a análise')
  const tags = cleanTags(pick('tags'))
  const hazmat = bool(pick('hazmat'))
  const submit = bool(body.submit)

  const cur = existing ? existing.status : null
  // Material perigoso muda o transporte permitido: tambem volta para analise
  const contentChanged = !existing || title !== existing.title || description !== (existing.description || '') ||
    category_slug !== existing.category_slug || JSON.stringify(images) !== JSON.stringify(existing.images || []) ||
    hazmat !== !!existing.hazmat
  const tagsChanged = !existing || JSON.stringify(tags) !== JSON.stringify(existing.tags || [])

  let status
  if (!existing) status = submit ? 'pending_review' : 'draft'
  else if (cur === 'approved' || cur === 'paused') status = contentChanged ? 'pending_review' : cur
  else if (cur === 'pending_review') status = 'pending_review'
  else status = submit ? 'pending_review' : cur // draft, rejected, archived

  // Para ficar visivel (ou ir para analise) o anuncio precisa estar completo
  if (['pending_review', 'approved', 'paused'].includes(status)) {
    if (!images.length) bad('Envie pelo menos 1 foto do produto.')
    if (description.length < 80) bad(`A descrição precisa ter pelo menos 80 caracteres (agora tem ${description.length}).`)
    // Anuncio ja aprovado so e reconferido no que mudou (preco/estoque nao)
    if (status === 'pending_review' || tagsChanged) {
      noContact(title, 'o título')
      noContact(description, 'a descrição')
      noContact(tags.join(' '), 'as palavras-chave')
    }
    const removedWeight = !!existing?.weight_oz && !weight_oz
    if (!weight_oz && (status === 'pending_review' || removedWeight) && await sellerShipsByCarrier(supabase, seller.id)) {
      bad('Informe o peso do produto com embalagem (em oz): sua loja envia por transportadora.')
    }
    if (status === 'pending_review' && category.gated && !compliance_notes && !compliance_images.length) {
      bad(`A categoria "${category.name}" pede informações extras para a análise: preencha o campo de conformidade ou envie foto do rótulo/nota.`)
    }
  }

  const row = {
    title, description, category_slug, condition, origin, price_cents, compare_at_cents, stock, sku,
    weight_oz, length_in, width_in, height_in, images, hazmat, tags, compliance_notes, compliance_images,
    search_text: normalizeSearch([title, tags.join(' '), category.name].join(' ')),
    status,
  }
  const now = new Date().toISOString()
  const enteringReview = status === 'pending_review' && cur !== 'pending_review'
  if (enteringReview) { row.submitted_at = now; row.rejection_reason = null }
  if (contentChanged) row.agent_status = 'pending'

  let product
  if (!existing) {
    for (let attempt = 0; attempt < 4 && !product; attempt++) {
      const slug = (slugify(title, 80) || 'produto') + '-' + randomSuffix(6)
      const { data, error } = await supabase.from('bc_store_products')
        .insert({ seller_id: seller.id, slug, ...row, agent_status: 'pending' }).select('*').single()
      if (error && error.code === '23505' && attempt < 3) continue
      dbFail('save-product insert', error)
      product = data
    }
  } else {
    const { data, error } = await supabase.from('bc_store_products').update(row)
      .eq('id', existing.id).eq('seller_id', seller.id).eq('status', cur).select('*')
    dbFail('save-product update', error)
    if (!data || !data.length) bad('O anúncio mudou de situação (talvez a análise tenha terminado). Atualize a página.', 409)
    product = data[0]
  }

  if (enteringReview) {
    await logModeration(supabase, {
      target_type: 'product', target_id: product.id, action: 'submit',
      from_status: cur, to_status: 'pending_review', actor: 'seller:' + user.id,
    })
    await notifyAdmin('Store: anúncio para aprovar', [
      `<strong>${esc(product.title)}</strong> · ${fmtUSD(product.price_cents)} · loja ${esc(seller.name)}${seller.status !== 'approved' ? ' (loja ainda em análise)' : ''}`,
      cur === 'approved' || cur === 'paused' ? 'Anúncio já aprovado que foi editado (título, descrição, fotos, categoria ou material perigoso).' : 'Anúncio novo enviado para análise.',
    ], APP_URL + '/admin/manage')
  }

  return res.status(200).json({ product: privateProduct(product), needs_review: status === 'pending_review' })
}

async function actProductStatus(req, res, supabase, body) {
  const { seller } = await sellerCtx(req, supabase)
  if (!isUuid(body.id)) bad('Produto inválido.')
  const to = String(body.status || '')
  if (!['paused', 'approved', 'archived'].includes(to)) bad('Situação inválida.')
  const { data: p, error } = await supabase.from('bc_store_products').select('id, status').eq('id', body.id).eq('seller_id', seller.id).maybeSingle()
  dbFail('product-status load', error)
  if (!p) bad('Produto não encontrado.', 404)
  if (to === 'paused' && p.status !== 'approved') bad('Só dá para pausar anúncio aprovado.', 409)
  if (to === 'approved' && p.status !== 'paused') bad('Só dá para reativar anúncio pausado.', 409)
  if (to === 'archived' && ['suspended', 'archived'].includes(p.status)) {
    bad(p.status === 'suspended' ? 'Anúncio suspenso pela BrasilConnect. Fale com oi@brasilconnectusa.com.' : 'O anúncio já está arquivado.', 409)
  }
  const { data, error: upErr } = await supabase.from('bc_store_products').update({ status: to })
    .eq('id', p.id).eq('seller_id', seller.id).eq('status', p.status).select('*')
  dbFail('product-status', upErr)
  if (!data || !data.length) bad('O anúncio mudou de situação. Atualize a página.', 409)
  return res.status(200).json({ product: privateProduct(data[0]) })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pedidos
// ─────────────────────────────────────────────────────────────────────────────
const ORDER_CARD_COLS = 'id, order_number, status, fulfillment, zone_snapshot, created_at, paid_at, ship_by, handoff_scheduled_at, items_cents, shipping_cents, ship_to, tracking_number, tracking_status, carrier, label_status, dispute_status, payout_status'

/** Quando o cron cancela o pedido nao enviado (prazo + carencia em dias uteis), ou null. */
function autoCancelIso(o, cfg) {
  const at = orderAutoCancelAt(o, cfg)
  return at ? at.toISOString() : null
}

async function actOrders(req, res, supabase, q) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const filter = ['to_ship', 'open', 'done', 'all'].includes(q.filter) ? q.filter : 'to_ship'

  let query = supabase.from('bc_store_orders').select(ORDER_CARD_COLS).eq('seller_id', seller.id)
  if (filter === 'to_ship') query = query.eq('status', 'paid').order('ship_by', { ascending: true })
  else if (filter === 'open') query = query.not('status', 'in', HIDDEN_ORDER_STATUSES).or(OPEN_FILTER).order('created_at', { ascending: false })
  else if (filter === 'done') query = query.in('status', ['completed', 'canceled', 'refunded']).order('created_at', { ascending: false })
  else query = query.not('status', 'in', HIDDEN_ORDER_STATUSES).order('created_at', { ascending: false })

  const head = () => supabase.from('bc_store_orders').select('id', { count: 'exact', head: true }).eq('seller_id', seller.id)
  const [list, cShip, cOpen, cDone, cDisp, cfg] = await Promise.all([
    query.limit(200),
    head().eq('status', 'paid'),
    head().not('status', 'in', HIDDEN_ORDER_STATUSES).or(OPEN_FILTER),
    head().in('status', ['completed', 'canceled', 'refunded']),
    head().not('status', 'in', HIDDEN_ORDER_STATUSES).in('dispute_status', ACTIVE_DISPUTES),
    getConfig(supabase),
  ])
  dbFail('orders', list.error)
  dbFail('orders count', cShip.error || cOpen.error || cDone.error || cDisp.error)

  const orders = list.data || []
  let items = []
  if (orders.length) {
    const { data, error } = await supabase.from('bc_store_order_items').select('order_id, title, image_url, quantity')
      .in('order_id', orders.map(o => o.id)).order('created_at')
    dbFail('orders items', error)
    items = data || []
  }
  const now = Date.now()
  return res.status(200).json({
    orders: orders.map(o => ({
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      status_label: ORDER_STATUS_PT[o.status] || o.status,
      fulfillment: o.fulfillment,
      created_at: o.created_at,
      paid_at: o.paid_at,
      ship_by: o.ship_by,
      // Prazo efetivo: e o que vale para "Atrasado" e para os textos de prazo do painel
      deadline_at: deadlineIso(o),
      auto_cancel_at: autoCancelIso(o, cfg),
      late: isLate(o, now),
      items: items.filter(i => i.order_id === o.id).map(i => ({ title: i.title, image_url: i.image_url, quantity: i.quantity })),
      items_cents: o.items_cents,
      shipping_cents: o.shipping_cents,
      buyer_name: o.ship_to?.name || null,
      ship_to_city: o.ship_to?.city || null,
      ship_to_state: o.ship_to?.state || null,
      tracking_number: o.tracking_number,
      carrier: o.carrier,
      handoff_scheduled_at: o.handoff_scheduled_at || null,
      label_status: o.label_status,
      dispute_status: o.dispute_status,
      payout_status: o.payout_status,
    })),
    counts: { to_ship: cShip.count || 0, open: cOpen.count || 0, done: cDone.count || 0, disputes: cDisp.count || 0 },
  })
}

function maxLabelCents(order) {
  // O custo da etiqueta nao pode passar do que a loja recebe (itens + frete - comissao - reembolso)
  return computePayout({ ...order, label_cost_cents: 0 }).payout_cents
}

async function actOrder(req, res, supabase, q) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, q.id)
  const cfg = await getConfig(supabase)

  const productIds = [...new Set(order.items.map(i => i.product_id).filter(Boolean))]
  const [ev, msg, prods, newSeller] = await Promise.all([
    supabase.from('bc_store_order_events').select('kind, actor, message, created_at').eq('order_id', order.id)
      .not('kind', 'in', HIDDEN_EVENT_KINDS).order('created_at'),
    supabase.from('bc_store_messages').select('id, sender_role, body, created_at').eq('order_id', order.id).order('created_at'),
    productIds.length
      ? supabase.from('bc_store_products').select('id, slug, hazmat, weight_oz').in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    isNewSeller(supabase, seller.id, cfg),
  ])
  dbFail('order events', ev.error)
  dbFail('order messages', msg.error)
  dbFail('order products', prods.error)
  const pmap = Object.fromEntries((prods.data || []).map(p => [p.id, p]))

  const calc = computePayout(order)
  const released = order.payout_status === 'released'
  const gross = (order.items_cents || 0) + (order.shipping_cents || 0)
  const due = released ? null : (order.release_at ? new Date(order.release_at) : releaseDueAt(order, cfg, { newSeller }))
  const refundable = Math.max(0, (order.total_cents || 0) - (order.refunded_cents || 0))
  const labelOpen = LABEL_OPEN.includes(order.label_status)
  const local = ['local_delivery', 'pickup'].includes(order.fulfillment)
  const events = (ev.data || []).map(e => (e.kind === 'hold' ? { ...e, actor: 'admin', message: 'Repasse retido pela BrasilConnect' } : e))
  const lastRefund = events.filter(e => e.kind === 'refunded').pop()
  const canSchedule = local && order.status === 'paid' && !order.handoff_scheduled_at

  return res.status(200).json({
    order: {
      ...privateOrder(order, seller), refundable_cents: refundable, max_label_cents: maxLabelCents(order),
      deadline_at: deadlineIso(order),
      late: isLate(order),
      auto_cancel_at: autoCancelIso(order, cfg),
    },
    items: order.items.map(i => ({
      id: i.id, product_id: i.product_id, product_slug: pmap[i.product_id]?.slug || null,
      title: i.title, image_url: i.image_url, unit_price_cents: i.unit_price_cents, quantity: i.quantity,
      subtotal_cents: i.subtotal_cents,
      weight_oz: i.weight_oz != null ? Number(i.weight_oz) : (pmap[i.product_id]?.weight_oz != null ? Number(pmap[i.product_id].weight_oz) : null),
      hazmat: !!pmap[i.product_id]?.hazmat,
    })),
    events,
    messages: (msg.data || []).map(m => ({ ...m, mine: m.sender_role === 'seller' })),
    // Janela da data combinada (retirada/entrega local), em datas de Nova York
    handoff: canSchedule ? { min_date: nyCivil(new Date()), max_date: handoffMaxCivil(order) } : null,
    payout_preview: {
      gross_cents: gross,
      fee_cents: released && order.fee_cents ? order.fee_cents : calc.fee_cents,
      label_cost_cents: order.label_cost_cents || 0,
      refunded_cents: Math.min(gross, order.refunded_cents || 0),
      payout_cents: released && order.payout_cents != null ? order.payout_cents : calc.payout_cents,
      release_at: released ? order.completed_at : (due ? due.toISOString() : null),
      payout_status: order.payout_status,
      new_seller: newSeller,
    },
    can: {
      buy_label: order.status === 'paid' && order.fulfillment === 'ship' && labelOpen && shippoEnabled() && !!seller.ship_from,
      ship_manual: order.status === 'paid' && order.fulfillment === 'ship' && labelOpen,
      void_label: labelVoidable(order),
      mark_delivered: local && ['paid', 'shipped'].includes(order.status),
      schedule_handoff: canSchedule,
      cancel: order.status === 'paid' && order.label_status !== 'purchasing',
      refund: ['paid', 'shipped', 'delivered', 'completed'].includes(order.status) && refundable > 0 &&
        order.dispute_status !== 'chargeback' && order.label_status !== 'purchasing' && order.payout_status !== 'releasing',
      message: !conversationClosed(order, lastRefund?.created_at || null),
    },
  })
}

/** Ultimo dia (Nova York) que a loja pode registrar como data combinada. */
function handoffMaxCivil(order) {
  return nyCivil(addDays(order.paid_at || order.created_at || new Date(), HANDOFF_MAX_DAYS))
}

/** Etiqueta da Store comprada e o pacote ainda nao foi escaneado: da para cancelar. */
function labelVoidable(order) {
  return order.status === 'shipped' && order.fulfillment === 'ship' && order.label_status === 'purchased' &&
    !!order.shippo_transaction_id &&
    VOIDABLE_TRACKING.includes(String(order.tracking_status || '').toUpperCase()) &&
    !ACTIVE_DISPUTES.includes(order.dispute_status) && !order.buyer_confirmed_at &&
    ['pending', 'blocked', 'held'].includes(order.payout_status)
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas (Shippo)
// ─────────────────────────────────────────────────────────────────────────────
function shippoFail(e, what) {
  if (e instanceof HttpError) return e
  if (e?.status === 503) {
    return new HttpError(503, 'A compra de etiqueta pela Store ainda não está disponível. Poste por conta própria e informe o rastreio em "Já enviei".')
  }
  console.error('[store/seller] shippo:', e?.message)
  const detail = String(e?.message || '').replace(/^Shippo \d+:\s*/, '').slice(0, 200)
  return new HttpError(502, `${what}${detail ? ': ' + detail : ''}. Confira o endereço e o pacote e tente de novo.`)
}

function assertLabelable(order) {
  if (order.fulfillment !== 'ship') bad('Este pedido é de entrega local ou retirada: não precisa de etiqueta.', 409)
  if (order.status !== 'paid') bad('Só dá para gerar etiqueta de pedido pago que ainda não foi enviado.', 409)
  if (order.label_status === 'purchasing') bad('A compra da etiqueta deste pedido ainda está em processamento. Atualize a página em alguns minutos.', 409)
  if (!LABEL_OPEN.includes(order.label_status)) bad('Este pedido já tem etiqueta.', 409)
}

function cleanParcel(p) {
  if (!p || typeof p !== 'object') bad('Informe o tamanho e o peso do pacote.')
  const side = (v, label) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 1 || n > 108) bad(`${cap(label)} do pacote precisa ficar entre 1 e 108 polegadas.`)
    return Math.round(n * 10) / 10
  }
  const w = Number(p.weight_oz)
  if (!Number.isFinite(w) || w < 1 || w > 1120) bad('O peso do pacote precisa ficar entre 1 e 1120 oz (70 lb).')
  return { length: side(p.length, 'o comprimento'), width: side(p.width, 'a largura'), height: side(p.height, 'a altura'), weight_oz: Math.round(w * 10) / 10 }
}

function shipFrom(seller) {
  if (!seller.ship_from || !seller.ship_from.street1) bad('Cadastre o endereço de postagem na aba Loja antes de gerar etiqueta.')
  return toShippoAddress({ ...seller.ship_from, phone: seller.ship_from.phone || seller.phone, company: seller.name })
}

async function orderHasHazmat(supabase, order) {
  const ids = [...new Set(order.items.map(i => i.product_id).filter(Boolean))]
  if (!ids.length) return false
  const { data, error } = await supabase.from('bc_store_products').select('id').in('id', ids).eq('hazmat', true).limit(1)
  dbFail('hazmat', error)
  return !!(data && data.length)
}

async function actLabelRates(req, res, supabase, body) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  assertLabelable(order)
  if (!shippoEnabled()) throw shippoFail({ status: 503 })
  const parcel = cleanParcel(body.parcel)
  const from = shipFrom(seller)
  const to = toShippoAddress(order.ship_to)
  const hazmat = await orderHasHazmat(supabase, order)

  let quote
  try {
    const acct = await ensureSellerAccount(supabase, seller)
    const carrier = acct.carrierAccountId || seller.shippo_carrier_account_id || null
    quote = await getRates({
      from, to, parcel,
      accountId: acct.accountId,
      carrierAccounts: carrier ? [carrier] : null,
      hazmat,
      returnAddress: seller.return_address?.street1 ? toShippoAddress({ ...seller.return_address, company: seller.name }) : null,
      metadata: 'order:' + order.id,
    })
  } catch (e) {
    throw shippoFail(e, 'Não deu para cotar a etiqueta')
  }

  const { error } = await supabase.from('bc_store_orders').update({ parcel, shippo_shipment_id: quote.shipment_id })
    .eq('id', order.id).eq('status', 'paid').in('label_status', LABEL_OPEN)
  dbFail('label-rates save', error)

  const max = maxLabelCents(order)
  return res.status(200).json({
    shipment_id: quote.shipment_id,
    rates: quote.rates.map(r => ({
      rate_id: r.rate_id, provider: r.provider, service: r.service, amount_cents: r.amount_cents, days: r.days,
      net_payout_cents: computePayout({ ...order, label_cost_cents: r.amount_cents }).payout_cents,
      allowed: r.amount_cents <= max,
    })),
    messages: hazmat ? ['Pedido com material perigoso: só aparecem fretes por transporte terrestre.', ...quote.messages] : quote.messages,
    hazmat,
  })
}

async function actLabelBuy(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  const rateId = String(body.rate_id || '')
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(rateId)) bad('Escolha um dos fretes da lista.')
  assertLabelable(order)
  if (!shippoEnabled()) throw shippoFail({ status: 503 })
  // Token de teste da Shippo gera etiqueta de amostra, que nao vale para postagem: nunca em producao
  if (shippoTestMode() && process.env.VERCEL_ENV === 'production') {
    bad('Etiquetas em modo de teste estão desligadas em produção. Poste por conta própria e informe o rastreio em "Já enviei".', 503)
  }
  if (!order.shippo_shipment_id) bad('Gere as opções de frete de novo antes de comprar.', 409)

  // Trava: so uma compra por pedido. label_rate_id + label_locked_at deixam o cron
  // conferir na Shippo uma compra que ficou sem resposta (purchasing ha mais de 10 min).
  const { data: locked, error: lockErr } = await supabase.from('bc_store_orders')
    .update({ label_status: 'purchasing', label_rate_id: rateId, label_locked_at: new Date().toISOString() })
    .eq('id', order.id).eq('status', 'paid').in('label_status', LABEL_OPEN).select('id')
  dbFail('label-buy lock', lockErr)
  if (!locked || !locked.length) bad('Este pedido mudou de situação ou já está comprando etiqueta. Atualize a página.', 409)

  // Nada foi cobrado: volta para 'failed' (a loja pode tentar de novo)
  const unlock = async (extra = {}) => {
    const { error } = await supabase.from('bc_store_orders').update({ label_status: 'failed', label_locked_at: null, ...extra })
      .eq('id', order.id).eq('label_status', 'purchasing')
    if (error) console.error('[store/seller] label unlock:', error.message)
  }
  // Talvez cobrada: continua 'purchasing' para o cron conferir na Shippo
  const keepPurchasing = async (extra) => {
    if (!extra || !Object.keys(extra).length) return
    const { error } = await supabase.from('bc_store_orders').update(extra).eq('id', order.id).eq('label_status', 'purchasing')
    if (error) console.error('[store/seller] label pending:', error.message)
  }
  const pendingReply = (message) => res.status(202).json({ ok: true, pending: true, message })

  // 1) Conferencias antes da compra: se falhar aqui, nada foi cobrado
  let acct, rate
  try {
    acct = await ensureSellerAccount(supabase, seller)
    rate = await getRate(rateId, acct.accountId)
    if (rate.currency && rate.currency !== 'USD') bad('Frete em moeda inválida. Gere as opções de novo.', 409)
    if (rate.shipment_id && rate.shipment_id !== order.shippo_shipment_id) bad('Esse frete não é deste pedido. Gere as opções de novo.', 409)
    const max = maxLabelCents(order)
    if (rate.amount_cents <= 0) bad('Frete inválido. Gere as opções de novo.', 409)
    if (rate.amount_cents > max) {
      bad(`Essa etiqueta (${fmtUSD(rate.amount_cents)}) custa mais do que você recebe neste pedido (${fmtUSD(max)}). Escolha um frete mais barato ou envie por conta própria.`, 409)
    }
  } catch (e) {
    await unlock()
    throw shippoFail(e, 'Não deu para comprar a etiqueta')
  }

  // 2) Compra. A Shippo recusou (4xx): nada foi cobrado. Rede, timeout ou 5xx depois
  //    do POST /transactions: a etiqueta pode ter sido gerada, entao o pedido fica
  //    'purchasing' e o admin e avisado (o cron reconcilia).
  let tx
  try {
    tx = await buyLabel({ rateId, accountId: acct.accountId, metadata: 'order:' + order.id })
  } catch (e) {
    if (e?.status >= 400 && e.status < 500) {
      await unlock()
      throw shippoFail(e, 'Não deu para comprar a etiqueta')
    }
    console.error('[store/seller] label-buy sem resposta:', e?.message)
    await logEvent(supabase, order.id, 'label_pending', { actor: 'system', message: 'Compra da etiqueta sem confirmação da Shippo; conferindo', data: { rate_id: rateId, error: String(e?.message || '').slice(0, 300) } })
    await notifyAdmin('Store: compra de etiqueta sem resposta da Shippo', [
      `Pedido <strong>#${order.order_number}</strong> (loja ${esc(seller.name)}): a Shippo não respondeu à compra da etiqueta (rate ${esc(rateId)}): ${esc(e?.message || 'erro de rede')}.`,
      'O pedido ficou com a etiqueta "em processamento". O cron confere na Shippo depois de 10 minutos; se não resolver, confira as transações da conta antes que a loja compre outra.',
    ])
    return pendingReply('A Shippo não confirmou a compra a tempo. A etiqueta está em processamento: atualize em alguns minutos antes de tentar de novo.')
  }

  const txStatus = String(tx?.status || '').toUpperCase()
  if (txStatus === 'ERROR') {
    await unlock(tx.transaction_id ? { shippo_transaction_id: tx.transaction_id } : {})
    await logEvent(supabase, order.id, 'label_failed', { actor: 'seller', actor_id: user.id, message: 'A compra da etiqueta não foi concluída', data: { status: tx.status, transaction_id: tx.transaction_id, messages: tx.messages } })
    const why = (tx.messages || []).slice(0, 3).join(' · ')
    bad(`A Shippo não gerou a etiqueta${why ? ': ' + why : ''}. Nada foi cobrado. Confira os dados e tente de novo.`, 502)
  }
  if (txStatus !== 'SUCCESS') {
    // QUEUED/WAITING: a Shippo ainda esta gerando (e vai cobrar se der certo). Nao destrava.
    await keepPurchasing(tx?.transaction_id ? { shippo_transaction_id: tx.transaction_id } : null)
    await logEvent(supabase, order.id, 'label_pending', { actor: 'seller', actor_id: user.id, message: 'Etiqueta em processamento na Shippo', data: { status: txStatus, transaction_id: tx?.transaction_id || null, rate_id: rateId } })
    if (!['QUEUED', 'WAITING'].includes(txStatus)) {
      await notifyAdmin('Store: etiqueta com situação inesperada na Shippo', [
        `Pedido <strong>#${order.order_number}</strong>: a transação ${esc(tx?.transaction_id || '')} voltou com a situação "${esc(txStatus || 'vazia')}". O pedido ficou com a etiqueta em processamento; confira.`,
      ])
    }
    return pendingReply('Etiqueta em processamento; atualize em alguns minutos.')
  }

  const carrierCode = normalizeCarrier(rate.provider)
  const trackingUrl = tx.tracking_url || trackingUrlFor(carrierCode, tx.tracking_number)
  const label = {
    label_status: 'purchased', label_url: tx.label_url, label_rate_id: rateId,
    shippo_transaction_id: tx.transaction_id, label_cost_cents: rate.amount_cents, label_locked_at: null,
  }

  try {
    await logEvent(supabase, order.id, 'label_purchased', {
      actor: 'seller', actor_id: user.id,
      message: `Etiqueta comprada pela Store (${[rate.provider, rate.service].filter(Boolean).join(' ')})`,
      data: { label_cost_cents: rate.amount_cents, rate_id: rateId, transaction_id: tx.transaction_id },
    })
    const shipped = await markShipped(supabase, order, {
      carrier: rate.provider, service: rate.service, tracking_number: tx.tracking_number, tracking_url: trackingUrl,
      label, actor: 'seller', actor_id: user.id,
    })
    if (!shipped.ok) {
      // O pedido mudou no meio (ex.: comprador cancelou): devolve a etiqueta
      let refundNote = 'pedimos o reembolso da etiqueta'
      try {
        await refundLabel({ transactionId: tx.transaction_id, accountId: acct.accountId })
      } catch (e) {
        refundNote = 'o reembolso automático da etiqueta falhou; a equipe vai conferir'
        await notifyAdmin('Store: etiqueta comprada para pedido que mudou de situação', [
          `Pedido <strong>#${order.order_number}</strong>: etiqueta ${esc(tx.transaction_id || '')} comprada, mas o pedido não estava mais aguardando envio. O reembolso falhou: ${esc(e.message)}.`,
        ])
      }
      const { error } = await supabase.from('bc_store_orders').update({
        label_status: 'refund_requested', label_url: tx.label_url, label_rate_id: rateId, shippo_transaction_id: tx.transaction_id,
        label_locked_at: null,
      }).eq('id', order.id).eq('label_status', 'purchasing')
      if (error) console.error('[store/seller] label refund save:', error.message)
      await logEvent(supabase, order.id, 'label_refund', { actor: 'system', message: 'Etiqueta não usada: pedido mudou de situação durante a compra' })
      bad(`O pedido mudou de situação durante a compra (${refundNote}). Atualize a página.`, 409)
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    // A etiqueta foi paga: nao destrava (senao a loja compra outra). O cron termina o registro.
    await keepPurchasing({ shippo_transaction_id: tx.transaction_id })
    await notifyAdmin('Store: etiqueta comprada sem registro no pedido', [
      `Pedido <strong>#${order.order_number}</strong>: a Shippo gerou a etiqueta ${esc(tx.transaction_id || '')}, mas o pedido não foi atualizado (${esc(e.message)}). Ele ficou com a etiqueta em processamento para o cron concluir; confira se não resolver.`,
    ])
    return pendingReply('Etiqueta gerada, mas o pedido ainda não foi atualizado. Atualize em alguns minutos.')
  }

  return res.status(200).json({ ok: true, label_url: tx.label_url, tracking_number: tx.tracking_number })
}

// Cancela a etiqueta comprada pela Store quando o pacote ainda nao foi postado:
// pede o reembolso na Shippo e o pedido volta para "aguardando envio".
async function actLabelVoid(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  if (order.status !== 'shipped' || order.label_status !== 'purchased') {
    bad('Só dá para cancelar a etiqueta comprada pela Store de um pedido que ainda não foi postado.', 409)
  }
  if (!VOIDABLE_TRACKING.includes(String(order.tracking_status || '').toUpperCase())) {
    bad('A transportadora já registrou o pacote: essa etiqueta não pode mais ser cancelada.', 409)
  }
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) bad('Com problema aberto pelo comprador, a etiqueta não pode ser cancelada por aqui. Responda pela conversa do pedido.', 409)
  if (order.buyer_confirmed_at) bad('O comprador já confirmou o recebimento deste pedido.', 409)
  if (!['pending', 'blocked', 'held'].includes(order.payout_status)) bad('O repasse deste pedido já está sendo processado.', 409)
  if (!order.shippo_transaction_id) bad('Não encontramos a etiqueta deste pedido. Fale com oi@brasilconnectusa.com.', 409)
  if (!shippoEnabled()) throw shippoFail({ status: 503 })

  // O rastreio gravado pode estar horas atrasado (webhook/poll): confere ao vivo.
  // Pacote ja escaneado (postado no balcao, em transito, entregue) nao cancela.
  const trackCode = normalizeCarrier(order.carrier)
  if (trackCode && order.tracking_number) {
    let live = null
    try {
      live = await withTimeout(getTrack(trackCode, order.tracking_number), LIVE_TRACK_TIMEOUT_MS)
    } catch (e) {
      console.error('[store/seller] label-void rastreio ao vivo:', e?.message)
      // Etiqueta de teste da Shippo nem sempre tem rastreio consultavel: segue so em modo de teste
      if (!shippoTestMode()) bad('Não deu para conferir o rastreio na transportadora agora. Tente de novo em alguns minutos.', 503)
    }
    const liveStatus = String(live?.status || '').toUpperCase()
    if (live && !VOIDABLE_TRACKING.includes(liveStatus)) {
      bad('A transportadora já registrou o pacote: essa etiqueta não pode mais ser cancelada.', 409)
    }
  }

  let refund
  try {
    refund = await refundLabel({ transactionId: order.shippo_transaction_id, accountId: seller.shippo_account_id || null })
  } catch (e) {
    if (e?.status === 503) throw shippoFail(e)
    console.error('[store/seller] label-void:', e?.message)
    const detail = String(e?.message || '').replace(/^Shippo \d+:\s*/, '').slice(0, 200)
    bad(`A Shippo não aceitou cancelar a etiqueta${detail ? ': ' + detail : ''}. Se o pacote não foi postado, fale com oi@brasilconnectusa.com.`, 502)
  }
  // ERROR: a transportadora ja usou/registrou a etiqueta. O pedido fica como esta.
  if (String(refund?.status || '').toUpperCase() === 'ERROR') {
    console.error('[store/seller] label-void recusado pela Shippo:', order.id, refund?.refund_id || '')
    bad('A transportadora já registrou esta etiqueta; ela não pode ser cancelada.', 409)
  }

  // Volta para "aguardando envio" so se nada mudou no meio (ex.: a transportadora escaneou)
  const { data: moved, error } = await supabase.from('bc_store_orders').update({
    status: 'paid', label_status: 'refund_requested', label_cost_cents: 0, label_url: null, label_locked_at: null,
    shipped_at: null, carrier: null, service: null, tracking_number: null, tracking_url: null,
    tracking_status: null, tracking_substatus: null, tracking_updated_at: null,
  }).eq('id', order.id).eq('status', 'shipped').eq('label_status', 'purchased')
    .or('tracking_status.is.null,tracking_status.in.(PRE_TRANSIT,UNKNOWN)')
    .in('payout_status', ['pending', 'blocked', 'held']).select('id')
  dbFail('label-void', error)
  const what = `etiqueta ${order.shippo_transaction_id} (${[order.carrier, order.service].filter(Boolean).join(' ')}, rastreio ${order.tracking_number || '—'})`
  if (!moved || !moved.length) {
    await logEvent(supabase, order.id, 'label_refund', {
      actor: 'seller', actor_id: user.id, message: 'Pedido de reembolso da etiqueta enviado, mas o pedido mudou de situação',
      data: { transaction_id: order.shippo_transaction_id, refund_id: refund?.refund_id || null, refund_status: refund?.status || null, voided_tracking_number: order.tracking_number || null },
    })
    await notifyAdmin(`Store: etiqueta cancelada com o pedido #${order.order_number} em movimento`, [
      `A loja <strong>${esc(seller.name)}</strong> pediu o reembolso da ${esc(what)}, mas o pedido mudou de situação no meio (talvez a transportadora tenha escaneado o pacote). Confira o pedido e o reembolso na Shippo.`,
    ])
    bad('O pedido mudou de situação enquanto a etiqueta era cancelada. Atualize a página; a equipe da BrasilConnect vai conferir.', 409)
  }

  await logEvent(supabase, order.id, 'label_refund', {
    actor: 'seller', actor_id: user.id,
    message: 'Etiqueta cancelada pela loja (não foi postada). O pedido voltou para aguardando envio.',
    // voided_tracking_number: o ship-manual deste pedido recusa esse numero (a etiqueta nao vale mais)
    data: {
      transaction_id: order.shippo_transaction_id, label_cost_cents: order.label_cost_cents, tracking_number: order.tracking_number,
      voided_tracking_number: order.tracking_number || null, refund_id: refund?.refund_id || null, refund_status: refund?.status || null,
    },
  })
  await notifyOrderParties(supabase, order, {
    type: 'store_order_label_void', icon: '📦', skipSeller: true,
    buyerTitle: `Pedido #${order.order_number}: o rastreio anterior foi cancelado`,
    buyerBody: 'A loja cancelou a etiqueta antes de postar. O pedido voltou para "aguardando envio" e você recebe o novo rastreio quando ela postar.',
    sellerTitle: '', sellerBody: '',
  })
  return res.status(200).json({ ok: true })
}

async function actShipManual(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  const carrier = MANUAL_CARRIERS[String(body.carrier || '').trim().toLowerCase()]
  if (!carrier) bad('Escolha a transportadora: USPS, UPS, FedEx, DHL ou Outro.')
  const tracking = String(body.tracking_number || '').replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z0-9-]{6,40}$/.test(tracking)) bad('O código de rastreio precisa ter de 6 a 40 letras ou números.')
  if (order.fulfillment !== 'ship') bad('Este pedido é de entrega local ou retirada. Use "Marcar como entregue".', 409)
  if (order.status !== 'paid') bad('Este pedido não está aguardando envio.', 409)
  if (order.label_status === 'purchasing') bad('A compra da etiqueta deste pedido ainda está em processamento. Espere alguns minutos e atualize a página antes de informar outro envio.', 409)
  if (!LABEL_OPEN.includes(order.label_status)) bad('Este pedido já tem etiqueta comprada pela Store.', 409)

  // Rastreio de outro pacote: so vale repetir no envio combinado (mesmo comprador, mesma loja)
  const { data: same, error: dupErr } = await supabase.from('bc_store_orders')
    .select('id, seller_id, buyer_user_id').ilike('tracking_number', tracking)
    .neq('id', order.id).not('status', 'in', '(canceled,expired)').limit(20)
  dbFail('ship-manual tracking', dupErr)
  if ((same || []).some(o => o.seller_id !== order.seller_id || o.buyer_user_id !== order.buyer_user_id)) {
    bad('Esse código de rastreio já está em outro pedido. Confira o número do pacote deste pedido.', 409)
  }

  // Rastreio da etiqueta da Store que a loja cancelou neste pedido: nao vale mais
  // (o reembolso dela foi pedido; postar com ela sairia de graca para a loja)
  const { data: voids, error: vErr } = await supabase.from('bc_store_order_events').select('data')
    .eq('order_id', order.id).eq('kind', 'label_refund').limit(50)
  dbFail('ship-manual etiquetas canceladas', vErr)
  const voided = new Set((voids || [])
    .map(ev => String(ev.data?.voided_tracking_number || '').replace(/\s+/g, '').toUpperCase())
    .filter(Boolean))
  if (voided.has(tracking)) {
    bad('Esse é o rastreio da etiqueta que você cancelou neste pedido, e ela não vale mais. Poste com uma etiqueta nova e informe o rastreio dela.', 409)
  }

  const code = normalizeCarrier(carrier)
  if (shippoEnabled() && code && code !== 'shippo') {
    try {
      await registerTrack({ carrier: code, trackingNumber: tracking, metadata: 'order:' + order.id })
    } catch (e) {
      console.error('[store/seller] registerTrack:', e.message)
    }
  }
  const r = await markShipped(supabase, order, {
    carrier, tracking_number: tracking, tracking_url: trackingUrlFor(code, tracking), actor: 'seller', actor_id: user.id,
  })
  if (!r.ok) bad(r.error || 'O pedido não está aguardando envio.', 409)
  return res.status(200).json({ ok: true })
}

async function actMarkDelivered(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  if (!['local_delivery', 'pickup'].includes(order.fulfillment)) bad('Pedido enviado por transportadora é marcado como entregue pelo rastreio.', 409)
  const r = await markDelivered(supabase, order, {
    actor: 'seller', actor_id: user.id,
    message: order.fulfillment === 'pickup' ? 'Retirado pelo comprador (informado pela loja)' : 'Entregue pela loja',
  })
  if (!r.ok) bad(r.error || 'O pedido não pode ser marcado como entregue agora.', 409)
  return res.status(200).json({ ok: true })
}

// Retirada/entrega local: registra a data combinada com o comprador (uma vez).
// O prazo (ship_by) passa a ser o fim desse dia em Nova York, ate 14 dias depois
// do pagamento; o cancelamento automatico conta a partir dele.
async function actScheduleHandoff(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  if (!['local_delivery', 'pickup'].includes(order.fulfillment)) bad('Só pedido de retirada ou entrega local tem data combinada.', 409)
  if (order.status !== 'paid') bad('Este pedido não está aguardando entrega.', 409)
  if (order.handoff_scheduled_at) bad('A data combinada deste pedido já foi registrada. Para mudar, fale com oi@brasilconnectusa.com.', 409)

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date || '').trim())
  if (!m) bad('Escolha a data combinada com o comprador.')
  const civil = `${m[1]}-${m[2]}-${m[3]}`
  const noon = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 16)) // meio-dia em Nova York
  if (isNaN(noon) || noon.toISOString().slice(0, 10) !== civil) bad('Data inválida.')
  if (civil < nyCivil(new Date())) bad('A data combinada não pode ser no passado.')
  const maxCivil = handoffMaxCivil(order)
  if (civil > maxCivil) {
    bad(`A data combinada pode ser até ${fmtDayNY(maxCivil + 'T16:00:00Z')} (${HANDOFF_MAX_DAYS} dias depois do pagamento). Para um prazo maior, cancele o pedido e combine uma nova compra.`)
  }

  const agreed = nyEndOfBusinessDay(noon, 0) // 23:59:59 do dia combinado, em Nova York
  // Nunca encurta o prazo que a loja ja tinha
  const shipBy = order.ship_by && new Date(order.ship_by) > agreed ? new Date(order.ship_by) : agreed
  const { data: saved, error } = await supabase.from('bc_store_orders')
    .update({ ship_by: shipBy.toISOString(), handoff_scheduled_at: agreed.toISOString() })
    .eq('id', order.id).eq('status', 'paid').is('handoff_scheduled_at', null).select('id')
  dbFail('schedule-handoff', error)
  if (!saved || !saved.length) bad('O pedido mudou de situação. Atualize a página.', 409)

  const pickup = order.fulfillment === 'pickup'
  const day = fmtDayNY(agreed)
  await logEvent(supabase, order.id, 'handoff_scheduled', {
    actor: 'seller', actor_id: user.id,
    message: `${pickup ? 'Retirada' : 'Entrega'} combinada para ${day}`,
    data: { date: civil },
  })
  await notifyOrderParties(supabase, order, {
    type: 'store_order_handoff', icon: '📅', skipSeller: true,
    buyerTitle: `Pedido #${order.order_number}: ${pickup ? 'retirada' : 'entrega'} combinada para ${day}`,
    buyerBody: `A loja registrou a data combinada com você: ${day}. Se não foi isso que vocês combinaram, responda pela conversa do pedido.`,
    sellerTitle: '', sellerBody: '',
  })
  return res.status(200).json({ ok: true, ship_by: shipBy.toISOString(), handoff_scheduled_at: agreed.toISOString() })
}

async function actCancel(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  const reason = textField(body.reason, 500, 'o motivo do cancelamento', { min: 3, required: true })
  if (order.status !== 'paid') bad('Só dá para cancelar pedido pago que ainda não foi enviado.', 409)
  if (order.label_status === 'purchasing') bad('A compra da etiqueta deste pedido ainda está em processamento. Atualize a página em alguns minutos e tente cancelar de novo.', 409)
  const stripe = await getStripe()
  if (!stripe) bad('Pagamentos indisponíveis agora. Tente mais tarde.', 503)
  const r = await cancelOrder(supabase, stripe, order, { by: 'seller', reason, actor_id: user.id })
  if (!r.ok) bad(r.error || 'Não deu para cancelar.', 409)
  return res.status(200).json({ ok: true })
}

async function actRefund(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  const reason = textField(body.reason, 500, 'o motivo do reembolso', { min: 3, required: true })
  if (!['paid', 'shipped', 'delivered', 'completed'].includes(order.status)) bad('Esse pedido não aceita reembolso.', 409)
  if (order.dispute_status === 'chargeback') bad('O comprador contestou a compra no cartão. A BrasilConnect cuida desse caso.', 409)
  if (order.label_status === 'purchasing') bad('A compra da etiqueta deste pedido ainda está em processamento. Atualize a página em alguns minutos e tente reembolsar de novo.', 409)
  if (order.payout_status === 'releasing') bad('O repasse deste pedido está sendo processado agora. Tente de novo em instantes.', 409)
  const refundable = Math.max(0, (order.total_cents || 0) - (order.refunded_cents || 0))
  const amount = intIn(body.amount_cents, 1, 100000000)
  if (amount == null) bad('Informe o valor do reembolso.')
  if (amount > refundable) bad(`O máximo que dá para reembolsar neste pedido é ${fmtUSD(refundable)}.`)
  const stripe = await getStripe()
  if (!stripe) bad('Pagamentos indisponíveis agora. Tente mais tarde.', 503)
  const r = await refundOrder(supabase, stripe, order, { amount_cents: amount, reason, actor: 'seller', actor_id: user.id })
  // Ex.: o repasse ja saiu e o saldo da loja no Stripe nao cobre o estorno (o painel mostra a mensagem)
  if (!r.ok) bad(r.error || 'Não deu para reembolsar.', 409)
  return res.status(200).json({
    ok: true, refunded_cents: r.refunded_cents, full: !!r.full, canceled: !!r.canceled,
    reversed_cents: r.reversed_cents || 0,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversa com o comprador
// ─────────────────────────────────────────────────────────────────────────────
async function actMessage(req, res, supabase, body) {
  const { user, seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const order = await ownOrder(supabase, seller, body.order_id)
  const text = textField(body.body, 2000, 'a mensagem', { required: true })

  // Conversa encerrada 30 dias depois de o pedido sair do andamento (exceto com problema aberto)
  let refundedAt = null
  if (order.status === 'refunded') {
    const { data: rev } = await supabase.from('bc_store_order_events').select('created_at')
      .eq('order_id', order.id).eq('kind', 'refunded').order('created_at', { ascending: false }).limit(1)
    refundedAt = rev?.[0]?.created_at || null
  }
  if (conversationClosed(order, refundedAt)) {
    bad('A conversa deste pedido foi encerrada (o pedido terminou há mais de 30 dias). Se precisar, fale com oi@brasilconnectusa.com.', 409)
  }

  // Limite por pedido (24 h) e silencio de 30 min: grava, mas nao avisa o comprador de novo
  const now = Date.now()
  const [dayCount, recentQ] = await Promise.all([
    supabase.from('bc_store_messages').select('id', { count: 'exact', head: true })
      .eq('order_id', order.id).eq('sender_role', 'seller').gte('created_at', new Date(now - 86400000).toISOString()),
    supabase.from('bc_store_messages').select('id')
      .eq('order_id', order.id).eq('sender_role', 'seller').gte('created_at', new Date(now - MSG_QUIET_MS).toISOString()).limit(1),
  ])
  dbFail('message count', dayCount.error)
  dbFail('message recent', recentQ.error)
  if ((dayCount.count || 0) >= MSG_MAX_PER_DAY) {
    bad('Você já mandou muitas mensagens neste pedido hoje. Espere o comprador responder ou tente amanhã.', 429)
  }
  const quiet = !!(recentQ.data && recentQ.data.length)

  const { data: msg, error } = await supabase.from('bc_store_messages')
    .insert({ order_id: order.id, sender_role: 'seller', sender_user_id: user.id, body: text })
    .select('id, sender_role, body, created_at').single()
  dbFail('message insert', error)
  const { error: upErr } = await supabase.from('bc_store_orders').update({ last_message_at: msg.created_at }).eq('id', order.id)
  if (upErr) console.error('[store/seller] last_message_at:', upErr.message)

  if (quiet) return res.status(200).json({ message: { ...msg, mine: true } })

  const snippet = text.length > 140 ? text.slice(0, 137) + '...' : text
  await notify({
    user_id: order.buyer_user_id,
    email: order.buyer_email,
    type: 'store_message', icon: '💬',
    title: `Mensagem da loja ${seller.name} · pedido #${order.order_number}`,
    body: snippet, url: buyerOrderUrl(order), metadata: { order_id: order.id },
    mail: {
      subject: `Nova mensagem sobre o pedido #${order.order_number}`,
      title: 'Nova mensagem da loja',
      paragraphs: [
        `<strong>${esc(seller.name)}</strong> escreveu sobre o pedido <strong>#${order.order_number}</strong>:`,
        `<em>${esc(snippet)}</em>`,
        'Responda pela página do pedido. Combinar tudo por lá protege a sua compra.',
      ],
      ctaUrl: APP_URL + buyerOrderUrl(order), ctaLabel: 'Responder',
    },
  })
  return res.status(200).json({ message: { ...msg, mine: true } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Avaliacoes
// ─────────────────────────────────────────────────────────────────────────────
async function shapeReviews(supabase, rows) {
  const pIds = [...new Set(rows.map(r => r.product_id).filter(Boolean))]
  const oIds = [...new Set(rows.map(r => r.order_id).filter(Boolean))]
  const [prods, orders] = await Promise.all([
    pIds.length ? supabase.from('bc_store_products').select('id, title').in('id', pIds) : Promise.resolve({ data: [], error: null }),
    oIds.length ? supabase.from('bc_store_orders').select('id, order_number, ship_to').in('id', oIds) : Promise.resolve({ data: [], error: null }),
  ])
  dbFail('reviews products', prods.error)
  dbFail('reviews orders', orders.error)
  const pm = Object.fromEntries((prods.data || []).map(p => [p.id, p.title]))
  const om = Object.fromEntries((orders.data || []).map(o => [o.id, o]))
  return rows.map(r => ({
    id: r.id, rating: r.rating, body: r.body, seller_reply: r.seller_reply, seller_replied_at: r.seller_replied_at,
    created_at: r.created_at, status: r.status, product_id: r.product_id,
    product_title: pm[r.product_id] || null,
    order_number: om[r.order_id]?.order_number || null,
    buyer_name: shortName(om[r.order_id]?.ship_to?.name),
  }))
}

const REVIEW_COLS = 'id, order_id, product_id, rating, body, seller_reply, seller_replied_at, status, created_at'

async function actReviews(req, res, supabase) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const { data, error } = await supabase.from('bc_store_reviews').select(REVIEW_COLS)
    .eq('seller_id', seller.id).order('created_at', { ascending: false }).limit(200)
  dbFail('reviews', error)
  return res.status(200).json({ reviews: await shapeReviews(supabase, data || []) })
}

async function actReplyReview(req, res, supabase, body) {
  const { seller } = await sellerCtx(req, supabase)
  if (!isUuid(body.review_id)) bad('Avaliação inválida.')
  const text = textField(body.body, 1000, 'a resposta', { required: true })
  noContact(text, 'a resposta')
  const { data: rv, error } = await supabase.from('bc_store_reviews').select('id, seller_reply, buyer_user_id, order_id')
    .eq('id', body.review_id).eq('seller_id', seller.id).maybeSingle()
  dbFail('reply load', error)
  if (!rv) bad('Avaliação não encontrada.', 404)
  if (rv.seller_reply) bad('Você já respondeu esta avaliação.', 409)
  const { data, error: upErr } = await supabase.from('bc_store_reviews')
    .update({ seller_reply: text, seller_replied_at: new Date().toISOString() })
    .eq('id', rv.id).eq('seller_id', seller.id).is('seller_reply', null).select(REVIEW_COLS)
  dbFail('reply', upErr)
  if (!data || !data.length) bad('Você já respondeu esta avaliação.', 409)
  await notify({
    user_id: rv.buyer_user_id, type: 'store_review_reply', icon: '💬',
    title: `A loja ${seller.name} respondeu sua avaliação`,
    body: text.length > 140 ? text.slice(0, 137) + '...' : text,
    url: buyerOrderUrl({ id: rv.order_id }),
  })
  const [review] = await shapeReviews(supabase, data)
  return res.status(200).json({ review })
}

// ─────────────────────────────────────────────────────────────────────────────
// Repasses
// ─────────────────────────────────────────────────────────────────────────────
async function actPayouts(req, res, supabase) {
  const { seller } = await sellerCtx(req, supabase, { allowSuspended: true })
  const cfg = await getConfig(supabase)
  const since30 = Date.now() - 30 * 86400000
  const [list, newSeller] = await Promise.all([
    supabase.from('bc_store_orders').select(PAYOUT_COLS).eq('seller_id', seller.id)
      .in('status', ['paid', 'shipped', 'delivered', 'completed', 'refunded']).neq('payout_status', 'none')
      .order('created_at', { ascending: false }).limit(200),
    isNewSeller(supabase, seller.id, cfg),
  ])
  dbFail('payouts', list.error)
  const orders = list.data || []
  const pending = orders.filter(isPendingPayout).reduce((s, o) => s + computePayout(o).payout_cents, 0)
  const released30 = orders.filter(o => o.payout_status === 'released' && o.completed_at && new Date(o.completed_at).getTime() >= since30)
    .reduce((s, o) => s + (o.payout_cents || 0), 0)
  return res.status(200).json({
    pending_cents: pending,
    released_cents_30d: released30,
    // Estorno de repasse que o Stripe recusou: sai dos proximos repasses
    debt_cents: Math.max(0, Number(seller.debt_cents) || 0),
    orders: orders.map(o => {
      const released = o.payout_status === 'released'
      const due = released ? null : (o.release_at ? new Date(o.release_at) : releaseDueAt(o, cfg, { newSeller }))
      return {
        id: o.id, order_number: o.order_number, status: o.status, status_label: ORDER_STATUS_PT[o.status] || o.status,
        payout_status: o.payout_status,
        payout_cents: released ? o.payout_cents : null,
        payout_preview_cents: computePayout(o).payout_cents,
        release_at: released ? o.completed_at : (due ? due.toISOString() : null),
        completed_at: o.completed_at,
      }
    }),
  })
}
