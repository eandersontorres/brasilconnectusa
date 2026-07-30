// ════════════════════════════════════════════════════════════════════════════
//   /magic-link-sent — confirmação "confira seu email"
// ════════════════════════════════════════════════════════════════════════════
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { colors, fonts, spacing, radius } from '../../lib/theme'

export default function MagicLinkSent() {
  const { email } = useLocalSearchParams()

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.icon}>✉</Text>
        <Text style={styles.title}>Confira seu e-mail</Text>
        <Text style={styles.body}>
          Mandamos um link mágico pra{'\n'}
          <Text style={styles.email}>{email}</Text>
          {'\n\n'}
          Toca no link no e-mail pra entrar no app.
        </Text>

        <Pressable
          onPress={() => router.replace('/(auth)/magic-link')}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.btnText}>Usar outro e-mail</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  icon: { fontSize: 64, marginBottom: spacing.lg, color: colors.green },
  title: { fontFamily: fonts.serifBold, fontSize: 28, color: colors.navy, marginBottom: spacing.lg, textAlign: 'center' },
  body: { fontFamily: fonts.sans, fontSize: 15, color: colors.textMuted, lineHeight: 22, textAlign: 'center', marginBottom: spacing.xxl },
  email: { fontFamily: fonts.sansBold, color: colors.text },
  btn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
  btnText: { fontFamily: fonts.sansMed, fontSize: 14, color: colors.text },
})
