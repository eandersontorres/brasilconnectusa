/**
 * Planos do diretorio de negocios (Free / Pro / Premium), por modulo.
 * Fonte unica das regras: limites do Free, precos e o que cada plano libera.
 * As paginas /para/* e o painel mostram estes mesmos numeros.
 *
 * O modulo agenda_pro nao entra aqui: o plano dele e a assinatura do AgendaPro
 * (Starter/Pro/Premium em /agenda/planos).
 */
export const LISTING_MODULES = {
  restaurant: { label: 'Restaurante', itemNoun: 'itens no cardápio', freeItems: 20, pro: 2900, premium: 7900, orders: true },
  grocery:    { label: 'Mercado',     itemNoun: 'produtos no catálogo', freeItems: 30, pro: 2900, premium: 7900, orders: true },
  retail:     { label: 'Loja',        itemNoun: 'produtos no catálogo', freeItems: 20, pro: 2900, premium: 7900, orders: true },
  showcase:   { label: 'Divulgação',  itemNoun: null, freeItems: null, pro: 900, premium: 2900, orders: false },
}

export const PAID_PLANS = ['pro', 'premium']

// Colunas que as rotas precisam pra decidir plano
export const PLAN_COLS = 'id, name, slug, module, listing_plan, plan, listing_plan_status, listing_period_end, stripe_customer_id, stripe_subscription_id, featured, accepts_orders, owner_email'

// Assinatura existe mas nao esta valendo
const DEAD_STATUS = ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']

export function moduleConfig(module) {
  return LISTING_MODULES[String(module || '').toLowerCase()] || null
}

export function isPaid(plan) {
  return PAID_PLANS.includes(plan)
}

/**
 * Plano que esta valendo agora.
 * - Plano dado pelo admin (sem assinatura no Stripe) vale como esta.
 * - Com assinatura, so vale se ela estiver ativa, em teste ou com pagamento atrasado
 *   (o Stripe ainda tenta cobrar; o webhook derruba pra free se desistir).
 */
export function effectivePlan(biz) {
  const p = String(biz?.listing_plan || biz?.plan || 'free').toLowerCase()
  if (!isPaid(p)) return 'free'
  if (biz?.stripe_subscription_id && DEAD_STATUS.includes(biz?.listing_plan_status)) return 'free'
  return p
}

export function hasLiveSubscription(biz) {
  return !!biz?.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(biz?.listing_plan_status)
}

export function priceCents(module, plan) {
  const cfg = moduleConfig(module)
  return cfg && isPaid(plan) ? cfg[plan] : null
}

/** Limite de itens do plano atual (null = ilimitado). */
export function itemLimit(biz) {
  const cfg = moduleConfig(biz?.module)
  if (!cfg || cfg.freeItems == null) return null
  return effectivePlan(biz) === 'free' ? cfg.freeItems : null
}

/** Pedidos online exigem modulo com pedidos + plano pago. */
export function canTakeOrders(biz) {
  const cfg = moduleConfig(biz?.module)
  return !!cfg?.orders && isPaid(effectivePlan(biz))
}

/** Campos de midia que so aparecem no perfil publico de Divulgacao a partir do Pro. */
export const SHOWCASE_PRO_FIELDS = ['logo_url', 'gallery_urls', 'video_url', 'instagram', 'facebook', 'tiktok']

export function stripForPlan(publicBiz) {
  if (String(publicBiz?.module) !== 'showcase') return publicBiz
  if (isPaid(String(publicBiz?.listing_plan || 'free').toLowerCase())) return publicBiz
  const out = { ...publicBiz }
  for (const k of SHOWCASE_PRO_FIELDS) out[k] = k === 'gallery_urls' ? [] : null
  return out
}
