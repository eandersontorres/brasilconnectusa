/**
 * Servicos da profissional (tabela ag_services).
 *
 * GET    /api/agenda/services?provider_id=...  publico: servicos ativos da profissional
 * GET    /api/agenda/services?mine=1           com JWT: todos os meus servicos (ativos e pausados)
 * POST   /api/agenda/services                  com JWT
 *        Body sem action: cria ou atualiza um servico meu
 *          { id?, name, price_cents, duration_min?, deposit_cents?, category?, description?, active?, display_order? }
 *        { action: 'reorder', ids: [...] }           ordem da lista = ordem na pagina publica
 *        { action: 'set_active', id, active }        pausa ou reativa sem mexer no resto
 *        { action: 'create_many', services: [...] }  sugestoes do app (ate 10 de uma vez)
 * DELETE /api/agenda/services?id=...           com JWT: remove (ou pausa, se tem historico)
 *
 * Criar, editar e remover exige o recurso 'services' do plano. Sinal > 0 exige
 * sinal por fora (deposit_offline) ou no cartao (deposit_stripe).
 * Tambem aceita x-admin-secret (com provider_id no body/query) pra uso administrativo.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth, isAdmin } from '../_lib/providerAuth.js'
import { requireFeature, hasFeature } from '../_lib/agendaPlans.js'

const MAX_SERVICES = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MINE_COLS = 'id, provider_id, name, category, description, duration_min, price_cents, deposit_cents, active, display_order, created_at'

const int = (v, min, max, def) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

/**
 * Dono da chamada. Admin so quando pede um provider_id explicito: a conta de
 * admin que tambem e profissional usa o app normalmente (sem provider_id).
 */
async function resolveOwner(req, res, supabase) {
  const target = req.body?.provider_id || req.query?.provider_id
  if (target && await isAdmin(req)) {
    if (!UUID.test(String(target))) { res.status(400).json({ error: 'provider_id inválido' }); return null }
    return { providerId: String(target), provider: null, admin: true }
  }
  const auth = await requireProviderAuth(req, supabase)
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return null }
  return { providerId: auth.provider.id, provider: auth.provider, admin: false }
}

/** Bloqueio do plano (admin passa direto). Responde e devolve false se bloqueou. */
function gate(res, owner, key) {
  if (owner.admin) return true
  const g = requireFeature(owner.provider, key)
  if (!g.ok) { res.status(g.status).json(g.body); return false }
  return true
}

/** Sinal precisa de alguma forma de receber: Zelle/dinheiro (Starter) ou cartao (Pro). */
function depositAllowed(owner) {
  if (owner.admin) return true
  return hasFeature(owner.provider, 'deposit_offline') || hasFeature(owner.provider, 'deposit_stripe')
}

