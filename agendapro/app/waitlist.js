// Lista de espera (plano Pro). Quem quer um horário que não tem: dias e período
// preferidos, serviço e prazo. Quando abre uma vaga (cancelamento), "Abriu um
// horário?" mostra quem combina; "Avisar" manda o modelo 'slot_open' no WhatsApp.
// Vindo do agendamento cancelado (?date=YYYY-MM-DD&time=HH:MM), já abre com esse
// horário, mostra quem combina primeiro e o "Avisar" vem com dia e hora.
// Dados de /api/agenda/waitlist.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { choose, confirm, notify } from '../lib/dialog'
import { colors, spacing } from '../lib/theme'
import { WEEKDAYS, dateKey, fmtAgo, fmtDay, phoneDigits, todayKey } from '../lib/format'
import { firstName, messageLang, msgDate, msgTime, openWhatsApp, renderAny } from '../lib/whatsapp'
import { Avatar, Badge, Banner, Button, Card, Chip, Divider, Empty, ErrorBox, H3, Input, Label, Loading, Muted, P, Row, Screen, Segmented, Small, ToggleRow } from '../components/ui'
import { DateField, TimeField } from '../components/pickers'
import Locked from '../components/Locked'

const PERIODS = [
  { value: 'qualquer', label: 'Qualquer hora' },
  { value: 'manha', label: 'Manhã' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noite', label: 'Noite' },
]
const PERIOD_TEXT = { manha: 'de manhã', tarde: 'à tarde', noite: 'à noite', qualquer: 'qualquer hora' }
const STATUS = {
  waiting: { text: 'Esperando', tone: 'gray' },
  notified: { text: 'Avisada', tone: 'blue' },
  booked: { text: 'Agendou', tone: 'green' },
  removed: { text: 'Removida', tone: 'gray' },
}
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const ACC = { á: 'a', à: 'a', â: 'a', ã: 'a', é: 'e', ê: 'e', í: 'i', ó: 'o', ô: 'o', õ: 'o', ú: 'u', ü: 'u', ç: 'c', ñ: 'n' }
const fold = (s) => String(s || '').toLowerCase().replace(/[áàâãéêíóôõúüçñ]/g, (c) => ACC[c] || c)

function whenText(e) {
  const days = e.preferred_days?.length ? e.preferred_days.map((d) => WEEKDAYS[d]).join(', ') : 'Qualquer dia'
  const parts = [days, PERIOD_TEXT[e.preferred_period] || 'qualquer hora']
  if (e.date_from && e.date_to) parts.push(`de ${fmtDay(e.date_from)} a ${fmtDay(e.date_to)}`)
  else if (e.date_from) parts.push(`a partir de ${fmtDay(e.date_from)}`)
  else if (e.date_to) parts.push(`até ${fmtDay(e.date_to)}`)
  return parts.join(' · ')
}

export default function WaitlistScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Lista de espera' }} />
      <Locked feature="waitlist"><Waitlist /></Locked>
    </>
  )
}

