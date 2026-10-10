// Relatórios (Premium): mês ou ano por serviço, top clientes, equipe, dia da semana,
// clientes novas x recorrentes e taxa de falta; exporta CSV pro contador.
import { useCallback, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Sharing from 'expo-sharing'
import { File as FsFile, Paths } from 'expo-file-system'
import * as LegacyFS from 'expo-file-system/legacy'
import { api } from '../../lib/api'
import { showError } from '../../lib/gate'
import { notify } from '../../lib/dialog'
import { colors, spacing, type } from '../../lib/theme'
import { MONTHS_LONG, WEEKDAYS_LONG, fmtMoney, todayKey } from '../../lib/format'
import { shiftMonth } from '../../lib/receipt'
import { Card, Divider, Empty, ErrorBox, H3, KPI, Loading, Muted, P, Row, Screen, Section, Segmented, Small, ToggleRow } from '../../components/ui'
import Locked from '../../components/Locked'

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
const monthName = (m) => MONTHS_LONG[Number(String(m).slice(5, 7)) - 1] || ''
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const SOURCE_LABEL = { online: 'Agendamento online', manual: 'Marcado por você', recurring: 'Clientes fixas', ical: 'Turnover (Airbnb/Vrbo)', unknown: 'Sem origem' }

const EXPORTS = [
  { kind: 'appointments', title: 'Agendamentos', icon: 'calendar-outline', file: 'agendamentos', sub: 'Data, cliente, serviço, valor, gorjeta e forma de pagamento' },
  { kind: 'expenses', title: 'Despesas', icon: 'receipt-outline', file: 'despesas', sub: 'Com a linha sugerida do Schedule C' },
  { kind: 'mileage', title: 'Milhagem', icon: 'car-outline', file: 'milhagem', sub: 'Registro de milhas no formato que o IRS pede' },
  { kind: 'clients', title: 'Clientes', icon: 'people-outline', file: 'clientes', sub: 'Lista com contato, visitas e gasto' },
  { kind: 'invoices', title: 'Faturas', icon: 'document-text-outline', file: 'faturas', sub: 'Número, cliente, emissão, vencimento, total, pago e saldo' },
  { kind: 'invoice_payments', title: 'Pagamentos de fatura', icon: 'cash-outline', file: 'pagamentos-faturas', sub: 'Cada pagamento na data em que entrou (bate com o faturado)' },
]

export default function ReportsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Relatórios' }} />
      <Locked feature="reports"><Reports /></Locked>
    </>
  )
}

/** api(…, { raw: true }) não lê o JSON de erro: recupera mensagem e código do plano. */
function rawError(e) {
  if (typeof e?.body === 'string') {
    try {
      const j = JSON.parse(e.body)
      if (j?.error) return Object.assign(new Error(j.error), { code: j.code || null, feature: j.feature || null })
    } catch (_) {}
  }
  return e
}

/** Salva o CSV e abre o compartilhar (celular) ou baixa o arquivo (navegador). */
async function saveAndShare(text, name) {
  // O fetch tira o BOM ao ler o texto; sem ele o Excel embaralha os acentos
  const csv = text.charCodeAt(0) === 0xfeff ? text : '﻿' + text
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return
  }
  let uri
  try {
    const file = new FsFile(Paths.cache, name)
    if (file.exists) file.delete()
    file.create()
    file.write(csv)
    uri = file.uri
  } catch (_) {
    // Plano B: API antiga do expo-file-system
    uri = LegacyFS.cacheDirectory + name
    await LegacyFS.writeAsStringAsync(uri, csv, { encoding: LegacyFS.EncodingType.UTF8 })
  }
  if (!(await Sharing.isAvailableAsync())) {
    notify('Arquivo pronto', 'Este aparelho não permite compartilhar arquivos daqui.')
    return
  }
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: name })
}

