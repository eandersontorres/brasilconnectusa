/**
 * /api/store/checkout — carrinho e pagamento da BrasilConnect Store.
 *
 *   POST ?action=quote          (sem login) recalcula o carrinho: preco, estoque e frete por loja
 *   POST ?action=create         (login) cria checkout + um pedido por loja + Stripe Checkout
 *   GET  ?action=status&id=     (login) situacao do checkout (pagina de retorno do Stripe)
 *
 * Contrato: docs/store/ARQUITETURA.md (secao 6.3).
 * Preco, estoque, frete e comissao SEMPRE recalculados aqui; nada vem do cliente.
 *
 * Estoque: o create reserva (bc_store_reserve_stock) antes de abrir o pagamento.
 * Se o comprador volta do Stripe sem pagar, a reserva dele continua ate o
 * checkout expirar. Por isso:
 *   - a cotacao de quem esta logado soma de volta o que esta preso nos checkouts
 *     pendentes dele (senao o produto apareceria "Esgotado" para ele mesmo);
 *   - o create fecha os checkouts pendentes do mesmo comprador antes de reservar.
 *
 * Anti-abuso (reservar estoque sem pagar para deixar a loja "Esgotado"):
 *   - um create por vez por comprador (checkout pendente com menos de 10 s = 409);
 *   - checkouts abandonados nas ultimas 24 h: 5 (3 para quem nunca pagou) = 429.
 *     So conta como abandono o checkout que segurou estoque por mais de 10 min
 *     (voltar do Stripe e refazer o carrinho logo em seguida nao pesa);
 *   - quem nunca pagou reserva no maximo metade do estoque de cada produto;
 *   - somadas, as contas que nunca pagaram nao seguram mais que metade do
 *     estoque de um produto (disponivel + o que elas ja reservaram): conferido
 *     antes de reservar e de novo depois de gravar (creates em paralelo).
 */
import {
  getSupabase, getStripe, getConfig, err, isUuid, normState, normZip, cleanText,
  deliveryOptions, sellerCanSell, requireUser, sellerFeeBps, computeFee, APP_URL,
} from '../_lib/store.js'
import { expireCheckout } from '../_lib/storeOrders.js'
import { shippoEnabled, validateAddress } from '../_lib/shippo.js'
import { requireAuthOnly } from '../_lib/businessAuth.js'
import { rateLimit } from '../_lib/rateLimit.js'

const MAX_DISTINCT = 30          // produtos diferentes por compra (contrato)
const MAX_LINES = 60             // teto do que a cotacao processa (protecao)
const MAX_TOTAL_CENTS = 99999999 // limite do Stripe por pagamento
const METHODS = ['ship', 'local_delivery', 'pickup']
const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s*office\s*box|caixa\s+postal)\b/i
const CREATE_LOCK_MS = 10 * 1000       // checkout pendente mais novo que isso = create em andamento
const CREATE_TWIN_MS = 60 * 1000       // depois de gravar: outro checkout pendente nessa janela = create duplicado
const ABANDON_WINDOW_MS = 24 * 3600 * 1000
const ABANDON_MAX = 5                  // checkouts abertos no Stripe e nao pagos em 24 h
const ABANDON_MAX_NEW = 3              // ... para quem nunca pagou na Store
const ABANDON_HOLD_MS = 10 * 60 * 1000 // so e abandono o que segurou estoque por mais que isso
const NEW_BUYER_SHARE = 0.5            // quem nunca pagou: no maximo metade do estoque (por conta e somando as contas)
const BUSY_MSG = 'Já estamos abrindo um pagamento para você. Espere alguns segundos e tente de novo.'
const CROWD_MSG = (title) => `"${title}": muita gente reservando este produto agora; tente em alguns minutos.`

// ─────────────────────────────────────────────────────────────────────────────
// Utilitarios
// ─────────────────────────────────────────────────────────────────────────────
/** Rate limit com balde proprio por acao (rateLimit agrupa por IP + caminho). */
function hitLimit(req, res, name, max, windowMs = 60000) {
  const hit = rateLimit({ headers: req.headers || {}, url: '/api/store/checkout/' + name }, { windowMs, max })
  if (!hit) return false
  res.setHeader('Retry-After', String(hit.retryAfter))
  err(res, 429, 'Muitas tentativas seguidas. Espere um pouco e tente de novo.')
  return true
}

/** Itens do carrinho: so UUID valido, quantidade inteira 1..99, sem repetir produto. */
function normItems(raw) {
  const list = Array.isArray(raw) ? raw : []
  const map = new Map()
  for (const it of list) {
    if (!it || !isUuid(it.product_id)) continue
    const id = it.product_id.toLowerCase()
    const n = Math.floor(Number(it.qty))
    const qty = Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1
    if (!map.has(id) && map.size >= MAX_LINES) break
    map.set(id, Math.min(99, (map.get(id) || 0) + qty))
  }
  return [...map].map(([product_id, qty]) => ({ product_id, qty }))
}

function normChoices(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    if (isUuid(k) && METHODS.includes(v)) out[k.toLowerCase()] = v
  }
  return out
}

