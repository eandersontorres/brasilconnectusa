// Detalhe do agendamento: tudo sobre o horário e as ações do dia a dia —
// confirmar, sinal, realizado, faltou, cancelar, remarcar, pagamento e gorjeta,
// anotação interna — mais WhatsApp com mensagens prontas, ligar, SMS, mapa,
// calendário do celular, recibo, avaliação, repetir e tornar cliente fixa.
import { useCallback, useRef, useState } from 'react'
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useApp } from '../../lib/session'
import { api, post } from '../../lib/api'
import { ensureFeature, featureInfo, showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { PUBLIC_PAGE } from '../../lib/config'
import {
  DEFAULT_TEMPLATES, LANGS, callPhone, fillTemplate, firstName, messageLang, msgDate, msgTime, openWhatsApp, renderTemplate, sendSms,
} from '../../lib/whatsapp'
import { addToCalendar, calendarError, removeFromCalendar } from '../../lib/calendar'
import {
  MONTHS_LONG, WEEKDAYS_LONG, centsToInput, fmtAgo, fmtDay, fmtDuration, fmtMoney, fmtPhone, fmtRelativeDay, fmtTime, hhmmOf, keyOf, parseMoney, todayKey, toWallIso,
} from '../../lib/format'
import { colors, radius, spacing, type } from '../../lib/theme'
import {
  Avatar, Badge, Button, Card, Chip, Divider, Empty, ErrorBox, H3, Input, Label, Loading, Muted, Row, Screen, Section, StatusBadge, ToggleRow,
} from '../../components/ui'
import { DateField, TimeField } from '../../components/pickers'

const ACTIVE = ['pending', 'confirmed']
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const METHODS = [
  { value: 'zelle', label: 'Zelle' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'card', label: 'Cartão' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'cashapp', label: 'Cash App' },
  { value: 'check', label: 'Cheque' },
  { value: 'other', label: 'Outro' },
]
const METHOD_LABEL = { ...Object.fromEntries(METHODS.map((m) => [m.value, m.label])), stripe: 'Cartão (online)', free: 'Sem custo' }
const PAY_TYPE = { deposit: 'Sinal', service: 'Serviço', tip: 'Gorjeta' }
const SOURCES = {
  online: { label: 'Pelo seu link', icon: 'globe-outline' },
  manual: { label: 'Marcado por você', icon: 'create-outline' },
  recurring: { label: 'Cliente fixa', icon: 'repeat-outline' },
  ical: { label: 'Turnover', icon: 'home-outline' },
}
const FEED_NAMES = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking: 'Booking', outro: 'Calendário' }
const MSG_KEYS = ['confirm', 'reminder', 'on_the_way', 'late', 'deposit', 'review', 'thanks']
const MSG_ICONS = { confirm: 'checkmark-circle-outline', reminder: 'alarm-outline', on_the_way: 'car-outline', late: 'hourglass-outline', deposit: 'wallet-outline', review: 'star-outline', thanks: 'heart-outline' }
const CANCEL_REASONS = ['A cliente desmarcou', 'Eu precisei desmarcar', 'Não pagou o sinal', 'Outro motivo']
// Aviso de cancelamento (não é modelo editável: só aparece depois de cancelar)
const CANCEL_MSG = {
  pt: 'Oi {nome}, seu horário de {data} às {hora} foi cancelado. Se quiser remarcar, é só me responder aqui. {profissional}',
  en: 'Hi {nome}, your appointment on {data} at {hora} has been canceled. If you would like to reschedule, just reply here. {profissional}',
  es: 'Hola {nome}, tu cita del {data} a las {hora} fue cancelada. Si quieres reprogramarla, respóndeme por aquí. {profissional}',
}

