/**
 * GET /api/admin/businesses-list
 *
 * Lista admin de TODOS os negocios da plataforma (qualquer status).
 * Retorna campos sensiveis (owner_email, Stripe IDs, etc) que o endpoint
 * publico (/api/businesses/list) nao expoe.
 *
 * Headers: x-admin-secret
 *
 * Query params:
 *   ?status=<string>     -> pending | approved | rejected | archived | all (default: all)
 *   ?q=<string>          -> busca por nome/cidade/email (ILIKE)
 *   ?category=<string>   -> filtra categoria
 *   ?state=<XX>          -> filtra estado USA
 *   ?stripe=<bool>       -> filtra so com Stripe Connect ativo
 *   ?limit=<int>         -> default 200, max 500
 *
 * Resposta:
 *   { businesses: [...], summary: { total, by_status: {...}, with_stripe, ... } }
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    const status   = req.query.status || 'all'
    const q        = req.query.q ? String(req.query.q).trim() : null
    const category = req.query.category || null
    const state    = req.query.state || null
    const stripe   = req.query.stripe
    const limit    = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 1), 500)

    let query = supabase.from('bc_businesses')
      .select(`
        id, name, slug, category,
        city, state, address, zip,
        phone, whatsapp, website, instagram, facebook,
        submitted_email, owner_email, owner_user_id,
        description, short_desc, emoji, color,
        status, active, featured, verified,
        rating, reviews, clicks_count,
        accepts_orders, stripe_charges_enabled, stripe_onboarded, stripe_account_id,
        platform_fee_pct, listing_plan, plan,
        created_at, updated_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (category)                   query = query.eq('category', category)
    if (state)                      query = query.eq('state', state)
    if (stripe === 'true')          query = query.eq('stripe_charges_enabled', true)
    if (stripe === 'false')         query = query.eq('stripe_charges_enabled', false)
    if (q) {
      // busca por nome OU cidade OU email
      const esc = q.replace(/[%_]/g, ch => '\\' + ch)
      query = query.or(`name.ilike.%${esc}%,city.ilike.%${esc}%,submitted_email.ilike.%${esc}%,owner_email.ilike.%${esc}%`)
    }

    const { data: businesses, error } = await query
    if (error) throw error

    // ─── Summary metrics (count separado, sem filtros) ─────────────
    const { data: all } = await supabase
      .from('bc_businesses')
      .select('status, stripe_charges_enabled, accepts_orders, created_at')

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const week  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const summary = {
      total:               all?.length || 0,
      pending:             (all || []).filter(b => b.status === 'pending').length,
      approved:            (all || []).filter(b => b.status === 'approved').length,
      rejected:            (all || []).filter(b => b.status === 'rejected').length,
      archived:            (all || []).filter(b => b.status === 'archived').length,
      with_stripe:         (all || []).filter(b => b.stripe_charges_enabled).length,
      accepting_orders:    (all || []).filter(b => b.accepts_orders).length,
      created_today:       (all || []).filter(b => new Date(b.created_at) >= today).length,
      created_week:        (all || []).filter(b => new Date(b.created_at) >= week).length,
    }

    return res.status(200).json({
      success: true,
      businesses: businesses || [],
      summary,
      filter: { status, q, category, state, stripe },
    })
  } catch (e) {
    console.error('admin/businesses-list error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
