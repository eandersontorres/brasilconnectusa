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
import { Avatar, Badge, Card, Divider, H3, Muted, Row, Screen, Section } from '../../components/ui'
import PlanBanner from '../../components/PlanBanner'

const SUPPORT_WHATSAPP = '' // número do suporte (vazio = só e-mail)

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

export default function Mais() {
  const app = useApp()
  const { provider, ent, user, signOut } = app
  const isCleaning = provider?.vertical === 'cleaning'
  const groups = isCleaning
    ? [...GROUPS.filter((g) => g.cleaningFirst), ...GROUPS.filter((g) => !g.cleaningFirst)]
    : GROUPS

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
            onPress={() => (SUPPORT_WHATSAPP ? openWhatsApp(SUPPORT_WHATSAPP, 'Oi! Preciso de ajuda com o AgendaPro.') : Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=AgendaPro`))} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="log-out-outline" title="Sair" danger onPress={logout} />
        </Card>
      </Section>

      <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>AgendaPro · BrasilConnect</Muted>
    </Screen>
  )
}
