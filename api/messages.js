/**
 * /api/messages — mensagens diretas entre membros.
 * Todas as ações exigem Authorization: Bearer <JWT>.
 *
 * GET  ?action=threads                 → minhas conversas (mais recente primeiro)
 * GET  ?action=thread&id=UUID          → mensagens da conversa (marca como lida)
 * GET  ?action=unread                  → total de mensagens não lidas
 * GET  ?action=peer&user_id=UUID|&username=x → posso escrever pra essa pessoa? já existe conversa?
 * POST ?action=send    { thread_id | to_user_id, body }
 * POST ?action=block   { user_id }
 * POST ?action=unblock { user_id }
 *
 * Regras:
 *  - Pra INICIAR uma conversa, as duas pessoas precisam ter ao menos uma comunidade em comum.
 *  - Bloqueio de qualquer lado impede novas mensagens (a conversa continua visível).
 *  - Limites: 30 mensagens a cada 10 minutos e 10 conversas novas por dia, por pessoa.
 *  - Denúncia usa /api/social?action=report com target_type 'dm_message'.
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from './_lib/businessAuth.js'

const MAX_BODY = 2000
const MSG_WINDOW_MIN = 10
const MSG_WINDOW_MAX = 30
const NEW_THREADS_PER_DAY = 10
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const err = (res, status, error, extra) => res.status(status).json({ error, ...(extra || {}) })
const pair = (x, y) => (x < y ? [x, y] : [y, x])
const other = (t, me) => (t.user_a === me ? t.user_b : t.user_a)

async function profiles(supabase, ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await supabase.from('bc_profiles')
    .select('user_id, username, display_name, avatar_url, avatar_color').in('user_id', uniq)
  const map = {}
  for (const p of data || []) {
    map[p.user_id] = {
      user_id: p.user_id,
      username: p.username || null,
      display_name: p.display_name || null,
      avatar_url: p.avatar_url || null,
      avatar_color: p.avatar_color || null,
    }
  }
  for (const id of uniq) if (!map[id]) map[id] = { user_id: id, username: null, display_name: 'Membro', avatar_url: null, avatar_color: null }
  return map
}

async function blockState(supabase, me, them) {
  const { data } = await supabase.from('bc_user_blocks').select('blocker_id, blocked_id')
    .or(`and(blocker_id.eq.${me},blocked_id.eq.${them}),and(blocker_id.eq.${them},blocked_id.eq.${me})`)
  const rows = data || []
  return {
    blocked_by_me: rows.some(r => r.blocker_id === me),
    blocked_me: rows.some(r => r.blocker_id === them),
  }
}

async function shareCommunity(supabase, me, them) {
  const { data: mine } = await supabase.from('bc_community_members').select('community_id').eq('user_id', me).limit(500)
  const ids = (mine || []).map(r => r.community_id)
  if (!ids.length) return false
  const { count } = await supabase.from('bc_community_members')
    .select('id', { count: 'exact', head: true }).eq('user_id', them).in('community_id', ids)
  return (count || 0) > 0
}

async function findThread(supabase, me, them) {
  const [a, b] = pair(me, them)
  const { data } = await supabase.from('bc_dm_threads').select('*').eq('user_a', a).eq('user_b', b).maybeSingle()
  return data || null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const action = req.query?.action
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  try {
    const auth = await requireAuthOnly(req, supabase)
    if (!auth.ok) return err(res, auth.status, auth.error)
    const me = auth.user.id

    // ── GET unread ───────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'unread') {
      const { data } = await supabase.from('bc_dm_threads')
        .select('user_a, unread_a, unread_b').or(`user_a.eq.${me},user_b.eq.${me}`)
      const unread = (data || []).reduce((n, t) => n + (t.user_a === me ? t.unread_a : t.unread_b), 0)
      return res.status(200).json({ unread })
    }

    // ── GET threads ──────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'threads') {
      const { data, error } = await supabase.from('bc_dm_threads').select('*')
        .or(`user_a.eq.${me},user_b.eq.${me}`)
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false }).limit(100)
      if (error) throw error
      const people = await profiles(supabase, (data || []).map(t => other(t, me)))
      const threads = (data || []).map(t => ({
        id: t.id,
        peer: people[other(t, me)],
        last_message_at: t.last_message_at,
        last_message_preview: t.last_message_preview,
        last_from_me: t.last_sender_id === me,
        unread: t.user_a === me ? t.unread_a : t.unread_b,
      }))
      return res.status(200).json({ threads })
    }

    // ── GET thread ───────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'thread') {
      const id = String(req.query.id || '')
      if (!UUID.test(id)) return err(res, 400, 'id inválido')
      const { data: t } = await supabase.from('bc_dm_threads').select('*').eq('id', id).maybeSingle()
      if (!t || (t.user_a !== me && t.user_b !== me)) return err(res, 404, 'Conversa não encontrada')

      const { data: msgs } = await supabase.from('bc_dm_messages')
        .select('id, sender_id, body, created_at').eq('thread_id', id)
        .order('created_at', { ascending: false }).limit(200)

      // Marca como lida pra mim
      const field = t.user_a === me ? 'unread_a' : 'unread_b'
      if (t[field] > 0) await supabase.from('bc_dm_threads').update({ [field]: 0 }).eq('id', id)

      const them = other(t, me)
      const people = await profiles(supabase, [them])
      const blocks = await blockState(supabase, me, them)
      return res.status(200).json({
        thread: { id: t.id, peer: people[them], ...blocks },
        messages: (msgs || []).reverse().map(m => ({ id: m.id, body: m.body, created_at: m.created_at, mine: m.sender_id === me })),
      })
    }

    // ── GET peer ─────────────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'peer') {
      let them = String(req.query.user_id || '')
      if (!them && req.query.username) {
        const u = String(req.query.username).replace(/^@/, '').trim().toLowerCase()
        if (!/^[a-z0-9_]{3,30}$/.test(u)) return err(res, 400, 'Nome de usuário inválido')
        const { data: p } = await supabase.from('bc_profiles').select('user_id').ilike('username', u).maybeSingle()
        if (!p) return err(res, 404, 'Não encontramos @' + u)
        them = p.user_id
      }
      if (!UUID.test(them)) return err(res, 400, 'user_id ou username obrigatório')
      if (them === me) return err(res, 400, 'Você não pode escrever pra si mesmo')

      const people = await profiles(supabase, [them])
      const existing = await findThread(supabase, me, them)
      const blocks = await blockState(supabase, me, them)
      let allowed = true, reason = null
      if (blocks.blocked_by_me) { allowed = false; reason = 'Você bloqueou essa pessoa.' }
      else if (blocks.blocked_me) { allowed = false; reason = 'Essa pessoa não está recebendo mensagens.' }
      else if (!existing && !(await shareCommunity(supabase, me, them))) {
        allowed = false; reason = 'Vocês ainda não têm uma comunidade em comum. Entre numa comunidade em que essa pessoa participa pra poder escrever.'
      }
      return res.status(200).json({ peer: people[them], thread_id: existing?.id || null, allowed, reason, ...blocks })
    }

    // ── POST send ────────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'send') {
      const b = req.body || {}
      const body = String(b.body || '').trim().slice(0, MAX_BODY)
      if (!body) return err(res, 400, 'Escreva a mensagem')

      let thread = null, them = null
      if (b.thread_id) {
        if (!UUID.test(String(b.thread_id))) return err(res, 400, 'thread_id inválido')
        const { data: t } = await supabase.from('bc_dm_threads').select('*').eq('id', b.thread_id).maybeSingle()
        if (!t || (t.user_a !== me && t.user_b !== me)) return err(res, 404, 'Conversa não encontrada')
        thread = t; them = other(t, me)
      } else {
        them = String(b.to_user_id || '')
        if (!UUID.test(them)) return err(res, 400, 'to_user_id obrigatório')
        if (them === me) return err(res, 400, 'Você não pode escrever pra si mesmo')
        thread = await findThread(supabase, me, them)
      }

      const blocks = await blockState(supabase, me, them)
      if (blocks.blocked_by_me) return err(res, 403, 'Você bloqueou essa pessoa. Desbloqueie pra escrever.')
      if (blocks.blocked_me) return err(res, 403, 'Essa pessoa não está recebendo mensagens.')

      // Limite de volume
      const since = new Date(Date.now() - MSG_WINDOW_MIN * 60_000).toISOString()
      const { count: recent } = await supabase.from('bc_dm_messages')
        .select('id', { count: 'exact', head: true }).eq('sender_id', me).gte('created_at', since)
      if ((recent || 0) >= MSG_WINDOW_MAX) return err(res, 429, 'Muitas mensagens em pouco tempo. Tente de novo em alguns minutos.')

      if (!thread) {
        const { data: exists } = await supabase.from('bc_profiles').select('user_id').eq('user_id', them).maybeSingle()
        if (!exists) return err(res, 404, 'Pessoa não encontrada')
        if (!(await shareCommunity(supabase, me, them))) {
          return err(res, 403, 'Vocês ainda não têm uma comunidade em comum.')
        }
        const day = new Date(Date.now() - 24 * 3600_000).toISOString()
        const { count: opened } = await supabase.from('bc_dm_threads')
          .select('id', { count: 'exact', head: true }).eq('created_by', me).gte('created_at', day)
        if ((opened || 0) >= NEW_THREADS_PER_DAY) return err(res, 429, 'Você abriu muitas conversas novas hoje. Tente amanhã.')

        const [a, bb] = pair(me, them)
        const ins = await supabase.from('bc_dm_threads').insert({ user_a: a, user_b: bb, created_by: me }).select().single()
        if (ins.error) {
          // Corrida: a outra pessoa criou ao mesmo tempo
          thread = await findThread(supabase, me, them)
          if (!thread) throw ins.error
        } else thread = ins.data
      }

      const { data: msg, error: msgErr } = await supabase.from('bc_dm_messages')
        .insert({ thread_id: thread.id, sender_id: me, body }).select('id, body, created_at').single()
      if (msgErr) throw msgErr

      const theirField = thread.user_a === them ? 'unread_a' : 'unread_b'
      const wasUnread = thread[theirField] || 0
      await supabase.from('bc_dm_threads').update({
        last_message_at: msg.created_at,
        last_message_preview: body.slice(0, 120),
        last_sender_id: me,
        [theirField]: wasUnread + 1,
      }).eq('id', thread.id)

      // Avisa só na primeira mensagem não lida (não a cada mensagem)
      if (wasUnread === 0) {
        try {
          const { createNotification } = await import('./_lib/notify.js')
          const mine = (await profiles(supabase, [me]))[me]
          const name = mine.username ? '@' + mine.username : (mine.display_name || 'Alguém')
          await createNotification({
            user_id: them,
            type: 'dm',
            title: name + ' te mandou uma mensagem',
            body: body.slice(0, 100),
            url: '/app/mensagens/' + thread.id,
            icon: '✉️',
            metadata: { thread_id: thread.id },
            also_push: true, push_topic: 'community',
          })
        } catch (e) { console.error('dm notif failed:', e.message) }
      }

      return res.status(201).json({ success: true, thread_id: thread.id, message: { ...msg, mine: true } })
    }

    // ── POST block / unblock ─────────────────────────────────────────────
    if (req.method === 'POST' && (action === 'block' || action === 'unblock')) {
      const them = String(req.body?.user_id || '')
      if (!UUID.test(them) || them === me) return err(res, 400, 'user_id inválido')
      if (action === 'block') {
        const { error } = await supabase.from('bc_user_blocks')
          .upsert({ blocker_id: me, blocked_id: them }, { onConflict: 'blocker_id,blocked_id' })
        if (error) throw error
      } else {
        const { error } = await supabase.from('bc_user_blocks').delete().eq('blocker_id', me).eq('blocked_id', them)
        if (error) throw error
      }
      return res.status(200).json({ success: true, blocked_by_me: action === 'block' })
    }

    return err(res, 405, 'action ou método inválido')
  } catch (e) {
    console.error('messages api error:', e.message)
    return err(res, 500, 'Erro interno: ' + e.message)
  }
}
