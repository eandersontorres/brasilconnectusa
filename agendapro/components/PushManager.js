// Trabalho de fundo do app (não desenha nada):
//   1. Registra o celular pra receber notificações, uma vez por login (lib/push.js).
//   2. Mostra o aviso mesmo com o app aberto e, ao tocar, abre a tela certa:
//        appointment → /appointment/[id] · review → /reviews · plans → /plans · agenda → /agenda
//        document → /document/[id] (sem id: /vendas) · quote_request → /quote-requests
//        documents (resumo do cron de faturas) → /vendas, na aba de faturas
//   3. Calendário do celular: com "calendar_sync" ligado (Configurações), sincroniza
//      os próximos 60 dias ao abrir e ao voltar pro app (no máximo a cada 10 min).
// Nada disso roda no preview web.
import { useCallback, useEffect, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { router } from 'expo-router'
import { useApp } from '../lib/session'
import { registerForPush } from '../lib/push'
import { calendarPermission, syncFromServer } from '../lib/calendar'

const isWeb = Platform.OS === 'web'
const CAL_EVERY_MS = 10 * 60 * 1000

/** Dados da notificação → rota do app (null = só abre o app). */
export function routeForNotification(data) {
  if (!data || typeof data !== 'object') return null
  switch (data.type) {
    case 'appointment': return data.id ? `/appointment/${encodeURIComponent(String(data.id))}` : '/agenda'
    case 'review': return '/reviews'
    case 'plans': return '/plans'
    case 'agenda': return '/agenda'
    // Orçamento visto/aprovado/recusado, fatura paga (doc-public, webhook do Stripe)
    case 'document': return data.id ? `/document/${encodeURIComponent(String(data.id))}` : '/vendas'
    case 'quote_request': return '/quote-requests'
    // Resumo diário (api/cron/agenda-documents.js): fatura vencida / cobrança automática
    case 'documents': return data.filter === 'overdue' ? '/vendas?tab=invoices&status=overdue' : '/vendas'
    default: return null
  }
}

export default function PushManager() {
  const app = useApp()
  const { session, provider, hasLoadedMe, settings } = app
  const uid = session?.user?.id || null
  const ready = !!(uid && hasLoadedMe && provider)
  const canCalendar = app.can('calendar_sync')
  const calendarOn = !!settings?.calendar_sync

  const registeredFor = useRef(null)
  const pending = useRef(null)
  const handled = useRef(new Set())
  const readyRef = useRef(ready)
  readyRef.current = ready

  // Navega quando o app já está pronto (login + perfil carregados)
  const flush = useCallback(() => {
    if (!pending.current || !readyRef.current) return
    const to = pending.current
    pending.current = null
    // Dá tempo do redirecionamento inicial (index → /hoje) acontecer antes
    setTimeout(() => { try { router.push(to) } catch (_) {} }, 400)
  }, [])

  // 1. Registro (uma vez por login)
  useEffect(() => {
    if (isWeb) return
    if (!uid) { registeredFor.current = null; return }
    if (!ready || registeredFor.current === uid) return
    registeredFor.current = uid
    registerForPush().catch(() => {})
  }, [ready, uid])

  // 2. Aviso com o app aberto + toque na notificação
  useEffect(() => {
    if (isWeb) return
    const n = require('expo-notifications')
    n.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })

    const open = (resp) => {
      if (!resp) return
      const id = resp.notification?.request?.identifier
      if (id) {
        if (handled.current.has(id)) return
        handled.current.add(id)
      }
      const to = routeForNotification(resp.notification?.request?.content?.data)
      if (to) { pending.current = to; flush() }
      try { n.clearLastNotificationResponseAsync?.()?.catch?.(() => {}) } catch (_) {}
    }

    // App aberto pelo toque (estava fechado)
    n.getLastNotificationResponseAsync().then(open).catch(() => {})
    // App aberto ou em segundo plano
    const sub = n.addNotificationResponseReceivedListener(open)
    return () => sub.remove()
  }, [flush])

  // Abriu pelo toque antes do login/perfil carregar: navega quando ficar pronto
  useEffect(() => {
    if (ready) flush()
  }, [ready, flush])

  // 3. Calendário do celular
  useEffect(() => {
    if (isWeb || !ready || !canCalendar || !calendarOn) return
    let last = 0
    let running = false
    const run = async () => {
      if (running || Date.now() - last < CAL_EVERY_MS) return
      running = true
      last = Date.now()
      try {
        // Em segundo plano não pede permissão: só sincroniza se já foi dada
        if ((await calendarPermission()) === 'granted') await syncFromServer(provider)
      } catch (_) {
        // sem internet / API fora: tenta na próxima vez que o app abrir
      } finally {
        running = false
      }
    }
    run()
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') run() })
    return () => sub.remove()
    // provider entra pelo id/fuso (o objeto muda a cada /me)
  }, [ready, canCalendar, calendarOn, provider?.id, provider?.timezone])

  return null
}
