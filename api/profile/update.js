import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })
  const { email, full_name, display_name, bio, city, state, whatsapp, instagram, avatar_color, privacy, notifications } = req.body || {}
  if (!email) return res.status(400).json({ error: 'email obrigatório' })
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Upsert do perfil
    const { data: profile, error: pErr } = await supabase.from('bc_profiles').upsert({
      email: email.toLowerCase(),
      full_name, display_name, bio, city, state, whatsapp, instagram, avatar_color,
      updated_at: new Date().toISOString()
    }, { onConflict: 'email' }).select().single()

    if (pErr) return res.status(500).json({ error: pErr.message })

    // Atualiza privacidade
    if (privacy && profile.id) {
      await supabase.from('bc_privacy_settings').upsert({
        user_id: profile.id, settings: privacy, updated_at: new Date().toISOString()
      })
    }

    // Atualiza notificações
    if (notifications && profile.id) {
      await supabase.from('bc_notification_prefs').upsert({
        user_id: profile.id, ...notifications, updated_at: new Date().toISOString()
      })
    }

    return res.status(200).json({ ok: true, profile })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
