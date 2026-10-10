// Nova cliente fixa ou edição (?id=&client_id=&service_id=). Cliente, frequência,
// dia da semana, horário, primeira data, serviço ou valor avulso, equipe (Premium),
// data final, observações e prévia das próximas 6 datas (mesma regra do servidor,
// api/_lib/recurring.js). Salvar já coloca as próximas 6 semanas na agenda.
import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { WEEKDAYS, WEEKDAYS_LONG, addDays, centsToInput, fmtDay, fmtDuration, fmtMoney, fmtPhone, fmtWhen, parseMoney, todayKey, weekdayOf } from '../../lib/format'
import { colors, radius, spacing, type } from '../../lib/theme'
import Locked from '../../components/Locked'
import { DateField, TimeField } from '../../components/pickers'
import { Avatar, Banner, Button, Card, Chip, Divider, ErrorBox, Input, Label, Loading, Muted, Row, Screen, Section, Segmented, StatusBadge, ToggleRow } from '../../components/ui'
import { conflictText } from './index'

const FREQS = [
  { value: 'weekly', label: 'Semanal', long: 'Toda semana' },
  { value: 'biweekly', label: 'Quinzenal', long: 'A cada 2 semanas' },
  { value: 'every3weeks', label: '3 sem.', long: 'A cada 3 semanas' },
  { value: 'every4weeks', label: '4 sem.', long: 'A cada 4 semanas (mais ou menos 1 vez por mês)' },
]
const FREQ_WEEKS = { weekly: 1, biweekly: 2, every3weeks: 3, every4weeks: 4 }
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DURATIONS = [30, 60, 90, 120, 180, 240]
const KEY = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const validKey = (k) => KEY.test(String(k || '')) && new Date(k + 'T12:00:00Z').toISOString().slice(0, 10) === k
const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000)
/** Primeira data >= key no dia da semana `dow`. */
const alignTo = (key, dow) => addDays(key, (Number(dow) - weekdayOf(key) + 7) % 7)

/**
 * Próximas `n` datas da regra a partir de `fromKey` (mesma conta do servidor:
 * conta a partir da primeira data, respeita data final e semanas puladas).
 */
export function previewDates(rule, fromKey, n = 6) {
  const step = FREQ_WEEKS[rule.frequency]
  if (!step || !validKey(rule.anchor_date) || !validKey(fromKey)) return []
  const first = alignTo(rule.anchor_date, rule.day_of_week)
  const period = step * 7
  const k = fromKey > first ? Math.ceil(diffDays(first, fromKey) / period) : 0
  const skip = new Set(rule.skip_dates || [])
  const out = []
  for (let d = addDays(first, k * period), i = 0; out.length < n && i < 300; d = addDays(d, period), i++) {
    if (rule.end_date && d > rule.end_date) break
    if (!skip.has(d)) out.push(d)
  }
  return out
}

const one = (v) => (Array.isArray(v) ? v[0] : v) || null

function StaffChip({ label, color, selected, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1,
        borderColor: selected ? colors.green : colors.line, backgroundColor: selected ? colors.green : colors.white, marginRight: 8, marginBottom: 8 }}>
      {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, borderWidth: selected ? 1 : 0, borderColor: colors.white }} /> : null}
      <Text style={{ fontSize: 14, fontWeight: '500', color: selected ? colors.white : colors.inkSoft }}>{label}</Text>
    </Pressable>
  )
}

