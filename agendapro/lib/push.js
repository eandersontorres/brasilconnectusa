// Notificações push (expo-notifications + API da Expo). O servidor manda os avisos
// (api/_lib/agendaPush.js): agendamento novo, avaliação, resumo de amanhã, cobrança.
// Assinaturas fixas:
//   registerForPush() → Promise<string|null>   (token Expo, já salvo no servidor)
//   unregisterPush() → Promise<void>           (ao sair da conta; chame ANTES do signOut)
// Extras pra tela de Configurações:
//   pushPermission() → 'granted' | 'denied' | 'undetermined' | 'unavailable'
//   registerForPush({ ask: false }) → só registra se a permissão já foi dada
//   lastPushError() → motivo do último null ('web', 'simulator', 'denied', 'no_project', 'error')
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { post } from './api'
import { EAS_PROJECT_ID } from './config'
import { VARIANT } from './variant'

const TOKEN_KEY = 'agendapro.push.token.v1'
const isWeb = Platform.OS === 'web'

// Módulos nativos carregados só no celular
const N = () => require('expo-notifications')
const Dev = () => require('expo-device')

let lastError = null
export const lastPushError = () => lastError

/** Canal do Android (precisa existir antes de pedir a permissão no Android 13+). */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return
  const n = N()
  await n.setNotificationChannelAsync('default', {
    name: 'Agendamentos',
    importance: n.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1F4D3F',
    sound: 'default',
  })
}

export async function pushPermission() {
  if (isWeb) return 'unavailable'
  try {
    if (!Dev().isDevice) return 'unavailable'
    const { status } = await N().getPermissionsAsync()
    return status || 'undetermined'
  } catch (_) {
    return 'unavailable'
  }
}

export async function registerForPush({ ask = true } = {}) {
  lastError = null
  if (isWeb) { lastError = 'web'; return null }
  try {
    if (!Dev().isDevice) { lastError = 'simulator'; return null }
    const n = N()
    await ensureAndroidChannel()

    let { status } = await n.getPermissionsAsync()
    if (status !== 'granted' && ask) {
      const r = await n.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })
      status = r.status
    }
    if (status !== 'granted') { lastError = 'denied'; return null }

    if (!EAS_PROJECT_ID) {
      // Sem projectId do EAS a Expo não emite token (rode `eas init` e defina EAS_PROJECT_ID)
      console.warn('[push] EAS_PROJECT_ID ausente: notificações desligadas neste build')
      lastError = 'no_project'
      return null
    }

    const { data: token } = await n.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })
    if (!token) { lastError = 'error'; return null }

    const d = Dev()
    await post('/api/agenda/push-token', {
      token,
      app: VARIANT,                       // AgendaPro e WorkPro: cada app recebe os seus avisos
      platform: Platform.OS,
      device_name: d.deviceName || d.modelName || null,
    })
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {})
    return token
  } catch (e) {
    console.warn('[push] registro falhou:', e?.message || e)
    lastError = 'error'
    return null
  }
}

export async function unregisterPush() {
  if (isWeb) return
  let token = null
  try { token = await AsyncStorage.getItem(TOKEN_KEY) } catch (_) {}
  if (token) {
    try { await post('/api/agenda/push-token', { action: 'unregister', token }) } catch (_) {}
  }
  try { await AsyncStorage.removeItem(TOKEN_KEY) } catch (_) {}
  try { await N().setBadgeCountAsync(0) } catch (_) {}
}

/** Token salvo neste celular (null = ainda não registrou). */
export async function savedPushToken() {
  try { return await AsyncStorage.getItem(TOKEN_KEY) } catch (_) { return null }
}
