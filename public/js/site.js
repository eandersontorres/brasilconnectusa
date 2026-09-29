/**
 * BrasilConnect USA — site-wide tracking helper
 *
 * Carregado em todas as páginas públicas. Cuida do consentimento de cookies e
 * encaminha eventos custom para GA4 e Meta Pixel, que só carregam depois do aceite.
 *
 * API pública:
 *   bcTrack(eventName, params)    — dispara evento custom
 *   bcAttribute(element)           — adiciona handlers a um <a>
 *
 * Auto-tracking:
 *   - Cliques em /go/* (afiliados) → click_affiliate
 *   - Cliques em [data-track="X"] → evento "X"
 *   - Forms com [data-track-submit="Y"] → evento "Y" no submit
 */
(function () {
  'use strict';

  // ── Analytics com consentimento ────────────────────────────────
  // Preencha os IDs quando as contas existirem. Com os dois vazios nada é
  // carregado, nenhum cookie de terceiro é gravado e o aviso não aparece.
  var ANALYTICS = {
    ga4: '',     // ex.: 'G-ABC123DEF4'
    pixel: '',   // ex.: '123456789012345'
  };
  var CONSENT_KEY = 'bc_consent';   // 'granted' | 'denied'
  var analyticsLoaded = false;

  function hasAnalytics() { return !!(ANALYTICS.ga4 || ANALYTICS.pixel); }
  function getConsent() {
    // Global Privacy Control do navegador vale como recusa
    if (navigator.globalPrivacyControl === true) return 'denied';
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }
  function setConsent(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {}
  }

  function loadAnalytics() {
    if (analyticsLoaded || !hasAnalytics()) return;
    analyticsLoaded = true;
    if (ANALYTICS.ga4) {
      var g = document.createElement('script');
      g.async = true;
      g.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ANALYTICS.ga4);
      document.head.appendChild(g);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', ANALYTICS.ga4, { anonymize_ip: true });
    }
    if (ANALYTICS.pixel) {
      (function (f, b, e, v, n, t, s2) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v;
        s2 = b.getElementsByTagName(e)[0]; s2.parentNode.insertBefore(t, s2);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', ANALYTICS.pixel);
      window.fbq('track', 'PageView');
    }
  }

  function closeBanner() {
    var el = document.getElementById('bc-consent');
    if (el) el.parentNode.removeChild(el);
  }

  function showBanner() {
    if (document.getElementById('bc-consent')) return;
    var el = document.createElement('div');
    el.id = 'bc-consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Preferências de cookies');
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;' +
      'background:#FAF7F0;color:#1A1F1C;border:1px solid #D9D3C4;border-radius:14px;padding:18px 20px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.18);font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;';
    var btn = 'font-family:inherit;font-size:14px;font-weight:600;padding:11px 18px;border-radius:9px;cursor:pointer;flex:1;min-width:120px;';
    el.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px;">Cookies de medição</div>' +
      '<div style="color:#4B4F4D;">Usamos cookies essenciais pra o site funcionar. Com a sua permissão, também medimos visitas ' +
      'pra melhorar a plataforma. <a href="/privacidade#cookies" style="color:#1F4D3F;">Saiba mais</a>.</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">' +
      '<button type="button" data-c="denied" style="' + btn + 'background:transparent;border:1px solid #1F4D3F;color:#1F4D3F;">Recusar</button>' +
      '<button type="button" data-c="granted" style="' + btn + 'background:#1F4D3F;border:1px solid #1F4D3F;color:#fff;">Aceitar</button>' +
      '</div>';
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-c]');
      if (!b) return;
      setConsent(b.getAttribute('data-c'));
      closeBanner();
      if (b.getAttribute('data-c') === 'granted') loadAnalytics();
    });
    document.body.appendChild(el);
  }

  function initConsent() {
    if (!hasAnalytics()) return;
    var c = getConsent();
    if (c === 'granted') loadAnalytics();
    else if (c !== 'denied') showBanner();
  }

  // Link "Preferências de cookies" (qualquer elemento com data-cookie-prefs)
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cookie-prefs]');
    if (!t) return;
    e.preventDefault();
    if (!hasAnalytics()) {
      alert('Hoje o site só usa cookies essenciais. Não há cookies de medição ou de anúncios pra configurar.');
      return;
    }
    showBanner();
  });

  window.bcConsent = { status: getConsent, open: showBanner, enabled: hasAnalytics };
  if (document.body) initConsent();
  else document.addEventListener('DOMContentLoaded', initConsent);

  function bcTrack(name, params) {
    params = params || {};
    // GA4
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', name, params);
      }
    } catch (e) {}
    // Meta Pixel
    try {
      if (typeof window.fbq === 'function') {
        window.fbq('trackCustom', name, params);
      }
    } catch (e) {}
    // Console (dev)
    if (window.__BC_DEBUG__) console.log('[bcTrack]', name, params);
  }

  // ── Auto: cliques em /go/ (afiliados) ─────────────────────────
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';

    // Afiliado interno
    if (href.indexOf('/go/') === 0 || href.indexOf('/go/') === 1) {
      var partner = href.match(/\/go\/([^?#\/]+)/);
      var campaign = (href.match(/[?&]campaign=([^&]+)/) || [])[1];
      bcTrack('click_affiliate', {
        partner: partner ? partner[1] : 'unknown',
        campaign: campaign ? decodeURIComponent(campaign) : null,
        source_page: location.pathname,
      });
    }

    // Elemento marcado com data-track
    if (a.dataset && a.dataset.track) {
      bcTrack(a.dataset.track, {
        href: href,
        source_page: location.pathname,
      });
    }
  }, true);

  // ── Auto: forms com data-track-submit ─────────────────────────
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && f.dataset && f.dataset.trackSubmit) {
      bcTrack(f.dataset.trackSubmit, { source_page: location.pathname });
    }
  }, true);

  // ── Auto: scroll depth ─────────────────────────────────────────
  // Dispara apenas uma vez por marcador (25%, 50%, 75%, 100%)
  var scrollMarks = { 25: false, 50: false, 75: false, 100: false };
  var debounceTimer;
  function checkScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return;
    var pct = Math.round((scrollTop / docHeight) * 100);
    [25, 50, 75, 100].forEach(function (mark) {
      if (pct >= mark && !scrollMarks[mark]) {
        scrollMarks[mark] = true;
        bcTrack('scroll_depth', { percent: mark, page: location.pathname });
      }
    });
  }
  window.addEventListener('scroll', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkScroll, 200);
  }, { passive: true });

  // ── Página de chegada via referral? ───────────────────────────
  try {
    var url = new URL(location.href);
    var ref = url.searchParams.get('ref');
    if (ref && /^BRA-[A-Z0-9]{5}$/.test(ref)) {
      bcTrack('referral_landing', { code: ref });
    }
  } catch (e) {}

  // Expor no window
  window.bcTrack = bcTrack;
})();
