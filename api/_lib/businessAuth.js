/**
 * Helper de auth pra endpoints de gerenciamento de negocio.
 * Substitui o "email-only lookup" (que era trivialmente falsificavel) por:
 *   - Authorization: Bearer <JWT do Supabase>
 *   - Backend valida JWT -> extrai email -> confirma que e dono do business_id
 *
 * Uso:
 *   import { requireBusinessAuth } from '../_lib/businessAuth.js'
 *
 *   const auth = await requireBusinessAuth(req, supabase, business_id)
 *   if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
 *   const { user, business } = auth  // garantia: user.email == business.owner_email
 */

export async function requireBusinessAuth(req, supabase, business_id) {
  if (!business_id) {
    return { ok: false, status: 400, error: 'business_id obrigatorio' }
  }

  // 1) Extrai Bearer token
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Token de autenticacao ausente (Bearer ...)' }
  }
  const token = authHeader.slice(7).trim()
  if (!token) {
    return { ok: false, status: 401, error: 'Token vazio' }
  }

  // 2) Valida token com Supabase
  let user
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return { ok: false, status: 401, error: 'Token invalido ou expirado' }
    }
    user = data.user
  } catch (e) {
    return { ok: false, status: 401, error: 'Erro ao validar token: ' + e.message }
  }

  // 3) Busca o business
  const { data: business, error: bizErr } = await supabase
    .from('bc_businesses')
    .select('id, name, slug, owner_email, owner_user_id, status, active, accepts_orders, stripe_account_id, stripe_charges_enabled, stripe_onboarded, platform_fee_pct, delivery_fee_cents, min_order_cents, pickup_only, prep_time_min, delivery_radius_miles')
    .eq('id', business_id)
    .single()

  if (bizErr || !business) {
    return { ok: false, status: 404, error: 'Negocio nao encontrado' }
  }

  // 4) Confirma ownership
  const userEmail  = String(user.email || '').toLowerCase().trim()
  const ownerEmail = String(business.owner_email || '').toLowerCase().trim()

  // Match por user_id (preferido — anti-collision) OU por email
  const ownsByUserId = business.owner_user_id && business.owner_user_id === user.id
  const ownsByEmail  = ownerEmail && ownerEmail === userEmail

  if (!ownsByUserId && !ownsByEmail) {
    return {
      ok: false,
      status: 403,
      error: 'Voce nao e dono desse negocio (email do token: ' + userEmail + ' != owner: ' + ownerEmail + ')',
    }
  }

  // 5) Auto-link user_id se faltava (one-time backfill)
  if (!business.owner_user_id && ownsByEmail) {
    await supabase
      .from('bc_businesses')
      .update({ owner_user_id: user.id })
      .eq('id', business_id)
      .catch(() => {}) // nao bloqueia se falhar
  }

  return { ok: true, user, business }
}

/**
 * Variante que NAO requer business_id — so valida que tem token valido.
 * Util pra endpoints como "lista os meus negocios" (sem ID conhecido ainda).
 * Retorna { ok, user } ou { ok: false, status, error }.
 */
export async function requireAuthOnly(req, supabase) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Token ausente' }
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { ok: false, status: 401, error: 'Token vazio' }

  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return { ok: false, status: 401, error: 'Token invalido' }
    return { ok: true, user: data.user }
  } catch (e) {
    return { ok: false, status: 401, error: e.message }
  }
}
