/**
 * /api/admin/moderation-queue — fila do agente de moderação IA
 *
 * GET ?severity=all|critical|high|medium&category=scam|illegal|spam|toxic&limit=50
 *   → lista itens flagged/auto_hidden via view bc_agent_queue
 *
 * GET ?stats=1
 *   → estatísticas: contagem por severity, custo total últimas 24h, modelo
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  try {
    // Modo estatístico
    if (req.query.stats === '1') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: logs } = await sb
        .from('bc_agent_log')
        .select('severity, cost_usd')
        .gte('created_at', since)

      const stats = {
        last_24h: {
          total: logs?.length || 0,
          by_severity: { low: 0, medium: 0, high: 0, critical: 0, error: 0 },
          cost_usd: 0,
        },
        queue: { critical: 0, high: 0, medium: 0, low: 0 },
      }
      for (const l of logs || []) {
        stats.last_24h.by_severity[l.severity] = (stats.last_24h.by_severity[l.severity] || 0) + 1
        stats.last_24h.cost_usd += Number(l.cost_usd || 0)
      }

      const { data: queueRows } = await sb
        .from('bc_agent_queue')
        .select('agent_severity')
      for (const r of queueRows || []) {
        stats.queue[r.agent_severity] = (stats.queue[r.agent_severity] || 0) + 1
      }
      return res.status(200).json({ success: true, stats })
    }

    // Lista
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const severity = req.query.severity || 'all'
    const category = req.query.category || 'all'

    let q = sb.from('bc_agent_queue').select('*').limit(limit)
    if (severity !== 'all') q = q.eq('agent_severity', severity)
    if (category !== 'all') q = q.contains('agent_categories', [category])

    const { data, error } = await q
    if (error) throw error

    return res.status(200).json({ success: true, items: data || [] })
  } catch (e) {
    console.error('moderation-queue error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