const isHttps = (u) => {
  try { return new URL(String(u)).protocol === 'https:' } catch (_) { return false }
}

/** Quantidade de cada produto presa nos checkouts pendentes do comprador. */
async function heldByUser(supabase, userId) {
  const held = new Map()
  const { data: cos, error } = await supabase.from('bc_store_checkouts')
    .select('id').eq('buyer_user_id', userId).eq('status', 'pending').eq('stock_released', false).limit(10)
  if (error || !cos || !cos.length) return held
  const { data: orders, error: oErr } = await supabase.from('bc_store_orders')
    .select('id').in('checkout_id', cos.map(c => c.id))
  if (oErr || !orders || !orders.length) return held
  const { data: items, error: iErr } = await supabase.from('bc_store_order_items')
    .select('product_id, quantity').in('order_id', orders.map(o => o.id))
  if (iErr) return held
  for (const it of items || []) {
    if (it.product_id) held.set(it.product_id, (held.get(it.product_id) || 0) + (it.quantity || 0))
  }
  return held
}

/**
 * Fecha os checkouts pendentes do comprador (devolve o estoque). Antes, expira a
 * sessao no Stripe para ninguem pagar uma sessao velha. Sessao ja paga fica
 * como esta (o webhook marca como pago). Checkout criado ha poucos segundos e
 * de outro create em andamento: fica (a checagem de duplicado resolve).
 */
async function closePendingCheckouts(supabase, stripe, userId) {
  const { data: pend, error } = await supabase.from('bc_store_checkouts')
    .select('id, stripe_session_id').eq('buyer_user_id', userId).eq('status', 'pending').eq('stock_released', false)
    .lt('created_at', new Date(Date.now() - CREATE_LOCK_MS).toISOString()).limit(10)
  if (error) { console.error('[store/checkout] pendentes:', error.message); return }
  for (const co of pend || []) {
    if (co.stripe_session_id) {
      try {
        const s = await stripe.checkout.sessions.retrieve(co.stripe_session_id)
        if (s.status === 'complete') continue
        if (s.status === 'open') await stripe.checkout.sessions.expire(co.stripe_session_id)
      } catch (e) {
        console.error('[store/checkout] expirar sessao falhou:', co.id, e.message)
        continue
      }
    }
    try {
      await expireCheckout(supabase, co.id, { reason: 'canceled' })
    } catch (e) {
      console.error('[store/checkout] expireCheckout falhou:', co.id, e.message)
    }
  }
}

async function releaseReserved(supabase, reserved) {
  for (const r of reserved) {
    const { error } = await supabase.rpc('bc_store_release_stock', { p_product: r.product_id, p_qty: r.qty })
    if (error) console.error('[store/checkout] release_stock falhou:', r.product_id, error.message)
  }
}

/**
 * Desfaz um create que falhou no meio: marca o checkout como cancelado (com
 * guarda, para nao brigar com o cron), os pedidos como expirados e devolve o
 * estoque reservado. Se nao conseguir marcar o checkout, deixa o cron expirar
 * (ele devolve o estoque dos itens gravados).
 */
async function undoCreate(supabase, checkoutId, reserved) {
  if (checkoutId) {
    const { data: claimed, error } = await supabase.from('bc_store_checkouts')
      .update({ status: 'canceled', stock_released: true })
      .eq('id', checkoutId).eq('status', 'pending').eq('stock_released', false)
      .select('id')
    if (error || !claimed || !claimed.length) {
      console.error('[store/checkout] nao consegui cancelar o checkout', checkoutId, error ? error.message : 'ja mudou')
      return
    }
    const { error: oErr } = await supabase.from('bc_store_orders')
      .update({ status: 'expired', payout_status: 'none' })
      .eq('checkout_id', checkoutId).eq('status', 'pending_payment')
    if (oErr) console.error('[store/checkout] expirar pedidos falhou:', checkoutId, oErr.message)
  }
  await releaseReserved(supabase, reserved)
}

/**
 * Freios contra reserva de estoque sem pagamento. Retorna { error, status }
 * para recusar, ou { hasPaid } para seguir.
 */
