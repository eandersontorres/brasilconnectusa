import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth, signOut } from '../../lib/auth'
import { colors, fonts, spacing, radius } from '../../lib/theme'

export default function ProfileScreen() {
  const { user } = useAuth()
  const initial = (user?.email || '?').charAt(0).toUpperCase()

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroBlock}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
          <Text style={styles.email}>{user?.email}</Text>
          <Text style={styles.location}>Edite seu perfil pra adicionar cidade e bio</Text>
        </View>

        <Text style={styles.sectionLabel}>Mais</Text>
        <Row label="💵  Câmbio & Remessas" hint="webview" />
        <Row label="✈️  Voos pro Brasil" hint="webview" />
        <Row label="🛍  Marketplace" hint="webview" />

        <Text style={styles.sectionLabel}>Conta</Text>
        <Row label="🔔  Notificações" />
        <Row label="⚙  Configurações" />
        <Row label="💬  Feedback" />
        <Row label="❓  Ajuda" />

        <Pressable
          onPress={() => signOut()}
          style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.signOutText}>↳ Sair</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function Row({ label, hint }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowHint}>{hint ? `${hint} ›` : '›'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },

  heroBlock: { alignItems: 'center', paddingVertical: spacing.xl },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 30, color: colors.textOnDark },
  email: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.navy },
  location: { fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },

  sectionLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  rowLabel: { fontFamily: fonts.sansMed, fontSize: 15, color: colors.text },
  rowHint: { fontFamily: fonts.sans, fontSize: 13, color: colors.textHint },

  signOut: { marginTop: spacing.xl, paddingVertical: spacing.md, alignItems: 'center' },
  signOutText: { fontFamily: fonts.sansMed, fontSize: 14, color: colors.danger },
})
