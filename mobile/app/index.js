// ════════════════════════════════════════════════════════════════════════════
//   / → redireciona pra (tabs) se logado, (auth) caso contrário.
// ════════════════════════════════════════════════════════════════════════════
import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'

export default function Index() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.green} />
      </View>
    )
  }

  if (!user) return <Redirect href="/(auth)/welcome" />
  return <Redirect href="/(tabs)/feed" />
}
