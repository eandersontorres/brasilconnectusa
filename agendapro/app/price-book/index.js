// Tabela de preços: serviços, mão de obra, materiais e taxas salvos pra montar o
// orçamento em segundos. Agrupada por tipo, com ordem (setas), pausados à parte e
// exemplos da especialidade pra quem está começando.
import { useCallback, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { fmtMoney } from '../../lib/format'
import { ITEM_KINDS } from '../../lib/docCalc'
import { KIND_GROUPS, unitLabel } from '../../lib/documents'
import { colors, spacing } from '../../lib/theme'
import { Badge, Button, Card, Divider, Empty, ErrorBox, Fab, IconButton, Input, Loading, Muted, Row, Screen, Section } from '../../components/ui'
import Locked from '../../components/Locked'

const tick = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}) }
const kindOf = (x) => (ITEM_KINDS.includes(x.kind) ? x.kind : 'other')
const byOrder = (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')

export default function PriceBookScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Tabela de preços' }} />
      <Locked feature="price_book"><PriceBook /></Locked>
    </>
  )
}

function PriceBook() {
  const app = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [q, setQ] = useState('')
  const seq = useRef(0)

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/catalog')
      setItems(Array.isArray(r.items) ? r.items : [])
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  // Recarrega ao voltar da edição
  useFocusEffect(useCallback(() => { load() }, [load]))

  const all = items || []
  const active = all.filter((x) => x.active !== false).sort(byOrder)
  const paused = all.filter((x) => x.active === false).sort(byOrder)
  const term = q.trim().toLowerCase()
  const match = (x) => !term || String(x.name || '').toLowerCase().includes(term) || String(x.description || '').toLowerCase().includes(term)
  const groups = ITEM_KINDS.map((k) => ({ kind: k, list: active.filter((x) => kindOf(x) === k && match(x)) })).filter((g) => g.list.length)
  const pausedShown = paused.filter(match)
  const specialty = String(app.provider?.specialty || '').trim()

  const open = (x) => router.push({ pathname: '/price-book/edit', params: { id: x.id } })

  async function newItem() {
    if (!(await ensureFeature(app, 'price_book'))) return
    router.push('/price-book/edit')
  }

  /** Sobe/desce dentro do mesmo tipo; a ordem vale pra lista toda (POST reorder). */
  async function move(item, dir) {
    if (!(await ensureFeature(app, 'price_book'))) return
    const ordered = active.slice()
    const group = ordered.filter((x) => kindOf(x) === kindOf(item))
    const neighbor = group[group.indexOf(item) + dir]
    if (!neighbor) return
    const i = ordered.indexOf(item)
    const j = ordered.indexOf(neighbor)
    ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
    const next = [...ordered, ...paused].map((x, k) => ({ ...x, display_order: k }))
    const prev = items
    setItems(next)
    tick()
    const my = ++seq.current
    try {
      const r = await post('/api/agenda/catalog', { action: 'reorder', ids: next.map((x) => x.id) })
      if (my === seq.current && Array.isArray(r?.items)) setItems(r.items)
    } catch (e) {
      if (my === seq.current) setItems(prev)
      showError(e)
    }
  }

  async function setActive(item, value) {
    if (!(await ensureFeature(app, 'price_book'))) return
    setBusyId(item.id)
    try {
      const r = await post('/api/agenda/catalog', { action: 'update', id: item.id, active: value })
      setItems((cur) => (cur || []).map((x) => (x.id === item.id ? { ...x, ...(r?.item || {}), active: value } : x)))
    } catch (e) {
      showError(e)
    } finally {
      setBusyId(null)
    }
  }

  async function seed() {
    if (!(await ensureFeature(app, 'price_book'))) return
    setSeeding(true)
    try {
      const r = await post('/api/agenda/catalog', { action: 'seed', specialty: specialty.slice(0, 80) })
      if (Array.isArray(r?.items)) setItems(r.items)
      load()
    } catch (e) {
      showError(e)
    } finally {
      setSeeding(false)
    }
  }

  if (!items && !error) return <Screen><Loading text="Carregando sua tabela…" /></Screen>

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Screen onRefresh={() => load(true)} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => load()} />

        {items && !all.length ? (
          <>
            <Empty icon="pricetags-outline" title="Sua tabela de preços"
              text="Salve uma vez o que você cobra (serviço, hora de trabalho, material, taxa de visita) e monte orçamentos e faturas em segundos." />
            <Card>
              <Button title={specialty ? `Começar com exemplos de ${specialty}` : 'Começar com exemplos'} icon="sparkles-outline" onPress={seed} loading={seeding} />
              <Button title="Criar do zero" variant="ghost" onPress={newItem} style={{ marginTop: spacing.sm }} />
            </Card>
            <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>Os preços dos exemplos são só referência. Você ajusta tudo depois.</Muted>
          </>
        ) : null}

        {all.length > 8 ? (
          <Input placeholder="Buscar na tabela" value={q} onChangeText={setQ} autoCorrect={false} maxLength={60} style={{ marginBottom: spacing.sm }}
            right={q ? (
              <Pressable onPress={() => setQ('')} hitSlop={10} style={{ paddingHorizontal: spacing.md }} accessibilityLabel="Limpar busca">
                <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
              </Pressable>
            ) : <Ionicons name="search" size={18} color={colors.inkMuted} style={{ paddingHorizontal: spacing.md }} />} />
        ) : null}

        {all.length && active.length ? <Muted style={{ marginBottom: spacing.xs }}>A ordem aqui é a ordem na hora de escolher no orçamento. Use as setas pra mudar.</Muted> : null}

        {groups.map((g) => (
          <Section key={g.kind} title={`${KIND_GROUPS[g.kind]} (${g.list.length})`} style={{ marginTop: spacing.lg }}>
            <Card padded={false}>
              {g.list.map((x, i) => (
                <View key={x.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <Row title={x.name} subtitle={<ItemMeta x={x} />} onPress={() => open(x)}
                    right={term ? null : (
                      <View style={st.arrows}>
                        <Arrow icon="chevron-up" disabled={i === 0} onPress={() => move(x, -1)} label={`Subir ${x.name}`} />
                        <Arrow icon="chevron-down" disabled={i === g.list.length - 1} onPress={() => move(x, 1)} label={`Descer ${x.name}`} />
                      </View>
                    )} />
                </View>
              ))}
            </Card>
          </Section>
        ))}
        {term && !groups.length && !pausedShown.length && all.length ? <Empty icon="search-outline" title="Nada encontrado" text={`Nenhum item com "${q.trim()}".`} /> : null}

        {pausedShown.length ? (
          <Section title={`Pausados (${pausedShown.length})`}>
            <Muted style={{ marginBottom: spacing.sm }}>Não aparecem na hora de montar o orçamento.</Muted>
            <Card padded={false}>
              {pausedShown.map((x, i) => (
                <View key={x.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <Row title={x.name} subtitle={<ItemMeta x={x} />} onPress={() => open(x)}
                    right={busyId === x.id ? <Loading style={{ padding: 0 }} /> : (
                      <IconButton icon="play" label={`Reativar ${x.name}`} onPress={() => setActive(x, true)} size={36} />
                    )} />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {all.length ? (
          <Button title={specialty ? `Adicionar exemplos de ${specialty}` : 'Adicionar exemplos'} icon="sparkles-outline" variant="ghost"
            onPress={seed} loading={seeding} style={{ marginTop: spacing.xl }} />
        ) : null}
        <View style={{ height: 72 }} />
      </Screen>
      {all.length || error ? <Fab onPress={newItem} label="Novo item" /> : null}
    </View>
  )
}

function ItemMeta({ x }) {
  return (
    <View style={{ marginTop: 2 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Muted>{fmtMoney(x.unit_price_cents || 0, { decimals: 2 })} / {unitLabel(x.unit, 'pt')}</Muted>
        {x.taxable ? <Badge text="Tributável" tone="blue" /> : null}
      </View>
      {x.description ? <Muted numberOfLines={1}>{x.description}</Muted> : null}
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
  arrows: { gap: 2 },
  arrow: { width: 32, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
})
