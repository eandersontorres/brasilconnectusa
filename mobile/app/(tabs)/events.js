// ════════════════════════════════════════════════════════════════════════════
//   Events — lista de eventos da rede do user, com RSVP nativo e add-to-calendar
//   Backend: GET /api/social?action=feed&type=event  +  POST ?action=rsvp
// ════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator,
  Alert, StyleSheet, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Calendar from 'expo-calendar'
import * as Haptics from 'expo-haptics'
import { useAuth } from '../../lib/auth'
import { apiJson } from '../../lib/api'
import { colors, fonts, spacing, radius } from '../../lib/theme'

const MONTH_PT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ']
const DAY_PT = ['DOM','SEG','TER','QUA','QUI','SEX','SAB']

export default function EventsScreen() {
  const { user } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Estado local de RSVP: { [postId]: 'going' | 'maybe' | null }
  const [rsvps, setRsvps] = useState({})

  const load = useCallback(async () => {
    if (!user) return
    const data = await apiJson(`/api/social?action=feed&user_id=${user.id}&type=event&limit=100`)
    setEvents(data.posts || [])
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

  const { upcoming, past } = useMemo(() => {
    const now = Date.now()
    const up = []
    const ps = []
    for (const e of events) {
      if (!e.event_date) continue
      const t = new Date(e.event_date).getTime()
      if (t >= now) up.push(e)
      else ps.push(e)
    }
    up.sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    ps.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    return { upcoming: up, past: ps }
  }, [events])

  async function handleRsvp(post, status) {
    if (!user) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const current = rsvps[post.id]
    const next = current === status ? null : status  // toque no mesmo botão = limpa
    setRsvps(r => ({ ...r, [post.id]: next }))
    // Atualiza count otimista se for going
    if (status === 'going') {
      setEvents(es => es.map(e =>
        e.id === post.id
          ? { ...e, event_rsvp_count: Math.max(0, (e.event_rsvp_count || 0) + (next ? 1 : -1) - (current === 'going' ? 1 : 0)) }
          : e
      ))
    }
    if (next == null) return  // limpar local apenas — backend não tem unset
    try {
      const data = await apiJson(`/api/social?action=rsvp`, {
        method: 'POST',
        body: JSON.stringify({ post_id: post.id, status: next }),
      })
      // Sincroniza contador real
      setEvents(es => es.map(e =>
        e.id === post.id ? { ...e, event_rsvp_count: data.going_count } : e
      ))
    } catch (e) {
      // Reverte estado local em caso de erro
      setRsvps(r => ({ ...r, [post.id]: current }))
      Alert.alert('Erro', e.message || 'Não foi possível salvar.')
    }
  }

  async function addToCalendar(event) {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permissão necessária', 'Habilita o acesso ao calendário nas configurações do celular.')
        return
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
      const writable = calendars.find(c => c.allowsModifications) || calendars[0]
      if (!writable) {
        Alert.alert('Sem calendário', 'Nenhum calendário gravável encontrado no celular.')
        return
      }
      const start = new Date(event.event_date)
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)  // 2h default
      await Calendar.createEventAsync(writable.id, {
        title: event.title || 'Evento BrasilConnect',
        startDate: start,
        endDate: end,
        location: event.event_location || undefined,
        notes: event.body || undefined,
        timeZone: Platform.OS === 'ios' ? undefined : 'America/Chicago',
      })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Pronto!', 'Evento adicionado no seu calendário.')
    } catch (e) {
      Alert.alert('Erro', e.message || 'Não foi possível adicionar.')
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header />
        <View style={styles.center}><ActivityIndicator color={colors.green} /></View>
      </SafeAreaView>
    )
  }

  const sections = [
    { kind: 'header', label: `Próximos (${upcoming.length})`, key: 'h-up' },
    ...(upcoming.length
      ? upcoming.map(e => ({ kind: 'row', event: e, key: `up-${e.id}`, isPast: false }))
      : [{ kind: 'empty', key: 'e-up', msg: 'Sem eventos próximos. Crie o primeiro pela web.' }]
    ),
    ...(past.length
      ? [
          { kind: 'header', label: `Passados (${past.length})`, key: 'h-ps' },
          ...past.slice(0, 10).map(e => ({ kind: 'row', event: e, key: `ps-${e.id}`, isPast: true })),
        ]
      : []
    ),
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header />
      <FlatList
        data={sections}
        keyExtractor={(it) => it.key}
        renderItem={({ item }) => {
          if (item.kind === 'header') return <Text style={styles.sectionHeader}>{item.label}</Text>
          if (item.kind === 'empty') return <Text style={styles.emptyText}>{item.msg}</Text>
          return (
            <EventCard
              event={item.event}
              isPast={item.isPast}
              rsvp={rsvps[item.event.id]}
              onRsvp={(status) => handleRsvp(item.event, status)}
              onAddToCalendar={() => addToCalendar(item.event)}
            />
          )
        }}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />
        }
      />
    </SafeAreaView>
  )
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Eventos</Text>
      <Text style={styles.subtitle}>Encontros, festas, esportes e atividades</Text>
    </View>
  )
}

