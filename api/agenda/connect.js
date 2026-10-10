/**
 * Conta Stripe da profissional (Stripe Connect Express), pra receber o sinal
 * direto na conta dela. Sem comissao da plataforma.
 *
 * GET  /api/agenda/connect   com JWT: situacao da conta (sincroniza com o Stripe). Liberado.
 *      → { connected, onboarded, charges_enabled, payouts_enabled, requirements_due, stripe_available }
 * POST /api/agenda/connect   com JWT, recurso 'deposit_stripe' (plano Pro)
 *      Body: { return_to?: 'app' }   (sem action) cria a conta se preciso e devolve o link de cadastro
 *        → { onboarding_url, url, expires_at }
 *        return_to 'app': a volta do Stripe cai em /agenda/planos?app=1&stripe=... (tela "volte pro app")
 *      Body: { action: 'dashboard' }   link de acesso ao painel Express (saldo e repasses)
 *        → { url }
 *
 * E opcional: quem nao conectar recebe o sinal por fora (Zelle, dinheiro)
 * e confirma no app.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    res.setHeader('Cache-Control', 'private, no-store')

    if (!process.env.STRIPE_SECRET_KEY) {
      if (req.method === 'GET') {
        return res.status(200).json({ connected: false, onboarded: false, charges_enabled: false, payouts_enabled: false, requirements_due: [], stripe_available: false })
      }
      return res.status(503).json({ error: 'O pagamento com cartão está indisponível no momento. Tente mais tarde.' })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    if (req.method === 'GET') {
      if (!provider.stripe_account_id) {
        return res.status(200).json({ connected: false, onboarded: false, charges_enabled: false, payouts_enabled: false, requirements_due: [], stripe_available: true })
      }
      const acc = await stripe.accounts.retrieve(provider.stripe_account_id)
      await supabase.from('ag_providers').update({
        stripe_onboarded: !!acc.details_submitted,
        stripe_charges_enabled: !!acc.charges_enabled,
      }).eq('id', provider.id)
      return res.status(200).json({
        connected: true,
        onboarded: !!acc.details_submitted,
        charges_enabled: !!acc.charges_enabled,
        payouts_enabled: !!acc.payouts_enabled,
        // So a quantidade/nomes do que falta (sem dados pessoais)
        requirements_due: Array.isArray(acc.requirements?.currently_due) ? acc.requirements.currently_due.slice(0, 20) : [],
        stripe_available: true,
      })
    }

    // POST: tudo aqui e do plano Pro (sinal com cartao)
    const gate = requireFeature(provider, 'deposit_stripe')
    if (!gate.ok) return res.status(gate.status).json(gate.body)

    const body = req.body || {}

    if (body.action === 'dashboard') {
      if (!provider.stripe_account_id) return res.status(400).json({ error: 'Conecte sua conta Stripe primeiro.' })
      try {
        const login = await stripe.accounts.createLoginLink(provider.stripe_account_id)
        return res.status(200).json({ url: login.url })
      } catch (e) {
        // Conta ainda sem cadastro completo nao tem painel
        return res.status(400).json({ error: 'Termine o cadastro no Stripe pra abrir o painel.' })
      }
    }
    if (body.action) return res.status(400).json({ error: 'Ação inválida' })

    let accountId = provider.stripe_account_id
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: String(auth.user.email || provider.email || '').toLowerCase(),
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        business_profile: {
          name: provider.name,
          product_description: 'Appointment deposits via BrasilConnect AgendaPro',
          mcc: '7230',
          url: 'https://brasilconnectusa.com/agenda/' + provider.slug,
        },
        metadata: { provider_id: provider.id, source: 'brasilconnect_agendapro' },
      })
      accountId = account.id
      await supabase.from('ag_providers').update({ stripe_account_id: accountId }).eq('id', provider.id)
    }

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'
    // Do app: a volta mostra "pronto, volte pro app" (public/agenda/planos.html trata app=1&stripe=)
    const fromApp = body.return_to === 'app'
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: fromApp ? baseUrl + '/agenda/planos?app=1&stripe=refresh' : baseUrl + '/assinante?agenda_stripe=refresh',
      return_url: fromApp ? baseUrl + '/agenda/planos?app=1&stripe=done' : baseUrl + '/assinante?agenda_stripe=done',
      type: 'account_onboarding',
    })

    return res.status(200).json({ onboarding_url: link.url, url: link.url, expires_at: link.expires_at })
  } catch (e) {
    console.error('agenda/connect error:', e.message)
    return res.status(500).json({ error: 'Não deu pra falar com o Stripe agora. Tente de novo em instantes.' })
  }
}
