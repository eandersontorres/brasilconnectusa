/**
 * POST /api/stripe/webhook
 * Recebe eventos do Stripe.
 * Importante: bodyParser deve ficar OFF pra signature verification funcionar.
 *
 * checkout.session.completed com metadata.type:
 *   deposit      → sinal do AgendaPro (api/agenda/checkout.js)
 *   invoice      → fatura do WorkPro paga no cartão (api/agenda/doc-public.js): registra o
 *                  pagamento em ag_payments (idempotente pelo id da sessão/pagamento) com a data
 *                  real do pagamento, recalcula a fatura, grava o evento e avisa a profissional.
 *                  Fatura anulada/paga ou valor acima do saldo: grava mesmo assim (o dinheiro
 *                  entrou) com metadata.overpaid_cents e avisa a profissional e o admin
 *                  (destination charge: o reembolso sai pela conta da plataforma)
 *   listing      → plano do diretório
 *   subscription → assinatura do AgendaPro/WorkPro
 * charge.refunded → reembolso (total ou parcial) de pagamento de fatura: ajusta ag_payments
 *                  (total → status 'refunded'), recalcula a fatura, evento e push.
 *                  Precisa do evento charge.refunded ligado no endpoint do webhook no Stripe.
 */
import { createClient } from '@supabase/supabase-js'
import { applyListingSubscription, endListingSubscription } from '../_lib/listingWebhook.js'

export const config = { api: { bodyParser: false } }

const LIVE_STATUSES = ['trialing', 'active', 'past_due']

