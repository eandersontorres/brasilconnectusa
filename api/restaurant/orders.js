/**
 * /api/restaurant/orders
 *
 * GET  ?action=list&business_id=UUID&owner_email=X         -> lista pedidos do dono
 * POST ?action=update-status                               -> { business_id, owner_email, order_id, status }
 *      Atualiza status + dispara email pro cliente
 */
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

async function checkOwnership(supabase, business_id, owner_email) {
  const { data: biz } = await supabase
    .from('bc_businesses')
    .select('id, name, slug, owner_email, prep_time_min')
    .eq('id', business_id)
    .single()
  if (!biz) return { error: 'Negocio nao encontrado', status: 404 }
  const ownerOnRecord = (biz.owner_email || '').toLowerCase().trim()
  const requested = String(owner_email || '').toLowerCase().trim()
  if (!ownerOnRecord || ownerOnRecord !== requested) {
    return { error: 'Email nao bate', status: 403 }
  }
  return { biz }
}

const STATUS_LABELS_PT = {
  pending:    { emoji: '⏳', subject: 'Pedido recebido',          msg: 'Recebemos seu pedido e estamos confirmando.' },
  confirmed:  { emoji: '✅', subject: 'Pedido confirmado!',       msg: 'A cozinha já recebeu seu pedido e vai começar a preparar.' },
  preparing:  { emoji: '👨‍🍳', subject: 'Preparando seu pedido',   msg: 'Seu pedido está sendo preparado.' },
  ready:      { emoji: '🛍️', subject: 'Pronto pra retirar!',     msg: 'Seu pedido está pronto. Pode buscar.' },
  delivered:  { emoji: '🎉', subject: 'Pedido entregue',          msg: 'Bom apetite! Esperamos você de volta em breve.' },
  canceled:   { emoji: '❌', subject: 'Pedido cancelado',         msg: 'Infelizmente seu pedido foi cancelado. Se foi engano, tenta de novo ou fala com o restaurante.' },
}

