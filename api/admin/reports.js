/**
 * /api/admin/reports — moderacao de denuncias
 * GET ?status=pending|all → lista
 * POST ?action=resolve { report_id, status, action_taken, admin_notes }
 *      → marca como reviewed/dismissed/actioned + opcionalmente apaga post
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  try {
    if (req.method === 'GET') {
      const { status = 'pending', limit = 50 } = req.query
      let q = supabase.from('bc_reports')
        .select('id, target_type, target_id, reason, details, reporter_id, status, action_taken, admin_notes, created_at, reviewed_at')
        .order('created_at', { ascending: false })
        .limit(Number(limit))
      if (status !== 'all') q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return res.status(200).json({ success: true, reports: data || [] })
    }

    if (req.method === 'POST' && req.query?.action === 'resolve') {
      const { report_id, status: newStatus, action_taken, admin_notes, delete_target } = req.body || {}
      if (!report_id || !newStatus) return res.status(400).json({ error: 'report_id e status obrigatorios' })

      const { data: report, error: e1 } = await supabase
        .from('bc_reports')
        .update({
          status: newStatus,
          action_taken: action_taken || null,
          admin_notes: admin_notes || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', report_id)
        .select()
        .single()
      if (e1) throw e1

      // Se admin pediu pra deletar o post/comment denunciado
      if (delete_target && report) {
        if (report.target_type === 'post') {
          await supabase.from('bc_posts').update({ is_deleted: true }).eq('id', report.target_id)
        } else if (report.target_type === 'comment') {
          await supabase.from('bc_comments').update({ is_deleted: true }).eq('id', report.target_id)
        }
      }

      return res.status(200).json({ success: true, report })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('admin/reports error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
