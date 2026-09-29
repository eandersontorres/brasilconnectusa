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

// Os horarios do AgendaPro sao guardados como hora do relogio da profissional,
// sem fuso (a pagina manda "2026-10-02T10:00:00" e o banco guarda como UTC).
// Por isso formata em UTC: converter pra um fuso deslocaria a hora.
export function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long',
      hour: '2-digit', minute: '2-digit',
    })
  } catch (_) {
    return String(iso)
  }
}
