// Aba "Agenda": dia (com os horários livres do seu horário de atendimento),
// semana e lista. Navegação por data, filtro por equipe (Premium) e o + pra
// marcar no dia escolhido.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../../lib/session'
import { api } from '../../lib/api'
import {
  MONTHS, MONTHS_LONG, WEEKDAYS_LONG, addDays, fmtDay, fmtDuration, fmtMoney, fmtRelativeDay, fmtTime, hhmmOf, keyOf, startOfWeek, todayKey, weekdayOf,
} from '../../lib/format'
import { colors, radius, spacing, statusStyle, type } from '../../lib/theme'
import { Badge, Banner, Button, Card, Chip, Divider, Empty, ErrorBox, Fab, IconButton, Loading, Muted, Screen, Section, Segmented, StatusBadge } from '../../components/ui'
import { DateField } from '../../components/pickers'

const MODES = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'list', label: 'Lista' },
]
const FEED_NAMES = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking: 'Booking', outro: 'Calendário' }
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MIN_FREE = 30   // intervalo livre menor que isso não aparece
const pad = (n) => String(n).padStart(2, '0')

// ── Horários (minutos do dia) ───────────────────────────────────────────────
const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
const live = (a) => a.status !== 'canceled' && a.status !== 'no_show'

function endTime(a) {
  return hhmmOf(new Date(Date.parse(a.scheduled_for) + (Number(a.duration_min) || 0) * 60e3).toISOString())
}

/** Intervalos ocupados [início, fim] do dia: agendamentos ativos + bloqueios parciais. */
function busyOf(apts, blocks = []) {
  const out = []
  for (const a of apts) {
    if (!live(a)) continue
    const s = toMin(hhmmOf(a.scheduled_for))
    out.push([s, Math.min(s + (Number(a.duration_min) || 0), 1440)])
  }
  for (const b of blocks) out.push([toMin(b.start), toMin(b.end) || 1440])
  return out.sort((x, y) => x[0] - y[0])
}

/** Janelas livres dentro do horário de atendimento (a partir de `from`). */
function freeGaps(windows, busy, { from = 0, min = MIN_FREE } = {}) {
  const gaps = []
  const ws = [...windows].sort((x, y) => toMin(x.start_time) - toMin(y.start_time))
  for (const w of ws) {
    const end = toMin(w.end_time)
    let cur = Math.max(toMin(w.start_time), from)
    for (const [s, e] of busy) {
      if (e <= cur || s >= end) continue
      if (s - cur >= min) gaps.push([cur, s])
      cur = Math.max(cur, e)
      if (cur >= end) break
    }
    if (end - cur >= min) gaps.push([cur, end])
  }
  return gaps
}

/** Resposta de GET /api/agenda/blocked → lista (aceita dia único ou período). */
function normBlocked(r) {
  if (!r) return []
  const list = Array.isArray(r) ? r : (r.blocks || r.blocked || r.blocked_dates || r.dates || [])
  return Array.isArray(list) ? list : []
}

/** Bloqueios de um dia: { full: {reason}|null, partial: [{start,end,reason}] }. */
function blocksForDay(list, key) {
  let full = null
  const partial = []
  for (const b of list || []) {
    const from = String(b.date || b.start_date || '').slice(0, 10)
    const to = String(b.end_date || b.date || b.start_date || '').slice(0, 10)
    if (!from || key < from || key > to) continue
    if (b.full_day === false && b.start_time && b.end_time) {
      partial.push({ start: String(b.start_time).slice(0, 5), end: String(b.end_time).slice(0, 5), reason: b.reason || '' })
    } else full = { reason: b.reason || '' }
  }
  return { full, partial }
}

function weekTitle(start) {
  const end = addDays(start, 6)
  const [, m1, d1] = start.split('-').map(Number)
  const [, m2, d2] = end.split('-').map(Number)
  return m1 === m2 ? `${d1} – ${d2} ${MONTHS[m2 - 1]}` : `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`
}

