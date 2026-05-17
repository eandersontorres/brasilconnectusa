/**
 * GET /api/admin/restaurant-orders
 *
 * Lista TODOS os pedidos de restaurante da plataforma, com filtros e métricas
 * agregadas. Visão admin/global (não scoped a um business específico).
 *
 * Query params:
 *   ?id=<uuid>             — retorna 1 pedido específico com items + business + timeline
 *   ?status=<string>       — filtra (pending|confirmed|preparing|ready|delivered|canceled)
 *   ?business_id=<uuid>    — filtra por restaurante específico
 *   ?days=<int>            — janela de dias atrás (default 30, max 365)
 *   ?limit=<int>           — paginação (default 100, max 500)
 *
 * Resposta (lista):
 *   { orders: [...], summary: { today, week, total_gmv_cents, platform_revenue_cents, ... } }
 *
 * Resposta (detalhe com ?id):
 *   { order: {...}, items: [...], business: {...} }
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Auth
  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    // ─── Modo DETALHE ──────────────────────────────────────────
    if (req.query.id) {
      const { data: order, error } = await supabase
        .from('bc_orders')
        .select('*')
        .eq('id', req.query.id)
        .single()
      if (error || !order) return res.status(404).json({ error: 'Pedido não encontrado' })

      const { data: items } = await supabase
        .from('bc_order_items')
        .select('*')
        .eq('order_id', order.id)
        .order('id', { ascending: true })

      const { data: business } = await supabase
        .from('bc_businesses')
        .select('id, name, slug, owner_email, city, state')
        .eq('id', order.business_id)
        .single()

      return res.status(200).json({ order, items: items || [], business })
    }

    // ─── Modo LISTA ────────────────────────────────────────────
    const days   = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 1), 365)
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500)
    const status = req.query.status
    const bizId  = req.query.business_id

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    let q = supabase
      .from('bc_orders')
      .select(`
        id, order_number, business_id, customer_email, customer_name,
        type, status, payment_status,
        subtotal_cents, total_cents, platform_fee_cents,
        created_at, delivered_at, canceled_at,
        bc_businesses!inner(id, name, slug, city, state)
      `)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) q = q.eq('status', status)
    if (bizId)  q = q.eq('business_id', bizId)

    const { data: orders, error } = await q
    if (error) throw error

    // Métricas agregadas (separado pra não bater no limite)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const week  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const { data: all } = await supabase
      .from('bc_orders')
      .select('total_cents, platform_fee_cents, status, payment_status, created_at')
      .gte('created_at', sinceIso)

    const summary = {
      window_days:                  days,
      total_orders:                 all?.length || 0,
      orders_today:                 (all || []).filter(o => new Date(o.created_at) >= today).length,
      orders_week:                  (all || []).filter(o => new Date(o.created_at) >= week).length,
      total_gmv_cents:              (all || []).filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.total_cents || 0), 0),
      platform_revenue_cents:       (all || []).filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.platform_fee_cents || 0), 0),
      pending_count:                (all || []).filter(o => o.status === 'pending').length,
      preparing_count:              (all || []).filter(o => o.status === 'preparing').length,
      delivered_count:              (all || []).filter(o => o.status === 'delivered').length,
      canceled_count:               (all || []).filter(o => o.status === 'canceled').length,
    }

    return res.status(200).json({ success: true, orders: orders || [], summary })
  } catch (e) {
    console.error('admin/restaurant-orders error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
