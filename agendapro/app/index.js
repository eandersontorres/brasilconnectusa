// Porta de entrada: decide entre login, cadastro do perfil e o app.
import { Redirect } from 'expo-router'
import { View } from 'react-native'
import { useApp } from '../lib/session'
import { colors } from '../lib/theme'
import { Button, ErrorBox, Loading } from '../components/ui'

export default function Index() {
  const { authReady, session, hasLoadedMe, provider, meError, refresh, signOut } = useApp()

  if (!authReady) return <Splash />
  if (!session) return <Redirect href="/login" />
  if (!hasLoadedMe) {
    if (meError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.paper }}>
          <ErrorBox error={meError} onRetry={() => refresh()} />
          <Button title="Sair da conta" variant="ghost" onPress={signOut} />
        </View>
      )
    }
    return <Splash />
  }
  if (!provider) return <Redirect href="/onboarding" />
  return <Redirect href="/hoje" />
}

function Splash() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.paper }}>
      <Loading />
    </View>
  )
}
