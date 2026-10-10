// Avaliações: média, distribuição das estrelas e a lista com resposta pública,
// ocultar/publicar e compartilhar. Recurso Pro (reviews). Pedir avaliação fica
// no detalhe do agendamento realizado (/appointment/[id]).
// Sem o plano a lista continua visível (só leitura): responder e ocultar/publicar
// ficam com cadeado, como no servidor (GET liberado, POST exige 'reviews').
import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, featureInfo, openPlans, showError } from '../lib/gate'
import { confirm } from '../lib/dialog'
import { EXTERNAL_PURCHASE, PUBLIC_PAGE } from '../lib/config'
import { fmtAgo, fmtDay } from '../lib/format'
import { colors, radius, spacing, type } from '../lib/theme'
import { Badge, Banner, Button, Card, Chip, Empty, ErrorBox, Loading, Muted, P, Screen, Section, Segmented, Small } from '../components/ui'
import { LockedCard } from '../components/Locked'

const MAX_RESPONSE = 1000
const isWeb = Platform.OS === 'web'

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || ''
const fmtAvg = (v) => (v == null ? '–' : Number(v).toFixed(1).replace('.', ','))

/** Mesmas contas do servidor (api/agenda/reviews.js), pra atualizar na hora. */
function statsOf(all) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of all) {
    const n = Math.round(Number(r.rating))
    if (n >= 1 && n <= 5) distribution[n]++
  }
  const avg = (list) => (list.length ? Math.round((list.reduce((s, r) => s + (Number(r.rating) || 0), 0) / list.length) * 10) / 10 : null)
  const published = all.filter((r) => r.is_published !== false)
  return {
    count: all.length,
    published: published.length,
    hidden: all.length - published.length,
    unanswered: all.filter((r) => !r.provider_response).length,
    average: avg(all),
    public_average: avg(published),
    distribution,
  }
}

/** Respostas prontas: agradecimento nas boas, cuidado nas ruins. */
function suggestions(review) {
  const n = firstName(review.client_name)
  if (Number(review.rating) <= 3) {
    return [
      `Obrigada pelo retorno, ${n}. Sinto muito que não foi como você esperava. Vou te chamar no WhatsApp pra gente conversar.`,
      `${n}, agradeço a sinceridade. Já estou ajustando isso pra próxima vez. Conte comigo!`,
    ]
  }
  return [
    `Obrigada pelo carinho, ${n}! Foi um prazer te atender. Te espero na próxima!`,
    `Que bom que você gostou, ${n}! Muito obrigada pela confiança.`,
  ]
}

