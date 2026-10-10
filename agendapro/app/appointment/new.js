// Novo agendamento (ou editar, com ?id=). Outras telas abrem pré-preenchido:
//   ?client_id=&date=YYYY-MM-DD&time=HH:MM&service_id=&staff_id=
//   ?client_name=&client_whatsapp=  pessoa ainda sem ficha (lista de espera) → cliente nova preenchida
//   ?repeat=<id>  copia cliente, serviço, preço e duração de um agendamento
// Mostra os horários livres do dia, avisa de conflito e pergunta se encaixa.
import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useApp } from '../../lib/session'
import { api, post } from '../../lib/api'
import { showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { PUBLIC_PAGE } from '../../lib/config'
import { firstName, messageLang, msgDate, msgTime, openWhatsApp, renderTemplate } from '../../lib/whatsapp'
import { addToCalendar } from '../../lib/calendar'
import {
  centsToInput, fmtDay, fmtDuration, fmtMoney, fmtPhone, hhmmOf, keyOf, parseMoney, phoneDigits, todayKey, toWallIso, weekdayOf,
} from '../../lib/format'
import { colors, radius, spacing, type } from '../../lib/theme'
import { Avatar, Banner, Button, Card, Chip, Divider, ErrorBox, Input, Loading, Muted, Screen, Section, ToggleRow } from '../../components/ui'
import { DateField, TimeField } from '../../components/pickers'
import Locked from '../../components/Locked'

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DURATIONS = [30, 45, 60, 90, 120, 180]
const pad = (n) => String(n).padStart(2, '0')

// ── Horários ────────────────────────────────────────────────────────────────
const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
const live = (a) => a.status !== 'canceled' && a.status !== 'no_show'
const validKey = (k) => KEY_RE.test(String(k || ''))

/** '9:30' → '09:30'; inválido → null. */
function normTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${pad(Number(m[1]))}:${m[2]}`
}

function busyOf(apts, blocks = []) {
  const out = []
  for (const a of apts) {
    if (!live(a)) continue
    const s = toMin(hhmmOf(a.scheduled_for))
    out.push([s, Math.min(s + (Number(a.duration_min) || 0), 1440), a])
  }
  for (const b of blocks) out.push([toMin(b.start), toMin(b.end) || 1440, null])
  return out.sort((x, y) => x[0] - y[0])
}

/** Inícios livres (de 30 em 30 min) que cabem a duração dentro do horário de atendimento. */
function freeStarts(windows, busy, duration, { step = 30, from = 0, max = 12 } = {}) {
  const out = []
  const dur = Math.max(5, Number(duration) || 60)
  const ws = [...windows].sort((x, y) => toMin(x.start_time) - toMin(y.start_time))
  for (const w of ws) {
    const end = toMin(w.end_time)
    for (let t = toMin(w.start_time); t + dur <= end; t += step) {
      if (t < from) continue
      if (busy.some(([s, e]) => s < t + dur && e > t)) continue
      out.push(toHHMM(t))
      if (out.length >= max) return out
    }
  }
  return out
}

function normBlocked(r) {
  if (!r) return []
  const list = Array.isArray(r) ? r : (r.blocks || r.blocked || r.blocked_dates || r.dates || [])
  return Array.isArray(list) ? list : []
}

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

const pickClient = (c) => ({ id: c.id || null, name: c.name || '', whatsapp: c.whatsapp || null, email: c.email || null, language: c.language || null })

// ── Tela ────────────────────────────────────────────────────────────────────
export default function NewAppointment() {
  const params = useLocalSearchParams()
  const editId = params.id ? String(params.id) : null
  return (
    <>
      <Stack.Screen options={{ title: editId ? 'Editar agendamento' : 'Novo agendamento' }} />
      <Locked feature="agenda">
        <Form params={params} editId={editId} />
      </Locked>
    </>
  )
}

function Form({ params, editId }) {
  const app = useApp()
  const { provider, settings, can } = app
  const repeatId = !editId && params.repeat ? String(params.repeat) : null
  const canTeam = can('team')
  const cleaning = provider?.vertical === 'cleaning'

  const [ready, setReady] = useState(false)
  const [loadErr, setLoadErr] = useState(null)
  const [orig, setOrig] = useState(null)

  const [client, setClient] = useState(null)
  const [clientMode, setClientMode] = useState('search')     // 'search' | 'new' | 'picked'
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [recent, setRecent] = useState([])
  const [nc, setNc] = useState({ name: '', whatsapp: '', email: '' })
  const searchId = useRef(0)

  const [services, setServices] = useState([])
  const [serviceId, setServiceId] = useState(null)
  const [custom, setCustom] = useState(false)
  const [label, setLabel] = useState('')

  const [date, setDate] = useState(validKey(params.date) ? String(params.date) : todayKey())
  const [time, setTime] = useState(normTime(params.time) || '')
  const [duration, setDuration] = useState('60')
  const [price, setPrice] = useState('')
  const [depositCents, setDepositCents] = useState(0)
  const [staff, setStaff] = useState([])
  const [staffId, setStaffId] = useState(params.staff_id ? String(params.staff_id) : null)
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(true)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const [dayApts, setDayApts] = useState([])
  const [hours, setHours] = useState(null)
  const [blocked, setBlocked] = useState([])

  function applyService(s) {
    setServiceId(s.id)
    setCustom(false)
    setDuration(String(s.duration_min || 60))
    setPrice(centsToInput(s.price_cents || 0))
    setDepositCents(s.deposit_cents || 0)
    setErrors((e) => ({ ...e, service: null }))
  }

  // ── Carga inicial ──────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [svc, st, hr, blk] = await Promise.all([
          api('/api/agenda/services?mine=1').then((r) => r.services || []).catch(() => []),
          // 402 (sem plano de equipe) ou 404 = sem equipe
          canTeam ? api('/api/agenda/staff').then((r) => (r.staff || []).filter((x) => x.active !== false)).catch(() => []) : Promise.resolve([]),
          api('/api/agenda/hours').then((r) => r.hours || []).catch(() => null),
          api('/api/agenda/blocked').then(normBlocked).catch(() => []),
        ])
        if (!alive) return
        setServices(svc)
        setStaff(st)
        setHours(hr)
        setBlocked(blk)
        if (!st.length) setStaffId(null)
        const activeSvc = svc.filter((x) => x.active !== false)

        const src = editId || repeatId
        if (src) {
          const r = await api(`/api/agenda/appointments?id=${encodeURIComponent(src)}`)
          if (!alive) return
          const a = r.appointment
          if (editId) setOrig(a)
          if (r.client) { setClient(pickClient(r.client)); setClientMode('picked') }
          else if (a.client_name) {
            setClient({ id: null, name: a.client_name, whatsapp: a.client_whatsapp, email: a.client_email, language: null })
            setClientMode('picked')
          }
          if (a.service_id && svc.some((x) => x.id === a.service_id)) { setServiceId(a.service_id); setCustom(false) }
          else { setCustom(true); setLabel(a.service_label || a.service_name || (a.external_uid ? 'Turnover' : '')) }
          setDuration(String(a.duration_min || 60))
          setPrice(centsToInput(a.total_cents || 0))
          setDepositCents(editId ? (a.deposit_cents || 0) : (svc.find((x) => x.id === a.service_id)?.deposit_cents || 0))
          if (a.staff_id && st.some((x) => x.id === a.staff_id)) setStaffId(a.staff_id)
          if (editId) {
            setDate(keyOf(a.scheduled_for))
            setTime(hhmmOf(a.scheduled_for))
            setNotes(a.internal_notes || '')
            setConfirmed(a.status !== 'pending')
          }
        } else {
          let picked = false
          if (params.client_id) {
            const r = await api(`/api/agenda/clients?id=${encodeURIComponent(String(params.client_id))}`).catch(() => null)
            if (!alive) return
            if (r?.client) { setClient(pickClient(r.client)); setClientMode('picked'); picked = true }
          }
          // Sem ficha (ex.: lista de espera): já abre "Cliente nova" com nome e WhatsApp
          if (!picked && (params.client_name || params.client_whatsapp)) {
            setNc({
              name: params.client_name ? String(params.client_name).slice(0, 120) : '',
              whatsapp: params.client_whatsapp ? fmtPhone(String(params.client_whatsapp)).slice(0, 25) : '',
              email: '',
            })
            setClientMode('new')
          }
          const fromParam = params.service_id ? svc.find((x) => x.id === String(params.service_id)) : null
          if (fromParam) applyService(fromParam)
          else if (activeSvc.length === 1) applyService(activeSvc[0])
          else if (!activeSvc.length) setCustom(true)
        }
        setReady(true)
      } catch (e) {
        if (alive) { setLoadErr(e); setReady(true) }
      }
    })()
    return () => { alive = false }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Busca de cliente (300 ms depois de parar de digitar) ───────────────
  useEffect(() => {
    if (clientMode !== 'search') return undefined
    const term = q.trim()
    if (term.length < 2) { setResults([]); setSearching(false); return undefined }
    setSearching(true)
    const my = ++searchId.current
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/agenda/clients?q=${encodeURIComponent(term)}&limit=8`)
        if (my === searchId.current) setResults((r.clients || []).slice(0, 8))
      } catch (_) {
        if (my === searchId.current) setResults([])
      } finally {
        if (my === searchId.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q, clientMode])

  // Clientes recentes pra escolher em 1 toque
  useEffect(() => {
    if (!ready || clientMode !== 'search' || recent.length) return
    api('/api/agenda/clients?limit=6').then((r) => setRecent((r.clients || []).slice(0, 6))).catch(() => {})
  }, [ready, clientMode])   // eslint-disable-line react-hooks/exhaustive-deps

  // Agenda do dia escolhido (horários livres e conflito)
  useEffect(() => {
    if (!validKey(date)) { setDayApts([]); return undefined }
    let alive = true
    api(`/api/agenda/appointments?scope=range&from=${date}&to=${date}`)
      .then((r) => { if (alive) setDayApts(r.appointments || []) })
      .catch(() => { if (alive) setDayApts([]) })
    return () => { alive = false }
  }, [date])

  // ── Derivados ──────────────────────────────────────────────────────────
  const dur = Math.round(Number(duration)) || 0
  const t = normTime(time)
  const others = dayApts.filter((a) => a.id !== orig?.id && (!staffId || !a.staff_id || a.staff_id === staffId))
  const dayBlock = validKey(date) ? blocksForDay(blocked, date) : { full: null, partial: [] }
  const windows = validKey(date) ? (hours || []).filter((h) => Number(h.day_of_week) === weekdayOf(date)) : []
  const busy = busyOf(others, dayBlock.partial)
  const slots = useMemo(() => {
    if (!validKey(date) || dayBlock.full || !windows.length || date < todayKey()) return []
    const n = new Date()
    const from = date === todayKey() ? Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15 : 0
    return freeStarts(windows, busy, dur || 60, { from })
  }, [date, dayApts, blocked, hours, dur, staffId, orig?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const overlaps = ([st, en]) => st < toMin(t) + dur && en > toMin(t)
  const clash = t && dur ? busy.find((b) => b[2] && overlaps(b)) : null
  const blockClash = t && dur && !clash ? dayBlock.partial.find((b) => overlaps([toMin(b.start), toMin(b.end)])) : null
  const outside = t && dur && hours && hours.length && !dayBlock.full
    ? !windows.some((w) => toMin(t) >= toMin(w.start_time) && toMin(t) + dur <= toMin(w.end_time))
    : false
  const selectedService = services.find((x) => x.id === serviceId) || null
  const shownServices = services.filter((x) => x.active !== false || x.id === serviceId)
  const showConfirmToggle = !orig || orig.status === 'pending'

  // ── Salvar ─────────────────────────────────────────────────────────────
  async function withConflict(fn) {
    try {
      return { res: await fn(false), allowed: false }
    } catch (e) {
      if (e?.status === 409 && e?.code === 'conflict') {
        const ok = await confirm('Horário ocupado', `${e.message}\n\nEncaixar mesmo assim?`, { ok: 'Encaixar', cancel: 'Voltar' })
        return ok ? { res: await fn(true), allowed: true } : null
      }
      throw e
    }
  }

  function validate() {
    const err = {}
    if (clientMode === 'new') {
      if (nc.name.trim().length < 2) err.name = 'Escreva o nome da cliente'
      const d = phoneDigits(nc.whatsapp)
      if (nc.whatsapp.trim() && d.length < 11) err.whatsapp = 'WhatsApp com código de área. Ex.: (512) 555-0101'
      if (nc.email.trim() && !EMAIL_RE.test(nc.email.trim())) err.email = 'E-mail inválido'
    } else if (clientMode !== 'picked' || !client) {
      err.client = 'Escolha a cliente ou cadastre uma nova'
    }
    if (custom && !label.trim()) err.label = 'Escreva o nome do serviço'
    if (!custom && !serviceId) err.service = 'Escolha o serviço'
    if (!validKey(date)) err.date = 'Escolha o dia'
    if (!t) err.time = 'Escolha o horário'
    if (!(dur >= 5 && dur <= 720)) err.duration = 'Entre 5 e 720 minutos'
    if (price.trim() && parseMoney(price) == null) err.price = 'Valor inválido. Ex.: 45 ou 45.50'
    return err
  }

  function clientBody() {
    if (clientMode === 'new') {
      return { client_name: nc.name.trim(), client_whatsapp: nc.whatsapp.trim(), client_email: nc.email.trim().toLowerCase() }
    }
    if (client?.id) return { client_id: client.id }
    return { client_name: client?.name || '', client_whatsapp: client?.whatsapp || '', client_email: client?.email || '' }
  }

  async function save() {
    const err = validate()
    setErrors(err)
    const first = Object.values(err).find(Boolean)
    if (first) { notify('Falta pouco', first); return }

    const scheduled = toWallIso(date, t)
    const cents = price.trim() ? parseMoney(price) : 0
    const serviceBody = custom ? { service_id: null, service_label: label.trim() } : { service_id: serviceId }
    const staffBody = staff.length ? { staff_id: staffId || null } : {}
    setSaving(true)
    try {
      if (orig) await saveEdit({ scheduled, cents, serviceBody, staffBody })
      else await saveNew({ scheduled, cents, staffBody })
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  async function saveNew({ scheduled, cents, staffBody }) {
    const body = {
      action: 'create',
      ...clientBody(),
      ...(custom ? { service_label: label.trim() } : { service_id: serviceId }),
      scheduled_for: scheduled,
      duration_min: dur,
      total_cents: cents,
      ...(custom ? { deposit_cents: 0 } : {}),
      ...(staffBody.staff_id ? { staff_id: staffBody.staff_id } : {}),
      status: confirmed ? 'confirmed' : 'pending',
      internal_notes: notes.trim() || null,
    }
    const out = await withConflict((allow) => post('/api/agenda/appointments', { ...body, ...(allow ? { allow_conflict: true } : {}) }))
    if (!out) return
    const created = out.res.appointment
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    if (settings.calendar_sync && can('calendar_sync') && Platform.OS !== 'web') addToCalendar(created, provider).catch(() => {})

    // Já manda a confirmação (ou o pedido do sinal) pra cliente.
    // blocked = o servidor viu folga nesse horário (só aviso, já está salvo)
    const blocked = !!out.res.blocked
    const phone = created?.client_whatsapp
    if (phone && can('whatsapp_templates')) {
      const askDeposit = created.status === 'pending' && created.deposit_cents > 0
      const ask = askDeposit ? 'Mandar o pedido do sinal pra cliente no WhatsApp?' : 'Mandar a confirmação pra cliente no WhatsApp?'
      const ok = await confirm(blocked ? 'Esse horário cai numa folga' : 'Agendado!', blocked ? `Agendamos assim mesmo.\n\n${ask}` : ask, { ok: 'Mandar', cancel: 'Agora não' })
      if (ok) {
        const lang = messageLang((clientMode === 'picked' && client?.language) || settings.default_language || 'pt', can('multilang_messages'))
        openWhatsApp(phone, renderTemplate(askDeposit ? 'deposit' : 'confirm', lang, {
          nome: firstName(created.client_name),
          data: msgDate(created.scheduled_for, lang),
          hora: msgTime(created.scheduled_for, lang),
          servico: created.service_name || created.service_label || '',
          profissional: provider?.name || '',
          valor: fmtMoney(created.deposit_cents),
          link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
        }, settings))
      }
    } else if (blocked) {
      notify('Esse horário cai numa folga', 'Agendamos assim mesmo. Se a folga mudou, ajuste em Folgas.')
    }
    router.replace(`/appointment/${created.id}`)
  }

  async function saveEdit({ scheduled, cents, serviceBody, staffBody }) {
    // Compara o instante, não o texto ('...+00:00' do banco x '...000Z' do toWallIso).
    // Só remarca (zera lembretes, traz cancelado de volta) se o dia ou a hora mudarem.
    const slotChanged = Date.parse(scheduled) !== Date.parse(orig.scheduled_for)
    const durChanged = dur !== Number(orig.duration_min)
    const staffChanged = staff.length && (staffId || null) !== (orig.staff_id || null)
    let allowed = false
    let blocked = false
    if (slotChanged) {
      const out = await withConflict((allow) => post('/api/agenda/appointments', {
        action: 'reschedule', id: orig.id, scheduled_for: scheduled, duration_min: dur,
        ...(staffChanged ? staffBody : {}), ...(allow ? { allow_conflict: true } : {}),
      }))
      if (!out) return
      allowed = out.allowed
      blocked = !!out.res?.blocked
    }

    const upd = { action: 'update', id: orig.id, internal_notes: notes.trim() || null, total_cents: cents }
    if (custom) {
      if (orig.service_id || (orig.service_label || '') !== label.trim()) Object.assign(upd, serviceBody)
    } else if (serviceId !== orig.service_id) Object.assign(upd, serviceBody)
    // Só a duração mudou: vai no update (o servidor confere conflito só se estiver ativo)
    if (!slotChanged && durChanged) upd.duration_min = dur
    if (!slotChanged && staffChanged) Object.assign(upd, staffBody)
    // Cliente nova: o servidor acha a ficha pelo WhatsApp/e-mail ou cria (só o nome = sem ficha)
    if (clientMode === 'new') Object.assign(upd, clientBody())
    else if (client?.id && client.id !== orig.client_id) upd.client_id = client.id
    else if (!client?.id && client && (client.name !== orig.client_name || (client.whatsapp || null) !== (orig.client_whatsapp || null))) {
      Object.assign(upd, clientBody())
    }
    const out = await withConflict((allow) => post('/api/agenda/appointments', { ...upd, ...((allow || allowed) ? { allow_conflict: true } : {}) }))
    if (!out) return
    if (orig.status === 'pending' && confirmed) {
      await post('/api/agenda/appointments', { action: 'confirm', id: orig.id })
    }
    if (settings.calendar_sync && can('calendar_sync') && Platform.OS !== 'web' && out.res?.appointment) addToCalendar(out.res.appointment, provider).catch(() => {})
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    if (blocked) notify('Esse horário cai numa folga', 'Salvamos o novo horário assim mesmo. Se a folga mudou, ajuste em Folgas.')
    router.back()
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (!ready) return <Screen><Loading /></Screen>
  if (loadErr && (editId || repeatId)) {
    return (
      <Screen>
        <ErrorBox error={loadErr} />
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </Screen>
    )
  }

  const footer = (
    <Button title={orig ? 'Salvar alterações' : 'Agendar'} icon={orig ? 'checkmark' : 'calendar'} loading={saving} onPress={save} />
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <Screen footer={footer}>
        {/* Cliente */}
        <Section title="Cliente" style={{ marginTop: 0 }}>
          {clientMode === 'picked' && client ? (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar name={client.name} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.body, { fontWeight: '600' }]} numberOfLines={1}>{client.name}</Text>
                <Muted numberOfLines={1}>{[client.whatsapp ? fmtPhone(client.whatsapp) : 'Sem WhatsApp', client.id ? null : 'sem ficha'].filter(Boolean).join(' · ')}</Muted>
              </View>
              <Button small full={false} variant="secondary" title="Trocar" onPress={() => { setClientMode('search'); setQ('') }} />
            </Card>
          ) : clientMode === 'new' ? (
            <Card>
              <Input label="Nome" value={nc.name} onChangeText={(v) => setNc((c) => ({ ...c, name: v }))} placeholder="Nome e sobrenome" autoCapitalize="words" maxLength={120} error={errors.name} />
              <Input label="WhatsApp" value={nc.whatsapp} onChangeText={(v) => setNc((c) => ({ ...c, whatsapp: v }))} placeholder="(512) 555-0101" keyboardType="phone-pad" maxLength={25} error={errors.whatsapp}
                hint="Se esse número já estiver na sua lista, usamos a mesma ficha." />
              <Input label="E-mail (opcional)" value={nc.email} onChangeText={(v) => setNc((c) => ({ ...c, email: v }))} placeholder="cliente@email.com" keyboardType="email-address" autoCapitalize="none" maxLength={254} error={errors.email}
                hint="Com e-mail, ela recebe a confirmação e o lembrete automáticos." style={{ marginBottom: spacing.sm }} />
              <Button small variant="ghost" title="Buscar na minha lista" icon="search" onPress={() => setClientMode('search')} />
            </Card>
          ) : (
            <>
              <Input value={q} onChangeText={setQ} placeholder="Buscar por nome, telefone ou e-mail" autoCapitalize="none" autoCorrect={false} error={errors.client}
                right={searching ? <Loading style={{ padding: 0, paddingRight: spacing.md }} /> : <Ionicons name="search" size={18} color={colors.inkMuted} style={{ marginRight: spacing.md }} />}
                style={{ marginBottom: spacing.sm }} />
              {(q.trim().length >= 2 ? results : recent).length ? (
                <Card padded={false} style={{ marginBottom: spacing.sm }}>
                  {q.trim().length < 2 ? <Muted style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>Recentes</Muted> : null}
                  {(q.trim().length >= 2 ? results : recent).map((c, i) => (
                    <View key={c.id}>
                      {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 64 }} /> : null}
                      <Pressable onPress={() => { setClient(pickClient(c)); setClientMode('picked'); setErrors((e) => ({ ...e, client: null })) }}
                        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.paperSoft }]}>
                        <Avatar name={c.name} size={36} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[type.body, { fontWeight: '500' }]} numberOfLines={1}>{c.name}</Text>
                          <Muted numberOfLines={1}>{[c.whatsapp ? fmtPhone(c.whatsapp) : null, c.total_visits ? `${c.total_visits} visita${c.total_visits > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || 'Sem telefone'}</Muted>
                        </View>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              ) : q.trim().length >= 2 && !searching ? (
                <Muted style={{ marginBottom: spacing.sm, marginLeft: 2 }}>Ninguém com “{q.trim()}” na sua lista.</Muted>
              ) : null}
              <Button variant="secondary" icon="person-add-outline" title={q.trim().length >= 2 && !results.length ? `Cadastrar “${q.trim()}”` : 'Cliente nova'}
                onPress={() => {
                  const term = q.trim()
                  const isPhone = term && phoneDigits(term).length >= 7 && !/[a-z]/i.test(term)
                  setNc({ name: isPhone ? '' : term, whatsapp: isPhone ? term : '', email: '' })
                  setClientMode('new')
                  setErrors((e) => ({ ...e, client: null }))
                }} />
            </>
          )}
        </Section>

        {/* Serviço */}
        <Section title="Serviço">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {shownServices.map((sv) => (
              <Chip key={sv.id} label={`${sv.name} · ${fmtMoney(sv.price_cents || 0)}`} selected={!custom && serviceId === sv.id} onPress={() => applyService(sv)} />
            ))}
            <Chip label={cleaning ? 'Outra limpeza' : 'Avulso'} icon="create-outline" selected={custom}
              onPress={() => { setCustom(true); setServiceId(null); setDepositCents(0); setErrors((e) => ({ ...e, service: null })) }} />
          </View>
          {errors.service ? <Text style={s.err}>{errors.service}</Text> : null}
          {!shownServices.length ? (
            <Pressable onPress={() => router.push('/services/edit')} style={{ marginBottom: spacing.sm }}>
              <Muted>Você ainda não cadastrou serviços. <Text style={{ color: colors.green, fontWeight: '600' }}>Cadastrar agora</Text></Muted>
            </Pressable>
          ) : null}
          {custom ? (
            <Input label="Nome do serviço" value={label} onChangeText={setLabel} placeholder={cleaning ? 'Ex.: Limpeza pesada, mudança' : 'Ex.: Escova + hidratação'} maxLength={120} error={errors.label} style={{ marginTop: spacing.sm }} />
          ) : null}
        </Section>

        {/* Quando */}
        <Section title="Quando">
          <DateField label="Dia" value={date} onChange={(v) => { setDate(v); setErrors((e) => ({ ...e, date: null })) }} />
          {errors.date ? <Text style={s.err}>{errors.date}</Text> : null}
          {dayBlock.full ? (
            <Banner tone="orange" icon="lock-closed-outline" text={`Você bloqueou esse dia${dayBlock.full.reason ? ` (${dayBlock.full.reason})` : ''}. Dá pra marcar assim mesmo.`} />
          ) : null}
          <TimeField label="Horário" value={time} onChange={(v) => { setTime(v); setErrors((e) => ({ ...e, time: null })) }} />
          {errors.time ? <Text style={s.err}>{errors.time}</Text> : null}

          {slots.length ? (
            <View style={{ marginBottom: spacing.md }}>
              <Muted style={{ marginBottom: spacing.sm }}>Horários livres pra {fmtDuration(dur || 60)}:</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {slots.map((sl) => <Chip key={sl} label={sl} selected={t === sl} onPress={() => { setTime(sl); setErrors((e) => ({ ...e, time: null })) }} />)}
              </ScrollView>
            </View>
          ) : validKey(date) && hours && !hours.length ? (
            <Pressable onPress={() => router.push('/hours')} style={{ marginBottom: spacing.md }}>
              <Muted>Cadastre seu horário de atendimento pra ver aqui os horários livres. <Text style={{ color: colors.green, fontWeight: '600' }}>Definir</Text></Muted>
            </Pressable>
          ) : null}

          {clash ? (
            <Banner tone="orange" icon="alert-circle-outline"
              text={`Bate com ${clash[2].client_name || 'outro agendamento'} (${hhmmOf(clash[2].scheduled_for)}–${toHHMM(clash[1])}).`} />
          ) : blockClash ? (
            <Banner tone="orange" icon="lock-closed-outline" text={`Esse horário está bloqueado (${blockClash.start}–${blockClash.end}${blockClash.reason ? ', ' + blockClash.reason : ''}).`} />
          ) : outside ? (
            <Muted style={{ marginBottom: spacing.md }}>Fora do seu horário de atendimento. Tudo bem, dá pra marcar assim mesmo.</Muted>
          ) : null}

          {others.filter(live).length ? (
            <View style={{ marginBottom: spacing.sm }}>
              <Muted style={{ marginBottom: 4 }}>Já marcados em {fmtDay(date)}:</Muted>
              {others.filter(live).slice(0, 8).map((a) => (
                <Muted key={a.id} numberOfLines={1} style={{ marginLeft: spacing.sm }}>
                  • {hhmmOf(a.scheduled_for)}–{toHHMM(toMin(hhmmOf(a.scheduled_for)) + (Number(a.duration_min) || 0))} {a.external_uid ? (a.feed_label || 'Turnover') : a.client_name}{a.staff_name ? ` (${a.staff_name})` : ''}
                </Muted>
              ))}
            </View>
          ) : null}
        </Section>

        {/* Duração e valor */}
        <Section title="Duração e valor">
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Input label="Duração (min)" value={duration} keyboardType="number-pad" error={errors.duration} style={{ flex: 1 }}
              onChangeText={(v) => { setDuration(v.replace(/\D/g, '').slice(0, 3)); setErrors((e) => ({ ...e, duration: null })) }} />
            <Input label="Preço ($)" value={price} keyboardType="decimal-pad" placeholder="0" error={errors.price} style={{ flex: 1 }}
              onChangeText={(v) => { setPrice(v); setErrors((e) => ({ ...e, price: null })) }} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: -spacing.sm }}>
            {DURATIONS.map((d) => <Chip key={d} label={fmtDuration(d)} selected={dur === d} onPress={() => setDuration(String(d))} />)}
          </View>
          {selectedService && !custom && (Number(duration) !== selectedService.duration_min || parseMoney(price) !== selectedService.price_cents) ? (
            <Pressable onPress={() => applyService(selectedService)}>
              <Muted>Padrão do serviço: {fmtDuration(selectedService.duration_min)} · {fmtMoney(selectedService.price_cents)}. <Text style={{ color: colors.green, fontWeight: '600' }}>Usar padrão</Text></Muted>
            </Pressable>
          ) : null}
        </Section>

        {/* Equipe */}
        {staff.length ? (
          <Section title={cleaning ? 'Equipe' : 'Quem atende'}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <StaffChip label="Eu / sem definir" selected={!staffId} onPress={() => setStaffId(null)} />
              {staff.map((st) => <StaffChip key={st.id} label={st.name} color={st.color} selected={staffId === st.id} onPress={() => setStaffId(st.id)} />)}
            </View>
          </Section>
        ) : null}

        {/* Confirmação e anotação */}
        <Section title="Detalhes">
          <Card padded={false}>
            {showConfirmToggle ? (
              <ToggleRow title="Já está confirmado"
                subtitle={confirmed ? 'Entra na agenda como confirmado.'
                  : depositCents > 0 ? `Fica "Aguardando sinal" (${fmtMoney(depositCents)}) até você confirmar.` : 'Fica aguardando até você confirmar.'}
                value={confirmed} onValueChange={setConfirmed} />
            ) : (
              <View style={{ padding: spacing.lg }}><Muted>Status atual: {orig?.status === 'completed' ? 'realizado' : orig?.status === 'canceled' ? 'cancelado' : orig?.status === 'no_show' ? 'faltou' : 'confirmado'}. Mude o status na tela do agendamento.</Muted></View>
            )}
          </Card>
          <Input label="Anotação interna (só você vê)" value={notes} onChangeText={setNotes} multiline maxLength={2000}
            placeholder="Ex.: trazer a cor 7.1, cliente prefere água sem gás" style={{ marginTop: spacing.lg }} />
        </Section>

        {orig ? (
          <Muted style={{ textAlign: 'center' }}>Mudou o horário? O lembrete automático vai de novo pro novo horário.</Muted>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
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
  err: { color: colors.danger, fontSize: 13, marginTop: -spacing.sm, marginBottom: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, marginRight: 8, marginBottom: 8 },
}
