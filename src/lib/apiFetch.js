import { supabase } from './supabase'

/**
 * apiFetch — wrapper de fetch que adiciona Authorization: Bearer <token>
 * automaticamente pegando o token da sessao atual do Supabase.
 *
 * Uso identico ao fetch nativo:
 *   const r = await apiFetch('/api/social?action=create-post', {
 *     method: 'POST', headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ community_id, type, title }),
 *   })
 *
 * Se nao houver sessao, faz fetch normal sem header — o backend vai
 * responder 401 e o caller deve tratar (ex: abrir modal de login).
 */
export async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) }

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = 'Bearer ' + session.access_token
    }
  } catch (_) {
    // sem token, faz fetch normal
  }

  return fetch(url, { ...options, headers })
}
