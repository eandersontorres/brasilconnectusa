// ────────────────────────────────────────────────────────────────────────────
//   Onboarding Gate — chamado ANTES de cada acao que cria conteudo.
//
//   Decide:
//     - Sem user logado  -> dispatch 'bc-open-auth' (abre AuthModal)
//     - User sem profile completo -> dispatch 'bc-require-onboarding' (abre OnboardingFlow)
//     - User OK -> retorna true, executa a acao
//
//   Cache de 60s em memoria pra evitar fetch a cada vote/comment.
//   Invalida quando OnboardingFlow completa (event 'bc-onboarding-done').
// ────────────────────────────────────────────────────────────────────────────
import { apiFetch } from './apiFetch'

let cached = null         // { user_id, needs_onboarding, fetchedAt }
const CACHE_MS = 60_000   // 1 min

// Invalida cache quando user completa o onboarding em qualquer lugar
if (typeof window !== 'undefined') {
  window.addEventListener('bc-onboarding-done', () => { cached = null })
  window.addEventListener('bc-auth-signed-out', () => { cached = null })
}

async function fetchNeedsOnboarding(user_id) {
  if (cached && cached.user_id === user_id && (Date.now() - cached.fetchedAt) < CACHE_MS) {
    return cached.needs_onboarding
  }
  try {
    const r = await apiFetch('/api/profile?user_id=' + user_id)
    const d = await r.json()
    cached = { user_id, needs_onboarding: !!d.needs_onboarding, fetchedAt: Date.now() }
    return cached.needs_onboarding
  } catch (_) {
    // Em caso de erro de rede, libera a acao (best effort — nao bloqueia)
    return false
  }
}

/**
 * Verifica se o user pode executar uma acao "de criacao" (postar, votar, etc).
 * Se nao, dispara o evento certo (auth ou onboarding) e retorna false.
 *
 * Uso:
 *   const ok = await requireOnboarding(user)
 *   if (!ok) return
 *   // ... executar acao
 */
export async function requireOnboarding(user) {
  if (typeof window === 'undefined') return true

  if (!user) {
    window.dispatchEvent(new CustomEvent('bc-open-auth'))
    return false
  }

  const needs = await fetchNeedsOnboarding(user.id)
  if (needs) {
    window.dispatchEvent(new CustomEvent('bc-require-onboarding'))
    return false
  }
  return true
}

// Marcador exportado caso queiramos invalidar manualmente (ex: depois de upsert profile)
export function invalidateOnboardingCache() {
  cached = null
}
