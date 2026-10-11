/**
 * Aba "Store" do painel admin (public/admin/manage.html).
 * Define window.loadStore(c), chamada pelo loadTab('store').
 *
 * Fala com /api/admin/store (GET ?view=, POST ?action=) mandando x-admin-secret;
 * o admin-auth.js troca pelo Authorization: Bearer quando o login e por conta.
 *
 * Seguranca: todo dado do banco passa por esc(); imagem so do Supabase Storage
 * (bucket uploads); nenhum onclick com dado interpolado (data-* + delegacao).
 * Tudo fica dentro desta IIFE para nao colidir com os const do manage.html.
 */
(function () {
  'use strict'

  const API = '/api/admin/store'
  const SUPA_HOST = 'ggwppcbdnemjuddnzbdw.supabase.co'
  const IMG_PATH = '/storage/v1/object/public/uploads/'

  // ───────────────────────────────────────────────────────────────────────────
  // Utilidades
  // ───────────────────────────────────────────────────────────────────────────
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, ch => ESC_MAP[ch])
  }

  function secret() {
    try { if (typeof getSecret === 'function') return getSecret() } catch (_) {}
    try { return sessionStorage.getItem('bc_admin_secret') || '' } catch (_) { return '' }
  }

  function safeImg(u) {
    if (typeof u !== 'string' || !u) return ''
    try {
      const x = new URL(u)
      if (x.protocol !== 'https:' || x.hostname !== SUPA_HOST || !x.pathname.startsWith(IMG_PATH)) return ''
      return x.href
    } catch (_) { return '' }
  }

  function safeHttp(u) {
    if (typeof u !== 'string' || !u) return ''
    try {
      const x = new URL(u)
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''
    } catch (_) { return '' }
  }

  const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

  function money(cents, opts) {
    const n = (Number(cents) || 0) / 100
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', ...(opts || {}) })
  }
  const moneyRound = cents => money(cents, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
  const fmtInt = n => (Number(n) || 0).toLocaleString('pt-BR')
  const pctFromBps = bps => ((Number(bps) || 0) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%'

  function when(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d)) return '—'
    return d.toLocaleString('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  async function api(params, opts) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
    const init = { method: (opts && opts.method) || 'GET', headers: { 'x-admin-secret': secret() } }
    if (opts && opts.body) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }
    let r
    try {
      r = await fetch(API + '?' + qs.toString(), init)
    } catch (e) {
      throw new Error('Erro de rede: ' + e.message)
    }
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
      const e = new Error(d.error || ('Erro ' + r.status))
      e.status = r.status
      throw e
    }
    return d
  }
  const getView = (view, params) => api({ view, ...(params || {}) })
  const post = (action, body) => api({ action }, { method: 'POST', body: { action, ...(body || {}) } })

  // ───────────────────────────────────────────────────────────────────────────
  // Rotulos (status ficam em ingles no banco)
  // ───────────────────────────────────────────────────────────────────────────
  const L = {
    seller: { pending: ['Aguardando análise', 'warn'], approved: ['Aprovada', 'ok'], rejected: ['Reprovada', 'bad'], suspended: ['Suspensa', 'bad'] },
    product: {
      draft: ['Rascunho', 'muted'], pending_review: ['Em análise', 'warn'], approved: ['Aprovado', 'ok'], rejected: ['Reprovado', 'bad'],
      paused: ['Pausado', 'muted'], suspended: ['Suspenso', 'bad'], archived: ['Arquivado', 'muted'],
    },
    order: {
      pending_payment: ['Aguardando pagamento', 'muted'], paid: ['Pago · a enviar', 'warn'], shipped: ['Enviado', 'info'],
      delivered: ['Entregue', 'info'], completed: ['Concluído', 'ok'], canceled: ['Cancelado', 'muted'],
      refunded: ['Reembolsado', 'muted'], expired: ['Não pago', 'muted'],
    },
    payout: {
      pending: ['Repasse aguardando', 'muted'], held: ['Repasse retido', 'bad'], blocked: ['Repasse bloqueado (Stripe)', 'warn'],
      releasing: ['Repasse em processamento', 'info'], released: ['Repassado', 'ok'], reversed: ['Repasse estornado', 'bad'],
      none: ['Sem repasse', 'muted'],
    },
    dispute: {
      none: ['Sem problema', 'muted'], open: ['Problema aberto', 'warn'], escalated: ['Problema escalado', 'bad'],
      resolved_refund: ['Resolvido: reembolso', 'info'], resolved_release: ['Resolvido: loja', 'info'], chargeback: ['Contestação no cartão', 'bad'],
    },
    report: { pending: ['Pendente', 'warn'], resolved: ['Procedente', 'ok'], dismissed: ['Descartada', 'muted'] },
  }
  const REPORT_REASON = { prohibited: 'Produto proibido', counterfeit: 'Falsificado', misleading: 'Enganoso', offensive: 'Ofensivo', scam: 'Golpe', other: 'Outro' }
  const DISPUTE_REASON = { not_received: 'Não recebi', not_as_described: 'Diferente do anúncio', damaged: 'Chegou com defeito ou avariado', other: 'Outro problema' }
  const CONDITION = { new: 'Novo', used_like_new: 'Usado · como novo', used_good: 'Usado · bom estado', handmade: 'Feito à mão' }
  const ORIGIN = { handmade: 'Feito à mão', made_in_usa: 'Feito nos EUA', imported_brazil: 'Importado do Brasil', other: 'Outro' }
  const METHOD = { ship: 'Envio por transportadora', local_delivery: 'Entrega local', pickup: 'Retirada' }
  const HOLD_REASON = {
    seller_suspended: 'Loja suspensa ou dono banido', stripe_incomplete: 'Stripe da loja incompleto', tracking_returned: 'Devolvido ao remetente',
    tracking_failure: 'Falha na entrega', reversal_failed: 'Estorno do repasse falhou (virou débito da loja)',
    chargeback: 'Contestação no cartão', chargeback_lost: 'Contestação perdida no Stripe (conferir e reembolsar ou estornar)',
    refund_mismatch: 'Reembolso feito fora da Store (conferir no Stripe)',
    tracking_date_invalid: 'Rastreio suspeito: entrega anterior ao envio', tracking_address_mismatch: 'Rastreio suspeito: entregue em outro endereço',
  }
  const ACTOR = { buyer: 'Comprador', seller: 'Loja', admin: 'BrasilConnect', system: 'Sistema', stripe: 'Stripe', shippo: 'Rastreio' }
  const SENDER = { buyer: 'Comprador', seller: 'Loja', admin: 'BrasilConnect' }
  const LABEL_STATUS = { none: 'Sem etiqueta', purchasing: 'Em processamento', purchased: 'Comprada', failed: 'Falhou', refund_requested: 'Reembolso pedido', refunded: 'Reembolsada' }
  const SHOP_FIELD = { name: 'Nome', logo_url: 'Logo', banner_url: 'Capa', tagline: 'Frase', bio: 'Sobre a loja' }
  const TRACK = { PRE_TRANSIT: 'Aguardando postagem', TRANSIT: 'Em trânsito', DELIVERED: 'Entregue', RETURNED: 'Devolvido', FAILURE: 'Falha', UNKNOWN: 'Sem informação' }
  const SEV = { critical: ['IA: crítico', 'bad'], high: ['IA: alto risco', 'bad'], medium: ['IA: atenção', 'warn'], low: ['IA: baixo risco', 'ok'] }

  function badge(map, key) {
    const m = map[key] || [key || '—', 'muted']
    return `<span class="as-badge as-${m[1]}">${esc(m[0])}</span>`
  }
  const tag = (text, tone) => `<span class="as-badge as-${tone || 'muted'}">${esc(text)}</span>`

  function holdLabel(r) {
    if (!r) return ''
    if (HOLD_REASON[r]) return HOLD_REASON[r]
    if (String(r).startsWith('admin: ')) return 'BrasilConnect: ' + String(r).slice(7)
    return String(r)
  }

  function aiBadge(x) {
    const st = x.agent_status
    if (!st || st === 'pending') return tag('IA: na fila', 'muted')
    if (st === 'reviewed') return tag('Revisado', 'muted')
    if (st === 'clean') return tag('IA: sem alerta', 'ok')
    const m = SEV[x.agent_severity] || ['IA: sinalizado', 'warn']
    return tag(m[0], m[1])
  }
  function aiNote(x) {
    if (!x.agent_reasoning || x.agent_status === 'clean' || x.agent_status === 'pending') return ''
    const cats = Array.isArray(x.agent_categories) && x.agent_categories.length ? ' · ' + x.agent_categories.map(esc).join(', ') : ''
    return `<div class="as-ai"><strong>Análise da IA${cats}:</strong> ${esc(x.agent_reasoning)}</div>`
  }

  const kv = (label, text) => `<div class="as-kv"><dt>${esc(label)}</dt><dd>${esc(text === null || text === undefined || text === '' ? '—' : text)}</dd></div>`
  const kvh = (label, html) => `<div class="as-kv"><dt>${esc(label)}</dt><dd>${html || '—'}</dd></div>`

  function errBox(e) {
    return `<div class="as-err" role="alert">${esc(e && e.message ? e.message : 'Erro.')}</div>`
  }

  const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

  // ───────────────────────────────────────────────────────────────────────────
  // Estilo (injetado uma vez; prefixo as-)
  // ───────────────────────────────────────────────────────────────────────────
  const CSS = `
.as-root { font-size:14px; color:var(--ink); }
.as-root *, .as-overlay * { box-sizing:border-box; }
.as-sr { position:absolute !important; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.as-subtabs { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 16px; }
.as-subtab { display:inline-flex; align-items:center; gap:6px; min-height:36px; padding:6px 14px; border:1px solid var(--line-strong); border-radius:999px; background:var(--paper-elevated); color:var(--ink-soft); font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
.as-subtab[aria-current="page"] { background:var(--ink); border-color:var(--ink); color:var(--paper); }
.as-count { min-width:20px; padding:1px 6px; border-radius:999px; background:#FEF3C7; color:#92400E; font-size:11px; font-weight:700; text-align:center; }
.as-root :focus-visible, .as-overlay :focus-visible { outline:2px solid var(--green-deep); outline-offset:2px; }
.as-root .panel { padding:20px; }
.as-root .item .actions { flex-wrap:wrap; align-items:center; }
.as-root .btn-mini, .as-overlay .btn-mini { min-height:32px; }
.as-root a.btn-mini, .as-overlay a.btn-mini { display:inline-flex; align-items:center; text-decoration:none; }
.as-root .btn-mini[disabled], .as-overlay .btn-mini[disabled] { opacity:.5; cursor:not-allowed; }
.as-btn-ghost { background:transparent; border:1px solid var(--line-strong) !important; color:var(--ink-soft); }
.as-btn-danger { background:transparent; border:1px solid #DC2626 !important; color:#B91C1C; }
.as-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:10.5px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; vertical-align:middle; white-space:nowrap; }
.as-ok { background:#DCFCE7; color:#166534; } .as-warn { background:#FEF3C7; color:#92400E; } .as-bad { background:#FEE2E2; color:#991B1B; }
.as-info { background:#DBEAFE; color:#1E40AF; } .as-muted { background:#F3F4F6; color:#6B7280; }
.as-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-top:12px; }
.as-stat { display:block; width:100%; text-align:left; padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--paper-soft); font:inherit; color:inherit; }
button.as-stat { cursor:pointer; }
button.as-stat:hover { border-color:var(--line-strong); }
.as-stat.is-alert { background:#FEFCE8; border-color:#FDE047; }
.as-stat.is-danger { background:#FEF2F2; border-color:#FCA5A5; }
.as-stat-label { display:block; font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-muted); }
.as-stat-value { display:block; font-size:22px; font-weight:800; margin-top:2px; font-variant-numeric:tabular-nums; }
.as-stat-sub { display:block; font-size:11.5px; color:var(--ink-muted); margin-top:2px; }
.as-switch-row { display:flex; gap:12px; align-items:center; justify-content:space-between; padding:12px 0; border-top:1px solid var(--line); flex-wrap:wrap; }
.as-switch-row > div { flex:1 1 220px; min-width:0; }
.as-switch { display:inline-flex; align-items:center; gap:8px; min-height:36px; padding:4px 12px 4px 4px; border:1px solid var(--line-strong); border-radius:999px; background:var(--paper); font:inherit; font-size:13px; font-weight:600; cursor:pointer; color:var(--ink-soft); }
.as-knob { width:36px; height:22px; border-radius:999px; background:#D1D5DB; position:relative; flex:none; transition:background .15s; }
.as-knob::after { content:''; position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s; }
.as-switch[aria-checked="true"] .as-knob { background:var(--green-deep); }
.as-switch[aria-checked="true"] .as-knob::after { transform:translateX(14px); }
.as-strong { font-weight:700; }
.as-hint { font-size:12px; color:var(--ink-muted); line-height:1.45; margin-top:2px; }
.as-callout { padding:10px 12px; border-radius:8px; font-size:12.5px; line-height:1.5; margin:8px 0; overflow-wrap:anywhere; }
.as-callout.warn { background:#FEF7E0; border-left:3px solid #B45309; color:#7A4A0E; }
.as-callout.info { background:var(--paper); border-left:3px solid var(--green-deep); color:var(--ink-soft); }
.as-callout.bad { background:#FEF2F2; border-left:3px solid #DC2626; color:#7F1D1D; }
.as-toolbar { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; margin:0 0 12px; }
.as-field { display:flex; flex-direction:column; gap:4px; font-size:11px; font-weight:600; color:var(--ink-muted); text-transform:uppercase; letter-spacing:.06em; }
.as-root select, .as-root input[type="search"], .as-root input[type="text"], .as-root input[type="number"], .as-overlay textarea { font:inherit; font-size:14px; padding:8px 10px; border:1px solid var(--line-strong); border-radius:8px; background:#fff; color:var(--ink); max-width:100%; }
.as-search { display:flex; gap:6px; flex:1 1 240px; align-items:flex-end; min-width:0; }
.as-search input { flex:1; min-width:0; }
.as-pills { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 10px; }
.as-pill { min-height:32px; padding:4px 12px; border-radius:999px; border:1px solid var(--line-strong); background:var(--paper-elevated); font:inherit; font-size:12.5px; font-weight:600; color:var(--ink-soft); cursor:pointer; }
.as-pill[aria-pressed="true"] { background:var(--ink); color:var(--paper); border-color:var(--ink); }
.as-summary { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:var(--ink-muted); margin:0 0 12px; }
.as-summary b { color:var(--ink); }
.as-card-head { display:flex; gap:12px; align-items:flex-start; }
.as-logo { width:48px; height:48px; border-radius:10px; object-fit:cover; flex:none; background:var(--paper-soft); }
.as-logo-ph { display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--ink-muted); }
.as-grow { flex:1; min-width:0; }
.as-title { font-weight:700; font-size:15px; overflow-wrap:anywhere; }
.as-sub { font-size:12px; color:var(--ink-muted); margin-top:2px; overflow-wrap:anywhere; }
.as-badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.as-kvs { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:6px 16px; margin:10px 0; font-size:12.5px; }
.as-kv { min-width:0; margin:0; }
.as-kv dt { color:var(--ink-muted); font-size:11px; }
.as-kv dd { margin:0; overflow-wrap:anywhere; }
.as-text { white-space:pre-wrap; overflow-wrap:anywhere; max-height:220px; overflow:auto; }
.as-thumbs { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0; }
.as-thumb { display:block; width:72px; height:72px; border-radius:8px; overflow:hidden; border:1px solid var(--line); background:var(--paper-soft); }
.as-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.as-price { color:var(--green-deep); font-weight:700; font-variant-numeric:tabular-nums; }
.as-strike { text-decoration:line-through; color:var(--ink-muted); margin-left:6px; font-variant-numeric:tabular-nums; }
.as-msg { font-size:12.5px; color:var(--ink-muted); margin:6px 0 0; min-height:1em; }
.as-msg.is-ok { color:#166534; } .as-msg.is-err { color:#B91C1C; }
.as-ai { font-size:12px; padding:8px 10px; border-radius:6px; margin-top:8px; background:#FEF7E0; border-left:3px solid #B45309; color:#7A4A0E; overflow-wrap:anywhere; }
.as-sec-title { margin:14px 0 6px; font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--brand-gold-dark); font-weight:700; }
.as-table-wrap { width:100%; overflow-x:auto; }
.as-table { width:100%; border-collapse:collapse; font-size:13px; }
.as-table th { text-align:left; padding:8px 10px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted); border-bottom:1px solid var(--line-strong); white-space:nowrap; }
.as-table td { padding:10px; border-bottom:1px solid var(--line); vertical-align:top; }
.as-num { font-variant-numeric:tabular-nums; white-space:nowrap; }
.as-mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11.5px; overflow-wrap:anywhere; }
.as-barcell { display:flex; align-items:center; gap:8px; }
.as-bar { flex:1; height:8px; border-radius:999px; background:var(--paper-soft); overflow:hidden; min-width:70px; }
.as-bar span { display:block; height:100%; background:var(--green-deep); }
.as-bar span.is-warn { background:#D97706; }
.as-bar span.is-over { background:#DC2626; }
.as-form { display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:16px 22px; }
.as-f { display:flex; flex-direction:column; gap:4px; min-width:0; }
.as-f label { font-size:13px; font-weight:600; color:var(--ink); }
.as-check { display:flex; gap:10px; align-items:flex-start; }
.as-check input { width:18px; height:18px; margin-top:2px; flex:none; }
.as-empty { padding:28px 12px; text-align:center; color:var(--ink-muted); font-size:13px; }
.as-loading { padding:20px; color:var(--ink-muted); }
.as-err { background:#FBE9E7; color:#802020; border:1px solid #E8C2BC; padding:10px 14px; border-radius:6px; font-size:13px; }
.as-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1002; display:flex; align-items:flex-start; justify-content:center; padding:24px 16px; overflow-y:auto; }
.as-overlay[hidden] { display:none; }
.as-modal { background:var(--paper-elevated); border-radius:14px; width:100%; max-width:820px; box-shadow:0 18px 48px rgba(0,0,0,.25); color:var(--ink); font-size:14px; }
.as-modal-head { position:sticky; top:0; display:flex; align-items:center; gap:10px; padding:14px 18px; border-bottom:1px solid var(--line); background:var(--paper-elevated); border-radius:14px 14px 0 0; z-index:1; }
.as-modal-head h3 { margin:0; font-size:17px; flex:1; min-width:0; overflow-wrap:anywhere; }
.as-x { width:36px; height:36px; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:8px; background:transparent; cursor:pointer; color:var(--ink-soft); flex:none; }
.as-modal-body { padding:14px 18px 22px; }
.as-sec { padding:12px 0; border-bottom:1px dashed var(--line); }
.as-sec:last-child { border-bottom:none; }
.as-sec h4 { margin:0 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--brand-gold-dark); }
.as-actions { display:flex; gap:8px; flex-wrap:wrap; }
.as-items { list-style:none; margin:0; padding:0; }
.as-items li { display:flex; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--line); }
.as-items img { width:44px; height:44px; border-radius:6px; object-fit:cover; flex:none; }
.as-timeline { list-style:none; margin:0; padding:0; font-size:12.5px; }
.as-timeline li { padding:6px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
.as-chat { display:flex; flex-direction:column; gap:8px; max-height:320px; overflow:auto; margin-bottom:10px; }
.as-bubble { padding:8px 10px; border-radius:8px; background:var(--paper); font-size:13px; white-space:pre-wrap; overflow-wrap:anywhere; }
.as-bubble.is-admin { background:var(--green-soft); }
.as-msgform { display:flex; flex-direction:column; gap:6px; }
.as-msgform textarea { width:100%; min-height:80px; resize:vertical; }
.as-msgform .btn-mini { align-self:flex-start; }
.as-photo { max-width:100%; max-height:75vh; display:block; margin:0 auto; border-radius:8px; }
@media (max-width: 640px) {
  .admin-container:has(.as-root) { padding:0 16px; }
  .as-root .panel { padding:14px; }
  .as-table thead { display:none; }
  .as-table, .as-table tbody, .as-table tr, .as-table td { display:block; width:100%; }
  .as-table tr { border:1px solid var(--line); border-radius:10px; padding:6px 10px; margin-bottom:8px; }
  .as-table td { border:none; padding:4px 0; display:flex; justify-content:space-between; gap:10px; text-align:right; overflow-wrap:anywhere; min-width:0; }
  .as-table td > * { min-width:0; }
  .as-table td::before { content:attr(data-label); font-size:11px; color:var(--ink-muted); text-transform:uppercase; letter-spacing:.05em; text-align:left; flex:none; }
  .as-table td.as-td-act { justify-content:flex-end; }
  .as-table td.as-td-act::before { content:none; }
  .as-overlay { padding:0; }
  .as-modal { border-radius:0; min-height:100%; }
  .as-modal-head { border-radius:0; }
}
`
  function ensureStyle() {
    if (document.getElementById('as-style')) return
    const s = document.createElement('style')
    s.id = 'as-style'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Estado (filtros guardados no dataset do #tab-content, como as outras abas)
  // ───────────────────────────────────────────────────────────────────────────
  const SUBS = [
    { id: 'overview', label: 'Resumo' },
    { id: 'sellers', label: 'Lojas', count: k => (k.sellers_pending || 0) + (k.shop_changes_pending || 0) },
    { id: 'products', label: 'Produtos', count: k => k.products_pending },
    { id: 'orders', label: 'Pedidos', count: k => (k.orders_late || 0) + (k.disputes_escalated || 0) + (k.labels_stuck || 0) },
    { id: 'reports', label: 'Denúncias', count: k => k.reports_pending },
    { id: 'reviews', label: 'Avaliações', count: k => k.reviews_flagged },
    { id: 'taxes', label: 'Impostos' },
    { id: 'config', label: 'Configuração' },
  ]
  const SUB_IDS = SUBS.map(s => s.id)
  const DS_KEYS = ['stSub', 'stSellerStatus', 'stSellerQ', 'stProductStatus', 'stProductQ', 'stProductSeller', 'stProductSellerName', 'stOrderFilter', 'stOrderQ', 'stReportStatus', 'stReviewFilter']

  function setState(c, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!DS_KEYS.includes(k)) continue
      if (v === null || v === undefined || v === '') delete c.dataset[k]
      else c.dataset[k] = String(v)
    }
  }

  /** So recarrega se a aba Store ainda estiver na tela (nao atropela outra aba). */
  function reloadIfVisible(c) {
    if (c && c.querySelector('.as-root')) loadStore(c)
  }

  function subtabs(active, counts) {
    const k = counts || {}
    return `<nav class="as-subtabs" aria-label="Seções da Store">${SUBS.map(s => {
      const n = s.count ? Number(s.count(k)) || 0 : 0
      return `<button type="button" class="as-subtab" data-as-sub="${esc(s.id)}"${s.id === active ? ' aria-current="page"' : ''}>${esc(s.label)}${n ? ` <span class="as-count" aria-label="${esc(n + ' pendente(s)')}">${esc(n)}</span>` : ''}</button>`
    }).join('')}</nav>`
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Entrada: loadStore(c)
  // ───────────────────────────────────────────────────────────────────────────
  async function loadStore(c) {
    c = c || document.getElementById('tab-content')
    if (!c) return
    ensureStyle()
    bind(c)
    const sub = SUB_IDS.includes(c.dataset.stSub) ? c.dataset.stSub : 'overview'
    const token = (c._asToken || 0) + 1
    c._asToken = token
    c.innerHTML = `<div class="as-root">${subtabs(sub, c._asCounts)}<div class="as-body" aria-live="polite" aria-busy="true"><p class="as-loading">Carregando…</p></div></div>`
    const body = c.querySelector('.as-body')
    const alive = () => c._asToken === token && c.contains(body)

    try {
      let html
      if (sub === 'overview') {
        const ov = await getView('overview')
        c._asCounts = ov.counts || {}
        c._asConfig = ov.config || {}
        html = renderOverview(ov)
      } else {
        getView('overview').then(ov => {
          c._asCounts = ov.counts || {}
          c._asConfig = ov.config || {}
          if (alive()) refreshCounts(c, sub)
        }).catch(() => {})
        html = await RENDER[sub](c)
      }
      if (!alive()) return
      body.innerHTML = html
      body.setAttribute('aria-busy', 'false')
      refreshCounts(c, sub)
    } catch (e) {
      if (!alive()) return
      body.innerHTML = errBox(e)
      body.setAttribute('aria-busy', 'false')
    }
  }

  function refreshCounts(c, sub) {
    const nav = c.querySelector('.as-subtabs')
    if (!nav || nav.contains(document.activeElement)) return
    nav.outerHTML = subtabs(sub, c._asCounts)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Eventos (delegacao no #tab-content; so reage a data-as-*)
  // ───────────────────────────────────────────────────────────────────────────
  function bind(c) {
    if (c._asBound) return
    c._asBound = true
    c.addEventListener('click', ev => onClick(ev, c))
    c.addEventListener('change', ev => onChange(ev, c))
    c.addEventListener('submit', ev => onSubmit(ev, c))
  }

  function onClick(ev, c) {
    const t = ev.target.closest('[data-as-sub],[data-as-go],[data-as-act]')
    if (!t || !c.contains(t) || !c.querySelector('.as-root')) return
    if (t.hasAttribute('data-as-sub')) {
      setState(c, { stSub: t.dataset.asSub })
      loadStore(c)
      return
    }
    if (t.hasAttribute('data-as-go')) {
      const patch = { stSub: t.dataset.asGo }
      if (t.dataset.key) patch[t.dataset.key] = t.dataset.value || ''
      setState(c, patch)
      loadStore(c)
      return
    }
    const act = t.dataset.asAct
    if (act === 'filter') {
      setState(c, { [t.dataset.key]: t.dataset.value || '' })
      loadStore(c)
    } else if (act === 'clear-seller') {
      setState(c, { stProductSeller: '', stProductSellerName: '' })
      loadStore(c)
    } else if (act === 'seller-products') {
      setState(c, { stSub: 'products', stProductSeller: t.dataset.id, stProductSellerName: t.dataset.name, stProductStatus: 'all', stProductQ: '' })
      loadStore(c)
    } else if (act === 'toggle') toggleConfig(c, t)
    else if (act === 'seller') sellerAct(c, t)
    else if (act === 'seller-changes') sellerChangesAct(c, t)
    else if (act === 'seller-debt') sellerDebtAct(c, t)
    else if (act === 'review') reviewAct(c, t)
    else if (act === 'seller-fee') sellerFee(c, t)
    else if (act === 'product') productAct(c, t)
    else if (act === 'report') reportAct(c, t)
    else if (act === 'order') openOrder(c, t.dataset.id)
    else if (act === 'photo') {
      ev.preventDefault()
      openPhoto(t.getAttribute('href'), t.dataset.alt)
    } else if (act === 'reload') loadStore(c)
  }

  function onChange(ev, c) {
    const sel = ev.target.closest('select[data-as-filter]')
    if (!sel || !c.contains(sel) || !c.querySelector('.as-root')) return
    setState(c, { [sel.dataset.asFilter]: sel.value })
    loadStore(c)
  }

  function onSubmit(ev, c) {
    const form = ev.target.closest('form[data-as-form]')
    if (!form || !c.contains(form)) return
    ev.preventDefault()
    if (form.dataset.asForm === 'search') {
      const input = form.querySelector('input[name="q"]')
      setState(c, { [form.dataset.key]: input ? input.value.trim().slice(0, 120) : '' })
      loadStore(c)
    } else if (form.dataset.asForm === 'config') {
      saveConfigForm(c, form)
    }
  }

  function say(scope, text, kind) {
    const m = scope && scope.querySelector('.as-msg')
    if (!m) return
    m.textContent = text || ''
    m.className = 'as-msg' + (kind ? ' is-' + kind : '')
  }

  /** Roda uma acao de card: trava os botoes, mostra o andamento e recarrega. */
  async function runCardAction(c, btn, fn, opts) {
    const scope = btn.closest('.item') || btn.closest('.panel') || btn.closest('.as-root')
    const btns = scope ? [...scope.querySelectorAll('button')] : [btn]
    const prev = btns.map(b => b.disabled)
    btns.forEach(b => { b.disabled = true })
    say(scope, (opts && opts.working) || 'Salvando…')
    try {
      const d = await fn()
      const done = opts && opts.done
      say(scope, typeof done === 'function' ? done(d) : (done || 'Feito.'), 'ok')
      setTimeout(() => reloadIfVisible(c), 1200)
    } catch (e) {
      say(scope, e.message, 'err')
      btns.forEach((b, i) => { b.disabled = prev[i] })
    }
  }

  function askReason(msg, def) {
    let v = prompt(msg, def || '')
    while (v !== null && v.trim().length < 3) {
      v = prompt('O motivo é obrigatório (pelo menos 3 letras).\n\n' + msg, v)
    }
    return v === null ? null : v.trim().slice(0, 1000)
  }

  function askMoney(msg, maxCents, allowZero) {
    let v = prompt(msg, ((Number(maxCents) || 0) / 100).toFixed(2))
    while (v !== null) {
      const n = Number(String(v).trim().replace(/[$\s]/g, '').replace(',', '.'))
      const cents = Math.round(n * 100)
      if (String(v).trim() !== '' && isFinite(n) && (allowZero ? cents >= 0 : cents > 0) && cents <= maxCents) return cents
      v = prompt(`Valor inválido. Use um número de ${allowZero ? '0' : '0.01'} até ${(maxCents / 100).toFixed(2)}.\n\n${msg}`, v)
    }
    return null
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Resumo
  // ───────────────────────────────────────────────────────────────────────────
  function statBtn(label, value, go, key, val, tone, sub) {
    return `<button type="button" class="as-stat${tone ? ' ' + tone : ''}" data-as-go="${esc(go)}" data-key="${esc(key || '')}" data-value="${esc(val || '')}">
      <span class="as-stat-label">${esc(label)}</span><span class="as-stat-value">${esc(fmtInt(value))}</span>${sub ? `<span class="as-stat-sub">${esc(sub)}</span>` : ''}</button>`
  }
  function statBox(label, value, sub) {
    return `<div class="as-stat"><span class="as-stat-label">${esc(label)}</span><span class="as-stat-value">${esc(value)}</span>${sub ? `<span class="as-stat-sub">${esc(sub)}</span>` : ''}</div>`
  }

  function switchRow(field, on, title, hint) {
    return `<div class="as-switch-row">
      <div><div class="as-strong">${esc(title)}</div><div class="as-hint">${esc(hint)}</div></div>
      <button type="button" class="as-switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(title)}" data-as-act="toggle" data-field="${esc(field)}">
        <span class="as-knob" aria-hidden="true"></span><span>${on ? 'Ligada' : 'Desligada'}</span>
      </button>
    </div>`
  }

  function renderOverview(d) {
    const k = d.counts || {}
    const cfg = d.config || {}
    const alert = n => (Number(n) > 0 ? 'is-alert' : '')
    const danger = n => (Number(n) > 0 ? 'is-danger' : '')
    return `
      <div class="panel">
        <div class="panel-eyebrow">BRASILCONNECT STORE</div>
        <h3>O que precisa de você</h3>
        <p class="panel-sub">Clique num quadro para abrir a fila correspondente.</p>
        <div class="as-stats">
          ${statBtn('Lojas aguardando', k.sellers_pending, 'sellers', 'stSellerStatus', 'pending', alert(k.sellers_pending))}
          ${statBtn('Produtos em análise', k.products_pending, 'products', 'stProductStatus', 'pending_review', alert(k.products_pending))}
          ${statBtn('Denúncias', k.reports_pending, 'reports', 'stReportStatus', 'pending', alert(k.reports_pending))}
          ${statBtn('Problemas escalados', k.disputes_escalated, 'orders', 'stOrderFilter', 'disputes', danger(k.disputes_escalated), 'A BrasilConnect decide')}
          ${statBtn('Problemas abertos', k.disputes_open, 'orders', 'stOrderFilter', 'disputes', alert(k.disputes_open), 'Loja e comprador conversando')}
          ${statBtn('Contestações no cartão', k.chargebacks, 'orders', 'stOrderFilter', 'disputes', danger(k.chargebacks))}
          ${statBtn('Pedidos atrasados', k.orders_late, 'orders', 'stOrderFilter', 'late', danger(k.orders_late), 'Prazo de postagem vencido')}
          ${statBtn('A enviar', k.orders_to_ship, 'orders', 'stOrderFilter', 'to_ship', '')}
          ${statBtn('Repasses bloqueados', k.payouts_blocked, 'orders', 'stOrderFilter', 'blocked', alert(k.payouts_blocked), 'Loja sem Stripe ativo')}
          ${statBtn('Repasses retidos', k.payouts_held, 'orders', 'stOrderFilter', 'held', alert(k.payouts_held))}
          ${statBtn('Etiquetas travadas', k.labels_stuck, 'orders', 'stOrderFilter', 'labels', danger(k.labels_stuck), 'Em processamento há mais de 10 min')}
          ${statBtn('Alterações de loja', k.shop_changes_pending, 'sellers', 'stSellerStatus', 'changes', alert(k.shop_changes_pending), 'Nome, logo ou capa novos')}
          ${statBtn('Lojas com débito', k.sellers_debt, 'sellers', 'stSellerStatus', 'debt', alert(k.sellers_debt), 'Estorno que o Stripe recusou')}
          ${statBtn('Avaliações sinalizadas', k.reviews_flagged, 'reviews', 'stReviewFilter', 'flagged', alert(k.reviews_flagged), 'A IA marcou para conferir')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-eyebrow">ÚLTIMOS 30 DIAS</div>
        <h3>Vendas</h3>
        <div class="as-stats">
          ${statBox('Vendas (GMV)', money(d.gmv_30d_cents), 'Itens + frete, menos reembolsos')}
          ${statBox('Comissão', money(d.fees_30d_cents), 'Estimada sobre os pedidos pagos')}
          ${statBox('Pedidos pagos', fmtInt(d.orders_30d))}
          ${statBox('Comissão atual', pctFromBps(cfg.fee_bps), (cfg.fee_fixed_cents ? '+ ' + money(cfg.fee_fixed_cents) + ' por pedido · ' : '') + (cfg.fee_on_shipping ? 'inclui o frete' : 'só sobre itens'))}
        </div>
      </div>

      <div class="panel">
        <div class="panel-eyebrow">LANÇAMENTO</div>
        <h3>Vitrine e compras</h3>
        <p class="panel-sub">Cada mudança pede confirmação e fica registrada.</p>
        ${switchRow('public_enabled', !!cfg.public_enabled, 'Vitrine aberta ao público', 'Desligada, só quem abre /store?preview=brasil2026 vê a Store. Lojas já podem se cadastrar.')}
        ${switchRow('checkout_enabled', !!cfg.checkout_enabled, 'Compras liberadas', 'Desligada, ninguém consegue pagar. Pedidos já pagos continuam normais.')}
        ${cfg.tax_enabled ? '' : '<div class="as-callout warn">Sales tax (Stripe Tax) está desligado. Fale com o contador antes de liberar as compras. Veja a seção Impostos.</div>'}
        <p class="as-msg" role="status" aria-live="polite"></p>
      </div>`
  }

  async function toggleConfig(c, btn) {
    const field = btn.dataset.field
    if (field !== 'public_enabled' && field !== 'checkout_enabled') return
    const value = btn.getAttribute('aria-checked') !== 'true'
    const cfg = c._asConfig || {}
    // A lista de espera e avisada quando a Store fica aberta para COMPRAS (vitrine e compras ligadas)
    const WL_NOW = '\n\nCom a vitrine e as compras ligadas, a lista de espera recebe o aviso de que a Store abriu para compras.'
    const WL_LATER = '\n\nA lista de espera só é avisada quando a vitrine e as compras estiverem ligadas.'
    const texts = {
      public_enabled: {
        true: 'Abrir a vitrine da Store para todo mundo?' + (cfg.checkout_enabled ? WL_NOW : '\n\nAs compras continuam fechadas.' + WL_LATER),
        false: 'Fechar a vitrine? Os produtos somem para o público (o preview continua funcionando).',
      },
      checkout_enabled: {
        true: 'Liberar as compras na Store? A partir de agora os clientes conseguem pagar.' + (cfg.public_enabled ? WL_NOW : WL_LATER) + (cfg.tax_enabled ? '' : '\n\nAtenção: o sales tax (Stripe Tax) está desligado.'),
        false: 'Pausar as compras? Ninguém consegue pagar até você ligar de novo. Pedidos já pagos continuam.',
      },
    }
    if (!confirm(texts[field][String(value)])) return
    await runCardAction(c, btn, async () => followWaitlist(await post('save_config', { [field]: value })), { done: 'Salvo.' })
  }

  /** Store aberta para compras: o servidor avisa a lista de espera em lotes; aqui o admin manda os próximos. */
  async function followWaitlist(d) {
    while (d && d.waitlist) {
      const w = d.waitlist
      if (w.error) { alert(w.error); break }
      if (!w.remaining) { if (w.sent) alert('A Store abriu para compras: avisamos ' + w.sent + ' pessoa(s) da lista de espera.'); break }
      if (!confirm('A Store abriu para compras: avisamos ' + w.sent + ' pessoa(s) da lista de espera. Faltam ' + w.remaining + '. Enviar o próximo lote?')) break
      let next
      try {
        next = await post('notify_waitlist', {})
      } catch (e) {
        // A configuração já foi salva: só o lote falhou
        alert('Não deu para enviar o próximo lote: ' + e.message + '\n\nA configuração foi salva. ' + w.remaining + ' pessoa(s) da lista ainda não foram avisadas.')
        break
      }
      // O próximo lote não traz a configuração: mantém a do save
      d = { ...d, waitlist: next && next.waitlist }
    }
    return d
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lojas
  // ───────────────────────────────────────────────────────────────────────────
  function statusSelect(key, current, options, label) {
    const id = 'as-sel-' + key
    return `<div class="as-field"><label for="${esc(id)}">${esc(label || 'Situação')}</label>
      <select id="${esc(id)}" data-as-filter="${esc(key)}">${options.map(([v, t]) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`
  }

  function searchForm(key, value, placeholder, label) {
    const id = 'as-q-' + key
    return `<form class="as-search" role="search" data-as-form="search" data-key="${esc(key)}">
      <div class="as-field" style="flex:1;min-width:0;"><label for="${esc(id)}">${esc(label || 'Buscar')}</label>
      <input id="${esc(id)}" name="q" type="search" maxlength="120" placeholder="${esc(placeholder)}" value="${esc(value)}"></div>
      <button type="submit" class="btn-mini btn-mark">Buscar</button>
      ${value ? `<button type="button" class="btn-mini as-btn-ghost" data-as-act="filter" data-key="${esc(key)}" data-value="">Limpar</button>` : ''}
    </form>`
  }

  function summaryLine(s, map) {
    return `<div class="as-summary">${Object.keys(map).map(k => `<span>${esc(map[k][0])}: <b>${esc(fmtInt(s[k]))}</b></span>`).join('')}<span>Total: <b>${esc(fmtInt(s.total))}</b></span></div>`
  }

  async function renderSellers(c) {
    const status = c.dataset.stSellerStatus || 'pending'
    const q = c.dataset.stSellerQ || ''
    const d = await getView('sellers', { status, q })
    const list = d.sellers || []
    const toolbar = `<div class="as-toolbar">
      ${statusSelect('stSellerStatus', status, [['pending', 'Aguardando análise'], ['changes', 'Alterações pendentes'], ['approved', 'Aprovadas'], ['rejected', 'Reprovadas'], ['suspended', 'Suspensas'], ['debt', 'Com débito'], ['all', 'Todas']])}
      ${searchForm('stSellerQ', q, 'Nome, endereço da loja, e-mail ou cidade', 'Buscar loja')}
    </div>`
    return `<div class="panel">
      <div class="panel-eyebrow">LOJAS</div>
      <h3>${esc(fmtInt(list.length))} loja${list.length === 1 ? '' : 's'} nesta lista</h3>
      <p class="panel-sub">Aprove só quem tem dados completos e produtos permitidos. A loja recebe aviso no sino e por e-mail.</p>
      ${summaryLine(d.summary || {}, { ...L.seller, changes: ['Alterações pendentes'], debt: ['Com débito'] })}
      ${toolbar}
      ${list.length ? list.map(sellerCard).join('') : `<div class="as-empty">${status === 'pending' ? 'Nenhuma loja aguardando análise.' : status === 'changes' ? 'Nenhuma alteração de loja esperando aprovação.' : 'Nenhuma loja neste filtro.'}</div>`}
    </div>`
  }

  function stripeBadges(s) {
    const out = []
    if (s.stripe_transfers_active) out.push(tag('Recebimentos ativos', 'ok'))
    else if (s.stripe_details_submitted) out.push(tag('Stripe em análise', 'warn'))
    else if (s.stripe_account_id) out.push(tag('Stripe incompleto', 'warn'))
    else out.push(tag('Sem Stripe', 'muted'))
    if (s.stripe_account_id && !s.stripe_payouts_enabled) out.push(tag('Saque no banco desligado', 'muted'))
    return out.join(' ')
  }

  function sellerCard(s) {
    const logo = safeImg(s.logo_url)
    const initials = esc(String(s.name || '?').trim().slice(0, 2).toUpperCase())
    const p = s.products || {}
    const zones = Array.isArray(s.zones) ? s.zones : []
    const due = Array.isArray(s.stripe_requirements_due) ? s.stripe_requirements_due : []
    const zonesText = zones.length
      ? zones.map(z => `${METHOD[z.method] || z.method}: ${z.name}${z.states && z.states.length ? ' (' + z.states.join(', ') + ')' : ''}${z.zip_count ? ' · ' + z.zip_count + ' CEP(s)' : ''}${z.active ? '' : ' · desligada'}`).join(' | ')
      : 'Nenhuma região cadastrada'
    const actions = []
    const dataBase = `data-id="${esc(s.id)}" data-name="${esc(s.name)}"`
    if (s.status === 'pending' || s.status === 'rejected') actions.push(`<button type="button" class="btn-mini btn-approve" data-as-act="seller" data-op="approve_seller" ${dataBase}>Aprovar loja</button>`)
    if (s.status === 'pending') actions.push(`<button type="button" class="btn-mini as-btn-danger" data-as-act="seller" data-op="reject_seller" ${dataBase}>Reprovar</button>`)
    if (s.status === 'approved') actions.push(`<button type="button" class="btn-mini btn-reject" data-as-act="seller" data-op="suspend_seller" ${dataBase}>Suspender</button>`)
    if (s.status === 'suspended') actions.push(`<button type="button" class="btn-mini btn-approve" data-as-act="seller" data-op="reinstate_seller" ${dataBase}>Reativar</button>`)
    const pc = s.pending_changes && typeof s.pending_changes === 'object' ? s.pending_changes : null
    if (pc) {
      actions.push(`<button type="button" class="btn-mini btn-approve" data-as-act="seller-changes" data-op="approve_shop_changes" ${dataBase} data-at="${esc(s.pending_changes_at || '')}">Aprovar alterações</button>`)
      actions.push(`<button type="button" class="btn-mini as-btn-danger" data-as-act="seller-changes" data-op="reject_shop_changes" ${dataBase} data-at="${esc(s.pending_changes_at || '')}">Recusar alterações</button>`)
    }
    if (Number(s.debt_cents) > 0) actions.push(`<button type="button" class="btn-mini as-btn-ghost" data-as-act="seller-debt" ${dataBase} data-debt="${esc(s.debt_cents)}">Zerar débito</button>`)
    actions.push(`<button type="button" class="btn-mini as-btn-ghost" data-as-act="seller-fee" ${dataBase} data-current="${esc(s.fee_bps_override === null || s.fee_bps_override === undefined ? '' : s.fee_bps_override)}">Comissão especial</button>`)
    actions.push(`<button type="button" class="btn-mini as-btn-ghost" data-as-act="seller-products" ${dataBase}>Ver produtos (${esc(fmtInt(p.total))})</button>`)
    if (s.status === 'approved' && s.slug) actions.push(`<a class="btn-mini as-btn-ghost" href="/store/loja/${esc(encodeURIComponent(s.slug))}" target="_blank" rel="noopener noreferrer">Ver na Store</a>`)

    return `<div class="item">
      <div class="as-card-head">
        ${logo ? `<img class="as-logo" src="${esc(logo)}" alt="" loading="lazy" width="48" height="48">` : `<div class="as-logo as-logo-ph" aria-hidden="true">${initials}</div>`}
        <div class="as-grow">
          <div class="as-title">${esc(s.name || '(sem nome)')}</div>
          <div class="as-sub">/store/loja/${esc(s.slug)} · ${esc(s.email)}${s.phone ? ' · ' + esc(s.phone) : ''}</div>
          <div class="as-badges">${badge(L.seller, s.status)} ${stripeBadges(s)} ${aiBadge(s)}
            ${s.fee_bps_override !== null && s.fee_bps_override !== undefined ? tag('Comissão especial ' + pctFromBps(s.fee_bps_override), 'info') : ''}
            ${s.vacation_mode ? tag('Em férias', 'muted') : ''}
            ${s.banned ? tag('Dono banido', 'bad') : ''}
            ${pc ? tag('Alterações esperando aprovação', 'warn') : ''}
            ${Number(s.debt_cents) > 0 ? tag('Débito ' + money(s.debt_cents), 'bad') : ''}
          </div>
        </div>
      </div>
      ${s.tagline ? `<div class="answer">${esc(s.tagline)}</div>` : ''}
      ${s.rejection_reason ? `<div class="as-callout bad"><strong>Motivo registrado:</strong> ${esc(s.rejection_reason)}</div>` : ''}
      ${pc ? pendingChangesBox(s, pc) : ''}
      ${Number(s.debt_cents) > 0 ? `<div class="as-callout bad"><strong>Débito com a BrasilConnect: ${esc(money(s.debt_cents))}.</strong> Estorno de repasse que o Stripe recusou (saldo da loja insuficiente). O valor sai automaticamente dos próximos repasses; zere só se a loja pagou por fora ou se o valor foi perdoado.</div>` : ''}
      <dl class="as-kvs">
        ${kv('Cidade da loja', [s.city, s.state].filter(Boolean).join(', '))}
        ${kv('Posta de', [s.ship_from_city, s.ship_from_state].filter(Boolean).join(', '))}
        ${kv('Prazo de postagem', s.handling_days ? s.handling_days + ' dia(s) útil(eis)' : '')}
        ${kv('Devolução', s.accepts_returns ? 'Aceita em até ' + s.return_window_days + ' dias' : 'Não aceita')}
        ${kv('Produtos', `${fmtInt(p.approved)} aprovados · ${fmtInt(p.pending_review)} em análise · ${fmtInt(p.total)} no total`)}
        ${kv('Vendas', fmtInt(s.sales_count) + (s.rating_count ? ` · nota ${Number(s.rating_avg || 0).toFixed(1)} (${fmtInt(s.rating_count)})` : ''))}
        ${kv('Cadastro enviado', when(s.submitted_at))}
        ${kv('Contrato aceito', s.agreement_version ? s.agreement_version + ' em ' + when(s.agreement_accepted_at) : 'Não')}
        ${kv('Última decisão', s.reviewed_by ? s.reviewed_by + ' · ' + when(s.reviewed_at) : '')}
        ${kv('Stripe', s.stripe_account_id ? s.stripe_account_id + (due.length ? ' · falta: ' + due.join(', ') : '') : 'Não conectado')}
      </dl>
      ${kv('Para onde entrega', zonesText).replace('class="as-kv"', 'class="as-kv" style="font-size:12.5px;margin-bottom:8px;"')}
      ${aiNote(s)}
      ${s.bio || s.return_policy || s.warranty_policy ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12.5px;color:var(--green-deep);font-weight:600;">Sobre a loja e políticas</summary>
        ${s.bio ? `<p class="as-sec-title">Sobre</p><div class="answer as-text">${esc(s.bio)}</div>` : ''}
        ${s.return_policy ? `<p class="as-sec-title">Devolução</p><div class="answer as-text">${esc(s.return_policy)}</div>` : ''}
        ${s.warranty_policy ? `<p class="as-sec-title">Garantia</p><div class="answer as-text">${esc(s.warranty_policy)}</div>` : ''}
      </details>` : ''}
      <div class="actions">${actions.join('')}</div>
      <p class="as-msg" role="status" aria-live="polite"></p>
    </div>`
  }

  function pendingChangesBox(s, pc) {
    const rows = Object.keys(SHOP_FIELD).filter(k => Object.prototype.hasOwnProperty.call(pc, k)).map(k => {
      const isImg = k === 'logo_url' || k === 'banner_url'
      const show = v => {
        if (isImg) {
          const u = safeImg(v)
          return u ? `<a class="as-thumb" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-as-act="photo" data-alt="${esc(SHOP_FIELD[k])}" aria-label="${esc('Ampliar ' + SHOP_FIELD[k])}"><img src="${esc(u)}" alt="" loading="lazy" width="72" height="72"></a>` : '<span class="as-sub">(sem imagem)</span>'
        }
        return v ? `<span class="as-text">${esc(v)}</span>` : '<span class="as-sub">(vazio)</span>'
      }
      return `<div class="as-kv"><dt>${esc(SHOP_FIELD[k])}</dt><dd><div class="as-sub">Hoje:</div>${show(s[k])}<div class="as-sub" style="margin-top:4px;">Novo:</div>${show(pc[k])}</dd></div>`
    }).join('')
    return `<div class="as-callout warn"><strong>Alterações esperando aprovação</strong>${s.pending_changes_at ? ' · enviadas em ' + esc(when(s.pending_changes_at)) : ''}. A loja continua com os dados de hoje até você decidir.</div>
      <dl class="as-kvs">${rows}</dl>`
  }

  async function sellerChangesAct(c, btn) {
    const op = btn.dataset.op
    const id = btn.dataset.id
    const name = btn.dataset.name || 'esta loja'
    if (!isUuid(id)) return
    let reason = null
    if (op === 'approve_shop_changes') {
      if (!confirm(`Aprovar as alterações de "${name}"? O nome, a logo ou a capa novos aparecem na Store e no checkout na hora.`)) return
    } else if (op === 'reject_shop_changes') {
      reason = askReason(`Motivo da recusa das alterações de "${name}". Vai para a loja.`)
      if (reason === null) return
    } else return
    await runCardAction(c, btn, () => post(op, { seller_id: id, id, reason, pending_changes_at: btn.dataset.at || undefined }), {
      done: op === 'approve_shop_changes' ? 'Alterações aplicadas. Aviso enviado.' : 'Alterações recusadas. Aviso enviado com o motivo.',
    })
  }

  async function sellerDebtAct(c, btn) {
    const id = btn.dataset.id
    const name = btn.dataset.name || 'esta loja'
    if (!isUuid(id)) return
    const reason = askReason(`Zerar o débito de ${money(btn.dataset.debt)} da loja "${name}"? Use só se a loja pagou por fora ou se o valor foi perdoado.\n\nMotivo (registro interno):`)
    if (reason === null) return
    await runCardAction(c, btn, () => post('clear_seller_debt', { seller_id: id, id, reason }), {
      done: d => 'Débito de ' + money(d.cleared_cents) + ' zerado.',
    })
  }

  async function sellerAct(c, btn) {
    const op = btn.dataset.op
    const id = btn.dataset.id
    const name = btn.dataset.name || 'esta loja'
    if (!isUuid(id)) return
    let reason = null
    if (op === 'approve_seller') {
      if (!confirm(`Aprovar a loja "${name}"? Ela recebe um aviso com os próximos passos (Stripe, regiões de entrega, produtos).`)) return
    } else if (op === 'reinstate_seller') {
      if (!confirm(`Reativar a loja "${name}"? Os produtos aprovados voltam para a vitrine e os repasses retidos pela suspensão voltam ao prazo normal.`)) return
    } else if (op === 'reject_seller') {
      reason = askReason(`Motivo da reprovação de "${name}". Vai para a loja: diga o que ela precisa corrigir.`)
      if (reason === null) return
    } else if (op === 'suspend_seller') {
      reason = askReason(`Motivo da suspensão de "${name}". Vai para a loja.\n\nOs produtos saem da vitrine, os repasses ainda não feitos ficam retidos e os pagamentos em aberto com produto desta loja são cancelados.`)
      if (reason === null) return
    } else return
    const DONE = {
      approve_seller: 'Loja aprovada. Aviso enviado.',
      reject_seller: 'Loja reprovada. Aviso enviado com o motivo.',
      reinstate_seller: 'Loja reativada. Aviso enviado.',
    }
    await runCardAction(c, btn, () => post(op, { seller_id: id, id, reason }), {
      done: d => (op === 'suspend_seller' ? `Loja suspensa${d.held_orders ? ', ' + d.held_orders + ' repasse(s) retido(s)' : ''}${d.expired_checkouts ? ', ' + d.expired_checkouts + ' pagamento(s) em aberto cancelado(s)' : ''}. Aviso enviado.` : DONE[op]),
    })
  }

  async function sellerFee(c, btn) {
    const id = btn.dataset.id
    if (!isUuid(id)) return
    const cur = btn.dataset.current
    const curPct = cur === '' || cur === undefined ? '' : String(Number(cur) / 100)
    const v = prompt('Comissão especial desta loja, em % (0 a 50).\nDeixe vazio para usar a comissão padrão.\n\nVale só para pedidos novos. A loja não é avisada automaticamente.', curPct)
    if (v === null) return
    const s = v.trim().replace(',', '.')
    let bps = null
    if (s !== '') {
      const n = Number(s)
      if (!isFinite(n) || n < 0 || n > 50) { alert('Use um número de 0 a 50.'); return }
      bps = Math.round(n * 100)
    }
    await runCardAction(c, btn, () => post('set_seller_fee', { seller_id: id, id, fee_bps_override: bps }), {
      done: bps === null ? 'Comissão padrão restaurada.' : 'Comissão especial salva: ' + pctFromBps(bps) + '.',
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Produtos
  // ───────────────────────────────────────────────────────────────────────────
  async function renderProducts(c) {
    const status = c.dataset.stProductStatus || 'pending_review'
    const q = c.dataset.stProductQ || ''
    const sellerId = isUuid(c.dataset.stProductSeller) ? c.dataset.stProductSeller : ''
    const sellerName = c.dataset.stProductSellerName || ''
    const d = await getView('products', { status, q, seller_id: sellerId })
    const list = d.products || []
    const toolbar = `<div class="as-toolbar">
      ${statusSelect('stProductStatus', status, [['pending_review', 'Em análise'], ['approved', 'Aprovados'], ['rejected', 'Reprovados'], ['suspended', 'Suspensos'], ['paused', 'Pausados'], ['draft', 'Rascunhos'], ['archived', 'Arquivados'], ['all', 'Todos']])}
      ${searchForm('stProductQ', q, 'Título, endereço do produto ou SKU', 'Buscar produto')}
    </div>
    ${sellerId ? `<div class="as-callout info">Só produtos da loja <strong>${esc(sellerName || 'selecionada')}</strong>. <button type="button" class="btn-mini as-btn-ghost" data-as-act="clear-seller">Ver todas as lojas</button></div>` : ''}`
    return `<div class="panel">
      <div class="panel-eyebrow">PRODUTOS</div>
      <h3>${esc(fmtInt(list.length))} produto${list.length === 1 ? '' : 's'} nesta lista</h3>
      <p class="panel-sub">Nada aparece na Store sem aprovação. A IA só sinaliza; a decisão é sua. Na fila, o que a IA achou mais grave vem primeiro.</p>
      ${summaryLine(d.summary || {}, { pending_review: L.product.pending_review, approved: L.product.approved, rejected: L.product.rejected, suspended: L.product.suspended, paused: L.product.paused })}
      ${toolbar}
      ${list.length ? list.map(productCard).join('') : `<div class="as-empty">${status === 'pending_review' ? 'Nenhum produto aguardando análise.' : 'Nenhum produto neste filtro.'}</div>`}
    </div>`
  }

  function thumbs(urls, title, label) {
    const safe = (urls || []).map(safeImg).filter(Boolean)
    if (!safe.length) return ''
    return `<div class="as-thumbs" role="group" aria-label="${esc(label)}">${safe.map((u, i) => `<a class="as-thumb" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-as-act="photo" data-alt="${esc(title + ' · foto ' + (i + 1))}" aria-label="${esc('Ampliar foto ' + (i + 1) + ' de ' + title)}"><img src="${esc(u)}" alt="" loading="lazy" width="72" height="72"></a>`).join('')}</div>`
  }

  function productCard(p) {
    const cat = p.category || {}
    const sellerOk = p.seller_status === 'approved'
    const dims = [p.length_in, p.width_in, p.height_in].every(x => x) ? `${p.length_in} × ${p.width_in} × ${p.height_in} in` : ''
    const weight = p.weight_oz ? p.weight_oz + ' oz' : ''
    const hasCompliance = !!(p.compliance_notes || (p.compliance_images && p.compliance_images.length))
    const dataBase = `data-id="${esc(p.id)}" data-name="${esc(p.title)}"`
    const actions = []
    if (['pending_review', 'rejected', 'suspended'].includes(p.status)) {
      actions.push(`<button type="button" class="btn-mini btn-approve" data-as-act="product" data-op="approve_product" ${dataBase}${sellerOk ? '' : ' disabled'}>${p.status === 'pending_review' ? 'Aprovar' : 'Aprovar de novo'}</button>`)
    }
    if (p.status === 'pending_review') actions.push(`<button type="button" class="btn-mini as-btn-danger" data-as-act="product" data-op="reject_product" ${dataBase}>Reprovar</button>`)
    if (p.status === 'approved' || p.status === 'paused') {
      actions.push(`<button type="button" class="btn-mini btn-reject" data-as-act="product" data-op="suspend_product" ${dataBase}>Suspender</button>`)
      // A vitrine so serve produto aprovado de loja que pode vender (senao /store/p/ da 404)
      if (p.status === 'approved' && p.seller_can_sell) actions.push(`<a class="btn-mini as-btn-ghost" href="/store/p/${esc(encodeURIComponent(p.slug || ''))}" target="_blank" rel="noopener noreferrer">Ver na Store</a>`)
      else actions.push(tag('Fora da vitrine: ' + (p.status === 'paused' ? 'pausado pela loja' : 'loja sem Stripe ativo ou em férias'), 'warn'))
    }

    return `<div class="item">
      <div class="as-card-head">
        <div class="as-grow">
          <div class="as-title">${esc(p.title)}</div>
          <div class="as-sub">${esc(p.seller_name || 'Loja')} · ${badge(L.seller, p.seller_status)} · /store/p/${esc(p.slug)}</div>
          <div class="as-badges">${badge(L.product, p.status)} ${aiBadge(p)}
            ${cat.gated ? tag('Exige atenção', 'warn') : ''}
            ${p.hazmat ? tag('Material perigoso (só terrestre)', 'warn') : ''}
          </div>
        </div>
        <div class="as-price as-num" aria-label="Preço">${esc(money(p.price_cents))}${p.compare_at_cents ? `<span class="as-strike">${esc(money(p.compare_at_cents))}</span>` : ''}</div>
      </div>
      ${sellerOk ? '' : '<div class="as-callout warn">A loja ainda não está aprovada. Aprove a loja antes do produto.</div>'}
      ${p.rejection_reason ? `<div class="as-callout bad"><strong>Motivo registrado:</strong> ${esc(p.rejection_reason)}</div>` : ''}
      ${thumbs(p.images, p.title || 'Produto', 'Fotos do produto')}
      <div class="answer as-text">${esc(p.description || '(sem descrição)')}</div>
      <dl class="as-kvs">
        ${kvh('Categoria', `${esc(cat.name || p.category_slug)}${cat.gated ? ' ' + tag('Exige atenção', 'warn') : ''}`)}
        ${kv('Condição', CONDITION[p.condition] || p.condition)}
        ${kv('Origem', ORIGIN[p.origin] || p.origin)}
        ${kv('Estoque', fmtInt(p.stock))}
        ${kv('SKU', p.sku)}
        ${kv('Peso e medidas', [weight, dims].filter(Boolean).join(' · '))}
        ${kv('Etiquetas', Array.isArray(p.tags) ? p.tags.join(', ') : '')}
        ${kv('Enviado para análise', when(p.submitted_at))}
        ${kv('Publicado', when(p.published_at))}
        ${kv('Última decisão', p.reviewed_by ? p.reviewed_by + ' · ' + when(p.reviewed_at) : '')}
        ${kv('Vendas', fmtInt(p.sales_count) + (p.rating_count ? ` · nota ${Number(p.rating_avg || 0).toFixed(1)} (${fmtInt(p.rating_count)})` : ''))}
      </dl>
      ${cat.gated && cat.requirements ? `<div class="as-callout warn"><strong>O que conferir nesta categoria:</strong> ${esc(cat.requirements)}</div>` : ''}
      ${hasCompliance || cat.gated ? `<p class="as-sec-title">Conformidade (só o admin vê)</p>
        ${p.compliance_notes ? `<div class="answer as-text">${esc(p.compliance_notes)}</div>` : ''}
        ${thumbs(p.compliance_images, (p.title || 'Produto') + ' · conformidade', 'Fotos de conformidade (rótulo, nota fiscal)')}
        ${!hasCompliance ? '<div class="as-callout bad">A loja não mandou dados de conformidade para uma categoria que exige atenção.</div>' : ''}` : ''}
      ${aiNote(p)}
      <div class="actions">${actions.join('')}</div>
      <p class="as-msg" role="status" aria-live="polite"></p>
    </div>`
  }

  async function productAct(c, btn) {
    const op = btn.dataset.op
    const id = btn.dataset.id
    const name = btn.dataset.name || 'este produto'
    if (!isUuid(id)) return
    let reason = null
    if (op === 'approve_product') {
      if (!confirm(`Aprovar "${name}"? Ele aparece na Store (se a loja estiver com o Stripe ativo) e a loja recebe o link.`)) return
    } else if (op === 'reject_product') {
      reason = askReason(`Motivo da reprovação de "${name}". Vai para a loja: diga o que corrigir (fotos, descrição, categoria, conformidade).`)
      if (reason === null) return
    } else if (op === 'suspend_product') {
      reason = askReason(`Motivo da suspensão de "${name}". Vai para a loja. O produto sai da vitrine.`)
      if (reason === null) return
    } else return
    const DONE = { approve_product: 'Produto aprovado. Aviso enviado.', reject_product: 'Produto reprovado. Aviso enviado com o motivo.', suspend_product: 'Produto suspenso. Aviso enviado.' }
    await runCardAction(c, btn, () => post(op, { product_id: id, id, reason }), { done: DONE[op] })
  }

  function openPhoto(href, alt) {
    const url = safeImg(href)
    if (!url) return
    openModal(alt || 'Foto', `<img class="as-photo" src="${esc(url)}" alt="${esc(alt || 'Foto do produto')}">
      <p style="text-align:center;margin:10px 0 0;"><a class="btn-mini as-btn-ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir em nova aba</a></p>`)
    modalOrderId = null
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Pedidos
  // ───────────────────────────────────────────────────────────────────────────
  const ORDER_FILTERS = [
    ['all', 'Todos', null],
    ['to_ship', 'A enviar', k => k.orders_to_ship],
    ['late', 'Atrasados', k => k.orders_late],
    ['disputes', 'Problemas', k => (k.disputes_open || 0) + (k.disputes_escalated || 0) + (k.chargebacks || 0)],
    ['blocked', 'Repasse bloqueado', k => k.payouts_blocked],
    ['held', 'Repasse retido', k => k.payouts_held],
    ['labels', 'Etiqueta em processamento', k => k.labels_stuck],
  ]

  async function renderOrders(c) {
    const filter = ORDER_FILTERS.some(f => f[0] === c.dataset.stOrderFilter) ? c.dataset.stOrderFilter : 'all'
    const q = c.dataset.stOrderQ || ''
    const d = await getView('orders', { filter, q })
    const list = d.orders || []
    const k = c._asCounts || {}
    const pills = `<div class="as-pills" role="group" aria-label="Filtrar pedidos">${ORDER_FILTERS.map(([id, label, cnt]) => {
      const n = cnt ? Number(cnt(k)) || 0 : 0
      return `<button type="button" class="as-pill" aria-pressed="${id === filter ? 'true' : 'false'}" data-as-act="filter" data-key="stOrderFilter" data-value="${esc(id)}">${esc(label)}${n ? ' (' + esc(fmtInt(n)) + ')' : ''}</button>`
    }).join('')}</div>`
    const rows = list.map(o => `<tr>
      <td data-label="Pedido"><span class="as-strong">#${esc(o.order_number)}</span>${o.late ? ' ' + tag('Atrasado', 'bad') : ''}</td>
      <td data-label="Data" class="as-num">${esc(when(o.paid_at || o.created_at))}</td>
      <td data-label="Loja">${esc(o.seller && o.seller.name ? o.seller.name : '—')}</td>
      <td data-label="Comprador">${esc(o.buyer_email)}${o.ship_to_state ? `<div class="as-sub">${esc([o.ship_to_city, o.ship_to_state].filter(Boolean).join(', '))}</div>` : ''}</td>
      <td data-label="Total" class="as-num">${esc(money(o.total_cents))}${o.refunded_cents ? `<div class="as-sub">reemb. ${esc(money(o.refunded_cents))}</div>` : ''}</td>
      <td data-label="Situação">${badge(L.order, o.status)}</td>
      <td data-label="Repasse">${badge(L.payout, o.payout_status)}${o.hold_reason ? `<div class="as-sub">${esc(holdLabel(o.hold_reason))}</div>` : ''}</td>
      <td data-label="Problema">${o.dispute_status && o.dispute_status !== 'none' ? badge(L.dispute, o.dispute_status) : '—'}</td>
      <td class="as-td-act"><button type="button" class="btn-mini btn-mark" data-as-act="order" data-id="${esc(o.id)}" aria-label="${esc('Abrir pedido #' + o.order_number)}">Abrir</button></td>
    </tr>`).join('')
    return `<div class="panel">
      <div class="panel-eyebrow">PEDIDOS</div>
      <h3>${esc(fmtInt(list.length))} pedido${list.length === 1 ? '' : 's'}</h3>
      <p class="panel-sub">Cada pedido é de uma loja. Abra para ver valores, repasse, linha do tempo e conversa.</p>
      ${pills}
      <div class="as-toolbar">${searchForm('stOrderQ', q, 'Número do pedido (#1001) ou e-mail do comprador', 'Buscar pedido')}</div>
      ${list.length ? `<div class="as-table-wrap"><table class="as-table">
        <thead><tr><th scope="col">Pedido</th><th scope="col">Data</th><th scope="col">Loja</th><th scope="col">Comprador</th><th scope="col">Total</th><th scope="col">Situação</th><th scope="col">Repasse</th><th scope="col">Problema</th><th scope="col"><span class="as-sr">Ações</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="as-empty">Nenhum pedido neste filtro.</div>'}
    </div>`
  }

  // ── Modal ──
  let modalEl = null
  let lastFocus = null
  let modalOrderId = null
  let modalC = null
  let modalData = null

  function modal() {
    if (modalEl) return modalEl
    const ov = document.createElement('div')
    ov.className = 'as-overlay'
    ov.hidden = true
    ov.innerHTML = `<div class="as-modal" role="dialog" aria-modal="true" aria-labelledby="as-modal-title">
      <div class="as-modal-head"><h3 id="as-modal-title">Pedido</h3>
        <button type="button" class="as-x" data-as-close aria-label="Fechar">${ICON_X}</button></div>
      <div class="as-modal-body" id="as-modal-body"></div></div>`
    document.body.appendChild(ov)
    ov.addEventListener('click', ev => {
      if (ev.target === ov || ev.target.closest('[data-as-close]')) { closeModal(); return }
      onModalClick(ev)
    })
    ov.addEventListener('submit', onModalSubmit)
    document.addEventListener('keydown', ev => {
      if (ov.hidden) return
      if (ev.key === 'Escape') closeModal()
      else if (ev.key === 'Tab') trapFocus(ev)
    })
    modalEl = ov
    return ov
  }

  function openModal(title, html) {
    const m = modal()
    if (m.hidden) lastFocus = document.activeElement
    m.querySelector('#as-modal-title').textContent = title
    m.querySelector('#as-modal-body').innerHTML = html
    m.hidden = false
    try { document.body.style.overflow = 'hidden' } catch (_) {}
    const x = m.querySelector('.as-x')
    if (x) x.focus()
  }

  function closeModal() {
    if (!modalEl || modalEl.hidden) return
    modalEl.hidden = true
    modalOrderId = null
    modalData = null
    try { document.body.style.overflow = '' } catch (_) {}
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      try { lastFocus.focus() } catch (_) {}
    }
  }

  function trapFocus(ev) {
    const f = [...modalEl.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled])')]
      .filter(x => x.offsetParent !== null)
    if (!f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus() }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
  }

  async function openOrder(c, id) {
    if (!isUuid(id)) return
    modalC = c
    openModal('Pedido', '<p class="as-loading">Carregando…</p>')
    modalOrderId = id
    await refreshOrder()
  }

  async function refreshOrder(note, kind) {
    const id = modalOrderId
    if (!id || !modalEl) return
    const body = modalEl.querySelector('#as-modal-body')
    try {
      const d = await getView('order', { id })
      if (modalOrderId !== id) return
      modalData = d
      modalEl.querySelector('#as-modal-title').textContent = 'Pedido #' + (d.order && d.order.order_number ? d.order.order_number : '')
      body.innerHTML = renderOrder(d, note, kind)
    } catch (e) {
      if (modalOrderId !== id) return
      body.innerHTML = errBox(e)
    }
  }

  function renderOrder(d, note, kind) {
    const o = d.order || {}
    const s = d.seller || {}
    const co = d.checkout || {}
    const pp = d.payout_preview || {}
    const can = d.can || {}
    const st = o.ship_to && typeof o.ship_to === 'object' ? o.ship_to : {}
    const zone = o.zone_snapshot && typeof o.zone_snapshot === 'object' ? o.zone_snapshot : {}
    const addr = [st.line1, st.line2, [[st.city, st.state].filter(Boolean).join(', '), st.zip].filter(Boolean).join(' ')].filter(Boolean)
    const trackUrl = safeHttp(o.tracking_url)
    const labelUrl = safeHttp(o.label_url)
    const ob = (op, label, cls) => `<button type="button" class="btn-mini ${cls}" data-as-oact="${esc(op)}">${esc(label)}</button>`

    const acts = []
    if (can.resolve_dispute) {
      acts.push(ob('resolve_refund', 'Resolver: reembolsar o comprador', 'btn-reject'))
      acts.push(ob('resolve_release', 'Resolver: valor fica com a loja', 'btn-approve'))
    }
    if (can.refund) acts.push(ob('refund', 'Reembolsar', 'as-btn-danger'))
    if (can.cancel) acts.push(ob('cancel_order', 'Cancelar pedido', 'as-btn-danger'))
    if (can.release) acts.push(ob('release', 'Liberar repasse agora', 'btn-approve'))
    if (can.unstick_release) acts.push(ob('unstick_release', 'Destravar repasse', 'btn-mark'))
    if (can.hold) acts.push(ob('hold', 'Reter repasse', 'btn-mark'))
    if (can.unhold) acts.push(ob('unhold', 'Soltar repasse', 'as-btn-ghost'))
    if (can.unlock_label) acts.push(ob('unlock_label', 'Conferir etiqueta na Shippo', 'btn-mark'))

    const items = (d.items || []).map(it => {
      const img = safeImg(it.image_url)
      return `<li>${img ? `<img src="${esc(img)}" alt="" loading="lazy" width="44" height="44">` : ''}
        <div class="as-grow"><div>${esc(it.title)}</div><div class="as-sub">${esc(fmtInt(it.quantity))} × ${esc(money(it.unit_price_cents))}</div></div>
        <div class="as-num">${esc(money(it.subtotal_cents))}</div></li>`
    }).join('')

    const events = (d.events || []).map(ev => `<li><div class="as-sub">${esc(when(ev.created_at))} · ${esc(ACTOR[ev.actor] || ev.actor)}${ev.actor === 'admin' && ev.actor_id ? ' (' + esc(ev.actor_id) + ')' : ''}</div><div>${esc(ev.message || ev.kind)}</div></li>`).join('')

    const messages = (d.messages || []).map(m => `<div class="as-bubble${m.sender_role === 'admin' ? ' is-admin' : ''}"><div class="as-sub">${esc(SENDER[m.sender_role] || m.sender_role)} · ${esc(when(m.created_at))}</div>${esc(m.body)}</div>`).join('')

    const reviews = (d.reviews || []).map(r => `<div class="item" style="margin-bottom:6px;">
      <div class="as-sub">Nota ${esc(r.rating)} de 5 · ${esc(when(r.created_at))} · ${r.status === 'hidden' ? tag('Oculta', 'muted') : tag('Visível', 'ok')}</div>
      ${r.body ? `<div class="as-text" style="margin-top:4px;">${esc(r.body)}</div>` : ''}
      ${r.seller_reply ? `<div class="as-sub" style="margin-top:4px;">Resposta da loja: ${esc(r.seller_reply)}</div>` : ''}
      ${r.status === 'visible' ? `<div class="as-actions" style="margin-top:6px;"><button type="button" class="btn-mini as-btn-danger" data-as-hide-review="${esc(r.id)}">Ocultar avaliação</button></div>` : ''}
    </div>`).join('')

    const fee = `${pctFromBps(o.fee_bps)}${o.fee_fixed_cents ? ' + ' + money(o.fee_fixed_cents) : ''}${o.fee_on_shipping ? ' (itens + frete)' : ' (só itens)'}`

    return `
      <p class="as-msg${kind ? ' is-' + kind : (note ? ' is-ok' : '')}" role="status" aria-live="polite">${esc(note || '')}</p>
      <div class="as-badges">${badge(L.order, o.status)} ${o.late ? tag('Atrasado', 'bad') : ''} ${badge(L.payout, o.payout_status)} ${o.dispute_status && o.dispute_status !== 'none' ? badge(L.dispute, o.dispute_status) : ''}</div>

      ${acts.length ? `<div class="as-sec"><h4>Ações</h4><div class="as-actions">${acts.join('')}</div>
        <div class="as-hint" style="margin-top:6px;">Reembolsável agora: ${esc(money(d.refundable_cents))}. Toda ação avisa as partes e fica na linha do tempo.</div></div>` : ''}

      ${o.dispute_status && o.dispute_status !== 'none' ? `<div class="as-sec"><h4>Problema (Garantia BrasilConnect)</h4>
        <dl class="as-kvs">
          ${kvh('Situação', badge(L.dispute, o.dispute_status))}
          ${kv('Motivo', DISPUTE_REASON[o.dispute_reason] || o.dispute_reason)}
          ${kv('Aberto em', when(o.dispute_opened_at))}
          ${kv('Escalado em', when(o.dispute_escalated_at))}
          ${kv('Resolvido em', when(o.dispute_resolved_at))}
        </dl>
        ${o.dispute_details ? `<div class="answer as-text">${esc(o.dispute_details)}</div>` : ''}
        ${o.dispute_resolution ? `<div class="as-callout info"><strong>Decisão:</strong> ${esc(o.dispute_resolution)}</div>` : ''}
      </div>` : ''}

      <div class="as-sec"><h4>Pedido</h4>
        <dl class="as-kvs">
          ${kv('Criado', when(o.created_at))}
          ${kv('Pago', when(o.paid_at))}
          ${kv('Prazo de postagem', when(o.ship_by))}
          ${kv('Enviado', when(o.shipped_at))}
          ${kv('Entregue', when(o.delivered_at))}
          ${kv('Recebimento confirmado', when(o.buyer_confirmed_at))}
          ${kv('Concluído', when(o.completed_at))}
          ${o.canceled_at ? kv('Cancelado', when(o.canceled_at) + (o.canceled_by ? ' · por ' + (ACTOR[o.canceled_by] || o.canceled_by) : '') + (o.cancel_reason ? ' · ' + o.cancel_reason : '')) : ''}
        </dl>
      </div>

      <div class="as-sec"><h4>Itens</h4><ul class="as-items">${items || '<li>—</li>'}</ul></div>

      <div class="as-sec"><h4>Valores</h4>
        <dl class="as-kvs">
          ${kv('Itens', money(o.items_cents))}
          ${kv('Frete', money(o.shipping_cents))}
          ${kv('Imposto', money(o.tax_cents))}
          ${kv('Total pago', money(o.total_cents))}
          ${kv('Reembolsado', money(o.refunded_cents))}
          ${kv('Reembolsável', money(d.refundable_cents))}
        </dl>
      </div>

      <div class="as-sec"><h4>Repasse para a loja</h4>
        <dl class="as-kvs">
          ${kvh('Situação', badge(L.payout, o.payout_status) + (o.hold_reason ? ' <span class="as-sub">' + esc(holdLabel(o.hold_reason)) + '</span>' : ''))}
          ${kv('Comissão', fee)}
          ${kv('Comissão calculada', money(pp.fee_cents))}
          ${kv('Etiqueta', money(pp.label_cost_cents))}
          ${kv(['released', 'reversed'].includes(o.payout_status) ? 'Repassado' : 'Repasse previsto', money(pp.payout_cents))}
          ${pp.debt_applied_cents ? kv('Débito antigo abatido', money(pp.debt_applied_cents)) : ''}
          ${pp.reversed_cents ? kv('Estornado da loja', money(pp.reversed_cents)) : ''}
          ${kv('Liberação', pp.manual_release ? 'Manual (botão “Liberar repasse agora”)' : pp.release_at ? when(pp.release_at) + (pp.new_seller ? ' (loja nova)' : '') : 'Ainda sem data')}
          ${o.stripe_transfer_id ? kvh('Transfer Stripe', `<span class="as-mono">${esc(o.stripe_transfer_id)}</span>`) : ''}
        </dl>
        ${o.payout_status === 'releasing' ? (o.releasing_stale
          ? `<div class="as-callout warn">Repasse em processamento${o.releasing_at ? ' desde ' + esc(when(o.releasing_at)) : ''}, há mais de 10 minutos: a rodada pode ter parado no meio. O cron confere sozinho a cada hora; use “Destravar repasse” para conferir agora no Stripe.</div>`
          : '<div class="as-callout info">Repasse em processamento: o transfer está sendo enviado agora (Stripe). Reembolso e nova liberação esperam terminar.</div>') : ''}
        ${o.hold_reason === 'reversal_failed' ? '<div class="as-callout bad">O estorno do repasse falhou no Stripe (saldo da loja insuficiente). O valor virou débito da loja e sai dos próximos repasses. Veja a loja na aba Lojas.</div>' : ''}
        ${['tracking_date_invalid', 'tracking_address_mismatch'].includes(o.hold_reason) ? '<div class="as-callout bad">Rastreio suspeito: confira o número com a loja antes de soltar o repasse. Se for de outro pacote, reembolse o comprador.</div>' : ''}
        ${pp.manual_release ? `<div class="as-callout warn">O problema foi resolvido com reembolso parcial. O restante (${esc(money(pp.payout_cents))}) não sai sozinho: se a loja tem direito a ele, use “Liberar repasse agora”.</div>` : ''}
      </div>

      <div class="as-sec"><h4>Entrega</h4>
        <dl class="as-kvs">
          ${kv('Forma', (METHOD[o.fulfillment] || o.fulfillment) + (zone.name ? ' · ' + zone.name : ''))}
          ${kv('Transportadora', [o.carrier, o.service].filter(Boolean).join(' · '))}
          ${kvh('Rastreio', o.tracking_number ? `<span class="as-mono">${esc(o.tracking_number)}</span>${trackUrl ? ` · <a href="${esc(trackUrl)}" target="_blank" rel="noopener noreferrer">acompanhar</a>` : ''}` : '')}
          ${kv('Situação do rastreio', o.tracking_status ? (TRACK[o.tracking_status] || o.tracking_status) + ' · ' + when(o.tracking_updated_at) : '')}
          ${kvh('Etiqueta', esc(LABEL_STATUS[o.label_status] || o.label_status || '') + (o.label_status === 'purchasing' && o.label_locked_at ? ' desde ' + esc(when(o.label_locked_at)) : '') + (labelUrl ? ` · <a href="${esc(labelUrl)}" target="_blank" rel="noopener noreferrer">abrir PDF</a>` : ''))}
          ${o.handoff_scheduled_at ? kv('Entrega/retirada combinada', when(o.handoff_scheduled_at)) : ''}
        </dl>
        ${o.label_status === 'purchasing' ? '<div class="as-callout warn">A compra da etiqueta não terminou. O cron confere na Shippo depois de 10 minutos; use “Conferir etiqueta na Shippo” para resolver agora.</div>' : ''}
      </div>

      <div class="as-sec"><h4>Comprador</h4>
        <dl class="as-kvs">
          ${kv('E-mail', o.buyer_email)}
          ${kv('Nome', st.name)}
          ${kv('Endereço', addr.join(' · '))}
          ${kv('Telefone', st.phone)}
        </dl>
      </div>

      <div class="as-sec"><h4>Loja</h4>
        <dl class="as-kvs">
          ${kvh('Loja', `${esc(s.name || '—')} ${s.status ? badge(L.seller, s.status) : ''}`)}
          ${kv('E-mail', s.email)}
          ${kv('Telefone', s.phone)}
          ${kv('Recebimentos', s.stripe_transfers_active ? 'Stripe ativo' : 'Stripe não ativo')}
          ${Number(s.debt_cents) > 0 ? kv('Débito da loja', money(s.debt_cents)) : ''}
        </dl>
      </div>

      <div class="as-sec"><h4>Pagamento (Stripe)</h4>
        <dl class="as-kvs">
          ${kvh('Checkout', co.id ? `<span class="as-mono">${esc(co.id)}</span>` : '')}
          ${kvh('Sessão', co.stripe_session_id ? `<span class="as-mono">${esc(co.stripe_session_id)}</span>` : '')}
          ${kvh('PaymentIntent', co.stripe_payment_intent_id ? `<span class="as-mono">${esc(co.stripe_payment_intent_id)}</span>` : '')}
          ${kvh('Cobrança', co.stripe_charge_id ? `<span class="as-mono">${esc(co.stripe_charge_id)}</span>` : '')}
        </dl>
      </div>

      <div class="as-sec"><h4>Linha do tempo</h4>${events ? `<ul class="as-timeline">${events}</ul>` : '<p class="as-hint">Nada registrado ainda.</p>'}</div>

      <div class="as-sec"><h4>Conversa</h4>
        ${messages ? `<div class="as-chat">${messages}</div>` : '<p class="as-hint">Sem mensagens.</p>'}
        ${can.message ? `<form class="as-msgform" data-as-oform="message">
          <label for="as-order-msg" class="as-strong">Mensagem da BrasilConnect (comprador e loja recebem)</label>
          <textarea id="as-order-msg" name="body" rows="3" maxlength="2000" required></textarea>
          <button type="submit" class="btn-mini btn-mark">Enviar mensagem</button>
        </form>` : ''}
      </div>

      ${reviews ? `<div class="as-sec"><h4>Avaliações deste pedido</h4>${reviews}</div>` : ''}`
  }

  function modalSay(text, kind) {
    const m = modalEl && modalEl.querySelector('#as-modal-body .as-msg')
    if (!m) return
    m.textContent = text || ''
    m.className = 'as-msg' + (kind ? ' is-' + kind : '')
  }

  async function modalRun(fn, doneText) {
    const btns = [...modalEl.querySelectorAll('#as-modal-body button')]
    const prev = btns.map(b => b.disabled)
    btns.forEach(b => { b.disabled = true })
    modalSay('Salvando…')
    try {
      const d = await fn()
      await refreshOrder(typeof doneText === 'function' ? doneText(d || {}) : doneText, 'ok')
      reloadIfVisible(modalC)
    } catch (e) {
      modalSay(e.message, 'err')
      btns.forEach((b, i) => { b.disabled = prev[i] })
    }
  }

  function onModalClick(ev) {
    const hide = ev.target.closest('[data-as-hide-review]')
    if (hide) return hideReview(hide.getAttribute('data-as-hide-review'))
    const t = ev.target.closest('[data-as-oact]')
    if (t) orderAct(t.getAttribute('data-as-oact'))
  }

  function onModalSubmit(ev) {
    const form = ev.target.closest('form[data-as-oform="message"]')
    if (!form) return
    ev.preventDefault()
    const d = modalData
    if (!d || !d.order) return
    const ta = form.querySelector('textarea[name="body"]')
    const text = ta ? ta.value.trim() : ''
    if (!text) { modalSay('Escreva a mensagem.', 'err'); return }
    modalRun(() => post('message', { order_id: d.order.id, id: d.order.id, body: text.slice(0, 2000) }), 'Mensagem enviada. Comprador e loja foram avisados.')
  }

  async function hideReview(id) {
    if (!isUuid(id)) return
    if (!confirm('Ocultar esta avaliação? Ela some da loja e do produto, e as notas são recalculadas.')) return
    const reason = prompt('Motivo (anotação interna, opcional):', '')
    if (reason === null) return
    modalRun(() => post('hide_review', { review_id: id, id, reason: reason.trim() || undefined }), 'Avaliação ocultada.')
  }

  function orderAct(op) {
    const d = modalData
    if (!d || !d.order) return
    const o = d.order
    const ref = Number(d.refundable_cents) || 0
    const pp = d.payout_preview || {}
    const base = { order_id: o.id, id: o.id }
    const n = '#' + o.order_number

    if (op === 'refund') {
      const cents = askMoney(`Valor do reembolso do pedido ${n}, em US$ (máximo ${money(ref)}).`, ref, false)
      if (cents === null) return
      const reason = askReason('Motivo do reembolso. Vai para o comprador e a loja.')
      if (reason === null) return
      const cancelNote = o.status === 'paid' && cents === ref ? '\n\nComo o pedido ainda não foi enviado, ele será cancelado e o estoque volta.' : ''
      if (!confirm(`Reembolsar ${money(cents)} ao comprador do pedido ${n}?${cancelNote}`)) return
      return modalRun(() => post('refund', { ...base, amount_cents: cents, reason }), r => {
        if (r.canceled) return 'Pedido cancelado e comprador reembolsado.'
        let t = 'Reembolso de ' + money(r.refunded_cents) + ' feito.'
        if (r.reversed_cents) t += ' ' + money(r.reversed_cents) + ' estornados do repasse da loja.'
        if (r.debt_cents) t += ' O estorno de ' + money(r.debt_cents) + ' não passou no Stripe e virou débito da loja.'
        return t
      })
    }
    if (op === 'unlock_label') {
      if (!confirm(`Conferir na Shippo a etiqueta do pedido ${n}? Se a etiqueta saiu, o pedido vira enviado; se não, a loja pode comprar outra ou informar o envio próprio.`)) return
      return modalRun(() => post('unlock_label', base), r => r.message || 'Etiqueta conferida.')
    }
    if (op === 'cancel_order') {
      const reason = askReason(`Motivo do cancelamento do pedido ${n}. Vai para o comprador e a loja.`)
      if (reason === null) return
      if (!confirm(`Cancelar o pedido ${n} e devolver ${money(ref)} ao comprador? O estoque volta para a loja.`)) return
      return modalRun(() => post('cancel_order', { ...base, reason }), 'Pedido cancelado e comprador reembolsado.')
    }
    if (op === 'release') {
      if (!confirm(`Liberar agora o repasse de cerca de ${money(pp.payout_cents)} para a loja? Isso ignora o prazo e a retenção (problema em aberto continua bloqueando).`)) return
      return modalRun(() => post('release', base), 'Repasse enviado para a loja.')
    }
    if (op === 'unstick_release') {
      if (!confirm(`Destravar o repasse do pedido ${n}? Conferimos no Stripe: se o transfer já saiu, ele é registrado; se não saiu, o repasse é destravado e enviado agora (ignora o prazo e a retenção; problema em aberto continua bloqueando).`)) return
      return modalRun(() => post('release', base), r => {
        if (r.unlocked) return r.message || 'Repasse destravado.'
        if (r.recovered) return 'O transfer já tinha saído: repasse registrado.'
        return 'Repasse destravado e enviado para a loja.'
      })
    }
    if (op === 'hold') {
      const reason = askReason(`Motivo da retenção do repasse do pedido ${n}. Vai para a loja.`)
      if (reason === null) return
      return modalRun(() => post('hold', { ...base, reason }), 'Repasse retido. A loja foi avisada.')
    }
    if (op === 'unhold') {
      if (!confirm('Soltar o repasse? Ele volta a seguir o prazo normal.')) return
      return modalRun(() => post('unhold', base), 'Retenção removida.')
    }
    if (op === 'resolve_refund') {
      const cents = askMoney(`Quanto devolver ao comprador, em US$? Máximo ${money(ref)}. Use 0 para só encerrar a favor dele.`, ref, true)
      if (cents === null) return
      const reason = askReason('Explique a decisão. Vai para o comprador e a loja.')
      if (reason === null) return
      if (!confirm(`Encerrar o problema do pedido ${n} a favor do comprador${cents ? ' com reembolso de ' + money(cents) : ''}?`)) return
      const partial = cents < ref && o.status !== 'paid'
      return modalRun(() => post('resolve_dispute', { ...base, decision: 'refund', amount_cents: cents, reason }),
        'Problema resolvido a favor do comprador.' + (partial ? ' Se a loja tem direito ao restante, libere o repasse manualmente.' : ''))
    }
    if (op === 'resolve_release') {
      const reason = askReason('Explique a decisão. Vai para o comprador e a loja.')
      if (reason === null) return
      if (!confirm(`Encerrar o problema do pedido ${n} a favor da loja? O repasse segue o prazo normal.`)) return
      return modalRun(() => post('resolve_dispute', { ...base, decision: 'release', reason }), 'Problema resolvido a favor da loja.')
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Denuncias
  // ───────────────────────────────────────────────────────────────────────────
  async function renderReports(c) {
    const status = c.dataset.stReportStatus || 'pending'
    const d = await getView('reports', { status })
    const list = d.reports || []
    return `<div class="panel">
      <div class="panel-eyebrow">DENÚNCIAS</div>
      <h3>${esc(fmtInt(list.length))} denúncia${list.length === 1 ? '' : 's'}</h3>
      <p class="panel-sub">Canal exigido pela lei (INFORM Consumers Act). Quem denunciou recebe um aviso quando você decide.</p>
      <div class="as-toolbar">${statusSelect('stReportStatus', status, [['pending', 'Pendentes'], ['resolved', 'Procedentes'], ['dismissed', 'Descartadas'], ['all', 'Todas']])}</div>
      ${list.length ? list.map(reportCard).join('') : `<div class="as-empty">${status === 'pending' ? 'Nenhuma denúncia pendente.' : 'Nenhuma denúncia neste filtro.'}</div>`}
    </div>`
  }

  function reportCard(r) {
    const p = r.product || null
    const img = p ? safeImg(p.image) : ''
    const canSuspend = p && (p.status === 'approved' || p.status === 'paused')
    const actions = []
    if (r.status === 'pending') {
      if (canSuspend) actions.push(`<button type="button" class="btn-mini btn-reject" data-as-act="report" data-op="resolve_report" data-suspend="1" data-id="${esc(r.id)}">Procedente e suspender produto</button>`)
      actions.push(`<button type="button" class="btn-mini btn-mark" data-as-act="report" data-op="resolve_report" data-id="${esc(r.id)}">Procedente</button>`)
      actions.push(`<button type="button" class="btn-mini as-btn-ghost" data-as-act="report" data-op="dismiss_report" data-id="${esc(r.id)}">Descartar</button>`)
    }
    if (p && p.status === 'approved' && p.slug && r.seller && r.seller.can_sell) actions.push(`<a class="btn-mini as-btn-ghost" href="/store/p/${esc(encodeURIComponent(p.slug))}" target="_blank" rel="noopener noreferrer">Ver anúncio</a>`)
    else if (p && p.status === 'approved') actions.push(tag('Fora da vitrine: loja sem Stripe ativo ou em férias', 'warn'))
    return `<div class="item">
      <div class="as-card-head">
        ${img ? `<img class="as-logo" src="${esc(img)}" alt="" loading="lazy" width="48" height="48">` : ''}
        <div class="as-grow">
          <div class="as-title">${esc(REPORT_REASON[r.reason] || r.reason)} · ${esc(p ? p.title : 'Produto removido')}</div>
          <div class="as-sub">Loja: ${esc(r.seller ? r.seller.name : '—')} · denunciado em ${esc(when(r.created_at))}${r.reporter_email ? ' · por ' + esc(r.reporter_email) : ''}</div>
          <div class="as-badges">${badge(L.report, r.status)} ${p ? badge(L.product, p.status) : ''}</div>
        </div>
      </div>
      ${r.details ? `<div class="answer as-text">${esc(r.details)}</div>` : ''}
      ${r.status !== 'pending' ? `<div class="as-sub">Decidido por ${esc(r.resolved_by || '—')} em ${esc(when(r.resolved_at))}${r.admin_notes ? ' · ' + esc(r.admin_notes) : ''}</div>` : ''}
      ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}
      <p class="as-msg" role="status" aria-live="polite"></p>
    </div>`
  }

  async function reportAct(c, btn) {
    const op = btn.dataset.op
    const id = btn.dataset.id
    if (!isUuid(id)) return
    const suspend = btn.dataset.suspend === '1'
    let reason = null
    if (op === 'resolve_report' && suspend) {
      reason = askReason('Motivo da suspensão do produto. Vai para a loja.')
      if (reason === null) return
    } else if (op === 'resolve_report') {
      if (!confirm('Marcar a denúncia como procedente, sem suspender o produto?')) return
      reason = prompt('Anotação interna (opcional):', '')
      if (reason === null) return
    } else if (op === 'dismiss_report') {
      reason = prompt('Por que descartar? Anotação interna (opcional):', '')
      if (reason === null) return
    } else return
    await runCardAction(c, btn, () => post(op, { report_id: id, id, reason: (reason || '').trim() || undefined, suspend_product: suspend }), {
      done: d => {
        if (op === 'dismiss_report') return 'Denúncia descartada.'
        if (!suspend) return 'Denúncia marcada como procedente.'
        return d.product_suspended ? 'Denúncia resolvida e produto suspenso.' : 'Denúncia resolvida. ' + (d.product_note || 'O produto não foi suspenso.')
      },
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Avaliacoes (a IA sinaliza; alto risco ja sai do ar sozinho)
  // ───────────────────────────────────────────────────────────────────────────
  async function renderReviews(c) {
    const filter = ['flagged', 'hidden', 'all'].includes(c.dataset.stReviewFilter) ? c.dataset.stReviewFilter : 'flagged'
    const d = await getView('reviews', { filter })
    const list = d.reviews || []
    const pills = `<div class="as-pills" role="group" aria-label="Filtrar avaliações">${[['flagged', 'Sinalizadas pela IA'], ['hidden', 'Ocultas'], ['all', 'Todas']].map(([id, label]) =>
      `<button type="button" class="as-pill" aria-pressed="${id === filter ? 'true' : 'false'}" data-as-act="filter" data-key="stReviewFilter" data-value="${esc(id)}">${esc(label)}</button>`).join('')}</div>`
    return `<div class="panel">
      <div class="panel-eyebrow">AVALIAÇÕES</div>
      <h3>${esc(fmtInt(list.length))} avaliaç${list.length === 1 ? 'ão' : 'ões'}</h3>
      <p class="panel-sub">A IA confere cada avaliação. Alto risco (contato para vender fora da Store, ofensa, dados pessoais) sai do ar sozinho; você confirma ou devolve. As notas da loja e do produto são recalculadas.</p>
      ${pills}
      ${list.length ? list.map(reviewCard).join('') : `<div class="as-empty">${filter === 'flagged' ? 'Nenhuma avaliação sinalizada.' : 'Nenhuma avaliação neste filtro.'}</div>`}
    </div>`
  }

  function reviewCard(r) {
    const actions = []
    const base = `data-id="${esc(r.id)}"`
    if (r.status === 'visible') actions.push(`<button type="button" class="btn-mini as-btn-danger" data-as-act="review" data-op="hide_review" ${base}>Ocultar</button>`)
    if (r.status === 'hidden') actions.push(`<button type="button" class="btn-mini btn-approve" data-as-act="review" data-op="show_review" ${base}>Mostrar de novo</button>`)
    if (['flagged', 'auto_hidden'].includes(r.agent_status)) {
      actions.push(r.status === 'hidden'
        ? `<button type="button" class="btn-mini as-btn-ghost" data-as-act="review" data-op="hide_review" ${base}>Manter oculta</button>`
        : `<button type="button" class="btn-mini as-btn-ghost" data-as-act="review" data-op="show_review" ${base}>Manter visível</button>`)
    }
    if (r.order_id) actions.push(`<button type="button" class="btn-mini as-btn-ghost" data-as-act="order" data-id="${esc(r.order_id)}">Abrir pedido</button>`)
    return `<div class="item">
      <div class="as-card-head"><div class="as-grow">
        <div class="as-title">Nota ${esc(r.rating)} de 5 · ${esc(r.product ? r.product.title : 'Produto removido')}</div>
        <div class="as-sub">Loja: ${esc(r.seller ? r.seller.name : '—')} · ${esc(when(r.created_at))}</div>
        <div class="as-badges">${r.status === 'hidden' ? tag('Oculta', 'muted') : tag('Visível', 'ok')} ${aiBadge(r)}</div>
      </div></div>
      ${r.body ? `<div class="answer as-text">${esc(r.body)}</div>` : '<div class="as-sub">(só a nota, sem texto)</div>'}
      ${r.seller_reply ? `<div class="as-sub" style="margin-top:4px;">Resposta da loja: ${esc(r.seller_reply)}</div>` : ''}
      ${aiNote(r)}
      <div class="actions">${actions.join('')}</div>
      <p class="as-msg" role="status" aria-live="polite"></p>
    </div>`
  }

  async function reviewAct(c, btn) {
    const op = btn.dataset.op
    const id = btn.dataset.id
    if (!isUuid(id) || (op !== 'hide_review' && op !== 'show_review')) return
    const msg = op === 'hide_review'
      ? 'Ocultar esta avaliação (ou manter oculta)? Ela some da loja e do produto, e as notas são recalculadas.'
      : 'Mostrar esta avaliação (ou manter visível)? Ela aparece na loja e no produto, e as notas são recalculadas.'
    if (!confirm(msg)) return
    const reason = prompt('Motivo (anotação interna, opcional):', '')
    if (reason === null) return
    await runCardAction(c, btn, () => post(op, { review_id: id, id, reason: reason.trim() || undefined }), {
      done: op === 'hide_review' ? 'Avaliação oculta.' : 'Avaliação visível.',
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Impostos (volume por estado x marketplace facilitator)
  // ───────────────────────────────────────────────────────────────────────────
  async function renderTaxes() {
    const d = await getView('state-volume')
    const rows = d.states || []
    const body = rows.map(r => {
      const pct = r.pct === null || r.pct === undefined ? null : Math.max(0, Number(r.pct) || 0)
      const cls = pct === null ? '' : pct >= 100 ? 'is-over' : pct >= 80 ? 'is-warn' : ''
      const limit = r.threshold_cents ? moneyRound(r.threshold_cents) + (r.transactions_threshold ? ' e ' + fmtInt(r.transactions_threshold) + ' transações' : '') : 'Sem sales tax'
      return `<tr>
        <td data-label="Estado"><span class="as-strong">${esc(r.state)}</span> <span class="as-sub">${esc(r.name)}</span></td>
        <td data-label="Transações" class="as-num">${esc(fmtInt(r.transactions))}</td>
        <td data-label="Pedidos" class="as-num">${esc(fmtInt(r.orders))}</td>
        <td data-label="Vendas (12 meses)" class="as-num">${esc(money(r.gross_cents))}</td>
        <td data-label="Limite">${esc(limit)}</td>
        <td data-label="% do limite">${pct === null ? '—' : `<div class="as-barcell"><div class="as-bar" aria-hidden="true"><span class="${cls}" style="width:${Math.min(100, pct).toFixed(1)}%"></span></div><span class="as-num">${esc(pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))}%</span></div>`}</td>
        <td data-label="Observação">${esc(r.note || '')}</td>
      </tr>`
    }).join('')
    return `<div class="panel">
      <div class="panel-eyebrow">IMPOSTOS · MARKETPLACE FACILITATOR</div>
      <h3>Vendas por estado de entrega (${esc(d.window || '12 meses')})</h3>
      <p class="panel-sub">A BrasilConnect vira responsável por cobrar o sales tax nos estados em que passar do limite. Acompanhe aqui e ligue o Stripe Tax depois de registrar os estados.</p>
      <div class="as-callout warn">${esc(d.note || 'Confirmar com contador.')}</div>
      ${rows.length ? `<div class="as-table-wrap"><table class="as-table">
        <thead><tr><th scope="col">Estado</th><th scope="col">Transações</th><th scope="col">Pedidos</th><th scope="col">Vendas (12 meses)</th><th scope="col">Limite</th><th scope="col">% do limite</th><th scope="col">Observação</th></tr></thead>
        <tbody>${body}</tbody></table></div>` : '<div class="as-empty">Ainda não há vendas pagas nos últimos 12 meses.</div>'}
    </div>`
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Configuracao
  // ───────────────────────────────────────────────────────────────────────────
  const CFG = [
    { key: 'public_enabled', type: 'bool', label: 'Vitrine aberta ao público', help: 'Desligada, só quem abre /store?preview=brasil2026 vê a Store.' },
    { key: 'checkout_enabled', type: 'bool', label: 'Compras liberadas', help: 'Desligue para pausar as vendas. Pedidos já pagos continuam.' },
    { key: 'fee_bps', type: 'pct', label: 'Comissão (%)', min: 0, max: 50, step: 0.01, help: 'Descontada do repasse da loja. Vale para pedidos novos. Abaixo de ~7% a Store perde dinheiro em pedido pequeno.' },
    { key: 'fee_fixed_cents', type: 'usd', label: 'Taxa fixa por pedido (US$)', min: 0, max: 1000, step: 0.01, help: 'Somada à comissão em cada pedido. Use 0 para não cobrar.' },
    { key: 'fee_on_shipping', type: 'bool', label: 'Comissão também sobre o frete', help: 'Ligado: a comissão incide sobre itens + frete.' },
    { key: 'release_days_after_delivery', type: 'int', label: 'Dias para repassar após a entrega', min: 0, max: 60, help: 'Prazo para o comprador reclamar antes de o dinheiro ir para a loja.' },
    { key: 'release_days_new_seller', type: 'int', label: 'Dias para repassar (loja nova)', min: 0, max: 60, help: 'Usado enquanto a loja tem menos pedidos concluídos que o número abaixo.' },
    { key: 'new_seller_orders', type: 'int', label: 'Pedidos para deixar de ser loja nova', min: 0, max: 1000, help: 'Pedidos concluídos que a loja precisa ter.' },
    { key: 'safety_release_days', type: 'int', label: 'Repasse sem confirmação de entrega (dias)', min: 7, max: 120, help: 'Se o rastreio nunca confirmar a entrega, o repasse sai este número de dias após o envio.' },
    { key: 'local_release_days', type: 'int', label: 'Dias para repassar (entrega local ou retirada)', min: 0, max: 60, help: 'Contados a partir de quando a loja marca como entregue.' },
    { key: 'auto_cancel_grace_days', type: 'int', label: 'Tolerância antes de cancelar pedido não postado (dias úteis)', min: 0, max: 30, help: 'Depois do prazo de postagem, mais estes dias; aí o pedido é cancelado e o comprador reembolsado.' },
    { key: 'dispute_window_days', type: 'int', label: 'Prazo para o comprador abrir problema (dias)', min: 1, max: 120, help: 'Contados a partir da entrega.' },
    { key: 'seller_response_days', type: 'int', label: 'Prazo da loja para responder um problema (dias úteis)', min: 1, max: 14, help: 'Depois disso o comprador pode pedir que a BrasilConnect decida.' },
    { key: 'checkout_expires_minutes', type: 'int', label: 'Tempo para concluir o pagamento (minutos)', min: 30, max: 1440, help: 'Depois disso o carrinho expira e o estoque volta. O Stripe aceita de 30 a 1440.' },
    { key: 'tax_enabled', type: 'bool', label: 'Cobrar sales tax (Stripe Tax)', help: 'Só ligue depois de registrar os estados no Stripe e falar com o contador.' },
    { key: 'agreement_version', type: 'text', label: 'Versão do contrato do vendedor', help: 'Mude quando o contrato mudar (ex.: 2026-10-10). Lojas novas aceitam a versão atual.' },
  ]

  async function renderConfig(c) {
    const d = await getView('config')
    const cfg = d.config || {}
    c._asConfig = cfg
    const fields = CFG.map(f => {
      const id = 'as-cfg-' + f.key
      const help = `<div class="as-hint" id="${esc(id)}-h">${esc(f.help)}</div>`
      if (f.type === 'bool') {
        return `<div class="as-f"><div class="as-check"><input type="checkbox" id="${esc(id)}" name="${esc(f.key)}"${cfg[f.key] ? ' checked' : ''} aria-describedby="${esc(id)}-h">
          <div><label for="${esc(id)}">${esc(f.label)}</label>${help}</div></div></div>`
      }
      let val = cfg[f.key]
      if (f.type === 'pct') val = (Number(val) || 0) / 100
      else if (f.type === 'usd') val = ((Number(val) || 0) / 100).toFixed(2)
      const attrs = f.type === 'text'
        ? 'type="text" maxlength="40" autocomplete="off"'
        : `type="number" inputmode="decimal" step="${esc(f.step || 1)}" min="${esc(f.min)}" max="${esc(f.max)}"`
      return `<div class="as-f"><label for="${esc(id)}">${esc(f.label)}</label>
        <input id="${esc(id)}" name="${esc(f.key)}" ${attrs} value="${esc(val)}" required aria-describedby="${esc(id)}-h">${help}</div>`
    }).join('')
    return `<div class="panel">
      <div class="panel-eyebrow">CONFIGURAÇÃO</div>
      <h3>Regras da Store</h3>
      <p class="panel-sub">Última mudança: ${esc(when(cfg.updated_at))}${cfg.updated_by ? ' por ' + esc(cfg.updated_by) : ''}. Mudanças de comissão e prazos valem para pedidos novos.</p>
      <form data-as-form="config" novalidate>
        <div class="as-form">${fields}</div>
        <div class="actions" style="margin-top:16px;"><button type="submit" class="btn-mini btn-approve">Salvar configuração</button></div>
        <p class="as-msg" role="status" aria-live="polite"></p>
      </form>
    </div>`
  }

  async function saveConfigForm(c, form) {
    const cfg = c._asConfig || {}
    const scope = form
    const payload = {}
    const changes = []
    for (const f of CFG) {
      const el = form.elements[f.key]
      if (!el) continue
      let v
      if (f.type === 'bool') v = !!el.checked
      else if (f.type === 'text') {
        v = String(el.value || '').trim()
        if (!/^[0-9A-Za-z._-]{1,40}$/.test(v)) { say(scope, `"${f.label}": use letras, números, ponto, hífen ou sublinhado (ex.: 2026-10-10).`, 'err'); el.focus(); return }
      } else {
        const raw = String(el.value || '').trim().replace(',', '.')
        const n = Number(raw)
        if (raw === '' || !isFinite(n)) { say(scope, `Preencha "${f.label}".`, 'err'); el.focus(); return }
        if (n < f.min || n > f.max) { say(scope, `"${f.label}" vai de ${f.min} a ${f.max}.`, 'err'); el.focus(); return }
        if (f.type === 'int' && !Number.isInteger(n)) { say(scope, `"${f.label}" precisa ser um número inteiro.`, 'err'); el.focus(); return }
        v = f.type === 'pct' || f.type === 'usd' ? Math.round(n * 100) : n
      }
      if (v !== cfg[f.key]) {
        payload[f.key] = v
        changes.push(f.label)
      }
    }
    if (!changes.length) { say(scope, 'Nada mudou.', ''); return }
    let warn = ''
    if (payload.checkout_enabled === true && !(payload.tax_enabled ?? cfg.tax_enabled)) warn += '\n\nAtenção: as compras vão abrir com o sales tax desligado.'
    const openAfter = (payload.public_enabled ?? cfg.public_enabled) && (payload.checkout_enabled ?? cfg.checkout_enabled)
    if (openAfter && !(cfg.public_enabled && cfg.checkout_enabled)) warn += '\n\nA Store fica aberta para compras: a lista de espera recebe o aviso.'
    if (payload.tax_enabled === true) warn += '\n\nConfirme que os estados já estão registrados no Stripe Tax.'
    if (!confirm('Salvar estas mudanças?\n\n- ' + changes.join('\n- ') + warn)) return
    const btn = form.querySelector('button[type="submit"]')
    if (btn) btn.disabled = true
    say(scope, 'Salvando…')
    try {
      const d = await followWaitlist(await post('save_config', payload))
      c._asConfig = (d && d.config) || cfg
      say(scope, 'Configuração salva.', 'ok')
      setTimeout(() => reloadIfVisible(c), 1200)
    } catch (e) {
      say(scope, e.message, 'err')
      if (btn) btn.disabled = false
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  const RENDER = {
    sellers: renderSellers,
    products: renderProducts,
    orders: renderOrders,
    reports: renderReports,
    reviews: renderReviews,
    taxes: renderTaxes,
    config: renderConfig,
  }

  window.loadStore = loadStore
})()