function Waitlist() {
  const app = useApp()
  const { provider, settings } = app
  const canMulti = app.can('multilang_messages')

  // Horário que acabou de vagar (?date=&time=, vindo do agendamento cancelado)
  const query = useLocalSearchParams()
  const pDate = String(query.date || '').slice(0, 10)
  const pTime = String(query.time || '').slice(0, 5)
  const freed = useMemo(() => (DATE_RE.test(pDate) ? { date: pDate, time: HHMM.test(pTime) ? pTime : '' } : null), [pDate, pTime])

  const [tab, setTab] = useState('active')           // active | all
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [services, setServices] = useState([])
  const [clients, setClients] = useState(null)        // sugestões no formulário
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [notifyId, setNotifyId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [slot, setSlot] = useState(() => freed || { date: todayKey(), time: '' })
  const [match, setMatch] = useState(null)            // { date, time, ids: Set }
  const [matching, setMatching] = useState(false)

  const load = useCallback(async ({ pull = false } = {}) => {
    if (pull) setRefreshing(true)
    setError(null)
    try {
      const r = await api(`/api/agenda/waitlist?status=${tab}`)
      setEntries({ tab, list: r.entries || [] })
    } catch (e) {
      setError(e)
    } finally {
      setRefreshing(false)
    }
  }, [tab])

  useFocusEffect(useCallback(() => { load() }, [load]))

  // Serviços pro formulário (uma vez)
  useEffect(() => {
    api('/api/agenda/services?mine=1')
      .then((r) => setServices((r.services || []).filter((s) => s.active !== false)))
      .catch(() => {})
  }, [])

  const loadClients = useCallback(() => {
    if (clients) return
    api('/api/agenda/clients?sort=name').then((r) => setClients(r.clients || [])).catch(() => setClients([]))
  }, [clients])

  const ready = entries && entries.tab === tab
  const list = useMemo(() => {
    if (!ready) return []
    const l = entries.list.slice()
    if (match && tab === 'active') l.sort((a, b) => Number(match.ids.has(b.id)) - Number(match.ids.has(a.id)))
    return l
  }, [ready, entries, match, tab])

  // quiet: busca automática (veio com ?date=), sem alerta quando ninguém combina
  async function runMatch(date, time, { quiet = false } = {}) {
    setMatching(true)
    try {
      const r = await post('/api/agenda/waitlist', { action: 'match', date, time: time || undefined })
      setMatch({ date, time, ids: new Set((r.entries || []).map((e) => e.id)) })
      if (!quiet && !r.entries?.length) notify('Ninguém combina', 'Ninguém da lista prefere esse dia e horário. Você ainda pode avisar quem quiser.')
    } catch (e) { showError(e) } finally { setMatching(false) }
  }

  function findMatches() {
    if (!DATE_RE.test(slot.date)) return notify('Escolha o dia', 'Diga qual dia abriu pra ver quem combina.')
    if (slot.time && !HHMM.test(slot.time)) return notify('Horário inválido', 'Use HH:MM, ex.: 14:30')
    runMatch(slot.date, slot.time)
  }

  // Veio com um horário livre: preenche e já mostra quem combina
  useEffect(() => {
    if (!freed) return
    setTab('active')
    setSlot(freed)
    runMatch(freed.date, freed.time, { quiet: true })
  }, [freed]) // eslint-disable-line react-hooks/exhaustive-deps

  async function update(e, patch) {
    setBusyId(e.id)
    try {
      const r = await post('/api/agenda/waitlist', { action: 'update', id: e.id, ...patch })
      setEntries((cur) => cur && ({ ...cur, list: cur.list.map((x) => (x.id === e.id ? r.entry : x)) }))
      return r.entry
    } catch (err) { showError(err); return null } finally { setBusyId(null) }
  }

  async function sendSlot(e, date, time) {
    if (!e.client_whatsapp) return notify('Sem WhatsApp', 'Edite a entrada e coloque o WhatsApp pra avisar.')
    if (!DATE_RE.test(date) || !HHMM.test(time)) return notify('Escolha dia e hora', 'Diga qual horário abriu pra mandar a mensagem.')
    const lang = messageLang(e.client_language, canMulti)
    const text = renderAny('slot_open', lang, {
      nome: firstName(e.client_name),
      data: msgDate(date, lang),
      hora: msgTime(time, lang),
      servico: e.service_name || '',
      profissional: provider?.name,
    }, settings)
    const ok = await openWhatsApp(e.client_whatsapp, text)
    if (!ok) return notify('WhatsApp não abriu', 'Confira se o WhatsApp está instalado no celular.')
    setNotifyId(null)
    if (e.status !== 'notified') await update(e, { status: 'notified' })
  }

  async function book(e) {
    const ok = await confirm('Agendar e tirar da lista?', `${firstName(e.client_name)} sai da lista de espera como "agendou" e abre o novo agendamento.`, { ok: 'Agendar' })
    if (!ok) return
    const saved = await update(e, { status: 'booked' })
    if (!saved) return
    const params = { client_name: e.client_name }
    if (e.client_id) params.client_id = e.client_id
    if (e.client_whatsapp) params.client_whatsapp = e.client_whatsapp
    if (e.service_id) params.service_id = e.service_id
    const when = match || freed
    if (when?.date) params.date = when.date
    if (when?.time) params.time = when.time
    router.push({ pathname: '/appointment/new', params })
  }

  function edit(e) {
    loadClients()
    setNotifyId(null)
    setEditingId(e.id)
  }

  async function setStatus(e, v) {
    const saved = await update(e, { status: v })
    if (saved && tab === 'active' && v === 'removed') setEntries((cur) => ({ ...cur, list: cur.list.filter((x) => x.id !== e.id) }))
  }

  async function remove(e) {
    const ok = await confirm('Excluir de vez?', 'A entrada some da lista e do histórico.', { ok: 'Excluir', destructive: true })
    if (!ok) return
    setBusyId(e.id)
    try {
      await post('/api/agenda/waitlist', { action: 'delete', id: e.id })
      setEntries((cur) => ({ ...cur, list: cur.list.filter((x) => x.id !== e.id) }))
    } catch (err) { showError(err) } finally { setBusyId(null) }
  }

  async function startAdd() {
    if (!(await ensureFeature(app, 'waitlist'))) return
    loadClients()
    setEditingId(null)
    setAdding(true)
  }

  const formProps = { services, clients, provider, settings, canMulti, isCleaning: provider?.vertical === 'cleaning' }

  return (
    <Screen onRefresh={() => load({ pull: true })} refreshing={refreshing}>
      {freed ? (
        <Banner tone="green" icon="time-outline"
          text={`Horário livre: ${fmtDay(freed.date)}${freed.time ? ' às ' + freed.time : ''}`} />
      ) : null}
      <Segmented options={[{ value: 'active', label: 'Esperando' }, { value: 'all', label: 'Todas' }]} value={tab}
        onChange={(v) => { setTab(v); setMatch(null) }} />

      {tab === 'active' ? (
        <Card style={{ marginTop: spacing.md }}>
          <H3>Abriu um horário?</H3>
          <Muted style={{ marginTop: 2, marginBottom: spacing.md }}>Cancelaram ou sobrou vaga? Veja quem da lista combina com o dia e a hora.</Muted>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1.3 }}><DateField label="Dia" value={slot.date} onChange={(d) => setSlot((s) => ({ ...s, date: d }))} /></View>
            <View style={{ flex: 1 }}><TimeField label="Hora" value={slot.time} onChange={(t) => setSlot((s) => ({ ...s, time: t }))} minuteInterval={15} placeholder="Opcional" /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="Ver quem combina" icon="search-outline" onPress={findMatches} loading={matching} style={{ flex: 1 }} />
            {match ? <Button title="Limpar" variant="secondary" full={false} onPress={() => setMatch(null)} /> : null}
          </View>
          {match ? (
            <Small style={{ marginTop: spacing.sm, color: match.ids.size ? colors.green : colors.inkSoft, fontWeight: '600' }}>
              {match.ids.size ? `${match.ids.size} pessoa${match.ids.size === 1 ? '' : 's'} combina${match.ids.size === 1 ? '' : 'm'} com ${fmtDay(match.date)}${match.time ? ' às ' + match.time : ''}` : 'Ninguém combina com esse horário.'}
            </Small>
          ) : null}
        </Card>
      ) : null}

      {adding ? (
        <Card style={{ marginTop: spacing.md }}>
          <H3 style={{ marginBottom: spacing.md }}>Nova pessoa na lista</H3>
          <EntryForm {...formProps} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
        </Card>
      ) : (
        <Button title="Adicionar à lista" icon="person-add-outline" variant="secondary" onPress={startAdd} style={{ marginTop: spacing.md }} />
      )}

      {error ? <ErrorBox error={error} onRetry={() => load()} style={{ marginTop: spacing.md }} /> : null}

      {!ready ? (!error ? <Loading /> : null) : !list.length ? (
        <Empty icon="hourglass-outline" style={{ marginTop: spacing.md }}
          title={tab === 'active' ? 'Ninguém esperando' : 'Lista vazia'}
          text="Quando alguém pedir um horário que você não tem, anote aqui. Se abrir uma vaga, você avisa em 1 toque." />
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          <Label style={{ marginBottom: spacing.sm, marginLeft: 2 }}>
            {tab === 'active'
              ? `${list.length} esperando · ${match?.ids.size ? 'quem combina aparece primeiro' : 'quem chegou antes aparece primeiro'}`
              : `${list.length} entrada${list.length === 1 ? '' : 's'}`}
          </Label>
          {list.map((e) => (
            <EntryCard key={e.id} e={e}
              matched={!!match?.ids.has(e.id)}
              busy={busyId === e.id}
              editing={editingId === e.id}
              notifying={notifyId === e.id}
              slot={match ? { date: match.date, time: match.time } : slot}
              formProps={formProps}
              onNotify={() => { setEditingId(null); setNotifyId(notifyId === e.id ? null : e.id) }}
              onSend={(d, t) => sendSlot(e, d, t)}
              onBook={() => book(e)}
              onEdit={() => edit(e)}
              onStatus={(v) => setStatus(e, v)}
              onDelete={() => remove(e)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={(saved) => { setEditingId(null); setEntries((cur) => ({ ...cur, list: cur.list.map((x) => (x.id === saved.id ? saved : x)) })) }} />
          ))}
        </View>
      )}
    </Screen>
  )
}

