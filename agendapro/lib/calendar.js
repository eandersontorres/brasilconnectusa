// Calendário do celular (expo-calendar). Os agendamentos vão pra um calendário
// com o nome do app (BRAND.name: "AgendaPro" ou "WorkPro") no iPhone/Android; o
// mesmo agendamento é ATUALIZADO (não duplica): guardamos appointmentId → eventId
// no aparelho. Nada disso existe no preview web.
// Cada evento leva nas notas a linha "ID AgendaPro: <id>" (no WorkPro, "ID WorkPro: <id>").
// Cada app só reconhece o próprio calendário e a própria marca: o AgendaPro continua
// achando o "AgendaPro" de sempre e o WorkPro cria o dele. O mapa é do aparelho
// (some ao reinstalar; iPhone e iPad têm um cada), mas o calendário do iCloud é
// o mesmo: pela marca o app reconhece os eventos que já existem, adota em vez de
// criar outro e apaga os repetidos e os de agendamento que não existe mais.
//
// Assinaturas fixas (outras telas já importam):
//   addToCalendar(appointment, provider) → Promise<boolean>   (um agendamento)
//   syncUpcoming(appointments, provider) → Promise<{ added, updated, removed, failed, error }>
//     error: null quando deu certo; senão o mesmo código de calendarError()
//   calendarAvailable() → boolean
// Extras:
//   calendarPermission() → 'granted'|'denied'|'undetermined'|'unavailable' (não pede)
//   requestCalendarAccess() → Promise<boolean> (pede)
//   syncFromServer(provider) → busca os próximos 60 dias na API e sincroniza
//   removeFromCalendar(appointmentId) · clearCalendar() · lastCalendarSync() · calendarError()
//
// Horário: scheduled_for é a hora do relógio da profissional (CONTRACT.md). Pro
// calendário do celular vira um instante de verdade: hora de parede no fuso do
// perfil (provider.timezone) → hora local do aparelho. Sem fuso válido, usa a
// mesma hora no relógio do aparelho.
//
// Quem chama addToCalendar e recebe false pode ler calendarError():
//   'permission' (sem acesso), 'unavailable' (web), 'invalid' (sem data), 'error'.
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from './api'
import { addDays, fmtPhone, todayKey } from './format'
import { colors, statusStyle } from './theme'
import { BRAND, VARIANT } from './variant'

const isWeb = Platform.OS === 'web'
const CAL_KEY = 'agendapro.calendar.id.v1'      // { id, own, adopted? } adopted = achado pelo nome, ainda não conferido
const MAP_KEY = 'agendapro.calendar.map.v1'     // { [appointmentId]: { e: eventId, t: startMs } }
const LAST_KEY = 'agendapro.calendar.last.v1'   // { at, added, updated, removed }
const CAL_TITLE = BRAND.name                    // 'AgendaPro' (o de sempre) | 'WorkPro'
const SYNC_DAYS = 60
const DONE = ['canceled', 'no_show']
const DAY_MS = 86400e3
const MARK = `ID ${BRAND.name}: `
// Só a última linha (obs. da cliente vem antes). AgendaPro: /(?:^|\n)ID AgendaPro: (\S+)\s*$/
const MARK_RE = new RegExp(`(?:^|\\n)${MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\S+)\\s*$`)

const Cal = () => require('expo-calendar')

let lastError = null
export const calendarError = () => lastError

export function calendarAvailable() {
  return !isWeb
}

// ── Hora de parede → Date ──────────────────────────────────────────────────

function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch (_) { return null }
}

/** Partes da data/hora de um instante visto no fuso `tz`. */
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const o = {}
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value
  return Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour) % 24, Number(o.minute), Number(o.second))
}

/**
 * '2026-10-13T10:00:00.000Z' (10:00 no relógio da profissional) → Date do instante real.
 * Com `tz` ('America/New_York'): 10:00 em Nova York. Sem tz: 10:00 no relógio do aparelho.
 */
export function wallToDate(iso, tz) {
  const w = new Date(iso)
  if (Number.isNaN(w.getTime())) return null
  const local = () => new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), 0, 0)
  if (!tz) return local()
  try {
    const guess = w.getTime()                    // hora de parede lida como UTC
    const off1 = partsIn(guess, tz) - guess      // deslocamento do fuso nesse instante
    let ms = guess - off1
    const off2 = partsIn(ms, tz) - ms            // reconfere (virada do horário de verão)
    if (off2 !== off1) ms = guess - off2
    return new Date(ms)
  } catch (_) {
    return local()
  }
}

// ── Armazenamento local ────────────────────────────────────────────────────
async function readJson(key, def) {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : def } catch (_) { return def }
}
const writeJson = (key, v) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {})

export async function lastCalendarSync() {
  return readJson(LAST_KEY, null)
}

