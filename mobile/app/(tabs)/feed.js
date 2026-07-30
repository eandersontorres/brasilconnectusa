// ════════════════════════════════════════════════════════════════════════════
//   Feed — timeline das comunidades do usuário
//   Backend: GET /api/social?action=feed&user_id=<id>
// ════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, RefreshControl, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../../lib/auth'
import { apiJson } from '../../lib/api'
import PostCard from '../../components/PostCard'
import { colors, fonts, spacing } from '../../lib/theme'

export default function FeedScreen() {
  const { user } = useAuth()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setErr(null)
    try {
      const data = await apiJson(`/api/social?action=feed&user_id=${user.id}`)
      setPosts(data.posts || [])
    } catch (e) {
      setErr(e.message || 'Não foi possível carregar o feed.')
    }
  }, [user])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.logo}>
          Brasil<Text style={styles.logoAccent}>Connect</Text>
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} />
        </View>
      ) : err ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Erro ao carregar</Text>
          <Text style={styles.errorBody}>{err}</Text>
          <Pressable onPress={() => { setLoading(true); load().finally(() => setLoading(false)) }} style={styles.retry}>
            <Text style={styles.retryText}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📰</Text>
          <Text style={styles.emptyTitle}>Nada por aqui ainda</Text>
          <Text style={styles.emptyBody}>
            Entra em algumas comunidades pro feed encher de posts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <PostCard post={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  logo: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.navy },
  logoAccent: { color: colors.gold },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  errorTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.danger, marginBottom: spacing.xs },
  errorBody: { fontFamily: fonts.sans, fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  retry: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.navy,
    borderRadius: 10,
  },
  retryText: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.textOnDark },

  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.navy, marginBottom: spacing.sm },
  emptyBody: { fontFamily: fonts.sans, fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  list: { padding: spacing.md, gap: spacing.md },
})
