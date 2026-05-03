/**
 * GET /api/admin/enterprise-leads
 * Lista leads do plano Enterprise (admin only)
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { status = 'all', limit = 100 } = req.query

    let q = supabase.from('bc_enterprise_leads')
      .select('id, name, email, whatsapp, company, sector, team_size, interest, message, status, source_url, created_at, contacted_at, notes')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (status && status !== 'all') q = q.eq('status', status)

    const { data, error } = await q
    if (error) throw error

    return res.status(200).json({ success: true, leads: data || [] })
  } catch (e) {
    console.error('admin/enterprise-leads error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
