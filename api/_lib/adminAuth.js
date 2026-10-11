/**
 * Auth do painel admin.
 *
 *   import { requireAdmin } from '../_lib/adminAuth.js'
 *   const admin = await requireAdmin(req)
 *   if (!admin.ok) return res.status(admin.status).json({ error: admin.error })
 *   // admin.actor = e-mail de quem esta agindo ('secret' quando veio pela senha compartilhada)
 *
 * Aceita, nesta ordem:
 *   1. Authorization: Bearer <JWT do Supabase> de um usuario com bc_profiles.role = 'admin'
 *      (ou cujo e-mail esteja em ADMIN_EMAILS, separado por virgula).
 *   2. x-admin-secret igual a ADMIN_SECRET (scripts, crons e a transicao do painel).
 *
 * Toda chamada que altera algo (POST/PUT/PATCH/DELETE) fica registrada em bc_admin_audit,
 * com quem fez, a rota, a acao e os ids envolvidos. Leituras nao sao registradas.
 */
import { createClient } from '@supabase/supabase-js'

const AUDIT_KEYS = ['action', 'id', 'business_id', 'user_id', 'request_id', 'report_id', 'order_id', 'match_id', 'message_id', 'lead_id', 'sponsor_id', 'entry_id', 'provider_id', 'appointment_id', 'role', 'status', 'reason', 'decision', 'home_score', 'away_score', 'product_id', 'seller_id', 'review_id']

function service() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

function secretOk(req) {
  const s = req.headers?.['x-admin-secret'] || req.query?.admin_secret || req.body?.admin_secret
  return !!s && !!process.env.ADMIN_SECRET && s === process.env.ADMIN_SECRET
}

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim())
  return m ? m[1] : null
}

/** Resolve quem esta chamando, sem registrar nada. */
export async function identifyAdmin(req, supabase) {
  if (secretOk(req)) return { ok: true, actor: 'secret', kind: 'secret' }

  const token = bearer(req)
  if (!token) return { ok: false, status: 401, error: 'Acesso restrito. Entre com uma conta de administrador.' }

  const sb = supabase || service()
  const { data: { user } = {}, error } = await sb.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, error: 'Sessão inválida ou expirada. Entre de novo.' }

  const email = String(user.email || '').toLowerCase()
  const allow = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  let isAdmin = allow.includes(email)
  if (!isAdmin) {
    const { data: prof } = await sb.from('bc_profiles').select('role').eq('user_id', user.id).maybeSingle()
    isAdmin = prof?.role === 'admin'
  }
  if (!isAdmin) return { ok: false, status: 403, error: 'Essa conta não é de administrador.' }
  return { ok: true, actor: email, kind: 'user', user_id: user.id }
}

function pick(obj) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  for (const k of AUDIT_KEYS) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') continue
    out[k] = typeof obj[k] === 'string' ? obj[k].slice(0, 300) : obj[k]
  }
  return out
}

/** Grava a acao. Nunca derruba a rota se falhar. */
export async function auditAdmin(req, admin, extra) {
  try {
    const sb = service()
    const path = String(req.url || '').split('?')[0]
    const body = pick(req.body)
    const query = pick(req.query)
    const action = body.action || query.action || extra?.action || null
    const target = body.business_id || body.user_id || body.request_id || body.report_id || body.order_id || body.match_id || body.product_id || body.seller_id || body.review_id || body.id || query.id || null
    const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || null
    await sb.from('bc_admin_audit').insert({
      actor_email: admin.actor,
      actor_kind: admin.kind,
      method: req.method,
      path,
      action,
      target_id: target ? String(target).slice(0, 120) : null,
      details: { ...query, ...body, ...(extra || {}) },
      ip,
      user_agent: String(req.headers?.['user-agent'] || '').slice(0, 200) || null,
    })
  } catch (e) {
    console.error('[admin-audit] falhou:', e.message)
  }
}

/** Auth + registro automatico das chamadas que alteram algo. */
export async function requireAdmin(req, supabase) {
  const admin = await identifyAdmin(req, supabase)
  if (!admin.ok) return admin
  const m = String(req.method || 'GET').toUpperCase()
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') await auditAdmin(req, admin)
  return admin
}
