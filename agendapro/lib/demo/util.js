// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — utilitários puros (sem react-native: dá pra testar no node).
//
//   Datas seguem a regra de horário do app (CONTRACT.md): scheduled_for é a hora
//   do relógio gravada como UTC ('...T10:00:00.000Z'). "Hoje" e "agora" saem do
//   relógio LOCAL do aparelho, igual a todayKey() de lib/format.js.
// ════════════════════════════════════════════════════════════════════════════

export const pad = (n) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' de hoje pela data local do aparelho. */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Agora no relógio local, no formato de parede ('...T14:05:00.000Z'). */
export function localNowWall(d = new Date()) {
  return `${localToday(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000Z`
}

export function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const weekdayOf = (key) => new Date(key + 'T12:00:00Z').getUTCDay()
export const diffDays = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400e3)
export const toWall = (key, hhmm = '00:00') => `${key}T${String(hhmm).slice(0, 5)}:00.000Z`
export const keyOf = (iso) => String(iso || '').slice(0, 10)
export const hhmmOf = (iso) => String(iso || '').slice(11, 16)
export const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`

/** Hora de parede ('...Z', relógio do aparelho) → timestamp real (created_at, paid_at). */
export function wallToReal(iso, plusMin = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''))
  if (!m) return new Date().toISOString()
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + plusMin).toISOString()
}

// ── Ids (formato UUID, como o banco) ────────────────────────────────────────
let seq = 0
export function uid() {
  seq += 1
  return `de000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`
}
export function resetIds() { seq = 0 }

// ── Aleatório com semente: os mesmos dados toda vez (bom pras capturas da loja) ──
export function rng(seed = 20261009) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  }
}

// ── Entrada (mesmas regras das rotas) ───────────────────────────────────────
export const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
export const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)
export function int(v, min, max, def) {
  if (v === null || v === undefined || v === '') return def
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}

/** Igual a api/_lib/phone.js: '(617) 555-0101' → '+16175550101'. Inválido → null. */
export function normalizePhone(input) {
  const raw = String(input ?? '').trim()
  let d = raw.replace(/\D/g, '')
  if (!d) return null
  if (raw.startsWith('+')) return d.length >= 8 && d.length <= 15 ? '+' + d : null
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10) d = '1' + d
  else if (d.length === 11 && !d.startsWith('1')) d = '55' + d
  else if (d.length === 11 && /^1[01]/.test(d)) d = '55' + d
  if (d.length < 11 || d.length > 15) return null
  return '+' + d
}

/** Sem acento e minúsculo ('Patrícia' → 'patricia'), pra busca e e-mails de exemplo. */
export function fold(s) {
  const str = String(s || '')
  return (typeof str.normalize === 'function' ? str.normalize('NFD') : str).replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export const EMAIL_RE =/^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/

/** Cópia profunda (a tela nunca mexe no estado do "servidor"). */
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

// ── Aceite eletrônico: JSON canônico + SHA-256 (síncrono, sem crypto do aparelho) ──
/** JSON com as chaves em ordem alfabética em todos os níveis (undefined some, igual ao JSON.stringify). */
export function canonicalJson(v) {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'
}

function utf8Bytes(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]
/** SHA-256 em hex do texto (UTF-8) — mesmo resultado do crypto.createHash('sha256') do servidor. */
export function sha256Hex(input) {
  const bytes = utf8Bytes(String(input ?? ''))
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255)
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const W = new Array(64)
  const rotr = (x, n) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + 4 * i
      W[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}
