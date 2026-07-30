// ════════════════════════════════════════════════════════════════════════════
//   /magic-link — pede email e dispara OTP via Supabase
// ════════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors, fonts, spacing, radius } from '../../lib/theme'
import { signInWithEmail } from '../../lib/auth'

export default function MagicLink() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function handleSubmit() {
    if (!email.trim()) return
    setLoading(true)
    setErr(null)
    const { error } = await signInWithEmail(email.trim())
    setLoading(false)
    if (error) {
      setErr(error.message || 'Não foi possível enviar o link. Tente de novo.')
      return
    }
    router.push({ pathname: '/(auth)/magic-link-sent', params: { email: email.trim() } })
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.container}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>← Voltar</Text>
          </Pressable>

          <Text style={styles.title}>Entrar</Text>
          <Text style={styles.subtitle}>
            Sem senha — a gente manda um link mágico no seu e-mail.
          </Text>

          <Text style={styles.label}>E-mail</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="voce@email.com"
            placeholderTextColor={colors.textHint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
            style={styles.input}
          />

          {err && <Text style={styles.error}>{err}</Text>}

          <Pressable
            onPress={handleSubmit}
            disabled={!email.trim() || loading}
            style={({ pressed }) => [
              styles.cta,
              (!email.trim() || loading) && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.ctaText}>
              {loading ? 'Enviando…' : 'Receber link →'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  back: { fontFamily: fonts.sansMed, fontSize: 14, color: colors.textMuted, marginBottom: spacing.xl },
  title: { fontFamily: fonts.serifBold, fontSize: 32, color: colors.navy, marginBottom: spacing.sm },
  subtitle: { fontFamily: fonts.sans, fontSize: 14, color: colors.textMuted, marginBottom: spacing.xxl },
  label: { fontFamily: fonts.sansMed, fontSize: 13, color: colors.text, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  error: { fontFamily: fonts.sans, fontSize: 13, color: colors.danger, marginBottom: spacing.md },
  cta: {
    backgroundColor: colors.green,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.textOnDark },
})
