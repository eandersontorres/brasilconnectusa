import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppProvider } from '../lib/session'
import { colors } from '../lib/theme'
import BiometricGate from '../components/BiometricGate'
import PushManager from '../components/PushManager'
import SheetHost from '../components/SheetHost'
import TimezoneCheck from '../components/TimezoneCheck'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <BiometricGate>
          <StatusBar style="dark" />
          <PushManager />
          <TimezoneCheck />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.paper },
              headerShadowVisible: false,
              headerTintColor: colors.green,
              headerTitleStyle: { color: colors.ink, fontWeight: '600' },
              headerBackTitle: 'Voltar',
              contentStyle: { backgroundColor: colors.paper },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ title: 'Seu perfil', headerBackVisible: false, gestureEnabled: false }} />
          </Stack>
          <SheetHost />
        </BiometricGate>
      </AppProvider>
    </SafeAreaProvider>
  )
}
