/**
 * Paginas SSR da BrasilConnect Store (HTML), para SEO e previa no WhatsApp.
 * Contrato: docs/store/ARQUITETURA.md, secao 6.2.
 *
 *   /store/p/:slug       -> ?type=product&slug=   pagina do produto
 *   /store/loja/:slug    -> ?type=shop&slug=      pagina da loja
 *   /store/sitemap.xml   -> ?type=sitemap         sitemap XML
 *
 * Tudo que vem do banco passa por esc() (ou por jsonForHtml dentro de
 * <script>). Os dados da pagina vao em <script type="application/json"
 * id="st-data"> e um script inline liga carrinho, galeria, frete e denuncia
 * (depende de /js/store.js, carregado com defer).
 */
import { getSupabase, getConfig, publicConfig, esc, CONDITION_PT, ORIGIN_PT, US_STATES } from '../_lib/store.js'
import { loadProductPage, loadShopPage, loadSitemap, PRODUCT_SLUG_RE, SELLER_SLUG_RE } from './catalog.js'

const SITE = 'https://brasilconnectusa.com'
const OG_DEFAULT = SITE + '/og-image.png'
const PUBLIC_CACHE = 'public, s-maxage=60, stale-while-revalidate=300'
const PREVIEW_TOKEN = 'brasil2026'

// ─────────────────────────────────────────────────────────────────────────────
// Formatacao
// ─────────────────────────────────────────────────────────────────────────────
function money(cents) {
  const n = Math.round(Number(cents) || 0)
  const parts = (Math.abs(n) / 100).toFixed(2).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (n < 0 ? '-' : '') + '$' + parts.join('.')
}

function fmtDate(iso, opts) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/New_York', ...(opts || { day: 'numeric', month: 'short', year: 'numeric' }) })
  } catch (_) {
    return d.toISOString().slice(0, 10)
  }
}

