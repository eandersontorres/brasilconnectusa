// ════════════════════════════════════════════════════════════════════════════
//   apiFetch — wrapper pra reusar os endpoints REST do web.
//   Prepende a base URL e injeta Authorization Bearer com o JWT do Supabase.
// ════════════════════════════════════════════════════════════════════════════
import Constants from 'expo-constants'
import { supabase } from './supabase'

const API_BASE = Constants.expoConfig?.extra?.apiBase || 'https://brasilconnect.com'

export async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, { ...opts, headers })
  return res
}

export async function apiJson(path, opts = {}) {
  const res = await apiFetch(path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}
