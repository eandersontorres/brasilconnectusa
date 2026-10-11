/**
 * GET /api/store/catalog — vitrine publica da BrasilConnect Store (JSON).
 * Contrato: docs/store/ARQUITETURA.md, secao 6.1.
 *
 *   ?action=home                     { config, categories, featured, newest, sellers }
 *   ?action=search&q=&category=&state=&seller=&sort=&min=&max=&page=&per=
 *                                    { items, total, page, per, has_more }
 *   ?action=product&slug=            { product, seller, category, delivery, ships_to, reviews, related }  (404 se nao estiver a venda)
 *   ?action=seller&slug=             { seller, products, delivery, ships_to, reviews, categories }
 *   ?action=estimate&product_id=&state=&zip=&qty=   { options }
 *   ?action=config                   { config, categories }
 *
 * So entram produtos 'approved' de lojas que podem vender (aprovada, Stripe
 * ativo, fora de ferias). Nunca devolve endereco, telefone, Stripe, Shippo,
 * compliance_*, agent_* nem pickup_note.
 *
 * Os carregadores (loadProductPage, loadShopPage, loadSitemap) tambem sao
 * usados pelas paginas SSR em api/store/page.js.
 */
import {
  getSupabase, getConfig, publicConfig, err, isUuid, normState, normZip, normalizeSearch,
  publicProduct, publicSeller, deliveryOptions, sellerStates, sellerCanSell,
  SELLER_PUBLIC_COLS, PRODUCT_PUBLIC_COLS,
} from '../_lib/store.js'
import { rateLimit } from '../_lib/rateLimit.js'

const PUBLIC_CACHE = 'public, s-maxage=60, stale-while-revalidate=300'

export const PRODUCT_SLUG_RE = /^[a-z0-9-]{3,100}$/
export const SELLER_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const CATEGORY_RE = /^[a-z0-9-]{2,40}$/
const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'best_selling']

// Loja embutida no produto. !inner: o filtro na loja corta o produto junto.
const SELLER_EMBED = `bc_store_sellers!inner(${SELLER_PUBLIC_COLS})`
const SELLER_GATE_EMBED = 'bc_store_sellers!inner(id, status, stripe_transfers_active, vacation_mode)'
// Sem pickup_note (so aparece depois da compra)
const ZONE_COLS = 'id, seller_id, name, method, states, zip_prefixes, rate_first_cents, rate_additional_cents, free_over_cents, est_days_min, est_days_max, active'

// ─────────────────────────────────────────────────────────────────────────────
// Utilitarios
// ─────────────────────────────────────────────────────────────────────────────
/** supabase-js nao lanca erro: confere { data, error } e lanca aqui. */
function check(result, what) {
  if (result && result.error) {
    const e = new Error(`${what}: ${result.error.message}`)
    e.code = result.error.code
    throw e
  }
  return result ? result.data : null
}

function clampInt(v, min, max, def) {
  const n = parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

function parseCents(v) {
  if (v === undefined || v === null || v === '') return null
  const n = parseInt(String(v), 10)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(n, 100000000)
}

/** Escapa curingas do LIKE (normalizeSearch ja tira, mas nao custa). */
function escapeLike(t) {
  return String(t).replace(/[\\%_]/g, (c) => '\\' + c)
}

/** "Ana Souza" -> "Ana S." ; sem nome -> null */
function shortName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!s || s.includes('@') || /^[\d\s.+-]+$/.test(s)) return null
  const parts = s.split(' ')
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  const first = cap(parts[0].slice(0, 20))
  if (parts.length < 2) return first
  const initial = parts[parts.length - 1].charAt(0).toUpperCase()
  return initial ? `${first} ${initial}.` : first
}

const sellerCard = (s) => ({
  slug: s.slug,
  name: s.name,
  logo_url: s.logo_url || null,
  city: s.city || null,
  state: s.state || null,
  rating_avg: s.rating_avg != null ? Number(s.rating_avg) : null,
  rating_count: s.rating_count || 0,
  sales_count: s.sales_count || 0,
})

function zoneSummary(z) {
  const out = {
    method: z.method,
    name: z.name,
    states: Array.isArray(z.states) ? z.states : [],
    rate_first_cents: z.rate_first_cents || 0,
    rate_additional_cents: z.rate_additional_cents || 0,
    free_over_cents: z.free_over_cents || null,
    est_days_min: z.est_days_min ?? null,
    est_days_max: z.est_days_max ?? null,
  }
  // Entrega local (e retirada limitada por ZIP code): so a quantidade, nunca a lista
  if (z.method === 'local_delivery') out.zip_count = (z.zip_prefixes || []).filter(Boolean).length
  else if (z.method === 'pickup') {
    const n = (z.zip_prefixes || []).filter(Boolean).length
    if (n) out.zip_count = n
  }
  return out
}

