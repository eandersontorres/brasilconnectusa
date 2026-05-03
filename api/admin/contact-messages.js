/**
 * GET /api/admin/contact-messages
 * Lista mensagens do Fale Conosco (admin only)
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
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const { status = 'new', limit = 100 } = req.query

    let q = supabase.from('bc_contact_messages')
      .select('id, name, email, reason, message, status, created_at')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (status && status !== 'all') q = q.eq('status', status)

    const { data, error } = await q
    if (error) throw error

    return res.status(200).json({ success: true, messages: data || [] })
  } catch (e) {
    console.error('admin/contact-messages error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
