import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const { category, state, city, q, sort } = req.query
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    let query = supabase.from('bc_businesses_public').select('*')
    if (category) query = query.eq('category', category)
    if (state)    query = query.eq('state', state)
    if (city)     query = query.ilike('city', `%${city}%`)
    if (q)        query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`)
    if (sort === 'rating') query = query.order('rating_avg', { ascending: false, nullsFirst: false })
    else if (sort === 'newest') query = query.order('created_at', { ascending: false })
    const { data, error } = await query.limit(100)
    if (error) return res.status(500).json({ error: error.message })
    res.setHeader('Cache-Control', 's-maxage=120')
    return res.status(200).json({ businesses: data })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
