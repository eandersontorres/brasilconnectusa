/**
 * Perfil da profissional (ag_providers).
 *
 * GET  /api/agenda/provider?slug=ana-torres    publico: perfil + servicos + avaliacoes (pagina /agenda/:slug)
 * GET  /api/agenda/provider?mine=1             com JWT: meu perfil completo (app)
 * GET  /api/agenda/provider?email=foo@bar.com  com JWT do mesmo e-mail: o perfil DESTE login completo
 *                                              (por user_id; pelo e-mail so se o perfil ainda nao tem dono)
 *                                              sem JWT (ou perfil de outro login): so id, nome e plano
 * POST /api/agenda/provider                    com JWT: cria ou atualiza o PROPRIO perfil
 *      ATUALIZACAO PARCIAL: so as chaves presentes no corpo mudam. Na criacao, name e obrigatorio.
 *      Chaves: name, specialty, bio, city, state, whatsapp, instagram, deposit_instructions,
 *              avatar_url, cover_url, cover_color, video_url, gallery_urls[], slug
 *              timezone (so na criacao: fuso do aparelho/navegador, ex. 'America/Chicago';
 *              sem ele, sai do estado; sem os dois, fica o padrao do banco)
 *      - gallery_urls com foto nova exige o recurso 'gallery' (Pro) → 402. Tirar foto e
 *        salvar a mesma lista continua liberado (quem desceu de plano nao fica travada).
 *      - slug novo precisa estar livre (409) e fora da lista reservada.
 *      - O perfil e achado pelo user_id do login. Pelo e-mail, so perfil ainda sem dono:
 *        e-mail que ficou livre (trocado ou conta apagada) nao entrega o perfil de outra
 *        pessoa. E-mail ja ligado ao perfil de outro login → 403.
 *
 * A pagina publica recebe so o que precisa: booking_enabled, accepts_card, show_branding,
 * galeria e avaliacoes saem do plano (api/_lib/agendaPlans.js). Colunas de plano e de
 * Stripe nao saem daqui. vertical ('services'|'cleaning'|'trades') e quote_requests_enabled
 * (formulario "Pedir orcamento": plano + app_settings.quote_requests_public, pela mesma
 * regra de api/agenda/quote-requests.js); app_settings e lido mas nunca sai cru.
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from '../_lib/businessAuth.js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { hasFeature, requireFeature } from '../_lib/agendaPlans.js'
import { quoteFormEnabled } from './quote-requests.js'

const FULL_COLS = 'id, name, email, slug, specialty, bio, city, state, avatar_url, cover_color, cover_url, gallery_urls, video_url, instagram, whatsapp, plan, plan_status, current_period_end, trial_ends_at, active, stripe_onboarded, stripe_charges_enabled, deposit_instructions'
// O que agendaPlans precisa pra calcular o plano efetivo (nunca vai pro publico)
const PLAN_COLS = 'plan, plan_status, current_period_end, trial_ends_at, active, stripe_subscription_id, created_at'
// vertical e app_settings: so pra decidir o formulario de orcamento (app_settings nao vai pra resposta)
const PUBLIC_COLS = `id, name, slug, specialty, bio, city, state, avatar_url, cover_color, cover_url, gallery_urls, video_url, instagram, whatsapp, deposit_instructions, stripe_charges_enabled, vertical, app_settings, ${PLAN_COLS}`

const MAX_GALLERY = 10
const PUBLIC_REVIEWS = 10

// Viram rota do site (/agenda/review/:token, /agenda/planos...) ou confundem a cliente
const RESERVED_SLUGS = new Set([
  'review', 'reviews', 'planos', 'profile', 'index', 'equipe', 'admin', 'api', 'assinante',
  'agenda', 'agendapro', 'login', 'entrar', 'cadastro', 'novo', 'new', 'app', 'para', 'suporte',
  'ajuda', 'termos', 'privacidade', 'brasilconnect', 'checkout', 'pagamento',
])

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '')
}

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

// Fuso do relogio da profissional. Mesmo filtro do /me (action 'vertical') + o
// Intl confirma que o nome existe (fuso inventado quebraria as contas de horario).
const TZ_RE = /^(America|Pacific)\/[A-Za-z_]+(\/[A-Za-z_]+)?$/
function validTz(v) {
  if (typeof v !== 'string' || !TZ_RE.test(v)) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v } catch (_) { return null }
}

// Fuso pela sigla do estado (o da maior parte da populacao; o app deixa trocar em Configuracoes)
const STATE_TZ = {}
for (const [tz, states] of Object.entries({
  'America/New_York': 'CT DC DE FL GA IN KY MA MD ME MI NC NH NJ NY OH PA RI SC VA VT WV',
  'America/Chicago': 'AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI',
  'America/Denver': 'CO ID MT NM UT WY',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'CA NV OR WA',
  'America/Anchorage': 'AK',
  'Pacific/Honolulu': 'HI',
})) for (const st of states.split(' ')) STATE_TZ[st] = tz

/**
 * Link http(s). Vazio → null. 'youtube.com/x' ganha https://. Qualquer outro
 * esquema (javascript:, data:...) → false (invalido).
 */
