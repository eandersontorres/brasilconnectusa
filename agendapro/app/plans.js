// Planos e assinatura: situação atual (teste, plano, renovação, pagamento pendente),
// os 3 planos montados do catálogo do servidor (ent.catalog) e o botão de assinar.
// Modo 'link' (EXTERNAL_PURCHASE, lib/config.js): preços e checkout do Stripe no
// navegador. Modo 'companion' (padrão nas lojas): sem preço, sem botão de compra e
// sem chamada pra assinar fora; só o plano ativo e o que cada plano inclui.
// /plans?feature=<chave> destaca o recurso.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking, Platform, Text, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../lib/session'
import { post } from '../lib/api'
import { featureInfo, showError } from '../lib/gate'
import { notify } from '../lib/dialog'
import { EXTERNAL_PURCHASE, PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '../lib/config'
import { MONTHS_LONG } from '../lib/format'
import { BRAND } from '../lib/variant'
import { colors, spacing, type } from '../lib/theme'
import { Badge, Banner, Button, Card, Divider, ErrorBox, H2, H3, Label, Loading, Muted, P, Screen, Small } from '../components/ui'

const PLAN_KEYS = ['starter', 'pro', 'premium']
const PREV_NAME = { pro: 'Starter', premium: 'Pro' }
const MIN_TRIAL_MS = 48 * 3600e3   // menos que isso, o Stripe não aceita manter o teste

/** Data real (timestamp com fuso) → '20 de outubro'. */
function fmtDate(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`
}

const planKey = (p) => (PLAN_KEYS.includes(p) ? p : p === 'salao' ? 'premium' : 'starter')
const subKey = (me) => {
  const p = me?.provider || {}
  return `${!!p.has_subscription}|${p.plan}|${p.plan_status}|${me?.entitlements?.tier}`
}

async function openUrl(url) {
  try {
    return await WebBrowser.openBrowserAsync(url, {
      dismissButtonStyle: 'close',
      controlsColor: colors.green,
      toolbarColor: colors.paper,
      enableBarCollapsing: true,
    })
  } catch (_) {
    await Linking.openURL(url).catch(() => {})
    return { type: 'opened' }
  }
}

export default function Plans() {
  const app = useApp()
  const { ent, provider, user, hasLoadedMe, meError, refresh } = app
  const params = useLocalSearchParams()
  const highlight = typeof params.feature === 'string' ? params.feature : null

  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(null)          // 'starter' | 'portal' | 'check' ...
  const [checking, setChecking] = useState(false) // conferindo a assinatura depois do Stripe
  const alive = useRef(true)
  const awaitingReturn = useRef(null)             // chave da assinatura antes de abrir o Stripe (Android)
  useEffect(() => () => { alive.current = false }, [])

  const catalog = ent.catalog
  const subscribed = !!provider?.has_subscription && ent.tier !== 'none'
  const currentPlan = subscribed ? planKey(provider?.plan) : null
  const hf = highlight && catalog?.features?.[highlight] ? featureInfo(ent, highlight) : null

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await refresh({ silent: true }) } finally { if (alive.current) setRefreshing(false) }
  }, [refresh])

  /**
   * Depois do checkout/portal: o webhook do Stripe pode levar uns segundos.
   * Atualiza até 5 vezes e avisa quando a assinatura mudar.
   */
  const checkAfterReturn = useCallback(async (before, { quiet = false } = {}) => {
    setChecking(true)
    try {
      for (let i = 0; i < 5 && alive.current; i++) {
        const r = await refresh({ silent: true })
        if (r && subKey(r) !== before) {
          const p = r.provider || {}
          const name = r.entitlements?.catalog?.plans?.[planKey(p.plan)]?.name || 'novo'
          if (p.has_subscription && r.entitlements?.tier !== 'none') {
            notify('Assinatura confirmada!', r.entitlements?.trial
              ? `Seu plano ${name} está garantido. Tudo continua liberado até o fim do teste, e a primeira cobrança só acontece depois.`
              : `Seu plano ${name} já está valendo. Obrigada por confiar no ${BRAND.name}!`)
          }
          return true
        }
        await new Promise((ok) => setTimeout(ok, 2000))
      }
      if (!quiet) {
        notify('Ainda não apareceu', 'Se você terminou o pagamento, espere um minutinho e puxe a tela pra atualizar.')
      }
      return false
    } finally {
      if (alive.current) setChecking(false)
    }
  }, [refresh])

  // Android: o navegador abre por cima e a promessa volta na hora. Confere quando o app volta.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' || awaitingReturn.current == null) return
      const before = awaitingReturn.current
      awaitingReturn.current = null
      checkAfterReturn(before, { quiet: true })
    })
    return () => sub.remove()
  }, [checkAfterReturn])

  async function openStripe(url, { quiet }) {
    const before = subKey(app.me)
    if (Platform.OS === 'android') awaitingReturn.current = before
    const r = await openUrl(url)
    if (r?.type !== 'opened') {
      awaitingReturn.current = null
      await checkAfterReturn(before, { quiet })
    }
  }

  async function openPortal(tag = 'portal') {
    setBusy(tag)
    try {
      const { portal_url } = await post('/api/stripe/portal', { source: 'app' })
      await openStripe(portal_url, { quiet: true })
    } catch (e) {
      showError(e, 'Não abriu a página de cobrança')
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  async function subscribe(plan) {
    if (!provider?.id) return
    setBusy(plan)
    try {
      let res
      try {
        res = await post('/api/stripe/subscribe', { provider_id: provider.id, plan, source: 'app' })
      } catch (e) {
        // Já tem assinatura: troca de plano é pelo portal
        if (e?.status === 409 && e.body?.use_portal) return await openPortal(plan)
        throw e
      }
      await openStripe(res.checkout_url, { quiet: true })
    } catch (e) {
      showError(e, 'Não abriu o pagamento')
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  async function alreadySubscribed() {
    setBusy('check')
    try {
      const r = await refresh({ silent: true })
      if (!r) { notify('Sem conexão', 'Confira a internet e tente de novo.'); return }
      if (r.provider?.has_subscription && r.entitlements?.tier !== 'none') {
        notify('Tudo certo!', 'Seu plano já está valendo aqui no app.')
      } else if (EXTERNAL_PURCHASE) {
        notify('Ainda não encontramos', `Confira se você assinou com o mesmo e-mail desta conta (${user?.email || 'seu e-mail'}). Se acabou de assinar, espere um minutinho e tente de novo.`)
      } else {
        notify('Plano atualizado', `Nada mudou na sua conta (${user?.email || 'seu e-mail'}). Se o plano mudou agora há pouco, espere um minutinho e tente de novo.`)
      }
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  // ── Estados de carregamento ─────────────────────────────────────────────
  if (!catalog) {
    return (
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <Stack.Screen options={{ title: 'Planos' }} />
        {meError && !hasLoadedMe ? <ErrorBox error={meError} onRetry={() => refresh()} /> : <Loading text="Carregando os planos…" />}
      </Screen>
    )
  }

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Planos' }} />

      {checking ? <Banner tone="blue" icon="sync-outline" text="Conferindo sua assinatura…" /> : null}

      <StatusCard ent={ent} provider={provider} catalog={catalog} subscribed={subscribed} sell={EXTERNAL_PURCHASE}
        onPortal={EXTERNAL_PURCHASE ? () => openPortal() : null} busy={busy === 'portal'} />

      {hf ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.goldSoft, borderColor: colors.gold }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name="sparkles" size={18} color={colors.goldDark} />
            <H3 style={{ flex: 1, color: colors.goldDark }}>{hf.label}</H3>
          </View>
          {hf.desc ? <P style={{ marginTop: 6, color: colors.inkSoft }}>{hf.desc}</P> : null}
          <Small style={{ marginTop: 6, color: colors.goldDark, fontWeight: '600' }}>
            {app.can(highlight) ? 'Já liberado no seu plano atual.' : `Faz parte do plano ${hf.minName} (e dos planos acima).`}
          </Small>
        </Card>
      ) : null}

      <Label style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>{EXTERNAL_PURCHASE ? 'Escolha seu plano' : 'O que cada plano inclui'}</Label>
      {PLAN_KEYS.map((key) => (
        <PlanCard
          key={key}
          planKey={key}
          catalog={catalog}
          highlight={highlight}
          isCurrent={currentPlan === key}
          popular={key === 'pro'}
          subscribed={subscribed}
          busy={busy === key}
          disabled={!!busy || checking}
          onSubscribe={() => subscribe(key)}
          onPortal={() => openPortal(key)}
        />
      ))}

      {!EXTERNAL_PURCHASE ? (
        <Card style={{ marginTop: spacing.md }}>
          <P>Sua assinatura fica na sua conta BrasilConnect. Quando o plano mudar, o app atualiza sozinho.</P>
        </Card>
      ) : null}

      <Button title={EXTERNAL_PURCHASE ? 'Já assinei pelo site' : 'Atualizar meu plano'} variant="ghost" icon="refresh-outline" onPress={alreadySubscribed}
        loading={busy === 'check'} disabled={!!busy && busy !== 'check'} style={{ marginTop: spacing.md }} />

      <View style={{ marginTop: spacing.lg, paddingHorizontal: spacing.xs }}>
        {EXTERNAL_PURCHASE ? (
          <Muted style={{ textAlign: 'center' }}>
            Assinatura mensal com renovação automática no cartão. Cancele quando quiser, sem multa, em "Gerenciar assinatura": o plano vale até o fim do mês já pago. Pagamento processado pelo Stripe.
          </Muted>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.md }}>
          <Text style={{ color: colors.green, fontWeight: '600', fontSize: 14 }} onPress={() => openUrl(TERMS_URL)}>Termos de uso</Text>
          <Text style={{ color: colors.green, fontWeight: '600', fontSize: 14 }} onPress={() => openUrl(PRIVACY_URL)}>Privacidade</Text>
        </View>
        <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>Dúvidas? {SUPPORT_EMAIL}</Muted>
      </View>
    </Screen>
  )
}

// ── Situação atual ─────────────────────────────────────────────────────────
function StatusCard({ ent, provider, catalog, subscribed, onPortal, busy, sell }) {
  const planName = catalog.plans?.[planKey(provider?.plan)]?.name || 'Starter'
  let badge, title, lines = [], action = null

  if (ent.past_due) {
    badge = <Badge text="Pagamento pendente" tone="red" icon="card-outline" />
    title = `Plano ${planName}`
    lines = [sell
      ? 'Não conseguimos cobrar seu cartão. Atualize a forma de pagamento pra não perder os recursos do plano.'
      : 'Não conseguimos processar a cobrança do seu plano. Os recursos continuam enquanto a cobrança é tentada de novo.']
    if (onPortal) action = <Button title="Atualizar pagamento" variant="danger" icon="card-outline" onPress={onPortal} loading={busy} style={{ marginTop: spacing.md }} />
  } else if (ent.trial && !provider?.has_subscription) {
    const d = ent.trial_days_left
    const endMs = ent.trial_ends_at ? new Date(ent.trial_ends_at).getTime() : 0
    badge = <Badge text="Teste grátis" tone="gold" icon="sparkles-outline" />
    title = d <= 1 ? 'Seu teste acaba hoje' : `Faltam ${d} dias do seu teste`
    lines = [
      `Tudo do Premium liberado${ent.trial_ends_at ? ` até ${fmtDate(ent.trial_ends_at)}` : ''}.`,
      !sell ? 'Quando o teste acabar, os recursos seguem o plano da sua conta.'
        : endMs - Date.now() > MIN_TRIAL_MS
          ? 'Escolha um plano antes do fim pra sua página não parar de receber agendamentos. Assinando agora, tudo continua liberado até o fim do teste e a cobrança do plano escolhido só começa depois.'
          : 'Escolha um plano pra sua página continuar recebendo agendamentos. A cobrança começa no dia da assinatura.',
    ]
  } else if (ent.trial) {
    badge = <Badge text="Em teste" tone="gold" />
    title = `Plano ${planName}`
    lines = [
      'Tudo do Premium liberado até o fim do teste.',
      ent.trial_ends_at ? `Depois, fica o plano ${planName}: primeira cobrança em ${fmtDate(ent.trial_ends_at)}.` : `Depois, fica o plano ${planName}: a primeira cobrança acontece no fim do teste.`,
    ]
  } else if (ent.tier !== 'none') {
    badge = <Badge text="Ativo" tone="green" icon="checkmark-circle" />
    title = `Plano ${planName}`
    lines = [subscribed && provider?.current_period_end ? `Renova em ${fmtDate(provider.current_period_end)}.` : 'Seu plano está em dia.']
  } else {
    badge = <Badge text="Inativo" tone="red" icon="lock-closed" />
    title = 'Seu plano não está ativo'
    lines = [
      ent.reason === 'trial_ended' ? 'Seu teste grátis acabou.'
        : ent.reason === 'canceled' ? 'Sua assinatura foi cancelada.'
        : 'Não há assinatura valendo agora.',
      sell
        ? 'Sua página não aceita agendamentos até você escolher um plano. Seus dados, clientes e histórico continuam guardados.'
        : 'Sua página não aceita agendamentos enquanto o plano não estiver ativo. Seus dados, clientes e histórico continuam guardados.',
    ]
  }

  if (!action && subscribed && onPortal) {
    action = <Button title="Gerenciar assinatura" variant="secondary" icon="settings-outline" onPress={onPortal} loading={busy} style={{ marginTop: spacing.md }} />
  }

  return (
    <Card>
      {badge}
      <H2 style={{ marginTop: spacing.sm }}>{title}</H2>
      {lines.map((l, i) => <P key={i} style={{ marginTop: 6, color: colors.inkSoft }}>{l}</P>)}
      {action}
    </Card>
  )
}

// ── Cartão de um plano ─────────────────────────────────────────────────────
function PlanCard({ planKey: key, catalog, highlight, isCurrent, popular, subscribed, busy, disabled, onSubscribe, onPortal }) {
  const plan = catalog.plans?.[key] || {}
  const feats = useMemo(
    () => Object.entries(catalog.features || {}).filter(([, f]) => f.min === key),
    [catalog, key],
  )
  const hasHighlight = !!highlight && catalog.features?.[highlight]?.min === key
  const lim = catalog.limits?.[key] || {}
  const extras = []
  if ('ical_feeds' in lim && (lim.ical_feeds === null || lim.ical_feeds > 0)) {
    extras.push(lim.ical_feeds === null ? 'Turnover: casas ilimitadas' : `Turnover: até ${lim.ical_feeds} casas`)
  }

  const border = hasHighlight ? colors.gold : isCurrent ? colors.green : popular ? colors.green : colors.line
  let button = null
  if (EXTERNAL_PURCHASE) {
    if (isCurrent) {
      button = <Button title="Gerenciar assinatura" variant="secondary" onPress={onPortal} loading={busy} disabled={disabled && !busy} />
    } else if (subscribed) {
      button = <Button title={`Mudar para o ${plan.name}`} variant={hasHighlight ? 'gold' : 'secondary'} onPress={onPortal} loading={busy} disabled={disabled && !busy} />
    } else {
      button = <Button title={`Assinar o ${plan.name}`} variant={hasHighlight ? 'gold' : popular ? 'primary' : 'secondary'} onPress={onSubscribe} loading={busy} disabled={disabled && !busy} />
    }
  }

  return (
    <Card style={{ marginBottom: spacing.md, borderColor: border, borderWidth: border === colors.line ? 1 : 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <H2>{plan.name}</H2>
        {isCurrent ? <Badge text="Seu plano" tone="green" /> : null}
        {!isCurrent && popular ? <Badge text="Mais escolhido" tone="navy" /> : null}
        {hasHighlight ? <Badge text="Libera o que você quer" tone="gold" icon="sparkles" /> : null}
      </View>
      {EXTERNAL_PURCHASE ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 }}>
          <Text style={[type.h1, { color: colors.ink }]}>${plan.price_usd}</Text>
          <Muted style={{ marginBottom: 5, marginLeft: 4 }}>/mês</Muted>
        </View>
      ) : null}
      {plan.tagline ? <Muted style={{ marginTop: 2 }}>{plan.tagline}</Muted> : null}

      <Divider />
      {PREV_NAME[key] ? <Small style={{ fontWeight: '600', color: colors.green, marginBottom: spacing.sm }}>Tudo do {PREV_NAME[key]}, mais:</Small> : null}
      {feats.map(([k, f]) => {
        const on = k === highlight
        return (
          <View key={k} style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: 7, alignItems: 'flex-start' }}>
            <Ionicons name={on ? 'sparkles' : 'checkmark-circle'} size={18} color={on ? colors.goldDark : colors.flag} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, on && { fontWeight: '700', color: colors.goldDark }]}>{f.label}</Text>
              {on && f.desc ? <Muted>{f.desc}</Muted> : null}
            </View>
          </View>
        )
      })}
      {extras.map((t) => (
        <View key={t} style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: 7 }}>
          <Ionicons name="home-outline" size={18} color={colors.inkSoft} style={{ marginTop: 1 }} />
          <Text style={[type.body, { flex: 1, color: colors.inkSoft }]}>{t}</Text>
        </View>
      ))}

      {button ? <View style={{ marginTop: spacing.md }}>{button}</View> : null}
    </Card>
  )
}
