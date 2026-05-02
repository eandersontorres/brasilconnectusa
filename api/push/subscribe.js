import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  if (req.method === 'POST') {
    const { user_id, subscription } = req.body || {}
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription obrigatório' })
    const { error } = await supabase.from('bc_push_subscriptions').upsert({
      user_id: user_id || null,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh,
      auth: subscription.keys?.auth,
      user_agent: req.headers['user-agent'] || null,
      active: true,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'endpoint' })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {}
    if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatório' })
    await supabase.from('bc_push_subscriptions').update({ active: false }).eq('endpoint', endpoint)
    return res.status(200).json({ ok: true })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