function EntryCard({ e, matched, busy, editing, notifying, slot, formProps, onNotify, onSend, onBook, onEdit, onStatus, onDelete, onCancelEdit, onSaved }) {
  const [date, setDate] = useState(slot.date || todayKey())
  const [time, setTime] = useState(slot.time || '')
  useEffect(() => { if (notifying) { setDate(slot.date || todayKey()); setTime(slot.time || '') } }, [notifying]) // eslint-disable-line react-hooks/exhaustive-deps

  const st = STATUS[e.status] || STATUS.waiting
  const active = e.status === 'waiting' || e.status === 'notified'

  // Ações extras numa folha de opções
  async function more() {
    const v = await choose(e.client_name, [
      { label: 'Editar', value: 'edit' },
      ...(e.client_id ? [{ label: 'Abrir ficha', value: 'client' }] : []),
      ...(e.status !== 'waiting' ? [{ label: 'Voltar pra lista', value: 'waiting' }] : []),
      ...(e.status !== 'removed' ? [{ label: 'Tirar da lista', value: 'removed' }] : []),
      { label: 'Excluir', value: 'delete', destructive: true },
    ])
    if (v === 'edit') onEdit()
    else if (v === 'client') router.push(`/client/${e.client_id}`)
    else if (v === 'waiting' || v === 'removed') onStatus(v)
    else if (v === 'delete') onDelete()
  }

  if (editing) {
    return (
      <Card style={{ marginBottom: spacing.md }}>
        <H3 style={{ marginBottom: spacing.md }}>Editar · {e.client_name}</H3>
        <EntryForm {...formProps} initial={e} onCancel={onCancelEdit} onSaved={onSaved} />
      </Card>
    )
  }

  return (
    <Card style={[{ marginBottom: spacing.md }, matched && { borderColor: colors.green, borderWidth: 1.5 }, !active && { opacity: 0.75 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={e.client_name} size={42} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <H3 numberOfLines={1}>{e.client_name}</H3>
          <Small numberOfLines={2}>{e.service_name ? `${e.service_name} · ` : ''}{whenText(e)}</Small>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
        {matched ? <Badge text="Combina" tone="green" icon="checkmark-circle" /> : null}
        <Badge text={e.status === 'notified' && e.notified_at ? `Avisada ${fmtAgo(e.notified_at)}` : st.text} tone={st.tone} />
        {e.expired && active ? <Badge text="Prazo passou" tone="orange" /> : null}
        {!e.client_whatsapp ? <Badge text="Sem WhatsApp" tone="red" /> : null}
      </View>

      {e.notes ? <P style={{ marginTop: spacing.sm, color: colors.inkSoft }}>{e.notes}</P> : null}
      <Muted style={{ marginTop: spacing.sm }}>Na lista desde {fmtDay(dateKey(new Date(e.created_at)))} ({fmtAgo(e.created_at)})</Muted>

      {notifying ? (
        <View style={{ marginTop: spacing.md }}>
          <Divider style={{ marginTop: 0 }} />
          <Label style={{ marginBottom: spacing.sm }}>Qual horário abriu?</Label>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1.3 }}><DateField label="Dia" value={date} onChange={setDate} /></View>
            <View style={{ flex: 1 }}><TimeField label="Hora" value={time} onChange={setTime} minuteInterval={15} /></View>
          </View>
          <Button title="Abrir WhatsApp com a mensagem" icon="logo-whatsapp" variant="whatsapp" onPress={() => onSend(date, time)} loading={busy} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        {active ? (
          <>
            <Button title={notifying ? 'Fechar' : 'Avisar'} icon={notifying ? 'close' : 'logo-whatsapp'} small variant={notifying ? 'secondary' : 'whatsapp'}
              disabled={!e.client_whatsapp && !notifying} onPress={onNotify} style={{ flex: 1 }} />
            <Button title="Agendar" icon="calendar-outline" small variant="secondary" onPress={onBook} loading={busy && !notifying} style={{ flex: 1 }} />
          </>
        ) : <View style={{ flex: 1 }} />}
        <Button title="Mais" icon="ellipsis-horizontal" small variant="ghost" full={false} onPress={more} />
      </View>
    </Card>
  )
}

/** Formulário de entrada (nova ou edição). */
function EntryForm({ initial, services, clients, provider, settings, canMulti, onCancel, onSaved }) {
  const app = useApp()
  const [name, setName] = useState(initial?.client_name || '')
  const [whatsapp, setWhatsapp] = useState(initial?.client_whatsapp || '')
  const [clientId, setClientId] = useState(initial?.client_id || null)
  const [clientLang, setClientLang] = useState(initial?.client_language || 'pt')
  const [serviceId, setServiceId] = useState(initial?.service_id || null)
  const [days, setDays] = useState(initial?.preferred_days || [])
  const [period, setPeriod] = useState(initial?.preferred_period || 'qualquer')
  const [hasRange, setHasRange] = useState(!!(initial?.date_from || initial?.date_to))
  const [from, setFrom] = useState(initial?.date_from || '')
  const [to, setTo] = useState(initial?.date_to || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [sendMsg, setSendMsg] = useState(true)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  // Sugere clientes cadastradas enquanto digita o nome
  const suggestions = useMemo(() => {
    const term = fold(name.trim())
    if (clientId || term.length < 2 || !clients) return []
    return clients.filter((c) => fold(c.name).includes(term)).slice(0, 4)
  }, [name, clientId, clients])

  function pickClient(c) {
    setClientId(c.id)
    setName(c.name)
    setWhatsapp(c.whatsapp || '')
    setClientLang(c.language || 'pt')
  }

  const toggleDay = (d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)))

  async function save() {
    const e = {}
    if (!name.trim()) e.name = 'Diga o nome'
    const digits = phoneDigits(whatsapp)
    if (whatsapp.trim() && (digits.length < 10 || digits.length > 15)) e.whatsapp = 'Confira o número (com DDD)'
    if (hasRange) {
      if (from && !DATE_RE.test(from)) e.range = 'Data inicial inválida'
      else if (to && !DATE_RE.test(to)) e.range = 'Data final inválida'
      else if (from && to && to < from) e.range = 'A data final precisa ser depois da inicial'
    }
    setErrors(e)
    if (Object.keys(e).length) return
    if (!(await ensureFeature(app, 'waitlist'))) return

    const body = {
      client_id: clientId || (initial ? null : undefined),
      client_name: name.trim(),
      client_whatsapp: whatsapp.trim(),
      service_id: serviceId || (initial ? null : undefined),
      preferred_days: days,
      preferred_period: period,
      date_from: hasRange ? from : '',
      date_to: hasRange ? to : '',
      notes: notes.trim(),
    }
    setSaving(true)
    try {
      const r = await post('/api/agenda/waitlist', initial ? { action: 'update', id: initial.id, ...body } : { action: 'create', ...body })
      if (!initial && sendMsg && r.entry?.client_whatsapp) {
        const lang = messageLang(r.entry.client_language || clientLang, canMulti)
        const svc = services.find((s) => s.id === serviceId)
        openWhatsApp(r.entry.client_whatsapp, renderAny('waitlist_added', lang, {
          nome: firstName(r.entry.client_name),
          servico: svc?.name || (lang === 'en' ? 'an appointment' : lang === 'es' ? 'una cita' : 'um horário'),
          profissional: provider?.name,
        }, settings))
      }
      onSaved(r.entry)
    } catch (err) { showError(err) } finally { setSaving(false) }
  }

  return (
    <View>
      <Input label="Nome *" value={name} onChangeText={(t) => { setName(t); if (clientId) setClientId(null); setErrors((x) => ({ ...x, name: null })) }}
        placeholder="Nome de quem está esperando" autoCapitalize="words" error={errors.name} maxLength={120}
        style={{ marginBottom: suggestions.length || clientId ? spacing.sm : spacing.lg }} />
      {suggestions.length ? (
        <Card padded={false} style={{ marginBottom: spacing.lg }}>
          {suggestions.map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
              <Row left={<Avatar name={c.name} size={30} />} title={c.name} subtitle={c.whatsapp ? 'Cliente cadastrada' : 'Cliente cadastrada · sem WhatsApp'} onPress={() => pickClient(c)} />
            </View>
          ))}
        </Card>
      ) : null}
      {clientId ? <Badge text="Ligada à ficha da cliente" tone="green" icon="person" style={{ marginBottom: spacing.lg }} /> : null}

      <Input label="WhatsApp" value={whatsapp} onChangeText={(t) => { setWhatsapp(t); setErrors((x) => ({ ...x, whatsapp: null })) }}
        placeholder="(512) 555-0101" keyboardType="phone-pad" error={errors.whatsapp} maxLength={30} />

      {services.length ? (
        <>
          <Label style={{ marginBottom: spacing.sm }}>Serviço</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
            <Chip label="Qualquer" selected={!serviceId} onPress={() => setServiceId(null)} />
            {services.map((s) => <Chip key={s.id} label={s.name} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />)}
          </View>
        </>
      ) : null}

      <Label style={{ marginBottom: spacing.sm }}>Dias que ela pode</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {WEEKDAYS.map((w, d) => <Chip key={w} label={w} selected={days.includes(d)} onPress={() => toggleDay(d)} />)}
      </View>
      <Muted style={{ marginBottom: spacing.md }}>{days.length ? '' : 'Nenhum marcado = qualquer dia.'}</Muted>

      <Label style={{ marginBottom: spacing.sm }}>Período</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
        {PERIODS.map((p) => <Chip key={p.value} label={p.label} selected={period === p.value} onPress={() => setPeriod(p.value)} />)}
      </View>

      <ToggleRow title="Tem prazo?" subtitle="Ex.: só serve até o casamento dia 20" value={hasRange} onValueChange={setHasRange} />
      {hasRange ? (
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}><DateField label="A partir de" value={from} onChange={setFrom} placeholder="Hoje" /></View>
          <View style={{ flex: 1 }}><DateField label="Até" value={to} onChange={setTo} placeholder="Sem fim" /></View>
        </View>
      ) : null}
      {errors.range ? <Small style={{ color: colors.danger, marginBottom: spacing.md }}>{errors.range}</Small> : null}

      <Input label="Observações" value={notes} onChangeText={setNotes} multiline maxLength={500} placeholder="Ex.: quer com a Ana, prefere sábado cedo" style={{ marginTop: spacing.sm }} />

      {!initial ? (
        <ToggleRow title="Avisar no WhatsApp que entrou na lista" subtitle="Abre a mensagem pronta depois de salvar" value={sendMsg && !!whatsapp.trim()}
          onValueChange={setSendMsg} disabled={!whatsapp.trim()} />
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Button title="Cancelar" variant="secondary" onPress={onCancel} style={{ flex: 1 }} disabled={saving} />
        <Button title={initial ? 'Salvar' : 'Adicionar'} onPress={save} loading={saving} style={{ flex: 1.4 }} />
      </View>
    </View>
  )
}
