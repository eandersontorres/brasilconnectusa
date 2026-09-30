/**
 * POST /api/agenda/deposit
 * Body: { appointment_id, method: 'zelle'|'cash'|'card'|'other' }
 * A profissional confirma que recebeu o sinal por fora (Zelle, dinheiro...).
 *
 * Auth: JWT da profissional dona do agendamento, ou x-admin-secret.
 * (Mantido por compatibilidade; o painel usa /api/agenda/appointments action=confirm_deposit.)
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth, isAdmin } from '../_lib/providerAuth.js'

const METHODS = ['zelle', 'cash', 'card', 'other']

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { appointment_id, method } = req.body || {}
  if (!appointment_id) return res.status(400).json({ error: 'appointment_id obrigatório' })
  const m = METHODS.includes(method) ? method : 'zelle'

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    let q = supabase.from('ag_appointments').select('id, provider_id, deposit_cents, deposit_paid').eq('id', appointment_id)
    if (!(await isAdmin(req))) {
      const auth = await requireProviderAuth(req, supabase)
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
      q = q.eq('provider_id', auth.provider.id)
    }
    const { data: found } = await q.maybeSingle()
    if (!found) return res.status(404).json({ error: 'Agendamento não encontrado' })

    const now = new Date().toISOString()
    const { data: apt, error } = await supabase
      .from('ag_appointments')
      .update({ deposit_paid: true, payment_method: m, status: 'confirmed', confirmed_at: now })
      .eq('id', appointment_id)
      .select('*, ag_providers(name, slug), ag_services(name)')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    if (!found.deposit_paid && (found.deposit_cents || 0) > 0) {
      await supabase.from('ag_payments').insert({
        provider_id: apt.provider_id,
        appointment_id,
        amount_cents: apt.deposit_cents,
        type: 'deposit',
        status: 'paid',
        paid_at: now,
        metadata: { method: m },
      })
    }

    return res.status(200).json({ ok: true, appointment: apt })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
