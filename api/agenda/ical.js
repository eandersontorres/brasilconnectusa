/**
 * Turnover de Airbnb, Vrbo e Booking: calendarios .ics das casas da profissional.
 *
 * GET  /api/agenda/ical   com JWT: minhas casas sincronizadas
 * POST /api/agenda/ical   com JWT
 *      Body: { action, ... }
 *        create  { label, url, checkout_time?, duration_min?, price_cents?, notes? }
 *                testa o link antes de salvar e ja sincroniza
 *        update  { id, label?, url?, checkout_time?, duration_min?, price_cents?, notes? }
 *                url vazio mantem o link atual; ressincroniza
 *        sync    { id }   sincroniza agora (no maximo 1x por minuto por casa)
 *        delete  { id }   remove a casa e cancela as limpezas por vir dela
 *
 * O link nunca volta inteiro pro navegador (tem token de acesso a agenda da
 * casa): so `url_hint`. Sincronizar exige plano em teste ou ativo.
 * O cron api/cron/ical-sync roda a sincronizacao de hora em hora.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth, planActive } from '../_lib/providerAuth.js'
import { normalizeIcsUrl, detectSource, maskUrl, fetchIcs } from '../_lib/ical.js'
import { syncFeed } from '../_lib/icalSync.js'
import { rateLimit } from '../_lib/rateLimit.js'

const FEED_COLS = 'id, provider_id, label, url, source, checkout_time, duration_min, price_cents, notes, active, last_synced_at, last_status, last_error, reservations_count, created_at'
const MAX_FEEDS = 50
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const NEED_PLAN = 'Sincronizar casas exige um plano ativo. O teste grátis de 14 dias vale.'

const int = (v, min, max, def) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

function publicFeed(f) {
  const { url, provider_id, ...rest } = f
  return { ...rest, checkout_time: String(f.checkout_time || '11:00').slice(0, 5), url_hint: maskUrl(url) }
}

/** Campos editaveis. Em `partial`, so o que veio no body. */
function readFields(body, partial) {
  const out = {}
  if (!partial || body.label !== undefined) {
    const label = clip(body.label, 80)
    if (!label) return { error: 'Dê um nome pra casa (ex.: Casa do lago, Kissimmee)' }
    out.label = label
  }
  if (!partial || body.checkout_time !== undefined) {
    const t = String(body.checkout_time || '11:00').slice(0, 5)
    if (!HHMM.test(t)) return { error: 'Horário do checkout inválido. Use HH:MM' }
    out.checkout_time = t
  }
  if (!partial || body.duration_min !== undefined) out.duration_min = int(body.duration_min, 15, 720, 180)
  if (!partial || body.price_cents !== undefined) out.price_cents = int(body.price_cents, 0, 1000000, 0)
  if (!partial || body.notes !== undefined) out.notes = clip(body.notes, 500)
  return { fields: out }
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

    if (req.method === 'GET') {
      const { data, error } = await supabase.from('ag_ical_feeds').select(FEED_COLS)
        .eq('provider_id', provider.id).order('created_at', { ascending: true })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ feeds: (data || []).map(publicFeed) })
    }

    const body = req.body || {}
    const action = body.action

    // Cada criar/editar/sincronizar baixa um link externo
    if (rateLimit(req, { windowMs: 60_000, max: 20 })) {
      return res.status(429).json({ error: 'Muitas tentativas. Espere um minuto.' })
    }

    const loadFeed = async () => {
      if (!body.id) return null
      const { data } = await supabase.from('ag_ical_feeds').select(FEED_COLS)
        .eq('id', body.id).eq('provider_id', provider.id).maybeSingle()
      return data || null
    }
    const reply = async (feedId, sync, status = 200) => {
      const { data } = await supabase.from('ag_ical_feeds').select(FEED_COLS).eq('id', feedId).maybeSingle()
      return res.status(status).json({ ok: true, feed: data ? publicFeed(data) : null, sync })
    }

    if (action === 'create') {
      if (!planActive(provider)) return res.status(402).json({ error: NEED_PLAN })
      const read = readFields(body, false)
      if (read.error) return res.status(400).json({ error: read.error })
      const n = normalizeIcsUrl(body.url)
      if (!n.ok) return res.status(400).json({ error: n.error })

      const { count } = await supabase.from('ag_ical_feeds')
        .select('id', { count: 'exact', head: true }).eq('provider_id', provider.id)
      if ((count || 0) >= MAX_FEEDS) return res.status(400).json({ error: `Limite de ${MAX_FEEDS} casas atingido` })

      const { data: dup } = await supabase.from('ag_ical_feeds').select('id')
        .eq('provider_id', provider.id).eq('url', n.url).maybeSingle()
      if (dup) return res.status(409).json({ error: 'Esse calendário já está cadastrado' })

      // Testa o link antes de salvar: erro aqui volta pra tela, nada fica gravado
      let text
      try { text = await fetchIcs(n.url) } catch (e) { return res.status(400).json({ error: e.message }) }

      const { data: feed, error } = await supabase.from('ag_ical_feeds')
        .insert({ provider_id: provider.id, url: n.url, source: detectSource(n.url), ...read.fields })
        .select(FEED_COLS).single()
      if (error) return res.status(500).json({ error: error.message })

      const sync = await syncFeed(supabase, feed, { text })
      return reply(feed.id, sync, 201)
    }

    const feed = await loadFeed()
    if (!feed) return res.status(404).json({ error: 'Casa não encontrada' })

    if (action === 'update') {
      const read = readFields(body, true)
      if (read.error) return res.status(400).json({ error: read.error })
      const patch = { ...read.fields, updated_at: new Date().toISOString() }

      let text = null
      if (body.url && String(body.url).trim()) {
        const n = normalizeIcsUrl(body.url)
        if (!n.ok) return res.status(400).json({ error: n.error })
        if (n.url !== feed.url) {
          const { data: dup } = await supabase.from('ag_ical_feeds').select('id')
            .eq('provider_id', provider.id).eq('url', n.url).neq('id', feed.id).maybeSingle()
          if (dup) return res.status(409).json({ error: 'Esse calendário já está cadastrado em outra casa' })
          try { text = await fetchIcs(n.url) } catch (e) { return res.status(400).json({ error: e.message }) }
          patch.url = n.url
          patch.source = detectSource(n.url)
        }
      }

      const { data: saved, error } = await supabase.from('ag_ical_feeds').update(patch)
        .eq('id', feed.id).eq('provider_id', provider.id).select(FEED_COLS).single()
      if (error) return res.status(500).json({ error: error.message })

      // Horario, duracao e valor novos valem pras limpezas por vir
      const sync = planActive(provider) && saved.active ? await syncFeed(supabase, saved, { text }) : null
      return reply(feed.id, sync)
    }

    if (action === 'sync') {
      if (!planActive(provider)) return res.status(402).json({ error: NEED_PLAN })
      if (feed.last_synced_at && Date.now() - new Date(feed.last_synced_at).getTime() < 60_000) {
        return res.status(429).json({ error: 'Essa casa acabou de sincronizar. Espere um minuto.' })
      }
      const sync = await syncFeed(supabase, feed)
      return reply(feed.id, sync)
    }

    if (action === 'delete') {
      // Limpezas por vir saem da agenda; o historico fica (ical_feed_id vira NULL)
      const now = new Date().toISOString()
      const c = await supabase.from('ag_appointments')
        .update({ status: 'canceled', canceled_at: now, cancel_reason: 'Casa removida da sincronização' })
        .eq('ical_feed_id', feed.id).eq('provider_id', provider.id)
        .in('status', ['pending', 'confirmed']).gt('scheduled_for', now)
      if (c.error) return res.status(500).json({ error: c.error.message })

      const { error } = await supabase.from('ag_ical_feeds').delete().eq('id', feed.id).eq('provider_id', provider.id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
