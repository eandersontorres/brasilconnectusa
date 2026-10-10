/**
 * POST /api/agenda/book
 * Body: { provider_id, service_id, scheduled_for, client_name, client_whatsapp?, client_email?, client_notes? }
 * Cria/atualiza cliente, valida conflito e cria appointment.
 *
 * Regras:
 * - A profissional precisa estar ativa e com o recurso 'online_booking' no plano
 *   (teste gratis ou assinatura em dia — api/_lib/agendaPlans.js).
 * - O servico precisa ser dela (antes dava pra agendar servico de outra profissional).
 * - scheduled_for e hora de parede sem fuso ('2026-10-13T10:00[:00][Z]'), gravada
 *   como '2026-10-13T10:00:00.000Z'. Com fuso (-04:00 etc.) → 400.
 * - So aceita horario que a pagina ofereceria: nao passou (fuso da profissional),
 *   ate 366 dias pra frente e dentro dos slots de ag_get_available_slots
 *   (expediente, folgas, conflito). Fora disso → 409.
 * - Horario em conflito ou em folga/ferias (rpc ag_is_blocked) → 409.
 * - Ficha da cliente: acha por (provider_id, WhatsApp normalizado); se existe, nao
 *   muda nada que a profissional escreveu (nome, observacoes) nem grava o e-mail
 *   que veio na pagina publica (qualquer um que saiba o WhatsApp mandaria o seu e
 *   passaria a receber os lembretes dela). O e-mail fica so no agendamento.
 * - Com sinal: nasce 'pending' e confirma quando o sinal e pago (cartao) ou
 *   quando a profissional marca como recebido (Zelle, dinheiro). Sinal no cartao
 *   e recurso do plano Pro ('deposit_stripe').
 * - WhatsApp da cliente gravado como '+' + digitos (10 digitos = EUA → +1), igual
 *   ao cadastro de clientes do app.
 * - Depois de criar: e-mails (profissional e cliente) e push no app da profissional.
 *
 * Retorna { appointment_id, status, requires_deposit, deposit_cents, accepts_card, deposit_instructions }
 */
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '../_lib/rateLimit.js'
import { hasFeature } from '../_lib/agendaPlans.js'
import { sendPushToProvider, shortWhen } from '../_lib/agendaPush.js'
// Mesma regra do cadastro de clientes do app: '+' + digitos, 10 digitos = EUA (+1)
import { normalizePhone } from '../_lib/phone.js'
import { addDays, isDateKey, wallNow } from '../_lib/recurring.js'

const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/
const MAX_DAYS_AHEAD = 366

// Colunas pra conferir o plano (hasFeature) + o que os e-mails e o push usam
const PROVIDER_COLS = 'id, name, email, slug, whatsapp, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at, stripe_charges_enabled, deposit_instructions'

/**
 * Hora de parede sem fuso → { date: 'YYYY-MM-DD', hhmm: 'HH:MM', iso } ou null.
 * Aceita 'YYYY-MM-DDTHH:MM', ':SS', '.mmm' e 'Z' final; recusa offset (-04:00).
 * Funcao pura.
 */
export function parseBookingWall(v) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?Z?$/.exec(String(v || '').trim())
  if (!m || !isDateKey(m[1])) return null
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return null
  const hhmm = `${m[2]}:${m[3]}`
  return { date: m[1], hhmm, iso: `${m[1]}T${hhmm}:00.000Z` }
}

/**
 * Motivo pra recusar pelo relogio da profissional (ou null). `now` = wallNow(tz).
 * Funcao pura.
 */
