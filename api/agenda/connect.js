/**
 * Conta Stripe da profissional (Stripe Connect Express), pra receber o sinal
 * direto na conta dela. Sem comissao da plataforma.
 *
 * GET  /api/agenda/connect   com JWT: situacao da conta (sincroniza com o Stripe)
 * POST /api/agenda/connect   com JWT: cria a conta (se preciso) e devolve o link de cadastro
 *
 * E opcional: quem nao conectar recebe o sinal por fora (Zelle, dinheiro)
 * e confirma no painel.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    if (req.method === 'GET') {
      if (!provider.stripe_account_id) {
        return res.status(200).json({ connected: false, onboarded: false, charges_enabled: false })
      }
      const acc = await stripe.accounts.retrieve(provider.stripe_account_id)
      await supabase.from('ag_providers').update({
        stripe_onboarded: !!acc.details_submitted,
        stripe_charges_enabled: !!acc.charges_enabled,
      }).eq('id', provider.id)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({
        connected: true,
        onboarded: !!acc.details_submitted,
        charges_enabled: !!acc.charges_enabled,
      })
    }

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
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: baseUrl + '/assinante?agenda_stripe=refresh',
      return_url: baseUrl + '/assinante?agenda_stripe=done',
      type: 'account_onboarding',
    })

    return res.status(200).json({ onboarding_url: link.url, expires_at: link.expires_at })
  } catch (e) {
    console.error('agenda/connect error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
