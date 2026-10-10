// Menu "Mais": tudo que não cabe nas abas. Itens com cadeado mostram o plano que libera.
import { Linking, View } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../../lib/session'
import { featureInfo } from '../../lib/gate'
import { confirm } from '../../lib/dialog'
import { colors, spacing } from '../../lib/theme'
import { SUPPORT_EMAIL } from '../../lib/config'
import { openWhatsApp } from '../../lib/whatsapp'
import { BRAND, IS_WORKPRO } from '../../lib/variant'
import { Avatar, Badge, Card, Divider, H3, Muted, Row, Screen, Section } from '../../components/ui'
import PlanBanner from '../../components/PlanBanner'

const SUPPORT_WHATSAPP = '' // número do suporte (vazio = só e-mail)

// Orçamentos e faturas. No WorkPro "Vendas" já é aba, então aqui ficam os ajustes e
// Finanças (a aba de Finanças fica escondida no WorkPro).
const SALES_GROUP = IS_WORKPRO
  ? {
    title: 'Vendas',
    items: [
      { icon: 'pricetags-outline', title: 'Tabela de preços', href: '/price-book', feature: 'price_book' },
      { icon: 'mail-unread-outline', title: 'Pedidos de orçamento', href: '/quote-requests', feature: 'quote_requests' },
      { icon: 'business-outline', title: 'Dados da empresa', href: '/business' },
      { icon: 'wallet-outline', title: 'Finanças', href: '/financas', feature: 'finance' },
    ],
  }
  : {
    title: 'Vendas',
    items: [
      { icon: 'document-text-outline', title: 'Orçamentos e faturas', href: '/vendas', feature: 'quotes' },
      { icon: 'mail-unread-outline', title: 'Pedidos de orçamento', href: '/quote-requests', feature: 'quote_requests' },
      { icon: 'pricetags-outline', title: 'Tabela de preços', href: '/price-book', feature: 'price_book' },
      { icon: 'business-outline', title: 'Dados da empresa', href: '/business' },
    ],
  }

/** WorkPro: Vendas primeiro. AgendaPro: antes de Dinheiro. */
function withSales(groups) {
  if (IS_WORKPRO) return [SALES_GROUP, ...groups]
  const i = groups.findIndex((g) => g.title === 'Dinheiro')
  return i < 0 ? [...groups, SALES_GROUP] : [...groups.slice(0, i), SALES_GROUP, ...groups.slice(i)]
}

const GROUPS = [
  {
    title: 'Meu negócio',
    items: [
      { icon: 'person-circle-outline', title: 'Perfil e página pública', href: '/profile' },
      { icon: 'qr-code-outline', title: 'Link e QR code', href: '/share', feature: 'share_qr' },
      { icon: 'pricetags-outline', title: 'Serviços e preços', href: '/services', feature: 'services' },
      { icon: 'time-outline', title: 'Horário de atendimento', href: '/hours', feature: 'hours' },
      { icon: 'airplane-outline', title: 'Folgas e férias', href: '/blocked', feature: 'hours' },
      { icon: 'card-outline', title: 'Sinal e pagamentos', href: '/deposit', feature: 'deposit_offline' },
      { icon: 'people-circle-outline', title: 'Equipe', href: '/team', feature: 'team' },
      { icon: 'star-outline', title: 'Avaliações', href: '/reviews', feature: 'reviews' },
    ],
  },
  {
    title: 'Clientes',
    items: [
      { icon: 'repeat-outline', title: 'Clientes fixas (recorrência)', href: '/recurring', feature: 'recurring' },
      { icon: 'hourglass-outline', title: 'Lista de espera', href: '/waitlist', feature: 'waitlist' },
      { icon: 'heart-dislike-outline', title: 'Clientes sumidas', href: '/reactivation', feature: 'reactivation' },
      { icon: 'chatbubbles-outline', title: 'Mensagens prontas', href: '/templates', feature: 'whatsapp_templates' },
    ],
  },
  {
    title: 'Limpeza',
    cleaningFirst: true,
    items: [
      { icon: 'home-outline', title: 'Turnover Airbnb, Vrbo e Booking', href: '/turnover', feature: 'turnover_ical' },
    ],
  },
  {
    title: 'Dinheiro',
    items: [
      { icon: 'receipt-outline', title: 'Despesas', href: '/finance/expenses', feature: 'finance' },
      { icon: 'car-outline', title: 'Milhagem', href: '/finance/mileage', feature: 'mileage' },
      { icon: 'bar-chart-outline', title: 'Relatórios e exportação', href: '/finance/reports', feature: 'reports' },
    ],
  },
]