function normUrl(v) {
  let s = clip(v, 500)
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = 'https://' + s
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : false
}

/** '@ana.hair', 'instagram.com/ana.hair/' → 'ana.hair'. Vazio → null. Invalido → false. */
function instagramHandle(v) {
  let s = String(v == null ? '' : v).trim()
  if (!s) return null
  const m = s.match(/instagram\.com\/([^/?#\s]+)/i)
  if (m) s = m[1]
  s = s.replace(/^@+/, '').replace(/\/+$/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : false
}

/** 'Maria Silva Santos' → 'Maria S.' (pagina publica nao mostra nome completo). */
function shortName(n) {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Cliente'
  const first = parts[0].slice(0, 30)
  const cap = first.charAt(0).toUpperCase() + first.slice(1)
  if (parts.length === 1) return cap
  return `${cap} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`
}

/**
 * Le as chaves presentes no corpo. Em `create`, name e obrigatorio.
 * → { fields } ou { error }
 */
function readFields(b, create) {
  const out = {}

  if (create || has(b, 'name')) {
    const name = clip(b.name, 120)
    if (!name) return { error: 'Nome é obrigatório' }
    out.name = name
  }
  if (has(b, 'specialty')) out.specialty = clip(b.specialty, 120)
  if (has(b, 'bio')) out.bio = clip(b.bio, 2000)
  if (has(b, 'city')) out.city = clip(b.city, 80)
  if (has(b, 'state')) {
    const st = String(b.state || '').trim().toUpperCase()
    if (st && !/^[A-Z]{2}$/.test(st)) return { error: 'Estado: use a sigla de 2 letras (ex.: MA, FL, TX)' }
    out.state = st || null
  }
  if (has(b, 'whatsapp')) {
    const w = clip(b.whatsapp, 30)
    if (w && w.replace(/\D/g, '').length < 10) return { error: 'WhatsApp incompleto. Coloque o número com o código de área.' }
    out.whatsapp = w
  }
  if (has(b, 'instagram')) {
    const ig = instagramHandle(b.instagram)
    if (ig === false) return { error: 'Instagram inválido. Use só o @ do perfil (ex.: @anahair)' }
    out.instagram = ig
  }
  if (has(b, 'deposit_instructions')) out.deposit_instructions = clip(b.deposit_instructions, 300)

  const URL_ERR = {
    avatar_url: 'Foto de perfil inválida',
    cover_url: 'Foto de capa inválida',
    video_url: 'Link do vídeo inválido. Cole o endereço que começa com https://',
  }
  for (const k of Object.keys(URL_ERR)) {
    if (!has(b, k)) continue
    const u = normUrl(b[k])
    if (u === false) return { error: URL_ERR[k] }
    out[k] = u
  }

  if (has(b, 'cover_color')) {
    const c = String(b.cover_color || '').trim()
    if (c && !/^#[0-9a-f]{6}$/i.test(c)) return { error: 'Cor da capa inválida' }
    if (c) out.cover_color = c
  }

  if (has(b, 'gallery_urls')) {
    if (b.gallery_urls != null && !Array.isArray(b.gallery_urls)) return { error: 'A galeria deve ser uma lista de fotos' }
    const list = []
    for (const raw of (b.gallery_urls || []).slice(0, 50)) {
      const u = normUrl(raw)
      if (u && !list.includes(u)) list.push(u)
    }
    if (list.length > MAX_GALLERY) return { error: `No máximo ${MAX_GALLERY} fotos na galeria` }
    out.gallery_urls = list
  }

  if (has(b, 'slug')) {
    const s = slugify(b.slug)
    if (s.length < 3) return { error: 'O link precisa ter pelo menos 3 letras ou números' }
    if (RESERVED_SLUGS.has(s)) return { error: 'Esse link é reservado. Escolha outro.' }
    out.slug = s
  }

  return { fields: out }
}

async function slugTaken(supabase, slug, exceptId) {
  let q = supabase.from('ag_providers').select('id').eq('slug', slug)
  if (exceptId) q = q.neq('id', exceptId)
  const { data } = await q.maybeSingle()
  return !!data
}

const SLUG_TAKEN = { error: 'Esse link já está em uso por outra profissional. Tente outro.', code: 'slug_taken' }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    // ── POST: cria/atualiza o proprio perfil (parcial) ───────────────────
    if (req.method === 'POST') {
      const auth = await requireAuthOnly(req, supabase)
      if (!auth.ok) return res.status(auth.status).json({ error: 'Faça login para salvar o perfil.' })

      const b = req.body && typeof req.body === 'object' ? req.body : {}
      const email = String(auth.user.email || '').toLowerCase().trim()

      // Acha o perfil do usuario: por user_id; pelo e-mail so se o perfil ainda nao tem dono
      // (e-mail que ficou livre nao pode entregar o perfil de outro login)
      const EXISTING_COLS = `id, owner_user_id, slug, gallery_urls, ${PLAN_COLS}`
      let { data: existing } = await supabase.from('ag_providers').select(EXISTING_COLS)
        .eq('owner_user_id', auth.user.id).maybeSingle()
      if (!existing && email) {
        const byEmail = await supabase.from('ag_providers').select(EXISTING_COLS)
          .eq('email', email).is('owner_user_id', null).maybeSingle()
        existing = byEmail.data || null
      }
      if (!existing && email) {
        // O e-mail e unico em ag_providers: se ainda existe perfil com ele, e de outro login
        const { data: taken } = await supabase.from('ag_providers').select('id').eq('email', email).limit(1)
        if (taken && taken.length) {
          return res.status(403).json({ error: 'Este e-mail já está ligado ao perfil de outra conta. Fale com o suporte do BrasilConnect.', code: 'email_taken' })
        }
      }

      const read = readFields(b, !existing)
      if (read.error) return res.status(400).json({ error: read.error })
      const fields = read.fields

      // Galeria com foto nova e recurso Pro. Perfil novo nasce no teste gratis (tudo liberado).
      if (fields.gallery_urls && fields.gallery_urls.length) {
        const current = new Set(Array.isArray(existing?.gallery_urls) ? existing.gallery_urls : [])
        if (fields.gallery_urls.some(u => !current.has(u))) {
          const planSource = existing || { plan: 'starter', plan_status: 'trialing', active: true, created_at: new Date().toISOString() }
          const gate = requireFeature(planSource, 'gallery')
          if (!gate.ok) return res.status(gate.status).json(gate.body)
        }
      }

      if (existing) {
        if (fields.slug && fields.slug !== existing.slug && await slugTaken(supabase, fields.slug, existing.id)) {
          return res.status(409).json(SLUG_TAKEN)
        }
        const { data, error } = await supabase.from('ag_providers')
          .update({ ...fields, updated_at: new Date().toISOString(), owner_user_id: existing.owner_user_id || auth.user.id })
          .eq('id', existing.id).select(FULL_COLS).single()
        if (error) {
          if (error.code === '23505') return res.status(409).json(SLUG_TAKEN)
          return res.status(500).json({ error: error.message })
        }
        return res.status(200).json({ ok: true, provider: data })
      }

      if (!email) return res.status(400).json({ error: 'Sua conta não tem e-mail' })

      // Novo perfil: slug pedido (se livre) ou gerado do nome
      let slug = null
      if (fields.slug && !(await slugTaken(supabase, fields.slug))) slug = fields.slug
      if (!slug) {
        let base = slugify(fields.name) || 'profissional'
        if (base.length < 3 || RESERVED_SLUGS.has(base)) base = `${base}-agenda`.replace(/^-/, '')
        slug = base
        for (let i = 1; i <= 30; i++) {
          if (!(await slugTaken(supabase, slug))) break
          slug = `${base}-${i + 1}`
        }
      }
      delete fields.slug

      // Fuso: o do aparelho/navegador (se veio e e valido) ou o do estado. Sem os dois,
      // fica o padrao do banco; o app confere o fuso do celular depois.
      const timezone = validTz(b.timezone) || STATE_TZ[fields.state] || null

      const { data, error } = await supabase.from('ag_providers')
        .insert({ ...fields, ...(timezone ? { timezone } : {}), email, slug, owner_user_id: auth.user.id, active: true, updated_at: new Date().toISOString() })
        .select(FULL_COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, created: true, provider: data })
    }

    // ── GET ──────────────────────────────────────────────────────────────
    const { slug, email, mine } = req.query || {}

    // App: meu perfil completo (bio, fotos, galeria...), que o /me nao traz
    if (mine) {
      const auth = await requireProviderAuth(req, supabase)
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
      const { data, error } = await supabase.from('ag_providers').select(FULL_COLS)
        .eq('id', auth.provider.id).single()
      if (error) return res.status(500).json({ error: error.message })
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({ provider: data })
    }

    if (!slug && !email) return res.status(400).json({ error: 'slug ou email obrigatorio' })

    if (email) {
      const requested = String(email).toLowerCase().trim()
      const auth = await requireAuthOnly(req, supabase)
      const tokenEmail = auth.ok ? String(auth.user.email || '').toLowerCase().trim() : null
      res.setHeader('Cache-Control', 'private, no-store')

      // Token do mesmo e-mail: o perfil DESTE login (por user_id) ou, pelo e-mail, so o
      // perfil ainda sem dono. Perfil de outro login nunca sai completo daqui.
      if (tokenEmail && tokenEmail === requested) {
        const own = await supabase.from('ag_providers').select(FULL_COLS)
          .eq('owner_user_id', auth.user.id).maybeSingle()
        if (own.error) return res.status(500).json({ error: own.error.message })
        let mine = own.data || null
        if (!mine) {
          const byEmail = await supabase.from('ag_providers').select(FULL_COLS)
            .eq('email', requested).is('owner_user_id', null).maybeSingle()
          if (byEmail.error) return res.status(500).json({ error: byEmail.error.message })
          mine = byEmail.data || null
        }
        if (mine) return res.status(200).json({ provider: mine })
      }

      // Sem token (ou perfil de outro login): so o minimo que a pagina de planos precisa.
      const { data: provider, error } = await supabase
        .from('ag_providers')
        .select('id, name, plan, plan_status')
        .eq('email', requested)
        .maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      if (!provider) return res.status(200).json({ provider: null })
      return res.status(200).json({ provider: { ...provider, email: requested } })
    }

    const { data: provider, error } = await supabase
      .from('ag_providers')
      .select(PUBLIC_COLS)
      .eq('slug', String(slug).toLowerCase().slice(0, 80))
      .eq('active', true)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    if (!provider) return res.status(404).json({ error: 'Profissional nao encontrada' })

    const canReviews = hasFeature(provider, 'reviews')
    const httpOnly = (u) => /^https?:\/\//i.test(String(u || ''))

    const [servicesQ, ratingsQ, latestQ] = await Promise.all([
      supabase.from('ag_services')
        .select('id, name, category, description, duration_min, price_cents, deposit_cents')
        .eq('provider_id', provider.id)
        .eq('active', true)
        .order('display_order', { ascending: true }),
      canReviews
        ? supabase.from('ag_reviews').select('rating')
          .eq('provider_id', provider.id).eq('is_published', true).limit(5000)
        : Promise.resolve({ data: [] }),
      canReviews
        ? supabase.from('ag_reviews').select('client_name, rating, comment, provider_response, created_at')
          .eq('provider_id', provider.id).eq('is_published', true)
          .order('created_at', { ascending: false }).limit(PUBLIC_REVIEWS)
        : Promise.resolve({ data: [] }),
    ])

    const ratings = (ratingsQ.data || []).map(r => Number(r.rating) || 0).filter(n => n >= 1 && n <= 5)
    const average = ratings.length
      ? Math.round((ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10) / 10
      : null

    // Lista branca: nada de plano, Stripe ou e-mail na resposta publica
    const publicProvider = {
      id: provider.id,
      name: provider.name,
      slug: provider.slug,
      specialty: provider.specialty,
      bio: provider.bio,
      city: provider.city,
      state: provider.state,
      avatar_url: provider.avatar_url,
      cover_color: provider.cover_color,
      cover_url: provider.cover_url,
      video_url: provider.video_url,
      instagram: provider.instagram,
      whatsapp: provider.whatsapp,
      deposit_instructions: provider.deposit_instructions,
      gallery_urls: hasFeature(provider, 'gallery')
        ? (Array.isArray(provider.gallery_urls) ? provider.gallery_urls.filter(httpOnly).slice(0, MAX_GALLERY) : [])
        : [],
      booking_enabled: hasFeature(provider, 'online_booking'),
      accepts_card: hasFeature(provider, 'deposit_stripe') && !!provider.stripe_charges_enabled,
      show_branding: !hasFeature(provider, 'no_branding'),
      vertical: provider.vertical || 'services',
      quote_requests_enabled: quoteFormEnabled(provider),
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return res.status(200).json({
      provider: publicProvider,
      services: servicesQ.data || [],
      reviews: {
        enabled: canReviews,
        count: ratings.length,
        average,
        items: (latestQ.data || []).map(r => ({
          client_name: shortName(r.client_name),
          rating: r.rating,
          comment: r.comment || null,
          provider_response: r.provider_response || null,
          created_at: r.created_at,
        })),
      },
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
