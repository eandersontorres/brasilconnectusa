/**
 * GET /api/agenda/services?provider_id=... → lista
 * POST /api/agenda/services (body) → cria/atualiza
 * Auth: header x-provider-secret (mock até auth completo)
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    const { provider_id } = req.query
    if (!provider_id) return res.status(400).json({ error: 'provider_id obrigatório' })
    const { data, error } = await supabase
      .from('ag_services')
      .select('*')
      .eq('provider_id', provider_id)
      .order('display_order', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ services: data })
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const adminSecret = req.headers['x-admin-secret']
    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })

    const body = req.body
    if (!body.provider_id || !body.name || body.price_cents == null) {
      return res.status(400).json({ error: 'Campos obrigatórios: provider_id, name, price_cents' })
    }

    const payload = {
      provider_id: body.provider_id,
      name: body.name,
      category: body.category || null,
      description: body.description || null,
      duration_min: body.duration_min || 60,
      price_cents: body.price_cents,
      deposit_cents: body.deposit_cents || 0,
      active: body.active !== false,
      display_order: body.display_order || 0,
    }

    let result
    if (body.id) {
      result = await supabase.from('ag_services').update(payload).eq('id', body.id).select().single()
    } else {
      result = await supabase.from('ag_services').insert(payload).select().single()
    }
    if (result.error) return res.status(500).json({ error: result.error.message })
    return res.status(200).json({ service: result.data })
  }

  if (req.method === 'DELETE') {
    const adminSecret = req.headers['x-admin-secret']
    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id obrigatório' })
    const { error } = await supabase.from('ag_services').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
