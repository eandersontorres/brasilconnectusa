/**
 * POST /api/agenda/checkout
 * Body: { appointment_id }
 * Cria Stripe Checkout Session pro depósito antecipado.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe não configurado' })

  const { appointment_id } = req.body || {}
  if (!appointment_id) return res.status(400).json({ error: 'appointment_id obrigatório' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: apt, error } = await supabase
      .from('ag_appointments')
      .select('*, ag_providers(slug, name, email), ag_services(name)')
      .eq('id', appointment_id)
      .single()
    if (error || !apt) return res.status(404).json({ error: 'Agendamento não encontrado' })
    if (apt.deposit_paid) return res.status(400).json({ error: 'Depósito já pago' })
    if ((apt.deposit_cents || 0) <= 0) return res.status(400).json({ error: 'Sem depósito a pagar' })

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

    const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Depósito · ${apt.ag_services.name}`,
            description: `Profissional: ${apt.ag_providers.name}`,
          },
          unit_amount: apt.deposit_cents,
        },
        quantity: 1,
      }],
      metadata: { appointment_id, type: 'deposit' },
      success_url: `${baseUrl}/agenda/${apt.ag_providers.slug}?paid=1&apt=${appointment_id}`,
      cancel_url: `${baseUrl}/agenda/${apt.ag_providers.slug}?canceled=1`,
    })

    // Registra pagamento como pending
    await supabase.from('ag_payments').insert({
      provider_id: apt.provider_id,
      appointment_id,
      amount_cents: apt.deposit_cents,
      type: 'deposit',
      stripe_session_id: session.id,
      status: 'pending',
    })

    return res.status(200).json({ checkout_url: session.url })
  } catch (e) {
    console.error('Checkout error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
