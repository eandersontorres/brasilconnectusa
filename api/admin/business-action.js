/**
 * POST /api/admin/business-action
 *
 * Admin aprova ou rejeita um negócio pendente em bc_businesses.
 *
 * Body: { business_id, action, reason? }
 *   action: 'approve' | 'reject' | 'archive'
 *   reason: opcional, gravado em status_notes (futuro)
 *
 * Headers: x-admin-secret
 *
 * Resposta: { success, business: { id, name, status, active } }
 */

import { createClient } from '@supabase/supabase-js'

const VALID_ACTIONS = new Set(['approve', 'reject', 'archive'])

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { business_id, action } = req.body || {}
  if (!business_id || !VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'business_id e action (approve|reject|archive) obrigatorios' })
  }

  const update =
    action === 'approve'  ? { status: 'approved', active: true }  :
    action === 'reject'   ? { status: 'rejected', active: false } :
    action === 'archive'  ? { status: 'archived', active: false } :
    null

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const { data, error } = await supabase
      .from('bc_businesses')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', business_id)
      .select('id, name, slug, status, active')
      .single()

    if (error || !data) return res.status(404).json({ error: 'Negocio nao encontrado' })

    return res.status(200).json({ success: true, business: data, action })
  } catch (e) {
    console.error('admin/business-action error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
