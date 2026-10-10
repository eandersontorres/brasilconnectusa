// Configurações: notificações, calendário do celular, Face ID, idioma das mensagens,
// semana, tipo de negócio e fuso, conta (senha, sair), excluir conta e "sobre".
// Preferências da conta vão pro servidor (saveSettings → app_settings); permissões,
// Face ID e calendário são do aparelho e ficam aqui mesmo.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, Platform, View } from 'react-native'
import { router, Stack } from 'expo-router'
import Constants from 'expo-constants'
import * as WebBrowser from 'expo-web-browser'
import { useApp } from '../lib/session'
import { post } from '../lib/api'
import { supabase } from '../lib/supabase'
import { ensureFeature, featureInfo, showError } from '../lib/gate'
import { choose, confirm, notify } from '../lib/dialog'
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '../lib/config'
import { LANGS } from '../lib/whatsapp'
import { fmtAgo } from '../lib/format'
import { pushPermission, registerForPush, lastPushError, unregisterPush } from '../lib/push'
import { calendarAvailable, calendarError, calendarPermission, clearCalendar, lastCalendarSync, requestCalendarAccess, syncFromServer } from '../lib/calendar'
import { authenticateDetailed, biometricAvailable, biometricLabel, isLockEnabled, setLockEnabled } from '../lib/biometric'
import { colors, spacing } from '../lib/theme'
import { Badge, Button, Card, Divider, Input, Loading, Muted, P, Row, Screen, Section, Segmented, ToggleRow } from '../components/ui'

const isWeb = Platform.OS === 'web'

// Preferências da conta e o valor quando nunca foram salvas (mesmo padrão do servidor)
const DEFAULTS = {
  notify_new_booking: true,
  notify_cancellation: true,
  notify_review: true,
  notify_daily_summary: false,
  calendar_sync: false,
  week_starts_monday: false,
  default_language: 'pt',
}

const TIMEZONES = [
  { value: 'America/New_York', label: 'Leste (Nova York, Boston, Miami)' },
  { value: 'America/Chicago', label: 'Central (Chicago, Houston, Dallas)' },
  { value: 'America/Denver', label: 'Montanha (Denver, Salt Lake City)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacífico (Los Angeles, Seattle)' },
  { value: 'America/Anchorage', label: 'Alasca' },
  { value: 'Pacific/Honolulu', label: 'Havaí' },
]

const VERTICALS = [
  { value: 'services', label: 'Beleza e serviços' },
  { value: 'cleaning', label: 'Limpeza' },
]

const LANG_SHORT = { pt: 'Português', en: 'English', es: 'Español' }

const tzLabel = (tz) => TIMEZONES.find((t) => t.value === tz)?.label || tz || 'Leste (Nova York)'

function deviceTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch (_) { return null }
}

const openUrl = (url) => WebBrowser.openBrowserAsync(url, { controlsColor: colors.green, dismissButtonStyle: 'close' }).catch(() => Linking.openURL(url))
const openDeviceSettings = () => Linking.openSettings().catch(() => {})

// Erro do Supabase na troca de senha → texto pra profissional
function passwordError(e) {
  const m = String(e?.message || '').toLowerCase()
  if (m.includes('different')) return 'A nova senha precisa ser diferente da atual.'
  if (m.includes('reauth') || m.includes('recent') || m.includes('nonce')) return 'Por segurança, saia e entre de novo na conta antes de trocar a senha.'
  if (m.includes('weak') || m.includes('characters') || m.includes('least')) return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'
  if (m.includes('network') || m.includes('fetch')) return 'Sem conexão. Confira a internet e tente de novo.'
  return e?.message || 'Não deu pra trocar a senha agora.'
}

