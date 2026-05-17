/**
 * GET /api/events/list
 * Query params:
 *   state, city, category, q, limit (default 100)
 *   owner_email | status — admin / dono do negócio (usa tabela base)
 *
 * Sem filtros admin → usa view bc_events_public (já filtra approved + futuros).
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { state, city, category, q, owner_email, status, limit = 100 } = req.query

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const useTable = owner_email || status ? 'bc_events' : 'bc_events_public'
    let query = supabase.from(useTable).select('*')

    if (state)       query = query.eq('state', String(state).toUpperCase())
    if (city)        query = query.ilike('city', `%${city}%`)
    if (category)    query = query.eq('category', category)
    if (q)           query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`)
    if (owner_email) query = query.eq('submitted_email', String(owner_email).toLowerCase().trim())
    if (status)      query = query.eq('status', status)

    const { data, error } = await query.limit(Number(limit))
    if (error) return res.status(500).json({ error: error.message })

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({ events: data || [] })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
