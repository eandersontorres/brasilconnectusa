// Pedidos de orçamento que chegam pelo formulário da página pública. A mesma lista
// aparece na aba Pedidos de Vendas (useQuoteRequests + QuoteRequestsPanel daqui).
// Ações: ligar, WhatsApp, e-mail, "Fazer orçamento" (vira rascunho e abre o editor),
// marcar em contato, arquivar, spam.
import { useCallback, useMemo, useRef, useState } from 'react'
import { Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { choose, notify } from '../lib/dialog'
import { fmtAgo, fmtDay, fmtPhone } from '../lib/format'
import { callPhone, firstName, openWhatsApp } from '../lib/whatsapp'
import { DocStatusBadge, REQUEST_FILTERS } from '../lib/documents'
import { colors, radius, spacing, type } from '../lib/theme'
import { Button, Card, Chip, Empty, ErrorBox, IconButton, Loading, Muted, Screen, Small, ToggleRow } from '../components/ui'
import Locked from '../components/Locked'

const OPEN = ['new', 'contacted']
const LANG_NAMES = { en: 'English', es: 'Español', pt: 'Português' }
// Primeira mensagem no WhatsApp, no idioma que a cliente usou no formulário
const HELLO = {
  pt: 'Oi {nome}! Aqui é {profissional}. Recebi seu pedido de orçamento{servico}. Posso te fazer umas perguntas pra montar o valor?',
  en: 'Hi {nome}! This is {profissional}. I got your quote request{servico}. Can I ask you a few questions to put the price together?',
  es: '¡Hola {nome}! Soy {profissional}. Recibí tu solicitud de presupuesto{servico}. ¿Puedo hacerte unas preguntas para armar el precio?',
}
const FOR = { pt: ' de ', en: ' for ', es: ' de ' }

function helloText(req, providerName) {
  const lang = HELLO[req.language] ? req.language : 'pt'
  const svc = req.service ? `${FOR[lang]}${String(req.service).slice(0, 80)}` : ''
  return HELLO[lang]
    .replace('{nome}', firstName(req.name) || '')
    .replace('{profissional}', providerName || '')
    .replace('{servico}', svc)
    .replace(/\s+([.!?,])/g, '$1')
    .trim()
}

function openMap(address) {
  const q = encodeURIComponent(address)
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`
  if (Platform.OS === 'web') { window.open(url, '_blank'); return }
  Linking.openURL(url).catch(() => notify('Não deu pra abrir o mapa', address))
}

// ── Dados ────────────────────────────────────────────────────────────────
/** Lista de pedidos (GET /api/agenda/quote-requests → { requests, counts }). */
export function useQuoteRequests() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async (pull = false) => {
    const my = ++seq.current
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/quote-requests')
      if (my !== seq.current) return
      setData({ requests: Array.isArray(r.requests) ? r.requests : [], counts: r.counts || {} })
      setError(null)
    } catch (e) {
      if (my === seq.current) setError(e)
    } finally {
      if (my === seq.current) setRefreshing(false)
    }
  }, [])

  const patch = useCallback((id, fields) => {
    setData((d) => (d ? { ...d, requests: d.requests.map((r) => (r.id === id ? { ...r, ...fields } : r)) } : d))
  }, [])

  return { data, error, refreshing, load, patch }
}

// ── Lista ────────────────────────────────────────────────────────────────
export function QuoteRequestsPanel({ qr }) {
  const app = useApp()
  const [filter, setFilter] = useState('open')
  const [busy, setBusy] = useState(null)
  const [viewer, setViewer] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [formBusy, setFormBusy] = useState(false)

  // Formulário "Pedir orçamento" na página: preferência dela, senão ligado pra quem é de obra/serviço (trades)
  const pref = app.settings?.quote_requests_public
  const formOn = pref === true || pref === false ? pref : app.provider?.vertical === 'trades'

  async function toggleForm(v) {
    if (!(await ensureFeature(app, 'quote_requests'))) return
    setFormBusy(true)
    try {
      const saved = await app.saveSettings({ quote_requests_public: !!v })
      if (saved?.quote_requests_public !== !!v) notify('Não deu pra mudar agora', 'Tente de novo daqui a pouco.')
    } catch (e) {
      showError(e)
    } finally {
      setFormBusy(false)
    }
  }

  const all = qr.data?.requests || []
  const counts = useMemo(() => {
    const c = { open: 0 }
    for (const r of all) {
      c[r.status] = (c[r.status] || 0) + 1
      if (OPEN.includes(r.status)) c.open++
    }
    return c
  }, [all])
  const list = all.filter((r) => (filter === 'open' ? OPEN.includes(r.status) : r.status === filter))

  async function setStatus(req, status, { silent = false } = {}) {
    if (!silent && !(await ensureFeature(app, 'quote_requests'))) return
    const prev = req.status
    qr.patch(req.id, { status })
    try {
      await post('/api/agenda/quote-requests', { action: 'update_status', id: req.id, status })
    } catch (e) {
      qr.patch(req.id, { status: prev })
      if (!silent) showError(e)
    }
  }

  // Falou com a cliente: pedido novo passa pra "em contato" (sem incomodar se falhar)
  const touched = (req) => { if (req.status === 'new' && app.can('quote_requests')) setStatus(req, 'contacted', { silent: true }) }

  async function whatsapp(req) {
    if (!req.phone) return
    const ok = await openWhatsApp(req.phone, helloText(req, app.provider?.name))
    if (!ok) { notify('WhatsApp não abriu', 'Confira se o WhatsApp está instalado neste celular.'); return }
    touched(req)
  }

  function call(req) {
    if (!req.phone) return
    callPhone(req.phone)
    touched(req)
  }

  function email(req) {
    if (!req.email) return
    // Assunto no idioma que a cliente usou no formulário
    const base = { pt: 'Seu pedido de orçamento', en: 'Your quote request', es: 'Su solicitud de presupuesto' }[req.language] || 'Your quote request'
    const subject = encodeURIComponent(req.service ? `${base}: ${String(req.service).slice(0, 80)}` : base)
    Linking.openURL(`mailto:${req.email}?subject=${subject}`).catch(() => notify('Não deu pra abrir o e-mail', req.email))
    touched(req)
  }

  async function makeQuote(req) {
    if (req.document_id) { router.push(`/document/${req.document_id}`); return }
    if (!(await ensureFeature(app, 'quotes'))) return
    setBusy(req.id)
    try {
      const r = await post('/api/agenda/quote-requests', { action: 'convert', id: req.id })
      const docId = r?.document?.id
      if (!docId) throw new Error('Não deu pra criar o orçamento. Tente de novo.')
      qr.patch(req.id, { status: 'quoted', document_id: docId })
      router.push({ pathname: '/document/edit', params: { id: docId } })
    } catch (e) {
      showError(e)
    } finally {
      setBusy(null)
    }
  }

  async function more(req) {
    const options = []
    if (req.status === 'new') options.push({ label: 'Marcar como em contato', value: 'contacted' })
    if (req.status !== 'closed') options.push({ label: 'Arquivar', value: 'closed' })
    if (req.status === 'closed' || req.status === 'spam') options.push({ label: 'Voltar pra em aberto', value: 'contacted' })
    if (req.status !== 'spam') options.push({ label: 'É spam', value: 'spam', destructive: true })
    const v = await choose(req.name || 'Pedido', options)
    if (v) setStatus(req, v)
  }

  if (!qr.data && !qr.error) return <Loading text="Carregando pedidos…" />

  return (
    <View>
      <ErrorBox error={qr.error} onRetry={() => qr.load()} />

      <Card padded={false} style={{ marginBottom: spacing.md }}>
        <ToggleRow title="Formulário na minha página" disabled={formBusy}
          subtitle={formOn ? 'Ligado: aparece o botão "Pedir orçamento" na sua página pública.' : 'Desligado: a cliente não vê o botão "Pedir orçamento".'}
          value={formOn} onValueChange={toggleForm} />
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }} contentContainerStyle={{ paddingRight: spacing.lg }}>
        {REQUEST_FILTERS.map((f) => {
          const n = counts[f.value] || 0
          return <Chip key={f.value} label={n ? `${f.label} · ${n}` : f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
        })}
      </ScrollView>

      {qr.data && !list.length ? (
        <Card>
          {filter === 'open' ? (
            <Empty icon="mail-unread-outline" title={all.length ? 'Nenhum pedido em aberto' : 'Nenhum pedido ainda'}
              text="Quando alguém pedir orçamento pela sua página, o pedido aparece aqui com fotos e você recebe um aviso no celular."
              style={{ padding: spacing.md }}
              action={<Button title="Compartilhar minha página" icon="share-social-outline" variant="secondary" onPress={() => router.push('/share')} />} />
          ) : (
            <Muted style={{ textAlign: 'center' }}>Nenhum pedido aqui.</Muted>
          )}
        </Card>
      ) : null}

      {list.map((req) => {
        const photos = (Array.isArray(req.photos) ? req.photos : []).filter((u) => /^https?:\/\//i.test(String(u)))
        const long = String(req.description || '').length > 180
        const open = !!expanded[req.id]
        return (
          <Card key={req.id} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.h3]} numberOfLines={1}>{req.name || 'Sem nome'}</Text>
                <Muted numberOfLines={1}>{req.created_at ? fmtAgo(req.created_at) : ''}{req.language && req.language !== 'pt' ? ` · fala ${LANG_NAMES[req.language] || req.language}` : ''}</Muted>
              </View>
              <DocStatusBadge kind="request" status={req.status} />
              <Pressable onPress={() => more(req)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Mais opções do pedido">
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.inkSoft} />
              </Pressable>
            </View>

            {req.service ? <Text style={[type.body, { fontWeight: '600', marginTop: spacing.sm }]}>{req.service}</Text> : null}
            {req.description ? (
              <Pressable onPress={long ? () => setExpanded((x) => ({ ...x, [req.id]: !open })) : undefined} disabled={!long}>
                <Text style={[type.body, { color: colors.inkSoft, marginTop: 4 }]} numberOfLines={open ? undefined : 4}>{req.description}</Text>
                {long ? <Small style={{ color: colors.green, fontWeight: '600', marginTop: 2 }}>{open ? 'Ver menos' : 'Ver tudo'}</Small> : null}
              </Pressable>
            ) : null}

            <View style={{ gap: 4, marginTop: spacing.sm }}>
              {req.address ? (
                <Pressable onPress={() => openMap(req.address)} style={st.info}>
                  <Ionicons name="location-outline" size={15} color={colors.green} />
                  <Text style={[type.small, { flex: 1, color: colors.green }]} numberOfLines={2}>{req.address}</Text>
                </Pressable>
              ) : null}
              {req.preferred_date ? (
                <View style={st.info}>
                  <Ionicons name="calendar-outline" size={15} color={colors.inkSoft} />
                  <Small>Prefere {fmtDay(String(req.preferred_date).slice(0, 10))}</Small>
                </View>
              ) : null}
              {req.phone || req.email ? (
                <View style={st.info}>
                  <Ionicons name="person-outline" size={15} color={colors.inkSoft} />
                  <Small style={{ flex: 1 }} numberOfLines={1} selectable>{[req.phone ? fmtPhone(req.phone) : '', req.email || ''].filter(Boolean).join(' · ')}</Small>
                </View>
              ) : null}
            </View>

            {photos.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                {photos.map((u, i) => (
                  <Pressable key={u + i} onPress={() => setViewer(u)} accessibilityLabel={`Foto ${i + 1} do pedido`} style={st.thumb}>
                    <Image source={{ uri: u }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
              {req.phone ? <IconButton icon="logo-whatsapp" color={colors.white} bg="#25D366" size={40} label="WhatsApp" onPress={() => whatsapp(req)} /> : null}
              {req.phone ? <IconButton icon="call-outline" size={40} label="Ligar" onPress={() => call(req)} /> : null}
              {req.email ? <IconButton icon="mail-outline" size={40} label="E-mail" onPress={() => email(req)} /> : null}
              <View style={{ flex: 1 }} />
              {req.status !== 'spam' ? (
                <Button small full={false} icon={req.document_id ? 'document-text-outline' : 'create-outline'}
                  title={req.document_id ? 'Ver orçamento' : 'Fazer orçamento'}
                  loading={busy === req.id} disabled={!!busy} onPress={() => makeQuote(req)} />
              ) : null}
            </View>
          </Card>
        )
      })}

      {qr.data && filter === 'open' && counts.closed ? (
        <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>{counts.closed} arquivado{counts.closed > 1 ? 's' : ''}. Toque em "Arquivados" pra ver.</Muted>
      ) : null}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={st.viewer} onPress={() => setViewer(null)} accessibilityLabel="Fechar foto">
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <View style={st.viewerClose}><Ionicons name="close" size={26} color={colors.white} /></View>
        </Pressable>
      </Modal>
    </View>
  )
}

// ── Tela ─────────────────────────────────────────────────────────────────
export default function QuoteRequestsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Pedidos de orçamento' }} />
      <Locked feature="quote_requests"><RequestsBody /></Locked>
    </>
  )
}

function RequestsBody() {
  const qr = useQuoteRequests()
  useFocusEffect(useCallback(() => { qr.load() }, [qr.load]))
  return (
    <Screen onRefresh={() => qr.load(true)} refreshing={qr.refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
        <Ionicons name="information-circle-outline" size={18} color={colors.inkSoft} />
        <Muted style={{ flex: 1 }}>Chegam pelo botão "Pedir orçamento" da sua página. Responda rápido: quem responde primeiro costuma fechar.</Muted>
      </View>
      <QuoteRequestsPanel qr={qr} />
    </Screen>
  )
}

const st = StyleSheet.create({
  info: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thumb: { width: 84, height: 84, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.paperSoft, marginRight: spacing.sm },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 56, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
})
