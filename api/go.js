/**
 * GET /go/:partner?campaign=xxx&utm_source=yyy
 *
 * Redirector de afiliados com tracking.
 * Registra clique no Supabase e redireciona para o link do parceiro.
 *
 * Fluxo:
 *   user → /go/lemonade?campaign=guia_cnh_tx
 *   → registra em bc_affiliate_clicks
 *   → redireciona 302 para AFFILIATE_LEMONADE_LINK com UTM apendados
 *
 * Configurar no vercel.json:
 *   { "source": "/go/:partner", "destination": "/api/go?partner=:partner" }
 */

import { createClient } from '@supabase/supabase-js'

// Mapa de parceiros suportados → variável de ambiente com link de afiliado
const PARTNERS = {
  // Tier 0 — quick wins
  lemonade:    { env: 'AFFILIATE_LEMONADE_LINK',    fallback: 'https://www.lemonade.com/' },
  mint:        { env: 'AFFILIATE_MINT_LINK',        fallback: 'https://www.mintmobile.com/' },
  mercury:     { env: 'AFFILIATE_MERCURY_LINK',     fallback: 'https://mercury.com/' },
  myus:        { env: 'AFFILIATE_MYUS_LINK',        fallback: 'https://www.myus.com/' },
  zenbusiness: { env: 'AFFILIATE_ZENBUSINESS_LINK', fallback: 'https://www.zenbusiness.com/' },
  capitalone:  { env: 'AFFILIATE_CAPITALONE_LINK',  fallback: 'https://www.capitalone.com/' },

  // Já no projeto
  wise:           { env: 'AFFILIATE_WISE_LINK',        fallback: 'https://wise.com/send' },
  remitly:        { env: 'AFFILIATE_REMITLY_LINK',     fallback: 'https://www.remitly.com/us/en/brazil' },
  western_union:  { env: 'AFFILIATE_WU_LINK',          fallback: 'https://www.westernunion.com/us/en/send-money/app/start' },
  kayak:          { env: 'AFFILIATE_KAYAK_LINK',       fallback: 'https://www.kayak.com/' },

  // Viagem (Fase 2 módulo 11)
  booking:        { env: 'AFFILIATE_BOOKING_LINK',     fallback: 'https://www.booking.com/' },
  expedia:        { env: 'AFFILIATE_EXPEDIA_LINK',     fallback: 'https://www.expedia.com/' },
  undercover:     { env: 'AFFILIATE_UNDERCOVER_LINK',  fallback: 'https://www.undercovertourist.com/' },
  klook:          { env: 'AFFILIATE_KLOOK_LINK',       fallback: 'https://www.klook.com/' },
  viator:         { env: 'AFFILIATE_VIATOR_LINK',      fallback: 'https://www.viator.com/' },
  getyourguide:   { env: 'AFFILIATE_GETYOURGUIDE_LINK',fallback: 'https://www.getyourguide.com/' },
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const partnerKey = (req.query.partner || '').toLowerCase().trim()
  const partner = PARTNERS[partnerKey]

  if (!partner) {
    return res.status(404).json({ error: 'Parceiro desconhecido', partner: partnerKey })
  }

  const targetUrl = process.env[partner.env] || partner.fallback

  // ── Metadata da requisição ─────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
  const userAgent = req.headers['user-agent'] || null
  const referer = req.headers['referer'] || null
  const campaign = req.query.campaign || null
  const utmSource = req.query.utm_source || null
  const utmMedium = req.query.utm_medium || null

  // ── Tracking no Supabase (não bloqueia o redirect) ─────────────
  // Usa fire-and-forget — não esperamos a resposta para não atrasar o user
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
        { auth: { persistSession: false } }
      )

      // .then sem await — fire and forget
      supabase.from('bc_affiliate_clicks').insert({
        provider: partnerKey,
        campaign,
        utm_source: utmSource,
        utm_medium: utmMedium,
        ip_address: ip,
        user_agent: userAgent,
        referer,
        clicked_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error('Track error:', error.message)
      })

      // ── Programa de Indicação (Módulo 05) ──────────────────
      // Se este parceiro é Tier 1 e o usuário veio via referral,
      // marca o referral_use como 'qualified'
      const TIER_1_PARTNERS = ['lemonade', 'mint', 'mercury', 'myus', 'zenbusiness', 'capitalone']
      if (TIER_1_PARTNERS.includes(partnerKey)) {
        const refCode = parseRefFromCookie(req.headers.cookie)
        if (refCode && /^BRA-[A-Z0-9]{5}$/.test(refCode)) {
          // Atualiza o use desse cookie/IP para 'qualified'
          supabase.from('bc_referral_uses')
            .update({
              status: 'qualified',
              qualified_at: new Date().toISOString(),
              qualified_via: partnerKey,
            })
            .eq('code', refCode)
            .eq('ip_address', ip)
            .neq('status', 'qualified')  // não sobrescreve se já está qualified
            .then(({ error }) => {
              if (error) console.error('Referral qualify error:', error.message)
            })
        }
      }
    } catch (e) {
      console.error('Track init error:', e.message)
    }
  }

  // ── Apendar UTMs ao link do parceiro (se ainda não tiver) ──────
  let finalUrl = targetUrl
  try {
    const u = new URL(targetUrl)
    if (utmSource && !u.searchParams.has('utm_source')) u.searchParams.set('utm_source', utmSource)
    if (utmMedium && !u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', utmMedium)
    if (campaign && !u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', campaign)
    finalUrl = u.toString()
  } catch (e) {
    // Se a URL do parceiro for inválida, redireciona pra fallback bruto
    console.error('URL parse error:', e.message)
  }

  // ── Redirect 302 ───────────────────────────────────────────────
  res.setHeader('Cache-Control', 'no-store')
  return res.redirect(302, finalUrl)
}

// Extrai código de referral do cookie 'bc_ref'
function parseRefFromCookie(cookieHeader) {
  if (!cookieHeader) return null
  const match = String(cookieHeader).match(/bc_ref=([A-Z0-9-]+)/i)
  return match ? match[1].toUpperCase() : null
}
