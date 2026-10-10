// Turnover de Airbnb, Vrbo e Booking: casas sincronizadas pelo calendário .ics.
// A limpeza entra sozinha na agenda no dia do checkout (sincroniza de hora em hora).
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, openPlans, showError } from '../../lib/gate'
import { notify } from '../../lib/dialog'
import { fmtAgo, fmtDuration, fmtMoney } from '../../lib/format'
import { openWhatsApp } from '../../lib/whatsapp'
import { colors, radius, spacing } from '../../lib/theme'
import Locked from '../../components/Locked'
import { Badge, Banner, Button, Card, Empty, ErrorBox, Fab, H3, Label, Loading, Muted, P, Screen, Section, Segmented, Small } from '../../components/ui'

const SOURCES = {
  airbnb: { label: 'Airbnb', tone: 'red' },
  vrbo: { label: 'Vrbo', tone: 'navy' },
  booking: { label: 'Booking', tone: 'blue' },
  outro: { label: 'Outro', tone: 'gray' },
}

const HOW_TO = {
  airbnb: [
    'No app ou site do Airbnb, entre como anfitrião e abra Anúncios.',
    'Escolha a casa e vá em Disponibilidade (ou Calendário).',
    'Toque em "Conectar calendários" / "Sincronizar calendários".',
    'Escolha "Exportar calendário" e copie o link (termina em .ics).',
  ],
  vrbo: [
    'Entre no painel do Vrbo e abra o Calendário da casa.',
    'Vá em "Importar/Exportar" ou "Sincronizar calendários".',
    'Escolha "Exportar" e copie o link do calendário (.ics).',
  ],
  booking: [
    'No Extranet do Booking.com, abra Tarifas e disponibilidade.',
    'Entre em "Sincronizar calendários".',
    'Escolha "Exportar calendário" e copie o link (.ics).',
  ],
}

const ASK_HOST = 'Oi! Pra eu organizar as limpezas da casa automaticamente no dia de cada checkout, você me manda o link de "exportar calendário" (.ics) do anúncio? No Airbnb fica em Calendário > Disponibilidade > Conectar calendários > Exportar calendário. Obrigada!'

/** Resumo do resultado de uma sincronização. */
function syncSummary(sync) {
  if (!sync) return ''
  if (sync.ok === false) return `Não deu pra ler o calendário: ${sync.error || 'erro desconhecido'}`
  const parts = []
  if (sync.created) parts.push(`${sync.created} limpeza${sync.created > 1 ? 's' : ''} nova${sync.created > 1 ? 's' : ''}`)
  if (sync.updated) parts.push(`${sync.updated} atualizada${sync.updated > 1 ? 's' : ''}`)
  if (sync.canceled) parts.push(`${sync.canceled} cancelada${sync.canceled > 1 ? 's' : ''} (reserva saiu do calendário)`)
  const head = parts.length ? parts.join(', ') + '.' : 'Tudo em dia, nada mudou.'
  return `${head} ${sync.reservations || 0} reserva${sync.reservations === 1 ? '' : 's'} por vir.`
}

export default function TurnoverScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Turnover' }} />
      <Locked feature="turnover_ical"><Turnover /></Locked>
    </>
  )
}