/** Produtos aprovados de lojas que podem vender. */
function sellableProducts(supabase, { select = `${PRODUCT_PUBLIC_COLS}, ${SELLER_EMBED}`, count = null, head = false } = {}) {
  const opts = {}
  if (count) opts.count = count
  if (head) opts.head = true
  return supabase.from('bc_store_products')
    .select(select, opts)
    .eq('status', 'approved')
    .eq('bc_store_sellers.status', 'approved')
    .eq('bc_store_sellers.stripe_transfers_active', true)
    .eq('bc_store_sellers.vacation_mode', false)
}

/** Linhas com loja embutida -> Product publico (confere a loja de novo). */
function toPublic(rows) {
  return (rows || [])
    .filter((r) => r && sellerCanSell(r.bc_store_sellers))
    .map((r) => publicProduct(r, r.bc_store_sellers))
}

function applySort(qb, sort) {
  switch (sort) {
    case 'newest':
      qb = qb.order('published_at', { ascending: false, nullsFirst: false })
      break
    case 'price_asc':
      qb = qb.order('price_cents', { ascending: true })
      break
    case 'price_desc':
      qb = qb.order('price_cents', { ascending: false })
      break
    case 'best_selling':
      qb = qb.order('sales_count', { ascending: false }).order('rating_count', { ascending: false })
      break
    default: // relevance: mais vendidos e melhor avaliados primeiro
      qb = qb.order('sales_count', { ascending: false })
        .order('rating_avg', { ascending: false, nullsFirst: false })
        .order('published_at', { ascending: false, nullsFirst: false })
  }
  return qb.order('id', { ascending: true }) // desempate estavel para paginar
}

// ─────────────────────────────────────────────────────────────────────────────
// Carregadores
// ─────────────────────────────────────────────────────────────────────────────
export async function loadCategories(supabase, { counts = false } = {}) {
  const rows = check(
    await supabase.from('bc_store_categories')
      .select('slug, name, description, gated, requirements, sort')
      .eq('active', true)
      .order('sort', { ascending: true })
      .order('name', { ascending: true }),
    'categorias',
  ) || []
  const cats = rows.map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description || null,
    gated: !!c.gated,
    requirements: c.requirements || null,
  }))
  if (!counts || !cats.length) return cats
  const results = await Promise.all(cats.map((c) =>
    sellableProducts(supabase, { select: `id, ${SELLER_GATE_EMBED}`, count: 'exact', head: true }).eq('category_slug', c.slug),
  ))
  results.forEach((r, i) => {
    if (r.error) console.error('[store/catalog] contagem de categoria:', cats[i].slug, r.error.message)
    cats[i].count = r.error ? 0 : (r.count || 0)
  })
  return cats
}

async function loadZones(supabase, sellerId) {
  return check(
    await supabase.from('bc_store_shipping_zones')
      .select(ZONE_COLS)
      .eq('seller_id', sellerId)
      .eq('active', true)
      .order('created_at', { ascending: true }),
    'regioes de entrega',
  ) || []
}

async function loadReviews(supabase, { productId = null, sellerId = null, withProductTitle = false, limit = 20 } = {}) {
  let q = supabase.from('bc_store_reviews')
    .select('product_id, buyer_user_id, rating, body, seller_reply, created_at')
    .eq('status', 'visible')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (productId) q = q.eq('product_id', productId)
  if (sellerId) q = q.eq('seller_id', sellerId)
  const rows = check(await q, 'avaliacoes') || []
  if (!rows.length) return []

  // Nome publico: "Ana S." a partir do perfil (best effort)
  const names = {}
  const buyerIds = [...new Set(rows.map((r) => r.buyer_user_id).filter(Boolean))]
  if (buyerIds.length) {
    const { data: profs, error } = await supabase.from('bc_profiles')
      .select('user_id, display_name, full_name')
      .in('user_id', buyerIds)
    if (error) console.error('[store/catalog] perfis das avaliacoes:', error.message)
    for (const p of profs || []) names[p.user_id] = shortName(p.display_name) || shortName(p.full_name)
  }

  const titles = {}
  if (withProductTitle) {
    const pids = [...new Set(rows.map((r) => r.product_id).filter(Boolean))]
    if (pids.length) {
      const { data: ps, error } = await supabase.from('bc_store_products').select('id, title').in('id', pids)
      if (error) console.error('[store/catalog] titulos das avaliacoes:', error.message)
      for (const p of ps || []) titles[p.id] = p.title
    }
  }

  return rows.map((r) => {
    const out = {
      rating: r.rating,
      body: r.body || null,
      seller_reply: r.seller_reply || null,
      created_at: r.created_at,
      buyer_name: names[r.buyer_user_id] || 'Comprador verificado',
    }
    if (withProductTitle) out.product_title = titles[r.product_id] || null
    return out
  })
}