async function sendStatusEmail(order, biz, newStatus) {
  if (!process.env.RESEND_API_KEY) return
  const lbl = STATUS_LABELS_PT[newStatus]
  if (!lbl) return
  const fromAddr = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect <oi@brasilconnectusa.com>'
  const trackUrl = (process.env.APP_URL || 'https://brasilconnectusa.com') + '/pedido/' + order.id
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [order.customer_email],
        subject: lbl.emoji + ' ' + lbl.subject + ' #' + order.order_number + ' — ' + biz.name,
        html: '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:20px;">'
          + '<div style="font-size:48px;text-align:center;margin-bottom:8px;">' + lbl.emoji + '</div>'
          + '<h2 style="text-align:center;color:#002776;">' + lbl.subject + '</h2>'
          + '<p style="font-size:15px;color:#374151;line-height:1.5;">Olá' + (order.customer_name ? ' ' + order.customer_name.split(' ')[0] : '') + ',</p>'
          + '<p style="font-size:15px;color:#374151;line-height:1.5;">' + lbl.msg + '</p>'
          + '<div style="background:#f9fafb;padding:14px;border-radius:8px;margin:18px 0;font-size:13px;">'
          +   '<b>Pedido #' + order.order_number + '</b><br>'
          +   '<b>Restaurante:</b> ' + biz.name + '<br>'
          +   '<b>Total:</b> $' + (order.total_cents / 100).toFixed(2)
          + '</div>'
          + '<p style="text-align:center;margin:24px 0;">'
          +   '<a href="' + trackUrl + '" style="background:#009c3b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Acompanhar pedido</a>'
          + '</p>'
          + '<p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:30px;">'
          +   'BrasilConnect USA · Comunidade brasileira nos Estados Unidos'
          + '</p>'
          + '</div>',
      }),
    }).catch(e => console.error('email error:', e.message))
  } catch (e) {
    console.error('sendStatusEmail error:', e.message)
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const action = req.query?.action

  try {
    const supabase = getSupabase()

    // GET list
    if (req.method === 'GET' && action === 'list') {
      const { business_id, owner_email, status, limit = 50 } = req.query
      if (!business_id || !owner_email) return res.status(400).json({ error: 'business_id e owner_email obrigatorios' })

      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      let q = supabase
        .from('bc_orders')
        .select('id, order_number, customer_email, customer_name, customer_phone, type, delivery_address, delivery_city, status, payment_status, subtotal_cents, total_cents, tip_cents, notes, created_at, confirmed_at, preparing_at, ready_at, delivered_at')
        .eq('business_id', business_id)
        .order('created_at', { ascending: false })
        .limit(Number(limit))

      if (status && status !== 'all') q = q.eq('status', status)

      const { data: orders, error } = await q
      if (error) throw error

      // Carrega items de cada pedido
      const orderIds = (orders || []).map(o => o.id)
      let itemsByOrder = {}
      if (orderIds.length) {
        const { data: items } = await supabase
          .from('bc_order_items')
          .select('order_id, item_name, quantity, subtotal_cents, notes')
          .in('order_id', orderIds)
        ;(items || []).forEach(i => {
          if (!itemsByOrder[i.order_id]) itemsByOrder[i.order_id] = []
          itemsByOrder[i.order_id].push(i)
        })
      }

      const enriched = (orders || []).map(o => ({ ...o, items: itemsByOrder[o.id] || [] }))

      // Conta novos (confirmed sem ack do dono) - opcional
      const newCount = enriched.filter(o => o.status === 'confirmed').length

      return res.status(200).json({ success: true, orders: enriched, new_count: newCount })
    }

    // POST update-status
    if (req.method === 'POST' && action === 'update-status') {
      const { business_id, owner_email, order_id, status: newStatus, cancel_reason } = req.body || {}
      if (!business_id || !owner_email || !order_id || !newStatus) {
        return res.status(400).json({ error: 'campos obrigatorios faltando' })
      }
      const validStatus = ['confirmed', 'preparing', 'ready', 'delivered', 'canceled']
      if (!validStatus.includes(newStatus)) return res.status(400).json({ error: 'status invalido' })

      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const tsField = {
        confirmed: 'confirmed_at',
        preparing: 'preparing_at',
        ready:     'ready_at',
        delivered: 'delivered_at',
        canceled:  'canceled_at',
      }[newStatus]

      const update = { status: newStatus }
      if (tsField) update[tsField] = new Date().toISOString()
      if (newStatus === 'canceled' && cancel_reason) update.cancel_reason = String(cancel_reason).slice(0, 500)

      const { data: order, error } = await supabase
        .from('bc_orders')
        .update(update)
        .eq('id', order_id)
        .eq('business_id', business_id)
        .select()
        .single()
      if (error) throw error
      if (!order) return res.status(404).json({ error: 'Pedido nao encontrado' })

      // Email pro cliente (best effort)
      sendStatusEmail(order, auth.biz, newStatus)

      // Push pro cliente (best effort)
      try {
        const { sendPushTo } = await import('../_lib/push.js')
        const lblMap = {
          confirmed:  { title: '✅ Pedido confirmado',     body: '' },
          preparing:  { title: '👨‍🍳 Preparando seu pedido', body: '' },
          ready:      { title: '🛍️ Pronto pra retirar!',   body: '' },
          delivered:  { title: '🎉 Pedido entregue',       body: 'Bom apetite!' },
          canceled:   { title: '❌ Pedido cancelado',      body: cancel_reason || '' },
        }
        const lbl = lblMap[newStatus]
        if (lbl) {
          await sendPushTo({
            user_email: order.customer_email,
            topic: 'restaurant_status',
            title: lbl.title,
            body: '#' + order.order_number + ' em ' + auth.biz.name + (lbl.body ? ' · ' + lbl.body : ''),
            url: '/pedido/' + order.id,
            type: 'restaurant_order_status',
            data: { order_id: order.id, status: newStatus },
          })
        }
      } catch (pushErr) {
        console.error('push status failed:', pushErr.message)
      }

      return res.status(200).json({ success: true, order })
    }

    return res.status(405).json({ error: 'Action invalida' })
  } catch (e) {
    console.error('orders handler error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
