// ════════════════════════════════════════════════════════════════════════════
//   Placeholder — stub usado pelas telas v0 do app. Some quando a tela
//   for implementada de verdade.
// ════════════════════════════════════════════════════════════════════════════
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts, spacing, radius } from '../lib/theme'

export default function Placeholder({ title, subtitle, bullets = [] }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Em construção</Text>
          <Text style={styles.cardBody}>
            Esta tela é um placeholder do scaffold. O design completo está em{' '}
            <Text style={styles.mono}>mobile/DESIGN.md</Text>.
          </Text>
          {bullets.length > 0 && (
            <View style={{ marginTop: spacing.md }}>
              {bullets.map((b, i) => (
                <Text key={i} style={styles.bullet}>• {b}</Text>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg },
  title: { fontFamily: fonts.serifBold, fontSize: 28, color: colors.navy, marginBottom: spacing.xs },
  subtitle: { fontFamily: fonts.sans, fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    color: colors.green,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  cardBody: { fontFamily: fonts.sans, fontSize: 14, color: colors.text, lineHeight: 20 },
  mono: { fontFamily: 'Courier', fontSize: 13 },
  bullet: { fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, lineHeight: 22 },
})
