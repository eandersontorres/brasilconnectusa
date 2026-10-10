// Equipe (Premium): profissionais ou equipes de limpeza, cada um com sua cor na
// agenda, quantos atendimentos tem hoje e o link "rota do dia" (sem senha) pra mandar.
import { useCallback, useState } from 'react'
import { Platform, Share, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { choose, notify } from '../lib/dialog'
import { openWhatsApp } from '../lib/whatsapp'
import { dayRange, todayKey } from '../lib/format'
import { colors, spacing } from '../lib/theme'
import Locked from '../components/Locked'
import { Avatar, Badge, Banner, Button, Card, Divider, Empty, ErrorBox, Fab, KPI, Loading, Muted, Row, Screen, Section } from '../components/ui'

const BUSY = ['pending', 'confirmed', 'completed']

/** Texto que vai junto com o link da rota do dia. */
export function dayLinkMessage(member, provider) {
  const first = String(member?.name || '').trim().split(/\s+/)[0] || ''
  const what = provider?.vertical === 'cleaning' ? 'os endereços e as observações de cada casa' : 'os horários, endereços e observações de cada atendimento'
  return `Oi${first ? ' ' + first : ''}! Esta é sua rota do dia no AgendaPro, com ${what}. Abra no celular (não precisa de senha): ${member.day_link_url}`
}

/** Copiar, compartilhar, mandar no WhatsApp ou abrir o link da rota do dia. */
export async function shareDayLink(member, provider) {
  if (!member?.day_link_url) return
  const text = dayLinkMessage(member, provider)
  const options = [
    ...(member.whatsapp ? [{ label: `Mandar no WhatsApp de ${member.name}`, value: 'wa' }] : []),
    { label: 'Compartilhar…', value: 'share' },
    { label: 'Copiar link', value: 'copy' },
    { label: 'Abrir e conferir', value: 'open' },
  ]
  const pick = await choose(`Rota do dia · ${member.name}`, options, { message: 'Link sem senha com as paradas do dia, em ordem de horário.' })
  if (!pick) return
  try {
    if (pick === 'wa') {
      await openWhatsApp(member.whatsapp, text)
    } else if (pick === 'share') {
      if (Platform.OS === 'web' && !(typeof navigator !== 'undefined' && navigator.share)) {
        await Clipboard.setStringAsync(text)
        notify('Mensagem copiada', 'Cole no aplicativo que preferir.')
      } else {
        await Share.share({ message: text })
      }
    } else if (pick === 'copy') {
      await Clipboard.setStringAsync(member.day_link_url)
      notify('Link copiado', 'Cole no WhatsApp ou na mensagem pra equipe.')
    } else if (pick === 'open') {
      if (Platform.OS === 'web') window.open(member.day_link_url, '_blank')
      else await WebBrowser.openBrowserAsync(member.day_link_url)
    }
  } catch (_) {
    notify('Não deu certo', 'Tente copiar o link e mandar manualmente.')
  }
}

function roleLine(m) {
  if (m.role === 'equipe') {
    const names = (m.members || []).filter(Boolean)
    return names.length ? `Equipe · ${names.join(', ')}` : 'Equipe de limpeza'
  }
  return 'Profissional'
}

function Team() {
  const app = useApp()
  const [data, setData] = useState(null)        // { staff, limit, active_count, can_day_link }
  const [counts, setCounts] = useState(null)    // { [staff_id|'none']: n } de hoje
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true)
    try {
      const [from, to] = dayRange(todayKey())
      const [s, a] = await Promise.all([
        api('/api/agenda/staff'),
        // Contagem de hoje: se falhar, a lista aparece sem os números
        api(`/api/agenda/appointments?scope=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).catch(() => null),
      ])
      setData(s)
      if (a && Array.isArray(a.appointments)) {
        const c = {}
        for (const apt of a.appointments) {
          if (!BUSY.includes(apt.status)) continue
          const k = apt.staff_id || 'none'
          c[k] = (c[k] || 0) + 1
        }
        setCounts(c)
      } else setCounts(null)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      if (pull) setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const staff = data?.staff || []
  const active = staff.filter((m) => m.active)
  const inactive = staff.filter((m) => !m.active)
  const limit = data ? data.limit : app.limit('staff')
  const atLimit = limit != null && active.length >= limit
  const canLink = app.can('team_day_link')
  const todayTotal = counts ? Object.values(counts).reduce((n, v) => n + v, 0) : null
  const unassigned = counts?.none || 0

  async function add() {
    if (!(await ensureFeature(app, 'team'))) return
    if (atLimit) {
      notify('Limite do plano', `Seu plano permite até ${limit} pessoas ativas. Desative alguém que não está trabalhando pra cadastrar outra.`)
      return
    }
    router.push('/team-edit')
  }

  async function share(m) {
    if (!(await ensureFeature(app, 'team_day_link'))) return
    let member = m
    if (!member.day_link_url) {
      // Cadastro antigo sem link: gera um na hora
      try {
        const r = await post('/api/agenda/staff', { action: 'rotate_token', id: m.id })
        member = r.staff
        load()
      } catch (e) {
        showError(e)
        return
      }
    }
    await shareDayLink(member, app.provider)
  }

  const open = (m) => router.push({ pathname: '/team-edit', params: { id: m.id } })

  if (!data && !error) return <Screen><Loading text="Carregando equipe…" /></Screen>

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={() => load(true)} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => load()} />

        {data && staff.length === 0 ? (
          <Empty icon="people-circle-outline" title="Monte sua equipe"
            text={app.provider?.vertical === 'cleaning'
              ? 'Cadastre cada equipe de limpeza com uma cor. Na agenda você vê quem vai em cada casa, e cada equipe recebe um link com a rota do dia, sem precisar de senha.'
              : 'Cadastre cada profissional com uma cor. Na agenda você vê quem atende cada horário, e cada um recebe um link com a agenda do dia, sem precisar de senha.'}
            action={<Button title="Adicionar a primeira pessoa" icon="person-add-outline" onPress={add} />} />
        ) : null}

        {staff.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <KPI label="Ativos" value={limit != null ? `${active.length} de ${limit}` : String(active.length)} sub="no seu plano" />
            <KPI label="Hoje" value={todayTotal == null ? '—' : String(todayTotal)} sub={todayTotal === 1 ? 'atendimento' : 'atendimentos'} tone="green" />
          </View>
        ) : null}

        {unassigned > 0 && active.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Banner tone="orange" icon="alert-circle-outline"
              text={`${unassigned} ${unassigned === 1 ? 'atendimento de hoje está' : 'atendimentos de hoje estão'} sem ninguém da equipe.`}
              action="Ver" onPress={() => router.push('/agenda')} />
          </View>
        ) : null}

        {active.length > 0 ? (
          <Section title="Na agenda">
            {active.map((m) => {
              const n = counts ? (counts[m.id] || 0) : null
              return (
                <Card key={m.id} padded={false} style={{ marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: m.color || colors.green }}>
                  <Row
                    left={<Avatar name={m.name} size={42} color={m.color || colors.green} />}
                    title={m.name}
                    subtitle={roleLine(m)}
                    right={n == null ? null : <Badge text={n ? `${n} hoje` : 'Livre hoje'} tone={n ? 'green' : 'gray'} />}
                    chevron
                    onPress={() => open(m)}
                  />
                  <Divider style={{ marginVertical: 0 }} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }}>
                    <Button small full={false} variant="secondary" icon={canLink ? 'navigate-outline' : 'lock-closed-outline'}
                      title="Rota do dia" onPress={() => share(m)} style={{ flex: 1 }} />
                    {m.whatsapp ? (
                      <Button small full={false} variant="whatsapp" icon="logo-whatsapp" title="Conversar"
                        onPress={() => openWhatsApp(m.whatsapp, '')} style={{ flex: 1 }} />
                    ) : null}
                  </View>
                </Card>
              )
            })}
          </Section>
        ) : null}

        {inactive.length > 0 ? (
          <Section title={`Desativados (${inactive.length})`}>
            <Muted style={{ marginBottom: spacing.sm }}>Não aparecem pra escolher na agenda. O histórico continua.</Muted>
            <Card padded={false}>
              {inactive.map((m, i) => (
                <View key={m.id} style={{ opacity: 0.7 }}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 70 }} /> : null}
                  <Row left={<Avatar name={m.name} size={38} color={colors.inkMuted} />} title={m.name} subtitle={roleLine(m)}
                    right={<Badge text="Desativado" tone="gray" />} chevron onPress={() => open(m)} />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {staff.length > 0 ? (
          <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>
            {canLink
              ? 'Cada pessoa tem um link próprio. Gerou um link novo? O antigo para de funcionar.'
              : 'A rota do dia por link faz parte do plano Premium.'}
          </Muted>
        ) : null}
      </Screen>
      {staff.length > 0 ? <Fab icon="person-add" label="Adicionar pessoa na equipe" onPress={add} /> : null}
    </View>
  )
}

export default function TeamRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Equipe' }} />
      <Locked feature="team"><Team /></Locked>
    </>
  )
}
