/**
 * BrasilConnect Store — operacoes de pedido que mexem com dinheiro.
 *
 * Toda mudanca de estado que envolve Stripe passa por aqui, para que o painel
 * do vendedor, a area do comprador, o admin, o cron e o webhook sigam as mesmas
 * regras:
 *
 *   markCheckoutPaid   webhook checkout.session.completed (retomavel; o cron repara)
 *   expireCheckout     webhook checkout.session.expired / cron (devolve estoque)
 *   cancelOrder        antes do envio: reembolso integral + estoque de volta
 *   refundOrder        depois do envio: reembolso parcial/total (+ estorno do repasse se ja saiu)
 *   releaseOrder       repasse ao vendedor (transfer com source_transaction)
 *   releaseDueAt       quando o repasse fica liberado
 *   markShipped / markDelivered / applyTracking
 *
 * Pagamento = separate charges and transfers: a cobranca fica no saldo da
 * plataforma (transfer_group STORE_<checkout_id>) e cada pedido vira um
 * transfer para a conta Express do vendedor quando for liberado.
 *
 * Concorrencia: reembolso e repasse disputam o mesmo dinheiro. O repasse trava
 * o pedido em payout_status='releasing'; o reembolso reserva o valor somando
 * refunded_cents com guarda no valor antigo. Um bloqueia o outro.
 */
import {
  APP_URL, getConfig, computeFee, computePayout, computeShipBy, addDays, logEvent, notify, notifyAdmin,
  esc, fmtUSD, ORDER_STATUS_PT, isBanned,
} from './store.js'
import { shippoEnabled, normalizeCarrier } from './shippo.js'

export const ACTIVE_DISPUTES = ['open', 'escalated', 'chargeback']
export const buyerOrderUrl = (o) => '/store/pedidos/' + o.id
export const sellerOrderUrl = (o) => '/store/painel?pedido=' + o.id

const CANCELED_BY_PT = {
  buyer: 'pelo comprador',
  seller: 'pela loja',
  admin: 'pela BrasilConnect',
  system: 'automaticamente (prazo vencido)',
}

export async function loadOrder(supabase, id) {
  const { data: order } = await supabase.from('bc_store_orders').select('*').eq('id', id).maybeSingle()
  if (!order) return null
  const { data: items } = await supabase.from('bc_store_order_items').select('*').eq('order_id', id).order('created_at')
  return { ...order, items: items || [] }
}

async function freshOrder(supabase, id) {
  const { data, error } = await supabase.from('bc_store_orders').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error('pedido: ' + error.message)
  return data
}

async function loadItems(supabase, orderIds) {
  if (!orderIds.length) return []
  const { data } = await supabase.from('bc_store_order_items').select('*').in('order_id', orderIds)
  return data || []
}

async function releaseStock(supabase, items) {
  for (const it of items) {
    if (!it.product_id) continue
    const { error } = await supabase.rpc('bc_store_release_stock', { p_product: it.product_id, p_qty: it.quantity })
    if (error) console.error('[store] release_stock falhou:', it.product_id, error.message)
  }
}

const chargeOf = (pi) => (pi?.latest_charge ? (typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge.id) : null)

/** Pede o reembolso de uma etiqueta comprada e nao usada (best effort). */
async function voidLabel(supabase, order) {
  if (order.label_status !== 'purchased' || !order.shippo_transaction_id) return false
  try {
    const { refundLabel } = await import('./shippo.js')
    const { data: seller } = await supabase.from('bc_store_sellers').select('shippo_account_id').eq('id', order.seller_id).maybeSingle()
    await refundLabel({ transactionId: order.shippo_transaction_id, accountId: seller?.shippo_account_id || null })
    await supabase.from('bc_store_orders').update({ label_status: 'refund_requested' }).eq('id', order.id).eq('label_status', 'purchased')
    return true
  } catch (e) {
    console.error('[store] reembolso de etiqueta falhou:', e.message)
    return false
  }
}

const neverScanned = (o) => ['PRE_TRANSIT', 'UNKNOWN', ''].includes(String(o.tracking_status || '').toUpperCase())

