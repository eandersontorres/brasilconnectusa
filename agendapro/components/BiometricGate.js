// Trava com Face ID / digital (ligada em Configurações → Segurança).
// Pede ao abrir o app e ao voltar depois de mais de 60s em segundo plano.
// O app continua montado por baixo (não perde a tela em que estava); a trava é
// uma camada por cima. Sem login, ou no preview web, não trava.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../lib/session'
import { authenticateDetailed, biometricLabel, CANT_AUTH_ERRORS, isLockEnabled, setLockEnabled } from '../lib/biometric'
import { colors, spacing, type } from '../lib/theme'
import { Button } from './ui'
import { BRAND } from '../lib/variant'

const RELOCK_AFTER_MS = 60 * 1000
const isWeb = Platform.OS === 'web'

export default function BiometricGate({ children }) {
  const { authReady, session } = useApp()
  const [checking, setChecking] = useState(!isWeb)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('Face ID')
  const [failed, setFailed] = useState(false)

  const authing = useRef(false)
  const bgSince = useRef(null)
  const hasSession = !!session

  const unlock = useCallback(async () => {
    if (authing.current) return
    authing.current = true
    setBusy(true)
    try {
      const r = await authenticateDetailed(`Desbloquear o ${BRAND.name}`)
      if (r.success) { setLocked(false); setFailed(false); return }
      // Biometria e senha foram tiradas do celular: não dá pra cobrar, desliga a trava
      if (CANT_AUTH_ERRORS.includes(r.error)) {
        await setLockEnabled(false)
        setLocked(false)
        return
      }
      setFailed(r.error !== 'user_cancel' && r.error !== 'system_cancel' && r.error !== 'app_cancel')
    } finally {
      authing.current = false
      setBusy(false)
    }
  }, [])

  // Abertura do app (uma vez): trava se a opção estiver ligada e houver login.
  // Quem acabou de entrar com a senha não precisa de Face ID em seguida.
  const started = useRef(false)
  useEffect(() => {
    if (isWeb || !authReady || started.current) return
    started.current = true
    ;(async () => {
      biometricLabel().then(setLabel)
      const on = hasSession && (await isLockEnabled())
      if (on) {
        setLocked(true)
        setChecking(false)
        // Um respiro pro app terminar de abrir (o Face ID cancela se o app ainda não está ativo)
        setTimeout(unlock, 300)
      } else {
        setChecking(false)
      }
    })()
  }, [authReady, hasSession, unlock])

  // Saiu da conta: nada pra proteger
  useEffect(() => {
    if (!hasSession) setLocked(false)
  }, [hasSession])

  // Volta do segundo plano: trava de novo depois de 60s fora
  useEffect(() => {
    if (isWeb) return
    const sub = AppState.addEventListener('change', async (st) => {
      // 'inactive' (iOS) acontece durante o próprio Face ID: só 'background' conta
      if (st === 'background') {
        if (!authing.current) bgSince.current = Date.now()
        return
      }
      if (st !== 'active') return
      const since = bgSince.current
      bgSince.current = null
      if (!since || authing.current || !hasSession) return
      if (Date.now() - since < RELOCK_AFTER_MS) return
      if (!(await isLockEnabled())) return
      setLocked(true)
      unlock()
    })
    return () => sub.remove()
  }, [hasSession, unlock])

  if (isWeb) return children

  return (
    <View style={{ flex: 1 }}>
      {children}
      {checking || locked ? (
        <View style={[StyleSheet.absoluteFill, s.cover]} accessibilityViewIsModal>
          {checking ? null : (
            <View style={s.box}>
              <View style={s.icon}>
                <Ionicons name="lock-closed" size={30} color={colors.green} />
              </View>
              <Text style={[type.h2, { marginTop: spacing.lg, textAlign: 'center' }]}>{BRAND.name} bloqueado</Text>
              <Text style={[type.small, { marginTop: spacing.sm, textAlign: 'center' }]}>
                {failed ? `Não reconheceu. Tente de novo com ${label} ou com a senha do celular.` : `Use ${label} ou a senha do celular pra abrir.`}
              </Text>
              <Button title="Desbloquear" icon="finger-print" onPress={unlock} loading={busy} style={{ marginTop: spacing.xl, alignSelf: 'stretch' }} />
            </View>
          )}
        </View>
      ) : null}
    </View>
  )
}

const s = StyleSheet.create({
  cover: { backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  box: { width: '100%', maxWidth: 360, paddingHorizontal: spacing.xl, alignItems: 'center' },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
})
