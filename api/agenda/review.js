/**
 * GET /api/agenda/review?token=...   → valida token e retorna info
 *   { provider_name, provider_slug, client_name, show_branding }
 *   show_branding = false quando o plano da profissional tem 'no_branding' (Premium).
 * POST /api/agenda/review             → submete review
 *   Body: { token, rating, comment? }
 *   Uma avaliacao por atendimento: segunda → 409 { code: 'already_reviewed' }.
 *   Depois de gravar: push no app da profissional (kind 'review').
 */
import { createClient } from '@supabase/supabase-js'
import { sendPushToProvider } from '../_lib/agendaPush.js'
import { hasFeature } from '../_lib/agendaPlans.js'

// Colunas que hasFeature usa pra saber o plano + o que a pagina mostra
const PROVIDER_COLS = 'name, slug, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at'

const ALREADY = { error: 'Você já avaliou esse atendimento. Obrigada!', code: 'already_reviewed' }

// Esse atendimento ja tem avaliacao? (outro link do mesmo atendimento, por exemplo)
async function alreadyReviewed(supabase, appointmentId) {
  if (!appointmentId) return false
  const { data } = await supabase
    .from('ag_reviews').select('id')
    .eq('appointment_id', appointmentId).limit(1)
  return !!(data && data.length)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    if (req.method === 'GET') {
      const token = String(req.query?.token || '').slice(0, 200)
      if (!token) return res.status(400).json({ error: 'token obrigatório' })
      const { data: t } = await supabase
        .from('ag_review_tokens')
        .select(`*, ag_appointments(client_name, client_whatsapp), ag_providers(${PROVIDER_COLS})`)
        .eq('token', token).maybeSingle()
      if (!t) return res.status(404).json({ error: 'Token inválido' })
      if (t.used) return res.status(410).json({ error: 'Token já utilizado' })
      if (new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'Token expirado' })
      if (await alreadyReviewed(supabase, t.appointment_id)) return res.status(409).json(ALREADY)
      return res.status(200).json({
        provider_name: t.ag_providers?.name || '',
        provider_slug: t.ag_providers?.slug || '',
        client_name: t.ag_appointments?.client_name || '',
        show_branding: !hasFeature(t.ag_providers, 'no_branding'),
      })
    }

    if (req.method === 'POST') {
      const { token, comment } = req.body || {}
      const rating = Math.round(Number(req.body?.rating))
      if (!token || !Number.isFinite(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'token e rating (1-5) obrigatórios' })
      }
      const text = comment ? String(comment).trim().slice(0, 2000) || null : null

      const { data: t } = await supabase
        .from('ag_review_tokens')
        .select('*, ag_appointments(client_name)')
        .eq('token', String(token).slice(0, 200)).maybeSingle()
      if (!t || t.used || new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'Token inválido ou expirado' })
      if (await alreadyReviewed(supabase, t.appointment_id)) return res.status(409).json(ALREADY)

      // Marca o link como usado antes de gravar (so um envio passa, mesmo com
      // dois toques seguidos em "Enviar")
      const { data: claimed } = await supabase
        .from('ag_review_tokens').update({ used: true })
        .eq('token', t.token).eq('used', false)
        .select('token')
      if (!claimed || !claimed.length) return res.status(410).json({ error: 'Token já utilizado' })

      const clientName = t.ag_appointments?.client_name || 'Cliente'
      const { error: rErr } = await supabase.from('ag_reviews').insert({
        provider_id: t.provider_id,
        appointment_id: t.appointment_id,
        client_name: clientName,
        rating,
        comment: text,
      })
      if (rErr) {
        // Nao gravou: libera o link pra cliente tentar de novo
        await supabase.from('ag_review_tokens').update({ used: false }).eq('token', t.token)
        return res.status(500).json({ error: rErr.message })
      }

      // Push pra profissional (best effort; respeita plano e preferencia notify_review)
      const first = String(clientName).trim().split(/\s+/)[0] || 'Uma cliente'
      await sendPushToProvider(supabase, t.provider_id, {
        kind: 'review',
        title: `Nova avaliação: ${rating} ${rating === 1 ? 'estrela' : 'estrelas'}`,
        body: text ? `${first}: “${text.slice(0, 140)}${text.length > 140 ? '…' : ''}”` : `${first} avaliou seu atendimento.`,
        data: { type: 'review' },
      })

      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
