// Aba Finanças: faturamento do mês (todo plano vê), meta, gráfico por dia, formas de
// pagamento e serviços; bloco Pro com despesas, lucro, reserva pro imposto e milhagem;
// visão do ano com o imposto estimado trimestral (1040-ES).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../../lib/session'
import { api } from '../../lib/api'
import { featureInfo, openPlans, showError } from '../../lib/gate'
import { colors, radius, spacing, type } from '../../lib/theme'
import { MONTHS, MONTHS_LONG, centsToInput, fmtDay, fmtMoney, parseMoney, todayKey } from '../../lib/format'
import { categoryInfo, methodLabel, nextEstimatedTaxDue, pctChange, shiftMonth } from '../../lib/receipt'
import { Badge, Button, Card, Chip, Divider, Empty, ErrorBox, H3, Input, KPI, Label, Loading, Muted, P, Row, Screen, Section, Segmented, Small } from '../../components/ui'
import { LockedCard } from '../../components/Locked'
import PlanBanner from '../../components/PlanBanner'

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
const monthName = (m) => MONTHS_LONG[Number(String(m).slice(5, 7)) - 1] || ''
const monthLabel = (m) => `${cap(monthName(m))} de ${String(m).slice(0, 4)}`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
/** '2026-04-15' → '15 abr 2026' */
const shortDate = (k) => `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`