function RecurringEdit() {
  const app = useApp()
  const params = useLocalSearchParams()
  const id = one(params.id)
  const clientParam = one(params.client_id)
  const serviceParam = one(params.service_id)
  const editing = !!id
  const today = todayKey()
  const canTeam = app.can('team')
  const cleaning = app.provider?.vertical === 'cleaning'

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [services, setServices] = useState([])
  const [staff, setStaff] = useState([])
  const [rule, setRule] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [client, setClient] = useState(null)
  const [form, setForm] = useState({
    service_id: null, duration: '60', price: '', staff_id: null, frequency: cleaning ? 'biweekly' : 'weekly',
    day_of_week: weekdayOf(today), start_time: '09:00', anchor_date: today, has_end: false, end_date: '', notes: '',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(null)

  // Busca de cliente
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const searchSeq = useRef(0)

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: null })) }

  function fillFromRule(r) {
    setRule(r)
    setClient({ id: r.client_id, name: r.client_name, whatsapp: r.client_whatsapp })
    setForm({
      service_id: r.service_id || null,
      duration: String(r.duration_min || 60),
      price: centsToInput(r.price_cents),
      staff_id: r.staff_id || null,
      frequency: r.frequency,
      day_of_week: r.day_of_week,
      start_time: r.start_time || '09:00',
      anchor_date: r.anchor_date,
      has_end: !!r.end_date,
      end_date: r.end_date || '',
      notes: r.notes || '',
    })
  }

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [sv, st, rr, cl] = await Promise.all([
        api('/api/agenda/services?mine=1').catch(() => ({ services: [] })),
        canTeam ? api('/api/agenda/staff').catch(() => ({ staff: [] })) : Promise.resolve({ staff: [] }),
        editing ? api(`/api/agenda/recurring?id=${encodeURIComponent(id)}`) : Promise.resolve(null),
        !editing && clientParam ? api(`/api/agenda/clients?id=${encodeURIComponent(clientParam)}`).catch(() => null) : Promise.resolve(null),
      ])
      // Serviço pausado que a regra ainda usa continua na lista
      const svcs = (sv.services || []).filter((s) => s.active !== false || (rr && s.id === rr.rule?.service_id))
      setServices(svcs)
      setStaff(st.staff || [])
      if (rr) {
        fillFromRule(rr.rule)
        setUpcoming(rr.appointments || [])
      } else {
        if (cl?.client) setClient({ id: cl.client.id, name: cl.client.name, whatsapp: cl.client.whatsapp })
        const s = serviceParam ? svcs.find((x) => x.id === serviceParam) : null
        if (s) setForm((f) => ({ ...f, service_id: s.id, duration: String(s.duration_min || 60), price: centsToInput(s.price_cents) }))
      }
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  // Busca com pausa de 300ms; sem texto mostra as clientes mais recentes
  useEffect(() => {
    if (client || loading) return undefined
    const my = ++searchSeq.current
    const q = query.trim()
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api(q ? `/api/agenda/clients?q=${encodeURIComponent(q)}&limit=12` : '/api/agenda/clients?limit=8')
        if (my !== searchSeq.current) return
        setResults((r.clients || []).filter((c) => !c.archived))
        setSearchError(null)
      } catch (e) {
        if (my === searchSeq.current) setSearchError(e)
      } finally {
        if (my === searchSeq.current) setSearching(false)
      }
    }, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [query, client, loading])

  // ── Dia e primeira data andam juntos ─────────────────────────────────────
  function pickDay(d) {
    setForm((f) => {
      // Mantém a primeira data se ela já cai nesse dia; senão, a próxima a partir de hoje
      const keep = validKey(f.anchor_date) && weekdayOf(f.anchor_date) === d
      return { ...f, day_of_week: d, anchor_date: keep ? f.anchor_date : alignTo(today, d) }
    })
    setErrors((e) => ({ ...e, anchor_date: null }))
  }
  function pickAnchor(key) {
    setForm((f) => ({ ...f, anchor_date: key, day_of_week: validKey(key) ? weekdayOf(key) : f.day_of_week }))
    setErrors((e) => ({ ...e, anchor_date: null }))
  }
  function pickService(s) {
    if (!s) { setForm((f) => ({ ...f, service_id: null })); return }
    setForm((f) => ({ ...f, service_id: s.id, duration: String(s.duration_min || f.duration), price: centsToInput(s.price_cents) }))
    setErrors((e) => ({ ...e, price: null, duration: null }))
  }

  const preview = useMemo(() => previewDates({
    frequency: form.frequency,
    day_of_week: form.day_of_week,
    anchor_date: form.anchor_date,
    end_date: form.has_end && validKey(form.end_date) ? form.end_date : null,
    skip_dates: rule?.skip_dates || [],
  }, today, 6), [form.frequency, form.day_of_week, form.anchor_date, form.has_end, form.end_date, rule?.skip_dates, today])

  const staffOptions = useMemo(() => staff.filter((m) => m.active || m.id === form.staff_id), [staff, form.staff_id])
  const priceCents = parseMoney(form.price)
  const duration = Math.round(Number(form.duration))
  const freq = FREQS.find((f) => f.value === form.frequency) || FREQS[0]
  const perMonth = priceCents != null ? Math.round((priceCents * 52) / 12 / (FREQ_WEEKS[form.frequency] || 1)) : null

  function validate() {
    const e = {}
    if (!client) e.client = 'Escolha a cliente'
    if (!HHMM.test(String(form.start_time || ''))) e.start_time = 'Escolha o horário (HH:MM)'
    if (!Number.isFinite(duration) || duration < 5 || duration > 720) e.duration = 'Duração entre 5 minutos e 12 horas'
    if (priceCents == null) e.price = 'Coloque o valor (pode ser 0)'
    else if (priceCents > 1000000) e.price = 'Valor alto demais'
    if (!validKey(form.anchor_date)) e.anchor_date = 'Escolha a primeira data'
    if (form.has_end) {
      if (!validKey(form.end_date)) e.end_date = 'Escolha a data final'
      else if (validKey(form.anchor_date) && form.end_date < alignTo(form.anchor_date, form.day_of_week)) e.end_date = 'A data final precisa ser depois da primeira data'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!(await ensureFeature(app, 'recurring'))) return
    if (!validate()) return
    setSaving(true)
    try {
      const anchor = alignTo(form.anchor_date, form.day_of_week)
      const body = {
        client_id: client.id,
        service_id: form.service_id,
        frequency: form.frequency,
        start_time: form.start_time,
        duration_min: duration,
        price_cents: priceCents,
        end_date: form.has_end ? form.end_date : null,
        notes: form.notes.trim(),
      }
      // Na edição, dia e primeira data só vão se mudaram (regra antiga continua editável)
      if (!editing || !rule || form.day_of_week !== rule.day_of_week) body.day_of_week = form.day_of_week
      if (!editing || !rule || anchor !== rule.anchor_date) body.anchor_date = anchor
      // Sem plano com equipe, não mexe em quem atende
      if (canTeam) body.staff_id = form.staff_id
      const r = editing
        ? await post('/api/agenda/recurring', { action: 'update', id, ...body })
        : await post('/api/agenda/recurring', { action: 'create', ...body })

      if (r.conflicts?.length) {
        notify('Salvo, mas atenção', conflictText(r.conflicts))
      } else if (r.warning) {
        notify('Salvo, com um aviso', `Não deu pra colocar todos os horários na agenda agora (${r.warning}). Tentamos de novo amanhã cedo.`)
      } else if (!editing) {
        const n = r.created || 0
        notify('Cliente fixa cadastrada', n
          ? `${n} ${n === 1 ? 'horário já está' : 'horários já estão'} na agenda. Os próximos entram sozinhos.`
          : 'Os horários entram na agenda conforme as datas chegarem perto.')
      }
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const ok = await confirm(`Excluir a recorrência de ${client?.name || 'cliente'}?`,
      'Os próximos horários dela saem da agenda. O que já aconteceu (e o que tem pagamento) continua no histórico.',
      { ok: 'Excluir', destructive: true })
    if (!ok) return
    setDeleting(true)
    try {
      await post('/api/agenda/recurring', { action: 'delete', id })
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setDeleting(false)
    }
  }

  async function act(action, extra = {}) {
    if ((action === 'resume' || action === 'unskip') && !(await ensureFeature(app, 'recurring'))) return
    if (action === 'pause') {
      const ok = await confirm(`Pausar ${client?.name || 'a cliente'}?`, 'Os próximos horários saem da agenda até você retomar. Quando voltar, a frequência continua no mesmo ritmo.', { ok: 'Pausar' })
      if (!ok) return
    }
    setBusy(action + (extra.date || ''))
    try {
      const r = await post('/api/agenda/recurring', { action, id, ...extra })
      if (r.rule) fillFromRule(r.rule)
      // Atualiza a lista "já na agenda"
      api(`/api/agenda/recurring?id=${encodeURIComponent(id)}`).then((x) => setUpcoming(x.appointments || [])).catch(() => {})
      if (r.conflicts?.length) notify('Voltou pra agenda, mas atenção', conflictText(r.conflicts))
    } catch (e) {
      showError(e)
    } finally {
      setBusy(null)
    }
  }

  const title = editing ? 'Cliente fixa' : 'Nova cliente fixa'
  if (loading) return <Screen><Stack.Screen options={{ title }} /><Loading /></Screen>
  if (loadError) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorBox error={loadError} onRetry={load} />
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </Screen>
    )
  }

  const skipped = (rule?.skip_dates || []).filter((d) => d >= today)

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title }} />
      <Screen footer={<Button title={editing ? 'Salvar alterações' : 'Salvar e colocar na agenda'} onPress={save} loading={saving} disabled={deleting} />}>
        {rule && !rule.active ? (
          <Banner tone="gray" icon="pause-circle-outline" text="Pausada: os horários não estão entrando na agenda." action="Retomar" onPress={() => act('resume')} />
        ) : null}

        {/* ── Cliente ── */}
        <Label style={{ marginBottom: spacing.sm }}>Cliente</Label>
        {client ? (
          <Card padded={false} style={{ marginBottom: spacing.lg }}>
            <Row left={<Avatar name={client.name} size={40} />} title={client.name} subtitle={client.whatsapp ? fmtPhone(client.whatsapp) : null}
              right={!editing ? (
                <Pressable onPress={() => { setClient(null); setQuery('') }} hitSlop={10} accessibilityRole="button">
                  <Text style={{ color: colors.green, fontWeight: '600' }}>Trocar</Text>
                </Pressable>
              ) : null} />
          </Card>
        ) : (
          <View style={{ marginBottom: spacing.lg }}>
            <Input value={query} onChangeText={setQuery} placeholder="Buscar por nome ou WhatsApp" autoCapitalize="words" autoCorrect={false}
              error={errors.client} style={{ marginBottom: spacing.sm }} autoFocus={!clientParam}
              right={searching ? <View style={{ paddingHorizontal: spacing.md }}><Loading style={{ padding: 0 }} /></View> : null} />
            <ErrorBox error={searchError} />
            {results.length ? (
              <Card padded={false}>
                {results.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 68 }} /> : null}
                    <Row left={<Avatar name={c.name} size={36} />} title={c.name}
                      subtitle={[c.whatsapp ? fmtPhone(c.whatsapp) : null, c.city].filter(Boolean).join(' · ') || null}
                      onPress={() => { setClient({ id: c.id, name: c.name, whatsapp: c.whatsapp }); setErrors((e) => ({ ...e, client: null })) }} />
                  </View>
                ))}
              </Card>
            ) : !searching && query.trim() ? (
              <Muted style={{ marginBottom: spacing.sm }}>Ninguém com “{query.trim()}”.</Muted>
            ) : null}
            <Button title="Cadastrar cliente nova" icon="person-add-outline" variant="ghost" small full={false}
              onPress={() => router.push({ pathname: '/client/edit', params: query.trim() ? { name: query.trim() } : {} })} style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {/* ── Quando ── */}
        <Label style={{ marginBottom: spacing.sm }}>Frequência</Label>
        <Segmented options={FREQS} value={form.frequency} onChange={set('frequency')} />
        <Muted style={{ marginTop: 6, marginBottom: spacing.lg }}>{freq.long}</Muted>

        <Label style={{ marginBottom: spacing.sm }}>Dia da semana</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
          {DAY_ORDER.map((d) => (
            <Chip key={d} label={WEEKDAYS[d].charAt(0).toUpperCase() + WEEKDAYS[d].slice(1)} selected={form.day_of_week === d} onPress={() => pickDay(d)} />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TimeField label="Horário" value={form.start_time} onChange={set('start_time')} />
            {errors.start_time ? <Text style={[type.muted, { color: colors.danger, marginTop: -spacing.md, marginBottom: spacing.md }]}>{errors.start_time}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="Primeira data" value={form.anchor_date} onChange={pickAnchor} />
            {errors.anchor_date ? <Text style={[type.muted, { color: colors.danger, marginTop: -spacing.md, marginBottom: spacing.md }]}>{errors.anchor_date}</Text> : null}
          </View>
        </View>

        {/* ── Serviço e valor ── */}
        <Label style={{ marginBottom: spacing.sm }}>Serviço</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {services.map((s) => (
            <Chip key={s.id} label={s.name} selected={form.service_id === s.id} onPress={() => pickService(s)} />
          ))}
          <Chip label={services.length ? 'Avulso' : 'Sem serviço'} icon="create-outline" selected={!form.service_id} onPress={() => pickService(null)} />
        </View>
        <Muted style={{ marginBottom: spacing.lg }}>
          {form.service_id ? 'Preço e duração vieram do serviço. Pode ajustar só pra essa cliente.' : 'Combine o valor e o tempo só pra essa cliente.'}
        </Muted>

        <Label style={{ marginBottom: spacing.sm }}>Duração</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DURATIONS.map((m) => (
            <Chip key={m} label={fmtDuration(m)} selected={duration === m} onPress={() => set('duration')(String(m))} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
          <Input label="Minutos" value={form.duration} onChangeText={(v) => set('duration')(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad"
            error={errors.duration} style={{ flex: 1 }} maxLength={3} />
          <Input label="Valor por visita" value={form.price} onChangeText={set('price')} keyboardType="decimal-pad" placeholder="0"
            error={errors.price} style={{ flex: 1 }} maxLength={9}
            hint={perMonth != null && !errors.price ? `≈ ${fmtMoney(perMonth)} por mês` : null}
            right={<Text style={{ paddingRight: spacing.md, color: colors.inkMuted }}>USD</Text>} />
        </View>

        {/* ── Equipe (Premium) ── */}
        {canTeam && staffOptions.length ? (
          <>
            <Label style={{ marginBottom: spacing.sm }}>Quem atende</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
              <StaffChip label="Eu mesma / sem equipe" selected={!form.staff_id} onPress={() => set('staff_id')(null)} />
              {staffOptions.map((m) => (
                <StaffChip key={m.id} label={m.active ? m.name : `${m.name} (desativada)`} color={m.color} selected={form.staff_id === m.id} onPress={() => set('staff_id')(m.id)} />
              ))}
            </View>
            <Muted style={{ marginBottom: spacing.lg }}>Os horários entram na agenda e na rota do dia de quem você escolher.</Muted>
          </>
        ) : !canTeam && rule?.staff_name ? (
          <Muted style={{ marginBottom: spacing.lg }}>Atende: {rule.staff_name}. Trocar quem atende faz parte do plano Premium.</Muted>
        ) : null}

        {/* ── Fim e observações ── */}
        <Card padded={false} style={{ marginBottom: form.has_end ? spacing.md : spacing.lg }}>
          <ToggleRow title="Tem data pra terminar" subtitle={form.has_end ? 'Depois dessa data, não entra mais na agenda.' : 'Sem fim: continua até você pausar ou excluir.'}
            value={form.has_end} onValueChange={(v) => setForm((f) => {
              // Sugestão: 12 semanas depois da primeira data (ou de hoje, se ela já passou)
              const base = validKey(f.anchor_date) && f.anchor_date > today ? f.anchor_date : today
              return { ...f, has_end: v, end_date: v && !f.end_date ? addDays(alignTo(base, f.day_of_week), 7 * 12) : f.end_date }
            })} />
        </Card>
        {form.has_end ? (
          <>
            <DateField label="Última data possível" value={form.end_date} onChange={set('end_date')} />
            {errors.end_date ? <Text style={[type.muted, { color: colors.danger, marginTop: -spacing.md, marginBottom: spacing.md }]}>{errors.end_date}</Text> : null}
          </>
        ) : null}

        <Input label="Observações" value={form.notes} onChangeText={set('notes')} multiline maxLength={500}
          placeholder={cleaning ? 'Ex.: Limpar geladeira toda vez. Chave com a vizinha.' : 'Ex.: Sempre pé e mão. Prefere esmalte claro.'}
          hint={canTeam ? 'Vão junto em cada horário (e aparecem na rota do dia da equipe).' : 'Vão junto em cada horário gerado.'} />

        {/* ── Prévia ── */}
        <Section title="Próximas datas" style={{ marginTop: spacing.sm }}>
          <Card>
            {preview.length ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {preview.map((d, i) => (
                    <View key={d} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: i === 0 ? colors.greenSoft : colors.paperSoft }}>
                      <Text style={{ fontSize: 14, fontWeight: i === 0 ? '600' : '500', color: i === 0 ? colors.green : colors.inkSoft }}>{fmtDay(d)}</Text>
                    </View>
                  ))}
                </View>
                <Muted style={{ marginTop: spacing.md }}>
                  {`${WEEKDAYS_LONG[form.day_of_week]} às ${HHMM.test(form.start_time) ? form.start_time : '--:--'}. Dias de folga cadastrados ficam de fora.`}
                </Muted>
              </>
            ) : (
              <Muted>{form.has_end ? 'Nenhuma data entre hoje e a data final.' : 'Escolha o dia e a primeira data pra ver as próximas.'}</Muted>
            )}
          </Card>
        </Section>

        {/* ── Edição: o que já está na agenda e as semanas puladas ── */}
        {editing && skipped.length ? (
          <Section title="Semanas puladas">
            <Card padded={false}>
              {skipped.map((d, i) => (
                <View key={d}>
                  {i > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Row icon="play-skip-forward-outline" iconColor={colors.inkMuted} title={fmtDay(d)}
                    right={<Button small full={false} variant="ghost" title="Desfazer" loading={busy === 'unskip' + d} onPress={() => act('unskip', { date: d })} />} />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {editing && upcoming.length ? (
          <Section title="Já na agenda">
            <Card padded={false}>
              {upcoming.slice(0, 6).map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Row title={fmtWhen(a.scheduled_for)} right={<StatusBadge status={a.status} />} chevron
                    onPress={() => router.push(`/appointment/${a.id}`)} />
                </View>
              ))}
            </Card>
            <Muted style={{ marginTop: spacing.sm }}>Mudou só um dia? Remarque pela agenda: a recorrência continua igual.</Muted>
          </Section>
        ) : null}

        {editing && rule?.active ? (
          <Button title="Pausar" variant="secondary" icon="pause-outline" onPress={() => act('pause')} loading={busy === 'pause'} disabled={saving || deleting} style={{ marginTop: spacing.xl }} />
        ) : null}
        {editing ? (
          <Button title="Excluir recorrência" variant="danger" icon="trash-outline" onPress={remove} loading={deleting} disabled={saving} style={{ marginTop: spacing.md }} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

export default function RecurringEditRoute() {
  const app = useApp()
  const { id } = useLocalSearchParams()
  if (!app.can('recurring')) {
    return (
      <>
        <Stack.Screen options={{ title: id ? 'Cliente fixa' : 'Nova cliente fixa' }} />
        <Locked feature="recurring" />
      </>
    )
  }
  return <RecurringEdit />
}
