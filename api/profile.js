/**
 * BrasilConnect — API Profile
 *
 * GET  /api/profile?user_id=UUID                  → busca perfil + checklist
 * POST /api/profile?action=upsert                 → cria/atualiza perfil
 *      body: { user_id, email?, full_name?, display_name?, avatar_url?, bio?, city?, state?, whatsapp?, instagram?, interests? }
 * POST /api/profile?action=onboarding-step        → atualiza step do onboarding
 *      body: { user_id, step (1-5), data: {...} }
 * POST /api/profile?action=complete-onboarding    → marca onboarding como completo
 *      body: { user_id }
 * POST /api/profile?action=accept-guidelines      → aceita as diretrizes
 *      body: { user_id }
 * POST /api/profile?action=checklist-mark         → marca step do checklist como done
 *      body: { user_id, step_key }
 */

import { createClient } from '@supabase/supabase-js'

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'
])

const VALID_CHECKLIST_STEPS = new Set([
  'introduce', 'first_question', 'invite', 'add_photo', 'attend_event',
])

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

function err(res, code, msg) {
  return res.status(code).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabase = getSupabase()
  const action = req.query?.action

  try {
    // ══════════ GET: perfil + checklist ═══════════════════════════════════
    if (req.method === 'GET') {
      const { user_id } = req.query
      if (!user_id) return err(res, 400, 'user_id é obrigatório')

      const { data: profile } = await supabase
        .from('bc_profiles')
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle()

      const { data: checklist } = await supabase
        .from('bc_profile_checklist')
        .select('step_key, completed_at')
        .eq('user_id', user_id)

      return res.status(200).json({
        success: true,
        profile: profile || null,
        checklist: checklist || [],
        needs_onboarding: !profile || !profile.onboarding_completed,
      })
    }

    // ══════════ POST: upsert (cria ou atualiza) ════════════════════════════
    if (req.method === 'POST' && action === 'upsert') {
      const b = req.body || {}
      if (!b.user_id) return err(res, 400, 'user_id é obrigatório')

      // Validações
      if (b.state && !VALID_STATES.has(String(b.state).toUpperCase())) {
        return err(res, 400, 'Estado USA inválido')
      }

      const update = {
        user_id: b.user_id,
        updated_at: new Date().toISOString(),
      }
      if (b.email !== undefined)        update.email = b.email ? String(b.email).toLowerCase() : null
      if (b.full_name !== undefined)    update.full_name = b.full_name ? String(b.full_name).trim().slice(0, 100) : null
      if (b.display_name !== undefined) update.display_name = b.display_name ? String(b.display_name).trim().slice(0, 50) : null
      if (b.avatar_url !== undefined)   update.avatar_url = b.avatar_url || null
      if (b.bio !== undefined)          update.bio = b.bio ? String(b.bio).slice(0, 500) : null
      if (b.city !== undefined)         update.city = b.city ? String(b.city).trim() : null
      if (b.state !== undefined)        update.state = b.state ? String(b.state).toUpperCase() : null
      if (b.whatsapp !== undefined)     update.whatsapp = b.whatsapp || null
      if (b.instagram !== undefined)    update.instagram = b.instagram || null
      if (b.interests !== undefined)    update.interests = Array.isArray(b.interests) ? b.interests.slice(0, 20) : null

      const { data, error } = await supabase
        .from('bc_profiles')
        .upsert(update, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, profile: data })
    }

    // ══════════ POST: onboarding-step (salva progresso) ════════════════════
    if (req.method === 'POST' && action === 'onboarding-step') {
      const { user_id, step, data: stepData } = req.body || {}
      if (!user_id || step === undefined) return err(res, 400, 'user_id e step obrigatórios')

      const stepNum = Number(step)
      if (stepNum < 0 || stepNum > 10) return err(res, 400, 'step inválido')

      const update = {
        user_id,
        onboarding_step: stepNum,
        updated_at: new Date().toISOString(),
        ...(stepData || {}),
      }
      // Se incluiu state, valida
      if (update.state) {
        if (!VALID_STATES.has(String(update.state).toUpperCase())) return err(res, 400, 'Estado USA inválido')
        update.state = String(update.state).toUpperCase()
      }

      // Auto-geocode se setou city + state (best effort, nao bloqueia)
      if (update.city && update.state) {
        try {
          const { geocodeWithCache } = await import('./geocode.js')
          const geo = await geocodeWithCache(update.city, update.state)
          if (geo) {
            update.latitude = geo.latitude
            update.longitude = geo.longitude
          }
        } catch (geoErr) {
          console.error('geocode skipped:', geoErr.message)
        }
      }

      const { data, error } = await supabase
        .from('bc_profiles')
        .upsert(update, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, profile: data })
    }

    // ══════════ POST: complete-onboarding ══════════════════════════════════
    if (req.method === 'POST' && action === 'complete-onboarding') {
      const { user_id } = req.body || {}
      if (!user_id) return err(res, 400, 'user_id obrigatório')

      const { data, error } = await supabase
        .from('bc_profiles')
        .update({
          onboarding_completed: true,
          welcomed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)
        .select()
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, profile: data })
    }

    // ══════════ POST: accept-guidelines ════════════════════════════════════
    if (req.method === 'POST' && action === 'accept-guidelines') {
      const { user_id } = req.body || {}
      if (!user_id) return err(res, 400, 'user_id obrigatório')

      const { data, error } = await supabase
        .from('bc_profiles')
        .upsert({
          user_id,
          guidelines_accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, profile: data })
    }

    // ══════════ POST: checklist-mark ════════════════════════════════════════
    if (req.method === 'POST' && action === 'checklist-mark') {
      const { user_id, step_key } = req.body || {}
      if (!user_id || !step_key) return err(res, 400, 'user_id e step_key obrigatórios')
      if (!VALID_CHECKLIST_STEPS.has(step_key)) return err(res, 400, 'step_key inválido')

      const { data, error } = await supabase
        .from('bc_profile_checklist')
        .upsert({ user_id, step_key }, { onConflict: 'user_id,step_key' })
        .select()
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, mark: data })
    }

    return err(res, 405, 'action ou método inválido')
  } catch (e) {
    console.error('profile api error:', e.message)
    return err(res, 500, 'Erro interno: ' + e.message)
  }
}
