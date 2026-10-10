// Login: e-mail + senha (entrar ou criar conta) e, como alternativa, código por e-mail.
// Mesma conta do site BrasilConnect (mesmo Supabase).
import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import { colors, radius, spacing, type } from '../../lib/theme'
import { DEMO, PRIVACY_URL, TERMS_URL } from '../../lib/config'
import { useApp } from '../../lib/session'
import { Button, ErrorBox, H1, Input, Muted, P, Segmented } from '../../components/ui'

export default function Login() {
  const [mode, setMode] = useState('signin')      // signin | signup | code
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const { signInDemo } = useApp()

  const cleanEmail = email.trim().toLowerCase()
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)

  async function submitPassword() {
    if (!validEmail) return setError('Digite um e-mail válido.')
    if (password.length < 6) return setError('A senha precisa de pelo menos 6 caracteres.')
    setLoading(true); setError(null); setInfo(null)
    try {
      if (mode === 'signup') {
        const { data, error: e } = await supabase.auth.signUp({ email: cleanEmail, password })
        if (e) throw e
        if (!data.session) {
          setInfo('Enviamos um e-mail de confirmação. Abra o link e depois entre aqui com sua senha, ou use o código por e-mail.')
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (e) throw e
      }
    } catch (e) {
      const m = String(e.message || '')
      if (m.includes('Invalid login')) setError('E-mail ou senha não conferem. Esqueceu a senha? Entre com código por e-mail.')
      else if (m.includes('already registered')) setError('Esse e-mail já tem conta. Toque em "Entrar".')
      else if (m.includes('Email not confirmed')) setError('Confirme seu e-mail pelo link que enviamos, ou entre com código.')
      else setError(m || 'Não deu certo. Tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  async function sendCode() {
    if (!validEmail) return setError('Digite um e-mail válido.')
    setLoading(true); setError(null); setInfo(null)
    try {
      const { error: e } = await supabase.auth.signInWithOtp({ email: cleanEmail, options: { shouldCreateUser: true } })
      if (e) throw e
      setCodeSent(true)
      setInfo(`Enviamos um código para ${cleanEmail}. Confira também o spam.`)
    } catch (e) {
      setError(e.message || 'Não foi possível enviar o código.')
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode() {
    const digits = code.replace(/\D/g, '')
    if (digits.length < 6) return setError('O código tem 6 dígitos ou mais.')
    setLoading(true); setError(null)
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email: cleanEmail, token: digits, type: 'email' })
      if (e) throw e
    } catch (e) {
      setError(String(e.message || '').includes('expired') ? 'Código expirou. Peça um novo.' : (e.message || 'Código inválido'))
    } finally {
      setLoading(false)
    }
  }

  // Modo demonstração: sem login de verdade, só o botão que entra com os dados de exemplo
  if (DEMO) return <DemoEntry onEnter={signInDemo} />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.xl }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.white, fontWeight: '800', fontSize: 18 }}>A</Text>
            </View>
            <View>
              <Text style={[type.h3, { fontWeight: '700' }]}>AgendaPro</Text>
              <Muted>por BrasilConnect</Muted>
            </View>
          </View>

          <H1>Sua agenda, seus clientes e seu dinheiro num lugar só.</H1>
          <P style={{ color: colors.inkSoft, marginTop: spacing.sm, marginBottom: spacing.xl }}>
            14 dias grátis com tudo liberado. Sem cartão pra começar.
          </P>

          <Segmented
            value={mode}
            onChange={(m) => { setMode(m); setError(null); setInfo(null) }}
            options={[{ value: 'signin', label: 'Entrar' }, { value: 'signup', label: 'Criar conta' }, { value: 'code', label: 'Código' }]}
            style={{ marginBottom: spacing.xl }}
          />

          <Input label="E-mail" value={email} onChangeText={setEmail} placeholder="voce@email.com"
            autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />

          {mode !== 'code' ? (
            <>
              <Input label="Senha" value={password} onChangeText={setPassword} secure placeholder="Mínimo 6 caracteres"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                textContentType={mode === 'signup' ? 'newPassword' : 'password'} onSubmitEditing={submitPassword} />
              <ErrorBox error={error} />
              {info ? <Info text={info} /> : null}
              <Button title={mode === 'signup' ? 'Criar conta grátis' : 'Entrar'} onPress={submitPassword} loading={loading} />
              <Pressable onPress={() => { setMode('code'); setError(null) }} style={{ padding: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.green, fontWeight: '600' }}>Esqueci a senha · entrar com código</Text>
              </Pressable>
            </>
          ) : (
            <>
              {codeSent ? (
                <Input label="Código" value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad"
                  autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} onSubmitEditing={verifyCode} />
              ) : null}
              <ErrorBox error={error} />
              {info ? <Info text={info} /> : null}
              {codeSent
                ? <Button title="Entrar" onPress={verifyCode} loading={loading} />
                : <Button title="Receber código por e-mail" onPress={sendCode} loading={loading} />}
              {codeSent ? (
                <Pressable onPress={sendCode} style={{ padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: colors.green, fontWeight: '600' }}>Mandar outro código</Text>
                </Pressable>
              ) : null}
            </>
          )}

          <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
            Ao continuar você aceita os{' '}
            <Text style={{ color: colors.green }} onPress={() => Linking.openURL(TERMS_URL)}>Termos</Text> e a{' '}
            <Text style={{ color: colors.green }} onPress={() => Linking.openURL(PRIVACY_URL)}>Política de Privacidade</Text>.
          </Muted>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// Modo demonstração (EXPO_PUBLIC_DEMO=1): entra direto, com dados de exemplo (lib/demo)
function DemoEntry({ onEnter }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.xl }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.white, fontWeight: '800', fontSize: 18 }}>A</Text>
          </View>
          <View>
            <Text style={[type.h3, { fontWeight: '700' }]}>AgendaPro</Text>
            <Muted>por BrasilConnect</Muted>
          </View>
        </View>
        <H1>Sua agenda, seus clientes e seu dinheiro num lugar só.</H1>
        <P style={{ color: colors.inkSoft, marginTop: spacing.sm, marginBottom: spacing.xl }}>
          Modo demonstração: tudo aqui é de exemplo, de uma profissional fictícia em Boston. Nada é salvo nem enviado pra ninguém.
        </P>
        <Button title="Entrar na demonstração" onPress={onEnter} />
      </ScrollView>
    </SafeAreaView>
  )
}

function Info({ text }) {
  return (
    <View style={{ backgroundColor: colors.greenSoft, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md }}>
      <Text style={{ color: colors.green, fontSize: 14 }}>{text}</Text>
    </View>
  )
}
