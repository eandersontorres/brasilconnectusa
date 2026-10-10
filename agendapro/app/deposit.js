// Sinal e pagamentos: o que é o sinal, instruções de Zelle/dinheiro (Starter) e
// conta Stripe pra cliente pagar o sinal no cartão (Pro).
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { fmtMoney, fmtPhone } from '../lib/format'
import { colors, radius, spacing } from '../lib/theme'
import { LockedCard } from '../components/Locked'
import { Badge, Banner, Button, Card, Chip, ErrorBox, H3, Input, Loading, Muted, P, Screen, Section } from '../components/ui'

const MAX_TEXT = 300

function Point({ icon, text }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={colors.green} style={{ marginTop: 1 }} />
      <P style={{ flex: 1, color: colors.inkSoft }}>{text}</P>
    </View>
  )
}

export default function Deposit() {
  const app = useApp()
  const { provider, setProvider } = app
  const canOffline = app.can('deposit_offline')
  const canStripe = app.can('deposit_stripe')

  // ── Serviços com sinal (resumo) ─────────────────────────────────────────
  const [services, setServices] = useState(null)
  const loadServices = useCallback(async () => {
    try { const r = await api('/api/agenda/services?mine=1'); setServices(r.services || []) } catch (_) { setServices(null) }
  }, [])

  // ── Instruções Zelle / dinheiro ─────────────────────────────────────────
  const [text, setText] = useState(provider?.deposit_instructions || '')
  const [savingText, setSavingText] = useState(false)
  const [textSaved, setTextSaved] = useState(false)
  const original = provider?.deposit_instructions || ''
  const textDirty = text.trim() !== original.trim()

  // Perfil chegou depois (cache → rede): preenche se a pessoa ainda não mexeu
  const touched = useRef(false)
  useEffect(() => { if (!touched.current) setText(provider?.deposit_instructions || '') }, [provider?.deposit_instructions])

  function editText(v) { touched.current = true; setTextSaved(false); setText(v.slice(0, MAX_TEXT)) }

  function addLine(kind) {
    const who = provider?.name || ''
    const phone = provider?.whatsapp ? fmtPhone(provider.whatsapp) : ''
    const contact = phone || provider?.email || ''
    const lines = {
      zelle: `Zelle: ${contact || '(seu telefone ou e-mail)'}${who ? ` (${who})` : ''}`,
      venmo: 'Venmo: @seu-usuario',
      cashapp: 'Cash App: $seu-usuario',
      cash: 'Ou em dinheiro, combinando comigo pelo WhatsApp.',
      proof: 'Depois de pagar, me mande o comprovante no WhatsApp que eu confirmo seu horário.',
    }
    const line = lines[kind]
    if (!line || text.includes(line)) return
    editText(text.trim() ? `${text.trim()}\n${line}` : line)
  }

  async function saveText() {
    if (!(await ensureFeature(app, 'deposit_offline'))) return
    setSavingText(true)
    try {
      const value = text.trim()
      const r = await post('/api/agenda/provider', { deposit_instructions: value })
      setProvider(r?.provider ? { ...r.provider, deposit_instructions: r.provider.deposit_instructions ?? value } : { deposit_instructions: value })
      touched.current = false
      setTextSaved(true)
    } catch (e) {
      showError(e)
    } finally {
      setSavingText(false)
    }
  }

  // ── Stripe ──────────────────────────────────────────────────────────────
  const [conn, setConn] = useState(null)
  const [connError, setConnError] = useState(null)
  const [opening, setOpening] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const chargesRef = useRef(!!provider?.stripe_charges_enabled)
  chargesRef.current = !!provider?.stripe_charges_enabled
  const loadConn = useCallback(async () => {
    if (!canStripe) return
    try {
      const r = await api('/api/agenda/connect')
      setConn(r)
      setConnError(null)
      // Mantém o perfil em memória igual ao Stripe (outras telas leem stripe_charges_enabled)
      if (!!r.charges_enabled !== chargesRef.current) setProvider({ stripe_charges_enabled: !!r.charges_enabled, stripe_onboarded: !!r.onboarded, stripe_connected: !!r.connected })
    } catch (e) {
      setConnError(e)
    }
  }, [canStripe, setProvider])

  useFocusEffect(useCallback(() => { loadServices(); loadConn() }, [loadServices, loadConn]))

  // Voltou do navegador (cadastro no Stripe)? Confere de novo. No Android o
  // openBrowserAsync volta na hora, então o AppState é quem avisa.
  const waitingStripe = useRef(false)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && waitingStripe.current) { waitingStripe.current = false; loadConn(); app.refresh({ silent: true }) }
    })
    return () => sub.remove()
  }, [loadConn, app.refresh])

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([loadServices(), loadConn(), app.refresh({ silent: true })])
    setRefreshing(false)
  }

  async function openStripe() {
    if (!(await ensureFeature(app, 'deposit_stripe'))) return
    setOpening(true)
    try {
      const r = await post('/api/agenda/connect', { return_to: 'app' })
      const url = r.url || r.onboarding_url
      if (!url) throw new Error('O Stripe não devolveu o link. Tente de novo.')
      waitingStripe.current = true
      await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'done', toolbarColor: colors.paper, controlsColor: colors.green })
      if (Platform.OS === 'ios') { waitingStripe.current = false; await loadConn(); app.refresh({ silent: true }) }
    } catch (e) {
      waitingStripe.current = false
      showError(e)
    } finally {
      setOpening(false)
    }
  }

  async function openDashboard() {
    setOpening(true)
    try {
      const r = await post('/api/agenda/connect', { action: 'dashboard' })
      await WebBrowser.openBrowserAsync(r.url, { dismissButtonStyle: 'done' })
    } catch (e) {
      showError(e)
    } finally {
      setOpening(false)
    }
  }

  const withDeposit = (services || []).filter((s) => s.active !== false && s.deposit_cents > 0)
  const activeCount = (services || []).filter((s) => s.active !== false).length
  const cardOn = canStripe && !!(conn ? conn.charges_enabled : provider?.stripe_charges_enabled)

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Sinal e pagamentos' }} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Ionicons name="shield-checkmark" size={22} color={colors.green} />
          <H3>Sinal garante o horário</H3>
        </View>
        <P style={{ color: colors.inkSoft, marginTop: spacing.sm }}>
          A cliente paga uma parte antes de vir e o valor é descontado do total no dia. Quem paga sinal quase nunca falta.
        </P>
        <Point icon="pricetag-outline" text="Você escolhe o valor do sinal em cada serviço (ou deixa sem)." />
        <Point icon="hourglass-outline" text="Enquanto o sinal não chega, o horário fica como 'Aguardando sinal' na agenda." />
        <Point icon="checkmark-done-outline" text="Recebeu por Zelle ou dinheiro? Toque em 'Sinal recebido' no agendamento e ele confirma." />

        <View style={{ marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.paperSoft }}>
          {services ? (
            <Muted>
              {activeCount === 0 ? 'Você ainda não tem serviços.'
                : withDeposit.length === 0 ? 'Nenhum serviço pede sinal ainda.'
                : `${withDeposit.length} de ${activeCount} serviço${activeCount === 1 ? '' : 's'} com sinal: ${withDeposit.slice(0, 3).map((s) => `${s.name} (${fmtMoney(s.deposit_cents)})`).join(', ')}${withDeposit.length > 3 ? '…' : ''}`}
            </Muted>
          ) : <Muted>Seus serviços com sinal aparecem aqui.</Muted>}
          <Button title="Definir sinal nos serviços" small variant="secondary" icon="pricetags-outline" full={false}
            onPress={() => router.push('/services')} style={{ marginTop: spacing.sm }} />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }}>
        <Muted>Hoje suas clientes pagam o sinal:</Muted>
        <Badge text={cardOn ? 'no cartão' : 'por Zelle / dinheiro'} tone={cardOn ? 'green' : 'gold'} icon={cardOn ? 'card' : 'cash-outline'} />
      </View>

      {/* ── Zelle / dinheiro ─────────────────────────────────────────────── */}
      <Section title="Zelle, Venmo ou dinheiro">
        {canOffline ? (
          <Card>
            <P style={{ color: colors.inkSoft, marginBottom: spacing.md }}>
              Essas instruções aparecem na sua página e na confirmação do agendamento{cardOn ? ' (pra quem não pagar no cartão)' : ''}.
            </P>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Chip label="Zelle" icon="add" onPress={() => addLine('zelle')} />
              <Chip label="Venmo" icon="add" onPress={() => addLine('venmo')} />
              <Chip label="Cash App" icon="add" onPress={() => addLine('cashapp')} />
              <Chip label="Dinheiro" icon="add" onPress={() => addLine('cash')} />
              <Chip label="Pedir comprovante" icon="add" onPress={() => addLine('proof')} />
            </View>
            <Input value={text} onChangeText={editText} multiline maxLength={MAX_TEXT}
              placeholder="Ex.: Zelle: (617) 555-0101 (Ana Torres). Mande o comprovante no WhatsApp."
              hint={`${text.length}/${MAX_TEXT}`} />
            {textSaved && !textDirty ? <Banner tone="green" icon="checkmark-circle-outline" text="Instruções salvas." /> : null}
            <Button title="Salvar instruções" onPress={saveText} loading={savingText} disabled={!textDirty} />
            {text.trim() ? (
              <View style={{ marginTop: spacing.lg }}>
                <Muted style={{ marginBottom: spacing.xs }}>Como a cliente vê</Muted>
                <View style={{ borderLeftWidth: 3, borderLeftColor: colors.gold, paddingLeft: spacing.md, paddingVertical: spacing.xs }}>
                  <P>{text.trim()}</P>
                </View>
              </View>
            ) : null}
          </Card>
        ) : <LockedCard feature="deposit_offline" />}
      </Section>

      {/* ── Cartão (Stripe) ──────────────────────────────────────────────── */}
      <Section title="Sinal no cartão">
        {!canStripe ? <LockedCard feature="deposit_stripe" /> : (
          <Card>
            {connError ? <ErrorBox error={connError} onRetry={loadConn} /> : null}
            {!conn && !connError ? <Loading text="Conferindo sua conta Stripe…" /> : null}
            {conn ? <StripeStatus conn={conn} opening={opening} onConnect={openStripe} onDashboard={openDashboard} /> : null}
          </Card>
        )}
      </Section>

      <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
        A BrasilConnect não cobra comissão sobre o sinal.
      </Muted>
    </Screen>
  )
}

