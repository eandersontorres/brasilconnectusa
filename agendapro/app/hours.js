// Horário de atendimento: liga/desliga cada dia, até 3 intervalos por dia
// (ex.: pausa pro almoço), atalhos prontos e "copiar pra seg–sex".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { Stack, router, useNavigation } from 'expo-router'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { confirm } from '../lib/dialog'
import { WEEKDAYS_LONG } from '../lib/format'
import { colors, spacing } from '../lib/theme'
import { TimeField } from '../components/pickers'
import { Banner, Button, Card, Chip, ErrorBox, IconButton, Label, Loading, Muted, Row, Screen, Section, ToggleRow } from '../components/ui'

const ORDER = [1, 2, 3, 4, 5, 6, 0]          // segunda primeiro
const WEEKDAYS = [1, 2, 3, 4, 5]
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
const toHHMM = (n) => {
  const v = Math.max(0, Math.min(23 * 60 + 45, Math.round(n)))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}
const emptyWeek = () => Array.from({ length: 7 }, () => ({ on: false, windows: [] }))

const PRESETS = [
  { label: 'Seg a sex · 9h às 18h', days: WEEKDAYS, windows: [['09:00', '18:00']] },
  { label: 'Seg a sex · 9h–12h e 13h–18h', days: WEEKDAYS, windows: [['09:00', '12:00'], ['13:00', '18:00']] },
  { label: 'Seg a sáb · 9h às 19h', days: [1, 2, 3, 4, 5, 6], windows: [['09:00', '19:00']] },
  { label: 'Ter a sáb · 10h às 20h', days: [2, 3, 4, 5, 6], windows: [['10:00', '20:00']] },
]

function fromApi(hours) {
  const week = emptyWeek()
  for (const h of hours || []) {
    const d = week[h.day_of_week]
    if (!d || d.windows.length >= 3) continue
    d.on = true
    d.windows.push({ start: h.start_time, end: h.end_time })
  }
  week.forEach((d) => d.windows.sort((a, b) => toMin(a.start) - toMin(b.start)))
  return week
}

function toApi(week) {
  const out = []
  week.forEach((d, day) => {
    if (!d.on) return
    for (const w of d.windows) out.push({ day_of_week: day, start_time: w.start, end_time: w.end })
  })
  return out
}

/** Problema do dia (texto) ou null. */
function dayProblem(d) {
  if (!d.on) return null
  if (d.windows.length === 0) return 'Adicione um horário ou desligue o dia.'
  for (const w of d.windows) {
    if (!HHMM.test(w.start || '') || !HHMM.test(w.end || '')) return 'Use o formato HH:MM (ex.: 09:00).'
    if (toMin(w.start) >= toMin(w.end)) return `${w.start}–${w.end}: o início precisa ser antes do fim.`
  }
  const sorted = d.windows.slice().sort((a, b) => toMin(a.start) - toMin(b.start))
  for (let i = 1; i < sorted.length; i++) {
    if (toMin(sorted[i].start) < toMin(sorted[i - 1].end)) return 'Os horários se sobrepõem.'
  }
  return null
}

const summary = (d) => (d.on && d.windows.length ? d.windows.map((w) => `${w.start}–${w.end}`).join(' · ') : 'Fechado')

