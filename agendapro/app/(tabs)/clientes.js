// Aba Clientes: busca, segmentos (todas, sumidas, aniversários), atalho pra lista de
// espera e botão + pra cadastrar. Dados de GET /api/agenda/clients.
// A busca filtra a lista já carregada (sem acento, na hora); se a lista veio cortada
// (mais de 500 clientes), pergunta também ao servidor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, featureInfo } from '../../lib/gate'
import { notify } from '../../lib/dialog'
import { colors, spacing } from '../../lib/theme'
import { fmtMoney, fmtWhen } from '../../lib/format'
import { PUBLIC_PAGE } from '../../lib/config'
import { firstName, messageLang, openWhatsApp, renderAny } from '../../lib/whatsapp'
import { Avatar, Badge, Button, Card, Chip, Divider, Empty, ErrorBox, Fab, IconButton, Input, Loading, Muted, Row, Screen, Segmented, Small } from '../../components/ui'
import { LockedCard } from '../../components/Locked'
import PlanBanner from '../../components/PlanBanner'

const SEGMENTS = [
  { value: 'all', label: 'Todas' },
  { value: 'inactive', label: 'Sumidas' },
  { value: 'birthday', label: 'Aniversários' },
]
const SORTS = [
  { value: 'recent', label: 'Recentes' },
  { value: 'name', label: 'A–Z' },
  { value: 'top', label: 'Mais gastam' },
]
const PAGE = 80

// Busca sem acento: 'Lúcia' acha 'lucia'
const ACC = { á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n' }
const fold = (s) => String(s || '').toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, (c) => ACC[c] || c)

function agoText(days) {
  if (days == null) return ''
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  if (days < 30) return `há ${days} dias`
  const m = Math.round(days / 30)
  if (m < 12) return `há ${m} ${m > 1 ? 'meses' : 'mês'}`
  const y = Math.round(days / 365)
  return `há ${y} ano${y > 1 ? 's' : ''}`
}

function birthdayText(c) {
  const d = c.birthday_in_days
  const [mm, dd] = String(c.birthday_md || '').split('-')
  const when = mm ? `${dd}/${mm}` : ''
  if (d === 0) return 'Faz aniversário hoje!'
  if (d === 1) return `Amanhã · ${when}`
  return `Em ${d} dias · ${when}`
}

