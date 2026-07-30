// ════════════════════════════════════════════════════════════════════════════
//   Root layout — carrega fontes + cuida do deep link de auth
// ════════════════════════════════════════════════════════════════════════════
import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import * as Linking from 'expo-linking'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
} from '@expo-google-fonts/inter'
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond'
import { View, ActivityIndicator } from 'react-native'
import { colors } from '../lib/theme'
import { supabase } from '../lib/supabase'

// Magic link volta como brasilconnect://auth/callback#access_token=..&refresh_token=..
// Extrai os tokens do fragmento e aplica a sessão.
async function handleAuthDeepLink(url) {
  if (!url) return
  const fragment = url.split('#')[1] || ''
  const params = Object.fromEntries(new URLSearchParams(fragment))
  if (params.access_token && params.refresh_token) {
    await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    })
  }
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
  })

  useEffect(() => {
    Linking.getInitialURL().then(handleAuthDeepLink)
    const sub = Linking.addEventListener('url', ({ url }) => handleAuthDeepLink(url))
    return () => sub.remove()
  }, [])

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.green} />
      </View>
    )
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  )
}
