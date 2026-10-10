/**
 * Celular da profissional pra receber notificacao push (app AgendaPro).
 *
 * POST /api/agenda/push-token   com JWT
 *      Body: { token: 'ExponentPushToken[...]', platform: 'ios'|'android', device_name? }
 *        registra (ou reativa) o aparelho. O mesmo token passa pra conta que esta
 *        logada agora (celular trocou de dona / outra conta entrou).
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
const MAX_DEVICES = 10

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
    const now = new Date().toISOString()

    const { error } = await supabase.from('ag_push_tokens').upsert({
      token,
      provider_id: providerId,
      user_id: auth.user.id,
      platform,
      device_name: deviceName,
      last_seen_at: now,
      disabled_at: null,
    }, { onConflict: 'token' })
    if (error) return res.status(500).json({ error: error.message })

    // Muitos aparelhos ativos (trocas de celular ao longo do tempo): desliga os mais antigos
    const { data: active } = await supabase.from('ag_push_tokens')
      .select('id')
      .eq('provider_id', providerId)
      .is('disabled_at', null)
      .order('last_seen_at', { ascending: false })
    const extra = (active || []).slice(MAX_DEVICES).map((r) => r.id)
    if (extra.length) {
      await supabase.from('ag_push_tokens').update({ disabled_at: now }).in('id', extra).eq('provider_id', providerId)
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
