/**
 * Painel da profissional do AgendaPro (aba "Profissional" do /assinante).
 *
 * Uso:  BCAgendaPainel.mount(container, provider)
 * Depende de window.bcFetch (fetch com o token da sessao) e window.showToast.
 *
 * Secoes: link publico · plano · sinal · servicos · horarios · turnover · agendamentos.
 * Turnover: casas de Airbnb/Vrbo/Booking sincronizadas pelo link .ics
 * (/api/agenda/ical); cada reserva vira uma limpeza no dia do checkout.
 * Os horarios dos agendamentos sao hora do relogio da profissional guardada sem
 * fuso, por isso tudo e formatado em UTC (sem conversao).
 */
(function () {
  'use strict'

  var DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  var STATUS = {
    pending: ['Aguardando sinal', '#8A5A00', '#F7EBCF'],
    confirmed: ['Confirmado', '#1F4D3F', '#E4EEE7'],
    completed: ['Concluído', '#4B4F4D', '#EDEBE4'],
    canceled: ['Cancelado', '#9F2D2D', '#F9E2DF'],
    no_show: ['Faltou', '#9F2D2D', '#F9E2DF'],
  }

  var SOURCES = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking: 'Booking', outro: 'Calendário' }

  var el, provider, state

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]
    })
  }
  function usd(cents) { return '$' + ((cents || 0) / 100).toFixed(2) }
  function toCents(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(',', '.'))
    return isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
  }
  function when(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    } catch (e) { return String(iso) }
  }
  function day(dateKey) {
    try {
      return new Date(dateKey + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' })
    } catch (e) { return String(dateKey) }
  }
  function ago(iso) {
    var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (!isFinite(min)) return ''
    if (min < 2) return 'agora há pouco'
    if (min < 60) return 'há ' + min + ' min'
    var h = Math.round(min / 60)
    if (h < 24) return 'há ' + h + 'h'
    var d = Math.round(h / 24)
    return 'há ' + d + (d === 1 ? ' dia' : ' dias')
  }
  function toast(msg, isError) {
    if (typeof window.showToast === 'function') window.showToast(msg, isError)
  }
  // Plano efetivo vem do /api/agenda/me (api/_lib/agendaPlans.js): teste vencido
  // continua 'trialing' no banco, mas nao vale. Ate o /me chegar, usa o status.
  function planOn() {
    if (state.ent) return state.ent.tier !== 'none'
    return provider.plan_status === 'trialing' || provider.plan_status === 'active'
  }

  async function api(url, opts) {
    var r = await window.bcFetch(url, opts || {})
    var d = await r.json().catch(function () { return {} })
    if (!r.ok) { var e = new Error(d.error || 'Não deu certo. Tente de novo.'); e.data = d; throw e }
    return d
  }
  function post(url, body, method) {
    return api(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  }

  // ── Estilos (prefixo ap-) ───────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ap-styles')) return
    var s = document.createElement('style')
    s.id = 'ap-styles'
    s.textContent = [
      '.ap-sec{background:var(--paper-elevated);border:1px solid var(--line);border-radius:14px;padding:26px 28px;margin-top:18px}',
      '.ap-sec h2{font-family:var(--font-display);font-size:1.3rem;font-weight:700;letter-spacing:-.02em;margin:0 0 4px;color:var(--ink)}',
      '.ap-sub{font-size:13px;color:var(--ink-muted);margin:0 0 18px;line-height:1.55}',
      '.ap-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:14px 0;border-top:1px solid var(--line);flex-wrap:wrap}',
      '.ap-row:first-of-type{border-top:0;padding-top:0}',
      '.ap-main{flex:1;min-width:200px}',
      '.ap-name{font-weight:600;font-size:15px;color:var(--ink)}',
      '.ap-meta{font-size:13px;color:var(--ink-muted);margin-top:3px;line-height:1.5;overflow-wrap:anywhere}',
      '.ap-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
      '.ap-btn{font-family:var(--font-sans);font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;border:1px solid var(--line-strong);background:transparent;color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}',
      '.ap-btn:hover{border-color:var(--green-deep)}',
      '.ap-btn.pri{background:var(--green-deep);border-color:var(--green-deep);color:#fff}',
      '.ap-btn.pri:hover{background:var(--green-deep-hover)}',
      '.ap-btn.danger{color:#9F2D2D;border-color:#E9C4C0}',
      '.ap-btn:disabled{opacity:.55;cursor:default}',
      '.ap-btn:focus-visible,.ap-sec input:focus-visible,.ap-sec select:focus-visible{outline:2px solid var(--green-deep);outline-offset:2px}',
      '.ap-pill{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px}',
      '.ap-form{display:grid;gap:12px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:14px}',
      '.ap-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '.ap-sec input,.ap-sec select,.ap-sec textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font-family:var(--font-sans);font-size:14px;color:var(--ink);background:var(--paper-elevated);box-sizing:border-box}',
      '.ap-day{display:grid;grid-template-columns:130px 1fr 1fr;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}',
      '.ap-day:first-child{border-top:0}',
      '.ap-day label{display:flex;align-items:center;gap:8px;margin:0;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:var(--ink)}',
      '.ap-day input[type=checkbox]{width:auto}',
      '.ap-link{display:flex;gap:8px;flex-wrap:wrap}',
      '.ap-link input{flex:1;min-width:200px;font-family:monospace;font-size:13px}',
      '.ap-note{background:var(--gold-soft);border-left:3px solid var(--accent);border-radius:8px;padding:12px 16px;font-size:13px;color:var(--ink-soft);line-height:1.55;margin-bottom:16px}',
      '.ap-empty{font-size:14px;color:var(--ink-muted);padding:6px 0}',
      '.ap-err{color:#9F2D2D}',
      '.ap-hot{display:inline-block;margin-top:4px;font-size:12px;font-weight:700;color:#8A5A00;background:#F7EBCF;border-radius:6px;padding:2px 8px}',
      '.ap-how{font-size:13px;color:var(--ink-soft);line-height:1.6;margin:0 0 16px}',
      '.ap-how summary{cursor:pointer;font-weight:600;color:var(--green-deep)}',
      '.ap-how ol{margin:8px 0 0;padding-left:20px}',
      '.ap-how li{margin-top:4px}',
      '@media(max-width:640px){.ap-sec{padding:22px 18px}.ap-grid{grid-template-columns:1fr}.ap-day{grid-template-columns:1fr 1fr}.ap-day label{grid-column:1/-1}}',
    ].join('\n')
    document.head.appendChild(s)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function render() {
    el.innerHTML = secLink() + secPlan() + secDeposit() + secServices() + secHours() + secTurnover() + secAppointments()
  }

  function secLink() {
    var url = location.origin + '/agenda/' + provider.slug
    return '<section class="ap-sec"><h2>Sua página de agendamento</h2>' +
      '<p class="ap-sub">É o link que você manda pra cliente ou coloca na bio do Instagram.</p>' +
      (planOn() ? '' : '<div class="ap-note">A página só recebe agendamentos com um plano ativo. Escolha um plano abaixo: os primeiros 14 dias são grátis.</div>') +
      '<div class="ap-link"><input id="ap-url" readonly value="' + esc(url) + '" aria-label="Link da sua página">' +
      '<button class="ap-btn" data-act="copy">Copiar link</button>' +
      '<a class="ap-btn" href="' + esc(url) + '" target="_blank" rel="noopener">Abrir</a></div></section>'
  }

  function secPlan() {
    var on = planOn()
    var label = on ? 'Plano ' + String(provider.plan || 'starter').toUpperCase() : 'Sem plano ativo'
    var ent = state.ent
    var sub = ent && ent.reason === 'trial_ended' ? 'Seu teste grátis terminou. Escolha um plano pra reabrir a agenda.'
      : ent && ent.trial ? 'Em teste grátis' + (ent.trial_ends_at ? ' até ' + new Date(ent.trial_ends_at).toLocaleDateString('pt-BR') : '') + ', com tudo do Premium liberado'
      : provider.plan_status === 'trialing' && !ent ? 'Em teste grátis' + (provider.trial_ends_at ? ' até ' + new Date(provider.trial_ends_at).toLocaleDateString('pt-BR') : '')
      : provider.plan_status === 'active' ? 'Assinatura ativa'
      : provider.plan_status === 'past_due' ? 'Pagamento pendente. Atualize o cartão pra reabrir a agenda.'
      : provider.plan_status === 'canceled' ? 'Assinatura cancelada'
      : 'Starter $19 · Pro $39 · Premium $79 por mês, com 14 dias grátis'
    return '<section class="ap-sec"><h2>Plano</h2><div class="ap-row"><div class="ap-main">' +
      '<div class="ap-name">' + esc(label) + '</div><div class="ap-meta">' + esc(sub) + '</div></div>' +
      '<div class="ap-actions">' +
      ((on && (!ent || ent.trial === false || provider.stripe_subscription_id)) || provider.plan_status === 'past_due'
        ? '<button class="ap-btn pri" data-act="portal">Gerenciar assinatura</button>'
        : '<a class="ap-btn pri" href="/agenda/planos">Ver planos</a>') +
      '</div></div></section>'
  }

  function secDeposit() {
    var c = state.connect
    var status = !c ? 'Carregando…'
      : c.charges_enabled ? 'Conta conectada. O sinal pago no cartão cai direto na sua conta, sem comissão.'
      : c.connected ? 'Cadastro no Stripe incompleto. Termine pra começar a receber no cartão.'
      : 'Opcional. Conecte sua conta pra cliente pagar o sinal no cartão ao agendar.'
    var btn = !c ? '' : c.charges_enabled ? '<span class="ap-pill" style="color:#1F4D3F;background:#E4EEE7">Cartão ativo</span>'
      : '<button class="ap-btn pri" data-act="connect">' + (c.connected ? 'Continuar cadastro' : 'Conectar Stripe') + '</button>'
    return '<section class="ap-sec"><h2>Sinal</h2>' +
      '<p class="ap-sub">Você decide, em cada serviço, se cobra sinal. A cliente pode pagar de dois jeitos.</p>' +
      '<div class="ap-row"><div class="ap-main"><div class="ap-name">Cartão, pelo Stripe</div><div class="ap-meta">' + esc(status) + '</div></div><div class="ap-actions">' + btn + '</div></div>' +
      '<div class="ap-row"><div class="ap-main"><div class="ap-name">Por fora: Zelle, dinheiro, Venmo</div>' +
      '<div class="ap-meta">' + (provider.deposit_instructions
        ? 'A cliente vê esta instrução: <strong>' + esc(provider.deposit_instructions) + '</strong>'
        : 'Preencha o campo “Como pagar o sinal” no perfil acima, pra cliente saber pra onde mandar.') +
      ' Quando receber, marque “Sinal recebido” no agendamento.</div></div></div></section>'
  }

  function secServices() {
    var list = state.services
    var rows = !list ? '<div class="ap-empty">Carregando…</div>'
      : list.length === 0 ? '<div class="ap-empty">Nenhum serviço ainda. Sem serviço, a cliente não tem o que agendar.</div>'
      : list.map(function (s) {
        return '<div class="ap-row"><div class="ap-main"><div class="ap-name">' + esc(s.name) +
          (s.active ? '' : ' <span class="ap-pill" style="color:#4B4F4D;background:#EDEBE4">Pausado</span>') + '</div>' +
          '<div class="ap-meta">' + (s.category ? esc(s.category) + ' · ' : '') + esc(s.duration_min) + ' min · ' + usd(s.price_cents) +
          (s.deposit_cents > 0 ? ' · sinal ' + usd(s.deposit_cents) : ' · sem sinal') + '</div></div>' +
          '<div class="ap-actions"><button class="ap-btn" data-act="svc-edit" data-id="' + esc(s.id) + '">Editar</button>' +
          '<button class="ap-btn danger" data-act="svc-del" data-id="' + esc(s.id) + '">Remover</button></div></div>'
      }).join('')
    return '<section class="ap-sec"><h2>Serviços</h2><p class="ap-sub">O que a cliente pode agendar, com duração e preço.</p>' +
      rows + (state.svcForm ? svcForm(state.svcForm) : '<div style="margin-top:14px"><button class="ap-btn pri" data-act="svc-new">Adicionar serviço</button></div>') +
      '</section>'
  }

  function svcForm(s) {
    return '<form class="ap-form" id="ap-svc-form">' +
      '<div><label for="ap-s-name">Nome do serviço *</label><input id="ap-s-name" name="name" required maxlength="120" value="' + esc(s.name) + '" placeholder="Ex.: Escova progressiva"></div>' +
      '<div class="ap-grid">' +
      '<div><label for="ap-s-dur">Duração (min) *</label><input id="ap-s-dur" name="duration_min" type="number" min="5" max="600" step="5" required value="' + esc(s.duration_min || 60) + '"></div>' +
      '<div><label for="ap-s-price">Preço (US$) *</label><input id="ap-s-price" name="price" type="number" min="0" step="0.01" required value="' + esc(s.price_cents != null ? (s.price_cents / 100).toFixed(2) : '') + '"></div>' +
      '<div><label for="ap-s-dep">Sinal (US$)</label><input id="ap-s-dep" name="deposit" type="number" min="0" step="0.01" value="' + esc(s.deposit_cents ? (s.deposit_cents / 100).toFixed(2) : '') + '" placeholder="0 = sem sinal"></div>' +
      '</div>' +
      '<div class="ap-grid"><div><label for="ap-s-cat">Categoria</label><input id="ap-s-cat" name="category" maxlength="60" value="' + esc(s.category) + '" placeholder="Cabelo, Unhas…"></div>' +
      '<div><label for="ap-s-act">Situação</label><select id="ap-s-act" name="active"><option value="1"' + (s.active === false ? '' : ' selected') + '>Disponível</option><option value="0"' + (s.active === false ? ' selected' : '') + '>Pausado</option></select></div></div>' +
      '<div><label for="ap-s-desc">Descrição</label><textarea id="ap-s-desc" name="description" rows="2" maxlength="600">' + esc(s.description) + '</textarea></div>' +
      '<div class="ap-actions"><button type="submit" class="ap-btn pri">' + (s.id ? 'Salvar serviço' : 'Adicionar serviço') + '</button>' +
      '<button type="button" class="ap-btn" data-act="svc-cancel">Cancelar</button></div></form>'
  }

  function secHours() {
    var hours = state.hours
    if (!hours) return '<section class="ap-sec"><h2>Horário de atendimento</h2><div class="ap-empty">Carregando…</div></section>'
    var byDay = {}
    hours.forEach(function (h) { (byDay[h.day_of_week] = byDay[h.day_of_week] || []).push(h) })
    var rows = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      var list = byDay[d] || []
      // Dia com pausa (2 ou 3 janelas, feitas no app): mostra o resumo e salva como esta
      if (list.length > 1) {
        return '<div class="ap-day" data-multi="' + d + '"><label><input type="checkbox" checked disabled> ' + DAYS[d] + '</label>' +
          '<span class="ap-meta">' + esc(list.map(function (h) { return String(h.start_time).slice(0, 5) + '–' + String(h.end_time).slice(0, 5) }).join(' · ')) + ' (com pausa: edite no app AgendaPro)</span></div>'
      }
      var h = list[0]
      return '<div class="ap-day"><label><input type="checkbox" data-day="' + d + '"' + (h ? ' checked' : '') + '> ' + DAYS[d] + '</label>' +
        '<input type="time" data-start="' + d + '" value="' + esc(h ? h.start_time : '09:00') + '" aria-label="Início ' + DAYS[d] + '">' +
        '<input type="time" data-end="' + d + '" value="' + esc(h ? h.end_time : '18:00') + '" aria-label="Fim ' + DAYS[d] + '"></div>'
    }).join('')
    return '<section class="ap-sec"><h2>Horário de atendimento</h2>' +
      '<p class="ap-sub">Marque os dias em que você atende. A cliente só vê horários livres dentro dessas janelas.</p>' +
      (hours.length === 0 ? '<div class="ap-note">Você ainda não definiu horários: a página não mostra nenhum horário pra cliente.</div>' : '') +
      '<div id="ap-hours">' + rows + '</div>' +
      '<div style="margin-top:14px"><button class="ap-btn pri" data-act="hours-save">Salvar horários</button></div></section>'
  }

  function secTurnover() {
    var list = state.feeds
    var rows = !list ? '<div class="ap-empty">Carregando…</div>'
      : list.length === 0 ? '<div class="ap-empty">Nenhuma casa sincronizada ainda.</div>'
      : list.map(feedRow).join('')
    return '<section class="ap-sec"><h2>Turnover de Airbnb, Vrbo e Booking</h2>' +
      '<p class="ap-sub">Cole o link do calendário de cada casa. A limpeza entra sozinha na sua agenda no dia do checkout, muda se a reserva mudar e sai se for cancelada. Atualiza de hora em hora.</p>' +
      '<details class="ap-how"><summary>Como pegar o link com o host</summary><ol>' +
      '<li><strong>Airbnb</strong> (no computador): Calendário → escolha o anúncio → Disponibilidade → Conectar calendários → Conectar a outro site → copiar o link.</li>' +
      '<li><strong>Vrbo e Booking</strong>: no calendário do anúncio, procure “Exportar calendário” ou “Sincronizar calendários” e copie o link.</li>' +
      '<li>O link termina em <code>.ics</code> e mostra as datas da casa: guarde como senha e não compartilhe.</li>' +
      '</ol></details>' +
      (planOn() ? '' : '<div class="ap-note">Pra sincronizar, você precisa de um plano ativo. Os 14 dias de teste grátis valem.</div>') +
      rows +
      (state.feedForm ? feedForm(state.feedForm) : '<div style="margin-top:14px"><button class="ap-btn pri" data-act="feed-new"' + (planOn() ? '' : ' disabled') + '>Adicionar casa</button></div>') +
      '</section>'
  }

  function feedRow(f) {
    var status = !f.last_synced_at ? 'Ainda não sincronizou'
      : f.last_status === 'error' ? '<span class="ap-err">Erro ' + esc(ago(f.last_synced_at)) + ': ' + esc(f.last_error || 'não deu certo') + '</span>'
      : 'Sincronizado ' + esc(ago(f.last_synced_at)) + ' · ' + esc(f.reservations_count) + (f.reservations_count === 1 ? ' reserva por vir' : ' reservas por vir')
    return '<div class="ap-row"><div class="ap-main"><div class="ap-name">' + esc(f.label) +
      ' <span class="ap-pill" style="color:#1F4D3F;background:#E4EEE7">' + esc(SOURCES[f.source] || 'Calendário') + '</span></div>' +
      '<div class="ap-meta">Checkout ' + esc(f.checkout_time) + ' · ' + esc(f.duration_min) + ' min · ' + usd(f.price_cents) + '<br>' + status +
      (f.notes ? '<br>Obs.: ' + esc(f.notes) : '') + '</div></div>' +
      '<div class="ap-actions">' +
      '<button class="ap-btn" data-act="feed-sync" data-id="' + esc(f.id) + '"' + (planOn() ? '' : ' disabled') + '>Sincronizar agora</button>' +
      '<button class="ap-btn" data-act="feed-edit" data-id="' + esc(f.id) + '">Editar</button>' +
      '<button class="ap-btn danger" data-act="feed-del" data-id="' + esc(f.id) + '">Remover</button></div></div>'
  }

  function feedForm(f) {
    var editing = !!f.id
    return '<form class="ap-form" id="ap-feed-form">' +
      '<div><label for="ap-f-label">Nome da casa *</label><input id="ap-f-label" name="label" required maxlength="80" value="' + esc(f.label) + '" placeholder="Ex.: Casa do lago, Kissimmee"></div>' +
      '<div><label for="ap-f-url">Link do calendário (.ics)' + (editing ? '' : ' *') + '</label>' +
      '<input id="ap-f-url" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false"' + (editing ? '' : ' required') +
      ' placeholder="' + (editing ? 'Deixe em branco pra manter: ' + esc(f.url_hint || 'link atual') : 'https://www.airbnb.com/calendar/ical/….ics') + '"></div>' +
      '<div class="ap-grid">' +
      '<div><label for="ap-f-time">Horário do checkout</label><input id="ap-f-time" name="checkout_time" type="time" required value="' + esc(f.checkout_time || '11:00') + '"></div>' +
      '<div><label for="ap-f-dur">Duração da limpeza (min)</label><input id="ap-f-dur" name="duration_min" type="number" min="15" max="720" step="15" required value="' + esc(f.duration_min || 180) + '"></div>' +
      '<div><label for="ap-f-price">Valor da limpeza (US$)</label><input id="ap-f-price" name="price" type="number" min="0" step="0.01" value="' + esc(f.price_cents != null ? (f.price_cents / 100).toFixed(2) : '') + '" placeholder="0.00"></div>' +
      '</div>' +
      '<div><label for="ap-f-notes">Observações</label><textarea id="ap-f-notes" name="notes" rows="2" maxlength="500" placeholder="Endereço, código da porta, onde fica a roupa de cama">' + esc(f.notes) + '</textarea></div>' +
      '<div class="ap-actions"><button type="submit" class="ap-btn pri">' + (editing ? 'Salvar casa' : 'Adicionar e sincronizar') + '</button>' +
      '<button type="button" class="ap-btn" data-act="feed-cancel">Cancelar</button></div></form>'
  }

  function secAppointments() {
    var list = state.appointments
    var scope = state.scope
    var tabs = '<div class="ap-actions" style="margin-bottom:12px">' +
      '<button class="ap-btn' + (scope === 'upcoming' ? ' pri' : '') + '" data-act="scope" data-scope="upcoming">Próximos</button>' +
      '<button class="ap-btn' + (scope === 'past' ? ' pri' : '') + '" data-act="scope" data-scope="past">Anteriores</button></div>'
    var rows = !list ? '<div class="ap-empty">Carregando…</div>'
      : list.length === 0 ? '<div class="ap-empty">' + (scope === 'past' ? 'Nenhum agendamento anterior.' : 'Nenhum agendamento por vir. Divulgue seu link pra começar.') + '</div>'
      : list.map(aptRow).join('')
    return '<section class="ap-sec"><h2>Agendamentos</h2>' + tabs + rows + '</section>'
  }

  function aptRow(a) {
    if (a.external_uid) return turnoverRow(a)
    var st = STATUS[a.status] || [a.status, '#4B4F4D', '#EDEBE4']
    var wa = String(a.client_whatsapp || '').replace(/\D/g, '')
    var acts = []
    if (a.status === 'pending') {
      acts.push('<select data-method="' + esc(a.id) + '" aria-label="Como recebeu o sinal" style="width:auto"><option value="zelle">Zelle</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option></select>')
      acts.push('<button class="ap-btn pri" data-act="apt" data-do="confirm_deposit" data-id="' + esc(a.id) + '">Sinal recebido</button>')
    }
    if (a.status === 'confirmed') {
      acts.push('<button class="ap-btn pri" data-act="apt" data-do="complete" data-id="' + esc(a.id) + '">Concluir</button>')
      acts.push('<button class="ap-btn" data-act="apt" data-do="no_show" data-id="' + esc(a.id) + '">Faltou</button>')
    }
    if (a.status === 'pending' || a.status === 'confirmed') {
      acts.push('<button class="ap-btn danger" data-act="apt" data-do="cancel" data-id="' + esc(a.id) + '">Cancelar</button>')
    }
    if (a.status === 'completed' && !a.review_requested) {
      acts.push('<button class="ap-btn" data-act="review" data-id="' + esc(a.id) + '">Pedir avaliação</button>')
    }
    if (wa) acts.push('<a class="ap-btn" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">WhatsApp</a>')

    return '<div class="ap-row"><div class="ap-main">' +
      '<div class="ap-name">' + esc(when(a.scheduled_for)) + ' · ' + esc(a.client_name) +
      ' <span class="ap-pill" style="color:' + st[1] + ';background:' + st[2] + '">' + esc(st[0]) + '</span></div>' +
      '<div class="ap-meta">' + esc(a.service_name || 'Serviço') + ' · ' + esc(a.duration_min) + ' min · ' + usd(a.total_cents) +
      (a.deposit_cents > 0 ? ' · sinal ' + usd(a.deposit_cents) + (a.deposit_paid ? ' pago' : ' pendente') : '') +
      (a.client_notes ? '<br>Obs.: ' + esc(a.client_notes) : '') + '</div></div>' +
      '<div class="ap-actions">' + acts.join('') + '</div></div>'
  }

  // Limpeza de turnover: nao tem cliente pra avisar; o que importa e quando chega o proximo hospede
  function turnoverRow(a) {
    var st = STATUS[a.status] || [a.status, '#4B4F4D', '#EDEBE4']
    var open = a.status === 'pending' || a.status === 'confirmed'
    var next = ''
    if (open) {
      next = !a.ical_next_checkin ? '<br>Sem próxima reserva no calendário'
        : a.ical_next_checkin === String(a.scheduled_for).slice(0, 10) ? '<br><span class="ap-hot">Próximo hóspede chega no mesmo dia</span>'
        : '<br>Próximo check-in: ' + esc(day(a.ical_next_checkin))
    }
    var acts = []
    if (open) {
      acts.push('<button class="ap-btn pri" data-act="apt" data-do="complete" data-id="' + esc(a.id) + '">Concluir</button>')
      acts.push('<button class="ap-btn danger" data-act="apt" data-do="cancel" data-id="' + esc(a.id) + '">Cancelar</button>')
    }
    return '<div class="ap-row"><div class="ap-main">' +
      '<div class="ap-name">' + esc(when(a.scheduled_for)) + ' · ' + esc(a.feed_label || a.client_name) +
      ' <span class="ap-pill" style="color:' + st[1] + ';background:' + st[2] + '">' + esc(st[0]) + '</span></div>' +
      '<div class="ap-meta">Turnover' + (a.feed_source ? ' ' + esc(SOURCES[a.feed_source] || '') : '') + ' · ' + esc(a.duration_min) + ' min · ' + usd(a.total_cents) + next +
      (a.status === 'canceled' && a.cancel_reason ? '<br>' + esc(a.cancel_reason) : '') +
      (open && a.feed_notes ? '<br>Obs.: ' + esc(a.feed_notes) : '') + '</div></div>' +
      '<div class="ap-actions">' + acts.join('') + '</div></div>'
  }

  // ── Dados ───────────────────────────────────────────────────────────────
  async function loadAll() {
    var jobs = [
      api('/api/agenda/services?mine=1').then(function (d) { state.services = d.services || [] }),
      api('/api/agenda/hours').then(function (d) { state.hours = d.hours || [] }),
      loadFeeds(true),
      loadAppointments(true),
      api('/api/agenda/connect').then(function (d) { state.connect = d }).catch(function () { state.connect = { connected: false, charges_enabled: false } }),
      api('/api/agenda/me').then(function (d) { state.ent = d.entitlements || null }).catch(function () {}),
    ]
    await Promise.all(jobs.map(function (p) { return p.catch(function (e) { toast(e.message, true) }) }))
    state.services = state.services || []
    state.hours = state.hours || []
    state.feeds = state.feeds || []
    state.appointments = state.appointments || []
    render()
  }
  function loadFeeds(silent) {
    return api('/api/agenda/ical').then(function (d) {
      state.feeds = d.feeds || []
      if (!silent) render()
    })
  }
  function loadAppointments(silent) {
    return api('/api/agenda/appointments?scope=' + state.scope).then(function (d) {
      state.appointments = d.appointments || []
      if (!silent) render()
    })
  }

  // ── Acoes ───────────────────────────────────────────────────────────────
  async function onClick(e) {
    var b = e.target.closest('[data-act]')
    if (!b || !el.contains(b)) return
    var act = b.dataset.act
    try {
      if (act === 'copy') {
        var input = document.getElementById('ap-url')
        try { await navigator.clipboard.writeText(input.value); toast('Link copiado') }
        catch (_) { input.select(); toast('Selecione e copie o link') }
      } else if (act === 'portal') {
        b.disabled = true
        try { var p = await post('/api/stripe/portal'); location.href = p.portal_url }
        catch (err) { b.disabled = false; if (/ainda não tem assinatura/i.test(err.message)) location.href = '/agenda/planos'; else throw err }
      } else if (act === 'connect') {
        b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Abrindo Stripe…'
        var c = await post('/api/agenda/connect')
        location.href = c.onboarding_url
      } else if (act === 'svc-new') {
        state.svcForm = { active: true, duration_min: 60 }; render(); focus('ap-s-name')
      } else if (act === 'svc-edit') {
        state.svcForm = Object.assign({}, state.services.find(function (s) { return s.id === b.dataset.id }))
        render(); focus('ap-s-name')
      } else if (act === 'svc-cancel') {
        state.svcForm = null; render()
      } else if (act === 'svc-del') {
        if (!confirm('Remover este serviço?')) return
        var r = await api('/api/agenda/services?id=' + encodeURIComponent(b.dataset.id), { method: 'DELETE' })
        toast(r.paused ? 'Serviço pausado (tem agendamentos no histórico)' : 'Serviço removido')
        state.services = (await api('/api/agenda/services?mine=1')).services || []
        render()
      } else if (act === 'feed-new') {
        state.feedForm = { checkout_time: '11:00', duration_min: 180 }; render(); focus('ap-f-label')
      } else if (act === 'feed-edit') {
        state.feedForm = Object.assign({}, state.feeds.find(function (f) { return f.id === b.dataset.id }))
        render(); focus('ap-f-label')
      } else if (act === 'feed-cancel') {
        state.feedForm = null; render()
      } else if (act === 'feed-sync') {
        b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Sincronizando…'
        var sr = await post('/api/agenda/ical', { action: 'sync', id: b.dataset.id })
        syncToast(sr.sync)
        await Promise.all([loadFeeds(true), loadAppointments(true)])
        render()
      } else if (act === 'feed-del') {
        if (!confirm('Remover esta casa? As limpezas por vir dela saem da agenda. As já feitas continuam no histórico.')) return
        b.disabled = true
        await post('/api/agenda/ical', { action: 'delete', id: b.dataset.id })
        toast('Casa removida')
        await Promise.all([loadFeeds(true), loadAppointments(true)])
        render()
      } else if (act === 'hours-save') {
        await saveHours(b)
      } else if (act === 'scope') {
        state.scope = b.dataset.scope; state.appointments = null; render(); await loadAppointments()
      } else if (act === 'apt') {
        await aptAction(b)
      } else if (act === 'review') {
        b.disabled = true
        var rv = await post('/api/agenda/request-review', { appointment_id: b.dataset.id })
        if (rv.whatsapp_url) window.open(rv.whatsapp_url, '_blank', 'noopener')
        else { try { await navigator.clipboard.writeText(rv.review_url); toast('Link da avaliação copiado') } catch (_) { toast(rv.review_url) } }
        await loadAppointments()
      }
    } catch (err) {
      b.disabled = false
      if (b.dataset.label) b.textContent = b.dataset.label
      // Recurso de outro plano (402): oferece a pagina de planos em vez de so mostrar o erro
      var code = err.data && err.data.code
      if (code === 'plan_required' || code === 'limit_reached') {
        if (confirm(err.message + ' Ver os planos agora?')) location.href = '/agenda/planos'
        return
      }
      toast(err.message, true)
    }
  }

  function focus(id) { setTimeout(function () { var n = document.getElementById(id); if (n) n.focus() }, 50) }

  async function onSubmit(e) {
    if (e.target.id === 'ap-feed-form') return saveFeed(e)
    if (e.target.id !== 'ap-svc-form') return
    e.preventDefault()
    var f = e.target, btn = f.querySelector('button[type=submit]')
    var price = toCents(f.price.value), dep = toCents(f.deposit.value)
    if (dep > price) { toast('O sinal não pode ser maior que o preço', true); return }
    btn.disabled = true
    try {
      await post('/api/agenda/services', {
        id: state.svcForm && state.svcForm.id,
        name: f.name.value, category: f.category.value, description: f.description.value,
        duration_min: Number(f.duration_min.value), price_cents: price, deposit_cents: dep,
        active: f.active.value === '1',
        display_order: state.svcForm && state.svcForm.display_order != null ? state.svcForm.display_order : (state.services || []).length,
      })
      toast('Serviço salvo')
      state.svcForm = null
      state.services = (await api('/api/agenda/services?mine=1')).services || []
      render()
    } catch (err) {
      btn.disabled = false
      toast(err.message, true)
    }
  }

  function syncToast(r) {
    if (!r) { toast('Casa salva'); return }
    if (!r.ok) { toast('Não deu pra sincronizar: ' + r.error, true); return }
    var parts = []
    if (r.created) parts.push(r.created + (r.created === 1 ? ' limpeza nova' : ' limpezas novas'))
    if (r.updated) parts.push(r.updated + (r.updated === 1 ? ' atualizada' : ' atualizadas'))
    if (r.canceled) parts.push(r.canceled + (r.canceled === 1 ? ' cancelada' : ' canceladas'))
    toast(parts.length ? 'Sincronizado: ' + parts.join(', ') : 'Sincronizado. Nada mudou.')
  }

  async function saveFeed(e) {
    e.preventDefault()
    var f = e.target, btn = f.querySelector('button[type=submit]')
    var editing = !!(state.feedForm && state.feedForm.id)
    var body = {
      action: editing ? 'update' : 'create',
      id: editing ? state.feedForm.id : undefined,
      label: f.label.value, url: f.url.value.trim(), checkout_time: f.checkout_time.value,
      duration_min: Number(f.duration_min.value), price_cents: toCents(f.price.value), notes: f.notes.value,
    }
    btn.disabled = true; btn.textContent = editing ? 'Salvando…' : 'Lendo o calendário…'
    try {
      var r = await post('/api/agenda/ical', body)
      syncToast(r.sync)
      state.feedForm = null
      await Promise.all([loadFeeds(true), loadAppointments(true)])
      render()
    } catch (err) {
      btn.disabled = false; btn.textContent = editing ? 'Salvar casa' : 'Adicionar e sincronizar'
      toast(err.message, true)
    }
  }

  async function saveHours(btn) {
    var hours = []
    var bad = false
    el.querySelectorAll('[data-day]').forEach(function (cb) {
      if (!cb.checked) return
      var d = Number(cb.dataset.day)
      var s = el.querySelector('[data-start="' + d + '"]').value
      var en = el.querySelector('[data-end="' + d + '"]').value
      if (!s || !en || s >= en) { bad = DAYS[d]; return }
      hours.push({ day_of_week: d, start_time: s, end_time: en })
    })
    if (bad) { toast(bad + ': o início precisa ser antes do fim', true); return }
    // Dias com pausa nao aparecem como campos: reenvia as janelas que ja existiam
    el.querySelectorAll('[data-multi]').forEach(function (row) {
      var d = Number(row.dataset.multi)
      ;(state.hours || []).forEach(function (h) {
        if (h.day_of_week === d) hours.push({ day_of_week: d, start_time: String(h.start_time).slice(0, 5), end_time: String(h.end_time).slice(0, 5) })
      })
    })
    btn.disabled = true
    var d = await post('/api/agenda/hours', { hours: hours })
    state.hours = d.hours || []
    toast('Horários salvos')
    render()
  }

  async function aptAction(b) {
    var action = b.dataset.do, id = b.dataset.id, body = { id: id, action: action }
    if (action === 'confirm_deposit') {
      var sel = el.querySelector('[data-method="' + id + '"]')
      body.method = sel ? sel.value : 'zelle'
    }
    if (action === 'cancel') {
      if (!confirm('Cancelar este agendamento? O horário volta a ficar livre.')) return
    }
    if (action === 'no_show' && !confirm('Marcar que a cliente faltou?')) return
    b.disabled = true
    await post('/api/agenda/appointments', body)
    toast({ confirm_deposit: 'Sinal registrado. Horário confirmado.', complete: 'Atendimento concluído', no_show: 'Falta registrada', cancel: 'Agendamento cancelado' }[action] || 'Atualizado')
    await loadAppointments()
  }

  // ── API publica ─────────────────────────────────────────────────────────
  window.BCAgendaPainel = {
    mount: function (container, prov) {
      if (!container || !prov) return
      injectStyles()
      // Remonta limpo: o /assinante recria o container a cada render
      el = container
      provider = prov
      state = { services: null, hours: null, feeds: null, appointments: null, connect: null, ent: null, scope: 'upcoming', svcForm: null, feedForm: null }
      el.addEventListener('click', onClick)
      el.addEventListener('submit', onSubmit)
      render()
      loadAll()
    },
  }
})()
