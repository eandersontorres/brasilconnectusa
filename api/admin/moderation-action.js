/**
 * /api/admin/moderation-action — ações sobre item da fila do agente
 *
 * POST { target_type, target_id, action }
 *   action = 'approve'  → libera (agent_status='reviewed', is_deleted=false se estava auto_hidden)
 *   action = 'hide'     → confirma ocultação (is_deleted=true, agent_status='reviewed')
 *   action = 'ban_user' → bane o user dono do conteúdo + esconde o item
 *
 * Cada ação cria log em bc_reports com reviewer_id e action_taken.
 */

import { createClient } from '@supabase/supabase-js'

const TABLE_BY_TYPE = {
  post: 'bc_posts',
  comment: 'bc_comments',
  business: 'bc_businesses',
  profile: 'bc_profiles',
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { target_type, target_id, action, admin_notes } = req.body || {}
  if (!target_type || !target_id || !action) {
    return res.status(400).json({ error: 'target_type, target_id e action obrigatórios' })
  }
  const table = TABLE_BY_TYPE[target_type]
  if (!table) return res.status(400).json({ error: 'target_type inválido' })

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  try {
    // Pega item pra ter author_id
    const { data: item } = await sb.from(table)
      .select(target_type === 'profile' ? 'user_id' : 'author_id')
      .eq('id', target_id)
      .single()

    const userId = item?.author_id || item?.user_id || null
    const now = new Date().toISOString()

    if (action === 'approve') {
      const update = { agent_status: 'reviewed' }
      if (target_type === 'post' || target_type === 'comment') update.is_deleted = false
      if (target_type === 'business') update.active = true
      await sb.from(table).update(update).eq('id', target_id)
    }
    else if (action === 'hide') {
      const update = { agent_status: 'reviewed' }
      if (target_type === 'post' || target_type === 'comment') update.is_deleted = true
      if (target_type === 'business') update.active = false
      await sb.from(table).update(update).eq('id', target_id)
    }
    else if (action === 'ban_user') {
      if (!userId) return res.status(400).json({ error: 'Item sem user_id, não dá pra banir' })
      const update = { agent_status: 'reviewed' }
      if (target_type === 'post' || target_type === 'comment') update.is_deleted = true
      if (target_type === 'business') update.active = false
      await sb.from(table).update(update).eq('id', target_id)

      // Insere em bc_banned_users (UPSERT manual)
      await sb.from('bc_banned_users').upsert({
        user_id: userId,
        reason: admin_notes || 'Banido via fila do agente IA',
        banned_by: 'admin',
        banned_at: now,
      }, { onConflict: 'user_id' })
    }
    else {
      return res.status(400).json({ error: 'action inválida (use approve|hide|ban_user)' })
    }

    // Log na tabela de reports pra rastro unificado
    await sb.from('bc_reports').insert({
      reporter_id: null,
      target_type, target_id,
      reason: 'agent_review',
      details: `[Agente IA] Ação admin: ${action}${admin_notes ? ' — ' + admin_notes : ''}`,
      status: 'actioned',
      action_taken: action === 'ban_user' ? 'banned_user' : (action === 'hide' ? 'removed_post' : 'none'),
      admin_notes: admin_notes || null,
      reviewed_at: now,
    })

    return res.status(200).json({ success: true })
  } catch (e) {
    console.error('moderation-action error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
