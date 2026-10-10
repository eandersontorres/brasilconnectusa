// Serviços e preços: lista (ativos e pausados), ordem da página pública e
// sugestões por especialidade pra quem está começando.
import { useCallback, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, openPlans, showError } from '../../lib/gate'
import { fmtDuration, fmtMoney } from '../../lib/format'
import { colors, spacing } from '../../lib/theme'
import { Badge, Banner, Button, Card, Divider, Empty, ErrorBox, Fab, IconButton, Label, Loading, Muted, Row, Screen, Section } from '../../components/ui'

// ── Sugestões por especialidade (preços de referência, a profissional ajusta) ──
const SUGGESTIONS = [
  { match: /cabel|hair|cabelo/i, label: 'cabeleireira', items: [
    { name: 'Corte feminino', category: 'Cabelo', duration_min: 60, price_cents: 6000 },
    { name: 'Escova', category: 'Cabelo', duration_min: 45, price_cents: 4500 },
    { name: 'Coloração', category: 'Cabelo', duration_min: 120, price_cents: 12000 },
  ] },
  { match: /manic|pedic|unha|nail/i, label: 'manicure', items: [
    { name: 'Manicure', category: 'Mãos', duration_min: 45, price_cents: 3000 },
    { name: 'Pedicure', category: 'Pés', duration_min: 60, price_cents: 4000 },
    { name: 'Unha em gel', category: 'Mãos', duration_min: 90, price_cents: 6000 },
  ] },
  { match: /lash|c[ií]lio/i, label: 'lash designer', items: [
    { name: 'Extensão de cílios fio a fio', category: 'Cílios', duration_min: 120, price_cents: 15000 },
    { name: 'Manutenção de cílios', category: 'Cílios', duration_min: 60, price_cents: 7000 },
    { name: 'Lash lifting', category: 'Cílios', duration_min: 60, price_cents: 8500 },
  ] },
  { match: /sobrancel|brow/i, label: 'design de sobrancelha', items: [
    { name: 'Design de sobrancelha', category: 'Sobrancelha', duration_min: 30, price_cents: 2500 },
    { name: 'Design com henna', category: 'Sobrancelha', duration_min: 45, price_cents: 3500 },
    { name: 'Brow lamination', category: 'Sobrancelha', duration_min: 60, price_cents: 7000 },
  ] },
  { match: /estetic|estétic|facial|pele/i, label: 'esteticista', items: [
    { name: 'Limpeza de pele', category: 'Estética', duration_min: 60, price_cents: 8000 },
    { name: 'Peeling', category: 'Estética', duration_min: 60, price_cents: 10000 },
    { name: 'Drenagem linfática', category: 'Corpo', duration_min: 60, price_cents: 9000 },
  ] },
  { match: /barb/i, label: 'barbeiro', items: [
    { name: 'Corte masculino', category: 'Cabelo', duration_min: 30, price_cents: 3000 },
    { name: 'Barba', category: 'Barba', duration_min: 30, price_cents: 2000 },
    { name: 'Corte + barba', category: 'Cabelo', duration_min: 60, price_cents: 4500 },
  ] },
  { match: /massag/i, label: 'massagista', items: [
    { name: 'Massagem relaxante', category: 'Massagem', duration_min: 60, price_cents: 9000 },
    { name: 'Massagem terapêutica', category: 'Massagem', duration_min: 60, price_cents: 10000 },
    { name: 'Drenagem linfática', category: 'Massagem', duration_min: 60, price_cents: 9000 },
  ] },
  { match: /maqui|make/i, label: 'maquiadora', items: [
    { name: 'Maquiagem social', category: 'Maquiagem', duration_min: 60, price_cents: 9000 },
    { name: 'Maquiagem de noiva', category: 'Maquiagem', duration_min: 120, price_cents: 25000 },
    { name: 'Penteado', category: 'Cabelo', duration_min: 60, price_cents: 8000 },
  ] },
  { match: /personal|trainer|treino/i, label: 'personal trainer', items: [
    { name: 'Aula individual', category: 'Treino', duration_min: 60, price_cents: 6000 },
    { name: 'Avaliação física', category: 'Treino', duration_min: 45, price_cents: 5000 },
    { name: 'Aula em dupla', category: 'Treino', duration_min: 60, price_cents: 9000 },
  ] },
  { match: /limp|clean|faxin|airbnb|diarista/i, label: 'limpeza', items: [
    { name: 'Limpeza padrão', category: 'Limpeza', duration_min: 180, price_cents: 15000 },
    { name: 'Limpeza pesada', category: 'Limpeza', duration_min: 300, price_cents: 28000 },
    { name: 'Turnover (Airbnb)', category: 'Limpeza', duration_min: 180, price_cents: 12000 },
  ] },
]
const GENERIC = { label: 'você', items: [
  { name: 'Atendimento', category: null, duration_min: 60, price_cents: 5000 },
  { name: 'Atendimento rápido', category: null, duration_min: 30, price_cents: 3000 },
  { name: 'Atendimento completo', category: null, duration_min: 90, price_cents: 8000 },
] }

