/**
 * Agendamentos da profissional.
 *
 * GET  /api/agenda/appointments?scope=upcoming|past   com JWT
 * POST /api/agenda/appointments                       com JWT
 *      Body: { id, action, method?, reason? }
 *      action:
 *        confirm_deposit  sinal recebido por fora (method: zelle|cash|card|other) → confirma
 *        confirm          confirma sem sinal
 *        complete         atendimento realizado
 *        no_show          cliente faltou
 *        cancel           cancela (reason opcional)
 *
 * Os horarios sao guardados como hora do relogio da profissional (sem fuso),
 * por isso a lista "proximos" olha 12h pra tras: evita sumir com o agendamento
 * de hoje por diferenca de fuso do servidor.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'

const LIST_COLS = 'id, scheduled_for, duration_min, status, client_name, client_whatsapp, client_email, client_notes, total_cents, deposit_cents, deposit_paid, payment_method, review_requested, created_at, cancel_reason, external_uid, ical_next_checkin, ag_services(name), ag_ical_feeds(label, source, notes)'
const METHODS = ['zelle', 'cash', 'card', 'other']

// Turnover (external_uid preenchido) traz a casa sincronizada no lugar do servico
const shape = a => ({
  ...a,
  service_name: a.ag_services?.name || null,
  feed_label: a.ag_ical_feeds?.label || null,
  feed_source: a.ag_ical_feeds?.source || null,
  feed_notes: a.ag_ical_feeds?.notes || null,
  ag_services: undefined,
  ag_ical_feeds: undefined,
})

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const providerId = auth.provider.id

    if (req.method === 'GET') {
      const past = req.query.scope === 'past'
      const pivot = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
      let q = supabase.from('ag_appointments').select(LIST_COLS).eq('provider_id', providerId)
      q = past
        ? q.lt('scheduled_for', pivot).order('scheduled_for', { ascending: false })
        : q.gte('scheduled_for', pivot).order('scheduled_for', { ascending: true })
      const { data, error } = await q.limit(100)
      if (error) return res.status(500).json({ error: error.message })

      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({
        appointments: (data || []).map(shape),
      })
    }

    // POST: acao sobre um agendamento
    const { id, action, method, reason } = req.body || {}
    if (!id || !action) return res.status(400).json({ error: 'id e action são obrigatórios' })

    const { data: apt } = await supabase.from('ag_appointments')
      .select('id, provider_id, status, deposit_cents, deposit_paid')
      .eq('id', id).eq('provider_id', providerId).maybeSingle()
    if (!apt) return res.status(404).json({ error: 'Agendamento não encontrado' })

    const now = new Date().toISOString()
    let patch = null

    if (action === 'confirm_deposit') {
      const m = METHODS.includes(method) ? method : 'zelle'
      patch = { deposit_paid: true, payment_method: m, status: 'confirmed', confirmed_at: now }
      if (!apt.deposit_paid && (apt.deposit_cents || 0) > 0) {
        await supabase.from('ag_payments').insert({
          provider_id: providerId, appointment_id: id, amount_cents: apt.deposit_cents,
          type: 'deposit', status: 'paid', paid_at: now, metadata: { method: m, confirmed_by: 'provider' },
        })
      }
    } else if (action === 'confirm') {
      patch = { status: 'confirmed', confirmed_at: now }
    } else if (action === 'complete') {
      patch = { status: 'completed', completed_at: now }
    } else if (action === 'no_show') {
      patch = { status: 'no_show' }
    } else if (action === 'cancel') {
      patch = { status: 'canceled', canceled_at: now, cancel_reason: reason ? String(reason).slice(0, 300) : null }
    } else {
      return res.status(400).json({ error: 'Ação inválida' })
    }

    const { data: updated, error } = await supabase.from('ag_appointments')
      .update(patch).eq('id', id).eq('provider_id', providerId).select(LIST_COLS).single()
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({
      ok: true,
      appointment: shape(updated),
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
