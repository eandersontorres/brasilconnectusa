/**
 * POST /api/restaurant/order
 * Cria pedido + Stripe PaymentIntent com application_fee + transfer_data.destination.
 *
 * Body: {
 *   business_id, customer_email, customer_name, customer_phone,
 *   type: 'pickup' | 'delivery',
 *   delivery_address, delivery_city, delivery_state, delivery_zip, delivery_notes,
 *   notes,                                          // observacoes do cliente
 *   tip_cents,                                      // gorjeta opcional
 *   items: [{ menu_item_id, quantity, notes }]
 * }
 *
 * GET /api/restaurant/order?id=UUID
 * Retorna o pedido (status check)
 */
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  // GET: busca pedido por id (cliente acompanha status)
  if (req.method === 'GET') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id obrigatorio' })
    try {
      const supabase = getSupabase()
      const { data: order, error } = await supabase
        .from('bc_orders')
        .select('id, order_number, business_id, customer_name, customer_email, type, status, payment_status, subtotal_cents, delivery_fee_cents, tip_cents, total_cents, created_at, confirmed_at, ready_at, scheduled_for')
        .eq('id', id)
        .single()
      if (error || !order) return res.status(404).json({ error: 'Pedido nao encontrado' })

      const { data: items } = await supabase
        .from('bc_order_items')
        .select('item_name, quantity, unit_price_cents, subtotal_cents, notes')
        .eq('order_id', id)
        .order('id')

      const { data: biz } = await supabase
        .from('bc_businesses')
        .select('id, name, slug, prep_time_min, phone, whatsapp')
        .eq('id', order.business_id)
        .single()

      return res.status(200).json({ success: true, order, items: items || [], business: biz })
    } catch (e) {
      console.error('order GET error:', e.message)
      return res.status(500).json({ error: 'Erro: ' + e.message })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe nao configurado' })

  try {
    const supabase = getSupabase()
    const body = req.body || {}
    const {
      business_id, customer_email, customer_name, customer_phone,
      type = 'pickup', delivery_address, delivery_city, delivery_state, delivery_zip, delivery_notes,
      notes, tip_cents = 0, items = [],
    } = body

    if (!business_id || !customer_email || !items.length) {
      return res.status(400).json({ error: 'business_id, customer_email e items obrigatorios' })
    }
    if (type === 'delivery' && (!delivery_address || !delivery_zip)) {
      return res.status(400).json({ error: 'Endereco obrigatorio pra delivery' })
    }

    // Busca business + valida que aceita pedidos
    const { data: biz, error: bizErr } = await supabase
      .from('bc_businesses')
      .select('id, name, slug, accepts_orders, stripe_account_id, stripe_charges_enabled, delivery_fee_cents, min_order_cents, platform_fee_pct, pickup_only')
      .eq('id', business_id)
      .single()
    if (bizErr || !biz) return res.status(404).json({ error: 'Negocio nao encontrado' })
    if (!biz.accepts_orders) return res.status(400).json({ error: 'Negocio nao esta aceitando pedidos no momento' })
    if (!biz.stripe_charges_enabled || !biz.stripe_account_id) return res.status(400).json({ error: 'Negocio nao terminou setup de pagamentos' })
    if (type === 'delivery' && biz.pickup_only) return res.status(400).json({ error: 'Negocio so aceita retirada' })

    // Busca items do menu pra pegar precos atuais (server-side, nao confia no client)
    const itemIds = items.map(i => i.menu_item_id).filter(Boolean)
    const { data: menuItems } = await supabase
      .from('bc_menu_items')
      .select('id, name, price_cents, available')
      .in('id', itemIds)
      .eq('business_id', business_id)

    const menuMap = {}
    ;(menuItems || []).forEach(m => { menuMap[m.id] = m })

    // Monta items do pedido com precos do server
    const orderItems = []
    let subtotal = 0
    for (const reqItem of items) {
      const menu = menuMap[reqItem.menu_item_id]
      if (!menu) return res.status(400).json({ error: 'Item invalido: ' + reqItem.menu_item_id })
      if (!menu.available) return res.status(400).json({ error: '"' + menu.name + '" esta esgotado' })
      const qty = Math.max(1, Math.min(99, parseInt(reqItem.quantity) || 1))
      const itemSubtotal = menu.price_cents * qty
      subtotal += itemSubtotal
      orderItems.push({
        menu_item_id: menu.id,
        item_name: menu.name,
        unit_price_cents: menu.price_cents,
        quantity: qty,
        notes: reqItem.notes ? String(reqItem.notes).slice(0, 200) : null,
        subtotal_cents: itemSubtotal,
      })
    }

    // Validacao minimo
    if (subtotal < (biz.min_order_cents || 0)) {
      return res.status(400).json({
        error: 'Pedido minimo: $' + ((biz.min_order_cents || 0) / 100).toFixed(2),
      })
    }

    // Calcula totais
    const deliveryFee = type === 'delivery' ? (biz.delivery_fee_cents || 0) : 0
    const tip = Math.max(0, parseInt(tip_cents) || 0)
    const platformFeePct = parseFloat(biz.platform_fee_pct || 2.5)
    const platformFee = Math.round(subtotal * (platformFeePct / 100))   // nossa fee soh sobre subtotal (nao sobre tip nem delivery)
    const total = subtotal + deliveryFee + tip

    // Cria order no DB primeiro (status pending)
    const { data: order, error: orderErr } = await supabase
      .from('bc_orders')
      .insert({
        business_id,
        customer_email: String(customer_email).toLowerCase().trim(),
        customer_name: customer_name ? String(customer_name).slice(0, 200) : null,
        customer_phone: customer_phone ? String(customer_phone).slice(0, 30) : null,
        type,
        delivery_address: type === 'delivery' ? String(delivery_address || '').slice(0, 300) : null,
        delivery_city: type === 'delivery' ? String(delivery_city || '').slice(0, 100) : null,
        delivery_state: type === 'delivery' ? String(delivery_state || '').slice(0, 2) : null,
        delivery_zip: type === 'delivery' ? String(delivery_zip || '').slice(0, 10) : null,
        delivery_notes: delivery_notes ? String(delivery_notes).slice(0, 500) : null,
        notes: notes ? String(notes).slice(0, 1000) : null,
        subtotal_cents: subtotal,
        delivery_fee_cents: deliveryFee,
        tip_cents: tip,
        total_cents: total,
        platform_fee_cents: platformFee,
        status: 'pending',
        payment_status: 'unpaid',
      })
      .select()
      .single()
    if (orderErr) throw orderErr

    // Insere items
    const itemsToInsert = orderItems.map(i => ({ ...i, order_id: order.id }))
    await supabase.from('bc_order_items').insert(itemsToInsert)

    // Cria Stripe PaymentIntent com split
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    const intent = await stripe.paymentIntents.create({
      amount: total,                                    // total em cents
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      application_fee_amount: platformFee,             // nossa parte
      transfer_data: { destination: biz.stripe_account_id },
      receipt_email: order.customer_email,
      description: 'Pedido #' + order.order_number + ' em ' + biz.name,
      metadata: {
        type: 'restaurant_order',
        order_id: order.id,
        business_id: biz.id,
        order_number: String(order.order_number),
      },
    })

    // Salva intent_id no pedido
    await supabase
      .from('bc_orders')
      .update({ stripe_payment_intent_id: intent.id })
      .eq('id', order.id)

    return res.status(200).json({
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      client_secret: intent.client_secret,
      total_cents: total,
      platform_fee_cents: platformFee,
    })
  } catch (e) {
    console.error('order POST error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
