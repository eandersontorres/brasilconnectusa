// Confere uma vez, por perfil e por aparelho, se o fuso do perfil bate com o do
// celular. Perfil criado no site pode ter ficado com o fuso do estado; se o
// celular está em outro, pergunta antes de trocar (nunca troca sozinho).
// O fuso muda quando os lembretes saem e como a agenda vai pro calendário do celular.
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useApp } from '../lib/session'
import { post } from '../lib/api'
import { confirm } from '../lib/dialog'
import { DEMO } from '../lib/config'

const KEY = (id) => `agendapro.tzcheck.${id}`
const VALID = /^(America|Pacific)\/[A-Za-z_]+(\/[A-Za-z_]+)?$/   // o servidor (me.js) aceita só fusos dos EUA

function deviceTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch (_) { return null }
}
const label = (tz) => String(tz || '').split('/').pop().replace(/_/g, ' ')

export default function TimezoneCheck() {
  const { provider, setProvider } = useApp()
  const asked = useRef(null)

  useEffect(() => {
    const id = provider?.id
    if (!id || DEMO || Platform.OS === 'web' || asked.current === id) return
    asked.current = id
    const dev = deviceTz()
    if (!dev || !VALID.test(dev) || !provider.timezone || provider.timezone === dev) return
    let alive = true
    ;(async () => {
      if (await AsyncStorage.getItem(KEY(id)).catch(() => null)) return
      // Marca antes de perguntar: se fechar o app no meio, não pergunta toda vez
      await AsyncStorage.setItem(KEY(id), new Date().toISOString()).catch(() => {})
      if (!alive) return
      const ok = await confirm(
        'Fuso horário',
        `Seu perfil está no fuso de ${label(provider.timezone)}, mas o celular está em ${label(dev)}. Usar o fuso do celular? Os horários da agenda continuam os mesmos; muda quando saem os lembretes e como os horários vão pro calendário do celular. Dá pra mudar depois em Configurações.`,
        { ok: 'Usar o do celular', cancel: 'Manter' },
      )
      if (!ok) return
      try {
        const r = await post('/api/agenda/me', { action: 'vertical', timezone: dev })
        if (r?.provider && alive) setProvider(r.provider)
      } catch (_) {}
    })()
    return () => { alive = false }
  }, [provider?.id, provider?.timezone, setProvider])

  return null
}
