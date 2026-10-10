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
