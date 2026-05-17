/**
 * POST /api/events/submit
 *
 * Body:
 *   { title, description, category, city, state, venue_name, address,
 *     starts_at, ends_at, cover_image_url, ticket_url, price_label,
 *     contact_whatsapp, organizer_business_id?, organizer_name?, submitted_email,
 *     admin_token? }
 *
 * Regras:
 *   - admin_token === ADMIN_TOKEN → cria já como 'approved' com organizer_type='admin'
 *   - senão, exige organizer_business_id de um negócio APROVADO e VERIFICADO
 *     em bc_businesses; cria como 'pending'.
 */
import { createClient } from '@supabase/supabase-js'

function slugify(s) {
  return String(s || 'evento')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    title, description, category,
    venue_name, address, city, state,
    starts_at, ends_at,
    cover_image_url, ticket_url, price_label,
    contact_whatsapp,
    organizer_business_id, organizer_name,
    submitted_email,
    admin_token,
  } = req.body || {}

  if (!title || !category || !city || !state || !starts_at || !submitted_email) {
    return res.status(400).json({
      error: 'title, category, city, state, starts_at e submitted_email são obrigatórios',
    })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const isAdmin = !!process.env.ADMIN_TOKEN && admin_token === process.env.ADMIN_TOKEN
    let organizerType = isAdmin ? 'admin' : 'business'
    let finalStatus = isAdmin ? 'approved' : 'pending'
    let businessRow = null

    if (!isAdmin) {
      if (!organizer_business_id) {
        return res.status(403).json({
          error: 'Apenas admin ou negócios verificados podem criar eventos. Informe organizer_business_id.',
        })
      }
      const { data: biz, error: bizErr } = await supabase
        .from('bc_businesses')
        .select('id, name, short_name, slug, status, active, verified, submitted_email, owner_email')
        .eq('id', organizer_business_id)
        .maybeSingle()
      if (bizErr) return res.status(500).json({ error: bizErr.message })
      if (!biz) return res.status(404).json({ error: 'Negócio não encontrado.' })
      if (biz.status !== 'approved' || biz.active === false) {
        return res.status(403).json({ error: 'Negócio precisa estar aprovado e ativo.' })
      }
      // Pequeno gate de autoria: o email enviado precisa bater com o do dono do negócio
      const allowed = [biz.submitted_email, biz.owner_email].filter(Boolean).map(s => s.toLowerCase().trim())
      if (allowed.length && !allowed.includes(String(submitted_email).toLowerCase().trim())) {
        return res.status(403).json({ error: 'Email não confere com o cadastro do negócio.' })
      }
      businessRow = biz
    }

    // Slug único
    const base = slugify(title)
    let slug = base
    for (let i = 0; i < 25; i++) {
      const { data: ex } = await supabase.from('bc_events').select('id').eq('slug', slug).maybeSingle()
      if (!ex) break
      slug = `${base}-${i + 1}`
    }

    const insert = {
      slug, title, description, category,
      venue_name, address,
      city, state: String(state).toUpperCase(),
      starts_at, ends_at: ends_at || null,
      cover_image_url, ticket_url, price_label, contact_whatsapp,
      organizer_type: organizerType,
      organizer_business_id: isAdmin ? (organizer_business_id || null) : organizer_business_id,
      organizer_name: organizer_name || businessRow?.short_name || businessRow?.name || null,
      submitted_email: String(submitted_email).toLowerCase().trim(),
      status: finalStatus,
    }

    const { data, error } = await supabase.from('bc_events').insert(insert).select().single()
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({
      ok: true,
      event: data,
      message: isAdmin
        ? 'Evento publicado.'
        : 'Evento enviado pra aprovação. Avisamos por email em até 48h.',
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
