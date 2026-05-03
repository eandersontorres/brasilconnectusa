import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthModal'
import GetStartedChecklist from './GetStartedChecklist'
import { C, FONT, useIsMobile } from './lib/colors'

// ────────────────────────────────────────────────────────────────────────────
//   FeedScreen — feed social estilo Reddit/Nextdoor
// ────────────────────────────────────────────────────────────────────────────

const POST_TYPES = {
  question:       { label: 'Pergunta',     color: '#3B82F6', bg: '#DBEAFE', icon: '?'  },
  recommendation: { label: 'Indicação',    color: '#10B981', bg: '#D1FAE5', icon: '★'  },
  event:          { label: 'Evento',       color: '#F59E0B', bg: '#FEF3C7', icon: '◉'  },
  classified:     { label: 'Vende/Compra', color: '#8B5CF6', bg: '#EDE9FE', icon: '$'  },
  job:            { label: 'Vaga',         color: C.green,   bg: '#D1FAE5', icon: '◫'  },
  announcement:   { label: 'Aviso',        color: '#EF4444', bg: '#FEE2E2', icon: '!'  },
}

// ────────────────────────────────────────────────────────────────────────────
//   Helpers
// ────────────────────────────────────────────────────────────────────────────
function timeAgo(date) {
  const d = new Date(date)
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function Avatar({ name, size = 28 }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: C.green,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 700, flexShrink: 0,
    }}>
      {initial}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   PostCard
