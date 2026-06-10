/**
 * GET /api/admin/bolao-stats
 *
 * Stats agregados do bolao Copa 2026 pra aba Bolao do /admin/manage:
 *   - funnel: signups -> aceitou termos -> entrou em bolao -> palpitou
 *   - groups: total criados, com membro, media de membros
 *   - predictions: distribuicao 100%/80%+/parcial/zero
 *   - top_groups: 10 grupos com mais membros (anonimiza nome do admin)
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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    // ─── Counts diretos (paralelo) ──────────────────────────────────────────
    const [
      authUsers, profilesAcceptedTerms, groupsTotal, membersTotal,
      uniqueMembersByEmail, uniqueAdmins, matchesTotal,
    ] = await Promise.all([
      supabase.from('bc_profiles').select('user_id', { count: 'exact', head: true }),
      supabase.from('bc_profiles').select('user_id', { count: 'exact', head: true }).not('bolao_terms_accepted_at', 'is', null),
      supabase.from('bc_bolao_groups').select('id', { count: 'exact', head: true }),
      supabase.from('bc_bolao_members').select('id', { count: 'exact', head: true }),
      // Para distinct counts precisamos buscar e contar no JS (Supabase nao tem count distinct)
      supabase.from('bc_bolao_members').select('email'),
      supabase.from('bc_bolao_groups').select('admin_email'),
      supabase.from('bc_copa_matches').select('id', { count: 'exact', head: true }),
    ])

    const total_signups        = authUsers.count || 0
    const accepted_terms       = profilesAcceptedTerms.count || 0
    const groups_created       = groupsTotal.count || 0
    const members_total        = membersTotal.count || 0
    const distinct_participants = new Set((uniqueMembersByEmail.data || []).map(m => (m.email || '').toLowerCase()).filter(Boolean)).size
    const distinct_creators    = new Set((uniqueAdmins.data || []).map(g => (g.admin_email || '').toLowerCase()).filter(Boolean)).size
    const total_matches        = matchesTotal.count || 0

    // ─── Logados em bolao (member com user_id != null) ──────────────────────
    const { count: logged_in_bolao } = await supabase
      .from('bc_bolao_members')
      .select('id', { count: 'exact', head: true })
      .not('user_id', 'is', null)

    // ─── Predictions distribution ───────────────────────────────────────────
    // Conta palpites por member_id e classifica em buckets
    const { data: predictionsByMember } = await supabase
      .from('bc_bolao_predictions')
      .select('member_id, match_id')

    const palpitesPorMembro = new Map()
    for (const p of predictionsByMember || []) {
      palpitesPorMembro.set(p.member_id, (palpitesPorMembro.get(p.member_id) || 0) + 1)
    }

    const fizeram_algum     = palpitesPorMembro.size
    const palpite_100pct    = total_matches > 0
      ? [...palpitesPorMembro.values()].filter(c => c >= total_matches).length
      : 0
    const palpite_80pct     = total_matches > 0
      ? [...palpitesPorMembro.values()].filter(c => c >= Math.ceil(total_matches * 0.8) && c < total_matches).length
      : 0
    const palpite_parcial   = total_matches > 0
      ? [...palpitesPorMembro.values()].filter(c => c > 0 && c < Math.ceil(total_matches * 0.8)).length
      : 0
    const zero_palpite      = members_total - fizeram_algum

    // ─── Top 10 grupos por membros ──────────────────────────────────────────
    const { data: groupsList } = await supabase
      .from('bc_bolao_groups')
      .select('id, name, join_code, created_at, anonymous_ranking')
      .order('created_at', { ascending: false })

    const groupMemberCounts = new Map()
    const { data: allMembers } = await supabase.from('bc_bolao_members').select('group_id')
    for (const m of allMembers || []) {
      groupMemberCounts.set(m.group_id, (groupMemberCounts.get(m.group_id) || 0) + 1)
    }

    const groupPredictionCounts = new Map()
    const { data: allPreds } = await supabase.from('bc_bolao_predictions').select('member_id')
    if (allPreds?.length) {
      // Mapa member_id -> group_id pra agregar palpites por grupo
      const { data: memberGroupMap } = await supabase.from('bc_bolao_members').select('id, group_id')
      const memberToGroup = new Map((memberGroupMap || []).map(m => [m.id, m.group_id]))
      for (const p of allPreds) {
        const gid = memberToGroup.get(p.member_id)
        if (gid) groupPredictionCounts.set(gid, (groupPredictionCounts.get(gid) || 0) + 1)
      }
    }

    const top_groups = (groupsList || [])
      .map(g => ({
        id: g.id,
        name: g.name,
        join_code: g.join_code,
        member_count: groupMemberCounts.get(g.id) || 0,
        prediction_count: groupPredictionCounts.get(g.id) || 0,
        anonymous_ranking: !!g.anonymous_ranking,
        created_at: g.created_at,
      }))
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, 10)

    return res.status(200).json({
      success: true,
      funnel: {
        total_signups,
        accepted_terms,
        logged_in_bolao: logged_in_bolao || 0,
        distinct_participants,
        members_total,
        fizeram_algum_palpite: fizeram_algum,
      },
      groups: {
        total: groups_created,
        with_member: groupMemberCounts.size,
        distinct_creators,
        avg_members_per_group: groups_created > 0 ? +(members_total / groups_created).toFixed(1) : 0,
      },
      predictions: {
        total_matches,
        palpite_100pct,
        palpite_80pct,
        palpite_parcial,
        zero_palpite,
      },
      top_groups,
      generated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('admin/bolao-stats error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
