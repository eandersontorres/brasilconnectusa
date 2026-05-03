/**
 * BrasilConnect — API Social (feed estilo Reddit/Nextdoor)
 *
 * GET  /api/social?action=communities                          → lista todas as comunidades
 * GET  /api/social?action=community&slug=brasil-tx             → detalhe + posts
 * GET  /api/social?action=feed&user_id=UUID                    → feed do usuário (comunidades que segue)
 * GET  /api/social?action=feed-public                          → feed público geral (sem login)
 * GET  /api/social?action=post&id=UUID                         → post + comentários
 * GET  /api/social?action=my-communities&user_id=UUID          → comunidades que o user segue
 *
 * POST /api/social?action=join          body: { user_id, community_id }
 * POST /api/social?action=leave         body: { user_id, community_id }
 * POST /api/social?action=create-post   body: { user_id, community_id, type, title, body, ...campos específicos }
 * POST /api/social?action=create-comment body: { user_id, post_id, parent_id?, body }
 * POST /api/social?action=vote          body: { user_id, target_type, target_id, value (1 ou -1, ou 0 pra remover) }
 * POST /api/social?action=rsvp          body: { user_id, post_id, status: 'going'|'maybe'|'not_going' }
 * POST /api/social?action=report        body: { reporter_id, target_type, target_id, reason, details? }
 *
 * DELETE /api/social?action=delete-post&id=UUID&user_id=UUID    → soft delete (apenas autor)
 * DELETE /api/social?action=delete-comment&id=UUID&user_id=UUID
 */

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

const VALID_POST_TYPES = new Set(['question', 'recommendation', 'event', 'classified', 'job', 'announcement'])
const VALID_RSVP = new Set(['going', 'maybe', 'not_going'])
const VALID_REPORT_REASONS = new Set(['spam', 'offensive', 'fake', 'harassment', 'other'])