function Reports() {
  const thisMonth = todayKey().slice(0, 7)
  const thisYear = Number(todayKey().slice(0, 4))
  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState(thisMonth)
  const [year, setYear] = useState(thisYear)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(null)
  const [english, setEnglish] = useState(false)
  const reqId = useRef(0)

  const query = mode === 'year' ? `year=${year}` : `month=${month}`
  const periodKey = mode === 'year' ? String(year) : month

  const load = useCallback(async () => {
    const id = ++reqId.current
    setError(null)
    try {
      const r = await api(`/api/agenda/finance?view=report&${query}`)
      if (id === reqId.current) setData({ ...r, key: periodKey })
    } catch (e) {
      if (id === reqId.current) setError(e)
    }
  }, [query, periodKey])

  useFocusEffect(useCallback(() => { load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function exportCsv(x) {
    setExporting(x.kind)
    try {
      const text = await api(`/api/agenda/finance?view=export&kind=${x.kind}&${query}${english ? '&lang=en' : ''}`, { raw: true })
      await saveAndShare(String(text || ''), `agendapro-${x.file}-${periodKey}.csv`)
    } catch (e) {
      showError(rawError(e), 'Não deu pra exportar')
    } finally {
      setExporting(null)
    }
  }

  const shown = data && data.key === periodKey ? data : null
  const label = mode === 'year' ? String(year) : `${cap(monthName(month))} de ${month.slice(0, 4)}`
  const canNext = mode === 'year' ? year < thisYear : month < thisMonth

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Segmented options={[{ value: 'month', label: 'Mês' }, { value: 'year', label: 'Ano' }]} value={mode} onChange={setMode} style={{ marginBottom: spacing.md }} />
      <View style={st.periodBar}>
        <Pressable onPress={() => (mode === 'year' ? setYear((y) => y - 1) : setMonth((m) => shiftMonth(m, -1)))} hitSlop={12} style={st.periodBtn} accessibilityLabel="Anterior">
          <Ionicons name="chevron-back" size={22} color={colors.green} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}><H3>{label}</H3></View>
        <Pressable onPress={canNext ? () => (mode === 'year' ? setYear((y) => y + 1) : setMonth((m) => shiftMonth(m, 1))) : undefined}
          hitSlop={12} style={[st.periodBtn, !canNext && { opacity: 0.3 }]} accessibilityLabel="Próximo">
          <Ionicons name="chevron-forward" size={22} color={colors.green} />
        </Pressable>
      </View>

      {error ? <ErrorBox error={error} onRetry={load} /> : null}
      {!shown && !error ? <Loading text="Montando o relatório…" /> : null}
      {shown ? <ReportBody d={shown} /> : null}

      <Section title="Exportar CSV pro contador">
        <Card padded={false}>
          <ToggleRow title="Cabeçalho em inglês" subtitle="Pra contador americano" value={english} onValueChange={setEnglish} />
          {EXPORTS.map((x) => (
            <View key={x.kind}>
              <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
              <Row icon={x.icon} title={x.title} subtitle={x.sub}
                right={exporting === x.kind ? <Small>Gerando…</Small> : <Ionicons name="download-outline" size={20} color={colors.green} />}
                onPress={exporting ? undefined : () => exportCsv(x)} />
            </View>
          ))}
        </Card>
        <Muted style={{ marginTop: spacing.sm, paddingHorizontal: 2 }}>
          Período: {label}. O arquivo abre no Excel, Numbers ou Google Planilhas.
        </Muted>
      </Section>
    </Screen>
  )
}

function ReportBody({ d }) {
  const t = d.totals
  if (!t.appointments) {
    return (
      <Card>
        <Empty icon="bar-chart-outline" title="Sem atendimentos no período"
          text="O relatório aparece quando houver atendimentos marcados como realizados. Dá pra exportar despesas e milhagem mesmo assim." />
      </Card>
    )
  }
  const tips = insights(d)
  return (
    <View>
      <View style={st.kpiRow}>
        <KPI label="Faturado" value={fmtMoney(t.revenue_cents)} tone="green" sub={t.tips_cents ? `+ ${fmtMoney(t.tips_cents)} de gorjeta` : null} />
        <KPI label="Realizados" value={String(t.completed)} sub={`de ${t.appointments} agendados`} />
      </View>
      <View style={[st.kpiRow, { marginTop: spacing.md }]}>
        <KPI label="Ticket médio" value={fmtMoney(t.avg_ticket_cents)} />
        <KPI label="Taxa de falta" value={`${String(t.no_show_rate).replace('.', ',')}%`} sub={`${t.no_shows} falta${t.no_shows === 1 ? '' : 's'} · ${t.cancellations} cancelado${t.cancellations === 1 ? '' : 's'}`} />
      </View>

      {tips.length ? (
        <Section title="O que os números dizem">
          <Card>
            {tips.map((x, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, marginTop: i ? spacing.sm : 0 }}>
                <Ionicons name={x.icon} size={18} color={x.color || colors.green} style={{ marginTop: 1 }} />
                <P style={{ flex: 1 }}>{x.text}</P>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {d.by_service.length ? (
        <Section title="Por serviço">
          <Card>
            {d.by_service.map((s, i) => (
              <BarLine key={s.name} first={i === 0} label={s.name} sub={`${s.count}x`} value={fmtMoney(s.cents)} share={pct(s.cents, t.completed_cents)} />
            ))}
          </Card>
        </Section>
      ) : null}

      {d.top_clients.length ? (
        <Section title="Clientes que mais gastaram">
          <Card padded={false}>
            {d.top_clients.map((c, i) => (
              <View key={`${c.client_id || c.name}-${i}`}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 56 }} /> : null}
                <Row
                  left={<View style={st.rank}><Text style={{ fontWeight: '700', color: i < 3 ? colors.goldDark : colors.inkSoft }}>{i + 1}</Text></View>}
                  title={c.name}
                  subtitle={`${c.count} atendimento${c.count === 1 ? '' : 's'}${c.tips_cents ? ` · ${fmtMoney(c.tips_cents)} de gorjeta` : ''}`}
                  right={<Text style={st.money}>{fmtMoney(c.cents)}</Text>}
                  chevron={!!c.client_id}
                  onPress={c.client_id ? () => router.push(`/client/${c.client_id}`) : undefined}
                />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Clientes novas x recorrentes">
        <Card>
          <View style={{ flexDirection: 'row' }}>
            <Stat label="Novas" value={d.clients.new_count} sub={fmtMoney(d.clients.new_cents)} color={colors.gold} />
            <Stat label="Voltaram" value={d.clients.returning_count} sub={fmtMoney(d.clients.returning_cents)} color={colors.green} />
          </View>
          {d.clients.new_count + d.clients.returning_count > 0 ? (
            <View style={[st.stack, { marginTop: spacing.md }]}>
              <View style={{ flex: d.clients.new_count || 0.0001, backgroundColor: colors.gold }} />
              <View style={{ flex: d.clients.returning_count || 0.0001, backgroundColor: colors.green }} />
            </View>
          ) : null}
          <Muted style={{ marginTop: spacing.sm }}>Nova = primeiro atendimento realizado neste período.</Muted>
        </Card>
      </Section>

      <Section title="Por dia da semana">
        <Card>
          {d.by_weekday.map((w, i) => {
            const max = Math.max(1, ...d.by_weekday.map((x) => x.cents))
            return (
              <View key={w.weekday} style={[st.wdRow, i > 0 && { marginTop: spacing.sm }]}>
                <Text style={st.wdLabel}>{WEEKDAYS_LONG[w.weekday].slice(0, 3)}</Text>
                <View style={[st.track, { flex: 1 }]}>
                  <View style={[st.fill, { width: `${w.cents ? Math.max(3, pct(w.cents, max)) : 0}%` }]} />
                </View>
                <Text style={st.wdValue}>{w.count ? fmtMoney(w.cents) : '—'}</Text>
              </View>
            )
          })}
        </Card>
      </Section>

      {d.by_staff?.length ? (
        <Section title="Por profissional">
          <Card padded={false}>
            {d.by_staff.map((s, i) => (
              <View key={s.staff_id || 'none'}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                <Row
                  left={<View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: s.color || colors.line }} />}
                  title={s.name}
                  subtitle={`${s.count} atendimento${s.count === 1 ? '' : 's'} · ${pct(s.cents, t.completed_cents)}%`}
                  right={<Text style={st.money}>{fmtMoney(s.cents)}</Text>}
                />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {d.by_source?.length ? (
        <Section title="De onde vieram os atendimentos">
          <Card>
            {d.by_source.map((s, i) => (
              <BarLine key={s.source} first={i === 0} label={SOURCE_LABEL[s.source] || s.source} sub={`${s.count}x`} value={fmtMoney(s.cents)} share={pct(s.count, t.completed)} />
            ))}
          </Card>
        </Section>
      ) : null}

      {d.by_month ? (
        <Section title="Mês a mês">
          <Card padded={false}>
            {d.by_month.map((m, i) => (
              <View key={m.month}>
                {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                <Row title={cap(monthName(m.month))} subtitle={m.count ? `${m.count} atendimento${m.count === 1 ? '' : 's'}` : 'Sem atendimentos'}
                  right={<Text style={[st.money, !m.cents && { color: colors.inkMuted }]}>{fmtMoney(m.cents)}</Text>} />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </View>
  )
}

/** Frases automáticas com o que mais chama atenção no período. */
function insights(d) {
  const t = d.totals
  const out = []
  const top = d.by_service[0]
  if (top && t.completed_cents && d.by_service.length > 1) {
    out.push({ icon: 'star-outline', text: `${top.name} trouxe ${pct(top.cents, t.completed_cents)}% do faturamento.` })
  }
  const bestDay = [...d.by_weekday].sort((a, b) => b.cents - a.cents)[0]
  if (bestDay?.cents) out.push({ icon: 'calendar-outline', text: `${WEEKDAYS_LONG[bestDay.weekday]} é seu dia mais forte (${fmtMoney(bestDay.cents)}).` })
  const hours = [...(d.by_hour || [])].filter((h) => h.count).sort((a, b) => b.count - a.count).slice(0, 2)
  if (hours.length) out.push({ icon: 'time-outline', text: `Horário${hours.length > 1 ? 's' : ''} mais procurado${hours.length > 1 ? 's' : ''}: ${hours.map((h) => `${h.hour}h`).join(' e ')}.` })
  if (t.no_show_rate >= 10) {
    out.push({ icon: 'alert-circle-outline', color: colors.warning, text: `Taxa de falta de ${String(t.no_show_rate).replace('.', ',')}%. Pedir sinal no agendamento ajuda a segurar o horário.` })
  } else if (!t.no_shows && t.completed >= 5) {
    out.push({ icon: 'checkmark-circle-outline', text: 'Nenhuma falta no período. Ótimo!' })
  }
  const best = d.top_clients[0]
  if (best && t.completed_cents && d.top_clients.length > 2 && best.cents / t.completed_cents >= 0.2) {
    out.push({ icon: 'heart-outline', text: `${best.name} sozinha representa ${pct(best.cents, t.completed_cents)}% do faturamento.` })
  }
  const online = d.by_source?.find((s) => s.source === 'online')
  if (online && t.completed) out.push({ icon: 'globe-outline', text: `${pct(online.count, t.completed)}% dos atendimentos vieram da sua página de agendamento online.` })
  if (d.clients.new_count) {
    out.push({ icon: 'sparkles-outline', text: `${d.clients.new_count} cliente${d.clients.new_count === 1 ? ' nova' : 's novas'} e ${d.clients.returning_count} que já eram suas.` })
  }
  return out
}

function BarLine({ label, sub, value, share, first }) {
  return (
    <View style={!first && { marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <P style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>{label}</P>
        <Small>{sub}</Small>
        <Text style={st.money}>{value}</Text>
      </View>
      <View style={[st.track, { marginTop: 6 }]}>
        <View style={[st.fill, { width: `${Math.max(2, share)}%` }]} />
      </View>
      <Muted style={{ marginTop: 2 }}>{share}%</Muted>
    </View>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[type.kpi, { color }]}>{value}</Text>
      <Small style={{ fontWeight: '600' }}>{label}</Small>
      <Muted>{sub}</Muted>
    </View>
  )
}

const st = StyleSheet.create({
  periodBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, minHeight: 44 },
  periodBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', gap: spacing.md },
  money: { fontSize: 15, fontWeight: '600', color: colors.ink },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.paperSoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.green },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.paperSoft },
  rank: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.paperSoft, alignItems: 'center', justifyContent: 'center' },
  wdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wdLabel: { width: 34, fontSize: 13, fontWeight: '600', color: colors.inkSoft },
  wdValue: { width: 72, textAlign: 'right', fontSize: 13, fontWeight: '600', color: colors.ink },
})
