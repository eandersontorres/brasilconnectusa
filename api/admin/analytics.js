/**
 * GET /api/admin/analytics
 *
 * Dashboard agregado puxando dados do Supabase:
 *   - Waitlist (total, hoje, 7 dias, por cidade)
 *   - Drip (emails enviados por step, taxa de conversão)
 *   - Cliques afiliado (por parceiro, campanha, dia)
 *   - Indicações (top, total qualificadas, recompensas pendentes)
 *   - Receita estimada por parceiro (CPA × qualificados)
 *
 * Autenticação: header x-admin-secret
 * Cache: 5 minutos (resposta pode ser pesada)
 */

import { createClient } from '@supabase/supabase-js'

// CPA estimado por parceiro (em USD) — usado para projetar receita
const CPA = {
  lemonade: 80,
  mint: 20,
  mercury: 50,
  myus: 30,
  zenbusiness: 75,
  capitalone: 100,
  wise: 30,
  remitly: 25,
  western_union: 15,
  moneygram: 10,
  paysend: 20,
  kayak: 15,
  booking: 20,
  expedia: 18,
  undercover: 12,
  klook: 10,
  viator: 15,
  getyourguide: 14,
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET) return res.status(500).json({ error: 'ADMIN_SECRET ausente' })
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars ausentes' })
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Em paralelo (8 queries)
    const [
      waitlistTotal,
      waitlistToday,
      waitlistByCityRes,
      waitlistByDayRes,
      dripStatsRes,
      clicksByProviderRes,
      clicksByDayRes,
      referralStatsRes,
      topReferrersRes,
    ] = await Promise.all([
      supabase.from('bc_waitlist').select('id', { count: 'exact', head: true }),
      supabase.from('bc_waitlist').select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      supabase.from('bc_waitlist_by_city').select('*').limit(15),
      supabase.from('bc_waitlist').select('created_at')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
      supabase.from('bc_drip_log').select('email_step, status'),
      supabase.from('bc_clicks_by_provider').select('*'),
      supabase.from('bc_clicks_daily').select('*').limit(30),
      supabase.from('bc_referral_codes').select('total_clicks, total_signups, total_qualified, reward_status'),
      supabase.from('bc_top_referrers').select('email, code, total_qualified, total_signups').limit(10),
    ])

    // ── Agregações em JS ─────────────────────────────────────────
    // Waitlist por dia (últimos 30)
    const dailySignupsMap = {}
    ;(waitlistByDayRes.data || []).forEach(row => {
      const d = row.created_at.slice(0, 10)
      dailySignupsMap[d] = (dailySignupsMap[d] || 0) + 1
    })
    const dailySignups = Object.entries(dailySignupsMap)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day))

    // Drip stats
    const dripByStep = {}
    ;(dripStatsRes.data || []).forEach(row => {
      const k = `step_${row.email_step}`
      if (!dripByStep[k]) dripByStep[k] = { sent: 0, failed: 0 }
      if (row.status === 'sent') dripByStep[k].sent++
      else if (row.status === 'failed') dripByStep[k].failed++
    })

    // Cliques agrupados por dia
    const clicksByDayMap = {}
    ;(clicksByDayRes.data || []).forEach(row => {
      const d = row.day
      if (!clicksByDayMap[d]) clicksByDayMap[d] = { day: d, total: 0 }
      clicksByDayMap[d].total += row.total_clicks
    })
    const clicksByDay = Object.values(clicksByDayMap).sort((a, b) => a.day.localeCompare(b.day))

    // Cliques por provider + receita estimada
    const clicksByProvider = (clicksByProviderRes.data || []).map(p => {
      const cpa = CPA[p.provider] || 0
      // Estimativa: 5-15% dos cliques convertem dependendo do parceiro
      const conversionRate = ['mercury', 'capitalone', 'zenbusiness'].includes(p.provider) ? 0.05 : 0.08
      const estimatedRevenue = Math.round(p.total_clicks * conversionRate * cpa)
      return {
        provider: p.provider,
        clicks: p.total_clicks,
        unique: p.unique_visitors,
        cpa,
        conversionRate,
        estimatedRevenue,
      }
    }).sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)

    // Total receita estimada
    const totalEstimatedRevenue = clicksByProvider.reduce((s, p) => s + p.estimatedRevenue, 0)

    // Referral aggregation
    const refRows = referralStatsRes.data || []
    const totalCodes = refRows.length
    const totalRefClicks = refRows.reduce((s, r) => s + (r.total_clicks || 0), 0)
    const totalRefSignups = refRows.reduce((s, r) => s + (r.total_signups || 0), 0)
    const totalRefQualified = refRows.reduce((s, r) => s + (r.total_qualified || 0), 0)
    const eligibleCount = refRows.filter(r => r.reward_status === 'eligible').length
    const paidCount = refRows.filter(r => r.reward_status === 'paid').length

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      waitlist: {
        total: waitlistTotal.count || 0,
        today: waitlistToday.count || 0,
        byCity: (waitlistByCityRes.data || []).slice(0, 10),
        dailyLast30: dailySignups,
      },
      drip: {
        byStep: dripByStep,
      },
      affiliates: {
        byProvider: clicksByProvider,
        byDay: clicksByDay,
        totalEstimatedRevenue,
        currency: 'USD',
      },
      referrals: {
        totalCodes,
        totalClicks: totalRefClicks,
        totalSignups: totalRefSignups,
        totalQualified: totalRefQualified,
        eligibleForReward: eligibleCount,
        paidRewards: paidCount,
        topReferrers: topReferrersRes.data || [],
      },
    })
  } catch (e) {
    console.error('Analytics error:', e.message)
    return res.status(500).json({ error: 'Erro interno' })
  }
}
