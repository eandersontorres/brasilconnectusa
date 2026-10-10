// Ficha da cliente: contato, ações rápidas (WhatsApp com modelos, ligar, SMS, novo
// agendamento, tornar fixa), números (visitas, gasto, ticket, faltas), ritmo de
// retorno, observações, casa (endereço e acesso) e histórico.
// Dados de GET /api/agenda/clients?id=.
import { useCallback, useState } from 'react'
import { Linking, Platform, Pressable, Text, View } from 'react-native'
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { notify } from '../../lib/dialog'
import { colors, radius, spacing, type } from '../../lib/theme'
import { MONTHS, dateKey, fmtDay, fmtMoney, fmtPhone, fmtWhen, todayKey } from '../../lib/format'
import { PUBLIC_PAGE } from '../../lib/config'
import { ALL_TEMPLATES, callPhone, firstName, messageLang, msgDate, msgTime, openWhatsApp, renderAny, sendSms } from '../../lib/whatsapp'
import { DocStatusBadge, docKindLabel } from '../../lib/documents'
import { Avatar, Badge, Button, Card, Divider, Empty, ErrorBox, H2, KPI, Loading, Muted, P, Row, Screen, Section, Small, StatusBadge } from '../../components/ui'

const LANG_SHORT = { pt: 'Português', en: 'English', es: 'Español' }

/** Endereço numa linha: '123 Main St, Boston, MA 02134'. */
function addressText(c) {
  if (!c) return ''
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [c.address_line, cityLine].filter(Boolean).join(', ')
}

