/**
 * POST /api/agenda/book
 * Body: { provider_id, service_id, scheduled_for, client_name, client_whatsapp, client_notes? }
 * Cria/atualiza cliente, valida conflito e cria appointment.
 * Retorna { appointment_id, requires_deposit, checkout_url? }
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { provider_id, service_id, scheduled_for, client_name, client_whatsapp, client_notes } = req.body || {}
  if (!provider_id || !service_id || !scheduled_for || !client_name) {
    return res.status(400).json({ error: 'provider_id, service_id, scheduled_for e client_name são obrigatórios' })
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // 1. Buscar serviço (preço, duração, depósito)
    const { data: service, error: sErr } = await supabase
      .from('ag_services').select('*').eq('id', service_id).eq('active', true).maybeSingle()
    if (sErr || !service) return res.status(404).json({ error: 'Serviço não encontrado' })

    // 2. Verificar conflito de horário
    const { data: conflict } = await supabase.rpc('ag_check_conflict', {
      p_provider_id: provider_id,
      p_start: scheduled_for,
      p_duration_min: service.duration_min,
    })
    if (conflict) return res.status(409).json({ error: 'Horário indisponível' })

    // 3. Upsert cliente
    let clientId = null
    if (client_whatsapp) {
      const { data: client } = await supabase
        .from('ag_clients')
        .upsert({
          provider_id,
          name: client_name.trim(),
          whatsapp: client_whatsapp.trim(),
          notes: client_notes || null,
        }, { onConflict: 'provider_id,whatsapp' })
        .select('id')
        .single()
      clientId = client?.id
    }

    // 4. Criar appointment
    const { data: appointment, error: aErr } = await supabase
      .from('ag_appointments')
      .insert({
        provider_id,
        service_id,
        client_id: clientId,
        client_name: client_name.trim(),
        client_whatsapp: client_whatsapp?.trim() || null,
        client_notes: client_notes || null,
        scheduled_for,
        duration_min: service.duration_min,
        total_cents: service.price_cents,
        deposit_cents: service.deposit_cents || 0,
        status: service.deposit_cents > 0 ? 'pending' : 'confirmed',
        confirmed_at: service.deposit_cents > 0 ? null : new Date().toISOString(),
      })
      .select()
      .single()

    if (aErr) return res.status(500).json({ error: aErr.message })

    return res.status(200).json({
      appointment_id: appointment.id,
      status: appointment.status,
      requires_deposit: service.deposit_cents > 0,
      deposit_cents: service.deposit_cents || 0,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