function Turnover() {
  const app = useApp()
  const insets = useSafeAreaInsets()
  const [feeds, setFeeds] = useState(null)
  const [max, setMax] = useState(undefined)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(null)
  const [howTo, setHowTo] = useState('airbnb')

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/ical')
      setFeeds(r.feeds || [])
      setMax(r.max_feeds)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const count = feeds ? feeds.length : 0
  const limit = max === undefined ? app.limit('ical_feeds') : max
  const atLimit = limit !== null && count >= limit
  const overLimit = limit !== null && count > limit
  const tierName = app.ent.catalog?.plans?.[app.ent.tier]?.name || ''
  const proMax = app.ent.catalog?.limits?.pro?.ical_feeds ?? 15
  const upsell = app.ent.tier === 'starter'
    ? `O plano Pro sincroniza até ${proMax} casas e o Premium, sem limite.`
    : 'O plano Premium sincroniza casas sem limite.'

  async function add() {
    if (!(await ensureFeature(app, 'turnover_ical'))) return
    if (atLimit) {
      showError({ code: 'limit_reached', message: `Seu plano${tierName ? ` ${tierName}` : ''} sincroniza até ${limit} casa${limit === 1 ? '' : 's'}. Um plano maior libera mais.`, feature: 'turnover_ical' })
      return
    }
    router.push('/turnover/edit')
  }

  async function sync(feed) {
    if (!(await ensureFeature(app, 'turnover_ical'))) return
    // Casa fora do limite do plano (depois de descer de plano): o servidor recusa
    if (feed.within_limit === false) {
      showError({ code: 'limit_reached', message: `Seu plano${tierName ? ` ${tierName}` : ''} sincroniza ${limit} casa${limit === 1 ? '' : 's'} (as primeiras que você cadastrou) e essa ficou de fora. Remova uma casa pra abrir espaço ou veja os planos.`, feature: 'turnover_ical' })
      return
    }
    setSyncing(feed.id)
    try {
      const r = await post('/api/agenda/ical', { action: 'sync', id: feed.id })
      if (r.feed) setFeeds((cur) => (cur || []).map((f) => (f.id === feed.id ? r.feed : f)))
      notify(feed.label, syncSummary(r.sync))
    } catch (e) {
      showError(e)
    } finally {
      setSyncing(null)
    }
  }

  if (!feeds && !error) {
    return <Screen><Loading text="Carregando casas…" /></Screen>
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={() => load(true)} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => load()} />

        <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name="sparkles-outline" size={20} color={colors.green} />
            <H3 style={{ color: colors.greenDark }}>Limpeza que se agenda sozinha</H3>
          </View>
          <P style={{ color: colors.greenDark, marginTop: spacing.sm }}>
            Cole o calendário de cada casa. No dia do checkout a limpeza entra na sua agenda, no horário de saída. Reserva cancelada sai sozinha. Atualiza de hora em hora.
          </P>
        </Card>

        {feeds ? (
          <View style={st.planLine}>
            <Muted>
              {limit === null ? `${count} casa${count === 1 ? '' : 's'} · sem limite no seu plano`
                : overLimit ? `${count} casas · seu plano${tierName ? ` ${tierName}` : ''} sincroniza ${limit}`
                : `${count} de ${limit} casa${limit === 1 ? '' : 's'} do seu plano${tierName ? ` ${tierName}` : ''}`}
            </Muted>
            {atLimit ? <Badge text="Limite" tone="gold" icon="lock-closed" /> : null}
          </View>
        ) : null}
        {atLimit ? (
          <Banner tone="gold" icon="arrow-up-circle-outline" action="Ver planos" onPress={() => openPlans('turnover_ical')}
            text={overLimit
              ? `Só ${limit === 1 ? 'a primeira casa sincroniza' : `as ${limit} primeiras casas sincronizam`}. As outras ficam paradas até você remover alguma. ${upsell}`
              : `Você chegou no limite de casas. ${upsell}`} />
        ) : null}

        {feeds && feeds.length === 0 ? (
          <Card style={{ marginTop: spacing.md }}>
            <Empty icon="home-outline" title="Nenhuma casa ainda"
              text="Adicione a primeira casa com o link do calendário (.ics). Não sabe onde pegar? Veja o passo a passo abaixo."
              action={<Button title="Adicionar casa" icon="add" onPress={add} />} />
          </Card>
        ) : null}

        {(feeds || []).map((f) => (
          <FeedCard key={f.id} feed={f} syncing={syncing === f.id} onSync={() => sync(f)}
            onEdit={() => router.push({ pathname: '/turnover/edit', params: { id: f.id } })} />
        ))}

        <Section title="Como pegar o link do calendário">
          <Card>
            <Segmented value={howTo} onChange={setHowTo} style={{ marginBottom: spacing.md }}
              options={[{ value: 'airbnb', label: 'Airbnb' }, { value: 'vrbo', label: 'Vrbo' }, { value: 'booking', label: 'Booking' }]} />
            {HOW_TO[howTo].map((step, i) => (
              <View key={i} style={st.step}>
                <View style={st.stepNum}><Small style={{ color: colors.white, fontWeight: '700' }}>{i + 1}</Small></View>
                <P style={{ flex: 1 }}>{step}</P>
              </View>
            ))}
            <View style={st.step}>
              <View style={st.stepNum}><Small style={{ color: colors.white, fontWeight: '700' }}>{HOW_TO[howTo].length + 1}</Small></View>
              <P style={{ flex: 1 }}>Aqui no AgendaPro, toque em + e cole o link.</P>
            </View>
            <View style={st.tip}>
              <Label style={{ marginBottom: 4 }}>Não é sua a casa?</Label>
              <Muted>Peça o link pra dona ou o dono do anúncio. A gente já deixou a mensagem pronta.</Muted>
              <Button title="Pedir o link no WhatsApp" variant="whatsapp" icon="logo-whatsapp" small full={false}
                onPress={() => openWhatsApp('', ASK_HOST)} style={{ marginTop: spacing.sm }} />
            </View>
            <Muted style={{ marginTop: spacing.md }}>
              O link mostra só o calendário de reservas da casa. Ele fica guardado em segurança e não aparece inteiro no app.
            </Muted>
          </Card>
        </Section>
      </Screen>
      {feeds && feeds.length > 0 ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { bottom: insets.bottom }]}>
          <Fab onPress={add} label="Adicionar casa" />
        </View>
      ) : null}
    </View>
  )
}