function err(res, code, msg) {
  return res.status(code).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const action = req.query?.action
  if (!action) return err(res, 400, 'action é obrigatório')

  const supabase = getSupabase()

  try {
    // ══════════ GET: lista comunidades ════════════════════════════════════
    if (req.method === 'GET' && action === 'communities') {
      const { type, state } = req.query
      let q = supabase.from('bc_communities')
        .select('id, slug, name, type, geo_state, geo_city, description, icon, member_count, post_count, is_official')
        .order('member_count', { ascending: false })
      if (type) q = q.eq('type', type)
      if (state) q = q.eq('geo_state', state.toUpperCase())
      const { data, error } = await q
      if (error) throw error
      return res.status(200).json({ success: true, communities: data || [] })
    }

    // ══════════ GET: comunidade + posts ════════════════════════════════════
    if (req.method === 'GET' && action === 'community') {
      const { slug, sort = 'new', limit = 50 } = req.query
      if (!slug) return err(res, 400, 'slug é obrigatório')

      const { data: community, error: ce } = await supabase
        .from('bc_communities')
        .select('*')
        .eq('slug', slug)
        .single()
      if (ce || !community) return err(res, 404, 'Comunidade não encontrada')

      let pq = supabase.from('bc_posts')
        .select('id, type, title, body, image_urls, event_date, event_location, event_rsvp_count, classified_price, classified_kind, job_category, job_pay, upvotes, downvotes, comment_count, view_count, is_pinned, author_id, created_at')
        .eq('community_id', community.id)
        .eq('is_deleted', false)
        .limit(Number(limit))

      if (sort === 'top') {
        // ordenar por (upvotes - downvotes) desc — usando ordem na query manualmente
        pq = pq.order('upvotes', { ascending: false }).order('created_at', { ascending: false })
      } else {
        pq = pq.order('is_pinned', { ascending: false }).order('created_at', { ascending: false })
      }

      const { data: posts, error: pe } = await pq
      if (pe) throw pe

      return res.status(200).json({ success: true, community, posts: posts || [] })
    }

    // ══════════ GET: feed do user (comunidades que segue) ══════════════════
    if (req.method === 'GET' && action === 'feed') {
      const { user_id, limit = 50 } = req.query
      if (!user_id) return err(res, 400, 'user_id é obrigatório')

      // Pega IDs das comunidades que o user segue
      const { data: memberships } = await supabase
        .from('bc_community_members')
        .select('community_id')
        .eq('user_id', user_id)

      const communityIds = (memberships || []).map(m => m.community_id)

      // Se o user não segue nenhuma, mostra a comunidade GERAL
      if (communityIds.length === 0) {
        const { data: general } = await supabase
          .from('bc_communities')
          .select('id')
          .eq('slug', 'brasil')
          .single()
        if (general) communityIds.push(general.id)
      }

      const { data: posts, error } = await supabase
        .from('bc_posts')
        .select('id, community_id, type, title, body, image_urls, event_date, event_location, classified_price, classified_kind, job_category, upvotes, downvotes, comment_count, author_id, created_at')
        .in('community_id', communityIds)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(Number(limit))
      if (error) throw error

      // Junta nomes das comunidades
      const { data: communities } = await supabase
        .from('bc_communities')
        .select('id, slug, name, icon')
        .in('id', communityIds)
      const cMap = {}
      for (const c of communities || []) cMap[c.id] = c

      const enriched = (posts || []).map(p => ({
        ...p,
        community: cMap[p.community_id] || null,
      }))

      return res.status(200).json({ success: true, posts: enriched })
    }

    // ══════════ GET: feed público (sem login, mostra comunidade GERAL) ════
    if (req.method === 'GET' && action === 'feed-public') {
      const { limit = 30 } = req.query
      const { data: general } = await supabase.from('bc_communities').select('id, slug, name, icon').eq('slug', 'brasil').single()
      if (!general) return res.status(200).json({ success: true, posts: [] })

      const { data: posts, error } = await supabase
        .from('bc_posts')
        .select('id, type, title, body, upvotes, downvotes, comment_count, author_id, created_at')
        .eq('community_id', general.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(Number(limit))
      if (error) throw error

      return res.status(200).json({ success: true, posts: (posts || []).map(p => ({ ...p, community: general })) })
    }

    // ══════════ GET: post + comentários ════════════════════════════════════
    if (req.method === 'GET' && action === 'post') {
      const { id } = req.query
      if (!id) return err(res, 400, 'id é obrigatório')

      const { data: post, error: pe } = await supabase
        .from('bc_posts').select('*').eq('id', id).single()
      if (pe || !post) return err(res, 404, 'Post não encontrado')
      if (post.is_deleted) return err(res, 410, 'Post foi removido')

      // Incrementa view (fire and forget)
      supabase.from('bc_posts').update({ view_count: (post.view_count || 0) + 1 }).eq('id', id).then(() => {}, () => {})

      const { data: comments } = await supabase
        .from('bc_comments')
        .select('id, parent_id, author_id, body, upvotes, downvotes, is_deleted, created_at')
        .eq('post_id', id)
        .order('created_at', { ascending: true })

      const { data: community } = await supabase
        .from('bc_communities').select('id, slug, name, icon').eq('id', post.community_id).single()

      return res.status(200).json({ success: true, post, community, comments: comments || [] })
    }

    // ══════════ GET: minhas comunidades ════════════════════════════════════
    if (req.method === 'GET' && action === 'my-communities') {
      const { user_id } = req.query
      if (!user_id) return err(res, 400, 'user_id é obrigatório')

      const { data, error } = await supabase
        .from('bc_community_members')
        .select('community_id, role, joined_at, bc_communities(id, slug, name, type, icon, member_count)')
        .eq('user_id', user_id)
      if (error) throw error

      const communities = (data || []).map(m => ({
        ...m.bc_communities,
        role: m.role,
        joined_at: m.joined_at,
      }))
      return res.status(200).json({ success: true, communities })
    }

    // ══════════ POST: join ═════════════════════════════════════════════════
    if (req.method === 'POST' && action === 'join') {
      const { user_id, community_id } = req.body || {}
      if (!user_id || !community_id) return err(res, 400, 'user_id e community_id obrigatórios')

      const { data, error } = await supabase
        .from('bc_community_members')
        .upsert({ user_id, community_id }, { onConflict: 'community_id,user_id' })
        .select()
        .single()
      if (error) throw error
      return res.status(200).json({ success: true, member: data })
    }

    // ══════════ POST: leave ════════════════════════════════════════════════
    if (req.method === 'POST' && action === 'leave') {
      const { user_id, community_id } = req.body || {}
      if (!user_id || !community_id) return err(res, 400, 'user_id e community_id obrigatórios')

      const { error } = await supabase
        .from('bc_community_members')
        .delete()
        .eq('user_id', user_id)
        .eq('community_id', community_id)
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    // ══════════ POST: create-post ══════════════════════════════════════════
    if (req.method === 'POST' && action === 'create-post') {
      const b = req.body || {}
      if (!b.user_id || !b.community_id || !b.type || !b.title) {
        return err(res, 400, 'user_id, community_id, type e title obrigatórios')
      }
      if (!VALID_POST_TYPES.has(b.type)) return err(res, 400, 'Tipo de post inválido')

      const insert = {
        community_id: b.community_id,
        author_id:    b.user_id,
        type:         b.type,
        title:        String(b.title).trim().slice(0, 200),
        body:         b.body ? String(b.body).slice(0, 5000) : null,
        image_urls:   Array.isArray(b.image_urls) ? b.image_urls.slice(0, 10) : null,
      }

      // Campos específicos por tipo
      if (b.type === 'event') {
        if (!b.event_date) return err(res, 400, 'event_date obrigatório para eventos')
        insert.event_date     = b.event_date
        insert.event_location = b.event_location || null
      }
      if (b.type === 'classified') {
        insert.classified_price    = b.classified_price ? Number(b.classified_price) : null
        insert.classified_currency = b.classified_currency || 'USD'
        insert.classified_kind     = b.classified_kind || 'sell'
        insert.classified_contact  = b.classified_contact || null
      }
      if (b.type === 'job') {
        insert.job_category = b.job_category || null
        insert.job_pay      = b.job_pay      || null
        insert.job_location = b.job_location || null
        insert.job_contact  = b.job_contact  || null
      }

      const { data, error } = await supabase.from('bc_posts').insert(insert).select().single()
      if (error) throw error

      // Garante que o autor é membro da comunidade
      supabase.from('bc_community_members').upsert(
        { user_id: b.user_id, community_id: b.community_id },
        { onConflict: 'community_id,user_id' }
      ).then(() => {}, () => {})

      return res.status(201).json({ success: true, post: data })
    }

    // ══════════ POST: create-comment ═══════════════════════════════════════
    if (req.method === 'POST' && action === 'create-comment') {
      const { user_id, post_id, parent_id, body } = req.body || {}
      if (!user_id || !post_id || !body) return err(res, 400, 'user_id, post_id e body obrigatórios')

      // Verifica que o post não está locked nem deletado
      const { data: post } = await supabase.from('bc_posts').select('is_locked, is_deleted').eq('id', post_id).single()
      if (!post || post.is_deleted) return err(res, 404, 'Post não encontrado')
      if (post.is_locked) return err(res, 403, 'Post está fechado para comentários')

      const { data, error } = await supabase
        .from('bc_comments')
        .insert({ post_id, parent_id: parent_id || null, author_id: user_id, body: String(body).slice(0, 3000) })
        .select()
        .single()
      if (error) throw error

      return res.status(201).json({ success: true, comment: data })
    }

    // ══════════ POST: vote ═════════════════════════════════════════════════
    if (req.method === 'POST' && action === 'vote') {
      const { user_id, target_type, target_id, value } = req.body || {}
      if (!user_id || !target_type || !target_id) return err(res, 400, 'user_id, target_type, target_id obrigatórios')
      if (!['post', 'comment'].includes(target_type)) return err(res, 400, 'target_type deve ser post ou comment')
      const v = Number(value)
      if (![1, -1, 0].includes(v)) return err(res, 400, 'value deve ser 1, -1 ou 0')

      if (v === 0) {
        // remove voto
        const { error } = await supabase.from('bc_votes')
          .delete()
          .eq('user_id', user_id).eq('target_type', target_type).eq('target_id', target_id)
        if (error) throw error
        return res.status(200).json({ success: true, removed: true })
      } else {
        // upsert
        const { data, error } = await supabase.from('bc_votes')
          .upsert({ user_id, target_type, target_id, value: v }, { onConflict: 'user_id,target_type,target_id' })
          .select()
          .single()
        if (error) throw error
        return res.status(200).json({ success: true, vote: data })
      }
    }

    // ══════════ POST: rsvp ═════════════════════════════════════════════════
    if (req.method === 'POST' && action === 'rsvp') {
      const { user_id, post_id, status } = req.body || {}
      if (!user_id || !post_id || !status) return err(res, 400, 'user_id, post_id, status obrigatórios')
      if (!VALID_RSVP.has(status)) return err(res, 400, 'status inválido')

      const { data, error } = await supabase
        .from('bc_event_rsvps')
        .upsert({ post_id, user_id, status }, { onConflict: 'post_id,user_id' })
        .select()
        .single()
      if (error) throw error

      // Atualiza contador event_rsvp_count se 'going'
      const { count } = await supabase.from('bc_event_rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', post_id).eq('status', 'going')
      await supabase.from('bc_posts').update({ event_rsvp_count: count || 0 }).eq('id', post_id)

      return res.status(200).json({ success: true, rsvp: data, going_count: count || 0 })
    }

    // ══════════ POST: report ═══════════════════════════════════════════════
    if (req.method === 'POST' && action === 'report') {
      const { reporter_id, target_type, target_id, reason, details } = req.body || {}
      if (!reporter_id || !target_type || !target_id || !reason) return err(res, 400, 'campos obrigatórios faltando')
      if (!VALID_REPORT_REASONS.has(reason)) return err(res, 400, 'reason inválido')

      const { data, error } = await supabase.from('bc_reports')
        .insert({ reporter_id, target_type, target_id, reason, details: details || null })
        .select()
        .single()
      if (error) throw error

      // Incrementa reported_count no post (se aplicável)
      if (target_type === 'post') {
        const { data: post } = await supabase.from('bc_posts').select('reported_count').eq('id', target_id).single()
        if (post) {
          await supabase.from('bc_posts').update({ reported_count: (post.reported_count || 0) + 1 }).eq('id', target_id)
        }
      }

      return res.status(201).json({ success: true, report: data })
    }

    // ══════════ DELETE: post (soft, só autor) ══════════════════════════════
    if (req.method === 'DELETE' && action === 'delete-post') {
      const { id, user_id } = req.query
      if (!id || !user_id) return err(res, 400, 'id e user_id obrigatórios')

      const { data: post } = await supabase.from('bc_posts').select('author_id').eq('id', id).single()
      if (!post) return err(res, 404, 'Post não encontrado')
      if (post.author_id !== user_id) return err(res, 403, 'Apenas o autor pode deletar')

      const { error } = await supabase.from('bc_posts').update({ is_deleted: true }).eq('id', id)
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    // ══════════ DELETE: comment (soft, só autor) ═══════════════════════════
    if (req.method === 'DELETE' && action === 'delete-comment') {
      const { id, user_id } = req.query
      if (!id || !user_id) return err(res, 400, 'id e user_id obrigatórios')

      const { data: comment } = await supabase.from('bc_comments').select('author_id').eq('id', id).single()
      if (!comment) return err(res, 404, 'Comentário não encontrado')
      if (comment.author_id !== user_id) return err(res, 403, 'Apenas o autor pode deletar')

      const { error } = await supabase.from('bc_comments').update({ is_deleted: true }).eq('id', id)
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    return err(res, 405, 'action ou método inválido')
  } catch (e) {
    console.error('social api error:', e.message)
    return err(res, 500, 'Erro interno: ' + e.message)
  }
}