const INVOICE_COLS = 'id, provider_id, kind, number, status, title, client_name, total_cents, amount_paid_cents, stripe_checkout_session_id'
const PROV_PUSH_COLS = 'id, timezone, app_settings, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at'
const usd = (cents) => '$' + ((Math.round(Number(cents) || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int0 = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0 }
const firstWord = (n, def) => String(n || '').trim().split(/\s+/)[0] || def

/**
 * Quando o pagamento aconteceu no Stripe (não a hora em que o webhook rodou: o Stripe reenvia
 * evento que falhou por até 3 dias). PaymentIntent expandido → created dele; senão o created do
 * evento (o mesmo em todo reenvio); sem nada → agora.
 */
export function paidAtIso(session, eventCreated) {
  const pi = session?.payment_intent
  const sec = (pi && typeof pi === 'object' && Number(pi.created)) || Number(eventCreated) || 0
  return sec > 0 ? new Date(sec * 1000).toISOString() : new Date().toISOString()
}

/**
 * Quanto do pagamento passa do que a fatura devia antes dele.
 * Anulada → tudo; paga/sem saldo → tudo; acima do saldo → a diferença; senão 0.
 */
export function overpaidCents(doc, amount) {
  if (!doc) return 0
  if (doc.status === 'void') return Math.max(0, int0(amount))
  const balance = Math.max(0, int0(doc.total_cents) - int0(doc.amount_paid_cents))
  return Math.max(0, int0(amount) - balance)
}

/**
 * Fatura paga pelo link (checkout.session.completed, metadata.type 'invoice').
 * Idempotente: o Stripe pode mandar o mesmo evento mais de uma vez. Erro de banco lança
 * (o webhook responde 500 e o Stripe tenta de novo). A lib dos documentos entra por import
 * dinâmico: um erro nela nunca derruba os outros eventos (assinatura, sinal, diretório).
 * eventCreated: event.created (segundos) → paid_at. Também chamado pelo doc-public quando a
 * cliente tenta pagar de novo e a sessão anterior já está paga (session com payment_intent expandido).
 */
export async function handleInvoicePaid(supabase, session, eventCreated) {
  const meta = session?.metadata || {}
  if (session?.payment_status && session.payment_status !== 'paid') {
    console.error(`[stripe] fatura ${meta.document_id}: sessão ${session.id} ainda não paga (${session.payment_status})`)
    return { skipped: 'unpaid' }
  }
  const amount = Math.round(Number(session?.amount_total) || 0)
  if (amount <= 0) return { skipped: 'no_amount' }
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null

  const { data: doc, error } = await supabase.from('ag_documents').select(INVOICE_COLS).eq('id', meta.document_id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc || doc.kind !== 'invoice') {
    console.error(`[stripe] fatura ${meta.document_id} não encontrada (sessão ${session.id})`)
    return { skipped: 'no_doc' }
  }
  if (meta.provider_id && meta.provider_id !== doc.provider_id) {
    console.error(`[stripe] fatura ${doc.id}: provider da sessão ${session.id} não confere`)
    return { skipped: 'provider_mismatch' }
  }

  const { data: prov } = await supabase.from('ag_providers').select(PROV_PUSH_COLS).eq('id', doc.provider_id).maybeSingle()
  // Soma os pagamentos e acerta status/paid_at (api/_lib/documents.js). Idempotente.
  const { recomputeInvoice, addEvent } = await import('../_lib/documents.js')
  const recompute = () => recomputeInvoice(supabase, doc.id, { provider: prov || undefined, providerId: doc.provider_id })
  // Sessão concluída: sai do documento (o pay do doc-public não tenta reaproveitar)
  const clearOpenSession = async () => {
    if (doc.stripe_checkout_session_id !== session.id) return
    const { error: cErr } = await supabase.from('ag_documents')
      .update({ stripe_checkout_session_id: null, stripe_checkout_expires_at: null })
      .eq('id', doc.id).eq('stripe_checkout_session_id', session.id)
    if (cErr) console.error(`[stripe] fatura ${doc.id}: limpar sessão:`, cErr.message)
  }

  // Já registrado (evento repetido)? Recalcula de novo: se a tentativa anterior caiu depois
  // de gravar o pagamento, a fatura fica certa agora (sem evento nem aviso repetidos).
  const bySession = await supabase.from('ag_payments').select('id').eq('stripe_session_id', session.id).limit(1)
  if (bySession.error) throw new Error(bySession.error.message)
  let dup = !!bySession.data?.length
  if (!dup && pi) {
    const byIntent = await supabase.from('ag_payments').select('id').eq('stripe_payment_intent_id', pi).limit(1)
    if (byIntent.error) throw new Error(byIntent.error.message)
    dup = !!byIntent.data?.length
  }
  if (dup) {
    await recompute()
    await clearOpenSession()
    return { duplicate: true }
  }

  // Fatura anulada/paga, ou a cliente pagou mais que o saldo (duas abas, Zelle registrado no
  // meio do checkout, total baixado depois de abrir a sessão): grava assim mesmo e marca o excesso
  const excess = overpaidCents(doc, amount)
  const isVoid = doc.status === 'void'
  const ins = await supabase.from('ag_payments').insert({
    provider_id: doc.provider_id,
    document_id: doc.id,
    amount_cents: amount,
    type: 'invoice',
    status: 'paid',
    method: 'card',
    stripe_session_id: session.id,
    stripe_payment_intent_id: pi,
    paid_at: paidAtIso(session, eventCreated),
    metadata: {
      source: 'stripe',
      number: doc.number,
      ...(excess > 0 ? { overpaid_cents: excess, invoice_status_before: doc.status, ...(isVoid ? { void: true } : {}) } : {}),
    },
  }).select('id').single()
  if (ins.error) {
    if (ins.error.code === '23505') { await recompute(); await clearOpenSession(); return { duplicate: true } }
    throw new Error(ins.error.message)
  }

  const rec = await recompute()
  await clearOpenSession()
  const status = rec?.status || doc.status
  const left = rec?.document ? rec.document.balance_cents : Math.max(0, (doc.total_cents || 0) - (doc.amount_paid_cents || 0) - amount)
  const paymentId = ins.data?.id || null
  await addEvent(supabase, doc, 'payment', 'stripe', {
    amount_cents: amount, method: 'card', payment_id: paymentId, ...(excess > 0 ? { overpaid_cents: excess } : {}),
  })
  const who = firstWord(doc.client_name, 'A cliente')

  if (excess > 0) {
    await addEvent(supabase, doc, 'overpaid', 'stripe', { amount_cents: amount, overpaid_cents: excess, payment_id: paymentId, ...(isVoid ? { void: true } : {}) })
    console.error(`[stripe] PAGAMENTO A MAIS na fatura ${doc.id} (${doc.number}): ${usd(excess)} de ${usd(amount)}${isVoid ? ' (fatura anulada)' : ''} · payment_intent ${pi} · reembolsar pela conta da plataforma`)
    try {
      const { sendPushToProvider } = await import('../_lib/agendaPush.js')
      // Aviso de dinheiro: sempre vai (kind sem chave de preferência no agendaPush)
      await sendPushToProvider(supabase, doc.provider_id, {
        kind: 'payment_alert',
        title: `Pagamento a mais: ${doc.number} · ${usd(excess)}`,
        body: isVoid
          ? `${who} pagou ${usd(amount)} no cartão numa fatura anulada. Fale com o suporte do BrasilConnect para devolver o valor.`
          : `${who} pagou ${usd(amount)} no cartão, ${usd(excess)} além do saldo. Fale com o suporte do BrasilConnect para devolver a diferença.`,
        data: { type: 'document', id: doc.id },
        provider: prov || undefined,
      })
    } catch (pushErr) {
      console.error('push invoice overpaid failed:', pushErr.message)
    }
    try {
      const { sendTransactional, adminEmail } = await import('../_lib/mailer.js')
      const { escapeHtml } = await import('../_lib/emailShell.js')
      await sendTransactional({
        to: adminEmail(),
        subject: `Reembolsar ${usd(excess)}: fatura ${doc.number} paga a mais`,
        kicker: 'WORKPRO · PAGAMENTO A MAIS',
        title: `Fatura ${escapeHtml(doc.number)}: ${usd(excess)} a mais`,
        paragraphs: [
          `${escapeHtml(doc.client_name || 'A cliente')} pagou <strong>${usd(amount)}</strong> no cartão${isVoid ? ' numa fatura <strong>anulada</strong>' : `, ${usd(excess)} além do saldo`}.`,
          `Fatura ${escapeHtml(doc.id)} · profissional ${escapeHtml(doc.provider_id)} · payment_intent ${escapeHtml(pi || '-')}.`,
          'É destination charge: o reembolso sai pela conta da plataforma (Stripe → Payments → Refund, com reverse transfer). O webhook charge.refunded acerta a fatura sozinho.',
        ],
      })
    } catch (mailErr) {
      console.error('email invoice overpaid failed:', mailErr.message)
    }
    return { ok: true, payment_id: paymentId, status, overpaid_cents: excess }
  }

  try {
    const { sendPushToProvider } = await import('../_lib/agendaPush.js')
    await sendPushToProvider(supabase, doc.provider_id, {
      kind: 'documents',
      title: status === 'paid' ? `Fatura ${doc.number} paga: ${usd(amount)}` : `Pagamento recebido: ${doc.number} · ${usd(amount)}`,
      body: status === 'paid'
        ? `${who} pagou no cartão${doc.title ? ' · ' + doc.title : ''}.`
        : `${who} pagou ${usd(amount)} no cartão. Falta ${usd(left)}.`,
      data: { type: 'document', id: doc.id },
      provider: prov || undefined,
    })
  } catch (pushErr) {
    console.error('push invoice paid failed:', pushErr.message)
  }
  return { ok: true, payment_id: paymentId, status }
}

/**
 * Reembolso no Stripe (charge.refunded: total ou parcial; amount_refunded é o acumulado).
 * Acha o pagamento de fatura pela stripe_payment_intent_id. Total → status 'refunded' (sai da
 * soma da fatura). Parcial → amount_cents vira o valor que ficou (o original fica em
 * metadata.original_amount_cents) e metadata.refunded_cents guarda o devolvido. Recalcula a
 * fatura, grava o evento 'refund' e avisa a profissional. Idempotente (reenvio não repete aviso).
 * Pagamento que não é de fatura (sinal, pedido) → { skipped }.
 */
export async function handleChargeRefunded(supabase, charge, eventCreated) {
  const pi = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id || null
  if (!pi) return { skipped: 'no_intent' }
  const { data: rows, error } = await supabase.from('ag_payments')
    .select('id, provider_id, document_id, amount_cents, status, metadata')
    .eq('stripe_payment_intent_id', pi).eq('type', 'invoice').limit(1)
  if (error) throw new Error(error.message)
  const pay = rows?.[0]
  if (!pay || !pay.document_id) return { skipped: 'not_invoice' }

  const meta = pay.metadata && typeof pay.metadata === 'object' ? pay.metadata : {}
  const gross = int0(charge.amount) || int0(meta.original_amount_cents) || int0(pay.amount_cents)
  const refunded = Math.min(gross, Math.max(0, int0(charge.amount_refunded)))
  if (refunded <= 0) return { skipped: 'no_refund' }
  const full = charge.refunded === true || refunded >= gross
  const before = int0(meta.refunded_cents)
  const delta = refunded - before

  const { recomputeInvoice, addEvent } = await import('../_lib/documents.js')
  const recompute = () => recomputeInvoice(supabase, pay.document_id, { providerId: pay.provider_id })

  // Reenvio do mesmo reembolso: só garante a fatura certa
  if (delta <= 0 && (!full || pay.status === 'refunded')) {
    await recompute()
    return { duplicate: true }
  }

  const refundedAt = Number(eventCreated) > 0 ? new Date(Number(eventCreated) * 1000).toISOString() : new Date().toISOString()
  const upd = await supabase.from('ag_payments').update({
    status: full ? 'refunded' : 'paid',
    amount_cents: full ? gross : gross - refunded,
    metadata: { ...meta, original_amount_cents: gross, refunded_cents: refunded, refunded_at: refundedAt },
  }).eq('id', pay.id)
  if (upd.error) throw new Error(upd.error.message)

  const rec = await recompute()
  const doc = rec?.row || { id: pay.document_id, provider_id: pay.provider_id }
  await addEvent(supabase, doc, 'refund', 'stripe', {
    amount_cents: Math.max(0, delta), refunded_cents: refunded, full, payment_id: pay.id,
  })

  try {
    const { sendPushToProvider } = await import('../_lib/agendaPush.js')
    const number = rec?.row?.number || meta.number || ''
    const isVoid = rec?.status === 'void'
    const left = rec?.document ? rec.document.balance_cents : null
    await sendPushToProvider(supabase, pay.provider_id, {
      kind: 'payment_alert',
      title: `Reembolso${number ? ' ' + number : ''}: ${usd(Math.max(0, delta))}`,
      body: (full
        ? `O pagamento de ${usd(gross)} no cartão foi devolvido à cliente.`
        : `${usd(Math.max(0, delta))} do pagamento no cartão foi devolvido à cliente.`)
        + (!isVoid && left != null ? ` Saldo da fatura agora: ${usd(left)}.` : ''),
      data: { type: 'document', id: pay.document_id },
    })
  } catch (pushErr) {
    console.error('push invoice refund failed:', pushErr.message)
  }
  return { ok: true, payment_id: pay.id, refunded_cents: refunded, full, status: rec?.status || null }
}

/**
 * O perfil ja tem OUTRA assinatura viva gravada? Devolve o id dela (ou null).
 * Evita que uma assinatura duplicada (dois checkouts antes do webhook) troque a
 * que vale: o portal so mostra o customer gravado e ela nao acharia a outra.
 */
async function otherLiveSubscription(supabase, providerId, subId) {
  const { data: cur } = await supabase.from('ag_providers')
    .select('stripe_subscription_id, plan_status').eq('id', providerId).maybeSingle()
  const curId = cur?.stripe_subscription_id
  if (!curId || curId === subId) return null
  return LIVE_STATUSES.includes(String(cur.plan_status || '').toLowerCase()) ? curId : null
}

/**
 * trial_ends_at vindo do Stripe. Sem trial na assinatura (assinou com menos de 48h
 * de teste, cobranca na hora) nao zera: o fim do teste gratis continua valendo.
 * → objeto pra espalhar no patch ({} = nao mexe).
 */
export function trialPatch(sub) {
  return sub?.trial_end ? { trial_ends_at: new Date(sub.trial_end * 1000).toISOString() } : {}
}

async function getRawBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).end()

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

  const sig = req.headers['stripe-signature']
  let event
  try {
    const buf = await getRawBody(req)
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    console.error('Webhook signature failed:', e.message)
    return res.status(400).send(`Webhook Error: ${e.message}`)
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const meta = session.metadata || {}

        if (meta.type === 'deposit' && meta.appointment_id) {
          // Marca depósito pago e confirma agendamento
          await supabase.from('ag_appointments').update({
            deposit_paid: true,
            stripe_payment_id: session.payment_intent,
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
          }).eq('id', meta.appointment_id)

          await supabase.from('ag_payments').update({
            status: 'paid',
            stripe_payment_intent_id: session.payment_intent,
            paid_at: new Date().toISOString(),
          }).eq('stripe_session_id', session.id)
        } else if (meta.type === 'invoice' && meta.document_id) {
          // Fatura do WorkPro paga pelo link da cliente (paid_at = hora do evento no Stripe)
          await handleInvoicePaid(supabase, session, event.created)
        } else if (meta.type === 'listing' && meta.business_id) {
          // Plano do diretorio (Pro/Premium) de um negocio
          const sub = await stripe.subscriptions.retrieve(session.subscription)
          await applyListingSubscription(supabase, { businessId: meta.business_id, sub, plan: meta.listing_plan })
        } else if (meta.type === 'subscription' && meta.provider_id) {
          // Assinatura criada. Grava o status real do Stripe: assinando durante o
          // teste gratis, fica 'trialing' ate trial_end (o fim do teste sem cartao).
          const dup = await otherLiveSubscription(supabase, meta.provider_id, session.subscription)
          if (dup) {
            console.error(`[stripe] assinatura duplicada ${session.subscription} do perfil ${meta.provider_id} (vale ${dup}): cancelar no Stripe`)
            break
          }
          const patch = {
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan: meta.plan || 'starter',
          }
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription)
            patch.plan_status = sub.status
            patch.current_period_end = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
            Object.assign(patch, trialPatch(sub))
          } catch (subErr) {
            // Sem o status real: libera o plano pago e deixa o customer.subscription.*
            // corrigir. Nao mexe no trial_ends_at (um 'trialing' com data vencida bloquearia tudo).
            console.error('subscription retrieve failed:', subErr.message)
            patch.plan_status = 'active'
          }
          await supabase.from('ag_providers').update(patch).eq('id', meta.provider_id)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object
        if (sub.metadata?.type === 'listing' && sub.metadata?.business_id) {
          await applyListingSubscription(supabase, { businessId: sub.metadata.business_id, sub, plan: sub.metadata.listing_plan })
          break
        }
        const planId = sub.items?.data?.[0]?.price?.id
        let plan = 'starter'
        if (planId === process.env.STRIPE_PRICE_PRO) plan = 'pro'
        else if (planId === process.env.STRIPE_PRICE_PREMIUM) plan = 'premium'

        const subPatch = {
          plan,
          plan_status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          ...trialPatch(sub),
        }
        if (sub.metadata?.provider_id) {
          // Outra assinatura viva ja gravada: nao troca (log pra cancelar a duplicada)
          const dup = await otherLiveSubscription(supabase, sub.metadata.provider_id, sub.id)
          if (dup) {
            console.error(`[stripe] assinatura duplicada ${sub.id} (${sub.status}) do perfil ${sub.metadata.provider_id} (vale ${dup}): cancelar no Stripe`)
            break
          }
          // Esse evento pode chegar antes do checkout.session.completed
          await supabase.from('ag_providers').update({
            ...subPatch, stripe_subscription_id: sub.id, stripe_customer_id: sub.customer,
          }).eq('id', sub.metadata.provider_id)
        } else {
          await supabase.from('ag_providers').update(subPatch).eq('stripe_subscription_id', sub.id)
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await supabase.from('ag_providers').update({
          plan_status: 'canceled',
        }).eq('stripe_subscription_id', sub.id)
        await endListingSubscription(supabase, sub.id)
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        if (invoice.subscription) {
          await supabase.from('ag_providers').update({
            plan_status: 'past_due',
          }).eq('stripe_subscription_id', invoice.subscription)
          await supabase.from('bc_businesses').update({
            listing_plan_status: 'past_due',
          }).eq('stripe_subscription_id', invoice.subscription)

          // Push no app AgendaPro (best effort): o app tambem mostra a faixa vermelha.
          // Texto neutro: no modo companion o app nao tem como mudar pagamento.
          try {
            const { data: prov } = await supabase.from('ag_providers')
              .select('id').eq('stripe_subscription_id', invoice.subscription).maybeSingle()
            if (prov?.id) {
              const { sendPushToProvider } = await import('../_lib/agendaPush.js')
              await sendPushToProvider(supabase, prov.id, {
                kind: 'billing',
                title: 'Aviso sobre o seu plano',
                body: 'Houve um problema com a cobrança do seu plano.',
                data: { type: 'plans' },
              })
            }
          } catch (pushErr) {
            console.error('push payment_failed failed:', pushErr.message)
          }
        }
        break
      }
      // Fim do teste em 3 dias: avisa a profissional (a pagina de planos promete esse aviso)
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object
        if (sub.metadata?.type === 'listing') break
        let { data: prov } = await supabase.from('ag_providers')
          .select('id, name, email, plan').eq('stripe_subscription_id', sub.id).maybeSingle()
        if (!prov && sub.metadata?.provider_id) {
          const byMeta = await supabase.from('ag_providers')
            .select('id, name, email, plan, stripe_subscription_id').eq('id', sub.metadata.provider_id).maybeSingle()
          // Perfil com outra assinatura gravada: esta e duplicada, nao avisa
          prov = byMeta.data && !byMeta.data.stripe_subscription_id ? byMeta.data : null
        }
        if (!prov) break
        const fim = sub.trial_end
          ? new Date(sub.trial_end * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: 'long' })
          : 'em 3 dias'
        const planName = String(prov.plan || 'starter').replace(/^\w/, (c) => c.toUpperCase())
        if (prov.email) {
          try {
            const { sendTransactional } = await import('../_lib/mailer.js')
            const { escapeHtml } = await import('../_lib/emailShell.js')
            await sendTransactional({
              to: prov.email,
              subject: 'Seu teste grátis do AgendaPro termina em 3 dias',
              kicker: 'AGENDAPRO',
              title: 'Seu teste termina em 3 dias',
              paragraphs: [
                `Oi, ${escapeHtml(String(prov.name || '').split(' ')[0])}! O teste grátis termina em <strong>${escapeHtml(fim)}</strong>. Depois disso começa a assinatura do plano <strong>${escapeHtml(planName)}</strong>.`,
                'A cobrança é feita no cartão cadastrado. Se não quiser continuar, cancele antes, sem custo, pelo seu painel em brasilconnectusa.com/assinante.',
              ],
              ctaUrl: 'https://brasilconnectusa.com/assinante',
              ctaLabel: 'Abrir meu painel',
            })
          } catch (mailErr) {
            console.error('email trial_will_end failed:', mailErr.message)
          }
        }
        try {
          const { sendPushToProvider } = await import('../_lib/agendaPush.js')
          await sendPushToProvider(supabase, prov.id, {
            kind: 'billing',
            title: 'Seu teste grátis termina em 3 dias',
            body: `Em ${fim} começa a assinatura do plano ${planName}.`,
            data: { type: 'plans' },
          })
        } catch (pushErr) {
          console.error('push trial_will_end failed:', pushErr.message)
        }
        break
      }
      // Stripe Connect Express: conta de um negocio (pedidos) ou de uma profissional (sinal)
      case 'account.updated': {
        const acc = event.data.object
        await supabase.from('ag_providers').update({
          stripe_onboarded: acc.details_submitted,
          stripe_charges_enabled: acc.charges_enabled,
        }).eq('stripe_account_id', acc.id)
        await supabase.from('bc_businesses').update({
          stripe_onboarded: acc.details_submitted,
          stripe_charges_enabled: acc.charges_enabled,
          stripe_payouts_enabled: acc.payouts_enabled,
        }).eq('stripe_account_id', acc.id)
        break
      }
      // Restaurant: pedido pago — atualiza order + notifica dono via push
      case 'payment_intent.succeeded': {
        const intent = event.data.object
        const meta = intent.metadata || {}
        if (meta.type === 'restaurant_order' && meta.order_id) {
          await supabase.from('bc_orders').update({
            payment_status: 'paid',
            status: 'confirmed',
            stripe_charge_id: intent.latest_charge,
            confirmed_at: new Date().toISOString(),
          }).eq('id', meta.order_id)

          // Push pro dono do restaurante (best effort, nao bloqueia webhook)
          try {
            const { data: order } = await supabase
              .from('bc_orders')
              .select('id, order_number, customer_name, total_cents, business_id')
              .eq('id', meta.order_id)
              .single()
            if (order) {
              const { data: biz } = await supabase
                .from('bc_businesses')
                .select('owner_email, name')
                .eq('id', order.business_id)
                .single()
              if (biz?.owner_email) {
                const { sendPushTo } = await import('../_lib/push.js')
                await sendPushTo({
                  user_email: biz.owner_email,
                  topic: 'orders',
                  title: '🔔 Novo pedido #' + order.order_number,
                  body: (order.customer_name || 'Cliente') + ' · $' + (order.total_cents / 100).toFixed(2),
                  url: '/assinante?tab=pedidos',
                  type: 'restaurant_order_new',
                  data: { order_id: order.id },
                })
              }
            }
          } catch (pushErr) {
            console.error('push order new failed:', pushErr.message)
          }

          // E-mail pro dono (o push so chega se ele ativou notificacoes no app)
          try {
            const { data: order } = await supabase
              .from('bc_orders')
              .select('order_number, customer_name, customer_phone, type, total_cents, business_id')
              .eq('id', meta.order_id)
              .single()
            const { data: biz } = order
              ? await supabase.from('bc_businesses').select('owner_email, name').eq('id', order.business_id).single()
              : { data: null }
            if (order && biz?.owner_email) {
              const { sendTransactional } = await import('../_lib/mailer.js')
              const { escapeHtml } = await import('../_lib/emailShell.js')
              await sendTransactional({
                to: biz.owner_email,
                subject: `Novo pedido #${order.order_number} · $${(order.total_cents / 100).toFixed(2)}`,
                kicker: 'NOVO PEDIDO',
                title: `Pedido #${order.order_number} pago`,
                paragraphs: [
                  `<strong>${escapeHtml(order.customer_name || 'Cliente')}</strong> fez um pedido em <strong>${escapeHtml(biz.name)}</strong>.`,
                  `Total: <strong>$${(order.total_cents / 100).toFixed(2)}</strong> · ${order.type === 'delivery' ? 'Entrega' : 'Retirada'}${order.customer_phone ? ' · ' + escapeHtml(order.customer_phone) : ''}`,
                  'O pagamento já foi confirmado. Os itens estão no painel.',
                ],
                ctaUrl: 'https://brasilconnectusa.com/assinante?tab=pedidos',
                ctaLabel: 'Abrir pedidos',
              })
            }
          } catch (mailErr) {
            console.error('email order new failed:', mailErr.message)
          }
        }
        break
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object
        const meta = intent.metadata || {}
        if (meta.type === 'restaurant_order' && meta.order_id) {
          await supabase.from('bc_orders').update({
            payment_status: 'failed',
          }).eq('id', meta.order_id)
        }
        break
      }
      // Reembolso (total ou parcial): só mexe se for pagamento de fatura do WorkPro
      case 'charge.refunded': {
        await handleChargeRefunded(supabase, event.data.object, event.created)
        break
      }
    }
    return res.status(200).json({ received: true })
  } catch (e) {
    console.error('Webhook handler error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
