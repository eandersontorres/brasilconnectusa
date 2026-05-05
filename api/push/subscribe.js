import { createClient } from '@supabase/supabase-js'

const VALID_TOPICS = ['orders', 'community', 'cambio', 'events', 'bolao', 'restaurant_status']

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  if (req.method === 'POST') {
    const { user_id, subscription, topics } = req.body || {}
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription obrigatório' })

    // Filtra topicos validos
    let topicsArr = null
    if (Array.isArray(topics)) {
      topicsArr = topics.filter(t => VALID_TOPICS.includes(t))
      if (topicsArr.length === 0) topicsArr = ['community', 'orders']
    }

    const payload = {
      user_id: user_id || null,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh,
      auth: subscription.keys?.auth,
      user_agent: req.headers['user-agent'] || null,
      active: true,
      last_used_at: new Date().toISOString(),
    }
    if (topicsArr) payload.topics = topicsArr

    const { error } = await supabase.from('bc_push_subscriptions').upsert(payload, { onConflict: 'endpoint' })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'PATCH') {
    // Atualiza topics sem trocar subscription
    const { endpoint, topics } = req.body || {}
    if (!endpoint || !Array.isArray(topics)) return res.status(400).json({ error: 'endpoint e topics obrigatorios' })
    const filtered = topics.filter(t => VALID_TOPICS.includes(t))
    const { error } = await supabase.from('bc_push_subscriptions').update({ topics: filtered }).eq('endpoint', endpoint)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, topics: filtered })
  }

  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {}
    if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatório' })
    await supabase.from('bc_push_subscriptions').update({ active: false }).eq('endpoint', endpoint)
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'GET') {
    // Retorna topicos atuais de uma subscription (frontend usa pra preencher checkboxes)
    const { endpoint } = req.query
    if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatorio' })
    const { data } = await supabase.from('bc_push_subscriptions').select('topics, active').eq('endpoint', endpoint).maybeSingle()
    return res.status(200).json({ subscription: data || null, available_topics: VALID_TOPICS })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
