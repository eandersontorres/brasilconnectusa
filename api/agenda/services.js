/**
 * GET    /api/agenda/services?provider_id=...  publico: servicos ativos da profissional
 * GET    /api/agenda/services?mine=1           com JWT: todos os meus servicos (ativos e pausados)
 * POST   /api/agenda/services  (body)          com JWT: cria ou atualiza um servico meu
 * DELETE /api/agenda/services?id=...           com JWT: remove um servico meu
 *
 * Tambem aceita x-admin-secret (com provider_id no body) pra uso administrativo.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth, isAdmin } from '../_lib/providerAuth.js'

const int = (v, min, max, def) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

async function resolveProviderId(req, res, supabase) {
  if (await isAdmin(req)) {
    const id = req.body?.provider_id || req.query?.provider_id
    if (!id) { res.status(400).json({ error: 'provider_id obrigatório' }); return null }
    return id
  }
  const auth = await requireProviderAuth(req, supabase)
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return null }
  return auth.provider.id
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  try {
    if (req.method === 'GET') {
      if (req.query.mine) {
        const providerId = await resolveProviderId(req, res, supabase)
        if (!providerId) return
        const { data, error } = await supabase.from('ag_services').select('*')
          .eq('provider_id', providerId).order('display_order', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        res.setHeader('Cache-Control', 'private, no-store')
        return res.status(200).json({ services: data || [] })
      }

      const { provider_id } = req.query
      if (!provider_id) return res.status(400).json({ error: 'provider_id obrigatório' })
      const { data, error } = await supabase
        .from('ag_services')
        .select('id, provider_id, name, category, description, duration_min, price_cents, deposit_cents, display_order')
        .eq('provider_id', provider_id)
        .eq('active', true)
        .order('display_order', { ascending: true })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ services: data || [] })
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const providerId = await resolveProviderId(req, res, supabase)
      if (!providerId) return

      const body = req.body || {}
      const name = clip(body.name, 120)
      if (!name || body.price_cents == null) {
        return res.status(400).json({ error: 'Nome e preço são obrigatórios' })
      }

      const price = int(body.price_cents, 0, 1000000, 0)
      const payload = {
        provider_id: providerId,
        name,
        category: clip(body.category, 60),
        description: clip(body.description, 600),
        duration_min: int(body.duration_min, 5, 600, 60),
        price_cents: price,
        deposit_cents: Math.min(int(body.deposit_cents, 0, 1000000, 0), price),
        active: body.active !== false,
        display_order: int(body.display_order, 0, 999, 0),
      }

      let result
      if (body.id) {
        // .eq('provider_id') garante que so mexe em servico proprio
        result = await supabase.from('ag_services').update(payload)
          .eq('id', body.id).eq('provider_id', providerId).select().maybeSingle()
        if (!result.error && !result.data) return res.status(404).json({ error: 'Serviço não encontrado' })
      } else {
        const { count } = await supabase.from('ag_services')
          .select('id', { count: 'exact', head: true }).eq('provider_id', providerId)
        if ((count || 0) >= 60) return res.status(400).json({ error: 'Limite de 60 serviços atingido' })
        result = await supabase.from('ag_services').insert(payload).select().single()
      }
      if (result.error) return res.status(500).json({ error: result.error.message })
      return res.status(200).json({ service: result.data })
    }

    if (req.method === 'DELETE') {
      const providerId = await resolveProviderId(req, res, supabase)
      if (!providerId) return
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id obrigatório' })

      // Servico com agendamento no historico nao pode ser apagado: pausa.
      const { count } = await supabase.from('ag_appointments')
        .select('id', { count: 'exact', head: true }).eq('service_id', id).eq('provider_id', providerId)
      if ((count || 0) > 0) {
        const { error } = await supabase.from('ag_services').update({ active: false })
          .eq('id', id).eq('provider_id', providerId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ ok: true, paused: true })
      }

      const { error } = await supabase.from('ag_services').delete().eq('id', id).eq('provider_id', providerId)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
