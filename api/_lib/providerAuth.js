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

export const PROVIDER_COLS = 'id, name, email, slug, city, state, owner_user_id, plan, plan_status, current_period_end, trial_ends_at, active, stripe_customer_id, stripe_subscription_id, stripe_account_id, stripe_onboarded, stripe_charges_enabled, deposit_instructions'

export async function requireProviderAuth(req, supabase) {
  const auth = await requireAuthOnly(req, supabase)
  if (!auth.ok) return auth

  const email = String(auth.user.email || '').toLowerCase().trim()

  let { data: provider } = await supabase.from('ag_providers').select(PROVIDER_COLS)
    .eq('owner_user_id', auth.user.id).maybeSingle()
  if (!provider && email) {
    const byEmail = await supabase.from('ag_providers').select(PROVIDER_COLS).eq('email', email).maybeSingle()
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

/** Assinatura em teste ou ativa. */
export function planActive(provider) {
  return ['trialing', 'active'].includes(provider?.plan_status)
}

/** Chamada administrativa (painel admin / scripts). */
export function isAdmin(req) {
  const s = req.headers?.['x-admin-secret']
  return !!s && !!process.env.ADMIN_SECRET && s === process.env.ADMIN_SECRET
}