// ─────────────────────────────────────────────────────────────────────────────
// Checkout pago (retomavel: se uma rodada morrer no meio, a proxima termina)
// ─────────────────────────────────────────────────────────────────────────────
export async function markCheckoutPaid(supabase, stripe, { checkoutId, session }) {
  const { data: co, error: coErr } = await supabase.from('bc_store_checkouts').select('*').eq('id', checkoutId).maybeSingle()
  if (coErr) throw new Error('checkout: ' + coErr.message)
  if (!co) { console.error('[store] checkout nao encontrado', checkoutId); return { ok: false } }

  const alreadyPaid = co.status === 'paid'
  const { data: orders0, error: oErr } = await supabase.from('bc_store_orders').select('*').eq('checkout_id', co.id).order('order_number')
  if (oErr) throw new Error('pedidos: ' + oErr.message)
  if (alreadyPaid && !(orders0 || []).some(o => o.status === 'pending_payment')) return { ok: true, already: true }

  // PI e cobranca antes de tudo: sem a cobranca o repasse nunca sai. Se falhar,
  // lanca: o webhook libera o evento e o Stripe reenvia.
  const piId = (typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id) || co.stripe_payment_intent_id
  if (!piId) throw new Error('checkout pago sem payment_intent')
  const pi = await stripe.paymentIntents.retrieve(piId)
  const chargeId = chargeOf(pi) || co.stripe_charge_id
  if (!chargeId) throw new Error('payment_intent sem cobranca: ' + piId)

  const paidAt = alreadyPaid && co.paid_at ? new Date(co.paid_at) : new Date()
  const taxTotal = alreadyPaid ? (co.tax_cents || 0) : Math.max(0, session?.total_details?.amount_tax || 0)

  if (!alreadyPaid) {
    // Pagamento chegou depois de o checkout ter sido expirado localmente:
    // volta os pedidos e tenta reservar o estoque de novo.
    if (co.status !== 'pending' || co.stock_released) {
      await supabase.from('bc_store_orders').update({ status: 'pending_payment', payout_status: 'pending' })
        .eq('checkout_id', co.id).eq('status', 'expired')
      if (co.stock_released) {
        const items0 = await loadItems(supabase, (orders0 || []).map(o => o.id))
        let short = false
        for (const it of items0) {
          if (!it.product_id) continue
          const { data: ok } = await supabase.rpc('bc_store_reserve_stock', { p_product: it.product_id, p_qty: it.quantity })
          if (!ok) short = true
        }
        if (short) await notifyAdmin('Store: pagamento recebido sem estoque', [`O checkout <strong>${esc(co.id)}</strong> foi pago depois de expirar e algum item ficou sem estoque. Confira e reembolse se precisar.`])
      }
    }
    const { error: upErr } = await supabase.from('bc_store_checkouts').update({
      status: 'paid',
      paid_at: paidAt.toISOString(),
      stripe_payment_intent_id: pi?.id || piId,
      stripe_charge_id: chargeId,
      tax_cents: taxTotal,
      total_cents: session?.amount_total ?? co.total_cents,
      stock_released: false,
    }).eq('id', co.id).neq('status', 'paid')
    if (upErr) throw new Error('checkout update: ' + upErr.message)
  } else if (!co.stripe_charge_id) {
    await supabase.from('bc_store_checkouts').update({ stripe_charge_id: chargeId }).eq('id', co.id)
  }

  const { data: orders1, error: o1Err } = await supabase.from('bc_store_orders').select('*').eq('checkout_id', co.id).order('order_number')
  if (o1Err) throw new Error('pedidos: ' + o1Err.message)
  const list = orders1 || []
  const items = await loadItems(supabase, list.map(o => o.id))

  // Imposto (Stripe Tax) rateado entre os pedidos pela base itens+frete
  const base = list.reduce((s, o) => s + o.items_cents + o.shipping_cents, 0) || 1
  let taxLeft = taxTotal
  const sellerIds = [...new Set(list.map(o => o.seller_id))]
  const { data: sellers } = await supabase.from('bc_store_sellers').select('id, user_id, email, name, slug, handling_days, status')
    .in('id', sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000'])
  const sellerMap = Object.fromEntries((sellers || []).map(s => [s.id, s]))
  const payable = {}
  for (const s of sellers || []) payable[s.id] = s.status === 'approved' && !(await isBanned(supabase, s.user_id))

  let promotedAny = false
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    const tax = i === list.length - 1 ? taxLeft : Math.round(taxTotal * (o.items_cents + o.shipping_cents) / base)
    taxLeft -= tax
    if (o.status !== 'pending_payment') continue
    const seller = sellerMap[o.seller_id]
    const ok = !!seller && payable[o.seller_id]
    const shipBy = computeShipBy(paidAt, seller?.handling_days || 2)
    const { data: promoted, error: pErr } = await supabase.from('bc_store_orders').update({
      status: 'paid', paid_at: paidAt.toISOString(), ship_by: shipBy.toISOString(),
      tax_cents: tax, total_cents: o.items_cents + o.shipping_cents + tax,
      payout_status: ok ? 'pending' : 'held', hold_reason: ok ? null : 'seller_suspended',
    }).eq('id', o.id).eq('status', 'pending_payment').select('id')
    if (pErr) throw new Error('pedido ' + o.id + ': ' + pErr.message)
    if (!promoted || !promoted.length) continue
    promotedAny = true
    await logEvent(supabase, o.id, 'paid', { actor: 'stripe', message: 'Pagamento confirmado' })

    const oItems = items.filter(x => x.order_id === o.id)
    for (const it of oItems) {
      if (it.product_id) await supabase.rpc('bc_store_product_sold', { p_product: it.product_id, p_qty: it.quantity })
    }

    if (!ok) {
      await notifyAdmin(`Store: pedido #${o.order_number} pago para loja suspensa`, [`A loja <strong>${esc(seller?.name || o.seller_id)}</strong> não está aprovada (ou o dono foi banido). O repasse ficou retido. Cancele e reembolse o pedido pelo admin se a loja não puder entregar.`])
      continue
    }
    const prazo = shipBy.toLocaleDateString('pt-BR', { timeZone: 'America/New_York', weekday: 'long', day: '2-digit', month: 'long' })
    const local = o.fulfillment !== 'ship'
    await notify({
      user_id: seller.user_id, email: seller.email,
      type: 'store_order_new', icon: '🛍️',
      title: `Novo pedido #${o.order_number} · ${fmtUSD(o.items_cents + o.shipping_cents)}`,
      body: `${oItems.length} item(ns). ${local ? 'Entregue ou registre a data combinada' : 'Poste'} até ${prazo}.`,
      url: sellerOrderUrl(o), metadata: { order_id: o.id },
      mail: {
        subject: `Novo pedido #${o.order_number} na sua loja`,
        kicker: 'BRASILCONNECT STORE · NOVO PEDIDO',
        title: `Pedido #${o.order_number} pago`,
        paragraphs: [
          oItems.map(it => `${it.quantity}× <strong>${esc(it.title)}</strong>`).join('<br>'),
          `Total do pedido: <strong>${fmtUSD(o.items_cents + o.shipping_cents)}</strong> (${o.fulfillment === 'ship' ? 'envio' : o.fulfillment === 'pickup' ? 'retirada' : 'entrega local'}).`,
          local
            ? `Prazo para entregar, ou para registrar no painel a data combinada com o comprador: <strong>${esc(prazo)}</strong>. Sem isso, o pedido é cancelado e o comprador reembolsado.`
            : `Prazo para postar: <strong>${esc(prazo)}</strong>. Depois disso o pedido é cancelado e o comprador reembolsado.`,
        ],
        ctaUrl: APP_URL + sellerOrderUrl(o), ctaLabel: 'Abrir o pedido',
      },
    })
  }

  // Comprador: um aviso com todas as lojas (so na primeira vez)
  if (promotedAny && !alreadyPaid && list[0]) {
    const lojas = sellerIds.map(id => sellerMap[id]?.name).filter(Boolean)
    const total = session?.amount_total ?? co.total_cents
    await notify({
      user_id: co.buyer_user_id, email: co.buyer_email,
      type: 'store_order_paid', icon: '✅',
      title: 'Compra confirmada na Store',
      body: `Pagamento de ${fmtUSD(total)} confirmado. ${lojas.length > 1 ? 'As lojas vão' : 'A loja vai'} enviar e você recebe o rastreio por aqui.`,
      url: list.length === 1 ? buyerOrderUrl(list[0]) : '/store/pedidos',
      metadata: { checkout_id: co.id },
      mail: {
        subject: 'Sua compra na BrasilConnect Store foi confirmada',
        title: 'Compra confirmada',
        paragraphs: [
          `Recebemos seu pagamento de <strong>${fmtUSD(total)}</strong>.`,
          list.map(o => `Pedido <strong>#${o.order_number}</strong> · ${esc(sellerMap[o.seller_id]?.name || 'Loja')}`).join('<br>'),
          'Cada loja envia o próprio pacote e é responsável pelo envio e pela garantia. O dinheiro só é repassado à loja depois da entrega.',
        ],
        ctaUrl: APP_URL + '/store/pedidos', ctaLabel: 'Ver meus pedidos',
      },
    })
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout nao pago: devolve estoque
// ─────────────────────────────────────────────────────────────────────────────
export async function expireCheckout(supabase, checkoutId, { reason = 'expired' } = {}) {
  const { data: claimed } = await supabase.from('bc_store_checkouts')
    .update({ status: reason === 'canceled' ? 'canceled' : 'expired', stock_released: true, closed_at: new Date().toISOString() })
    .eq('id', checkoutId).eq('status', 'pending').eq('stock_released', false)
    .select('id')
  if (!claimed || !claimed.length) return { ok: true, skipped: true }
  const { data: orders } = await supabase.from('bc_store_orders').select('id').eq('checkout_id', checkoutId)
  const ids = (orders || []).map(o => o.id)
  await releaseStock(supabase, await loadItems(supabase, ids))
  if (ids.length) {
    await supabase.from('bc_store_orders').update({ status: 'expired', payout_status: 'none' }).in('id', ids).eq('status', 'pending_payment')
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancelar antes do envio (reembolso integral)
// ─────────────────────────────────────────────────────────────────────────────
export async function cancelOrder(supabase, stripe, order, { by = 'system', reason = null, actor_id = null } = {}) {
  if (order.status !== 'paid') return { ok: false, error: 'Só dá para cancelar pedido pago que ainda não foi enviado.' }
  if (order.label_status === 'purchasing') return { ok: false, error: 'A etiqueta deste pedido está sendo gerada. Tente de novo em alguns minutos.' }
  const { data: co } = await supabase.from('bc_store_checkouts').select('id, stripe_payment_intent_id').eq('id', order.checkout_id).maybeSingle()
  if (!co?.stripe_payment_intent_id) return { ok: false, error: 'Pagamento do pedido não encontrado.' }

  // Trava: so um cancelamento passa, e nada de reembolso parcial no meio
  const now = new Date().toISOString()
  const prevPayout = order.payout_status || 'pending'
  const { data: claimed } = await supabase.from('bc_store_orders')
    .update({ status: 'canceled', canceled_at: now, canceled_by: by, cancel_reason: reason ? String(reason).slice(0, 500) : null, payout_status: 'none' })
    .eq('id', order.id).eq('status', 'paid').eq('refunded_cents', order.refunded_cents || 0).neq('label_status', 'purchasing')
    .select('id')
  if (!claimed || !claimed.length) return { ok: false, error: 'O pedido mudou de situação. Atualize a página.' }

  const amount = Math.max(0, order.total_cents - (order.refunded_cents || 0))
  let refund = null
  if (amount > 0) {
    try {
      refund = await stripe.refunds.create(
        { payment_intent: co.stripe_payment_intent_id, amount, metadata: { type: 'store_order', order_id: order.id, reason: 'cancel' } },
        { idempotencyKey: `store_cancel_${order.id}` },
      )
    } catch (e) {
      // Desfaz a trava para tentar de novo
      await supabase.from('bc_store_orders').update({ status: 'paid', canceled_at: null, canceled_by: null, cancel_reason: null, payout_status: prevPayout }).eq('id', order.id).eq('status', 'canceled')
      return { ok: false, error: 'O reembolso falhou no Stripe: ' + e.message }
    }
  }
  await supabase.from('bc_store_orders').update({
    refunded_cents: (order.refunded_cents || 0) + amount,
    stripe_refund_ids: refund ? [...(order.stripe_refund_ids || []), refund.id] : (order.stripe_refund_ids || []),
  }).eq('id', order.id)

  const items = order.items || await loadItems(supabase, [order.id])
  await releaseStock(supabase, items)
  await voidLabel(supabase, order)

  const who = CANCELED_BY_PT[by] || by
  await logEvent(supabase, order.id, 'canceled', { actor: by, actor_id, message: `Cancelado ${who}${reason ? ': ' + reason : ''}`, data: { refund_cents: amount } })
  await notifyOrderParties(supabase, order, {
    type: 'store_order_canceled', icon: '↩️',
    buyerTitle: `Pedido #${order.order_number} cancelado`,
    buyerBody: `Cancelado ${who}. Reembolso de ${fmtUSD(amount)} no cartão (pode levar 5 a 10 dias úteis).`,
    sellerTitle: `Pedido #${order.order_number} cancelado`,
    sellerBody: `Cancelado ${who}. O comprador foi reembolsado e o estoque voltou.`,
    reason,
  })
  return { ok: true, refunded_cents: amount, canceled: true, full: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reembolso depois do envio (garantia, acordo, decisao do admin)
//   actor 'seller': se o repasse ja saiu, estorna da loja ANTES de reembolsar;
//                   sem saldo na conta da loja, nao reembolsa (vai para o admin).
//   admin/sistema:  reembolsa (protege o comprador); se o estorno falhar, o valor
//                   vira divida da loja (debt_cents), abatida dos proximos repasses.
// ─────────────────────────────────────────────────────────────────────────────
export async function refundOrder(supabase, stripe, order, { amount_cents, reason = null, actor = 'admin', actor_id = null } = {}) {
  const cur = await freshOrder(supabase, order.id)
  if (!cur) return { ok: false, error: 'Pedido não encontrado.' }
  const refundable = Math.max(0, cur.total_cents - (cur.refunded_cents || 0))
  const amount = Math.min(refundable, Math.max(0, Math.floor(Number(amount_cents) || 0)))
  if (amount <= 0) return { ok: false, error: 'Nada a reembolsar.' }
  if (!['shipped', 'delivered', 'completed', 'paid'].includes(cur.status)) return { ok: false, error: 'Esse pedido não aceita reembolso.' }
  if (cur.payout_status === 'releasing') return { ok: false, error: 'O repasse deste pedido está sendo processado agora. Tente de novo em instantes.' }
  if (cur.label_status === 'purchasing') return { ok: false, error: 'A etiqueta deste pedido está sendo gerada. Tente de novo em alguns minutos.' }
  // Reembolso total antes do envio = cancelamento (devolve estoque, trava o pedido)
  if (cur.status === 'paid' && amount === refundable) {
    const items = await loadItems(supabase, [cur.id])
    return cancelOrder(supabase, stripe, { ...cur, items }, { by: actor, reason, actor_id })
  }
  const { data: co } = await supabase.from('bc_store_checkouts').select('id, stripe_payment_intent_id').eq('id', cur.checkout_id).maybeSingle()
  if (!co?.stripe_payment_intent_id) return { ok: false, error: 'Pagamento do pedido não encontrado.' }

  // Reserva o valor: serializa reembolsos e bloqueia o repasse ao mesmo tempo
  const old = cur.refunded_cents || 0
  const newTotal = old + amount
  const { data: reserved, error: rErr } = await supabase.from('bc_store_orders').update({ refunded_cents: newTotal })
    .eq('id', cur.id).eq('refunded_cents', old).neq('payout_status', 'releasing').select('id')
  if (rErr) return { ok: false, error: 'Erro ao reservar o reembolso: ' + rErr.message }
  if (!reserved || !reserved.length) return { ok: false, error: 'O pedido mudou de situação. Atualize a página e tente de novo.' }
  const undo = () => supabase.from('bc_store_orders').update({ refunded_cents: old }).eq('id', cur.id).eq('refunded_cents', newTotal)

  // Repasse ja acertado (transfer e/ou divida antiga abatida): a loja recebeu
  // V = payout_cents + debt_applied_cents. Depois deste reembolso ela deve ficar
  // com E' (computePayout). A diferenca volta por estorno (ate o que foi
  // transferido) e, o que nao der, vira divida de novo. Tudo cumulativo.
  const settled = !!cur.completed_at && cur.payout_cents != null
  const released = settled && !!cur.stripe_transfer_id
  let reverse = 0
  let debtBack = 0
  if (settled) {
    const value = (cur.payout_cents || 0) + (cur.debt_applied_cents || 0)
    const after = computePayout({ ...cur, refunded_cents: newTotal }).payout_cents
    const needed = Math.max(0, Math.max(0, value - after) - (cur.reversed_cents || 0) - (cur.debt_restored_cents || 0))
    const maxRev = cur.stripe_transfer_id ? Math.max(0, (cur.payout_cents || 0) - (cur.reversed_cents || 0)) : 0
    reverse = Math.min(needed, maxRev)
    debtBack = needed - reverse
  }

  const patch = {}
  let reversed = false
  let debtAdded = 0
  let reversalFailed = false
  let reversalNote = null
  const doReversal = async () => {
    const rv = await stripe.transfers.createReversal(cur.stripe_transfer_id,
      { amount: reverse, metadata: { type: 'store_refund', order_id: cur.id } },
      { idempotencyKey: `store_rev_${cur.id}_${cur.reversed_cents || 0}_${reverse}` })
    patch.stripe_reversal_ids = [...(cur.stripe_reversal_ids || []), rv.id]
    patch.reversed_cents = (cur.reversed_cents || 0) + reverse
    reversed = true
  }

  if (reverse > 0 && actor === 'seller') {
    try {
      await doReversal()
    } catch (e) {
      await undo()
      return { ok: false, error: `Seu saldo no Stripe não cobre o estorno de ${fmtUSD(reverse)} deste repasse. Fale com a BrasilConnect (oi@brasilconnectusa.com) para concluir esse reembolso.` }
    }
    // grava ja: uma nova tentativa nao estorna duas vezes
    await supabase.from('bc_store_orders').update({ stripe_reversal_ids: patch.stripe_reversal_ids, reversed_cents: patch.reversed_cents }).eq('id', cur.id)
  }

  let refund
  try {
    refund = await stripe.refunds.create(
      { payment_intent: co.stripe_payment_intent_id, amount, metadata: { type: 'store_order', order_id: cur.id, reason: reason ? String(reason).slice(0, 200) : 'refund' } },
      { idempotencyKey: `store_refund_${cur.id}_${old}_${amount}` },
    )
  } catch (e) {
    await undo()
    return { ok: false, error: 'O reembolso falhou no Stripe: ' + e.message + (reversed ? ' O estorno do repasse já foi feito; tente o reembolso de novo.' : '') }
  }
  patch.stripe_refund_ids = [...(cur.stripe_refund_ids || []), refund.id]

  let reversalError = null
  if (reverse > 0 && actor !== 'seller') {
    try {
      await doReversal()
    } catch (e) {
      reversalFailed = true
      reversalError = e.message
      debtBack += reverse
    }
  }
  // O que nao voltou por estorno vira divida da loja (sai dos proximos repasses)
  if (debtBack > 0) {
    const { error: dErr } = await supabase.rpc('bc_store_add_debt', { p_seller: cur.seller_id, p_cents: debtBack })
    if (!dErr) {
      debtAdded = debtBack
      patch.debt_restored_cents = (cur.debt_restored_cents || 0) + debtBack
    }
  }
  if (reversalFailed) {
    patch.hold_reason = 'reversal_failed'
    await notifyAdmin('Store: estorno de repasse falhou', [`Pedido <strong>#${cur.order_number}</strong>: reembolso de ${fmtUSD(amount)} feito, mas o estorno de ${fmtUSD(reverse)} da loja falhou (${esc(reversalError)}). ${debtAdded ? 'O valor ficou como débito da loja e sai dos próximos repasses.' : 'Não deu para registrar o débito: cobre a loja manualmente.'}`])
  }
  if (reversed && debtAdded) reversalNote = `Estornado ${fmtUSD(reverse)} do repasse da loja; ${fmtUSD(debtAdded)} ficam como débito e saem dos próximos repasses.`
  else if (reversed) reversalNote = `Estornado ${fmtUSD(reverse)} do repasse da loja.`
  else if (debtAdded) reversalNote = `${fmtUSD(debtAdded)} deste reembolso ficam como débito da loja e saem dos próximos repasses.`

  const full = newTotal >= cur.total_cents
  if (full) {
    if (cur.status !== 'paid') patch.status = 'refunded'
    if (!released) patch.payout_status = 'none'
    else patch.payout_status = reversalFailed ? 'released' : 'reversed'
  }
  const { error: pErr } = await supabase.from('bc_store_orders').update(patch).eq('id', cur.id)
  if (pErr) console.error('[store] refund patch falhou:', cur.id, pErr.message)

  // Reembolso total de pacote que nunca foi escaneado: etiqueta e estoque voltam
  if (full && cur.label_status === 'purchased' && neverScanned(cur)) {
    await voidLabel(supabase, cur)
    await releaseStock(supabase, await loadItems(supabase, [cur.id]))
  }

  await logEvent(supabase, cur.id, 'refunded', { actor, actor_id, message: `Reembolso de ${fmtUSD(amount)}${reason ? ': ' + reason : ''}`, data: { amount_cents: amount, full, reversed_cents: reversed ? reverse : 0, debt_cents: debtAdded } })
  await notifyOrderParties(supabase, cur, {
    type: 'store_order_refunded', icon: '💸',
    buyerTitle: `Reembolso de ${fmtUSD(amount)} · pedido #${cur.order_number}`,
    buyerBody: 'O valor volta para o cartão em 5 a 10 dias úteis.',
    sellerTitle: `Reembolso de ${fmtUSD(amount)} no pedido #${cur.order_number}`,
    sellerBody: reversalNote || 'O valor sai do repasse deste pedido.',
    reason,
  })
  return { ok: true, refunded_cents: amount, full, reversed_cents: reversed ? reverse : 0, debt_cents: debtAdded }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repasse
// ─────────────────────────────────────────────────────────────────────────────
/** Data em que o repasse fica liberado, ou null se nao ha o que liberar. */
export function releaseDueAt(order, cfg, { newSeller = false } = {}) {
  if (ACTIVE_DISPUTES.includes(order.dispute_status)) return null
  if (!['pending', 'blocked'].includes(order.payout_status)) return null
  if (order.stripe_transfer_id) return null
  if (order.buyer_confirmed_at && ['shipped', 'delivered'].includes(order.status)) return new Date(order.buyer_confirmed_at)
  if (order.status === 'delivered' && order.delivered_at) {
    let days
    if (order.fulfillment === 'ship') {
      // Envio sem etiqueta da Store (rastreio informado pela loja) segue o prazo maior
      const cautious = newSeller || order.label_status !== 'purchased'
      days = cautious ? Math.max(cfg.release_days_new_seller, cfg.release_days_after_delivery) : cfg.release_days_after_delivery
    } else {
      days = newSeller ? Math.max(cfg.release_days_new_seller, cfg.local_release_days) : cfg.local_release_days
    }
    return addDays(order.delivered_at, days)
  }
  // Sem confirmacao de entrega: so libera se a transportadora ja escaneou o pacote.
  // Envio que nao da para acompanhar (transportadora "Outro" ou Shippo desligada)
  // libera no prazo de seguranca, como antes.
  if (order.status === 'shipped' && order.shipped_at && order.fulfillment === 'ship') {
    const trackable = shippoEnabled() && !!normalizeCarrier(order.carrier)
    if (trackable && String(order.tracking_status || '').toUpperCase() !== 'TRANSIT') return null
    return addDays(order.shipped_at, cfg.safety_release_days)
  }
  return null
}

export async function isNewSeller(supabase, sellerId, cfg) {
  const { count } = await supabase.from('bc_store_orders').select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId).eq('status', 'completed')
  return (count || 0) < (cfg.new_seller_orders || 0)
}

async function holdPayout(supabase, order, reason, extra = {}) {
  await supabase.from('bc_store_orders').update({ payout_status: 'held', hold_reason: reason, ...extra })
    .eq('id', order.id).in('payout_status', ['pending', 'blocked'])
}

/**
 * Cria o transfer para a loja. force=true ignora a data e a retencao (admin),
 * mas nunca ignora disputa aberta, contestacao no cartao ou loja suspensa sem force.
 */
export async function releaseOrder(supabase, stripe, order, { actor = 'system', actor_id = null, force = false } = {}) {
  const cur = await freshOrder(supabase, order.id)
  if (!cur) return { ok: false, error: 'Pedido não encontrado.' }
  if (cur.stripe_transfer_id || cur.payout_status === 'released') return { ok: true, already: true }
  if (cur.payout_status === 'releasing') {
    // Repasse em andamento. Se a rodada anterior morreu (mais de 10 min) ou o admin
    // forcou, confere no Stripe: o transfer saiu -> grava; nao saiu -> destrava.
    const stale = !cur.releasing_at || Date.now() - new Date(cur.releasing_at).getTime() > RELEASE_STALE_MS
    if (!stale && !force) return { ok: false, error: 'O repasse já está sendo processado.' }
    const rec = await recoverRelease(supabase, stripe, cur, { actor, actor_id })
    if (!rec.ok || rec.released) return rec
    return releaseOrder(supabase, stripe, order, { actor, actor_id, force })
  }
  if (ACTIVE_DISPUTES.includes(cur.dispute_status)) return { ok: false, error: 'Pedido com problema em aberto.' }
  if (!['shipped', 'delivered'].includes(cur.status)) return { ok: false, error: 'O pedido ainda não foi enviado/entregue.' }
  if (cur.label_status === 'purchasing') return { ok: false, error: 'A etiqueta deste pedido ainda está sendo gerada.' }
  const cfg = await getConfig(supabase)
  if (!force) {
    if (cur.payout_status === 'held') return { ok: false, error: 'Repasse retido.' }
    const due = releaseDueAt(cur, cfg, { newSeller: await isNewSeller(supabase, cur.seller_id, cfg) })
    if (!due || due > new Date()) return { ok: false, error: 'Ainda não chegou a data do repasse.' }
  }

  const { data: seller } = await supabase.from('bc_store_sellers')
    .select('id, user_id, email, name, status, stripe_account_id, stripe_transfers_active, debt_cents').eq('id', cur.seller_id).maybeSingle()
  if (!seller) return { ok: false, error: 'Loja não encontrada.' }
  if (!force && (seller.status !== 'approved' || await isBanned(supabase, seller.user_id))) {
    await holdPayout(supabase, cur, 'seller_suspended')
    return { ok: false, error: 'Loja suspensa: repasse retido.' }
  }
  if (!seller.stripe_account_id || !seller.stripe_transfers_active) {
    if (cur.payout_status !== 'blocked') {
      await supabase.from('bc_store_orders').update({ payout_status: 'blocked', hold_reason: 'stripe_incomplete' }).eq('id', cur.id).eq('payout_status', cur.payout_status)
      await notify({
        user_id: seller.user_id, email: seller.email, type: 'store_payout_blocked', icon: '⚠️',
        title: 'Termine o cadastro no Stripe para receber',
        body: `O repasse do pedido #${cur.order_number} está pronto, mas sua conta de recebimento não está ativa.`,
        url: '/store/painel?aba=recebimentos',
        mail: { subject: 'Seu repasse está esperando o cadastro no Stripe', title: 'Repasse esperando', paragraphs: [`O repasse do pedido <strong>#${cur.order_number}</strong> está liberado, mas sua conta de recebimento (Stripe) ainda não está ativa. Termine o cadastro no painel.`], ctaUrl: APP_URL + '/store/painel?aba=recebimentos', ctaLabel: 'Abrir o painel' },
      })
    }
    return { ok: false, error: 'Conta de recebimento da loja não está ativa.' }
  }

  // Cobranca do pedido (recupera pelo PaymentIntent se o webhook nao gravou)
  const { data: co } = await supabase.from('bc_store_checkouts').select('id, stripe_charge_id, stripe_payment_intent_id').eq('id', cur.checkout_id).maybeSingle()
  let chargeId = co?.stripe_charge_id || null
  if (!chargeId && co?.stripe_payment_intent_id) {
    try {
      chargeId = chargeOf(await stripe.paymentIntents.retrieve(co.stripe_payment_intent_id))
      if (chargeId) await supabase.from('bc_store_checkouts').update({ stripe_charge_id: chargeId }).eq('id', co.id)
    } catch (e) {
      return { ok: false, error: 'Não deu para ler o pagamento no Stripe: ' + e.message }
    }
  }
  if (!chargeId) return { ok: false, error: 'Cobrança do pedido não encontrada.' }

  // Contestacao no cartao (aberta ou perdida) ou reembolso feito fora da Store
  // seguram o repasse. charge.disputed continua true depois de uma contestacao
  // ganha, por isso o que vale e o status de cada disputa.
  try {
    const ds = await stripe.disputes.list({ charge: chargeId, limit: 10 })
    const disputes = ds?.data || []
    const open = disputes.some(d => OPEN_CARD_DISPUTE.includes(d.status))
    const lost = disputes.some(d => d.status === 'lost')
    if (open || lost) {
      await holdPayout(supabase, cur, open ? 'chargeback' : 'chargeback_lost', open ? { dispute_status: 'chargeback' } : {})
      await logEvent(supabase, cur.id, 'hold', { actor: 'system', message: 'Repasse retido: contestação no cartão' })
      await notifyAdmin(`Store: contestação no pedido #${cur.order_number}`, [open ? 'A cobrança tem uma contestação aberta no Stripe. O repasse foi retido.' : 'A cobrança tem uma contestação PERDIDA no Stripe que a Store não registrou. O repasse foi retido; confira e reembolse ou estorne.'])
      return { ok: false, error: 'Contestação no cartão: repasse retido.' }
    }
    const ch = await stripe.charges.retrieve(chargeId)
    const { data: sib } = await supabase.from('bc_store_orders').select('refunded_cents').eq('checkout_id', cur.checkout_id)
    const ours = (sib || []).reduce((s, o) => s + (o.refunded_cents || 0), 0)
    if ((ch?.amount_refunded || 0) > ours) {
      await holdPayout(supabase, cur, 'refund_mismatch')
      await notifyAdmin(`Store: reembolso fora da Store no pedido #${cur.order_number}`, [`O Stripe mostra ${fmtUSD(ch.amount_refunded)} reembolsados nesta cobrança, mais do que a Store registrou (${fmtUSD(ours)}). O repasse foi retido até você conferir.`])
      return { ok: false, error: 'Reembolso fora da Store: repasse retido.' }
    }
  } catch (e) {
    return { ok: false, error: 'Não deu para conferir a cobrança no Stripe: ' + e.message }
  }

  // Trava (um repasse por vez; reembolso em andamento impede)
  const prev = cur.payout_status
  const { data: claimed, error: cErr } = await supabase.from('bc_store_orders').update({ payout_status: 'releasing', releasing_at: new Date().toISOString(), debt_taken_cents: 0 })
    .eq('id', cur.id).eq('payout_status', prev).eq('refunded_cents', cur.refunded_cents || 0)
    .is('stripe_transfer_id', null).in('status', ['shipped', 'delivered']).select('*')
  if (cErr) return { ok: false, error: 'Erro ao travar o repasse: ' + cErr.message }
  if (!claimed || !claimed.length) return { ok: false, error: 'O pedido mudou de situação.' }
  const o = claimed[0]
  const unlock = () => supabase.from('bc_store_orders').update({ payout_status: prev, releasing_at: null, debt_taken_cents: 0 }).eq('id', o.id).eq('payout_status', 'releasing')
  if (ACTIVE_DISPUTES.includes(o.dispute_status)) {
    await unlock()
    return { ok: false, error: 'Pedido com problema em aberto.' }
  }

  const { payout_cents: gross, fee_cents } = computePayout(o)
  const now = new Date().toISOString()

  // Ja existe transfer deste pedido no Stripe? (rodada anterior que morreu antes de gravar)
  let transfer = null
  try {
    const list = await stripe.transfers.list({ transfer_group: 'STORE_' + o.checkout_id, limit: 100 })
    transfer = (list?.data || []).find(t => t?.metadata?.order_id === o.id) || null
  } catch (e) {
    await unlock()
    return { ok: false, error: 'Não deu para consultar os repasses no Stripe: ' + e.message }
  }

  let debt = transfer ? (o.debt_taken_cents || 0) : 0
  if (!transfer) {
    // Divida antiga da loja (estorno recusado) sai deste repasse. Fica anotada no
    // pedido (debt_taken_cents) para voltar a loja se a rodada morrer no meio.
    if (gross > 0 && (seller.debt_cents || 0) > 0) {
      const { data: taken, error: tErr } = await supabase.rpc('bc_store_take_debt', { p_seller: seller.id, p_max: gross })
      if (!tErr) debt = Number(taken) || 0
      if (debt) await supabase.from('bc_store_orders').update({ debt_taken_cents: debt }).eq('id', o.id).eq('payout_status', 'releasing')
    }
    const amount = gross - debt
    if (amount <= 0) {
      await supabase.from('bc_store_orders').update({ status: 'completed', completed_at: now, payout_status: 'none', payout_cents: 0, fee_cents, debt_applied_cents: debt, releasing_at: null, debt_taken_cents: 0 }).eq('id', o.id).eq('payout_status', 'releasing')
      await logEvent(supabase, o.id, 'completed', { actor, actor_id, message: debt ? 'Concluído; o valor abateu débito antigo da loja.' : 'Concluído sem repasse (valor zerado por reembolso/etiqueta).', data: { debt_applied_cents: debt } })
      return { ok: true, payout_cents: 0 }
    }
    try {
      transfer = await stripe.transfers.create({
        amount,
        currency: 'usd',
        destination: seller.stripe_account_id,
        source_transaction: chargeId,
        transfer_group: 'STORE_' + o.checkout_id,
        description: `BrasilConnect Store · pedido #${o.order_number}`,
        metadata: { type: 'store_payout', order_id: o.id, order_number: String(o.order_number), seller_id: seller.id },
      }, { idempotencyKey: `store_tr_${o.id}_${amount}` })
    } catch (e) {
      if (debt) await supabase.rpc('bc_store_add_debt', { p_seller: seller.id, p_cents: debt })
      await unlock()
      await logEvent(supabase, o.id, 'payout_failed', { actor, message: 'O repasse não saiu; a BrasilConnect já foi avisada.', data: { error: e.message } })
      return { ok: false, error: 'O repasse falhou no Stripe: ' + e.message }
    }
  }
  return finishRelease(supabase, o, seller, transfer, { debt, fee_cents, actor, actor_id })
}

const RELEASE_STALE_MS = 10 * 60 * 1000
const OPEN_CARD_DISPUTE = ['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review']

/**
 * Repasse que ficou em 'releasing' (funcao morreu no meio): se o transfer saiu,
 * grava; se nao saiu, devolve a divida abatida e volta para 'pending'.
 * Retorna { ok, released, recovered }.
 */
export async function recoverRelease(supabase, stripe, cur, { actor = 'system', actor_id = null } = {}) {
  let transfer = null
  try {
    const list = await stripe.transfers.list({ transfer_group: 'STORE_' + cur.checkout_id, limit: 100 })
    transfer = (list?.data || []).find(t => t?.metadata?.order_id === cur.id) || null
  } catch (e) {
    return { ok: false, error: 'Não deu para consultar os repasses no Stripe: ' + e.message }
  }
  if (transfer) {
    const { data: seller } = await supabase.from('bc_store_sellers').select('id, user_id, email, name').eq('id', cur.seller_id).maybeSingle()
    const r = await finishRelease(supabase, cur, seller || { id: cur.seller_id }, transfer, { debt: cur.debt_taken_cents || 0, fee_cents: computePayout(cur).fee_cents, actor, actor_id })
    return { ...r, released: true, recovered: true }
  }
  if ((cur.debt_taken_cents || 0) > 0) await supabase.rpc('bc_store_add_debt', { p_seller: cur.seller_id, p_cents: cur.debt_taken_cents })
  await supabase.from('bc_store_orders').update({ payout_status: 'pending', releasing_at: null, debt_taken_cents: 0 })
    .eq('id', cur.id).eq('payout_status', 'releasing')
  await logEvent(supabase, cur.id, 'payout_failed', { actor: 'system', message: 'Repasse interrompido; destravado para tentar de novo.' })
  return { ok: true, released: false, recovered: true }
}

/** Grava o repasse feito (transfer) e avisa a loja. */
async function finishRelease(supabase, o, seller, transfer, { debt = 0, fee_cents, actor = 'system', actor_id = null }) {
  const now = new Date().toISOString()
  const sent = transfer.amount ?? 0
  await supabase.from('bc_store_orders').update({
    status: 'completed', completed_at: o.completed_at || now, payout_status: 'released', payout_cents: sent, fee_cents,
    debt_applied_cents: debt, stripe_transfer_id: transfer.id, hold_reason: null, releasing_at: null, debt_taken_cents: 0,
  }).eq('id', o.id)
  const { count } = await supabase.from('bc_store_orders').select('id', { count: 'exact', head: true }).eq('seller_id', seller.id).eq('status', 'completed')
  await supabase.from('bc_store_sellers').update({ sales_count: count || 0 }).eq('id', seller.id)

  await logEvent(supabase, o.id, 'payout', { actor, actor_id, message: `Repasse de ${fmtUSD(sent)} enviado à loja`, data: { transfer_id: transfer.id, fee_cents, label_cost_cents: o.label_cost_cents, debt_applied_cents: debt } })
  await notify({
    user_id: seller.user_id, email: seller.email, type: 'store_payout', icon: '💰',
    title: `Repasse de ${fmtUSD(sent)} · pedido #${o.order_number}`,
    body: 'O valor já está na sua conta Stripe e cai no banco no próximo pagamento semanal.',
    url: '/store/painel?aba=recebimentos',
    mail: {
      subject: `Repasse de ${fmtUSD(sent)} liberado`,
      title: 'Repasse liberado',
      paragraphs: [
        `Pedido <strong>#${o.order_number}</strong>: ${fmtUSD(o.items_cents + o.shipping_cents)} em vendas − ${fmtUSD(fee_cents)} de comissão${o.label_cost_cents ? ' − ' + fmtUSD(o.label_cost_cents) + ' de etiqueta' : ''}${o.refunded_cents ? ' − ' + fmtUSD(o.refunded_cents) + ' reembolsado' : ''}${debt ? ' − ' + fmtUSD(debt) + ' de débito anterior' : ''} = <strong>${fmtUSD(sent)}</strong>.`,
        'O valor já está na sua conta Stripe e cai no banco no próximo pagamento semanal.',
      ],
      ctaUrl: APP_URL + '/store/painel?aba=recebimentos', ctaLabel: 'Ver recebimentos',
    },
  })
  return { ok: true, payout_cents: sent, transfer_id: transfer.id }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envio e entrega
// ─────────────────────────────────────────────────────────────────────────────
export async function markShipped(supabase, order, { carrier, service = null, tracking_number = null, tracking_url = null, label = null, actor = 'seller', actor_id = null }) {
  const now = new Date().toISOString()
  const patch = {
    status: 'shipped', shipped_at: now,
    carrier: carrier ? String(carrier).slice(0, 40) : null,
    service: service ? String(service).slice(0, 80) : null,
    tracking_number: tracking_number ? String(tracking_number).slice(0, 60) : null,
    tracking_url: tracking_url ? String(tracking_url).slice(0, 500) : null,
    tracking_status: tracking_number ? 'PRE_TRANSIT' : null,
    tracking_updated_at: now,
  }
  if (label) Object.assign(patch, label)
  const { data: claimed } = await supabase.from('bc_store_orders').update(patch).eq('id', order.id).eq('status', 'paid').select('id')
  if (!claimed || !claimed.length) return { ok: false, error: 'O pedido não está aguardando envio.' }
  await logEvent(supabase, order.id, 'shipped', { actor, actor_id, message: `Enviado${carrier ? ' via ' + carrier : ''}${tracking_number ? ' · rastreio ' + tracking_number : ''}` })
  await notify({
    user_id: order.buyer_user_id, email: order.buyer_email, type: 'store_order_shipped', icon: '📦',
    title: `Pedido #${order.order_number} enviado`,
    body: tracking_number ? `Rastreio ${tracking_number}${carrier ? ' (' + carrier + ')' : ''}.` : 'A loja postou seu pedido.',
    url: buyerOrderUrl(order), metadata: { order_id: order.id },
    mail: {
      subject: `Seu pedido #${order.order_number} foi enviado`,
      title: 'Pedido enviado',
      paragraphs: [
        `A loja postou o pedido <strong>#${order.order_number}</strong>.`,
        tracking_number ? `Rastreio: <strong>${esc(tracking_number)}</strong>${carrier ? ' · ' + esc(carrier) : ''}${tracking_url ? ` · <a href="${esc(tracking_url)}">acompanhar</a>` : ''}` : '',
        'Se algo der errado com a entrega, abra um problema pela página do pedido. O dinheiro só vai para a loja depois da entrega.',
      ].filter(Boolean),
      ctaUrl: APP_URL + buyerOrderUrl(order), ctaLabel: 'Acompanhar pedido',
    },
  })
  return { ok: true }
}

/**
 * Entrega confirmada (rastreio, loja na entrega local/retirada, ou comprador).
 * Rastreio com data de entrega anterior ao envio e de outro pacote: nao marca,
 * retem o repasse e avisa o admin.
 */
export async function markDelivered(supabase, order, { actor = 'seller', actor_id = null, at = null, message = null } = {}) {
  const now = new Date()
  let when = at ? new Date(at) : now
  if (isNaN(when)) when = now
  // Etiqueta da Store: nao pode ser entregue antes da compra da etiqueta. Envio
  // proprio: a loja pode digitar o rastreio depois da entrega; o piso e o pagamento.
  const floorSrc = order.label_status === 'purchased' ? (order.shipped_at || order.paid_at) : (order.paid_at || order.shipped_at)
  const floor = new Date(floorSrc || order.created_at || now)
  if (actor === 'shippo' && when.getTime() < floor.getTime() - 24 * 3600 * 1000) {
    await holdPayout(supabase, order, 'tracking_date_invalid')
    await logEvent(supabase, order.id, 'hold', { actor: 'system', message: 'Repasse retido: o rastreio informa entrega antes do envio deste pedido.', data: { delivered_at: when.toISOString() } })
    await notifyAdmin(`Store: rastreio suspeito no pedido #${order.order_number}`, [`O rastreio <strong>${esc(order.tracking_number || '')}</strong> mostra entrega em ${esc(when.toISOString())}, antes do envio do pedido (${esc(floor.toISOString())}). Pode ser o número de outro pacote. O repasse foi retido.`])
    return { ok: false, suspect: true, error: 'Rastreio com data de entrega anterior ao envio.' }
  }
  if (when < floor) when = floor
  if (when > now) when = now
  const iso = when.toISOString()
  const { data: claimed } = await supabase.from('bc_store_orders')
    .update({ status: 'delivered', delivered_at: iso, ...(order.status === 'paid' ? { shipped_at: iso } : {}) })
    .eq('id', order.id).in('status', ['paid', 'shipped']).select('id')
  if (!claimed || !claimed.length) return { ok: false, error: 'O pedido não pode ser marcado como entregue agora.' }
  await logEvent(supabase, order.id, 'delivered', { actor, actor_id, message: message || 'Entregue' })
  const cfg = await getConfig(supabase)
  await notify({
    user_id: order.buyer_user_id, email: order.buyer_email, type: 'store_order_delivered', icon: '🏠',
    title: `Pedido #${order.order_number} entregue`,
    body: `Deu tudo certo? Confirme o recebimento. Se houver problema, avise em até ${cfg.dispute_window_days} dias.`,
    url: buyerOrderUrl(order), metadata: { order_id: order.id },
    mail: {
      subject: `Pedido #${order.order_number} entregue`,
      title: 'Pedido entregue',
      paragraphs: [
        `O pedido <strong>#${order.order_number}</strong> consta como entregue.`,
        `Se recebeu tudo certo, confirme na página do pedido e avalie a loja. Se não recebeu ou veio diferente do anúncio, abra um problema em até <strong>${cfg.dispute_window_days} dias</strong>.`,
      ],
      ctaUrl: APP_URL + buyerOrderUrl(order), ctaLabel: 'Abrir o pedido',
    },
  })
  return { ok: true }
}

export const TRACKING_PT = {
  PRE_TRANSIT: 'Etiqueta criada · esperando a transportadora',
  TRANSIT: 'Em trânsito',
  DELIVERED: 'Entregue',
  RETURNED: 'Devolvido ao remetente',
  FAILURE: 'Problema na entrega',
  UNKNOWN: 'Sem atualização da transportadora',
}

/**
 * Atualizacao de rastreio (webhook Shippo, consulta do cron ou envio proprio).
 * status: PRE_TRANSIT | TRANSIT | DELIVERED | RETURNED | FAILURE | UNKNOWN
 * address_to (opcional, da Shippo): { zip, state } do destino do pacote.
 * Idempotente: pode ser chamada de novo com o mesmo status.
 */
export async function applyTracking(supabase, order, { status, substatus = null, details = null, date = null, source = 'webhook', address_to = null }) {
  const st = String(status || 'UNKNOWN').toUpperCase()
  const prev = String(order.tracking_status || '').toUpperCase()
  const parsed = date ? new Date(date) : new Date()
  const when = isNaN(parsed) ? new Date() : parsed
  await supabase.from('bc_store_tracking_events').insert({
    order_id: order.id, tracking_number: order.tracking_number || 'n/a', status: st,
    substatus: substatus ? String(substatus).slice(0, 60) : null, status_details: details ? String(details).slice(0, 500) : null,
    status_date: when.toISOString(), source,
  }) // duplicado (mesmo pedido, status e data) e ignorado pela constraint

  await supabase.from('bc_store_orders').update({
    tracking_status: st, tracking_substatus: substatus ? String(substatus).slice(0, 60) : null, tracking_updated_at: new Date().toISOString(),
  }).eq('id', order.id)

  if (st === 'DELIVERED' && ['paid', 'shipped'].includes(order.status)) {
    // Envio proprio: o destino do pacote precisa bater com o endereco do pedido
    if (order.label_status !== 'purchased' && address_to && order.ship_to) {
      const zipA = String(address_to.zip || '').slice(0, 5), zipB = String(order.ship_to.zip || '').slice(0, 5)
      const stA = String(address_to.state || '').toUpperCase(), stB = String(order.ship_to.state || '').toUpperCase()
      if ((zipA && zipB && zipA !== zipB) || (stA && stB && stA !== stB)) {
        await holdPayout(supabase, order, 'tracking_address_mismatch')
        await logEvent(supabase, order.id, 'hold', { actor: 'system', message: 'Repasse retido: o rastreio foi entregue em outro endereço.', data: { address_to } })
        await notifyAdmin(`Store: rastreio de outro endereço no pedido #${order.order_number}`, [`O rastreio <strong>${esc(order.tracking_number || '')}</strong> foi entregue em ${esc(stA)} ${esc(zipA)}, mas o pedido é para ${esc(stB)} ${esc(zipB)}. O repasse foi retido.`])
        return { ok: false, suspect: true }
      }
    }
    return markDelivered(supabase, order, { actor: 'shippo', at: when, message: 'Entregue (rastreio)' })
  }
  if (st === 'TRANSIT' && order.status === 'paid') {
    const { data: moved } = await supabase.from('bc_store_orders').update({ status: 'shipped', shipped_at: when.toISOString() })
      .eq('id', order.id).eq('status', 'paid').select('id')
    if (moved?.length) await logEvent(supabase, order.id, 'tracking', { actor: 'shippo', message: TRACKING_PT.TRANSIT, data: { details } })
    return { ok: true }
  }
  if ((st === 'RETURNED' || st === 'FAILURE') && !['completed', 'canceled', 'refunded'].includes(order.status)) {
    if (prev === st) return { ok: true }
    await holdPayout(supabase, order, 'tracking_' + st.toLowerCase())
    await logEvent(supabase, order.id, 'tracking', { actor: 'shippo', message: TRACKING_PT[st], data: { details } })
    await notifyOrderParties(supabase, order, {
      type: 'store_tracking_problem', icon: '⚠️',
      buyerTitle: `Problema na entrega do pedido #${order.order_number}`,
      buyerBody: 'A transportadora informou um problema. A loja foi avisada; se precisar, abra um problema na página do pedido.',
      sellerTitle: `Problema na entrega do pedido #${order.order_number}`,
      sellerBody: 'A transportadora informou um problema (devolução ou falha). Fale com o comprador pela página do pedido.',
    })
    await notifyAdmin(`Store: problema de entrega no pedido #${order.order_number}`, [`Rastreio <strong>${esc(order.tracking_number || '')}</strong>: ${esc(TRACKING_PT[st])}${details ? ' · ' + esc(details) : ''}. Repasse retido.`])
    return { ok: true }
  }
  if (st !== prev && st !== 'UNKNOWN' && TRACKING_PT[st]) {
    await logEvent(supabase, order.id, 'tracking', { actor: 'shippo', message: TRACKING_PT[st], data: { details } })
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aviso para as duas pontas do pedido
// ─────────────────────────────────────────────────────────────────────────────
export async function notifyOrderParties(supabase, order, { type, icon, buyerTitle, buyerBody, sellerTitle, sellerBody, reason, skipBuyer = false, skipSeller = false }) {
  const extra = reason ? `Motivo: ${esc(reason)}` : null
  if (!skipBuyer) {
    await notify({
      user_id: order.buyer_user_id, email: order.buyer_email, type, icon,
      title: buyerTitle, body: buyerBody, url: buyerOrderUrl(order), metadata: { order_id: order.id },
      mail: { subject: buyerTitle, title: buyerTitle, paragraphs: [esc(buyerBody), extra].filter(Boolean), ctaUrl: APP_URL + buyerOrderUrl(order), ctaLabel: 'Abrir o pedido' },
    })
  }
  if (!skipSeller) {
    const { data: seller } = await supabase.from('bc_store_sellers').select('user_id, email').eq('id', order.seller_id).maybeSingle()
    if (seller) {
      await notify({
        user_id: seller.user_id, email: seller.email, type, icon,
        title: sellerTitle, body: sellerBody, url: sellerOrderUrl(order), metadata: { order_id: order.id },
        mail: { subject: sellerTitle, title: sellerTitle, paragraphs: [esc(sellerBody), extra].filter(Boolean), ctaUrl: APP_URL + sellerOrderUrl(order), ctaLabel: 'Abrir o pedido' },
      })
    }
  }
}

export { ORDER_STATUS_PT, computeFee }
