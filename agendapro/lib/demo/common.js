// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — peças comuns aos dados de exemplo (AgendaPro e WorkPro).
//   JS puro, sem react-native.
// ════════════════════════════════════════════════════════════════════════════

export const DEMO_USER = { id: 'de000000-0000-4000-9000-000000000001', email: 'demo@agendapro.app' }
export const DEMO_PLANS = ['trial', 'starter', 'pro', 'premium', 'none']
export const DAY = 86400e3

/** Imagem de exemplo (PNG: o Image do React Native não lê SVG). */
export const placeholderImage = (text, bg = '1F4D3F', fg = 'FAF7F0', size = '800x800') =>
  `https://placehold.co/${size}/${bg}/${fg}/png?text=${encodeURIComponent(text).replace(/%20/g, '+')}`

/** Campos de assinatura do perfil conforme o plano da demo. */
export function planFields(plan, nowMs) {
  const iso = (d) => new Date(nowMs + d * DAY).toISOString()
  if (plan === 'none') {
    return { plan: 'pro', plan_status: 'canceled', trial_ends_at: iso(-80), current_period_end: iso(-8), stripe_customer_id: 'cus_demo', stripe_subscription_id: null, created_at: iso(-94) }
  }
  if (plan === 'starter' || plan === 'pro' || plan === 'premium') {
    return { plan, plan_status: 'active', trial_ends_at: iso(-60), current_period_end: iso(18), stripe_customer_id: 'cus_demo', stripe_subscription_id: 'sub_demo', created_at: iso(-74) }
  }
  // trial: 14 dias com tudo do Premium, faltando 9 (sem cartão)
  return { plan: 'starter', plan_status: 'trialing', trial_ends_at: new Date(nowMs + 9 * DAY - 3600e3).toISOString(), current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null, created_at: iso(-5) }
}
