// Clientes fixas (recorrência, plano Pro): regras agrupadas por dia da semana,
// próxima data, pular a próxima, pausar e retomar. A agenda se preenche sozinha
// pelas próximas 6 semanas (servidor: api/agenda/recurring + cron diário).
import { useCallback, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { WEEKDAYS_LONG, fmtDay, fmtDuration, fmtMoney, fmtRelativeDay } from '../../lib/format'
import { colors, spacing, type } from '../../lib/theme'
import Locked from '../../components/Locked'
import { Badge, Button, Card, Divider, Empty, ErrorBox, Fab, Input, KPI, Loading, Muted, P, Row, Screen, Section } from '../../components/ui'

export const FREQ_LABEL = { weekly: 'Semanal', biweekly: 'Quinzenal', every3weeks: 'A cada 3 semanas', every4weeks: 'A cada 4 semanas' }
const FREQ_WEEKS = { weekly: 1, biweekly: 2, every3weeks: 3, every4weeks: 4 }
// Semana de trabalho começando na segunda
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Quanto a regra rende por mês, em média (52 semanas / 12 meses). */
const monthlyCents = (r) => Math.round(((Number(r.price_cents) || 0) * 52) / 12 / (FREQ_WEEKS[r.frequency] || 1))

/** Conflitos que o servidor achou depois de salvar/retomar. */
export function conflictText(conflicts) {
  const list = (conflicts || []).slice(0, 4).map((c) => `• ${fmtDay(c.date)} às ${c.time} (${c.client_name || 'outro horário'})`)
  const more = (conflicts || []).length > 4 ? `\n…e mais ${conflicts.length - 4}` : ''
  return `Essas datas batem com outro horário na agenda:\n${list.join('\n')}${more}\n\nAjuste na agenda quem atende ou o horário.`
}

function RuleCard({ r, busy, onOpen, onSkip, onPause, onResume }) {
  const next = r.next_dates?.[0]
  const paused = !r.active
  return (
    <Card padded={false} style={{ marginBottom: spacing.md, opacity: paused ? 0.8 : 1 }}>
      <Row
        onPress={onOpen}
        chevron
        left={
          <View style={{ width: 58, alignItems: 'center' }}>
            <Text style={[type.h3, { color: paused ? colors.inkMuted : colors.green }]}>{r.start_time}</Text>
            <Muted style={{ fontSize: 12 }}>{fmtDuration(r.duration_min)}</Muted>
          </View>
        }
        title={r.client_name}
        subtitle={
          <View style={{ marginTop: 2 }}>
            <Muted numberOfLines={1}>{[FREQ_LABEL[r.frequency], r.service_name, fmtMoney(r.price_cents)].filter(Boolean).join(' · ')}</Muted>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {paused ? <Badge text="Pausada" tone="gray" icon="pause" />
                : r.ended ? <Badge text="Terminou" tone="gray" />
                : next ? <Badge text={`Próxima: ${fmtRelativeDay(next)}`} tone="green" icon="calendar-outline" />
                : <Badge text="Sem data nas próximas semanas" tone="orange" />}
              {r.staff_name ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.staff_color || colors.green }} />
                  <Muted numberOfLines={1}>{r.staff_name}{r.staff_active === false ? ' (desativada)' : ''}</Muted>
                </View>
              ) : null}
            </View>
          </View>
        }
      />
      <Divider style={{ marginVertical: 0 }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }}>
        {paused ? (
          <Button small title="Retomar" icon="play" onPress={onResume} loading={busy} style={{ flex: 1 }} />
        ) : (
          <>
            <Button small variant="secondary" title="Pular a próxima" icon="play-skip-forward-outline" onPress={onSkip} disabled={!next || busy} style={{ flex: 1 }} />
            <Button small variant="secondary" title="Pausar" icon="pause-outline" onPress={onPause} loading={busy} style={{ flex: 1 }} />
          </>
        )}
      </View>
    </Card>
  )
}

