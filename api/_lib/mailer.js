/**
 * E-mails transacionais (avisos operacionais): novo pedido, novo agendamento,
 * novo cadastro de negocio. Best effort: nunca derruba o fluxo que chamou.
 *
 * Nao sao marketing, entao nao levam link de descadastro.
 * `paragraphs` recebe HTML: quem chama escapa dado de usuario com escapeHtml().
 *
 * Opcionais (sem eles, nada muda):
 *   replyTo    e-mail valido → resposta vai pra ele (ex.: a profissional), no lugar do REPLY_TO fixo
 *   lang       'pt' | 'en' | 'es' → <html lang> e textos fixos do shell/rodape no idioma
 *   fromName   nome exibido no From, mantendo o endereco do dominio:
 *              'Silva Remodeling' → "Silva Remodeling via BrasilConnect <oi@...>"
 *   hideBrand  sem a marca BrasilConnect no corpo/rodape e no From (Premium no_branding);
 *              com fromName, o nome da empresa vira o topo do e-mail
 */
import { shellHtml, block } from './emailShell.js'

const FROM = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'
const REPLY_TO = 'oi@brasilconnectusa.com'
const LANGS = ['pt', 'en', 'es']
const EMAIL_RE = /^[^\s@<>"'`\\;(),]+@[^\s@<>"'`\\;(),]+\.[^\s@<>"'`\\;(),]{2,}$/
const OPEN_LABEL = { pt: 'Abrir', en: 'Open', es: 'Abrir' }

export function adminEmail() {
  return process.env.CONTACT_NOTIFY_EMAIL || 'oi@brasilconnectusa.com'
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
}

/** Nome pra exibir (From/topo): sem quebra de linha, aspas nem <>; ate 70 caracteres. */
export function cleanDisplayName(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70).trim()
  return s || null
}

/** E-mail de resposta valido (um so, sem quebra de linha) ou null. */
export function cleanReplyTo(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null
}

/**
 * Cabecalho From. Sem fromName → FROM de sempre. Com fromName → o nome dela + ' via BrasilConnect'
 * (hideBrand: so o nome), no mesmo endereco do dominio (o Resend so envia por ele).
 */
export function fromHeader({ fromName, hideBrand } = {}, from = FROM) {
  const name = cleanDisplayName(fromName)
  if (!name) return from
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(from)
  const addr = m ? m[1] : String(from).trim()
  const display = hideBrand ? name : `${name} via BrasilConnect`
  // Ponto, virgula etc. no nome (ex.: 'J. Silva, LLC') pedem aspas no padrao do e-mail
  return /[()<>[\]:;@\\,."]/.test(display) ? `"${display}" <${addr}>` : `${display} <${addr}>`
}

export async function sendTransactional({ to, subject, kicker, title, paragraphs = [], ctaUrl, ctaLabel, replyTo, lang, fromName, hideBrand }) {
  if (!process.env.RESEND_API_KEY || !to) return { ok: false, skipped: true }
  try {
    const L = LANGS.includes(lang) ? lang : null
    const html = shellHtml({
      kicker, title,
      bodyHtml: paragraphs.map(p => block(p)).join(''),
      ctaUrl, ctaLabel,
      hideUnsubscribe: true,
      ...(L ? { lang: L } : {}),
      ...(hideBrand ? { hideBrand: true, brandName: cleanDisplayName(fromName) } : {}),
    })
    const text = [title, '', ...paragraphs.map(stripTags), ctaUrl ? `\n${ctaLabel || OPEN_LABEL[L || 'pt']}: ${ctaUrl}` : ''].join('\n')
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: fromHeader({ fromName, hideBrand: !!hideBrand }),
        to: [to],
        reply_to: cleanReplyTo(replyTo) || REPLY_TO,
        subject, html, text,
      }),
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
