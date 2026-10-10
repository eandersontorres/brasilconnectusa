// Aba "Vendas" (WorkPro; no AgendaPro fica escondida e abre pelo menu Mais, com a seta
// de voltar do _layout das abas): orçamentos, faturas e pedidos de orçamento. Números
// do mês no topo, filtro por status, busca e o + pra criar. ?tab=quotes|invoices|requests
// e ?status= abrem direto num filtro.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, openPlans } from '../../lib/gate'
import { dateKey, fmtDay, fmtMoney, todayKey } from '../../lib/format'
import { DocStatusBadge, INVOICE_FILTERS, OPEN_INVOICE, OPEN_QUOTE, QUOTE_FILTERS } from '../../lib/documents'
import { colors, spacing, type } from '../../lib/theme'
import { Banner, Button, Card, Chip, Divider, Empty, ErrorBox, Fab, Input, KPI, Loading, Muted, Screen, Segmented } from '../../components/ui'
import { LockedCard } from '../../components/Locked'
import PlanBanner from '../../components/PlanBanner'
import { QuoteRequestsPanel, useQuoteRequests } from '../quote-requests'

const TABS = [
  { value: 'quote', label: 'Orçamentos' },
  { value: 'invoice', label: 'Faturas' },
  { value: 'requests', label: 'Pedidos' },
]
const TAB_ALIASES = { quote: 'quote', quotes: 'quote', invoice: 'invoice', invoices: 'invoice', requests: 'requests' }
const FEATURE = { quote: 'quotes', invoice: 'invoices', requests: 'quote_requests' }
const FILTERS = { quote: QUOTE_FILTERS, invoice: INVOICE_FILTERS }
const one = (v) => (Array.isArray(v) ? v[0] : v)
const diffDays = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400e3)
/** Instante real (accepted_at, paid_at) → dia no relógio do celular. */
const dayOfInstant = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : fmtDay(dateKey(d)) }

