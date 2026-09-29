/**
 * GET  /api/agenda/provider?slug=ana-torres    publico (perfil + servicos + nota media)
 * GET  /api/agenda/provider?email=foo@bar.com  com JWT do mesmo e-mail: perfil completo
 *                                              sem JWT: so id, nome e plano (pagina de planos)
 * POST /api/agenda/provider                    com JWT: cria ou atualiza o PROPRIO perfil
 *
 * Antes o GET por e-mail devolvia WhatsApp e dados do plano de qualquer profissional,
 * e o POST nao existia (salvar o perfil no /assinante dava 405).
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from '../_lib/businessAuth.js'

const FULL_COLS = 'id, name, email, slug, specialty, bio, city, state, avatar_url, cover_color, cover_url, gallery_urls, video_url, instagram, whatsapp, plan, plan_status, current_period_end, active'
const PUBLIC_COLS = 'id, name, slug, specialty, bio, city, state, avatar_url, cover_color, cover_url, gallery_urls, video_url, instagram, plan, plan_status'

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

// So aceita http(s): bloqueia javascript:, data: etc. em campos que viram link/imagem.
function safeUrl(v) {
  const s = clip(v, 500)
  if (!s) return null
  return /^https?:\/\//i.test(s) ? s : null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    // ── POST: cria/atualiza o proprio perfil ─────────────────────────────
    if (req.method === 'POST') {
      const auth = await requireAuthOnly(req, supabase)
      if (!auth.ok) return res.status(auth.status).json({ error: 'Faça login para salvar o perfil.' })

      const b = req.body || {}
      const name = clip(b.name, 120)
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' })

      const email = String(auth.user.email || '').toLowerCase().trim()
      if (!email) return res.status(400).json({ error: 'Sua conta não tem e-mail' })

      const gallery = Array.isArray(b.gallery_urls)
        ? b.gallery_urls.map(safeUrl).filter(Boolean).slice(0, 10)
        : []

      const fields = {
        name,
        specialty: clip(b.specialty, 120),
        bio: clip(b.bio, 2000),
        city: clip(b.city, 80),
        state: clip(String(b.state || '').toUpperCase(), 2),
        whatsapp: clip(b.whatsapp, 30),
        instagram: clip(b.instagram, 60),
        avatar_url: safeUrl(b.avatar_url),
        cover_url: safeUrl(b.cover_url),
        video_url: safeUrl(b.video_url),
        gallery_urls: gallery,
        updated_at: new Date().toISOString(),
      }

      // Acha o perfil do usuario: por user_id (preferido) ou por e-mail
      let { data: existing } = await supabase.from('ag_providers').select('id, owner_user_id')
        .eq('owner_user_id', auth.user.id).maybeSingle()
      if (!existing) {
        const byEmail = await supabase.from('ag_providers').select('id, owner_user_id').eq('email', email).maybeSingle()
        existing = byEmail.data || null
      }

      if (existing) {
        const { data, error } = await supabase.from('ag_providers')
          .update({ ...fields, owner_user_id: existing.owner_user_id || auth.user.id })
          .eq('id', existing.id).select(FULL_COLS).single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ ok: true, provider: data })
      }

      // Novo perfil: slug unico
      const base = slugify(name) || 'profissional'
      let slug = base
      for (let i = 1; i <= 30; i++) {
        const { data: taken } = await supabase.from('ag_providers').select('id').eq('slug', slug).maybeSingle()
        if (!taken) break
        slug = `${base}-${i + 1}`
      }

      const { data, error } = await supabase.from('ag_providers')
        .insert({ ...fields, email, slug, owner_user_id: auth.user.id, active: true })
        .select(FULL_COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, created: true, provider: data })
    }

    // ── GET ──────────────────────────────────────────────────────────────
    const { slug, email } = req.query
    if (!slug && !email) return res.status(400).json({ error: 'slug ou email obrigatorio' })

    if (email) {
      const requested = String(email).toLowerCase().trim()
      const auth = await requireAuthOnly(req, supabase)
      const tokenEmail = auth.ok ? String(auth.user.email || '').toLowerCase().trim() : null
      const isOwner = tokenEmail && tokenEmail === requested

      const { data: provider, error } = await supabase
        .from('ag_providers')
        .select(isOwner ? FULL_COLS : 'id, name, plan, plan_status')
        .eq('email', requested)
        .maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      if (!provider) return res.status(200).json({ provider: null })

      res.setHeader('Cache-Control', 'private, no-store')
      // Sem token: devolve so o minimo que a pagina de planos precisa pra abrir o checkout.
      return res.status(200).json({ provider: isOwner ? provider : { ...provider, email: requested } })
    }

    const { data: provider, error } = await supabase
      .from('ag_providers')
      .select(PUBLIC_COLS)
      .eq('slug', String(slug).toLowerCase())
      .eq('active', true)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    if (!provider) return res.status(404).json({ error: 'Profissional nao encontrada' })

    const { data: services } = await supabase
      .from('ag_services')
      .select('id, name, category, description, duration_min, price_cents, deposit_cents')
      .eq('provider_id', provider.id)
      .eq('active', true)
      .order('display_order', { ascending: true })

    const { data: reviewAgg } = await supabase
      .from('ag_reviews')
      .select('rating')
      .eq('provider_id', provider.id)
      .eq('is_published', true)

    const reviews = reviewAgg || []
    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({
      provider,
      services: services || [],
      reviews: { count: reviews.length, average: avgRating },
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
