// ════════════════════════════════════════════════════════════════════════════
//   (tabs) — bottom tab nav. 5 tabs por design (DESIGN.md §3).
// ════════════════════════════════════════════════════════════════════════════
import { Tabs, Redirect } from 'expo-router'
import { Text } from 'react-native'
import { useAuth } from '../../lib/auth'
import { colors, fonts } from '../../lib/theme'

function TabIcon({ glyph, color }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>
}

export default function TabsLayout() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Redirect href="/(auth)/welcome" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.textHint,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.sansMed,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{ title: 'Feed', tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} /> }}
      />
      <Tabs.Screen
        name="communities"
        options={{ title: 'Comunidades', tabBarIcon: ({ color }) => <TabIcon glyph="🌐" color={color} /> }}
      />
      <Tabs.Screen
        name="events"
        options={{ title: 'Eventos', tabBarIcon: ({ color }) => <TabIcon glyph="🎉" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Perfil', tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} /> }}
      />
    </Tabs>
  )
}