function EventCard({ event, isPast, rsvp, onRsvp, onAddToCalendar }) {
  const d = new Date(event.event_date)
  const dayLabel = String(d.getDate()).padStart(2, '0')
  const monthLabel = MONTH_PT[d.getMonth()]
  const dayName = DAY_PT[d.getDay()]
  const timeLabel = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[styles.card, isPast && { opacity: 0.6 }]}>
      <View style={styles.cardRow}>
        <View style={styles.dateStripe}>
          <Text style={styles.dayName}>{dayName}</Text>
          <Text style={styles.day}>{dayLabel}</Text>
          <Text style={styles.month}>{monthLabel}</Text>
        </View>

        <View style={styles.body}>
          {event.community && (
            <Text style={styles.community} numberOfLines={1}>
              {event.community.icon || '🎉'} {event.community.name}
            </Text>
          )}
          <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
          <Text style={styles.meta}>
            🕐 {timeLabel}
            {event.event_location ? `  •  📍 ${event.event_location}` : ''}
          </Text>
          {(event.event_rsvp_count || 0) > 0 && (
            <Text style={styles.goingCount}>
              👥 {event.event_rsvp_count} {event.event_rsvp_count === 1 ? 'vai' : 'vão'}
            </Text>
          )}
        </View>
      </View>

      {!isPast && (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => onRsvp('going')}
            style={({ pressed }) => [
              styles.rsvpBtn,
              rsvp === 'going' && styles.rsvpBtnActive,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.rsvpText, rsvp === 'going' && styles.rsvpTextActive]}>
              {rsvp === 'going' ? '✓ Vou' : 'Vou'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onRsvp('maybe')}
            style={({ pressed }) => [
              styles.rsvpBtn,
              rsvp === 'maybe' && styles.rsvpBtnActiveMaybe,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.rsvpText, rsvp === 'maybe' && styles.rsvpTextActiveMaybe]}>
              {rsvp === 'maybe' ? '? Talvez' : 'Talvez'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onAddToCalendar}
            style={({ pressed }) => [styles.calBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <Text style={styles.calText}>📅</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.navy },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, color: colors.textMuted, marginTop: 2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textHint,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardRow: { flexDirection: 'row', padding: spacing.md, gap: spacing.md },
  dateStripe: {
    width: 56,
    backgroundColor: colors.greenSoft,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  dayName: { fontFamily: fonts.sansBold, fontSize: 10, color: colors.greenDark, letterSpacing: 0.5 },
  day: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.greenDark, lineHeight: 26 },
  month: { fontFamily: fonts.sansBold, fontSize: 10, color: colors.greenDark, letterSpacing: 0.5 },

  body: { flex: 1, minWidth: 0 },
  community: { fontFamily: fonts.sansMed, fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  eventTitle: { fontFamily: fonts.serifBold, fontSize: 16, color: colors.navy, lineHeight: 20 },
  meta: { fontFamily: fonts.sans, fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  goingCount: { fontFamily: fonts.sansMed, fontSize: 12, color: colors.green, marginTop: spacing.xs },

  actionsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  rsvpBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.soft,
    alignItems: 'center',
  },
  rsvpBtnActive: { backgroundColor: colors.green },
  rsvpBtnActiveMaybe: { backgroundColor: colors.navy },
  rsvpText: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.text },
  rsvpTextActive: { color: colors.textOnDark },
  rsvpTextActiveMaybe: { color: colors.textOnDark },

  calBtn: {
    width: 44,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.soft,
  },
  calText: { fontSize: 18 },
})
