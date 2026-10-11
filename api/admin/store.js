/**
 * /api/admin/store — admin da BrasilConnect Store (requireAdmin).
 *
 * GET ?view=
 *   overview                                   contadores, GMV/comissao 30d, config
 *   sellers&status=&q=                         lojas + summary por status (status=changes: alteracoes
 *                                              pendentes; status=debt: com debito)
 *   products&status=&q=&seller_id=             produtos + loja, categoria, agent_* + summary
 *   orders&filter=all|to_ship|late|disputes|blocked|held|labels&q=   (q = numero do pedido ou e-mail do comprador)
 *   order&id=                                  detalhe completo (itens, eventos, conversa, checkout, loja)
 *   reports&status=pending|resolved|dismissed|all
 *   reviews&filter=flagged|hidden|all          avaliacoes (a IA sinaliza; o admin esconde/mostra)
 *   state-volume                               volume por estado x limites de marketplace facilitator
 *   config
 *
 * POST ?action=  (body JSON; mande tambem "id" para a auditoria)
 *   approve_seller | reject_seller | suspend_seller | reinstate_seller   { seller_id, reason }
 *   approve_shop_changes | reject_shop_changes                           { seller_id, reason, pending_changes_at? }
 *   clear_seller_debt                                                    { seller_id, reason }
 *   approve_product | reject_product | suspend_product                  { product_id, reason }
 *   resolve_report | dismiss_report                                      { report_id, reason, suspend_product? }
 *   refund { order_id, amount_cents, reason } · cancel_order { order_id, reason }
 *   release { order_id }   (force; repasse travado em 'releasing' ha 10 min+: confere no Stripe e
 *                           grava o transfer ou destrava e repassa = botao "Destravar repasse")
 *   hold { order_id, reason } · unhold { order_id } · unlock_label { order_id }
 *   resolve_dispute { order_id, decision: refund|release, amount_cents?, reason }
 *   message { order_id, body } · hide_review { review_id, reason? } · show_review { review_id, reason? }
 *   save_config { ...campos de bc_store_config } · set_seller_fee { seller_id, fee_bps_override }
 *   notify_waitlist   proximo lote do aviso "a Store abriu para compras" (save_config manda o
 *                     primeiro quando vitrine e compras ficam ligadas)
 *
 * Toda decisao: update com guarda de status (409 se mudou), reviewed_by = admin.actor,
 * logModeration() e aviso para a loja (sino + e-mail). A auditoria da requisicao
 * (bc_admin_audit) e automatica no requireAdmin.
 *
 * suspendStoreOfBannedUser() e exportada para api/admin/user-action.js e
 * api/admin/moderation-action.js: banir o dono suspende a loja (mesmo efeito de suspend_seller).
 */
import { requireAdmin } from '../_lib/adminAuth.js'
import { rateLimit } from '../_lib/rateLimit.js'
import {
  APP_URL, CONFIG_DEFAULTS, getSupabase, getStripe, err, isUuid, cleanText, cleanImages, isSafeImageUrl,
  computePayout, sellerCanSell, isBanned, logEvent, logModeration, notify, esc, fmtUSD,
  ORDER_STATUS_PT, US_STATES,
} from '../_lib/store.js'
import {
  ACTIVE_DISPUTES, loadOrder, cancelOrder, refundOrder, releaseOrder, releaseDueAt, isNewSeller,
  notifyOrderParties, expireCheckout,
} from '../_lib/storeOrders.js'
import { reconcileLabel } from '../cron/store.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────
const SELLER_STATUSES = ['pending', 'approved', 'rejected', 'suspended']
const PRODUCT_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'paused', 'suspended', 'archived']
const REPORT_STATUSES = ['pending', 'resolved', 'dismissed']
const ORDER_FILTERS = ['all', 'to_ship', 'late', 'disputes', 'blocked', 'held', 'labels']
const REVIEW_FILTERS = ['flagged', 'hidden', 'all']
const LABEL_STALE_MS = 10 * 60_000
// Repasse em 'releasing' ha mais que isso: a rodada morreu no meio (releaseOrder recupera)
const RELEASE_STALE_MS = 10 * 60_000
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 }

const releasingStale = (o) => o?.payout_status === 'releasing'
  && (!o.releasing_at || Date.now() - new Date(o.releasing_at).getTime() > RELEASE_STALE_MS)

const SELLER_STATUS_PT = { pending: 'aguardando análise', approved: 'aprovada', rejected: 'reprovada', suspended: 'suspensa' }
const PRODUCT_STATUS_PT = {
  draft: 'rascunho', pending_review: 'em análise', approved: 'aprovado', rejected: 'reprovado',
  paused: 'pausado', suspended: 'suspenso', archived: 'arquivado',
}

// Lista (sem ship_from completo, return_address, agreement_ip e shippo_*): o card mostra so cidade/UF de postagem
const SELLER_ADMIN_COLS = 'id, user_id, email, slug, name, tagline, bio, logo_url, banner_url, city, state, phone, status, rejection_reason, submitted_at, reviewed_by, reviewed_at, ship_from, handling_days, accepts_returns, return_window_days, return_policy, warranty_policy, agreement_version, agreement_accepted_at, stripe_account_id, stripe_details_submitted, stripe_payouts_enabled, stripe_transfers_active, stripe_requirements, fee_bps_override, vacation_mode, debt_cents, pending_changes, pending_changes_at, sales_count, rating_avg, rating_count, agent_status, agent_severity, agent_categories, agent_reasoning, agent_checked_at, admin_notes, created_at, updated_at'
const PRODUCT_ADMIN_COLS = 'id, seller_id, slug, title, description, category_slug, condition, origin, price_cents, compare_at_cents, stock, sku, weight_oz, length_in, width_in, height_in, images, hazmat, tags, compliance_notes, compliance_images, status, rejection_reason, submitted_at, reviewed_by, reviewed_at, published_at, sales_count, rating_avg, rating_count, agent_status, agent_severity, agent_categories, agent_reasoning, agent_checked_at, created_at, updated_at'
const ORDER_LIST_COLS = 'id, order_number, checkout_id, seller_id, buyer_email, ship_to, fulfillment, items_cents, shipping_cents, tax_cents, total_cents, refunded_cents, fee_cents, payout_cents, status, ship_by, paid_at, shipped_at, delivered_at, completed_at, canceled_at, created_at, tracking_number, carrier, label_status, label_locked_at, payout_status, hold_reason, release_at, stripe_transfer_id, reversed_cents, debt_applied_cents, dispute_status, dispute_reason, dispute_opened_at, dispute_escalated_at, last_message_at'

// Limites de marketplace facilitator (vendas em 12 meses). Confirmar com contador.
const NO_SALES_TAX = new Set(['DE', 'MT', 'NH', 'OR'])
const TAX_NOTE = 'Limites aproximados: confirmar com contador; no TX com presença física a coleta vale desde a primeira venda.'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  e.expose = true
  return e
}

function tableMissing(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''))
}

function dbError(error, what) {
  if (tableMissing(error)) return httpError(503, 'As tabelas da Store ainda não existem no banco. Aplique supabase/bc_store_schema.sql.')
  return httpError(500, `Erro ao ${what}: ${error.message}`)
}

/** Confere { data, error } do supabase-js (que nao lanca erro). */
function must(result, what) {
  if (result.error) throw dbError(result.error, what)
  return result.data
}

/** Termo de busca seguro para ilike dentro de .or(): tira os separadores do PostgREST e escapa % e _. */
function likeTerm(q) {
  const s = String(q || '').replace(/[,()"'*:\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!s) return null
  return s.replace(/[%_]/g, ch => '\\' + ch)
}

function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10)
  return NaN
}

function toBool(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return undefined
}

function requireReason(body, msg) {
  const reason = cleanText(body.reason, 1000)
  if (!reason || reason.length < 3) throw httpError(400, msg || 'Escreva o motivo (ele vai para a loja).')
  return reason
}

function avg(list) {
  const ratings = (list || []).map(r => Number(r.rating)).filter(n => n >= 1 && n <= 5)
  if (!ratings.length) return { avg: null, count: 0 }
  return { avg: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100, count: ratings.length }
}

async function countWhere(supabase, table, build) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  if (build) q = build(q)
  const { count, error } = await q
  if (error) throw dbError(error, 'contar ' + table)
  return count || 0
}

async function readConfig(supabase) {
  const data = must(await supabase.from('bc_store_config').select('*').eq('id', 1).maybeSingle(), 'ler a configuração')
  return { ...CONFIG_DEFAULTS, ...(data || {}) }
}

async function needStripe() {
  const stripe = await getStripe()
  if (!stripe) throw httpError(503, 'Stripe não configurado (STRIPE_SECRET_KEY).')
  return stripe
}

/** Erro devolvido pelas operacoes de storeOrders: falha do Stripe = 502, o resto = 409. */
function opError(r) {
  const msg = r?.error || 'Não deu para concluir.'
  return httpError(/stripe/i.test(msg) ? 502 : 409, msg)
}

function stripeRequirementsDue(req) {
  if (!req || typeof req !== 'object') return []
  const list = [...(Array.isArray(req.currently_due) ? req.currently_due : []), ...(Array.isArray(req.past_due) ? req.past_due : [])]
  return [...new Set(list.map(String))].slice(0, 20)
}

// Campos de loja aprovada que so mudam com aprovacao do admin (pending_changes)
const SHOP_CHANGE_FIELDS = ['name', 'logo_url', 'banner_url', 'tagline', 'bio']

/** Alteracoes pendentes limpas para o admin ver (so campos conhecidos; imagem so do nosso bucket). */
function cleanPendingChanges(pc) {
  if (!pc || typeof pc !== 'object' || Array.isArray(pc)) return null
  const out = {}
  for (const k of SHOP_CHANGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(pc, k)) continue
    const v = pc[k]
    if (k === 'logo_url' || k === 'banner_url') out[k] = v === null || v === '' ? null : (isSafeImageUrl(v) ? String(v) : undefined)
    else out[k] = v === null ? null : cleanText(v, k === 'bio' ? 2000 : k === 'tagline' ? 120 : 60)
    if (out[k] === undefined) delete out[k]
  }
  return Object.keys(out).length ? out : null
}

function sellerAdmin(s, extra = {}) {
  if (!s) return null
  const { ship_from: from, stripe_requirements: reqs, ...rest } = s
  const sf = from && typeof from === 'object' ? from : null
  return {
    ...rest,
    pending_changes: cleanPendingChanges(s.pending_changes),
    debt_cents: s.debt_cents || 0,
    logo_url: isSafeImageUrl(s.logo_url) ? s.logo_url : null,
    banner_url: isSafeImageUrl(s.banner_url) ? s.banner_url : null,
    rating_avg: s.rating_avg != null ? Number(s.rating_avg) : null,
    ship_from_city: sf ? (sf.city || null) : null,
    ship_from_state: sf ? (sf.state || null) : null,
    stripe_requirements_due: stripeRequirementsDue(reqs),
    stripe_disabled_reason: reqs && typeof reqs === 'object' ? (reqs.disabled_reason || null) : null,
    ...extra,
  }
}