function Recurring() {
  const app = useApp()
  const [data, setData] = useState(null)       // { rules, limit, can_team }
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const r = await api('/api/agenda/recurring')
      setData(r)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const rules = data?.rules || []
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rules.filter((r) => String(r.client_name || '').toLowerCase().includes(s) || String(r.staff_name || '').toLowerCase().includes(s)) : rules
  }, [rules, q])
  const running = filtered.filter((r) => r.active && !r.ended)
  const stopped = filtered.filter((r) => !r.active || r.ended)
  const byDay = DAY_ORDER.map((d) => ({ d, list: running.filter((r) => r.day_of_week === d) })).filter((g) => g.list.length)
  const activeAll = rules.filter((r) => r.active && !r.ended)
  const perMonth = activeAll.reduce((n, r) => n + monthlyCents(r), 0)

  const replace = (rule) => { if (rule) setData((cur) => ({ ...(cur || {}), rules: (cur?.rules || []).map((x) => (x.id === rule.id ? rule : x)) })) }

  async function add() {
    if (!(await ensureFeature(app, 'recurring'))) return
    router.push('/recurring/edit')
  }

  async function skipNext(r) {
    const next = r.next_dates?.[0]
    if (!next) return
    const ok = await confirm(`Pular ${fmtDay(next)}?`, `${r.client_name} não vem nesse dia. As outras datas continuam iguais.`, { ok: 'Pular' })
    if (!ok) return
    setBusyId(r.id)
    try {
      const res = await post('/api/agenda/recurring', { action: 'skip', id: r.id, date: next })
      replace(res.rule)
      if (res.kept) notify('O horário ficou na agenda', 'Esse dia já tem pagamento registrado. Se ela não vier mesmo, cancele o agendamento pela agenda.')
    } catch (e) {
      showError(e)
    } finally {
      setBusyId(null)
    }
  }

  async function pause(r) {
    const ok = await confirm(`Pausar ${r.client_name}?`, 'Os próximos horários saem da agenda até você retomar. Quando voltar, a frequência continua no mesmo ritmo.', { ok: 'Pausar' })
    if (!ok) return
    setBusyId(r.id)
    try {
      const res = await post('/api/agenda/recurring', { action: 'pause', id: r.id })
      replace(res.rule)
      if (res.kept) notify('Atenção', `${res.kept} ${res.kept === 1 ? 'horário com pagamento ficou' : 'horários com pagamento ficaram'} na agenda.`)
    } catch (e) {
      showError(e)
    } finally {
      setBusyId(null)
    }
  }

  async function resume(r) {
    if (!(await ensureFeature(app, 'recurring'))) return
    setBusyId(r.id)
    try {
      const res = await post('/api/agenda/recurring', { action: 'resume', id: r.id })
      replace(res.rule)
      if (res.conflicts?.length) notify('Voltou pra agenda, mas atenção', conflictText(res.conflicts))
      else if (res.warning) notify('Voltou, com um aviso', res.warning)
    } catch (e) {
      showError(e)
    } finally {
      setBusyId(null)
    }
  }

  const open = (r) => router.push({ pathname: '/recurring/edit', params: { id: r.id } })
  const card = (r) => (
    <RuleCard key={r.id} r={r} busy={busyId === r.id} onOpen={() => open(r)}
      onSkip={() => skipNext(r)} onPause={() => pause(r)} onResume={() => resume(r)} />
  )

  if (!data && !error) return <Screen><Loading text="Carregando clientes fixas…" /></Screen>

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={() => load(true)} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => load()} />

        {data && rules.length === 0 ? (
          <Empty icon="repeat-outline" title="Sua agenda se preenche sozinha"
            text={app.provider?.vertical === 'cleaning'
              ? 'Casa que você limpa toda semana, a cada 15 dias ou uma vez por mês? Cadastre uma vez e os horários das próximas 6 semanas aparecem na agenda.'
              : 'Cliente que vem toda semana ou a cada 15 dias? Cadastre uma vez e os horários das próximas 6 semanas aparecem na agenda.'}
            action={<Button title="Cadastrar cliente fixa" icon="add" onPress={add} />} />
        ) : null}

        {rules.length > 0 ? (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <KPI label="Clientes fixas" value={String(activeAll.length)} sub={rules.length > activeAll.length ? `${rules.length - activeAll.length} pausada(s)` : 'ativas'} />
              <KPI label="Por mês" value={fmtMoney(perMonth)} sub="média da renda fixa" tone="green" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md }}>
              <Ionicons name="sparkles-outline" size={14} color={colors.inkMuted} />
              <Muted style={{ flex: 1 }}>Os horários das próximas 6 semanas já estão na agenda. Dia de folga cadastrado fica de fora.</Muted>
            </View>
            {rules.length > 8 ? (
              <Input value={q} onChangeText={setQ} placeholder="Buscar cliente ou equipe" autoCapitalize="none" autoCorrect={false}
                style={{ marginTop: spacing.md, marginBottom: 0 }} clearButtonMode="while-editing" />
            ) : null}
          </>
        ) : null}

        {byDay.map((g) => (
          <Section key={g.d} title={`${WEEKDAYS_LONG[g.d]} (${g.list.length})`}>
            {g.list.map(card)}
          </Section>
        ))}

        {stopped.length > 0 ? (
          <Section title={`Pausadas e encerradas (${stopped.length})`}>
            {stopped.map(card)}
          </Section>
        ) : null}

        {rules.length > 0 && q && !filtered.length ? (
          <P style={{ textAlign: 'center', marginTop: spacing.xl, color: colors.inkSoft }}>Ninguém com “{q}”.</P>
        ) : null}
      </Screen>
      {rules.length > 0 ? <Fab label="Cadastrar cliente fixa" onPress={add} /> : null}
    </View>
  )
}

export default function RecurringRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Clientes fixas' }} />
      <Locked feature="recurring"><Recurring /></Locked>
    </>
  )
}