async function loadRelated(supabase, row, limit = 8) {
  const sameCat = check(
    await sellableProducts(supabase)
      .eq('category_slug', row.category_slug)
      .neq('id', row.id)
      .gt('stock', 0)
      .order('sales_count', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit),
    'relacionados',
  )
  const list = toPublic(sameCat)
  if (list.length < 4) {
    const sameSeller = check(
      await sellableProducts(supabase)
        .eq('seller_id', row.seller_id)
        .neq('id', row.id)
        .gt('stock', 0)
        .order('sales_count', { ascending: false })
        .limit(limit),
      'mais da loja',
    )
    const seen = new Set(list.map((p) => p.id))
    for (const p of toPublic(sameSeller)) {
      if (list.length >= limit) break
      if (!seen.has(p.id)) { list.push(p); seen.add(p.id) }
    }
  }
  return list
}

async function loadSellerCards(supabase, limit = 12) {
  const sellers = check(
    await supabase.from('bc_store_sellers')
      .select(SELLER_PUBLIC_COLS)
      .eq('status', 'approved')
      .eq('stripe_transfers_active', true)
      .eq('vacation_mode', false)
      .order('sales_count', { ascending: false })
      .order('rating_count', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(60),
    'lojas',
  ) || []
  const list = sellers.filter(sellerCanSell)
  if (!list.length) return []
  // So lojas com pelo menos um produto aprovado
  const rows = check(
    await supabase.from('bc_store_products')
      .select('seller_id')
      .in('seller_id', list.map((s) => s.id))
      .eq('status', 'approved')
      .limit(1000),
    'produtos das lojas',
  ) || []
  const has = new Set(rows.map((r) => r.seller_id))
  return list.filter((s) => has.has(s.id)).slice(0, limit).map(sellerCard)
}

/** Dados da pagina de produto. null = nao esta a venda. */
export async function loadProductPage(supabase, slug) {
  if (!PRODUCT_SLUG_RE.test(String(slug || ''))) return null
  const row = check(await sellableProducts(supabase).eq('slug', slug).maybeSingle(), 'produto')
  if (!row || !sellerCanSell(row.bc_store_sellers)) return null
  const s = row.bc_store_sellers
  const [catRes, zones, reviews, related] = await Promise.all([
    supabase.from('bc_store_categories').select('slug, name, description, gated, requirements').eq('slug', row.category_slug).maybeSingle(),
    loadZones(supabase, s.id),
    loadReviews(supabase, { productId: row.id }),
    loadRelated(supabase, row),
  ])
  const cat = check(catRes, 'categoria')
  return {
    product: publicProduct(row, s),
    seller: publicSeller(s),
    category: cat ? { slug: cat.slug, name: cat.name, description: cat.description || null, gated: !!cat.gated, requirements: cat.requirements || null } : null,
    delivery: zones.map(zoneSummary),
    ships_to: sellerStates(zones),
    reviews,
    related,
  }
}

/** Dados da pagina da loja. null = loja nao existe ou nao esta aprovada. */
export async function loadShopPage(supabase, slug) {
  if (!SELLER_SLUG_RE.test(String(slug || ''))) return null
  const s = check(
    await supabase.from('bc_store_sellers').select(SELLER_PUBLIC_COLS).eq('slug', slug).eq('status', 'approved').maybeSingle(),
    'loja',
  )
  if (!s) return null
  const canSell = sellerCanSell(s)
  const [zones, reviews, prodRes, cats] = await Promise.all([
    loadZones(supabase, s.id),
    loadReviews(supabase, { sellerId: s.id, withProductTitle: true }),
    canSell
      ? supabase.from('bc_store_products')
        .select(PRODUCT_PUBLIC_COLS)
        .eq('seller_id', s.id)
        .eq('status', 'approved')
        .order('sales_count', { ascending: false })
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(200)
      : Promise.resolve({ data: [], error: null }),
    loadCategories(supabase),
  ])
  const products = (check(prodRes, 'produtos da loja') || [])
    .map((p) => publicProduct(p, s))
    .sort((a, b) => Number(b.in_stock) - Number(a.in_stock)) // esgotados no fim (sort estavel)
  const counts = {}
  for (const p of products) counts[p.category_slug] = (counts[p.category_slug] || 0) + 1
  return {
    seller: publicSeller(s),
    products,
    delivery: zones.map(zoneSummary),
    ships_to: sellerStates(zones),
    reviews,
    categories: cats.filter((c) => counts[c.slug]).map((c) => ({ slug: c.slug, name: c.name, count: counts[c.slug] })),
  }
}

/** Produtos e lojas para o sitemap. */
export async function loadSitemap(supabase) {
  const products = []
  for (let from = 0; from < 5000; from += 1000) {
    const rows = check(
      await sellableProducts(supabase, { select: `slug, updated_at, published_at, ${SELLER_GATE_EMBED}` })
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, from + 999),
      'sitemap produtos',
    ) || []
    for (const r of rows) {
      if (sellerCanSell(r.bc_store_sellers)) products.push({ slug: r.slug, lastmod: r.updated_at || r.published_at || null })
    }
    if (rows.length < 1000) break
  }
  // So lojas que podem vender (as outras abrem sem produtos)
  const shops = check(
    await supabase.from('bc_store_sellers')
      .select('slug, updated_at')
      .eq('status', 'approved')
      .eq('stripe_transfers_active', true)
      .eq('vacation_mode', false)
      .order('created_at', { ascending: true })
      .limit(1000),
    'sitemap lojas',
  ) || []
  return { products, shops: shops.map((s) => ({ slug: s.slug, lastmod: s.updated_at || null })) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Acoes
// ─────────────────────────────────────────────────────────────────────────────
async function actionHome(supabase) {
  const cfg = await getConfig(supabase)
  const [categories, featuredRes, newestRes, sellers] = await Promise.all([
    loadCategories(supabase, { counts: true }),
    sellableProducts(supabase)
      .gt('stock', 0)
      .order('sales_count', { ascending: false })
      .order('rating_count', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(12),
    sellableProducts(supabase)
      .gt('stock', 0)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(12),
    loadSellerCards(supabase, 12),
  ])
  return {
    status: 200,
    body: {
      config: publicConfig(cfg),
      categories,
      featured: toPublic(check(featuredRes, 'destaques')),
      newest: toPublic(check(newestRes, 'novidades')),
      sellers,
    },
  }
}

async function actionSearch(supabase, query) {
  const page = clampInt(query.page, 1, 1000, 1)
  const per = clampInt(query.per, 1, 48, 24)
  const sort = SORTS.includes(String(query.sort || '')) ? String(query.sort) : 'relevance'
  const q = normalizeSearch(String(query.q || '').slice(0, 120))
  // Palavra de 1 letra pega tudo; fica de fora (numero fica)
  const terms = q ? q.split(' ').filter((t) => t.length >= 2 || /\d/.test(t)).slice(0, 6) : []
  const category = String(query.category || '').trim().toLowerCase()
  const state = query.state ? normState(String(query.state).trim()) : null
  const sellerSlug = String(query.seller || '').trim().toLowerCase()
  let min = parseCents(query.min)
  let max = parseCents(query.max)
  if (min != null && max != null && min > max) [min, max] = [max, min]

  const empty = { status: 200, body: { items: [], total: 0, page, per, has_more: false } }
  if (category && !CATEGORY_RE.test(category)) return empty
  if (sellerSlug && !SELLER_SLUG_RE.test(sellerSlug)) return empty

  // Lojas com alguma regiao ativa que inclua o estado
  let sellerIds = null
  if (state) {
    const zs = check(
      await supabase.from('bc_store_shipping_zones')
        .select('seller_id')
        .eq('active', true)
        .contains('states', [state])
        .limit(5000),
      'regioes por estado',
    ) || []
    sellerIds = [...new Set(zs.map((z) => z.seller_id))]
    if (!sellerIds.length) return empty
  }

  const build = (opts) => {
    let qb = sellableProducts(supabase, opts)
    for (const t of terms) qb = qb.ilike('search_text', `%${escapeLike(t)}%`)
    if (category) qb = qb.eq('category_slug', category)
    if (sellerSlug) qb = qb.eq('bc_store_sellers.slug', sellerSlug)
    if (sellerIds) qb = qb.in('seller_id', sellerIds)
    if (min != null) qb = qb.gte('price_cents', min)
    if (max != null) qb = qb.lte('price_cents', max)
    return qb
  }

  const from = (page - 1) * per
  const res = await applySort(build({ count: 'exact' }), sort).range(from, from + per - 1)
  if (res.error) {
    // Pagina alem do fim (PostgREST 416): devolve vazio com o total certo
    if (res.error.code === 'PGRST103') {
      const c = await build({ select: `id, ${SELLER_GATE_EMBED}`, count: 'exact', head: true })
      return { status: 200, body: { items: [], total: c.count || 0, page, per, has_more: false } }
    }
    check(res, 'busca')
  }
  const items = toPublic(res.data)
  const total = res.count ?? items.length
  return { status: 200, body: { items, total, page, per, has_more: from + items.length < total } }
}

async function actionProduct(supabase, query) {
  const slug = String(query.slug || '').trim().toLowerCase()
  const data = await loadProductPage(supabase, slug)
  if (!data) return { status: 404, body: { error: 'Produto não encontrado ou fora de venda.' } }
  return { status: 200, body: data }
}

async function actionSeller(supabase, query) {
  const slug = String(query.slug || '').trim().toLowerCase()
  const data = await loadShopPage(supabase, slug)
  if (!data) return { status: 404, body: { error: 'Loja não encontrada.' } }
  return { status: 200, body: data }
}

async function actionEstimate(supabase, query) {
  const productId = String(query.product_id || '').trim()
  if (!isUuid(productId)) return { status: 400, body: { error: 'Produto inválido.' } }
  const state = normState(String(query.state || '').trim())
  if (!state) return { status: 400, body: { error: 'Escolha o estado de entrega.' } }
  const rawZip = String(query.zip || '').trim()
  const zip = rawZip ? normZip(rawZip) : null
  if (rawZip && !zip) return { status: 400, body: { error: 'ZIP code inválido. Use 5 números.' } }
  const qty = clampInt(query.qty, 1, 99, 1)

  const row = check(
    await sellableProducts(supabase, { select: `id, seller_id, price_cents, stock, hazmat, ${SELLER_GATE_EMBED}` })
      .eq('id', productId)
      .maybeSingle(),
    'produto',
  )
  if (!row || !sellerCanSell(row.bc_store_sellers)) return { status: 404, body: { error: 'Esse produto não está à venda.' } }

  const zones = await loadZones(supabase, row.seller_id)
  const units = Math.max(1, Math.min(qty, row.stock || 1))
  const options = deliveryOptions(zones, { state, zip }, units, (row.price_cents || 0) * units, { hazmat: !!row.hazmat })
    .map((o) => ({
      zone_id: o.zone_id,
      method: o.method,
      name: o.name,
      shipping_cents: o.shipping_cents,
      est_days_min: o.est_days_min,
      est_days_max: o.est_days_max,
    }))
  return { status: 200, body: { options } }
}

async function actionConfig(supabase) {
  const [cfg, categories] = await Promise.all([getConfig(supabase), loadCategories(supabase)])
  return { status: 200, body: { config: publicConfig(cfg), categories } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS')
    return err(res, 405, 'Método não permitido.')
  }
  // Leitura publica (a CDN segura a maior parte); limite largo so contra abuso
  const limited = rateLimit(req, { windowMs: 60000, max: 240 })
  if (limited) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', String(limited.retryAfter))
    return err(res, 429, 'Muitas requisições. Tente de novo em instantes.')
  }

  const query = req.query || {}
  const action = String(query.action || '')
  const supabase = getSupabase()
  try {
    let out
    switch (action) {
      case 'home': out = await actionHome(supabase); break
      case 'search': out = await actionSearch(supabase, query); break
      case 'product': out = await actionProduct(supabase, query); break
      case 'seller': out = await actionSeller(supabase, query); break
      case 'estimate': out = await actionEstimate(supabase, query); break
      case 'config': out = await actionConfig(supabase); break
      default:
        res.setHeader('Cache-Control', 'no-store')
        return err(res, 400, 'Ação inválida.')
    }
    const cacheable = out.status === 200 || out.status === 404
    res.setHeader('Cache-Control', cacheable ? PUBLIC_CACHE : 'no-store')
    return res.status(out.status).json(out.body)
  } catch (e) {
    console.error('[store/catalog]', action, e.message)
    res.setHeader('Cache-Control', 'no-store')
    return err(res, 500, 'Não deu para carregar a Store agora. Tente de novo em instantes.')
  }
}