function productAdmin(p, seller, cat) {
  if (!p) return null
  return {
    ...p,
    images: cleanImages(p.images),
    compliance_images: cleanImages(p.compliance_images, 12),
    rating_avg: p.rating_avg != null ? Number(p.rating_avg) : null,
    weight_oz: p.weight_oz != null ? Number(p.weight_oz) : null,
    length_in: p.length_in != null ? Number(p.length_in) : null,
    width_in: p.width_in != null ? Number(p.width_in) : null,
    height_in: p.height_in != null ? Number(p.height_in) : null,
    seller_name: seller?.name || null,
    seller_slug: seller?.slug || null,
    seller_status: seller?.status || null,
    seller_can_sell: sellerCanSell(seller),
    category: cat
      ? { slug: cat.slug, name: cat.name, gated: !!cat.gated, requirements: cat.requirements || null }
      : { slug: p.category_slug, name: p.category_slug, gated: false, requirements: null },
  }
}

function orderCard(o, seller) {
  const st = o.ship_to && typeof o.ship_to === 'object' ? o.ship_to : {}
  return {
    id: o.id, order_number: o.order_number, status: o.status, status_label: ORDER_STATUS_PT[o.status] || o.status,
    fulfillment: o.fulfillment, created_at: o.created_at, paid_at: o.paid_at, ship_by: o.ship_by,
    late: o.status === 'paid' && !!o.ship_by && new Date(o.ship_by) < new Date(),
    seller: seller ? { id: seller.id, name: seller.name, slug: seller.slug } : { id: o.seller_id, name: null, slug: null },
    buyer_email: o.buyer_email, buyer_name: st.name || null, ship_to_city: st.city || null, ship_to_state: st.state || null,
    items_cents: o.items_cents, shipping_cents: o.shipping_cents, tax_cents: o.tax_cents, total_cents: o.total_cents,
    refunded_cents: o.refunded_cents, payout_status: o.payout_status, payout_cents: o.payout_cents,
    hold_reason: o.hold_reason, release_at: o.release_at, dispute_status: o.dispute_status,
    dispute_reason: o.dispute_reason, dispute_opened_at: o.dispute_opened_at, tracking_number: o.tracking_number,
    carrier: o.carrier, label_status: o.label_status, label_locked_at: o.label_locked_at || null,
    reversed_cents: o.reversed_cents || 0, last_message_at: o.last_message_at,
  }
}

async function sellersByIds(supabase, ids, cols = 'id, name, slug, status') {
  const list = [...new Set((ids || []).filter(isUuid))]
  if (!list.length) return {}
  const data = must(await supabase.from('bc_store_sellers').select(cols).in('id', list), 'ler lojas')
  return Object.fromEntries((data || []).map(s => [s.id, s]))
}

async function recalcRatings(supabase, { product_id, seller_id }) {
  if (product_id) {
    const { data, error } = await supabase.from('bc_store_reviews').select('rating').eq('product_id', product_id).eq('status', 'visible').limit(10000)
    if (error) console.error('[admin/store] media do produto falhou:', error.message)
    else {
      const r = avg(data)
      const { error: upErr } = await supabase.from('bc_store_products').update({ rating_avg: r.avg, rating_count: r.count }).eq('id', product_id)
      if (upErr) console.error('[admin/store] update media produto:', upErr.message)
    }
  }
  if (seller_id) {
    const { data, error } = await supabase.from('bc_store_reviews').select('rating').eq('seller_id', seller_id).eq('status', 'visible').limit(10000)
    if (error) console.error('[admin/store] media da loja falhou:', error.message)
    else {
      const r = avg(data)
      const { error: upErr } = await supabase.from('bc_store_sellers').update({ rating_avg: r.avg, rating_count: r.count }).eq('id', seller_id)
      if (upErr) console.error('[admin/store] update media loja:', upErr.message)
    }
  }
}