// ── Permissão e calendário ─────────────────────────────────────────────────
export async function calendarPermission() {
  if (isWeb) return 'unavailable'
  try {
    const { status } = await Cal().getCalendarPermissionsAsync()
    return status || 'undetermined'
  } catch (_) {
    return 'unavailable'
  }
}

export async function requestCalendarAccess() {
  if (isWeb) return false
  try {
    const { status } = await Cal().requestCalendarPermissionsAsync()
    return status === 'granted'
  } catch (_) {
    return false
  }
}

/** Acha (ou cria) o calendário do app (CAL_TITLE). → { id, own } */
async function getCalendar() {
  const C = Cal()
  const saved = await readJson(CAL_KEY, null)
  const cals = await C.getCalendarsAsync(C.EntityTypes.EVENT)
  const writable = (c) => c && c.allowsModifications !== false
  if (saved?.id && writable(cals.find((c) => c.id === saved.id))) return saved

  // Já existe (app reinstalado, outro aparelho no mesmo iCloud): o mapa deste
  // aparelho não conhece os eventos dele; o sync confere pela marca (adopted)
  const found = cals.find((c) => c.title === CAL_TITLE && writable(c))
  if (found) {
    const v = { id: found.id, own: true, adopted: true }
    await writeJson(CAL_KEY, v)
    return v
  }

  let v
  try {
    let source
    if (Platform.OS === 'ios') {
      const def = await C.getDefaultCalendarAsync()
      source = def.source
    } else {
      source = { isLocalAccount: true, name: CAL_TITLE }
    }
    const id = await C.createCalendarAsync({
      title: CAL_TITLE,
      color: colors.green,
      entityType: C.EntityTypes.EVENT,
      sourceId: source?.id,
      source,
      name: VARIANT,                           // 'agendapro' (como antes) | 'workpro'
      ownerAccount: Platform.OS === 'ios' ? 'personal' : CAL_TITLE,
      accessLevel: C.CalendarAccessLevel?.OWNER || 'owner',
    })
    v = { id, own: true }
  } catch (e) {
    // iPhone com conta que não deixa criar calendário (Exchange/Google): usa o padrão
    if (Platform.OS !== 'ios') throw e
    const def = await C.getDefaultCalendarAsync()
    v = { id: def.id, own: false }
  }
  await writeJson(CAL_KEY, v)
  return v
}

// ── Evento ─────────────────────────────────────────────────────────────────
function eventFor(apt, provider) {
  const tz = provider?.timezone || null
  const start = wallToDate(apt.scheduled_for, tz)
  if (!start) return null
  const minutes = Math.max(5, Number(apt.duration_min) || 60)
  const end = new Date(start.getTime() + minutes * 60e3)

  const isTurnover = !!(apt.external_uid || apt.feed_label)
  const what = isTurnover
    ? `Limpeza · ${apt.feed_label || 'Turnover'}`
    : `${apt.service_name || apt.service_label || 'Atendimento'} · ${apt.client_name || 'Cliente'}`
  const title = apt.staff_name ? `${what} (${apt.staff_name})` : what

  const lines = [
    statusStyle[apt.status]?.label ? `Status: ${statusStyle[apt.status].label}` : '',
    apt.client_whatsapp ? `WhatsApp: ${fmtPhone(apt.client_whatsapp)}` : '',
    apt.client_notes ? `Obs. da cliente: ${apt.client_notes}` : '',
    apt.internal_notes ? `Minhas notas: ${apt.internal_notes}` : '',
    apt.feed_notes ? `Casa: ${apt.feed_notes}` : '',
  ].filter(Boolean)
  // A marca fica sempre no fim, fora do corte de tamanho
  const tail = `Criado pelo ${BRAND.name}\n${MARK}${String(apt.id).slice(0, 64)}`
  const body = lines.join('\n').slice(0, 2000 - tail.length - 1)

  return {
    title: String(title).slice(0, 200),
    startDate: start,
    endDate: end,
    timeZone: deviceTimeZone() || 'UTC',      // obrigatório no Android; o instante já está certo
    notes: body ? `${body}\n${tail}` : tail,
    alarms: [{ relativeOffset: -60 }],
  }
}

// ── Conferência pela marca ─────────────────────────────────────────────────

