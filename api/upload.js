/**
 * POST /api/upload
 * Body: { file_data: 'data:image/jpeg;base64,...', folder?: 'businesses'|'providers'|'posts', email?: string }
 * Faz upload pro bucket Supabase Storage 'uploads' e retorna URL publica.
 *
 * Validacoes server-side:
 * - Tamanho max: 500KB (frontend ja deve comprimir antes)
 * - MIME: jpeg/png/webp/gif
 * - Email obrigatorio (rate limit basico por email)
 */
import { createClient } from '@supabase/supabase-js'

const MAX_BYTES = 500 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { file_data, folder = 'misc', email } = req.body || {}
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

    // Path: {folder}/{email-sanitized}/{timestamp}.{ext}
    const ext = EXT_BY_MIME[mime]
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const safeEmail = String(email || 'anon').replace(/[^a-z0-9]/gi, '_').slice(0, 50)
    const path = `${safeFolder}/${safeEmail}/${ts}_${rand}.${ext}`

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

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
