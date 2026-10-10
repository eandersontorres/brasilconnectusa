/**
 * Calendario .ics de aluguel por temporada (Airbnb, Vrbo, Booking).
 *
 * Leitor minimo, sem dependencia: so VEVENT com datas, que e o que essas
 * plataformas exportam. O Airbnb manda cada reserva como SUMMARY "Reserved"
 * (DTSTART = check-in, DTEND = checkout) e os bloqueios do host como
 * "Airbnb (Not available)". Nao vem nome do hospede nem preco.
 *
 * O link exportado tem um token no query string: quem tem o link ve as datas
 * da casa. Guardar como segredo e nunca devolver inteiro pro navegador.
 */
import dns from 'node:dns/promises'
import net from 'node:net'

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 10000
const MAX_REDIRECTS = 3

// ── Link ──────────────────────────────────────────────────────────────────

/** Valida o link colado pela profissional. Aceita webcal:// (vira https). */
export function normalizeIcsUrl(raw) {
  let s = String(raw || '').trim()
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://')
  let u
  try { u = new URL(s) } catch (_) { return { ok: false, error: 'Link inválido. Copie o link completo do calendário.' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'O link do calendário precisa começar com https://' }
  if (u.username || u.password) return { ok: false, error: 'Link inválido.' }
  if (u.port && u.port !== '443') return { ok: false, error: 'Link inválido.' }
  const host = u.hostname.toLowerCase()
  if (net.isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(^|\.)(localhost|local|internal|home|lan)$/.test(host)) {
    return { ok: false, error: 'Esse endereço não é aceito. Use o link exportado pelo Airbnb, Vrbo ou Booking.' }
  }
  u.hash = ''
  return { ok: true, url: u.toString() }
}

/** De onde vem o calendario, pelo dominio do link. */
export function detectSource(url) {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch (_) {}
  if (/(^|\.)airbnb\./.test(host)) return 'airbnb'
  if (/(^|\.)(vrbo|homeaway|abritel|fewo-direkt|stayz|bookabach)\./.test(host)) return 'vrbo'
  if (/(^|\.)booking\.com$/.test(host)) return 'booking'
  return 'outro'
}

/** Versao do link que pode aparecer na tela: dominio + fim do caminho, sem o token. */
export function maskUrl(url) {
  try {
    const u = new URL(url)
    const tail = u.pathname.split('/').filter(Boolean).pop() || ''
    return u.hostname + '/…/' + (tail.length > 14 ? '…' + tail.slice(-12) : tail)
  } catch (_) { return '' }
}

// ── Download ──────────────────────────────────────────────────────────────

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')
}

async function assertPublicHost(host) {
  let addrs
  try { addrs = await dns.lookup(host, { all: true }) } catch (_) {
    throw new Error('Não encontramos esse endereço. Confira o link do calendário.')
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('Esse endereço não é aceito.')
  }
}

async function readCapped(res) {
  if (!res.body || !res.body.getReader) {
    const t = await res.text()
    if (t.length > MAX_BYTES) throw new Error('O calendário é grande demais.')
    return t
  }
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { try { await reader.cancel() } catch (_) {} throw new Error('O calendário é grande demais.') }
    chunks.push(value)
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map(c => Buffer.from(c))))
}

/**
 * Baixa o .ics. Segue no maximo 3 redirecionamentos, validando cada destino
 * (o link vem da usuaria: nada de endereco interno). Erros com mensagem em PT-BR.
 */