/** Taxa de aprovação: aceita 0–1 ou 0–100. */
function rateText(r) {
  const n = Number(r)
  if (r == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n <= 1 ? n * 100 : n)}%`
}

/** Linha de data/situação de cada documento na lista. */
function dateLine(doc, today) {
  if (doc.kind === 'invoice') {
    if (doc.status === 'draft') return doc.issue_date ? `Rascunho · ${fmtDay(doc.issue_date)}` : 'Rascunho'
    if (doc.status === 'void') return 'Anulada'
    if (doc.status === 'paid') return doc.paid_at ? `Paga ${dayOfInstant(doc.paid_at)}` : 'Paga'
    const parts = []
    const due = doc.due_date ? String(doc.due_date).slice(0, 10) : ''
    if (!due) parts.push('Sem vencimento')
    else if (due < today) { const n = diffDays(due, today); parts.push(`Venceu há ${n} dia${n === 1 ? '' : 's'}`) }
    else if (due === today) parts.push('Vence hoje')
    else parts.push(`Vence ${fmtDay(due)}`)
    if (doc.status === 'partial' || (Number(doc.amount_paid_cents) > 0 && Number(doc.balance_cents) > 0)) parts.push(`falta ${fmtMoney(doc.balance_cents)}`)
    if (doc.status === 'viewed') parts.push('vista pela cliente')
    return parts.join(' · ')
  }
  if (doc.status === 'draft') return doc.issue_date ? `Rascunho · ${fmtDay(doc.issue_date)}` : 'Rascunho'
  if (doc.status === 'accepted') return `Aprovado${doc.accepted_at ? ' ' + dayOfInstant(doc.accepted_at) : ''}${doc.accepted_name ? ` por ${doc.accepted_name}` : ''}`
  if (doc.status === 'declined') return 'Recusado pela cliente'
  if (doc.status === 'converted') return 'Virou fatura'
  const until = doc.valid_until ? String(doc.valid_until).slice(0, 10) : ''
  if (doc.status === 'expired' || (until && until < today)) return until ? `Validade venceu ${fmtDay(until)}` : 'Validade venceu'
  const seen = doc.status === 'viewed' ? 'Visto pela cliente' : 'Enviado'
  return until ? `${seen} · válido até ${fmtDay(until)}` : seen
}

export default function Vendas() {
  const app = useApp()
  const params = useLocalSearchParams()
  const settings = app.settings || {}

  const [tab, setTab] = useState(() => TAB_ALIASES[String(one(params.tab) || '')] || 'quote')
  const [filters, setFilters] = useState({ quote: 'all', invoice: 'all' })
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [docs, setDocs] = useState({ quote: null, invoice: null })
  const [summary, setSummary] = useState(null)
  const [errors, setErrors] = useState({})
  const [refreshing, setRefreshing] = useState(false)
  const seq = useRef({ quote: 0, invoice: 0 })
  const qr = useQuoteRequests()

  // Aberta de outra tela com ?tab= / ?status= (a aba continua montada). Depois de usar,
  // limpa os parâmetros (como a Agenda faz com ?date=): assim o mesmo atalho de novo
  // (Hoje → "Vencidas", push de fatura vencida) volta a valer, mesmo com valores iguais.
  useEffect(() => {
    const t = TAB_ALIASES[String(one(params.tab) || '')]
    if (!t) return
    setTab(t)
    const s = String(one(params.status) || '')
    if (t !== 'requests' && FILTERS[t].some((f) => f.value === s)) pickFilter(t, s)
    router.setParams({ tab: undefined, status: undefined })
  }, [params.tab, params.status])

  // Busca com pausa (não chama a API a cada letra)
  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim().slice(0, 60)), 350)
    return () => clearTimeout(id)
  }, [q])

  const loadDocs = useCallback(async (kind, status, text) => {
    const my = ++seq.current[kind]
    try {
      const qs = `kind=${kind}&status=${encodeURIComponent(status)}${text ? `&q=${encodeURIComponent(text)}` : ''}`
      const r = await api(`/api/agenda/documents?${qs}`)
      if (my !== seq.current[kind]) return
      setDocs((d) => ({ ...d, [kind]: Array.isArray(r.documents) ? r.documents : [] }))
      if (r.summary) setSummary(r.summary)
      setErrors((e) => ({ ...e, [kind]: null }))
    } catch (e) {
      if (my === seq.current[kind]) setErrors((x) => ({ ...x, [kind]: e }))
    }
  }, [])

  const filter = tab === 'requests' ? null : filters[tab]
  const canRequests = app.can('quote_requests')
  const loadRequests = qr.load

  // Volta pra aba (depois de criar/editar) e troca de aba/filtro/busca
  useFocusEffect(useCallback(() => {
    if (tab !== 'requests') loadDocs(tab, filter, term)
  }, [tab, filter, term, loadDocs]))

  // Pedidos: carrega ao abrir a tela (o contador de novos aparece na aba Pedidos)
  useFocusEffect(useCallback(() => {
    if (canRequests) loadRequests()
  }, [loadRequests, canRequests]))

  async function onRefresh() {
    setRefreshing(true)
    try {
      if (tab === 'requests') await qr.load()
      else await loadDocs(tab, filter, term)
    } finally {
      setRefreshing(false)
    }
  }

  async function create(kind) {
    if (!(await ensureFeature(app, FEATURE[kind]))) return
    router.push({ pathname: '/document/edit', params: { kind } })
  }

  /** Troca o filtro e limpa a lista daquele tipo (mostra carregando, não a lista do filtro anterior). */
  const pickFilter = (kind, status) => {
    if (filters[kind] === status) return
    setFilters((f) => ({ ...f, [kind]: status }))
    setDocs((d) => ({ ...d, [kind]: null }))
  }
  const goFilter = (kind, status) => {
    setTab(kind)
    pickFilter(kind, status)
  }

  const today = todayKey()
  const list = tab === 'requests' ? null : docs[tab]
  const err = tab === 'requests' ? null : errors[tab]
  const locked = !app.can(FEATURE[tab])
  const inactive = app.ent.tier === 'none'
  const docLimit = app.limit('documents_month')
  const business = settings.business || {}
  const needsBusiness = !business.legal_name && !business.phone && !settings.doc_defaults?.payment_instructions

  function renderDocs() {
    if (err?.code === 'plan_required') return <LockedCard feature={FEATURE[tab]} style={{ marginTop: spacing.md }} />
    if (err && !list) return <ErrorBox error={err} onRetry={() => loadDocs(tab, filter, term)} style={{ marginTop: spacing.md }} />
    if (!list) return <Loading text={tab === 'invoice' ? 'Carregando faturas…' : 'Carregando orçamentos…'} />

    if (!list.length) {
      if (term) return <Empty icon="search-outline" title="Nada encontrado" text={`Nenhum documento com "${term}".`} />
      if (filter !== 'all') {
        const label = FILTERS[tab].find((f) => f.value === filter)?.label || ''
        return (
          <Empty icon="funnel-outline" title={`Nada em "${label}"`} text="Troque o filtro pra ver os outros."
            action={<Button title="Ver todos" variant="secondary" onPress={() => pickFilter(tab, 'all')} />} />
        )
      }
      if (locked) return <LockedCard feature={FEATURE[tab]} style={{ marginTop: spacing.md }} />
      return tab === 'invoice' ? (
        <Empty icon="receipt-outline" title="Mande sua primeira fatura"
          text="Fatura em PDF e por link, com Zelle, cheque ou cartão. Você vê na hora quem pagou e quem está devendo."
          action={(
            <View style={{ gap: spacing.sm }}>
              <Button title="Nova fatura" icon="add" onPress={() => create('invoice')} />
              <Button title="Dados da empresa e como receber" icon="business-outline" variant="secondary" onPress={() => router.push('/business')} />
            </View>
          )} />
      ) : (
        <Empty icon="document-text-outline" title="Monte seu primeiro orçamento em 1 minuto"
          text="Escolha a cliente, puxe os itens da sua tabela de preços e mande o link no WhatsApp. Ela aprova pelo celular, com assinatura."
          action={(
            <View style={{ gap: spacing.sm }}>
              <Button title="Novo orçamento" icon="add" onPress={() => create('quote')} />
              <Button title="Montar minha tabela de preços" icon="pricetags-outline" variant="secondary" onPress={() => router.push('/price-book')} />
            </View>
          )} />
      )
    }

    return (
      <>
        <Muted style={{ marginTop: spacing.md, marginBottom: spacing.sm, marginLeft: 2 }}>
          {list.length} {tab === 'invoice' ? (list.length === 1 ? 'fatura' : 'faturas') : (list.length === 1 ? 'orçamento' : 'orçamentos')}
        </Muted>
        <Card padded={false}>
          {list.map((d, i) => (
            <View key={d.id}>
              {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
              <DocRow doc={d} today={today} onPress={() => router.push(`/document/${d.id}`)} />
            </View>
          ))}
        </Card>
      </>
    )
  }

  const s = summary || {}
  const overdueCount = Number(s.overdue_count) || 0
  const openQuotes = Number(s.open_quotes_count) || 0

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <PlanBanner />
        <Segmented options={TABS.map((t) => (t.value === 'requests' && qr.data ? { ...t, label: badgeLabel(t.label, qr.data.requests) } : t))} value={tab} onChange={setTab} />

        {tab === 'requests' ? (
          <View style={{ marginTop: spacing.md }}>
            {locked ? <LockedCard feature="quote_requests" /> : <QuoteRequestsPanel qr={qr} />}
          </View>
        ) : (
          <>
            {/* Números */}
            {summary ? (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <KPI label="A receber" value={fmtMoney(s.awaiting_cents || 0)} tone="green" onPress={() => goFilter('invoice', 'open')} />
                  <KPI label="Vencidas" value={fmtMoney(s.overdue_cents || 0)} sub={overdueCount ? `${overdueCount} fatura${overdueCount === 1 ? '' : 's'}` : 'nenhuma'}
                    onPress={() => goFilter('invoice', 'overdue')} />
                  <KPI label="Recebido no mês" value={fmtMoney(s.paid_month_cents || 0)} tone="gold" onPress={() => goFilter('invoice', 'paid')} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <KPI label="Orçamentos aguardando" value={String(openQuotes)} sub={s.open_quotes_cents ? fmtMoney(s.open_quotes_cents) : null}
                    onPress={() => goFilter('quote', 'open')} />
                  <KPI label="Aprovação" value={rateText(s.acceptance_rate)} sub="dos orçamentos enviados" />
                </View>
              </View>
            ) : null}

            {overdueCount > 0 && tab === 'invoice' && filter !== 'overdue' ? (
              <View style={{ marginTop: spacing.md }}>
                <Banner tone="red" icon="alert-circle-outline" action="Ver"
                  text={`${overdueCount} fatura${overdueCount === 1 ? '' : 's'} vencida${overdueCount === 1 ? '' : 's'}: ${fmtMoney(s.overdue_cents || 0)} pra cobrar.`}
                  onPress={() => goFilter('invoice', 'overdue')} />
              </View>
            ) : null}

            {inactive && locked ? (
              <View style={{ marginTop: spacing.md }}>
                <Banner tone="orange" icon="lock-closed-outline" action="Ver planos" onPress={() => openPlans(FEATURE[tab])}
                  text="Seu plano não está ativo. Você vê seus documentos, mas pra criar ou enviar precisa de um plano ativo." />
              </View>
            ) : needsBusiness && !locked ? (
              <View style={{ marginTop: spacing.md }}>
                <Banner tone="gold" icon="business-outline" action="Completar" onPress={() => router.push('/business')}
                  text="Coloque nome da empresa, licença e como receber (Zelle, cheque): sai em todo orçamento e fatura." />
              </View>
            ) : null}

            <Input
              placeholder="Buscar por cliente, número ou título"
              value={q}
              onChangeText={setQ}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              maxLength={60}
              style={{ marginTop: spacing.md, marginBottom: spacing.sm }}
              right={q ? (
                <Pressable onPress={() => setQ('')} hitSlop={10} style={{ paddingHorizontal: spacing.md }} accessibilityLabel="Limpar busca">
                  <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
                </Pressable>
              ) : <Ionicons name="search" size={18} color={colors.inkMuted} style={{ paddingHorizontal: spacing.md }} />}
            />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.lg }}>
              {FILTERS[tab].map((f) => (
                <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => pickFilter(tab, f.value)} />
              ))}
            </ScrollView>

            {err && list ? <ErrorBox error={err} onRetry={() => loadDocs(tab, filter, term)} style={{ marginTop: spacing.sm }} /> : null}
            {renderDocs()}

            {list && list.length && typeof docLimit === 'number' && docLimit > 0 ? (
              <Muted style={{ textAlign: 'center', marginTop: spacing.lg }}>
                Seu plano cria até {docLimit} documentos por mês. No Pro é ilimitado.
              </Muted>
            ) : null}
            {list && list.length ? (
              <Card padded={false} style={{ marginTop: spacing.xl }}>
                <ShortcutRow icon="pricetags-outline" title="Tabela de preços" sub="Serviços e materiais pra montar rápido" onPress={() => router.push('/price-book')} />
                <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
                <ShortcutRow icon="business-outline" title="Dados da empresa e padrões" sub="Licença, imposto, Zelle, condições" onPress={() => router.push('/business')} />
              </Card>
            ) : null}
          </>
        )}
        <View style={{ height: 72 }} />
      </Screen>
      {tab !== 'requests' ? (
        <Fab label={tab === 'invoice' ? 'Nova fatura' : 'Novo orçamento'} onPress={() => create(tab)} />
      ) : null}
    </View>
  )
}

/** 'Pedidos · 3' quando tem pedido novo. */
function badgeLabel(label, requests) {
  const n = (requests || []).filter((r) => r.status === 'new').length
  return n ? `${label} · ${n}` : label
}

function DocRow({ doc, today, onPress }) {
  const faded = doc.status === 'void' || doc.status === 'declined' || doc.status === 'expired'
  const openInv = doc.kind === 'invoice' && OPEN_INVOICE.includes(doc.status)
  const late = openInv && doc.due_date && String(doc.due_date).slice(0, 10) < today
  const waiting = doc.kind === 'quote' && OPEN_QUOTE.includes(doc.status)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: 3 }, pressed && { backgroundColor: colors.paperSoft }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={[type.body, { fontWeight: '600', flex: 1 }, faded && { color: colors.inkMuted }]} numberOfLines={1}>{doc.client_name || 'Sem cliente'}</Text>
        <Text style={[type.body, { fontWeight: '700' }, faded && { color: colors.inkMuted, textDecorationLine: doc.status === 'void' ? 'line-through' : 'none' }]}>
          {fmtMoney(doc.total_cents || 0, { decimals: 2 })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Muted style={{ flex: 1 }} numberOfLines={1}>{[doc.number, doc.title].filter(Boolean).join(' · ')}</Muted>
        <DocStatusBadge kind={doc.kind} status={doc.status} />
      </View>
      <Text style={[type.small, late && { color: colors.danger, fontWeight: '600' }, waiting && { color: colors.inkSoft }]} numberOfLines={1}>
        {dateLine(doc, today)}{doc.stage_label ? ` · ${doc.stage_label}` : ''}
      </Text>
    </Pressable>
  )
}

function ShortcutRow({ icon, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.paperSoft }]}>
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={colors.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: '500' }]}>{title}</Text>
        <Muted numberOfLines={1}>{sub}</Muted>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
    </Pressable>
  )
}