function FeedCard({ feed, syncing, onSync, onEdit }) {
  const src = SOURCES[feed.source] || SOURCES.outro
  const err = feed.last_status === 'error'
  const out = feed.within_limit === false
  return (
    <Card onPress={onEdit} style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <H3 style={{ flex: 1 }} numberOfLines={1}>{feed.label}</H3>
        <Badge text={src.label} tone={src.tone} />
      </View>
      {feed.url_hint ? <Muted numberOfLines={1} style={{ marginTop: 2 }}>{feed.url_hint}</Muted> : null}

      <View style={st.facts}>
        <Fact icon="log-out-outline" text={`Checkout ${feed.checkout_time}`} />
        <Fact icon="time-outline" text={fmtDuration(feed.duration_min)} />
        <Fact icon="cash-outline" text={feed.price_cents ? fmtMoney(feed.price_cents) : 'Sem valor'} />
      </View>

      {out ? (
        <View style={[st.status, { backgroundColor: colors.goldSoft }]}>
          <Ionicons name="lock-closed" size={16} color={colors.goldDark} />
          <Small style={{ flex: 1, color: colors.goldDark }}>
            Fora do limite do seu plano: essa casa não sincroniza.
          </Small>
        </View>
      ) : err ? (
        <View style={[st.status, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Small style={{ flex: 1, color: colors.danger }} numberOfLines={3}>
            {feed.last_error || 'Não deu pra ler o calendário.'}{feed.last_synced_at ? ` (${fmtAgo(feed.last_synced_at)})` : ''}
          </Small>
        </View>
      ) : feed.last_synced_at ? (
        <View style={[st.status, { backgroundColor: colors.successSoft }]}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Small style={{ flex: 1, color: colors.success }}>
            Sincronizado {fmtAgo(feed.last_synced_at)} · {feed.reservations_count || 0} reserva{feed.reservations_count === 1 ? '' : 's'} por vir
          </Small>
        </View>
      ) : (
        <View style={[st.status, { backgroundColor: colors.paperSoft }]}>
          <Ionicons name="hourglass-outline" size={16} color={colors.inkSoft} />
          <Small style={{ flex: 1 }}>Ainda não sincronizou.</Small>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Button title="Sincronizar agora" icon={out ? 'lock-closed-outline' : 'refresh'} variant="secondary" small full={false} loading={syncing} onPress={onSync} />
        <Button title="Editar" icon="create-outline" variant="ghost" small full={false} onPress={onEdit} />
      </View>
    </Card>
  )
}

function Fact({ icon, text }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={14} color={colors.inkSoft} />
      <Small>{text}</Small>
    </View>
  )
}

const st = StyleSheet.create({
  planLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.xs, paddingHorizontal: 2 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: spacing.sm, borderRadius: radius.sm, marginTop: spacing.md },
  step: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tip: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.paperSoft },
})