export default function Financas() {
  const app = useApp()
  const canFinance = app.can('finance')
  const thisMonth = todayKey().slice(0, 7)
  const thisYear = Number(todayKey().slice(0, 4))

  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState(thisMonth)
  const [year, setYear] = useState(thisYear)
  const [summary, setSummary] = useState(null)
  const [yearData, setYearData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      if (mode === 'year') {
        if (!canFinance) return
        const r = await api(`/api/agenda/finance?view=year&year=${year}`)
        if (id === reqId.current) setYearData(r)
      } else {
        const r = await api(`/api/agenda/finance?view=summary&month=${month}`)
        if (id === reqId.current) setSummary(r)
      }
    } catch (e) {
      if (id === reqId.current) setError(e)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [mode, month, year, canFinance])

  // Recarrega ao voltar pra aba (pagamento marcado, despesa lançada…) e ao trocar o período
  useFocusEffect(useCallback(() => { load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shownSummary = summary && summary.month === month ? summary : null
  const shownYear = yearData && yearData.year === year ? yearData : null

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <PlanBanner />
      <Segmented
        options={[{ value: 'month', label: 'Mês' }, { value: 'year', label: 'Ano' }]}
        value={mode}
        onChange={setMode}
        style={{ marginBottom: spacing.md }}
      />

      {mode === 'month' ? (
        <>
          <PeriodBar
            label={monthLabel(month)}
            onPrev={() => setMonth((m) => shiftMonth(m, -1))}
            onNext={() => setMonth((m) => shiftMonth(m, 1))}
            nextDisabled={month >= shiftMonth(thisMonth, 6)}
            showToday={month !== thisMonth}
            onToday={() => setMonth(thisMonth)}
          />
          {error ? <ErrorBox error={error} onRetry={load} /> : null}
          {shownSummary ? (
            <MonthView d={shownSummary} isCurrent={month === thisMonth} onChanged={(patch) => setSummary((s) => ({ ...s, ...patch }))} />
          ) : !error ? <Loading text="Somando seu mês…" /> : null}
        </>
      ) : (
        <>
          <PeriodBar
            label={String(year)}
            onPrev={() => setYear((y) => y - 1)}
            onNext={() => setYear((y) => y + 1)}
            nextDisabled={year >= thisYear}
            showToday={year !== thisYear}
            onToday={() => setYear(thisYear)}
          />
          {!canFinance ? (
            <>
              <LockedCard feature="finance" />
              <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>
                No plano Pro você vê o ano inteiro: faturamento, despesas, lucro e quanto guardar pro imposto a cada trimestre.
              </Muted>
            </>
          ) : (
            <>
              {error ? <ErrorBox error={error} onRetry={load} /> : null}
              {shownYear ? (
                <YearView d={shownYear} onPickMonth={(m) => { setMonth(m); setMode('month') }} />
              ) : !error ? <Loading text="Somando o ano…" /> : null}
            </>
          )}
        </>
      )}
      {loading && (shownSummary || shownYear) && !refreshing ? <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>Atualizando…</Muted> : null}
    </Screen>
  )
}

// ── Seletor de período ─────────────────────────────────────────────────────
function PeriodBar({ label, onPrev, onNext, nextDisabled, showToday, onToday }) {
  return (
    <View style={st.periodBar}>
      <Pressable onPress={onPrev} hitSlop={12} style={st.periodBtn} accessibilityRole="button" accessibilityLabel="Anterior">
        <Ionicons name="chevron-back" size={22} color={colors.green} />
      </Pressable>
      <Pressable onPress={showToday ? onToday : undefined} style={{ flex: 1, alignItems: 'center' }} accessibilityRole="button">
        <H3>{label}</H3>
        {showToday ? <Small style={{ color: colors.green, fontWeight: '600' }}>Voltar pro atual</Small> : null}
      </Pressable>
      <Pressable onPress={nextDisabled ? undefined : onNext} hitSlop={12} style={[st.periodBtn, nextDisabled && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Próximo">
        <Ionicons name="chevron-forward" size={22} color={colors.green} />
      </Pressable>
    </View>
  )
}

// ── Mês ────────────────────────────────────────────────────────────────────
function MonthView({ d, isCurrent, onChanged }) {
  const app = useApp()
  const nothing = !d.revenue_cents && !d.expected_cents && !d.completed && !d.no_shows && !d.cancellations && !d.unmarked_count

  return (
    <View>
      {d.unmarked_count > 0 ? (
        <Pressable onPress={() => router.push('/agenda')} style={st.unmarked}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.warning, fontWeight: '600', fontSize: 14 }}>
              {plural(d.unmarked_count, 'atendimento passou', 'atendimentos passaram')} sem marcar como realizado
            </Text>
            <Text style={{ color: colors.warning, fontSize: 13 }}>
              {fmtMoney(d.unmarked_cents)} ficam fora do faturamento até você marcar. Toque pra abrir a agenda.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.warning} />
        </Pressable>
      ) : null}

      <View style={st.kpiRow}>
        <KPI label="Faturado" value={fmtMoney(d.revenue_cents)} tone="green"
          sub={d.no_show_deposits_cents > 0
            ? `${plural(d.completed, 'atendimento', 'atendimentos')} + ${fmtMoney(d.no_show_deposits_cents)} de sinais de faltas`
            : plural(d.completed, 'atendimento realizado', 'atendimentos realizados')} />
        <KPI label="Previsto" value={fmtMoney(d.expected_cents)}
          sub={d.expected_count ? plural(d.expected_count, 'horário marcado', 'horários marcados') : 'Nada agendado pra frente'} />
      </View>
      <View style={[st.kpiRow, { marginTop: spacing.md }]}>
        <KPI label="Gorjetas" value={fmtMoney(d.tips_cents)} sub={d.tips_cents ? 'Entram no lucro' : 'Marque no pagamento'} />
        <KPI label="Ticket médio" value={fmtMoney(d.avg_ticket_cents)} sub="por atendimento" />
      </View>

      {nothing ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Empty icon="wallet-outline" title="Nada neste mês ainda"
            text="Quando você marcar os atendimentos como realizados (e o pagamento), o faturamento aparece aqui sozinho."
            action={<Button title="Abrir a agenda" variant="secondary" icon="calendar-outline" onPress={() => router.push('/agenda')} />} />
        </Card>
      ) : null}

      <Compare d={d} />
      <GoalCard d={d} isCurrent={isCurrent} onChanged={onChanged} />

      {d.revenue_cents > 0 ? (
        <Section title="Faturamento por dia">
          <Card><DailyBars daily={d.daily} today={d.today} /></Card>
        </Section>
      ) : null}

      {Object.keys(d.by_method || {}).length ? (
        <Section title="Por forma de pagamento">
          <Card><MethodBreakdown byMethod={d.by_method} total={d.revenue_cents} /></Card>
        </Section>
      ) : null}

      {d.by_service?.length ? (
        <Section title="Serviços que mais renderam">
          <Card padded={false}>
            {d.by_service.slice(0, 5).map((s, i) => (
              <View key={s.name}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                <Row title={s.name} subtitle={`${s.count}x`} right={<Text style={st.money}>{fmtMoney(s.cents)}</Text>} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {d.completed || d.no_shows || d.cancellations ? (
        <Section title="Atendimentos">
          <Card style={{ flexDirection: 'row' }}>
            <MiniStat label="Realizados" value={d.completed} color={colors.success} />
            <MiniStat label="Faltas" value={d.no_shows} color={colors.danger} />
            <MiniStat label="Cancelados" value={d.cancellations} color={colors.inkMuted} />
          </Card>
          {d.no_shows > 0 && d.completed + d.no_shows > 0 ? (
            <Muted style={{ marginTop: spacing.sm, paddingHorizontal: 2 }}>
              Taxa de falta: {Math.round((d.no_shows / (d.completed + d.no_shows)) * 100)}%.
              {d.no_shows / (d.completed + d.no_shows) >= 0.1 ? ' Pedir sinal no agendamento ajuda a diminuir as faltas.' : ''}
            </Muted>
          ) : null}
        </Section>
      ) : null}

      <Section title="Lucro e imposto">
        {d.finance_locked ? <LockedCard feature="finance" /> : <ProfitBlock d={d} onChanged={onChanged} />}
      </Section>

      <Section title="Mais em finanças">
        <Card padded={false}>
          <Shortcut icon="receipt-outline" title="Despesas" subtitle="Lance gastos e guarde a foto do comprovante" href="/finance/expenses" feature="finance" />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Shortcut icon="car-outline" title="Milhagem" subtitle="Milhas rodadas a trabalho viram dedução" href="/finance/mileage" feature="mileage" />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Shortcut icon="bar-chart-outline" title="Relatórios e exportação" subtitle="Por serviço, cliente e equipe, com CSV pro contador" href="/finance/reports" feature="reports" />
        </Card>
      </Section>
      {!app.can('receipts') ? null : (
        <Muted style={{ textAlign: 'center', marginTop: spacing.lg }}>
          Recibo em PDF: abra um atendimento realizado e toque em “Recibo”.
        </Muted>
      )}
    </View>
  )
}

function Shortcut({ icon, title, subtitle, href, feature }) {
  const app = useApp()
  const locked = feature && !app.can(feature)
  const info = featureInfo(app.ent, feature)
  return (
    <Row icon={icon} title={title} subtitle={subtitle} chevron onPress={() => router.push(href)}
      right={locked ? <Badge text={info.minName} tone="gold" icon="lock-closed" /> : null} />
  )
}

function MiniStat({ label, value, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[type.kpi, { color }]}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
  )
}

function Compare({ d }) {
  const prevName = monthName(d.previous_month)
  const current = d.previous_same_period_cents != null
  const base = current ? d.previous_same_period_cents : d.previous_revenue_cents
  if (d.month > d.today.slice(0, 7)) return null      // mês que ainda não começou
  if (!base && !d.revenue_cents) return null
  const ch = pctChange(d.revenue_cents, base)
  const up = ch != null && ch >= 0
  return (
    <Card style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={[st.compareIcon, { backgroundColor: ch == null ? colors.paperSoft : up ? colors.successSoft : colors.dangerSoft }]}>
        <Ionicons name={ch == null ? 'remove' : up ? 'trending-up' : 'trending-down'} size={20}
          color={ch == null ? colors.inkMuted : up ? colors.success : colors.danger} />
      </View>
      <View style={{ flex: 1 }}>
        {ch != null ? (
          <Text style={[type.body, { fontWeight: '600', color: up ? colors.success : colors.danger }]}>
            {up ? '+' : ''}{ch}% {current ? `que o mesmo período de ${prevName}` : `que ${prevName}`}
          </Text>
        ) : (
          <Text style={[type.body, { fontWeight: '600' }]}>Sem faturamento em {prevName} pra comparar</Text>
        )}
        <Muted>
          {current
            ? `De 1º até hoje em ${prevName}: ${fmtMoney(base)} · mês inteiro: ${fmtMoney(d.previous_revenue_cents)}`
            : `${cap(prevName)}: ${fmtMoney(base)}`}
        </Muted>
      </View>
    </Card>
  )
}

function GoalCard({ d, isCurrent, onChanged }) {
  const app = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const goal = d.goal_cents || 0

  function startEdit() {
    setValue(goal ? centsToInput(goal) : '')
    setErr(null)
    setEditing(true)
  }

  async function save(cents) {
    if (cents == null) { setErr('Digite um valor, ex.: 3000'); return }
    if (cents > 100000000) { setErr('Valor muito alto'); return }
    setSaving(true)
    try {
      await app.saveSettings({ monthly_goal_cents: cents })
      onChanged({ goal_cents: cents > 0 ? cents : null })
      setEditing(false)
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  // Sugestão: 10% acima do mês passado, arredondado pra dezena
  const suggestion = d.previous_revenue_cents > 0 ? Math.ceil((d.previous_revenue_cents * 1.1) / 1000) * 1000 : null

  if (editing) {
    return (
      <Card style={{ marginTop: spacing.md }}>
        <H3 style={{ marginBottom: spacing.md }}>Meta de faturamento do mês</H3>
        <Input label="Quanto você quer faturar por mês?" value={value} onChangeText={(t) => { setValue(t); setErr(null) }}
          keyboardType="decimal-pad" placeholder="Ex.: 3000" error={err} autoFocus
          hint="Vale pra todos os meses. Muda quando quiser." />
        {suggestion ? (
          <Chip label={`Sugestão: ${fmtMoney(suggestion)} (mês passado + 10%)`} onPress={() => setValue(centsToInput(suggestion))} icon="sparkles-outline" />
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button title="Cancelar" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
          <Button title="Salvar meta" onPress={() => save(parseMoney(value))} loading={saving} style={{ flex: 1 }} />
        </View>
        {goal ? <Button title="Tirar a meta" variant="ghost" small onPress={() => save(0)} style={{ marginTop: spacing.sm }} /> : null}
      </Card>
    )
  }

  if (!goal) {
    return (
      <Card style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }} onPress={startEdit}>
        <View style={[st.compareIcon, { backgroundColor: colors.goldSoft }]}><Ionicons name="flag-outline" size={20} color={colors.goldDark} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: '600' }]}>Defina uma meta pro mês</Text>
          <Muted>Acompanhe quanto falta e quantos atendimentos precisa.</Muted>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      </Card>
    )
  }

  // Mês futuro: compara a meta com o que já está agendado
  const future = d.month > d.today.slice(0, 7)
  const progress = future ? d.expected_cents : d.revenue_cents
  const pct = Math.min(100, Math.round((progress / goal) * 100))
  const left = Math.max(0, goal - progress)
  const reached = !future && d.revenue_cents >= goal
  const visits = d.avg_ticket_cents > 0 ? Math.ceil(left / d.avg_ticket_cents) : null
  let perDay = null
  if (isCurrent && left > 0) {
    const [y, m] = d.month.split('-').map(Number)
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(d.today.slice(8, 10)) + 1
    if (days > 0) perDay = Math.ceil(left / days)
  }

  return (
    <Card style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>Meta do mês</Label>
        <Pressable onPress={startEdit} hitSlop={10}><Text style={{ color: colors.green, fontWeight: '600' }}>Editar</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <Text style={type.kpi}>{fmtMoney(progress)}</Text>
        <Muted>{future ? 'agendado ' : ''}de {fmtMoney(goal)} · {pct}%</Muted>
      </View>
      <View style={st.track}>
        <View style={[st.fill, { width: `${pct}%`, backgroundColor: reached ? colors.flag : colors.green }]} />
      </View>
      {reached ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
          <Ionicons name="trophy-outline" size={18} color={colors.goldDark} />
          <Text style={[type.body, { fontWeight: '600', color: colors.goldDark }]}>Meta batida! Parabéns.</Text>
        </View>
      ) : future ? (
        <Muted style={{ marginTop: spacing.sm }}>
          {left ? `Faltam ${fmtMoney(left)} em horários pra chegar na meta.` : 'A agenda já cobre a meta deste mês.'}
        </Muted>
      ) : (
        <Muted style={{ marginTop: spacing.sm }}>
          Faltam {fmtMoney(left)}
          {visits ? ` · uns ${plural(visits, 'atendimento', 'atendimentos')} no seu ticket médio` : ''}
          {perDay ? ` · ${fmtMoney(perDay)} por dia até o fim do mês` : ''}
        </Muted>
      )}
    </Card>
  )
}

function DailyBars({ daily, today }) {
  const [sel, setSel] = useState(null)
  const max = Math.max(1, ...daily.map((x) => x.cents))
  const best = daily.reduce((b, x) => (x.cents > (b?.cents || 0) ? x : b), null)
  const last = daily.length
  const ticks = [1, 8, 16, 24, last]
  const picked = sel != null ? daily[sel] : null
  return (
    <View>
      <View style={st.bars}>
        {daily.map((x, i) => {
          const h = x.cents ? Math.max(4, Math.round((x.cents / max) * 112)) : 2
          const on = sel === i
          const isToday = x.date === today
          return (
            <Pressable key={x.date} onPress={() => setSel(on ? null : i)} style={st.barSlot} accessibilityLabel={`${fmtDay(x.date)}: ${fmtMoney(x.cents)}`}>
              <View style={{ height: h, borderRadius: 3, backgroundColor: on ? colors.gold : x.cents ? colors.green : colors.line, borderWidth: isToday && !on ? 1 : 0, borderColor: colors.gold }} />
            </Pressable>
          )
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {ticks.map((t) => <Text key={t} style={st.tick}>{t}</Text>)}
      </View>
      <Muted style={{ marginTop: spacing.sm }}>
        {picked
          ? `${cap(fmtDay(picked.date))}: ${fmtMoney(picked.cents)}`
          : best ? `Melhor dia: ${fmtDay(best.date)} (${fmtMoney(best.cents)}). Toque numa barra pra ver o dia.` : ''}
      </Muted>
    </View>
  )
}

function MethodBreakdown({ byMethod, total }) {
  const list = Object.entries(byMethod).sort((a, b) => b[1] - a[1])
  return (
    <View style={{ gap: spacing.md }}>
      {list.map(([k, cents]) => {
        const pct = total ? Math.round((cents / total) * 100) : 0
        return (
          <View key={k}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <P style={{ fontWeight: '500' }}>{methodLabel(k)}</P>
              <Text style={st.money}>{fmtMoney(cents)} <Text style={type.muted}>· {pct}%</Text></Text>
            </View>
            <View style={[st.track, { height: 6, marginTop: 6 }]}>
              <View style={[st.fill, { width: `${Math.max(2, pct)}%` }]} />
            </View>
          </View>
        )
      })}
    </View>
  )
}

// ── Bloco Pro: lucro, imposto e milhagem ───────────────────────────────────
function ProfitBlock({ d, onChanged }) {
  const app = useApp()
  const [pct, setPct] = useState(d.tax_reserve_pct)
  const timer = useRef(null)
  const pending = useRef(null)

  useEffect(() => { setPct(d.tax_reserve_pct) }, [d.tax_reserve_pct, d.month])

  // Salva o % com uma pausa (vários toques no +/- viram uma gravação só)
  const flush = useCallback(() => {
    if (pending.current == null) return
    const v = pending.current
    pending.current = null
    app.saveSettings({ tax_reserve_pct: v }).catch((e) => showError(e))
  }, [app.saveSettings])
  useEffect(() => () => { clearTimeout(timer.current); flush() }, [flush])

  function changePct(v) {
    const n = Math.min(60, Math.max(0, v))
    setPct(n)
    onChanged({ tax_reserve_pct: n, tax_reserve_cents: Math.round(((d.taxable_cents || 0) * n) / 100) })
    pending.current = n
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }

  const income = d.revenue_cents + d.tips_cents
  const reserve = Math.round(((d.taxable_cents || 0) * pct) / 100)
  const due = nextEstimatedTaxDue(d.today)
  const cats = (d.expenses_by_category || []).slice(0, 3)

  return (
    <View>
      <Card>
        <Line label="Faturado + gorjetas" value={fmtMoney(income)} />
        <Pressable onPress={() => router.push('/finance/expenses')}>
          <Line label={`Despesas${d.expenses_count ? ` (${d.expenses_count})` : ''}`} value={d.expenses_cents ? `−${fmtMoney(d.expenses_cents)}` : fmtMoney(0)} link />
        </Pressable>
        {cats.length ? (
          <Muted style={{ marginTop: 2 }}>{cats.map((c) => `${categoryInfo(c.category).label} ${fmtMoney(c.cents)}`).join(' · ')}</Muted>
        ) : (
          <Muted style={{ marginTop: 2 }}>Nenhuma despesa lançada neste mês.</Muted>
        )}
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <H3>Lucro do mês</H3>
          <Text style={[type.kpi, { color: d.net_cents >= 0 ? colors.green : colors.danger }]}>{fmtMoney(d.net_cents)}</Text>
        </View>
        {!d.expenses_cents ? (
          <Button title="Lançar despesa" small variant="secondary" icon="add" full={false} style={{ marginTop: spacing.md }}
            onPress={() => router.push('/finance/expense-edit')} />
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Label>Reserva pro imposto</Label>
        <Text style={[type.kpi, { color: colors.goldDark, marginTop: 6 }]}>{fmtMoney(reserve)}</Text>
        <Muted>{pct}% do lucro tributável estimado ({fmtMoney(d.taxable_cents || 0)})</Muted>
        {d.mileage_deduction_cents > 0 ? <Muted>Já descontamos {fmtMoney(d.mileage_deduction_cents)} da milhagem.</Muted> : null}
        {d.gas_excluded ? <Muted>A gasolina ({fmtMoney(d.gas_cents)}) não entra: a dedução por milha já cobre o carro.</Muted> : null}

        <View style={st.stepper}>
          <Pressable onPress={() => changePct(pct - 1)} style={st.stepBtn} hitSlop={8} accessibilityLabel="Diminuir porcentagem">
            <Ionicons name="remove" size={20} color={colors.green} />
          </Pressable>
          <Text style={[type.h2, { minWidth: 64, textAlign: 'center' }]}>{pct}%</Text>
          <Pressable onPress={() => changePct(pct + 1)} style={st.stepBtn} hitSlop={8} accessibilityLabel="Aumentar porcentagem">
            <Ionicons name="add" size={20} color={colors.green} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
          {[15, 20, 25, 30].map((v) => <Chip key={v} label={`${v}%`} selected={pct === v} onPress={() => changePct(v)} />)}
        </View>

        <View style={st.warn}>
          <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
          <Text style={{ flex: 1, color: colors.warning, fontSize: 13, lineHeight: 18 }}>
            Estimativa; confirme com seu contador. Como autônoma (1099) você paga self-employment tax ~15,3% + imposto de renda.
          </Text>
        </View>
        <Muted style={{ marginTop: spacing.sm }}>
          Próximo pagamento trimestral estimado (1040-ES): {shortDate(due.due)}, referente a {due.months}. Separe a reserva numa poupança assim que receber.
        </Muted>
      </Card>

      <Card padded={false} style={{ marginTop: spacing.md }}>
        {d.mileage_locked ? (
          <Row icon="car-outline" title="Milhagem" subtitle="Milhas a trabalho viram dedução no imposto" chevron onPress={() => openPlans('mileage')}
            right={<Badge text={featureInfo(app.ent, 'mileage').minName} tone="gold" icon="lock-closed" />} />
        ) : (
          <Row icon="car-outline" title="Milhagem do mês" chevron onPress={() => router.push('/finance/mileage')}
            subtitle={d.miles ? `${String(d.miles).replace('.', ',')} milhas · dedução estimada ${fmtMoney(d.mileage_deduction_cents)}` : 'Nenhuma viagem registrada. Toque pra lançar.'} />
        )}
      </Card>
    </View>
  )
}

function Line({ label, value, link }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
      <P style={link ? { color: colors.green, fontWeight: '500' } : null}>{label}{link ? ' ›' : ''}</P>
      <Text style={st.money}>{value}</Text>
    </View>
  )
}

// ── Ano ────────────────────────────────────────────────────────────────────
function YearView({ d, onPickMonth }) {
  const t = d.totals
  const today = todayKey()
  const nextDue = d.quarters.find((q) => q.due >= today)
  const hasData = t.revenue_cents || t.expenses_cents
  return (
    <View>
      <View style={st.kpiRow}>
        <KPI label="Faturado" value={fmtMoney(t.revenue_cents + t.tips_cents)} tone="green" sub={`${t.completed} atendimentos · com gorjetas`} />
        <KPI label="Despesas" value={fmtMoney(t.expenses_cents)} />
      </View>
      <View style={[st.kpiRow, { marginTop: spacing.md }]}>
        <KPI label="Lucro" value={fmtMoney(t.net_cents)} tone={t.net_cents >= 0 ? 'green' : undefined} />
        <KPI label="Reserva imposto" value={fmtMoney(t.tax_reserve_cents)} tone="gold" sub={`${d.tax_reserve_pct}% do tributável`} />
      </View>

      {hasData ? (
        <Section title="Mês a mês">
          <Card>
            <YearBars months={d.months} onPick={onPickMonth} />
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md }}>
              <Legend color={colors.green} label="Faturado" />
              <Legend color={colors.gold} label="Despesas" />
            </View>
          </Card>
        </Section>
      ) : (
        <Card style={{ marginTop: spacing.lg }}>
          <Empty icon="bar-chart-outline" title="Nada neste ano ainda" text="O resumo do ano aparece conforme você marca atendimentos e lança despesas." />
        </Card>
      )}

      <Section title="Imposto estimado trimestral (1040-ES)">
        <Card padded={false}>
          {d.quarters.map((q, i) => {
            const isNext = nextDue && q.due === nextDue.due
            const past = q.due < today
            const first = MONTHS[q.months[0] - 1], lastM = MONTHS[q.months[q.months.length - 1] - 1]
            return (
              <View key={q.due}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                <Row
                  title={`${i + 1}º pagamento · ${first}–${lastM}`}
                  subtitle={`Vence ${shortDate(q.due)}`}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[st.money, past && { color: colors.inkMuted }]}>{fmtMoney(q.tax_reserve_cents)}</Text>
                      {isNext ? <Badge text="Próximo" tone="gold" /> : past ? <Badge text="Venceu" tone="gray" /> : null}
                    </View>
                  }
                />
              </View>
            )
          })}
        </Card>
        <Muted style={{ marginTop: spacing.sm, paddingHorizontal: 2 }}>
          Estimativa com {d.tax_reserve_pct}% sobre o lucro de cada período. O pagamento é feito no IRS Direct Pay ou EFTPS; se cair em fim de semana, vale o próximo dia útil. Confirme o valor com seu contador.
        </Muted>
      </Section>

      {!d.mileage_locked && t.miles > 0 ? (
        <Section title="Milhagem do ano">
          <Card padded={false}>
            <Row icon="car-outline" title={`${String(t.miles).replace('.', ',')} milhas`} subtitle={`Dedução estimada ${fmtMoney(t.mileage_deduction_cents)}`} chevron onPress={() => router.push('/finance/mileage')} />
          </Card>
        </Section>
      ) : null}

      {hasData ? (
        <Section title="Meses">
          <Card padded={false}>
            {d.months.filter((m) => m.revenue_cents || m.expenses_cents).map((m, i) => (
              <View key={m.month}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                <Row title={cap(monthName(m.month))} subtitle={`Despesas ${fmtMoney(m.expenses_cents)} · Lucro ${fmtMoney(m.net_cents)}`}
                  right={<Text style={st.money}>{fmtMoney(m.revenue_cents)}</Text>} chevron onPress={() => onPickMonth(m.month)} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </View>
  )
}

function YearBars({ months, onPick }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.revenue_cents, m.expenses_cents)))
  return (
    <View>
      <View style={[st.bars, { gap: 4 }]}>
        {months.map((m) => {
          const h1 = m.revenue_cents ? Math.max(3, Math.round((m.revenue_cents / max) * 112)) : 2
          const h2 = m.expenses_cents ? Math.max(3, Math.round((m.expenses_cents / max) * 112)) : 2
          return (
            <Pressable key={m.month} onPress={() => onPick(m.month)} style={[st.barSlot, { flexDirection: 'row', alignItems: 'flex-end', gap: 1 }]}
              accessibilityLabel={`${monthName(m.month)}: faturado ${fmtMoney(m.revenue_cents)}, despesas ${fmtMoney(m.expenses_cents)}`}>
              <View style={{ flex: 1, height: h1, borderRadius: 2, backgroundColor: m.revenue_cents ? colors.green : colors.line }} />
              <View style={{ flex: 1, height: h2, borderRadius: 2, backgroundColor: m.expenses_cents ? colors.gold : colors.line }} />
            </Pressable>
          )
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
        {months.map((m) => <Text key={m.month} style={[st.tick, { flex: 1, textAlign: 'center' }]}>{MONTHS[Number(m.month.slice(5, 7)) - 1][0].toUpperCase()}</Text>)}
      </View>
    </View>
  )
}

function Legend({ color, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Small>{label}</Small>
    </View>
  )
}

const st = StyleSheet.create({
  periodBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, minHeight: 44 },
  periodBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', gap: spacing.md },
  unmarked: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningSoft, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  compareIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.paperSoft, overflow: 'hidden', marginTop: spacing.sm },
  fill: { height: '100%', borderRadius: 5, backgroundColor: colors.green },
  bars: { height: 116, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  tick: { fontSize: 10, color: colors.inkMuted },
  money: { fontSize: 15, fontWeight: '600', color: colors.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  warn: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningSoft, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
})
