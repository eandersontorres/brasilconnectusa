/**
 * /api/sponsors — endpoints publicos
 *
 * GET  /api/sponsors?placement=sidebar&state=MA&interests=tech,imigracao
 *      Retorna patrocinadores ativos filtrados pra audiencia do user.
 *      Resposta: { sponsors: [...], picked: <sponsor> } (picked = 1 random pra slot)
 *
 * GET  /api/sponsors/track?id=<sponsor_id>&type=impression&placement=sidebar
 *      Tracking leve via beacon/img. Sempre retorna 200.
 *
 * Nota: redirect de click vai pelo /api/go/sponsor?id=X (em api/go.js)
 *       — fica junto com o redirect de afiliados existente.
 */

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

// Verifica se um sponsor faz match com o user (geo, interesses, etc)
function matchesAudience(s, audience) {
  // geo_state: null/[] = qualquer; senao precisa estar no array
  if (Array.isArray(s.geo_state) && s.geo_state.length > 0) {
    if (!audience.state || !s.geo_state.includes(audience.state)) return false
  }
  // module: se sponsor tem module, user precisa estar no contexto desse modulo
  if (s.module && audience.module && s.module !== audience.module) return false
  // interests: se sponsor tem, user precisa ter pelo menos 1 em comum
  if (Array.isArray(s.interests) && s.interests.length > 0 && Array.isArray(audience.interests)) {
    const any = s.interests.some(i => audience.interests.includes(i))
    if (!any) return false
  }
  return true
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabase()

  try {
    // ─── Tracking (impression) — sub-endpoint ────────────────────────────
    if (req.query.action === 'track' || req.url?.includes('/track')) {
      const sponsor_id = req.query.id
      const event_type = (req.query.type || 'impression').toLowerCase()
      if (!sponsor_id || !['impression', 'click'].includes(event_type)) {
        return res.status(400).json({ error: 'id e type (impression|click) obrigatorios' })
      }

      const placement = req.query.placement || null
      const user_id = req.query.user_id || null
      const ua = req.headers['user-agent'] || null

      // Log granular (fire-and-forget)
      supabase.from('bc_sponsor_events').insert({
        sponsor_id, event_type, user_id, placement, user_agent: ua,
      }).then(() => {})

      // Incrementa contador no bc_sponsors (best-effort)
      const col = event_type === 'click' ? 'clicks_count' : 'impressions_count'
      const { data: cur } = await supabase.from('bc_sponsors').select(col).eq('id', sponsor_id).maybeSingle()
      if (cur) {
        await supabase.from('bc_sponsors').update({ [col]: (cur[col] || 0) + 1 }).eq('id', sponsor_id)
      }

      // Sempre 1x1 pixel pra <img beacon>
      res.setHeader('Content-Type', 'image/gif')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
    }

    // ─── List filtrada por audience ──────────────────────────────────────
    const placement = (req.query.placement || 'sidebar').toLowerCase()
    const audience = {
      state:     req.query.state     ? String(req.query.state).toUpperCase() : null,
      city:      req.query.city      || null,
      interests: req.query.interests ? String(req.query.interests).split(',').map(s => s.trim()).filter(Boolean) : [],
      module:    req.query.module    || null,
    }

    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('bc_sponsors')
      .select('id, name, logo_url, website_url, blurb, cta_label, geo_state, interests, module, placement, business_id')
      .eq('active', true)
      .eq('status', 'approved')
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .contains('placement', [placement])
      .limit(50)
    if (error) throw error

    const eligible = (data || []).filter(s => matchesAudience(s, audience))

    // Random pick (rotacao simples — pra produção, considerar weighted/priorizado)
    const picked = eligible.length > 0
      ? eligible[Math.floor(Math.random() * eligible.length)]
      : null

    return res.status(200).json({
      success: true,
      placement,
      audience,
      total: eligible.length,
      picked,
      sponsors: eligible,
    })
  } catch (e) {
    console.error('sponsors error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