function suggestionsFor(provider) {
  const spec = String(provider?.specialty || '')
  const found = SUGGESTIONS.find((s) => s.match.test(spec))
  if (found) return found
  if (provider?.vertical === 'cleaning') return SUGGESTIONS[SUGGESTIONS.length - 1]
  return GENERIC
}

const tick = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}) }

export default function Services() {
  const app = useApp()
  const insets = useSafeAreaInsets()
  const [services, setServices] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/services?mine=1')
      setServices(r.services || [])
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  // Recarrega ao voltar da edição
  useFocusEffect(useCallback(() => { load() }, [load]))

  const list = services || []
  const active = list.filter((s) => s.active !== false)
  const paused = list.filter((s) => s.active === false)
  const locked = !app.can('services')

  async function newService() {
    if (!(await ensureFeature(app, 'services'))) return
    router.push('/services/edit')
  }

  const open = (s) => router.push({ pathname: '/services/edit', params: { id: s.id } })

  async function move(id, dir) {
    if (!(await ensureFeature(app, 'services'))) return
    const i = active.findIndex((s) => s.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= active.length) return
    const nextActive = active.slice()
    ;[nextActive[i], nextActive[j]] = [nextActive[j], nextActive[i]]
    const prev = services
    const next = [...nextActive, ...paused].map((s, k) => ({ ...s, display_order: k }))
    setServices(next)
    tick()
    const my = ++seq.current
    try {
      const r = await post('/api/agenda/services', { action: 'reorder', ids: next.map((s) => s.id) })
      if (my === seq.current && r.services) setServices(r.services)
    } catch (e) {
      if (my === seq.current) setServices(prev)
      showError(e)
    }
  }

  async function reactivate(s) {
    if (!(await ensureFeature(app, 'services'))) return
    setBusyId(s.id)
    try {
      const r = await post('/api/agenda/services', { action: 'set_active', id: s.id, active: true })
      setServices((cur) => (cur || []).map((x) => (x.id === s.id ? { ...x, ...r.service } : x)))
    } catch (e) {
      showError(e)
    } finally {
      setBusyId(null)
    }
  }

  async function createSuggested() {
    if (!(await ensureFeature(app, 'services'))) return
    const sug = suggestionsFor(app.provider)
    setSeeding(true)
    try {
      const r = await post('/api/agenda/services', { action: 'create_many', services: sug.items })
      setServices(r.services || [])
      load()
    } catch (e) {
      showError(e)
    } finally {
      setSeeding(false)
    }
  }

  // ── Estados ──────────────────────────────────────────────────────────────
  if (!services && !error) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Serviços e preços' }} />
        <Loading text="Carregando serviços…" />
      </Screen>
    )
  }

  const sug = suggestionsFor(app.provider)

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Serviços e preços' }} />
      <Screen onRefresh={() => load(true)} refreshing={refreshing}>
        {locked ? (
          <Banner tone="orange" icon="lock-closed-outline" action="Ver planos" onPress={() => openPlans('services')}
            text={app.ent.tier === 'none' ? 'Seu plano não está ativo. Você vê seus serviços, mas pra criar ou mudar precisa de um plano ativo.' : 'Serviços fazem parte de outro plano.'} />
        ) : null}
        <ErrorBox error={error} onRetry={() => load()} />

        {services && list.length === 0 ? (
          <>
            <Empty icon="pricetags-outline" title="Monte seu cardápio de serviços"
              text="É o que suas clientes escolhem na sua página. Comece com uma sugestão e ajuste nome, tempo e preço quando quiser." />
            <Card>
              <Label style={{ marginBottom: spacing.sm }}>Sugestão pra {sug.label}</Label>
              {sug.items.map((s, i) => (
                <View key={s.name}>
                  {i > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                  <Row style={{ paddingHorizontal: 0 }} title={s.name} subtitle={`${fmtDuration(s.duration_min)} · ${fmtMoney(s.price_cents)}`} />
                </View>
              ))}
              <Button title="Criar estes 3 serviços" icon="sparkles-outline" onPress={createSuggested} loading={seeding} style={{ marginTop: spacing.md }} />
              <Button title="Prefiro criar do zero" variant="ghost" onPress={newService} style={{ marginTop: spacing.sm }} />
            </Card>
            <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>Os preços são só referência. Você muda tudo depois.</Muted>
          </>
        ) : null}

        {active.length > 0 ? (
          <Section title={`Na sua página (${active.length})`} style={{ marginTop: spacing.sm }}>
            <Muted style={{ marginBottom: spacing.sm }}>A ordem aqui é a ordem que a cliente vê. Use as setas pra mudar.</Muted>
            <Card padded={false}>
              {active.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <Row
                    title={s.name}
                    subtitle={<ServiceMeta s={s} />}
                    onPress={() => open(s)}
                    right={
                      <View style={st.arrows}>
                        <Arrow icon="chevron-up" disabled={i === 0} onPress={() => move(s.id, -1)} label={`Subir ${s.name}`} />
                        <Arrow icon="chevron-down" disabled={i === active.length - 1} onPress={() => move(s.id, 1)} label={`Descer ${s.name}`} />
                      </View>
                    }
                  />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {paused.length > 0 ? (
          <Section title={`Pausados (${paused.length})`}>
            <Muted style={{ marginBottom: spacing.sm }}>Não aparecem na página, mas continuam no histórico.</Muted>
            <Card padded={false}>
              {paused.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <Row
                    title={s.name}
                    subtitle={<ServiceMeta s={s} />}
                    onPress={() => open(s)}
                    right={busyId === s.id ? <Loading style={{ padding: 0 }} /> : (
                      <IconButton icon="play" label={`Reativar ${s.name}`} onPress={() => reactivate(s)} size={36} />
                    )}
                  />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {list.length > 0 ? (
          <Card style={{ marginTop: spacing.xl, flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.goldSoft }}
            onPress={() => router.push('/deposit')}>
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.goldDark} />
            <View style={{ flex: 1 }}>
              <Muted style={{ color: colors.goldDark, fontWeight: '600' }}>Cansada de cliente que falta?</Muted>
              <Muted style={{ color: colors.goldDark }}>Peça um sinal nos serviços mais longos. Veja como receber.</Muted>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.goldDark} />
          </Card>
        ) : null}
      </Screen>
      {list.length > 0 || error ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { bottom: insets.bottom }]}>
          <Fab onPress={newService} label="Novo serviço" />
        </View>
      ) : null}
    </View>
  )
}

function ServiceMeta({ s }) {
  return (
    <View style={st.meta}>
      <Muted>{fmtDuration(s.duration_min)} · {fmtMoney(s.price_cents)}{s.category ? ` · ${s.category}` : ''}</Muted>
      {s.deposit_cents > 0 ? <Badge text={`Sinal ${fmtMoney(s.deposit_cents)}`} tone="gold" /> : null}
    </View>
  )
}

function Arrow({ icon, onPress, disabled, label }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [st.arrow, disabled && { opacity: 0.25 }, pressed && { backgroundColor: colors.greenSoft }]}>
      <Ionicons name={icon} size={18} color={colors.green} />
    </Pressable>
  )
}

const st = StyleSheet.create({
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  arrows: { gap: 2 },
  arrow: { width: 32, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
})
