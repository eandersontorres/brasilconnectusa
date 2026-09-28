// ════════════════════════════════════════════════════════════════════════════
//   Community detail — header + posts + join/leave
//   Backend: GET ?action=community&slug=X  +  POST ?action=join|leave
// ════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, Pressable, RefreshControl,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../../lib/auth'
import { apiJson } from '../../../lib/api'
import PostCard from '../../../components/PostCard'
import { colors, fonts, spacing, radius } from '../../../lib/theme'

export default function CommunityDetail() {
  const { slug } = useLocalSearchParams()
  const { user } = useAuth()
  const [community, setCommunity] = useState(null)
  const [posts, setPosts] = useState([])
  const [isMember, setIsMember] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [joining, setJoining] = useState(false)

  const load = useCallback(async () => {
    const [detail, mine] = await Promise.all([
      apiJson(`/api/social?action=community&slug=${slug}`),
      user
        ? apiJson(`/api/social?action=my-communities&user_id=${user.id}`)
        : Promise.resolve({ communities: [] }),
    ])
    setCommunity(detail.community)
    setPosts(detail.posts || [])
    const memberIds = new Set((mine.communities || []).map(c => c.id))
    setIsMember(memberIds.has(detail.community?.id))
  }, [slug, user])

  useEffect(() => {
    setLoading(true)
    load().catch(() => {}).finally(() => setLoading(false))
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load().catch(() => {})
    setRefreshing(false)
  }

  async function toggleMembership() {
    if (!community || !user || joining) return
    const action = isMember ? 'leave' : 'join'
    setJoining(true)
    try {
      const data = await apiJson(`/api/social?action=${action}`, {
        method: 'POST',
        body: JSON.stringify({ community_id: community.id }),
      })
      if (data.pending_approval) {
        Alert.alert('Pedido enviado', 'Os admins vão revisar.')
      } else {
        setIsMember(!isMember)
        setCommunity(c => c && {
          ...c,
          member_count: Math.max(0, (c.member_count || 0) + (isMember ? -1 : 1)),
        })
      }
    } catch (e) {
      Alert.alert('Erro', e.message || 'Não foi possível atualizar.')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackBar />
        <View style={styles.center}><ActivityIndicator color={colors.green} /></View>
      </SafeAreaView>
    )
  }

  if (!community) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackBar />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Comunidade não encontrada</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackBar title={community.name} />

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard post={{ ...item, community }} />
        )}
        ListHeaderComponent={
          <CommunityHero
            community={community}
            isMember={isMember}
            joining={joining}
            onToggle={toggleMembership}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyPostsWrap}>
            <Text style={styles.emptyEmoji}>✍️</Text>
            <Text style={styles.emptyText}>
              Ninguém postou aqui ainda.{'\n'}Seja o primeiro!
            </Text>
          </View>
        }
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.md }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />
        }
      />
    </SafeAreaView>
  )
}

function BackBar({ title }) {
  return (
    <View style={styles.backBar}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
        <Text style={styles.backText}>←</Text>
      </Pressable>
      <Text style={styles.backTitle} numberOfLines={1}>{title || ''}</Text>
      <View style={{ width: 30 }} />
    </View>
  )
}

function CommunityHero({ community, isMember, joining, onToggle }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroIcon}>{community.icon || '🌐'}</Text>
      <Text style={styles.heroName}>{community.name}</Text>
      <Text style={styles.heroMeta}>
        {(community.member_count || 0).toLocaleString('pt-BR')} membros
        {community.geo_state ? `  ·  ${community.geo_state}` : ''}
        {community.type === 'national' ? '  ·  nacional' : ''}
      </Text>
      {community.description && (
        <Text style={styles.heroDesc}>{community.description}</Text>
      )}
      <Pressable
        onPress={onToggle}
        disabled={joining}
        style={({ pressed }) => [
          styles.cta,
          isMember && styles.ctaLeave,
          joining && { opacity: 0.5 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={[styles.ctaText, isMember && styles.ctaLeaveText]}>
          {joining ? '…' : isMember ? '✓ Membro · sair' : '+ Entrar'}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },

  backBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  backBtn: { width: 30, alignItems: 'flex-start' },
  backText: { fontFamily: fonts.sans, fontSize: 22, color: colors.text },
  backTitle: { flex: 1, fontFamily: fonts.sansBold, fontSize: 15, color: colors.text, textAlign: 'center' },

  hero: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroIcon: { fontSize: 48, marginBottom: spacing.sm },
  heroName: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.navy, textAlign: 'center' },
  heroMeta: { fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },
  heroDesc: { fontFamily: fonts.sans, fontSize: 14, color: colors.text, textAlign: 'center', marginTop: spacing.md, lineHeight: 20 },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.green,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    minWidth: 180,
    alignItems: 'center',
  },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.textOnDark, letterSpacing: 0.3 },
  ctaLeave: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border },
  ctaLeaveText: { color: colors.textMuted },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  errorTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.danger, textAlign: 'center' },

  emptyPostsWrap: { alignItems: 'center', paddingVertical: spacing.xxxl },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
})
