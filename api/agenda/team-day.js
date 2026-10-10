/**
 * Rota do dia da equipe (publica, sem login): a pagina /agenda/equipe?t=TOKEN
 * mostra as paradas do dia de uma pessoa/equipe, em ordem de horario.
 *
 * GET /api/agenda/team-day?t=TOKEN&date=YYYY-MM-DD
 *     date padrao: hoje no fuso da profissional (ag_providers.timezone).
 *     404 link invalido ou desativado · 403 plano sem 'team_day_link'
 *     → { staff: { name, members }, provider: { name, whatsapp }, today, date,
 *         stops: [{ time, end_time, duration_min, client_first_name, service, address_line,
 *                   city, state, zip, home_notes, client_whatsapp, maps_url, notes, status }] }
 *
 * Nada de valores, pagamentos ou e-mail da cliente: a equipe so precisa chegar
 * e fazer o servico. O token vale como senha (gerar outro no app invalida este).
 */
import { createClient } from '@supabase/supabase-js'
import { hasFeature } from '../_lib/agendaPlans.js'
import { rateLimit } from '../_lib/rateLimit.js'
import { addDays, hhmm, isDateKey, wallNow } from '../_lib/recurring.js'

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/
const SHOW = ['pending', 'confirmed', 'completed']
const PROV_COLS = 'id, name, whatsapp, active, plan, plan_status, current_period_end, trial_ends_at, stripe_subscription_id, created_at, timezone'

const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''

function mapsUrl(parts) {
  const q = parts.filter(Boolean).join(', ')
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')

  if (rateLimit(req, { windowMs: 60_000, max: 40 })) {
    return res.status(429).json({ error: 'Muitas tentativas. Espere um minuto e atualize.' })
  }

  try {
    const token = String(req.query.t || '').trim()
    if (!TOKEN.test(token)) return res.status(404).json({ error: 'Link inválido. Peça um link novo pra quem te mandou.' })

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: staff, error: sErr } = await supabase.from('ag_staff')
      .select('id, provider_id, name, members, active')
      .eq('day_link_token', token).maybeSingle()
    if (sErr) return res.status(500).json({ error: 'Não foi possível abrir a rota agora.' })
    if (!staff || !staff.active) return res.status(404).json({ error: 'Link inválido ou desativado. Peça um link novo pra quem te mandou.' })

    const { data: provider } = await supabase.from('ag_providers').select(PROV_COLS).eq('id', staff.provider_id).maybeSingle()
    if (!provider) return res.status(404).json({ error: 'Link inválido ou desativado.' })
    if (!hasFeature(provider, 'team_day_link')) {
      return res.status(403).json({ error: 'A rota do dia não está disponível agora. Fale com quem te mandou o link.', code: 'plan_required' })
    }

    const today = wallNow(provider.timezone || 'America/New_York').key
    let date = String(req.query.date || '').slice(0, 10) || today
    if (!isDateKey(date)) return res.status(400).json({ error: 'Data inválida' })
    // Só ontem até as próximas 2 semanas: o link não vira histórico da agenda
    if (date < addDays(today, -1) || date > addDays(today, 14)) {
      return res.status(400).json({ error: 'Essa data não está disponível no link.' })
    }

    const { data: apts, error: aErr } = await supabase.from('ag_appointments')
      .select('id, scheduled_for, duration_min, status, client_id, client_name, client_whatsapp, client_notes, external_uid, ag_services(name), ag_ical_feeds(label, notes)')
      .eq('provider_id', provider.id).eq('staff_id', staff.id)
      .in('status', SHOW)
      .gte('scheduled_for', `${date}T00:00:00.000Z`).lte('scheduled_for', `${date}T23:59:59.999Z`)
      .order('scheduled_for', { ascending: true })
      .limit(60)
    if (aErr) return res.status(500).json({ error: 'Não foi possível carregar as paradas agora.' })

    // Endereço e observações da casa vêm da ficha da cliente
    const ids = [...new Set((apts || []).map((a) => a.client_id).filter(Boolean))]
    let clients = new Map()
    if (ids.length) {
      const { data: cs } = await supabase.from('ag_clients')
        .select('id, name, whatsapp, address_line, city, state, zip, home_notes')
        .eq('provider_id', provider.id).in('id', ids)
      clients = new Map((cs || []).map((c) => [c.id, c]))
    }

    const stops = (apts || []).map((a) => {
      const c = a.client_id ? clients.get(a.client_id) : null
      const feed = a.ag_ical_feeds || null
      const start = hhmm(String(a.scheduled_for).slice(11, 16))
      const [h, m] = start.split(':').map(Number)
      const endMin = h * 60 + m + (Number(a.duration_min) || 0)
      const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
      const address = c ? [c.address_line, c.city, [c.state, c.zip].filter(Boolean).join(' ')] : []
      return {
        time: start,
        end_time: end,
        duration_min: a.duration_min,
        // Turnover: o "nome" é a casa (ex.: Casa do lago), não uma pessoa
        client_first_name: feed && !c ? (feed.label || a.client_name || '') : firstName(c?.name || a.client_name),
        service: a.ag_services?.name || (feed ? 'Turnover' : null),
        address_line: c?.address_line || null,
        city: c?.city || null,
        state: c?.state || null,
        zip: c?.zip || null,
        home_notes: c?.home_notes || (feed && !c ? feed.notes : null) || null,
        client_whatsapp: c?.whatsapp || a.client_whatsapp || null,
        maps_url: mapsUrl(address),
        notes: a.client_notes || null,
        status: a.status,
      }
    })

    const members = Array.isArray(staff.members) ? staff.members.filter((x) => typeof x === 'string').slice(0, 12) : []
    return res.status(200).json({
      staff: { name: staff.name, members },
      provider: { name: provider.name, whatsapp: provider.whatsapp || null },
      today,
      date,
      stops,
    })
  } catch (e) {
    return res.status(500).json({ error: 'Não foi possível abrir a rota agora.' })
  }
}
