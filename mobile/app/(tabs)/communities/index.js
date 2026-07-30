// ════════════════════════════════════════════════════════════════════════════
//   Communities list — minhas + descobrir + busca
//   Backend: GET /api/social?action=communities  &  ?action=my-communities
// ════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, TextInput, Pressable, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useAuth } from '../../../lib/auth'
import { apiJson } from '../../../lib/api'
import { colors, fonts, spacing, radius } from '../../../lib/theme'

export default function CommunitiesList() {
  const { user } = useAuth()
  const [all, setAll] = useState([])
  const [mine, setMine] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    if (!user) return
    const [a, m] = await Promise.all([
      apiJson(`/api/social?action=communities`),
      apiJson(`/api/social?action=my-communities&user_id=${user.id}`),
    ])
    setAll(a.communities || [])
    setMine(m.communities || [])
  }, [user])

  useEffect(() => {
    setLoading(true)
    load().catch(() => {}).finally(() => setLoading(false))
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load().catch(() => {})
    setRefreshing(false)
  }

  // IDs que o user já segue, pra remover do "Descobrir"
  const mineIds = useMemo(() => new Set(mine.map(c => c.id)), [mine])

  // Filtros por query
  const queryLower = q.trim().toLowerCase()
  const mineFiltered = queryLower
    ? mine.filter(c => c.name?.toLowerCase().includes(queryLower))
    : mine
  const discover = useMemo(
    () => all.filter(c => !mineIds.has(c.id) && (
      !queryLower || c.name?.toLowerCase().includes(queryLower)
    )),
    [all, mineIds, queryLower],
  )

  const sections = [
    ...(mineFiltered.length ? [{ kind: 'header', label: `Minhas comunidades (${mineFiltered.length})`, key: 'h-mine' }] : []),
    ...mineFiltered.map(c => ({ kind: 'row', community: c, key: `m-${c.id}`, isMine: true })),
    ...(discover.length ? [{ kind: 'header', label: 'Descobrir', key: 'h-disc' }] : []),
    ...discover.map(c => ({ kind: 'row', community: c, key: `d-${c.id}`, isMine: false })),
  ]

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header />
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header />
      <View style={styles.searchWrap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Buscar comunidades…"
          placeholderTextColor={colors.textHint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
      </View>

      {sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🌐</Text>
          <Text style={styles.emptyTitle}>Nenhuma comunidade encontrada</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(it) => it.key}
          renderItem={({ item }) =>
            item.kind === 'header'
              ? <Text style={styles.sectionHeader}>{item.label}</Text>
              : <CommunityRow community={item.community} isMine={item.isMine} />
          }
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxxl }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />
          }
        />
      )}
    </SafeAreaView>
  )
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Comunidades</Text>
    </View>
  )
}

function CommunityRow({ community, isMine }) {
  return (
    <Pressable
      onPress={() => router.push(`/(tabs)/communities/${community.slug}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
    >
      <Text style={styles.rowIcon}>{community.icon || '🌐'}</Text>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>{community.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {(community.member_count || 0).toLocaleString('pt-BR')} membros
          {community.geo_state ? `  ·  ${community.geo_state}` : ''}
        </Text>
      </View>
      {isMine ? (
        <Text style={styles.rowBadge}>✓</Text>
      ) : (
        <Text style={styles.rowChevron}>›</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.navy },

  searchWrap: { padding: spacing.md, paddingBottom: 0 },
  search: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.navy, textAlign: 'center' },

  sectionHeader: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    gap: spacing.md,
  },
  rowIcon: { fontSize: 24 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.text },
  rowMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowBadge: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.green },
  rowChevron: { fontFamily: fonts.sans, fontSize: 22, color: colors.textHint },
})
