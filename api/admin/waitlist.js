/**
 * GET /api/admin/waitlist
 *
 * Lista de espera com proteção via header x-admin-secret.
 * Retorna JSON com signups ordenados do mais recente.
 *
 * Autenticação:
 *   Header: x-admin-secret: <ADMIN_SECRET do .env>
 *
 * Query params:
 *   ?limit=100        (max 1000)
 *   ?format=csv       (default: json)
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET) {
    return res.status(500).json({ error: 'ADMIN_SECRET não configurado' })
  }
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const limit = Math.min(parseInt(req.query.limit) || 200, 1000)
  const format = (req.query.format || 'json').toLowerCase()

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { data, error, count } = await supabase
      .from('bc_waitlist')
      .select('id, email, city, source, created_at, notified', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    const { data: byCity } = await supabase
      .from('bc_waitlist_by_city')
      .select('*')
      .limit(20)

    const { data: bySourceRaw } = await supabase
      .from('bc_waitlist')
      .select('source')

    const sourceCount = {}
    ;(bySourceRaw || []).forEach(row => {
      const k = row.source || '(unknown)'
      sourceCount[k] = (sourceCount[k] || 0) + 1
    })

    if (format === 'csv') {
      const csvRows = [
        ['email', 'city', 'source', 'created_at', 'notified'].join(','),
        ...data.map(r => [
          r.email,
          (r.city || '').replace(/,/g, ' '),
          r.source || '',
          r.created_at,
          r.notified ? 'true' : 'false',
        ].join(','))
      ]
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="waitlist_${new Date().toISOString().slice(0,10)}.csv"`)
      return res.status(200).send(csvRows.join('\n'))
    }

    return res.status(200).json({
      total: count,
      returned: data.length,
      signups: data,
      stats: {
        byCity: byCity || [],
        bySource: sourceCount,
      }
    })
  } catch (e) {
    console.error('Admin waitlist error:', e.message)
    return res.status(500).json({ error: 'Erro interno' })
  }
}
