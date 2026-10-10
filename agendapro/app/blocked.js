// Folgas e férias: bloqueia um dia, um período (até 60 dias) ou só algumas horas.
// Avisa quando já tem cliente marcada no período, com atalho pra agenda.
import { useCallback, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { confirm } from '../lib/dialog'
import { addDays, fmtDay, fmtRelativeDay, todayKey } from '../lib/format'
import { colors, spacing } from '../lib/theme'
import { DateField, TimeField } from '../components/pickers'
import { Badge, Banner, Button, Card, Chip, Divider, Empty, ErrorBox, IconButton, Input, Label, Loading, Muted, P, Row, Screen, Section, Segmented } from '../components/ui'

const MAX_DAYS = 60
const DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const REASONS = ['Folga', 'Férias', 'Feriado', 'Consulta médica', 'Curso', 'Viagem', 'Compromisso']

// ── Feriados dos EUA (atalho pra bloquear) ────────────────────────────────
const isoUTC = (ms) => new Date(ms).toISOString().slice(0, 10)
/** n-ésimo dia da semana do mês (n = -1: o último). month 0-11, weekday 0 = domingo. */
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    return isoUTC(Date.UTC(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7))
  }
  const last = new Date(Date.UTC(year, month + 1, 0))
  return isoUTC(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)))
}
function holidaysOf(y) {
  return [
    { name: 'Ano Novo', date: `${y}-01-01` },
    { name: 'Memorial Day', date: nthWeekday(y, 4, 1, -1) },
    { name: '4 de Julho', date: `${y}-07-04` },
    { name: 'Labor Day', date: nthWeekday(y, 8, 1, 1) },
    { name: 'Thanksgiving', date: nthWeekday(y, 10, 4, 4) },
    { name: 'Véspera de Natal', date: `${y}-12-24` },
    { name: 'Natal', date: `${y}-12-25` },
    { name: 'Réveillon', date: `${y}-12-31` },
  ]
}
function upcomingHolidays(today, n = 4) {
  const y = Number(String(today).slice(0, 4))
  return [...holidaysOf(y), ...holidaysOf(y + 1)].filter((h) => h.date >= today).slice(0, n)
}

const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400e3)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Junta dias seguidos de dia inteiro com o mesmo motivo (férias viram 1 linha). */
function groupBlocks(blocks) {
  const groups = []
  for (const b of blocks) {
    const g = groups[groups.length - 1]
    if (g && b.full_day && g.full_day && (g.reason || '') === (b.reason || '') && daysBetween(g.to, b.date) === 1) {
      g.to = b.date
      g.ids.push(b.id)
      g.appointments_count += b.appointments_count || 0
      if (!g.first_conflict && b.appointments_count) g.first_conflict = b.date
      continue
    }
    groups.push({
      key: b.id, ids: [b.id], from: b.date, to: b.date, full_day: b.full_day,
      start_time: b.start_time, end_time: b.end_time, reason: b.reason,
      appointments_count: b.appointments_count || 0, first_conflict: b.appointments_count ? b.date : null,
    })
  }
  return groups
}

const emptyForm = () => ({ mode: 'day', date: '', dateTo: '', fullDay: true, start: '12:00', end: '13:00', reason: '' })

