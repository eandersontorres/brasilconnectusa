/**
 * Plano do negocio no diretorio (aba "Meu Negócio" do /assinante).
 *
 * Uso:  BCPlanoNegocio.mount(container, biz, moduleKey)
 * Depende de window.bcFetch (fetch com o token da sessao) e window.showToast.
 *
 * Os precos e limites espelham api/_lib/listingPlans.js (o servidor e quem decide).
 */
(function () {
  'use strict'

  var PLANS = {
    restaurant: { label: 'Restaurante', free: 'Cardápio com até 20 itens', freeItems: 20, pro: 29, premium: 79 },
    grocery:    { label: 'Mercado',     free: 'Catálogo com até 30 produtos', freeItems: 30, pro: 29, premium: 79 },
    retail:     { label: 'Loja',        free: 'Catálogo com até 20 produtos', freeItems: 20, pro: 29, premium: 79 },
    showcase:   { label: 'Divulgação',  free: 'Capa e descrição', freeItems: null, pro: 9, premium: 29 },
  }
  var INCLUDES = {
    orders: {
      pro: ['Itens ilimitados', 'Pedidos online com pagamento', 'Sem comissão por pedido'],
      premium: ['Tudo do Pro', 'Destaque na busca', 'Selo de verificado, depois da conferência'],
    },
    showcase: {
      pro: ['Logo, galeria e vídeo no perfil', 'Instagram e Facebook', 'Descrição completa'],
      premium: ['Tudo do Pro', 'Destaque no topo da categoria', 'Selo de verificado, depois da conferência'],
    },
  }
  var LIVE = ['active', 'trialing', 'past_due']
  var DEAD = ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']

  var el, biz, mod

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]
    })
  }
  function toast(msg, isError) { if (typeof window.showToast === 'function') window.showToast(msg, isError) }

  function currentPlan() {
    var p = String(biz.listing_plan || biz.plan || 'free').toLowerCase()
    if (p !== 'pro' && p !== 'premium') return 'free'
    if (biz.stripe_subscription_id && DEAD.indexOf(biz.listing_plan_status) !== -1) return 'free'
    return p
  }
  function hasSub() { return !!biz.stripe_subscription_id && LIVE.indexOf(biz.listing_plan_status) !== -1 }

  function injectStyles() {
    if (document.getElementById('pn-styles')) return
    var s = document.createElement('style')
    s.id = 'pn-styles'
    s.textContent = [
      '.pn{border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:18px;background:var(--paper)}',
      '.pn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}',
      '.pn-title{font-family:var(--font-display);font-weight:700;font-size:17px;letter-spacing:-.02em;color:var(--ink)}',
      '.pn-sub{font-size:13px;color:var(--ink-muted);margin-top:3px;line-height:1.5}',
      '.pn-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}',
      '.pn-opt{background:var(--paper-elevated);border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.pn-opt.on{border-color:var(--green-deep);box-shadow:inset 0 0 0 1px var(--green-deep)}',
      '.pn-name{font-weight:700;font-size:15px;color:var(--ink)}',
      '.pn-price{font-family:var(--font-display);font-weight:700;font-size:24px;letter-spacing:-.03em;color:var(--ink)}',
      '.pn-price small{font-size:13px;font-weight:500;color:var(--ink-muted);letter-spacing:0}',
      '.pn-opt ul{list-style:none;margin:0;padding:0;display:grid;gap:5px;flex:1}',
      '.pn-opt li{font-size:13px;color:var(--ink-soft);line-height:1.45;padding-left:16px;position:relative}',
      '.pn-opt li::before{content:"";position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:50%;background:var(--green-deep)}',
      '.pn-btn{font-family:var(--font-sans);font-size:13px;font-weight:600;padding:10px 14px;border-radius:8px;border:1px solid var(--green-deep);background:var(--green-deep);color:#fff;cursor:pointer}',
      '.pn-btn:hover{background:var(--green-deep-hover)}',
      '.pn-btn.ghost{background:transparent;color:var(--ink);border-color:var(--line-strong)}',
      '.pn-btn.ghost:hover{border-color:var(--green-deep);background:transparent}',
      '.pn-btn:disabled{opacity:.55;cursor:default}',
      '.pn-btn:focus-visible{outline:2px solid var(--green-deep);outline-offset:2px}',
      '.pn-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:var(--green-soft);color:var(--green-deep)}',
      '.pn-warn{background:var(--gold-soft);border-left:3px solid var(--accent);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--ink-soft);margin-top:12px;line-height:1.5}',
      '@media(max-width:640px){.pn-grid{grid-template-columns:1fr}}',
    ].join('\n')
    document.head.appendChild(s)
  }

  function render() {
    if (mod === 'agenda_pro') {
      el.innerHTML = '<div class="pn"><div class="pn-title">Plano</div>' +
        '<div class="pn-sub">O plano do AgendaPro (Starter, Pro ou Premium) é assinado na aba <strong>Profissional</strong>.</div></div>'
      return
    }
    var cfg = PLANS[mod]
    if (!cfg) { el.innerHTML = ''; return }

    var cur = currentPlan()
    var sub = hasSub()
    var inc = INCLUDES[mod === 'showcase' ? 'showcase' : 'orders']
    var status = biz.listing_plan_status === 'past_due'
      ? '<div class="pn-warn">O último pagamento não passou. Atualize o cartão em “Gerenciar cobrança” pra não perder o plano.</div>'
      : ''

    function option(plan, name) {
      var on = cur === plan
      var label = on ? 'Plano atual'
        : sub ? 'Trocar para ' + name
        : 'Assinar ' + name
      return '<div class="pn-opt' + (on ? ' on' : '') + '">' +
        '<div class="pn-name">' + name + (on ? ' <span class="pn-tag">Atual</span>' : '') + '</div>' +
        '<div class="pn-price">$' + cfg[plan] + '<small> / mês</small></div>' +
        '<ul>' + inc[plan].map(function (t) { return '<li>' + esc(t) + '</li>' }).join('') + '</ul>' +
        '<button class="pn-btn' + (on ? ' ghost' : '') + '" data-plan="' + plan + '"' + (on ? ' disabled' : '') + '>' + label + '</button></div>'
    }

    el.innerHTML = '<div class="pn"><div class="pn-head"><div>' +
      '<div class="pn-title">Plano ' + (cur === 'free' ? 'Grátis' : cur === 'pro' ? 'Pro' : 'Premium') + '</div>' +
      '<div class="pn-sub">' + (cur === 'free'
        ? 'Incluído: perfil no diretório, telefone e WhatsApp. ' + esc(cfg.free) + '.'
        : 'Cobrança mensal, sem fidelidade. Cancele quando quiser.') + '</div></div>' +
      (biz.stripe_customer_id ? '<button class="pn-btn ghost" data-act="portal">Gerenciar cobrança</button>' : '') +
      '</div>' + status +
      '<div class="pn-grid">' + option('pro', 'Pro') + option('premium', 'Premium') + '</div></div>'
  }

  async function call(body) {
    var r = await window.bcFetch('/api/stripe/listing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ business_id: biz.id }, body)),
    })
    var d = await r.json().catch(function () { return {} })
    return { ok: r.ok, status: r.status, data: d }
  }

  async function onClick(e) {
    var b = e.target.closest('button')
    if (!b || !el.contains(b) || b.disabled) return
    var old = b.textContent
    b.disabled = true
    try {
      if (b.dataset.act === 'portal') {
        var p = await call({ action: 'portal' })
        if (!p.ok) throw new Error(p.data.error || 'Não deu pra abrir a cobrança.')
        location.href = p.data.portal_url
        return
      }
      var plan = b.dataset.plan
      if (!plan) { b.disabled = false; return }

      if (hasSub()) {
        // Pergunta o preco pro servidor e confirma antes de cobrar
        var ask = await call({ action: 'change', plan: plan })
        if (ask.status !== 409 || !ask.data.needs_confirm) throw new Error(ask.data.error || 'Não deu pra trocar o plano.')
        if (!confirm(ask.data.error)) { b.disabled = false; return }
        b.textContent = 'Trocando…'
        var done = await call({ action: 'change', plan: plan, confirm: true })
        if (!done.ok) throw new Error(done.data.error || 'Não deu pra trocar o plano.')
        toast('Plano alterado para ' + (plan === 'pro' ? 'Pro' : 'Premium'))
        biz.listing_plan = plan
        if (typeof window.bcReloadBiz === 'function') window.bcReloadBiz()
        else render()
        return
      }

      b.textContent = 'Abrindo Stripe…'
      var s = await call({ action: 'subscribe', plan: plan })
      if (!s.ok) throw new Error(s.data.error || 'Não deu pra abrir o pagamento.')
      location.href = s.data.checkout_url
    } catch (err) {
      b.disabled = false
      b.textContent = old
      toast(err.message, true)
    }
  }

  window.BCPlanoNegocio = {
    mount: function (container, business, moduleKey) {
      if (!container || !business || !business.id) return
      injectStyles()
      el = container
      biz = business
      mod = String(moduleKey || business.module || '')
      el.addEventListener('click', onClick)
      render()
    },
  }
})()