async function checkoutGuard(supabase, userId) {
  const now = Date.now()
  // Um create por vez: clique duplo ou duas abas
  const { data: busy, error: bErr } = await supabase.from('bc_store_checkouts').select('id')
    .eq('buyer_user_id', userId).eq('status', 'pending')
    .gte('created_at', new Date(now - CREATE_LOCK_MS).toISOString()).limit(1)
  if (bErr) throw new Error('checkouts em andamento: ' + bErr.message)
  if (busy && busy.length) return { status: 409, error: BUSY_MSG }

  const [paidRes, abandonedRes] = await Promise.all([
    supabase.from('bc_store_checkouts').select('id', { count: 'exact', head: true })
      .eq('buyer_user_id', userId).eq('status', 'paid'),
    // So conta o que chegou a abrir o Stripe (falha nossa ou create duplicado nao pesa)
    supabase.from('bc_store_checkouts').select('created_at, closed_at, updated_at')
      .eq('buyer_user_id', userId).in('status', ['expired', 'canceled']).not('stripe_session_id', 'is', null)
      .gte('created_at', new Date(now - ABANDON_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false }).limit(100),
  ])
  if (paidRes.error) throw new Error('compras pagas: ' + paidRes.error.message)
  if (abandonedRes.error) throw new Error('checkouts abandonados: ' + abandonedRes.error.message)
  const hasPaid = (paidRes.count || 0) > 0
  // Abandono = segurou estoque por mais de 10 min (de criado ate fechado). Quem volta
  // do Stripe e refaz o carrinho fecha o checkout anterior em poucos minutos: nao conta.
  const abandoned = (abandonedRes.data || []).filter(c => {
    const start = new Date(c.created_at).getTime()
    const end = new Date(c.closed_at || c.updated_at || c.created_at).getTime()
    return Number.isFinite(start) && Number.isFinite(end) && end - start > ABANDON_HOLD_MS
  }).length
  if (abandoned >= (hasPaid ? ABANDON_MAX : ABANDON_MAX_NEW)) {
    return { status: 429, error: 'Muitas tentativas de compra sem pagamento nas últimas 24 horas. Tente de novo amanhã ou fale com oi@brasilconnectusa.com.' }
  }
  return { hasPaid }
}

/** Divide a lista em pedacos (filtro .in() com muitos ids estoura a URL do PostgREST). */
function chunks(list, size = 100) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Quanto de cada produto esta preso em checkouts pendentes de contas que nunca
 * pagaram na Store (fora a conta exceptUserId). Map(product_id -> qty).
 */
async function newBuyerHeld(supabase, sellerIds, productIds, exceptUserId) {
  const held = new Map()
  if (!sellerIds.length || !productIds.length) return held
  // Pedidos aguardando pagamento das lojas do carrinho
  const { data: orders, error } = await supabase.from('bc_store_orders')
    .select('id, checkout_id, buyer_user_id').in('seller_id', sellerIds).eq('status', 'pending_payment')
    .neq('buyer_user_id', exceptUserId).limit(2000)
  if (error) throw new Error('reservas pendentes: ' + error.message)
  if (!orders || !orders.length) return held

  // So checkouts que ainda seguram estoque
  const live = new Set()
  for (const part of chunks([...new Set(orders.map(o => o.checkout_id).filter(Boolean))])) {
    const { data, error: cErr } = await supabase.from('bc_store_checkouts').select('id')
      .in('id', part).eq('status', 'pending').eq('stock_released', false)
    if (cErr) throw new Error('checkouts pendentes: ' + cErr.message)
    for (const c of data || []) live.add(c.id)
  }
  const pend = orders.filter(o => live.has(o.checkout_id))
  if (!pend.length) return held

  // Quem ja pagou alguma vez fica de fora
  const paid = new Set()
  for (const part of chunks([...new Set(pend.map(o => o.buyer_user_id))], 50)) {
    const { data, error: pErr } = await supabase.from('bc_store_checkouts').select('buyer_user_id')
      .in('buyer_user_id', part).eq('status', 'paid').limit(5000)
    if (pErr) throw new Error('compras pagas: ' + pErr.message)
    for (const c of data || []) paid.add(c.buyer_user_id)
  }
  const counted = pend.filter(o => !paid.has(o.buyer_user_id)).map(o => o.id)
  for (const part of chunks(counted)) {
    const { data, error: iErr } = await supabase.from('bc_store_order_items').select('product_id, quantity')
      .in('order_id', part).in('product_id', productIds)
    if (iErr) throw new Error('itens reservados: ' + iErr.message)
    for (const it of data || []) {
      if (it.product_id) held.set(it.product_id, (held.get(it.product_id) || 0) + (it.quantity || 0))
    }
  }
  return held
}

/**
 * Teto somado das contas que nunca pagaram: o que elas ja seguram de um produto
 * mais este pedido nao passa de metade de (estoque disponivel + o que elas seguram).
 * afterReserve: confere de novo depois de reservar e gravar (le o estoque atual,
 * que ja descontou este pedido). Creates em paralelo: quem confere por ultimo ve
 * os itens de todos os outros. Retorna a linha que estourou ou null.
 */
