/**
 * Helper interno pra criar notificacao in-app + (opcionalmente) push.
 *
 * Uso:
 *   import { createNotification } from '../_lib/notify.js'
 *   await createNotification({
 *     user_id, user_email,
 *     type: 'comment', title: 'Novo comentario', body: '...', url: '/post/abc',
 *     icon: '💬',
 *     also_push: true, push_topic: 'community',
 *   })
 */
import { createClient } from '@supabase/supabase-js'

export async function createNotification({
  user_id, user_email, type, title, body, url, icon, metadata,
  also_push, push_topic,
}) {
  if (!user_id && !user_email) return { error: 'no_target' }
  if (!type || !title) return { error: 'no_payload' }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  const { data, error } = await supabase.from('bc_notifications').insert({
    user_id: user_id || null,
    user_email: user_email ? String(user_email).toLowerCase().trim() : null,
    type, title, body, url, icon, metadata,
  }).select().single()

  if (error) {
    console.error('notif create:', error.message)
    return { error: error.message }
  }

  // Push opcional (best effort)
  if (also_push) {
    try {
      const { sendPushTo } = await import('./push.js')
      await sendPushTo({
        user_id, user_email,
        topic: push_topic || 'community',
        title: (icon ? icon + ' ' : '') + title,
        body: body || '',
        url: url || '/',
        type,
        data: metadata,
      })
    } catch (e) {
      console.error('push from notif failed:', e.message)
    }
  }

  return { notification: data }
}
