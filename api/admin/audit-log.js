/**
 * GET /api/admin/audit-log?limit=100&actor=&path=
 * Ultimas acoes feitas no painel admin (tabela bc_admin_audit).
 */
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '../_lib/adminAuth.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const admin = await requireAdmin(req)
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error })

  const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500)
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  let q = supabase.from('bc_admin_audit')
    .select('id, at, actor_email, actor_kind, method, path, action, target_id, details, ip')
    .order('at', { ascending: false })
    .limit(limit)
  if (req.query.actor) q = q.eq('actor_email', String(req.query.actor).toLowerCase())
  if (req.query.path) q = q.eq('path', String(req.query.path))

  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ entries: data || [], you: admin.actor })
}
