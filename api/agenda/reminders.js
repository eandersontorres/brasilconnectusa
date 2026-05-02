/**
 * GET /api/agenda/reminders?secret=...
 * Cron: roda diariamente. Encontra agendamentos pra amanhã que ainda não tiveram reminder.
 * Por enquanto apenas LOGA o que enviaria — quando integrar Z-API, troca o console.log
 * por uma chamada real à API.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret
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

    let sent = 0
    for (const apt of appointments || []) {
      const time = new Date(apt.scheduled_for).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      const message = `Oi ${apt.client_name}! Lembrete do seu agendamento amanhã às ${time} com ${apt.ag_providers.name} — ${apt.ag_services.name}. Até lá!`
      console.log(`[REMINDER] ${apt.client_whatsapp}: ${message}`)
      // TODO: integrar Z-API aqui
      // await fetch(`https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`, ...)
      await supabase.from('ag_appointments').update({ reminder_24h_sent: true }).eq('id', apt.id)
      sent++
    }

    return res.status(200).json({ ok: true, total: appointments?.length || 0, sent })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
