/**
 * GET /api/admin/users-list
 *
 * Lista admin de TODOS os usuarios da plataforma.
 * Une bc_profiles + auth.users (via service key) + flags de ban/business/posts.
 *
 * Headers: x-admin-secret
 *
 * Query params:
 *   ?q=<string>        -> busca por email/full_name/display_name (ILIKE)
 *   ?state=<XX>        -> filtra estado USA
 *   ?role=<string>     -> filtra role
 *   ?onboarded=<bool>  -> true | false
 *   ?banned=<bool>     -> true | false
 *   ?has_business=<b>  -> true | false
 *   ?limit=<int>       -> default 200, max 500
 *
 * Resposta:
 *   { users: [...], summary: {...}, filter: {...} }
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    const q            = req.query.q ? String(req.query.q).trim() : null
    const state        = req.query.state || null
    const role         = req.query.role || null
    const onboarded    = req.query.onboarded
    const banned       = req.query.banned
    const hasBusiness  = req.query.has_business
    const limit        = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 1), 500)

    let query = supabase.from('bc_profiles')
      .select(`
        user_id, email, full_name, display_name, avatar_url, bio,
        city, state, country, whatsapp, instagram, role, interests,
        onboarding_completed, onboarding_step,
        guidelines_accepted_at, welcomed_at,
        created_at, updated_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (state) query = query.eq('state', state)
    if (role)  query = query.eq('role', role)
    if (onboarded === 'true')  query = query.eq('onboarding_completed', true)
    if (onboarded === 'false') query = query.eq('onboarding_completed', false)
    if (q) {
      const esc = q.replace(/[%_]/g, ch => '\\' + ch)
      query = query.or(
        `email.ilike.%${esc}%,full_name.ilike.%${esc}%,display_name.ilike.%${esc}%,city.ilike.%${esc}%`
      )
    }

    const { data: profiles, error } = await query
    if (error) throw error

    const userIds = (profiles || []).map(p => p.user_id).filter(Boolean)
    const emails  = (profiles || []).map(p => (p.email || '').toLowerCase()).filter(Boolean)

    // ─── Enriquece com banidos / negocios / contadores ──────────────────
    const [bansRes, bizRes, postsRes, commRes, authRes] = await Promise.allSettled([
      userIds.length
        ? supabase.from('bc_banned_users').select('user_id, reason, banned_at, expires_at').in('user_id', userIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('bc_businesses').select('id, owner_user_id, status').in('owner_user_id', userIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('bc_posts').select('author_id').in('author_id', userIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('bc_community_members').select('user_id').in('user_id', userIds)
        : Promise.resolve({ data: [] }),
      // Auth users: precisa listar por email pra pegar last_sign_in
      // listUsers nao filtra por id, entao paginamos limit=1000 e mapeamos por user_id
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])

    const banMap = new Map()
    if (bansRes.status === 'fulfilled') {
      for (const b of bansRes.value.data || []) banMap.set(b.user_id, b)
    }

    const bizMap = new Map() // user_id -> {total, approved, pending}
    if (bizRes.status === 'fulfilled') {
      for (const b of bizRes.value.data || []) {
        const entry = bizMap.get(b.owner_user_id) || { total: 0, approved: 0, pending: 0 }
        entry.total++
        if (b.status === 'approved') entry.approved++
        if (b.status === 'pending')  entry.pending++
        bizMap.set(b.owner_user_id, entry)
      }
    }

    const postCount = new Map()
    if (postsRes.status === 'fulfilled') {
      for (const p of postsRes.value.data || []) {
        postCount.set(p.author_id, (postCount.get(p.author_id) || 0) + 1)
      }
    }

    const commCount = new Map()
    if (commRes.status === 'fulfilled') {
      for (const m of commRes.value.data || []) {
        commCount.set(m.user_id, (commCount.get(m.user_id) || 0) + 1)
      }
    }

    const authMap = new Map() // user_id -> auth row
    if (authRes.status === 'fulfilled') {
      for (const u of authRes.value.data?.users || []) {
        authMap.set(u.id, {
          last_sign_in_at:    u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          provider:           u.app_metadata?.provider || null,
          auth_created_at:    u.created_at,
        })
      }
    }

    // Aplica filtros pos-join
    let users = (profiles || []).map(p => {
      const biz = bizMap.get(p.user_id) || { total: 0, approved: 0, pending: 0 }
      const ban = banMap.get(p.user_id) || null
      const auth = authMap.get(p.user_id) || {}
      return {
        ...p,
        ...auth,
        banned: !!ban,
        ban_reason: ban?.reason || null,
        ban_expires_at: ban?.expires_at || null,
        businesses_count: biz.total,
        businesses_approved: biz.approved,
        businesses_pending: biz.pending,
        posts_count: postCount.get(p.user_id) || 0,
        communities_count: commCount.get(p.user_id) || 0,
      }
    })

    if (banned === 'true')        users = users.filter(u => u.banned)
    if (banned === 'false')       users = users.filter(u => !u.banned)
    if (hasBusiness === 'true')   users = users.filter(u => u.businesses_count > 0)
    if (hasBusiness === 'false')  users = users.filter(u => u.businesses_count === 0)

    // ─── Summary (sobre TODA a base, sem filtros) ────────────────────────
    const { count: totalCount } = await supabase
      .from('bc_profiles')
      .select('user_id', { count: 'exact', head: true })

    const { count: onboardedCount } = await supabase
      .from('bc_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('onboarding_completed', true)

    const { count: bannedCount } = await supabase
      .from('bc_banned_users')
      .select('user_id', { count: 'exact', head: true })

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const week  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const { count: createdToday } = await supabase
      .from('bc_profiles')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', today.toISOString())
    const { count: createdWeek } = await supabase
      .from('bc_profiles')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', week.toISOString())

    return res.status(200).json({
      success: true,
      users,
      returned: users.length,
      summary: {
        total:           totalCount || 0,
        onboarded:       onboardedCount || 0,
        not_onboarded:   (totalCount || 0) - (onboardedCount || 0),
        banned:          bannedCount || 0,
        created_today:   createdToday || 0,
        created_week:    createdWeek || 0,
      },
      filter: { q, state, role, onboarded, banned, has_business: hasBusiness },
    })
  } catch (e) {
    console.error('admin/users-list error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
