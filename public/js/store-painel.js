/**
 * Painel do vendedor da BrasilConnect Store (/store/painel).
 *
 * Uso:  BCStorePainel.mount(container)
 * Depende de window.BCStore (public/js/store.js): ready, onAuth, login, api, esc, safeUrl,
 * money, fmtDate, toast, states, uploadImage.
 *
 * Abas por ?aba= (visao, pedidos, produtos, entregas, recebimentos, loja, avaliacoes).
 * ?pedido=<id> abre o detalhe do pedido. ?store_stripe=done|refresh e a volta do cadastro
 * no Stripe (sincroniza e avisa). Render por innerHTML com esc() em todo dado; eventos
 * delegados por data-act. CSS proprio com prefixo sp- (alem do store.css).
 */
(function () {
  'use strict'

  var API = '/api/store/seller?action='
  var TABS = [
    ['visao', 'Visão geral'],
    ['pedidos', 'Pedidos'],
    ['produtos', 'Produtos'],
    ['entregas', 'Entregas'],
    ['recebimentos', 'Recebimentos'],
    ['loja', 'Loja'],
    ['avaliacoes', 'Avaliações'],
  ]
  var TAB_KEYS = TABS.map(function (t) { return t[0] })

  var SELLER_ST = { pending: ['Em análise', 'warn'], approved: ['Aprovada', 'ok'], rejected: ['Reprovada', 'err'], suspended: ['Suspensa', 'err'] }
  var PRODUCT_ST = {
    draft: ['Rascunho', 'muted'], pending_review: ['Em análise', 'warn'], approved: ['Aprovado', 'ok'],
    rejected: ['Reprovado', 'err'], paused: ['Pausado', 'muted'], suspended: ['Suspenso', 'err'], archived: ['Arquivado', 'muted'],
  }
  var PRODUCT_FILTERS = [['all', 'Todos'], ['draft', 'Rascunhos'], ['pending_review', 'Em análise'], ['approved', 'Aprovados'], ['rejected', 'Reprovados'], ['paused', 'Pausados'], ['archived', 'Arquivados']]
  var ORDER_FILTERS = [['to_ship', 'A enviar'], ['open', 'Em andamento'], ['done', 'Concluídos'], ['all', 'Todos']]
  var ORDER_KIND = { paid: 'warn', shipped: 'ok', delivered: 'ok', completed: 'ok', canceled: 'muted', refunded: 'muted' }
  var PAYOUT_ST = {
    pending: ['A receber', 'warn'], held: ['Retido', 'err'], blocked: ['Aguardando Stripe', 'err'],
    releasing: ['Repasse em processamento', 'warn'],
    released: ['Pago', 'ok'], reversed: ['Estornado', 'muted'], none: ['Sem repasse', 'muted'],
  }
  // Motivo do Stripe em PT (chave fora do mapa: nao mostra nada)
  var STRIPE_REASON = {
    'requirements.past_due': 'Prazo para enviar dados venceu',
    'requirements.pending_verification': 'Documentos em verificação',
    listed: 'Conta em análise pelo Stripe',
    under_review: 'Conta em análise pelo Stripe',
    platform_paused: 'Pausada pela BrasilConnect',
  }
  var DISPUTE_ST = {
    open: 'Problema aberto pelo comprador', escalated: 'Em análise pela BrasilConnect', chargeback: 'Contestação no cartão',
    resolved_refund: 'Problema resolvido com reembolso', resolved_release: 'Problema resolvido a favor da loja',
  }
  var ACTIVE_DISPUTES = ['open', 'escalated', 'chargeback']
  var DISPUTE_REASON = { not_received: 'Não recebi', not_as_described: 'Diferente do anúncio', damaged: 'Chegou com defeito ou avariado', other: 'Outro problema' }
  var LABEL_ST = { purchasing: 'Etiqueta em processamento', purchased: 'Etiqueta comprada', failed: 'Etiqueta falhou', refund_requested: 'Etiqueta cancelada', refunded: 'Etiqueta reembolsada' }
  var ACTOR = { buyer: 'Comprador', seller: 'Sua loja', admin: 'BrasilConnect', system: 'Store', stripe: 'Pagamento', shippo: 'Rastreio' }
  var METHOD = { ship: 'Envio por transportadora', local_delivery: 'Entrega local', pickup: 'Retirada' }
  var FULFILL = { ship: 'Envio pela transportadora', local_delivery: 'Entrega local', pickup: 'Retirada com a loja' }
  var CONDITION = { new: 'Novo', used_like_new: 'Usado · como novo', used_good: 'Usado · bom estado', handmade: 'Feito à mão' }
  var ORIGIN = { handmade: 'Feito à mão', made_in_usa: 'Feito nos EUA', imported_brazil: 'Importado do Brasil', other: 'Outro' }
  var CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Outro']
  var STATE_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']

  var ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>'
  var ICON_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'
  var ICON_PLUS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'

  var el = null
  var S = null
  var pollTimer = null
  var lastUserId

  // ── Utilitarios ──────────────────────────────────────────────────────────
  function B() { return window.BCStore }
  function esc(s) { return B().esc(s) }
  function safeUrl(u) { return B().safeUrl(u) }
  function money(c) { return B().money(c) }
  function date(iso, opts) { return B().fmtDate(iso, opts) }
  function dateTime(iso) {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    } catch (_) { return date(iso) }
  }
  function toast(msg, kind) { B().toast(msg, kind) }
  function badge(text, kind) { return '<span class="st-badge st-badge-' + (kind || 'muted') + '">' + esc(text) + '</span>' }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')) }
  function dollars(c) { return c == null || c === '' ? '' : (Number(c) / 100).toFixed(2) }
  /** "12,50" / "$12.50" -> 1250. '' -> null. Invalido -> NaN. */
  function toCents(v) {
    var s = String(v == null ? '' : v).trim().replace(/[$\s]/g, '').replace(',', '.')
    if (!s) return null
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN
    return Math.round(parseFloat(s) * 100)
  }
  function intOrNull(v) {
    var s = String(v == null ? '' : v).trim()
    if (!s) return null
    var n = Number(s)
    return Number.isInteger(n) ? n : NaN
  }
  function numOrNull(v) {
    var s = String(v == null ? '' : v).trim().replace(',', '.')
    if (!s) return null
    var n = Number(s)
    return isFinite(n) ? n : NaN
  }
  function states() {
    var list = B().states
    return Array.isArray(list) && list.length ? list : STATE_CODES.map(function (c) { return { code: c, name: c } })
  }
  function stateOptions(sel, placeholder) {
    return '<option value="">' + esc(placeholder || 'Escolha') + '</option>' + states().map(function (s) {
      return '<option value="' + esc(s.code) + '"' + (s.code === sel ? ' selected' : '') + '>' + esc(s.name) + ' (' + esc(s.code) + ')</option>'
    }).join('')
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/)
    return ((p[0] || '').charAt(0) + (p[1] || '').charAt(0)).toUpperCase() || 'L'
  }
  function val(form, name) {
    var f = form.elements[name]
    return f ? String(f.value == null ? '' : f.value).trim() : ''
  }
  function checked(form, name) {
    var f = form.elements[name]
    return !!(f && f.checked)
  }
  /** Aviso de contato direto (o servidor confere de novo). */
  function contactHint(text) {
    var s = String(text || '')
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return 'e-mail'
    if (/(https?:\/\/|www\.)\S+/i.test(s)) return 'link'
    if (/\b(whats\s?app|wpp|telegram)\b|(^|\s)@[a-z][a-z0-9_.]{2,}/i.test(s)) return 'contato de rede social'
    if (/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(s)) return 'telefone'
    return null
  }
  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text)
      toast(okMsg || 'Copiado.', 'ok')
    } catch (_) {
      window.prompt('Copie o texto:', text)
    }
  }
  function focusId(id) {
    setTimeout(function () { var n = document.getElementById(id); if (n) n.focus() }, 30)
  }
  function busy(btn, on, label) {
    if (!btn) return
    if (on) {
      btn.dataset.label = btn.textContent
      btn.disabled = true
      btn.setAttribute('aria-busy', 'true')
      if (label) btn.textContent = label
    } else {
      btn.disabled = false
      btn.removeAttribute('aria-busy')
      if (btn.dataset.label) btn.textContent = btn.dataset.label
    }
  }

  // ── API ──────────────────────────────────────────────────────────────────
  function get(action, params) {
    var qs = ''
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] != null && params[k] !== '') qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
    })
    return B().api(API + action + qs)
  }
  function post(action, body) {
    return B().api(API + action, { method: 'POST', body: body || {} })
  }

  // ── Estilos (prefixo sp-) ────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sp-styles')) return
    var s = document.createElement('style')
    s.id = 'sp-styles'
    s.textContent = [
      '.sp-root{min-height:50vh;min-width:0}',
      '.sp-top{display:flex;align-items:center;gap:14px;margin:4px 0 16px;min-width:0}',
      '.sp-top-main{flex:1;min-width:0}',
      '.sp-title{font-size:clamp(22px,5.6vw,30px);font-weight:700;letter-spacing:-.02em;line-height:1.15;margin:0 0 4px;overflow-wrap:anywhere}',
      '.sp-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:13px;color:var(--ink-muted)}',
      '.sp-meta a{color:var(--green-deep);font-weight:600}',
      '.sp-nav{margin:0 0 20px}',
      '.sp-body{min-width:0}',
      '.sp-stack>*+*{margin-top:16px}',
      '.sp-two{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}',
      '.sp-two>.st-panel+.st-panel{margin-top:0}',
      '@media(min-width:900px){.sp-two{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.sp-two.sp-wide{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}}',
      '.sp-col>*+*{margin-top:16px}',
      '.sp-h2{font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0}',
      '.sp-lede{font-size:14px;color:var(--ink-soft);margin:4px 0 0;max-width:68ch}',
      '.sp-headrow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:0 0 14px}',
      '.sp-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '@media(min-width:720px){.sp-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.sp-stat{padding:14px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--paper);min-width:0}',
      '.sp-stat-n{display:block;font-size:24px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink);overflow-wrap:anywhere}',
      '.sp-stat-l{display:block;font-size:12px;color:var(--ink-muted);margin-top:2px}',
      '.sp-stat.is-warn .sp-stat-n{color:var(--st-err,var(--accent-deep))}',
      '.sp-checklist{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
      '.sp-checklist li{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--ink-soft);line-height:1.45}',
      '.sp-dot{flex:none;width:22px;height:22px;border-radius:50%;border:2px solid var(--line-strong);display:inline-flex;align-items:center;justify-content:center;color:var(--paper)}',
      '.sp-checklist li.is-done .sp-dot{background:var(--green-deep);border-color:var(--green-deep)}',
      '.sp-checklist li.is-done strong{color:var(--ink)}',
      '.sp-checklist .st-linkbtn{font-size:13px}',
      '.sp-link{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.sp-link .st-input{flex:1 1 220px;min-width:0;font-family:ui-monospace,Menlo,monospace;font-size:14px}',
      '.sp-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
      '.sp-item{display:flex;gap:12px;align-items:flex-start;width:100%;padding:14px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--paper-elevated);min-width:0;font:inherit;color:inherit;text-align:left}',
      'button.sp-item{cursor:pointer}',
      'button.sp-item:hover{border-color:var(--line-strong)}',
      '.sp-item.is-late{border-color:var(--st-err,var(--accent-deep))}',
      '.sp-thumb{flex:none;width:56px;height:56px;border-radius:10px;object-fit:cover;background:var(--paper-soft);border:1px solid var(--line);display:block}',
      '.sp-item-main{flex:1;min-width:0;display:block}',
      '.sp-item-title{display:block;font-weight:600;font-size:15px;color:var(--ink);overflow-wrap:anywhere}',
      '.sp-item-sub{display:block;font-size:13px;color:var(--ink-muted);margin-top:2px;overflow-wrap:anywhere}',
      '.sp-item-side{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px;text-align:right;max-width:40%}',
      '.sp-price{font-weight:700;color:var(--green-deep);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.sp-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.sp-late{font-size:12px;font-weight:600;color:var(--st-err,var(--accent-deep))}',
      '.sp-due{font-size:12px;color:var(--ink-muted)}',
      '.sp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
      '.sp-photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
      '@media(min-width:720px){.sp-photos{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.sp-photo{position:relative;border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--paper-soft);min-width:0}',
      '.sp-photo img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}',
      '.sp-photo-tag{position:absolute;top:6px;left:6px}',
      '.sp-photo-bar{display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:var(--paper-elevated)}',
      '.sp-mini{font:inherit;font-size:12px;font-weight:600;padding:4px 9px;min-height:30px;border-radius:999px;border:1px solid var(--line-strong);background:var(--paper-elevated);color:var(--ink);cursor:pointer}',
      '.sp-mini:hover{border-color:var(--green-deep);color:var(--green-deep)}',
      '.sp-add{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;aspect-ratio:1/1;padding:8px;border:1px dashed var(--line-strong);border-radius:var(--r-md);background:var(--paper);color:var(--ink-soft);font-size:13px;text-align:center;cursor:pointer;min-width:0}',
      '.sp-add:hover{border-color:var(--green-deep);color:var(--green-deep)}',
      '.sp-add:focus-within{outline:2px solid var(--green-deep);outline-offset:2px}',
      '.sp-file{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}',
      '.sp-fieldset{border:1px solid var(--line);border-radius:var(--r-md);padding:14px;margin:0;min-width:0}',
      '.sp-fieldset>legend{font-size:14px;font-weight:700;color:var(--ink);padding:0 6px}',
      '.sp-fieldset>.st-hint{margin:0 0 10px}',
      '.sp-states{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:6px;margin-top:10px}',
      '.sp-state{display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--paper-elevated);font-size:13px;cursor:pointer;min-width:0}',
      '.sp-state input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--green-deep)}',
      '.sp-state:has(input:checked){border-color:var(--green-deep);background:var(--green-soft)}',
      '.sp-zone[data-m="pickup"] .sp-if-paid{display:none}',
      '.sp-zone[data-m="ship"] .sp-if-local,.sp-zone[data-m="ship"] .sp-if-note,.sp-zone[data-m="pickup"] .sp-if-local{display:none}',
      '.sp-zone[data-m="local_delivery"] .sp-if-states{display:none}',
      '.sp-root label.btn:focus-within{outline:2px solid var(--green-deep);outline-offset:2px}',
      '.sp-methods{display:grid;gap:8px}',
      '@media(min-width:720px){.sp-methods{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.sp-method{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--paper-elevated);cursor:pointer;font-size:14px;color:var(--ink-soft);line-height:1.45}',
      '.sp-method input{flex:none;width:18px;height:18px;margin:2px 0 0;accent-color:var(--green-deep)}',
      '.sp-method strong{display:block;color:var(--ink)}',
      '.sp-method:has(input:checked){border-color:var(--green-deep);box-shadow:0 0 0 1px var(--green-deep)}',
      '.sp-grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '@media(min-width:720px){.sp-grid4{grid-template-columns:repeat(4,minmax(0,1fr))}}',
      '.sp-grid3{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}',
      '@media(min-width:720px){.sp-grid3{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.sp-conv{display:grid;gap:8px;max-height:420px;overflow-y:auto;padding:2px;margin:0 0 12px}',
      '.sp-msg{max-width:85%;padding:10px 12px;border-radius:12px;background:var(--paper-soft);font-size:14px;color:var(--ink);white-space:pre-line;overflow-wrap:anywhere;justify-self:start}',
      '.sp-msg.is-mine{justify-self:end;background:var(--green-soft)}',
      '.sp-msg.is-admin{background:var(--gold-soft)}',
      '.sp-msg-meta{display:block;font-size:11px;color:var(--ink-muted);margin-top:4px}',
      '.sp-rates{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}',
      '.sp-rate{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--paper-elevated);cursor:pointer;font-size:14px}',
      '.sp-rate input{flex:none;width:18px;height:18px;margin:2px 0 0;accent-color:var(--green-deep)}',
      '.sp-rate:has(input:checked){border-color:var(--green-deep);box-shadow:0 0 0 1px var(--green-deep)}',
      '.sp-rate.is-off{opacity:.6;cursor:not-allowed}',
      '.sp-rate-main{flex:1;min-width:0}',
      '.sp-rate-main strong{display:block;color:var(--ink)}',
      '.sp-rate-side{flex:none;text-align:right;font-variant-numeric:tabular-nums}',
      '.sp-addr{font-style:normal;font-size:14px;line-height:1.6;color:var(--ink);white-space:pre-line;overflow-wrap:anywhere;margin:0 0 10px}',
      '.sp-label-ok{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 14px;border-radius:var(--r-md);background:var(--green-soft);color:var(--green-deep);font-size:14px;font-weight:600}',
      '.sp-preview-logo{width:72px;height:72px;border-radius:14px;object-fit:cover;border:1px solid var(--line);background:var(--paper-soft);display:block}',
      '.sp-preview-banner{width:100%;max-width:440px;aspect-ratio:3/1;border-radius:var(--r-md);object-fit:cover;border:1px solid var(--line);background:var(--paper-soft);display:block}',
      '.sp-imgrow{display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '.sp-counter{font-variant-numeric:tabular-nums}',
      '.sp-counter.is-low{color:var(--st-err,var(--accent-deep))}',
      '.sp-skel{height:120px;border-radius:var(--r-lg);margin-top:16px}',
      '.sp-back{display:inline-flex;align-items:center;gap:4px;margin:0 0 12px}',
      '.sp-od-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 14px}',
      '.sp-od-head h2{margin:0;font-size:22px}',
      '.sp-items{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
      '.sp-items li{display:flex;gap:10px;align-items:flex-start;font-size:14px;min-width:0}',
      '.sp-items .sp-thumb{width:48px;height:48px}',
      '.sp-reply{margin-top:10px}',
      '.sp-req{white-space:pre-line}',
      // Celular: as 7 abas quebram em linhas (a aba ativa nunca fica escondida)
      '@media(max-width:560px){.sp-nav .st-tabs{flex-wrap:wrap;border-radius:var(--r-md)}.sp-nav .st-tab{padding:7px 10px}}',
      '.sp-body h2[tabindex="-1"]:focus,.sp-body h3[tabindex="-1"]:focus{outline:none}',
    ].join('\n')
    document.head.appendChild(s)
  }

  // ── Estado e URL ─────────────────────────────────────────────────────────
  function freshState() {
    return {
      user: null, me: null, loading: true, loadError: null,
      tab: 'visao', orderId: null,
      orders: { filter: 'to_ship', list: null, counts: null, error: null },
      order: null, orderError: null, panel: null, rates: null, labelDone: null,
      products: null, productsError: null, prodFilter: 'all', edit: null,
      zoneEdit: null,
      payouts: null, payoutsError: null, reviews: null, reviewsError: null,
      stripeSynced: false,
    }
  }

  function readUrl() {
    var p = new URLSearchParams(location.search)
    return { aba: p.get('aba'), pedido: p.get('pedido'), stripe: p.get('store_stripe') }
  }
  function writeUrl(push) {
    var p = new URLSearchParams()
    if (S.tab && S.tab !== 'visao') p.set('aba', S.tab)
    if (S.orderId) p.set('pedido', S.orderId)
    var qs = p.toString()
    var url = location.pathname + (qs ? '?' + qs : '')
    try { history[push ? 'pushState' : 'replaceState']({ sp: 1 }, '', url) } catch (_) { /* ignore */ }
  }
  function onPop() {
    if (!S || !S.me || !S.me.seller) return
    var u = readUrl()
    stopPoll()
    S.orderId = isUuid(u.pedido) ? u.pedido : null
    S.tab = TAB_KEYS.indexOf(u.aba) !== -1 ? u.aba : (S.orderId ? 'pedidos' : 'visao')
    resetEphemeral()
    render()
    loadTab()
  }
  function resetEphemeral() {
    S.panel = null
    S.rates = null
    S.labelDone = null
    S.order = null
    S.orderError = null
    S.zoneEdit = null
    S.edit = null
  }

  function go(tab, opts) {
    opts = opts || {}
    if (S.edit && S.edit.uploading && !confirm('Ainda tem foto sendo enviada. Sair mesmo assim?')) return
    stopPoll()
    S.tab = tab
    S.orderId = opts.orderId || null
    resetEphemeral()
    writeUrl(true)
    render()
    loadTab()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    focusBodyStart()
  }

  /** Leva o foco ao titulo da secao (ou ao "Voltar") depois de trocar de aba. */
  function focusBodyStart() {
    var h = el && el.querySelector('#sp-body h2, #sp-body .sp-back')
    if (!h) return
    if (!/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(h.tagName)) h.setAttribute('tabindex', '-1')
    try { h.focus({ preventScroll: true }) } catch (_) { h.focus() }
  }

  /** Mantem a aba ativa visivel quando a faixa de abas rola na horizontal. */
  function centerActiveTab() {
    var bar = el && el.querySelector('.sp-nav .st-tabs')
    var a = bar && bar.querySelector('.st-tab.is-active')
    if (!bar || !a || bar.scrollWidth <= bar.clientWidth) return
    var br = bar.getBoundingClientRect()
    var ar = a.getBoundingClientRect()
    bar.scrollLeft += (ar.left - br.left) - (br.width - ar.width) / 2
  }

  function startPoll() {
    stopPoll()
    pollTimer = setInterval(function () {
      if (S && S.tab === 'pedidos' && !S.orderId && document.visibilityState === 'visible') loadOrders(true)
    }, 60000)
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  // ── Carga ────────────────────────────────────────────────────────────────
  async function boot(user) {
    var uid = user ? user.id : ''
    if (uid === lastUserId) return
    lastUserId = uid
    stopPoll()
    S = freshState()
    S.user = user
    if (!user) { S.loading = false; render(); return }
    render()
    try {
      S.me = await get('me')
    } catch (e) {
      S.loadError = e.message
    }
    S.loading = false
    var u = readUrl()
    S.orderId = isUuid(u.pedido) ? u.pedido : null
    S.tab = TAB_KEYS.indexOf(u.aba) !== -1 ? u.aba : (S.orderId ? 'pedidos' : 'visao')
    if (u.stripe) S.tab = 'recebimentos'
    if (S.me && S.me.seller) writeUrl(false)
    render()
    if (!S.me || !S.me.seller) return
    if (u.stripe === 'done' || u.stripe === 'refresh') await stripeReturn(u.stripe)
    loadTab(true)
  }

  async function refreshMe(rerender) {
    try {
      S.me = await get('me')
      if (rerender) render()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  /** initial=true: o 'me' acabou de chegar, nao precisa buscar de novo. */
  function loadTab(initial) {
    if (!S.me || !S.me.seller) return
    if (S.tab === 'pedidos') {
      if (S.orderId) loadOrder(S.orderId)
      else { loadOrders(); startPoll() }
    } else if (S.tab === 'produtos') {
      loadProducts()
    } else if (S.tab === 'recebimentos') {
      loadPayouts()
      var st = S.me.stripe || {}
      if (st.connected && !st.transfers_active && !S.stripeSynced) syncStripe(false)
    } else if (S.tab === 'avaliacoes') {
      loadReviews()
    } else if ((S.tab === 'visao' || S.tab === 'entregas') && !initial) {
      // Numeros e regioes frescos, sem apagar um formulario aberto no meio
      refreshMe(false).then(function () {
        // Cabecalho e abas podem mudar (situacao da loja, contadores): render inteiro, sem perder o foco
        if (S.tab === 'visao') renderKeepFocus()
        else if (S.tab === 'entregas' && !S.zoneEdit) renderBody()
      })
    }
  }

  // Erro de rede nao vira lista vazia: a tela mostra "Não deu para carregar" com "Tentar de novo"
  async function loadOrders(silent) {
    try {
      var d = await get('orders', { filter: S.orders.filter })
      S.orders.list = d.orders || []
      S.orders.counts = d.counts || null
      S.orders.error = null
    } catch (e) {
      if (!silent) toast(e.message, 'err')
      S.orders.error = e.message || 'Não deu para carregar.'
    }
    if (S.tab === 'pedidos' && !S.orderId) {
      var wrap = el.querySelector('#sp-orders')
      if (wrap) wrap.innerHTML = ordersInner()
      else renderBody()
      updateTabCount()
    }
  }

  async function loadOrder(id) {
    S.order = null
    S.orderError = null
    renderBody()
    try {
      S.order = await get('order', { id: id })
    } catch (e) {
      S.orderError = e.message
    }
    if (S.orderId === id) renderBody()
  }

  async function loadProducts() {
    try {
      var d = await get('products')
      S.products = d.products || []
      S.productsError = null
    } catch (e) {
      toast(e.message, 'err')
      S.productsError = e.message || 'Não deu para carregar.'
    }
    if (S.tab === 'produtos' && !S.edit) renderBody()
  }

  async function loadPayouts() {
    try {
      S.payouts = await get('payouts')
      S.payoutsError = null
    } catch (e) {
      toast(e.message, 'err')
      S.payoutsError = e.message || 'Não deu para carregar.'
    }
    if (S.tab === 'recebimentos') renderBody()
  }

  async function loadReviews() {
    try {
      var d = await get('reviews')
      S.reviews = d.reviews || []
      S.reviewsError = null
    } catch (e) {
      toast(e.message, 'err')
      S.reviewsError = e.message || 'Não deu para carregar.'
    }
    if (S.tab === 'avaliacoes') renderBody()
  }

  function loadErrorBox() {
    return '<div class="st-empty" role="alert"><p>Não deu para carregar. Confira a internet.</p>' +
      '<button type="button" class="btn btn-primary st-btn-sm" data-act="retry-tab">Tentar de novo</button></div>'
  }
  function staleNote() {
    return '<div class="st-alert st-alert-warn" role="status" style="margin-bottom:14px">Não deu para atualizar agora; mostrando a última lista. ' +
      '<button type="button" class="st-linkbtn" data-act="retry-tab">Tentar de novo</button></div>'
  }

  async function syncStripe(showToast) {
    S.stripeSynced = true
    try {
      var d = await get('connect-status')
      if (d && d.stripe) S.me.stripe = d.stripe
      if (showToast) toast('Situação do Stripe atualizada.', 'ok')
    } catch (e) {
      if (showToast) toast(e.message, 'err')
    }
    if (S.tab === 'recebimentos' || S.tab === 'visao') renderKeepFocus()
  }

  async function stripeReturn(kind) {
    await syncStripe(false)
    var st = S.me.stripe || {}
    if (kind === 'refresh') toast('O link do Stripe expirou. Clique em "Continuar cadastro" para abrir de novo.', 'err')
    else if (st.transfers_active) toast('Recebimentos ativos. Seus repasses já podem cair na sua conta.', 'ok')
    else toast('Cadastro enviado ao Stripe. Se faltar alguma informação, ela aparece aqui.', 'ok')
  }

  // ── Render principal ─────────────────────────────────────────────────────
  function render() {
    if (!el || !S) return
    if (!S.user) {
      el.innerHTML = '<div class="st-empty"><h2>Entre para abrir o painel da sua loja</h2>' +
        '<p>É aqui que você cadastra produtos, acompanha pedidos, gera etiquetas e vê seus repasses.</p>' +
        '<button type="button" class="btn btn-primary" data-act="login">Entrar</button></div>'
      return
    }
    if (S.loading) {
      el.innerHTML = '<p class="st-sr" role="status">Carregando o painel…</p><span class="st-skeleton sp-skel"></span><span class="st-skeleton sp-skel"></span>'
      return
    }
    if (!S.me) {
      el.innerHTML = '<div class="st-empty"><h2>Não deu para abrir o painel</h2><p>' + esc(S.loadError || 'Tente de novo.') + '</p>' +
        '<button type="button" class="btn btn-primary" data-act="retry">Tentar de novo</button></div>'
      return
    }
    if (!S.me.seller) {
      el.innerHTML = '<div class="st-empty"><h2>Você ainda não tem uma loja na Store</h2>' +
        '<p>Abra sua loja em poucos minutos. A BrasilConnect aprova o cadastro e você já pode montar o catálogo.</p>' +
        '<a class="btn btn-primary" href="/store/vender">Abrir minha loja</a></div>'
      return
    }
    el.innerHTML = head() + tabsNav() + '<div id="sp-body" class="sp-body">' + body() + '</div>'
    centerActiveTab()
  }
  function renderBody() {
    var b = el && el.querySelector('#sp-body')
    if (!b) { render(); return }
    // Se o foco estava no titulo da secao (troca de aba), devolve depois de redesenhar
    var ae = document.activeElement
    var keepFocus = !!(ae && b.contains && b.contains(ae) && ae.getAttribute &&
      (ae.getAttribute('tabindex') === '-1' || (ae.classList && ae.classList.contains('sp-back'))))
    b.innerHTML = body()
    if (keepFocus) focusBodyStart()
  }
  /**
   * render() inteiro (cabecalho e abas tambem) sem jogar o foco no <body>: depois de
   * redesenhar, volta ao mesmo controle (mesmo id, aba ou acao) se ele ainda existir;
   * se o foco estava dentro de #sp-body e o controle sumiu, vai para o titulo da secao.
   */
  function renderKeepFocus() {
    var ae = document.activeElement
    if (!el || !ae || ae === document.body || !el.contains(ae)) { render(); return }
    var b = el.querySelector('#sp-body')
    var inBody = !!(b && b.contains(ae))
    var sel = focusSelector(ae)
    render()
    var again = null
    try { again = sel ? el.querySelector(sel) : null } catch (_) { again = null }
    if (again && !again.disabled) {
      // Titulo que recebeu o foco por focusBodyStart: o novo tambem precisa de tabindex
      if (ae.getAttribute('tabindex') === '-1' && !again.hasAttribute('tabindex')) again.setAttribute('tabindex', '-1')
      try { again.focus({ preventScroll: true }) } catch (_) { again.focus() }
      if (document.activeElement !== again && inBody) focusBodyStart()
    } else if (inBody) {
      focusBodyStart()
    }
  }
  /** Seletor que acha o "mesmo" controle depois de redesenhar (ou null). */
  function focusSelector(n) {
    var q = function (v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\\]]/g, '\\$&') }
    if (n.id) return '#' + q(n.id)
    var act = n.getAttribute && n.getAttribute('data-act')
    var tab = n.getAttribute && n.getAttribute('data-tab')
    var id = n.getAttribute && n.getAttribute('data-id')
    if (!act && !tab) return null
    return (n.tagName ? n.tagName.toLowerCase() : '') +
      (act ? '[data-act="' + q(act) + '"]' : '') + (tab ? '[data-tab="' + q(tab) + '"]' : '') + (id ? '[data-id="' + q(id) + '"]' : '')
  }
  function updateTabCount() {
    var t = el.querySelector('[data-tab="pedidos"]')
    if (t) t.innerHTML = tabLabel('pedidos', 'Pedidos')
  }

  function head() {
    var s = S.me.seller
    var st = SELLER_ST[s.status] || [s.status, 'muted']
    var logo = safeUrl(s.logo_url)
    var pub = '/store/loja/' + encodeURIComponent(s.slug)
    return '<div class="sp-top">' +
      '<span class="st-logo" aria-hidden="true">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : esc(initials(s.name))) + '</span>' +
      '<div class="sp-top-main"><h1 class="sp-title">' + esc(s.name) + '</h1>' +
      '<div class="sp-meta">' + badge('Loja ' + st[0].toLowerCase(), st[1]) +
      (s.vacation_mode ? badge('Modo férias', 'warn') : '') +
      (s.status === 'approved' ? '<a href="' + esc(pub) + '" target="_blank" rel="noopener">Ver minha loja</a>' : '') +
      '</div></div></div>'
  }

  function tabLabel(key, label) {
    var n = 0
    if (key === 'pedidos') n = S.orders.counts ? S.orders.counts.to_ship : (S.me.stats ? S.me.stats.to_ship : 0)
    return esc(label) + (n > 0 ? '<span class="st-tab-count" aria-label="' + n + ' a enviar">' + n + '</span>' : '')
  }

  function tabsNav() {
    return '<nav class="sp-nav" aria-label="Seções do painel"><div class="st-tabs">' + TABS.map(function (t) {
      var on = S.tab === t[0]
      return '<a class="st-tab' + (on ? ' is-active' : '') + '" href="/store/painel?aba=' + t[0] + '" data-act="tab" data-tab="' + t[0] + '"' +
        (on ? ' aria-current="page"' : '') + '>' + tabLabel(t[0], t[1]) + '</a>'
    }).join('') + '</div></nav>'
  }

  function body() {
    switch (S.tab) {
      case 'pedidos': return S.orderId ? orderDetail() : ordersView()
      case 'produtos': return S.edit ? productEditor() : productsView()
      case 'entregas': return zonesView()
      case 'recebimentos': return payoutsView()
      case 'loja': return shopView()
      case 'avaliacoes': return reviewsView()
      default: return overview()
    }
  }

  // ── Visao geral ──────────────────────────────────────────────────────────
  function statusBand() {
    var s = S.me.seller
    var st = S.me.stripe || {}
    var out = ''
    if (s.status === 'pending') {
      out += '<div class="st-alert st-alert-warn" role="status"><strong>Sua loja está em análise.</strong> A equipe da BrasilConnect confere o cadastro em até 2 dias úteis. Enquanto isso, cadastre os produtos, as regiões de entrega e ative os recebimentos: tudo fica pronto para vender quando a loja for aprovada.</div>'
    } else if (s.status === 'rejected') {
      out += '<div class="st-alert st-alert-err" role="status"><strong>Sua loja não foi aprovada.</strong>' +
        (s.rejection_reason ? ' Motivo: ' + esc(s.rejection_reason) : '') +
        '<div class="sp-actions"><button type="button" class="btn btn-primary st-btn-sm" data-act="go-tab" data-tab="loja">Corrigir e reenviar</button></div></div>'
    } else if (s.status === 'suspended') {
      out += '<div class="st-alert st-alert-err" role="status"><strong>Sua loja está suspensa.</strong> Seus produtos não aparecem na vitrine. Você ainda consegue enviar os pedidos já pagos. Fale com <a href="mailto:oi@brasilconnectusa.com">oi@brasilconnectusa.com</a>.</div>'
    } else if (s.vacation_mode) {
      out += '<div class="st-alert st-alert-warn" role="status"><strong>Modo férias ligado.</strong> Seus produtos não aparecem para compra. Desligue na aba Loja quando voltar.</div>'
    } else if (!st.transfers_active) {
      out += '<div class="st-alert st-alert-warn" role="status"><strong>Falta ativar os recebimentos.</strong> Sem isso seus produtos não aparecem para compra. <button type="button" class="st-linkbtn" data-act="go-tab" data-tab="recebimentos">Ativar agora</button></div>'
    }
    // Pre-lancamento: a loja ja pode montar tudo, mas ninguem compra ainda
    var store = S.me.store
    if (store && s.status !== 'suspended' && s.status !== 'rejected') {
      if (!store.public_enabled) {
        out += '<div class="st-alert st-alert-warn" role="status"><strong>A Store ainda não abriu ao público.</strong> Seus produtos aprovados ficam prontos e começam a vender no lançamento.</div>'
      } else if (!store.checkout_enabled) {
        out += '<div class="st-alert st-alert-warn" role="status"><strong>As compras na Store ainda não abriram.</strong> A vitrine já mostra os produtos aprovados, mas o pagamento só é liberado no lançamento.</div>'
      }
    }
    return out
  }
  function storeOpen() {
    var store = S.me.store
    return !store || !!store.checkout_enabled
  }

  function overview() {
    var s = S.me.seller
    var st = S.me.stripe || {}
    var stats = S.me.stats || {}
    var p = stats.products || {}
    var hasZone = (S.me.zones || []).some(function (z) { return z.active })
    var steps = [
      [s.status === 'approved', 'Loja aprovada', s.status === 'rejected' ? 'Corrija o cadastro e reenvie.' : 'A equipe confere seu cadastro.', 'loja', s.status === 'rejected' ? 'Corrigir' : ''],
      [!!st.transfers_active, 'Recebimentos ativos no Stripe', 'É por onde o dinheiro das vendas chega até você.', 'recebimentos', st.transfers_active ? '' : (st.connected ? 'Continuar' : 'Ativar')],
      [hasZone, 'Região de entrega', 'Para onde você envia ou entrega, e quanto cobra.', 'entregas', hasZone ? '' : 'Cadastrar'],
      [(p.approved || 0) > 0, 'Primeiro produto aprovado', (p.pending_review || 0) > 0 ? 'Você tem produto em análise.' : 'Cadastre e envie para aprovação.', 'produtos', (p.approved || 0) > 0 ? '' : 'Cadastrar'],
    ]
    var checklist = '<ul class="sp-checklist">' + steps.map(function (x) {
      return '<li class="' + (x[0] ? 'is-done' : '') + '"><span class="sp-dot">' + (x[0] ? ICON_CHECK : '') + '</span>' +
        '<span><strong>' + esc(x[1]) + '</strong><span class="st-sr">' + (x[0] ? ' (feito)' : ' (pendente)') + '</span><br>' +
        '<span class="st-small">' + esc(x[2]) + '</span>' +
        (x[4] ? ' <button type="button" class="st-linkbtn" data-act="go-tab" data-tab="' + x[3] + '">' + esc(x[4]) + '</button>' : '') +
        '</span></li>'
    }).join('') + '</ul>'

    var nums = '<div class="sp-stats">' +
      statTile(stats.to_ship || 0, 'Pedidos a enviar', false, 'pedidos') +
      statTile(stats.late || 0, 'Atrasados', (stats.late || 0) > 0, 'pedidos') +
      statTile(stats.disputes || 0, 'Problemas abertos', (stats.disputes || 0) > 0, 'pedidos') +
      statTile(money(stats.pending_payout_cents || 0), 'Repasse a receber', false, 'recebimentos') +
      '</div><p class="st-hint" style="margin-top:10px">Liberado nos últimos 30 dias: <strong>' + esc(money(stats.released_cents_30d || 0)) + '</strong></p>'

    var url = location.origin + '/store/loja/' + encodeURIComponent(s.slug)
    var link = '<div class="sp-link"><input class="st-input" id="sp-pub" readonly value="' + esc(url) + '" aria-label="Link público da sua loja">' +
      '<button type="button" class="btn btn-secondary st-btn-sm" data-act="copy-link">Copiar</button>' +
      (s.status === 'approved' ? '<a class="btn btn-secondary st-btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">Abrir</a>' : '') + '</div>' +
      '<p class="st-hint" style="margin-top:8px">' + (s.status !== 'approved'
        ? 'O link funciona depois que a loja for aprovada.'
        : storeOpen()
          ? 'Mande no WhatsApp ou coloque na bio do Instagram.'
          : 'Divulgue quando a Store abrir: antes disso, quem abrir o link ainda não consegue comprar.') + '</p>'

    return '<div class="sp-stack">' + statusBand() +
      '<div class="sp-two">' +
      '<section class="st-panel" aria-labelledby="sp-h-check"><h2 class="st-panel-title" id="sp-h-check">Para começar a vender</h2>' + checklist + '</section>' +
      '<section class="st-panel" aria-labelledby="sp-h-nums"><h2 class="st-panel-title" id="sp-h-nums">Seus números</h2>' + nums + '</section>' +
      '</div>' +
      '<section class="st-panel" aria-labelledby="sp-h-link"><h2 class="st-panel-title" id="sp-h-link">Link da sua loja</h2>' + link + '</section>' +
      '</div>'
  }
  function statTile(n, label, warn, tab) {
    return '<button type="button" class="sp-stat' + (warn ? ' is-warn' : '') + '" data-act="go-tab" data-tab="' + tab + '" style="text-align:left;font:inherit;cursor:pointer">' +
      '<span class="sp-stat-n">' + esc(n) + '</span><span class="sp-stat-l">' + esc(label) + '</span></button>'
  }

  // ── Pedidos ──────────────────────────────────────────────────────────────
  function ordersView() {
    return '<div class="sp-headrow"><div><h2 class="sp-h2">Pedidos</h2><p class="sp-lede">Poste dentro do prazo: pedido não enviado é cancelado e o comprador recebe o dinheiro de volta.</p></div>' +
      '<button type="button" class="btn btn-secondary st-btn-sm" data-act="refresh-orders">Atualizar</button></div>' +
      '<div id="sp-orders">' + ordersInner() + '</div>'
  }
  function ordersInner() {
    var c = S.orders.counts || {}
    var chips = '<div class="st-chips" role="group" aria-label="Filtrar pedidos" style="margin-bottom:14px">' + ORDER_FILTERS.map(function (f) {
      var on = S.orders.filter === f[0]
      var n = f[0] === 'all' ? null : c[f[0]]
      return '<button type="button" class="st-chip" data-act="o-filter" data-filter="' + f[0] + '" aria-pressed="' + on + '">' + esc(f[1]) +
        (n != null ? ' <span class="st-chip-count">' + esc(n) + '</span>' : '') + '</button>'
    }).join('') + '</div>'
    if (c.disputes > 0) chips += '<div class="st-alert st-alert-err" style="margin-bottom:14px">' + c.disputes + (c.disputes === 1 ? ' pedido tem' : ' pedidos têm') + ' problema aberto pelo comprador. Responda pela conversa do pedido.</div>'
    var list = S.orders.list
    if (!list) return chips + (S.orders.error ? loadErrorBox() : '<span class="st-skeleton sp-skel"></span>')
    if (S.orders.error) chips += staleNote()
    if (!list.length) {
      var msg = { to_ship: 'Nenhum pedido esperando envio.', open: 'Nenhum pedido em andamento.', done: 'Nenhum pedido concluído ainda.', all: 'Nenhum pedido ainda. Quando alguém comprar, ele aparece aqui e você recebe um aviso.' }
      return chips + '<div class="st-empty"><p>' + esc(msg[S.orders.filter]) + '</p></div>'
    }
    return chips + '<ul class="sp-list">' + list.map(orderCard).join('') + '</ul>'
  }
  function orderCard(o) {
    var first = (o.items || [])[0] || {}
    var img = safeUrl(first.image_url)
    var items = (o.items || []).map(function (i) { return i.quantity + '× ' + i.title }).join(' · ')
    var where = [o.ship_to_city, o.ship_to_state].filter(Boolean).join('/')
    var due = ''
    // deadline_at: prazo efetivo (o mesmo do cron); ship_by so se o servidor nao mandar
    var dl = o.deadline_at || o.ship_by
    if (o.status === 'paid' && dl) {
      var short = { weekday: 'short', day: 'numeric', month: 'short' }
      due = o.late
        ? '<span class="sp-late">Atrasado · ' + (o.auto_cancel_at ? 'cancela em ' + esc(date(o.auto_cancel_at, short)) : 'prazo era ' + esc(date(dl))) + '</span>'
        : '<span class="sp-due">' + (o.fulfillment === 'ship' ? 'Poste até ' : o.handoff_scheduled_at ? 'Combinado para ' : 'Entregue até ') +
          esc(date(o.handoff_scheduled_at || dl, short)) + '</span>'
    }
    var badges = badge(o.status_label, ORDER_KIND[o.status] || 'muted')
    if (o.late) badges += badge('Atrasado', 'err')
    if (ACTIVE_DISPUTES.indexOf(o.dispute_status) !== -1) badges += badge(DISPUTE_ST[o.dispute_status], 'err')
    if (LABEL_ST[o.label_status] && o.status === 'paid') badges += badge(LABEL_ST[o.label_status], o.label_status === 'failed' ? 'err' : 'muted')
    return '<li><button type="button" class="sp-item' + (o.late ? ' is-late' : '') + '" data-act="order" data-id="' + esc(o.id) + '">' +
      (img ? '<img class="sp-thumb" src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="sp-thumb" aria-hidden="true"></span>') +
      '<span class="sp-item-main"><span class="sp-item-title">Pedido #' + esc(o.order_number) + (o.buyer_name ? ' · ' + esc(o.buyer_name) : '') + '</span>' +
      '<span class="sp-item-sub">' + esc(items) + '</span>' +
      '<span class="sp-item-sub">' + esc(FULFILL[o.fulfillment] || o.fulfillment) + (where ? ' · ' + esc(where) : '') + ' · ' + esc(date(o.paid_at || o.created_at)) + '</span>' +
      '<span class="sp-badges">' + badges + '</span></span>' +
      '<span class="sp-item-side"><span class="sp-price">' + esc(money((o.items_cents || 0) + (o.shipping_cents || 0))) + '</span>' + due + '</span>' +
      '</button></li>'
  }

  function orderDetail() {
    var back = '<button type="button" class="st-linkbtn sp-back" data-act="back-orders">' + ICON_BACK + 'Voltar para os pedidos</button>'
    if (S.orderError) return back + '<div class="st-empty" role="alert"><p>' + esc(S.orderError) + '</p>' +
      '<button type="button" class="btn btn-primary st-btn-sm" data-act="retry-tab">Tentar de novo</button></div>'
    if (!S.order) return back + '<span class="st-skeleton sp-skel"></span><span class="st-skeleton sp-skel"></span>'
    var d = S.order
    var o = d.order
    var badges = badge(o.status_label, ORDER_KIND[o.status] || 'muted')
    // Prazo efetivo (deadline_at, mesma regra do cron e do cancelamento automatico)
    var dl = o.deadline_at || o.ship_by
    var late = o.status === 'paid' && !!dl && new Date(dl).getTime() < Date.now()
    if (late) badges += badge('Atrasado', 'err')
    if (LABEL_ST[o.label_status]) badges += badge(LABEL_ST[o.label_status], o.label_status === 'failed' ? 'err' : 'muted')

    var dispute = ''
    if (o.dispute_status && o.dispute_status !== 'none') {
      var active = ACTIVE_DISPUTES.indexOf(o.dispute_status) !== -1
      dispute = '<div class="st-alert ' + (active ? 'st-alert-err' : 'st-alert-ok') + '" role="status"><strong>' + esc(DISPUTE_ST[o.dispute_status] || o.dispute_status) + '.</strong>' +
        (o.dispute_reason ? ' ' + esc(DISPUTE_REASON[o.dispute_reason] || o.dispute_reason) + '.' : '') +
        (o.dispute_details ? '<br>“' + esc(o.dispute_details) + '”' : '') +
        (active ? '<br>Converse com o comprador abaixo. Enquanto o problema estiver aberto, o repasse fica parado.' : '') + '</div>'
    }
    var deadline = ''
    if (o.status === 'paid' && dl) {
      var longD = { weekday: 'long', day: 'numeric', month: 'long' }
      var isShip = o.fulfillment === 'ship'
      var done = o.fulfillment === 'pickup' ? 'retirado' : 'entregue'
      var txt
      if (late) {
        txt = 'O prazo de ' + (isShip ? 'postagem' : 'entrega') + ' venceu em ' + esc(date(dl)) + '. ' +
          (o.auto_cancel_at
            ? 'Se não ' + (isShip ? 'postar' : 'marcar como ' + done) + ' até ' + esc(date(o.auto_cancel_at, longD)) + ', o pedido é cancelado automaticamente e o comprador reembolsado.'
            : (isShip ? 'Envie hoje' : 'Marque como ' + done + ' hoje') + ' ou o pedido é cancelado automaticamente.') +
          (!isShip && d.can && d.can.schedule_handoff ? ' Se combinou outra data com o comprador, registre em "Registrar data combinada".' : '')
      } else if (isShip) {
        txt = 'Poste até ' + esc(date(dl, longD)) + '.'
      } else if (o.handoff_scheduled_at) {
        txt = (o.fulfillment === 'pickup' ? 'Retirada' : 'Entrega') + ' combinada para ' + esc(date(o.handoff_scheduled_at, longD)) +
          '. Marque como ' + done + ' até ' + esc(date(dl, longD)) + '.'
      } else {
        txt = 'Marque como ' + done + ' até ' + esc(date(dl, longD)) + ' ou registre a data combinada com o comprador.'
      }
      deadline = '<p class="' + (late ? 'sp-late' : 'st-hint') + '" style="margin:0 0 12px">' + txt + '</p>'
    }

    var left = '<section class="st-panel" aria-labelledby="sp-h-act"><h3 class="st-panel-title" id="sp-h-act">O que fazer</h3>' + deadline + '<div id="sp-actions">' + actionsInner() + '</div></section>' +
      itemsPanel(d) + addressPanel(o)
    var right = payoutPanel(d) + '<section class="st-panel" aria-labelledby="sp-h-conv"><h3 class="st-panel-title" id="sp-h-conv">Conversa com o comprador</h3><div id="sp-conv-wrap">' + convInner() + '</div></section>' +
      timelinePanel(d)

    return back + '<div class="sp-od-head"><h2>Pedido #' + esc(o.order_number) + '</h2>' + badges + '</div>' +
      (dispute ? '<div style="margin-bottom:16px">' + dispute + '</div>' : '') +
      '<div class="sp-two sp-wide"><div class="sp-col">' + left + '</div><div class="sp-col">' + right + '</div></div>'
  }

  function actionsInner() {
    var d = S.order
    var o = d.order
    var can = d.can || {}
    var out = ''
    var testMode = !!(S.me.shippo && S.me.shippo.test_mode)
    var testWarn = '<div class="st-alert st-alert-warn" role="status" style="margin:0 0 10px">Modo de teste: a etiqueta não vale para postagem.</div>'
    var labelUrl = safeUrl((S.labelDone && S.labelDone.label_url) || o.label_url)
    if (labelUrl && (o.label_status === 'purchased' || (S.labelDone && o.label_status !== 'refund_requested')) && ['canceled', 'refunded'].indexOf(o.status) === -1) {
      if (testMode) out += testWarn
      out += '<div class="sp-label-ok" role="status">Etiqueta pronta' + (o.tracking_number ? ' · rastreio ' + esc(o.tracking_number) : '') +
        ' <a class="btn btn-primary st-btn-sm" href="' + esc(labelUrl) + '" target="_blank" rel="noopener">Imprimir etiqueta</a></div>'
    } else if (o.tracking_number) {
      var tu = safeUrl(o.tracking_url)
      out += '<p class="st-small" style="margin:0 0 8px">Enviado' + (o.carrier ? ' via ' + esc(o.carrier) : '') + ' · rastreio <strong>' + esc(o.tracking_number) + '</strong>' +
        (tu ? ' · <a href="' + esc(tu) + '" target="_blank" rel="noopener">acompanhar</a>' : '') + '</p>'
    }
    if (o.label_status === 'purchasing' && o.status === 'paid') {
      out += '<div class="st-alert st-alert-warn" role="status" style="margin:0 0 10px">Etiqueta em processamento na Shippo. Atualize em alguns minutos antes de tentar de novo: se ela sair, o pedido vira "Enviado" com o rastreio. ' +
        '<button type="button" class="st-linkbtn" data-act="retry-tab">Atualizar</button></div>'
    }
    if (o.label_status === 'refund_requested' && o.status === 'paid') {
      out += '<p class="st-hint" style="margin:0 0 8px">A etiqueta anterior foi cancelada e o reembolso foi pedido à Shippo. Gere outra ou informe o envio por conta própria.</p>'
    }

    var btns = []
    if (can.buy_label) btns.push(['label', 'Gerar etiqueta', 'btn-primary'])
    if (can.ship_manual) btns.push(['manual', 'Já enviei por conta própria', 'btn-secondary'])
    if (can.mark_delivered) btns.push(['delivered', o.fulfillment === 'pickup' ? 'Marcar como retirado' : 'Marcar como entregue', 'btn-primary'])
    if (can.schedule_handoff) btns.push(['handoff', 'Registrar data combinada', 'btn-secondary'])
    if (can.refund) btns.push(['refund', o.status === 'paid' ? 'Reembolso parcial' : 'Reembolsar', 'btn-secondary'])
    if (can.void_label) btns.push(['void', 'Cancelar etiqueta', 'btn-secondary'])
    if (can.cancel) btns.push(['cancel', 'Cancelar pedido', 'st-btn-danger'])
    if (o.status === 'paid' && o.fulfillment === 'ship' && !can.buy_label && S.me.shippo && !S.me.shippo.enabled) {
      out += '<p class="st-hint" style="margin:0 0 8px">A compra de etiqueta pela Store ainda não está disponível. Poste por conta própria e informe o rastreio.</p>'
    } else if (o.status === 'paid' && o.fulfillment === 'ship' && !can.buy_label && !(S.me.seller.ship_from && S.me.seller.ship_from.street1)) {
      out += '<p class="st-hint" style="margin:0 0 8px">Para gerar etiqueta, cadastre o endereço de postagem na aba Loja.</p>'
    }
    if (!btns.length && !out) out += '<p class="st-hint" style="margin:0">Nada para fazer agora neste pedido.</p>'
    if (btns.length) {
      out += '<div class="sp-actions" style="margin-top:0">' + btns.map(function (b) {
        var on = S.panel === b[0]
        var act = b[0] === 'delivered' ? 'mark-delivered' : b[0] === 'void' ? 'label-void' : 'panel'
        return '<button type="button" class="btn ' + b[2] + ' st-btn-sm" data-act="' + act + '" data-panel="' + b[0] + '"' +
          (act === 'panel' ? ' aria-expanded="' + on + '"' : '') + '>' + esc(b[1]) + '</button>'
      }).join('') + '</div>'
    }
    if (S.panel === 'label') out += (testMode ? '<div style="margin-top:14px">' + testWarn + '</div>' : '') + labelForm()
    if (S.panel === 'manual') out += manualForm()
    if (S.panel === 'handoff') out += handoffForm()
    if (S.panel === 'cancel') out += cancelForm()
    if (S.panel === 'refund') out += refundForm()
    return out
  }
  function handoffForm() {
    var o = S.order.order
    var h = S.order.handoff || {}
    var what = o.fulfillment === 'pickup' ? 'a retirada' : 'a entrega'
    return '<form id="sp-handoff-form" class="st-form" style="margin-top:14px" novalidate>' +
      field('sp-h-date', 'Data combinada para ' + what, '<input class="st-input" id="sp-h-date" name="date" type="date" required' +
        (h.min_date ? ' min="' + esc(h.min_date) + '"' : '') + (h.max_date ? ' max="' + esc(h.max_date) + '"' : '') + ' aria-describedby="sp-h-date-h">') +
      '<p class="st-hint" id="sp-h-date-h">Registre só depois de combinar com o comprador pela conversa. O prazo do pedido passa a ser esse dia' +
      (h.max_date ? ' (até ' + esc(date(h.max_date + 'T16:00:00Z', { day: 'numeric', month: 'long' })) + ')' : '') +
      ' e o comprador recebe um aviso. Dá para registrar uma vez só.</p>' +
      '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn btn-primary st-btn-sm">Registrar data</button></div></form>'
  }

  function suggestedWeight(items) {
    var total = 0
    for (var i = 0; i < items.length; i++) {
      if (items[i].weight_oz == null) return ''
      total += Number(items[i].weight_oz) * (items[i].quantity || 1)
    }
    return String(Math.round((total + 4) * 10) / 10)
  }
  function labelForm() {
    var d = S.order
    var parcel = d.order.parcel || {}
    var hazmat = (d.items || []).some(function (i) { return i.hazmat })
    var w = parcel.weight_oz != null ? parcel.weight_oz : suggestedWeight(d.items || [])
    return '<form id="sp-label-form" class="st-form" style="margin-top:14px" novalidate>' +
      '<p class="st-hint" style="margin:0">Confira as medidas da caixa e o peso com embalagem. O valor da etiqueta sai do seu repasse, sem cartão.</p>' +
      (hazmat ? '<div class="st-alert st-alert-warn">Tem material perigoso no pedido (perfume, esmalte, aerossol): só aparecem fretes por transporte terrestre.</div>' : '') +
      '<div class="sp-grid4">' +
      field('sp-l-len', 'Comprimento (in)', '<input class="st-input" id="sp-l-len" name="length" inputmode="decimal" required value="' + esc(parcel.length != null ? parcel.length : 10) + '">') +
      field('sp-l-wid', 'Largura (in)', '<input class="st-input" id="sp-l-wid" name="width" inputmode="decimal" required value="' + esc(parcel.width != null ? parcel.width : 8) + '">') +
      field('sp-l-hei', 'Altura (in)', '<input class="st-input" id="sp-l-hei" name="height" inputmode="decimal" required value="' + esc(parcel.height != null ? parcel.height : 4) + '">') +
      field('sp-l-wt', 'Peso (oz)', '<input class="st-input" id="sp-l-wt" name="weight_oz" inputmode="decimal" required value="' + esc(w) + '" aria-describedby="sp-l-wt-h">') +
      '</div><p class="st-hint" id="sp-l-wt-h">Sugestão: peso dos itens + 4 oz de embalagem. 1 lb = 16 oz.</p>' +
      '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn btn-primary st-btn-sm">Ver fretes</button></div>' +
      '</form><div id="sp-rates">' + ratesInner() + '</div>'
  }
  function ratesInner() {
    var r = S.rates
    if (!r) return ''
    var msgs = (r.messages || []).length ? '<ul class="st-hint" style="margin:10px 0 0;padding-left:18px">' + r.messages.map(function (m) { return '<li>' + esc(m) + '</li>' }).join('') + '</ul>' : ''
    if (!r.rates || !r.rates.length) return msgs + '<div class="st-alert st-alert-warn" style="margin-top:12px">Nenhum frete disponível para esse pacote. Confira as medidas e o peso ou envie por conta própria.</div>'
    var firstOk = null
    var list = r.rates.map(function (x) {
      if (x.allowed && !firstOk) firstOk = x.rate_id
      var id = 'sp-rate-' + esc(x.rate_id)
      return '<li><label class="sp-rate' + (x.allowed ? '' : ' is-off') + '" for="' + id + '">' +
        '<input type="radio" name="sp-rate" id="' + id + '" value="' + esc(x.rate_id) + '"' + (x.allowed ? '' : ' disabled') + (x.allowed && x.rate_id === firstOk ? ' checked' : '') + '>' +
        '<span class="sp-rate-main"><strong>' + esc([x.provider, x.service].filter(Boolean).join(' · ')) + '</strong>' +
        '<span class="st-small st-muted">' + (x.days != null ? 'Cerca de ' + esc(x.days) + (x.days === 1 ? ' dia' : ' dias') : 'Prazo não informado') +
        (x.allowed ? '' : ' · custa mais do que você recebe neste pedido') + '</span></span>' +
        '<span class="sp-rate-side"><span class="sp-price">' + esc(money(x.amount_cents)) + '</span><br><span class="st-small">você recebe ' + esc(money(x.net_payout_cents)) + '</span></span>' +
        '</label></li>'
    }).join('')
    return msgs + '<fieldset style="border:0;padding:0;margin:0"><legend class="st-sr">Escolha o frete</legend><ul class="sp-rates">' + list + '</ul></fieldset>' +
      '<div class="st-btn-row"><button type="button" class="btn btn-primary" data-act="label-buy"' + (firstOk ? '' : ' disabled') + '>Comprar etiqueta</button></div>'
  }
  function manualForm() {
    return '<form id="sp-manual-form" class="st-form" style="margin-top:14px" novalidate>' +
      '<div class="st-form-grid">' +
      field('sp-m-car', 'Transportadora', '<select class="st-select" id="sp-m-car" name="carrier" required><option value="">Escolha</option>' +
        CARRIERS.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>' }).join('') + '</select>') +
      field('sp-m-trk', 'Código de rastreio', '<input class="st-input" id="sp-m-trk" name="tracking_number" required minlength="6" maxlength="40" autocomplete="off" autocapitalize="characters">') +
      '</div><p class="st-hint">' + manualHint() + '</p>' +
      '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn btn-primary st-btn-sm">Confirmar envio</button></div></form>'
  }
  function manualHint() {
    var policy = S.me.policy || {}
    var days = Math.max(policy.release_days_new_seller || 0, policy.release_days_after_delivery || 0)
    return 'O comprador recebe o rastreio na hora. Informe o número deste pacote: rastreio que já está em pedido de outro comprador é recusado. ' +
      'No envio por conta própria, o repasse sai ' + (days ? esc(days) + ' dias' : 'alguns dias') + ' depois que o rastreio confirmar a entrega' +
      (policy.safety_release_days ? ', ou ' + esc(policy.safety_release_days) + ' dias depois do envio se o pacote estiver em trânsito sem confirmação' : '') + '.'
  }
  function cancelForm() {
    return '<form id="sp-cancel-form" class="st-form" style="margin-top:14px" novalidate>' +
      field('sp-c-rea', 'Motivo do cancelamento (o comprador vê)', '<textarea class="st-textarea" id="sp-c-rea" name="reason" required minlength="3" maxlength="500" rows="3"></textarea>') +
      '<p class="st-hint">O comprador recebe o valor total de volta e o estoque dos produtos volta. Cancelar muitos pedidos pode suspender a loja.</p>' +
      '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn st-btn-danger st-btn-sm">Cancelar e reembolsar o comprador</button></div></form>'
  }
  function refundForm() {
    var o = S.order.order
    return '<form id="sp-refund-form" class="st-form" style="margin-top:14px" novalidate>' +
      '<div class="st-form-grid">' +
      field('sp-r-amt', 'Valor (US$)', '<input class="st-input" id="sp-r-amt" name="amount" inputmode="decimal" required placeholder="0.00" aria-describedby="sp-r-h">') +
      field('sp-r-rea', 'Motivo (o comprador vê)', '<input class="st-input" id="sp-r-rea" name="reason" required minlength="3" maxlength="500">') +
      '</div><p class="st-hint" id="sp-r-h">Até ' + esc(money(o.refundable_cents)) + '. O valor volta para o cartão do comprador e sai do seu repasse' +
      (o.payout_status === 'released' ? ' (como o repasse já saiu, ele é estornado da sua conta Stripe; se o saldo lá não cobrir, o reembolso não é feito e você fala com a BrasilConnect)' : '') + '.' +
      (o.status === 'paid' ? ' Reembolsar o valor total cancela o pedido, porque ele ainda não foi enviado.' : '') + '</p>' +
      '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn btn-primary st-btn-sm">Reembolsar</button></div></form>'
  }

  function itemsPanel(d) {
    var o = d.order
    var rows = (d.items || []).map(function (i) {
      var img = safeUrl(i.image_url)
      return '<li>' + (img ? '<img class="sp-thumb" src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="sp-thumb" aria-hidden="true"></span>') +
        '<span class="sp-item-main"><span class="sp-item-title">' + esc(i.title) + '</span>' +
        '<span class="sp-item-sub">' + esc(i.quantity) + ' × ' + esc(money(i.unit_price_cents)) + (i.hazmat ? ' · material perigoso' : '') + '</span></span>' +
        '<span class="sp-price">' + esc(money(i.subtotal_cents)) + '</span></li>'
    }).join('')
    return '<section class="st-panel" aria-labelledby="sp-h-items"><h3 class="st-panel-title" id="sp-h-items">Itens</h3><ul class="sp-items">' + rows + '</ul>' +
      '<div class="st-totals" style="margin-top:14px"><div><span>Itens</span><span>' + esc(money(o.items_cents)) + '</span></div>' +
      '<div><span>Frete cobrado</span><span>' + esc(money(o.shipping_cents)) + '</span></div>' +
      (o.tax_cents ? '<div><span>Imposto (fica com a Store para recolher)</span><span>' + esc(money(o.tax_cents)) + '</span></div>' : '') +
      '<div class="st-total-final"><span>Total pago</span><span>' + esc(money(o.total_cents)) + '</span></div></div></section>'
  }

  function addressText(a) {
    if (!a) return ''
    return [a.name, a.line1 || a.street1, a.line2 || a.street2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), a.phone]
      .filter(Boolean).join('\n')
  }
  function addressPanel(o) {
    var z = o.zone_snapshot || {}
    var title = o.fulfillment === 'ship' ? 'Endereço de entrega' : o.fulfillment === 'pickup' ? 'Retirada' : 'Entrega local'
    var txt = addressText(o.ship_to)
    return '<section class="st-panel" aria-labelledby="sp-h-addr"><h3 class="st-panel-title" id="sp-h-addr">' + esc(title) + '</h3>' +
      '<p class="st-small st-muted" style="margin:0 0 8px">' + esc(FULFILL[o.fulfillment] || '') + (z.name ? ' · ' + esc(z.name) : '') + '</p>' +
      (txt ? '<address class="sp-addr">' + esc(txt) + '</address><button type="button" class="btn btn-secondary st-btn-sm" data-act="copy-addr">Copiar endereço</button>' : '') +
      (o.fulfillment !== 'ship' && z.pickup_note ? '<p class="st-small" style="margin:12px 0 0">Instruções que o comprador recebeu: ' + esc(z.pickup_note) + '</p>' : '') +
      '<p class="st-hint" style="margin-top:10px">' + (['canceled', 'refunded', 'completed'].indexOf(o.status) !== -1
        ? 'Depois que o pedido termina, o endereço completo e o telefone do comprador deixam de aparecer.'
        : o.fulfillment === 'pickup' ? 'Na retirada, você vê só o nome, o telefone e a cidade do comprador.' : 'Use estes dados só para entregar este pedido.') + '</p></section>'
  }

  function payoutPanel(d) {
    var pp = d.payout_preview || {}
    var o = d.order
    var policy = S.me.policy || {}
    var when
    if (pp.payout_status === 'released') when = 'Pago em ' + date(pp.release_at) + '. O Stripe deposita no seu banco na sexta-feira seguinte.'
    else if (pp.payout_status === 'releasing') when = 'Repasse em processamento: o valor está sendo enviado à sua conta Stripe.'
    else if (pp.payout_status === 'held') when = 'Repasse retido enquanto a BrasilConnect analisa o pedido.'
    else if (pp.payout_status === 'blocked') when = 'O repasse está pronto, mas sua conta de recebimento no Stripe não está ativa. Ative na aba Recebimentos.'
    else if (pp.payout_status === 'none' || pp.payout_status === 'reversed') when = 'Este pedido não tem repasse (cancelado ou reembolsado).'
    else if (ACTIVE_DISPUTES.indexOf(o.dispute_status) !== -1) when = 'Com problema aberto, o repasse espera a solução.'
    else if (pp.release_at) when = 'Previsão de liberação: ' + date(pp.release_at, { weekday: 'long', day: 'numeric', month: 'long' }) + '.'
    else {
      var days = pp.new_seller ? Math.max(policy.release_days_new_seller || 0, policy.release_days_after_delivery || 0) : policy.release_days_after_delivery
      when = 'Liberado ' + (days != null ? days + ' dias depois da entrega' : 'depois da entrega') + ', ou na hora em que o comprador confirmar o recebimento.'
    }
    return '<section class="st-panel" aria-labelledby="sp-h-pay"><h3 class="st-panel-title" id="sp-h-pay">Seu repasse</h3><div class="st-totals">' +
      '<div><span>Vendas (itens + frete)</span><span>' + esc(money(pp.gross_cents)) + '</span></div>' +
      '<div><span>Comissão da Store</span><span>− ' + esc(money(pp.fee_cents)) + '</span></div>' +
      (pp.label_cost_cents ? '<div><span>Etiqueta</span><span>− ' + esc(money(pp.label_cost_cents)) + '</span></div>' : '') +
      (pp.refunded_cents ? '<div><span>Reembolsado ao comprador</span><span>− ' + esc(money(pp.refunded_cents)) + '</span></div>' : '') +
      '<div class="st-total-final"><span>Você recebe</span><span>' + esc(money(pp.payout_cents)) + '</span></div></div>' +
      '<p class="st-hint" style="margin-top:10px">' + esc(when) + '</p></section>'
  }

  function convInner() {
    var msgs = (S.order && S.order.messages) || []
    var list = msgs.length ? '<div class="sp-conv" id="sp-conv" aria-live="polite">' + msgs.map(function (m) {
      var who = m.mine ? 'Você' : (m.sender_role === 'admin' ? 'BrasilConnect' : 'Comprador')
      return '<div class="sp-msg' + (m.mine ? ' is-mine' : '') + (m.sender_role === 'admin' ? ' is-admin' : '') + '">' + esc(m.body) +
        '<span class="sp-msg-meta">' + esc(who) + ' · ' + esc(dateTime(m.created_at)) + '</span></div>'
    }).join('') + '</div>' : '<p class="st-hint" style="margin:0 0 12px">Nenhuma mensagem ainda. Use para combinar a entrega ou tirar dúvidas.</p>'
    var can = (S.order && S.order.can) || {}
    if (can.message === false) {
      return list + '<p class="st-hint" style="margin:0">A conversa foi encerrada: o pedido terminou há mais de 30 dias. Se precisar, fale com <a href="mailto:oi@brasilconnectusa.com">oi@brasilconnectusa.com</a>.</p>'
    }
    return list + '<form id="sp-msg-form" class="st-form" novalidate>' +
      '<label class="st-sr" for="sp-msg-body">Mensagem para o comprador</label>' +
      '<textarea class="st-textarea" id="sp-msg-body" name="body" rows="3" maxlength="2000" required placeholder="Escreva para o comprador"></textarea>' +
      '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn btn-primary st-btn-sm">Enviar mensagem</button></div></form>'
  }

  function timelinePanel(d) {
    var ev = d.events || []
    if (!ev.length) return ''
    return '<section class="st-panel" aria-labelledby="sp-h-tl"><h3 class="st-panel-title" id="sp-h-tl">Linha do tempo</h3><ol class="st-timeline">' +
      ev.map(function (e, i) {
        var cls = /cancel|fail|dispute|hold/.test(e.kind) ? 'is-err' : (i === ev.length - 1 ? 'is-current' : 'is-done')
        return '<li class="' + cls + '"><span class="st-timeline-title">' + esc(e.message || e.kind) + '</span>' +
          '<span class="st-timeline-date">' + esc(dateTime(e.created_at)) + ' · ' + esc(ACTOR[e.actor] || e.actor) + '</span></li>'
      }).join('') + '</ol></section>'
  }

  // ── Produtos ─────────────────────────────────────────────────────────────
  function productsView() {
    var list = S.products
    var counts = { all: 0 }
    ;(list || []).forEach(function (p) {
      counts[p.status] = (counts[p.status] || 0) + 1
      if (p.status !== 'archived') counts.all++
    })
    var head = '<div class="sp-headrow"><div><h2 class="sp-h2">Produtos</h2><p class="sp-lede">Todo anúncio passa pela aprovação da BrasilConnect antes de aparecer na vitrine.</p></div>' +
      '<button type="button" class="btn btn-primary st-btn-sm" data-act="p-new">Novo produto</button></div>'
    var chips = '<div class="st-chips" role="group" aria-label="Filtrar produtos" style="margin-bottom:14px">' + PRODUCT_FILTERS.map(function (f) {
      var n = counts[f[0]] || 0
      if (f[0] !== 'all' && !n && S.prodFilter !== f[0]) return ''
      return '<button type="button" class="st-chip" data-act="p-filter" data-filter="' + f[0] + '" aria-pressed="' + (S.prodFilter === f[0]) + '">' + esc(f[1]) +
        ' <span class="st-chip-count">' + n + '</span></button>'
    }).join('') + '</div>'
    if (!list) return head + (S.productsError ? loadErrorBox() : '<span class="st-skeleton sp-skel"></span>')
    if (S.productsError) head += staleNote()
    var shown = list.filter(function (p) { return S.prodFilter === 'all' ? p.status !== 'archived' : p.status === S.prodFilter })
    if (!list.length) {
      return head + '<div class="st-empty"><h3>Nenhum produto ainda</h3><p>Fotos boas e uma descrição completa (com medidas, material e estado) ajudam a vender e a aprovar mais rápido.</p>' +
        '<button type="button" class="btn btn-primary" data-act="p-new">Cadastrar o primeiro produto</button></div>'
    }
    return head + chips + (shown.length ? '<ul class="sp-list">' + shown.map(productRow).join('') + '</ul>' : '<div class="st-empty"><p>Nenhum produto neste filtro.</p></div>')
  }
  function productRow(p) {
    var st = PRODUCT_ST[p.status] || [p.status, 'muted']
    var img = safeUrl((p.images || [])[0])
    var acts = '<button type="button" class="btn btn-secondary st-btn-sm" data-act="p-edit" data-id="' + esc(p.id) + '">' + (p.status === 'suspended' ? 'Ver' : 'Editar') + '</button>'
    if (p.status === 'approved') acts += '<button type="button" class="btn btn-secondary st-btn-sm" data-act="p-status" data-status="paused" data-id="' + esc(p.id) + '">Pausar</button>'
    if (p.status === 'paused') acts += '<button type="button" class="btn btn-secondary st-btn-sm" data-act="p-status" data-status="approved" data-id="' + esc(p.id) + '">Reativar</button>'
    return '<li class="sp-item">' +
      (img ? '<img class="sp-thumb" src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="sp-thumb" aria-hidden="true"></span>') +
      '<div class="sp-item-main"><span class="sp-item-title">' + esc(p.title) + '</span>' +
      '<span class="sp-item-sub">' + esc(money(p.price_cents)) + ' · estoque ' + esc(p.stock) + (p.stock === 0 ? ' (esgotado)' : '') + '</span>' +
      (p.status === 'rejected' && p.rejection_reason ? '<span class="sp-item-sub">Motivo: ' + esc(p.rejection_reason) + '</span>' : '') +
      '<span class="sp-badges">' + badge(st[0], st[1]) + '</span>' +
      '<div class="sp-actions">' + acts + '</div></div></li>'
  }

  function newEdit(p) {
    p = p || {}
    return {
      id: p.id || null,
      status: p.status || null,
      rejection_reason: p.rejection_reason || null,
      slug: p.slug || null,
      images: (p.images || []).slice(),
      compliance_images: (p.compliance_images || []).slice(),
      uploading: null,
      p: p,
    }
  }

  function productEditor() {
    var e = S.edit
    var p = e.p
    var cats = S.me.categories || []
    var cat = cats.filter(function (c) { return c.slug === p.category_slug })[0]
    var st = e.status ? PRODUCT_ST[e.status] : null
    var locked = e.status === 'suspended'
    var head = '<button type="button" class="st-linkbtn sp-back" data-act="p-back">' + ICON_BACK + 'Voltar para os produtos</button>' +
      '<div class="sp-headrow"><h2 class="sp-h2">' + (e.id ? 'Editar produto' : 'Novo produto') + '</h2>' + (st ? badge(st[0], st[1]) : '') + '</div>'
    var notes = ''
    if (e.status === 'rejected') notes += '<div class="st-alert st-alert-err">Este anúncio foi reprovado' + (e.rejection_reason ? ': ' + esc(e.rejection_reason) : '.') + ' Corrija e envie de novo.</div>'
    if (e.status === 'pending_review') notes += '<div class="st-alert st-alert-warn">Em análise. Você ainda pode corrigir; a análise considera a última versão.</div>'
    if (e.status === 'approved' || e.status === 'paused') notes += '<div class="st-alert st-alert-warn">Mudar título, descrição, fotos, categoria ou a marcação de material perigoso manda o anúncio de volta para análise (ele sai da vitrine até ser aprovado). Preço, estoque e peso não.</div>'
    if (locked) notes += '<div class="st-alert st-alert-err">Anúncio suspenso pela BrasilConnect. Fale com oi@brasilconnectusa.com.</div>'

    var catOpts = '<option value="">Escolha a categoria</option>' + cats.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === p.category_slug ? ' selected' : '') + '>' + esc(c.name) + '</option>'
    }).join('')
    var condOpts = Object.keys(CONDITION).map(function (k) { return '<option value="' + k + '"' + ((p.condition || 'new') === k ? ' selected' : '') + '>' + esc(CONDITION[k]) + '</option>' }).join('')
    var origOpts = Object.keys(ORIGIN).map(function (k) { return '<option value="' + k + '"' + ((p.origin || 'other') === k ? ' selected' : '') + '>' + esc(ORIGIN[k]) + '</option>' }).join('')
    var desc = p.description || ''

    var buttons
    if (locked) buttons = ''
    else if (!e.status || ['draft', 'rejected', 'archived'].indexOf(e.status) !== -1) {
      buttons = '<button type="submit" class="btn btn-secondary" data-submit="0">Salvar rascunho</button>' +
        '<button type="submit" class="btn btn-primary" data-submit="1">Enviar para aprovação</button>'
    } else if (e.status === 'pending_review') {
      buttons = '<button type="submit" class="btn btn-primary" data-submit="1">Salvar alterações</button>'
    } else {
      buttons = '<button type="submit" class="btn btn-primary" data-submit="0">Salvar alterações</button>'
    }
    var extra = ''
    if (e.status === 'approved') extra += '<button type="button" class="btn btn-secondary" data-act="p-status" data-status="paused" data-id="' + esc(e.id) + '">Pausar</button>'
    if (e.status === 'paused') extra += '<button type="button" class="btn btn-secondary" data-act="p-status" data-status="approved" data-id="' + esc(e.id) + '">Reativar</button>'
    if (e.id && ['archived', 'suspended'].indexOf(e.status) === -1) extra += '<button type="button" class="btn st-btn-danger" data-act="p-status" data-status="archived" data-id="' + esc(e.id) + '">Arquivar</button>'

    return head + '<div class="sp-stack">' + notes +
      '<form id="sp-product-form" class="st-form" novalidate>' +
      '<fieldset class="sp-fieldset"' + (locked ? ' disabled' : '') + '><legend>Fotos</legend>' +
      '<p class="st-hint">De 1 a 8 fotos. A primeira é a principal: produto inteiro, fundo limpo, sem texto nem contato na imagem.</p>' +
      '<div id="sp-photos">' + photosInner('images') + '</div></fieldset>' +

      '<fieldset class="sp-fieldset"' + (locked ? ' disabled' : '') + '><legend>Anúncio</legend><div class="st-form-grid">' +
      field('sp-p-title', 'Título', '<input class="st-input" id="sp-p-title" name="title" required minlength="3" maxlength="120" value="' + esc(p.title || '') + '" placeholder="Ex.: Kit 3 panos de prato bordados à mão">', 'st-full') +
      field('sp-p-cat', 'Categoria', '<select class="st-select" id="sp-p-cat" name="category_slug" required>' + catOpts + '</select>') +
      field('sp-p-cond', 'Condição', '<select class="st-select" id="sp-p-cond" name="condition">' + condOpts + '</select>') +
      '<div class="st-full" id="sp-catreq">' + catReqInner(cat) + '</div>' +
      field('sp-p-orig', 'Origem', '<select class="st-select" id="sp-p-orig" name="origin">' + origOpts + '</select>') +
      field('sp-p-tags', 'Palavras-chave (opcional)', '<input class="st-input" id="sp-p-tags" name="tags" maxlength="340" value="' + esc((p.tags || []).join(', ')) + '" placeholder="bordado, cozinha, presente" aria-describedby="sp-p-tags-h">' +
        '<p class="st-hint" id="sp-p-tags-h">Até 10, separadas por vírgula. Ajudam a busca.</p>') +
      '<div class="st-field st-full"><label for="sp-p-desc">Descrição</label>' +
      '<textarea class="st-textarea" id="sp-p-desc" name="description" rows="7" maxlength="8000" aria-describedby="sp-p-desc-h sp-p-desc-c">' + esc(desc) + '</textarea>' +
      '<p class="st-hint" id="sp-p-desc-h">Conte o que é, material, medidas, estado e o que vem na embalagem. Não coloque telefone, e-mail, link ou @: a venda e a conversa acontecem pela Store.</p>' +
      '<p class="st-hint sp-counter' + (desc.length < 80 ? ' is-low' : '') + '" id="sp-p-desc-c" aria-live="polite">' + descCount(desc.length) + '</p>' +
      '<p class="st-hint sp-late" id="sp-p-contact" role="status"></p></div>' +
      '</div></fieldset>' +

      '<fieldset class="sp-fieldset"' + (locked ? ' disabled' : '') + '><legend>Preço e estoque</legend><div class="sp-grid4">' +
      field('sp-p-price', 'Preço (US$)', '<input class="st-input" id="sp-p-price" name="price" inputmode="decimal" required value="' + esc(dollars(p.price_cents)) + '" placeholder="0.00">') +
      field('sp-p-cmp', 'Preço “de” (opcional)', '<input class="st-input" id="sp-p-cmp" name="compare_at" inputmode="decimal" value="' + esc(dollars(p.compare_at_cents)) + '" placeholder="0.00">') +
      field('sp-p-stock', 'Estoque', '<input class="st-input" id="sp-p-stock" name="stock" type="number" min="0" max="9999" step="1" inputmode="numeric" value="' + esc(p.stock != null ? p.stock : 1) + '">') +
      field('sp-p-sku', 'SKU (opcional)', '<input class="st-input" id="sp-p-sku" name="sku" maxlength="60" value="' + esc(p.sku || '') + '">') +
      '</div><p class="st-hint" style="margin-top:8px">O preço “de” aparece riscado: só use se o produto estava mais caro antes.</p></fieldset>' +

      '<fieldset class="sp-fieldset"' + (locked ? ' disabled' : '') + '><legend>Pacote para envio</legend>' +
      '<p class="st-hint">Peso com embalagem, em onças (1 lb = 16 oz). Obrigatório se sua loja envia por transportadora: é o que calcula a etiqueta.</p><div class="sp-grid4">' +
      field('sp-p-wt', 'Peso (oz)', '<input class="st-input" id="sp-p-wt" name="weight_oz" inputmode="decimal" value="' + esc(p.weight_oz != null ? p.weight_oz : '') + '">') +
      field('sp-p-len', 'Comprimento (in)', '<input class="st-input" id="sp-p-len" name="length_in" inputmode="decimal" value="' + esc(p.length_in != null ? p.length_in : '') + '">') +
      field('sp-p-wid', 'Largura (in)', '<input class="st-input" id="sp-p-wid" name="width_in" inputmode="decimal" value="' + esc(p.width_in != null ? p.width_in : '') + '">') +
      field('sp-p-hei', 'Altura (in)', '<input class="st-input" id="sp-p-hei" name="height_in" inputmode="decimal" value="' + esc(p.height_in != null ? p.height_in : '') + '">') +
      '</div><div style="margin-top:12px"><label class="st-check"><input type="checkbox" name="hazmat"' + (p.hazmat ? ' checked' : '') + '>' +
      '<span><strong>Material perigoso</strong> (perfume, esmalte, aerossol, álcool em gel): só vai por transporte terrestre.</span></label>' +
      '<p class="st-hint" id="sp-hazmat-tip"' + (p.category_slug === 'beleza' ? '' : ' hidden') + ' style="margin-top:6px">Na categoria Beleza, perfume, esmalte e aerossol precisam desta marcação.</p></div></fieldset>' +

      '<fieldset class="sp-fieldset" id="sp-compl"' + (cat && cat.gated ? '' : ' hidden') + (locked ? ' disabled' : '') + '><legend>Informações para a análise</legend>' +
      '<p class="st-hint">Só a equipe da BrasilConnect vê. Para esta categoria, conte a origem do produto (loja, nota fiscal, importador), validade e rótulo em inglês, e envie fotos do rótulo ou da nota.</p>' +
      field('sp-p-cnotes', 'Informações', '<textarea class="st-textarea" id="sp-p-cnotes" name="compliance_notes" rows="4" maxlength="2000">' + esc(p.compliance_notes || '') + '</textarea>') +
      '<div style="margin-top:12px" id="sp-cphotos">' + photosInner('compliance_images') + '</div></fieldset>' +

      (locked ? '' : '<div class="st-btn-row">' + buttons + extra + '<button type="button" class="btn btn-secondary" data-act="p-back">Cancelar</button></div>') +
      '</form></div>'
  }
  function descCount(n) {
    return n < 80 ? n + ' caracteres · faltam ' + (80 - n) + ' para poder enviar' : n + ' caracteres'
  }
  function catReqInner(cat) {
    if (!cat) return ''
    var out = cat.description ? '<p class="st-hint" style="margin:0 0 6px">' + esc(cat.description) + '</p>' : ''
    if (cat.gated && cat.requirements) out += '<div class="st-alert st-alert-warn sp-req"><strong>Categoria com regras extras.</strong> ' + esc(cat.requirements) + '</div>'
    return out
  }
  function photosInner(key) {
    var e = S.edit
    var list = e[key] || []
    var up = e.uploading && e.uploading.key === key ? e.uploading : null
    var isMain = key === 'images'
    var tiles = list.map(function (u, i) {
      var url = safeUrl(u)
      return '<div class="sp-photo">' + (url ? '<img src="' + esc(url) + '" alt="' + (isMain ? 'Foto ' + (i + 1) : 'Documento ' + (i + 1)) + '" loading="lazy">' : '') +
        (isMain && i === 0 ? '<span class="st-badge st-badge-ok sp-photo-tag">Principal</span>' : '') +
        '<div class="sp-photo-bar">' +
        (isMain && i > 0 ? '<button type="button" class="sp-mini" data-act="ph-main" data-i="' + i + '">Usar como principal</button>' : '') +
        '<button type="button" class="sp-mini" data-act="ph-del" data-key="' + key + '" data-i="' + i + '" aria-label="Remover ' + (isMain ? 'foto ' : 'documento ') + (i + 1) + '">Remover</button>' +
        '</div></div>'
    }).join('')
    var add = ''
    if (list.length < 8 && !up) {
      var id = 'sp-file-' + key
      add = '<label class="sp-add" for="' + id + '">' + ICON_PLUS + '<span>' + (isMain ? (list.length ? 'Adicionar fotos' : 'Enviar fotos') : 'Enviar foto do rótulo ou nota') + '</span>' +
        '<input class="sp-file" type="file" id="' + id + '" data-upload="' + key + '" accept="image/*" multiple></label>'
    }
    var status = up ? '<p class="st-hint" role="status" style="margin-top:8px">Enviando ' + Math.min(up.done + 1, up.total) + ' de ' + up.total + '…</p>' : ''
    return '<div class="sp-photos">' + tiles + add + '</div>' + status
  }
  function renderPhotos(key) {
    var c = el.querySelector(key === 'images' ? '#sp-photos' : '#sp-cphotos')
    if (c) c.innerHTML = photosInner(key)
  }

  async function uploadPhotos(input) {
    var key = input.getAttribute('data-upload')
    var ed = S.edit
    if (!ed || (key !== 'images' && key !== 'compliance_images')) return
    var files = Array.prototype.slice.call(input.files || [])
    input.value = ''
    if (!files.length) return
    var room = 8 - ed[key].length
    if (room <= 0) { toast('Máximo de 8 fotos.', 'err'); return }
    if (files.length > room) toast('Só cabem mais ' + room + (room === 1 ? ' foto' : ' fotos') + '. As outras ficaram de fora.', 'err')
    files = files.slice(0, room)
    ed.uploading = { key: key, done: 0, total: files.length }
    renderPhotos(key)
    for (var i = 0; i < files.length; i++) {
      try {
        var url = await B().uploadImage(files[i])
        if (S.edit !== ed) return
        ed[key].push(url)
      } catch (err) {
        toast(err.message || 'Uma foto não foi enviada.', 'err')
      }
      ed.uploading.done = i + 1
      if (S.edit === ed) renderPhotos(key)
    }
    ed.uploading = null
    if (S.edit === ed) renderPhotos(key)
  }

  async function openProduct(id) {
    if (!id) { S.edit = newEdit(null); renderBody(); focusId('sp-p-title'); return }
    var p = (S.products || []).filter(function (x) { return x.id === id })[0]
    if (!p) {
      try { p = (await get('product', { id: id })).product } catch (e) { toast(e.message, 'err'); return }
    }
    S.edit = newEdit(p)
    renderBody()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveProduct(form, submit, btn) {
    var e = S.edit
    if (e.uploading) { toast('Espere as fotos terminarem de enviar.', 'err'); return }
    var price = toCents(val(form, 'price'))
    var cmp = toCents(val(form, 'compare_at'))
    if (price == null || isNaN(price)) { toast('Informe o preço (ex.: 24.90).', 'err'); focusId('sp-p-price'); return }
    if (cmp !== null && isNaN(cmp)) { toast('O preço “de” está num formato inválido.', 'err'); focusId('sp-p-cmp'); return }
    var stock = intOrNull(val(form, 'stock'))
    if (stock === null || isNaN(stock) || stock < 0) { toast('Estoque: use um número inteiro.', 'err'); focusId('sp-p-stock'); return }
    var nums = {}
    var bad = false
    ;[['weight_oz', 'sp-p-wt'], ['length_in', 'sp-p-len'], ['width_in', 'sp-p-wid'], ['height_in', 'sp-p-hei']].forEach(function (k) {
      var n = numOrNull(val(form, k[0]))
      if (n !== null && (isNaN(n) || n <= 0) && !bad) { bad = true; toast('Peso e medidas precisam ser números maiores que zero.', 'err'); focusId(k[1]) }
      nums[k[0]] = n
    })
    if (bad) return
    var description = form.elements.description.value
    if (submit) {
      if (!e.images.length) { toast('Envie pelo menos 1 foto.', 'err'); return }
      if (description.trim().length < 80) { toast('A descrição precisa ter pelo menos 80 caracteres.', 'err'); focusId('sp-p-desc'); return }
    }
    var body = {
      id: e.id || undefined,
      title: val(form, 'title'),
      description: description,
      category_slug: val(form, 'category_slug'),
      condition: val(form, 'condition'),
      origin: val(form, 'origin'),
      price_cents: price,
      compare_at_cents: cmp,
      stock: stock,
      sku: val(form, 'sku'),
      weight_oz: nums.weight_oz,
      length_in: nums.length_in,
      width_in: nums.width_in,
      height_in: nums.height_in,
      images: e.images,
      hazmat: checked(form, 'hazmat'),
      tags: val(form, 'tags').split(',').map(function (t) { return t.trim() }).filter(Boolean),
      compliance_notes: form.elements.compliance_notes ? form.elements.compliance_notes.value : '',
      compliance_images: e.compliance_images,
      submit: !!submit,
    }
    busy(btn, true, 'Salvando…')
    try {
      var d = await post('save-product', body)
      var wasNew = !e.id
      if (d.needs_review) {
        toast(e.status === 'pending_review' ? 'Alterações salvas. O anúncio segue em análise.' : 'Anúncio enviado para análise. Avisamos quando for aprovado.', 'ok')
        S.edit = null
        S.prodFilter = 'all'
        await loadProducts()
        refreshMe(false)
        return
      }
      toast(wasNew ? 'Rascunho salvo.' : 'Alterações salvas.', 'ok')
      S.edit = newEdit(d.product)
      if (S.products) {
        var idx = S.products.findIndex(function (x) { return x.id === d.product.id })
        if (idx === -1) S.products.unshift(d.product)
        else S.products[idx] = d.product
      }
      renderBody()
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
    }
  }

  async function productStatus(btn) {
    var to = btn.getAttribute('data-status')
    var id = btn.getAttribute('data-id')
    if (to === 'archived' && !confirm('Arquivar este anúncio? Ele sai da vitrine e da sua lista principal.')) return
    if (to === 'paused' && !confirm('Pausar este anúncio? Ele some da vitrine até você reativar.')) return
    busy(btn, true)
    try {
      var d = await post('product-status', { id: id, status: to })
      toast({ paused: 'Anúncio pausado.', approved: 'Anúncio reativado.', archived: 'Anúncio arquivado.' }[to], 'ok')
      if (S.products) {
        var idx = S.products.findIndex(function (x) { return x.id === id })
        if (idx !== -1) S.products[idx] = d.product
      }
      S.edit = null
      renderBody()
      refreshMe(false)
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
    }
  }

  // ── Entregas ─────────────────────────────────────────────────────────────
  function statesSummary(list) {
    list = list || []
    if (!list.length) return ''
    if (list.length >= 51) return 'Todos os estados'
    if (list.length === 49 && list.indexOf('AK') === -1 && list.indexOf('HI') === -1) return 'Todos os EUA (exceto AK e HI)'
    if (list.length > 12) return list.slice(0, 12).join(', ') + ' e mais ' + (list.length - 12)
    return list.join(', ')
  }
  function zonePrice(z) {
    if (z.method === 'pickup') return 'Sem custo'
    var s = z.rate_first_cents ? money(z.rate_first_cents) + ' o primeiro item' : 'Grátis'
    if (z.rate_first_cents && z.rate_additional_cents) s += ' + ' + money(z.rate_additional_cents) + ' por item a mais'
    if (z.free_over_cents) s += ' · grátis acima de ' + money(z.free_over_cents)
    return s
  }
  function zoneDays(z) {
    if (z.est_days_min == null && z.est_days_max == null) return ''
    if (z.est_days_min != null && z.est_days_max != null && z.est_days_min !== z.est_days_max) return z.est_days_min + '–' + z.est_days_max + ' dias'
    var n = z.est_days_max != null ? z.est_days_max : z.est_days_min
    return n + (n === 1 ? ' dia' : ' dias')
  }
  function zonesView() {
    if (S.zoneEdit) return zoneEditor()
    var zones = S.me.zones || []
    var head = '<div class="sp-headrow"><div><h2 class="sp-h2">Entregas</h2><p class="sp-lede">Cadastre para onde você entrega e quanto cobra. O comprador só consegue comprar se o endereço dele estiver numa das suas regiões.</p></div>' +
      (zones.length < 20 ? '<button type="button" class="btn btn-primary st-btn-sm" data-act="z-new">Nova região</button>' : '') + '</div>'
    var sf = S.me.seller.ship_from
    var tip = '<p class="st-hint" style="margin:0 0 14px">Prazo de postagem da loja: <strong>' + esc(S.me.seller.handling_days) + ' dia(s) útil(eis)</strong>' +
      (sf && sf.city ? ' · postagem saindo de ' + esc(sf.city) + '/' + esc(sf.state) : '') + '. Muda na aba Loja.</p>'
    if (!zones.length) {
      return head + tip + '<div class="st-empty"><h3>Nenhuma região ainda</h3><p>Sem região de entrega, seus produtos não podem ser comprados. Comece pelo seu estado.</p>' +
        '<button type="button" class="btn btn-primary" data-act="z-new">Cadastrar região</button></div>'
    }
    return head + tip + '<ul class="sp-list">' + zones.map(function (z) {
      var where = z.method === 'local_delivery' ? (z.zip_prefixes || []).length + ' ZIP code(s)' + (z.states && z.states.length ? ' · ' + statesSummary(z.states) : '') : statesSummary(z.states)
      var days = zoneDays(z)
      return '<li class="sp-item"><div class="sp-item-main"><span class="sp-item-title">' + esc(z.name) + '</span>' +
        '<span class="sp-item-sub">' + esc(METHOD[z.method] || z.method) + (where ? ' · ' + esc(where) : '') + '</span>' +
        '<span class="sp-item-sub">' + esc(zonePrice(z)) + (days ? ' · ' + esc(days) : '') + '</span>' +
        '<span class="sp-badges">' + (z.active ? badge('Ativa', 'ok') : badge('Desligada', 'muted')) + '</span>' +
        '<div class="sp-actions"><button type="button" class="btn btn-secondary st-btn-sm" data-act="z-edit" data-id="' + esc(z.id) + '">Editar</button>' +
        '<button type="button" class="btn st-btn-danger st-btn-sm" data-act="z-del" data-id="' + esc(z.id) + '">Apagar</button></div></div></li>'
    }).join('') + '</ul>'
  }
  function zoneEditor() {
    var z = S.zoneEdit
    var m = z.method || 'ship'
    var sel = z.states || []
    var methods = [['ship', 'Envio por transportadora', 'Você posta (USPS, UPS...) e o comprador recebe em casa.'],
      ['local_delivery', 'Entrega local', 'Você mesma entrega em mãos, nos ZIP codes que escolher.'],
      ['pickup', 'Retirada', 'O comprador busca com você. Sem custo de frete.']]
    var grid = states().map(function (s) {
      return '<label class="sp-state" title="' + esc(s.name) + '"><input type="checkbox" name="st" value="' + esc(s.code) + '"' + (sel.indexOf(s.code) !== -1 ? ' checked' : '') + '>' + esc(s.code) + '</label>'
    }).join('')
    return '<button type="button" class="st-linkbtn sp-back" data-act="z-cancel">' + ICON_BACK + 'Voltar para as regiões</button>' +
      '<h2 class="sp-h2" style="margin-bottom:14px">' + (z.id ? 'Editar região' : 'Nova região de entrega') + '</h2>' +
      '<form id="sp-zone-form" class="st-form sp-zone" data-m="' + esc(m) + '" novalidate>' +
      '<fieldset class="sp-fieldset"><legend>Como você entrega</legend><div class="sp-methods">' + methods.map(function (x) {
        return '<label class="sp-method"><input type="radio" name="method" value="' + x[0] + '"' + (m === x[0] ? ' checked' : '') + '><span><strong>' + esc(x[1]) + '</strong>' + esc(x[2]) + '</span></label>'
      }).join('') + '</div></fieldset>' +
      field('sp-z-name', 'Nome da região', '<input class="st-input" id="sp-z-name" name="name" required maxlength="60" value="' + esc(z.name || '') + '" placeholder="Ex.: Texas e estados vizinhos">') +
      '<fieldset class="sp-fieldset"><legend>Estados</legend>' +
      '<p class="st-hint"><span class="sp-if-states">Marque os estados que essa região atende.</span><span class="sp-if-local">Na entrega local, marque o estado dos ZIP codes (opcional; ajuda o comprador a achar sua loja).</span></p>' +
      '<div class="sp-actions" style="margin-top:0"><button type="button" class="sp-mini" data-act="z-mine">Meu estado</button>' +
      '<button type="button" class="sp-mini" data-act="z-all">Todos os EUA (exceto AK e HI)</button>' +
      '<button type="button" class="sp-mini" data-act="z-clear">Limpar</button></div>' +
      '<div class="sp-states" role="group" aria-label="Estados atendidos">' + grid + '</div></fieldset>' +
      '<div class="sp-if-local">' + field('sp-z-zips', 'ZIP codes onde você entrega', '<textarea class="st-textarea" id="sp-z-zips" name="zip_prefixes" rows="3" aria-describedby="sp-z-zips-h">' + esc((z.zip_prefixes || []).join(', ')) + '</textarea>' +
        '<p class="st-hint" id="sp-z-zips-h">Separados por vírgula. Pode usar só o começo: 787 cobre todos os ZIP codes que começam com 787. Ex.: 78664, 78665, 787</p>') + '</div>' +
      '<div class="sp-if-paid"><div class="sp-grid3">' +
      field('sp-z-first', 'Frete do 1º item (US$)', '<input class="st-input" id="sp-z-first" name="rate_first" inputmode="decimal" value="' + esc(dollars(z.rate_first_cents || 0)) + '">') +
      field('sp-z-add', 'Cada item a mais (US$)', '<input class="st-input" id="sp-z-add" name="rate_additional" inputmode="decimal" value="' + esc(dollars(z.rate_additional_cents || 0)) + '">') +
      field('sp-z-free', 'Grátis acima de (US$, opcional)', '<input class="st-input" id="sp-z-free" name="free_over" inputmode="decimal" value="' + esc(dollars(z.free_over_cents)) + '" placeholder="Sem frete grátis">') +
      '</div><p class="st-hint" style="margin-top:8px">Coloque 0 no primeiro item para frete grátis. Lembre que, se comprar a etiqueta pela Store, o custo dela sai do seu repasse.</p></div>' +
      '<div class="st-form-grid">' +
      field('sp-z-min', 'Prazo de entrega: mínimo (dias)', '<input class="st-input" id="sp-z-min" name="est_days_min" type="number" min="0" max="60" inputmode="numeric" value="' + esc(z.est_days_min != null ? z.est_days_min : '') + '">') +
      field('sp-z-max', 'Prazo de entrega: máximo (dias)', '<input class="st-input" id="sp-z-max" name="est_days_max" type="number" min="0" max="90" inputmode="numeric" value="' + esc(z.est_days_max != null ? z.est_days_max : '') + '">') +
      '</div><p class="st-hint">Depois da postagem. O comprador vê esse prazo antes de comprar.</p>' +
      '<div class="sp-if-note">' + field('sp-z-note', 'Instruções de retirada ou entrega', '<textarea class="st-textarea" id="sp-z-note" name="pickup_note" rows="3" maxlength="500" aria-describedby="sp-z-note-h">' + esc(z.pickup_note || '') + '</textarea>' +
        '<p class="st-hint" id="sp-z-note-h">Endereço ou ponto de encontro e horários. O comprador só vê depois de pagar.</p>') + '</div>' +
      '<label class="st-check"><input type="checkbox" name="active"' + (z.active === false ? '' : ' checked') + '><span>Região ativa</span></label>' +
      '<div class="st-btn-row"><button type="submit" class="btn btn-primary">Salvar região</button><button type="button" class="btn btn-secondary" data-act="z-cancel">Cancelar</button></div>' +
      '</form>'
  }
  function setStates(fn) {
    var boxes = el.querySelectorAll('#sp-zone-form input[name="st"]')
    Array.prototype.forEach.call(boxes, function (b) { b.checked = fn(b.value, b.checked) })
  }
  async function saveZone(form, btn) {
    var method = (form.querySelector('input[name="method"]:checked') || {}).value || 'ship'
    var states = Array.prototype.map.call(form.querySelectorAll('input[name="st"]:checked'), function (b) { return b.value })
    var first = toCents(val(form, 'rate_first'))
    var add = toCents(val(form, 'rate_additional'))
    var free = toCents(val(form, 'free_over'))
    if ([first, add, free].some(function (x) { return x !== null && isNaN(x) })) { toast('Valores de frete: use números como 7.50.', 'err'); return }
    var min = intOrNull(val(form, 'est_days_min'))
    var max = intOrNull(val(form, 'est_days_max'))
    if ((min !== null && isNaN(min)) || (max !== null && isNaN(max))) { toast('Prazo: use números inteiros de dias.', 'err'); return }
    if (!val(form, 'name')) { toast('Dê um nome para a região.', 'err'); focusId('sp-z-name'); return }
    if (method !== 'local_delivery' && !states.length) { toast('Marque pelo menos um estado.', 'err'); return }
    var zips = val(form, 'zip_prefixes').split(/[\s,;]+/).filter(Boolean)
    if (method === 'local_delivery' && !zips.length) { toast('Informe os ZIP codes da entrega local.', 'err'); focusId('sp-z-zips'); return }
    busy(btn, true, 'Salvando…')
    try {
      await post('save-zone', {
        id: S.zoneEdit.id || undefined,
        name: val(form, 'name'), method: method, states: states, zip_prefixes: method === 'local_delivery' ? zips : [],
        rate_first_cents: first || 0, rate_additional_cents: add || 0, free_over_cents: free || null,
        est_days_min: min, est_days_max: max,
        pickup_note: method === 'ship' ? null : val(form, 'pickup_note'),
        active: checked(form, 'active'),
      })
      toast('Região salva.', 'ok')
      S.zoneEdit = null
      await refreshMe(false)
      renderBody()
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
    }
  }

  // ── Recebimentos ─────────────────────────────────────────────────────────
  function payoutsView() {
    var st = S.me.stripe || {}
    var policy = S.me.policy || {}
    var status, kind, btn
    var due = st.requirements_due || []
    var reason = String(st.disabled_reason || '')
    var reasonPT = /^rejected\./.test(reason) ? 'Conta recusada' : (STRIPE_REASON[reason] || '')
    if (st.transfers_active) {
      status = 'Recebimentos ativos. Os repasses caem na sua conta Stripe, que deposita no seu banco toda sexta-feira.'
      kind = 'ok'
      btn = '<button type="button" class="btn btn-primary st-btn-sm" data-act="stripe-login">Abrir painel do Stripe</button>'
    } else if (st.connected && /^rejected\./.test(reason)) {
      status = 'O Stripe recusou a conta de recebimento. Fale com oi@brasilconnectusa.com.'
      kind = 'err'
      btn = ''
    } else if (st.connected && due.length) {
      // Quem precisa agir e a loja, nao o Stripe
      status = 'Falta enviar ' + (due.length === 1 ? '1 informação' : due.length + ' informações') + ' ao Stripe para liberar seus repasses.'
      kind = 'warn'
      btn = '<button type="button" class="btn btn-primary st-btn-sm" data-act="connect">Completar cadastro</button>' +
        (st.details_submitted ? '<button type="button" class="btn btn-secondary st-btn-sm" data-act="stripe-login">Abrir painel do Stripe</button>' : '')
    } else if (st.connected && st.details_submitted) {
      status = (reason === 'requirements.pending_verification' || reason === 'under_review' || reason === 'listed'
        ? 'O Stripe está conferindo seus documentos.' : 'O Stripe está conferindo seus dados.') + ' Isso costuma levar poucos minutos.'
      kind = 'warn'
      btn = '<button type="button" class="btn btn-secondary st-btn-sm" data-act="stripe-login">Abrir painel do Stripe</button>'
    } else if (st.connected) {
      status = 'Cadastro no Stripe incompleto. Termine para poder receber.'
      kind = 'warn'
      btn = '<button type="button" class="btn btn-primary st-btn-sm" data-act="connect">Continuar cadastro</button>'
    } else {
      status = 'Você ainda não ativou os recebimentos. Leva uns 5 minutos: o Stripe pede seus dados, SSN ou ITIN e a conta do banco.'
      kind = 'warn'
      btn = '<button type="button" class="btn btn-primary st-btn-sm" data-act="connect">Ativar recebimentos</button>'
    }
    var stripePanel = '<section class="st-panel" aria-labelledby="sp-h-stripe"><h2 class="st-panel-title" id="sp-h-stripe">Conta de recebimento</h2>' +
      '<div class="st-alert st-alert-' + kind + '" role="status">' + esc(status) + (reasonPT && !st.transfers_active ? '<br><span class="st-small">Situação no Stripe: ' + esc(reasonPT) + '</span>' : '') + '</div>' +
      '<div class="sp-actions">' + btn + (st.connected ? '<button type="button" class="btn btn-secondary st-btn-sm" data-act="stripe-sync">Atualizar situação</button>' : '') + '</div>' +
      '<p class="st-hint" style="margin-top:10px">Quem guarda seus dados bancários é o Stripe, não a BrasilConnect.</p></section>'

    var newDays = Math.max(policy.release_days_new_seller || 0, policy.release_days_after_delivery || 0)
    var how = '<section class="st-panel" aria-labelledby="sp-h-how"><h2 class="st-panel-title" id="sp-h-how">Quando o dinheiro sai</h2>' +
      '<ul class="st-small" style="margin:0;padding-left:18px;color:var(--ink-soft);line-height:1.6">' +
      '<li>O comprador paga na Store. O valor fica guardado até a entrega.</li>' +
      '<li>Envio com etiqueta da Store: liberado ' + esc(policy.release_days_after_delivery) + ' dias depois da entrega' +
        (newDays > (policy.release_days_after_delivery || 0) ? ' (' + esc(newDays) + ' dias enquanto a loja tiver menos de ' + esc(policy.new_seller_orders || 5) + ' pedidos concluídos)' : '') + '.</li>' +
      (newDays > (policy.release_days_after_delivery || 0) ? '<li>Envio por conta própria (rastreio informado por você): ' + esc(newDays) + ' dias depois da entrega.</li>' : '') +
      '<li>Se o comprador confirmar o recebimento antes, o repasse sai na hora.</li>' +
      '<li>Entrega local ou retirada: ' + esc(policy.local_release_days != null ? policy.local_release_days : 3) + ' dias depois de você marcar como entregue.</li>' +
      '<li>Envio sem confirmação de entrega no rastreio: ' + esc(policy.safety_release_days || 30) + ' dias depois do envio, se o rastreio mostrar o pacote em trânsito.</li>' +
      '<li>Do repasse saem a comissão da Store e, se comprou pela Store, a etiqueta. Com problema aberto pelo comprador, o repasse espera a solução.</li>' +
      '</ul></section>'

    var p = S.payouts
    var lists
    var debt = p && p.debt_cents != null ? p.debt_cents : (S.me.seller.debt_cents || 0)
    var debtNote = debt > 0 ? '<div class="st-alert st-alert-warn" role="status" style="margin-bottom:14px"><strong>Débito com a BrasilConnect: ' + esc(money(debt)) + '</strong>, sai dos próximos repasses. ' +
      'É de um reembolso feito depois que o repasse já tinha saído. Dúvidas: <a href="mailto:oi@brasilconnectusa.com">oi@brasilconnectusa.com</a>.</div>' : ''
    if (!p) lists = S.payoutsError ? loadErrorBox() : '<span class="st-skeleton sp-skel"></span>'
    else {
      var pend = (p.orders || []).filter(function (o) { return o.payout_status !== 'released' && o.payout_status !== 'reversed' })
      var paid = (p.orders || []).filter(function (o) { return o.payout_status === 'released' || o.payout_status === 'reversed' })
      lists = (S.payoutsError ? staleNote() : '') + debtNote + '<div class="sp-stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
        '<div class="sp-stat"><span class="sp-stat-n">' + esc(money(p.pending_cents)) + '</span><span class="sp-stat-l">A receber (enviados e entregues)</span></div>' +
        '<div class="sp-stat"><span class="sp-stat-n">' + esc(money(p.released_cents_30d)) + '</span><span class="sp-stat-l">Pago nos últimos 30 dias</span></div></div>' +
        '<h3 class="st-panel-title" style="margin-top:18px">A receber</h3>' + payoutTable(pend, 'Nenhum repasse pendente.') +
        '<h3 class="st-panel-title" style="margin-top:18px">Pagos</h3>' + payoutTable(paid, 'Nenhum repasse pago ainda.')
    }
    return '<div class="sp-stack"><div class="sp-two">' + stripePanel + how + '</div>' +
      '<section class="st-panel" aria-labelledby="sp-h-list"><h2 class="st-panel-title" id="sp-h-list">Repasses</h2>' + lists + '</section></div>'
  }
  function payoutTable(rows, empty) {
    if (!rows.length) return '<p class="st-hint" style="margin:0">' + esc(empty) + '</p>'
    return '<div class="st-table-wrap"><table class="st-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Situação</th><th scope="col" class="st-num">Valor</th><th scope="col">Data</th></tr></thead><tbody>' +
      rows.map(function (o) {
        var ps = PAYOUT_ST[o.payout_status] || [o.payout_status, 'muted']
        var value = o.payout_status === 'released' ? o.payout_cents : o.payout_preview_cents
        var when = o.payout_status === 'released' ? date(o.release_at)
          : o.payout_status === 'releasing' ? 'Em processamento'
            : (o.release_at ? 'Previsto ' + date(o.release_at) : (o.status === 'paid' ? 'Depois do envio' : '—'))
        return '<tr><td><button type="button" class="st-linkbtn" data-act="open-order" data-id="' + esc(o.id) + '">#' + esc(o.order_number) + '</button><br><span class="st-small st-muted">' + esc(o.status_label || '') + '</span></td>' +
          '<td>' + badge(ps[0], ps[1]) + '</td><td class="st-num">' + esc(money(value)) + '</td><td>' + esc(when) + '</td></tr>'
      }).join('') + '</tbody></table></div>'
  }

  async function connectStripe(btn) {
    busy(btn, true, 'Abrindo o Stripe…')
    try {
      var d = await post('connect')
      var url = safeUrl(d.url)
      if (!url) throw new Error('O Stripe não devolveu o link. Tente de novo.')
      location.href = url
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
    }
  }
  async function stripeLogin(btn) {
    // Abre a aba ja no clique (sem bloqueio de pop-up) e aponta depois
    var w = null
    try { w = window.open('', '_blank') } catch (_) { w = null }
    if (w) { try { w.opener = null } catch (_) { /* ignore */ } }
    busy(btn, true, 'Abrindo…')
    try {
      var d = await post('stripe-login')
      var url = safeUrl(d.url)
      if (!url) throw new Error('O Stripe não devolveu o link. Tente de novo.')
      if (w) w.location.href = url
      else location.href = url
      busy(btn, false)
    } catch (err) {
      if (w) w.close()
      busy(btn, false)
      toast(err.message, 'err')
    }
  }

  // ── Loja ─────────────────────────────────────────────────────────────────
  function shopView() {
    var s = S.me.seller
    var sf = s.ship_from || {}
    var ra = s.return_address || {}
    var rejected = s.status === 'rejected'
    var slugEditable = s.status === 'pending' || rejected
    // Loja aprovada: nome/logo/capa novos esperam a aprovacao. O formulario mostra o que foi pedido.
    var pend = s.status === 'approved' && s.pending_changes && typeof s.pending_changes === 'object' ? s.pending_changes : {}
    var has = function (k) { return Object.prototype.hasOwnProperty.call(pend, k) }
    var nameVal = has('name') ? pend.name : s.name
    var logoVal = has('logo_url') ? pend.logo_url : s.logo_url
    var bannerVal = has('banner_url') ? pend.banner_url : s.banner_url
    var logo = safeUrl(logoVal)
    var banner = safeUrl(bannerVal)
    var agreement = (S.me.policy || {}).agreement_version
    var pendingNote = ''
    if (has('name') || has('logo_url') || has('banner_url')) {
      var what = []
      if (has('name')) what.push('nome “' + esc(pend.name) + '”')
      if (has('logo_url')) what.push('logo novo')
      if (has('banner_url')) what.push('capa nova')
      pendingNote = '<div class="st-alert st-alert-warn" role="status" style="margin-bottom:14px"><strong>Alterações aguardando aprovação:</strong> ' + what.join(', ') +
        '. Até a BrasilConnect aprovar, a vitrine continua com ' + (has('name') ? 'o nome “' + esc(s.name) + '”' : 'a imagem atual') + '.' +
        (s.pending_changes_at ? ' <span class="st-small">Pedido em ' + esc(date(s.pending_changes_at)) + '.</span>' : '') + '</div>'
    }

    var vacation = s.status === 'approved' ? '<section class="st-panel" aria-labelledby="sp-h-vac"><h2 class="st-panel-title" id="sp-h-vac">Modo férias</h2>' +
      '<label class="st-check"><input type="checkbox" id="sp-vac" data-act-change="vacation"' + (s.vacation_mode ? ' checked' : '') + '>' +
      '<span><strong>Pausar a loja</strong><br>Seus produtos somem da vitrine até você desligar. Pedidos já pagos continuam com você.</span></label></section>' : ''

    var form = '<form id="sp-shop-form" class="st-form" novalidate>' +
      (rejected ? '<div class="st-alert st-alert-err"><strong>Cadastro reprovado.</strong>' + (s.rejection_reason ? ' Motivo: ' + esc(s.rejection_reason) : '') + ' Corrija abaixo e reenvie para análise.</div>' : '') +
      '<fieldset class="sp-fieldset"><legend>Vitrine</legend><div class="st-form-grid">' +
      field('sp-s-name', 'Nome da loja', '<input class="st-input" id="sp-s-name" name="name" required minlength="2" maxlength="60" value="' + esc(nameVal) + '">') +
      field('sp-s-slug', 'Endereço da loja', '<input class="st-input" id="sp-s-slug" name="slug" maxlength="40" value="' + esc(s.slug) + '"' + (slugEditable ? '' : ' readonly aria-readonly="true"') + ' aria-describedby="sp-s-slug-h">' +
        '<p class="st-hint" id="sp-s-slug-h">brasilconnectusa.com/store/loja/<strong>' + esc(s.slug) + '</strong>' + (slugEditable ? '' : ' · não muda depois da aprovação') + '</p>') +
      field('sp-s-tag', 'Frase curta', '<input class="st-input" id="sp-s-tag" name="tagline" maxlength="120" value="' + esc(s.tagline || '') + '" placeholder="Ex.: Bordados feitos à mão em Austin">', 'st-full') +
      field('sp-s-bio', 'Sobre a loja', '<textarea class="st-textarea" id="sp-s-bio" name="bio" rows="5" maxlength="2000">' + esc(s.bio || '') + '</textarea>', 'st-full') +
      field('sp-s-city', 'Cidade', '<input class="st-input" id="sp-s-city" name="city" required maxlength="60" value="' + esc(s.city || '') + '" autocomplete="address-level2">') +
      field('sp-s-state', 'Estado', '<select class="st-select" id="sp-s-state" name="state" required>' + stateOptions(s.state) + '</select>') +
      '<div class="st-field"><span class="st-label">Logo</span><div class="sp-imgrow">' +
      '<img class="sp-preview-logo" id="sp-s-logo-img" alt="Logo atual" src="' + esc(logo) + '"' + (logo ? '' : ' hidden') + '>' +
      '<label class="btn btn-secondary st-btn-sm" style="position:relative">' + (logo ? 'Trocar logo' : 'Enviar logo') + '<input class="sp-file" type="file" accept="image/*" data-shopimg="logo_url"></label>' +
      (logo ? '<button type="button" class="sp-mini" data-act="shop-img-clear" data-key="logo_url">Remover</button>' : '') + '</div>' +
      '<input type="hidden" name="logo_url" value="' + esc(logoVal || '') + '"><p class="st-hint" id="sp-s-logo_url-st" role="status"></p></div>' +
      '<div class="st-field"><span class="st-label">Capa</span><div class="sp-imgrow">' +
      '<img class="sp-preview-banner" id="sp-s-banner-img" alt="Capa atual" src="' + esc(banner) + '"' + (banner ? '' : ' hidden') + '>' +
      '<label class="btn btn-secondary st-btn-sm" style="position:relative">' + (banner ? 'Trocar capa' : 'Enviar capa') + '<input class="sp-file" type="file" accept="image/*" data-shopimg="banner_url"></label>' +
      (banner ? '<button type="button" class="sp-mini" data-act="shop-img-clear" data-key="banner_url">Remover</button>' : '') + '</div>' +
      '<input type="hidden" name="banner_url" value="' + esc(bannerVal || '') + '"><p class="st-hint" id="sp-s-banner_url-st" role="status"></p></div>' +
      '</div><p class="st-hint" style="margin-top:10px">Nada de telefone, e-mail, link ou @ nos textos: a venda e a conversa acontecem pela Store.</p></fieldset>' +

      '<fieldset class="sp-fieldset"><legend>Contato e postagem (privado)</legend>' +
      '<p class="st-hint">Só a BrasilConnect vê. O endereço vai na etiqueta como remetente.</p><div class="st-form-grid">' +
      field('sp-s-phone', 'Telefone', '<input class="st-input" id="sp-s-phone" name="phone" type="tel" required autocomplete="tel" value="' + esc(s.phone || '') + '">') +
      field('sp-s-hd', 'Prazo de postagem (dias úteis)', '<input class="st-input" id="sp-s-hd" name="handling_days" type="number" min="1" max="30" required inputmode="numeric" value="' + esc(s.handling_days || 2) + '" aria-describedby="sp-s-hd-h"><p class="st-hint" id="sp-s-hd-h">Quantos dias úteis você leva para postar depois do pagamento.</p>') +
      addrFields('sf', sf, true) +
      '</div></fieldset>' +

      '<fieldset class="sp-fieldset"><legend>Endereço de devolução (opcional)</legend>' +
      '<p class="st-hint">Para onde a transportadora devolve o pacote se não conseguir entregar. Em branco, volta para o endereço de postagem.</p><div class="st-form-grid">' +
      addrFields('ra', ra, false) + '</div></fieldset>' +

      '<fieldset class="sp-fieldset"><legend>Devolução e garantia</legend>' +
      '<label class="st-check"><input type="checkbox" name="accepts_returns"' + (s.accepts_returns ? ' checked' : '') + '><span>Aceito devolução</span></label>' +
      '<div class="st-form-grid" style="margin-top:12px">' +
      field('sp-s-rw', 'Prazo para devolver (dias)', '<input class="st-input" id="sp-s-rw" name="return_window_days" type="number" min="0" max="90" inputmode="numeric" value="' + esc(s.return_window_days != null ? s.return_window_days : 7) + '">') +
      '<div></div>' +
      field('sp-s-rp', 'Política de devolução', '<textarea class="st-textarea" id="sp-s-rp" name="return_policy" rows="4" maxlength="3000" placeholder="Ex.: Aceito devolução em até 7 dias, produto sem uso e na embalagem. O frete de volta é por conta do comprador, exceto em caso de defeito.">' + esc(s.return_policy || '') + '</textarea>', 'st-full') +
      field('sp-s-wp', 'Garantia', '<textarea class="st-textarea" id="sp-s-wp" name="warranty_policy" rows="3" maxlength="3000" placeholder="Ex.: Troco peças com defeito de fabricação em até 30 dias.">' + esc(s.warranty_policy || '') + '</textarea>', 'st-full') +
      '</div></fieldset>' +

      (rejected ? '<label class="st-check"><input type="checkbox" name="agree" required><span>Li e aceito o <a href="/store/regras#contrato" target="_blank" rel="noopener">Contrato do Vendedor</a>' +
        (agreement ? ' (versão ' + esc(agreement) + ')' : '') + ' e as <a href="/store/regras#proibidos" target="_blank" rel="noopener">regras de produtos</a>.</span></label>' : '') +
      '<div class="st-btn-row"><button type="submit" class="btn btn-primary">' + (rejected ? 'Reenviar para análise' : 'Salvar') + '</button></div>' +
      '</form>'

    return '<div class="sp-stack">' + vacation + '<section class="st-panel" aria-labelledby="sp-h-shop"><h2 class="st-panel-title" id="sp-h-shop">Dados da loja</h2>' +
      (s.status === 'approved' ? '<p class="st-hint" style="margin:0 0 12px">Nome, logo e capa novos só aparecem na vitrine depois da aprovação da BrasilConnect. Frase curta e texto mudam na hora e passam por uma revisão rápida. A loja continua no ar.</p>' : '') +
      pendingNote + form + '</section></div>'
  }
  function addrFields(p, a, required) {
    var req = required ? ' required' : ''
    return field('sp-' + p + '-name', 'Nome de quem envia', '<input class="st-input" id="sp-' + p + '-name" name="' + p + '_name" maxlength="60"' + req + ' autocomplete="name" value="' + esc(a.name || '') + '">') +
      field('sp-' + p + '-phone', 'Telefone do endereço (opcional)', '<input class="st-input" id="sp-' + p + '-phone" name="' + p + '_phone" type="tel" autocomplete="tel" value="' + esc(a.phone || '') + '">') +
      field('sp-' + p + '-s1', 'Endereço (rua e número)', '<input class="st-input" id="sp-' + p + '-s1" name="' + p + '_street1" maxlength="100"' + req + ' autocomplete="address-line1" value="' + esc(a.street1 || '') + '">', 'st-full') +
      field('sp-' + p + '-s2', 'Complemento (opcional)', '<input class="st-input" id="sp-' + p + '-s2" name="' + p + '_street2" maxlength="100" autocomplete="address-line2" value="' + esc(a.street2 || '') + '" placeholder="Apt, suite">', 'st-full') +
      field('sp-' + p + '-city', 'Cidade', '<input class="st-input" id="sp-' + p + '-city" name="' + p + '_city" maxlength="60"' + req + ' autocomplete="address-level2" value="' + esc(a.city || '') + '">') +
      '<div class="sp-two" style="gap:12px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
      field('sp-' + p + '-state', 'Estado', '<select class="st-select" id="sp-' + p + '-state" name="' + p + '_state"' + req + ' autocomplete="address-level1">' + stateOptions(a.state, 'UF') + '</select>') +
      field('sp-' + p + '-zip', 'ZIP code', '<input class="st-input" id="sp-' + p + '-zip" name="' + p + '_zip" inputmode="numeric" maxlength="10"' + req + ' autocomplete="postal-code" value="' + esc(a.zip || '') + '">') +
      '</div>'
  }
  function readAddr(form, p) {
    return {
      name: val(form, p + '_name'), street1: val(form, p + '_street1'), street2: val(form, p + '_street2'),
      city: val(form, p + '_city'), state: val(form, p + '_state'), zip: val(form, p + '_zip'), phone: val(form, p + '_phone'),
    }
  }
  async function shopImage(input) {
    var key = input.getAttribute('data-shopimg')
    var file = input.files && input.files[0]
    input.value = ''
    if (!file) return
    var form = el.querySelector('#sp-shop-form')
    var stEl = el.querySelector('#sp-s-' + key + '-st')
    if (stEl) stEl.textContent = 'Enviando…'
    try {
      var url = await B().uploadImage(file)
      if (form && form.elements[key]) form.elements[key].value = url
      var img = el.querySelector(key === 'logo_url' ? '#sp-s-logo-img' : '#sp-s-banner-img')
      if (img) { img.src = url; img.hidden = false }
      if (stEl) stEl.textContent = 'Imagem enviada. Clique em Salvar para aplicar.'
    } catch (err) {
      if (stEl) stEl.textContent = ''
      toast(err.message, 'err')
    }
  }
  async function saveShop(form, btn) {
    var s = S.me.seller
    var rejected = s.status === 'rejected'
    var ra = readAddr(form, 'ra')
    var hasReturn = !!(ra.street1 || ra.zip || ra.city)
    var body = {
      name: val(form, 'name'),
      tagline: val(form, 'tagline'),
      bio: form.elements.bio.value,
      city: val(form, 'city'),
      state: val(form, 'state'),
      phone: val(form, 'phone'),
      logo_url: val(form, 'logo_url') || null,
      banner_url: val(form, 'banner_url') || null,
      ship_from: readAddr(form, 'sf'),
      return_address: hasReturn ? ra : null,
      handling_days: intOrNull(val(form, 'handling_days')),
      accepts_returns: checked(form, 'accepts_returns'),
      return_window_days: intOrNull(val(form, 'return_window_days')),
      return_policy: form.elements.return_policy.value,
      warranty_policy: form.elements.warranty_policy.value,
    }
    if (s.status === 'pending' || rejected) body.slug = val(form, 'slug')
    if (!body.ship_from.phone) body.ship_from.phone = null
    if (body.return_address && !body.return_address.phone) body.return_address.phone = null
    if (rejected) {
      if (!checked(form, 'agree')) { toast('Para reenviar, aceite o Contrato do Vendedor.', 'err'); return }
      body.agree = true
    }
    busy(btn, true, 'Salvando…')
    try {
      var hadPending = !!(s.pending_changes && Object.keys(s.pending_changes).length)
      var d = await post(rejected ? 'apply' : 'update-shop', body)
      S.me.seller = d.seller
      var nowPending = !!(d.seller && d.seller.pending_changes && Object.keys(d.seller.pending_changes).length)
      var changedPending = JSON.stringify((d.seller && d.seller.pending_changes) || null) !== JSON.stringify(s.pending_changes || null)
      toast(rejected ? 'Cadastro reenviado. Avisamos quando a análise terminar.'
        : nowPending && changedPending ? 'Dados salvos. Nome, logo ou capa novos vão ao ar depois da aprovação da BrasilConnect.'
          : hadPending && !nowPending ? 'Dados salvos. O pedido de mudança de nome/imagem foi retirado.'
            : 'Dados da loja salvos.', 'ok')
      render()
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
    }
  }
  async function setVacation(input) {
    var on = input.checked
    input.disabled = true
    try {
      var d = await post('update-shop', { vacation_mode: on })
      S.me.seller = d.seller
      toast(on ? 'Modo férias ligado. Seus produtos saíram da vitrine.' : 'Modo férias desligado. Seus produtos voltaram.', 'ok')
      render()
    } catch (err) {
      input.checked = !on
      input.disabled = false
      toast(err.message, 'err')
    }
  }

  // ── Avaliacoes ───────────────────────────────────────────────────────────
  function reviewsView() {
    var list = S.reviews
    var head = '<div class="sp-headrow"><div><h2 class="sp-h2">Avaliações</h2><p class="sp-lede">Responda com educação: sua resposta aparece na página da loja e do produto. Dá para responder uma vez.</p></div></div>'
    if (!list) return head + (S.reviewsError ? loadErrorBox() : '<span class="st-skeleton sp-skel"></span>')
    if (S.reviewsError) head += staleNote()
    if (!list.length) return head + '<div class="st-empty"><p>Nenhuma avaliação ainda. Elas aparecem depois que o comprador recebe o pedido.</p></div>'
    return head + '<ul class="st-reviews">' + list.map(function (r) {
      var reply = r.seller_reply
        ? '<div class="st-review-reply"><strong>Sua resposta</strong>' + esc(r.seller_reply) + '</div>'
        : '<form class="st-form sp-reply" data-form="reply" data-id="' + esc(r.id) + '" novalidate>' +
          '<label class="st-sr" for="sp-rr-' + esc(r.id) + '">Responder à avaliação</label>' +
          '<textarea class="st-textarea" id="sp-rr-' + esc(r.id) + '" name="body" rows="2" maxlength="1000" required placeholder="Agradeça ou explique o que aconteceu"></textarea>' +
          '<div class="st-btn-row" style="margin-top:0"><button type="submit" class="btn btn-secondary st-btn-sm">Responder</button></div></form>'
      return '<li class="st-review"><div class="st-review-head"><strong>' + esc(r.buyer_name) + '</strong>' + B().stars(r.rating) +
        '<span>' + esc(date(r.created_at)) + '</span>' + (r.status === 'hidden' ? badge('Oculta pela BrasilConnect', 'muted') : '') + '</div>' +
        (r.product_title ? '<p class="st-review-product">' + esc(r.product_title) + (r.order_number ? ' · pedido #' + esc(r.order_number) : '') + '</p>' : '') +
        (r.body ? '<p class="st-review-body">' + esc(r.body) + '</p>' : '') + reply + '</li>'
    }).join('') + '</ul>'
  }

  // ── Campos ───────────────────────────────────────────────────────────────
  function field(id, label, control, cls) {
    return '<div class="st-field' + (cls ? ' ' + cls : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + control + '</div>'
  }

  // ── Eventos ──────────────────────────────────────────────────────────────
  var submitFlag = null

  async function onClick(e) {
    var b = e.target.closest('[data-act]')
    if (!b || !el.contains(b)) {
      var sb = e.target.closest('button[data-submit]')
      if (sb) submitFlag = sb.getAttribute('data-submit')
      return
    }
    var act = b.getAttribute('data-act')
    if (act === 'tab') { e.preventDefault(); go(b.getAttribute('data-tab')); return }
    if (act === 'go-tab') { go(b.getAttribute('data-tab')); return }
    try {
      switch (act) {
        case 'login': await B().login({ reason: 'Entre para abrir o painel da sua loja.' }); break
        case 'retry': lastUserId = undefined; boot(B().user()); break
        case 'copy-link': copyText(el.querySelector('#sp-pub').value, 'Link copiado.'); break
        case 'o-filter':
          S.orders.filter = b.getAttribute('data-filter')
          S.orders.list = null
          S.orders.error = null
          el.querySelector('#sp-orders').innerHTML = ordersInner()
          loadOrders()
          break
        case 'refresh-orders': await loadOrders(); toast('Pedidos atualizados.', 'ok'); break
        case 'order':
        case 'open-order':
          go('pedidos', { orderId: b.getAttribute('data-id') })
          break
        case 'back-orders': go('pedidos'); break
        case 'panel': {
          var pnl = b.getAttribute('data-panel')
          S.panel = S.panel === pnl ? null : pnl
          if (S.panel !== 'label') S.rates = null
          el.querySelector('#sp-actions').innerHTML = actionsInner()
          var first = el.querySelector('#sp-actions form input, #sp-actions form select, #sp-actions form textarea')
          if (first && S.panel) first.focus()
          break
        }
        case 'label-buy': await buyLabel(b); break
        case 'label-void':
          S.labelDone = null // a etiqueta antiga nao pode mais aparecer como "pronta"
          await orderAction(b, 'label-void', {},
          'Cancelar a etiqueta? Use só se o pacote ainda não foi postado: o reembolso da etiqueta é pedido à Shippo, o valor dela volta para o seu repasse e o pedido volta para "aguardando envio". O comprador é avisado.',
          'Etiqueta cancelada. O pedido voltou para aguardando envio.')
          break
        case 'retry-tab':
          S.orders.error = null
          S.productsError = null
          S.payoutsError = null
          S.reviewsError = null
          if (S.tab === 'pedidos' && !S.orderId && !S.orders.list) el.querySelector('#sp-orders').innerHTML = ordersInner()
          else if (S.tab !== 'pedidos') renderBody()
          loadTab()
          break
        case 'mark-delivered': await orderAction(b, 'mark-delivered', {},
          S.order.order.fulfillment === 'pickup' ? 'Confirmar que o comprador retirou o pedido?' : 'Confirmar que você entregou o pedido?',
          'Pedido marcado como entregue.')
          break
        case 'copy-addr': copyText(addressText(S.order.order.ship_to), 'Endereço copiado.'); break
        case 'p-new': openProduct(null); break
        case 'p-edit': openProduct(b.getAttribute('data-id')); break
        case 'p-back':
          if (S.edit && S.edit.uploading && !confirm('Ainda tem foto sendo enviada. Sair mesmo assim?')) break
          S.edit = null; renderBody(); loadProducts()
          break
        case 'p-filter': S.prodFilter = b.getAttribute('data-filter'); renderBody(); break
        case 'p-status': await productStatus(b); break
        case 'ph-main': {
          var i = Number(b.getAttribute('data-i'))
          var imgs = S.edit.images
          if (i > 0 && i < imgs.length) { imgs.unshift(imgs.splice(i, 1)[0]); renderPhotos('images') }
          break
        }
        case 'ph-del': {
          var key = b.getAttribute('data-key')
          S.edit[key].splice(Number(b.getAttribute('data-i')), 1)
          renderPhotos(key)
          break
        }
        case 'z-new':
          S.zoneEdit = { method: 'ship', states: S.me.seller.state ? [S.me.seller.state] : [], active: true, rate_first_cents: 0, rate_additional_cents: 0 }
          renderBody(); focusId('sp-z-name')
          break
        case 'z-edit':
          S.zoneEdit = Object.assign({}, (S.me.zones || []).filter(function (z) { return z.id === b.getAttribute('data-id') })[0] || {})
          renderBody(); focusId('sp-z-name')
          break
        case 'z-cancel': S.zoneEdit = null; renderBody(); break
        case 'z-del':
          if (!confirm('Apagar esta região? Compradores dela deixam de conseguir comprar.')) break
          busy(b, true)
          try {
            await post('delete-zone', { id: b.getAttribute('data-id') })
            toast('Região apagada.', 'ok')
            await refreshMe(false)
            renderBody()
          } catch (err) { busy(b, false); throw err }
          break
        case 'z-mine': {
          var mine = S.me.seller.state || (S.me.seller.ship_from && S.me.seller.ship_from.state)
          if (!mine) { toast('Cadastre o estado da loja na aba Loja.', 'err'); break }
          setStates(function (code, cur) { return cur || code === mine })
          break
        }
        case 'z-all': setStates(function (code) { return code !== 'AK' && code !== 'HI' }); break
        case 'z-clear': setStates(function () { return false }); break
        case 'connect': await connectStripe(b); break
        case 'stripe-login': await stripeLogin(b); break
        case 'stripe-sync': {
          busy(b, true)
          await syncStripe(true)
          // O botao desabilitado perde o foco antes do redesenho: devolve ao novo botao
          var nb = el.querySelector('[data-act="stripe-sync"]')
          if (nb && (!document.activeElement || document.activeElement === document.body)) nb.focus()
          break
        }
        case 'shop-img-clear': {
          var k = b.getAttribute('data-key')
          var f = el.querySelector('#sp-shop-form')
          if (f && f.elements[k]) f.elements[k].value = ''
          var img = el.querySelector(k === 'logo_url' ? '#sp-s-logo-img' : '#sp-s-banner-img')
          if (img) { img.hidden = true; img.removeAttribute('src') }
          b.hidden = true
          var stEl = el.querySelector('#sp-s-' + k + '-st')
          if (stEl) stEl.textContent = 'Imagem removida. Clique em Salvar para aplicar.'
          break
        }
        default:
          if (b.hasAttribute('data-submit')) submitFlag = b.getAttribute('data-submit')
      }
    } catch (err) {
      toast(err.message || 'Não deu certo. Tente de novo.', 'err')
    }
  }

  /** okMsg pode ser texto ou funcao(resposta) -> texto. */
  async function orderAction(btn, action, extra, confirmMsg, okMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return false
    busy(btn, true)
    try {
      var d = await post(action, Object.assign({ order_id: S.orderId }, extra || {}))
      toast(typeof okMsg === 'function' ? okMsg(d || {}) : okMsg, 'ok')
      S.panel = null
      S.rates = null
      await loadOrder(S.orderId)
      refreshMe(false).then(function () { updateTabCount() })
      return d || true
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
      return false
    }
  }

  async function buyLabel(btn) {
    var pick = el.querySelector('input[name="sp-rate"]:checked')
    if (!pick) { toast('Escolha um frete.', 'err'); return }
    var rate = (S.rates.rates || []).filter(function (r) { return r.rate_id === pick.value })[0]
    if (!rate) return
    if (!confirm('Comprar a etiqueta ' + [rate.provider, rate.service].filter(Boolean).join(' ') + ' por ' + money(rate.amount_cents) + '? O valor sai do seu repasse deste pedido.')) return
    busy(btn, true, 'Comprando…')
    try {
      var d = await post('label-buy', { order_id: S.orderId, rate_id: rate.rate_id })
      S.panel = null
      S.rates = null
      if (d.pending) {
        // A Shippo ainda esta gerando (ou nao respondeu): nao compre outra
        toast(d.message || 'Etiqueta em processamento; atualize em alguns minutos.', 'ok')
        await loadOrder(S.orderId)
        return
      }
      S.labelDone = { label_url: d.label_url, tracking_number: d.tracking_number }
      toast('Etiqueta comprada. Imprima e poste o pacote.', 'ok')
      await loadOrder(S.orderId)
      refreshMe(false).then(function () { updateTabCount() })
      var link = el.querySelector('.sp-label-ok a')
      if (link) link.focus()
    } catch (err) {
      busy(btn, false)
      toast(err.message, 'err')
    }
  }

  async function onSubmit(e) {
    var form = e.target
    if (!el.contains(form)) return
    e.preventDefault()
    var btn = e.submitter || form.querySelector('button[type="submit"]')
    try {
      if (form.id === 'sp-product-form') {
        var flag = (e.submitter && e.submitter.getAttribute('data-submit')) || submitFlag
        submitFlag = null
        await saveProduct(form, flag === '1', btn)
      } else if (form.id === 'sp-zone-form') {
        await saveZone(form, btn)
      } else if (form.id === 'sp-shop-form') {
        await saveShop(form, btn)
      } else if (form.id === 'sp-label-form') {
        var parcel = {
          length: numOrNull(val(form, 'length')), width: numOrNull(val(form, 'width')),
          height: numOrNull(val(form, 'height')), weight_oz: numOrNull(val(form, 'weight_oz')),
        }
        var keys = Object.keys(parcel)
        for (var i = 0; i < keys.length; i++) {
          if (parcel[keys[i]] === null || isNaN(parcel[keys[i]]) || parcel[keys[i]] <= 0) { toast('Preencha medidas e peso com números maiores que zero.', 'err'); return }
        }
        busy(btn, true, 'Cotando…')
        try {
          S.rates = await post('label-rates', { order_id: S.orderId, parcel: parcel })
          el.querySelector('#sp-rates').innerHTML = ratesInner()
          var r1 = el.querySelector('input[name="sp-rate"]:checked')
          if (r1) r1.focus()
        } finally {
          busy(btn, false)
        }
      } else if (form.id === 'sp-manual-form') {
        var carrier = val(form, 'carrier')
        var trk = val(form, 'tracking_number').replace(/\s+/g, '')
        if (!carrier) { toast('Escolha a transportadora.', 'err'); return }
        if (trk.length < 6) { toast('Informe o código de rastreio.', 'err'); return }
        await orderAction(btn, 'ship-manual', { carrier: carrier, tracking_number: trk }, null, 'Envio registrado. O comprador recebeu o rastreio.')
      } else if (form.id === 'sp-cancel-form') {
        var reason = val(form, 'reason')
        if (reason.length < 3) { toast('Conte o motivo do cancelamento.', 'err'); return }
        await orderAction(btn, 'cancel', { reason: reason }, 'Cancelar o pedido e devolver todo o dinheiro ao comprador?', 'Pedido cancelado. O comprador foi reembolsado.')
      } else if (form.id === 'sp-refund-form') {
        var amt = toCents(val(form, 'amount'))
        var rr = val(form, 'reason')
        if (amt == null || isNaN(amt) || amt <= 0) { toast('Informe o valor do reembolso (ex.: 10.00).', 'err'); return }
        if (amt > S.order.order.refundable_cents) { toast('O máximo é ' + money(S.order.order.refundable_cents) + '.', 'err'); return }
        if (rr.length < 3) { toast('Conte o motivo do reembolso.', 'err'); return }
        // Valor total de pedido ainda nao enviado = cancelamento (estoque volta, pedido fecha)
        var willCancel = S.order.order.status === 'paid' && amt === S.order.order.refundable_cents
        await orderAction(btn, 'refund', { amount_cents: amt, reason: rr },
          willCancel
            ? 'Reembolsar o valor total cancela o pedido (ainda não foi enviado): o comprador recebe tudo de volta e o estoque volta. Continuar?'
            : 'Reembolsar ' + money(amt) + ' ao comprador? O valor sai do seu repasse.',
          function (d) { return d.canceled ? 'Pedido cancelado e reembolsado.' : 'Reembolso feito.' })
      } else if (form.id === 'sp-handoff-form') {
        var day = val(form, 'date')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { toast('Escolha a data combinada.', 'err'); focusId('sp-h-date'); return }
        var hw = S.order.handoff || {}
        if ((hw.min_date && day < hw.min_date) || (hw.max_date && day > hw.max_date)) {
          toast('Escolha uma data entre hoje e ' + date(hw.max_date + 'T16:00:00Z', { day: 'numeric', month: 'long' }) + '.', 'err'); focusId('sp-h-date'); return
        }
        var label = date(day + 'T16:00:00Z', { weekday: 'long', day: 'numeric', month: 'long' })
        await orderAction(btn, 'schedule-handoff', { date: day },
          'Registrar ' + (S.order.order.fulfillment === 'pickup' ? 'a retirada' : 'a entrega') + ' para ' + label + '? O comprador é avisado e dá para registrar uma vez só.',
          'Data combinada registrada.')
      } else if (form.id === 'sp-msg-form') {
        var text = form.elements.body.value.trim()
        if (!text) return
        busy(btn, true, 'Enviando…')
        try {
          var d = await post('message', { order_id: S.orderId, body: text })
          S.order.messages = (S.order.messages || []).concat([d.message])
          el.querySelector('#sp-conv-wrap').innerHTML = convInner()
          var conv = el.querySelector('#sp-conv')
          if (conv) conv.scrollTop = conv.scrollHeight
          focusId('sp-msg-body')
        } finally {
          busy(btn, false)
        }
      } else if (form.getAttribute('data-form') === 'reply') {
        var rtext = form.elements.body.value.trim()
        if (!rtext) return
        busy(btn, true, 'Enviando…')
        try {
          var rd = await post('reply-review', { review_id: form.getAttribute('data-id'), body: rtext })
          S.reviews = (S.reviews || []).map(function (x) { return x.id === rd.review.id ? rd.review : x })
          toast('Resposta publicada.', 'ok')
          renderBody()
        } catch (err2) {
          busy(btn, false)
          throw err2
        }
      }
    } catch (err) {
      toast(err.message || 'Não deu certo. Tente de novo.', 'err')
    }
  }

  function onChange(e) {
    var t = e.target
    if (!el.contains(t)) return
    if (t.matches('input[data-upload]')) { uploadPhotos(t); return }
    if (t.matches('input[data-shopimg]')) { shopImage(t); return }
    if (t.id === 'sp-vac') { setVacation(t); return }
    if (t.id === 'sp-p-cat') {
      var cat = (S.me.categories || []).filter(function (c) { return c.slug === t.value })[0]
      var req = el.querySelector('#sp-catreq')
      if (req) req.innerHTML = catReqInner(cat)
      var compl = el.querySelector('#sp-compl')
      if (compl) compl.hidden = !(cat && cat.gated)
      var tip = el.querySelector('#sp-hazmat-tip')
      if (tip) tip.hidden = t.value !== 'beleza'
      return
    }
    if (t.name === 'method' && t.closest('#sp-zone-form')) {
      t.closest('#sp-zone-form').setAttribute('data-m', t.value)
    }
  }

  function onInput(e) {
    var t = e.target
    if (t.id === 'sp-p-desc') {
      var c = el.querySelector('#sp-p-desc-c')
      var n = t.value.trim().length
      if (c) { c.textContent = descCount(n); c.classList.toggle('is-low', n < 80) }
    }
    if (t.id === 'sp-p-desc' || t.id === 'sp-p-title' || t.id === 'sp-p-tags') {
      var w = el.querySelector('#sp-p-contact')
      if (!w) return
      var f = t.form
      var hit = contactHint([f.elements.title.value, f.elements.description.value, f.elements.tags.value].join(' '))
      w.textContent = hit ? 'Parece que tem ' + hit + ' no anúncio. Tire antes de enviar: anúncio com contato direto é recusado.' : ''
    }
  }

  // ── API publica ──────────────────────────────────────────────────────────
  window.BCStorePainel = {
    mount: function (container) {
      if (!container) return
      if (!window.BCStore) {
        container.innerHTML = '<div class="st-empty"><p>Não deu para carregar o painel. Atualize a página.</p></div>'
        return
      }
      injectStyles()
      el = container
      el.classList.add('sp-root')
      S = freshState()
      el.addEventListener('click', onClick)
      el.addEventListener('submit', onSubmit)
      el.addEventListener('change', onChange)
      el.addEventListener('input', onInput)
      window.addEventListener('popstate', onPop)
      render()
      B().ready.then(function () {
        B().onAuth(function (user) { boot(user) })
      })
    },
  }
})()