/** Campos de um servico. `existing` = linha atual (edicao): o que nao veio fica como esta. */
function readService(body, existing) {
  const name = clip(body.name, 120)
  if (!name) return { error: 'Dê um nome pro serviço' }
  if (body.price_cents == null || body.price_cents === '') return { error: 'Informe o preço' }
  const price = int(body.price_cents, 0, 1000000, 0)
  const out = {
    name,
    category: clip(body.category, 60),
    description: clip(body.description, 600),
    duration_min: int(body.duration_min, 5, 600, existing?.duration_min ?? 60),
    price_cents: price,
    deposit_cents: Math.min(int(body.deposit_cents, 0, 1000000, 0), price),
  }
  if (typeof body.active === 'boolean') out.active = body.active
  else if (!existing) out.active = true
  if (body.display_order != null && body.display_order !== '') out.display_order = int(body.display_order, 0, 999, 0)
  return { fields: out }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  try {
    if (req.method === 'GET') {
      if (req.query.mine) {
        const owner = await resolveOwner(req, res, supabase)
        if (!owner) return
        const { data, error } = await supabase.from('ag_services').select(MINE_COLS)
          .eq('provider_id', owner.providerId)
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        res.setHeader('Cache-Control', 'private, no-store')
        return res.status(200).json({ services: data || [] })
      }

      const { provider_id } = req.query
      if (!provider_id) return res.status(400).json({ error: 'provider_id obrigatório' })
      if (!UUID.test(String(provider_id))) return res.status(400).json({ error: 'provider_id inválido' })
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
      const owner = await resolveOwner(req, res, supabase)
      if (!owner) return
      if (!gate(res, owner, 'services')) return
      const providerId = owner.providerId
      const body = req.body || {}
      const action = body.action || null

      // ── Reordenar: a lista inteira na ordem nova ─────────────────────────
      if (action === 'reorder') {
        const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(id => UUID.test(id)) : null
        if (!ids || ids.length === 0) return res.status(400).json({ error: 'Lista de serviços vazia' })
        if (ids.length > MAX_SERVICES) return res.status(400).json({ error: 'Lista grande demais' })

        const { data: mine, error } = await supabase.from('ag_services').select('id, display_order, created_at')
          .eq('provider_id', providerId)
          .order('display_order', { ascending: true }).order('created_at', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        const own = new Set((mine || []).map(s => s.id))
        // So ids meus, sem repetir; os que ficaram de fora vao pro fim na ordem atual
        const order = [...new Set(ids.filter(id => own.has(id)))]
        for (const s of mine || []) if (!order.includes(s.id)) order.push(s.id)

        const results = await Promise.all(order.map((id, i) =>
          supabase.from('ag_services').update({ display_order: i }).eq('id', id).eq('provider_id', providerId)))
        const failed = results.find(r => r.error)
        if (failed) return res.status(500).json({ error: failed.error.message })

        const { data } = await supabase.from('ag_services').select(MINE_COLS)
          .eq('provider_id', providerId).order('display_order', { ascending: true })
        return res.status(200).json({ ok: true, services: data || [] })
      }

      // ── Pausar / reativar ────────────────────────────────────────────────
      if (action === 'set_active') {
        if (!UUID.test(String(body.id || ''))) return res.status(400).json({ error: 'id inválido' })
        if (typeof body.active !== 'boolean') return res.status(400).json({ error: 'active deve ser true ou false' })
        const { data, error } = await supabase.from('ag_services').update({ active: body.active })
          .eq('id', body.id).eq('provider_id', providerId).select(MINE_COLS).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Serviço não encontrado' })
        return res.status(200).json({ service: data })
      }

      // ── Varios de uma vez (sugestoes por especialidade) ──────────────────
      if (action === 'create_many') {
        const input = Array.isArray(body.services) ? body.services.slice(0, 10) : []
        if (input.length === 0) return res.status(400).json({ error: 'Nenhum serviço pra criar' })
        const { count } = await supabase.from('ag_services')
          .select('id', { count: 'exact', head: true }).eq('provider_id', providerId)
        const start = count || 0
        if (start + input.length > MAX_SERVICES) return res.status(400).json({ error: `Limite de ${MAX_SERVICES} serviços atingido` })

        const rows = []
        for (const [i, s] of input.entries()) {
          const r = readService(s || {}, null)
          if (r.error) return res.status(400).json({ error: r.error })
          if (r.fields.deposit_cents > 0 && !depositAllowed(owner)) r.fields.deposit_cents = 0
          rows.push({ ...r.fields, provider_id: providerId, display_order: start + i })
        }
        const { data, error } = await supabase.from('ag_services').insert(rows).select(MINE_COLS)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ ok: true, services: data || [] })
      }

      if (action) return res.status(400).json({ error: 'Ação inválida' })

      // ── Criar ou editar um ───────────────────────────────────────────────
      let existing = null
      if (body.id) {
        if (!UUID.test(String(body.id))) return res.status(400).json({ error: 'id inválido' })
        const { data } = await supabase.from('ag_services').select(MINE_COLS)
          .eq('id', body.id).eq('provider_id', providerId).maybeSingle()
        if (!data) return res.status(404).json({ error: 'Serviço não encontrado' })
        existing = data
      }

      const read = readService(body, existing)
      if (read.error) return res.status(400).json({ error: read.error })
      const payload = read.fields

      if (payload.deposit_cents > 0 && !depositAllowed(owner)) {
        const g = requireFeature(owner.provider, 'deposit_offline')
        return res.status(g.status).json(g.body)
      }

      let result
      if (existing) {
        // .eq('provider_id') garante que so mexe em servico proprio
        result = await supabase.from('ag_services').update(payload)
          .eq('id', existing.id).eq('provider_id', providerId).select(MINE_COLS).maybeSingle()
        if (!result.error && !result.data) return res.status(404).json({ error: 'Serviço não encontrado' })
      } else {
        const { count } = await supabase.from('ag_services')
          .select('id', { count: 'exact', head: true }).eq('provider_id', providerId)
        if ((count || 0) >= MAX_SERVICES) return res.status(400).json({ error: `Limite de ${MAX_SERVICES} serviços atingido` })
        // Servico novo entra no fim da lista
        if (payload.display_order == null) payload.display_order = count || 0
        result = await supabase.from('ag_services').insert({ ...payload, provider_id: providerId }).select(MINE_COLS).single()
      }
      if (result.error) return res.status(500).json({ error: result.error.message })
      return res.status(200).json({ service: result.data })
    }

    if (req.method === 'DELETE') {
      const owner = await resolveOwner(req, res, supabase)
      if (!owner) return
      if (!gate(res, owner, 'services')) return
      const providerId = owner.providerId
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id obrigatório' })
      if (!UUID.test(String(id))) return res.status(400).json({ error: 'id inválido' })

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