function StripeStatus({ conn, opening, onConnect, onDashboard }) {
  if (conn.stripe_available === false) {
    return <Muted>O pagamento com cartão está indisponível no momento. Use Zelle ou dinheiro enquanto isso.</Muted>
  }
  if (!conn.connected) {
    return (
      <>
        <P style={{ color: colors.inkSoft }}>
          Conecte uma conta Stripe (grátis) e a cliente paga o sinal no cartão na hora de agendar. O horário confirma sozinho e o dinheiro cai na sua conta bancária.
        </P>
        <Muted style={{ marginTop: spacing.sm }}>O Stripe cobra a taxa dele por pagamento. Leva uns 5 minutos: tenha em mãos seus documentos e os dados da conta do banco.</Muted>
        <Button title="Conectar com Stripe" icon="card-outline" onPress={onConnect} loading={opening} style={{ marginTop: spacing.lg }} />
      </>
    )
  }
  if (!conn.onboarded) {
    return (
      <>
        <Badge text="Cadastro incompleto" tone="orange" icon="alert-circle-outline" />
        <P style={{ color: colors.inkSoft, marginTop: spacing.sm }}>Falta terminar o cadastro no Stripe pra começar a receber no cartão.</P>
        <Button title="Continuar cadastro" icon="arrow-forward" onPress={onConnect} loading={opening} style={{ marginTop: spacing.lg }} />
      </>
    )
  }
  if (!conn.charges_enabled) {
    const due = (conn.requirements_due || []).length
    return (
      <>
        <Badge text="Em análise" tone="gold" icon="time-outline" />
        <P style={{ color: colors.inkSoft, marginTop: spacing.sm }}>
          O Stripe está conferindo seus dados. Costuma levar poucos minutos.{due ? ` Ele pediu mais ${due} informaç${due === 1 ? 'ão' : 'ões'}.` : ''}
        </P>
        <Button title={due ? 'Enviar o que falta' : 'Revisar cadastro'} variant={due ? 'primary' : 'secondary'} onPress={onConnect} loading={opening} style={{ marginTop: spacing.lg }} />
      </>
    )
  }
  return (
    <>
      <Badge text="Ativo" tone="green" icon="checkmark-circle" />
      <P style={{ color: colors.inkSoft, marginTop: spacing.sm }}>Suas clientes pagam o sinal no cartão ao agendar, e o horário confirma sozinho.</P>
      {conn.payouts_enabled === false ? (
        <Banner tone="orange" icon="alert-circle-outline" text="Repasses pausados: confira a conta bancária no Stripe." onPress={onConnect} action="Abrir" />
      ) : null}
      <Button title="Ver saldo e repasses" variant="secondary" icon="wallet-outline" onPress={onDashboard} loading={opening} style={{ marginTop: spacing.lg }} />
    </>
  )
}
