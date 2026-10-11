/**
 * BrasilConnect Store — biblioteca do front (window.BCStore).
 *
 * Carregar com <script src="/js/store.js" defer></script> em toda pagina da
 * Store. Contrato completo: docs/store/ARQUITETURA.md, secao 7.
 *
 * - Sessao: a mesma do resto do site (Supabase, localStorage
 *   'sb-ggwppcbdnemjuddnzbdw-auth-token'). Nao mudar storageKey nem flowType.
 * - Carrinho em localStorage 'bc_store_cart_v1' (precos aqui sao so para
 *   mostrar; o servidor recalcula tudo).
 * - Todo acesso a localStorage passa por try/catch (aba anonima, bloqueio).
 * - Dado de usuario sempre passa por esc() antes de virar HTML.
 */
(function () {
  'use strict'
  if (window.BCStore) return

  var SUPA_URL = 'https://ggwppcbdnemjuddnzbdw.supabase.co'
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnd3BwY2JkbmVtanVkZG56YmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MzI3MDgsImV4cCI6MjA5MzAwODcwOH0.-oeVAtpfqUJiHSUMErBEnfvGX_waABpNgaIh-UPJdlY'
  var SUPA_LIB = 'https://esm.sh/@supabase/supabase-js@2.45.4'
  var AUTH_STORAGE_KEY = 'sb-ggwppcbdnemjuddnzbdw-auth-token'
  var CART_KEY = 'bc_store_cart_v1'
  var SHIPTO_KEY = 'bc_store_shipto'
  var PREVIEW_KEY = 'bc_preview_mode'
  var PREVIEW_TOKEN = 'brasil2026'
  var MAX_CART_LINES = 30
  var MAX_QTY = 99
  var UPLOAD_MAX_BYTES = 480 * 1024
  var UPLOAD_MAX_DIM = 1200
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

  // ───────────────────────────────────────────────────────────────────────
  // localStorage seguro
  // ───────────────────────────────────────────────────────────────────────
  function lsGet(k) { try { return window.localStorage.getItem(k) } catch (_) { return null } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true } catch (_) { return false } }
  function lsDel(k) { try { window.localStorage.removeItem(k) } catch (_) { /* sem storage */ } }
  // Mesmo localStorage do site, so que sem lancar erro quando o navegador bloqueia
  var authStorage = {
    getItem: function (k) { return lsGet(k) },
    setItem: function (k, v) { lsSet(k, v) },
    removeItem: function (k) { lsDel(k) },
  }
  function parseJson(s) { try { return JSON.parse(s) } catch (_) { return null } }

  // ───────────────────────────────────────────────────────────────────────
  // Texto, dinheiro, datas
  // ───────────────────────────────────────────────────────────────────────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c] })
  }
  /** So http(s). Qualquer outra coisa (javascript:, data:, relativo) vira ''. */
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim()
    return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : ''
  }
  function money(cents) {
    var n = Math.round(Number(cents) || 0)
    var neg = n < 0
    var parts = (Math.abs(n) / 100).toFixed(2).split('.')
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return (neg ? '-' : '') + '$' + parts.join('.')
  }
  function fmtDate(iso, opts) {
    if (!iso) return ''
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    var o = Object.assign({ day: 'numeric', month: 'short', timeZone: 'America/New_York' }, opts || {})
    try { return d.toLocaleDateString('pt-BR', o) } catch (_) { return d.toLocaleDateString('pt-BR') }
  }
  function toInt(v) {
    var n = typeof v === 'number' ? v : parseInt(String(v == null ? '' : v), 10)
    return isFinite(n) ? Math.floor(n) : NaN
  }
  function clip(v, max) { return String(v == null ? '' : v).slice(0, max) }

  /** HTML de estrelas (0 a 5). count opcional. */
  function stars(avg, count) {
    var a = Math.max(0, Math.min(5, Number(avg) || 0))
    var pct = Math.round((a / 5) * 100)
    var num = a.toFixed(1).replace('.', ',')
    var hasCount = count != null && isFinite(Number(count))
    var c = hasCount ? Math.max(0, Math.floor(Number(count))) : 0
    var label = 'Nota ' + num + ' de 5' + (hasCount ? ' (' + c + ' ' + (c === 1 ? 'avaliação' : 'avaliações') + ')' : '')
    return '<span class="st-stars" role="img" aria-label="' + esc(label) + '">' +
      '<span class="st-stars-track" aria-hidden="true">★★★★★<span class="st-stars-fill" style="width:' + pct + '%">★★★★★</span></span>' +
      '<span class="st-stars-num" aria-hidden="true">' + num + (hasCount ? ' (' + c + ')' : '') + '</span></span>'
  }

  // ───────────────────────────────────────────────────────────────────────
  // Estados e rotulos
  // ───────────────────────────────────────────────────────────────────────
  var STATE_NAMES = {
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
  var STATES = Object.keys(STATE_NAMES)
    .map(function (code) { return { code: code, name: STATE_NAMES[code] } })
    .sort(function (a, b) { return a.name.localeCompare(b.name) })

  var LABELS = {
    status: {
      pending_payment: 'Aguardando pagamento',
      paid: 'Pago · aguardando envio',
      shipped: 'Enviado',
      delivered: 'Entregue',
      completed: 'Concluído',
      canceled: 'Cancelado',
      refunded: 'Reembolsado',
      expired: 'Pagamento não concluído',
    },
    condition: { new: 'Novo', used_like_new: 'Usado · como novo', used_good: 'Usado · bom estado', handmade: 'Feito à mão' },
    origin: { handmade: 'Feito à mão', made_in_usa: 'Feito nos EUA', imported_brazil: 'Importado do Brasil', other: 'Outro' },
    fulfillment: { ship: 'Envio pela transportadora', local_delivery: 'Entrega local', pickup: 'Retirada com a loja' },
    dispute_reason: {
      not_received: 'Não recebi',
      not_as_described: 'Diferente do anúncio',
      damaged: 'Chegou com defeito ou avariado',
      other: 'Outro problema',
    },
  }

  // ───────────────────────────────────────────────────────────────────────
  // Aviso flutuante
  // ───────────────────────────────────────────────────────────────────────
  var toastWrap = null
  function toast(msg, kind) {
    if (!document.body) return
    if (!toastWrap || !toastWrap.isConnected) {
      toastWrap = document.createElement('div')
      toastWrap.className = 'st-toast-wrap'
      toastWrap.setAttribute('role', 'status')
      toastWrap.setAttribute('aria-live', 'polite')
      document.body.appendChild(toastWrap)
    }
    var el = document.createElement('div')
    el.className = 'st-toast' + (kind === 'ok' ? ' is-ok' : kind === 'err' ? ' is-err' : '')
    el.textContent = String(msg == null ? '' : msg)
    toastWrap.appendChild(el)
    while (toastWrap.children.length > 3) toastWrap.removeChild(toastWrap.firstChild)
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el) }, kind === 'err' ? 6000 : 3500)
  }

  // ───────────────────────────────────────────────────────────────────────
  // Modal generico (foco preso, Esc, clique fora)
  // ───────────────────────────────────────────────────────────────────────
  var FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  var ICON_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  var modalStack = []
  var modalSeq = 0

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
      return !el.closest('[hidden]') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
    })
  }

  /**
   * Abre um modal. opts: { title, html (HTML ja escapado por quem chama),
   * wide, initialFocus (seletor), onClose(result) }.
   * Retorna { el, body, close(result) }.
   */
  function modal(opts) {
    opts = opts || {}
    var prevFocus = document.activeElement
    var id = 'st-modal-' + (++modalSeq)
    var back = document.createElement('div')
    back.className = 'st-modal-backdrop'
    back.innerHTML =
      '<div class="st-modal' + (opts.wide ? ' st-modal-wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '-t">' +
        '<div class="st-modal-head"><h2 class="st-modal-title" id="' + id + '-t">' + esc(opts.title || '') + '</h2>' +
        '<button type="button" class="st-modal-close" data-st-close aria-label="Fechar">' + ICON_X + '</button></div>' +
        '<div class="st-modal-body"></div>' +
      '</div>'
    var box = back.firstChild
    var body = box.querySelector('.st-modal-body')
    if (opts.html) body.innerHTML = opts.html
    var closed = false
    var handle = { el: box, body: body, close: close }

    function close(result) {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey, true)
      if (back.parentNode) back.parentNode.removeChild(back)
      var i = modalStack.indexOf(handle)
      if (i !== -1) modalStack.splice(i, 1)
      if (!modalStack.length) document.documentElement.classList.remove('st-modal-open')
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
        try { prevFocus.focus() } catch (_) { /* elemento sumiu */ }
      }
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(result) } catch (e) { console.error('[store] onClose:', e) }
      }
    }
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== handle) return
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === 'Tab') {
        var list = focusables(box)
        if (!list.length) { e.preventDefault(); return }
        var first = list[0]
        var last = list[list.length - 1]
        var active = document.activeElement
        if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus() }
      }
    }
    // Fecha so se o clique comecou e terminou fora da caixa (nao fecha ao selecionar texto)
    var downOutside = false
    back.addEventListener('mousedown', function (e) { downOutside = e.target === back })
    back.addEventListener('click', function (e) {
      if (e.target === back && downOutside) close()
      downOutside = false
    })
    box.querySelector('[data-st-close]').addEventListener('click', function () { close() })
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(back)
    document.documentElement.classList.add('st-modal-open')
    modalStack.push(handle)
    var first = (opts.initialFocus && box.querySelector(opts.initialFocus)) || focusables(body)[0] || box.querySelector('[data-st-close]')
    setTimeout(function () { try { if (first) first.focus() } catch (_) { /* ignore */ } }, 0)
    return handle
  }

  // ───────────────────────────────────────────────────────────────────────
  // Supabase (sessao)
  // ───────────────────────────────────────────────────────────────────────
  var client = null
  var session = null
  var currentUser = null
  var isReady = false
  var lastUserKey = undefined
  var authListeners = []
  var readyResolve
  var ready = new Promise(function (resolve) { readyResolve = resolve })

  function setSession(s) {
    session = s || null
    currentUser = session && session.user ? session.user : null
    var key = currentUser ? currentUser.id : ''
    if (!isReady || key === lastUserKey) return
    lastUserKey = key
    renderAccount()
    authListeners.slice().forEach(function (cb) {
      try { cb(currentUser) } catch (e) { console.error('[store] onAuth:', e) }
    })
  }
  function finishReady() {
    if (isReady) return
    isReady = true
    lastUserKey = currentUser ? currentUser.id : ''
    renderAccount()
    authListeners.slice().forEach(function (cb) {
      try { cb(currentUser) } catch (e) { console.error('[store] onAuth:', e) }
    })
    readyResolve(currentUser)
  }
  function boot() {
    // Se a CDN do esm.sh demorar, a pagina segue sem login depois de 8s
    var timer = setTimeout(finishReady, 8000)
    import(SUPA_LIB)
      .then(function (mod) {
        client = mod.createClient(SUPA_URL, SUPA_ANON, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage },
        })
        client.auth.onAuthStateChange(function (_event, s) { setSession(s) })
        return client.auth.getSession()
      })
      .then(function (r) { setSession(r && r.data ? r.data.session : null) })
      .catch(function (e) { console.error('[store] login nao carregou:', e && e.message) })
      .then(function () { clearTimeout(timer); finishReady() })
  }
  function getClient() {
    return ready.then(function () {
      if (!client) {
        var e = new Error('LOGIN_UNAVAILABLE')
        e.code = 'login_unavailable'
        throw e
      }
      return client
    })
  }
  async function freshToken() {
    await ready
    if (client) {
      try {
        var r = await client.auth.getSession()
        var s = r && r.data ? r.data.session : null
        setSession(s)
        return s ? s.access_token : null
      } catch (_) { /* usa o que tem */ }
    }
    return session ? session.access_token : null
  }

  function onAuth(cb) {
    if (typeof cb !== 'function') return function () {}
    authListeners.push(cb)
    if (isReady) {
      try { cb(currentUser) } catch (e) { console.error('[store] onAuth:', e) }
    }
    return function () {
      var i = authListeners.indexOf(cb)
      if (i !== -1) authListeners.splice(i, 1)
    }
  }

  async function logout() {
    await ready
    try {
      if (client) {
        var r = await client.auth.signOut()
        if (r && r.error) throw r.error
      }
    } catch (e) {
      // Sem rede: garante que a sessao local some mesmo assim
      console.error('[store] signOut:', e && e.message)
      lsDel(AUTH_STORAGE_KEY)
    }
    setSession(null)
  }

  // ───────────────────────────────────────────────────────────────────────
  // Login (modal proprio: senha ou codigo por e-mail)
  // ───────────────────────────────────────────────────────────────────────
  function authMsg(err) {
    var m = String((err && (err.message || err.error_description)) || err || '')
    var code = String((err && err.code) || '')
    if (code === 'login_unavailable' || m === 'LOGIN_UNAVAILABLE') return 'O login não carregou. Recarregue a página e tente de novo.'
    if (/invalid login credentials|invalid_credentials/i.test(m + ' ' + code)) return 'E-mail ou senha incorretos. Sem senha? Use a aba "Código por e-mail".'
    if (/email not confirmed|email_not_confirmed/i.test(m + ' ' + code)) return 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou entre com um código por e-mail.'
    if (/already registered|already been registered|user_already_exists/i.test(m + ' ' + code)) return 'Esse e-mail já tem conta. Entre com a senha ou peça um código por e-mail.'
    if (/password should be|weak.?password/i.test(m + ' ' + code)) return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'
    if (/token has expired|otp_expired|invalid.*(otp|token)|(otp|token).*(expired|invalid)/i.test(m + ' ' + code)) return 'Código inválido ou vencido. Peça um novo.'
    if (/rate limit|too many|security purposes|only request this after|over_email_send_rate_limit/i.test(m + ' ' + code)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
    if (/signups? not allowed|signup.*disabled|signup_disabled/i.test(m + ' ' + code)) return 'O cadastro de contas novas está fechado agora.'
    if (/(invalid|unable to validate).*email|email.*invalid|email_address_invalid/i.test(m + ' ' + code)) return 'Digite um e-mail válido.'
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return 'Sem conexão. Confira a internet e tente de novo.'
    return 'Não deu certo. Tente de novo em instantes.'
  }
  function redirectUrl() {
    try { return window.location.origin + window.location.pathname + window.location.search } catch (_) { return undefined }
  }

  function loginHtml(reason) {
    return '' +
      '<p class="st-modal-lede">' + esc(reason || 'Use a mesma conta do app BrasilConnect. Se ainda não tem, crie agora.') + '</p>' +
      '<div class="st-tabs" role="tablist" aria-label="Como você quer entrar">' +
        '<button type="button" class="st-tab" role="tab" id="st-lt-pass" aria-controls="st-lp-pass" aria-selected="true">Com senha</button>' +
        '<button type="button" class="st-tab" role="tab" id="st-lt-code" aria-controls="st-lp-code" aria-selected="false" tabindex="-1">Código por e-mail</button>' +
      '</div>' +
      '<div id="st-lp-pass" role="tabpanel" aria-labelledby="st-lt-pass">' +
        '<form class="st-form" data-form="pass" novalidate>' +
          '<div class="st-field" data-only="signup" hidden><label for="st-login-name">Seu nome <span class="st-muted">(opcional)</span></label>' +
            '<input id="st-login-name" class="st-input" name="name" autocomplete="name" maxlength="80"></div>' +
          '<div class="st-field"><label for="st-login-email">E-mail</label>' +
            '<input id="st-login-email" class="st-input" name="email" type="email" autocomplete="email" inputmode="email" maxlength="200" required></div>' +
          '<div class="st-field"><label for="st-login-pass">Senha</label>' +
            '<input id="st-login-pass" class="st-input" name="password" type="password" autocomplete="current-password" maxlength="200" required>' +
            '<p class="st-hint" data-only="signup" hidden>Pelo menos 8 caracteres.</p></div>' +
          '<div class="st-alert st-alert-err" data-err role="alert" hidden></div>' +
          '<div class="st-alert st-alert-ok" data-notice role="status" hidden></div>' +
          '<button type="submit" class="btn btn-primary st-btn-block" data-submit>Entrar</button>' +
          '<p class="st-small st-muted st-center" style="margin:0"><span data-switch-text>Não tem conta?</span> <button type="button" class="st-linkbtn" data-switch>Criar conta</button></p>' +
        '</form>' +
      '</div>' +
      '<div id="st-lp-code" role="tabpanel" aria-labelledby="st-lt-code" hidden>' +
        '<form class="st-form" data-form="code-email" novalidate>' +
          '<p class="st-hint">Mandamos um código para o seu e-mail. Serve para entrar ou criar a conta, sem senha.</p>' +
          '<div class="st-field"><label for="st-code-email">E-mail</label>' +
            '<input id="st-code-email" class="st-input" name="email" type="email" autocomplete="email" inputmode="email" maxlength="200" required></div>' +
          '<div class="st-alert st-alert-err" data-err role="alert" hidden></div>' +
          '<button type="submit" class="btn btn-primary st-btn-block" data-submit>Enviar código</button>' +
        '</form>' +
        '<form class="st-form" data-form="code-verify" novalidate hidden>' +
          '<p class="st-hint" data-sent-to></p>' +
          '<div class="st-field"><label for="st-code-token">Código do e-mail</label>' +
            '<input id="st-code-token" class="st-input st-code-input" name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></div>' +
          '<div class="st-alert st-alert-err" data-err role="alert" hidden></div>' +
          '<div class="st-alert st-alert-ok" data-notice role="status" hidden></div>' +
          '<button type="submit" class="btn btn-primary st-btn-block" data-submit>Entrar</button>' +
          '<div class="st-row-between st-small"><button type="button" class="st-linkbtn" data-back>Trocar e-mail</button>' +
            '<button type="button" class="st-linkbtn" data-resend>Reenviar código</button></div>' +
        '</form>' +
      '</div>' +
      '<p class="st-modal-foot">Ao entrar, você concorda com os <a href="/termos">Termos</a> e a <a href="/privacidade">Política de Privacidade</a>.</p>'
  }

  function wireLogin(m, onSuccess) {
    var root = m.body
    function q(sel) { return root.querySelector(sel) }
    function showErr(form, msg, field) {
      var box = form.querySelector('[data-err]')
      var ok = form.querySelector('[data-notice]')
      if (ok) ok.hidden = true
      box.textContent = msg
      box.hidden = false
      if (field) { field.setAttribute('aria-invalid', 'true'); try { field.focus() } catch (_) { /* ignore */ } }
    }
    function showNotice(form, msg) {
      var box = form.querySelector('[data-notice]')
      var er = form.querySelector('[data-err]')
      if (er) er.hidden = true
      if (box) { box.textContent = msg; box.hidden = false }
    }
    function clearMsgs(form) {
      form.querySelectorAll('[data-err],[data-notice]').forEach(function (el) { el.hidden = true; el.textContent = '' })
      form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid') })
    }
    function busy(form, on, label) {
      var b = form.querySelector('[data-submit]')
      if (!b) return
      if (on) { b.setAttribute('data-label', b.textContent); b.textContent = label || 'Aguarde…'; b.disabled = true }
      else { b.textContent = b.getAttribute('data-label') || b.textContent; b.disabled = false }
    }

    // Abas
    var tabs = [q('#st-lt-pass'), q('#st-lt-code')]
    var panels = [q('#st-lp-pass'), q('#st-lp-code')]
    function selectTab(i, focus) {
      tabs.forEach(function (t, j) {
        t.setAttribute('aria-selected', j === i ? 'true' : 'false')
        t.tabIndex = j === i ? 0 : -1
        panels[j].hidden = j !== i
      })
      // Leva o e-mail de uma aba para a outra
      var a = q('#st-login-email')
      var b = q('#st-code-email')
      if (i === 1 && a.value && !b.value) b.value = a.value
      if (i === 0 && b.value && !a.value) a.value = b.value
      if (focus) tabs[i].focus()
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { selectTab(i) })
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault()
          selectTab(i === 0 ? 1 : 0, true)
        }
      })
    })

    // Senha: entrar ou criar conta
    var passForm = q('[data-form="pass"]')
    var mode = 'signin'
    function setMode(next) {
      mode = next
      passForm.querySelectorAll('[data-only="signup"]').forEach(function (el) { el.hidden = mode !== 'signup' })
      q('#st-login-pass').setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password')
      passForm.querySelector('[data-submit]').textContent = mode === 'signup' ? 'Criar conta' : 'Entrar'
      q('[data-switch-text]').textContent = mode === 'signup' ? 'Já tem conta?' : 'Não tem conta?'
      q('[data-switch]').textContent = mode === 'signup' ? 'Entrar' : 'Criar conta'
      clearMsgs(passForm)
    }
    q('[data-switch]').addEventListener('click', function () {
      setMode(mode === 'signup' ? 'signin' : 'signup')
      var f = mode === 'signup' ? q('#st-login-name') : q('#st-login-email')
      try { f.focus() } catch (_) { /* ignore */ }
    })
    passForm.addEventListener('submit', async function (e) {
      e.preventDefault()
      clearMsgs(passForm)
      var emailEl = q('#st-login-email')
      var passEl = q('#st-login-pass')
      var email = String(emailEl.value || '').trim().toLowerCase()
      var pass = String(passEl.value || '')
      if (!EMAIL_RE.test(email)) return showErr(passForm, 'Digite um e-mail válido.', emailEl)
      if (!pass) return showErr(passForm, 'Digite sua senha.', passEl)
      if (mode === 'signup' && pass.length < 8) return showErr(passForm, 'A senha precisa ter pelo menos 8 caracteres.', passEl)
      busy(passForm, true)
      try {
        var c = await getClient()
        if (mode === 'signup') {
          var name = String(q('#st-login-name').value || '').replace(/\s+/g, ' ').trim().slice(0, 80)
          var r = await c.auth.signUp({
            email: email,
            password: pass,
            options: { data: name ? { full_name: name } : {}, emailRedirectTo: redirectUrl() },
          })
          if (r.error) throw r.error
          if (r.data && r.data.session) {
            setSession(r.data.session)
            onSuccess(r.data.user || r.data.session.user)
            return
          }
          // Supabase devolve usuario sem identidades quando o e-mail ja existe
          if (r.data && r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0) {
            throw new Error('User already registered')
          }
          showNotice(passForm, 'Conta criada. Abra o e-mail que enviamos e confirme para entrar. Se preferir, use a aba "Código por e-mail".')
        } else {
          var r2 = await c.auth.signInWithPassword({ email: email, password: pass })
          if (r2.error) throw r2.error
          setSession(r2.data.session)
          onSuccess(r2.data.user || (r2.data.session && r2.data.session.user))
        }
      } catch (err) {
        showErr(passForm, authMsg(err))
      } finally {
        busy(passForm, false)
      }
    })

    // Codigo por e-mail
    var emailForm = q('[data-form="code-email"]')
    var verifyForm = q('[data-form="code-verify"]')
    var codeEmail = ''
    var resendLeft = 0
    var resendTimer = null
    var resendBtn = q('[data-resend]')
    function tickResend() {
      if (!root.isConnected) { clearInterval(resendTimer); resendTimer = null; return }
      resendLeft = Math.max(0, resendLeft - 1)
      resendBtn.textContent = resendLeft > 0 ? 'Reenviar em ' + resendLeft + 's' : 'Reenviar código'
      resendBtn.disabled = resendLeft > 0
      if (!resendLeft) { clearInterval(resendTimer); resendTimer = null }
    }
    function startResend(sec) {
      resendLeft = sec + 1
      if (resendTimer) clearInterval(resendTimer)
      resendTimer = setInterval(tickResend, 1000)
      tickResend()
    }
    async function sendCode() {
      var c = await getClient()
      var r = await c.auth.signInWithOtp({ email: codeEmail, options: { shouldCreateUser: true, emailRedirectTo: redirectUrl() } })
      if (r.error) throw r.error
    }
    emailForm.addEventListener('submit', async function (e) {
      e.preventDefault()
      clearMsgs(emailForm)
      var el = q('#st-code-email')
      var email = String(el.value || '').trim().toLowerCase()
      if (!EMAIL_RE.test(email)) return showErr(emailForm, 'Digite um e-mail válido.', el)
      busy(emailForm, true, 'Enviando…')
      try {
        codeEmail = email
        await sendCode()
        emailForm.hidden = true
        verifyForm.hidden = false
        clearMsgs(verifyForm)
        q('[data-sent-to]').textContent = 'Enviamos um código para ' + email + '. Digite abaixo. Se não chegar em 1 minuto, confira o spam.'
        q('#st-code-token').value = ''
        startResend(45)
        setTimeout(function () { try { q('#st-code-token').focus() } catch (_) { /* ignore */ } }, 0)
      } catch (err) {
        showErr(emailForm, authMsg(err))
      } finally {
        busy(emailForm, false)
      }
    })
    q('#st-code-token').addEventListener('input', function (e) {
      var v = String(e.target.value || '').replace(/\D/g, '').slice(0, 10)
      if (v !== e.target.value) e.target.value = v
    })
    verifyForm.addEventListener('submit', async function (e) {
      e.preventDefault()
      clearMsgs(verifyForm)
      var el = q('#st-code-token')
      var digits = String(el.value || '').replace(/\D/g, '')
      if (digits.length < 6 || digits.length > 10) return showErr(verifyForm, 'Digite o código de 6 dígitos que chegou no e-mail.', el)
      busy(verifyForm, true, 'Conferindo…')
      try {
        var c = await getClient()
        var r = await c.auth.verifyOtp({ email: codeEmail, token: digits, type: 'email' })
        if (r.error) throw r.error
        setSession(r.data.session)
        onSuccess(r.data.user || (r.data.session && r.data.session.user))
      } catch (err) {
        showErr(verifyForm, authMsg(err), el)
      } finally {
        busy(verifyForm, false)
      }
    })
    resendBtn.addEventListener('click', async function () {
      if (resendLeft > 0 || !codeEmail) return
      clearMsgs(verifyForm)
      resendBtn.disabled = true
      try {
        await sendCode()
        showNotice(verifyForm, 'Mandamos um código novo.')
        startResend(45)
      } catch (err) {
        resendBtn.disabled = false
        showErr(verifyForm, authMsg(err))
      }
    })
    q('[data-back]').addEventListener('click', function () {
      verifyForm.hidden = true
      emailForm.hidden = false
      if (resendTimer) { clearInterval(resendTimer); resendTimer = null }
      try { q('#st-code-email').focus() } catch (_) { /* ignore */ }
    })
  }

  function openLogin(opts) {
    return new Promise(function (resolve) {
      var done = false
      var m = modal({
        title: 'Entrar na sua conta',
        html: loginHtml(opts.reason),
        initialFocus: '#st-login-email',
        onClose: function () {
          if (!done) { done = true; resolve(currentUser || null) }
        },
      })
      wireLogin(m, function (user) {
        if (done) return
        done = true
        resolve(user || currentUser || null)
        m.close()
        toast('Pronto, você entrou.', 'ok')
      })
    })
  }
  var loginPromise = null
  /** Abre o login (se ainda nao entrou). Resolve com o usuario ou null se fechar. */
  function login(opts) {
    opts = opts || {}
    if (loginPromise) return loginPromise
    var p = ready.then(function () {
      if (currentUser) return currentUser
      return openLogin(opts)
    })
    loginPromise = p
    p.then(function () { if (loginPromise === p) loginPromise = null })
    return p
  }

  // ───────────────────────────────────────────────────────────────────────
  // API (mesma origem; Bearer quando houver sessao)
  // ───────────────────────────────────────────────────────────────────────
  async function api(path, opts) {
    opts = opts || {}
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.charAt(1) === '\\') {
      throw new Error('Endereço inválido.')
    }
    var method = String(opts.method || 'GET').toUpperCase()
    var auth = opts.auth !== false
    var headers = { Accept: 'application/json' }
    var init = { method: method, headers: headers, credentials: 'same-origin' }
    if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }
    if (auth) {
      var token = await freshToken()
      if (token) headers.Authorization = 'Bearer ' + token
    }
    var r
    try {
      r = await fetch(path, init)
    } catch (_) {
      var ne = new Error('Sem conexão. Confira a internet e tente de novo.')
      ne.status = 0
      throw ne
    }
    var d = null
    try { d = await r.json() } catch (_) { d = null }
    if (!r.ok) {
      if (r.status === 401 && auth && !opts._retried) {
        var u = await login({ reason: (d && d.error) || 'Entre na sua conta para continuar.' })
        if (u) return api(path, Object.assign({}, opts, { _retried: true }))
      }
      var err = new Error((d && d.error) || (r.status === 429 ? 'Muitas tentativas. Espere um pouco e tente de novo.' : 'Algo deu errado (' + r.status + '). Tente de novo.'))
      err.status = r.status
      err.data = d
      throw err
    }
    return d || {}
  }

  // ───────────────────────────────────────────────────────────────────────
  // Entrega (estado/CEP salvos)
  // ───────────────────────────────────────────────────────────────────────
  function normState(s) {
    var v = String(s == null ? '' : s).trim().toUpperCase()
    return Object.prototype.hasOwnProperty.call(STATE_NAMES, v) ? v : ''
  }
  function normZip(z) {
    var m = /^(\d{5})(?:-?\d{4})?$/.exec(String(z == null ? '' : z).trim())
    return m ? m[1] : ''
  }
  var shipTo = {
    get: function () {
      var v = parseJson(lsGet(SHIPTO_KEY)) || {}
      return { state: normState(v.state), zip: normZip(v.zip) }
    },
    set: function (v) {
      v = v || {}
      var out = { state: normState(v.state), zip: normZip(v.zip) }
      if (!out.state && !out.zip) lsDel(SHIPTO_KEY)
      else lsSet(SHIPTO_KEY, JSON.stringify(out))
      try { window.dispatchEvent(new CustomEvent('bc-store-shipto', { detail: out })) } catch (_) { /* ignore */ }
      return out
    },
  }

  // ───────────────────────────────────────────────────────────────────────
  // Carrinho
  // ───────────────────────────────────────────────────────────────────────
  function readCart() {
    var arr = parseJson(lsGet(CART_KEY))
    if (!Array.isArray(arr)) return []
    var seen = {}
    var out = []
    for (var i = 0; i < arr.length && out.length < MAX_CART_LINES; i++) {
      var it = arr[i]
      if (!it || typeof it.product_id !== 'string' || !UUID_RE.test(it.product_id) || seen[it.product_id]) continue
      var qty = toInt(it.qty)
      if (!(qty >= 1)) continue
      seen[it.product_id] = true
      out.push({
        product_id: it.product_id,
        qty: Math.min(qty, MAX_QTY),
        slug: clip(it.slug, 100),
        title: clip(it.title, 120),
        image: safeUrl(it.image),
        price_cents: Math.max(0, Math.round(Number(it.price_cents) || 0)),
        seller_id: clip(it.seller_id, 36),
        seller_name: clip(it.seller_name, 60),
      })
    }
    return out
  }
  function cartCount() {
    return readCart().reduce(function (s, it) { return s + it.qty }, 0)
  }
  function emitCart() {
    renderCartCount()
    try { window.dispatchEvent(new CustomEvent('bc-store-cart', { detail: { count: cartCount(), items: readCart() } })) } catch (_) { /* ignore */ }
  }
  function writeCart(items) {
    if (!lsSet(CART_KEY, JSON.stringify(items))) {
      toast('Seu navegador não deixou salvar o carrinho. Saia do modo anônimo ou libere o armazenamento do site.', 'err')
    }
    emitCart()
  }
  var cart = {
    get: function () { return readCart() },
    add: function (product, qty) {
      if (!product || typeof product.id !== 'string' || !UUID_RE.test(product.id)) return false
      var n = toInt(qty)
      if (!(n >= 1)) n = 1
      n = Math.min(n, MAX_QTY)
      var limit = MAX_QTY
      if (product.stock != null && isFinite(Number(product.stock))) limit = Math.max(0, Math.min(MAX_QTY, Math.floor(Number(product.stock))))
      if (product.in_stock === false || limit === 0) { toast('Esse produto está esgotado.', 'err'); return false }
      var items = readCart()
      var seller = product.seller || {}
      var snap = {
        slug: clip(product.slug, 100),
        title: clip(product.title, 120),
        image: safeUrl((product.images || [])[0]),
        price_cents: Math.max(0, Math.round(Number(product.price_cents) || 0)),
        seller_id: clip(seller.id, 36),
        seller_name: clip(seller.name, 60),
      }
      var found = null
      for (var i = 0; i < items.length; i++) if (items[i].product_id === product.id) { found = items[i]; break }
      if (found) {
        var want = found.qty + n
        found.qty = Math.min(limit, want)
        Object.keys(snap).forEach(function (k) { if (snap[k] || snap[k] === 0) found[k] = snap[k] })
        if (want > limit) toast('Só há ' + limit + (limit === 1 ? ' unidade disponível.' : ' unidades disponíveis.'), 'err')
      } else {
        if (items.length >= MAX_CART_LINES) { toast('O carrinho aceita até ' + MAX_CART_LINES + ' produtos diferentes.', 'err'); return false }
        if (n > limit) toast('Só há ' + limit + (limit === 1 ? ' unidade disponível.' : ' unidades disponíveis.'), 'err')
        items.push(Object.assign({ product_id: product.id, qty: Math.min(limit, n) }, snap))
      }
      writeCart(items)
      return true
    },
    set: function (productId, qty) {
      var n = toInt(qty)
      if (isNaN(n)) return
      var items = readCart()
      var next = []
      items.forEach(function (it) {
        if (it.product_id !== productId) { next.push(it); return }
        if (n >= 1) { it.qty = Math.min(n, MAX_QTY); next.push(it) }
      })
      writeCart(next)
    },
    remove: function (productId) {
      writeCart(readCart().filter(function (it) { return it.product_id !== productId }))
    },
    clear: function () {
      lsDel(CART_KEY)
      emitCart()
    },
    count: cartCount,
  }
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY || e.key === null) emitCart()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Upload de imagem (comprime no navegador e envia a /api/upload)
  // ───────────────────────────────────────────────────────────────────────
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file)
      var img = new Image()
      img.onload = function () { URL.revokeObjectURL(url); resolve(img) }
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Não deu para abrir essa imagem. Use uma foto JPG, PNG ou WebP.')) }
      img.src = url
    })
  }
  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { resolve(b) }, 'image/jpeg', quality)
      } else {
        var data = canvas.toDataURL('image/jpeg', quality)
        var bin = atob(data.split(',')[1])
        var arr = new Uint8Array(bin.length)
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        resolve(new Blob([arr], { type: 'image/jpeg' }))
      }
    })
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader()
      fr.onload = function () { resolve(String(fr.result)) }
      fr.onerror = function () { reject(new Error('Não deu para preparar a foto.')) }
      fr.readAsDataURL(blob)
    })
  }
  async function compressImage(file) {
    if (!file || (file.type && !/^image\//i.test(file.type))) throw new Error('Escolha uma imagem (JPG, PNG ou WebP).')
    if (file.size > 25 * 1024 * 1024) throw new Error('Imagem muito grande. Use uma foto com menos de 25 MB.')
    var img = await loadImage(file)
    var w0 = img.naturalWidth || img.width
    var h0 = img.naturalHeight || img.height
    if (!w0 || !h0) throw new Error('Não deu para ler essa imagem.')
    var maxDim = UPLOAD_MAX_DIM
    var quality = 0.86
    for (var attempt = 0; attempt < 14; attempt++) {
      var scale = Math.min(1, maxDim / Math.max(w0, h0))
      var w = Math.max(1, Math.round(w0 * scale))
      var h = Math.max(1, Math.round(h0 * scale))
      var canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      var ctx = canvas.getContext('2d')
      ctx.fillStyle = '#FFFFFF' // fundo branco: PNG transparente nao vira preto no JPEG
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      var blob = await canvasToBlob(canvas, quality)
      if (blob && blob.size < UPLOAD_MAX_BYTES) return blobToDataUrl(blob)
      if (quality > 0.5) quality = Math.round((quality - 0.08) * 100) / 100
      else { maxDim = Math.round(maxDim * 0.85); quality = 0.8 }
    }
    throw new Error('Não deu para reduzir essa foto. Tente outra imagem.')
  }
  async function uploadImage(file) {
    var dataUrl = await compressImage(file)
    var d = await api('/api/upload', { method: 'POST', body: { file_data: dataUrl, folder: 'store' } })
    var url = safeUrl(d && d.url)
    if (!url) throw new Error('O envio da foto falhou. Tente de novo.')
    return url
  }

  // ───────────────────────────────────────────────────────────────────────
  // Card de produto
  // ───────────────────────────────────────────────────────────────────────
  function productCard(p, opts) {
    if (!p) return ''
    opts = opts || {}
    var showSeller = opts.showSeller !== false
    var img = safeUrl((p.images || [])[0])
    var href = '/store/p/' + encodeURIComponent(p.slug || '')
    var price = Number(p.price_cents) || 0
    var compare = Number(p.compare_at_cents) || 0
    var soldOut = p.in_stock === false
    return '<a class="st-card' + (soldOut ? ' is-soldout' : '') + '" href="' + esc(href) + '">' +
      '<div class="st-card-media">' +
        (img
          ? '<img src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async" width="600" height="600">'
          : '<span class="st-card-noimg" aria-hidden="true"></span>') +
        (soldOut ? '<span class="st-badge st-badge-muted st-card-flag">Esgotado</span>' : '') +
      '</div>' +
      '<div class="st-card-body">' +
        '<h3 class="st-card-title">' + esc(p.title) + '</h3>' +
        '<div class="st-price-row"><span class="st-price">' + money(price) + '</span>' +
          (compare > price ? '<s class="st-price-old"><span class="st-sr">Preço anterior: </span>' + money(compare) + '</s>' : '') +
        '</div>' +
        (showSeller && p.seller && p.seller.name ? '<div class="st-card-seller">' + esc(p.seller.name) + '</div>' : '') +
        (Number(p.rating_count) > 0 ? stars(p.rating_avg, p.rating_count) : '') +
      '</div>' +
    '</a>'
  }

  // ───────────────────────────────────────────────────────────────────────
  // Previa e configuracao
  // ───────────────────────────────────────────────────────────────────────
  function isPreview() {
    try {
      var p = new URLSearchParams(window.location.search).get('preview')
      if (p === 'off') { lsDel(PREVIEW_KEY); return false }
      if (p === PREVIEW_TOKEN) { lsSet(PREVIEW_KEY, '1'); return true }
    } catch (_) { /* ignore */ }
    return lsGet(PREVIEW_KEY) === '1'
  }
  var configPromise = null
  function config() {
    if (!configPromise) {
      configPromise = api('/api/store/catalog?action=config', { auth: false })
        .then(function (d) { return (d && d.config) || {} })
        .catch(function (e) { configPromise = null; throw e })
    }
    return configPromise
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cabecalho: contador do carrinho e conta
  // ───────────────────────────────────────────────────────────────────────
  var ICON_USER = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
  var menuSeq = 0

  function renderCartCount() {
    var n = cartCount()
    document.querySelectorAll('[data-st-cart-count]').forEach(function (el) {
      el.textContent = n > 99 ? '99+' : String(n)
      el.hidden = n === 0
      var link = el.closest('.st-nav-cart')
      if (link) link.setAttribute('aria-label', n ? 'Carrinho, ' + n + (n === 1 ? ' item' : ' itens') : 'Carrinho')
    })
  }

  function closeMenus(except) {
    document.querySelectorAll('[data-st-account] .st-account-menu').forEach(function (menu) {
      if (menu === except || menu.hidden) return
      menu.hidden = true
      var btn = menu.parentNode && menu.parentNode.querySelector('[data-st-menu-btn]')
      if (btn) btn.setAttribute('aria-expanded', 'false')
    })
  }

  function renderAccount() {
    if (!document.body) return
    document.querySelectorAll('[data-st-account]').forEach(function (slot) {
      if (!isReady) return
      var key = currentUser ? 'u:' + currentUser.id : 'anon'
      if (slot.getAttribute('data-st-state') === key) return
      slot.setAttribute('data-st-state', key)
      if (!currentUser) {
        slot.innerHTML = '<button type="button" class="st-nav-account-btn" data-st-login>' + ICON_USER + '<span class="st-nav-account-label">Entrar</span></button>'
        return
      }
      var id = 'st-account-menu-' + (++menuSeq)
      slot.innerHTML =
        '<button type="button" class="st-nav-account-btn" data-st-menu-btn aria-expanded="false" aria-controls="' + id + '">' + ICON_USER + '<span class="st-nav-account-label">Minha conta</span></button>' +
        '<div class="st-account-menu" id="' + id + '" hidden>' +
          '<div class="st-account-email">' + esc(currentUser.email || '') + '</div>' +
          '<a href="/store/pedidos">Meus pedidos</a>' +
          '<a href="/store/painel">Minha loja</a>' +
          '<button type="button" data-st-logout>Sair</button>' +
        '</div>'
    })
  }

  function onHeaderClick(e) {
    var t = e.target
    if (!t || !t.closest) return
    var loginBtn = t.closest('[data-st-account] [data-st-login]')
    if (loginBtn) { e.preventDefault(); login(); return }
    var menuBtn = t.closest('[data-st-account] [data-st-menu-btn]')
    if (menuBtn) {
      e.preventDefault()
      var menu = menuBtn.parentNode.querySelector('.st-account-menu')
      var open = menu.hidden
      closeMenus(menu)
      menu.hidden = !open
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
      if (open) { var first = menu.querySelector('a, button'); if (first) first.focus() }
      return
    }
    var out = t.closest('[data-st-account] [data-st-logout]')
    if (out) {
      e.preventDefault()
      closeMenus()
      logout().then(function () { toast('Você saiu da conta.', 'ok') })
      return
    }
    if (!t.closest('[data-st-account]')) closeMenus()
  }
  function onHeaderKey(e) {
    if (e.key !== 'Escape') return
    var open = document.querySelector('[data-st-account] .st-account-menu:not([hidden])')
    if (!open) return
    closeMenus()
    var btn = open.parentNode.querySelector('[data-st-menu-btn]')
    if (btn) btn.focus()
  }

  function initHeader() {
    renderCartCount()
    renderAccount()
    document.addEventListener('click', onHeaderClick)
    document.addEventListener('keydown', onHeaderKey)
  }

  // ───────────────────────────────────────────────────────────────────────
  // API publica
  // ───────────────────────────────────────────────────────────────────────
  window.BCStore = {
    ready: ready,
    user: function () { return currentUser },
    session: function () { return session },
    onAuth: onAuth,
    login: login,
    logout: logout,
    api: api,
    esc: esc,
    safeUrl: safeUrl,
    money: money,
    fmtDate: fmtDate,
    stars: stars,
    toast: toast,
    states: STATES,
    labels: LABELS,
    shipTo: shipTo,
    cart: cart,
    uploadImage: uploadImage,
    productCard: productCard,
    isPreview: isPreview,
    config: config,
    // Extra (fora do contrato da secao 7): modal acessivel reutilizavel
    modal: modal,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHeader)
  else initHeader()
  boot()
})()
