/**
 * Efeitos da assinatura do plano do diretorio no negocio (chamado pelo webhook do Stripe
 * e pela troca de plano em api/stripe/listing.js).
 *
 * - Plano valendo: grava pro/premium. Premium liga o destaque na busca.
 * - Assinatura encerrada: volta pro Free, tira o destaque que veio do Premium e
 *   desliga os pedidos online (pedidos exigem plano pago).
 * - O selo "verificado" NAO e automatico: quem marca e o admin, depois de conferir
 *   o negocio. O admin e avisado por e-mail quando alguem assina o Premium.
 */
import { PAID_PLANS } from './listingPlans.js'

const LIVE = ['active', 'trialing', 'past_due']

export async function applyListingSubscription(supabase, { businessId, sub, plan }) {
  if (!businessId || !sub) return null

  const { data: before } = await supabase.from('bc_businesses')
    .select('id, name, slug, owner_email, listing_plan, featured, module')
    .eq('id', businessId).maybeSingle()
  if (!before) return null

  const live = LIVE.includes(sub.status)
  const wanted = PAID_PLANS.includes(plan) ? plan : (PAID_PLANS.includes(sub.metadata?.listing_plan) ? sub.metadata.listing_plan : 'pro')
  const next = live ? wanted : 'free'

  const patch = {
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null,
    stripe_subscription_id: sub.id,
    listing_plan: next,
    listing_plan_status: sub.status,
    listing_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  if (next === 'premium') patch.featured = true
  else if (before.listing_plan === 'premium') patch.featured = false
  if (next === 'free') patch.accepts_orders = false

  const { error } = await supabase.from('bc_businesses').update(patch).eq('id', businessId)
  if (error) throw error

  // Virou Premium agora: pede pro admin conferir e dar o selo
  if (next === 'premium' && before.listing_plan !== 'premium') {
    try {
      const { sendTransactional, adminEmail } = await import('./mailer.js')
      const { escapeHtml } = await import('./emailShell.js')
      await sendTransactional({
        to: adminEmail(),
        subject: `Premium novo: conferir e dar o selo a ${String(before.name).slice(0, 80)}`,
        kicker: 'PLANO PREMIUM',
        title: 'Negócio assinou o Premium',
        paragraphs: [
          `<strong>${escapeHtml(before.name)}</strong> assinou o plano Premium. O destaque na busca já foi ligado.`,
          'O selo de verificado não é automático: confira os dados do negócio e marque o selo no painel.',
        ],
        ctaUrl: 'https://brasilconnectusa.com/admin/manage',
        ctaLabel: 'Abrir painel de negócios',
      })
    } catch (e) {
      console.error('[listing] aviso de premium falhou:', e.message)
    }
  }

  return { before, plan: next, status: sub.status }
}

/** Assinatura apagada no Stripe: volta pro Free. */
export async function endListingSubscription(supabase, subscriptionId) {
  if (!subscriptionId) return
  const { data: biz } = await supabase.from('bc_businesses')
    .select('id, listing_plan').eq('stripe_subscription_id', subscriptionId).maybeSingle()
  if (!biz) return
  const patch = {
    listing_plan: 'free',
    listing_plan_status: 'canceled',
    accepts_orders: false,
    updated_at: new Date().toISOString(),
  }
  if (biz.listing_plan === 'premium') patch.featured = false
  await supabase.from('bc_businesses').update(patch).eq('id', biz.id)
}