function longDay(key) {
  const d = new Date(key + 'T12:00:00Z')
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}`
}

const sum = (list) => list.reduce((t, a) => t + (Number(a.total_cents) || 0), 0)

// ── Tela ────────────────────────────────────────────────────────────────────
export default function Agenda() {
  const app = useApp()
  const { provider, settings, can } = app
  const params = useLocalSearchParams()
  const cleaning = provider?.vertical === 'cleaning'
  const noun = (n) => (cleaning ? (n === 1 ? 'limpeza' : 'limpezas') : (n === 1 ? 'atendimento' : 'atendimentos'))
  const mondayFirst = !!settings.week_starts_monday
  const canTeam = can('team')

  const [mode, setMode] = useState('day')
  const [date, setDate] = useState(todayKey())
  const [listScope, setListScope] = useState('upcoming')
  const [staffFilter, setStaffFilter] = useState(null)
  const [showCanceled, setShowCanceled] = useState(false)
  const [picking, setPicking] = useState(false)

  const [apts, setApts] = useState([])
  const [blocked, setBlocked] = useState([])
  const [hours, setHours] = useState(null)      // null = não carregou
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const reqId = useRef(0)
  const loadedKey = useRef(null)

  // Veio de outra tela com ?date= (ex.: "Ver todos" de amanhã, Folgas). Depois de usar,
  // limpa o parâmetro: assim abrir o mesmo dia de novo (já tendo navegado) funciona.
  useEffect(() => {
    if (params.date && KEY_RE.test(String(params.date))) {
      setDate(String(params.date))
      setMode('day')
      setPicking(false)
      router.setParams({ date: undefined })
    }
  }, [params.date])

  const range = useMemo(() => {
    if (mode === 'day') return [date, date]
    if (mode === 'week') { const s = startOfWeek(date, mondayFirst); return [s, addDays(s, 6)] }
    return null
  }, [mode, date, mondayFirst])
  const rangeKey = range ? range.join('|') : 'list'

  // Horário de atendimento e equipe: mudam pouco, carregam uma vez
  const loadStatic = useCallback(async () => {
    const [h, st] = await Promise.all([
      api('/api/agenda/hours').then((r) => r.hours || []).catch(() => null),
      // 402 (plano sem equipe) ou 404 (rota ainda não existe) = sem equipe
      canTeam ? api('/api/agenda/staff').then((r) => (r.staff || []).filter((x) => x.active !== false)).catch(() => []) : Promise.resolve([]),
    ])
    if (h) setHours(h)
    setStaff(st)
    if (!st.length) setStaffFilter(null)
  }, [canTeam])

  useEffect(() => { loadStatic() }, [loadStatic])

  const load = useCallback(async (kind = 'auto') => {
    const my = ++reqId.current
    const key = `${rangeKey}|${listScope}|${staffFilter || ''}`
    if (kind === 'refresh') setRefreshing(true)
    else if (key !== loadedKey.current) setLoading(true)
    const staffQ = staffFilter ? `&staff_id=${encodeURIComponent(staffFilter)}` : ''
    try {
      let list = []
      let blk = []
      if (range) {
        const [r, b] = await Promise.all([
          api(`/api/agenda/appointments?scope=range&from=${range[0]}&to=${range[1]}${staffQ}`),
          // A rota de bloqueios pode ainda não existir (404): segue sem
          api(`/api/agenda/blocked?from=${range[0]}&to=${range[1]}`).catch(() => null),
        ])
        list = r.appointments || []
        blk = normBlocked(b)
      } else {
        const r = await api(`/api/agenda/appointments?scope=${listScope}${staffQ}`)
        list = r.appointments || []
      }
      if (my !== reqId.current) return
      setApts(list)
      setBlocked(blk)
      setError(null)
      loadedKey.current = key
    } catch (e) {
      if (my === reqId.current) setError(e)
    } finally {
      if (my === reqId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [rangeKey, listScope, staffFilter])   // eslint-disable-line react-hooks/exhaustive-deps

  // Foco na aba ou mudança de dia/modo/filtro → recarrega
  useFocusEffect(useCallback(() => { load('auto') }, [load]))

  const refresh = () => { loadStatic(); load('refresh') }

  // ── Navegação ──────────────────────────────────────────────────────────
  const today = todayKey()
  const shift = (dir) => setDate((d) => addDays(d, mode === 'week' ? dir * 7 : dir))
  const goToday = () => setDate(today)
  const inRange = range ? today >= range[0] && today <= range[1] : true
  const newAt = (day, time) => router.push({
    pathname: '/appointment/new',
    params: { date: day, ...(time ? { time } : {}), ...(staffFilter && staffFilter !== 'none' ? { staff_id: staffFilter } : {}) },
  })
  const open = (a) => router.push(`/appointment/${a.id}`)

  // ── Dia ────────────────────────────────────────────────────────────────
  const dayView = useMemo(() => {
    if (mode !== 'day') return null
    const b = blocksForDay(blocked, date)
    const windows = (hours || []).filter((h) => Number(h.day_of_week) === weekdayOf(date))
    const dayApts = apts.filter((a) => keyOf(a.scheduled_for) === date)
    const visible = dayApts.filter((a) => showCanceled || a.status !== 'canceled')
    let gaps = []
    if (!b.full && date >= today && windows.length) {
      const n = new Date()
      const from = date === today ? Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15 : 0
      gaps = freeGaps(windows, busyOf(dayApts, b.partial), { from })
    }
    const items = [
      ...visible.map((a) => ({ kind: 'apt', start: toMin(hhmmOf(a.scheduled_for)), a })),
      ...b.partial.map((p) => ({ kind: 'block', start: toMin(p.start), p })),
      ...gaps.map(([st, en]) => ({ kind: 'free', start: st, end: en })),
    ].sort((x, y) => x.start - y.start || (x.kind === 'apt' ? -1 : y.kind === 'apt' ? 1 : 0))
    const active = dayApts.filter(live)
    return {
      items, full: b.full, windows,
      count: active.length,
      total: sum(active),
      freeMin: gaps.reduce((t, [st, en]) => t + (en - st), 0),
      canceled: dayApts.filter((a) => a.status === 'canceled').length,
    }
  }, [mode, date, apts, blocked, hours, showCanceled, today])

  // ── Semana ─────────────────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    if (mode !== 'week' || !range) return []
    return Array.from({ length: 7 }, (_, i) => {
      const key = addDays(range[0], i)
      const all = apts.filter((a) => keyOf(a.scheduled_for) === key)
      const list = all.filter((a) => showCanceled || a.status !== 'canceled')
      const active = all.filter(live)
      return { key, list, count: active.length, total: sum(active), block: blocksForDay(blocked, key), canceled: all.length - list.length }
    })
  }, [mode, range, apts, blocked, showCanceled])
  const weekCount = weekDays.reduce((t, d) => t + d.count, 0)
  const weekTotal = weekDays.reduce((t, d) => t + d.total, 0)
  const weekCanceled = apts.filter((a) => a.status === 'canceled').length

  // ── Lista ──────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    if (mode !== 'list') return []
    const map = new Map()
    for (const a of apts) {
      if (!showCanceled && a.status === 'canceled') continue
      const k = keyOf(a.scheduled_for)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(a)
    }
    return [...map.entries()].map(([key, list]) => ({ key, list: [...list].sort((x, y) => x.scheduled_for.localeCompare(y.scheduled_for)) }))
  }, [mode, apts, showCanceled])
  const listCanceled = mode === 'list' ? apts.filter((a) => a.status === 'canceled').length : 0

  const canceledCount = mode === 'day' ? (dayView?.canceled || 0) : mode === 'week' ? weekCanceled : listCanceled

  // ── Render ─────────────────────────────────────────────────────────────
  const header = (
    <>
      <Segmented options={MODES} value={mode} onChange={(v) => { setMode(v); setPicking(false) }} />

      {mode !== 'list' ? (
        <View style={s.nav}>
          <IconButton icon="chevron-back" bg={colors.white} label={mode === 'week' ? 'Semana anterior' : 'Dia anterior'} onPress={() => shift(-1)} />
          <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={() => setPicking((p) => !p)} accessibilityRole="button" accessibilityLabel="Escolher data">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={type.h3}>{mode === 'week' ? weekTitle(range[0]) : fmtRelativeDay(date)}</Text>
              <Ionicons name={picking ? 'chevron-up' : 'chevron-down'} size={16} color={colors.inkMuted} />
            </View>
            <Muted>{mode === 'week' ? `${weekCount} ${noun(weekCount)} · ${fmtMoney(weekTotal)}` : longDay(date)}</Muted>
          </Pressable>
          <IconButton icon="chevron-forward" bg={colors.white} label={mode === 'week' ? 'Próxima semana' : 'Próximo dia'} onPress={() => shift(1)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
          <Chip label="Próximos" selected={listScope === 'upcoming'} onPress={() => setListScope('upcoming')} />
          <Chip label="Anteriores" selected={listScope === 'past'} onPress={() => setListScope('past')} />
        </View>
      )}

      {mode !== 'list' && !inRange ? (
        <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
          <Chip label="Voltar pra hoje" icon="today-outline" onPress={goToday} style={{ marginBottom: 0, marginRight: 0 }} />
        </View>
      ) : null}
      {mode !== 'list' && picking ? (
        <DateField label="Ir para o dia" value={date}
          onChange={(k) => { if (KEY_RE.test(String(k))) { setDate(k); setPicking(false) } }} />
      ) : null}

      {staff.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: mode === 'list' ? 0 : spacing.xs, marginBottom: spacing.sm }}>
          <StaffChip label="Toda a equipe" selected={!staffFilter} onPress={() => setStaffFilter(null)} />
          {staff.map((st) => (
            <StaffChip key={st.id} label={st.name} color={st.color} selected={staffFilter === st.id} onPress={() => setStaffFilter(st.id)} />
          ))}
        </ScrollView>
      ) : null}
    </>
  )

  let body = null
  if (loading) {
    body = <Loading />
  } else if (mode === 'day') {
    body = (
      <>
        {dayView.full ? (
          <Banner tone="gray" icon="lock-closed-outline" text={`Dia bloqueado${dayView.full.reason ? ': ' + dayView.full.reason : ''}. Sua página não oferece horários.`}
            action="Folgas" onPress={() => router.push('/blocked')} />
        ) : null}
        {dayView.count ? (
          <Muted style={{ marginBottom: spacing.sm, marginLeft: 2 }}>
            {dayView.count} {noun(dayView.count)} · {fmtMoney(dayView.total)}
            {dayView.freeMin ? ` · ${fmtDuration(dayView.freeMin)} livre${dayView.freeMin >= 120 ? 's' : ''}` : ''}
          </Muted>
        ) : null}

        {dayView.items.length ? (
          <Card padded={false}>
            {dayView.items.map((it, i) => (
              <View key={it.kind === 'apt' ? it.a.id : `${it.kind}-${it.start}`}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 70 }} /> : null}
                {it.kind === 'apt' ? <AptRow a={it.a} onPress={() => open(it.a)} />
                  : it.kind === 'free' ? <FreeRow start={it.start} end={it.end} onPress={() => newAt(date, toHHMM(it.start))} />
                  : <BlockRow p={it.p} />}
              </View>
            ))}
          </Card>
        ) : !dayView.full ? (
          <Card>
            <Empty icon="calendar-clear-outline"
              title={date < today ? 'Nada neste dia' : hours && hours.length && !dayView.windows.length ? 'Você não atende neste dia' : 'Dia livre'}
              text={date < today ? 'Nenhum agendamento ficou registrado.' : hours && !hours.length ? 'Cadastre seu horário de atendimento pra ver aqui os horários livres.' : 'Nenhum agendamento marcado.'}
              style={{ padding: spacing.md }}
              action={date >= today ? (
                <View style={{ gap: spacing.sm }}>
                  <Button title={hours && hours.length && !dayView.windows.length ? 'Marcar mesmo assim' : 'Novo agendamento'} icon="add" onPress={() => newAt(date)} />
                  {hours && !hours.length ? <Button title="Definir horário de atendimento" variant="secondary" icon="time-outline" onPress={() => router.push('/hours')} /> : null}
                </View>
              ) : null} />
          </Card>
        ) : null}
      </>
    )
  } else if (mode === 'week') {
    body = weekDays.map((d) => {
      const isToday = d.key === today
      return (
        <Card key={d.key} padded={false} style={[{ marginBottom: spacing.md }, isToday && { borderColor: colors.green, borderWidth: 1 }]}>
          <Pressable onPress={() => { setDate(d.key); setMode('day') }} style={({ pressed }) => [s.weekHead, pressed && { backgroundColor: colors.paperSoft }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: '700' }, isToday && { color: colors.green }]}>
                {isToday ? 'Hoje · ' : ''}{fmtDay(d.key)}
              </Text>
              {d.block.full ? <Muted>Bloqueado{d.block.full.reason ? ` · ${d.block.full.reason}` : ''}</Muted> : null}
            </View>
            {d.count ? <Badge text={`${d.count} · ${fmtMoney(d.total)}`} tone={isToday ? 'green' : 'gray'} /> : null}
            <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
          </Pressable>
          {d.list.length ? d.list.map((a) => (
            <Pressable key={a.id} onPress={() => open(a)} style={({ pressed }) => [s.weekRow, pressed && { backgroundColor: colors.paperSoft }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: (statusStyle[a.status] || statusStyle.pending).fg }} />
              <Text style={[type.small, { width: 44, fontWeight: '700', color: colors.ink }]}>{fmtTime(a.scheduled_for)}</Text>
              {a.staff_color ? <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: a.staff_color }} /> : null}
              <Text style={[type.small, { flex: 1, color: live(a) ? colors.ink : colors.inkMuted }]} numberOfLines={1}>
                {a.external_uid ? (a.feed_label || 'Turnover') : a.client_name}
                <Text style={{ color: colors.inkMuted }}> · {a.external_uid ? 'Turnover' : (a.service_name || a.service_label || 'Atendimento')}</Text>
              </Text>
            </Pressable>
          )) : (
            <Pressable onPress={() => (d.key >= today && !d.block.full ? newAt(d.key) : null)} style={s.weekRow}>
              <Muted>{d.block.full ? 'Sem atendimento' : d.key >= today ? 'Livre · toque pra marcar' : 'Livre'}</Muted>
            </Pressable>
          )}
          <View style={{ height: spacing.sm }} />
        </Card>
      )
    })
  } else {
    body = groups.length ? groups.map((g) => (
      <Section key={g.key} title={`${fmtRelativeDay(g.key)} · ${g.list.filter(live).length}`} style={{ marginTop: spacing.lg }}>
        <Card padded={false}>
          {g.list.map((a, i) => (
            <View key={a.id}>
              {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 70 }} /> : null}
              <AptRow a={a} onPress={() => open(a)} />
            </View>
          ))}
        </Card>
      </Section>
    )) : (
      <Card style={{ marginTop: spacing.md }}>
        <Empty icon="calendar-outline"
          title={listScope === 'upcoming' ? 'Nenhum agendamento pela frente' : 'Nenhum agendamento anterior'}
          text={listScope === 'upcoming' ? 'Marque um horário ou mande seu link pras clientes agendarem sozinhas.' : 'Os atendimentos que já passaram aparecem aqui.'}
          style={{ padding: spacing.md }}
          action={listScope === 'upcoming' ? (
            <View style={{ gap: spacing.sm }}>
              <Button title="Novo agendamento" icon="add" onPress={() => newAt(today)} />
              <Button title="Compartilhar meu link" variant="secondary" icon="share-social-outline" onPress={() => router.push('/share')} />
            </View>
          ) : null} />
      </Card>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={refresh} refreshing={refreshing}>
        {header}
        <ErrorBox error={error} onRetry={() => load('refresh')} />
        {body}
        {!loading && canceledCount ? (
          <Pressable onPress={() => setShowCanceled((v) => !v)} hitSlop={8} style={{ alignSelf: 'center', marginTop: spacing.lg }}>
            <Text style={{ color: colors.green, fontWeight: '600' }}>
              {showCanceled ? 'Esconder cancelados' : `Mostrar cancelados (${canceledCount})`}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ height: 72 }} />
      </Screen>
      <Fab label="Novo agendamento" onPress={() => newAt(mode === 'list' ? today : (mode === 'week' && inRange ? today : date))} />
    </View>
  )
}

// ── Peças ───────────────────────────────────────────────────────────────────
function AptRow({ a, onPress }) {
  const st = statusStyle[a.status] || statusStyle.pending
  const turnover = !!a.external_uid
  const faded = !live(a)
  const title = turnover ? (a.feed_label || 'Turnover') : a.client_name
  const what = turnover
    ? `Turnover${a.feed_source ? ' · ' + (FEED_NAMES[a.feed_source] || a.feed_source) : ''}`
    : (a.service_name || a.service_label || 'Atendimento')
  const tight = turnover && a.ical_next_checkin && String(a.ical_next_checkin).slice(0, 10) === keyOf(a.scheduled_for)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.paperSoft }]}>
      <View style={{ width: 48 }}>
        <Text style={[type.body, { fontWeight: '700' }, faded && { color: colors.inkMuted }]}>{fmtTime(a.scheduled_for)}</Text>
        <Muted>{endTime(a)}</Muted>
      </View>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: st.fg, opacity: faded ? 0.4 : 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {a.staff_color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.staff_color }} /> : null}
          <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }, faded && { color: colors.inkMuted, textDecorationLine: a.status === 'canceled' ? 'line-through' : 'none' }]} numberOfLines={1}>{title}</Text>
        </View>
        <Muted numberOfLines={1}>
          {what}{a.total_cents ? ` · ${fmtMoney(a.total_cents)}` : ''}{a.staff_name ? ` · ${a.staff_name}` : ''}
        </Muted>
        {tight ? <Badge text="Check-in no mesmo dia" tone="red" icon="alert-circle" style={{ marginTop: 4 }} /> : null}
        {a.status === 'pending' && a.deposit_cents > 0 && !a.deposit_paid ? <Badge text={`Sinal ${fmtMoney(a.deposit_cents)}`} tone="orange" style={{ marginTop: 4 }} /> : null}
      </View>
      <StatusBadge status={a.status} />
    </Pressable>
  )
}

function FreeRow({ start, end, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, { minHeight: 48 }, pressed && { backgroundColor: colors.greenSoft }]} accessibilityRole="button"
      accessibilityLabel={`Livre das ${toHHMM(start)} às ${toHHMM(end)}. Toque pra agendar.`}>
      <View style={{ width: 48 }}>
        <Text style={[type.small, { color: colors.green, fontWeight: '600' }]}>{toHHMM(start)}</Text>
      </View>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.green }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.small, { color: colors.green, fontWeight: '600' }]}>Livre até {toHHMM(end)} · {fmtDuration(end - start)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Ionicons name="add" size={16} color={colors.green} />
        <Text style={{ color: colors.green, fontWeight: '600', fontSize: 14 }}>Agendar</Text>
      </View>
    </Pressable>
  )
}

function BlockRow({ p }) {
  return (
    <View style={[s.row, { minHeight: 48, backgroundColor: colors.paperDeep }]}>
      <View style={{ width: 48 }}>
        <Text style={[type.small, { fontWeight: '600' }]}>{p.start}</Text>
      </View>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.inkMuted }} />
      <View style={{ flex: 1 }}>
        <Text style={[type.small, { fontWeight: '600', color: colors.inkSoft }]}>Bloqueado até {p.end}{p.reason ? ` · ${p.reason}` : ''}</Text>
      </View>
      <Ionicons name="lock-closed-outline" size={16} color={colors.inkMuted} />
    </View>
  )
}

function StaffChip({ label, color, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && { backgroundColor: colors.green, borderColor: colors.green }]}>
      {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 6, borderWidth: selected ? 1 : 0, borderColor: colors.white }} /> : null}
      <Text style={{ fontSize: 14, fontWeight: '500', color: selected ? colors.white : colors.inkSoft }} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const s = {
  nav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 60 },
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, marginRight: 8 },
}
