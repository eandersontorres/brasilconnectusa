import { Redirect, Stack } from 'expo-router'
import { useApp } from '../../lib/session'

export default function AuthLayout() {
  const { authReady, session } = useApp()
  if (authReady && session) return <Redirect href="/" />
  return <Stack screenOptions={{ headerShown: false }} />
}
