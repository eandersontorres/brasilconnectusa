// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — CÓPIA de api/_lib/agendaPlans.js (matriz de planos).
//   O app não importa nada de api/ (o Metro só enxerga agendapro/). Mudou a matriz
//   lá? Copie de novo pra cá. Sem dependência de Node: roda no app e no node.
// ════════════════════════════════════════════════════════════════════════════

/**
 * AgendaPro — fonte unica do que cada plano libera.
 *
 * O app (agendapro/) e o painel web leem isso via GET /api/agenda/me; as rotas
 * usam requireFeature() pra bloquear do lado do servidor. Mudou preco ou recurso?
 * Muda aqui e na pagina /agenda/planos.
 *
 *   import { entitlementsFor, requireFeature } from '../_lib/agendaPlans.js'
 *   const gate = requireFeature(provider, 'finance')
 *   if (!gate.ok) return res.status(gate.status).json(gate.body)
 *
 * Regras de status:
 *   - trialing  → teste gratis de 14 dias com tudo do Premium liberado (mesmo
 *                 depois de assinar no meio do teste). Sem trial_ends_at (perfil
 *                 antigo), conta 14 dias do created_at.
 *   - active    → recursos do plano assinado.
 *   - past_due  → mantem o plano enquanto o Stripe tenta cobrar de novo (o
 *                 Stripe cancela a assinatura quando as tentativas acabam, e ai
 *                 vem customer.subscription.deleted) e mostra aviso no app.
 *                 Conferir em Stripe → Billing → Revenue recovery que a acao final
 *                 e "cancelar a assinatura".
 *   - active    → com current_period_end vencido ha mais de 3 dias (webhook de
 *                 renovacao perdido), cai pra 'none'.
 *   - outros    → 'none': o app abre, mostra agenda e clientes, mas nao cria
 *                 nada novo e a pagina publica nao aceita agendamento.
 */

export const TRIAL_DAYS = 14
const GRACE_MS = 3 * 24 * 3600e3

export const PLAN_ORDER = ['none', 'starter', 'pro', 'premium']

export const PLANS = {
  starter: { name: 'Starter', price_usd: 19, tagline: 'Pra quem está começando' },
  pro:     { name: 'Pro',     price_usd: 39, tagline: 'Pra quem já tem clientela e quer crescer' },
  premium: { name: 'Premium', price_usd: 79, tagline: 'Equipes e negócios com vários profissionais' },
}

/**
 * Recurso → plano minimo. `label` e `desc` aparecem no app (tela de planos e
 * cadeado), entao escreve pensando na profissional, nao no codigo.
 */