/** Faixa de busca (ms): a janela e os horários da lista, com 2 dias de folga (fuso). */
function scanRange(appointments, tz, bounds) {
  let lo = bounds ? bounds.from : Infinity
  let hi = bounds ? bounds.to : -Infinity
  for (const a of appointments || []) {
    const d = a?.scheduled_for ? wallToDate(a.scheduled_for, tz) : null
    if (d) { lo = Math.min(lo, d.getTime()); hi = Math.max(hi, d.getTime()) }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? { from: lo - 2 * DAY_MS, to: hi + 2 * DAY_MS } : null
}

/**
 * Eventos do calendário na faixa, separados pela marca.
 * → { byId: Map<appointmentId, [{ e, t }]>, unmarked: [{ e, t }] } · null se não deu pra ler
 */
async function scanCalendar(C, calId, range) {
  if (!range) return null
  try {
    const evs = await C.getEventsAsync([calId], new Date(range.from), new Date(range.to))
    const byId = new Map()
    const unmarked = []
    for (const ev of evs || []) {
      if (!ev?.id) continue
      const item = { e: String(ev.id), t: new Date(ev.startDate).getTime() }
      const m = MARK_RE.exec(String(ev.notes || ''))
      if (!m) { unmarked.push(item); continue }
      if (!byId.has(m[1])) byId.set(m[1], [])
      byId.get(m[1]).push(item)
    }
    return { byId, unmarked }
  } catch (e) {
    console.warn('[calendar] scan:', e?.message || e)
    return null
  }
}

/**
 * Junta o mapa deste aparelho com os eventos marcados desse agendamento: adota o
 * que já existe (o do mapa, se estiver lá) e apaga os repetidos. Sem evento
 * marcado, não mexe em nada (calendário escondido no Android não devolve eventos).
 */
async function reconcileOne(C, map, id, cur, scan) {
  const marked = scan.byId.get(id) || []
  scan.byId.delete(id)                    // o que sobrar no scan é de agendamento fora da lista
  if (!marked.length) return cur
  const curE = cur?.e ? String(cur.e) : null
  const keep = marked.find((m) => m.e === curE) || marked[0]
  for (const m of marked) {
    if (m !== keep) { try { await C.deleteEventAsync(m.e) } catch (_) {} }
  }
  // O evento do mapa é outro (horário antigo, fora da busca, ou já apagado): é repetido
  if (curE && curE !== keep.e) { try { await C.deleteEventAsync(curE) } catch (_) {} }
  const v = { e: keep.e, t: keep.t }
  map[id] = v
  return v
}

/**
 * Cria/atualiza/remove um evento. map é mutado. scan (opcional) = eventos do
 * calendário pela marca. → 'added'|'updated'|'removed'|'skipped'
 */
async function upsertOne(C, calId, map, apt, provider, scan) {
  const id = String(apt.id)
  let cur = map[id]
  if (scan) cur = await reconcileOne(C, map, id, cur, scan)
  if (DONE.includes(apt.status)) {
    if (cur?.e) {
      try { await C.deleteEventAsync(cur.e) } catch (_) {}
      delete map[id]
      return 'removed'
    }
    return 'skipped'
  }
  const details = eventFor(apt, provider)
  if (!details) return 'skipped'
  if (cur?.e) {
    try {
      await C.updateEventAsync(cur.e, details)
      map[id] = { e: cur.e, t: details.startDate.getTime() }
      return 'updated'
    } catch (_) {
      // Evento apagado à mão no calendário: cria de novo
    }
  }
  const eventId = await C.createEventAsync(calId, details)
  map[id] = { e: eventId, t: details.startDate.getTime() }
  return 'added'
}

// Mapa sem entradas velhas (mais de 30 dias atrás)
function pruneOld(map) {
  const limit = Date.now() - 30 * 86400e3
  for (const k of Object.keys(map)) if (!map[k]?.t || map[k].t < limit) delete map[k]
  return map
}

async function prepare() {
  lastError = null
  if (isWeb) { lastError = 'unavailable'; return null }
  const ok = (await calendarPermission()) === 'granted' || (await requestCalendarAccess())
  if (!ok) { lastError = 'permission'; return null }
  const C = Cal()
  const cal = await getCalendar()
  return { C, cal }
}

export async function addToCalendar(appointment, provider) {
  try {
    if (!appointment?.id || !appointment?.scheduled_for) { lastError = 'invalid'; return false }
    const ctx = await prepare()
    if (!ctx) return false
    const map = await readJson(MAP_KEY, {})
    // Fora do mapa deste aparelho: procura um evento já marcado com esse agendamento
    let scan = null
    if (!map[String(appointment.id)]?.e) {
      const now = Date.now()
      scan = await scanCalendar(ctx.C, ctx.cal.id,
        scanRange([appointment], provider?.timezone || null, { from: now, to: now + SYNC_DAYS * DAY_MS }))
    }
    const r = await upsertOne(ctx.C, ctx.cal.id, map, appointment, provider, scan)
    await writeJson(MAP_KEY, pruneOld(map))
    if (r === 'skipped') lastError = DONE.includes(appointment.status) ? 'canceled' : 'invalid'
    return r !== 'skipped'
  } catch (e) {
    console.warn('[calendar] addToCalendar:', e?.message || e)
    lastError = 'error'
    return false
  }
}

/**
 * Sincroniza uma lista. Com `window: { from, to }` (YYYY-MM-DD, hora de parede),
 * apaga do celular os eventos desse intervalo cujo agendamento não veio na lista
 * (foi excluído ou mudou pra fora da janela).
 */
export async function syncUpcoming(appointments, provider, { window } = {}) {
  const out = { added: 0, updated: 0, removed: 0, failed: 0 }
  let error = null
  try {
    const ctx = await prepare()
    if (!ctx) return { ...out, error: lastError }
    const tz = provider?.timezone || null
    // Janela em instantes de verdade: 00:00 do primeiro dia até o fim do último, no fuso do perfil
    const win = window?.from && window?.to ? {
      from: wallToDate(window.from + 'T00:00:00.000Z', tz)?.getTime(),
      to: (wallToDate(addDays(window.to, 1) + 'T00:00:00.000Z', tz)?.getTime() ?? NaN) - 1,
    } : null
    const hasWin = !!(win && Number.isFinite(win.from) && Number.isFinite(win.to))
    const map = await readJson(MAP_KEY, {})
    const scan = await scanCalendar(ctx.C, ctx.cal.id, scanRange(appointments, tz, hasWin ? win : null))
    const seen = new Set()
    for (const apt of appointments || []) {
      if (!apt?.id || !apt.scheduled_for) continue
      seen.add(String(apt.id))
      try {
        const r = await upsertOne(ctx.C, ctx.cal.id, map, apt, provider, scan)
        if (r !== 'skipped') out[r]++
      } catch (_) {
        out.failed++
      }
    }
    if (hasWin) {
      const inWin = (t) => !!t && t >= win.from && t <= win.to
      const gone = new Set()
      const drop = async (e) => {
        if (!e || gone.has(String(e))) return
        gone.add(String(e))
        try { await ctx.C.deleteEventAsync(e) } catch (_) {}
        out.removed++
      }
      for (const [id, v] of Object.entries(map)) {
        if (seen.has(id) || !inWin(v?.t)) continue
        await drop(v.e)
        delete map[id]
      }
      if (scan) {
        // Eventos marcados de agendamento que não veio na lista (de outro aparelho ou de antes de reinstalar)
        for (const [id, list] of scan.byId) {
          if (seen.has(id)) continue
          for (const m of list) if (inWin(m.t)) await drop(m.e)
        }
        // Calendário do app achado pelo nome: os eventos sem marca são de uma versão
        // antiga ou de outra instalação e nunca seriam atualizados. Uma vez só.
        if (ctx.cal.adopted) {
          if (ctx.cal.own) {
            const mine = new Set(Object.values(map).map((v) => String(v?.e)))
            for (const u of scan.unmarked) if (inWin(u.t) && !mine.has(u.e)) await drop(u.e)
          }
          await writeJson(CAL_KEY, { id: ctx.cal.id, own: ctx.cal.own })
        }
      }
    }
    await writeJson(MAP_KEY, pruneOld(map))
    await writeJson(LAST_KEY, { at: new Date().toISOString(), ...out })
  } catch (e) {
    console.warn('[calendar] syncUpcoming:', e?.message || e)
    lastError = 'error'
    error = 'error'
  }
  return { ...out, error }
}

/** Busca os próximos 60 dias (inclui cancelados, pra tirar do calendário) e sincroniza. */
export async function syncFromServer(provider) {
  const from = todayKey()
  const to = addDays(from, SYNC_DAYS)
  const { appointments } = await api(`/api/agenda/appointments?scope=range&from=${from}&to=${to}`)
  return syncUpcoming(appointments || [], provider, { window: { from, to } })
}

export async function removeFromCalendar(appointmentId) {
  if (isWeb || !appointmentId) return false
  try {
    const map = await readJson(MAP_KEY, {})
    const cur = map[String(appointmentId)]
    if (!cur?.e) return false
    try { await Cal().deleteEventAsync(cur.e) } catch (_) {}
    delete map[String(appointmentId)]
    await writeJson(MAP_KEY, map)
    return true
  } catch (_) {
    return false
  }
}

/** Tira tudo do app do celular (desligou a sincronização / excluiu a conta). */
export async function clearCalendar() {
  if (isWeb) return
  try {
    const C = Cal()
    const cal = await readJson(CAL_KEY, null)
    const map = await readJson(MAP_KEY, {})
    if (cal?.id && cal.own) {
      try { await C.deleteCalendarAsync(cal.id) } catch (_) {}
    } else {
      for (const v of Object.values(map)) {
        try { await C.deleteEventAsync(v.e) } catch (_) {}
      }
    }
  } catch (_) {}
  await AsyncStorage.multiRemove([CAL_KEY, MAP_KEY, LAST_KEY]).catch(() => {})
}