/** So https (fotos vem do nosso storage). Qualquer outra coisa vira ''. */
function httpsUrl(u) {
  const s = String(u || '').trim()
  return /^https:\/\/[^\s<>"'`]+$/i.test(s) ? s : ''
}

/** Texto curto para meta description (corta na palavra). */
function summary(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '') + '…'
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?'
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** JSON seguro dentro de <script> (sem </script>, sem U+2028/2029). */
function jsonForHtml(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function starsHtml(avg, count) {
  const a = Math.max(0, Math.min(5, Number(avg) || 0))
  const pct = Math.round((a / 5) * 100)
  const num = a.toFixed(1).replace('.', ',')
  const hasCount = count != null && Number.isFinite(Number(count))
  const c = hasCount ? Math.max(0, Math.floor(Number(count))) : 0
  const label = `Nota ${num} de 5` + (hasCount ? ` (${plural(c, 'avaliação', 'avaliações')})` : '')
  return `<span class="st-stars" role="img" aria-label="${esc(label)}">` +
    `<span class="st-stars-track" aria-hidden="true">★★★★★<span class="st-stars-fill" style="width:${pct}%">★★★★★</span></span>` +
    `<span class="st-stars-num" aria-hidden="true">${num}${hasCount ? ` (${c})` : ''}</span></span>`
}

/** Mesmo HTML de BCStore.productCard (public/js/store.js). */
function cardHtml(p, { showSeller = true } = {}) {
  const img = httpsUrl((p.images || [])[0])
  const price = Number(p.price_cents) || 0
  const compare = Number(p.compare_at_cents) || 0
  const soldOut = p.in_stock === false
  return `<a class="st-card${soldOut ? ' is-soldout' : ''}" href="/store/p/${esc(encodeURIComponent(p.slug))}">` +
    '<div class="st-card-media">' +
      (img
        ? `<img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy" decoding="async" width="600" height="600">`
        : '<span class="st-card-noimg" aria-hidden="true"></span>') +
      (soldOut ? '<span class="st-badge st-badge-muted st-card-flag">Esgotado</span>' : '') +
    '</div>' +
    '<div class="st-card-body">' +
      `<h3 class="st-card-title">${esc(p.title)}</h3>` +
      `<div class="st-price-row"><span class="st-price">${money(price)}</span>` +
        (compare > price ? `<s class="st-price-old"><span class="st-sr">Preço anterior: </span>${money(compare)}</s>` : '') +
      '</div>' +
      (showSeller && p.seller && p.seller.name ? `<div class="st-card-seller">${esc(p.seller.name)}</div>` : '') +
      (Number(p.rating_count) > 0 ? starsHtml(p.rating_avg, p.rating_count) : '') +
    '</div>' +
  '</a>'
}

function logoHtml(seller, size) {
  const logo = httpsUrl(seller.logo_url)
  const cls = 'st-logo' + (size === 'lg' ? ' st-logo-lg' : '')
  return logo
    ? `<span class="${cls}"><img src="${esc(logo)}" alt="Logo de ${esc(seller.name)}" loading="lazy" decoding="async"></span>`
    : `<span class="${cls}" aria-hidden="true">${esc(initials(seller.name))}</span>`
}

const METHOD_PT = { ship: 'Envio', local_delivery: 'Entrega local', pickup: 'Retirada com a loja' }

function daysText(min, max, method) {
  const after = method === 'ship' ? ' depois do envio' : ''
  if (min != null && max != null && max > min) return `${min} a ${max} dias${after}`
  const d = max != null ? max : min
  if (d == null) return ''
  return `${plural(d, 'dia', 'dias')}${after}`
}

function statesShort(list) {
  const arr = Array.isArray(list) ? list : []
  if (arr.length >= Object.keys(US_STATES).length) return 'todos os estados'
  if (arr.length > 8) return plural(arr.length, 'estado', 'estados')
  return arr.join(', ')
}

function zoneLine(z, zipHint = false) {
  const parts = [`<strong>${esc(METHOD_PT[z.method] || 'Entrega')}</strong>${z.name ? ' · ' + esc(z.name) : ''}`]
  if (z.method === 'pickup') {
    parts.push('sem custo; o local é combinado depois da compra')
  } else {
    let price = z.rate_first_cents ? money(z.rate_first_cents) : 'grátis'
    if (z.rate_first_cents && z.rate_additional_cents) price += ` + ${money(z.rate_additional_cents)} por item a mais`
    parts.push(esc(price))
    if (z.free_over_cents && z.rate_first_cents) parts.push(`grátis acima de ${esc(money(z.free_over_cents))}`)
  }
  // Entrega local (e retirada com lista de ZIP): so a quantidade de regioes, nunca a lista
  if ((z.method === 'local_delivery' || z.method === 'pickup') && z.zip_count) parts.push(esc(plural(z.zip_count, 'região de ZIP code', 'regiões de ZIP code')) + (zipHint ? ' (o CEP americano)' : ''))
  else if (z.states && z.states.length) parts.push(esc(statesShort(z.states)))
  const days = daysText(z.est_days_min, z.est_days_max, z.method)
  if (days) parts.push(esc(days))
  return parts.join(' · ')
}

function reviewHtml(r) {
  return '<li class="st-review">' +
    '<div class="st-review-head">' +
      `<strong>${esc(r.buyer_name || 'Comprador verificado')}</strong>` +
      starsHtml(r.rating) +
      `<span>${esc(fmtDate(r.created_at))}</span>` +
      '<span class="st-badge st-badge-ok">Compra verificada</span>' +
    '</div>' +
    (r.product_title ? `<p class="st-review-product">Sobre: ${esc(r.product_title)}</p>` : '') +
    (r.body ? `<p class="st-review-body">${esc(r.body)}</p>` : '') +
    (r.seller_reply ? `<div class="st-review-reply"><strong>Resposta da loja</strong>${esc(r.seller_reply)}</div>` : '') +
  '</li>'
}

function policiesHtml(seller, cfg) {
  const hd = Number(seller.handling_days) || 2
  const returns = seller.accepts_returns
    ? (Number(seller.return_window_days) > 0
      ? `Aceita devolução em até ${plural(Number(seller.return_window_days), 'dia', 'dias')} depois da entrega.`
      : 'Aceita devolução. Combine com a loja pela página do pedido.')
    : 'Não aceita devolução por arrependimento.'
  return '<dl class="st-dl">' +
    `<dt>Prazo de postagem</dt><dd>Até ${esc(plural(hd, 'dia útil', 'dias úteis'))} depois do pagamento.</dd>` +
    `<dt>Devolução</dt><dd>${esc(returns)}</dd>` +
    (seller.return_policy ? `<dt>Política de devolução</dt><dd class="st-policy-text">${esc(seller.return_policy)}</dd>` : '') +
    (seller.warranty_policy ? `<dt>Garantia da loja</dt><dd class="st-policy-text">${esc(seller.warranty_policy)}</dd>` : '') +
    `<dt>Garantia BrasilConnect</dt><dd>Não recebeu, veio diferente do anúncio ou com defeito? Abra um problema em até ${esc(plural(Number(cfg.dispute_window_days) || 30, 'dia', 'dias'))} depois da entrega. <a href="/store/regras#garantia">Como funciona</a></dd>` +
  '</dl>'
}

// ─────────────────────────────────────────────────────────────────────────────
// Moldura (head, nav e footer da secao 9)
// ─────────────────────────────────────────────────────────────────────────────
const NAV = `<div class="flag-stripe" aria-hidden="true"></div>
<nav class="bc-nav">
  <a class="bc-logo" href="/">Brasil<em>Connect</em></a>
  <div class="bc-nav-r">
    <a class="bc-nl active" href="/store">Store</a>
    <a class="bc-nl" href="/store/pedidos">Meus pedidos</a>
    <a class="st-nav-cart" href="/store/carrinho" aria-label="Carrinho">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
      <span class="st-nav-count" data-st-cart-count hidden>0</span>
    </a>
    <span class="st-nav-account" data-st-account></span>
    <a class="bc-nl" href="/store/vender">Vender</a>
  </div>
</nav>`

const FOOTER = `<footer class="bc-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="bc-logo" href="/">Brasil<em>Connect</em></a>
        <p class="footer-tagline">A Store da comunidade brasileira nos EUA. Cada loja vende, envia e garante os próprios produtos; a BrasilConnect aprova os anúncios e protege o pagamento.</p>
      </div>
      <div><h4>Comprar</h4><a href="/store">Vitrine</a><a href="/store/pedidos">Meus pedidos</a><a href="/store/regras#garantia">Garantia BrasilConnect</a></div>
      <div><h4>Vender</h4><a href="/store/vender">Abrir minha loja</a><a href="/store/painel">Painel da loja</a><a href="/store/regras#proibidos">Produtos proibidos</a></div>
      <div><h4>BrasilConnect</h4><a href="/">Início</a><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a><a href="mailto:oi@brasilconnectusa.com">Contato</a></div>
    </div>
    <div class="footer-bottom">© 2026 BrasilConnect USA · <a href="/store/regras">Regras da Store</a></div>
  </div>
</footer>`

function layout({ title, description, canonical, robots, image, imageAlt, ogType = 'website', extraHead = '', jsonLd = [], body, data = null, script = '' }) {
  const img = httpsUrl(image) || OG_DEFAULT
  const ld = (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).filter(Boolean)
    .map((o) => `<script type="application/ld+json">${jsonForHtml(o)}</script>`).join('\n')
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta name="robots" content="${esc(robots || 'index, follow, max-image-preview:large')}">
<meta name="theme-color" content="#1F4D3F">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="BrasilConnect Store">
<meta property="og:locale" content="pt_BR">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:alt" content="${esc(imageAlt || title)}">
${extraHead}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/premium.css">
<link rel="stylesheet" href="/css/store.css">
${ld}
<script src="/js/site.js" defer></script>
<script src="/js/store.js" defer></script>
</head>
<body class="has-flag-stripe st-page">
${NAV}
<main id="conteudo" class="st-main">
<div class="st-wrap">
${body}
</div>
</main>
${FOOTER}
${data ? `<script type="application/json" id="st-data">${jsonForHtml(data)}</script>` : ''}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`
}

function closedBanner(cfg, preview) {
  if (cfg.public_enabled || preview) return ''
  return '<div class="st-banner" data-st-closed-banner role="note"><strong>A Store abre em breve.</strong> ' +
    '<span>Os anúncios já estão sendo aprovados, mas as compras ainda não começaram.</span> <a href="/store">Entrar na lista de espera</a></div>'
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagina do produto
// ─────────────────────────────────────────────────────────────────────────────
export function renderProductPage(d, cfg, { preview = false } = {}) {
  const p = d.product
  const s = d.seller
  const canonical = `${SITE}/store/p/${encodeURIComponent(p.slug)}`
  const shopUrl = `/store/loja/${encodeURIComponent(s.slug)}`
  const images = (p.images || []).map(httpsUrl).filter(Boolean)
  const first = images[0] || ''
  const price = Number(p.price_cents) || 0
  const compare = Number(p.compare_at_cents) || 0
  const stock = Math.max(0, Number(p.stock) || 0)
  const loc = [s.city, s.state].filter(Boolean).join(', ')

  const title = `${p.title} · BrasilConnect Store`
  const description = summary(`${money(price)} · vendido por ${s.name}${loc ? ' (' + loc + ')' : ''}. ${p.description || ''}`, 155)

  // Botao do carrinho
  let addLabel = 'Adicionar ao carrinho'
  let addReason = ''
  if (!p.in_stock) { addLabel = 'Esgotado'; addReason = 'soldout' }
  else if (!cfg.checkout_enabled) { addLabel = 'Compras abrem em breve'; addReason = 'closed' }

  let stockHtml
  if (!p.in_stock) stockHtml = '<p class="st-stock is-out">Esgotado no momento</p>'
  else if (stock <= 3) stockHtml = `<p class="st-stock is-low">${stock === 1 ? 'Última unidade' : `Últimas ${stock} unidades`}</p>`
  else stockHtml = '<p class="st-stock is-ok">Em estoque</p>'

  const facts = [
    CONDITION_PT[p.condition] ? `<li class="st-badge">${esc(CONDITION_PT[p.condition])}</li>` : '',
    ORIGIN_PT[p.origin] && p.origin !== 'other' ? `<li class="st-badge">${esc(ORIGIN_PT[p.origin])}</li>` : '',
    d.category ? `<li class="st-badge">${esc(d.category.name)}</li>` : '',
    p.hazmat ? '<li class="st-badge st-badge-warn">Envio só por via terrestre</li>' : '',
  ].join('')

  const gallery = '<section class="st-gallery" aria-label="Fotos do produto">' +
    '<div class="st-gallery-main">' +
      (first
        ? `<img id="st-main-img" src="${esc(first)}" alt="${esc(p.title)}" width="900" height="900" fetchpriority="high" decoding="async">`
        : '<span class="st-card-noimg" aria-hidden="true"></span>') +
    '</div>' +
    (images.length > 1
      ? '<div class="st-thumbs">' + images.map((u, i) =>
        `<button type="button" class="st-thumb" data-i="${i}" aria-pressed="${i === 0 ? 'true' : 'false'}" aria-label="Ver foto ${i + 1} de ${images.length}">` +
          `<img src="${esc(u)}" alt="" loading="lazy" decoding="async" width="72" height="72"></button>`).join('') + '</div>'
      : '') +
  '</section>'

  const stateOptions = '<option value="">Escolha o estado</option>' +
    Object.keys(US_STATES).sort((a, b) => US_STATES[a].localeCompare(US_STATES[b]))
      .map((c) => `<option value="${c}">${esc(US_STATES[c])} (${c})</option>`).join('')

  const ships = d.ships_to || []
  const shipBox = '<div class="st-panel st-ship" aria-labelledby="st-h-ship">' +
    '<h2 class="st-panel-title" id="st-h-ship">Entrega</h2>' +
    `<p class="st-small st-muted" style="margin:0">A loja posta em até ${esc(plural(Number(s.handling_days) || 2, 'dia útil', 'dias úteis'))} depois do pagamento.` +
      (ships.length ? ` Atende: ${esc(statesShort(ships))}.` : '') + '</p>' +
    '<form class="st-ship-form" id="st-ship-form" novalidate>' +
      `<div class="st-field"><label for="st-ship-state">Estado</label><select id="st-ship-state" class="st-select" autocomplete="address-level1">${stateOptions}</select></div>` +
      '<div class="st-field"><label for="st-ship-zip">ZIP code <span class="st-muted">(o CEP americano)</span></label><input id="st-ship-zip" class="st-input" inputmode="numeric" autocomplete="postal-code" maxlength="10" placeholder="Opcional"></div>' +
      '<button type="submit" class="btn btn-secondary">Calcular frete</button>' +
    '</form>' +
    '<div id="st-ship-out" aria-live="polite"></div>' +
    (d.delivery && d.delivery.length
      ? '<ul class="st-zones">' + d.delivery.map((z) => `<li>${zoneLine(z)}</li>`).join('') + '</ul>'
      : '<p class="st-small st-muted">Esta loja ainda não cadastrou regiões de entrega.</p>') +
  '</div>'

  const buy = '<section class="st-buy" aria-labelledby="st-h-title">' +
    `<h1 class="st-product-title" id="st-h-title">${esc(p.title)}</h1>` +
    '<p class="st-byline">' +
      `<span>Vendido por <a href="${esc(shopUrl)}">${esc(s.name)}</a>${loc ? ' · ' + esc(loc) : ''}</span>` +
      (Number(p.rating_count) > 0 ? `<a href="#st-h-reviews" class="st-nowrap" style="text-decoration:none">${starsHtml(p.rating_avg, p.rating_count)}</a>` : '') +
    '</p>' +
    '<div class="st-price-row st-price-lg">' +
      `<span class="st-price">${money(price)}</span>` +
      (compare > price ? `<s class="st-price-old"><span class="st-sr">Preço anterior: </span>${money(compare)}</s>` : '') +
    '</div>' +
    (facts ? `<ul class="st-facts">${facts}</ul>` : '') +
    stockHtml +
    '<form class="st-buy-form" id="st-buy-form" novalidate>' +
      '<div class="st-qty" role="group" aria-label="Quantidade">' +
        '<button type="button" data-qty="-1" aria-label="Diminuir quantidade">−</button>' +
        `<input id="st-qty" type="number" inputmode="numeric" min="1" max="${Math.max(1, Math.min(99, stock))}" value="1" aria-label="Quantidade"${p.in_stock ? '' : ' disabled'}>` +
        '<button type="button" data-qty="1" aria-label="Aumentar quantidade">+</button>' +
      '</div>' +
      `<button type="submit" class="btn btn-primary" id="st-add" data-reason="${addReason}"${addReason ? ' disabled' : ''}>${esc(addLabel)}</button>` +
    '</form>' +
    '<p class="st-buy-msg" id="st-buy-msg" role="status"></p>' +
    `<p class="st-transparency">Vendido, enviado e garantido por <strong>${esc(s.name)}</strong>. A BrasilConnect aprova o anúncio e só repassa o pagamento à loja depois da entrega. <a href="/store/regras#garantia">Garantia BrasilConnect</a></p>` +
    shipBox +
  '</section>'

  const descSection = '<section class="st-section" aria-labelledby="st-h-desc">' +
    '<h2 id="st-h-desc">Descrição</h2>' +
    `<div class="st-desc">${esc(p.description || '')}</div>` +
    (p.tags && p.tags.length ? '<ul class="st-tags" aria-label="Etiquetas">' + p.tags.slice(0, 12).map((t) => `<li class="st-badge st-badge-muted">${esc(t)}</li>`).join('') + '</ul>' : '') +
  '</section>'

  const memberSince = fmtDate(s.member_since, { month: 'short', year: 'numeric' })
  const sellerSection = '<section class="st-section" aria-labelledby="st-h-seller">' +
    '<h2 id="st-h-seller">Sobre a loja</h2>' +
    '<div class="st-panel st-seller-card">' +
      '<div class="st-seller-top">' + logoHtml(s) +
        '<div style="min-width:0">' +
          `<h3><a href="${esc(shopUrl)}">${esc(s.name)}</a></h3>` +
          '<div class="st-seller-meta">' +
            (loc ? `<span>${esc(loc)}</span>` : '') +
            (memberSince ? `<span>Na Store desde ${esc(memberSince)}</span>` : '') +
            (s.sales_count ? `<span>${esc(plural(s.sales_count, 'venda', 'vendas'))}</span>` : '') +
            (Number(s.rating_count) > 0 ? starsHtml(s.rating_avg, s.rating_count) : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      (s.tagline ? `<p class="st-small" style="margin:0">${esc(s.tagline)}</p>` : '') +
      policiesHtml(s, cfg) +
      `<div><a class="btn btn-secondary st-btn-sm" href="${esc(shopUrl)}">Ver todos os produtos da loja</a></div>` +
    '</div>' +
  '</section>'

  const reviews = d.reviews || []
  const reviewsSection = '<section class="st-section" aria-labelledby="st-h-reviews">' +
    `<div class="st-head"><h2 id="st-h-reviews">Avaliações</h2>${Number(p.rating_count) > 0 ? starsHtml(p.rating_avg, p.rating_count) : ''}</div>` +
    (reviews.length
      ? '<ul class="st-reviews">' + reviews.map(reviewHtml).join('') + '</ul>'
      : '<p class="st-muted">Ainda sem avaliações. Só quem compra pela Store pode avaliar.</p>') +
  '</section>'

  const related = d.related || []
  const relatedSection = related.length
    ? '<section class="st-section" aria-labelledby="st-h-related"><h2 id="st-h-related">Você também pode gostar</h2>' +
      '<ul class="st-grid st-grid-4">' + related.map((r) => `<li>${cardHtml(r)}</li>`).join('') + '</ul></section>'
    : ''

  const crumbs = '<nav class="st-crumbs" aria-label="Você está em">' +
    '<a href="/store">Store</a><span aria-hidden="true">/</span>' +
    (d.category ? `<a href="/store?cat=${esc(encodeURIComponent(d.category.slug))}">${esc(d.category.name)}</a><span aria-hidden="true">/</span>` : '') +
    `<span aria-current="page">${esc(p.title)}</span></nav>`

  const body = closedBanner(cfg, preview) + crumbs +
    `<div class="st-product">${gallery}${buy}</div>` +
    descSection + sellerSection + reviewsSection + relatedSection +
    '<p class="st-report-row">Viu algo errado neste anúncio? <button type="button" class="st-linkbtn" id="st-report">Denunciar anúncio</button></p>'

  const offer = {
    '@type': 'Offer',
    url: canonical,
    price: (price / 100).toFixed(2),
    priceCurrency: 'USD',
    availability: p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: p.condition === 'used_like_new' || p.condition === 'used_good' ? 'https://schema.org/UsedCondition' : 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: s.name, url: `${SITE}${shopUrl}` },
  }
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: summary(p.description, 5000),
    url: canonical,
    image: images.length ? images : undefined,
    category: d.category ? d.category.name : undefined,
    offers: offer,
  }
  if (Number(p.rating_count) > 0 && p.rating_avg != null) {
    productLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(p.rating_avg).toFixed(1),
      reviewCount: Number(p.rating_count),
      bestRating: '5',
      worstRating: '1',
    }
  }
  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Store', item: `${SITE}/store` },
      ...(d.category ? [{ '@type': 'ListItem', position: 2, name: d.category.name, item: `${SITE}/store?cat=${encodeURIComponent(d.category.slug)}` }] : []),
      { '@type': 'ListItem', position: d.category ? 3 : 2, name: p.title, item: canonical },
    ],
  }

  return layout({
    title,
    description,
    canonical,
    robots: cfg.public_enabled ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    image: first,
    imageAlt: p.title,
    ogType: 'product',
    extraHead: `<meta property="product:price:amount" content="${(price / 100).toFixed(2)}">\n<meta property="product:price:currency" content="USD">\n<meta property="product:availability" content="${p.in_stock ? 'in stock' : 'out of stock'}">`,
    jsonLd: [productLd, crumbLd],
    body,
    data: {
      type: 'product',
      // So as fotos que passaram no filtro (mesmos indices dos botoes da galeria)
      product: { ...p, images },
      seller: { id: s.id, slug: s.slug, name: s.name },
      delivery: d.delivery || [],
      ships_to: ships,
      config: { public_enabled: !!cfg.public_enabled, checkout_enabled: !!cfg.checkout_enabled },
    },
    script: PAGE_SCRIPT,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagina da loja
// ─────────────────────────────────────────────────────────────────────────────
export function renderShopPage(d, cfg, { preview = false } = {}) {
  const s = d.seller
  const canonical = `${SITE}/store/loja/${encodeURIComponent(s.slug)}`
  const loc = [s.city, s.state].filter(Boolean).join(', ')
  const banner = httpsUrl(s.banner_url)
  const logo = httpsUrl(s.logo_url)
  const products = d.products || []
  const memberSince = fmtDate(s.member_since, { month: 'short', year: 'numeric' })

  const title = `${s.name} · BrasilConnect Store`
  const description = summary(
    `${s.tagline || s.bio || `Loja brasileira${loc ? ' em ' + loc : ''} na BrasilConnect Store.`} ${products.length ? plural(products.length, 'produto', 'produtos') + ' à venda.' : ''}`,
    155,
  )

  let notice = ''
  if (s.vacation_mode) notice = '<div class="st-banner" role="note"><strong>Loja de férias.</strong> <span>Os produtos voltam quando a loja reabrir.</span></div>'
  else if (!products.length) notice = '<div class="st-banner" role="note"><strong>Sem produtos à venda agora.</strong> <span>Volte daqui a pouco.</span></div>'

  const head = `<div class="st-shop-cover"${banner ? ` style="background-image:url(&quot;${esc(banner)}&quot;)"` : ''} aria-hidden="true"></div>` +
    '<div class="st-shop-head">' + logoHtml(s, 'lg') +
      '<div class="st-shop-title">' +
        `<h1>${esc(s.name)}</h1>` +
        (s.tagline ? `<p class="st-shop-tagline">${esc(s.tagline)}</p>` : '') +
        '<div class="st-shop-meta">' +
          (loc ? `<span>${esc(loc)}</span>` : '') +
          (memberSince ? `<span>Na Store desde ${esc(memberSince)}</span>` : '') +
          (Number(s.rating_count) > 0 ? starsHtml(s.rating_avg, s.rating_count) : '') +
          (s.sales_count ? `<span>${esc(plural(s.sales_count, 'venda concluída', 'vendas concluídas'))}</span>` : '') +
        '</div>' +
      '</div>' +
    '</div>'

  const cats = d.categories || []
  const chips = cats.length > 1
    ? '<div class="st-chips" role="group" aria-label="Filtrar por categoria" style="margin-bottom:16px">' +
      `<button type="button" class="st-chip" data-shop-cat="" aria-pressed="true">Todos <span class="st-chip-count">${products.length}</span></button>` +
      cats.map((c) => `<button type="button" class="st-chip" data-shop-cat="${esc(c.slug)}" aria-pressed="false">${esc(c.name)} <span class="st-chip-count">${Number(c.count) || 0}</span></button>`).join('') +
      '</div>'
    : ''

  const productsSection = '<section aria-labelledby="st-h-products">' +
    `<div class="st-head"><h2 id="st-h-products">Produtos</h2><span class="st-small st-muted" id="st-shop-count" aria-live="polite">${esc(plural(products.length, 'produto', 'produtos'))}</span></div>` +
    chips +
    (products.length
      ? '<ul class="st-grid" id="st-shop-grid">' + products.map((p) => `<li data-cat="${esc(p.category_slug)}">${cardHtml(p, { showSeller: false })}</li>`).join('') + '</ul>'
      : '<div class="st-empty"><p>Nenhum produto à venda nesta loja agora.</p><p><a class="btn btn-secondary" href="/store">Ver a vitrine</a></p></div>') +
  '</section>'

  const zones = d.delivery || []
  // Primeira mencao a ZIP code na pagina leva a dica "(o CEP americano)"
  const hintIdx = zones.findIndex((z) => (z.method === 'local_delivery' || z.method === 'pickup') && z.zip_count)
  const aside = '<aside aria-label="Informações da loja">' +
    (s.bio ? `<div class="st-panel"><h2 class="st-panel-title">Sobre a loja</h2><p class="st-desc" style="font-size:14px">${esc(s.bio)}</p></div>` : '') +
    `<div class="st-panel"><h2 class="st-panel-title">Políticas</h2>${policiesHtml(s, cfg)}</div>` +
    '<div class="st-panel"><h2 class="st-panel-title">Regiões atendidas</h2>' +
      (zones.length
        ? '<ul class="st-zones">' + zones.map((z, i) => `<li>${zoneLine(z, i === hintIdx)}</li>`).join('') + '</ul>'
        : '<p class="st-small st-muted" style="margin:0">A loja ainda não cadastrou regiões de entrega.</p>') +
    '</div>' +
    `<p class="st-transparency">Cada produto é vendido, enviado e garantido por <strong>${esc(s.name)}</strong>. A BrasilConnect aprova os anúncios e só repassa o pagamento à loja depois da entrega.</p>` +
  '</aside>'

  const reviews = d.reviews || []
  const reviewsSection = '<section class="st-section" aria-labelledby="st-h-reviews">' +
    `<div class="st-head"><h2 id="st-h-reviews">Avaliações da loja</h2>${Number(s.rating_count) > 0 ? starsHtml(s.rating_avg, s.rating_count) : ''}</div>` +
    (reviews.length
      ? '<ul class="st-reviews">' + reviews.map(reviewHtml).join('') + '</ul>'
      : '<p class="st-muted">Ainda sem avaliações. Só quem compra pela Store pode avaliar.</p>') +
  '</section>'

  const body = closedBanner(cfg, preview) +
    '<nav class="st-crumbs" aria-label="Você está em"><a href="/store">Store</a><span aria-hidden="true">/</span>' +
      `<span aria-current="page">${esc(s.name)}</span></nav>` +
    head + notice +
    `<div class="st-shop-layout">${productsSection}${aside}</div>` +
    reviewsSection

  const storeLd = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: s.name,
    description: summary(s.tagline || s.bio || '', 300) || undefined,
    url: canonical,
    image: logo || banner || undefined,
    address: s.city || s.state
      ? { '@type': 'PostalAddress', addressLocality: s.city || undefined, addressRegion: s.state || undefined, addressCountry: 'US' }
      : undefined,
  }
  if (Number(s.rating_count) > 0 && s.rating_avg != null) {
    storeLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(s.rating_avg).toFixed(1),
      reviewCount: Number(s.rating_count),
      bestRating: '5',
      worstRating: '1',
    }
  }

  return layout({
    title,
    description,
    canonical,
    robots: cfg.public_enabled ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    image: banner || logo || (products[0] && products[0].images && products[0].images[0]),
    imageAlt: s.name,
    jsonLd: [storeLd],
    body,
    data: {
      type: 'shop',
      seller: { id: s.id, slug: s.slug, name: s.name },
      config: { public_enabled: !!cfg.public_enabled, checkout_enabled: !!cfg.checkout_enabled },
    },
    script: PAGE_SCRIPT,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 404 e erro
// ─────────────────────────────────────────────────────────────────────────────
export function renderNotFound(kind) {
  const what = kind === 'shop' ? 'Loja não encontrada' : kind === 'product' ? 'Produto não encontrado' : 'Página não encontrada'
  const text = kind === 'shop'
    ? 'Esse endereço não corresponde a nenhuma loja aprovada na Store.'
    : 'Esse anúncio não existe, saiu do ar ou a loja está temporariamente fechada.'
  return layout({
    title: `${what} · BrasilConnect Store`,
    description: text,
    canonical: '',
    robots: 'noindex, follow',
    body: `<div class="st-empty"><h1 style="font-size:28px">${esc(what)}</h1><p>${esc(text)}</p>` +
      '<p><a class="btn btn-primary" href="/store">Ver a vitrine</a></p></div>',
  })
}

function renderError() {
  return layout({
    title: 'Não deu para carregar · BrasilConnect Store',
    description: 'Não deu para carregar a página agora.',
    canonical: '',
    robots: 'noindex, follow',
    body: '<div class="st-empty"><h1 style="font-size:28px">Não deu para carregar</h1>' +
      '<p>Tivemos um problema para abrir esta página. Tente de novo em instantes.</p>' +
      '<p><a class="btn btn-primary" href="/store">Voltar para a vitrine</a></p></div>',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Sitemap
// ─────────────────────────────────────────────────────────────────────────────
function sitemapXml(entries) {
  const urls = entries.map((e) => '  <url><loc>' + esc(e.loc) + '</loc>' +
    (e.lastmod ? '<lastmod>' + esc(String(e.lastmod).slice(0, 10)) + '</lastmod>' : '') +
    (e.changefreq ? '<changefreq>' + e.changefreq + '</changefreq>' : '') +
    '</url>').join('\n')
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n'
}

// ─────────────────────────────────────────────────────────────────────────────
// Script inline das paginas (sem template string: so aspas simples)
// ─────────────────────────────────────────────────────────────────────────────
const PAGE_SCRIPT = String.raw`
(function () {
  'use strict'
  function init() {
    var S = window.BCStore
    var dataEl = document.getElementById('st-data')
    if (!S || !dataEl) return
    var data
    try { data = JSON.parse(dataEl.textContent) } catch (e) { return }
    var preview = S.isPreview()

    // Na previa, a faixa "abre em breve" vira aviso de previa
    var banner = document.querySelector('[data-st-closed-banner]')
    if (banner && preview) banner.innerHTML = '<strong>Modo prévia.</strong> <span>A Store ainda está fechada ao público.</span>'

    if (data.type === 'product') initProduct(S, data, preview)
    if (data.type === 'shop') initShop()
  }

  function initProduct(S, data, preview) {
    var p = data.product || {}
    var images = (p.images || []).map(S.safeUrl).filter(Boolean)

    // Galeria
    var main = document.getElementById('st-main-img')
    var thumbs = Array.prototype.slice.call(document.querySelectorAll('.st-thumb'))
    thumbs.forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-i')) || 0
        if (!main || !images[i]) return
        main.src = images[i]
        main.alt = p.title + ' (foto ' + (i + 1) + ')'
        thumbs.forEach(function (t) { t.setAttribute('aria-pressed', t === b ? 'true' : 'false') })
      })
    })

    // Quantidade
    var qty = document.getElementById('st-qty')
    var maxQty = Math.max(1, Math.min(99, Number(p.stock) || 1))
    var minus = document.querySelector('[data-qty="-1"]')
    var plus = document.querySelector('[data-qty="1"]')
    function curQty() { return Math.max(1, Math.min(maxQty, Math.floor(Number(qty && qty.value) || 1))) }
    function setQty(n) {
      n = Math.max(1, Math.min(maxQty, Math.floor(Number(n) || 1)))
      if (qty) qty.value = String(n)
      if (minus) minus.disabled = n <= 1 || !p.in_stock
      if (plus) plus.disabled = n >= maxQty || !p.in_stock
    }
    setQty(1)
    ;[minus, plus].forEach(function (b) {
      if (!b) return
      b.addEventListener('click', function () {
        setQty(curQty() + Number(b.getAttribute('data-qty')))
        if (lastEstimate) estimate()
      })
    })
    if (qty) qty.addEventListener('change', function () { setQty(qty.value); if (lastEstimate) estimate() })

    // Carrinho
    var add = document.getElementById('st-add')
    var msg = document.getElementById('st-buy-msg')
    var form = document.getElementById('st-buy-form')
    if (add && add.getAttribute('data-reason') === 'closed' && preview && p.in_stock) {
      add.disabled = false
      add.textContent = 'Adicionar ao carrinho'
      if (msg) msg.textContent = 'Prévia: as compras ainda estão fechadas ao público.'
    }
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault()
        if (!add || add.disabled) return
        if (S.cart.add(p, curQty()) && msg) {
          msg.innerHTML = 'Adicionado ao carrinho. <a href="/store/carrinho">Ver carrinho</a>'
          S.toast('Adicionado ao carrinho.', 'ok')
        }
      })
    }

    // Frete
    var METHOD = { ship: 'Envio', local_delivery: 'Entrega local', pickup: 'Retirada com a loja' }
    var shipForm = document.getElementById('st-ship-form')
    var stateSel = document.getElementById('st-ship-state')
    var zipIn = document.getElementById('st-ship-zip')
    var out = document.getElementById('st-ship-out')
    var hasLocal = (data.delivery || []).some(function (z) { return z.method === 'local_delivery' || (z.method === 'pickup' && z.zip_count) })
    var lastEstimate = false
    var reqSeq = 0
    function stateName(code) {
      for (var i = 0; i < S.states.length; i++) if (S.states[i].code === code) return S.states[i].name
      return code
    }
    function daysText(o) {
      var a = o.est_days_min, b = o.est_days_max
      var after = o.method === 'ship' ? ' depois do envio' : ''
      if (a != null && b != null && b > a) return a + ' a ' + b + ' dias' + after
      var d = b != null ? b : a
      if (d == null) return ''
      return d + (d === 1 ? ' dia' : ' dias') + after
    }
    function estimate() {
      if (!stateSel || !out) return
      var st = stateSel.value
      var zip = String(zipIn ? zipIn.value : '').trim()
      if (!st) { out.innerHTML = '<p class="st-msg is-err">Escolha o estado.</p>'; stateSel.focus(); return }
      if (zip && !/^\d{5}(-?\d{4})?$/.test(zip)) { out.innerHTML = '<p class="st-msg is-err">ZIP code inválido. Use 5 números.</p>'; zipIn.focus(); return }
      S.shipTo.set({ state: st, zip: zip })
      lastEstimate = true
      var seq = ++reqSeq
      out.innerHTML = '<p class="st-small st-muted">Calculando…</p>'
      var qs = 'action=estimate&product_id=' + encodeURIComponent(p.id) + '&state=' + encodeURIComponent(st) +
        (zip ? '&zip=' + encodeURIComponent(zip) : '') + '&qty=' + encodeURIComponent(curQty())
      S.api('/api/store/catalog?' + qs, { auth: false }).then(function (d) {
        if (seq !== reqSeq) return
        var opts = (d && d.options) || []
        if (!opts.length) {
          out.innerHTML = '<p class="st-msg is-err">Esta loja não entrega em ' + S.esc(stateName(st)) + (zip ? ' (ZIP code ' + S.esc(zip) + ')' : '') + '.</p>' +
            (hasLocal && !zip ? '<p class="st-small st-muted">Se você mora perto da loja, informe o ZIP code para ver as opções da sua região.</p>' : '')
          return
        }
        out.innerHTML = '<ul class="st-options">' + opts.map(function (o) {
          var price = o.method === 'pickup' ? 'Sem custo' : (o.shipping_cents > 0 ? S.money(o.shipping_cents) : 'Grátis')
          var days = daysText(o)
          return '<li class="st-option"><span><span class="st-option-name">' + S.esc(METHOD[o.method] || 'Entrega') + '</span>' +
            '<span class="st-option-sub">' + S.esc(o.name || '') + (days ? ' · ' + S.esc(days) : '') + '</span></span>' +
            '<span class="st-option-price">' + S.esc(price) + '</span></li>'
        }).join('') + '</ul>' +
          (hasLocal && !zip ? '<p class="st-small st-muted">Informe o ZIP code para ver também as opções da sua região.</p>' : '')
      }).catch(function (err) {
        if (seq !== reqSeq) return
        out.innerHTML = '<p class="st-msg is-err">' + S.esc(err.message) + '</p>'
      })
    }
    if (shipForm) {
      var saved = S.shipTo.get()
      if (saved.state && stateSel) stateSel.value = saved.state
      if (saved.zip && zipIn) zipIn.value = saved.zip
      shipForm.addEventListener('submit', function (e) { e.preventDefault(); estimate() })
      if (saved.state) estimate()
    }

    // Denuncia
    var reportBtn = document.getElementById('st-report')
    var REASONS = [
      ['prohibited', 'Produto proibido na Store'],
      ['counterfeit', 'Falsificado ou réplica'],
      ['misleading', 'Anúncio enganoso'],
      ['offensive', 'Conteúdo ofensivo'],
      ['scam', 'Golpe ou fraude'],
      ['other', 'Outro motivo'],
    ]
    if (reportBtn) {
      reportBtn.addEventListener('click', function () {
        S.login({ reason: 'Entre na sua conta para denunciar este anúncio.' }).then(function (u) {
          if (!u) return
          var html = '<p class="st-modal-lede">Conte o que está errado em "' + S.esc(p.title) + '". A equipe da BrasilConnect analisa toda denúncia. A loja não fica sabendo quem denunciou.</p>' +
            '<form class="st-form" novalidate>' +
              '<div class="st-field"><label for="st-rep-reason">Motivo</label><select id="st-rep-reason" class="st-select" required>' +
                '<option value="">Escolha o motivo</option>' +
                REASONS.map(function (r) { return '<option value="' + r[0] + '">' + S.esc(r[1]) + '</option>' }).join('') +
              '</select></div>' +
              '<div class="st-field"><label for="st-rep-details">Detalhes <span class="st-muted">(opcional)</span></label>' +
                '<textarea id="st-rep-details" class="st-textarea" maxlength="2000" rows="4"></textarea></div>' +
              '<div class="st-alert st-alert-err" data-err role="alert" hidden></div>' +
              '<button type="submit" class="btn btn-primary st-btn-block">Enviar denúncia</button>' +
            '</form>'
          var m = S.modal({ title: 'Denunciar anúncio', html: html, initialFocus: '#st-rep-reason' })
          var f = m.body.querySelector('form')
          var errBox = m.body.querySelector('[data-err]')
          var btn = f.querySelector('button[type="submit"]')
          f.addEventListener('submit', function (e) {
            e.preventDefault()
            var reason = m.body.querySelector('#st-rep-reason').value
            var details = String(m.body.querySelector('#st-rep-details').value || '').trim()
            errBox.hidden = true
            if (!reason) { errBox.textContent = 'Escolha o motivo da denúncia.'; errBox.hidden = false; return }
            if (reason === 'other' && details.length < 10) { errBox.textContent = 'Conte em poucas palavras o que está errado.'; errBox.hidden = false; return }
            btn.disabled = true
            btn.textContent = 'Enviando…'
            S.api('/api/store/buyer?action=report', { method: 'POST', body: { product_id: p.id, reason: reason, details: details } })
              .then(function () {
                m.close()
                S.toast('Denúncia enviada. Obrigado por avisar.', 'ok')
              })
              .catch(function (err) {
                errBox.textContent = err.message
                errBox.hidden = false
                btn.disabled = false
                btn.textContent = 'Enviar denúncia'
              })
          })
        })
      })
    }
  }

  function initShop() {
    var chips = Array.prototype.slice.call(document.querySelectorAll('[data-shop-cat]'))
    var count = document.getElementById('st-shop-count')
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        var cat = c.getAttribute('data-shop-cat')
        var n = 0
        chips.forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false') })
        document.querySelectorAll('#st-shop-grid > li').forEach(function (li) {
          var show = !cat || li.getAttribute('data-cat') === cat
          li.hidden = !show
          if (show) n++
        })
        if (count) count.textContent = n + (n === 1 ? ' produto' : ' produtos')
      })
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
`

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
function sendHtml(res, status, html, cache) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', cache)
  return res.status(status).send(html)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS')
    return sendHtml(res, 405, renderNotFound('page'), 'no-store')
  }
  const query = req.query || {}
  const type = String(query.type || '')
  const slug = String(query.slug || '').trim().toLowerCase()
  const preview = String(query.preview || '') === PREVIEW_TOKEN
  const supabase = getSupabase()

  try {
    if (type === 'sitemap') {
      const cfg = await getConfig(supabase)
      const entries = [
        { loc: `${SITE}/store`, changefreq: 'daily' },
        { loc: `${SITE}/store/regras`, changefreq: 'monthly' },
      ]
      // Antes de abrir ao publico, so as paginas institucionais
      if (cfg.public_enabled) {
        const { products, shops } = await loadSitemap(supabase)
        for (const sh of shops) entries.push({ loc: `${SITE}/store/loja/${encodeURIComponent(sh.slug)}`, lastmod: sh.lastmod, changefreq: 'weekly' })
        for (const p of products) entries.push({ loc: `${SITE}/store/p/${encodeURIComponent(p.slug)}`, lastmod: p.lastmod, changefreq: 'weekly' })
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
      return res.status(200).send(sitemapXml(entries))
    }

    if (type === 'product') {
      if (!PRODUCT_SLUG_RE.test(slug)) return sendHtml(res, 404, renderNotFound('product'), PUBLIC_CACHE)
      const [data, cfgRaw] = await Promise.all([loadProductPage(supabase, slug), getConfig(supabase)])
      if (!data) return sendHtml(res, 404, renderNotFound('product'), PUBLIC_CACHE)
      return sendHtml(res, 200, renderProductPage(data, publicConfig(cfgRaw), { preview }), PUBLIC_CACHE)
    }

    if (type === 'shop') {
      if (!SELLER_SLUG_RE.test(slug)) return sendHtml(res, 404, renderNotFound('shop'), PUBLIC_CACHE)
      const [data, cfgRaw] = await Promise.all([loadShopPage(supabase, slug), getConfig(supabase)])
      if (!data) return sendHtml(res, 404, renderNotFound('shop'), PUBLIC_CACHE)
      return sendHtml(res, 200, renderShopPage(data, publicConfig(cfgRaw), { preview }), PUBLIC_CACHE)
    }

    return sendHtml(res, 404, renderNotFound('page'), PUBLIC_CACHE)
  } catch (e) {
    console.error('[store/page]', type, slug, e.message)
    if (type === 'sitemap') {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(500).send('')
    }
    return sendHtml(res, 500, renderError(), 'no-store')
  }
}
