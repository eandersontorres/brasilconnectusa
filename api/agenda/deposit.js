/**
 * POST /api/agenda/deposit
 * Body: { appointment_id, method: 'zelle'|'cash'|'card'|'other' }
 * Quando profissional confirma que recebeu o depósito.
 */
import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  const { appointment_id, method } = req.body || {}
  if (!appointment_id) return res.status(400).json({ error: 'appointment_id obrigatório' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: apt, error } = await supabase
      .from('ag_appointments')
      .update({
        deposit_paid: true,
        payment_method: method || 'zelle',
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', appointment_id)
      .select('*, ag_providers(name, slug), ag_services(name)')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    // Cria payment record
    await supabase.from('ag_payments').insert({
      provider_id: apt.provider_id,
      appointment_id,
      amount_cents: apt.deposit_cents,
      type: 'deposit',
      status: 'paid',
      paid_at: new Date().toISOString(),
      metadata: { method: method || 'zelle' }
    })

    return res.status(200).json({ ok: true, appointment: apt })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