/**
 * Obra/reparo (vertical 'trades'): sem Limpeza (turnover) nem Lista de espera, e os
 * serviços da agenda com nome que não confunde com a tabela de preços dos orçamentos.
 */
const TRADES_HIDE = ['/turnover', '/waitlist']
const TRADES_TITLES = { '/services': 'Serviços da agenda online' }
function forTrades(groups) {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !TRADES_HIDE.includes(it.href)).map((it) => (TRADES_TITLES[it.href] ? { ...it, title: TRADES_TITLES[it.href] } : it)),
    }))
    .filter((g) => g.items.length)
}

export default function Mais() {
  const app = useApp()
  const { provider, ent, user, signOut } = app
  const isCleaning = provider?.vertical === 'cleaning'
  const groups = withSales(isCleaning
    ? [...GROUPS.filter((g) => g.cleaningFirst), ...GROUPS.filter((g) => !g.cleaningFirst)]
    : provider?.vertical === 'trades' ? forTrades(GROUPS) : GROUPS)

  async function logout() {
    if (await confirm('Sair da conta?', 'Seus dados continuam salvos. É só entrar de novo.', { ok: 'Sair', destructive: true })) {
      await signOut()
      router.replace('/login')
    }
  }

  const tierLabel = ent.trial ? `Teste grátis · ${ent.trial_days_left} dia${ent.trial_days_left === 1 ? '' : 's'}`
    : ent.tier === 'none' ? 'Plano inativo'
    : `Plano ${ent.catalog?.plans?.[ent.tier]?.name || ent.tier}`

  return (
    <Screen>
      <PlanBanner />
      <Card onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={provider?.name} uri={provider?.avatar_url} size={52} />
        <View style={{ flex: 1 }}>
          <H3 numberOfLines={1}>{provider?.name || 'Seu perfil'}</H3>
          <Muted numberOfLines={1}>{provider?.specialty || user?.email}</Muted>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      </Card>

      <Card padded={false} style={{ marginTop: spacing.md }}>
        <Row icon="diamond-outline" iconColor={colors.goldDark} title="Meu plano" subtitle={tierLabel} chevron onPress={() => router.push('/plans')}
          right={ent.tier === 'none' ? <Badge text="Inativo" tone="red" /> : null} />
      </Card>

      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <Card padded={false}>
            {g.items.map((it, i) => {
              const locked = it.feature && !app.can(it.feature)
              const info = it.feature ? featureInfo(ent, it.feature) : null
              return (
                <View key={it.href}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
                  <Row icon={it.icon} title={it.title} chevron onPress={() => router.push(it.href)}
                    right={locked ? <Badge text={info.minName} tone="gold" icon="lock-closed" /> : null} />
                </View>
              )
            })}
          </Card>
        </Section>
      ))}

      <Section title="Conta">
        <Card padded={false}>
          <Row icon="settings-outline" title="Configurações" subtitle="Notificações, Face ID, calendário, idioma" chevron onPress={() => router.push('/settings')} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="help-buoy-outline" title="Ajuda e suporte" chevron
            onPress={() => (SUPPORT_WHATSAPP ? openWhatsApp(SUPPORT_WHATSAPP, `Oi! Preciso de ajuda com o ${BRAND.name}.`) : Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(BRAND.name)}`))} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="log-out-outline" title="Sair" danger onPress={logout} />
        </Card>
      </Section>

      <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>{`${BRAND.name} · BrasilConnect`}</Muted>
    </Screen>
  )
}