function taxThreshold(st) {
  if (NO_SALES_TAX.has(st)) return { threshold_cents: null, transactions_threshold: null, note: 'Sem sales tax estadual.' }
  if (st === 'AL' || st === 'MS') return { threshold_cents: 25000000, transactions_threshold: null, note: null }
  if (st === 'CA') return { threshold_cents: 50000000, transactions_threshold: null, note: null }
  if (st === 'TX') return { threshold_cents: 50000000, transactions_threshold: null, note: 'Com presença física no TX, a coleta vale desde a primeira venda.' }
  if (st === 'NY') return { threshold_cents: 50000000, transactions_threshold: 100, note: 'NY exige US$ 500 mil e 100 transações.' }
  if (st === 'AK') return { threshold_cents: 10000000, transactions_threshold: null, note: 'Só imposto local (ARSSTC).' }
  return { threshold_cents: 10000000, transactions_threshold: null, note: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Views (GET)
// ─────────────────────────────────────────────────────────────────────────────
async function viewOverview(supabase) {
  const nowIso = new Date().toISOString()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const labelCutoff = new Date(Date.now() - LABEL_STALE_MS).toISOString()
  const [
    sellers_pending, products_pending, reports_pending, disputes_escalated, disputes_open,
    chargebacks, orders_late, payouts_blocked, payouts_held, orders_to_ship,
    shop_changes_pending, sellers_debt, reviews_flagged, labels_stuck,
  ] = await Promise.all([
    countWhere(supabase, 'bc_store_sellers', q => q.eq('status', 'pending')),
    countWhere(supabase, 'bc_store_products', q => q.eq('status', 'pending_review')),
    countWhere(supabase, 'bc_store_reports', q => q.eq('status', 'pending')),
    countWhere(supabase, 'bc_store_orders', q => q.eq('dispute_status', 'escalated')),
    countWhere(supabase, 'bc_store_orders', q => q.eq('dispute_status', 'open')),
    countWhere(supabase, 'bc_store_orders', q => q.eq('dispute_status', 'chargeback')),
    countWhere(supabase, 'bc_store_orders', q => q.eq('status', 'paid').lt('ship_by', nowIso)),
    countWhere(supabase, 'bc_store_orders', q => q.eq('payout_status', 'blocked')),
    countWhere(supabase, 'bc_store_orders', q => q.eq('payout_status', 'held')),
    countWhere(supabase, 'bc_store_orders', q => q.eq('status', 'paid')),
    countWhere(supabase, 'bc_store_sellers', q => q.not('pending_changes', 'is', null)),
    countWhere(supabase, 'bc_store_sellers', q => q.gt('debt_cents', 0)),
    countWhere(supabase, 'bc_store_reviews', q => q.in('agent_status', ['flagged', 'auto_hidden'])),
    countWhere(supabase, 'bc_store_orders', q => q.eq('label_status', 'purchasing').lt('label_locked_at', labelCutoff)),
  ])

  const recent = must(await supabase.from('bc_store_orders')
    .select('status, items_cents, shipping_cents, refunded_cents, fee_bps, fee_fixed_cents, fee_on_shipping, label_cost_cents')
    .gte('paid_at', since)
    .in('status', ['paid', 'shipped', 'delivered', 'completed', 'refunded'])
    .limit(10000), 'ler pedidos dos últimos 30 dias') || []

  let gmv = 0
  let fees = 0
  for (const o of recent) {
    const gross = (o.items_cents || 0) + (o.shipping_cents || 0)
    gmv += Math.max(0, gross - Math.min(gross, o.refunded_cents || 0))
    fees += computePayout(o).fee_cents
  }

  return {
    counts: {
      sellers_pending, products_pending, reports_pending, disputes_escalated, disputes_open,
      orders_late, payouts_blocked, chargebacks, payouts_held, orders_to_ship,
      shop_changes_pending, sellers_debt, reviews_flagged, labels_stuck,
    },
    gmv_30d_cents: gmv,
    fees_30d_cents: fees,
    orders_30d: recent.length,
    config: await readConfig(supabase),
  }
}

async function viewSellers(supabase, query) {
  // changes = loja com nome/logo/capa esperando aprovacao · debt = loja com debito
  const status = SELLER_STATUSES.includes(query.status) || ['changes', 'debt'].includes(query.status) ? query.status : 'all'
  let qb = supabase.from('bc_store_sellers').select(SELLER_ADMIN_COLS)
    .order(status === 'changes' ? 'pending_changes_at' : 'submitted_at', { ascending: status === 'pending' || status === 'changes' })
    .limit(100)
  if (status === 'changes') qb = qb.not('pending_changes', 'is', null)
  else if (status === 'debt') qb = qb.gt('debt_cents', 0)
  else if (status !== 'all') qb = qb.eq('status', status)
  const term = likeTerm(query.q)
  if (term) qb = qb.or(`name.ilike.%${term}%,slug.ilike.%${term}%,email.ilike.%${term}%,city.ilike.%${term}%`)
  const sellers = must(await qb, 'listar lojas') || []

  const ids = sellers.map(s => s.id)
  const userIds = sellers.map(s => s.user_id).filter(isUuid)
  let prods = []
  let zones = []
  let banned = new Set()
  if (ids.length) {
    const [p, z, b] = await Promise.all([
      supabase.from('bc_store_products').select('seller_id, status').in('seller_id', ids).limit(20000),
      supabase.from('bc_store_shipping_zones').select('seller_id, method, name, states, zip_prefixes, active').in('seller_id', ids),
      userIds.length ? supabase.from('bc_banned_users').select('user_id').in('user_id', userIds) : Promise.resolve({ data: [] }),
    ])
    prods = must(p, 'contar produtos das lojas') || []
    zones = must(z, 'ler regiões de entrega') || []
    if (!b.error) banned = new Set((b.data || []).map(x => x.user_id))
  }

  const list = sellers.map(s => {
    const mine = prods.filter(p => p.seller_id === s.id)
    const byStatus = {}
    for (const p of mine) byStatus[p.status] = (byStatus[p.status] || 0) + 1
    const zs = zones.filter(z => z.seller_id === s.id)
    const states = [...new Set(zs.filter(z => z.active !== false).flatMap(z => z.states || []))].sort()
    return sellerAdmin(s, {
      products: { total: mine.length, ...byStatus },
      zones: zs.map(z => ({ name: z.name, method: z.method, states: z.states || [], zip_count: (z.zip_prefixes || []).length, active: z.active !== false })),
      ships_to: states,
      banned: banned.has(s.user_id),
    })
  })

  const counts = await Promise.all(SELLER_STATUSES.map(st => countWhere(supabase, 'bc_store_sellers', q => q.eq('status', st))))
  const summary = { total: counts.reduce((a, b) => a + b, 0) }
  SELLER_STATUSES.forEach((st, i) => { summary[st] = counts[i] })
  const [changes, debt] = await Promise.all([
    countWhere(supabase, 'bc_store_sellers', q => q.not('pending_changes', 'is', null)),
    countWhere(supabase, 'bc_store_sellers', q => q.gt('debt_cents', 0)),
  ])
  summary.changes = changes
  summary.debt = debt

  return { sellers: list, summary, filter: { status, q: query.q || '' } }
}

async function viewProducts(supabase, query) {
  const status = PRODUCT_STATUSES.includes(query.status) ? query.status : 'all'
  const sellerId = isUuid(query.seller_id) ? query.seller_id : null
  let qb = supabase.from('bc_store_products').select(PRODUCT_ADMIN_COLS).limit(200)
  if (status === 'pending_review') qb = qb.order('submitted_at', { ascending: true, nullsFirst: false })
  else qb = qb.order('updated_at', { ascending: false })
  if (status !== 'all') qb = qb.eq('status', status)
  if (sellerId) qb = qb.eq('seller_id', sellerId)
  const term = likeTerm(query.q)
  if (term) qb = qb.or(`title.ilike.%${term}%,slug.ilike.%${term}%,sku.ilike.%${term}%`)
  const products = must(await qb, 'listar produtos') || []

  const [sellerMap, cats] = await Promise.all([
    sellersByIds(supabase, products.map(p => p.seller_id), 'id, name, slug, status, stripe_transfers_active, vacation_mode'),
    supabase.from('bc_store_categories').select('slug, name, gated, requirements'),
  ])
  const catMap = Object.fromEntries((must(cats, 'ler categorias') || []).map(c => [c.slug, c]))

  let list = products.map(p => productAdmin(p, sellerMap[p.seller_id], catMap[p.category_slug]))
  if (status === 'pending_review') {
    // Fila: o que a IA sinalizou como mais grave primeiro, depois o mais antigo
    list = list
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (SEV_RANK[b.p.agent_severity] || 0) - (SEV_RANK[a.p.agent_severity] || 0) || a.i - b.i)
      .map(x => x.p)
  }

  const counts = await Promise.all(PRODUCT_STATUSES.map(st => countWhere(supabase, 'bc_store_products', q => {
    let x = q.eq('status', st)
    if (sellerId) x = x.eq('seller_id', sellerId)
    return x
  })))
  const summary = { total: counts.reduce((a, b) => a + b, 0) }
  PRODUCT_STATUSES.forEach((st, i) => { summary[st] = counts[i] })

  return { products: list, summary, filter: { status, q: query.q || '', seller_id: sellerId } }
}

async function viewOrders(supabase, query) {
  const filter = ORDER_FILTERS.includes(query.filter) ? query.filter : 'all'
  const nowIso = new Date().toISOString()
  const raw = String(query.q || '').trim().slice(0, 120)
  let qb = supabase.from('bc_store_orders').select(ORDER_LIST_COLS).limit(200)

  if (filter === 'to_ship') qb = qb.eq('status', 'paid').order('ship_by', { ascending: true })
  else if (filter === 'late') qb = qb.eq('status', 'paid').lt('ship_by', nowIso).order('ship_by', { ascending: true })
  else if (filter === 'disputes') qb = qb.in('dispute_status', ACTIVE_DISPUTES).order('dispute_opened_at', { ascending: true, nullsFirst: false })
  else if (filter === 'blocked') qb = qb.eq('payout_status', 'blocked').order('created_at', { ascending: false })
  else if (filter === 'held') qb = qb.eq('payout_status', 'held').order('created_at', { ascending: false })
  else if (filter === 'labels') qb = qb.eq('label_status', 'purchasing').order('label_locked_at', { ascending: true, nullsFirst: true })
  else {
    qb = qb.order('created_at', { ascending: false })
    // Sem busca, a lista geral esconde checkouts nao pagos
    if (!raw) qb = qb.not('status', 'in', '(pending_payment,expired)')
  }

  if (raw) {
    const num = /^#?\s*(\d{1,12})$/.exec(raw)
    if (num) qb = qb.eq('order_number', Number(num[1]))
    else if (isUuid(raw)) qb = qb.eq('id', raw)
    else {
      const term = likeTerm(raw)
      if (term) qb = qb.ilike('buyer_email', `%${term}%`)
    }
  }

  const orders = must(await qb, 'listar pedidos') || []
  const sellerMap = await sellersByIds(supabase, orders.map(o => o.seller_id))
  return { orders: orders.map(o => orderCard(o, sellerMap[o.seller_id])), filter, q: raw }
}

async function viewOrder(supabase, query) {
  const id = query.id
  if (!isUuid(id)) throw httpError(400, 'id do pedido inválido.')
  const full = await loadOrder(supabase, id)
  if (!full) throw httpError(404, 'Pedido não encontrado.')
  const { items: rawItems, ...order } = full

  const [ev, msgs, co, sel, revs, cfg] = await Promise.all([
    supabase.from('bc_store_order_events').select('id, kind, actor, actor_id, message, data, created_at').eq('order_id', id).order('created_at', { ascending: true }).limit(500),
    supabase.from('bc_store_messages').select('id, sender_role, sender_user_id, body, created_at').eq('order_id', id).order('created_at', { ascending: true }).limit(500),
    supabase.from('bc_store_checkouts').select('id, status, buyer_email, items_cents, shipping_cents, tax_cents, total_cents, stripe_session_id, stripe_payment_intent_id, stripe_charge_id, paid_at, expires_at, created_at').eq('id', order.checkout_id).maybeSingle(),
    supabase.from('bc_store_sellers').select('id, user_id, email, name, slug, phone, status, logo_url, stripe_account_id, stripe_transfers_active, fee_bps_override, sales_count, vacation_mode, debt_cents').eq('id', order.seller_id).maybeSingle(),
    supabase.from('bc_store_reviews').select('id, product_id, rating, body, seller_reply, status, created_at').eq('order_id', id).order('created_at', { ascending: true }),
    readConfig(supabase),
  ])
  const events = must(ev, 'ler eventos do pedido') || []
  const messages = must(msgs, 'ler conversa do pedido') || []
  const checkout = must(co, 'ler checkout do pedido')
  const seller = must(sel, 'ler loja do pedido')
  const reviews = must(revs, 'ler avaliações do pedido') || []

  const newSeller = await isNewSeller(supabase, order.seller_id, cfg)
  const pp = computePayout(order)
  const due = releaseDueAt(order, cfg, { newSeller })
  const refundable = Math.max(0, (order.total_cents || 0) - (order.refunded_cents || 0))
  const activeDispute = ACTIVE_DISPUTES.includes(order.dispute_status)
  const closed = ['canceled', 'refunded', 'expired', 'pending_payment'].includes(order.status)
  // O cron so libera repasse com dispute_status none|resolved_release. Depois de um
  // reembolso parcial (resolved_refund), o que sobrou para a loja sai so pelo admin.
  const manualRelease = order.dispute_status === 'resolved_refund'
    && ['shipped', 'delivered'].includes(order.status)
    && ['pending', 'blocked'].includes(order.payout_status)
    && !order.stripe_transfer_id
    && pp.payout_cents > 0

  return {
    order: {
      ...order,
      status_label: ORDER_STATUS_PT[order.status] || order.status,
      // Repasse em processamento ha 10 min+: a rodada morreu; o admin pode destravar
      releasing_stale: releasingStale(order),
      late: order.status === 'paid' && !!order.ship_by && new Date(order.ship_by) < new Date(),
      tracking_url: /^https?:\/\//i.test(order.tracking_url || '') ? order.tracking_url : null,
      label_url: /^https:\/\//i.test(order.label_url || '') ? order.label_url : null,
    },
    items: rawItems.map(it => ({ ...it, image_url: isSafeImageUrl(it.image_url) ? it.image_url : null })),
    events,
    messages,
    checkout,
    seller: seller ? { ...seller, logo_url: isSafeImageUrl(seller.logo_url) ? seller.logo_url : null } : null,
    reviews,
    refundable_cents: refundable,
    payout_preview: {
      gross_cents: (order.items_cents || 0) + (order.shipping_cents || 0),
      fee_cents: pp.fee_cents,
      label_cost_cents: order.label_cost_cents || 0,
      refunded_cents: order.refunded_cents || 0,
      payout_cents: ['released', 'reversed'].includes(order.payout_status) && order.payout_cents != null ? order.payout_cents : pp.payout_cents,
      reversed_cents: order.reversed_cents || 0,
      debt_applied_cents: order.debt_applied_cents || 0,
      release_at: manualRelease ? null : (order.release_at || (due ? due.toISOString() : null)),
      new_seller: newSeller,
      manual_release: manualRelease,
    },
    can: {
      refund: ['paid', 'shipped', 'delivered', 'completed'].includes(order.status) && refundable > 0 && order.payout_status !== 'releasing' && order.label_status !== 'purchasing',
      cancel: order.status === 'paid' && order.label_status !== 'purchasing',
      release: ['shipped', 'delivered'].includes(order.status) && !order.stripe_transfer_id && !['released', 'releasing'].includes(order.payout_status) && !activeDispute,
      // Mesmo action 'release' (force): releaseOrder confere no Stripe e grava o transfer ou destrava
      unstick_release: releasingStale(order) && !order.stripe_transfer_id,
      hold: ['pending', 'blocked'].includes(order.payout_status) && !order.stripe_transfer_id && !closed && order.status !== 'completed',
      unhold: order.payout_status === 'held',
      unlock_label: order.label_status === 'purchasing',
      resolve_dispute: ['open', 'escalated'].includes(order.dispute_status),
      message: !['pending_payment', 'expired'].includes(order.status),
    },
  }
}

async function viewReports(supabase, query) {
  const status = REPORT_STATUSES.includes(query.status) ? query.status : (query.status === 'all' ? 'all' : 'pending')
  let qb = supabase.from('bc_store_reports')
    .select('id, product_id, seller_id, reporter_user_id, reporter_email, reason, details, status, resolved_by, resolved_at, admin_notes, created_at')
    .order('created_at', { ascending: status === 'pending' })
    .limit(200)
  if (status !== 'all') qb = qb.eq('status', status)
  const reports = must(await qb, 'listar denúncias') || []

  const productIds = [...new Set(reports.map(r => r.product_id).filter(isUuid))]
  let productMap = {}
  if (productIds.length) {
    const prods = must(await supabase.from('bc_store_products').select('id, slug, title, status, images, seller_id').in('id', productIds), 'ler produtos denunciados') || []
    productMap = Object.fromEntries(prods.map(p => [p.id, p]))
  }
  const sellerMap = await sellersByIds(supabase, reports.map(r => r.seller_id || productMap[r.product_id]?.seller_id),
    'id, name, slug, status, stripe_transfers_active, vacation_mode')

  return {
    reports: reports.map(r => {
      const p = productMap[r.product_id]
      const s = sellerMap[r.seller_id || p?.seller_id]
      return {
        ...r,
        product: p ? { id: p.id, slug: p.slug, title: p.title, status: p.status, image: cleanImages(p.images)[0] || null } : null,
        // can_sell: a vitrine so mostra produto de loja que pode vender (senao /store/p/ da 404)
        seller: s ? { id: s.id, name: s.name, slug: s.slug, status: s.status, can_sell: sellerCanSell(s) } : null,
      }
    }),
    filter: { status },
  }
}

async function viewReviews(supabase, query) {
  const filter = REVIEW_FILTERS.includes(query.filter) ? query.filter : 'flagged'
  let qb = supabase.from('bc_store_reviews')
    .select('id, order_id, product_id, seller_id, rating, body, seller_reply, status, agent_status, agent_severity, agent_categories, agent_reasoning, agent_checked_at, created_at')
    .order('created_at', { ascending: false }).limit(200)
  if (filter === 'flagged') qb = qb.in('agent_status', ['flagged', 'auto_hidden'])
  else if (filter === 'hidden') qb = qb.eq('status', 'hidden')
  const reviews = must(await qb, 'listar avaliações') || []

  const productIds = [...new Set(reviews.map(r => r.product_id).filter(isUuid))]
  let productMap = {}
  if (productIds.length) {
    const prods = must(await supabase.from('bc_store_products').select('id, slug, title').in('id', productIds), 'ler produtos das avaliações') || []
    productMap = Object.fromEntries(prods.map(p => [p.id, p]))
  }
  const sellerMap = await sellersByIds(supabase, reviews.map(r => r.seller_id))
  let list = reviews.map(r => ({
    ...r,
    product: productMap[r.product_id] ? { id: r.product_id, slug: productMap[r.product_id].slug, title: productMap[r.product_id].title } : null,
    seller: sellerMap[r.seller_id] ? { id: r.seller_id, name: sellerMap[r.seller_id].name, slug: sellerMap[r.seller_id].slug } : null,
  }))
  if (filter === 'flagged') {
    list = list.map((r, i) => ({ r, i }))
      .sort((a, b) => (SEV_RANK[b.r.agent_severity] || 0) - (SEV_RANK[a.r.agent_severity] || 0) || a.i - b.i)
      .map(x => x.r)
  }
  return { reviews: list, filter }
}

async function viewStateVolume(supabase) {
  const rows = must(await supabase.from('bc_store_state_volume').select('state, transactions, orders, gross_cents, tax_cents'), 'ler o volume por estado') || []
  const states = rows
    .filter(r => r.state)
    .map(r => {
      const st = String(r.state).toUpperCase()
      const t = taxThreshold(st)
      const gross = Number(r.gross_cents) || 0
      const tx = Number(r.transactions) || 0
      let pct = null
      if (t.threshold_cents) {
        pct = (gross / t.threshold_cents) * 100
        // NY: precisa dos dois criterios, entao o mais distante manda
        if (t.transactions_threshold) pct = Math.min(pct, (tx / t.transactions_threshold) * 100)
        pct = Math.round(pct * 10) / 10
      }
      return {
        state: st, name: US_STATES[st] || st, transactions: tx, orders: Number(r.orders) || 0,
        gross_cents: gross, tax_cents: Number(r.tax_cents) || 0,
        threshold_cents: t.threshold_cents, transactions_threshold: t.transactions_threshold, pct, note: t.note,
      }
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.gross_cents - a.gross_cents)
  return { states, note: TAX_NOTE, window: '12 meses' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lojas
// ─────────────────────────────────────────────────────────────────────────────
const SELLER_RULES = {
  approve_seller: { from: ['pending', 'rejected'], to: 'approved', needReason: false },
  reject_seller: { from: ['pending'], to: 'rejected', needReason: true },
  suspend_seller: { from: ['approved'], to: 'suspended', needReason: true },
  reinstate_seller: { from: ['suspended'], to: 'approved', needReason: false },
}

async function sellerDecision(supabase, admin, action, body) {
  const rules = SELLER_RULES[action]
  const id = body.seller_id || body.id
  if (!isUuid(id)) throw httpError(400, 'seller_id inválido.')
  const reason = rules.needReason ? requireReason(body) : cleanText(body.reason, 1000)

  const before = must(await supabase.from('bc_store_sellers')
    .select('id, user_id, email, name, slug, status, stripe_transfers_active')
    .eq('id', id).maybeSingle(), 'ler a loja')
  if (!before) throw httpError(404, 'Loja não encontrada.')
  if (!rules.from.includes(before.status)) {
    throw httpError(409, `A loja está ${SELLER_STATUS_PT[before.status] || before.status}. Atualize a página.`)
  }
  if (rules.to === 'approved' && await isBanned(supabase, before.user_id)) {
    throw httpError(409, 'O dono desta loja está banido da plataforma.')
  }

  const nowIso = new Date().toISOString()
  const patch = { status: rules.to, reviewed_by: admin.actor, reviewed_at: nowIso }
  patch.rejection_reason = rules.to === 'approved' ? null : reason
  if (action === 'approve_seller' || action === 'reject_seller') patch.agent_status = 'reviewed'

  // Guarda: so atualiza se o status ainda e o que foi lido (409 se alguem mudou no meio)
  const updated = must(await supabase.from('bc_store_sellers').update(patch)
    .eq('id', id).eq('status', before.status)
    .select(SELLER_ADMIN_COLS).maybeSingle(), 'atualizar a loja')
  if (!updated) throw httpError(409, 'A loja mudou de situação enquanto você decidia. Atualize a página.')

  // Loja suspensa nao recebe: retem os repasses ainda nao feitos. Reativada: solta so o que a suspensao reteve.
  let heldOrders = 0
  let expiredCheckouts = 0
  if (action === 'suspend_seller') {
    const { data: held, error: hErr } = await supabase.from('bc_store_orders')
      .update({ payout_status: 'held', hold_reason: 'seller_suspended' })
      .eq('seller_id', id).in('payout_status', ['pending', 'blocked']).is('stripe_transfer_id', null)
      .in('status', ['paid', 'shipped', 'delivered'])
      .select('id')
    if (hErr) console.error('[admin/store] reter repasses falhou:', hErr.message)
    heldOrders = (held || []).length
    for (const o of held || []) {
      await logEvent(supabase, o.id, 'payout_held', { actor: 'admin', actor_id: admin.actor, message: 'Repasse retido: loja suspensa' })
    }
    // Carrinhos com produto desta loja ainda no Stripe Checkout: expira para ninguem pagar a loja suspensa
    expiredCheckouts = await expireOpenCheckouts(supabase, id)
  } else if (action === 'reinstate_seller') {
    const { data: freed, error: fErr } = await supabase.from('bc_store_orders')
      .update({ payout_status: 'pending', hold_reason: null })
      .eq('seller_id', id).eq('payout_status', 'held').eq('hold_reason', 'seller_suspended')
      .select('id')
    if (fErr) console.error('[admin/store] soltar repasses falhou:', fErr.message)
    for (const o of freed || []) {
      await logEvent(supabase, o.id, 'payout_unheld', { actor: 'admin', actor_id: admin.actor, message: 'Repasse volta ao prazo normal: loja reativada' })
    }
  }

  await logModeration(supabase, { target_type: 'seller', target_id: id, action, from_status: before.status, to_status: rules.to, reason, actor: admin.actor })
  await notifySellerDecision(before, action, reason, { heldOrders })

  return { ok: true, seller: sellerAdmin(updated), held_orders: heldOrders, expired_checkouts: expiredCheckouts }
}

/**
 * Expira os checkouts ainda abertos (Stripe Checkout) com pedido desta loja e devolve o
 * estoque. Se a sessao ja foi paga, nao mexe: o markCheckoutPaid retem o repasse da loja
 * suspensa (hold_reason 'seller_suspended') e avisa o admin.
 */
async function expireOpenCheckouts(supabase, sellerId) {
  const { data: pend, error } = await supabase.from('bc_store_orders')
    .select('checkout_id').eq('seller_id', sellerId).eq('status', 'pending_payment').limit(200)
  if (error) { console.error('[admin/store] pedidos aguardando pagamento:', error.message); return 0 }
  const ids = [...new Set((pend || []).map(o => o.checkout_id).filter(isUuid))]
  if (!ids.length) return 0
  const { data: cos, error: cErr } = await supabase.from('bc_store_checkouts')
    .select('id, stripe_session_id').in('id', ids).eq('status', 'pending')
  if (cErr) { console.error('[admin/store] checkouts abertos:', cErr.message); return 0 }
  const stripe = await getStripe()
  let n = 0
  for (const co of cos || []) {
    try {
      if (co.stripe_session_id) {
        if (!stripe) continue
        let s = null
        try {
          s = await stripe.checkout.sessions.expire(co.stripe_session_id)
        } catch (e) {
          try {
            s = await stripe.checkout.sessions.retrieve(co.stripe_session_id)
          } catch (e2) {
            // Sessao inexistente (outra conta/modo): nunca vai ser paga
            if (e2?.code === 'resource_missing' || e2?.statusCode === 404) s = { status: 'expired' }
            else throw e2
          }
        }
        if (!s || s.status !== 'expired') continue // paga no meio: o webhook resolve
      }
      const r = await expireCheckout(supabase, co.id, { reason: 'canceled' })
      if (r?.ok && !r.skipped) n++
    } catch (e) {
      console.error('[admin/store] expirar checkout', co.id, e.message)
    }
  }
  return n
}

/**
 * Dono banido (api/admin/user-action 'ban' ou moderation-action 'ban_user'):
 * suspende a loja aprovada com o mesmo efeito de suspend_seller (repasses retidos com
 * 'seller_suspended', checkouts abertos expirados, aviso a loja). Sem loja: nada.
 */
export async function suspendStoreOfBannedUser(supabase, userId, { actor = 'admin', reason = null } = {}) {
  if (!isUuid(userId)) return { ok: true, skipped: 'usuário inválido' }
  const { data: s, error } = await supabase.from('bc_store_sellers').select('id, status').eq('user_id', userId).maybeSingle()
  if (error) {
    if (tableMissing(error)) return { ok: true, skipped: 'Store não instalada' }
    throw dbError(error, 'ler a loja do usuário')
  }
  if (!s) return { ok: true, skipped: 'sem loja' }
  if (s.status !== 'approved') return { ok: true, skipped: 'loja ' + (SELLER_STATUS_PT[s.status] || s.status) }
  const why = cleanText(reason, 900) || 'Conta do dono banida da plataforma'
  const r = await sellerDecision(supabase, { actor }, 'suspend_seller', { seller_id: s.id, reason: why.length >= 3 ? why : 'Conta do dono banida da plataforma' })
  return { ok: true, seller_id: s.id, suspended: true, held_orders: r.held_orders, expired_checkouts: r.expired_checkouts }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alteracoes de loja aprovada (nome/logo/capa) esperando o admin
// ─────────────────────────────────────────────────────────────────────────────
async function shopChangesDecision(supabase, admin, action, body) {
  const id = body.seller_id || body.id
  if (!isUuid(id)) throw httpError(400, 'seller_id inválido.')
  const approve = action === 'approve_shop_changes'
  const reason = approve ? cleanText(body.reason, 1000) : requireReason(body, 'Escreva o motivo da recusa (ele vai para a loja).')

  const before = must(await supabase.from('bc_store_sellers')
    .select('id, user_id, email, name, slug, status, pending_changes, pending_changes_at')
    .eq('id', id).maybeSingle(), 'ler a loja')
  if (!before) throw httpError(404, 'Loja não encontrada.')
  if (!before.pending_changes) throw httpError(409, 'Esta loja não tem alterações esperando aprovação. Atualize a página.')
  // A loja mandou outra versao depois que o admin abriu a tela
  if (body.pending_changes_at && before.pending_changes_at && new Date(body.pending_changes_at).getTime() !== new Date(before.pending_changes_at).getTime()) {
    throw httpError(409, 'A loja mandou novas alterações enquanto você analisava. Atualize a página.')
  }
  const changes = cleanPendingChanges(before.pending_changes) || {}
  const patch = { pending_changes: null, pending_changes_at: null, reviewed_by: admin.actor, reviewed_at: new Date().toISOString() }
  if (approve) {
    if (changes.name !== undefined && (!changes.name || changes.name.length < 2)) throw httpError(409, 'O nome novo da loja é inválido. Recuse as alterações.')
    Object.assign(patch, changes)
  }

  let q = supabase.from('bc_store_sellers').update(patch).eq('id', id).not('pending_changes', 'is', null)
  q = before.pending_changes_at ? q.eq('pending_changes_at', before.pending_changes_at) : q.is('pending_changes_at', null)
  const updated = must(await q.select(SELLER_ADMIN_COLS).maybeSingle(), 'salvar as alterações da loja')
  if (!updated) throw httpError(409, 'As alterações da loja mudaram enquanto você decidia. Atualize a página.')

  const fields = Object.keys(changes).map(k => ({ name: 'nome', logo_url: 'logo', banner_url: 'capa', tagline: 'frase', bio: 'sobre' }[k] || k))
  await logModeration(supabase, {
    target_type: 'seller', target_id: id, action,
    from_status: before.status, to_status: before.status,
    reason: ((approve ? 'Aplicadas: ' : 'Recusadas: ') + (fields.join(', ') || '—') + (reason ? ' · ' + reason : '')).slice(0, 1000),
    actor: admin.actor,
  })
  const title = approve ? 'Alterações da loja aprovadas' : 'Alterações da loja não aprovadas'
  const what = fields.join(', ') || 'dados da loja'
  await notify({
    user_id: before.user_id, email: before.email, type: approve ? 'store_shop_changes_approved' : 'store_shop_changes_rejected', icon: approve ? '✅' : '⚠️',
    title,
    body: approve ? `As mudanças (${what}) já aparecem na sua loja.` : `As mudanças (${what}) não foram aprovadas. Motivo: ${reason}`,
    url: '/store/painel?aba=loja', metadata: { seller_id: id },
    mail: {
      subject: title, title,
      paragraphs: approve
        ? [`As mudanças da loja <strong>${esc(before.name)}</strong> (${esc(what)}) foram aprovadas e já aparecem na Store.`]
        : [
            `As mudanças da loja <strong>${esc(before.name)}</strong> (${esc(what)}) não foram aprovadas. A loja continua com os dados anteriores.`,
            `<strong>Motivo:</strong> ${esc(reason)}`,
            'Corrija e envie de novo pelo painel.',
          ],
      ctaUrl: APP_URL + '/store/painel?aba=loja', ctaLabel: 'Abrir o painel',
    },
  })
  return { ok: true, seller: sellerAdmin(updated) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Debito da loja (estorno de repasse que o Stripe recusou)
// ─────────────────────────────────────────────────────────────────────────────
async function clearSellerDebt(supabase, admin, body) {
  const id = body.seller_id || body.id
  if (!isUuid(id)) throw httpError(400, 'seller_id inválido.')
  const reason = requireReason(body, 'Escreva o motivo (ex.: a loja pagou por fora, perdão do valor).')
  const before = must(await supabase.from('bc_store_sellers').select('id, name, debt_cents').eq('id', id).maybeSingle(), 'ler a loja')
  if (!before) throw httpError(404, 'Loja não encontrada.')
  const cur = before.debt_cents || 0
  if (cur <= 0) throw httpError(409, 'Esta loja não tem débito.')
  const updated = must(await supabase.from('bc_store_sellers').update({ debt_cents: 0 })
    .eq('id', id).eq('debt_cents', cur).select('id, debt_cents').maybeSingle(), 'zerar o débito')
  if (!updated) throw httpError(409, 'O débito da loja mudou (um repasse pode ter abatido parte). Atualize a página.')
  await logModeration(supabase, {
    target_type: 'seller', target_id: id, action: 'clear_seller_debt',
    from_status: String(cur), to_status: '0', reason: `${fmtUSD(cur)} · ${reason}`, actor: admin.actor,
  })
  return { ok: true, cleared_cents: cur }
}

async function notifySellerDecision(seller, action, reason, { heldOrders = 0 } = {}) {
  const name = seller.name || 'sua loja'
  let n
  if (action === 'approve_seller') {
    n = {
      type: 'store_seller_approved', icon: '✅',
      title: 'Sua loja foi aprovada na BrasilConnect Store',
      body: 'Próximos passos: ative os recebimentos no Stripe, cadastre as regiões de entrega e envie seus produtos para análise.',
      url: '/store/painel',
      paragraphs: [
        `A loja <strong>${esc(name)}</strong> foi aprovada. Faltam três passos para começar a vender:`,
        seller.stripe_transfers_active
          ? '<strong>1. Recebimentos:</strong> sua conta Stripe já está ativa.'
          : '<strong>1. Ative os recebimentos.</strong> No painel, abra Recebimentos e faça o cadastro no Stripe. Sem isso seus produtos não aparecem na vitrine.',
        '<strong>2. Cadastre as regiões de entrega.</strong> Diga para quais estados você envia, se faz entrega local ou retirada, e quanto cobra de frete.',
        '<strong>3. Envie seus produtos.</strong> Cada produto passa por uma análise rápida antes de aparecer na Store.',
      ],
      ctaLabel: 'Abrir o painel da loja',
    }
  } else if (action === 'reject_seller') {
    n = {
      type: 'store_seller_rejected', icon: '⚠️',
      title: 'Sua loja ainda não foi aprovada',
      body: `Motivo: ${reason}. Corrija e envie o cadastro de novo.`,
      url: '/store/vender',
      paragraphs: [
        `Analisamos o cadastro da loja <strong>${esc(name)}</strong> e ainda não deu para aprovar.`,
        `<strong>Motivo:</strong> ${esc(reason)}`,
        'Corrija o que foi apontado e envie o cadastro de novo pelo mesmo formulário. A gente analisa outra vez.',
      ],
      ctaLabel: 'Corrigir o cadastro',
    }
  } else if (action === 'suspend_seller') {
    n = {
      type: 'store_seller_suspended', icon: '⛔',
      title: 'Sua loja foi suspensa na BrasilConnect Store',
      body: `Motivo: ${reason}. Seus produtos saíram da vitrine.`,
      url: '/store/painel',
      paragraphs: [
        `A loja <strong>${esc(name)}</strong> foi suspensa e seus produtos saíram da vitrine.`,
        `<strong>Motivo:</strong> ${esc(reason)}`,
        heldOrders ? `Os repasses de ${heldOrders} pedido(s) em aberto ficam retidos até a análise.` : '',
        'Para resolver, responda este e-mail ou escreva para oi@brasilconnectusa.com.',
      ].filter(Boolean),
      ctaLabel: 'Abrir o painel da loja',
    }
  } else {
    n = {
      type: 'store_seller_reinstated', icon: '✅',
      title: 'Sua loja foi reativada',
      body: 'Seus produtos aprovados voltam para a vitrine.',
      url: '/store/painel',
      paragraphs: [
        `A loja <strong>${esc(name)}</strong> foi reativada. Os produtos aprovados voltam para a vitrine.`,
        seller.stripe_transfers_active ? '' : 'Confira no painel se os recebimentos (Stripe) estão ativos. Sem isso os produtos não aparecem.',
      ].filter(Boolean),
      ctaLabel: 'Abrir o painel da loja',
    }
  }
  await notify({
    user_id: seller.user_id, email: seller.email, type: n.type, icon: n.icon,
    title: n.title, body: n.body, url: n.url, metadata: { seller_id: seller.id },
    mail: { subject: n.title, title: n.title, paragraphs: n.paragraphs, ctaUrl: APP_URL + n.url, ctaLabel: n.ctaLabel },
  })
}

async function setSellerFee(supabase, admin, body) {
  const id = body.seller_id || body.id
  if (!isUuid(id)) throw httpError(400, 'seller_id inválido.')
  if (body.fee_bps_override === undefined) throw httpError(400, 'Informe fee_bps_override (0 a 5000) ou null para usar a comissão padrão.')
  let fee = null
  if (body.fee_bps_override !== null && body.fee_bps_override !== '') {
    fee = toInt(body.fee_bps_override)
    if (!Number.isInteger(fee) || fee < 0 || fee > 5000) throw httpError(400, 'A comissão especial vai de 0 a 5000 (0% a 50%).')
  }
  const before = must(await supabase.from('bc_store_sellers').select('id, fee_bps_override').eq('id', id).maybeSingle(), 'ler a loja')
  if (!before) throw httpError(404, 'Loja não encontrada.')
  const updated = must(await supabase.from('bc_store_sellers').update({ fee_bps_override: fee })
    .eq('id', id).select('id, name, fee_bps_override').maybeSingle(), 'salvar a comissão')
  if (!updated) throw httpError(409, 'A loja mudou. Atualize a página.')
  await logModeration(supabase, {
    target_type: 'seller', target_id: id, action: 'set_seller_fee',
    from_status: before.fee_bps_override == null ? 'padrao' : String(before.fee_bps_override),
    to_status: fee == null ? 'padrao' : String(fee),
    reason: cleanText(body.reason, 500), actor: admin.actor,
  })
  return { ok: true, seller: updated, config: await readConfig(supabase) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Produtos
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCT_RULES = {
  approve_product: { from: ['pending_review', 'rejected', 'suspended'], to: 'approved', needReason: false },
  reject_product: { from: ['pending_review'], to: 'rejected', needReason: true },
  suspend_product: { from: ['approved', 'paused'], to: 'suspended', needReason: true },
}

async function productDecision(supabase, admin, action, body) {
  const rules = PRODUCT_RULES[action]
  const id = body.product_id || body.id
  if (!isUuid(id)) throw httpError(400, 'product_id inválido.')
  const reason = rules.needReason ? requireReason(body) : cleanText(body.reason, 1000)

  const before = must(await supabase.from('bc_store_products')
    .select('id, seller_id, slug, title, status, published_at')
    .eq('id', id).maybeSingle(), 'ler o produto')
  if (!before) throw httpError(404, 'Produto não encontrado.')
  if (!rules.from.includes(before.status)) {
    throw httpError(409, `O produto está ${PRODUCT_STATUS_PT[before.status] || before.status}. Atualize a página.`)
  }
  const seller = must(await supabase.from('bc_store_sellers')
    .select('id, user_id, email, name, slug, status, stripe_transfers_active, vacation_mode')
    .eq('id', before.seller_id).maybeSingle(), 'ler a loja do produto')
  if (rules.to === 'approved' && seller?.status !== 'approved') throw httpError(409, 'Aprove a loja antes.')
  if (rules.to === 'approved' && await isBanned(supabase, seller.user_id)) {
    throw httpError(409, 'O dono desta loja está banido da plataforma.')
  }

  const nowIso = new Date().toISOString()
  const patch = { status: rules.to, reviewed_by: admin.actor, reviewed_at: nowIso }
  if (rules.to === 'approved') {
    patch.rejection_reason = null
    patch.agent_status = 'reviewed'
    if (!before.published_at) patch.published_at = nowIso
  } else {
    patch.rejection_reason = reason
    if (action === 'reject_product') patch.agent_status = 'reviewed'
  }

  const res = await supabase.from('bc_store_products').update(patch)
    .eq('id', id).eq('status', before.status)
    .select(PRODUCT_ADMIN_COLS).maybeSingle()
  if (res.error && res.error.code === '23514') {
    throw httpError(409, 'O produto precisa de pelo menos 1 foto e de uma descrição com 80 caracteres ou mais.')
  }
  const updated = must(res, 'atualizar o produto')
  if (!updated) throw httpError(409, 'O produto mudou de situação enquanto você decidia. Atualize a página.')

  await logModeration(supabase, { target_type: 'product', target_id: id, action, from_status: before.status, to_status: rules.to, reason, actor: admin.actor })
  if (seller) await notifyProductDecision(seller, before, action, reason)

  return { ok: true, product: productAdmin(updated, seller, null) }
}

async function notifyProductDecision(seller, product, action, reason) {
  const title = product.title || 'Seu produto'
  const productUrl = '/store/p/' + encodeURIComponent(product.slug || '')
  let n
  if (action === 'approve_product') {
    const canSell = sellerCanSell(seller)
    const extra = canSell
      ? 'Já está à venda na Store. Compartilhe o link com seus clientes.'
      : !seller.stripe_transfers_active
        ? 'Para ele aparecer na vitrine, ative os recebimentos no Stripe pelo painel (aba Recebimentos).'
        : 'Sua loja está em modo férias. Desligue no painel para voltar a vender.'
    // Loja que ainda nao vende: /store/p/<slug> daria 404, entao o link vai para o painel
    n = {
      type: 'store_product_approved', icon: '✅',
      title: `Produto aprovado: ${title}`,
      body: canSell ? 'Já está à venda na Store.' : extra,
      url: canSell ? productUrl : (!seller.stripe_transfers_active ? '/store/painel?aba=recebimentos' : '/store/painel?aba=loja'),
      paragraphs: [`<strong>${esc(title)}</strong> foi aprovado.`, esc(extra)],
      ctaLabel: canSell ? 'Ver o produto' : (!seller.stripe_transfers_active ? 'Ativar recebimentos' : 'Abrir o painel'),
    }
  } else if (action === 'reject_product') {
    n = {
      type: 'store_product_rejected', icon: '⚠️',
      title: `Produto não aprovado: ${title}`,
      body: `Motivo: ${reason}. Corrija no painel e envie de novo.`,
      url: '/store/painel?aba=produtos',
      paragraphs: [
        `Analisamos <strong>${esc(title)}</strong> e ainda não deu para aprovar.`,
        `<strong>Motivo:</strong> ${esc(reason)}`,
        'Para corrigir: abra o painel da loja, edite o produto (fotos, descrição, categoria ou dados de conformidade) e envie para análise de novo.',
      ],
      ctaLabel: 'Corrigir no painel',
    }
  } else {
    n = {
      type: 'store_product_suspended', icon: '⛔',
      title: `Produto suspenso: ${title}`,
      body: `Motivo: ${reason}. Ele saiu da vitrine.`,
      url: '/store/painel?aba=produtos',
      paragraphs: [
        `<strong>${esc(title)}</strong> foi suspenso e saiu da vitrine.`,
        `<strong>Motivo:</strong> ${esc(reason)}`,
        'Se achar que foi engano ou se já corrigiu o problema, responda este e-mail.',
      ],
      ctaLabel: 'Abrir o painel',
    }
  }
  await notify({
    user_id: seller.user_id, email: seller.email, type: n.type, icon: n.icon,
    title: n.title, body: n.body, url: n.url, metadata: { product_id: product.id },
    mail: { subject: n.title, title: n.title, paragraphs: n.paragraphs, ctaUrl: APP_URL + n.url, ctaLabel: n.ctaLabel },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Denuncias
// ─────────────────────────────────────────────────────────────────────────────
async function reportDecision(supabase, admin, action, body) {
  const id = body.report_id || body.id
  if (!isUuid(id)) throw httpError(400, 'report_id inválido.')
  const suspend = action === 'resolve_report' && toBool(body.suspend_product) === true
  const reason = suspend ? requireReason(body, 'Escreva o motivo da suspensão (ele vai para a loja).') : cleanText(body.reason, 1000)

  const before = must(await supabase.from('bc_store_reports')
    .select('id, product_id, seller_id, reporter_user_id, reporter_email, status')
    .eq('id', id).maybeSingle(), 'ler a denúncia')
  if (!before) throw httpError(404, 'Denúncia não encontrada.')
  if (before.status !== 'pending') throw httpError(409, 'Essa denúncia já foi analisada. Atualize a página.')

  const to = action === 'resolve_report' ? 'resolved' : 'dismissed'
  const updated = must(await supabase.from('bc_store_reports')
    .update({ status: to, resolved_by: admin.actor, resolved_at: new Date().toISOString(), admin_notes: reason })
    .eq('id', id).eq('status', 'pending').select('id').maybeSingle(), 'atualizar a denúncia')
  if (!updated) throw httpError(409, 'Essa denúncia já foi analisada. Atualize a página.')

  await logModeration(supabase, { target_type: 'report', target_id: id, action, from_status: 'pending', to_status: to, reason, actor: admin.actor })

  // Suspender o produto junto (so se ainda estiver a venda ou pausado)
  let productSuspended = false
  let productNote = null
  if (suspend && isUuid(before.product_id)) {
    try {
      await productDecision(supabase, admin, 'suspend_product', { product_id: before.product_id, reason })
      productSuspended = true
    } catch (e) {
      productNote = e.expose ? e.message : 'Não deu para suspender o produto.'
    }
  }

  if (before.reporter_user_id || before.reporter_email) {
    const title = 'Sua denúncia na Store foi analisada'
    const body = to === 'resolved'
      ? 'Tomamos as providências necessárias. Obrigado por ajudar a manter a Store segura.'
      : 'Analisamos o anúncio e não encontramos problema contra as regras. Obrigado por avisar.'
    await notify({
      user_id: before.reporter_user_id || null, email: before.reporter_email || null,
      type: 'store_report_reviewed', icon: '🛡️', title, body, url: '/store', metadata: { report_id: id },
      mail: { subject: title, title, paragraphs: [esc(body)], ctaUrl: APP_URL + '/store', ctaLabel: 'Abrir a Store' },
    })
  }

  return { ok: true, product_suspended: productSuspended, product_note: productNote }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pedidos
// ─────────────────────────────────────────────────────────────────────────────
async function orderAction(supabase, admin, action, body) {
  const id = body.order_id || body.id
  if (!isUuid(id)) throw httpError(400, 'order_id inválido.')
  const order = await loadOrder(supabase, id)
  if (!order) throw httpError(404, 'Pedido não encontrado.')
  const refundable = Math.max(0, (order.total_cents || 0) - (order.refunded_cents || 0))
  const actorOpts = { actor_id: admin.actor }

  if (action === 'refund') {
    const reason = requireReason(body, 'Escreva o motivo do reembolso (ele vai para o comprador e a loja).')
    const stripe = await needStripe()
    const amount = body.amount_cents === undefined || body.amount_cents === null || body.amount_cents === '' ? refundable : toInt(body.amount_cents)
    if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, 'Valor do reembolso inválido.')
    if (amount > refundable) throw httpError(400, `O máximo reembolsável é ${fmtUSD(refundable)}.`)
    const r = await refundOrder(supabase, stripe, order, { amount_cents: amount, reason, actor: 'admin', ...actorOpts })
    if (!r.ok) throw opError(r)
    // Reembolso total de pedido ainda nao enviado vira cancelamento (storeOrders.refundOrder -> cancelOrder)
    const toStatus = r.canceled ? 'canceled' : (r.full && order.status !== 'paid' ? 'refunded' : order.status)
    await logModeration(supabase, { target_type: 'order', target_id: id, action: 'refund', from_status: order.status, to_status: toStatus, reason: `${fmtUSD(r.refunded_cents)} · ${reason}`, actor: admin.actor })
    return {
      ok: true, refunded_cents: r.refunded_cents, canceled: !!r.canceled, full: !!r.full,
      reversed_cents: r.reversed_cents || 0, debt_cents: r.debt_cents || 0,
    }
  }

  if (action === 'unlock_label') {
    if (order.label_status !== 'purchasing') throw httpError(409, 'A etiqueta deste pedido não está em processamento. Atualize a página.')
    // Compra em andamento agora (a funcao da loja dura ate 60s): espera um pouco
    const lockedAt = new Date(order.label_locked_at || order.updated_at || 0).getTime()
    if (Date.now() - lockedAt < 2 * 60_000) throw httpError(409, 'A compra da etiqueta começou há menos de 2 minutos. Espere e tente de novo.')
    let r
    try {
      r = await reconcileLabel(supabase, order, { actor: 'admin', actor_id: admin.actor })
    } catch (e) {
      throw httpError(502, 'Não deu para conferir a etiqueta na Shippo: ' + e.message)
    }
    if (r.result === 'skipped') throw httpError(409, r.message)
    await logModeration(supabase, { target_type: 'order', target_id: id, action: 'unlock_label', from_status: 'purchasing', to_status: r.result, reason: r.message, actor: admin.actor })
    return { ok: true, result: r.result, message: r.message }
  }

  if (action === 'cancel_order') {
    const reason = requireReason(body, 'Escreva o motivo do cancelamento (ele vai para o comprador e a loja).')
    const stripe = await needStripe()
    const r = await cancelOrder(supabase, stripe, order, { by: 'admin', reason, ...actorOpts })
    if (!r.ok) throw opError(r)
    await logModeration(supabase, { target_type: 'order', target_id: id, action: 'cancel_order', from_status: order.status, to_status: 'canceled', reason, actor: admin.actor })
    return { ok: true, refunded_cents: r.refunded_cents }
  }

  if (action === 'release') {
    // Repasse em processamento agora (outra funcao fazendo o transfer): nao mexe. Travado
    // ha 10 min+ (a rodada morreu): releaseOrder com force confere no Stripe e grava o
    // transfer, ou destrava e repassa.
    if (order.payout_status === 'releasing' && !releasingStale(order)) {
      throw httpError(409, 'O repasse deste pedido está sendo processado agora. Se continuar assim, espere 10 minutos e use "Destravar repasse".')
    }
    const stripe = await needStripe()
    const wasStuck = order.payout_status === 'releasing'
    const r = await releaseOrder(supabase, stripe, order, { actor: 'admin', force: true, ...actorOpts })
    if (!r.ok) {
      // Destravou (o transfer nao tinha saido), mas o repasse nao pode sair agora
      if (wasStuck) {
        const now = must(await supabase.from('bc_store_orders').select('payout_status').eq('id', id).maybeSingle(), 'ler o pedido')
        if (now && now.payout_status !== 'releasing') {
          await logModeration(supabase, { target_type: 'order', target_id: id, action: 'release', from_status: 'releasing', to_status: now.payout_status, reason: ('Destravado: ' + (r.error || '')).slice(0, 500), actor: admin.actor })
          return { ok: true, unlocked: true, payout_status: now.payout_status, message: `Repasse destravado (o transfer não tinha saído), mas não saiu agora: ${r.error || 'tente de novo.'}` }
        }
      }
      throw opError(r)
    }
    if (!r.already) {
      await logModeration(supabase, { target_type: 'order', target_id: id, action: 'release', from_status: order.payout_status, to_status: r.payout_cents > 0 ? 'released' : 'none', reason: cleanText(body.reason, 500) || (wasStuck ? 'Destravar repasse' : null), actor: admin.actor })
    }
    return { ok: true, already: !!r.already, recovered: !!r.recovered, payout_cents: r.payout_cents ?? null }
  }

  if (action === 'hold') {
    const reason = requireReason(body, 'Escreva o motivo da retenção (ele vai para a loja).')
    const updated = must(await supabase.from('bc_store_orders')
      .update({ payout_status: 'held', hold_reason: ('admin: ' + reason).slice(0, 500) })
      .eq('id', id).in('payout_status', ['pending', 'blocked']).is('stripe_transfer_id', null)
      .in('status', ['paid', 'shipped', 'delivered'])
      .select('id').maybeSingle(), 'reter o repasse')
    if (!updated) throw httpError(409, 'O repasse deste pedido não pode ser retido agora (já saiu, já está retido ou o pedido foi encerrado).')
    await logEvent(supabase, id, 'payout_held', { actor: 'admin', ...actorOpts, message: 'Repasse retido pela BrasilConnect: ' + reason })
    await logModeration(supabase, { target_type: 'order', target_id: id, action: 'hold', from_status: order.payout_status, to_status: 'held', reason, actor: admin.actor })
    await notifyOrderParties(supabase, order, {
      type: 'store_payout_held', icon: '⏸️', skipBuyer: true,
      sellerTitle: `Repasse do pedido #${order.order_number} retido`,
      sellerBody: 'A BrasilConnect reteve o repasse deste pedido para análise. Responda pela página do pedido se precisar.',
      reason,
    })
    return { ok: true }
  }

  if (action === 'unhold') {
    const updated = must(await supabase.from('bc_store_orders')
      .update({ payout_status: 'pending', hold_reason: null })
      .eq('id', id).eq('payout_status', 'held')
      .select('id').maybeSingle(), 'soltar o repasse')
    if (!updated) throw httpError(409, 'O repasse deste pedido não está retido. Atualize a página.')
    await logEvent(supabase, id, 'payout_unheld', { actor: 'admin', ...actorOpts, message: 'Retenção removida: o repasse segue o prazo normal' })
    await logModeration(supabase, { target_type: 'order', target_id: id, action: 'unhold', from_status: 'held', to_status: 'pending', reason: cleanText(body.reason, 500), actor: admin.actor })
    await notifyOrderParties(supabase, order, {
      type: 'store_payout_unheld', icon: '▶️', skipBuyer: true,
      sellerTitle: `Repasse do pedido #${order.order_number} liberado`,
      sellerBody: 'A retenção foi removida. O repasse segue o prazo normal.',
    })
    return { ok: true }
  }

  if (action === 'resolve_dispute') {
    const decision = body.decision
    if (decision !== 'refund' && decision !== 'release') throw httpError(400, 'decision deve ser refund ou release.')
    const reason = requireReason(body, 'Explique a decisão (ela vai para o comprador e a loja).')
    if (!['open', 'escalated'].includes(order.dispute_status)) throw httpError(409, 'Este pedido não tem problema em aberto. Atualize a página.')

    let amount = 0
    let stripe = null
    if (decision === 'refund') {
      stripe = await needStripe()
      amount = body.amount_cents === undefined || body.amount_cents === null || body.amount_cents === '' ? refundable : toInt(body.amount_cents)
      if (!Number.isInteger(amount) || amount < 0) throw httpError(400, 'Valor do reembolso inválido.')
      if (amount > refundable) throw httpError(400, `O máximo reembolsável é ${fmtUSD(refundable)}.`)
    }

    const prev = order.dispute_status
    const to = decision === 'refund' ? 'resolved_refund' : 'resolved_release'
    const nowIso = new Date().toISOString()
    // Trava: so uma decisao passa
    const claimed = must(await supabase.from('bc_store_orders')
      .update({ dispute_status: to, dispute_resolved_at: nowIso, dispute_resolution: reason })
      .eq('id', id).eq('dispute_status', prev)
      .select('id').maybeSingle(), 'resolver o problema')
    if (!claimed) throw httpError(409, 'O problema deste pedido mudou de situação. Atualize a página.')

    if (decision === 'refund' && amount > 0) {
      const r = await refundOrder(supabase, stripe, { ...order, dispute_status: to }, { amount_cents: amount, reason, actor: 'admin', ...actorOpts })
      if (!r.ok) {
        // Desfaz a trava para tentar de novo
        await supabase.from('bc_store_orders').update({ dispute_status: prev, dispute_resolved_at: null, dispute_resolution: null }).eq('id', id).eq('dispute_status', to)
        throw opError(r)
      }
    }
    if (decision === 'release') {
      const { error: uErr } = await supabase.from('bc_store_orders').update({ payout_status: 'pending', hold_reason: null }).eq('id', id).eq('payout_status', 'held')
      if (uErr) console.error('[admin/store] soltar repasse da disputa:', uErr.message)
    }

    await logEvent(supabase, id, 'dispute_resolved', {
      actor: 'admin', ...actorOpts,
      message: decision === 'refund' ? `Problema resolvido pela BrasilConnect: reembolso de ${fmtUSD(amount)}` : 'Problema resolvido pela BrasilConnect: valor fica com a loja',
      data: { decision, amount_cents: amount },
    })
    await logModeration(supabase, { target_type: 'order', target_id: id, action: 'resolve_dispute', from_status: prev, to_status: to, reason, actor: admin.actor })
    await notifyOrderParties(supabase, order, {
      type: 'store_dispute_resolved', icon: '⚖️',
      buyerTitle: `Problema resolvido · pedido #${order.order_number}`,
      buyerBody: decision === 'refund'
        ? (amount > 0 ? `A BrasilConnect decidiu a seu favor: reembolso de ${fmtUSD(amount)}.` : 'A BrasilConnect decidiu a seu favor.')
        : 'A BrasilConnect analisou o caso e decidiu que o valor fica com a loja.',
      sellerTitle: `Problema resolvido · pedido #${order.order_number}`,
      sellerBody: decision === 'refund'
        ? (amount > 0 ? `A BrasilConnect decidiu pelo reembolso de ${fmtUSD(amount)} ao comprador.` : 'A BrasilConnect decidiu a favor do comprador.')
        : 'A BrasilConnect decidiu a seu favor. O repasse segue o prazo normal.',
      reason,
    })
    return { ok: true, dispute_status: to, refunded_cents: amount }
  }

  if (action === 'message') {
    const text = cleanText(body.body ?? body.message, 2000)
    if (!text) throw httpError(400, 'Escreva a mensagem.')
    const message = must(await supabase.from('bc_store_messages')
      .insert({ order_id: id, sender_role: 'admin', sender_user_id: isUuid(admin.user_id) ? admin.user_id : null, body: text })
      .select('id, sender_role, body, created_at').single(), 'enviar a mensagem')
    const { error: lmErr } = await supabase.from('bc_store_orders').update({ last_message_at: message.created_at || new Date().toISOString() }).eq('id', id)
    if (lmErr) console.error('[admin/store] last_message_at:', lmErr.message)
    const excerpt = text.length > 160 ? text.slice(0, 157) + '...' : text
    await notifyOrderParties(supabase, order, {
      type: 'store_order_message', icon: '💬',
      buyerTitle: `Mensagem da BrasilConnect · pedido #${order.order_number}`, buyerBody: excerpt,
      sellerTitle: `Mensagem da BrasilConnect · pedido #${order.order_number}`, sellerBody: excerpt,
    })
    return { ok: true, message }
  }

  throw httpError(400, 'Ação desconhecida.')
}

async function hideReview(supabase, admin, body) {
  const id = body.review_id || body.id
  if (!isUuid(id)) throw httpError(400, 'review_id inválido.')
  const before = must(await supabase.from('bc_store_reviews').select('id, order_id, product_id, seller_id, status').eq('id', id).maybeSingle(), 'ler a avaliação')
  if (!before) throw httpError(404, 'Avaliação não encontrada.')
  // Avaliacao escondida pela IA (ja 'hidden'): so confirma a decisao e tira da fila
  if (before.status === 'hidden') {
    must(await supabase.from('bc_store_reviews').update({ agent_status: 'reviewed' }).eq('id', id).eq('status', 'hidden'), 'confirmar a avaliação oculta')
    await logModeration(supabase, { target_type: 'review', target_id: id, action: 'hide_review', from_status: 'hidden', to_status: 'hidden', reason: cleanText(body.reason, 500), actor: admin.actor })
    return { ok: true, already: true }
  }
  const updated = must(await supabase.from('bc_store_reviews').update({ status: 'hidden', agent_status: 'reviewed' })
    .eq('id', id).eq('status', 'visible').select('id').maybeSingle(), 'ocultar a avaliação')
  if (!updated) throw httpError(409, 'Essa avaliação já está oculta.')
  await recalcRatings(supabase, { product_id: before.product_id, seller_id: before.seller_id })
  await logModeration(supabase, { target_type: 'review', target_id: id, action: 'hide_review', from_status: 'visible', to_status: 'hidden', reason: cleanText(body.reason, 500), actor: admin.actor })
  return { ok: true }
}

async function showReview(supabase, admin, body) {
  const id = body.review_id || body.id
  if (!isUuid(id)) throw httpError(400, 'review_id inválido.')
  const before = must(await supabase.from('bc_store_reviews').select('id, order_id, product_id, seller_id, status, agent_status').eq('id', id).maybeSingle(), 'ler a avaliação')
  if (!before) throw httpError(404, 'Avaliação não encontrada.')
  // Visivel e sinalizada pela IA: o admin confirma que pode ficar
  if (before.status === 'visible') {
    must(await supabase.from('bc_store_reviews').update({ agent_status: 'reviewed' }).eq('id', id).eq('status', 'visible'), 'confirmar a avaliação')
    await logModeration(supabase, { target_type: 'review', target_id: id, action: 'show_review', from_status: 'visible', to_status: 'visible', reason: cleanText(body.reason, 500), actor: admin.actor })
    return { ok: true, already: true }
  }
  const updated = must(await supabase.from('bc_store_reviews').update({ status: 'visible', agent_status: 'reviewed' })
    .eq('id', id).eq('status', 'hidden').select('id').maybeSingle(), 'mostrar a avaliação')
  if (!updated) throw httpError(409, 'Essa avaliação já está visível.')
  await recalcRatings(supabase, { product_id: before.product_id, seller_id: before.seller_id })
  await logModeration(supabase, { target_type: 'review', target_id: id, action: 'show_review', from_status: 'hidden', to_status: 'visible', reason: cleanText(body.reason, 500), actor: admin.actor })
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuracao (mesmas faixas das CHECK do schema)
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG_BOOLS = ['public_enabled', 'checkout_enabled', 'fee_on_shipping', 'tax_enabled']
const CONFIG_INTS = {
  fee_bps: [0, 5000],
  fee_fixed_cents: [0, 2147483647],
  release_days_after_delivery: [0, 60],
  release_days_new_seller: [0, 60],
  new_seller_orders: [0, 2147483647],
  safety_release_days: [7, 120],
  local_release_days: [0, 60],
  auto_cancel_grace_days: [0, 30],
  dispute_window_days: [1, 120],
  seller_response_days: [1, 14],
  checkout_expires_minutes: [30, 1440],
}

async function saveConfig(supabase, admin, body) {
  const patch = {}
  for (const k of CONFIG_BOOLS) {
    if (body[k] === undefined) continue
    const v = toBool(body[k])
    if (v === undefined) throw httpError(400, `Valor inválido em ${k}.`)
    patch[k] = v
  }
  for (const [k, [min, max]] of Object.entries(CONFIG_INTS)) {
    if (body[k] === undefined) continue
    const v = toInt(body[k])
    if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${k} precisa ser um número inteiro de ${min} a ${max}.`)
    patch[k] = v
  }
  if (body.agreement_version !== undefined) {
    const v = String(body.agreement_version || '').trim()
    if (!/^[0-9A-Za-z._-]{1,40}$/.test(v)) throw httpError(400, 'Versão do contrato inválida (use algo como 2026-10-10).')
    patch.agreement_version = v
  }
  if (!Object.keys(patch).length) throw httpError(400, 'Nada para salvar.')

  const before = await readConfig(supabase)
  const changes = Object.keys(patch).filter(k => before[k] !== patch[k]).map(k => `${k}: ${before[k]} -> ${patch[k]}`)

  const saved = must(await supabase.from('bc_store_config')
    .upsert({ id: 1, ...patch, updated_by: admin.actor, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select('*').maybeSingle(), 'salvar a configuração')

  if (changes.length) {
    await logModeration(supabase, {
      target_type: 'config', target_id: '1', action: 'save_config',
      from_status: null, to_status: null, reason: changes.join('; ').slice(0, 1000), actor: admin.actor,
    })
  }
  // Store aberta para COMPRAS agora (vitrine e checkout ligados depois do save, e antes
  // nao estavam os dois): avisa quem entrou na lista de espera. So a vitrine aberta
  // (compras ainda fechadas) nao avisa: a lista prometeu "quando abrir para compras".
  const after = { ...CONFIG_DEFAULTS, ...(saved || {}) }
  const openBefore = !!before.public_enabled && !!before.checkout_enabled
  const openAfter = !!after.public_enabled && !!after.checkout_enabled
  let waitlist = null
  if (openAfter && !openBefore) waitlist = await notifyStoreWaitlist(supabase)
  return { ok: true, config: after, changed: changes.length, waitlist }
}

/**
 * Lista de espera da Store (bc_interest_waitlist, interest_id 'store', gravada
 * por api/waitlist.js com source 'store'). Manda o aviso "A Store abriu para
 * compras" em lotes e marca notified. Sem RESEND_API_KEY nada e marcado.
 * Disparado por save_config quando vitrine e compras ficam ligadas, ou pelo
 * action notify_waitlist (proximos lotes).
 */
async function notifyStoreWaitlist(supabase, { limit = 200 } = {}) {
  const { data, error } = await supabase.from('bc_interest_waitlist').select('id, email')
    .eq('interest_id', 'store').eq('notified', false).order('created_at', { ascending: true }).limit(limit)
  if (error) return { sent: 0, remaining: null, error: 'Lista de espera indisponível: ' + error.message }
  const { sendTransactional } = await import('../_lib/mailer.js')
  let sent = 0
  const rows = data || []
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10)
    const done = await Promise.all(batch.map(async (w) => {
      const r = await sendTransactional({
        to: w.email,
        subject: 'A BrasilConnect Store abriu para compras',
        kicker: 'BRASILCONNECT STORE',
        title: 'A Store abriu para compras',
        paragraphs: [
          'Você pediu para ser avisado: a BrasilConnect Store abriu para compras, com lojas da comunidade brasileira nos EUA.',
          'Cada loja envia e garante os próprios produtos, e o pagamento só vai para a loja depois que você recebe.',
        ],
        ctaUrl: APP_URL + '/store',
        ctaLabel: 'Conhecer a Store',
      })
      return r && r.ok ? w.id : null
    }))
    const ids = done.filter(Boolean)
    if (ids.length) await supabase.from('bc_interest_waitlist').update({ notified: true }).in('id', ids)
    sent += ids.length
  }
  const { count } = await supabase.from('bc_interest_waitlist').select('id', { count: 'exact', head: true })
    .eq('interest_id', 'store').eq('notified', false)
  return { sent, remaining: count ?? null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  res.setHeader('Cache-Control', 'private, no-store')

  let supabase
  try {
    supabase = getSupabase()
  } catch (e) {
    return err(res, 500, 'Supabase não configurado no servidor.')
  }
  const admin = await requireAdmin(req, supabase)
  if (!admin.ok) return err(res, admin.status, admin.error)

  try {
    const query = req.query || {}

    if (req.method === 'GET') {
      const view = String(query.view || 'overview')
      let out
      if (view === 'overview') out = await viewOverview(supabase)
      else if (view === 'sellers') out = await viewSellers(supabase, query)
      else if (view === 'products') out = await viewProducts(supabase, query)
      else if (view === 'orders') out = await viewOrders(supabase, query)
      else if (view === 'order') out = await viewOrder(supabase, query)
      else if (view === 'reports') out = await viewReports(supabase, query)
      else if (view === 'reviews') out = await viewReviews(supabase, query)
      else if (view === 'state-volume') out = await viewStateVolume(supabase)
      else if (view === 'config') out = { config: await readConfig(supabase) }
      else return err(res, 400, 'view desconhecida.')
      return res.status(200).json(out)
    }

    if (req.method !== 'POST') return err(res, 405, 'Método não permitido.')

    const limited = rateLimit(req, { windowMs: 60_000, max: 60 })
    if (limited) return err(res, 429, 'Muitas ações seguidas. Espere um minuto.')

    let body = req.body || {}
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}') } catch (_) { return err(res, 400, 'JSON inválido.') }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {}
    const action = String(query.action || body.action || '')

    let out
    if (SELLER_RULES[action]) out = await sellerDecision(supabase, admin, action, body)
    else if (action === 'approve_shop_changes' || action === 'reject_shop_changes') out = await shopChangesDecision(supabase, admin, action, body)
    else if (action === 'clear_seller_debt') out = await clearSellerDebt(supabase, admin, body)
    else if (action === 'notify_waitlist') out = { ok: true, waitlist: await notifyStoreWaitlist(supabase) }
    else if (PRODUCT_RULES[action]) out = await productDecision(supabase, admin, action, body)
    else if (action === 'resolve_report' || action === 'dismiss_report') out = await reportDecision(supabase, admin, action, body)
    else if (['refund', 'cancel_order', 'release', 'hold', 'unhold', 'unlock_label', 'resolve_dispute', 'message'].includes(action)) out = await orderAction(supabase, admin, action, body)
    else if (action === 'hide_review') out = await hideReview(supabase, admin, body)
    else if (action === 'show_review') out = await showReview(supabase, admin, body)
    else if (action === 'save_config') out = await saveConfig(supabase, admin, body)
    else if (action === 'set_seller_fee') out = await setSellerFee(supabase, admin, body)
    else return err(res, 400, 'Ação desconhecida.')
    return res.status(200).json(out)
  } catch (e) {
    if (e && e.expose) return err(res, e.status || 400, e.message)
    console.error('[admin/store] erro:', e)
    return err(res, 500, 'Erro: ' + (e?.message || 'desconhecido'))
  }
}
