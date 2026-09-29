/**
 * GET /api/agenda/reminders
 * Cron diario: lembrete de 24h por E-MAIL pra cliente com agendamento amanha.
 *
 * - So marca `reminder_24h_sent` quando o e-mail foi de fato enviado.
 * - Agendamento sem e-mail da cliente nao recebe lembrete (SMS/WhatsApp ainda
 *   nao estao implementados) e fica contado em `sem_email`.
 *
 * Autenticacao: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron),
 * header `x-cron-secret` ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'
import { sendTransactional, formatWhen } from '../_lib/mailer.js'
import { escapeHtml } from '../_lib/emailShell.js'

const MAX_PER_RUN = 80

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Horarios sao hora do relogio da profissional guardada sem fuso: "amanha" e pela data.
    const tomorrowStart = new Date(); tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1); tomorrowStart.setUTCHours(0, 0, 0, 0)
    const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setUTCHours(23, 59, 59, 999)

    const { data: appointments, error } = await supabase
      .from('ag_appointments')
      .select('id, scheduled_for, client_name, client_email, ag_services(name), ag_providers(name, slug, whatsapp)')
      .eq('status', 'confirmed')
      .eq('reminder_24h_sent', false)
      .gte('scheduled_for', tomorrowStart.toISOString())
      .lte('scheduled_for', tomorrowEnd.toISOString())
      .limit(MAX_PER_RUN)

    if (error) return res.status(500).json({ error: error.message })

    let sent = 0, failed = 0, semEmail = 0
    for (const apt of appointments || []) {
      if (!apt.client_email) { semEmail++; continue }

      const provName = apt.ag_providers?.name || 'sua profissional'
      const first = String(apt.client_name || '').trim().split(' ')[0]
      const r = await sendTransactional({
        to: apt.client_email,
        subject: `Lembrete: ${apt.ag_services?.name || 'seu horário'} amanhã com ${provName}`,
        kicker: 'LEMBRETE',
        title: 'Seu horário é amanhã',
        paragraphs: [
          `${first ? 'Oi, ' + escapeHtml(first) + '! ' : ''}Passando pra lembrar do seu agendamento.`,
          `<strong>${escapeHtml(apt.ag_services?.name || 'Atendimento')}</strong> com <strong>${escapeHtml(provName)}</strong>`,
          `Quando: <strong>${escapeHtml(formatWhen(apt.scheduled_for))}</strong>`,
          apt.ag_providers?.whatsapp ? `Precisa remarcar? Fale com ${escapeHtml(provName)} no WhatsApp: ${escapeHtml(apt.ag_providers.whatsapp)}` : '',
        ].filter(Boolean),
        ctaUrl: apt.ag_providers?.slug ? `https://brasilconnectusa.com/agenda/${apt.ag_providers.slug}` : undefined,
        ctaLabel: 'Ver perfil',
      })

      if (r.ok) {
        await supabase.from('ag_appointments').update({ reminder_24h_sent: true }).eq('id', apt.id)
        sent++
      } else {
        failed++
      }
    }

    return res.status(200).json({ ok: true, total: appointments?.length || 0, sent, failed, sem_email: semEmail })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
