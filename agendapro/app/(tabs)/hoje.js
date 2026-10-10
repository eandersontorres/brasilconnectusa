// Aba "Hoje": o painel do dia. Saudação, primeiros passos, números, próximo
// atendimento com WhatsApp em 1 toque, lista de hoje, aniversariantes do dia,
// prévia de amanhã, pendências (sinal, atendimento sem marcar) e atalhos.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useApp } from '../../lib/session'
import { api, post } from '../../lib/api'
import { showError } from '../../lib/gate'
import { confirm } from '../../lib/dialog'
import { PUBLIC_PAGE } from '../../lib/config'
import { firstName, messageLang, msgDate, msgTime, openWhatsApp, renderAny, renderTemplate } from '../../lib/whatsapp'
import {
  MONTHS, MONTHS_LONG, WEEKDAYS_LONG, addDays, fmtDuration, fmtMoney, fmtRelativeDay, fmtTime, hhmmOf, keyOf, todayKey, toWallIso,
} from '../../lib/format'
import { colors, radius, shadow, spacing, statusStyle, type } from '../../lib/theme'
import { Avatar, Badge, Banner, Button, Card, Divider, Empty, ErrorBox, H2, H3, IconButton, KPI, Loading, Muted, Screen, Section, StatusBadge } from '../../components/ui'
import PlanBanner from '../../components/PlanBanner'

const CHECK_KEY = 'agendapro.checklist.v1'
const pad = (n) => String(n).padStart(2, '0')
const FEED_NAMES = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking: 'Booking', outro: 'Calendário' }

// ── Ajudantes ───────────────────────────────────────────────────────────────
/** Agora no relógio do celular, como ISO de parede. */
function nowWall() {
  const d = new Date()
  return toWallIso(todayKey(), `${pad(d.getHours())}:${pad(d.getMinutes())}`)
}

function endTime(a) {
  const d = new Date(Date.parse(a.scheduled_for) + (Number(a.duration_min) || 0) * 60e3)
  return hhmmOf(d.toISOString())
}