function openMap(address) {
  const q = encodeURIComponent(address)
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`
  if (Platform.OS === 'web') { window.open(url, '_blank'); return }
  Linking.openURL(url).catch(() => notify('Não deu pra abrir o mapa', address))
}

function birthdayLabel(md) {
  if (!md) return null
  const [mm, dd] = md.split('-')
  return `${Number(dd)} de ${MONTHS[Number(mm) - 1]}`
}

/** Quadradinho com dia e mês do agendamento. */
function DateChip({ iso, muted }) {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z')
  return (
    <View style={{ width: 44, alignItems: 'center', paddingVertical: 4, borderRadius: radius.sm, backgroundColor: muted ? colors.paperSoft : colors.greenSoft }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: muted ? colors.inkSoft : colors.green }}>{d.getUTCDate()}</Text>
      <Text style={{ fontSize: 11, fontWeight: '600', color: muted ? colors.inkMuted : colors.green, textTransform: 'uppercase' }}>{MONTHS[d.getUTCMonth()]}</Text>
    </View>
  )
}

function Action({ icon, label, onPress, color = colors.green, bg = colors.greenSoft, disabled }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={{ alignItems: 'center', width: 68, opacity: disabled ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel={label}>
      {/* Só o círculo (sem outro botão dentro do botão: no web vira <button> aninhado) */}
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Small style={{ marginTop: 4, fontWeight: '500' }}>{label}</Small>
    </Pressable>
  )
}

export default function ClientDetail() {
  const { id } = useLocalSearchParams()
  const app = useApp()
  const { provider, settings } = app
  const isCleaning = provider?.vertical === 'cleaning'

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showMsgs, setShowMsgs] = useState(false)   // painel de mensagens prontas

  const load = useCallback(async ({ pull = false } = {}) => {
    if (!id) return
    if (pull) setRefreshing(true)
    setError(null)
    try {
      setData(await api(`/api/agenda/clients?id=${encodeURIComponent(String(id))}`))
    } catch (e) {
      setError(e)
    } finally {
      setRefreshing(false)
    }
  }, [id])

  useFocusEffect(useCallback(() => { load() }, [load]))

  // Orçamentos e faturas da cliente. null = carregando, false = sem a rota/erro (seção some)
  const [docs, setDocs] = useState(null)
  const canDocs = app.can('quotes') || app.can('invoices')
  const loadDocs = useCallback(async () => {
    if (!id) return
    try {
      const cid = encodeURIComponent(String(id))
      const [qs, inv] = await Promise.all([
        api(`/api/agenda/documents?kind=quote&status=all&client_id=${cid}`),
        api(`/api/agenda/documents?kind=invoice&status=all&client_id=${cid}`),
      ])
      const key = (d) => String(d.created_at || d.issue_date || '')
      setDocs([...(qs.documents || []), ...(inv.documents || [])].sort((a, b) => key(b).localeCompare(key(a))))
    } catch (_) {
      setDocs(false)
    }
  }, [id])

  useFocusEffect(useCallback(() => { loadDocs() }, [loadDocs]))

  const c = data?.client
  const st = data?.stats
  const edit = () => router.push({ pathname: '/client/edit', params: { id: String(id) } })

  const header = (
    <Stack.Screen options={{
      title: c ? firstName(c.name) : 'Cliente',
      headerRight: c ? () => (
        <Pressable onPress={edit} hitSlop={10} accessibilityLabel="Editar cliente">
          <Ionicons name="create-outline" size={23} color={colors.green} />
        </Pressable>
      ) : undefined,
    }} />
  )

  if (!data) {
    return (
      <Screen onRefresh={() => load({ pull: true })} refreshing={refreshing}>
        {header}
        {error ? (
          error.status === 404
            ? <Empty icon="person-outline" title="Cliente não encontrada" text="Ela pode ter sido excluída." action={<Button title="Voltar" variant="secondary" onPress={() => router.back()} />} />
            : <ErrorBox error={error} onRetry={() => load()} />
        ) : <Loading text="Abrindo a ficha…" />}
      </Screen>
    )
  }

  const lang = messageLang(c.language, app.can('multilang_messages'))
  const next = st.next_appointment
  const address = addressText(c)
  const today = todayKey()
  const upcoming = data.appointments.filter((a) => (a.status === 'pending' || a.status === 'confirmed') && String(a.scheduled_for).slice(0, 10) >= today)
    .sort((a, b) => (a.scheduled_for < b.scheduled_for ? -1 : 1))
  const upIds = new Set(upcoming.map((a) => a.id))
  const history = data.appointments.filter((a) => !upIds.has(a.id))
  const overdue = !next && st.expected_return && st.expected_return < today
  // first_visit_at é hora de parede (scheduled_for); created_at é instante real → data local
  const sinceKey = st.first_visit_at ? String(st.first_visit_at).slice(0, 7) : c.created_at ? dateKey(new Date(c.created_at)).slice(0, 7) : ''

  function vars() {
    return {
      nome: firstName(c.name),
      profissional: provider?.name,
      link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
      data: next ? msgDate(next.scheduled_for, lang) : '',
      hora: next ? msgTime(next.scheduled_for, lang) : '',
      servico: next?.service_name || st.favorite_service || '',
      endereco: address,
    }
  }

  // Modelos que fazem sentido na ficha (confirmar/lembrar só com horário marcado)
  const msgKeys = [
    ...(next ? ['confirm', 'reminder'] : []),
    'on_the_way', 'late', 'thanks', 'comeback', 'birthday',
    ...(isCleaning ? ['home_access'] : []),
  ]

  async function whatsapp(key) {
    if (!c.whatsapp) return notify('Sem WhatsApp', 'Cadastre o número na ficha pra mandar mensagem.')
    setShowMsgs(false)
    const ok = await openWhatsApp(c.whatsapp, key ? renderAny(key, lang, vars(), settings) : '')
    if (!ok) notify('WhatsApp não abriu', 'Confira se o WhatsApp está instalado no celular.')
  }

  async function newDoc(kind) {
    if (!(await ensureFeature(app, kind === 'invoice' ? 'invoices' : 'quotes'))) return
    router.push({ pathname: '/document/edit', params: { kind, client_id: c.id } })
  }

  async function makeRecurring() {
    if (!(await ensureFeature(app, 'recurring'))) return
    router.push({ pathname: '/recurring/edit', params: { client_id: c.id } })
  }

  async function unarchive() {
    if (!(await ensureFeature(app, 'clients'))) return
    setBusy(true)
    try {
      const r = await post('/api/agenda/clients', { action: 'unarchive', id: c.id })
      setData((d) => ({ ...d, client: { ...d.client, archived: r.client.archived } }))
    } catch (e) { showError(e) } finally { setBusy(false) }
  }

  return (
    <Screen onRefresh={() => load({ pull: true })} refreshing={refreshing}>
      {header}
      {error ? <ErrorBox error={error} onRetry={() => load()} /> : null}

      {/* Cabeçalho */}
      <Card style={{ alignItems: 'center' }}>
        <Avatar name={c.name} size={72} />
        <H2 style={{ marginTop: spacing.md, textAlign: 'center' }}>{c.name}</H2>
        {c.whatsapp ? <P style={{ color: colors.inkSoft, marginTop: 2 }} selectable>{fmtPhone(c.whatsapp)}</P> : <Muted style={{ marginTop: 2 }}>Sem WhatsApp cadastrado</Muted>}
        {c.email ? <Muted selectable>{c.email}</Muted> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: spacing.sm }}>
          <Badge text={LANG_SHORT[c.language] || 'Português'} tone="navy" icon="language-outline" />
          {c.archived ? <Badge text="Arquivada" tone="gray" icon="archive-outline" /> : null}
          {(c.tags || []).map((t) => <Badge key={t} text={t} tone="gold" />)}
        </View>
        {c.birthday_md ? <Muted style={{ marginTop: spacing.sm }}>Aniversário: {birthdayLabel(c.birthday_md)}</Muted> : null}

        <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
          <Action icon="logo-whatsapp" label="WhatsApp" color="#128C7E" bg="#E7F8EE" disabled={!c.whatsapp} onPress={() => setShowMsgs((v) => !v)} />
          <Action icon="call-outline" label="Ligar" disabled={!c.whatsapp} onPress={() => callPhone(c.whatsapp)} />
          <Action icon="chatbubble-ellipses-outline" label="SMS" disabled={!c.whatsapp} onPress={() => sendSms(c.whatsapp)} />
          {c.email ? <Action icon="mail-outline" label="E-mail" onPress={() => Linking.openURL(`mailto:${c.email}`).catch(() => {})} /> : null}
        </View>
      </Card>

      {showMsgs ? (
        <Card padded={false} style={{ marginTop: spacing.md }}>
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Small style={{ flex: 1, fontWeight: '600' }}>
              Mensagem no WhatsApp{lang !== 'pt' ? ` · em ${LANG_SHORT[lang]}` : ''}
            </Small>
            <Pressable onPress={() => setShowMsgs(false)} hitSlop={10} accessibilityLabel="Fechar">
              <Ionicons name="close" size={20} color={colors.inkMuted} />
            </Pressable>
          </View>
          <Row icon="create-outline" title="Escrever do zero" onPress={() => whatsapp('')} chevron />
          {msgKeys.map((k) => (
            <View key={k}>
              <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
              <Row icon="logo-whatsapp" iconColor="#128C7E" title={ALL_TEMPLATES[k].title}
                subtitle={renderAny(k, lang, vars(), settings)} onPress={() => whatsapp(k)} chevron />
            </View>
          ))}
        </Card>
      ) : null}

      {c.archived ? (
        <Card style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Ionicons name="archive-outline" size={20} color={colors.inkSoft} />
          <Muted style={{ flex: 1 }}>Ficha arquivada: não aparece nas listas.</Muted>
          <Button title="Desarquivar" small variant="secondary" full={false} loading={busy} onPress={unarchive} />
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Button title="Novo agendamento" icon="add-circle-outline"
          onPress={() => router.push({ pathname: '/appointment/new', params: { client_id: c.id } })} />
        <Button title="Tornar cliente fixa" icon={app.can('recurring') ? 'repeat-outline' : 'lock-closed-outline'} variant="secondary" onPress={makeRecurring} />
      </View>

      {/* Números */}
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <KPI label="Visitas" value={String(st.visits)} sub={sinceKey ? `cliente desde ${MONTHS[Number(sinceKey.slice(5, 7)) - 1]}/${sinceKey.slice(2, 4)}` : null} />
        <KPI label="Gasto total" value={fmtMoney(st.spent_cents)} tone="green" sub={st.tips_cents ? `+ ${fmtMoney(st.tips_cents)} de gorjeta` : null} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
        <KPI label="Ticket médio" value={fmtMoney(st.avg_ticket_cents)} />
        <KPI label="Faltas" value={String(st.no_shows)} sub={st.cancellations ? `${st.cancellations} cancelamento${st.cancellations === 1 ? '' : 's'}` : 'nenhum cancelamento'} />
      </View>

      {/* Ritmo */}
      {(next || st.return_every_days || st.favorite_service) ? (
        <Card padded={false} style={{ marginTop: spacing.md }}>
          {next ? (
            <Row icon="calendar-outline" title="Próximo horário" subtitle={`${fmtWhen(next.scheduled_for)}${next.service_name ? ' · ' + next.service_name : ''}`} chevron
              onPress={() => router.push(`/appointment/${next.id}`)} />
          ) : null}
          {st.return_every_days ? (
            <>
              {next ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
              <Row icon="repeat-outline" iconColor={overdue ? colors.warning : colors.green}
                title={`Costuma voltar a cada ${st.return_every_days} dias`}
                subtitle={next ? 'Já tem horário marcado.' : overdue
                  ? `Era pra ter voltado por volta de ${fmtDay(st.expected_return)}. Que tal chamar?`
                  : `Próxima visita esperada: ${fmtDay(st.expected_return)}`}
                right={overdue && c.whatsapp ? <Button title="Chamar" small variant="whatsapp" full={false} onPress={() => whatsapp('comeback')} /> : null} />
            </>
          ) : null}
          {st.favorite_service ? (
            <>
              {(next || st.return_every_days) ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
              <Row icon="heart-outline" title="Serviço preferido" subtitle={st.favorite_service} />
            </>
          ) : null}
        </Card>
      ) : null}

      {/* Orçamentos e faturas */}
      {docs !== false && (canDocs || (docs && docs.length)) ? (
        <Section title="Orçamentos e faturas">
          <Card padded={false}>
            {docs && docs.length ? docs.slice(0, 5).map((d, i) => (
              <View key={d.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                <Row title={`${d.number || docKindLabel(d.kind)}${d.title ? ' · ' + d.title : ''}`}
                  subtitle={`${d.issue_date ? fmtDay(String(d.issue_date).slice(0, 10)) + ' · ' : ''}${fmtMoney(d.total_cents || 0)}${d.kind === 'invoice' && Number(d.balance_cents) > 0 && d.status !== 'draft' && d.status !== 'void' ? ` · falta ${fmtMoney(d.balance_cents)}` : ''}`}
                  right={<DocStatusBadge kind={d.kind} status={d.status} />}
                  onPress={() => router.push(`/document/${d.id}`)} />
              </View>
            )) : (
              <Muted style={{ padding: spacing.lg }}>{docs ? 'Nenhum orçamento ou fatura pra ela ainda.' : 'Carregando…'}</Muted>
            )}
          </Card>
          {docs && docs.length > 5 ? <Muted style={{ marginTop: spacing.xs, marginLeft: 2 }}>Mostrando os 5 mais recentes de {docs.length}.</Muted> : null}
          {canDocs ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button small title="Novo orçamento" icon="document-text-outline" variant="secondary" style={{ flex: 1 }} onPress={() => newDoc('quote')} />
              <Button small title="Nova fatura" icon="receipt-outline" variant="secondary" style={{ flex: 1 }} onPress={() => newDoc('invoice')} />
            </View>
          ) : null}
        </Section>
      ) : null}

      {/* Observações */}
      <Section title="Observações" right={<Pressable onPress={edit} hitSlop={8}><Small style={{ color: colors.green, fontWeight: '600' }}>Editar</Small></Pressable>}>
        <Card>
          {c.notes ? <P selectable>{c.notes}</P>
            : <Muted>Nada anotado. Guarde aqui alergias, preferências, fórmula da cor, o que ela gosta de conversar…</Muted>}
        </Card>
      </Section>

      {/* Casa */}
      {(isCleaning || address || c.home_notes) ? (
        <Section title="Casa">
          <Card>
            {address ? (
              <>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Ionicons name="location-outline" size={18} color={colors.green} style={{ marginTop: 2 }} />
                  <P style={{ flex: 1 }} selectable>{address}</P>
                </View>
                <Button title="Abrir no mapa" icon="navigate-outline" small variant="secondary" onPress={() => openMap(address)} style={{ marginTop: spacing.md }} />
              </>
            ) : <Muted>Sem endereço. Toque em editar pra cadastrar.</Muted>}
            {c.home_notes ? (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Ionicons name="key-outline" size={18} color={colors.goldDark} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={type.label}>Acesso e cuidados</Text>
                    <P style={{ marginTop: 4 }} selectable>{c.home_notes}</P>
                  </View>
                </View>
              </>
            ) : null}
            {isCleaning && c.whatsapp && (!address || !c.home_notes) ? (
              <Button title="Pedir endereço e acesso" icon="logo-whatsapp" small variant="ghost" onPress={() => whatsapp('home_access')} style={{ marginTop: spacing.sm }} />
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* Agendamentos */}
      {upcoming.length ? (
        <Section title="Próximos">
          <Card padded={false}>
            {upcoming.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 72 }} /> : null}
                <Row left={<DateChip iso={a.scheduled_for} />} title={a.service_name || 'Atendimento'}
                  subtitle={`${fmtWhen(a.scheduled_for)} · ${fmtMoney(a.total_cents)}`} right={<StatusBadge status={a.status} />}
                  onPress={() => router.push(`/appointment/${a.id}`)} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Histórico">
        {history.length ? (
          <Card padded={false}>
            {history.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 72 }} /> : null}
                <Row left={<DateChip iso={a.scheduled_for} muted />} title={a.service_name || 'Atendimento'}
                  subtitle={`${fmtDay(a.scheduled_for)} · ${fmtMoney(a.paid_cents || a.total_cents)}${a.tip_cents ? ` + ${fmtMoney(a.tip_cents)} gorjeta` : ''}`}
                  right={<StatusBadge status={a.status} />}
                  onPress={() => router.push(`/appointment/${a.id}`)} />
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Muted style={{ textAlign: 'center' }}>{upcoming.length ? 'O primeiro atendimento ainda vai acontecer.' : 'Nenhum atendimento ainda.'}</Muted>
          </Card>
        )}
        {data.appointments.length >= 50 ? <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>Mostrando os 50 mais recentes.</Muted> : null}
      </Section>

      <Button title="Editar ficha" icon="create-outline" variant="secondary" onPress={edit} style={{ marginTop: spacing.xl }} />
      {c.created_at ? <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>Ficha criada em {fmtDay(dateKey(new Date(c.created_at)))}</Muted> : null}
    </Screen>
  )
}