const pad = (n) => String(n).padStart(2, '0')
const endTime = (a) => hhmmOf(new Date(Date.parse(a.scheduled_for) + (Number(a.duration_min) || 0) * 60e3).toISOString())
function longDay(iso) {
  const d = new Date(keyOf(iso) + 'T12:00:00Z')
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}`
}
/** '9:30' → '09:30'; inválido → null. */
function normTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${pad(Number(m[1]))}:${m[2]}`
}
const haptic = () => {
  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

export default function AppointmentScreen() {
  const { id } = useLocalSearchParams()
  const app = useApp()
  const { provider, settings, can } = app

  const [apt, setApt] = useState(null)
  const [client, setClient] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [panel, setPanel] = useState(null)      // 'pay' | 'reschedule' | 'cancel'
  const [sheet, setSheet] = useState(null)      // 'whatsapp' | 'deposit'
  const [msgLang, setMsgLang] = useState('pt')
  const [pay, setPay] = useState({ amount: '', tip: '', method: 'zelle', complete: false })
  const [payErr, setPayErr] = useState({})
  const [rs, setRs] = useState({ date: '', time: '', duration: '' })
  const [rsErr, setRsErr] = useState({})
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0])
  const [cancelText, setCancelText] = useState('')
  const [notes, setNotes] = useState('')
  const notesDirty = useRef(false)
  const loadedOnce = useRef(false)

  const load = useCallback(async (kind = 'initial') => {
    if (!id) return
    if (kind === 'refresh') setRefreshing(true)
    try {
      const r = await api(`/api/agenda/appointments?id=${encodeURIComponent(String(id))}`)
      setApt(r.appointment || null)
      setClient(r.client || null)
      setPayments(r.payments || [])
      if (!notesDirty.current) setNotes(r.appointment?.internal_notes || '')
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useFocusEffect(useCallback(() => {
    load(loadedOnce.current ? 'silent' : 'initial')
    loadedOnce.current = true
  }, [load]))

  // ── Estados de carregamento ────────────────────────────────────────────
  if (loading && !apt) {
    return <Screen><Stack.Screen options={{ title: 'Agendamento' }} /><Loading /></Screen>
  }
  if (!apt) {
    const notFound = error?.status === 404
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Agendamento' }} />
        {notFound ? (
          <Empty icon="calendar-clear-outline" title="Agendamento não encontrado" text="Ele pode ter sido apagado ou é de outra conta."
            action={<Button title="Voltar" variant="secondary" onPress={() => router.back()} />} />
        ) : <ErrorBox error={error || 'Não deu pra abrir o agendamento.'} onRetry={() => load('refresh')} />}
      </Screen>
    )
  }

  // ── Dados derivados ────────────────────────────────────────────────────
  const a = apt
  const turnover = !!a.external_uid
  const active = ACTIVE.includes(a.status)
  const phone = a.client_whatsapp || client?.whatsapp || null
  const title = turnover ? (a.feed_label || 'Turnover') : a.client_name
  const serviceName = turnover ? 'Turnover' : (a.service_name || a.service_label || 'Atendimento')
  const depositPending = (a.deposit_cents || 0) > 0 && !a.deposit_paid
  const address = [client?.address_line, client?.city, [client?.state, client?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const canMulti = can('multilang_messages')
  const baseLang = messageLang(client?.language || settings.default_language || 'pt', canMulti)
  const isFuture = keyOf(a.scheduled_for) >= todayKey()
  const tightCheckin = turnover && a.ical_next_checkin && String(a.ical_next_checkin).slice(0, 10) === keyOf(a.scheduled_for)
  const source = SOURCES[a.source] || SOURCES.online
  const lock = (key) => (can(key) ? null : <Badge text={featureInfo(app.ent, key).minName} tone="gold" icon="lock-closed" />)

  const vars = (appt, lang, extra = {}) => ({
    nome: firstName(appt.client_name),
    data: msgDate(appt.scheduled_for, lang),
    hora: msgTime(appt.scheduled_for, lang),
    servico: appt.service_name || appt.service_label || '',
    profissional: provider?.name || '',
    valor: fmtMoney(appt.deposit_cents),
    endereco: address,
    link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
    ...extra,
  })

  // ── Chamadas ───────────────────────────────────────────────────────────
  /** Conflito de horário (409) → pergunta se encaixa e reenvia com allow_conflict. */
  async function withConflict(fn) {
    try {
      return await fn(false)
    } catch (e) {
      if (e?.status === 409 && e?.code === 'conflict') {
        const ok = await confirm('Horário ocupado', `${e.message}\n\nEncaixar mesmo assim?`, { ok: 'Encaixar', cancel: 'Voltar' })
        return ok ? fn(true) : null
      }
      throw e
    }
  }

  /** Devolve o agendamento atualizado (ou, com raw, a resposta inteira: { appointment, blocked, ... }). */
  async function run(action, extra = {}, { raw = false } = {}) {
    setBusy(action)
    try {
      const r = await withConflict((allow) => post('/api/agenda/appointments', { action, id: a.id, ...extra, ...(allow ? { allow_conflict: true } : {}) }))
      if (!r) return null
      if (r.appointment) setApt(r.appointment)
      haptic()
      load('silent')
      const up = r.appointment || a
      return raw ? { ...r, appointment: up } : up
    } catch (e) {
      showError(e)
      return null
    } finally {
      setBusy(null)
    }
  }

  const removeCal = () => { if (Platform.OS !== 'web') removeFromCalendar(a.id).catch(() => {}) }

  // ── WhatsApp ───────────────────────────────────────────────────────────
  function openMessages() {
    if (!phone) return
    if (!can('whatsapp_templates')) { openWhatsApp(phone, ''); return }
    setMsgLang(baseLang)
    setSheet('whatsapp')
  }

  async function pickLang(l) {
    if (l !== 'pt' && !canMulti) {
      setSheet(null)
      await ensureFeature(app, 'multilang_messages')
      return
    }
    setMsgLang(l)
  }

  /**
   * Link de avaliação: POST /api/agenda/request-review →
   * { review_url, whatsapp_url, message, language, expires_at } (message já vem no idioma da
   * cliente, com o modelo da profissional e o link). Erro ou já avaliado → null.
   */
  async function requestReview() {
    if (!(await ensureFeature(app, 'reviews'))) return null
    if (a.status !== 'completed') {
      notify('Ainda não', 'Peça a avaliação depois de marcar o atendimento como realizado.')
      return null
    }
    setBusy('review')
    try {
      const r = await post('/api/agenda/request-review', { appointment_id: a.id })
      setApt((cur) => (cur ? { ...cur, review_requested: true } : cur))
      if (!r?.review_url) { notify('Não deu certo', 'Tente de novo em instantes.'); return null }
      return r
    } catch (e) {
      if (e?.status === 409 && e?.code === 'already_reviewed') notify('Essa cliente já avaliou', 'A avaliação desse atendimento já chegou. Não precisa pedir de novo.')
      else showError(e)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function sendTpl(key, { lang = msgLang, appt = a } = {}) {
    setSheet(null)
    if (key === 'review') {
      const r = await requestReview()
      if (!r) return
      // Mesmo idioma da resposta: usa o texto pronto do servidor
      if (r.message && r.language === lang) { openWhatsApp(phone, r.message); return }
      const text = renderTemplate(key, lang, vars(appt, lang, { link: r.review_url }), settings)
      openWhatsApp(phone, text.includes(r.review_url) ? text : `${text} ${r.review_url}`)
      return
    }
    openWhatsApp(phone, renderTemplate(key, lang, vars(appt, lang), settings))
  }

  async function askReview() {
    const r = await requestReview()
    if (!r) return
    if (phone) {
      openWhatsApp(phone, r.message || renderTemplate('review', baseLang, vars(a, baseLang, { link: r.review_url }), settings))
    } else {
      await Clipboard.setStringAsync(r.review_url).catch(() => {})
      notify('Link copiado', 'Essa cliente não tem WhatsApp na ficha. Cole o link onde preferir.')
    }
  }

  /** Pergunta se manda a mensagem; note (opcional) vai antes da pergunta. */
  async function offerMessage(titleText, key, appt, note) {
    if (!phone || !can('whatsapp_templates')) return
    const ask = 'Mandar a mensagem pra cliente no WhatsApp?'
    const ok = await confirm(titleText, note ? `${note}\n\n${ask}` : ask, { ok: 'Mandar', cancel: 'Agora não' })
    if (ok) sendTpl(key, { lang: baseLang, appt })
  }

  // ── Lista de espera ────────────────────────────────────────────────────
  /** Quem da lista combina com o horário que abriu (POST /api/agenda/waitlist match → { entries }). */
  async function waitlistMatches(appt) {
    const r = await post('/api/agenda/waitlist', { action: 'match', date: keyOf(appt.scheduled_for), time: hhmmOf(appt.scheduled_for) })
    return r?.entries || []
  }
  const openWaitlist = (appt) => router.push({ pathname: '/waitlist', params: { date: keyOf(appt.scheduled_for), time: hhmmOf(appt.scheduled_for) } })

  async function notifyWaitlist(appt = a) {
    if (!(await ensureFeature(app, 'waitlist'))) return
    setBusy('waitlist')
    let list
    try {
      list = await waitlistMatches(appt)
    } catch (e) {
      showError(e)
      return
    } finally {
      setBusy(null)
    }
    if (list.length) { openWaitlist(appt); return }
    const ok = await confirm('Ninguém combina', 'Ninguém da lista de espera prefere esse dia e horário. Abrir a lista mesmo assim?', { ok: 'Abrir lista', cancel: 'Agora não' })
    if (ok) openWaitlist(appt)
  }

  // ── Status ─────────────────────────────────────────────────────────────
  async function doConfirm() {
    const up = await run('confirm')
    if (up) offerMessage('Confirmado!', 'confirm', up)
  }

  async function doDeposit(method) {
    setSheet(null)
    const up = await run('confirm_deposit', { method })
    if (up) offerMessage('Sinal recebido!', 'confirm', up)
  }

  async function doComplete() {
    const up = await run('complete')
    if (up && !up.paid_at && can('payments_log')) openPay(false, up)
  }

  async function doNoShow() {
    const ok = await confirm('A cliente faltou?', 'O horário fica marcado como "Faltou". Dá pra desfazer depois.', { ok: 'Faltou', destructive: true })
    if (!ok) return
    const up = await run('no_show')
    if (up) removeCal()
  }

  async function doReopen() {
    const up = await run('reopen')
    if (up && settings.calendar_sync && Platform.OS !== 'web') addToCalendar(up, provider).catch(() => {})
  }

  function openCancel() {
    setCancelReason(CANCEL_REASONS[0])
    setCancelText('')
    setPanel('cancel')
  }

  async function doCancel() {
    const other = cancelReason === 'Outro motivo'
    const reason = other ? cancelText.trim() : cancelReason
    if (other && !reason) { notify('Qual o motivo?', 'Escreva o motivo do cancelamento.'); return }
    const before = a
    const up = await run('cancel', { reason })
    if (!up) return
    setPanel(null)
    removeCal()
    if (phone && cancelReason !== 'A cliente desmarcou') {
      const ok = await confirm('Avisar a cliente?', 'Abrir o WhatsApp com uma mensagem avisando do cancelamento?', { ok: 'Avisar', cancel: 'Agora não' })
      if (ok) openWhatsApp(phone, fillTemplate(CANCEL_MSG[baseLang] || CANCEL_MSG.pt, vars(before, baseLang)))
    }
    // Só pergunta quando alguém da lista de espera combina com o horário que abriu
    if (keyOf(before.scheduled_for) >= todayKey() && can('waitlist')) {
      const list = await waitlistMatches(before).catch(() => [])
      if (list.length) {
        const n = list.length
        const ok = await confirm('Horário liberado', `${n === 1 ? '1 pessoa' : `${n} pessoas`} da lista de espera ${n === 1 ? 'combina' : 'combinam'} com esse horário. Avisar agora?`, { ok: 'Ver lista', cancel: 'Agora não' })
        if (ok) openWaitlist(before)
      }
    }
  }

  // ── Remarcar ───────────────────────────────────────────────────────────
  function openReschedule() {
    const k = keyOf(a.scheduled_for)
    setRs({ date: k >= todayKey() ? k : todayKey(), time: hhmmOf(a.scheduled_for), duration: String(a.duration_min || 60) })
    setRsErr({})
    setPanel('reschedule')
  }

  async function saveReschedule() {
    const err = {}
    const time = normTime(rs.time)
    const dur = Math.round(Number(rs.duration))
    if (!KEY_RE.test(String(rs.date))) err.date = 'Escolha o dia'
    if (!time) err.time = 'Escolha a hora (HH:MM)'
    if (!Number.isFinite(dur) || dur < 5 || dur > 720) err.duration = 'Entre 5 e 720 minutos'
    setRsErr(err)
    if (Object.keys(err).length) return
    const r = await run('reschedule', { scheduled_for: toWallIso(rs.date, time), duration_min: dur }, { raw: true })
    if (!r) return
    const up = r.appointment
    setPanel(null)
    if (settings.calendar_sync && Platform.OS !== 'web') addToCalendar(up, provider).catch(() => {})
    // blocked = o servidor viu folga no novo horário (só aviso, já está salvo)
    if (r.blocked && !(phone && can('whatsapp_templates'))) {
      notify('Esse horário cai numa folga', 'Remarcamos assim mesmo. Se a folga mudou, ajuste em Folgas.')
      return
    }
    offerMessage(r.blocked ? 'Esse horário cai numa folga' : 'Remarcado!', 'confirm', up, r.blocked ? 'Remarcamos assim mesmo.' : null)
  }

  // ── Pagamento ──────────────────────────────────────────────────────────
  async function openPay(withComplete, base = a) {
    if (!(await ensureFeature(app, 'payments_log'))) return
    const prev = base.paid_method || (METHOD_LABEL[base.payment_method] && base.payment_method !== 'stripe' && base.payment_method !== 'free' ? base.payment_method : null)
    setPay({
      amount: centsToInput(base.paid_cents ?? base.total_cents ?? 0),
      tip: base.tip_cents ? centsToInput(base.tip_cents) : '',
      method: prev || 'zelle',
      complete: withComplete,
    })
    setPayErr({})
    setPanel('pay')
  }

  async function savePay() {
    const amount = String(pay.amount).trim() === '' ? 0 : parseMoney(pay.amount)
    const tip = String(pay.tip).trim() === '' ? 0 : parseMoney(pay.tip)
    const err = {}
    if (amount == null) err.amount = 'Valor inválido. Ex.: 80 ou 80.50'
    if (tip == null) err.tip = 'Valor inválido. Ex.: 10'
    setPayErr(err)
    if (Object.keys(err).length) return
    const up = await run('mark_paid', { paid_cents: amount, tip_cents: tip, method: pay.method, complete: !!pay.complete && ACTIVE.includes(a.status) })
    if (up) setPanel(null)
  }

  async function clearPay() {
    const ok = await confirm('Apagar o pagamento?', 'O valor e a gorjeta registrados saem do financeiro.', { ok: 'Apagar', destructive: true })
    if (!ok) return
    const up = await run('unmark_paid')
    if (up) setPanel(null)
  }

  // ── Outras ações ───────────────────────────────────────────────────────
  async function saveNotes() {
    const up = await run('update', { internal_notes: notes })
    if (up) { notesDirty.current = false; setNotes(up.internal_notes || '') }
  }

  async function toCalendar() {
    if (!(await ensureFeature(app, 'calendar_sync'))) return
    const ok = await addToCalendar({ ...a, service_name: serviceName }, provider)
    if (ok) { haptic(); notify('No calendário', 'O horário foi pro calendário do celular.'); return }
    const why = calendarError()
    notify('Não deu pra adicionar', why === 'permission'
      ? 'Libere o acesso ao calendário pro AgendaPro nos Ajustes do celular.'
      : why === 'canceled' ? 'Agendamento cancelado não vai pro calendário.' : 'Tente de novo em instantes.')
  }

  function openMap() {
    const q = encodeURIComponent(address)
    Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {})
  }

  // Ver a recorrência é livre (a tela de edição mostra o cadeado se o plano não tiver)
  const openRecurring = () => router.push({ pathname: '/recurring/edit', params: { id: a.recurring_id } })

  async function makeRecurring() {
    if (a.recurring_id) { openRecurring(); return }
    if (!(await ensureFeature(app, 'recurring'))) return
    if (!a.client_id) {
      notify('Cadastre a cliente primeiro', 'Pra virar cliente fixa, ela precisa ter ficha. Toque em Editar, troque a cliente e escolha uma da sua lista ou cadastre com WhatsApp ou e-mail.')
      return
    }
    router.push({ pathname: '/recurring/edit', params: { client_id: a.client_id, ...(a.service_id ? { service_id: a.service_id } : {}) } })
  }

  async function openReceipt() {
    if (!(await ensureFeature(app, 'receipts'))) return
    router.push(`/receipt/${a.id}`)
  }

  const edit = () => router.push({ pathname: '/appointment/new', params: { id: a.id } })
  const repeat = () => router.push({ pathname: '/appointment/new', params: { repeat: a.id } })
  const openClient = () => { if (a.client_id) router.push(`/client/${a.client_id}`) }

  // ── Render ─────────────────────────────────────────────────────────────
  const depositPaidCents = a.deposit_paid ? (a.deposit_cents || 0) : 0
  const msgKeys = MSG_KEYS.filter((k) => (k === 'deposit' ? depositPending : k === 'review' ? a.status === 'completed' : true))

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <Stack.Screen options={{
        title: turnover ? 'Limpeza' : 'Agendamento',
        headerRight: () => (
          <Pressable onPress={edit} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: colors.green, fontWeight: '600', fontSize: 16 }}>Editar</Text>
          </Pressable>
        ),
      }} />
      <Screen onRefresh={() => load('refresh')} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => load('refresh')} />

        {/* Quando e quem */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.kpi, !active && a.status !== 'completed' && { color: colors.inkMuted }]}>
                {fmtTime(a.scheduled_for)} <Text style={{ fontSize: 18, fontWeight: '500', color: colors.inkMuted }}>– {endTime(a)}</Text>
              </Text>
              <Muted style={{ marginTop: 2 }}>
                {fmtRelativeDay(a.scheduled_for) === fmtDay(a.scheduled_for) ? '' : `${fmtRelativeDay(a.scheduled_for)} · `}{longDay(a.scheduled_for)} · {fmtDuration(a.duration_min)}
              </Muted>
            </View>
            <StatusBadge status={a.status} />
          </View>

          <Divider />

          <Pressable onPress={openClient} disabled={!a.client_id} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }, pressed && { opacity: 0.7 }]}>
            {turnover ? (
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="home-outline" size={22} color={colors.navy} />
              </View>
            ) : <Avatar name={title} size={44} color={a.staff_color || colors.green} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <H3 numberOfLines={1}>{title}</H3>
              <Muted numberOfLines={1}>
                {turnover
                  ? `Turnover${a.feed_source ? ' · ' + (FEED_NAMES[a.feed_source] || a.feed_source) : ''}`
                  : [phone ? fmtPhone(phone) : 'Sem WhatsApp', a.client_email].filter(Boolean).join(' · ')}
              </Muted>
            </View>
            {a.client_id ? <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
          </Pressable>

          <Divider />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name={turnover ? 'sparkles-outline' : 'pricetag-outline'} size={18} color={colors.green} />
            <Text style={[type.body, { flex: 1, fontWeight: '500' }]} numberOfLines={2}>{serviceName}</Text>
            <Text style={[type.body, { fontWeight: '700' }]}>{fmtMoney(a.total_cents || 0)}</Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
            {/* origem 'recurring' já vira o selo "Cliente fixa" abaixo */}
            {a.recurring_id && a.source === 'recurring' ? null : <Badge text={source.label} icon={source.icon} tone="gray" />}
            {a.staff_name ? <Badge text={a.staff_name} icon="person-outline" tone="navy" /> : null}
            {a.recurring_id ? <Badge text="Cliente fixa" icon="repeat-outline" tone="green" /> : null}
            {a.review_requested ? <Badge text="Avaliação pedida" icon="star-outline" tone="gold" /> : null}
            {tightCheckin ? <Badge text="Check-in no mesmo dia" icon="alert-circle" tone="red" /> : null}
          </View>
          {a.recurring_id ? (
            <Pressable onPress={openRecurring} hitSlop={8} accessibilityRole="button"
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, alignSelf: 'flex-start' }, pressed && { opacity: 0.7 }]}>
              <Text style={s.link}>Ver recorrência</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.green} />
            </Pressable>
          ) : null}
        </Card>

        {/* Contato rápido */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', marginTop: spacing.lg }}>
          {phone ? <QuickAction icon="logo-whatsapp" label="WhatsApp" color={colors.white} bg="#25D366" onPress={openMessages} /> : null}
          {phone ? <QuickAction icon="call-outline" label="Ligar" onPress={() => callPhone(phone)} /> : null}
          {phone ? <QuickAction icon="chatbubble-outline" label="SMS" onPress={() => sendSms(phone, '')} /> : null}
          {address ? <QuickAction icon="navigate-outline" label="Mapa" onPress={openMap} /> : null}
          {Platform.OS !== 'web' && a.status !== 'canceled' ? <QuickAction icon="calendar-outline" label="Calendário" onPress={toCalendar} /> : null}
          {a.client_id ? <QuickAction icon="person-outline" label="Ficha" onPress={openClient} /> : null}
        </View>

        {/* O que fazer agora */}
        <Section title="O que fazer">
          <Card>
            {a.status === 'pending' ? (
              <View style={{ gap: spacing.sm }}>
                {depositPending ? (
                  <>
                    <Muted>Sinal de {fmtMoney(a.deposit_cents)} ainda não chegou. O horário fica reservado até você confirmar.</Muted>
                    <Button title="Recebi o sinal" icon="wallet-outline" variant="gold" loading={busy === 'confirm_deposit'} onPress={() => setSheet('deposit')} />
                    {phone ? <Button title="Cobrar o sinal no WhatsApp" icon="logo-whatsapp" variant="whatsapp" onPress={() => (can('whatsapp_templates') ? sendTpl('deposit', { lang: baseLang }) : openWhatsApp(phone, ''))} /> : null}
                    <Button title="Confirmar sem sinal" variant="secondary" loading={busy === 'confirm'} onPress={doConfirm} />
                  </>
                ) : (
                  <>
                    <Muted>Esse horário ainda não foi confirmado.</Muted>
                    <Button title="Confirmar horário" icon="checkmark-circle-outline" loading={busy === 'confirm'} onPress={doConfirm} />
                  </>
                )}
              </View>
            ) : null}

            {a.status === 'confirmed' ? (
              <View style={{ gap: spacing.sm }}>
                <Muted>{isFuture ? 'Tudo certo. Depois do atendimento, marque como foi.' : 'Esse horário já passou. Como foi?'}</Muted>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title={turnover ? 'Limpeza feita' : 'Realizado'} icon="checkmark-done-outline" style={{ flex: 1 }} loading={busy === 'complete'} disabled={!!busy && busy !== 'complete'} onPress={doComplete} />
                  {!turnover ? (
                    <Button title="Faltou" icon="close-circle-outline" variant="danger" style={{ flex: 1 }} loading={busy === 'no_show'} disabled={!!busy && busy !== 'no_show'} onPress={doNoShow} />
                  ) : null}
                </View>
              </View>
            ) : null}

            {a.status === 'completed' ? (
              <View style={{ gap: spacing.sm }}>
                <Muted>{a.paid_at ? 'Atendimento realizado e pago.' : 'Atendimento realizado. Falta registrar o pagamento.'}</Muted>
                {!a.paid_at ? <Button title="Registrar pagamento" icon="cash-outline" onPress={() => openPay(false)} /> : null}
                {phone ? <Button title="Agradecer no WhatsApp" icon="heart-outline" variant="secondary" onPress={() => (can('whatsapp_templates') ? sendTpl('thanks', { lang: baseLang }) : openWhatsApp(phone, ''))} /> : null}
                {!turnover ? (
                  <Button title={a.review_requested ? 'Pedir avaliação de novo' : 'Pedir avaliação'} icon="star-outline" variant="secondary" loading={busy === 'review'} onPress={askReview} />
                ) : null}
              </View>
            ) : null}

            {a.status === 'no_show' || a.status === 'canceled' ? (
              <View style={{ gap: spacing.sm }}>
                <Muted>
                  {a.status === 'no_show' ? 'Marcado como "Faltou".' : `Cancelado${a.cancel_reason ? `: ${a.cancel_reason}` : '.'}`}
                </Muted>
                <Button title={a.status === 'no_show' ? 'Desfazer: ela veio' : 'Desfazer cancelamento'} icon="arrow-undo-outline" variant="secondary" loading={busy === 'reopen'} onPress={doReopen} />
                <Button title="Remarcar" icon="calendar-outline" onPress={openReschedule} />
                {a.status === 'no_show' && !a.paid_at ? <Button title="Registrar taxa de falta" icon="cash-outline" variant="ghost" onPress={() => openPay(false)} /> : null}
              </View>
            ) : null}

            {active ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button small title="Remarcar" icon="calendar-outline" variant="secondary" style={{ flex: 1 }} onPress={openReschedule} />
                <Button small title="Cancelar" icon="close-outline" variant="danger" style={{ flex: 1 }} onPress={openCancel} />
              </View>
            ) : null}
          </Card>
        </Section>

        {/* Painéis */}
        {panel === 'reschedule' ? (
          <Card style={s.panel}>
            <H3 style={{ marginBottom: spacing.md }}>Remarcar</H3>
            <DateField label="Novo dia" value={rs.date} onChange={(v) => setRs((r) => ({ ...r, date: v }))} />
            {rsErr.date ? <Text style={s.err}>{rsErr.date}</Text> : null}
            <TimeField label="Novo horário" value={rs.time} onChange={(v) => setRs((r) => ({ ...r, time: v }))} />
            {rsErr.time ? <Text style={s.err}>{rsErr.time}</Text> : null}
            <Input label="Duração (minutos)" value={rs.duration} keyboardType="number-pad" error={rsErr.duration}
              onChangeText={(v) => setRs((r) => ({ ...r, duration: v.replace(/\D/g, '').slice(0, 3) }))} />
            <Muted style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>O lembrete automático vai de novo pro novo horário.</Muted>
            <Button title="Salvar novo horário" loading={busy === 'reschedule'} onPress={saveReschedule} />
            <Button title="Voltar" variant="ghost" onPress={() => setPanel(null)} style={{ marginTop: spacing.xs }} />
          </Card>
        ) : null}

        {panel === 'cancel' ? (
          <Card style={[s.panel, { borderColor: '#F3C7C2' }]}>
            <H3 style={{ marginBottom: spacing.sm }}>Cancelar agendamento</H3>
            <Muted style={{ marginBottom: spacing.md }}>O horário fica livre de novo na sua página.</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {CANCEL_REASONS.map((r) => <Chip key={r} label={r} selected={cancelReason === r} onPress={() => setCancelReason(r)} />)}
            </View>
            {cancelReason === 'Outro motivo' ? (
              <Input label="Motivo" value={cancelText} onChangeText={setCancelText} placeholder="Ex.: mudou de cidade" maxLength={300} style={{ marginTop: spacing.sm }} />
            ) : null}
            <Button title="Cancelar agendamento" variant="danger" icon="close-circle-outline" loading={busy === 'cancel'} onPress={doCancel} style={{ marginTop: spacing.sm }} />
            <Button title="Voltar" variant="ghost" onPress={() => setPanel(null)} style={{ marginTop: spacing.xs }} />
          </Card>
        ) : null}

        {panel === 'pay' ? (
          <Card style={s.panel}>
            <H3>Registrar pagamento</H3>
            <Muted style={{ marginBottom: spacing.md }}>
              Valor do serviço: {fmtMoney(a.total_cents || 0)}{depositPaidCents ? ` · sinal de ${fmtMoney(depositPaidCents)} já recebido` : ''}
            </Muted>
            <Input label="Valor total recebido pelo serviço" value={pay.amount} keyboardType="decimal-pad" placeholder="0" error={payErr.amount}
              hint={depositPaidCents ? 'Conte o sinal junto. Ex.: serviço de $80 com $20 de sinal = 80.' : 'Sem a gorjeta.'}
              onChangeText={(v) => setPay((p) => ({ ...p, amount: v }))} />
            <Input label="Gorjeta" value={pay.tip} keyboardType="decimal-pad" placeholder="0" error={payErr.tip}
              onChangeText={(v) => setPay((p) => ({ ...p, tip: v }))} />
            <Label style={{ marginBottom: spacing.sm }}>Forma de pagamento</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {METHODS.map((m) => <Chip key={m.value} label={m.label} selected={pay.method === m.value} onPress={() => setPay((p) => ({ ...p, method: m.value }))} />)}
            </View>
            {active ? (
              <View style={{ marginHorizontal: -spacing.lg }}>
                <ToggleRow title="Marcar como realizado" subtitle="O atendimento já aconteceu" value={pay.complete} onValueChange={(v) => setPay((p) => ({ ...p, complete: v }))} />
              </View>
            ) : null}
            <Button title="Salvar pagamento" icon="checkmark" loading={busy === 'mark_paid'} onPress={savePay} style={{ marginTop: spacing.sm }} />
            {a.paid_at ? <Button title="Apagar pagamento" variant="ghost" loading={busy === 'unmark_paid'} onPress={clearPay} style={{ marginTop: spacing.xs }} /> : null}
            <Button title="Fechar" variant="ghost" onPress={() => setPanel(null)} style={{ marginTop: spacing.xs }} />
          </Card>
        ) : null}

        {/* Valores */}
        {(a.total_cents || a.deposit_cents || a.paid_at || payments.length) ? (
          <Section title="Valores" right={a.paid_at && panel !== 'pay' ? (
            <Pressable onPress={() => openPay(false)} hitSlop={8}><Text style={s.link}>Editar</Text></Pressable>
          ) : null}>
            <Card padded={false}>
              <Row title="Serviço" right={fmtMoney(a.total_cents || 0)} />
              {a.deposit_cents ? (
                <>
                  <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} />
                  <Row title="Sinal" subtitle={a.deposit_paid ? `Recebido${a.payment_method ? ' · ' + (METHOD_LABEL[a.payment_method] || a.payment_method) : ''}` : 'Pendente'}
                    right={<Text style={[type.body, { fontWeight: '600', color: a.deposit_paid ? colors.success : colors.warning }]}>{fmtMoney(a.deposit_cents)}</Text>} />
                </>
              ) : null}
              {a.paid_at ? (
                <>
                  <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} />
                  <Row title="Recebido pelo serviço" subtitle={`${METHOD_LABEL[a.paid_method] || 'Pago'} · ${fmtAgo(a.paid_at)}`}
                    right={<Text style={[type.body, { fontWeight: '600', color: colors.success }]}>{fmtMoney(a.paid_cents || 0)}</Text>} />
                  {a.tip_cents ? (
                    <>
                      <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} />
                      <Row title="Gorjeta" right={<Text style={[type.body, { fontWeight: '600', color: colors.success }]}>{fmtMoney(a.tip_cents)}</Text>} />
                    </>
                  ) : null}
                  <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} />
                  <Row title="Total recebido" right={<Text style={[type.body, { fontWeight: '700' }]}>{fmtMoney((a.paid_cents || 0) + (a.tip_cents || 0))}</Text>} />
                </>
              ) : a.status === 'completed' && can('payments_log') && panel !== 'pay' ? (
                <>
                  <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} />
                  <Row icon="cash-outline" title="Registrar pagamento" subtitle="Valor, gorjeta e forma de pagamento" chevron onPress={() => openPay(false)} />
                </>
              ) : null}
            </Card>
            {payments.length > 1 || (payments.length === 1 && !a.paid_at) ? (
              <View style={{ marginTop: spacing.sm }}>
                {payments.map((p) => (
                  <Muted key={p.id} style={{ marginLeft: 2, marginTop: 2 }}>
                    {PAY_TYPE[p.type] || p.type}{p.method ? ` · ${METHOD_LABEL[p.method] || p.method}` : ''} · {fmtMoney(p.amount_cents)} · {fmtAgo(p.paid_at)}
                  </Muted>
                ))}
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* Turnover: casa */}
        {turnover ? (
          <Section title="Casa">
            <Card>
              <Text style={[type.body, { fontWeight: '600' }]}>{a.feed_label || 'Casa sincronizada'}</Text>
              {a.feed_notes ? <Muted style={{ marginTop: 4 }}>{a.feed_notes}</Muted> : null}
              {a.ical_next_checkin ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
                  <Ionicons name={tightCheckin ? 'alert-circle' : 'log-in-outline'} size={16} color={tightCheckin ? colors.danger : colors.inkSoft} />
                  <Text style={[type.small, tightCheckin && { color: colors.danger, fontWeight: '600' }]}>
                    {tightCheckin ? 'Próximo hóspede chega no mesmo dia: termine antes do check-in.' : `Próximo check-in: ${fmtRelativeDay(String(a.ical_next_checkin).slice(0, 10))}`}
                  </Text>
                </View>
              ) : null}
            </Card>
          </Section>
        ) : null}

        {/* Observações */}
        <Section title="Anotações">
          <Card>
            {a.client_notes ? (
              <View style={{ marginBottom: spacing.md }}>
                <Label style={{ marginBottom: 4 }}>Recado da cliente</Label>
                <Text style={type.body}>{a.client_notes}</Text>
              </View>
            ) : null}
            {client?.notes ? (
              <View style={{ marginBottom: spacing.md }}>
                <Label style={{ marginBottom: 4 }}>Da ficha</Label>
                <Text style={type.body}>{client.notes}</Text>
              </View>
            ) : null}
            {client?.home_notes || address ? (
              <View style={{ marginBottom: spacing.md }}>
                <Label style={{ marginBottom: 4 }}>Endereço e acesso</Label>
                {address ? (
                  <Pressable onPress={openMap} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="location-outline" size={16} color={colors.green} />
                    <Text style={[type.body, { color: colors.green, flex: 1 }]}>{address}</Text>
                  </Pressable>
                ) : null}
                {client?.home_notes ? <Text style={[type.body, { marginTop: 4 }]}>{client.home_notes}</Text> : null}
              </View>
            ) : null}
            <Input label="Anotação interna (só você vê)" value={notes} multiline maxLength={2000}
              placeholder="Ex.: cor usada, fórmula, preferência, o que combinar na próxima"
              onChangeText={(v) => { notesDirty.current = true; setNotes(v) }} style={{ marginBottom: notes !== (a.internal_notes || '') ? spacing.md : 0 }} />
            {notes !== (a.internal_notes || '') ? (
              <Button small title="Salvar anotação" icon="save-outline" loading={busy === 'update'} onPress={saveNotes} />
            ) : null}
          </Card>
        </Section>

        {/* Mais */}
        <Section title="Mais">
          <Card padded={false}>
            <Row icon="repeat-outline" title="Repetir agendamento" subtitle="Mesma cliente e serviço, outro dia" chevron onPress={repeat} />
            {!turnover ? (
              <>
                <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
                <Row icon="infinite-outline" title={a.recurring_id ? 'Ver recorrência' : 'Tornar cliente fixa'} subtitle={a.recurring_id ? 'Esse horário se repete sozinho' : 'Semanal, quinzenal ou mensal'}
                  chevron onPress={makeRecurring} right={lock('recurring')} />
              </>
            ) : null}
            {a.status === 'completed' || a.paid_at ? (
              <>
                <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
                <Row icon="document-text-outline" title="Recibo" subtitle="PDF pra mandar pra cliente" chevron onPress={openReceipt} right={lock('receipts')} />
              </>
            ) : null}
            {a.status === 'canceled' && isFuture ? (
              <>
                <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
                <Row icon="hourglass-outline" title="Avisar a lista de espera" subtitle={busy === 'waitlist' ? 'Procurando quem combina…' : 'Alguém pode querer esse horário'} chevron right={lock('waitlist')}
                  onPress={() => { if (!busy) notifyWaitlist() }} />
              </>
            ) : null}
            <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
            <Row icon="create-outline" title="Editar agendamento" subtitle="Serviço, preço, duração, cliente" chevron onPress={edit} />
          </Card>
        </Section>

        <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
          {source.label}{a.created_at ? ` · criado ${fmtAgo(a.created_at)}` : ''}
        </Muted>
      </Screen>

      {/* Mensagens prontas */}
      <Sheet visible={sheet === 'whatsapp'} title="Mensagem no WhatsApp" subtitle={`Pra ${firstName(a.client_name) || 'a cliente'} · abre a conversa com o texto pronto`} onClose={() => setSheet(null)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          {LANGS.map((l) => (
            <Chip key={l.value} label={l.label} selected={msgLang === l.value} icon={l.value !== 'pt' && !canMulti ? 'lock-closed' : undefined} onPress={() => pickLang(l.value)} />
          ))}
        </View>
        {msgKeys.map((k) => (
          <Pressable key={k} onPress={() => sendTpl(k)} style={({ pressed }) => [s.msgRow, pressed && { backgroundColor: colors.paperSoft }]}>
            <View style={s.msgIcon}><Ionicons name={MSG_ICONS[k]} size={18} color={colors.green} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{DEFAULT_TEMPLATES[k]?.title || k}</Text>
              <Muted numberOfLines={2}>{renderTemplate(k, msgLang, vars(a, msgLang, k === 'review' ? { link: '…' } : {}), settings)}</Muted>
            </View>
          </Pressable>
        ))}
        <Pressable onPress={() => { setSheet(null); openWhatsApp(phone, '') }} style={({ pressed }) => [s.msgRow, pressed && { backgroundColor: colors.paperSoft }]}>
          <View style={s.msgIcon}><Ionicons name="create-outline" size={18} color={colors.green} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontWeight: '600' }]}>Mensagem livre</Text>
            <Muted>Abre a conversa sem texto</Muted>
          </View>
        </Pressable>
        <Pressable onPress={() => { setSheet(null); router.push('/templates') }} style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
          <Text style={s.link}>Editar mensagens prontas</Text>
        </Pressable>
      </Sheet>

      {/* Forma do sinal */}
      <Sheet visible={sheet === 'deposit'} title="Como chegou o sinal?" subtitle={`${fmtMoney(a.deposit_cents || 0)} · o horário fica confirmado`} onClose={() => setSheet(null)}>
        {METHODS.map((m) => (
          <Pressable key={m.value} onPress={() => doDeposit(m.value)} style={({ pressed }) => [s.msgRow, pressed && { backgroundColor: colors.paperSoft }]}>
            <View style={s.msgIcon}><Ionicons name={m.value === 'cash' ? 'cash-outline' : m.value === 'card' ? 'card-outline' : 'phone-portrait-outline'} size={18} color={colors.green} /></View>
            <Text style={[type.body, { fontWeight: '600', flex: 1 }]}>{m.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </Pressable>
        ))}
      </Sheet>
    </KeyboardAvoidingView>
  )
}

// ── Peças ───────────────────────────────────────────────────────────────────
function QuickAction({ icon, label, onPress, color = colors.green, bg = colors.greenSoft }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ alignItems: 'center', minWidth: 56 }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={{ fontSize: 12, color: colors.inkSoft, marginTop: 4, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  )
}

/** Folha que sobe de baixo com uma lista de opções (o Alert do Android só tem 3 botões). */
function Sheet({ visible, title, subtitle, onClose, children }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} accessibilityLabel="Fechar" />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={s.handle} />
          <H3>{title}</H3>
          {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
          <ScrollView style={{ maxHeight: 460, marginTop: spacing.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <Button title="Fechar" variant="secondary" onPress={onClose} style={{ marginTop: spacing.sm }} />
        </View>
      </View>
    </Modal>
  )
}

const s = {
  panel: { marginTop: spacing.lg, borderColor: colors.green, borderWidth: 1 },
  err: { color: colors.danger, fontSize: 13, marginTop: -spacing.md, marginBottom: spacing.md },
  link: { color: colors.green, fontWeight: '600', fontSize: 14 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingTop: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: spacing.md },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  msgIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
}
