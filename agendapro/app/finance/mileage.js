// Milhagem: viagens a trabalho do mês, total de milhas e dedução estimada (taxa
// por milha do IRS, editável), registro rápido a partir dos atendimentos do mês.
import { useCallback, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useApp } from '../../lib/session'
import { api, post } from '../../lib/api'
import { showError } from '../../lib/gate'
import { confirm } from '../../lib/dialog'
import { colors, radius, spacing, type } from '../../lib/theme'
import { MONTHS_LONG, fmtDay, fmtMoney, todayKey } from '../../lib/format'
import { shiftMonth } from '../../lib/receipt'
import { Button, Card, Divider, Empty, ErrorBox, H3, Input, Label, Loading, Muted, Row, Screen, Section, Small, ToggleRow } from '../../components/ui'
import { DateField } from '../../components/pickers'
import Locked from '../../components/Locked'

const IRS_RATES_URL = 'https://www.irs.gov/tax-professionals/standard-mileage-rates'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
const monthName = (m) => MONTHS_LONG[Number(String(m).slice(5, 7)) - 1] || ''
/** 12.5 → '12,5' · 12 → '12' */
const fmtMiles = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1).replace(/\.0$/, '').replace('.', ',')
const parseMiles = (s) => {
  const n = Number(String(s || '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export default function MileageScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Milhagem' }} />
      <Locked feature="mileage"><Mileage /></Locked>
    </>
  )
}

const EMPTY_FORM = { id: null, date: '', miles: '', roundTrip: false, purpose: '', from: '', to: '', appointmentId: null }

