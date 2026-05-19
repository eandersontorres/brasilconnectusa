/**
 * /api/admin/feedback — fila de feedback in-app pra admin
 *
 * GET ?status=open|all&type=bug|suggestion|question&limit=50
 *   → lista feedback
 *
 * POST ?action=resolve { id, status, admin_notes? }
 *   status: 'reviewing' | 'resolved' | 'dismissed'
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  try {
    if (req.method === 'GET') {
      const status = req.query.status || 'open'
      const type   = req.query.type   || 'all'
      const limit  = Math.min(Number(req.query.limit) || 50, 200)

      let q = sb.from('bc_feedback')
        .select('id, user_id, user_email, type, message, url, user_agent, status, admin_notes, reviewed_by, reviewed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (status !== 'all') q = q.eq('status', status)
      if (type !== 'all')   q = q.eq('type', type)

      const { data, error } = await q
      if (error) throw error
      return res.status(200).json({ success: true, items: data || [] })
    }

    if (req.method === 'POST' && req.query?.action === 'resolve') {
      const { id, status, admin_notes } = req.body || {}
      if (!id || !status) return res.status(400).json({ error: 'id e status obrigatórios' })
      const validStatuses = ['reviewing', 'resolved', 'dismissed', 'open']
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'status inválido' })
      }

      const { error } = await sb.from('bc_feedback').update({
        status,
        admin_notes: admin_notes || null,
        reviewed_by: 'admin',
        reviewed_at: new Date().toISOString(),
      }).eq('id', id)

      if (error) throw error
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('admin/feedback error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
