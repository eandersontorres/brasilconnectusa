/**
 * POST /api/businesses/update
 *
 * Atualiza dados de um negocio EXISTENTE. So o dono pode editar
 * (validado via JWT em requireBusinessAuth).
 *
 * Body: { id, name?, category?, city?, state?, phone?, whatsapp?,
 *         website?, instagram?, tiktok?, description?, address?,
 *         logo_url?, cover_url?, video_url?, gallery_urls?, hours? }
 *
 * Headers: Authorization: Bearer <JWT>
 *
 * NOTA: campos sensiveis NUNCA sao alterados aqui (status, active,
 * featured, verified, owner_email, owner_user_id, stripe_*,
 * platform_fee_pct). Esses ficam protegidos no admin.
 */

import { createClient } from '@supabase/supabase-js'
import { requireBusinessAuth } from '../_lib/businessAuth.js'
import { VALID_MODULES } from '../_lib/modules.js'

// Whitelist de campos editaveis pelo dono (TUDO que nao esta aqui sera ignorado)
const EDITABLE_FIELDS = [
  'name', 'category', 'module', 'city', 'state', 'zip', 'address',
  'phone', 'whatsapp', 'website', 'instagram', 'tiktok', 'facebook',
  'description', 'short_desc',
  'logo_url', 'cover_url', 'video_url', 'gallery_urls',
  'hours', 'tags', 'emoji', 'color',
]

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id obrigatorio' })

  try {
    const supabase = getSupabase()

    // Auth: valida JWT + confirma ownership do business_id
    const auth = await requireBusinessAuth(req, supabase, id)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

    // Filtra payload: so campos da whitelist passam
    const payload = {}
    for (const k of EDITABLE_FIELDS) {
      if (k in req.body) {
        let v = req.body[k]
        // Normaliza state pra uppercase 2 chars
        if (k === 'state' && v) v = String(v).toUpperCase().slice(0, 2)
        // Modulo: aceita so canonicos. Vazio/invalido = ignora (mantem atual)
        if (k === 'module') {
          if (!v || !VALID_MODULES.has(String(v).toLowerCase())) continue
          v = String(v).toLowerCase()
        }
        // Strings vazias viram null
        if (typeof v === 'string' && v.trim() === '') v = null
        payload[k] = v
      }
    }
    payload.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('bc_businesses')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('businesses/update error:', error.message)
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({ success: true, business: data })
  } catch (e) {
    console.error('businesses/update exception:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
