/**
 * BrasilConnect USA — site-wide tracking helper
 *
 * Carregado em todas as páginas estáticas. Encaminha eventos custom
 * para GA4 e Meta Pixel + Supabase via /api/track.
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