export function bookingTimeProblem(wall, now) {
  if (!wall) return 'invalid'
  if (wall.date < now.key || (wall.date === now.key && wall.hhmm <= now.hhmm)) return 'past'
  if (wall.date > addDays(now.key, MAX_DAYS_AHEAD)) return 'too_far'
  return null
}

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
  const rawWhatsapp = client_whatsapp ? String(client_whatsapp).trim().slice(0, 30) : ''
  const whatsapp = rawWhatsapp ? normalizePhone(rawWhatsapp) : null
  if (rawWhatsapp && !whatsapp) return res.status(400).json({ error: 'WhatsApp inválido. Coloque o DDD e o número (ex.: (512) 555-0101).' })
  const notes = client_notes ? String(client_notes).trim().slice(0, 1000) : null
  let email = client_email ? String(client_email).trim().toLowerCase().slice(0, 254) : null
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' })
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' })
  if (!whatsapp && !email) return res.status(400).json({ error: 'Informe WhatsApp ou e-mail pra contato' })
  const wall = parseBookingWall(scheduled_for)
  if (!wall) return res.status(400).json({ error: 'Data inválida' })
  const scheduled = wall.iso

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // 0. Profissional ativa e com agendamento online no plano (+ fuso, se a coluna ja existir)
    let { data: prov, error: pErr } = await supabase
      .from('ag_providers')
      .select(PROVIDER_COLS + ', timezone')
      .eq('id', provider_id).maybeSingle()
    if (pErr) {
      const retry = await supabase.from('ag_providers').select(PROVIDER_COLS).eq('id', provider_id).maybeSingle()
      prov = retry.data
    }
    if (!prov || !prov.active) return res.status(404).json({ error: 'Profissional não encontrada' })
    if (!hasFeature(prov, 'online_booking')) {
      return res.status(403).json({ error: 'Essa agenda ainda não está recebendo agendamentos.' })
    }
    const acceptsCard = !!prov.stripe_charges_enabled && hasFeature(prov, 'deposit_stripe')

    // 1. Buscar serviço (preço, duração, depósito) — tem que ser dessa profissional
    const { data: service, error: sErr } = await supabase
      .from('ag_services').select('*')
      .eq('id', service_id).eq('provider_id', provider_id).eq('active', true).maybeSingle()
    if (sErr || !service) return res.status(404).json({ error: 'Serviço não encontrado' })

    // 2. Horario que a pagina ofereceria: nao passou, nao esta longe demais e
    //    esta nos slots do dia (mesma regra e mesmo passo de availability.js)
    const problem = bookingTimeProblem(wall, wallNow(prov.timezone || 'America/New_York'))
    if (problem === 'past') return res.status(409).json({ error: 'Esse horário já passou. Escolha outro.' })
    if (problem) return res.status(409).json({ error: 'Horário indisponível' })

    const dur = Math.min(Math.max(parseInt(service.duration_min, 10) || 60, 5), 720)
    const { data: slotRows, error: slotErr } = await supabase.rpc('ag_get_available_slots', {
      p_provider_id: provider_id,
      p_date: wall.date,
      p_duration_min: dur,
      p_slot_step_min: 30,
    })
    if (slotErr) return res.status(500).json({ error: 'Não conseguimos conferir o horário agora. Tente de novo.' })
    const slots = new Set((slotRows || []).map(s => String(s.slot_time || '').slice(0, 5)))
    if (!slots.has(wall.hhmm)) return res.status(409).json({ error: 'Horário indisponível' })

    // 2a. Conflito de horário (de novo, perto do insert)
    const { data: conflict } = await supabase.rpc('ag_check_conflict', {
      p_provider_id: provider_id,
      p_start: scheduled,
      p_duration_min: service.duration_min,
    })
    if (conflict) return res.status(409).json({ error: 'Horário indisponível' })

    // 2b. Folga/ferias (ag_blocked_dates). Erro da rpc (funcao ainda nao criada
    //     — ag_app_setup.sql) = segue como nao bloqueado.
    const { data: blocked, error: bErr } = await supabase.rpc('ag_is_blocked', {
      p_provider_id: provider_id,
      p_start: scheduled,
      p_duration_min: service.duration_min,
    })
    if (!bErr && blocked === true) return res.status(409).json({ error: 'Horário indisponível' })

    // 3. Cliente: reaproveita a ficha pelo WhatsApp sem mexer no que a profissional
    //    escreveu. E-mail vindo da pagina publica so entra em ficha NOVA (numa ficha
    //    existente, quem soubesse o WhatsApp trocaria pra onde vao os lembretes);
    //    nos dois casos ele fica no agendamento. A observacao fica no agendamento.
    let clientId = null
    if (whatsapp) {
      const findClient = () => supabase
        .from('ag_clients').select('id, name, email')
        .eq('provider_id', provider_id).eq('whatsapp', whatsapp).maybeSingle()
      let { data: existing } = await findClient()
      if (!existing) {
        // Ficha nova. Insert (nao upsert): se outra requisicao criou no meio
        // tempo (unique provider_id+whatsapp), reaproveita a ficha dela.
        const { data: created, error: cErr } = await supabase
          .from('ag_clients')
          .insert({ provider_id, name, whatsapp, email })
          .select('id')
          .single()
        if (created) clientId = created.id
        else if (cErr) existing = (await findClient()).data
      }
      if (existing) {
        clientId = existing.id
        const fill = {}
        if (!String(existing.name || '').trim()) fill.name = name
        if (Object.keys(fill).length) {
          await supabase.from('ag_clients').update(fill).eq('id', existing.id).eq('provider_id', provider_id)
        }
      }
    }

    // 4. Criar appointment
    const hasDeposit = (service.deposit_cents || 0) > 0
    const row = {
      provider_id,
      service_id,
      client_id: clientId,
      client_name: name,
      client_whatsapp: whatsapp,
      client_email: email,
      client_notes: notes,
      scheduled_for: scheduled,
      duration_min: service.duration_min,
      total_cents: service.price_cents,
      deposit_cents: service.deposit_cents || 0,
      status: hasDeposit ? 'pending' : 'confirmed',
      confirmed_at: hasDeposit ? null : new Date().toISOString(),
      source: 'online',
    }
    let ins = await supabase.from('ag_appointments').insert(row).select().single()
    if (ins.error && /source/.test(ins.error.message || '')) {
      // Banco sem a coluna source (ag_app_agenda.sql ainda nao aplicado): nao perde o agendamento
      const { source, ...rest } = row
      ins = await supabase.from('ag_appointments').insert(rest).select().single()
    }
    const { data: appointment, error: aErr } = ins

    if (aErr) return res.status(500).json({ error: aErr.message })

    // 5. E-mails (best effort: nao derrubam o agendamento)
    try {
      const { sendTransactional, formatWhen } = await import('../_lib/mailer.js')
      const { escapeHtml } = await import('../_lib/emailShell.js')
      const when = formatWhen(scheduled)
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
              ? (acceptsCard
                ? `O horário fica reservado e confirma sozinho quando o sinal de ${sinal} for pago no cartão.`
                : `Sinal de ${sinal} a combinar por fora (Zelle, dinheiro). Quando receber, marque como recebido no app AgendaPro ou no painel pra confirmar o horário.`)
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
              ? (acceptsCard
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

    // 6. Push no app da profissional (best effort; respeita plano e preferencia)
    await sendPushToProvider(supabase, prov.id, {
      kind: 'new_booking',
      title: hasDeposit ? 'Novo agendamento (aguardando sinal)' : 'Novo agendamento',
      body: `${name} · ${service.name} · ${shortWhen(scheduled)}`,
      data: { type: 'appointment', id: appointment.id },
    })

    return res.status(200).json({
      appointment_id: appointment.id,
      status: appointment.status,
      requires_deposit: hasDeposit,
      deposit_cents: service.deposit_cents || 0,
      accepts_card: acceptsCard,
      deposit_instructions: hasDeposit && !acceptsCard ? (prov.deposit_instructions || null) : null,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
