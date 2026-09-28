// ════════════════════════════════════════════════════════════════════════════
//   /welcome — primeira tela. Logo + CTA pra magic-link.
// ════════════════════════════════════════════════════════════════════════════
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors, fonts, spacing, radius } from '../../lib/theme'

export default function Welcome() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.heroBlock}>
          <Text style={styles.logo}>
            Brasil<Text style={styles.logoAccent}>Connect</Text>
          </Text>
          <Text style={styles.tagline}>
            Comunidade brasileira nos EUA, num app.
          </Text>
        </View>

        <View style={styles.ctaBlock}>
          <Pressable
            onPress={() => router.push('/(auth)/magic-link')}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ctaText}>Entrar / Criar conta</Text>
          </Pressable>
          <Text style={styles.terms}>
            Ao continuar você aceita os Termos e a Política de Privacidade.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  heroBlock: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo: {
    fontFamily: fonts.serifBold,
    fontSize: 42,
    color: colors.navy,
    letterSpacing: -0.5,
  },
  logoAccent: { color: colors.gold },
  tagline: {
    marginTop: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  ctaBlock: { gap: spacing.md },
  cta: {
    backgroundColor: colors.green,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: fonts.sansBold,
    fontSize: 16,
    color: colors.textOnDark,
  },
  terms: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textHint,
    textAlign: 'center',
  },
})