function Stars({ value, size = 16 }) {
  const v = Number(value) || 0
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityLabel={`${fmtAvg(v)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const name = v >= i ? 'star' : v >= i - 0.5 ? 'star-half' : 'star-outline'
        return <Ionicons key={i} name={name} size={size} color={colors.gold} />
      })}
    </View>
  )
}

export default function ReviewsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Avaliações' }} />
      <ReviewsContent />
    </>
  )
}

function ReviewsContent() {
  const app = useApp()
  const slug = app.provider?.slug
  const canAct = app.can('reviews')   // responder, ocultar/publicar e estrelas na página
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [replyFor, setReplyFor] = useState(null)   // id da avaliação sendo respondida
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(null)           // id em ação

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await api('/api/agenda/reviews')
      setReviews(r.reviews || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => statsOf(reviews), [reviews])
  const list = useMemo(() => (
    filter === 'unanswered' ? reviews.filter((r) => !r.provider_response)
      : filter === 'hidden' ? reviews.filter((r) => r.is_published === false)
      : reviews
  ), [reviews, filter])

  const replace = (saved) => setReviews((cur) => cur.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)))

  async function startReply(r) {
    if (!(await ensureFeature(app, 'reviews'))) return
    setReplyFor(r.id)
    setReplyText(r.provider_response || '')
  }

  async function sendReply(r) {
    const text = replyText.trim()
    if (text.length > MAX_RESPONSE) return
    if (!text && r.provider_response) {
      const ok = await confirm('Apagar sua resposta?', 'A avaliação continua na página, sem a sua resposta.', { ok: 'Apagar', destructive: true })
      if (!ok) return
    } else if (!text) {
      setReplyFor(null)
      return
    }
    setBusy(r.id)
    try {
      const res = await post('/api/agenda/reviews', { action: 'respond', id: r.id, response: text })
      replace(res.review)
      setReplyFor(null)
      setReplyText('')
    } catch (e) {
      showError(e, 'Não deu pra enviar a resposta')
    } finally {
      setBusy(null)
    }
  }

  async function togglePublished(r) {
    if (!(await ensureFeature(app, 'reviews'))) return
    const hide = r.is_published !== false
    if (hide) {
      const ok = await confirm('Ocultar esta avaliação?', 'Ela sai da sua página pública, mas continua guardada aqui. Você pode publicar de novo quando quiser.', { ok: 'Ocultar' })
      if (!ok) return
    }
    setBusy(r.id)
    try {
      const res = await post('/api/agenda/reviews', { action: hide ? 'hide' : 'publish', id: r.id })
      replace(res.review)
    } catch (e) {
      showError(e, 'Não deu pra mudar a avaliação')
    } finally {
      setBusy(null)
    }
  }

  async function shareReview(r) {
    const who = firstName(r.client_name)
    const stars = '★'.repeat(Math.round(Number(r.rating) || 0))
    const message = `${stars}\n"${r.comment}"\n— ${who}, cliente${slug ? `\n\nAgende seu horário: ${PUBLIC_PAGE(slug)}` : ''}`
    try { await Share.share({ message }) } catch (_) {}
  }

  async function openPage() {
    if (!slug) return
    const url = PUBLIC_PAGE(slug) + '#avaliacoes'
    if (isWeb) { window.open(url, '_blank'); return }
    try { await WebBrowser.openBrowserAsync(url, { controlsColor: colors.green }) } catch (_) {}
  }

  const onRefresh = () => { setRefreshing(true); load() }

  if (loading) {
    return <Screen><Loading text="Carregando avaliações…" /></Screen>
  }

  const tip = (
    <Card style={{ marginTop: spacing.lg, backgroundColor: colors.goldSoft, borderColor: colors.goldSoft }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Ionicons name="bulb-outline" size={20} color={colors.goldDark} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={[type.h3, { color: colors.ink }]}>Como conseguir mais avaliações</Text>
          <P style={{ color: colors.inkSoft, marginTop: 4 }}>
            Depois do atendimento, abra o agendamento, marque como realizado e toque em “Pedir avaliação”. A cliente recebe um link pelo WhatsApp e avalia em poucos segundos.
          </P>
          <Muted style={{ marginTop: 6 }}>Peça no mesmo dia, enquanto a experiência está fresquinha.</Muted>
          <Button title="Ir para a agenda" icon="calendar-outline" variant="secondary" small full={false} onPress={() => router.push('/agenda')} style={{ marginTop: spacing.md }} />
        </View>
      </View>
    </Card>
  )

  if (!reviews.length) {
    return (
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => { setLoading(true); load() }} />
        {!canAct ? <LockedCard feature="reviews" /> : (
          <>
            {!error ? (
              <Empty icon="star-outline" title="Nenhuma avaliação ainda"
                text="Quando suas clientes avaliarem, as estrelas aparecem aqui e na sua página pública." />
            ) : null}
            {tip}
          </>
        )}
      </Screen>
    )
  }

  // Sem o plano: as avaliações continuam aqui, só leitura
  const lockInfo = featureInfo(app.ent, 'reviews')
  const lockText = app.ent?.tier === 'none'
    ? 'Seu plano não está ativo. Suas avaliações continuam aqui, mas responder, ocultar e mostrar as estrelas na sua página ficam travados.'
    : `Suas avaliações continuam aqui. Responder, ocultar e mostrar as estrelas na sua página fazem parte do plano ${lockInfo.minName}.`

  const total = stats.count || 1
  const filters = [
    { value: 'all', label: `Todas (${stats.count})` },
    { value: 'unanswered', label: `Sem resposta (${stats.unanswered})` },
    { value: 'hidden', label: `Ocultas (${stats.hidden})` },
  ]

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={load} />

        {!canAct ? (
          <Banner tone="gold" icon="lock-closed-outline" text={lockText}
            action={EXTERNAL_PURCHASE ? 'Ver planos' : 'Saiba mais'} onPress={() => openPlans('reviews')} />
        ) : null}

        {/* Resumo */}
        <Card>
          <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
            <View style={{ alignItems: 'center', minWidth: 92 }}>
              <Text style={s.big}>{fmtAvg(stats.average)}</Text>
              <Stars value={stats.average} />
              <Muted style={{ marginTop: 4 }}>{stats.count} {stats.count === 1 ? 'avaliação' : 'avaliações'}</Muted>
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              {[5, 4, 3, 2, 1].map((n) => (
                <View key={n} style={s.distRow}>
                  <Small style={{ width: 12, textAlign: 'right' }}>{n}</Small>
                  <Ionicons name="star" size={11} color={colors.gold} />
                  <View style={s.distTrack}><View style={[s.distFill, { width: `${Math.round((stats.distribution[n] / total) * 100)}%` }]} /></View>
                  <Small style={{ width: 26, textAlign: 'right' }}>{stats.distribution[n]}</Small>
                </View>
              ))}
            </View>
          </View>
          {/* Sem o plano a página pública não mostra as avaliações */}
          {canAct && stats.hidden > 0 ? (
            <Muted style={{ marginTop: spacing.md }}>
              Na sua página: média {fmtAvg(stats.public_average)} com {stats.published} {stats.published === 1 ? 'avaliação publicada' : 'avaliações publicadas'}.
            </Muted>
          ) : null}
          {canAct ? (
            <Button title="Ver na minha página" icon="open-outline" variant="ghost" small onPress={openPage} style={{ marginTop: spacing.sm }} />
          ) : null}
        </Card>

        {canAct && stats.unanswered > 0 ? (
          <Muted style={{ marginTop: spacing.md, textAlign: 'center' }}>
            Responder mostra cuidado: quem visita sua página lê as suas respostas também.
          </Muted>
        ) : null}

        <Section>
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </Section>

        {list.length === 0 ? (
          <Empty icon={filter === 'hidden' ? 'eye-off-outline' : 'chatbubble-ellipses-outline'}
            title={filter === 'hidden' ? 'Nenhuma avaliação oculta' : 'Tudo respondido'}
            text={filter === 'hidden' ? 'Todas as avaliações estão aparecendo na sua página.' : 'Você respondeu todas as avaliações. Muito bem!'} />
        ) : null}

        {list.map((r) => {
          const hidden = r.is_published === false
          const editing = replyFor === r.id
          const isBusy = busy === r.id
          return (
            <Card key={r.id} style={[{ marginTop: spacing.md }, hidden && { opacity: 0.8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <Stars value={r.rating} size={18} />
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {hidden ? <Badge text="Oculta" tone="gray" icon="eye-off-outline" /> : null}
                  {!r.provider_response && !hidden ? <Badge text="Sem resposta" tone="orange" /> : null}
                </View>
              </View>

              <Pressable disabled={!r.client_id} onPress={() => router.push(`/client/${r.client_id}`)} style={{ marginTop: spacing.sm }}>
                <Text style={[type.body, { fontWeight: '600' }, r.client_id && { color: colors.green }]}>{r.client_name}</Text>
              </Pressable>
              <Muted>
                {[r.service_name, r.appointment_at ? fmtDay(r.appointment_at) : null, fmtAgo(r.created_at)].filter(Boolean).join(' · ')}
              </Muted>

              {r.comment ? <P style={{ marginTop: spacing.sm }}>{r.comment}</P> : <Muted style={{ marginTop: spacing.sm, fontStyle: 'italic' }}>Só deu as estrelas, sem comentário.</Muted>}

              {r.provider_response && !editing ? (
                <View style={s.reply}>
                  <Small style={{ fontWeight: '700', color: colors.ink }}>Sua resposta</Small>
                  <P style={{ color: colors.inkSoft, marginTop: 2 }}>{r.provider_response}</P>
                </View>
              ) : null}

              {editing ? (
                <View style={{ marginTop: spacing.md }}>
                  <View style={s.replyInputWrap}>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Escreva uma resposta gentil (aparece na sua página)"
                      placeholderTextColor={colors.inkMuted}
                      multiline
                      maxLength={MAX_RESPONSE}
                      autoFocus
                      style={s.replyInput}
                    />
                  </View>
                  <Small style={{ textAlign: 'right', marginTop: 4, color: colors.inkMuted }}>{replyText.length}/{MAX_RESPONSE}</Small>
                  {!replyText.trim() ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                      {suggestions(r).map((t) => <Chip key={t} label={t.length > 42 ? t.slice(0, 40) + '…' : t} icon="sparkles-outline" onPress={() => setReplyText(t)} />)}
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button title="Cancelar" variant="secondary" small onPress={() => { setReplyFor(null); setReplyText('') }} style={{ flex: 1 }} disabled={isBusy} />
                    <Button title={replyText.trim() || !r.provider_response ? 'Publicar resposta' : 'Apagar resposta'} small icon="send" onPress={() => sendReply(r)} loading={isBusy} style={{ flex: 2 }} />
                  </View>
                </View>
              ) : (
                <View style={s.actions}>
                  <Button title={r.provider_response ? 'Editar resposta' : 'Responder'} icon={canAct ? 'chatbubble-outline' : 'lock-closed'} variant="ghost" small full={false}
                    onPress={() => startReply(r)} disabled={isBusy} />
                  <Button title={hidden ? 'Publicar' : 'Ocultar'} icon={!canAct ? 'lock-closed' : hidden ? 'eye-outline' : 'eye-off-outline'} variant="ghost" small full={false}
                    onPress={() => togglePublished(r)} loading={isBusy} />
                  {r.comment && Number(r.rating) >= 4 && !hidden ? (
                    <Button title="Compartilhar" icon="share-social-outline" variant="ghost" small full={false} onPress={() => shareReview(r)} disabled={isBusy} />
                  ) : null}
                </View>
              )}
            </Card>
          )
        })}

        {canAct ? tip : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  big: { fontSize: 40, fontWeight: '700', color: colors.ink, letterSpacing: -0.5, lineHeight: 46 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.paperSoft, overflow: 'hidden' },
  distFill: { height: 7, borderRadius: 4, backgroundColor: colors.gold },
  reply: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.paperDeep, borderLeftWidth: 3, borderLeftColor: colors.gold, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  replyInputWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white },
  replyInput: { minHeight: 96, padding: spacing.md, fontSize: 16, color: colors.ink, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, marginHorizontal: -spacing.sm },
})
