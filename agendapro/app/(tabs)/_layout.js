import { Redirect, Tabs, router } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../../lib/session'
import { colors } from '../../lib/theme'
import { DEMO } from '../../lib/config'
import { BRAND } from '../../lib/variant'
import { Loading } from '../../components/ui'

// Modo demonstração: selo discreto no topo das abas (dados de exemplo)
const demoBadge = () => (
  <View style={{ marginRight: 16, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.goldSoft }}
    accessibilityLabel="Modo demonstração, dados de exemplo">
    <Text style={{ color: colors.goldDark, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>DEMO</Text>
  </View>
)

// Todas as abas que existem em app/(tabs)/. Cada app mostra as suas (BRAND.tabs,
// lib/variant.js) e esconde as outras (href: null): o WorkPro troca Finanças por
// Vendas (orçamentos e faturas) e leva Finanças pro menu Mais.
const ALL_TABS = {
  hoje: { title: 'Hoje', icon: 'today' },
  agenda: { title: 'Agenda', icon: 'calendar' },
  vendas: { title: 'Vendas', icon: 'document-text' },
  clientes: { title: 'Clientes', icon: 'people' },
  financas: { title: 'Finanças', icon: 'wallet' },
  mais: { title: 'Mais', icon: 'grid' },
}
// Aba escondida (Finanças no WorkPro, Vendas no AgendaPro) abre pelo menu Mais: sem aba
// marcada embaixo, a seta no topo leva de volta pro Mais.
const backToMore = () => (
  <Pressable onPress={() => router.navigate('/mais')} hitSlop={10} style={{ paddingLeft: 12, paddingRight: 4 }}
    accessibilityRole="button" accessibilityLabel="Voltar">
    <Ionicons name="chevron-back" size={26} color={colors.green} />
  </Pressable>
)

const VISIBLE = BRAND.tabs
const TABS = [
  ...VISIBLE.map((name) => ({ name, ...ALL_TABS[name] })),
  ...Object.keys(ALL_TABS).filter((n) => !VISIBLE.includes(n)).map((name) => ({ name, ...ALL_TABS[name], hidden: true })),
]

export default function TabsLayout() {
  const { authReady, session, hasLoadedMe, provider } = useApp()
  if (!authReady) return <View style={{ flex: 1, backgroundColor: colors.paper }}><Loading /></View>
  if (!session) return <Redirect href="/login" />
  if (hasLoadedMe && !provider) return <Redirect href="/onboarding" />

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink, fontWeight: '700', fontSize: 20 },
        headerTitleAlign: 'left',
        sceneStyle: { backgroundColor: colors.paper },
        ...(DEMO ? { headerRight: demoBadge } : {}),
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? t.icon : `${t.icon}-outline`} size={size} color={color} />,
            ...(t.hidden ? { href: null, headerLeft: backToMore } : {}),
          }}
        />
      ))}
    </Tabs>
  )
}
