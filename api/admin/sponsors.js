/**
 * /api/admin/sponsors — CRUD admin de patrocinadores
 *
 * Headers: x-admin-secret
 *
 * GET    /api/admin/sponsors                    -> lista todos
 * POST   /api/admin/sponsors?action=upsert      -> cria ou atualiza (id opcional)
 * POST   /api/admin/sponsors?action=delete      -> { id }
 * POST   /api/admin/sponsors?action=toggle      -> { id, active } (pausa/ativa)
 * GET    /api/admin/sponsors?action=stats&id=X  -> impressions/clicks daquele sponsor
 */

import { createClient } from '@supabase/supabase-js'

const VALID_PLACEMENTS = new Set(['sidebar', 'feed', 'events_top', 'category_top'])
const VALID_STATUS = new Set(['pending', 'approved', 'paused', 'expired'])

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const action = req.query.action

  try {
    // ─── GET lista ───────────────────────────────────────────────────────
    if (req.method === 'GET' && !action) {
      const { data, error } = await supabase
        .from('bc_sponsors')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return res.status(200).json({ success: true, sponsors: data || [] })
    }

    // ─── GET stats de um sponsor ─────────────────────────────────────────
    if (req.method === 'GET' && action === 'stats') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id obrigatorio' })

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: events } = await supabase
        .from('bc_sponsor_events')
        .select('event_type, created_at, user_geo')
        .eq('sponsor_id', id)
        .gte('created_at', since)
        .limit(5000)

      const impressions = (events || []).filter(e => e.event_type === 'impression').length
      const clicks      = (events || []).filter(e => e.event_type === 'click').length
      const ctr         = impressions > 0 ? (clicks / impressions) * 100 : 0

      return res.status(200).json({
        success: true,
        sponsor_id: id,
        window: '30d',
        impressions, clicks, ctr: Number(ctr.toFixed(2)),
        events_sample: (events || []).slice(0, 20),
      })
    }

    // ─── POST upsert ─────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'upsert') {
      const b = req.body || {}
      if (!b.name || !b.website_url) {
        return res.status(400).json({ error: 'name e website_url obrigatorios' })
      }

      const placement = Array.isArray(b.placement) && b.placement.length > 0
        ? b.placement.filter(p => VALID_PLACEMENTS.has(p))
        : ['sidebar']

      const status = b.status && VALID_STATUS.has(b.status) ? b.status : 'approved'

      const payload = {
        name: String(b.name).trim().slice(0, 120),
        logo_url: b.logo_url || null,
        website_url: String(b.website_url).trim(),
        blurb: b.blurb ? String(b.blurb).trim().slice(0, 200) : null,
        cta_label: b.cta_label ? String(b.cta_label).trim().slice(0, 30) : 'Saiba mais',
        geo_state: Array.isArray(b.geo_state) ? b.geo_state.map(s => String(s).toUpperCase().slice(0, 2)) : null,
        geo_city: Array.isArray(b.geo_city) ? b.geo_city : null,
        interests: Array.isArray(b.interests) ? b.interests : null,
        module: b.module || null,
        placement,
        active: b.active !== false,
        start_date: b.start_date || null,
        end_date: b.end_date || null,
        status,
        business_id: b.business_id || null,
        monthly_price: b.monthly_price ? Number(b.monthly_price) : null,
        notes: b.notes || null,
        updated_at: new Date().toISOString(),
      }

      let result
      if (b.id) {
        const { data, error } = await supabase
          .from('bc_sponsors').update(payload).eq('id', b.id).select().single()
        if (error) throw error
        result = data
      } else {
        const { data, error } = await supabase
          .from('bc_sponsors').insert(payload).select().single()
        if (error) throw error
        result = data
      }
      return res.status(200).json({ success: true, sponsor: result })
    }

    // ─── POST toggle (pause/ativa) ───────────────────────────────────────
    if (req.method === 'POST' && action === 'toggle') {
      const { id, active } = req.body || {}
      if (!id) return res.status(400).json({ error: 'id obrigatorio' })
      const { data, error } = await supabase
        .from('bc_sponsors')
        .update({ active: !!active, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      if (error) throw error
      return res.status(200).json({ success: true, sponsor: data })
    }

    // ─── POST delete ─────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete') {
      const { id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'id obrigatorio' })
      const { error } = await supabase.from('bc_sponsors').delete().eq('id', id)
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'action invalida' })
  } catch (e) {
    console.error('admin/sponsors error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
