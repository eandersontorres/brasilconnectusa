/**
 * GET /api/admin/user-detail?user_id=<uuid>
 *
 * Visao 360 de um usuario — agrega tudo que existe sobre ele em UMA chamada:
 *   - auth.users (last_sign_in, email_confirmed, provider, raw_user_meta_data)
 *   - bc_profiles (todo o perfil)
 *   - bc_banned_users (se banido)
 *   - bc_businesses (negocios que possui)
 *   - bc_community_members (comunidades que participa)
 *   - bc_posts / bc_comments (counts + ultimos 5)
 *   - bc_reports (denuncias que fez)
 *   - bc_notifications (count + ultimas 5)
 *   - bc_profile_checklist (steps do Get Started)
 *   - bc_referral_codes / bc_referral_uses
 *   - bc_drip_log (por email)
 *   - bc_waitlist (por email)
 *   - bc_orders (se for cliente de restaurante)
 *
 * Headers: x-admin-secret
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const user_id = req.query.user_id
  if (!user_id) return res.status(400).json({ error: 'user_id obrigatorio' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    // Busca profile primeiro (precisamos do email pra outras queries)
    const { data: profile, error: pErr } = await supabase
      .from('bc_profiles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle()
    if (pErr) throw pErr

    const email = (profile?.email || '').toLowerCase()

    // Dispara tudo em paralelo — qualquer falha vira null/[]
    const [
      authRes, banRes, bizRes, commRes, postsRes, commentsRes, reportsRes,
      notifRes, checklistRes, refCodesRes, refUsesRes, dripRes, waitlistRes, ordersRes,
    ] = await Promise.allSettled([
      supabase.auth.admin.getUserById(user_id),
      supabase.from('bc_banned_users').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('bc_businesses')
        .select('id, name, slug, category, city, state, status, stripe_charges_enabled, accepts_orders, rating, clicks_count, created_at')
        .eq('owner_user_id', user_id)
        .order('created_at', { ascending: false }),
      supabase.from('bc_community_members')
        .select('community_id, role, joined_at, bc_communities!inner(name, slug)')
        .eq('user_id', user_id),
      supabase.from('bc_posts')
        .select('id, title, community_id, created_at, is_deleted')
        .eq('author_id', user_id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('bc_comments')
        .select('id, post_id, body, created_at, is_deleted')
        .eq('author_id', user_id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('bc_reports')
        .select('id, target_type, target_id, reason, details, status, action_taken, created_at')
        .eq('reporter_id', user_id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('bc_notifications')
        .select('id, kind, title, body, created_at, read_at')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase.from('bc_profile_checklist')
        .select('step_key, completed_at')
        .eq('user_id', user_id),
      supabase.from('bc_referral_codes').select('*').eq('user_id', user_id),
      supabase.from('bc_referral_uses').select('*').or(`referrer_id.eq.${user_id},used_by.eq.${user_id}`),
      email ? supabase.from('bc_drip_log').select('*').eq('email', email).order('sent_at', { ascending: false }).limit(20)
            : Promise.resolve({ data: [] }),
      email ? supabase.from('bc_waitlist').select('*').eq('email', email).maybeSingle()
            : Promise.resolve({ data: null }),
      supabase.from('bc_orders')
        .select('id, total_cents, status, created_at, business_id')
        .eq('customer_user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const pick = r => (r.status === 'fulfilled' ? r.value?.data : null)

    const authUser = authRes.status === 'fulfilled' ? authRes.value?.data?.user : null
    const auth = authUser ? {
      id:                   authUser.id,
      email:                authUser.email,
      phone:                authUser.phone,
      created_at:           authUser.created_at,
      last_sign_in_at:      authUser.last_sign_in_at,
      email_confirmed_at:   authUser.email_confirmed_at,
      phone_confirmed_at:   authUser.phone_confirmed_at,
      provider:             authUser.app_metadata?.provider || null,
      providers:            authUser.app_metadata?.providers || [],
      raw_user_meta_data:   authUser.user_metadata || {},
      banned_until:         authUser.banned_until || null,
    } : null

    // Counts totais (sem limit) para posts/comentarios/notif
    const [{ count: postsTotal }, { count: commentsTotal }, { count: notifTotal }] = await Promise.all([
      supabase.from('bc_posts').select('id', { count: 'exact', head: true }).eq('author_id', user_id),
      supabase.from('bc_comments').select('id', { count: 'exact', head: true }).eq('author_id', user_id),
      supabase.from('bc_notifications').select('id', { count: 'exact', head: true }).eq('user_id', user_id),
    ])

    return res.status(200).json({
      success: true,
      user_id,
      profile: profile || null,
      auth,
      banned: pick(banRes),
      businesses: pick(bizRes) || [],
      communities: pick(commRes) || [],
      posts: { total: postsTotal || 0, recent: pick(postsRes) || [] },
      comments: { total: commentsTotal || 0, recent: pick(commentsRes) || [] },
      reports_filed: pick(reportsRes) || [],
      notifications: { total: notifTotal || 0, recent: pick(notifRes) || [] },
      checklist: pick(checklistRes) || [],
      referral_codes: pick(refCodesRes) || [],
      referral_uses: pick(refUsesRes) || [],
      drip_log: pick(dripRes) || [],
      waitlist: pick(waitlistRes) || null,
      orders: pick(ordersRes) || [],
    })
  } catch (e) {
    console.error('admin/user-detail error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
