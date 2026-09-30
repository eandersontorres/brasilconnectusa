/**
 * Login do painel admin com conta Supabase (código por e-mail).
 *
 * Carregado no <head> das páginas /admin/* ANTES do script da página.
 * - Se houver sessão Supabase salva, marca sessionStorage.bc_admin_secret = '__jwt__'
 *   pra página abrir direto (o getSecret() delas continua funcionando).
 * - Troca o header x-admin-secret por Authorization: Bearer <token> nas chamadas /api/*.
 * - Injeta o formulário "entrar com e-mail" abaixo do campo de senha das telas de login.
 * A senha compartilhada (ADMIN_SECRET) continua aceita durante a transição.
 */
(function () {
  'use strict';

  var REF = 'ggwppcbdnemjuddnzbdw';
  var SUPA_URL = 'https://' + REF + '.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnd3BwY2JkbmVtanVkZG56YmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MzI3MDgsImV4cCI6MjA5MzAwODcwOH0.-oeVAtpfqUJiHSUMErBEnfvGX_waABpNgaIh-UPJdlY';
  var SESSION_KEY = 'sb-' + REF + '-auth-token';
  var SECRET_KEY = 'bc_admin_secret';
  var MARK = '__jwt__';

  function ss(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  function storedSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.access_token ? s : null;
    } catch (e) { return null; }
  }

  // Estado inicial, síncrono, pra página decidir se mostra login
  var s0 = storedSession();
  var cur = ss(SECRET_KEY);
  if (s0 && (!cur || cur === MARK)) ssSet(SECRET_KEY, MARK);
  else if (!s0 && cur === MARK) ssDel(SECRET_KEY);

  var clientP = import('https://esm.sh/@supabase/supabase-js@2').then(function (m) {
    return m.createClient(SUPA_URL, SUPA_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage },
    });
  });
  clientP.catch(function (e) { console.error('[admin-auth] supabase não carregou:', e); });

  async function token() {
    try {
      var c = await clientP;
      var r = await c.auth.getSession();
      return r.data && r.data.session ? r.data.session.access_token : null;
    } catch (e) {
      var s = storedSession();
      return s ? s.access_token : null;
    }
  }

  async function email() {
    try {
      var c = await clientP;
      var r = await c.auth.getSession();
      return r.data && r.data.session ? r.data.session.user.email : null;
    } catch (e) { return null; }
  }

  // ── Troca x-admin-secret pelo token da sessão ──────────────────────
  var _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isApi = url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0;
    var usedMark = false;
    if (isApi) {
      try {
        var h = new Headers((init && init.headers) || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
        var sec = h.get('x-admin-secret');
        if (sec === MARK || (!sec && ss(SECRET_KEY) === MARK)) {
          usedMark = true;
          var t = await token();
          h.delete('x-admin-secret');
          if (t) h.set('Authorization', 'Bearer ' + t);
          init = Object.assign({}, init || {}, { headers: h });
        }
      } catch (e) {}
    }
    var res = await _fetch(input, init);
    // Sessão morreu: volta pra tela de login
    if (usedMark && res.status === 401) {
      ssDel(SECRET_KEY);
      try { (await clientP).auth.signOut(); } catch (e) {}
      setTimeout(function () { location.reload(); }, 300);
    }
    return res;
  };

  window.bcAdminLogout = async function () {
    ssDel(SECRET_KEY);
    try { (await clientP).auth.signOut(); } catch (e) {}
  };

  // ── Formulário "entrar com e-mail" nas telas de login ──────────────
  var pending = '';

  function inject(secretInput) {
    if (document.getElementById('bc-admin-email-login')) return;
    var host = secretInput.parentNode;
    var box = document.createElement('div');
    box.id = 'bc-admin-email-login';
    box.style.cssText = 'margin-top:18px;padding-top:16px;border-top:1px solid rgba(0,0,0,.1);text-align:left;';
    box.innerHTML =
      '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B6E68;margin-bottom:8px;">Ou entre com sua conta</div>' +
      '<div id="bc-al-step1" style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<input id="bc-al-email" type="email" placeholder="seu e-mail de administrador" autocomplete="email" style="flex:1;min-width:200px;padding:10px 12px;border:1px solid #D9D3C4;border-radius:8px;font:inherit;font-size:14px;" />' +
      '<button type="button" id="bc-al-send" style="padding:10px 16px;border-radius:8px;border:1px solid #1F4D3F;background:#1F4D3F;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;">Enviar código</button>' +
      '</div>' +
      '<div id="bc-al-step2" style="display:none;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
      '<input id="bc-al-code" inputmode="numeric" placeholder="código de 6 dígitos" autocomplete="one-time-code" style="flex:1;min-width:160px;padding:10px 12px;border:1px solid #D9D3C4;border-radius:8px;font:inherit;font-size:14px;letter-spacing:.2em;" />' +
      '<button type="button" id="bc-al-verify" style="padding:10px 16px;border-radius:8px;border:1px solid #1F4D3F;background:#1F4D3F;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;">Entrar</button>' +
      '</div>' +
      '<div id="bc-al-msg" style="font-size:13px;color:#6B6E68;margin-top:8px;min-height:18px;"></div>';
    host.appendChild(box);

    var msg = box.querySelector('#bc-al-msg');
    function say(t, bad) { msg.textContent = t; msg.style.color = bad ? '#B91C1C' : '#6B6E68'; }

    box.querySelector('#bc-al-send').onclick = async function () {
      var em = box.querySelector('#bc-al-email').value.trim().toLowerCase();
      if (!em) return;
      this.disabled = true;
      try {
        var c = await clientP;
        var r = await c.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false } });
        if (r.error) throw r.error;
        pending = em;
        box.querySelector('#bc-al-step2').style.display = 'flex';
        say('Código enviado pra ' + em + '. Vale por alguns minutos.');
        setTimeout(function () { box.querySelector('#bc-al-code').focus(); }, 50);
      } catch (e) {
        say(e.message || 'Não deu pra enviar o código.', true);
      }
      this.disabled = false;
    };

    async function verify() {
      var code = box.querySelector('#bc-al-code').value.replace(/\D/g, '');
      if (!pending || code.length < 6) return;
      say('Conferindo…');
      try {
        var c = await clientP;
        var r = await c.auth.verifyOtp({ email: pending, token: code, type: 'email' });
        if (r.error) throw r.error;
        ssSet(SECRET_KEY, MARK);
        var chk = await fetch('/api/admin/usage', { headers: { 'x-admin-secret': MARK } });
        if (chk.status === 403) {
          await window.bcAdminLogout();
          say('Essa conta entrou, mas não é de administrador.', true);
          return;
        }
        if (!chk.ok && chk.status !== 500) throw new Error('Não deu pra confirmar o acesso (' + chk.status + ').');
        location.reload();
      } catch (e) {
        say(e.message || 'Código inválido.', true);
      }
    }
    box.querySelector('#bc-al-verify').onclick = verify;
    box.querySelector('#bc-al-code').onkeydown = function (e) { if (e.key === 'Enter') verify(); };
    box.querySelector('#bc-al-email').onkeydown = function (e) { if (e.key === 'Enter') box.querySelector('#bc-al-send').click(); };
  }

  function scan() {
    var el = document.getElementById('secret');
    if (el) inject(el);
  }
  function watch() {
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch);

  window.bcAdminAuth = { token: token, email: email, logout: window.bcAdminLogout };
})();
