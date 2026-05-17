/**
 * POST /api/admin/user-action
 *
 * Mutations admin sobre um usuario.
 * Body: { user_id, action, ...payload }
 *
 * Actions:
 *   - ban               { reason, expires_at? }                  → insert/upsert bc_banned_users
 *   - unban             {}                                       → delete bc_banned_users
 *   - reset_onboarding  {}                                       → bc_profiles.onboarding_completed=false, step=0
 *   - set_role          { role }                                 → bc_profiles.role = role
 *   - update_profile    { patch: { field: value, ... } }         → bc_profiles update (whitelist abaixo)
 *   - update_auth_email { new_email }                            → auth.admin.updateUserById
 *
 * Headers: x-admin-secret
 */

import { createClient } from '@supabase/supabase-js'

const PROFILE_EDITABLE = new Set([
  'full_name', 'display_name', 'avatar_url', 'bio',
  'city', 'state', 'country', 'whatsapp', 'instagram',
  'role', 'interests',
  'onboarding_completed', 'onboarding_step',
  'guidelines_accepted_at', 'welcomed_at',
])

const VALID_ROLES = new Set(['user', 'moderator', 'admin', 'partner', 'business', null, ''])

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { user_id, action, ...payload } = req.body || {}
  if (!user_id || !action) return res.status(400).json({ error: 'user_id e action obrigatorios' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    if (action === 'ban') {
      const { reason, expires_at } = payload
      if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: 'reason obrigatorio (min 3 chars)' })
      }
      // Pega email pra registrar junto
      const { data: prof } = await supabase.from('bc_profiles').select('email').eq('user_id', user_id).maybeSingle()
      const { error } = await supabase.from('bc_banned_users').upsert({
        user_id,
        email: prof?.email || null,
        reason: String(reason).trim(),
        banned_by: 'admin-console',
        banned_at: new Date().toISOString(),
        expires_at: expires_at || null,
      }, { onConflict: 'user_id' })
      if (error) throw error
      return res.status(200).json({ success: true, action: 'ban', user_id })
    }

    if (action === 'unban') {
      const { error } = await supabase.from('bc_banned_users').delete().eq('user_id', user_id)
      if (error) throw error
      return res.status(200).json({ success: true, action: 'unban', user_id })
    }

    if (action === 'reset_onboarding') {
      const { error } = await supabase.from('bc_profiles').update({
        onboarding_completed: false,
        onboarding_step: 0,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user_id)
      if (error) throw error
      // Limpa checklist tambem
      await supabase.from('bc_profile_checklist').delete().eq('user_id', user_id)
      return res.status(200).json({ success: true, action: 'reset_onboarding', user_id })
    }

    if (action === 'set_role') {
      const { role } = payload
      if (!VALID_ROLES.has(role)) {
        return res.status(400).json({ error: 'role invalido (use: user, moderator, admin, partner, business)' })
      }
      const { error } = await supabase.from('bc_profiles').update({
        role: role || null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user_id)
      if (error) throw error
      return res.status(200).json({ success: true, action: 'set_role', user_id, role })
    }

    if (action === 'update_profile') {
      const { patch } = payload
      if (!patch || typeof patch !== 'object') {
        return res.status(400).json({ error: 'patch obrigatorio (objeto com campos a atualizar)' })
      }
      const clean = {}
      for (const [k, v] of Object.entries(patch)) {
        if (PROFILE_EDITABLE.has(k)) clean[k] = v
      }
      if (Object.keys(clean).length === 0) {
        return res.status(400).json({ error: 'nenhum campo editavel fornecido. permitidos: ' + [...PROFILE_EDITABLE].join(', ') })
      }
      if ('role' in clean && !VALID_ROLES.has(clean.role)) {
        return res.status(400).json({ error: 'role invalido' })
      }
      clean.updated_at = new Date().toISOString()
      const { data, error } = await supabase.from('bc_profiles').update(clean).eq('user_id', user_id).select().single()
      if (error) throw error
      return res.status(200).json({ success: true, action: 'update_profile', user_id, profile: data })
    }

    if (action === 'update_auth_email') {
      const { new_email } = payload
      if (!new_email || !/^.+@.+\..+$/.test(new_email)) {
        return res.status(400).json({ error: 'new_email invalido' })
      }
      const { data, error } = await supabase.auth.admin.updateUserById(user_id, {
        email: new_email,
        email_confirm: true,
      })
      if (error) throw error
      // Espelha em bc_profiles
      await supabase.from('bc_profiles').update({
        email: new_email,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user_id)
      return res.status(200).json({ success: true, action: 'update_auth_email', user_id, email: data?.user?.email })
    }

    return res.status(400).json({ error: 'action desconhecido: ' + action })
  } catch (e) {
    console.error('admin/user-action error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
