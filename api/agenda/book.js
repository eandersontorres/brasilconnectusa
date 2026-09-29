/**
 * POST /api/agenda/book
 * Body: { provider_id, service_id, scheduled_for, client_name, client_whatsapp?, client_email?, client_notes? }
 * Cria/atualiza cliente, valida conflito e cria appointment.
 *
 * Regras:
 * - A profissional precisa estar ativa e com assinatura em teste ou ativa.
 * - O servico precisa ser dela (antes dava pra agendar servico de outra profissional).
 * - Com sinal: nasce 'pending' e confirma quando o sinal e pago (cartao) ou
 *   quando a profissional marca como recebido (Zelle, dinheiro).
 *
 * Retorna { appointment_id, status, requires_deposit, deposit_cents, accepts_card, deposit_instructions }
 */
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '../_lib/rateLimit.js'

const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const _rl = rateLimit(req, { windowMs: 60000, max: 10 })
  if (_rl) return res.status(429).json({ error: 'Muitas tentativas. Tenta de novo em ' + _rl.retryAfter + 's.' })

  const { provider_id, service_id, scheduled_for, client_name, client_whatsapp, client_email, client_notes } = req.body || {}
  if (!provider_id || !service_id || !scheduled_for || !client_name) {
    return res.status(400).json({ error: 'provider_id, service_id, scheduled_for e client_name são obrigatórios' })
  }

  const name = String(client_name).trim().slice(0, 120)
  const whatsapp = client_whatsapp ? String(client_whatsapp).trim().slice(0, 30) : null
  const notes = client_notes ? String(client_notes).trim().slice(0, 1000) : null
  let email = client_email ? String(client_email).trim().toLowerCase().slice(0, 254) : null
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' })
  if (!whatsapp && !email) return res.status(400).json({ error: 'Informe WhatsApp ou e-mail pra contato' })
  if (Number.isNaN(new Date(scheduled_for).getTime())) return res.status(400).json({ error: 'Data inválida' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // 0. Profissional ativa e com plano valido
    const { data: prov } = await supabase
      .from('ag_providers')
      .select('id, name, email, slug, whatsapp, active, plan_status, stripe_charges_enabled, deposit_instructions')
      .eq('id', provider_id).maybeSingle()
    if (!prov || !prov.active) return res.status(404).json({ error: 'Profissional não encontrada' })
    if (!['trialing', 'active'].includes(prov.plan_status)) {
      return res.status(403).json({ error: 'Essa agenda ainda não está recebendo agendamentos.' })
    }

    // 1. Buscar serviço (preço, duração, depósito) — tem que ser dessa profissional
    const { data: service, error: sErr } = await supabase
      .from('ag_services').select('*')
      .eq('id', service_id).eq('provider_id', provider_id).eq('active', true).maybeSingle()
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
    if (whatsapp) {
      const { data: client } = await supabase
        .from('ag_clients')
        .upsert({ provider_id, name, whatsapp, notes }, { onConflict: 'provider_id,whatsapp' })
        .select('id')
        .single()
      clientId = client?.id
    }

    // 4. Criar appointment
    const hasDeposit = (service.deposit_cents || 0) > 0
    const { data: appointment, error: aErr } = await supabase
      .from('ag_appointments')
      .insert({
        provider_id,
        service_id,
        client_id: clientId,
        client_name: name,
        client_whatsapp: whatsapp,
        client_email: email,
        client_notes: notes,
        scheduled_for,
        duration_min: service.duration_min,
        total_cents: service.price_cents,
        deposit_cents: service.deposit_cents || 0,
        status: hasDeposit ? 'pending' : 'confirmed',
        confirmed_at: hasDeposit ? null : new Date().toISOString(),
      })
      .select()
      .single()

    if (aErr) return res.status(500).json({ error: aErr.message })

    // 5. E-mails (best effort: nao derrubam o agendamento)
    try {
      const { sendTransactional, formatWhen } = await import('../_lib/mailer.js')
      const { escapeHtml } = await import('../_lib/emailShell.js')
      const when = formatWhen(scheduled_for)
      const sinal = `$${((service.deposit_cents || 0) / 100).toFixed(2)}`

      if (prov.email) {
        await sendTransactional({
          to: prov.email,
          subject: `Novo agendamento: ${name} · ${service.name}`,
          kicker: 'NOVO AGENDAMENTO',
          title: hasDeposit ? 'Novo agendamento aguardando sinal' : 'Novo agendamento confirmado',
          paragraphs: [
            `<strong>${escapeHtml(name)}</strong> agendou <strong>${escapeHtml(service.name)}</strong>.`,
            `Quando: <strong>${escapeHtml(when)}</strong>`,
            whatsapp ? `WhatsApp da cliente: ${escapeHtml(whatsapp)}` : '',
            email ? `E-mail da cliente: ${escapeHtml(email)}` : '',
            notes ? `Observação: ${escapeHtml(notes.slice(0, 500))}` : '',
            hasDeposit
              ? (prov.stripe_charges_enabled
                ? `O horário fica reservado e confirma sozinho quando o sinal de ${sinal} for pago no cartão.`
                : `Sinal de ${sinal} a combinar por fora (Zelle, dinheiro). Quando receber, marque como recebido no painel pra confirmar o horário.`)
              : '',
          ].filter(Boolean),
          ctaUrl: 'https://brasilconnectusa.com/assinante',
          ctaLabel: 'Abrir meu painel',
        })
      }

      if (email) {
        await sendTransactional({
          to: email,
          subject: `${hasDeposit ? 'Agendamento recebido' : 'Agendamento confirmado'}: ${service.name} com ${prov.name}`,
          kicker: hasDeposit ? 'AGENDAMENTO RECEBIDO' : 'AGENDAMENTO CONFIRMADO',
          title: hasDeposit ? 'Falta só o sinal' : 'Seu horário está marcado',
          paragraphs: [
            `<strong>${escapeHtml(service.name)}</strong> com <strong>${escapeHtml(prov.name)}</strong>`,
            `Quando: <strong>${escapeHtml(when)}</strong>`,
            `Valor: $${((service.price_cents || 0) / 100).toFixed(2)}`,
            hasDeposit
              ? (prov.stripe_charges_enabled
                ? `O horário é confirmado assim que o sinal de ${sinal} for pago.`
                : `O horário é confirmado quando ${escapeHtml(prov.name)} receber o sinal de ${sinal}.` +
                  (prov.deposit_instructions ? ` Como pagar: ${escapeHtml(prov.deposit_instructions)}` : ''))
              : '',
            prov.whatsapp ? `Precisa remarcar? Fale com ${escapeHtml(prov.name)} no WhatsApp: ${escapeHtml(prov.whatsapp)}` : '',
          ].filter(Boolean),
          ctaUrl: `https://brasilconnectusa.com/agenda/${prov.slug}`,
          ctaLabel: 'Ver perfil',
        })
      }
    } catch (mailErr) {
      console.error('email de agendamento falhou:', mailErr.message)
    }

    return res.status(200).json({
      appointment_id: appointment.id,
      status: appointment.status,
      requires_deposit: hasDeposit,
      deposit_cents: service.deposit_cents || 0,
      accepts_card: !!prov.stripe_charges_enabled,
      deposit_instructions: hasDeposit && !prov.stripe_charges_enabled ? (prov.deposit_instructions || null) : null,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
