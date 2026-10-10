// ════════════════════════════════════════════════════════════════════════════
//   Sessão do app: login (Supabase) + perfil da profissional + plano (/api/agenda/me).
//
//   const { user, provider, ent, can, limit, refresh, saveSettings, signOut } = useApp()
//   can('finance')        → true se o plano libera
//   limit('staff')        → número máximo (null = ilimitado)
//   ent.tier              → 'none' | 'starter' | 'pro' | 'premium'
//   ent.trial / ent.trial_days_left / ent.past_due
//   ent.catalog           → planos, recursos (label/desc/min) e limites, vindos do servidor
//
//   Guarda o último /me no aparelho: o app abre sem internet mostrando o cache.
//   Modo demonstração (DEMO de lib/config.js): sessão fictícia, sem Supabase e sem cache;
//   demo → true e signInDemo() pro botão do login.
// ════════════════════════════════════════════════════════════════════════════
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { api, post } from './api'
import { unregisterPush } from './push'
import { DEMO } from './config'

const CACHE_KEY = 'agendapro.me.v1'
const AppCtx = createContext(null)

const EMPTY_ENT = { tier: 'none', features: {}, limits: {}, catalog: null, trial: false, trial_days_left: 0, past_due: false }

// Modo demonstração (EXPO_PUBLIC_DEMO=1): sessão fictícia só na memória, sem Supabase (lib/demo)
const DEMO_SESSION = DEMO ? { access_token: 'demo', user: { id: 'de000000-0000-4000-9000-000000000001', email: 'demo@agendapro.app' } } : null

export function AppProvider({ children }) {
  const [session, setSession] = useState(DEMO_SESSION)
  const [authReady, setAuthReady] = useState(DEMO)   // demo: pronto na hora
  const [me, setMe] = useState(null)          // { user, provider, entitlements }
  const [meLoading, setMeLoading] = useState(false)
  const [meError, setMeError] = useState(null)
  const lastFetch = useRef(0)
  const sessionRef = useRef(session)
  sessionRef.current = session

  // ── sessão ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (DEMO) return                              // demo: não fala com o Supabase
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session || null)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null))
    return () => { alive = false; sub?.subscription?.unsubscribe?.() }
  }, [])

  // ── /me ─────────────────────────────────────────────────────────────────
  const refresh = useCallback(async ({ silent = false } = {}) => {
    // Demo: a sessão fictícia vem da memória
    const cur = DEMO ? sessionRef.current : (await supabase.auth.getSession()).data?.session
    if (!cur) { setMe(null); return null }
    if (!silent) setMeLoading(true)
    try {
      const r = await api('/api/agenda/me')
      lastFetch.current = Date.now()
      setMe(r)
      setMeError(null)
      if (!DEMO) AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ uid: cur.user.id, me: r })).catch(() => {})
      return r
    } catch (e) {
      setMeError(e)
      return null
    } finally {
      if (!silent) setMeLoading(false)
    }
  }, [])

  // Supabase recomenda pausar o refresh com o app em segundo plano
  useEffect(() => {
    const s = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        if (!DEMO) supabase.auth.startAutoRefresh()
        // Voltou do navegador (checkout/portal do Stripe)? Atualiza o plano.
        if (Date.now() - lastFetch.current > 15000) refresh({ silent: true })
      } else if (!DEMO) supabase.auth.stopAutoRefresh()
    })
    return () => s.remove()
  }, [refresh])

  useEffect(() => {
    if (!authReady) return
    if (!session) { setMe(null); return }
    if (DEMO) { refresh(); return }               // demo: sem cache no aparelho
    let alive = true
    // Cache primeiro (abre rápido / offline), depois rede
    AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (!alive || !raw) return
      try {
        const c = JSON.parse(raw)
        if (c?.uid === session.user.id && c.me) setMe((cur) => cur || c.me)
      } catch (_) {}
    }).finally(() => { if (alive) refresh() })
    return () => { alive = false }
  }, [authReady, session?.user?.id, refresh])

  const saveSettings = useCallback(async (patch) => {
    const r = await post('/api/agenda/me', { action: 'settings', settings: patch })
    setMe((cur) => ({ ...(cur || {}), provider: r.provider, entitlements: r.entitlements }))
    return r.provider.app_settings
  }, [])

  /** Atualiza o perfil em memória depois de salvar em outra tela. */
  const setProvider = useCallback((provider) => {
    setMe((cur) => ({ ...(cur || {}), provider: { ...(cur?.provider || {}), ...provider } }))
  }, [])

  const signOut = useCallback(async () => {
    // Antes de sair: este celular para de receber os avisos desta conta
    await unregisterPush().catch(() => {})
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
    setMe(null)
    if (DEMO) { setSession(null); return }        // demo: só limpa e volta pro login
    await supabase.auth.signOut()
  }, [])

  /** Demo: botão "Entrar na demonstração" do login. */
  const signInDemo = useCallback(() => { if (DEMO) setSession(DEMO_SESSION) }, [])

  const value = useMemo(() => {
    const ent = me?.entitlements || EMPTY_ENT
    return {
      session,
      user: session?.user || null,
      authReady,
      me,
      provider: me?.provider || null,
      settings: me?.provider?.app_settings || {},
      ent,
      meLoading,
      meError,
      hasLoadedMe: !!me,
      can: (key) => !!ent.features?.[key],
      limit: (key) => (ent.limits && key in ent.limits ? ent.limits[key] : 0),
      refresh,
      saveSettings,
      setProvider,
      signOut,
      demo: DEMO,
      signInDemo,
    }
  }, [session, authReady, me, meLoading, meError, refresh, saveSettings, setProvider, signOut, signInDemo])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const v = useContext(AppCtx)
  if (!v) throw new Error('useApp fora do AppProvider')
  return v
}