function Mileage() {
  const app = useApp()
  const thisMonth = todayKey().slice(0, 7)
  const scroller = useRef(null)
  const reqId = useRef(0)

  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [form, setForm] = useState(null)              // null = fechado
  const [formErr, setFormErr] = useState({})
  const [saving, setSaving] = useState(null)          // 'save' | 'delete'
  const [rateEdit, setRateEdit] = useState(null)      // texto em edição
  const [rateSaving, setRateSaving] = useState(false)
  const [showAllSug, setShowAllSug] = useState(false)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setError(null)
    try {
      const r = await api(`/api/agenda/finance?view=mileage&month=${month}`)
      if (id === reqId.current) setData(r)
    } catch (e) {
      if (id === reqId.current) setError(e)
    }
  }, [month])

  useFocusEffect(useCallback(() => { load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = data && data.month === month ? data : null
  // Último "De" usado vira sugestão (quase sempre "Casa")
  const lastFrom = shown?.trips?.find((t) => t.from_label)?.from_label || 'Casa'

  function openForm(values) {
    setFormErr({})
    setForm({ ...EMPTY_FORM, date: month === thisMonth ? todayKey() : `${month}-01`, from: lastFrom, ...values })
    requestAnimationFrame(() => scroller.current?.scrollTo?.({ y: 0, animated: true }))
  }

  function editTrip(t) {
    openForm({
      id: t.id, date: String(t.driven_on).slice(0, 10), miles: fmtMiles(t.miles), roundTrip: false,
      purpose: t.purpose || '', from: t.from_label || '', to: t.to_label || '', appointmentId: t.appointment_id || null,
    })
  }

  function fromSuggestion(s) {
    openForm({
      date: s.date,
      purpose: `Atendimento: ${s.client_name || 'cliente'}${s.service_name ? ` (${s.service_name})` : ''}`,
      to: s.place || s.client_name || '',
      roundTrip: true,
      appointmentId: s.appointment_id,
    })
  }

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setFormErr((e) => ({ ...e, [k]: null })) }
  const baseMiles = form ? parseMiles(form.miles) : null
  const totalMiles = baseMiles != null ? Math.round(baseMiles * (form.roundTrip ? 2 : 1) * 10) / 10 : null
  const rate = shown?.rate_cents ?? app.settings?.mileage_rate_cents ?? 70

  async function saveTrip() {
    const e = {}
    if (!DATE_RE.test(String(form.date || ''))) e.date = 'Data inválida. Use AAAA-MM-DD'
    else if (form.date > todayKey()) e.date = 'Registre só viagens que já aconteceram'
    if (totalMiles == null || totalMiles < 0.1) e.miles = 'Informe as milhas, ex.: 12,5'
    else if (totalMiles > 2000) e.miles = 'Máximo de 2.000 milhas por viagem'
    setFormErr(e)
    if (Object.keys(e).length) return

    setSaving('save')
    const body = {
      driven_on: form.date,
      miles: totalMiles,
      purpose: form.purpose.trim() || null,
      from_label: form.from.trim() || null,
      to_label: form.to.trim() || null,
    }
    try {
      if (form.id) await post('/api/agenda/finance', { action: 'mileage_update', id: form.id, ...body })
      else await post('/api/agenda/finance', { action: 'mileage_create', ...body, appointment_id: form.appointmentId })
      setForm(null)
      const m = form.date.slice(0, 7)
      if (m !== month) setMonth(m)
      else await load()
    } catch (err) {
      showError(err)
    } finally {
      setSaving(null)
    }
  }

  async function deleteTrip() {
    if (!(await confirm('Excluir esta viagem?', 'Ela sai do total de milhas e da dedução estimada.', { ok: 'Excluir', destructive: true }))) return
    setSaving('delete')
    try {
      await post('/api/agenda/finance', { action: 'mileage_delete', id: form.id })
      setForm(null)
      await load()
    } catch (err) {
      showError(err)
    } finally {
      setSaving(null)
    }
  }

  async function saveRate() {
    const raw = String(rateEdit || '').trim().replace(',', '.')
    let cents = Number(raw)
    if (!Number.isFinite(cents) || cents < 0) return showError(new Error('Digite os centavos por milha, ex.: 70'))
    if (cents > 0 && cents < 5) cents = Math.round(cents * 100)   // digitou em dólar (0,70)
    cents = Math.round(cents)
    if (cents > 500) return showError(new Error('Taxa muito alta. Confira o valor no site do IRS.'))
    setRateSaving(true)
    try {
      await app.saveSettings({ mileage_rate_cents: cents })
      setRateEdit(null)
      await load()
    } catch (err) {
      showError(err)
    } finally {
      setRateSaving(false)
    }
  }

  const sugs = shown?.suggestions || []
  const sugList = showAllSug ? sugs : sugs.slice(0, 4)

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
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
        {!shown && !error ? <Loading text="Carregando viagens…" /> : null}

        {form ? (
          <Card style={{ marginBottom: spacing.lg, borderColor: colors.green }}>
            <H3 style={{ marginBottom: spacing.md }}>{form.id ? 'Editar viagem' : 'Nova viagem'}</H3>
            <DateField label="Dia" value={form.date} onChange={set('date')} maximumDate={new Date()} />
            {formErr.date ? <Text style={st.err}>{formErr.date}</Text> : null}
            <Input label="Milhas" value={form.miles} onChangeText={set('miles')} keyboardType="decimal-pad" placeholder="Ex.: 12,5"
              error={formErr.miles} hint={!form.id ? 'Dica: o mapa do celular mostra a distância do trajeto.' : null} />
            {!form.id ? (
              <ToggleRow title="Ida e volta" subtitle="Dobra as milhas da ida" value={form.roundTrip} onValueChange={set('roundTrip')} />
            ) : null}
            {totalMiles ? (
              <Muted style={{ marginBottom: spacing.md, marginTop: form.id ? 0 : spacing.sm }}>
                Total: {fmtMiles(totalMiles)} milhas · dedução estimada {fmtMoney(Math.round(totalMiles * rate))}
              </Muted>
            ) : null}
            <Input label="Motivo" value={form.purpose} onChangeText={set('purpose')} maxLength={200}
              placeholder="Ex.: Atendimento na casa da cliente" hint="O IRS pede o motivo de cada viagem." />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Input label="De" value={form.from} onChangeText={set('from')} placeholder="Casa" maxLength={120} style={{ flex: 1 }} />
              <Input label="Para" value={form.to} onChangeText={set('to')} placeholder="Cliente, loja…" maxLength={120} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Cancelar" variant="secondary" onPress={() => setForm(null)} style={{ flex: 1 }} disabled={!!saving} />
              <Button title="Salvar" onPress={saveTrip} loading={saving === 'save'} disabled={!!saving} style={{ flex: 1 }} />
            </View>
            {form.id ? (
              <Button title="Excluir viagem" variant="ghost" small icon="trash-outline" onPress={deleteTrip} loading={saving === 'delete'}
                disabled={!!saving} style={{ marginTop: spacing.sm }} />
            ) : null}
          </Card>
        ) : null}

        {shown ? (
          <>
            <Card>
              <Label>Neste mês</Label>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                <Text style={type.kpi}>{fmtMiles(shown.total_miles)}</Text>
                <Muted>milhas</Muted>
              </View>
              <Muted>
                Dedução estimada {fmtMoney(shown.deduction_cents)} · {shown.trips.length} viage{shown.trips.length === 1 ? 'm' : 'ns'}
              </Muted>
              <Divider />
              <Small>
                No ano de {shown.year}: {fmtMiles(shown.year_miles)} milhas · dedução estimada{' '}
                <Text style={{ fontWeight: '700', color: colors.green }}>{fmtMoney(shown.year_deduction_cents)}</Text>
              </Small>

              {rateEdit == null ? (
                <Pressable onPress={() => setRateEdit(String(rate))} style={st.rateRow} accessibilityRole="button">
                  <Ionicons name="calculator-outline" size={16} color={colors.inkSoft} />
                  <Small style={{ flex: 1 }}>Taxa usada: {rate}¢ por milha</Small>
                  <Text style={{ color: colors.green, fontWeight: '600' }}>Editar</Text>
                </Pressable>
              ) : (
                <View style={{ marginTop: spacing.md }}>
                  <Input label="Centavos por milha" value={rateEdit} onChangeText={setRateEdit} keyboardType="decimal-pad" placeholder="70"
                    hint={`Taxa padrão do IRS de 2025: 70 centavos por milha. Confira a taxa de ${shown.year} no site do IRS.`} />
                  <Button title="Ver a taxa no site do IRS" variant="ghost" small icon="open-outline"
                    onPress={() => WebBrowser.openBrowserAsync(IRS_RATES_URL).catch(() => {})} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button title="Cancelar" variant="secondary" small onPress={() => setRateEdit(null)} style={{ flex: 1 }} />
                    <Button title="Salvar taxa" small onPress={saveRate} loading={rateSaving} style={{ flex: 1 }} />
                  </View>
                </View>
              )}
            </Card>

            {!form ? (
              <Button title="Registrar viagem" icon="add" onPress={() => openForm({})} style={{ marginTop: spacing.md }} />
            ) : null}

            {sugs.length ? (
              <Section title="Atendimentos sem viagem" right={<Small>{sugs.length}</Small>}>
                <Card padded={false}>
                  {sugList.map((s, i) => (
                    <View key={s.appointment_id}>
                      {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                      <Row
                        title={s.client_name || 'Cliente'}
                        subtitle={[fmtDay(s.date), s.service_name, s.place].filter(Boolean).join(' · ')}
                        right={<Button title="Registrar" small variant="secondary" full={false} onPress={() => fromSuggestion(s)} />}
                      />
                    </View>
                  ))}
                </Card>
                {sugs.length > 4 ? (
                  <Button title={showAllSug ? 'Mostrar menos' : `Ver todos (${sugs.length})`} variant="ghost" small onPress={() => setShowAllSug((v) => !v)} />
                ) : null}
                <Muted style={{ marginTop: spacing.xs, paddingHorizontal: 2 }}>Foi até a cliente? Registre com 1 toque: o motivo e o destino já vêm preenchidos.</Muted>
              </Section>
            ) : null}

            <Section title={`Viagens de ${monthName(month)}`}>
              {shown.trips.length ? (
                <Card padded={false}>
                  {shown.trips.map((t, i) => (
                    <View key={t.id}>
                      {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
                      <Row
                        icon="car-outline"
                        title={`${fmtMiles(t.miles)} mi · ${t.purpose || 'Viagem a trabalho'}`}
                        subtitle={[fmtDay(t.driven_on), t.from_label || t.to_label ? `${t.from_label || '—'} → ${t.to_label || '—'}` : null].filter(Boolean).join(' · ')}
                        right={<Small style={{ fontWeight: '600' }}>{fmtMoney(Math.round(t.miles * rate))}</Small>}
                        chevron
                        onPress={() => editTrip(t)}
                      />
                    </View>
                  ))}
                </Card>
              ) : (
                <Card>
                  <Empty icon="car-outline" title="Nenhuma viagem neste mês"
                    text="Cada milha rodada a trabalho diminui o imposto. Registre as idas até as clientes, compras de produtos e idas ao banco pelo negócio." />
                </Card>
              )}
            </Section>

            <View style={st.tip}>
              <Ionicons name="information-circle-outline" size={18} color={colors.green} />
              <Text style={{ flex: 1, color: colors.inkSoft, fontSize: 13, lineHeight: 18 }}>
                Conta como viagem a trabalho ir até a cliente, comprar material ou ir ao banco pelo negócio. O trajeto de casa até um local fixo de trabalho (o salão, por exemplo) normalmente não conta.
                Usando a dedução por milha, não deduza gasolina e manutenção do carro à parte. Estimativa; confirme com seu contador.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const st = StyleSheet.create({
  periodBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, minHeight: 44 },
  periodBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  err: { ...type.muted, color: colors.danger, marginTop: -spacing.sm, marginBottom: spacing.md },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  tip: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.greenSoft, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.xl },
})
