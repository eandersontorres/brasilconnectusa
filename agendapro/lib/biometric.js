// Face ID / digital (expo-local-authentication). Liga em Configurações; a trava
// em si fica em components/BiometricGate.js. Nada disso existe no preview web.
// Assinaturas fixas:
//   biometricAvailable() → Promise<boolean>
//   isLockEnabled() / setLockEnabled(bool) → Promise
//   authenticate(reason) → Promise<boolean>
// Extras: biometricLabel() → 'Face ID' | 'Touch ID' | 'digital' | ...
//         authenticateDetailed(reason) → { success, error }
import { Platform } from 'react-native'

const isWeb = Platform.OS === 'web'
const LOCK_KEY = 'agendapro.biometric.lock'

// Carregados só no celular (o preview web não tem esses módulos nativos)
const LA = () => require('expo-local-authentication')
const Store = () => require('expo-secure-store')

/** Celular tem Face ID / digital cadastrado? */
export async function biometricAvailable() {
  if (isWeb) return false
  try {
    const la = LA()
    const [hw, enrolled] = await Promise.all([la.hasHardwareAsync(), la.isEnrolledAsync()])
    return !!(hw && enrolled)
  } catch (_) {
    return false
  }
}

/** Nome do recurso pra mostrar na tela ("Pedir Face ID ao abrir"). */
export async function biometricLabel() {
  if (isWeb) return 'Face ID'
  try {
    const la = LA()
    const types = await la.supportedAuthenticationTypesAsync()
    const face = types.includes(la.AuthenticationType.FACIAL_RECOGNITION)
    const finger = types.includes(la.AuthenticationType.FINGERPRINT)
    if (Platform.OS === 'ios') return face ? 'Face ID' : finger ? 'Touch ID' : 'Face ID'
    if (finger) return 'digital'
    if (face) return 'reconhecimento facial'
    return 'biometria'
  } catch (_) {
    return Platform.OS === 'ios' ? 'Face ID' : 'digital'
  }
}

export async function isLockEnabled() {
  if (isWeb) return false
  try {
    return (await Store().getItemAsync(LOCK_KEY)) === '1'
  } catch (_) {
    return false
  }
}

export async function setLockEnabled(v) {
  if (isWeb) return
  try {
    if (v) await Store().setItemAsync(LOCK_KEY, '1')
    else await Store().deleteItemAsync(LOCK_KEY)
  } catch (_) {}
}

/**
 * Pede Face ID / digital. Se falhar várias vezes, o sistema oferece a senha do
 * aparelho (disableDeviceFallback: false). → { success, error }
 */
export async function authenticateDetailed(reason = 'Desbloquear o AgendaPro') {
  if (isWeb) return { success: true, error: null }
  try {
    const r = await LA().authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancelar',
      fallbackLabel: 'Usar a senha do celular',
      disableDeviceFallback: false,
    })
    return { success: !!r.success, error: r.success ? null : (r.error || 'unknown') }
  } catch (e) {
    return { success: false, error: 'unknown' }
  }
}

export async function authenticate(reason) {
  return (await authenticateDetailed(reason)).success
}

/** Erros em que o celular não tem como pedir biometria nem senha: não dá pra travar. */
export const CANT_AUTH_ERRORS = ['not_enrolled', 'not_available', 'passcode_not_set']
