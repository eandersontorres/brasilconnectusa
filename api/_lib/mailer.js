/**
 * E-mails transacionais (avisos operacionais): novo pedido, novo agendamento,
 * novo cadastro de negocio. Best effort: nunca derruba o fluxo que chamou.
 *
 * Nao sao marketing, entao nao levam link de descadastro.
 * `paragraphs` recebe HTML: quem chama escapa dado de usuario com escapeHtml().
 */
import { shellHtml, block } from './emailShell.js'

const FROM = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'
const REPLY_TO = 'oi@brasilconnectusa.com'

export function adminEmail() {
  return process.env.CONTACT_NOTIFY_EMAIL || 'oi@brasilconnectusa.com'
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
}

export async function sendTransactional({ to, subject, kicker, title, paragraphs = [], ctaUrl, ctaLabel }) {
  if (!process.env.RESEND_API_KEY || !to) return { ok: false, skipped: true }
  try {
    const html = shellHtml({
      kicker, title,
      bodyHtml: paragraphs.map(p => block(p)).join(''),
      ctaUrl, ctaLabel,
      hideUnsubscribe: true,
    })
    const text = [title, '', ...paragraphs.map(stripTags), ctaUrl ? `\n${ctaLabel || 'Abrir'}: ${ctaUrl}` : ''].join('\n')
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
    })
    if (!r.ok) {
      console.error('[notify] resend respondeu', r.status, (await r.text()).slice(0, 200))
      return { ok: false }
    }
    return { ok: true }
  } catch (e) {
    console.error('[notify] erro:', e.message)
    return { ok: false }
  }
}

// Fuso por estado, pra mostrar o horario do agendamento no relogio da profissional.
const TZ_BY_STATE = {
  FL: 'America/New_York', MA: 'America/New_York', NY: 'America/New_York', NJ: 'America/New_York',
  CT: 'America/New_York', GA: 'America/New_York', PA: 'America/New_York', NC: 'America/New_York',
  SC: 'America/New_York', VA: 'America/New_York', MD: 'America/New_York', DC: 'America/New_York',
  OH: 'America/New_York', MI: 'America/New_York',
  TX: 'America/Chicago', IL: 'America/Chicago', TN: 'America/Chicago', LA: 'America/Chicago',
  MN: 'America/Chicago', MO: 'America/Chicago', WI: 'America/Chicago',
  CO: 'America/Denver', UT: 'America/Denver', AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
}

export function formatWhen(iso, state) {
  const tz = TZ_BY_STATE[String(state || '').toUpperCase()] || 'America/New_York'
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: tz, weekday: 'long', day: '2-digit', month: 'long',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
  } catch (_) {
    return String(iso)
  }
}
