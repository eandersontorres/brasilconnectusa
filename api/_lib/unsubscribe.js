/**
 * Descadastro de e-mails de marketing.
 *
 * O link NAO leva o e-mail na URL: leva um identificador opaco (tipo + id)
 * assinado com HMAC. Tipos:
 *   u = usuario (auth.users.id)      — lembretes de onboarding
 *   w = lista de espera (bc_waitlist.id) — drip da waitlist
 *   a = alerta de cambio (bc_rate_alerts.id)
 *
 * Quem pediu pra sair fica em bc_email_optouts (so service_role acessa).
 */
import crypto from 'crypto'

const SITE_URL = 'https://brasilconnectusa.com'
export const UNSUB_KINDS = ['u', 'w', 'a']

function key() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY || ''
}

export function unsubToken(kind, id) {
  return crypto.createHmac('sha256', key()).update(`${kind}:${id}`).digest('hex').slice(0, 40)
}

export function verifyUnsubToken(kind, id, token) {
  if (!key() || !UNSUB_KINDS.includes(kind) || !id || !token) return false
  const expected = Buffer.from(unsubToken(kind, id))
  const given = Buffer.from(String(token))
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/** Link de descadastro. Retorna null se nao houver id (o chamador decide o fallback). */
export function unsubscribeUrl(kind, id) {
  if (!id || !UNSUB_KINDS.includes(kind)) return null
  return `${SITE_URL}/api/unsubscribe?k=${kind}&id=${encodeURIComponent(id)}&t=${unsubToken(kind, id)}`
}

/** Headers que Gmail/Outlook usam pro botao nativo "Cancelar inscricao". */
export function unsubscribeHeaders(url) {
  if (!url) return undefined
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
}

/** Set com os e-mails (minusculos) que pediram descadastro, dentre os informados. */
export async function loadOptOuts(supabase, emails) {
  const list = [...new Set((emails || []).map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  if (list.length === 0) return new Set()
  const { data, error } = await supabase.from('bc_email_optouts').select('email').in('email', list)
  if (error) {
    // Na duvida, NAO envia: melhor atrasar um e-mail do que mandar pra quem pediu pra sair.
    console.error('[unsubscribe] erro lendo bc_email_optouts:', error.message)
    return new Set(list)
  }
  return new Set((data || []).map(r => r.email))
}
