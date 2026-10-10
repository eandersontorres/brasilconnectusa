import { Redirect, Tabs } from 'expo-router'
import { Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../../lib/session'
import { colors } from '../../lib/theme'
import { DEMO } from '../../lib/config'
import { Loading } from '../../components/ui'

// Modo demonstração: selo discreto no topo das abas (dados de exemplo)
const demoBadge = () => (
  <View style={{ marginRight: 16, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.goldSoft }}
    accessibilityLabel="Modo demonstração, dados de exemplo">
    <Text style={{ color: colors.goldDark, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>DEMO</Text>
  </View>
)

const TABS = [
  { name: 'hoje', title: 'Hoje', icon: 'today' },
  { name: 'agenda', title: 'Agenda', icon: 'calendar' },
  { name: 'clientes', title: 'Clientes', icon: 'people' },
  { name: 'financas', title: 'Finanças', icon: 'wallet' },
  { name: 'mais', title: 'Mais', icon: 'grid' },
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
          }}
        />
      ))}
    </Tabs>
  )
}
