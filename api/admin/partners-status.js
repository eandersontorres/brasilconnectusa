/**
 * GET /api/admin/partners-status
 *
 * Retorna estado de cada env var de afiliado:
 *   - present: boolean (env existe e não está vazia)
 *   - preview: string | null (primeiros 8 chars do valor — NUNCA o segredo completo)
 *   - using_fallback: boolean (se true, /go/<id> redireciona pro link público sem afiliado)
 *
 * Fonte de verdade do registry: api/go.js (re-declarado aqui em escopo módulo
 * pra evitar acoplar essa rota ao handler de redirect — se um dia o registry
 * sair de go.js pra um arquivo dedicado, atualiza nos dois lugares).
 *
 * Autenticação:
 *   Header: x-admin-secret: <ADMIN_SECRET do .env>
 */

// Espelho do registry em api/go.js — manter em sincronia.
const PARTNERS = [
  // Tier 0 — quick wins
  { id: 'lemonade',     name: 'Lemonade',           category: 'tier0',   env: 'AFFILIATE_LEMONADE_LINK',     fallback: 'https://www.lemonade.com/' },
  { id: 'mint',         name: 'Mint Mobile',        category: 'tier0',   env: 'AFFILIATE_MINT_LINK',         fallback: 'https://www.mintmobile.com/' },
  { id: 'mercury',      name: 'Mercury',            category: 'tier0',   env: 'AFFILIATE_MERCURY_LINK',      fallback: 'https://mercury.com/' },
  { id: 'myus',         name: 'MyUS',               category: 'tier0',   env: 'AFFILIATE_MYUS_LINK',         fallback: 'https://www.myus.com/' },
  { id: 'zenbusiness',  name: 'ZenBusiness',        category: 'tier0',   env: 'AFFILIATE_ZENBUSINESS_LINK',  fallback: 'https://www.zenbusiness.com/' },
  { id: 'capitalone',   name: 'Capital One',        category: 'tier0',   env: 'AFFILIATE_CAPITALONE_LINK',   fallback: 'https://www.capitalone.com/' },

  // Remessas
  { id: 'wise',          name: 'Wise',              category: 'remessa', env: 'AFFILIATE_WISE_LINK',         fallback: 'https://wise.com/send' },
  { id: 'remitly',       name: 'Remitly',           category: 'remessa', env: 'AFFILIATE_REMITLY_LINK',      fallback: 'https://www.remitly.com/us/en/brazil' },
  { id: 'western_union', name: 'Western Union',     category: 'remessa', env: 'AFFILIATE_WU_LINK',           fallback: 'https://www.westernunion.com/us/en/send-money/app/start' },
  { id: 'moneygram',     name: 'MoneyGram',         category: 'remessa', env: 'AFFILIATE_MONEYGRAM_LINK',    fallback: 'https://www.moneygram.com/mgo/us/en/send-money/send-to/brazil/' },
  { id: 'paysend',       name: 'Paysend',           category: 'remessa', env: 'AFFILIATE_PAYSEND_LINK',      fallback: 'https://paysend.com/en-us/send-money/to/brazil' },
  { id: 'nomad',         name: 'Nomad',             category: 'remessa', env: 'AFFILIATE_NOMAD_LINK',        fallback: 'https://www.nomadglobal.com/' },
  { id: 'xoom',          name: 'Xoom (PayPal)',     category: 'remessa', env: 'AFFILIATE_XOOM_LINK',         fallback: 'https://www.xoom.com/brazil/send-money' },

  // Voo
  { id: 'kayak',         name: 'KAYAK',             category: 'voo',     env: 'AFFILIATE_KAYAK_LINK',        fallback: 'https://www.kayak.com/' },

  // Viagem (Fase 2)
  { id: 'booking',       name: 'Booking.com',       category: 'viagem',  env: 'AFFILIATE_BOOKING_LINK',      fallback: 'https://www.booking.com/' },
  { id: 'expedia',       name: 'Expedia',           category: 'viagem',  env: 'AFFILIATE_EXPEDIA_LINK',      fallback: 'https://www.expedia.com/' },
  { id: 'undercover',    name: 'Undercover Tourist',category: 'viagem',  env: 'AFFILIATE_UNDERCOVER_LINK',   fallback: 'https://www.undercovertourist.com/' },
  { id: 'klook',         name: 'Klook',             category: 'viagem',  env: 'AFFILIATE_KLOOK_LINK',        fallback: 'https://www.klook.com/' },
  { id: 'viator',        name: 'Viator',            category: 'viagem',  env: 'AFFILIATE_VIATOR_LINK',       fallback: 'https://www.viator.com/' },
  { id: 'getyourguide',  name: 'GetYourGuide',      category: 'viagem',  env: 'AFFILIATE_GETYOURGUIDE_LINK', fallback: 'https://www.getyourguide.com/' },
]

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET) {
    return res.status(500).json({ error: 'ADMIN_SECRET não configurado' })
  }
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const rows = PARTNERS.map((p) => {
    const raw = process.env[p.env]
    const present = !!(raw && String(raw).trim().length > 0)
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      env: p.env,
      present,
      // Mostra os primeiros 8 chars do valor pra confirmação visual (sem vazar segredo)
      preview: present ? String(raw).slice(0, 8) + '…' : null,
      using_fallback: !present,
      current_url: present ? maskUrl(String(raw)) : p.fallback,
      fallback: p.fallback,
      go_url: `/go/${p.id}`,
    }
  })

  const summary = {
    total: rows.length,
    configured: rows.filter(r => r.present).length,
    using_fallback: rows.filter(r => r.using_fallback).length,
    by_category: groupBy(rows, 'category'),
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    generated_at: new Date().toISOString(),
    summary,
    partners: rows,
  })
}

// Mascarar query string em links de afiliado (mantém origem + path, oculta IDs)
function maskUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname
    const hasQuery = u.search.length > 0
    return `${u.origin}${path}${hasQuery ? '?…' : ''}`
  } catch (_) {
    return url.slice(0, 40) + '…'
  }
}

function groupBy(rows, key) {
  const out = {}
  for (const r of rows) {
    const k = r[key] || '(other)'
    if (!out[k]) out[k] = { total: 0, configured: 0 }
    out[k].total += 1
    if (r.present) out[k].configured += 1
  }
  return out
}
