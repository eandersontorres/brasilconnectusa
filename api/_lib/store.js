/**
 * BrasilConnect Store — regras e helpers compartilhados pelo backend.
 *
 * Quem usa: api/store/*.js, api/admin/store.js, api/cron/store.js,
 * api/stripe/webhook.js e api/_lib/storeOrders.js.
 *
 * Dinheiro sempre em centavos (int). Nada aqui confia em valor vindo do cliente.
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from './businessAuth.js'

export const APP_URL = process.env.APP_URL || 'https://brasilconnectusa.com'

export function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

let _stripe = null
export async function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null
  if (_stripe) return _stripe
  const Stripe = (await import('stripe')).default
  // timeout curto: as funcoes da Store tem 30 a 60 s; o padrao do SDK (80 s) estoura antes
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20', timeout: 20000, maxNetworkRetries: 1 })
  return _stripe
}

export const err = (res, status, error, extra) => res.status(status).json({ error, ...(extra || {}) })

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v) => typeof v === 'string' && UUID.test(v)

// ─────────────────────────────────────────────────────────────────────────────
// Configuracao (linha unica em bc_store_config). Se a tabela falhar, usa os
// padroes abaixo, com compras FECHADAS.
// ─────────────────────────────────────────────────────────────────────────────
export const CONFIG_DEFAULTS = {
  public_enabled: false,
  checkout_enabled: false,
  fee_bps: 1000,
  fee_fixed_cents: 0,
  fee_on_shipping: true,
  release_days_after_delivery: 3,
  release_days_new_seller: 7,
  new_seller_orders: 5,
  safety_release_days: 30,
  local_release_days: 3,
  auto_cancel_grace_days: 2,
  dispute_window_days: 30,
  seller_response_days: 2,
  checkout_expires_minutes: 30,
  tax_enabled: false,
  agreement_version: '2026-10-10',
}

export async function getConfig(supabase) {
  try {
    const { data, error } = await supabase.from('bc_store_config').select('*').eq('id', 1).maybeSingle()
    if (error) console.error('[store] config indisponivel, usando padroes (Store fechada):', error.message)
    return { ...CONFIG_DEFAULTS, ...(data || {}) }
  } catch (_) {
    return { ...CONFIG_DEFAULTS }
  }
}

/** O que a vitrine pode saber da configuracao. */
export function publicConfig(cfg) {
  return {
    public_enabled: !!cfg.public_enabled,
    checkout_enabled: !!cfg.checkout_enabled,
    release_days_after_delivery: cfg.release_days_after_delivery,
    release_days_new_seller: cfg.release_days_new_seller,
    new_seller_orders: cfg.new_seller_orders,
    safety_release_days: cfg.safety_release_days,
    local_release_days: cfg.local_release_days,
    auto_cancel_grace_days: cfg.auto_cancel_grace_days,
    seller_response_days: cfg.seller_response_days,
    dispute_window_days: cfg.dispute_window_days,
    agreement_version: cfg.agreement_version,
    // A comissao nao e segredo: a loja precisa saber antes de se cadastrar
    fee_bps: cfg.fee_bps,
    fee_fixed_cents: cfg.fee_fixed_cents,
    fee_on_shipping: !!cfg.fee_on_shipping,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estados (50 + DC). Territorios, APO/FPO e envio internacional ficam fora.
// ─────────────────────────────────────────────────────────────────────────────
export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
export const isState = (s) => typeof s === 'string' && Object.prototype.hasOwnProperty.call(US_STATES, s.toUpperCase())
export const normState = (s) => (isState(s) ? s.toUpperCase() : null)
export const normZip = (z) => {
  const m = /^(\d{5})(?:-?\d{4})?$/.exec(String(z || '').trim())
  return m ? m[1] : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto
// ─────────────────────────────────────────────────────────────────────────────
export function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}
export function normalizeSearch(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
export function slugify(s, max = 60) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '')
}
/** Texto livre: corta no limite, tira caracteres de controle. null se vazio. */
export function cleanText(v, max) {
  if (v === undefined || v === null) return null
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (!s) return null
  return s.slice(0, max)
}

/** Slugs que nao podem ser de loja (rotas da Store). */
export const RESERVED_SLUGS = new Set([
  'p', 'loja', 'lojas', 'carrinho', 'vender', 'painel', 'pedidos', 'pedido', 'regras', 'busca',
  'categoria', 'categorias', 'checkout', 'api', 'admin', 'store', 'brasilconnect', 'oficial',
  'suporte', 'ajuda', 'termos', 'sitemap', 'login', 'conta', 'minha-conta',
])

/**
 * Detecta contato direto (telefone, e-mail, WhatsApp, link) em anuncio.
 * Igual ao Mercado Livre: a venda acontece dentro da plataforma.
 */
export function hasContactInfo(text) {
  const s = String(text || '')
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return 'e-mail'
  if (/(https?:\/\/|www\.)\S+/i.test(s)) return 'link'
  if (/\b(whats\s?app|wpp|zap\s?zap|telegram|insta(gram)?\s*:)|(^|\s)@[a-z][a-z0-9_.]{2,}/i.test(s)) return 'contato de rede social'
  // Telefone com separador (512-555-1234, (512) 555 1234), com DDI, ou numero logo apos "tel/cel/ligue".
  // Sequencia de digitos solta (ISBN, codigo de barras) nao conta.
  if (/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(s)) return 'telefone'
  if (/\+\s?(1|55)[\s\d().-]{9,}/.test(s)) return 'telefone'
  if (/\b(tel|fone|telefone|cel|celular|ligue|liga|chama)\b\D{0,6}\d{8,}/i.test(s)) return 'telefone'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Imagens: so URLs publicas do nosso bucket 'uploads' (vindas de /api/upload)
// ─────────────────────────────────────────────────────────────────────────────
export function isSafeImageUrl(url) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'https:') return false
    const base = new URL(process.env.SUPABASE_URL || 'https://ggwppcbdnemjuddnzbdw.supabase.co')
    return u.host === base.host && u.pathname.startsWith('/storage/v1/object/public/uploads/')
  } catch (_) {
    return false
  }
}
export function cleanImages(list, max = 8) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const x of list) {
    if (isSafeImageUrl(x) && !out.includes(x)) out.push(String(x))
    if (out.length >= max) break
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Dinheiro: comissao e repasse
// ─────────────────────────────────────────────────────────────────────────────
export const fmtUSD = (cents) => '$' + ((Number(cents) || 0) / 100).toFixed(2)

/** Comissao da plataforma sobre uma base (itens [+ frete]). */
export function computeFee({ items_cents, shipping_cents, fee_bps, fee_fixed_cents, fee_on_shipping }) {
  const base = Math.max(0, (items_cents || 0) + (fee_on_shipping ? (shipping_cents || 0) : 0))
  if (base <= 0) return 0
  return Math.round(base * (Math.max(0, fee_bps || 0) / 10000)) + Math.max(0, fee_fixed_cents || 0)
}

/** Taxa efetiva da loja (override do admin ou a padrao). */
export function sellerFeeBps(seller, cfg) {
  return seller && Number.isInteger(seller.fee_bps_override) ? seller.fee_bps_override : cfg.fee_bps
}

/**
 * Quanto o vendedor recebe por um pedido, descontando reembolsos.
 * Reembolso abate primeiro da base (itens+frete); a comissao e recalculada
 * sobre o que sobrou. A etiqueta comprada pela plataforma sai do repasse.
 * Nunca negativo.
 */
export function computePayout(order) {
  const gross = (order.items_cents || 0) + (order.shipping_cents || 0)
  const refunded = Math.min(gross, Math.max(0, order.refunded_cents || 0))
  const remaining = gross - refunded
  if (remaining <= 0) return { payout_cents: 0, fee_cents: 0 }
  const ratio = gross > 0 ? remaining / gross : 0
  const fee = computeFee({
    items_cents: Math.round((order.items_cents || 0) * ratio),
    shipping_cents: Math.round((order.shipping_cents || 0) * ratio),
    fee_bps: order.fee_bps,
    fee_fixed_cents: order.fee_fixed_cents,
    fee_on_shipping: order.fee_on_shipping,
  })
  const payout = remaining - fee - Math.max(0, order.label_cost_cents || 0)
  return { payout_cents: Math.max(0, payout), fee_cents: Math.min(fee, remaining) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Datas: dias uteis no horario de Nova York (seg-sex, sem feriados federais,
// que sao os dias sem coleta da USPS). Prazos vencem as 23:59 de Nova York.
// ─────────────────────────────────────────────────────────────────────────────
const NY = 'America/New_York'
const _civilFmt = new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' })
const _timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: NY, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const pad2 = (n) => String(n).padStart(2, '0')

/** Data civil em Nova York ('YYYY-MM-DD'). */
export function nyCivil(date) {
  return _civilFmt.format(new Date(date))
}
/** Diferenca (minutos) entre Nova York e UTC naquele instante (-240 no verao, -300 no inverno). */
function nyOffsetMinutes(date) {
  const d = new Date(date)
  const [h, m, s] = _timeFmt.format(d).split(':').map(Number)
  const [y, mo, da] = nyCivil(d).split('-').map(Number)
  const asUtc = Date.UTC(y, mo - 1, da, h, m, s)
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000)
}
/** Instante UTC de um horario de parede em Nova York. */
function nyWallToUtc(civil, h, m, s) {
  const [y, mo, da] = civil.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, da, h, m, s)
  // duas passadas resolvem a troca de horario de verao
  let t = guess - nyOffsetMinutes(guess) * 60000
  t = guess - nyOffsetMinutes(t) * 60000
  return new Date(t)
}

const _holidayCache = new Map()
/** Feriados federais (com a data observada quando caem no fim de semana). */
export function usFederalHolidays(year) {
  if (_holidayCache.has(year)) return _holidayCache.get(year)
  const ymd = (m, d) => `${year}-${pad2(m)}-${pad2(d)}`
  const nth = (m, wd, k) => { // k-esimo dia da semana wd do mes m
    const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay()
    return ymd(m, 1 + ((wd - first + 7) % 7) + (k - 1) * 7)
  }
  const last = (m, wd) => {
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
    const lw = new Date(Date.UTC(year, m - 1, lastDay)).getUTCDay()
    return ymd(m, lastDay - ((lw - wd + 7) % 7))
  }
  const observed = (m, d) => {
    const wd = new Date(Date.UTC(year, m - 1, d)).getUTCDay()
    const t = Date.UTC(year, m - 1, d) + (wd === 6 ? -86400000 : wd === 0 ? 86400000 : 0)
    return new Date(t).toISOString().slice(0, 10)
  }
  const set = new Set([
    observed(1, 1), nth(1, 1, 3), nth(2, 1, 3), last(5, 1), observed(6, 19), observed(7, 4),
    nth(9, 1, 1), nth(10, 1, 2), observed(11, 11), nth(11, 4, 4), observed(12, 25),
  ])
  _holidayCache.set(year, set)
  return set
}
function isBusinessCivil(civil) {
  const [y, m, d] = civil.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd !== 0 && wd !== 6 && !usFederalHolidays(y).has(civil)
}
function addBusinessDaysCivil(civil, n) {
  let [y, m, d] = civil.split('-').map(Number)
  let t = Date.UTC(y, m - 1, d, 12)
  let left = Math.max(0, Math.floor(n || 0))
  while (left > 0) {
    t += 86400000
    if (isBusinessCivil(new Date(t).toISOString().slice(0, 10))) left--
  }
  return new Date(t).toISOString().slice(0, 10)
}

/** Soma N dias uteis mantendo o mesmo horario de parede em Nova York. */
export function addBusinessDays(date, n) {
  const d = new Date(date)
  const [h, m, s] = _timeFmt.format(d).split(':').map(Number)
  return nyWallToUtc(addBusinessDaysCivil(nyCivil(d), n), h, m, s)
}
export const addDays = (date, n) => new Date(new Date(date).getTime() + (n || 0) * 86400000)

/** 23:59:59 de Nova York, N dias uteis depois da data (civil) de `date`. */
export function nyEndOfBusinessDay(date, n) {
  return nyWallToUtc(addBusinessDaysCivil(nyCivil(date), n), 23, 59, 59)
}

/** Prazo de postagem: 23:59 de Nova York apos N dias uteis do pagamento. */
export function computeShipBy(paidAt, handlingDays) {
  return nyEndOfBusinessDay(paidAt, handlingDays || 2)
}

/** Quando o cron cancela um pedido nao enviado: prazo + carencia em dias uteis. */
export function autoCancelAt(shipBy, graceDays) {
  if (!shipBy) return null
  return nyEndOfBusinessDay(shipBy, Math.max(0, graceDays || 0))
}

/**
 * Prazo efetivo de um pedido pago. Na entrega local, vale o maior entre o prazo
 * de preparo (ship_by, ou a data combinada) e o prazo de entrega que a regiao
 * anunciou (pago + est_days_max dias).
 */
export function orderDeadline(o) {
  if (!o?.ship_by) return null
  let base = new Date(o.ship_by)
  if (o.fulfillment === 'local_delivery' && o.paid_at) {
    const max = Number(o.zone_snapshot?.est_days_max)
    if (Number.isFinite(max) && max > 0) {
      const est = nyEndOfBusinessDay(addDays(o.paid_at, max), 0)
      if (est > base) base = est
    }
  }
  return base
}

/** Carencia extra (dias uteis) de pedido com etiqueta da Store que a transportadora ainda nao leu. */
export const UNSCANNED_EXTRA_BUSINESS_DAYS = 2

/**
 * Data em que o cron cancela este pedido (ou null). Mesma regra para cron, painel
 * e comprador: pedido pago = prazo + carencia; etiqueta da Store comprada mas
 * nunca lida pela transportadora = isso + UNSCANNED_EXTRA_BUSINESS_DAYS.
 */
export function orderAutoCancelAt(o, cfg) {
  if (!o) return null
  const d = orderDeadline(o)
  if (!d) return null
  const base = autoCancelAt(d, cfg?.auto_cancel_grace_days || 0)
  if (o.status === 'paid') return base
  const unscanned = ['PRE_TRANSIT', 'UNKNOWN', ''].includes(String(o.tracking_status || '').toUpperCase())
  if (o.status === 'shipped' && o.label_status === 'purchased' && unscanned) return addBusinessDays(base, UNSCANNED_EXTRA_BUSINESS_DAYS)
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Frete: regioes da loja
// ─────────────────────────────────────────────────────────────────────────────
export function zoneMatches(zone, dest) {
  if (!zone || zone.active === false) return false
  const state = normState(dest?.state)
  const zip = normZip(dest?.zip)
  if (zone.method === 'local_delivery') {
    if (!zip) return false
    const prefixes = (zone.zip_prefixes || []).filter(Boolean)
    if (prefixes.length) return prefixes.some(p => zip.startsWith(String(p)))
    return !!state && (zone.states || []).includes(state)
  }
  if (!state || !(zone.states || []).includes(state)) return false
  // Retirada: se a loja listou CEPs, so aparece para quem esta perto
  if (zone.method === 'pickup' && (zone.zip_prefixes || []).filter(Boolean).length) {
    return !!zip && zone.zip_prefixes.some(p => p && zip.startsWith(String(p)))
  }
  return true
}

/** Frete de um pacote numa regiao (primeiro item + adicionais; gratis acima de X). */
export function shippingForZone(zone, totalQty, itemsCents) {
  if (!zone || zone.method === 'pickup') return 0
  if (zone.free_over_cents && itemsCents >= zone.free_over_cents) return 0
  const q = Math.max(1, totalQty || 1)
  return (zone.rate_first_cents || 0) + (zone.rate_additional_cents || 0) * (q - 1)
}

/**
 * Opcoes de entrega de uma loja para um destino. Uma por metodo (a mais barata).
 * Retorna [{zone_id, method, name, shipping_cents, est_days_min, est_days_max}].
 */
export function deliveryOptions(zones, dest, totalQty, itemsCents, { hazmat = false } = {}) {
  const best = {}
  for (const z of zones || []) {
    if (!zoneMatches(z, dest)) continue
    const cents = shippingForZone(z, totalQty, itemsCents)
    const cur = best[z.method]
    if (!cur || cents < cur.shipping_cents) {
      best[z.method] = {
        zone_id: z.id, method: z.method, name: z.name, shipping_cents: cents,
        est_days_min: z.est_days_min ?? null, est_days_max: z.est_days_max ?? null,
        hazmat_ground_only: hazmat && z.method === 'ship',
      }
    }
  }
  return ['ship', 'local_delivery', 'pickup'].map(m => best[m]).filter(Boolean)
}

/** Estados que a loja atende (para a vitrine mostrar "Envia para ..."). */
export function sellerStates(zones) {
  const set = new Set()
  for (const z of zones || []) {
    if (z.active === false) continue
    for (const s of z.states || []) set.add(s)
  }
  return [...set].sort()
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotulos em PT-BR (status ficam em ingles no banco)
// ─────────────────────────────────────────────────────────────────────────────
export const ORDER_STATUS_PT = {
  pending_payment: 'Aguardando pagamento',
  paid: 'Pago · aguardando envio',
  shipped: 'Enviado',
  delivered: 'Entregue',
  completed: 'Concluído',
  canceled: 'Cancelado',
  refunded: 'Reembolsado',
  expired: 'Pagamento não concluído',
}
export const FULFILLMENT_PT = { ship: 'Envio pelos Correios/transportadora', local_delivery: 'Entrega local', pickup: 'Retirada com o vendedor' }
export const CONDITION_PT = { new: 'Novo', used_like_new: 'Usado · como novo', used_good: 'Usado · bom estado', handmade: 'Feito à mão' }
export const ORIGIN_PT = { handmade: 'Feito à mão', made_in_usa: 'Feito nos EUA', imported_brazil: 'Importado do Brasil', other: 'Outro' }
export const DISPUTE_REASON_PT = {
  not_received: 'Não recebi',
  not_as_described: 'Diferente do anúncio',
  damaged: 'Chegou com defeito ou avariado',
  other: 'Outro problema',
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializacao publica (nunca expor endereco, telefone, Stripe, Shippo)
// ─────────────────────────────────────────────────────────────────────────────
export const SELLER_PUBLIC_COLS = 'id, slug, name, tagline, bio, logo_url, banner_url, city, state, status, handling_days, accepts_returns, return_window_days, return_policy, warranty_policy, sales_count, rating_avg, rating_count, vacation_mode, stripe_transfers_active, created_at'
export const PRODUCT_PUBLIC_COLS = 'id, seller_id, slug, title, description, category_slug, condition, origin, price_cents, compare_at_cents, stock, images, hazmat, tags, sales_count, rating_avg, rating_count, published_at, status'

export function publicSeller(s) {
  if (!s) return null
  return {
    id: s.id, slug: s.slug, name: s.name, tagline: s.tagline || null, bio: s.bio || null,
    logo_url: s.logo_url || null, banner_url: s.banner_url || null,
    city: s.city || null, state: s.state || null,
    handling_days: s.handling_days, accepts_returns: !!s.accepts_returns, return_window_days: s.return_window_days,
    return_policy: s.return_policy || null, warranty_policy: s.warranty_policy || null,
    sales_count: s.sales_count || 0, rating_avg: s.rating_avg != null ? Number(s.rating_avg) : null, rating_count: s.rating_count || 0,
    vacation_mode: !!s.vacation_mode, member_since: s.created_at,
  }
}

export function publicProduct(p, seller) {
  if (!p) return null
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description,
    category_slug: p.category_slug, condition: p.condition, origin: p.origin,
    price_cents: p.price_cents, compare_at_cents: p.compare_at_cents || null,
    in_stock: (p.stock || 0) > 0, stock: Math.min(p.stock || 0, 99),
    images: p.images || [], hazmat: !!p.hazmat, tags: p.tags || [],
    sales_count: p.sales_count || 0, rating_avg: p.rating_avg != null ? Number(p.rating_avg) : null, rating_count: p.rating_count || 0,
    published_at: p.published_at,
    seller: seller ? { id: seller.id, slug: seller.slug, name: seller.name, logo_url: seller.logo_url || null, state: seller.state || null, city: seller.city || null, rating_avg: seller.rating_avg != null ? Number(seller.rating_avg) : null, rating_count: seller.rating_count || 0 } : undefined,
  }
}

/** Loja pode vender agora? (aprovada, Stripe pronto, fora de ferias) */
export function sellerCanSell(s) {
  return !!s && s.status === 'approved' && !!s.stripe_transfers_active && !s.vacation_mode
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────
export async function requireUser(req, supabase) {
  const auth = await requireAuthOnly(req, supabase)
  if (!auth.ok) return { ok: false, status: 401, error: 'Entre na sua conta para continuar.' }
  if (await isBanned(supabase, auth.user.id)) return { ok: false, status: 403, error: 'Sua conta está suspensa.' }
  return { ok: true, user: auth.user }
}

/** Vendedor logado (dono da loja). approvedOnly exige loja aprovada. */
export async function requireSeller(req, supabase, { approvedOnly = false } = {}) {
  const auth = await requireUser(req, supabase)
  if (!auth.ok) return auth
  const { data: seller } = await supabase.from('bc_store_sellers').select('*').eq('user_id', auth.user.id).maybeSingle()
  if (!seller) return { ok: false, status: 404, error: 'Você ainda não tem uma loja na Store.', user: auth.user }
  if (seller.status === 'suspended') return { ok: false, status: 403, error: 'Sua loja está suspensa. Fale com oi@brasilconnectusa.com.' }
  if (approvedOnly && seller.status !== 'approved') return { ok: false, status: 403, error: 'Sua loja ainda não foi aprovada.' }
  return { ok: true, user: auth.user, seller }
}

export async function isBanned(supabase, userId) {
  if (!userId) return false
  try {
    const { data } = await supabase.from('bc_banned_users').select('user_id').eq('user_id', userId).maybeSingle()
    return !!data
  } catch (_) {
    return false
  }
}

export function clientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '').split(',')[0].trim() || null
}

// ─────────────────────────────────────────────────────────────────────────────
// Registros
// ─────────────────────────────────────────────────────────────────────────────
export async function logEvent(supabase, orderId, kind, { actor = 'system', actor_id = null, message = null, data = null } = {}) {
  try {
    await supabase.from('bc_store_order_events').insert({ order_id: orderId, kind, actor, actor_id: actor_id ? String(actor_id) : null, message, data })
  } catch (e) {
    console.error('[store] logEvent falhou:', e.message)
  }
}

export async function logModeration(supabase, { target_type, target_id, action, from_status = null, to_status = null, reason = null, actor }) {
  try {
    await supabase.from('bc_store_moderation_log').insert({ target_type, target_id: String(target_id), action, from_status, to_status, reason, actor: actor || 'system' })
  } catch (e) {
    console.error('[store] logModeration falhou:', e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Avisos (sino in-app + e-mail). Best effort: nunca derruba a acao principal.
//   notify({ user_id, email, type, title, body, url, icon, metadata,
//            mail: { subject, kicker, title, paragraphs, ctaUrl, ctaLabel } })
// paragraphs vao como HTML: escape dado de usuario com esc().
// ─────────────────────────────────────────────────────────────────────────────
export async function notify({ user_id, email, type, title, body, url, icon, metadata, mail }) {
  if (user_id && type && title) {
    try {
      const { createNotification } = await import('./notify.js')
      await createNotification({ user_id, type, title, body, url, icon, metadata, also_push: true, push_topic: 'orders' })
    } catch (e) {
      console.error('[store] notificacao falhou:', e.message)
    }
  }
  if (email && mail) {
    try {
      const { sendTransactional } = await import('./mailer.js')
      await sendTransactional({
        to: email,
        subject: mail.subject || title,
        kicker: mail.kicker || 'BRASILCONNECT STORE',
        title: mail.title || title,
        paragraphs: mail.paragraphs || (body ? [esc(body)] : []),
        ctaUrl: mail.ctaUrl || (url ? (url.startsWith('http') ? url : APP_URL + url) : undefined),
        ctaLabel: mail.ctaLabel || 'Abrir',
      })
    } catch (e) {
      console.error('[store] e-mail falhou:', e.message)
    }
  }
}

export async function notifyAdmin(subject, paragraphs, ctaUrl) {
  try {
    const { sendTransactional, adminEmail } = await import('./mailer.js')
    await sendTransactional({
      to: adminEmail(), subject, kicker: 'STORE · ADMIN', title: subject, paragraphs,
      ctaUrl: ctaUrl || APP_URL + '/admin/manage', ctaLabel: 'Abrir o admin',
    })
  } catch (e) {
    console.error('[store] aviso ao admin falhou:', e.message)
  }
}

export function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
