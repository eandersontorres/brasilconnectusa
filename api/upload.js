/**
 * POST /api/upload
 * Header: Authorization: Bearer <JWT do Supabase>  (obrigatorio)
 * Body: { file_data: 'data:image/jpeg;base64,...', folder?: 'businesses'|'providers'|'posts'|'communities' }
 * Faz upload pro bucket Supabase Storage 'uploads' e retorna URL publica.
 *
 * Validacoes server-side:
 * - Login obrigatorio (antes qualquer pessoa subia arquivo, sem limite)
 * - Tamanho max: 500KB (frontend ja deve comprimir antes)
 * - MIME: jpeg/png/webp/gif
 * - Limite de 30 uploads por minuto por IP
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from './_lib/businessAuth.js'
import { rateLimit } from './_lib/rateLimit.js'

const MAX_BYTES = 500 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const _rl = rateLimit(req, { windowMs: 60000, max: 30 })
  if (_rl) return res.status(429).json({ error: 'Muitos envios. Tenta de novo em ' + _rl.retryAfter + 's.' })

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const auth = await requireAuthOnly(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: 'Faça login para enviar imagens.' })

    const { file_data, folder = 'misc' } = req.body || {}
    if (!file_data) return res.status(400).json({ error: 'file_data obrigatorio' })

    // Parse data URL
    const match = String(file_data).match(/^data:(image\/[a-z]+);base64,(.+)$/)
    if (!match) return res.status(400).json({ error: 'Formato invalido. Esperado data:image/...' })

    const mime = match[1]
    if (!ALLOWED_MIME.includes(mime)) {
      return res.status(400).json({ error: 'Tipo nao suportado. Use JPG, PNG, WebP ou GIF' })
    }

    const buf = Buffer.from(match[2], 'base64')
    if (buf.length > MAX_BYTES) {
      return res.status(400).json({
        error: `Arquivo muito grande (${Math.round(buf.length / 1024)}KB). Max: ${MAX_BYTES / 1024}KB`,
      })
    }

    // Sanitiza folder
    const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'misc'

    // Path: {folder}/{user_id}/{timestamp}.{ext}  (id do usuario logado, nao o e-mail do body)
    const ext = EXT_BY_MIME[mime]
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const path = `${safeFolder}/${auth.user.id}/${ts}_${rand}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('uploads')
      .upload(path, buf, { contentType: mime, upsert: false })

    if (upErr) {
      console.error('upload error:', upErr.message)
      return res.status(500).json({ error: 'Falha no upload: ' + upErr.message })
    }

    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(path)

    return res.status(200).json({
      success: true,
      url: urlData.publicUrl,
      path,
      size_kb: Math.round(buf.length / 1024),
      mime,
    })
  } catch (e) {
    console.error('upload handler error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
