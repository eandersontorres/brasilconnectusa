import { identifyAdmin } from './adminAuth.js'
/**
 * Auth da profissional do AgendaPro.
 *
 * Substitui o ADMIN_SECRET que as rotas de servicos/sinal exigiam: com ele, a
 * profissional nao conseguia operar a propria agenda. Agora o dono vem do JWT.
 *
 *   const auth = await requireProviderAuth(req, supabase)
 *   if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
 *   const { user, provider } = auth
 */
import { requireAuthOnly } from './businessAuth.js'
import { effectivePlan } from './agendaPlans.js'

export const PROVIDER_COLS = 'id, name, email, slug, city, state, owner_user_id, plan, plan_status, current_period_end, trial_ends_at, active, stripe_customer_id, stripe_subscription_id, stripe_account_id, stripe_onboarded, stripe_charges_enabled, deposit_instructions, created_at, vertical, timezone, app_settings, whatsapp, specialty, avatar_url, cover_color'

export async function requireProviderAuth(req, supabase) {
  const auth = await requireAuthOnly(req, supabase)
  if (!auth.ok) return auth

  const email = String(auth.user.email || '').toLowerCase().trim()

  let { data: provider } = await supabase.from('ag_providers').select(PROVIDER_COLS)
    .eq('owner_user_id', auth.user.id).maybeSingle()
  // Pelo e-mail so vale perfil ainda SEM dono (criado antes do vinculo por login).
  // Perfil de outro login com o mesmo e-mail (e-mail trocado ou login apagado e
  // recriado) nunca e entregue.
  if (!provider && email) {
    const byEmail = await supabase.from('ag_providers').select(PROVIDER_COLS)
      .eq('email', email).is('owner_user_id', null).maybeSingle()
    provider = byEmail.data || null
  }
  if (!provider) {
    return { ok: false, status: 404, error: 'Você ainda não tem perfil de profissional. Salve o perfil primeiro.' }
  }

  // Backfill do vinculo por user_id (uma vez)
  if (!provider.owner_user_id) {
    try { await supabase.from('ag_providers').update({ owner_user_id: auth.user.id }).eq('id', provider.id) } catch (_) {}
  }

  return { ok: true, user: auth.user, provider }
}

/**
 * Assinatura em teste (dentro do prazo) ou ativa. Recurso por recurso: use
 * hasFeature/requireFeature de ./agendaPlans.js.
 */
export function planActive(provider) {
  return effectivePlan(provider).tier !== 'none'
}

/** Chamada administrativa (painel admin / scripts): senha compartilhada ou conta com papel admin. */
export async function isAdmin(req) {
  const a = await identifyAdmin(req)
  return !!a.ok
}