async function crowdOver(supabase, internal, userId, { afterReserve = false } = {}) {
  const lines = internal.flatMap(g => g.lines)
  const productIds = [...new Set(lines.map(ln => ln.p.id))]
  const sellerIds = [...new Set(internal.map(g => g.seller.id))]
  const held = await newBuyerHeld(supabase, sellerIds, productIds, userId)
  let stock = new Map(lines.map(ln => [ln.p.id, Math.max(0, ln.p.stock || 0)]))
  if (afterReserve) {
    const { data, error } = await supabase.from('bc_store_products').select('id, stock').in('id', productIds)
    if (error) throw new Error('estoque: ' + error.message)
    stock = new Map((data || []).map(p => [p.id, Math.max(0, p.stock || 0)]))
  }
  for (const ln of lines) {
    const h = held.get(ln.p.id) || 0
    const available = (stock.get(ln.p.id) || 0) + (afterReserve ? ln.qty : 0)
    if (h + ln.qty > Math.ceil((available + h) * NEW_BUYER_SHARE)) return ln
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Cotacao
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Monta a Quote (contrato 6.3) e, para o create, os dados internos de cada loja.
 * held: Map(product_id -> qty) devolvida a disponibilidade (reservas do proprio comprador).
 */
async function buildQuote(supabase, cfg, body, held = new Map()) {
  const items = normItems(body && body.items)
  const shipTo = (body && body.ship_to && typeof body.ship_to === 'object') ? body.ship_to : {}
  const state = normState(shipTo.state)
  const zip = normZip(shipTo.zip)
  const choices = normChoices(body && body.choices)

  const problems = []
  const addProblem = (p) => { if (p && !problems.includes(p)) problems.push(p) }
  const quote = {
    groups: [],
    items_cents: 0, shipping_cents: 0, total_cents: 0,
    can_checkout: false, problems, checkout_enabled: !!cfg.checkout_enabled,
    tax_enabled: !!cfg.tax_enabled, // extra: a pagina avisa "imposto calculado no pagamento"
    missing: [],                    // extra: produtos do carrinho que nao existem mais
  }
  const internal = []
  if (!items.length) {
    addProblem('Seu carrinho está vazio.')
    return { quote, internal }
  }
  if (items.length > MAX_DISTINCT) addProblem(`Máximo de ${MAX_DISTINCT} produtos diferentes por compra. Remova alguns para continuar.`)

  const { data: products, error: pErr } = await supabase.from('bc_store_products')
    .select('id, seller_id, slug, title, price_cents, stock, images, hazmat, weight_oz, status')
    .in('id', items.map(i => i.product_id))
  if (pErr) throw new Error('produtos: ' + pErr.message)
  const pMap = new Map((products || []).map(p => [p.id, p]))

  const sellerIds = [...new Set((products || []).map(p => p.seller_id))]
  const sMap = new Map()
  const zonesBySeller = new Map()
  if (sellerIds.length) {
    const [sRes, zRes] = await Promise.all([
      supabase.from('bc_store_sellers')
        .select('id, user_id, slug, name, logo_url, status, stripe_transfers_active, vacation_mode, fee_bps_override, handling_days')
        .in('id', sellerIds),
      supabase.from('bc_store_shipping_zones')
        .select('id, seller_id, name, method, states, zip_prefixes, rate_first_cents, rate_additional_cents, free_over_cents, est_days_min, est_days_max, pickup_note, active')
        .in('seller_id', sellerIds).eq('active', true),
    ])
    if (sRes.error) throw new Error('lojas: ' + sRes.error.message)
    if (zRes.error) throw new Error('regioes: ' + zRes.error.message)
    for (const s of sRes.data || []) sMap.set(s.id, s)
    for (const z of zRes.data || []) {
      if (!zonesBySeller.has(z.seller_id)) zonesBySeller.set(z.seller_id, [])
      zonesBySeller.get(z.seller_id).push(z)
    }
  }

  // Agrupa por loja, na ordem do carrinho
  const groups = new Map()
  for (const it of items) {
    const p = pMap.get(it.product_id)
    if (!p) { quote.missing.push(it.product_id); continue }
    if (!groups.has(p.seller_id)) groups.set(p.seller_id, { sellerId: p.seller_id, seller: sMap.get(p.seller_id) || null, lines: [] })
    groups.get(p.seller_id).lines.push({ p, requested: it.qty })
  }
  if (quote.missing.length) addProblem('Algum produto do carrinho não está mais na Store. Remova-o para continuar.')

  let needState = false
  for (const g of groups.values()) {
    const s = g.seller
    const canSell = sellerCanSell(s)
    const outItems = []
    const buyLines = []
    let itemsCents = 0
    let totalQty = 0
    let hazmat = false

    for (const { p, requested } of g.lines) {
      const stock = Math.max(0, (p.stock || 0) + (held.get(p.id) || 0))
      let ok = true
      let problem = null
      let qty = requested
      let available = true
      if (!canSell || p.status !== 'approved') { ok = false; available = false; problem = 'Produto indisponível' }
      else if (stock <= 0) { ok = false; available = false; problem = 'Esgotado' }
      else if (requested > stock) { ok = false; qty = stock; problem = stock === 1 ? 'Só resta 1' : `Só restam ${stock}` }
      if (available) {
        itemsCents += p.price_cents * qty
        totalQty += qty
        if (p.hazmat) hazmat = true
        buyLines.push({ p, qty })
      }
      outItems.push({
        product_id: p.id, slug: p.slug, title: p.title,
        image: (Array.isArray(p.images) && p.images[0]) || null,
        price_cents: p.price_cents, qty, stock: Math.min(stock, 99), ok, problem,
      })
    }

    let options = []
    let selected = null
    let option = null
    let shippingCents = 0
    let gProblem = null
    if (!canSell) {
      gProblem = s && s.vacation_mode ? 'Esta loja está de férias e não está vendendo agora' : 'Esta loja não está vendendo no momento'
    } else if (!state) {
      gProblem = 'Informe o estado de entrega'
      needState = true
    } else {
      const zones = zonesBySeller.get(g.sellerId) || []
      options = deliveryOptions(zones, { state, zip }, Math.max(1, totalQty), itemsCents, { hazmat })
      if (!options.length) {
        // Entrega local e retirada com lista de ZIP so aparecem com o ZIP informado
        const needsZip = !zip && zones.some(z => z.method === 'local_delivery' || (z.method === 'pickup' && (z.zip_prefixes || []).some(Boolean)))
        gProblem = needsZip ? 'Informe o ZIP code para ver se a loja entrega no seu endereço' : `Esta loja não entrega em ${state}`
        for (const it of outItems) if (it.ok) { it.ok = false; it.problem = gProblem }
      } else {
        option = options.find(o => o.method === choices[g.sellerId]) || options[0]
        selected = option.method
        shippingCents = option.shipping_cents
      }
    }

    const gOk = canSell && !!selected && outItems.length > 0 && outItems.every(i => i.ok)
    const sellerName = s ? s.name : 'Loja'
    if (gProblem && gProblem !== 'Informe o estado de entrega') addProblem(`${sellerName}: ${gProblem}.`)
    for (const it of outItems) {
      if (!it.ok && it.problem && it.problem !== gProblem) addProblem(`${it.title}: ${it.problem}.`)
    }

    quote.groups.push({
      // handling_days: prazo de postagem/entrega da loja em dias uteis (o carrinho mostra junto com a regiao)
      seller: { id: g.sellerId, slug: s ? s.slug : null, name: sellerName, logo_url: s ? (s.logo_url || null) : null, handling_days: (s && s.handling_days) || 2 },
      items: outItems,
      options: options.map(o => ({
        zone_id: o.zone_id, method: o.method, name: o.name, shipping_cents: o.shipping_cents,
        est_days_min: o.est_days_min, est_days_max: o.est_days_max, hazmat_ground_only: !!o.hazmat_ground_only,
      })),
      selected,
      items_cents: itemsCents,
      shipping_cents: shippingCents,
      subtotal_cents: itemsCents + shippingCents,
      ok: gOk,
      problem: gProblem,
    })
    quote.items_cents += itemsCents
    quote.shipping_cents += shippingCents

    if (gOk && option) {
      const zone = (zonesBySeller.get(g.sellerId) || []).find(z => z.id === option.zone_id) || null
      internal.push({ seller: s, option, zone, lines: buyLines, items_cents: itemsCents, shipping_cents: shippingCents })
    }
  }
  if (needState) problems.unshift('Informe o estado de entrega.')

  quote.total_cents = quote.items_cents + quote.shipping_cents
  quote.can_checkout = !!cfg.checkout_enabled
    && quote.groups.length > 0
    && quote.groups.every(g => g.ok)
    && !quote.missing.length
    && items.length <= MAX_DISTINCT
  return { quote, internal }
}

async function quoteAction(req, res, supabase) {
  if (hitLimit(req, res, 'quote', 120)) return
  const cfg = await getConfig(supabase)
  // Login opcional: so serve para devolver a disponibilidade presa nos checkouts pendentes do proprio comprador
  let held = new Map()
  if (req.headers && req.headers.authorization) {
    const a = await requireAuthOnly(req, supabase)
    if (a.ok) held = await heldByUser(supabase, a.user.id)
  }
  const { quote } = await buildQuote(supabase, cfg, req.body || {}, held)
  return res.status(200).json(quote)
}

// ─────────────────────────────────────────────────────────────────────────────
// Endereco de entrega
// ─────────────────────────────────────────────────────────────────────────────
function validateShipTo(raw) {
  const a = raw && typeof raw === 'object' ? raw : {}
  const name = cleanText(a.name, 80)
  if (!name || name.length < 2) return { error: 'Informe o nome de quem vai receber.', field: 'name' }
  const line1 = cleanText(a.line1, 100)
  if (!line1 || line1.length < 3) return { error: 'Informe o endereço (número e rua).', field: 'line1' }
  const line2 = cleanText(a.line2, 100)
  const city = cleanText(a.city, 60)
  if (!city || city.length < 2) return { error: 'Informe a cidade.', field: 'city' }
  const state = normState(a.state)
  if (!state) return { error: 'Escolha o estado.', field: 'state' }
  const zip = normZip(a.zip)
  if (!zip) return { error: 'Informe um ZIP code válido (5 dígitos).', field: 'zip' }
  let phone = String(a.phone || '').replace(/\D/g, '')
  if (phone.length === 11 && phone[0] === '1') phone = phone.slice(1)
  if (phone.length < 10 || phone.length > 15) return { error: 'Informe um telefone com código de área (10 dígitos).', field: 'phone' }
  return { value: { name, line1, line2: line2 || null, city, state, zip, phone } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Criar o pagamento
// ─────────────────────────────────────────────────────────────────────────────
async function createAction(req, res, supabase) {
  if (hitLimit(req, res, 'create', 8)) return
  const auth = await requireUser(req, supabase)
  if (!auth.ok) return err(res, auth.status, auth.error)
  const user = auth.user

  const cfg = await getConfig(supabase)
  if (!cfg.checkout_enabled) return err(res, 403, 'As compras na Store abrem em breve.')
  const email = String(user.email || '').trim().toLowerCase()
  if (!email) return err(res, 400, 'Sua conta precisa ter um e-mail para receber os avisos do pedido.')
  const stripe = await getStripe()
  if (!stripe) return err(res, 503, 'O pagamento está indisponível agora. Tente de novo mais tarde.')

  const body = req.body || {}
  const v = validateShipTo(body.ship_to)
  if (v.error) return err(res, 400, v.error, { field: v.field })
  const shipTo = v.value

  const guard = await checkoutGuard(supabase, user.id)
  if (guard.error) {
    if (guard.status === 429) res.setHeader('Retry-After', '3600')
    return err(res, guard.status, guard.error)
  }

  // Libera o que este comprador tinha preso em checkouts abertos (voltou do Stripe sem pagar)
  await closePendingCheckouts(supabase, stripe, user.id)

  const { quote, internal } = await buildQuote(supabase, cfg, { items: body.items, ship_to: shipTo, choices: body.choices })
  if (!quote.can_checkout || !internal.length || internal.length !== quote.groups.length) {
    return err(res, 409, quote.problems[0] || 'Revise o carrinho antes de pagar.', { quote })
  }
  if (quote.total_cents < 50) return err(res, 400, 'O valor mínimo de compra é $0.50.')
  if (quote.total_cents > MAX_TOTAL_CENTS) return err(res, 400, 'O valor passou do limite de um pagamento. Divida a compra em partes.')

  const own = internal.find(g => g.seller && g.seller.user_id === user.id)
  if (own) return err(res, 400, `Você não pode comprar da sua própria loja (${own.seller.name}). Remova esses produtos do carrinho.`)

  // Caixa postal / endereco militar nao serve para envio por transportadora
  const shipGroups = internal.filter(g => g.option.method === 'ship')
  if (shipGroups.length && PO_BOX.test(`${shipTo.line1} ${shipTo.line2 || ''}`)) {
    return err(res, 400, `A loja ${shipGroups[0].seller.name} envia por transportadora e não entrega em caixa postal (PO Box). Use um endereço de rua.`, { field: 'line1' })
  }
  if (shippoEnabled()) {
    const check = await validateAddress(shipTo)
    if (check && check.result === 'invalid') {
      const why = (check.reasons || []).slice(0, 2).join('; ')
      return err(res, 400, `Não encontramos esse endereço${why ? ' (' + why + ')' : ''}. Confira número, rua, cidade e ZIP code.`, { field: 'line1' })
    }
    if (check && shipGroups.length && check.address_type === 'po_box') {
      return err(res, 400, `A loja ${shipGroups[0].seller.name} envia por transportadora e não entrega em caixa postal (PO Box). Use um endereço de rua.`, { field: 'line1' })
    }
    if (check && shipGroups.length && check.address_type === 'military') {
      return err(res, 400, `A loja ${shipGroups[0].seller.name} envia por transportadora e não entrega em endereço militar (APO/FPO/DPO).`, { field: 'line1' })
    }
  }

  // Quem nunca pagou na Store nao segura mais que metade do estoque de um produto,
  // e as contas que nunca pagaram, somadas, tambem nao
  if (!guard.hasPaid) {
    for (const g of internal) {
      for (const ln of g.lines) {
        const cap = Math.ceil(Math.max(0, ln.p.stock || 0) * NEW_BUYER_SHARE)
        if (ln.qty > cap) {
          return err(res, 409, `Na primeira compra na Store, dá para levar até ${cap} unidade${cap === 1 ? '' : 's'} de "${ln.p.title}". Diminua a quantidade para continuar.`)
        }
      }
    }
    const crowded = await crowdOver(supabase, internal, user.id)
    if (crowded) return err(res, 409, CROWD_MSG(crowded.p.title))
  }

  // Reserva o estoque item a item; se algo faltar, devolve o que ja reservou
  const reserved = []
  for (const g of internal) {
    for (const ln of g.lines) {
      const { data: okRes, error: rErr } = await supabase.rpc('bc_store_reserve_stock', { p_product: ln.p.id, p_qty: ln.qty })
      if (rErr || okRes !== true) {
        await releaseReserved(supabase, reserved)
        if (rErr) {
          console.error('[store/checkout] reserve_stock falhou:', ln.p.id, rErr.message)
          return err(res, 500, 'Não conseguimos reservar o estoque agora. Tente de novo em instantes.')
        }
        return err(res, 409, `"${ln.p.title}" acabou de esgotar ou mudou de estoque. Atualize o carrinho.`)
      }
      reserved.push({ product_id: ln.p.id, qty: ln.qty })
    }
  }

  // Validade do pagamento: Stripe aceita de 30 min a 24 h (margem de 2 min nas pontas)
  const minutes = Math.floor(Number(cfg.checkout_expires_minutes) || 30)
  const ttlSec = Math.min(24 * 3600 - 120, Math.max(30 * 60 + 120, minutes * 60))
  const expiresUnix = Math.floor(Date.now() / 1000) + ttlSec
  const expiresIso = new Date(expiresUnix * 1000).toISOString()

  let checkoutId = null
  try {
    const { data: co, error: coErr } = await supabase.from('bc_store_checkouts').insert({
      buyer_user_id: user.id,
      buyer_email: email,
      ship_to: shipTo,
      items_cents: quote.items_cents,
      shipping_cents: quote.shipping_cents,
      tax_cents: 0,
      total_cents: quote.total_cents,
      status: 'pending',
      expires_at: expiresIso,
    }).select('id').single()
    if (coErr || !co) throw new Error('checkout insert: ' + (coErr ? coErr.message : 'sem retorno'))
    checkoutId = co.id

    // Dois creates do mesmo comprador ao mesmo tempo passam juntos pela trava
    // inicial; depois de gravar, quem enxergar o outro desiste (no maximo um segue)
    const { data: twins, error: tErr } = await supabase.from('bc_store_checkouts').select('id')
      .eq('buyer_user_id', user.id).eq('status', 'pending').eq('stock_released', false).neq('id', checkoutId)
      .gte('created_at', new Date(Date.now() - CREATE_TWIN_MS).toISOString()).limit(1)
    if (tErr) throw new Error('checkout duplicado: ' + tErr.message)
    if (twins && twins.length) {
      await undoCreate(supabase, checkoutId, reserved)
      return err(res, 409, BUSY_MSG)
    }

    const lineItems = []
    for (const g of internal) {
      const fee_bps = sellerFeeBps(g.seller, cfg)
      const fee_fixed_cents = Math.max(0, cfg.fee_fixed_cents || 0)
      const fee_on_shipping = !!cfg.fee_on_shipping
      const z = g.zone || {}
      const { data: order, error: oErr } = await supabase.from('bc_store_orders').insert({
        checkout_id: checkoutId,
        seller_id: g.seller.id,
        buyer_user_id: user.id,
        buyer_email: email,
        ship_to: shipTo,
        fulfillment: g.option.method,
        zone_id: g.zone ? g.zone.id : null,
        zone_snapshot: {
          name: z.name || g.option.name,
          method: z.method || g.option.method,
          est_days_min: z.est_days_min ?? g.option.est_days_min ?? null,
          est_days_max: z.est_days_max ?? g.option.est_days_max ?? null,
          pickup_note: z.pickup_note || null,
        },
        items_cents: g.items_cents,
        shipping_cents: g.shipping_cents,
        tax_cents: 0,
        total_cents: g.items_cents + g.shipping_cents,
        fee_bps,
        fee_fixed_cents,
        fee_on_shipping,
        fee_cents: computeFee({ items_cents: g.items_cents, shipping_cents: g.shipping_cents, fee_bps, fee_fixed_cents, fee_on_shipping }),
        status: 'pending_payment',
      }).select('id, order_number').single()
      if (oErr || !order) throw new Error('order insert: ' + (oErr ? oErr.message : 'sem retorno'))

      const rows = g.lines.map(ln => ({
        order_id: order.id,
        product_id: ln.p.id,
        title: ln.p.title,
        image_url: (Array.isArray(ln.p.images) && ln.p.images[0]) || null,
        unit_price_cents: ln.p.price_cents,
        quantity: ln.qty,
        subtotal_cents: ln.p.price_cents * ln.qty,
        weight_oz: ln.p.weight_oz ?? null,
      }))
      const { error: iErr } = await supabase.from('bc_store_order_items').insert(rows)
      if (iErr) throw new Error('items insert: ' + iErr.message)

      for (const ln of g.lines) {
        const img = Array.isArray(ln.p.images) ? ln.p.images[0] : null
        const priceData = {
          currency: 'usd',
          unit_amount: ln.p.price_cents,
          product_data: {
            name: `${ln.p.title} · ${g.seller.name}`.slice(0, 250),
            metadata: { product_id: ln.p.id, seller_id: g.seller.id, order_id: order.id },
          },
        }
        if (img && isHttps(img)) priceData.product_data.images = [img]
        if (cfg.tax_enabled) priceData.tax_behavior = 'exclusive'
        lineItems.push({ quantity: ln.qty, price_data: priceData })
      }
    }

    // Contas sem compra paga reservando o mesmo produto ao mesmo tempo passam juntas
    // pela conferencia inicial; com os itens gravados, confere de novo
    if (!guard.hasPaid) {
      const crowded = await crowdOver(supabase, internal, user.id, { afterReserve: true })
      if (crowded) {
        await undoCreate(supabase, checkoutId, reserved)
        return err(res, 409, CROWD_MSG(crowded.p.title))
      }
    }

    const address = { line1: shipTo.line1, city: shipTo.city, state: shipTo.state, postal_code: shipTo.zip, country: 'US' }
    if (shipTo.line2) address.line2 = shipTo.line2
    const params = {
      mode: 'payment',
      customer_email: email,
      locale: 'pt-BR',
      client_reference_id: checkoutId,
      payment_method_types: ['card', 'link'],
      line_items: lineItems,
      payment_intent_data: {
        transfer_group: 'STORE_' + checkoutId,
        shipping: { name: shipTo.name, phone: shipTo.phone, address },
        metadata: { type: 'store_checkout', checkout_id: checkoutId },
      },
      metadata: { type: 'store_checkout', checkout_id: checkoutId },
      expires_at: expiresUnix,
      success_url: `${APP_URL}/store/pedidos?checkout=${checkoutId}&ok=1`,
      cancel_url: `${APP_URL}/store/carrinho?cancelado=1`,
    }
    if (quote.shipping_cents > 0) {
      const rate = {
        type: 'fixed_amount',
        display_name: internal.length > 1 ? `Frete (${internal.length} lojas)` : 'Frete',
        fixed_amount: { amount: quote.shipping_cents, currency: 'usd' },
      }
      if (cfg.tax_enabled) { rate.tax_behavior = 'exclusive'; rate.tax_code = 'txcd_92010001' }
      params.shipping_options = [{ shipping_rate_data: rate }]
    }
    if (cfg.tax_enabled) params.automatic_tax = { enabled: true, liability: { type: 'self' } }

    let session
    try {
      // Stripe Tax calcula pelo endereco de ENTREGA so se ele estiver no Customer
      // (payment_intent_data.shipping nao entra no calculo). Sem Customer, usaria o
      // endereco de cobranca do cartao.
      if (cfg.tax_enabled) {
        const customer = await stripe.customers.create({
          email,
          name: shipTo.name,
          phone: shipTo.phone,
          address,
          shipping: { name: shipTo.name, phone: shipTo.phone, address },
          metadata: { type: 'store_buyer', user_id: user.id, checkout_id: checkoutId },
        }, { idempotencyKey: 'store_cus_' + checkoutId })
        params.customer = customer.id
        delete params.customer_email
      }
      session = await stripe.checkout.sessions.create(params, { idempotencyKey: 'store_cs_' + checkoutId })
    } catch (e) {
      console.error('[store/checkout] Stripe falhou:', checkoutId, e.message)
      await undoCreate(supabase, checkoutId, reserved)
      return err(res, 502, 'Não conseguimos abrir o pagamento agora. Tente de novo em instantes.')
    }

    const { error: upErr } = await supabase.from('bc_store_checkouts')
      .update({ stripe_session_id: session.id }).eq('id', checkoutId)
    if (upErr) console.error('[store/checkout] gravar stripe_session_id falhou:', checkoutId, upErr.message)

    return res.status(200).json({ url: session.url, checkout_id: checkoutId })
  } catch (e) {
    console.error('[store/checkout] create falhou:', e.message)
    await undoCreate(supabase, checkoutId, reserved)
    return err(res, 500, 'Não conseguimos registrar o pedido agora. Nada foi cobrado. Tente de novo em instantes.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Situacao do checkout (pagina de retorno)
// ─────────────────────────────────────────────────────────────────────────────
async function statusAction(req, res, supabase) {
  const auth = await requireUser(req, supabase)
  if (!auth.ok) return err(res, auth.status, auth.error)
  const id = String((req.query && req.query.id) || '')
  if (!isUuid(id)) return err(res, 400, 'Compra inválida.')

  const { data: co, error } = await supabase.from('bc_store_checkouts')
    .select('id, buyer_user_id, status').eq('id', id).maybeSingle()
  if (error) throw new Error('checkout: ' + error.message)
  if (!co || co.buyer_user_id !== auth.user.id) return err(res, 404, 'Compra não encontrada.')

  const { data: orders, error: oErr } = await supabase.from('bc_store_orders')
    .select('id, order_number, seller_id, created_at').eq('checkout_id', id).order('created_at')
  if (oErr) throw new Error('pedidos: ' + oErr.message)
  const sellerIds = [...new Set((orders || []).map(o => o.seller_id))]
  const names = {}
  if (sellerIds.length) {
    const { data: sellers, error: sErr } = await supabase.from('bc_store_sellers').select('id, name').in('id', sellerIds)
    if (sErr) throw new Error('lojas: ' + sErr.message)
    for (const s of sellers || []) names[s.id] = s.name
  }
  return res.status(200).json({
    status: co.status,
    orders: (orders || []).map(o => ({ id: o.id, order_number: o.order_number, seller_name: names[o.seller_id] || 'Loja' })),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  res.setHeader('Cache-Control', 'private, no-store')
  const action = String((req.query && req.query.action) || '')
  try {
    const supabase = getSupabase()
    if (action === 'quote') {
      if (req.method !== 'POST') return err(res, 405, 'Use POST.')
      return await quoteAction(req, res, supabase)
    }
    if (action === 'create') {
      if (req.method !== 'POST') return err(res, 405, 'Use POST.')
      return await createAction(req, res, supabase)
    }
    if (action === 'status') {
      if (req.method !== 'GET') return err(res, 405, 'Use GET.')
      return await statusAction(req, res, supabase)
    }
    return err(res, 400, 'Ação inválida.')
  } catch (e) {
    console.error('[store/checkout]', action, e.message)
    if (res.headersSent) return
    return err(res, 500, 'Algo deu errado. Tente de novo em instantes.')
  }
}
