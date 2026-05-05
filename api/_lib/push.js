/**
 * Push helper — funcao reutilizavel pra disparar notificacoes.
 * NAO e um endpoint API (subdir _lib nao vira rota Vercel).
 *
 * Uso:
 *   import { sendPushTo } from '../_lib/push.js'
 *   await sendPushTo({ user_email: 'x@y.com', topic: 'orders', title: '...', body: '...', url: '/...' })
 *
 * Filtra subscriptions por:
 *   - user_id (se fornecido)
 *   - user_email (se fornecido)
 *   - topic (se fornecido) → so envia pra quem tem esse topico no array
 */
import { createClient } from '@supabase/supabase-js'

export async function sendPushTo({ user_id, user_email, topic, title, body, url, type, data }) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error('[push] VAPID keys nao configuradas, pulando')
    return { sent: 0, skipped: 'no_vapid' }
  }
  if (!title || !body) {
    console.error('[push] title/body obrigatorios')
    return { sent: 0, error: 'missing_payload' }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  let q = supabase.from('bc_push_subscriptions').select('endpoint, p256dh, auth, topics').eq('active', true)
  if (user_id) q = q.eq('user_id', user_id)
  if (user_email) q = q.eq('user_email', String(user_email).toLowerCase().trim())

  const { data: subs, error } = await q
  if (error || !subs?.length) return { sent: 0, total: 0 }

  // Filtra por topic (se especificado)
  const filtered = topic
    ? subs.filter(s => !s.topics || s.topics.includes(topic))
    : subs

  if (!filtered.length) return { sent: 0, total: subs.length, filtered_out: subs.length }

  const webpush = (await import('web-push')).default
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_SUBJECT?.replace('mailto:', '') || process.env.VAPID_EMAIL || 'oi@brasilconnectusa.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const payload = JSON.stringify({
    title,
    body,
    url: url || '/',
    type: type || 'general',
    data: data || {},
  })

  let sent = 0, failed = 0
  for (const sub of filtered) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      sent++
    } catch (e) {
      failed++
      // Subscription expirou → desativa
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from('bc_push_subscriptions').update({ active: false }).eq('endpoint', sub.endpoint).catch(() => {})
      }
    }
  }
  return { sent, failed, total: filtered.length }
}
