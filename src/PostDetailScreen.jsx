import { useState, useEffect, useCallback, useMemo } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { apiFetch } from './lib/apiFetch'
import { requireOnboarding } from './lib/onboardingGate'
import { renderTextWithMentions } from './lib/mentions'
import { PostCard } from './FeedScreen'

// ════════════════════════════════════════════════════════════════════════════
//   PostDetailScreen — um post, presença (eventos) e os comentários
//
//   Rota: /post/<id> (link das notificações) e /app/post/<id>.
//   API:  GET /api/social?action=post&id=   (com Bearer devolve my_rsvp)
//         POST create-comment · DELETE delete-comment · POST rsvp
// ════════════════════════════════════════════════════════════════════════════

const RSVP = [
  { key: 'going',     label: 'Vou',        on: C.green,  bg: '#D1FAE5' },
  { key: 'maybe',     label: 'Talvez',     on: '#B45309', bg: '#FEF3C7' },
  { key: 'not_going', label: 'Não vou',    on: '#6B7280', bg: '#F3F4F6' },
]

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60); if (m < 60) return `${m}min`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function Mentions({ text }) {
  const parts = useMemo(() => renderTextWithMentions(text || ''), [text])
  return parts.map((p, i) => p.type === 'mention'
    ? <span key={i} style={{ color: C.navy, fontWeight: 600 }}>@{p.value}</span>
    : <span key={i}>{p.value}</span>)
}

