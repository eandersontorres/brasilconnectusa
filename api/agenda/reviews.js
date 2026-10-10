/**
 * Avaliacoes da profissional (ag_reviews), vistas e respondidas pelo app.
 *
 * GET  /api/agenda/reviews?filter=all|unanswered|hidden   com JWT
 *      → { reviews: [...], stats: { count, published, hidden, unanswered, average,
 *          public_average, distribution: { 1: n, ..., 5: n } } }
 *        stats sempre contam todas as avaliacoes (o filtro so muda a lista).
 *        Leitura liberada mesmo sem plano: a profissional nao perde o historico.
 * POST /api/agenda/reviews   com JWT + recurso 'reviews' (Pro)
 *      Body: { action, id, ... }
 *        respond  { id, response }   resposta publica (ate 1000 caracteres; vazio apaga)
 *        hide     { id }             tira da pagina publica
 *        publish  { id }             volta a mostrar
 *
 * Cada avaliacao: id, appointment_id, client_id, client_name, rating, comment,
 * provider_response, responded_at, is_published, created_at, service_name, appointment_at.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'

const REVIEW_COLS = 'id, appointment_id, client_name, rating, comment, provider_response, responded_at, is_published, created_at'
const FILTERS = ['all', 'unanswered', 'hidden']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LIST = 1000

const avg = (list) => (list.length
  ? Math.round((list.reduce((s, r) => s + (Number(r.rating) || 0), 0) / list.length) * 10) / 10
  : null)

/** Junta servico e data do atendimento (duas consultas simples, sem embed). */
async function withAppointments(supabase, providerId, reviews) {
  const ids = [...new Set(reviews.map(r => r.appointment_id).filter(Boolean))]
  if (!ids.length) return reviews.map(r => ({ ...r, client_id: null, service_name: null, appointment_at: null }))

  const appts = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('ag_appointments')
      .select('id, client_id, service_id, scheduled_for')
      .eq('provider_id', providerId).in('id', ids.slice(i, i + 200))
    for (const a of data || []) appts.set(a.id, a)
  }

  const serviceIds = [...new Set([...appts.values()].map(a => a.service_id).filter(Boolean))]
  const services = new Map()
  if (serviceIds.length) {
    const { data } = await supabase.from('ag_services').select('id, name')
      .eq('provider_id', providerId).in('id', serviceIds)
    for (const s of data || []) services.set(s.id, s.name)
  }

  return reviews.map(r => {
    const a = r.appointment_id ? appts.get(r.appointment_id) : null
    return {
      ...r,
      client_id: a?.client_id || null,
      service_name: a?.service_id ? services.get(a.service_id) || null : null,
      appointment_at: a?.scheduled_for || null,
    }
  })
}

function statsOf(all) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of all) {
    const n = Math.round(Number(r.rating))
    if (n >= 1 && n <= 5) distribution[n]++
  }
  const published = all.filter(r => r.is_published !== false)
  return {
    count: all.length,
    published: published.length,
    hidden: all.length - published.length,
    unanswered: all.filter(r => !r.provider_response).length,
    average: avg(all),
    public_average: avg(published),
    distribution,
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    res.setHeader('Cache-Control', 'private, no-store')

    // ── GET: minhas avaliacoes ───────────────────────────────────────────
    if (req.method === 'GET') {
      const filter = FILTERS.includes(req.query?.filter) ? req.query.filter : 'all'
      const { data, error } = await supabase.from('ag_reviews').select(REVIEW_COLS)
        .eq('provider_id', provider.id)
        .order('created_at', { ascending: false })
        .limit(MAX_LIST)
      if (error) return res.status(500).json({ error: error.message })

      const all = data || []
      const list = filter === 'unanswered' ? all.filter(r => !r.provider_response)
        : filter === 'hidden' ? all.filter(r => r.is_published === false)
        : all

      return res.status(200).json({
        filter,
        stats: statsOf(all),
        reviews: await withAppointments(supabase, provider.id, list),
      })
    }

    // ── POST: responder, ocultar, publicar ───────────────────────────────
    const gate = requireFeature(provider, 'reviews')
    if (!gate.ok) return res.status(gate.status).json(gate.body)

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const action = String(body.action || '')
    if (!['respond', 'hide', 'publish'].includes(action)) return res.status(400).json({ error: 'Ação inválida' })

    const id = String(body.id || '')
    if (!UUID.test(id)) return res.status(400).json({ error: 'Avaliação inválida' })

    const { data: review } = await supabase.from('ag_reviews').select('id')
      .eq('id', id).eq('provider_id', provider.id).maybeSingle()
    if (!review) return res.status(404).json({ error: 'Avaliação não encontrada' })

    let patch
    if (action === 'respond') {
      if (body.response != null && typeof body.response !== 'string') return res.status(400).json({ error: 'Resposta inválida' })
      const text = String(body.response || '').trim()
      if (text.length > 1000) return res.status(400).json({ error: 'A resposta pode ter até 1000 caracteres' })
      patch = text
        ? { provider_response: text, responded_at: new Date().toISOString() }
        : { provider_response: null, responded_at: null }
    } else {
      patch = { is_published: action === 'publish' }
    }

    const { data: saved, error } = await supabase.from('ag_reviews').update(patch)
      .eq('id', id).eq('provider_id', provider.id).select(REVIEW_COLS).single()
    if (error) return res.status(500).json({ error: error.message })

    const [out] = await withAppointments(supabase, provider.id, [saved])
    return res.status(200).json({ ok: true, review: out })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
