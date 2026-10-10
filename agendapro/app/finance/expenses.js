// Despesas do mês agrupadas por categoria, com total, atalho pra repetir as fixas
// (aluguel, celular, seguro) do mês anterior e botão pra lançar nova.
import { useCallback, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../../lib/api'
import { showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { colors, radius, spacing, type } from '../../lib/theme'
import { MONTHS_LONG, fmtDay, fmtMoney, todayKey } from '../../lib/format'
import { categoryInfo, lastDayOfMonth, methodLabel, shiftMonth } from '../../lib/receipt'
import { Banner, Button, Card, Divider, Empty, ErrorBox, Fab, H3, Label, Loading, Muted, Row, Screen, Section, Small } from '../../components/ui'
import Locked from '../../components/Locked'

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
const monthName = (m) => MONTHS_LONG[Number(String(m).slice(5, 7)) - 1] || ''

export default function ExpensesScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Despesas' }} />
      <Locked feature="finance"><Expenses /></Locked>
    </>
  )
}

function Expenses() {
  const thisMonth = todayKey().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copying, setCopying] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setError(null)
    try {
      const r = await api(`/api/agenda/finance?view=expenses&month=${month}`)
      if (id === reqId.current) setData(r)
    } catch (e) {
      if (id === reqId.current) setError(e)
    }
  }, [month])

  // Volta da tela de edição → lista atualizada
  useFocusEffect(useCallback(() => { load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // Dia sugerido pra despesa nova: hoje no mês atual; último dia em mês passado
  const defaultDate = month === thisMonth ? todayKey() : month < thisMonth ? lastDayOfMonth(month) : `${month}-01`
  const addNew = () => router.push({ pathname: '/finance/expense-edit', params: { date: defaultDate } })

  async function copyFixed(s) {
    const cats = s.categories.map((c) => categoryInfo(c).label.toLowerCase()).join(', ')
    const ok = await confirm(
      'Repetir despesas fixas?',
      `Lançar em ${monthName(month)} as mesmas despesas de ${cats} de ${monthName(s.from_month)} (${s.count}, total ${fmtMoney(s.cents)})? Dá pra editar depois.`,
      { ok: 'Repetir' },
    )
    if (!ok) return
    setCopying(true)
    try {
      const r = await post('/api/agenda/finance', { action: 'expense_copy', from_month: s.from_month, to_month: month })
      await load()
      notify(r.created ? 'Pronto!' : 'Nada novo', r.created ? `${r.created} despesa${r.created > 1 ? 's' : ''} lançada${r.created > 1 ? 's' : ''}.` : 'Essas despesas já estavam lançadas neste mês.')
    } catch (e) {
      showError(e)
    } finally {
      setCopying(false)
    }
  }

  const shown = data && data.month === month ? data : null
  const groups = shown ? groupByCategory(shown) : []

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <View style={st.periodBar}>
          <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} hitSlop={12} style={st.periodBtn} accessibilityLabel="Mês anterior">
            <Ionicons name="chevron-back" size={22} color={colors.green} />
          </Pressable>
          <Pressable onPress={month !== thisMonth ? () => setMonth(thisMonth) : undefined} style={{ flex: 1, alignItems: 'center' }}>
            <H3>{cap(monthName(month))} de {month.slice(0, 4)}</H3>
            {month !== thisMonth ? <Small style={{ color: colors.green, fontWeight: '600' }}>Voltar pro mês atual</Small> : null}
          </Pressable>
          <Pressable onPress={month < thisMonth ? () => setMonth((m) => shiftMonth(m, 1)) : undefined} hitSlop={12}
            style={[st.periodBtn, month >= thisMonth && { opacity: 0.3 }]} accessibilityLabel="Próximo mês">
            <Ionicons name="chevron-forward" size={22} color={colors.green} />
          </Pressable>
        </View>

        {error ? <ErrorBox error={error} onRetry={load} /> : null}
        {!shown && !error ? <Loading text="Carregando despesas…" /> : null}

        {shown ? (
          <>
            {shown.fixed_suggestion ? (
              <Banner tone="navy" icon="repeat-outline"
                text={copying ? 'Lançando…' : `Repetir as despesas fixas de ${monthName(shown.fixed_suggestion.from_month)} (${fmtMoney(shown.fixed_suggestion.cents)})?`}
                action={copying ? null : 'Repetir'} onPress={copying ? undefined : () => copyFixed(shown.fixed_suggestion)} />
            ) : null}

            {shown.count ? (
              <>
                <Card>
                  <Label>Total do mês</Label>
                  <Text style={[type.kpi, { marginTop: 6, color: colors.goldDark }]}>{fmtMoney(shown.total_cents)}</Text>
                  <Muted>{shown.count} despesa{shown.count > 1 ? 's' : ''} lançada{shown.count > 1 ? 's' : ''}</Muted>
                  <CategoryBar byCategory={shown.by_category} total={shown.total_cents} />
                </Card>

                {groups.map((g) => {
                  const info = categoryInfo(g.category)
                  return (
                    <Section key={g.category} title={info.label} right={<Small style={{ fontWeight: '600' }}>{fmtMoney(g.cents)}</Small>}>
                      <Card padded={false}>
                        {g.items.map((e, i) => (
                          <View key={e.id}>
                            {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
                            <Row
                              icon={info.icon}
                              title={e.description || info.label}
                              subtitle={[fmtDay(e.spent_on), e.payment_method ? methodLabel(e.payment_method) : null, e.receipt_url ? 'com comprovante' : null].filter(Boolean).join(' · ')}
                              right={<Text style={st.money}>{fmtMoney(e.amount_cents)}</Text>}
                              chevron
                              onPress={() => router.push({ pathname: '/finance/expense-edit', params: { id: e.id } })}
                            />
                          </View>
                        ))}
                      </Card>
                    </Section>
                  )
                })}

                <View style={st.tip}>
                  <Ionicons name="bulb-outline" size={18} color={colors.green} />
                  <Text style={{ flex: 1, color: colors.inkSoft, fontSize: 13, lineHeight: 18 }}>
                    Despesas do trabalho diminuem o lucro tributável. Guarde os comprovantes por pelo menos 3 anos: o IRS pode pedir.
                  </Text>
                </View>
              </>
            ) : (
              <Card style={{ marginTop: spacing.sm }}>
                <Empty icon="receipt-outline" title={`Nenhuma despesa em ${monthName(month)}`}
                  text="Lance produtos, gasolina, aluguel, celular… Cada despesa diminui o lucro tributável e o imposto que você paga."
                  action={<Button title="Lançar despesa" icon="add" onPress={addNew} />} />
              </Card>
            )}
          </>
        ) : null}
      </Screen>
      {shown ? <Fab onPress={addNew} label="Lançar despesa" /> : null}
    </View>
  )
}

/** Grupos na ordem do maior total pro menor; dentro, mais recente primeiro. */
function groupByCategory(d) {
  const map = new Map(d.by_category.map((c) => [c.category, { ...c, items: [] }]))
  for (const e of d.expenses) {
    if (!map.has(e.category)) map.set(e.category, { category: e.category, cents: 0, count: 0, items: [] })
    map.get(e.category).items.push(e)
  }
  return [...map.values()].filter((g) => g.items.length)
}

const BAR_COLORS = [colors.gold, colors.green, colors.navy, colors.warning, colors.info, colors.goldDark, colors.flag, colors.danger, colors.inkSoft, colors.inkMuted]

function CategoryBar({ byCategory, total }) {
  if (!total || !byCategory?.length) return null
  return (
    <View style={{ marginTop: spacing.md }}>
      <View style={st.stack}>
        {byCategory.map((c, i) => (
          <View key={c.category} style={{ flex: c.cents, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.md }}>
        {byCategory.map((c, i) => (
          <View key={c.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
            <Small>{categoryInfo(c.category).label} · {Math.round((c.cents / total) * 100)}%</Small>
          </View>
        ))}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  periodBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, minHeight: 44 },
  periodBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  money: { fontSize: 15, fontWeight: '600', color: colors.ink },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.paperSoft },
  tip: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.greenSoft, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.xl },
})
