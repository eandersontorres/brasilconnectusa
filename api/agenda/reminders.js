/**
 * GET /api/agenda/reminders
 * Cron: roda diariamente. Encontra agendamentos pra amanhã que ainda não tiveram reminder.
 *
 * O ENVIO AINDA NAO ESTA IMPLEMENTADO (falta integrar Z-API/Twilio ou email).
 * Por isso o cron so LOGA o que enviaria e NAO marca `reminder_24h_sent`:
 * marcar sem enviar queimaria o lembrete real quando o envio existir.
 *
 * Autenticacao: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron),
 * header `x-cron-secret` ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const tomorrowStart = new Date(); tomorrowStart.setDate(tomorrowStart.getDate() + 1); tomorrowStart.setHours(0,0,0,0)
    const tomorrowEnd   = new Date(tomorrowStart); tomorrowEnd.setHours(23,59,59,999)

    const { data: appointments, error } = await supabase
      .from('ag_appointments')
      .select('id, scheduled_for, client_name, client_whatsapp, ag_services(name), ag_providers(name, slug)')
      .eq('status', 'confirmed')
      .eq('reminder_24h_sent', false)
      .gte('scheduled_for', tomorrowStart.toISOString())
      .lte('scheduled_for', tomorrowEnd.toISOString())

    if (error) return res.status(500).json({ error: error.message })

    for (const apt of appointments || []) {
      const time = new Date(apt.scheduled_for).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      const message = `Oi ${apt.client_name}! Lembrete do seu agendamento amanhã às ${time} com ${apt.ag_providers?.name} — ${apt.ag_services?.name}. Até lá!`
      console.log(`[REMINDER nao enviado: envio nao implementado] apt=${apt.id}: ${message}`)
      // TODO: integrar envio real (Z-API/Twilio/email) e SO ENTAO marcar reminder_24h_sent = true
    }

    return res.status(200).json({ ok: true, total: appointments?.length || 0, sent: 0, note: 'envio de lembrete ainda nao implementado' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
