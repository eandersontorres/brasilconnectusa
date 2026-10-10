/**
 * Celular da profissional pra receber notificacao push (app AgendaPro).
 *
 * POST /api/agenda/push-token   com JWT
 *      Body: { token: 'ExponentPushToken[...]', platform: 'ios'|'android', device_name?, app?: 'agendapro'|'workpro' }
 *        registra (ou reativa) o aparelho. O mesmo token passa pra conta que esta
 *        logada agora (celular trocou de dona / outra conta entrou).
 *        AgendaPro e WorkPro no mesmo celular = dois tokens (projetos Expo diferentes): `app`
 *        fica gravado (coluna ag_push_tokens.app, se existir) pro envio agrupar por projeto, e o
 *        limite de aparelhos conta por app, entao registrar um app nunca desliga o token do outro.
 *      Body: { action: 'unregister', token }
 *        ao sair da conta: o aparelho para de receber os avisos dessa profissional.
 *      Body: { action: 'test' }
 *        manda um aviso de teste pros celulares dela (botao em Configuracoes).
 *        → { ok, sent } · 402 sem o recurso no plano
 *
 * Registrar nao exige plano: o envio (api/_lib/agendaPush.js) e que confere o
 * recurso 'push_notifications'. Assim, assinou → os avisos ja chegam.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'
import { sendPushToProvider } from '../_lib/agendaPush.js'
import { rateLimit } from '../_lib/rateLimit.js'

const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,200}\]$/
const PLATFORMS = ['ios', 'android']
const APPS = ['agendapro', 'workpro']
const MAX_DEVICES = 10          // por app; sem a coluna app, o limite vale pros dois juntos (x2)

const isSchemaError = (e) => ['42703', 'PGRST204'].includes(e?.code) || /column .* does not exist|could not find/i.test(e?.message || '')

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const providerId = auth.provider.id
    res.setHeader('Cache-Control', 'private, no-store')

    const b = req.body || {}

    if (b.action === 'test') {
      const gate = requireFeature(auth.provider, 'push_notifications')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const rl = rateLimit(req, { windowMs: 60000, max: 5 })
      if (rl) return res.status(429).json({ error: 'Calma! Espere ' + rl.retryAfter + 's pra mandar outro teste.' })
      const r = await sendPushToProvider(supabase, providerId, {
        kind: 'test',
        title: 'Notificações funcionando',
        body: 'É assim que você vai saber na hora quando chegar agendamento novo.',
        data: { type: 'agenda' },
      })
      return res.status(200).json({ ok: true, sent: r.sent || 0 })
    }

    const token = String(b.token || '').trim().slice(0, 260)
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Token de notificação inválido' })

    if (b.action === 'unregister') {
      const { error } = await supabase.from('ag_push_tokens').delete()
        .eq('token', token).eq('provider_id', providerId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (b.action && b.action !== 'register') return res.status(400).json({ error: 'Ação inválida' })

    const platform = PLATFORMS.includes(b.platform) ? b.platform : null
    const deviceName = b.device_name ? String(b.device_name).trim().slice(0, 80) || null : null
    const app = APPS.includes(b.app) ? b.app : null
    const now = new Date().toISOString()

    const row = {
      token,
      provider_id: providerId,
      user_id: auth.user.id,
      platform,
      device_name: deviceName,
      last_seen_at: now,
      disabled_at: null,
    }
    let appSaved = !!app
    let { error } = await supabase.from('ag_push_tokens').upsert(app ? { ...row, app } : row, { onConflict: 'token' })
    if (error && app && isSchemaError(error)) {
      // Banco ainda sem a coluna app: grava sem ela (o envio separa os projetos pelo erro da Expo)
      appSaved = false
      ;({ error } = await supabase.from('ag_push_tokens').upsert(row, { onConflict: 'token' }))
    }
    if (error) return res.status(500).json({ error: error.message })

    // Muitos aparelhos ativos (trocas de celular ao longo do tempo): desliga os mais antigos.
    // Conta só os do mesmo app, pra nunca desligar o token do outro app da mesma conta.
    let q = supabase.from('ag_push_tokens')
      .select('id')
      .eq('provider_id', providerId)
      .is('disabled_at', null)
    if (appSaved) q = q.eq('app', app)
    const { data: active } = await q.order('last_seen_at', { ascending: false })
    const extra = (active || []).slice(appSaved ? MAX_DEVICES : MAX_DEVICES * 2).map((r) => r.id)
    if (extra.length) {
      await supabase.from('ag_push_tokens').update({ disabled_at: now }).in('id', extra).eq('provider_id', providerId)
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