export const FEATURES = {
  // ── Starter ────────────────────────────────────────────────────────────
  agenda:             { min: 'starter', label: 'Agenda completa', desc: 'Dia e semana, agendamento manual, remarcar e cancelar' },
  online_booking:     { min: 'starter', label: 'Agendamento online', desc: 'Sua página /agenda/seu-nome aceitando horários 24h' },
  services:           { min: 'starter', label: 'Serviços e preços', desc: 'Catálogo com duração, preço e sinal' },
  hours:              { min: 'starter', label: 'Horários e folgas', desc: 'Horário de atendimento, férias e dias bloqueados' },
  clients:            { min: 'starter', label: 'Clientes', desc: 'Ficha da cliente com histórico, observações e WhatsApp' },
  email_reminders:    { min: 'starter', label: 'Lembrete por e-mail', desc: 'Confirmação e lembrete 24h antes, automáticos' },
  push_notifications: { min: 'starter', label: 'Notificações no celular', desc: 'Aviso na hora quando chega agendamento novo' },
  whatsapp_templates: { min: 'starter', label: 'Mensagens prontas no WhatsApp', desc: 'Confirmar, lembrar, avisar atraso e pedir avaliação em 1 toque' },
  calendar_sync:      { min: 'starter', label: 'Calendário do celular', desc: 'Manda os agendamentos pro calendário do iPhone ou Android' },
  deposit_offline:    { min: 'starter', label: 'Sinal por Zelle ou dinheiro', desc: 'Instruções na página e confirmação no app' },
  payments_log:       { min: 'starter', label: 'Controle de pagamento', desc: 'Marca pago, forma de pagamento e gorjeta' },
  share_qr:           { min: 'starter', label: 'Link e QR code', desc: 'Compartilha sua página e imprime o QR pro balcão' },
  turnover_ical:      { min: 'starter', label: 'Turnover Airbnb, Vrbo e Booking', desc: 'Limpeza criada sozinha no dia do checkout' },

  // ── Pro ────────────────────────────────────────────────────────────────
  deposit_stripe:     { min: 'pro', label: 'Sinal com cartão', desc: 'Cliente paga o sinal no cartão e o dinheiro cai na sua conta Stripe' },
  reviews:            { min: 'pro', label: 'Avaliações', desc: 'Pede avaliação, responde e mostra as estrelas na sua página' },
  gallery:            { min: 'pro', label: 'Galeria de fotos', desc: 'Fotos do seu trabalho na página pública' },
  recurring:          { min: 'pro', label: 'Clientes fixas (recorrência)', desc: 'Semanal, quinzenal ou mensal: a agenda se preenche sozinha' },
  reactivation:       { min: 'pro', label: 'Clientes sumidas', desc: 'Lista quem não volta há semanas, com mensagem pronta pra chamar de volta' },
  waitlist:           { min: 'pro', label: 'Lista de espera', desc: 'Cancelou? Avisa quem estava esperando um horário' },
  finance:            { min: 'pro', label: 'Finanças', desc: 'Despesas, lucro do mês, meta e reserva pro imposto' },
  mileage:            { min: 'pro', label: 'Milhagem', desc: 'Registra as milhas rodadas a trabalho (dedução no imposto)' },
  multilang_messages: { min: 'pro', label: 'Mensagens em inglês e espanhol', desc: 'Lembretes e mensagens no idioma da cliente' },

  // ── Premium ────────────────────────────────────────────────────────────
  team:               { min: 'premium', label: 'Equipe', desc: 'Até 10 profissionais ou equipes, cada um com sua cor na agenda' },
  team_day_link:      { min: 'premium', label: 'Rota do dia da equipe', desc: 'Link sem senha com as paradas do dia, endereço e observações' },
  reports:            { min: 'premium', label: 'Relatórios e exportação', desc: 'Relatório mensal por serviço, cliente e equipe, com CSV pro contador' },
  receipts:           { min: 'premium', label: 'Recibos em PDF', desc: 'Recibo com sua marca pra mandar pra cliente' },
  no_branding:        { min: 'premium', label: 'Sem a marca BrasilConnect', desc: 'Página pública só com a sua marca' },
}

/** Limites por plano (null = ilimitado). */
export const LIMITS = {
  none:    { staff: 0,  ical_feeds: 0,    recurring: 0 },
  starter: { staff: 0,  ical_feeds: 3,    recurring: 0 },
  pro:     { staff: 0,  ical_feeds: 15,   recurring: null },
  premium: { staff: 10, ical_feeds: null, recurring: null },
}

const rank = (tier) => Math.max(0, PLAN_ORDER.indexOf(tier))

function normPlan(p) {
  const s = String(p || '').toLowerCase()
  if (s === 'salao') return 'premium'
  return PLANS[s] ? s : 'starter'
}

function trialEnd(provider) {
  if (provider?.trial_ends_at) return new Date(provider.trial_ends_at)
  // Perfil sem data de fim do teste e sem assinatura: 14 dias a partir do cadastro
  if (!provider?.stripe_subscription_id && provider?.created_at) {
    return new Date(new Date(provider.created_at).getTime() + TRIAL_DAYS * 86400e3)
  }
  return null
}

/**
 * Plano efetivo agora.
 * → { tier: 'none'|'starter'|'pro'|'premium', status, trial, trial_ends_at,
 *     trial_days_left, plan, past_due, reason }
 */