export default function Blocked() {
  const app = useApp()
  const [blocks, setBlocks] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const [conflict, setConflict] = useState(null)   // { count, first_date } do último bloqueio criado

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/blocked')
      setBlocks(r.blocks || [])
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const today = todayKey()
  const upcoming = useMemo(() => groupBlocks((blocks || []).filter((b) => b.date >= today)), [blocks, today])
  const past = useMemo(() => groupBlocks((blocks || []).filter((b) => b.date < today)).reverse(), [blocks, today])
  const fullDays = useMemo(() => new Set((blocks || []).filter((b) => b.full_day).map((b) => b.date)), [blocks])
  const holidays = useMemo(() => upcomingHolidays(today, 6).filter((h) => !fullDays.has(h.date)).slice(0, 4), [today, fullDays])
  const conflictsAhead = upcoming.reduce((n, g) => n + g.appointments_count, 0)

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setFormError(null) }

  async function openForm(prefill) {
    if (!(await ensureFeature(app, 'hours'))) return
    setForm({ ...emptyForm(), date: today, ...(prefill || {}) })
    setFormError(null)
    setFormOpen(true)
  }

  function validate() {
    const f = form
    if (!DATE.test(f.date)) return 'Escolha o dia (AAAA-MM-DD).'
    if (f.date < addDays(today, -1)) return 'Esse dia já passou.'
    if (f.mode === 'range') {
      if (!DATE.test(f.dateTo)) return 'Escolha até quando (AAAA-MM-DD).'
      if (f.dateTo < f.date) return 'A data final precisa ser depois da inicial.'
      if (daysBetween(f.date, f.dateTo) + 1 > MAX_DAYS) return `No máximo ${MAX_DAYS} dias de uma vez. Divida em duas partes.`
    }
    if (!f.fullDay) {
      if (!HHMM.test(f.start) || !HHMM.test(f.end)) return 'Use o formato HH:MM (ex.: 12:00).'
      if (f.start >= f.end) return 'O início precisa ser antes do fim.'
    }
    return null
  }

  async function save() {
    const problem = validate()
    if (problem) { setFormError(problem); return }
    if (!(await ensureFeature(app, 'hours'))) return
    setSaving(true)
    try {
      const r = await post('/api/agenda/blocked', {
        action: 'create',
        date: form.date,
        date_to: form.mode === 'range' ? form.dateTo : undefined,
        full_day: form.fullDay,
        start_time: form.fullDay ? undefined : form.start,
        end_time: form.fullDay ? undefined : form.end,
        reason: form.reason.trim() || undefined,
      })
      setBlocks(r.blocks || [])
      setFormOpen(false)
      const c = r.conflicts || {}
      setConflict(c.count > 0 ? c : null)
      if (c.count > 0) {
        const go = await confirm(
          'Você tem cliente marcada',
          `${plural(c.count, 'agendamento cai', 'agendamentos caem')} nesse período. A folga não cancela nada sozinha: remarque ou avise as clientes.`,
          { ok: 'Ver na agenda', cancel: 'Depois' },
        )
        if (go) openAgenda(c.first_date)
      }
    } catch (e) {
      if (e?.isPlan) showError(e)
      else setFormError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(g) {
    const what = g.ids.length > 1 ? `os ${g.ids.length} dias dessa folga` : 'essa folga'
    const ok = await confirm('Remover folga?', `Vou liberar ${what}. Os horários voltam a aparecer na sua página.`, { ok: 'Remover', destructive: true })
    if (!ok) return
    setDeleting(g.key)
    try {
      await post('/api/agenda/blocked', { action: 'delete', ids: g.ids })
      setBlocks((cur) => (cur || []).filter((b) => !g.ids.includes(b.id)))
      setConflict(null)
    } catch (e) {
      showError(e)
    } finally {
      setDeleting(null)
    }
  }

  function openAgenda(date) {
    router.push(date ? { pathname: '/agenda', params: { date } } : '/agenda')
  }

  if (!blocks && !error) {
    return <Screen><Stack.Screen options={{ title: 'Folgas e férias' }} /><Loading text="Carregando folgas…" /></Screen>
  }

  const rangeDays = form.mode === 'range' && DATE.test(form.date) && DATE.test(form.dateTo) && form.dateTo >= form.date
    ? daysBetween(form.date, form.dateTo) + 1 : null

  return (
    <Screen onRefresh={() => load(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Folgas e férias' }} />
      <ErrorBox error={error} onRetry={() => load()} />

      {conflict ? (
        <Banner tone="orange" icon="alert-circle-outline" action="Ver" onPress={() => openAgenda(conflict.first_date)}
          text={`${plural(conflict.count, 'agendamento', 'agendamentos')} no período da folga. Remarque ou avise as clientes.`} />
      ) : null}

      <Muted style={{ marginBottom: spacing.md }}>
        Dias e horários bloqueados somem da sua página. Os agendamentos que já existem continuam na agenda.
      </Muted>

      {!formOpen ? (
        <Button title="Adicionar folga" icon="add" onPress={() => openForm()} />
      ) : (
        <Card>
          <Label style={{ marginBottom: spacing.sm }}>Nova folga</Label>
          <Segmented style={{ marginBottom: spacing.lg }} value={form.mode}
            onChange={(v) => { setFormError(null); setForm((f) => ({ ...f, mode: v, dateTo: v === 'range' && !f.dateTo && DATE.test(f.date) ? addDays(f.date, 6) : f.dateTo })) }}
            options={[{ value: 'day', label: 'Um dia' }, { value: 'range', label: 'Vários dias' }]} />

          {form.mode === 'day' ? (
            <DateField label="Dia" value={form.date} onChange={set('date')} minimumDate={new Date()} />
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <DateField label="De" value={form.date} minimumDate={new Date()}
                  onChange={(v) => setForm((f) => ({ ...f, date: v, dateTo: f.dateTo && f.dateTo >= v ? f.dateTo : v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField label="Até" value={form.dateTo} onChange={set('dateTo')} minimumDate={new Date()} placeholder="Último dia" />
              </View>
            </View>
          )}
          {rangeDays ? <Muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>{plural(rangeDays, 'dia', 'dias')} bloqueados</Muted> : null}

          <Segmented style={{ marginBottom: spacing.lg }} value={form.fullDay ? 'full' : 'part'} onChange={(v) => set('fullDay')(v === 'full')}
            options={[{ value: 'full', label: 'Dia inteiro' }, { value: 'part', label: 'Só umas horas' }]} />

          {!form.fullDay ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}><TimeField label="Das" value={form.start} onChange={set('start')} minuteInterval={15} /></View>
              <View style={{ flex: 1 }}><TimeField label="Até" value={form.end} onChange={set('end')} minuteInterval={15} /></View>
            </View>
          ) : null}

          <Label style={{ marginBottom: spacing.sm }}>Motivo (só você vê)</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {REASONS.map((r) => <Chip key={r} label={r} selected={form.reason === r} onPress={() => set('reason')(form.reason === r ? '' : r)} />)}
          </View>
          <Input value={form.reason} onChangeText={set('reason')} placeholder="Ou escreva" maxLength={120} />

          <ErrorBox error={formError} />
          <Button title="Bloquear" icon="lock-closed-outline" onPress={save} loading={saving} />
          <Button title="Cancelar" variant="ghost" onPress={() => setFormOpen(false)} style={{ marginTop: spacing.sm }} />
        </Card>
      )}

      {!formOpen && holidays.length ? (
        <Section title="Feriados chegando">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {holidays.map((h) => (
              <Chip key={h.date} icon="flag-outline" label={`${h.name} · ${fmtDay(h.date)}`}
                onPress={() => openForm({ mode: 'day', date: h.date, fullDay: true, reason: h.name })} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Próximas folgas" right={conflictsAhead ? <Badge text={plural(conflictsAhead, 'conflito', 'conflitos')} tone="orange" icon="alert-circle-outline" /> : null}>
        {upcoming.length === 0 ? (
          <Card>
            <Empty icon="sunny-outline" title="Nenhuma folga marcada"
              text="Vai tirar férias, tem consulta ou feriado? Bloqueie aqui e a página para de oferecer esses horários." />
          </Card>
        ) : (
          <Card padded={false}>
            {upcoming.map((g, i) => (
              <View key={g.key}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
                <BlockRow g={g} onDelete={() => remove(g)} deleting={deleting === g.key} onConflict={() => openAgenda(g.first_conflict || g.from)} />
              </View>
            ))}
          </Card>
        )}
      </Section>

      {past.length ? (
        <Section title="Últimos 30 dias" right={
          <Pressable onPress={() => setShowPast((v) => !v)} hitSlop={8}>
            <Muted style={{ color: colors.green, fontWeight: '600' }}>{showPast ? 'Esconder' : `Mostrar (${past.length})`}</Muted>
          </Pressable>
        }>
          {showPast ? (
            <Card padded={false} style={{ opacity: 0.75 }}>
              {past.map((g, i) => (
                <View key={g.key}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
                  <BlockRow g={g} past onDelete={() => remove(g)} deleting={deleting === g.key} />
                </View>
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  )
}

function BlockRow({ g, past, onDelete, deleting, onConflict }) {
  const days = daysBetween(g.from, g.to) + 1
  const title = g.from === g.to
    ? (g.full_day ? fmtRelativeDay(g.from) : `${fmtRelativeDay(g.from)} · ${g.start_time}–${g.end_time}`)
    : `${fmtDay(g.from)} até ${fmtDay(g.to)}`
  const sub = [g.reason, g.full_day ? (days > 1 ? plural(days, 'dia', 'dias') : 'Dia inteiro') : 'Parte do dia'].filter(Boolean).join(' · ')
  return (
    <Row
      icon={g.full_day ? (days > 1 ? 'airplane-outline' : 'calendar-clear-outline') : 'time-outline'}
      iconColor={past ? colors.inkMuted : colors.green}
      title={title}
      subtitle={
        <View>
          <Muted numberOfLines={1}>{sub}</Muted>
          {!past && g.appointments_count > 0 ? (
            <Pressable onPress={onConflict} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Ionicons name="alert-circle" size={14} color={colors.warning} />
              <P style={{ fontSize: 13, color: colors.warning, fontWeight: '600' }}>
                {plural(g.appointments_count, 'cliente marcada', 'clientes marcadas')} · ver na agenda
              </P>
            </Pressable>
          ) : null}
        </View>
      }
      right={deleting ? <Loading style={{ padding: 0 }} /> : (
        <IconButton icon="trash-outline" size={36} color={colors.danger} bg={colors.dangerSoft} label="Remover folga" onPress={onDelete} />
      )}
    />
  )
}