// ────────────────────────────────────────────────────────────────────────────
function PostCard({ post, currentUser, onClick, onVote }) {
  const t = POST_TYPES[post.type] || POST_TYPES.question
  const score = (post.upvotes || 0) - (post.downvotes || 0)
  const [voted, setVoted] = useState(0)

  async function handleVote(e, value) {
    e.stopPropagation()
    if (!currentUser) { onVote && onVote('need-auth'); return }
    const newValue = voted === value ? 0 : value
    setVoted(newValue)
    try {
      await fetch('/api/social?action=vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id, target_type: 'post', target_id: post.id, value: newValue,
        }),
      })
    } catch (_) { setVoted(voted) }
  }

  return (
    <div onClick={onClick} style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
      padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
      transition: 'border-color .15s, box-shadow .15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.04)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{
          background: t.bg, color: t.color, padding: '2px 8px', borderRadius: 4,
          fontWeight: 600,
        }}>
          {t.icon} {t.label}
        </span>
        {post.community && (
          <span style={{ color: C.inkSoft, fontWeight: 500 }}>
            {post.community.name}
          </span>
        )}
        <span style={{ color: C.inkMuted }}>· {timeAgo(post.created_at)}</span>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35 }}>
        {post.title}
      </div>

      {post.body && (
        <div style={{
          fontSize: 13, color: C.inkSoft, lineHeight: 1.5, marginBottom: 8,
          overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3,
        }}>
          {post.body}
        </div>
      )}

      {post.type === 'event' && post.event_date && (
        <div style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>
          {new Date(post.event_date).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {post.event_location && ' · ' + post.event_location}
          {post.event_rsvp_count > 0 && ` · ${post.event_rsvp_count} confirmados`}
        </div>
      )}
      {post.type === 'classified' && post.classified_price && (
        <div style={{ fontSize: 13, color: '#6D28D9', background: '#EDE9FE', padding: '6px 10px', borderRadius: 6, marginBottom: 8, fontWeight: 600 }}>
          ${Number(post.classified_price).toLocaleString('en-US')}
        </div>
      )}
      {post.type === 'job' && (post.job_pay || post.job_category) && (
        <div style={{ fontSize: 12, color: '#065F46', background: '#D1FAE5', padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>
          {post.job_pay && post.job_pay}
          {post.job_pay && post.job_category && ' · '}
          {post.job_category}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: C.inkSoft, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={e => handleVote(e, 1)} style={{
            background: voted === 1 ? C.green : 'transparent',
            color: voted === 1 ? '#fff' : C.inkSoft,
            border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 14,
          }}>▲</button>
          <span style={{ fontWeight: 700, color: voted ? C.green : C.ink, minWidth: 18, textAlign: 'center' }}>
            {score + voted}
          </span>
          <button onClick={e => handleVote(e, -1)} style={{
            background: voted === -1 ? '#EF4444' : 'transparent',
            color: voted === -1 ? '#fff' : C.inkSoft,
            border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 14,
          }}>▼</button>
        </div>
        <span>{post.comment_count || 0} comentários</span>
        <span style={{ marginLeft: 'auto' }}>{post.view_count || 0} views</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   CreatePostModal
// ────────────────────────────────────────────────────────────────────────────
function CreatePostModal({ user, onClose, onCreated }) {
  const [communities, setCommunities] = useState([])
  const [communityId, setCommunityId] = useState('')
  const [type, setType] = useState('question')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/social?action=my-communities&user_id=' + user.id)
      .then(r => r.json())
      .then(d => {
        const list = d.communities || []
        if (list.length > 0) {
          setCommunities(list)
          setCommunityId(list[0].id)
        } else {
          // sem comunidades ainda — busca todas
          fetch('/api/social?action=communities').then(r => r.json()).then(d2 => {
            const all = (d2.communities || []).slice(0, 60)
            setCommunities(all)
            if (all.length > 0) setCommunityId(all[0].id)
          })
        }
      })
  }, [user])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title || !communityId) { setError('Comunidade e título obrigatórios'); return }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/social?action=create-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, community_id: communityId, type, title, body }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      onCreated()
    } catch (err) {
      setError(err.message || 'Erro ao publicar')
    } finally { setSubmitting(false) }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid ' + C.line, fontSize: 14, outline: 'none',
    background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans,
    color: C.ink,
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: 16, padding: 24, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflowY: 'auto', fontFamily: FONT.sans,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>Criar post</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 20, color: C.inkMuted,
            cursor: 'pointer', padding: 0,
          }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Tipo
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(POST_TYPES).map(([k, v]) => (
                <button key={k} type="button" onClick={() => setType(k)} style={{
                  padding: '6px 12px', borderRadius: 20,
                  background: type === k ? v.color : C.soft,
                  color: type === k ? '#fff' : C.inkSoft,
                  border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: FONT.sans,
                }}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Comunidade
            </label>
            <select value={communityId} onChange={e => setCommunityId(e.target.value)} required style={inputStyle}>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Título
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200}
              placeholder="Ex: Onde acho mandioca em Boston?"
              style={inputStyle} />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Detalhes (opcional)
            </label>
            <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={5000} rows={4}
              placeholder="Adicione mais contexto..."
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: '#FEE2E2', color: '#991B1B', fontSize: 12 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting || !title || !communityId} style={{
            padding: '12px 0', borderRadius: 10,
            background: submitting ? C.inkLight : C.green,
            color: '#fff', fontSize: 14, fontWeight: 700, border: 'none',
            cursor: submitting ? 'default' : 'pointer', fontFamily: FONT.sans,
          }}>
            {submitting ? 'Publicando…' : 'Publicar →'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   FeedScreen principal
// ────────────────────────────────────────────────────────────────────────────
export default function FeedScreen({ onNavigate }) {
  const { user } = useAuth()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [needAuthMsg, setNeedAuthMsg] = useState(false)

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const url = user
        ? `/api/social?action=feed&user_id=${user.id}`
        : '/api/social?action=feed-public'
      const res = await fetch(url)
      const data = await res.json()
      setPosts(data.posts || [])
    } catch (_) { setPosts([]) }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { loadFeed() }, [loadFeed])

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink }}>

      {/* Hero pra usuário não logado */}
      {!user && (
        <div style={{
          background: 'linear-gradient(135deg, ' + C.green + ' 0%, ' + C.navy + ' 100%)',
          borderRadius: 12, padding: '20px 18px', color: '#fff', marginBottom: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontFamily: FONT.serif, fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
            Comunidade brasileira nos EUA
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 12, lineHeight: 1.5 }}>
            Pergunte, indique, encontre brasileiros perto de você
          </div>
          <button onClick={() => setNeedAuthMsg(true)} style={{
            background: '#fff', color: C.green, border: 'none', borderRadius: 8,
            padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: FONT.sans,
          }}>
            Entrar / criar conta grátis →
          </button>
        </div>
      )}

      {/* Get Started Checklist */}
      {user && <GetStartedChecklist user={user} onAction={(act, key) => {
        if (act === 'create-post') setShowCreate(true)
        else if (act === 'navigate' && key) onNavigate && onNavigate(key)
      }} />}

      {/* Compositor */}
      <div style={{
        background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 10,
      }}>
        {user && <Avatar name={user.email} />}
        <button onClick={() => user ? setShowCreate(true) : setNeedAuthMsg(true)} style={{
          flex: 1, padding: '10px 14px', borderRadius: 24,
          border: '1px solid ' + C.line, background: C.paper,
          color: C.inkMuted, fontSize: 13, cursor: 'pointer',
          textAlign: 'left', fontFamily: FONT.sans,
        }}>
          Pergunte algo, indique, ou compartilhe…
        </button>
      </div>

      {needAuthMsg && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: '#92400E', marginBottom: 10,
        }}>
          Faça login no botão "Entrar" no topo pra interagir.
        </div>
      )}

      {/* Feed */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: C.inkMuted }}>Carregando feed…</div>
      ) : posts.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 32, color: C.inkMuted,
          background: C.white, border: '1px dashed ' + C.line, borderRadius: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
            Nada por aqui ainda
          </div>
          <div style={{ fontSize: 12 }}>Seja a primeira pessoa a postar!</div>
        </div>
      ) : (
        <div>
          {posts.map(p => (
            <PostCard
              key={p.id}
              post={p}
              currentUser={user}
              onClick={() => alert('Detalhe do post — em breve')}
              onVote={r => { if (r === 'need-auth') setNeedAuthMsg(true) }}
            />
          ))}
        </div>
      )}

      {showCreate && user && (
        <CreatePostModal
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadFeed() }}
        />
      )}
    </div>
  )
}