export async function fetchIcs(rawUrl) {
  let current = rawUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const n = normalizeIcsUrl(current)
    if (!n.ok) throw new Error(n.error)
    await assertPublicHost(new URL(n.url).hostname)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      let res
      try {
        res = await fetch(n.url, {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'BrasilConnect-AgendaPro/1.0 (+https://brasilconnectusa.com)', Accept: 'text/calendar, text/plain, */*' },
        })
      } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'O calendário demorou demais pra responder. Tente de novo.' : 'Não conseguimos abrir o link do calendário.')
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location')
        try { if (res.body) await res.body.cancel() } catch (_) {}
        if (!loc) throw new Error('Não conseguimos abrir o link do calendário.')
        current = new URL(loc, n.url).toString()
        continue
      }
      if (res.status === 404 || res.status === 410) throw new Error('Calendário não encontrado. O host pode ter gerado um link novo: peça o link atualizado.')
      if (res.status === 401 || res.status === 403) throw new Error('O calendário recusou o acesso. Peça ao host um link novo.')
      if (!res.ok) throw new Error('O calendário respondeu com erro (' + res.status + '). Tente de novo mais tarde.')

      const text = await readCapped(res)
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Esse link não é de um calendário (.ics). Copie o link de exportar calendário.')
      return text
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('O link redireciona demais. Copie o link direto do calendário.')
}

// ── Leitura ───────────────────────────────────────────────────────────────

function unescapeText(v) {
  return v.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** 'YYYYMMDD' ou 'YYYYMMDDTHHMMSS[Z]' → 'YYYY-MM-DD' (so a data importa pro turnover). */
function toDateKey(v) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v || '').trim())
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Divide "NOME;PARAM=x:valor" no primeiro ':' fora de aspas. */
function splitLine(line) {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) return [line.slice(0, i), line.slice(i + 1)]
  }
  return [line, '']
}

/**
 * Le os VEVENT do texto .ics.
 * Retorna [{ uid, summary, description, status, start, end }] com datas 'YYYY-MM-DD'.
 */
export function parseIcs(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events = []
  let ev = null
  for (const line of lines) {
    if (!line) continue
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') { ev = {}; continue }
    if (upper === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue }
    if (!ev) continue
    const [head, value] = splitLine(line)
    const name = head.split(';')[0].toUpperCase()
    if (name === 'UID') ev.uid = value.trim()
    else if (name === 'SUMMARY') ev.summary = unescapeText(value).trim()
    else if (name === 'DESCRIPTION') ev.description = unescapeText(value)
    else if (name === 'STATUS') ev.status = value.trim().toUpperCase()
    else if (name === 'DTSTART') ev.start = toDateKey(value)
    else if (name === 'DTEND') ev.end = toDateKey(value)
  }
  return events.filter(e => e.start).map(e => ({ ...e, end: e.end && e.end > e.start ? e.end : addDays(e.start, 1) }))
}

/**
 * E reserva de hospede (gera limpeza) ou bloqueio do host?
 * - Airbnb: so "Reserved". "Airbnb (Not available)" e bloqueio.
 * - Vrbo: bloqueio do dono vem como "Blocked".
 * - Booking: tudo vem "CLOSED - Not available" (reserva e bloqueio iguais),
 *   entao tudo conta; a profissional cancela no painel o que nao for reserva,
 *   e a sincronizacao respeita esse cancelamento.
 */
export function isReservation(ev, source) {
  if (ev.status === 'CANCELLED') return false
  const s = String(ev.summary || '').trim()
  if (source === 'airbnb') return /^reserved\b/i.test(s)
  return !/^(blocked|bloqueado|owner block)\b/i.test(s)
}

/**
 * Reservas do feed, uma por UID, ordenadas por check-in, com a data do
 * proximo check-in da casa (pra saber se o proximo hospede chega no mesmo dia).
 * Retorna [{ uid, checkin, checkout, nextCheckin }].
 */
export function reservationsFromIcs(text, source) {
  const seen = new Set()
  const list = []
  for (const ev of parseIcs(text)) {
    if (!isReservation(ev, source)) continue
    const uid = (ev.uid || ev.start + '_' + ev.end).slice(0, 255)
    if (seen.has(uid)) continue
    seen.add(uid)
    list.push({ uid, checkin: ev.start, checkout: ev.end })
  }
  list.sort((a, b) => (a.checkin < b.checkin ? -1 : a.checkin > b.checkin ? 1 : 0))
  for (const r of list) {
    let next = null
    for (const o of list) {
      if (o !== r && o.checkin >= r.checkout && (!next || o.checkin < next)) next = o.checkin
    }
    r.nextCheckin = next
  }
  return list
}
