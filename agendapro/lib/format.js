// ════════════════════════════════════════════════════════════════════════════
//   Datas, dinheiro e telefone.
//
//   REGRA DE HORÁRIO (mesma do backend e do painel web): `scheduled_for` guarda a
//   HORA DO RELÓGIO da profissional sem fuso, gravada como se fosse UTC.
//   "Terça 10:00" em Boston vira '2026-10-13T10:00:00.000Z'. Então:
//     - pra MOSTRAR, leia com getters UTC (fmtTime/fmtDate daqui fazem isso);
//     - pra GRAVAR, monte com toWallIso(dateKey, 'HH:MM');
//     - "hoje" é a data local do celular: todayKey().
//   Nunca use new Date(iso).getHours() nem toLocaleTimeString sem timeZone:'UTC'.
// ════════════════════════════════════════════════════════════════════════════

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export { WEEKDAYS, WEEKDAYS_LONG, MONTHS, MONTHS_LONG }

const pad = (n) => String(n).padStart(2, '0')

// ── Dinheiro (centavos USD) ────────────────────────────────────────────────
export function fmtMoney(cents, { decimals } = {}) {
  const v = (Number(cents) || 0) / 100
  const d = decimals ?? (Number.isInteger(v) ? 0 : 2)
  const s = Math.abs(v).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (v < 0 ? '-$' : '$') + s
}

/** '45', '45.5', '$45,50' → 4550. Vazio/inválido → null. */
export function parseMoney(input) {
  if (input == null) return null
  let s = String(input).trim().replace(/[$\s]/g, '')
  if (!s) return null
  // vírgula como decimal ('45,50') quando não há ponto
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.')
  s = s.replace(/,/g, '')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export const centsToInput = (cents) => (cents == null ? '' : ((Number(cents) || 0) / 100).toFixed(2).replace(/\.00$/, ''))

// ── Datas "de parede" ──────────────────────────────────────────────────────
/** 'YYYY-MM-DD' de um Date, pela data LOCAL do celular. */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const todayKey = () => dateKey(new Date())

/** Soma dias a uma 'YYYY-MM-DD'. */
export function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Dia da semana (0 = domingo) de uma 'YYYY-MM-DD'. */
export const weekdayOf = (key) => new Date(key + 'T12:00:00Z').getUTCDay()

/** Início da semana (domingo, ou segunda se mondayFirst). */
export function startOfWeek(key, mondayFirst = false) {
  const wd = weekdayOf(key)
  const back = mondayFirst ? (wd + 6) % 7 : wd
  return addDays(key, -back)
}

/** 'YYYY-MM-DD' + 'HH:MM' → ISO de parede ('...T10:00:00.000Z'). */
export function toWallIso(key, hhmm = '00:00') {
  const [h, m] = String(hhmm).split(':')
  return `${key}T${pad(Number(h) || 0)}:${pad(Number(m) || 0)}:00.000Z`
}

/** ISO de parede → 'YYYY-MM-DD'. */
export const keyOf = (iso) => String(iso || '').slice(0, 10)
/** ISO de parede → 'HH:MM'. */
export function hhmmOf(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Faixa do dia pra filtro na API: [início, fim] em ISO de parede. */
export const dayRange = (key) => [toWallIso(key, '00:00'), `${key}T23:59:59.999Z`]

export function fmtTime(iso) { return hhmmOf(iso) }

/** 'ter, 14 out' */
export function fmtDay(isoOrKey) {
  const key = String(isoOrKey).length === 10 ? isoOrKey : keyOf(isoOrKey)
  const d = new Date(key + 'T12:00:00Z')
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** 'Hoje', 'Amanhã', 'Ontem' ou 'ter, 14 out' */
export function fmtRelativeDay(isoOrKey) {
  const key = String(isoOrKey).length === 10 ? isoOrKey : keyOf(isoOrKey)
  const today = todayKey()
  if (key === today) return 'Hoje'
  if (key === addDays(today, 1)) return 'Amanhã'
  if (key === addDays(today, -1)) return 'Ontem'
  return fmtDay(key)
}

/** 'ter, 14 out · 10:00' */
export const fmtWhen = (iso) => `${fmtRelativeDay(iso)} · ${fmtTime(iso)}`

/** 'outubro de 2026' a partir de 'YYYY-MM' ou 'YYYY-MM-DD' */
export function fmtMonth(key) {
  const [y, m] = String(key).split('-')
  return `${MONTHS_LONG[Number(m) - 1]} de ${y}`
}

/** Data real (timestamp com fuso, ex.: created_at) → 'há 3 dias' */
export function fmtAgo(iso) {
  const t = new Date(iso).getTime()
  if (!t) return ''
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'agora'
  const m = Math.round(s / 60); if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60); if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24); if (d < 30) return `há ${d} dia${d > 1 ? 's' : ''}`
  const mo = Math.round(d / 30); if (mo < 12) return `há ${mo} ${mo > 1 ? 'meses' : 'mês'}`
  const y = Math.round(mo / 12); return `há ${y} ano${y > 1 ? 's' : ''}`
}

export function fmtDuration(min) {
  const n = Number(min) || 0
  if (n < 60) return `${n} min`
  const h = Math.floor(n / 60), r = n % 60
  return r ? `${h}h${pad(r)}` : `${h}h`
}

// ── Telefone (EUA por padrão; aceita +55) ──────────────────────────────────
/** Só dígitos com DDI: '(512) 555-0101' → '15125550101'. */
export function phoneDigits(input) {
  let d = String(input || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 10) d = '1' + d          // número dos EUA sem DDI
  return d
}

export function fmtPhone(input) {
  const d = phoneDigits(input)
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.startsWith('55') && d.length >= 12) return `+55 ${d.slice(2, 4)} ${d.slice(4, -4)}-${d.slice(-4)}`
  return input ? String(input) : ''
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || '').join('') || '?'