export default function Hours() {
  const app = useApp()
  const navigation = useNavigation()
  const [week, setWeek] = useState(null)
  const [saved, setSaved] = useState(null)      // JSON do que está no servidor
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/hours')
      const w = fromApi(r.hours)
      setWeek(w)
      setSaved(JSON.stringify(toApi(w)))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const dirty = !!week && saved !== null && JSON.stringify(toApi(week)) !== saved
  const problems = useMemo(() => (week ? week.map(dayProblem) : []), [week])
  const hasProblem = problems.some(Boolean)
  const nothingSaved = saved === '[]'

  // Saiu sem salvar? Pergunta antes.
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      confirm('Sair sem salvar?', 'Suas mudanças no horário vão se perder.', { ok: 'Sair', cancel: 'Continuar editando', destructive: true })
        .then((ok) => { if (ok) navigation.dispatch(e.data.action) })
    })
    return unsub
  }, [navigation])

  function update(fn) {
    setJustSaved(false)
    setWeek((cur) => {
      const next = cur.map((d) => ({ on: d.on, windows: d.windows.map((w) => ({ ...w })) }))
      fn(next)
      return next
    })
  }

  function toggleDay(day, on) {
    update((w) => {
      w[day].on = on
      if (on && w[day].windows.length === 0) {
        // Usa o horário de outro dia ligado como ponto de partida
        const model = ORDER.map((d) => w[d]).find((d) => d.on && d.windows.length)
        w[day].windows = model ? model.windows.map((x) => ({ ...x })) : [{ start: '09:00', end: '18:00' }]
      }
    })
  }

  function setWindow(day, i, key, value) {
    update((w) => { w[day].windows[i][key] = value })
  }

  function addWindow(day) {
    update((w) => {
      const list = w[day].windows
      if (list.length >= 3) return
      // Um intervalo longo vira dois, com 1h de almoço (12h–13h) quando cabe
      if (list.length === 1) {
        const [only] = list
        if (toMin(only.start) < toMin('12:00') && toMin(only.end) > toMin('13:00')) {
          w[day].windows = [{ start: only.start, end: '12:00' }, { start: '13:00', end: only.end }]
          return
        }
      }
      const last = list[list.length - 1]
      const start = last ? Math.min(toMin(last.end) + 60, 22 * 60) : 9 * 60
      list.push({ start: toHHMM(start), end: toHHMM(Math.min(start + 180, 23 * 60 + 45)) })
    })
  }

  function removeWindow(day, i) {
    update((w) => { w[day].windows.splice(i, 1); if (w[day].windows.length === 0) w[day].on = false })
  }

  function copyTo(day, targets) {
    update((w) => {
      for (const t of targets) {
        if (t === day) continue
        w[t].on = w[day].on
        w[t].windows = w[day].windows.map((x) => ({ ...x }))
      }
    })
  }

  function applyPreset(p) {
    update((w) => {
      for (let d = 0; d < 7; d++) {
        const on = p.days.includes(d)
        w[d].on = on
        w[d].windows = on ? p.windows.map(([start, end]) => ({ start, end })) : []
      }
    })
  }

  async function save() {
    if (hasProblem) return
    if (!(await ensureFeature(app, 'hours'))) return
    setSaving(true)
    try {
      const r = await post('/api/agenda/hours', { hours: toApi(week) })
      const w = fromApi(r.hours)
      setWeek(w)
      setSaved(JSON.stringify(toApi(w)))
      setJustSaved(true)
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  if (!week) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Horário de atendimento' }} />
        {error ? <ErrorBox error={error} onRetry={() => load()} /> : <Loading text="Carregando horários…" />}
      </Screen>
    )
  }

  const openDays = week.filter((d) => d.on).length

  return (
    <Screen onRefresh={dirty ? undefined : () => load(true)} refreshing={refreshing}
      footer={<Button title={dirty ? 'Salvar horários' : 'Horários salvos'} icon={dirty ? 'save-outline' : 'checkmark'} onPress={save} loading={saving} disabled={!dirty || hasProblem} />}>
      <Stack.Screen options={{ title: 'Horário de atendimento' }} />
      <ErrorBox error={error} onRetry={() => load()} />
      {justSaved ? <Banner tone="green" icon="checkmark-circle-outline" text="Horários salvos. Sua página já mostra os horários novos." /> : null}
      {nothingSaved && !dirty ? (
        <Banner tone="orange" icon="alert-circle-outline" text="Sem horário salvo, sua página não mostra nenhum horário pras clientes." />
      ) : null}
      {!app.can('hours') ? (
        <Banner tone="orange" icon="lock-closed-outline" text="Seu plano não está ativo. Você vê seus horários, mas pra mudar precisa de um plano ativo." />
      ) : null}

      <Muted style={{ marginBottom: spacing.md }}>
        Os horários livres da sua página saem daqui, já descontando agendamentos e folgas.
      </Muted>

      {openDays === 0 || nothingSaved ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Label style={{ marginBottom: spacing.sm }}>Comece rápido</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {PRESETS.map((p) => <Chip key={p.label} label={p.label} onPress={() => applyPreset(p)} />)}
          </View>
          <Muted>Depois ajuste dia por dia.</Muted>
        </Card>
      ) : null}

      {ORDER.map((day) => {
        const d = week[day]
        const problem = problems[day]
        return (
          <Card key={day} padded={false} style={{ marginBottom: spacing.md, borderColor: problem ? colors.danger : colors.line }}>
            <ToggleRow title={WEEKDAYS_LONG[day]} subtitle={summary(d)} value={d.on} onValueChange={(v) => toggleDay(day, v)} />
            {d.on ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                {d.windows.map((w, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <TimeField label={i === 0 ? 'Começa' : undefined} value={w.start} onChange={(v) => setWindow(day, i, 'start', v)} minuteInterval={15} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TimeField label={i === 0 ? 'Termina' : undefined} value={w.end} onChange={(v) => setWindow(day, i, 'end', v)} minuteInterval={15} />
                    </View>
                    <View style={{ marginBottom: spacing.lg + 4 }}>
                      <IconButton icon="close" size={36} color={colors.inkSoft} bg={colors.paperSoft} label="Remover horário" onPress={() => removeWindow(day, i)} />
                    </View>
                  </View>
                ))}
                {problem ? <Muted style={{ color: colors.danger, marginBottom: spacing.sm }}>{problem}</Muted> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {d.windows.length < 3 ? (
                    <Button small variant="secondary" full={false} icon="add"
                      title={d.windows.length === 1 ? 'Pausa / almoço' : 'Outro horário'} onPress={() => addWindow(day)} />
                  ) : null}
                  <Button small variant="ghost" full={false} icon="copy-outline" title="Copiar pra seg–sex" onPress={() => copyTo(day, WEEKDAYS)} />
                  <Button small variant="ghost" full={false} icon="albums-outline" title="Pra todos" onPress={() => copyTo(day, [0, 1, 2, 3, 4, 5, 6])} />
                </View>
              </View>
            ) : null}
          </Card>
        )
      })}

      <Section title="Também ajuda">
        <Card padded={false}>
          <Row icon="airplane-outline" title="Folgas e férias" subtitle="Feriado, consulta, viagem: bloqueie o dia ou só algumas horas." chevron
            onPress={() => router.push('/blocked')} />
        </Card>
      </Section>
    </Screen>
  )
}
