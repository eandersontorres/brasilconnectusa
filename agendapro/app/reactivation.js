// Clientes sumidas (plano Pro): quem não volta há X dias e não tem horário marcado.
// Mensagem 'comeback' no idioma da cliente com o link da página pública, e
// "Chamei" (guardado no aparelho) tira a cliente da lista por 14 dias.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../lib/api'
import { useApp } from '../lib/session'
import { showError } from '../lib/gate'
import { notify } from '../lib/dialog'
import { colors, spacing } from '../lib/theme'
import { addDays, fmtDay, fmtMoney, todayKey } from '../lib/format'
import { PUBLIC_PAGE } from '../lib/config'
import { firstName, messageLang, openWhatsApp, renderAny } from '../lib/whatsapp'
import { Avatar, Badge, Banner, Button, Card, Chip, Empty, ErrorBox, H2, H3, Label, Loading, Muted, Screen, Segmented, Small, ToggleRow } from '../components/ui'
import Locked from '../components/Locked'

const DAY_OPTIONS = [30, 45, 60, 90, 120, 180]
const SNOOZE_DAYS = 14
const SORTS = [
  { value: 'recent', label: 'Recentes' },
  { value: 'value', label: 'Valiosas' },
  { value: 'longest', label: 'Mais tempo' },
]
const LANG_SHORT = { en: 'EN', es: 'ES' }

export default function ReactivationScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Clientes sumidas' }} />
      <Locked feature="reactivation"><Reactivation /></Locked>
    </>
  )
}