export function effectivePlan(provider, now = new Date()) {
  const plan = normPlan(provider?.plan)
  const status = String(provider?.plan_status || '').toLowerCase()
  const out = { tier: 'none', plan, status, trial: false, trial_ends_at: null, trial_days_left: 0, past_due: false, reason: null }
  if (!provider) return { ...out, reason: 'no_provider' }
  if (provider.active === false) return { ...out, reason: 'inactive' }

  if (status === 'trialing') {
    const end = trialEnd(provider)
    // Teste gratis libera tudo do Premium ate o fim, mesmo se ela ja assinou um
    // plano no meio do teste (o Stripe so cobra no fim; ai vale o plano escolhido).
    if (end && end.getTime() > now.getTime()) {
      const left = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400e3))
      return {
        ...out,
        tier: 'premium',
        trial: true,
        trial_ends_at: end.toISOString(),
        trial_days_left: left,
      }
    }
    if (provider.stripe_subscription_id && !end) return { ...out, tier: 'premium', trial: true }
    return { ...out, reason: 'trial_ended', trial_ends_at: end ? end.toISOString() : null }
  }

  if (status === 'active' || status === 'past_due') {
    const periodEnd = provider.current_period_end ? new Date(provider.current_period_end).getTime() : null
    if (periodEnd && periodEnd < now.getTime() - GRACE_MS) return { ...out, reason: 'period_ended' }
    // Assinou nas ultimas 48h do teste (o Stripe nao aceita trial tao curto e cobra
    // na hora): o resto do teste continua com tudo do Premium.
    const trialEndMs = provider.trial_ends_at ? new Date(provider.trial_ends_at).getTime() : 0
    const tier = status === 'active' && trialEndMs > now.getTime() ? 'premium' : plan
    return { ...out, tier, past_due: status === 'past_due' }
  }

  return { ...out, reason: status || 'no_plan' }
}

export function hasFeature(provider, key, now = new Date()) {
  const f = FEATURES[key]
  if (!f) return false
  return rank(effectivePlan(provider, now).tier) >= rank(f.min)
}

export function limitFor(provider, key, now = new Date()) {
  const tier = effectivePlan(provider, now).tier
  const v = LIMITS[tier]?.[key]
  return v === undefined ? 0 : v
}

/** O que o app precisa pra desenhar cadeados, avisos e a tela de planos. */
export function entitlementsFor(provider, now = new Date()) {
  const eff = effectivePlan(provider, now)
  const features = {}
  for (const k of Object.keys(FEATURES)) features[k] = rank(eff.tier) >= rank(FEATURES[k].min)
  return {
    ...eff,
    features,
    limits: { ...(LIMITS[eff.tier] || LIMITS.none) },
    catalog: {
      plans: PLANS,
      order: PLAN_ORDER,
      features: FEATURES,
      limits: LIMITS,
      trial_days: TRIAL_DAYS,
    },
  }
}

/**
 * Bloqueio do lado do servidor. Responde 402 com o que o app precisa pra
 * mostrar o cadeado certo ("Disponível no plano Pro").
 */
export function requireFeature(provider, key, now = new Date()) {
  if (hasFeature(provider, key, now)) return { ok: true }
  const f = FEATURES[key] || { min: 'starter', label: key }
  const eff = effectivePlan(provider, now)
  const minName = PLANS[f.min]?.name || f.min
  const error = eff.tier === 'none'
    ? `Seu plano não está ativo. ${f.label} fica liberado com um plano ativo.`
    : `${f.label} faz parte do plano ${minName}.`
  return {
    ok: false,
    status: 402,
    body: { error, code: 'plan_required', feature: key, min_plan: f.min, current_tier: eff.tier },
  }
}

/** Limite numerico (equipe, casas do turnover...). `count` = quantos ja tem. */
export function requireLimit(provider, key, count, now = new Date()) {
  const max = limitFor(provider, key, now)
  if (max === null || count < max) return { ok: true, max }
  const eff = effectivePlan(provider, now)
  const next = PLAN_ORDER.slice(rank(eff.tier) + 1).find(t => {
    const v = LIMITS[t]?.[key]
    return v === null || v > max
  })
  return {
    ok: false,
    status: 402,
    body: {
      error: `Você chegou no limite do seu plano (${max}).${next ? ` O plano ${PLANS[next].name} libera mais.` : ''}`,
      code: 'limit_reached', limit: key, max, min_plan: next || null, current_tier: eff.tier,
    },
  }
}
