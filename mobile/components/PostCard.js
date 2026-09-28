// ════════════════════════════════════════════════════════════════════════════
//   PostCard — render compacto de um post no feed mobile.
//   v1 sem interações (vote/share). Tap no card vai pra detalhe futuramente.
// ════════════════════════════════════════════════════════════════════════════
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, fonts, spacing, radius } from '../lib/theme'

const POST_TYPES = {
  question:       { label: 'Pergunta',     color: '#3B82F6', bg: '#DBEAFE' },
  recommendation: { label: 'Indicação',    color: '#10B981', bg: '#D1FAE5' },
  event:          { label: 'Evento',       color: '#F59E0B', bg: '#FEF3C7' },
  classified:     { label: 'Vende/Compra', color: '#8B5CF6', bg: '#EDE9FE' },
  job:            { label: 'Vaga',         color: '#009c3b', bg: '#D1FAE5' },
  announcement:   { label: 'Aviso',        color: '#EF4444', bg: '#FEE2E2' },
}

function timeAgo(dateStr) {
  const d = new Date(dateStr)
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function fmtPrice(v) {
  if (v == null) return null
  return Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function PostCard({ post, onPress }) {
  const t = POST_TYPES[post.type] || POST_TYPES.question
  const community = post.community

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
    >
      {/* Header: comunidade + tipo + tempo */}
      <View style={styles.headerRow}>
        {community && (
          <Text style={styles.communityName} numberOfLines={1}>
            {community.icon || '🌐'} {community.name}
          </Text>
        )}
        <View style={[styles.typeChip, { backgroundColor: t.bg }]}>
          <Text style={[styles.typeChipText, { color: t.color }]}>{t.label}</Text>
        </View>
      </View>

      {/* Título */}
      {post.title && (
        <Text style={styles.title} numberOfLines={2}>{post.title}</Text>
      )}

      {/* Body */}
      {post.body && (
        <Text style={styles.body} numberOfLines={3}>{post.body}</Text>
      )}

      {/* Linha de meta específica por tipo */}
      {post.type === 'classified' && post.classified_price != null && (
        <Text style={styles.price}>{fmtPrice(post.classified_price)}</Text>
      )}
      {post.type === 'event' && post.event_date && (
        <Text style={styles.metaLine}>
          📅 {new Date(post.event_date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
          {post.event_location ? `  •  📍 ${post.event_location}` : ''}
        </Text>
      )}
      {post.type === 'job' && post.job_category && (
        <Text style={styles.metaLine}>💼 {post.job_category}</Text>
      )}

      {/* Footer: tempo + comentários + score */}
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{timeAgo(post.created_at)}</Text>
        <Text style={styles.footerDot}>·</Text>
        <Text style={styles.footerText}>💬 {post.comment_count || 0}</Text>
        {(post.upvotes || 0) > 0 && (
          <>
            <Text style={styles.footerDot}>·</Text>
            <Text style={styles.footerText}>▲ {post.upvotes}</Text>
          </>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  communityName: {
    flex: 1,
    fontFamily: fonts.sansMed,
    fontSize: 12,
    color: colors.textMuted,
  },
  typeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  typeChipText: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 17,
    color: colors.navy,
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  price: {
    fontFamily: fonts.sansBold,
    fontSize: 18,
    color: colors.green,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  metaLine: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  footerText: { fontFamily: fonts.sans, fontSize: 12, color: colors.textHint },
  footerDot:  { fontFamily: fonts.sans, fontSize: 12, color: colors.textHint, marginHorizontal: 4 },
})
