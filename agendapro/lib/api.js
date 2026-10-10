// Cliente das APIs do site (/api/agenda/*, /api/stripe/*, /api/upload).
// Manda o JWT da sessão e transforma erro HTTP em ApiError com `code`.
//
//   import { api, post, del } from '../lib/api'
//   const { services } = await api('/api/agenda/services?mine=1')
//   await post('/api/agenda/services', { name, price_cents })
//
// Erro 402 de plano: e.code === 'plan_required' (e.feature, e.minPlan) ou
// 'limit_reached'. Use showError(e) de lib/gate.js pra mostrar o cadeado certo.
import { supabase } from './supabase'
import { API_BASE, DEMO, DEMO_PLAN, DEMO_VERTICAL } from './config'

// Modo demonstração (EXPO_PUBLIC_DEMO=1): nada vai pra rede. lib/demo/server.js responde
// em memória com as mesmas rotas e formatos. Desligado, o módulo nem é carregado.
let demo = null
if (DEMO) demo = require('./demo/server').createDemoServer({ plan: DEMO_PLAN, vertical: DEMO_VERTICAL, siteUrl: API_BASE })

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body || {}
    this.feature = body?.feature || null
    this.minPlan = body?.min_plan || null
  }
  get isPlan() { return this.code === 'plan_required' || this.code === 'limit_reached' }
  get isOffline() { return this.status === 0 }
}

async function token() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || null
}

export async function api(path, opts = {}) {
  const headers = { Accept: 'application/json', ...(opts.headers || {}) }
  const t = demo ? null : await token()     // demo: sem login de verdade
  if (t) headers.Authorization = `Bearer ${t}`
  let body = opts.body
  if (body && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }

  let res
  try {
    // Demo: mesma resposta (ok, status, text()) vinda da memória
    res = demo
      ? await demo.fetch(path, { method: opts.method || 'GET', body })
      : await fetch(API_BASE + path, { method: opts.method || 'GET', headers, body })
  } catch (e) {
    throw new ApiError('Sem conexão. Confira a internet e tente de novo.', { status: 0, code: 'offline' })
  }

  const text = await res.text()
  let data = null
  if (opts.raw) data = text
  else {
    try { data = text ? JSON.parse(text) : {} } catch (_) { data = { error: text.slice(0, 200) } }
  }

  if (!res.ok) {
    const msg = (data && data.error) || `Erro ${res.status}`
    throw new ApiError(msg, { status: res.status, code: data?.code || (res.status === 401 ? 'auth' : null), body: data })
  }
  return data
}

export const post = (path, body) => api(path, { method: 'POST', body: body || {} })
export const del = (path) => api(path, { method: 'DELETE' })
