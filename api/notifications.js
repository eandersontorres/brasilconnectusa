/**
 * /api/notifications
 * GET ?user_id=UUID | ?email=X — lista (default 30 mais recentes)
 * POST ?action=mark-read           { user_id|email, ids: [UUID,...] | all: true }
 * POST ?action=create               body: { user_id|user_email, type, title, body, url, icon, metadata }  [interno/admin]
 */
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from './_lib/rateLimit.js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const _rl = rateLimit(req, { windowMs: 60_000, max: 60 })
  if (_rl) return res.status(429).json({ error: 'Rate limit. Tenta em ' + _rl.retryAfter + 's' })

  const supabase = getSupabase()
  const action = req.query?.action

  try {
    if (req.method === 'GET') {
      const { user_id, email, limit = 30, unread_only } = req.query
      if (!user_id && !email) return res.status(400).json({ error: 'user_id ou email obrigatorio' })

      let q = supabase
        .from('bc_notifications')
        .select('id, type, title, body, url, icon, metadata, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(Number(limit))

      if (user_id) q = q.eq('user_id', user_id)
      else q = q.eq('user_email', String(email).toLowerCase().trim())
      if (unread_only === '1') q = q.is('read_at', null)

      const { data, error } = await q
      if (error) throw error

      const unread = (data || []).filter(n => !n.read_at).length

      return res.status(200).json({ success: true, notifications: data || [], unread })
    }

    if (req.method === 'POST' && action === 'mark-read') {
      const { user_id, email, ids, all } = req.body || {}
      if (!user_id && !email) return res.status(400).json({ error: 'user_id ou email obrigatorio' })

      let q = supabase.from('bc_notifications').update({ read_at: new Date().toISOString() })
      if (user_id) q = q.eq('user_id', user_id)
      else q = q.eq('user_email', String(email).toLowerCase().trim())
      if (!all) {
        if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids ou all=true obrigatorio' })
        q = q.in('id', ids)
      }
      q = q.is('read_at', null)
      const { error } = await q
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    if (req.method === 'POST' && action === 'create') {
      // Auth: x-admin-secret OU vem de outro endpoint via fetch interno (dificil de validar)
      const adminSecret = req.headers['x-admin-secret']
      if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
      const { user_id, user_email, type, title, body, url, icon, metadata } = req.body || {}
      if ((!user_id && !user_email) || !type || !title) return res.status(400).json({ error: 'campos obrigatorios' })

      const { data, error } = await supabase.from('bc_notifications').insert({
        user_id: user_id || null,
        user_email: user_email ? String(user_email).toLowerCase().trim() : null,
        type, title, body, url, icon, metadata,
      }).select().single()
      if (error) throw error
      return res.status(200).json({ success: true, notification: data })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('notifications error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