/** "em 25 min", "agora", "hoje às 14:00", "amanhã às 09:00". */
function relLabel(iso) {
  const diff = Math.round((Date.parse(iso) - Date.parse(nowWall())) / 60000)
  if (diff <= 0 && diff > -60) return 'agora'
  if (diff > 0 && diff < 60) return `em ${diff} min`
  if (keyOf(iso) === todayKey()) return `hoje às ${fmtTime(iso)}`
  return `${fmtRelativeDay(iso).toLowerCase()} às ${fmtTime(iso)}`
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function longToday() {
  const d = new Date()
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`
}

const sameDayCheckin = (a) => !!a.external_uid && !!a.ical_next_checkin && String(a.ical_next_checkin).slice(0, 10) === keyOf(a.scheduled_for)

// ── Tela ────────────────────────────────────────────────────────────────────
export default function Hoje() {
  const app = useApp()
  const { provider, settings, can } = app
  const cleaning = provider?.vertical === 'cleaning'
  const noun = (n) => (cleaning ? (n === 1 ? 'limpeza' : 'limpezas') : (n === 1 ? 'atendimento' : 'atendimentos'))

  const [stats, setStats] = useState(null)
  const [apts, setApts] = useState([])
  const [day, setDay] = useState(todayKey())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [check, setCheck] = useState({ loaded: false })
  const [birthdays, setBirthdays] = useState([])
  const loadedOnce = useRef(false)
  const bdayDay = useRef(null)          // dia em que os aniversariantes já foram buscados
  const canClients = can('clients')

  const load = useCallback(async (mode = 'initial') => {
    if (mode === 'refresh') setRefreshing(true)
    const today = todayKey()
    try {
      const [s, r] = await Promise.all([
        api(`/api/agenda/appointments?scope=stats&today=${today}&now=${encodeURIComponent(nowWall())}`),
        api(`/api/agenda/appointments?scope=range&from=${today}&to=${addDays(today, 1)}`),
      ])
      setStats(s)
      setApts(r.appointments || [])
      setDay(today)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Recarrega sempre que a aba volta pro foco (depois de criar/editar um agendamento)
  useFocusEffect(useCallback(() => {
    load(loadedOnce.current ? 'silent' : 'initial')
    loadedOnce.current = true
  }, [load]))

  // Aniversariantes de hoje (plano com clientes). window=1 traz hoje e amanhã; fica só o 0.
  // Busca uma vez por dia; puxar pra atualizar busca de novo.
  const loadBirthdays = useCallback(async (force = false) => {
    if (!canClients) { setBirthdays([]); bdayDay.current = null; return }
    const today = todayKey()
    if (!force && bdayDay.current === today) return
    bdayDay.current = today
    try {
      const r = await api('/api/agenda/clients?filter=birthday&window=1&sort=name')
      setBirthdays((r.clients || []).filter((c) => c.birthday_in_days === 0))
    } catch (_) {
      setBirthdays([])
      bdayDay.current = null
    }
  }, [canClients])

  useFocusEffect(useCallback(() => { loadBirthdays() }, [loadBirthdays]))

  const refresh = () => { load('refresh'); loadBirthdays(true) }

  useEffect(() => {
    AsyncStorage.getItem(CHECK_KEY)
      .then((raw) => { try { setCheck({ loaded: true, ...(JSON.parse(raw || '{}') || {}) }) } catch (_) { setCheck({ loaded: true }) } })
      .catch(() => setCheck({ loaded: true }))
  }, [])

  const saveCheck = (patch) => {
    setCheck((cur) => {
      const next = { ...cur, ...patch }
      const { loaded, ...persist } = next
      AsyncStorage.setItem(CHECK_KEY, JSON.stringify(persist)).catch(() => {})
      return next
    })
  }

  // ── Ações ──────────────────────────────────────────────────────────────
  async function mark(a, action) {
    setBusy(a.id + action)
    try {
      await post('/api/agenda/appointments', { action, id: a.id })
      setStats((s) => s && ({
        ...s,
        unmarked_list: (s.unmarked_list || []).filter((x) => x.id !== a.id),
        unmarked_past: Math.max(0, (s.unmarked_past || 1) - 1),
      }))
      load('silent')
    } catch (e) {
      showError(e)
    } finally {
      setBusy(null)
    }
  }

  async function markAllDone() {
    const list = stats?.unmarked_list || []
    if (!list.length) return
    const ok = await confirm('Marcar todos como realizados?', `${list.length} ${noun(list.length)} que já passaram vão ficar como "Realizado".`, { ok: 'Marcar todos' })
    if (!ok) return
    setBusy('all')
    try {
      for (const a of list) await post('/api/agenda/appointments', { action: 'complete', id: a.id })
    } catch (e) {
      showError(e)
    } finally {
      setBusy(null)
      load('silent')
    }
  }

  // Idioma da mensagem: o da cliente (ou o padrão dela) se o plano libera, senão português
  const langFor = (clientLang) => messageLang(clientLang || settings.default_language || 'pt', can('multilang_messages'))

  function sendTemplate(a, key, clientLang, extra = {}) {
    if (!a.client_whatsapp) return
    const lang = langFor(clientLang)
    const text = renderTemplate(key, lang, {
      nome: firstName(a.client_name),
      data: msgDate(a.scheduled_for, lang),
      hora: msgTime(a.scheduled_for, lang),
      servico: a.service_name || a.service_label || '',
      profissional: provider?.name || '',
      valor: fmtMoney(a.deposit_cents),
      link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
      ...extra,
    }, settings)
    openWhatsApp(a.client_whatsapp, text)
  }

  // Parabéns no WhatsApp com o modelo 'birthday' (sem mensagens prontas no plano: conversa vazia)
  function sendBirthday(c) {
    if (!c.whatsapp) return
    if (!can('whatsapp_templates')) { openWhatsApp(c.whatsapp, ''); return }
    const lang = langFor(c.language)
    openWhatsApp(c.whatsapp, renderAny('birthday', lang, {
      nome: firstName(c.name),
      profissional: provider?.name || '',
      link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
    }, settings))
  }

  const open = (a) => router.push(`/appointment/${a.id}`)

  // ── Dados derivados ────────────────────────────────────────────────────
  const tomorrow = addDays(day, 1)
  const todayList = apts.filter((a) => keyOf(a.scheduled_for) === day && a.status !== 'canceled')
  const canceledToday = apts.filter((a) => keyOf(a.scheduled_for) === day && a.status === 'canceled').length
  const tomorrowList = apts.filter((a) => keyOf(a.scheduled_for) === tomorrow && a.status !== 'canceled' && a.status !== 'no_show')
  const next = stats?.next_appointment || null
  const tight = todayList.filter((a) => sameDayCheckin(a) && a.status !== 'no_show')
  const unmarked = stats?.unmarked_list || []
  const pending = stats?.pending_list || []

  const setup = stats?.setup || {}
  const steps = [
    { key: 'services', icon: 'pricetags-outline', title: 'Cadastre seus serviços', sub: 'Nome, duração e preço', done: setup.services == null || setup.services > 0, href: '/services' },
    { key: 'hours', icon: 'time-outline', title: 'Defina seu horário de atendimento', sub: 'Os dias e horas em que você atende', done: setup.hours == null || setup.hours > 0, href: '/hours' },
    { key: 'share', icon: 'share-social-outline', title: 'Compartilhe seu link', sub: 'Mande pras clientes ou poste no Instagram', done: !!check.shared || setup.has_online_booking === true, href: '/share' },
  ]
  const stepsDone = steps.filter((s) => s.done).length
  const showSteps = !!stats && check.loaded && !check.hidden && stepsDone < steps.length

  if (loading && !stats) {
    return <Screen><Loading text="Carregando seu dia…" /></Screen>
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ marginBottom: spacing.lg }}>
        <H2>{greeting()}{provider?.name ? `, ${firstName(provider.name)}` : ''}!</H2>
        <Muted style={{ marginTop: 2 }}>{longToday()}</Muted>
      </View>

      <PlanBanner />
      <ErrorBox error={error} onRetry={() => load('refresh')} />

      {/* Primeiros passos */}
      {showSteps ? (
        <Card style={{ marginBottom: spacing.lg }} padded={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, paddingBottom: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <H3>Primeiros passos</H3>
              <Muted>{stepsDone} de {steps.length} prontos · sua agenda online começa aqui</Muted>
            </View>
            <Pressable onPress={() => saveCheck({ hidden: true })} hitSlop={10} accessibilityLabel="Ocultar primeiros passos">
              <Ionicons name="close" size={20} color={colors.inkMuted} />
            </Pressable>
          </View>
          <View style={{ height: 6, backgroundColor: colors.paperSoft, marginHorizontal: spacing.lg, borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ width: `${(stepsDone / steps.length) * 100}%`, height: 6, backgroundColor: colors.flag }} />
          </View>
          <View style={{ paddingVertical: spacing.sm }}>
            {steps.map((s) => (
              <Pressable key={s.key}
                onPress={() => { if (s.key === 'share') saveCheck({ shared: true }); router.push(s.href) }}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.paperSoft }]}>
                <Ionicons name={s.done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={s.done ? colors.flag : colors.inkMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { fontWeight: '600' }, s.done && { color: colors.inkMuted, textDecorationLine: 'line-through' }]}>{s.title}</Text>
                  {!s.done ? <Muted>{s.sub}</Muted> : null}
                </View>
                {!s.done ? <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Números */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <KPI label="Hoje" value={String(stats?.today_count ?? 0)} sub={noun(stats?.today_count ?? 0)} />
        <KPI label="Previsto" value={fmtMoney(stats?.today_expected_cents || 0)} sub="hoje" tone="green" />
        <KPI label="No mês" value={fmtMoney(stats?.month_completed_cents || 0)} sub="faturado" tone="gold"
          onPress={() => router.push('/financas')} />
      </View>

      {/* Turnover apertado (faxina) */}
      {cleaning && tight.length ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner tone="red" icon="alert-circle-outline"
            text={tight.length === 1 ? 'Hoje tem 1 casa com check-in no mesmo dia: termine antes do próximo hóspede.' : `Hoje tem ${tight.length} casas com check-in no mesmo dia: termine antes dos próximos hóspedes.`} />
        </View>
      ) : null}

      {/* Próximo atendimento */}
      {next ? (
        <Section title={cleaning ? 'Próxima limpeza' : 'Próximo atendimento'}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Badge text={relLabel(next.scheduled_for)} tone="green" icon="time-outline" />
              {next.staff_name ? <StaffTag name={next.staff_name} color={next.staff_color} /> : null}
              <View style={{ flex: 1 }} />
              <StatusBadge status={next.status} />
            </View>
            <H3 style={{ marginTop: spacing.md }} numberOfLines={1}>
              {next.external_uid ? (next.feed_label || 'Turnover') : next.client_name}
            </H3>
            <Muted numberOfLines={2}>
              {fmtTime(next.scheduled_for)}–{endTime(next)} · {next.external_uid ? `Turnover${next.feed_source ? ' · ' + (FEED_NAMES[next.feed_source] || next.feed_source) : ''}` : (next.service_name || next.service_label || 'Atendimento')} · {fmtDuration(next.duration_min)}
            </Muted>
            {next.client_address ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Ionicons name="location-outline" size={14} color={colors.inkSoft} />
                <Muted style={{ flex: 1 }} numberOfLines={1}>{next.client_address}</Muted>
              </View>
            ) : null}
            {sameDayCheckin(next) ? <Badge text="Check-in no mesmo dia" tone="red" icon="alert-circle" style={{ marginTop: spacing.sm }} /> : null}
            {next.status === 'pending' && next.deposit_cents > 0 && !next.deposit_paid ? (
              <Badge text={`Sinal de ${fmtMoney(next.deposit_cents)} pendente`} tone="orange" style={{ marginTop: spacing.sm }} />
            ) : null}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              {next.client_whatsapp ? (
                <>
                  <Button small variant="whatsapp" icon="car-outline" title="A caminho" style={{ flex: 1 }}
                    onPress={() => sendTemplate(next, 'on_the_way', next.client_language)} />
                  <Button small variant="secondary" icon="hourglass-outline" title="Vou atrasar" style={{ flex: 1 }}
                    onPress={() => sendTemplate(next, 'late', next.client_language)} />
                </>
              ) : null}
              <Button small variant={next.client_whatsapp ? 'ghost' : 'secondary'} title="Abrir" icon="open-outline" full={!next.client_whatsapp}
                style={next.client_whatsapp ? null : { flex: 1 }} onPress={() => open(next)} />
            </View>
          </Card>
        </Section>
      ) : null}

      {/* Lista de hoje */}
      <Section title={`Hoje · ${todayList.length} ${noun(todayList.length)}`}
        right={<Pressable onPress={() => router.push('/agenda')} hitSlop={8}><Text style={s.link}>Ver agenda</Text></Pressable>}>
        {todayList.length ? (
          <Card padded={false}>
            {todayList.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 70 }} /> : null}
                <AptRow a={a} onPress={() => open(a)} />
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Empty icon="sunny-outline" title="Dia livre por enquanto"
              text={cleaning ? 'Nenhuma limpeza marcada pra hoje.' : 'Nenhum atendimento marcado pra hoje. Que tal mandar seu link pras clientes?'}
              style={{ padding: spacing.md }}
              action={<Button title="Novo agendamento" icon="add" onPress={() => router.push({ pathname: '/appointment/new', params: { date: day } })} />} />
          </Card>
        )}
        {canceledToday ? <Muted style={{ marginTop: spacing.sm, marginLeft: 2 }}>{canceledToday} cancelado{canceledToday > 1 ? 's' : ''} hoje</Muted> : null}
      </Section>

      {/* Aniversário hoje (some sem ninguém ou sem o recurso de clientes) */}
      {canClients && birthdays.length ? (
        <Section title={birthdays.length === 1 ? 'Aniversário hoje' : `Aniversário hoje · ${birthdays.length}`}>
          <Card padded={false}>
            {birthdays.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 68 }} /> : null}
                <Pressable onPress={() => router.push(`/client/${c.id}`)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 60 }, pressed && { backgroundColor: colors.paperSoft }]}>
                  <Avatar name={c.name} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.body, { fontWeight: '600' }]} numberOfLines={1}>{c.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name="gift-outline" size={14} color={colors.inkSoft} />
                      <Muted numberOfLines={1} style={{ flex: 1 }}>{c.whatsapp ? 'Mande os parabéns' : 'Sem WhatsApp na ficha'}</Muted>
                    </View>
                  </View>
                  {c.whatsapp ? (
                    <IconButton icon="logo-whatsapp" color={colors.white} bg="#25D366" size={36} label={`Mandar parabéns pra ${firstName(c.name)} no WhatsApp`}
                      onPress={() => sendBirthday(c)} />
                  ) : <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />}
                </Pressable>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* Amanhã */}
      <Section title={`Amanhã · ${tomorrowList.length} ${noun(tomorrowList.length)}`}
        right={tomorrowList.length > 4 ? (
          <Pressable onPress={() => router.push({ pathname: '/agenda', params: { date: tomorrow } })} hitSlop={8}>
            <Text style={s.link}>Ver todos</Text>
          </Pressable>
        ) : null}>
        {tomorrowList.length ? (
          <Card padded={false}>
            {tomorrowList.slice(0, 4).map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 70 }} /> : null}
                <AptRow a={a} onPress={() => open(a)} compact />
              </View>
            ))}
          </Card>
        ) : (
          <Muted style={{ marginLeft: 2 }}>Nada marcado pra amanhã ainda.</Muted>
        )}
      </Section>

      {/* Pendências */}
      {unmarked.length || pending.length ? (
        <Section title="Pendências">
          {unmarked.length ? (
            <Card padded={false} style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, paddingBottom: spacing.sm }}>
                <Ionicons name="checkbox-outline" size={18} color={colors.warning} />
                <Text style={[type.body, { fontWeight: '600', flex: 1, marginLeft: 8 }]}>
                  {stats.unmarked_past === 1 ? '1 já passou e não foi marcado' : `${stats.unmarked_past} já passaram e não foram marcados`}
                </Text>
                {unmarked.length > 1 ? (
                  <Pressable onPress={markAllDone} disabled={busy === 'all'} hitSlop={8}>
                    <Text style={s.link}>{busy === 'all' ? 'Marcando…' : 'Todos realizados'}</Text>
                  </Pressable>
                ) : null}
              </View>
              {unmarked.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }}>
                    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => open(a)}>
                      <Text style={[type.body, { fontWeight: '500' }]} numberOfLines={1}>{a.external_uid ? (a.feed_label || 'Turnover') : a.client_name}</Text>
                      <Muted numberOfLines={1}>{fmtRelativeDay(a.scheduled_for)} · {fmtTime(a.scheduled_for)} · {a.service_name || a.service_label || (a.external_uid ? 'Turnover' : 'Atendimento')}</Muted>
                    </Pressable>
                    <Button small full={false} title="Realizado" loading={busy === a.id + 'complete'} disabled={!!busy}
                      onPress={() => mark(a, 'complete')} />
                    <Button small full={false} variant="danger" title="Faltou" loading={busy === a.id + 'no_show'} disabled={!!busy}
                      onPress={() => mark(a, 'no_show')} />
                  </View>
                </View>
              ))}
              {stats.unmarked_past > unmarked.length ? (
                <Muted style={{ padding: spacing.lg, paddingTop: spacing.sm }}>E mais {stats.unmarked_past - unmarked.length} na agenda.</Muted>
              ) : <View style={{ height: spacing.sm }} />}
            </Card>
          ) : null}

          {pending.length ? (
            <Card padded={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg, paddingBottom: spacing.sm }}>
                <Ionicons name="wallet-outline" size={18} color={colors.warning} />
                <Text style={[type.body, { fontWeight: '600', flex: 1, marginLeft: 8 }]}>
                  {stats.pending_deposits ? `${stats.pending_deposits} aguardando sinal` : 'Aguardando confirmação'}
                </Text>
              </View>
              {pending.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <Pressable onPress={() => open(a)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.paperSoft }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.body, { fontWeight: '500' }]} numberOfLines={1}>{a.client_name}</Text>
                      <Muted numberOfLines={1}>
                        {fmtRelativeDay(a.scheduled_for)} · {fmtTime(a.scheduled_for)}
                        {a.deposit_cents > 0 && !a.deposit_paid ? ` · sinal ${fmtMoney(a.deposit_cents)}` : ''}
                      </Muted>
                    </View>
                    {a.client_whatsapp && a.deposit_cents > 0 && !a.deposit_paid ? (
                      <IconButton icon="logo-whatsapp" color={colors.white} bg="#25D366" size={36} label="Cobrar o sinal no WhatsApp"
                        onPress={() => sendTemplate(a, 'deposit', null)} />
                    ) : null}
                    <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
                  </Pressable>
                </View>
              ))}
              <View style={{ height: spacing.sm }} />
            </Card>
          ) : null}
        </Section>
      ) : null}

      {/* Atalhos */}
      <Section title="Atalhos">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Shortcut icon="add-circle-outline" label="Novo agendamento" onPress={() => router.push({ pathname: '/appointment/new', params: { date: day } })} />
          <Shortcut icon="remove-circle-outline" label="Bloquear horário" onPress={() => router.push('/blocked')} />
          <Shortcut icon="share-social-outline" label="Compartilhar link" onPress={() => { saveCheck({ shared: true }); router.push('/share') }} />
        </View>
      </Section>

      {stats?.week_count ? (
        <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
          {stats.week_count} {noun(stats.week_count)} nesta semana · {fmtMoney(stats.month_expected_cents || 0)} previstos em {MONTHS[Number(day.slice(5, 7)) - 1]}
        </Muted>
      ) : null}
    </Screen>
  )
}

// ── Peças ───────────────────────────────────────────────────────────────────
function StaffTag({ name, color }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color || colors.inkMuted }} />
      <Muted numberOfLines={1}>{name}</Muted>
    </View>
  )
}

function AptRow({ a, onPress, compact }) {
  const st = statusStyle[a.status] || statusStyle.pending
  const turnover = !!a.external_uid
  const faded = a.status === 'canceled' || a.status === 'no_show'
  const title = turnover ? (a.feed_label || 'Turnover') : a.client_name
  const sub = turnover
    ? `Turnover${a.feed_source ? ' · ' + (FEED_NAMES[a.feed_source] || a.feed_source) : ''}`
    : (a.service_name || a.service_label || 'Atendimento')
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.paperSoft }]}>
      <View style={{ width: 48 }}>
        <Text style={[type.body, { fontWeight: '700' }, faded && { color: colors.inkMuted }]}>{fmtTime(a.scheduled_for)}</Text>
        {!compact ? <Muted>{endTime(a)}</Muted> : null}
      </View>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: st.fg, opacity: faded ? 0.4 : 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {a.staff_color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.staff_color }} /> : null}
          <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }, faded && { color: colors.inkMuted }]} numberOfLines={1}>{title}</Text>
        </View>
        <Muted numberOfLines={1}>{sub}{a.staff_name ? ` · ${a.staff_name}` : ''}</Muted>
        {sameDayCheckin(a) ? <Badge text="Check-in no mesmo dia" tone="red" icon="alert-circle" style={{ marginTop: 4 }} /> : null}
      </View>
      <StatusBadge status={a.status} />
    </Pressable>
  )
}

function Shortcut({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.shortcut, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <View style={s.shortcutIcon}><Ionicons name={icon} size={22} color={colors.green} /></View>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink, textAlign: 'center', marginTop: 8 }} numberOfLines={2}>{label}</Text>
    </Pressable>
  )
}

const s = {
  link: { color: colors.green, fontWeight: '600', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 60 },
  shortcut: { flex: 1, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, alignItems: 'center', ...shadow },
  shortcutIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
}