function Who({ item }) {
  if (item.is_anonymous || !item.author) return <span style={{ color: C.inkMuted, fontStyle: 'italic' }}>Anônimo</span>
  const a = item.author
  const name = a.username ? '@' + a.username : (a.display_name || 'Membro')
  const initial = (a.display_name || a.username || '?').charAt(0).toUpperCase()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: C.ink }}>
      {a.avatar_url
        ? <img src={a.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
        : <span style={{ width: 22, height: 22, borderRadius: '50%', background: a.avatar_color || C.green, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{initial}</span>}
      {name}
    </span>
  )
}

export default function PostDetailScreen({ postId, onNavigate }) {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [replyTo, setReplyTo] = useState(null)      // comentário sendo respondido
  const [body, setBody] = useState('')
  const [anon, setAnon] = useState(false)
  const [sending, setSending] = useState(false)
  const [rsvpBusy, setRsvpBusy] = useState(false)

  const load = useCallback(async () => {
    if (!postId) return
    setLoading(true); setError(null)
    try {
      const r = await apiFetch('/api/social?action=post&id=' + encodeURIComponent(postId))
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não deu pra abrir o post.')
      setData(d)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [postId])

  useEffect(() => { load() }, [load])

  const comments = useMemo(() => {
    const list = data?.comments || []
    const roots = list.filter(c => !c.parent_id)
    const byParent = {}
    for (const c of list) if (c.parent_id) (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c)
    return { roots, byParent }
  }, [data])

  async function submit(e) {
    e.preventDefault()
    if (!user || !body.trim() || sending) return
    if (!(await requireOnboarding(user))) return
    setSending(true)
    try {
      const r = await apiFetch('/api/social?action=create-comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, parent_id: replyTo?.id || null, body: body.trim(), is_anonymous: anon }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não deu pra comentar.')
      setBody(''); setReplyTo(null); setAnon(false)
      await load()
    } catch (err) { alert(err.message) }
    finally { setSending(false) }
  }

  async function remove(c) {
    if (!confirm('Apagar seu comentário?')) return
    const r = await apiFetch('/api/social?action=delete-comment&id=' + c.id, { method: 'DELETE' })
    if (r.ok) load()
  }

  async function rsvp(status) {
    if (!user || rsvpBusy) return
    if (!(await requireOnboarding(user))) return
    setRsvpBusy(true)
    try {
      const r = await apiFetch('/api/social?action=rsvp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, status }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não deu pra confirmar.')
      setData(prev => prev ? { ...prev, my_rsvp: status, post: { ...prev.post, event_rsvp_count: d.going_count } } : prev)
    } catch (err) { alert(err.message) }
    finally { setRsvpBusy(false) }
  }

  const back = () => {
    if (window.history.length > 1) window.history.back()
    else onNavigate && onNavigate('feed')
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: C.inkMuted, fontFamily: FONT.sans }}>Carregando…</div>
  if (error) return (
    <div style={{ fontFamily: FONT.sans, padding: '12px 0' }}>
      <button onClick={back} style={linkBtn}>← Voltar</button>
      <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '12px 14px', borderRadius: 8, fontSize: 13, marginTop: 10 }}>{error}</div>
    </div>
  )
  const { post, community } = data
  const isEvent = post.type === 'event'
  const past = isEvent && post.event_date && new Date(post.event_date).getTime() < Date.now()

  function Comment({ c, depth }) {
    const mine = user && c.author_id === user.id
    return (
      <div style={{ marginLeft: depth ? 28 : 0, marginTop: 10 }}>
        <div style={{ background: C.white, border: '1px solid ' + C.line, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4, flexWrap: 'wrap' }}>
            <Who item={c} />
            <span style={{ color: C.inkMuted }}>· {timeAgo(c.created_at)}</span>
          </div>
          <div style={{ fontSize: 14, color: c.is_deleted ? C.inkMuted : C.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap', fontStyle: c.is_deleted ? 'italic' : 'normal' }}>
            {c.is_deleted ? 'Comentário apagado.' : <Mentions text={c.body} />}
          </div>
          {!c.is_deleted && user && (
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12 }}>
              {depth < 2 && !post.is_locked && <button onClick={() => { setReplyTo(c); document.getElementById('bc-comment-box')?.focus() }} style={linkBtn}>Responder</button>}
              {mine && <button onClick={() => remove(c)} style={{ ...linkBtn, color: '#B91C1C' }}>Apagar</button>}
            </div>
          )}
        </div>
        {(comments.byParent[c.id] || []).map(ch => <Comment key={ch.id} c={ch} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 13 }}>
        <button onClick={back} style={linkBtn}>← Voltar</button>
        {community && (
          <button onClick={() => onNavigate && onNavigate('community', community.slug)} style={{ ...linkBtn, color: C.inkSoft }}>
            {community.icon} {community.name}
          </button>
        )}
      </div>

      <PostCard post={post} currentUser={user} full onClick={() => {}} onVote={() => {}} />

      {isEvent && (
        <div style={{ background: C.white, border: '1px solid ' + C.line, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {past ? 'Esse evento já aconteceu' : 'Você vai?'}
            {post.event_rsvp_count > 0 && <span style={{ color: C.green, fontWeight: 600, marginLeft: 8 }}>✓ {post.event_rsvp_count} confirmado{post.event_rsvp_count > 1 ? 's' : ''}</span>}
          </div>
          {!past && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {RSVP.map(o => {
                const on = data.my_rsvp === o.key
                return (
                  <button key={o.key} onClick={() => rsvp(o.key)} disabled={rsvpBusy || !user} style={{
                    fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 20, cursor: 'pointer',
                    background: on ? o.on : C.white, color: on ? '#fff' : o.on, border: '1px solid ' + (on ? o.on : C.line),
                  }}>{o.label}</button>
                )
              })}
            </div>
          )}
          {!user && <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 6 }}>Entre pra confirmar presença.</div>}
        </div>
      )}

      <h2 style={{ fontFamily: FONT.serif, fontSize: 18, fontWeight: 600, margin: '18px 0 6px' }}>
        {post.comment_count || 0} comentário{post.comment_count === 1 ? '' : 's'}
      </h2>

      {user && !post.is_locked ? (
        <form onSubmit={submit} style={{ background: C.white, border: '1px solid ' + C.line, borderRadius: 12, padding: '12px 14px' }}>
          {replyTo && (
            <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              Respondendo a <Who item={replyTo} />
              <button type="button" onClick={() => setReplyTo(null)} style={linkBtn}>cancelar</button>
            </div>
          )}
          <textarea id="bc-comment-box" value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={3000}
            placeholder={replyTo ? 'Sua resposta…' : 'Escreva um comentário… use @usuario pra mencionar alguém'}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 8, padding: '10px 12px', fontFamily: FONT.sans, fontSize: 14, resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: C.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} /> Comentar como anônimo
            </label>
            <button type="submit" disabled={sending || !body.trim()} style={{
              marginLeft: 'auto', fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 8,
              background: C.green, color: '#fff', border: 'none', cursor: 'pointer', opacity: sending || !body.trim() ? 0.6 : 1,
            }}>{sending ? 'Enviando…' : 'Comentar'}</button>
          </div>
        </form>
      ) : post.is_locked ? (
        <div style={{ fontSize: 13, color: C.inkMuted, padding: '8px 0' }}>Esse post está fechado para comentários.</div>
      ) : (
        <div style={{ fontSize: 13, color: C.inkMuted, padding: '8px 0' }}>Entre pra comentar.</div>
      )}

      {comments.roots.length === 0
        ? <div style={{ fontSize: 13, color: C.inkMuted, padding: '16px 0' }}>Ninguém comentou ainda. Seja a primeira pessoa.</div>
        : comments.roots.map(c => <Comment key={c.id} c={c} depth={0} />)}
    </div>
  )
}

const linkBtn = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
  color: C.navy, fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600,
}