export default function Clientes() {
  const app = useApp()
  const { provider, settings } = app
  const canReact = app.can('reactivation')
  const canWait = app.can('waitlist')
  const canMulti = app.can('multilang_messages')

  const [filter, setFilter] = useState('all')      // all | inactive | birthday | archived
  const [sort, setSort] = useState('recent')
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)            // { key, clients, truncated, days }
  const [remote, setRemote] = useState(null)        // busca no servidor { q, clients }
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [waitCount, setWaitCount] = useState(null)
  const [shown, setShown] = useState(PAGE)
  const reqId = useRef(0)

  const effSort = filter === 'all' || filter === 'archived' ? sort : 'recent'
  const key = `${filter}:${effSort}`
  const locked = filter === 'inactive' && !canReact

  const load = useCallback(async ({ pull = false } = {}) => {
    if (canWait) api('/api/agenda/waitlist?count=1').then((r) => setWaitCount(r.count)).catch(() => {})
    if (filter === 'inactive' && !canReact) { setRefreshing(false); return }
    const my = ++reqId.current
    if (pull) setRefreshing(true)
    setError(null)
    try {
      const r = await api(`/api/agenda/clients?filter=${filter}&sort=${effSort}`)
      if (my === reqId.current) setData({ ...r, key: `${filter}:${effSort}` })
    } catch (e) {
      if (my === reqId.current) setError(e)
    } finally {
      if (my === reqId.current) setRefreshing(false)
    }
  }, [filter, effSort, canReact, canWait])

  // Recarrega ao voltar pra aba (editou/criou cliente) e ao trocar filtro
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { setShown(PAGE) }, [key, q])

  // Lista cortada no servidor: busca lá também (com pausa pra não chamar a cada letra)
  useEffect(() => {
    const term = q.trim()
    if (!data?.truncated || term.length < 2 || locked) { setRemote(null); return }
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/agenda/clients?filter=${filter}&sort=${effSort}&q=${encodeURIComponent(term)}`)
        setRemote({ q: term, clients: r.clients || [] })
      } catch (_) {}
    }, 400)
    return () => clearTimeout(t)
  }, [q, data?.truncated, filter, effSort, locked])

  const ready = data && data.key === key
  const list = useMemo(() => {
    if (!ready) return []
    const term = q.trim()
    if (remote && remote.q === term) return remote.clients
    if (!term) return data.clients || []
    const f = fold(term)
    const digits = term.replace(/\D/g, '')
    return (data.clients || []).filter((c) =>
      fold(c.name).includes(f) ||
      fold(c.email).includes(f) ||
      (digits.length >= 3 && String(c.whatsapp || '').includes(digits)) ||
      (c.tags || []).some((t) => fold(t).includes(f)))
  }, [ready, data, q, remote])

  // Receita parada (mesma conta da tela Clientes sumidas): ticket médio × quantidade
  const lostCents = useMemo(() => {
    if (filter !== 'inactive' || !ready) return 0
    const all = data.clients || []
    const spent = all.reduce((s, c) => s + (c.total_spent_cents || 0), 0)
    const visits = all.reduce((s, c) => s + (c.total_visits || 0), 0)
    return visits ? Math.round(spent / visits) * all.length : 0
  }, [filter, ready, data])

  function sendBirthday(c) {
    if (!c.whatsapp) return notify('Sem WhatsApp', 'Cadastre o número na ficha pra mandar parabéns.')
    const lang = messageLang(c.language, canMulti)
    const text = renderAny('birthday', lang, {
      nome: firstName(c.name),
      profissional: provider?.name,
      link: provider?.slug ? PUBLIC_PAGE(provider.slug) : '',
    }, settings)
    openWhatsApp(c.whatsapp, text)
  }

  function subtitle(c) {
    if (filter === 'birthday') return birthdayText(c)
    if (filter === 'inactive') {
      return `Sem vir ${agoText(c.days_since_visit)} · ${c.total_visits} visita${c.total_visits === 1 ? '' : 's'} · ticket ${fmtMoney(c.avg_ticket_cents)}`
    }
    if (c.next_appointment_at) return `Próximo: ${fmtWhen(c.next_appointment_at)}`
    if (!c.total_visits) return 'Ainda não veio'
    return `Última visita ${agoText(c.days_since_visit)} · ${c.total_visits} visita${c.total_visits === 1 ? '' : 's'}`
  }

  function right(c) {
    if (filter === 'birthday') {
      return <IconButton icon="logo-whatsapp" color="#128C7E" bg="#E7F8EE" size={36} label={`Mandar parabéns pra ${c.name}`} onPress={() => sendBirthday(c)} />
    }
    if (filter === 'archived') return <Badge text="Arquivada" tone="gray" />
    if (filter === 'all' && sort === 'top' && c.total_spent_cents) return <Small style={{ color: colors.green, fontWeight: '600' }}>{fmtMoney(c.total_spent_cents)}</Small>
    if (c.tags?.length) return <Badge text={c.tags[0]} tone="gold" />
    return null
  }

  const waitInfo = featureInfo(app.ent, 'waitlist')
  const reactInfo = featureInfo(app.ent, 'reactivation')
  const term = q.trim()

  function renderBody() {
    if (locked) return <LockedCard feature="reactivation" style={{ marginTop: spacing.md }} />
    if (error && !ready) return <ErrorBox error={error} onRetry={() => load()} style={{ marginTop: spacing.md }} />
    if (!ready) return <Loading text="Carregando clientes…" />

    if (!list.length) {
      if (term) return <Empty icon="search-outline" title="Nada encontrado" text={`Nenhuma cliente com "${term}".`} />
      if (filter === 'inactive') {
        return <Empty icon="happy-outline" title="Ninguém sumido" text={`Todas as clientes voltaram nos últimos ${data.days || 45} dias. Que beleza!`} />
      }
      if (filter === 'birthday') {
        return <Empty icon="gift-outline" title="Nenhum aniversário nos próximos 30 dias" text="Anote o aniversário na ficha da cliente e o app lembra você de mandar parabéns." />
      }
      if (filter === 'archived') return <Empty icon="archive-outline" title="Nenhuma cliente arquivada" />
      return (
        <Empty icon="people-outline" title="Nenhuma cliente ainda"
          text="Quem agenda pela sua página entra aqui sozinha. Você também pode cadastrar agora."
          action={<Button title="Cadastrar cliente" icon="person-add-outline" onPress={() => router.push('/client/edit')} />} />
      )
    }

    const page = list.slice(0, shown)
    return (
      <>
        {filter === 'inactive' ? (
          <Card onPress={() => router.push('/reactivation')} style={{ marginTop: spacing.md, backgroundColor: colors.goldSoft, borderColor: colors.goldSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Ionicons name="sparkles-outline" size={22} color={colors.goldDark} />
              <View style={{ flex: 1 }}>
                <Small style={{ color: colors.goldDark, fontWeight: '700' }}>
                  {list.length} cliente{list.length === 1 ? '' : 's'} · {fmtMoney(lostCents)} parados
                </Small>
                <Muted>Chame de volta com mensagem pronta, no idioma de cada uma.</Muted>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.goldDark} />
            </View>
          </Card>
        ) : null}

        <Muted style={{ marginTop: spacing.md, marginBottom: spacing.sm, marginLeft: 2 }}>
          {list.length} cliente{list.length === 1 ? '' : 's'}{data.truncated && !term ? ' (mostrando as 500 primeiras)' : ''}
        </Muted>
        <Card padded={false}>
          {page.map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 68 }} /> : null}
              <Row left={<Avatar name={c.name} size={40} />} title={c.name} subtitle={subtitle(c)} right={right(c)} chevron={filter !== 'birthday'}
                onPress={() => router.push(`/client/${c.id}`)} />
            </View>
          ))}
        </Card>
        {list.length > shown ? (
          <Button title={`Mostrar mais (${list.length - shown})`} variant="ghost" onPress={() => setShown((n) => n + PAGE)} style={{ marginTop: spacing.sm }} />
        ) : null}
      </>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Screen onRefresh={() => load({ pull: true })} refreshing={refreshing}>
        <PlanBanner />

        <Input
          placeholder="Buscar por nome, telefone ou etiqueta"
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={{ marginBottom: spacing.md }}
          right={q ? (
            <Pressable onPress={() => setQ('')} hitSlop={10} style={{ paddingHorizontal: spacing.md }} accessibilityLabel="Limpar busca">
              <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
            </Pressable>
          ) : <Ionicons name="search" size={18} color={colors.inkMuted} style={{ paddingHorizontal: spacing.md }} />}
        />

        <Card padded={false} style={{ marginBottom: spacing.md }}>
          <Row icon="hourglass-outline" title="Lista de espera" chevron
            subtitle={!canWait ? 'Avise quem espera quando abrir um horário'
              : waitCount ? `${waitCount} pessoa${waitCount === 1 ? '' : 's'} esperando horário` : 'Ninguém esperando agora'}
            right={!canWait ? <Badge text={waitInfo.minName} tone="gold" icon="lock-closed" />
              : waitCount ? <Badge text={String(waitCount)} tone="green" /> : null}
            onPress={() => router.push('/waitlist')} />
        </Card>

        {filter === 'archived' ? (
          <Card padded={false} style={{ marginBottom: spacing.sm }}>
            <Row icon="archive-outline" title="Clientes arquivadas" subtitle="Somem das listas, mas o histórico fica."
              right={<Button title="Voltar" small variant="secondary" full={false} onPress={() => setFilter('all')} />} />
          </Card>
        ) : (
          // Sem o plano, "Sumidas" mostra o cadeado no lugar da lista
          <Segmented options={SEGMENTS.map((s) => (s.value === 'inactive' && !canReact ? { ...s, label: `Sumidas · ${reactInfo.minName}` } : s))}
            value={filter} onChange={setFilter} />
        )}

        {(filter === 'all' || filter === 'archived') ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md }}>
            {SORTS.map((s) => <Chip key={s.value} label={s.label} selected={sort === s.value} onPress={() => setSort(s.value)} />)}
          </View>
        ) : null}

        {error && ready ? <ErrorBox error={error} onRetry={() => load()} style={{ marginTop: spacing.md }} /> : null}
        {renderBody()}

        {filter === 'all' && ready && !term ? (
          <Card padded={false} style={{ marginTop: spacing.xl }}>
            <Row icon="archive-outline" iconColor={colors.inkSoft} title="Clientes arquivadas" chevron onPress={() => setFilter('archived')} />
            <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
            <Row icon="chatbubbles-outline" title="Mensagens prontas" subtitle="Edite os textos do WhatsApp" chevron onPress={() => router.push('/templates')} />
          </Card>
        ) : null}
        <View style={{ height: 72 }} />
      </Screen>
      <Fab icon="person-add" label="Cadastrar cliente" onPress={async () => {
        if (!(await ensureFeature(app, 'clients'))) return
        router.push('/client/edit')
      }} />
    </View>
  )
}
