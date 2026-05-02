import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'VAPID keys não configuradas' })
  }

  const { user_id, title, body, url, type } = req.body || {}
  if (!title || !body) return res.status(400).json({ error: 'title e body obrigatórios' })

  try {
    const webpush = (await import('web-push')).default
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'admin@brasilconnectusa.com'}`,
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
    )
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    let query = supabase.from('bc_push_subscriptions').select('*').eq('active', true)
    if (user_id) query = query.eq('user_id', user_id)
    const { data: subs } = await query

    let sent = 0, failed = 0
    const payload = JSON.stringify({ title, body, url: url || '/', type: type || 'general' })
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload)
        sent++
      } catch (e) {
        failed++
        if (e.statusCode === 410) {
          await supabase.from('bc_push_subscriptions').update({ active: false }).eq('endpoint', sub.endpoint)
        }
      }
    }
    return res.status(200).json({ ok: true, sent, failed, total: subs?.length || 0 })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
