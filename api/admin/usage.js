/**
 * GET /api/admin/usage
 *
 * Dashboard unificado de uso das plataformas que usamos:
 *   - Supabase Pro: MAU, DB size, Storage size, contadores de app
 *   - Vercel Pro: bandwidth + invocations (se VERCEL_TOKEN setado)
 *   - Resend: emails enviados (via bc_drip_log se existir)
 *   - App stats: usuarios, comunidades, posts, negócios, etc
 *
 * Headers: x-admin-secret
 *
 * Pra cada metrica retornamos:
 *   { value: <atual>, limit: <maximo do plano>, label: <descrição> }
 *
 * Cache 60s no client (refresh manual ou auto).
 */

import { createClient } from '@supabase/supabase-js'

// ─── Limites dos planos atuais (Supabase Pro + Vercel Pro) ──────────────
const LIMITS = {
  supabase_pro: {
    mau:              100_000,
    db_bytes:         8  * 1024 ** 3,        // 8 GB
    storage_bytes:    100 * 1024 ** 3,       // 100 GB
    bandwidth_bytes:  250 * 1024 ** 3,       // 250 GB / mes (egress)
    edge_invocations: 2_000_000,             // /mes
    realtime_concurrent: 500,
  },
  vercel_pro: {
    bandwidth_bytes:        1024 ** 4,       // 1 TB / mes
    function_invocations:   1_000_000,       // /dia
    function_gb_hours:      1000,            // /mes
    edge_requests:          10_000_000,      // /mes
    build_minutes:          6000,            // /mes
  },
  resend_pro: {
    emails_per_month: 50_000,
  },
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

// ─── Vercel API (best-effort — endpoint pode mudar) ──────────────────────
async function fetchVercelUsage() {
  const token = process.env.VERCEL_TOKEN
  if (!token) return { configured: false, reason: 'VERCEL_TOKEN nao setado em env' }

  const teamId = process.env.VERCEL_TEAM_ID || null
  const queryStr = teamId ? `?teamId=${teamId}` : ''

  try {
    // Endpoint de billing usage (Pro/Enterprise). Pode retornar 403 dependendo do escopo do token.
    const r = await fetch(`https://api.vercel.com/v1/usage${queryStr}`, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!r.ok) {
      return { configured: true, error: 'Vercel API ' + r.status, hint: 'Token sem permissao ou endpoint nao disponivel pra esse plano. Veja https://vercel.com/<team>/usage no dashboard.' }
    }
    const data = await r.json()
    return { configured: true, raw: data }
  } catch (e) {
    return { configured: true, error: e.message }
  }
}

// ─── Helper: monta uma metrica { value, limit, pct } ─────────────────────
function metric(value, limit, label) {
  const v = Number(value) || 0
  const lim = limit || 0
  const pct = lim > 0 ? (v / lim) * 100 : 0
  return { value: v, limit: lim, pct: Number(pct.toFixed(2)), label }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabase()
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  try {
    // ─── Supabase (via SQL helpers) ────────────────────────────────────
    const [dbSizeRes, storageSizeRes, mauRes, totalUsersRes, storageBucketsRes] = await Promise.allSettled([
      supabase.rpc('bc_get_db_size'),
      supabase.rpc('bc_get_storage_size'),
      supabase.rpc('bc_get_mau'),
      supabase.rpc('bc_get_total_users'),
      supabase.rpc('bc_get_storage_by_bucket'),
    ])

    const dbBytes      = dbSizeRes.status === 'fulfilled' ? Number(dbSizeRes.value.data || 0) : 0
    const storageBytes = storageSizeRes.status === 'fulfilled' ? Number(storageSizeRes.value.data || 0) : 0
    const mau          = mauRes.status === 'fulfilled' ? Number(mauRes.value.data || 0) : 0
    const totalUsers   = totalUsersRes.status === 'fulfilled' ? Number(totalUsersRes.value.data || 0) : 0
    const buckets      = storageBucketsRes.status === 'fulfilled' ? (storageBucketsRes.value.data || []) : []

    // ─── App stats (counts no banco) ────────────────────────────────────
    const [
      communitiesAll, communitiesActive,
      postsAll, posts30d,
      commentsAll, comments30d,
      businessesAll, businessesPending, businessesApproved,
      pushSubsActive,
      sponsorsActive,
      ordersAll, orders30d,
      bolaoMembers,
      eventRsvps,
      reportsPending,
      contactMessages,
      enterpriseLeads,
      waitlist,
      dripEmails30d,
    ] = await Promise.all([
      supabase.from('bc_communities').select('id', { count: 'exact', head: true }),
      supabase.from('bc_communities').select('id', { count: 'exact', head: true }).gt('member_count', 0),
      supabase.from('bc_posts').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      supabase.from('bc_posts').select('id', { count: 'exact', head: true }).eq('is_deleted', false).gte('created_at', since30d),
      supabase.from('bc_comments').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      supabase.from('bc_comments').select('id', { count: 'exact', head: true }).eq('is_deleted', false).gte('created_at', since30d),
      supabase.from('bc_businesses').select('id', { count: 'exact', head: true }),
      supabase.from('bc_businesses').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('bc_businesses').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('bc_push_subscriptions').select('endpoint', { count: 'exact', head: true }).eq('active', true),
      supabase.from('bc_sponsors').select('id', { count: 'exact', head: true }).eq('active', true).eq('status', 'approved'),
      supabase.from('bc_orders').select('id', { count: 'exact', head: true }),
      supabase.from('bc_orders').select('id', { count: 'exact', head: true }).gte('created_at', since30d),
      supabase.from('bc_bolao_members').select('id', { count: 'exact', head: true }),
      supabase.from('bc_event_rsvps').select('id', { count: 'exact', head: true }),
      supabase.from('bc_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('bc_contact_messages').select('id', { count: 'exact', head: true }).is('replied_at', null),
      supabase.from('bc_enterprise_leads').select('id', { count: 'exact', head: true }),
      supabase.from('bc_waitlist').select('id', { count: 'exact', head: true }),
      supabase.from('bc_drip_log').select('id', { count: 'exact', head: true }).gte('sent_at', since30d),
    ].map(p => p.then(r => r.count || 0, () => 0)))

    // ─── Vercel ────────────────────────────────────────────────────────
    const vercel = await fetchVercelUsage()

    // ─── Resposta consolidada ──────────────────────────────────────────
    const out = {
      success: true,
      timestamp: new Date().toISOString(),
      window: '30 dias',

      // Supabase Pro
      supabase: {
        mau:           metric(mau,          LIMITS.supabase_pro.mau,           'Monthly Active Users (login 30d)'),
        db_size:       metric(dbBytes,      LIMITS.supabase_pro.db_bytes,      'Database size'),
        storage:       metric(storageBytes, LIMITS.supabase_pro.storage_bytes, 'Storage total'),
        storage_by_bucket: buckets,
        bandwidth:     { label: 'Egress bandwidth (medir no dashboard)', limit: LIMITS.supabase_pro.bandwidth_bytes, external_link: 'https://supabase.com/dashboard/project/_/settings/billing' },
        connections:   { label: 'Connection pool (200 default — Supavisor)', limit: 200, external_link: 'https://supabase.com/dashboard/project/_/database/pooler' },
      },

      // Vercel Pro
      vercel: {
        ...vercel,
        external_link: 'https://vercel.com/dashboard/usage',
        bandwidth_limit_bytes:    LIMITS.vercel_pro.bandwidth_bytes,
        invocations_limit_daily:  LIMITS.vercel_pro.function_invocations,
        gb_hours_limit:           LIMITS.vercel_pro.function_gb_hours,
        build_minutes_limit:      LIMITS.vercel_pro.build_minutes,
      },

      // Resend
      resend: {
        emails_30d: metric(dripEmails30d, LIMITS.resend_pro.emails_per_month, 'Emails enviados (30d, via bc_drip_log)'),
        external_link: 'https://resend.com/emails',
      },

      // App stats
      app: {
        total_users:           totalUsers,
        mau:                   mau,
        communities_total:     communitiesAll,
        communities_active:    communitiesActive,
        posts_total:           postsAll,
        posts_30d:             posts30d,
        comments_total:        commentsAll,
        comments_30d:          comments30d,
        businesses_total:      businessesAll,
        businesses_pending:    businessesPending,
        businesses_approved:   businessesApproved,
        push_subscriptions:    pushSubsActive,
        sponsors_active:       sponsorsActive,
        orders_total:          ordersAll,
        orders_30d:            orders30d,
        bolao_members:         bolaoMembers,
        event_rsvps:           eventRsvps,
        reports_pending:       reportsPending,
        contact_unanswered:    contactMessages,
        enterprise_leads:      enterpriseLeads,
        waitlist:              waitlist,
      },
    }

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(out)
  } catch (e) {
    console.error('admin/usage error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