function Reactivation() {
  const app = useApp()
  const { provider, settings, saveSettings } = app
  const canMulti = app.can('multilang_messages')
  const storeKey = `agendapro.reactivation.called.v1:${provider?.id || 'x'}`

  const [days, setDays] = useState(() => Number(settings.reactivation_days) || 45)
  const [data, setData] = useState(null)       // { days, clients }
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [called, setCalled] = useState({})      // { [clientId]: 'YYYY-MM-DD' }
  const [showCalled, setShowCalled] = useState(false)
  const [sort, setSort] = useState('recent')
  const [undo, setUndo] = useState(null)        // última marcada, pra desfazer
  const reqId = useRef(0)

  // "Chamei" fica no aparelho; some sozinho depois de 14 dias
  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(storeKey).then((raw) => {
      if (!alive || !raw) return
      try {
        const all = JSON.parse(raw) || {}
        const limit = addDays(todayKey(), -SNOOZE_DAYS)
        const fresh = Object.fromEntries(Object.entries(all).filter(([, d]) => typeof d === 'string' && d > limit))
        setCalled(fresh)
      } catch (_) {}
    }).catch(() => {})
    return () => { alive = false }
  }, [storeKey])

  const persist = (next) => {
    setCalled(next)
    AsyncStorage.setItem(storeKey, JSON.stringify(next)).catch(() => {})
  }

  const load = useCallback(async ({ pull = false, d = days } = {}) => {
    const my = ++reqId.current
    if (pull) setRefreshing(true)
    setError(null)
    try {
      const r = await api(`/api/agenda/clients?filter=inactive&sort=recent&days=${d}`)
      if (my === reqId.current) setData(r)
    } catch (e) {
      if (my === reqId.current) setError(e)
    } finally {
      if (my === reqId.current) setRefreshing(false)
    }
  }, [days])

  useFocusEffect(useCallback(() => { load() }, [load]))

  async function pickDays(d) {
    if (d === days) return
    setDays(d)
    setData(null)
    try { await saveSettings({ reactivation_days: d }) } catch (e) { showError(e, 'Não salvou a preferência') }
  }

  const list = useMemo(() => {
    const all = (data?.clients || []).slice()
    if (sort === 'value') all.sort((a, b) => b.total_spent_cents - a.total_spent_cents || b.total_visits - a.total_visits)
    else if (sort === 'longest') all.sort((a, b) => (b.days_since_visit || 0) - (a.days_since_visit || 0))
    else all.sort((a, b) => (a.days_since_visit || 0) - (b.days_since_visit || 0))
    return all
  }, [data, sort])

  const pending = list.filter((c) => !called[c.id])
  const visible = showCalled ? list : pending
  const calledCount = list.length - pending.length

  // Receita parada: ticket médio dessas clientes × quantas são
  const stats = useMemo(() => {
    const spent = pending.reduce((s, c) => s + (c.total_spent_cents || 0), 0)
    const visits = pending.reduce((s, c) => s + (c.total_visits || 0), 0)
    const avg = visits ? Math.round(spent / visits) : 0
    return { avg, lost: avg * pending.length }
  }, [pending])

  async function sendComeback(c) {
    if (!c.whatsapp) return notify('Sem WhatsApp', 'Cadastre o número na ficha pra chamar pelo WhatsApp.')
    const lang = messageLang(c.language, canMulti)
    const text = renderAny('comeback', lang, {
      nome: firstName(c.name),
      profissional: provider?.name,
      link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
    }, settings)
    const ok = await openWhatsApp(c.whatsapp, text)
    if (!ok) notify('WhatsApp não abriu', 'Confira se o WhatsApp está instalado no celular.')
  }

  function toggleCalled(c) {
    if (called[c.id]) {
      const { [c.id]: _, ...rest } = called
      persist(rest)
      if (undo?.id === c.id) setUndo(null)
    } else {
      persist({ ...called, [c.id]: todayKey() })
      setUndo({ id: c.id, name: firstName(c.name) })
    }
  }

  function undoLast() {
    if (!undo) return
    const { [undo.id]: _, ...rest } = called
    persist(rest)
    setUndo(null)
  }

  const ready = data && Number(data.days || days) === days

  return (
    <Screen onRefresh={() => load({ pull: true })} refreshing={refreshing}>
      <Card style={{ backgroundColor: colors.goldSoft, borderColor: colors.goldSoft }}>
        <Label style={{ color: colors.goldDark }}>Receita parada estimada</Label>
        <H2 style={{ color: colors.goldDark, marginTop: 4 }}>{ready ? fmtMoney(stats.lost) : '—'}</H2>
        <Muted style={{ marginTop: 4 }}>
          {ready
            ? (pending.length
              ? `${pending.length} cliente${pending.length === 1 ? '' : 's'} × ticket médio de ${fmtMoney(stats.avg)}. Se cada uma voltar uma vez, é isso no seu bolso.`
              : 'Nenhuma cliente esperando um oi seu agora.')
            : 'Calculando…'}
        </Muted>
      </Card>

      <Label style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>Sem vir há mais de</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {DAY_OPTIONS.map((d) => <Chip key={d} label={`${d} dias`} selected={days === d} onPress={() => pickDays(d)} />)}
      </View>

      <Segmented options={SORTS} value={sort} onChange={setSort} style={{ marginTop: spacing.sm }} />

      {calledCount ? (
        <Card padded={false} style={{ marginTop: spacing.md }}>
          <ToggleRow title={`Mostrar quem já chamei (${calledCount})`} subtitle={`Volta pra lista ${SNOOZE_DAYS} dias depois de chamar.`}
            value={showCalled} onValueChange={setShowCalled} />
        </Card>
      ) : null}

      {undo ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone="green" icon="checkmark-circle-outline" text={`${undo.name} sai da lista por ${SNOOZE_DAYS} dias.`} action="Desfazer" onPress={undoLast} />
        </View>
      ) : null}

      {error ? <ErrorBox error={error} onRetry={() => load()} style={{ marginTop: spacing.md }} /> : null}

      {!ready ? (!error ? <Loading text="Procurando quem sumiu…" /> : null) : !visible.length ? (
        <Empty icon="happy-outline" style={{ marginTop: spacing.lg }}
          title={list.length ? 'Você já chamou todo mundo' : 'Ninguém sumido'}
          text={list.length
            ? `Quem você chamou volta pra cá em ${SNOOZE_DAYS} dias, se ainda não tiver agendado.`
            : `Todas as clientes voltaram nos últimos ${days} dias. Que beleza!`} />
      ) : (
        <View style={{ marginTop: spacing.md }}>
          {visible.map((c) => {
            const isCalled = !!called[c.id]
            return (
              <Card key={c.id} style={{ marginBottom: spacing.md, opacity: isCalled ? 0.7 : 1 }}>
                <Pressable onPress={() => router.push(`/client/${c.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Avatar name={c.name} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <H3 numberOfLines={1} style={{ flexShrink: 1 }}>{c.name}</H3>
                      {LANG_SHORT[c.language] ? <Badge text={LANG_SHORT[c.language]} tone="navy" /> : null}
                    </View>
                    <Small>Última visita {c.last_visit_at ? fmtDay(c.last_visit_at) : '—'} · há {c.days_since_visit} dias</Small>
                    <Muted>{c.total_visits} visita{c.total_visits === 1 ? '' : 's'} · ticket {fmtMoney(c.avg_ticket_cents)} · total {fmtMoney(c.total_spent_cents)}</Muted>
                    {isCalled ? <Badge text={`Chamada em ${fmtDay(called[c.id])}`} tone="green" icon="checkmark" style={{ marginTop: 4 }} /> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
                </Pressable>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button title={c.whatsapp ? 'Chamar no WhatsApp' : 'Sem WhatsApp'} icon="logo-whatsapp" variant="whatsapp" small
                    disabled={!c.whatsapp} onPress={() => sendComeback(c)} style={{ flex: 1.4 }} />
                  <Button title={isCalled ? 'Desmarcar' : 'Chamei'} icon={isCalled ? 'arrow-undo-outline' : 'checkmark'} variant="secondary" small
                    onPress={() => toggleCalled(c)} style={{ flex: 1 }} />
                </View>
              </Card>
            )
          })}
        </View>
      )}

      {ready && visible.length ? (
        <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
          A mensagem sai no idioma de cada cliente, com o link da sua página. Edite o texto em Mensagens prontas.
        </Muted>
      ) : null}
    </Screen>
  )
}