export default function Settings() {
  const app = useApp()
  const { provider, settings, user, ent, hasLoadedMe, saveSettings, setProvider, refresh, signOut } = app

  const [refreshing, setRefreshing] = useState(false)
  const [local, setLocal] = useState({})          // mudanças otimistas ainda salvando
  const [saving, setSaving] = useState(null)      // chave sendo salva

  // Estado do aparelho
  const [pushPerm, setPushPerm] = useState(isWeb ? 'unavailable' : 'undetermined')
  const [pushBusy, setPushBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [calPerm, setCalPerm] = useState('undetermined')
  const [calBusy, setCalBusy] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [bioAvail, setBioAvail] = useState(false)
  const [bioLabel, setBioLabel] = useState('Face ID')
  const [bioOn, setBioOn] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)

  // Conta
  const [pwOpen, setPwOpen] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwErr, setPwErr] = useState(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [bizBusy, setBizBusy] = useState(false)

  // Exclusão
  const [delOpen, setDelOpen] = useState(false)
  const [delText, setDelText] = useState('')
  // Ligado por padrão: pra Apple, excluir a conta inclui apagar o login
  const [delLogin, setDelLogin] = useState(true)
  const [delBusy, setDelBusy] = useState(false)

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const value = (key) => (key in local ? local[key] : settings?.[key] ?? DEFAULTS[key])

  const loadDevice = useCallback(async () => {
    if (isWeb) return
    const [pp, cp, ba, bl, bo, ls] = await Promise.all([
      pushPermission(), calendarPermission(), biometricAvailable(), biometricLabel(), isLockEnabled(), lastCalendarSync(),
    ])
    if (!alive.current) return
    setPushPerm(pp); setCalPerm(cp); setBioAvail(ba); setBioLabel(bl); setBioOn(bo); setLastSync(ls)
  }, [])

  useEffect(() => { loadDevice() }, [loadDevice])

  // Voltou dos Ajustes do celular (liberou notificação/calendário): relê as permissões
  useEffect(() => {
    if (isWeb) return
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') loadDevice() })
    return () => sub.remove()
  }, [loadDevice])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await Promise.all([refresh({ silent: true }), loadDevice()]) } finally { if (alive.current) setRefreshing(false) }
  }, [refresh, loadDevice])

  /** Salva uma preferência da conta com resposta imediata na tela. */
  async function save(key, v) {
    setLocal((cur) => ({ ...cur, [key]: v }))
    setSaving(key)
    try {
      await saveSettings({ [key]: v })
    } catch (e) {
      showError(e, 'Não salvou')
    } finally {
      if (alive.current) {
        setLocal((cur) => { const n = { ...cur }; delete n[key]; return n })
        setSaving(null)
      }
    }
  }

  // ── Notificações ────────────────────────────────────────────────────────
  async function enablePush() {
    if (!(await ensureFeature(app, 'push_notifications'))) return
    setPushBusy(true)
    try {
      const token = await registerForPush()
      const pp = await pushPermission()
      setPushPerm(pp)
      if (token) { notify('Pronto!', 'Você vai receber aviso aqui no celular quando chegar agendamento novo.'); return }
      const why = lastPushError()
      if (why === 'denied') {
        if (await confirm('Notificações bloqueadas', 'Pra receber os avisos, libere as notificações do AgendaPro nos Ajustes do celular.', { ok: 'Abrir Ajustes', cancel: 'Agora não' })) openDeviceSettings()
      } else if (why === 'no_project') {
        notify('Ainda não disponível', 'As notificações chegam na versão do app baixada da loja. Atualize o app e tente de novo.')
      } else {
        notify('Não deu certo', 'Não conseguimos ligar as notificações agora. Confira a internet e tente de novo.')
      }
    } finally {
      if (alive.current) setPushBusy(false)
    }
  }

  async function sendTest() {
    setTestBusy(true)
    try {
      await registerForPush({ ask: false })   // garante o token deste celular no servidor
      const r = await post('/api/agenda/push-token', { action: 'test' })
      if (r.sent > 0) notify('Aviso enviado', 'Deve chegar em alguns segundos.')
      else notify('Nenhum celular recebeu', 'Confira se as notificações estão ligadas e tente de novo em instantes.')
    } catch (e) {
      showError(e, 'Não enviou o teste')
    } finally {
      if (alive.current) setTestBusy(false)
    }
  }

  function toggleNotify(key, v) {
    if (!app.can('push_notifications')) { ensureFeature(app, 'push_notifications'); return }
    save(key, v)
  }

  // ── Calendário ──────────────────────────────────────────────────────────
  async function syncNow({ silent = false } = {}) {
    setCalBusy(true)
    try {
      const r = await syncFromServer(provider)
      // O erro vem no resultado (calendarError() pode ter mudado com outro sync rodando junto)
      const err = r && 'error' in r ? r.error : calendarError()
      setLastSync(await lastCalendarSync())
      setCalPerm(await calendarPermission())
      if (err === 'permission') {
        if (await confirm('Sem acesso ao calendário', 'Libere o AgendaPro nos Ajustes do celular (Privacidade → Calendários).', { ok: 'Abrir Ajustes', cancel: 'Agora não' })) openDeviceSettings()
        return
      }
      if (err) {
        if (!silent) notify('Não sincronizou', 'Não conseguimos acessar o calendário do celular agora. Tente de novo.')
        return
      }
      if (!silent) {
        const parts = [`${r.added} ${r.added === 1 ? 'novo' : 'novos'}`, `${r.updated} ${r.updated === 1 ? 'atualizado' : 'atualizados'}`]
        if (r.removed) parts.push(`${r.removed} ${r.removed === 1 ? 'removido' : 'removidos'}`)
        notify('Calendário em dia', `Próximos 60 dias no calendário "AgendaPro": ${parts.join(', ')}.${r.failed ? ` ${r.failed} não entraram; tente de novo.` : ''}`)
      }
    } catch (e) {
      showError(e, 'Não sincronizou')
    } finally {
      if (alive.current) setCalBusy(false)
    }
  }

  async function toggleCalendar(v) {
    if (v) {
      if (!(await ensureFeature(app, 'calendar_sync'))) return
      const ok = await requestCalendarAccess()
      setCalPerm(await calendarPermission())
      if (!ok) {
        if (await confirm('Sem acesso ao calendário', 'Pra mandar seus agendamentos pro calendário, libere o AgendaPro nos Ajustes do celular.', { ok: 'Abrir Ajustes', cancel: 'Agora não' })) openDeviceSettings()
        return
      }
      await save('calendar_sync', true)
      await syncNow()
      return
    }
    await save('calendar_sync', false)
    const wipe = await confirm('Tirar do calendário do celular?', 'Apagamos os eventos do calendário "AgendaPro" deste celular. Seus agendamentos continuam no app.', { ok: 'Apagar eventos', cancel: 'Deixar lá' })
    if (wipe) { await clearCalendar(); setLastSync(null) }
  }

  // ── Face ID ─────────────────────────────────────────────────────────────
  async function toggleBio(v) {
    setBioBusy(true)
    try {
      if (v) {
        const r = await authenticateDetailed(`Confirme para ligar o ${bioLabel}`)
        if (!r.success) {
          if (r.error && !['user_cancel', 'system_cancel', 'app_cancel'].includes(r.error)) notify('Não ligou', `Não conseguimos confirmar com ${bioLabel}. Tente de novo.`)
          return
        }
        await setLockEnabled(true)
        setBioOn(true)
      } else {
        await setLockEnabled(false)
        setBioOn(false)
      }
    } finally {
      if (alive.current) setBioBusy(false)
    }
  }

  // ── Mensagens e agenda ──────────────────────────────────────────────────
  async function pickLanguage(lang) {
    if (lang === value('default_language')) return
    if (lang !== 'pt' && !(await ensureFeature(app, 'multilang_messages'))) return
    save('default_language', lang)
  }

  // ── Negócio ─────────────────────────────────────────────────────────────
  async function saveBusiness(patch, okMsg) {
    setBizBusy(true)
    try {
      const r = await post('/api/agenda/me', { action: 'vertical', ...patch })
      if (r?.provider) setProvider(r.provider)
      if (okMsg) notify('Salvo', okMsg)
    } catch (e) {
      showError(e, 'Não salvou')
    } finally {
      if (alive.current) setBizBusy(false)
    }
  }

  async function pickVertical(v) {
    if (v === (provider?.vertical || 'services')) return
    saveBusiness({ vertical: v })
  }

  async function pickTimezone() {
    const dev = deviceTz()
    const options = TIMEZONES.map((t) => ({ label: t.value === provider?.timezone ? `${t.label} (atual)` : t.label, value: t.value }))
    const tz = await choose('Fuso horário', options, {
      message: dev ? `Seu celular está no fuso ${tzLabel(dev)}.` : 'O fuso da cidade onde você atende.',
    })
    if (!tz || tz === provider?.timezone) return
    saveBusiness({ timezone: tz }, 'Fuso atualizado. Os horários da agenda continuam os mesmos.')
  }

  // ── Conta ───────────────────────────────────────────────────────────────
  async function changePassword() {
    setPwErr(null)
    if (pw1.length < 8) { setPwErr('Use pelo menos 8 caracteres.'); return }
    if (pw1 !== pw2) { setPwErr('As duas senhas não estão iguais.'); return }
    setPwBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 })
      if (error) { setPwErr(passwordError(error)); return }
      setPw1(''); setPw2(''); setPwOpen(false)
      notify('Senha trocada', 'Use a nova senha da próxima vez que entrar.')
    } catch (e) {
      setPwErr(passwordError(e))
    } finally {
      if (alive.current) setPwBusy(false)
    }
  }

  async function logout() {
    if (!(await confirm('Sair da conta?', 'Seus dados continuam salvos. É só entrar de novo.', { ok: 'Sair', destructive: true }))) return
    await unregisterPush()          // antes do signOut: precisa do login pra avisar o servidor
    await signOut()
    router.replace('/login')
  }

  // ── Exclusão de conta ───────────────────────────────────────────────────
  async function startDelete() {
    const ok = await confirm(
      'Excluir sua conta?',
      'Vamos apagar para sempre seu perfil, sua página, agenda, clientes, serviços, finanças e avaliações. Não dá pra desfazer.',
      { ok: 'Continuar', cancel: 'Cancelar', destructive: true },
    )
    if (ok) { setDelText(''); setDelLogin(true); setDelOpen(true) }
  }

  async function confirmDelete() {
    if (delText.trim().toUpperCase() !== 'EXCLUIR') return
    const ok = await confirm(
      'Última confirmação',
      (provider?.has_subscription
        ? 'Sua assinatura será cancelada agora e todos os dados do AgendaPro serão apagados.'
        : 'Todos os dados do AgendaPro serão apagados.')
        + (delLogin ? ' Seu login e sua conta do site BrasilConnect também.' : '') + ' Tem certeza?',
      { ok: 'Excluir para sempre', cancel: 'Voltar', destructive: true },
    )
    if (!ok) return
    setDelBusy(true)
    try {
      const r = await post('/api/agenda/me', { action: 'delete_account', confirm: 'EXCLUIR', also_login: delLogin })
      // Limpa o que fica no aparelho (calendário, Face ID, token de notificação)
      await clearCalendar().catch(() => {})
      await setLockEnabled(false).catch(() => {})
      await unregisterPush().catch(() => {})
      await signOut().catch(() => {})
      router.replace('/login')
      notify(
        'Conta excluída',
        delLogin && !r?.login_deleted
          ? `Apagamos seus dados do AgendaPro, mas o login não saiu agora. Escreva para ${SUPPORT_EMAIL} que a gente apaga.`
          : delLogin
            ? 'Seus dados e seu login BrasilConnect foram apagados. Obrigada por ter usado o AgendaPro.'
            : 'Seus dados foram apagados. Obrigada por ter usado o AgendaPro.',
      )
    } catch (e) {
      showError(e, 'Não excluiu')
    } finally {
      if (alive.current) setDelBusy(false)
    }
  }

  if (!hasLoadedMe || !provider) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Configurações' }} />
        <Loading />
      </Screen>
    )
  }

  const canPush = app.can('push_notifications')
  const canCal = app.can('calendar_sync')
  const calOn = !!value('calendar_sync')
  const lang = value('default_language')
  const version = Constants.expoConfig?.version || '1.0.0'
  const build = Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode
  const planLine = ent.trial ? `Teste grátis · ${ent.trial_days_left} dia${ent.trial_days_left === 1 ? '' : 's'}`
    : ent.tier === 'none' ? 'Plano inativo'
    : `Plano ${ent.catalog?.plans?.[ent.tier]?.name || ent.tier}`
  const lockBadge = (feature) => <Badge text={featureInfo(ent, feature).minName} tone="gold" icon="lock-closed" />
  const devTz = deviceTz()

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Configurações' }} />

      {/* ── Notificações ─────────────────────────────────────────────── */}
      <Section title="Notificações" style={{ marginTop: 0 }}>
        <Card padded={false}>
          {isWeb || pushPerm === 'unavailable' ? (
            <Row icon="notifications-outline" title="Avisos no celular" subtitle="As notificações funcionam no app instalado no iPhone ou Android." />
          ) : !canPush ? (
            <Row icon="notifications-outline" title="Avisos no celular" subtitle={featureInfo(ent, 'push_notifications').desc}
              right={lockBadge('push_notifications')} onPress={() => ensureFeature(app, 'push_notifications')} />
          ) : pushPerm === 'granted' ? (
            <Row icon="notifications" title="Notificações ligadas" subtitle="Este celular recebe os avisos do AgendaPro."
              right={<Badge text="Ligado" tone="green" />} />
          ) : (
            <View style={{ padding: spacing.lg }}>
              <P style={{ fontWeight: '600' }}>{pushPerm === 'denied' ? 'Notificações bloqueadas' : 'Saiba na hora quando chegar agendamento'}</P>
              <Muted style={{ marginTop: 4 }}>
                {pushPerm === 'denied'
                  ? 'Libere as notificações do AgendaPro nos Ajustes do celular.'
                  : 'Ligue as notificações pra receber aviso de agendamento novo, cancelamento e avaliação.'}
              </Muted>
              <Button title={pushPerm === 'denied' ? 'Abrir Ajustes' : 'Ativar notificações'} icon="notifications-outline" small
                onPress={pushPerm === 'denied' ? openDeviceSettings : enablePush} loading={pushBusy} style={{ marginTop: spacing.md }} />
            </View>
          )}
          <Divider style={{ marginVertical: 0 }} />
          <ToggleRow title="Agendamento novo" subtitle="Quando alguém agendar pela sua página"
            value={value('notify_new_booking')} onValueChange={(v) => toggleNotify('notify_new_booking', v)} disabled={saving === 'notify_new_booking'} />
          <ToggleRow title="Cancelamento" subtitle="Quando um horário for cancelado"
            value={value('notify_cancellation')} onValueChange={(v) => toggleNotify('notify_cancellation', v)} disabled={saving === 'notify_cancellation'} />
          <ToggleRow title="Avaliação nova" subtitle={app.can('reviews') ? 'Quando uma cliente deixar avaliação' : 'Quando uma cliente deixar avaliação (avaliações são do plano Pro)'}
            value={value('notify_review')} onValueChange={(v) => toggleNotify('notify_review', v)} disabled={saving === 'notify_review'} />
          <ToggleRow title="Resumo de amanhã" subtitle="Todo dia à tarde: quantos atendimentos você tem amanhã, o primeiro horário e quem faz aniversário"
            value={value('notify_daily_summary')} onValueChange={(v) => toggleNotify('notify_daily_summary', v)} disabled={saving === 'notify_daily_summary'} />
          {canPush && pushPerm === 'granted' ? (
            <>
              <Divider style={{ marginVertical: 0 }} />
              <Row icon="paper-plane-outline" title="Mandar um aviso de teste" onPress={testBusy ? undefined : sendTest}
                right={testBusy ? <Loading style={{ padding: 0 }} /> : null} chevron={!testBusy} />
            </>
          ) : null}
        </Card>
      </Section>

      {/* ── Calendário ───────────────────────────────────────────────── */}
      <Section title="Calendário do celular">
        <Card padded={false}>
          {!calendarAvailable() ? (
            <Row icon="calendar-outline" title="Calendário do celular" subtitle="Disponível no app instalado no iPhone ou Android." />
          ) : !canCal ? (
            <Row icon="calendar-outline" title="Mandar pro calendário do celular" subtitle={featureInfo(ent, 'calendar_sync').desc}
              right={lockBadge('calendar_sync')} onPress={() => ensureFeature(app, 'calendar_sync')} />
          ) : (
            <>
              <ToggleRow title="Mandar pro calendário do celular"
                subtitle='Seus agendamentos aparecem no calendário "AgendaPro" do iPhone ou Android, com aviso 1 hora antes.'
                value={calOn} onValueChange={toggleCalendar} disabled={saving === 'calendar_sync' || calBusy} />
              {calOn ? (
                <>
                  <Divider style={{ marginVertical: 0 }} />
                  {calPerm === 'denied' ? (
                    <Row icon="alert-circle-outline" iconColor={colors.warning} title="Sem acesso ao calendário"
                      subtitle="Toque pra liberar o AgendaPro nos Ajustes do celular." onPress={openDeviceSettings} chevron />
                  ) : (
                    <Row icon="sync-outline" title="Sincronizar agora"
                      subtitle={lastSync?.at ? `Última vez ${fmtAgo(lastSync.at)}` : 'Próximos 60 dias. Também sincroniza sozinho quando você abre o app.'}
                      onPress={calBusy ? undefined : () => syncNow()} right={calBusy ? <Loading style={{ padding: 0 }} /> : null} chevron={!calBusy} />
                  )}
                </>
              ) : null}
            </>
          )}
        </Card>
      </Section>

      {/* ── Segurança ────────────────────────────────────────────────── */}
      {!isWeb ? (
        <Section title="Segurança">
          <Card padded={false}>
            {bioAvail || bioOn ? (
              <ToggleRow title={`Pedir ${bioLabel} ao abrir o app`}
                subtitle="Protege seus clientes e valores se alguém pegar seu celular. Pede de novo depois de 1 minuto fora do app."
                value={bioOn} onValueChange={toggleBio} disabled={bioBusy} />
            ) : (
              <Row icon="finger-print-outline" title="Face ID / digital"
                subtitle="Cadastre o Face ID ou a digital nos Ajustes do celular pra proteger o app." />
            )}
          </Card>
        </Section>
      ) : null}

      {/* ── Mensagens e agenda ───────────────────────────────────────── */}
      <Section title="Mensagens e agenda">
        <Card>
          <P style={{ fontWeight: '500' }}>Idioma padrão das mensagens</P>
          <Muted style={{ marginTop: 2, marginBottom: spacing.md }}>
            Já vem escolhido nas mensagens prontas do WhatsApp. Dá pra trocar na hora de mandar.
            {!app.can('multilang_messages') ? ` Inglês e espanhol: plano ${featureInfo(ent, 'multilang_messages').minName}.` : ''}
          </Muted>
          <Segmented
            options={LANGS.map((l) => ({ value: l.value, label: LANG_SHORT[l.value] || l.label }))}
            value={lang}
            onChange={pickLanguage}
          />
        </Card>
        <Card padded={false} style={{ marginTop: spacing.md }}>
          <ToggleRow title="Semana começa na segunda" subtitle="Na agenda da semana (desligado: começa no domingo)"
            value={value('week_starts_monday')} onValueChange={(v) => save('week_starts_monday', v)} disabled={saving === 'week_starts_monday'} />
        </Card>
      </Section>

      {/* ── Negócio ──────────────────────────────────────────────────── */}
      <Section title="Seu negócio">
        <Card>
          <P style={{ fontWeight: '500' }}>Tipo de negócio</P>
          <Muted style={{ marginTop: 2, marginBottom: spacing.md }}>Muda a ordem do menu e os atalhos. Limpeza mostra o turnover do Airbnb primeiro.</Muted>
          <Segmented options={VERTICALS} value={provider.vertical || 'services'} onChange={bizBusy ? () => {} : pickVertical} />
        </Card>
        <Card padded={false} style={{ marginTop: spacing.md }}>
          <Row icon="globe-outline" title="Fuso horário" subtitle={tzLabel(provider.timezone)} onPress={bizBusy ? undefined : pickTimezone} chevron
            right={devTz && provider.timezone && devTz !== provider.timezone && TIMEZONES.some((t) => t.value === devTz) ? <Badge text="Conferir" tone="orange" /> : null} />
        </Card>
      </Section>

      {/* ── Conta ────────────────────────────────────────────────────── */}
      <Section title="Conta">
        <Card padded={false}>
          <Row icon="mail-outline" title="E-mail" subtitle={user?.email || ''} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="diamond-outline" iconColor={colors.goldDark} title="Meu plano" subtitle={planLine} chevron onPress={() => router.push('/plans')} />
          {/* Modo demonstração não tem login de verdade: sem trocar senha */}
          {!app.demo ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
          {!app.demo ? <Row icon="key-outline" title="Trocar senha" chevron={!pwOpen} onPress={() => { setPwOpen((o) => !o); setPwErr(null) }} /> : null}
          {pwOpen && !app.demo ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              <Input label="Nova senha" value={pw1} onChangeText={setPw1} secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" placeholder="Pelo menos 8 caracteres" />
              <Input label="Repita a nova senha" value={pw2} onChangeText={setPw2} secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={pwErr} />
              <Button title="Salvar nova senha" onPress={changePassword} loading={pwBusy} disabled={!pw1 || !pw2} />
              <Muted style={{ marginTop: spacing.sm }}>Vale também pro site e pra comunidade BrasilConnect.</Muted>
            </View>
          ) : null}
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="log-out-outline" title="Sair da conta" danger onPress={logout} />
        </Card>
      </Section>

      {/* ── Excluir conta ────────────────────────────────────────────── */}
      <Section title="Zona de perigo">
        {!delOpen ? (
          <Card padded={false}>
            <Row icon="trash-outline" title="Excluir minha conta" subtitle="Apaga todos os seus dados do AgendaPro" danger onPress={startDelete} />
          </Card>
        ) : (
          <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
            <P style={{ fontWeight: '700', color: colors.danger }}>Excluir conta para sempre</P>
            <P style={{ marginTop: spacing.sm, color: colors.inkSoft }}>
              Apagamos seu perfil e página pública, agenda, clientes, serviços, horários, finanças, avaliações e equipe. Não dá pra desfazer.
            </P>
            {provider.has_subscription ? (
              <P style={{ marginTop: spacing.sm, color: colors.inkSoft }}>Sua assinatura é cancelada na hora, sem novas cobranças.</P>
            ) : null}
            <Muted style={{ marginTop: spacing.sm }}>Dica: se precisar do histórico pro imposto, exporte antes em Finanças → Relatórios.</Muted>
            <View style={{ marginHorizontal: -spacing.lg, marginTop: spacing.sm }}>
              <ToggleRow title="Apagar também meu login BrasilConnect"
                subtitle="Recomendado. Sua conta do site BrasilConnect também some: o mesmo e-mail e senha deixam de entrar no site e na comunidade, e as fotos enviadas por lá são apagadas. Desligue só se quiser continuar usando o site."
                value={delLogin} onValueChange={setDelLogin} disabled={delBusy} />
            </View>
            <Input label="Digite EXCLUIR para confirmar" value={delText} onChangeText={setDelText}
              autoCapitalize="characters" autoCorrect={false} placeholder="EXCLUIR" style={{ marginTop: spacing.sm }} />
            <Button title="Excluir para sempre" variant="danger" icon="trash-outline" onPress={confirmDelete} loading={delBusy}
              disabled={delText.trim().toUpperCase() !== 'EXCLUIR'} />
            <Button title="Cancelar" variant="ghost" onPress={() => setDelOpen(false)} disabled={delBusy} style={{ marginTop: spacing.sm }} />
          </Card>
        )}
      </Section>

      {/* ── Sobre ────────────────────────────────────────────────────── */}
      <Section title="Sobre">
        <Card padded={false}>
          <Row icon="information-circle-outline" title="Versão" right={build ? `${version} (${build})` : version} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="document-text-outline" title="Termos de uso" chevron onPress={() => openUrl(TERMS_URL)} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="shield-checkmark-outline" title="Política de privacidade" chevron onPress={() => openUrl(PRIVACY_URL)} />
          <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
          <Row icon="help-buoy-outline" title="Falar com o suporte" subtitle={SUPPORT_EMAIL} chevron
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=AgendaPro`).catch(() => notify('Suporte', `Escreva para ${SUPPORT_EMAIL}`))} />
        </Card>
      </Section>

      <Muted style={{ textAlign: 'center', marginTop: spacing.xl }}>AgendaPro · BrasilConnect</Muted>
    </Screen>
  )
}
