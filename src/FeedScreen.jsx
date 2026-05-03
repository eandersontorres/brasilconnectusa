import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import AuthModal, { useAuth } from './AuthModal'

// ════════════════════════════════════════════════════════════════════════════
//   Paleta Brasil
// ════════════════════════════════════════════════════════════════════════════
const GREEN  = '#009c3b'
const BLUE   = '#002776'
const YELLOW = '#ffdf00'
const GOLD   = '#FFD700'
const NAVY   = '#0B1928'
const CREAM  = '#FAF7F0'

const POST_TYPES = {
  question:       { label: 'Pergunta',      color: '#3B82F6', bg: '#DBEAFE', icon: '🤔' },
  recommendation: { label: 'Indicação',     color: '#10B981', bg: '#D1FAE5', icon: '⭐' },
  event:          { label: 'Evento',        color: '#F59E0B', bg: '#FEF3C7', icon: '🎉' },
  classified:     { label: 'Vende/Compra',  color: '#8B5CF6', bg: '#EDE9FE', icon: '🛒' },
  job:            { label: 'Vaga',          color: GREEN,     bg: '#D1FAE5', icon: '💼' },
  announcement:   { label: 'Aviso',         color: '#EF4444', bg: '#FEE2E2', icon: '📢' },
}

// ════════════════════════════════════════════════════════════════════════════
//   Helpers
// ════════════════════════════════════════════════════════════════════════════
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
      width: size, height: size, borderRadius: '50%', background: GREEN,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 700, flexShrink: 0,
    }}>
      {initial}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   PostCard
// ════════════════════════════════════════════════════════════════════════════
function PostCard({ post, onClick, currentUser, onVote }) {
  const t = POST_TYPES[post.type] || POST_TYPES.question
  const score = (post.upvotes || 0) - (post.downvotes || 0)
  const [voted, setVoted] = useState(0)  // -1, 0, 1

  async function handleVote(e, value) {
    e.stopPropagation()
    if (!currentUser) { onVote && onVote('need-auth'); return }
    const newValue = voted === value ? 0 : value
    setVoted(newValue)
    try {
      await fetch('/api/social?action=vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id, target_type: 'post', target_id: post.id, value: newValue,
        }),
      })
    } catch (_) { setVoted(voted) }
  }

  return (
    <div onClick={onClick} style={{
      background: '#fff', border: '1px solid #E5E1D6', borderRadius: 12,
      padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
      transition: 'border-color .15s, box-shadow .15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.04)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E1D6'; e.currentTarget.style.boxShadow = 'none' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{
          background: t.bg, color: t.color, padding: '2px 8px', borderRadius: 4,
          fontWeight: 600,
        }}>
          {t.icon} {t.label}
        </span>
        {post.community && (
          <span style={{ color: '#6b7280', fontWeight: 500 }}>
            {post.community.icon} {post.community.name}
          </span>
        )}
        <span style={{ color: '#9ca3af' }}>· {timeAgo(post.created_at)}</span>
      </div>

      {/* Title */}
      <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4, lineHeight: 1.35 }}>
        {post.title}
      </div>

      {/* Body preview */}
      {post.body && (
        <div style={{
          fontSize: 13, color: '#4B5563', lineHeight: 1.5, marginBottom: 8,
          overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3,
        }}>
          {post.body}
        </div>
      )}

      {/* Type-specific content */}
      {post.type === 'event' && post.event_date && (
        <div style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>
          📅 {new Date(post.event_date).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {post.event_location && ' · ' + post.event_location}
          {post.event_rsvp_count > 0 && ` · ${post.event_rsvp_count} confirmados`}
        </div>
      )}
      {post.type === 'classified' && post.classified_price && (
        <div style={{ fontSize: 13, color: '#6D28D9', background: '#EDE9FE', padding: '6px 10px', borderRadius: 6, marginBottom: 8, fontWeight: 600 }}>
          💰 ${Number(post.classified_price).toLocaleString('en-US')}
        </div>
      )}
      {post.type === 'job' && (post.job_pay || post.job_category) && (
        <div style={{ fontSize: 12, color: '#065F46', background: '#D1FAE5', padding: '6px 10px', borderRadius: 6, marginBottom: 8 }}>
          {post.job_pay && '💵 ' + post.job_pay}
          {post.job_pay && post.job_category && ' · '}
          {post.job_category}
        </div>
      )}

      {/* Footer: votes + comments */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#6b7280', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={e => handleVote(e, 1)} style={{
            background: voted === 1 ? GREEN : 'transparent', color: voted === 1 ? '#fff' : '#6b7280',
            border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 14,
          }}>▲</button>
          <span style={{ fontWeight: 700, color: voted ? GREEN : '#374151', minWidth: 18, textAlign: 'center' }}>
            {score + voted}
          </span>
          <button onClick={e => handleVote(e, -1)} style={{
            background: voted === -1 ? '#EF4444' : 'transparent', color: voted === -1 ? '#fff' : '#6b7280',
            border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 14,
          }}>▼</button>
        </div>
        <span>💬 {post.comment_count || 0}</span>
        <span style={{ marginLeft: 'auto' }}>👁 {post.view_count || 0}</span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Sidebar Esquerda — Comunidades
// ════════════════════════════════════════════════════════════════════════════
function CommunitiesList({ user, myCommunities, onSelectCommunity, activeSlug }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E1D6', borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        Suas comunidades
      </div>
      {!user && (
        <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', padding: '10px 0' }}>
          Faça login pra seguir comunidades
        </div>
      )}
      {user && myCommunities.length === 0 && (
        <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', padding: '10px 0' }}>
          Você ainda não segue nenhuma comunidade. Clique em &quot;Descobrir&quot; abaixo.
        </div>
      )}
      {myCommunities.map(c => (
        <button key={c.id} onClick={() => onSelectCommunity(c.slug)} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 10px', background: activeSlug === c.slug ? '#F0FDF4' : 'transparent',
          color: activeSlug === c.slug ? GREEN : '#374151',
          border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
          textAlign: 'left', marginBottom: 2, fontFamily: 'inherit',
        }}>
          <span style={{ fontSize: 14 }}>{c.icon}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        </button>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Sidebar Direita — Tools (Câmbio, Voos, Bolão)
// ════════════════════════════════════════════════════════════════════════════
function ToolsSidebar({ onNavigate }) {
  const [rate, setRate] = useState(null)
  useEffect(() => {
    fetch('/api/rates').then(r => r.json()).then(d => { if (d.mid_rate) setRate(d.mid_rate) }).catch(() => {})
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Câmbio */}
      <div style={{
        background: 'linear-gradient(135deg, ' + GREEN + ' 0%, #006428 100%)',
        borderRadius: 12, padding: '14px 16px', color: '#fff', cursor: 'pointer',
      }} onClick={() => onNavigate('remessas')}>
        <div style={{ fontSize: 10, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>
          💱 Câmbio agora
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {rate ? `R$ ${rate.toFixed(4)}` : 'Carregando...'}
        </div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>USD → BRL · Comparar 5 parceiros →</div>
      </div>

      {/* Voos */}
      <div style={{
        background: '#fff', border: '1px solid #E5E1D6', borderRadius: 12,
        padding: '12px 14px', cursor: 'pointer',
      }} onClick={() => onNavigate('voos')}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          ✈️ Voos pro Brasil
        </div>
        <div style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
          A partir de $480
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Skyscanner, KAYAK e mais →</div>
      </div>

      {/* Bolão */}
      <div style={{
        background: '#fff', border: '1px solid ' + YELLOW, borderRadius: 12,
        padding: '12px 14px', cursor: 'pointer',
      }} onClick={() => onNavigate('bolao')}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          ⚽ Bolão Copa 2026
        </div>
        <div style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
          Faltam 40 dias
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Crie ou entre num bolão →</div>
      </div>

      {/* Negócios */}
      <div style={{
        background: '#fff', border: '1px solid #E5E1D6', borderRadius: 12,
        padding: '12px 14px', cursor: 'pointer',
      }} onClick={() => onNavigate('negocios')}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          🏪 Negócios brasileiros
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>Restaurantes, mercados, salões →</div>
      </div>

      {/* Agenda */}
      <div style={{
        background: '#fff', border: '1px solid #E5E1D6', borderRadius: 12,
        padding: '12px 14px', cursor: 'pointer',
      }} onClick={() => onNavigate('agenda')}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          📅 Agendar serviços
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>Cabeleireira, manicure, etc →</div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   FeedScreen — componente principal
// ════════════════════════════════════════════════════════════════════════════
export default function FeedScreen({ onNavigate }) {
  const { user, loading: authLoading } = useAuth()
  const [posts, setPosts] = useState([])
  const [myCommunities, setMyCommunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [activeView, setActiveView] = useState('feed')   // 'feed' | 'community:<slug>'

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const url = user
        ? `/api/social?action=feed&user_id=${user.id}`
        : '/api/social?action=feed-public'
      const res = await fetch(url)
      const data = await res.json()
      setPosts(data.posts || [])
    } catch (_) {
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [user])

  const loadMyCommunities = useCallback(async () => {
    if (!user) { setMyCommunities([]); return }
    try {
      const res = await fetch(`/api/social?action=my-communities&user_id=${user.id}`)
      const data = await res.json()
      setMyCommunities(data.communities || [])
    } catch (_) {
      setMyCommunities([])
    }
  }, [user])

  useEffect(() => { loadFeed() }, [loadFeed])
  useEffect(() => { loadMyCommunities() }, [loadMyCommunities])

  return (
    <div style={{
      maxWidth: 1200, margin: '0 auto', padding: '16px',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 16,
      fontFamily: "'Sora', -apple-system, sans-serif",
    }}>
      {/* Hero / topo só aparece se não logado */}
      {!user && !authLoading && (
        <div style={{
          background: 'linear-gradient(135deg, ' + GREEN + ' 0%, ' + BLUE + ' 100%)',
          borderRadius: 14, padding: '20px 18px', color: '#fff', marginBottom: 4,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
            🇧🇷 Comunidade brasileira nos EUA
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 12, lineHeight: 1.5 }}>
            Pergunte, indique, encontre brasileiros perto de você
          </div>
          <button onClick={() => setShowAuth(true)} style={{
            background: '#fff', color: GREEN, border: 'none', borderRadius: 8,
            padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            Entrar / criar conta grátis →
          </button>
        </div>
      )}

      {/* Botão criar post */}
      <div style={{
        background: '#fff', border: '1px solid #E5E1D6', borderRadius: 12,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        {user && <Avatar name={user.email} />}
        <button onClick={() => user ? setShowCreate(true) : setShowAuth(true)} style={{
          flex: 1, padding: '10px 14px', borderRadius: 24, border: '1px solid #e5e7eb',
          background: '#F9FAFB', color: '#6b7280', fontSize: 13, cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}>
          Pergunte algo, indique, ou compartilhe…
        </button>
      </div>

      {/* Feed */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando feed…</div>
      ) : posts.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 32, color: '#9ca3af',
          background: '#fff', border: '1px dashed #E5E1D6', borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌱</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
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
              onVote={r => { if (r === 'need-auth') setShowAuth(true) }}
            />
          ))}
        </div>
      )}

      {/* Sidebar tools (mobile fica embaixo, desktop seria à direita) */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, padding: '0 4px' }}>
          ⚡ Ferramentas
        </div>
        <ToolsSidebar onNavigate={onNavigate} />
      </div>

      {/* Modais */}
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} onAuthenticated={() => { setShowAuth(false); loadFeed() }} />
      )}
      {showCreate && user && (
        <CreatePostModal
          user={user}
          myCommunities={myCommunities}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadFeed() }}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   CreatePostModal — formulário pra criar post
// ════════════════════════════════════════════════════════════════════════════
function CreatePostModal({ user, myCommunities, onClose, onCreated }) {
  const [communities, setCommunities] = useState(myCommunities)
  const [communityId, setCommunityId] = useState('')
  const [type, setType]               = useState('question')
  const [title, setTitle]             = useState('')
  const [body, setBody]               = useState('')
  const [eventDate, setEventDate]     = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [classifiedPrice, setPrice]   = useState('')
  const [classifiedKind, setKind]     = useState('sell')
  const [classifiedContact, setClassifiedContact] = useState('')
  const [jobCategory, setJobCategory] = useState('')
  const [jobPay, setJobPay]           = useState('')
  const [jobLocation, setJobLocation] = useState('')
  const [jobContact, setJobContact]   = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState(null)

  // Se user não segue nenhuma, busca as públicas pra ele escolher
  useEffect(() => {
    if (myCommunities.length > 0) {
      setCommunities(myCommunities)
      setCommunityId(myCommunities[0].id)
    } else {
      fetch('/api/social?action=communities').then(r => r.json()).then(d => {
        const list = (d.communities || []).slice(0, 60)
        setCommunities(list)
        if (list.length > 0) setCommunityId(list[0].id)
      })
    }
  }, [myCommunities])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!communityId || !title) { setError('Comunidade e título obrigatórios'); return }
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        user_id: user.id, community_id: communityId, type, title, body,
      }
      if (type === 'event') {
        if (!eventDate) throw new Error('Data do evento obrigatória')
        payload.event_date = new Date(eventDate).toISOString()
        payload.event_location = eventLocation
      }
      if (type === 'classified') {
        payload.classified_price = classifiedPrice ? Number(classifiedPrice) : null
        payload.classified_kind = classifiedKind
        payload.classified_contact = classifiedContact
      }
      if (type === 'job') {
        payload.job_category = jobCategory
        payload.job_pay      = jobPay
        payload.job_location = jobLocation
        payload.job_contact  = jobContact
      }
      const res = await fetch('/api/social?action=create-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onCreated()
    } catch (err) {
      setError(err.message || 'Erro ao publicar')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid #e5e7eb', fontSize: 14, outline: 'none',
    background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit',
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: 24, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: NAVY }}>📝 Criar post</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 20, color: '#9ca3af',
            cursor: 'pointer', padding: 0,
          }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Tipo */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Tipo
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(POST_TYPES).map(([k, v]) => (
                <button key={k} type="button" onClick={() => setType(k)} style={{
                  padding: '6px 12px', borderRadius: 20,
                  background: type === k ? v.color : '#F3F4F6',
                  color: type === k ? '#fff' : '#6b7280',
                  border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Comunidade */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Comunidade
            </label>
            <select value={communityId} onChange={e => setCommunityId(e.target.value)} required style={inputStyle}>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>

          {/* Título */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Título
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200}
              placeholder="Ex: Onde acho mandioca em Boston?"
              style={inputStyle} />
          </div>

          {/* Corpo */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Detalhes (opcional)
            </label>
            <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={5000} rows={4}
              placeholder="Adicione mais contexto..."
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* Campos por tipo */}
          {type === 'event' && (
            <>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  Data e hora *
                </label>
                <input type="datetime-local" value={eventDate} onChange={e => setEventDate(e.target.value)} required style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  Local
                </label>
                <input type="text" value={eventLocation} onChange={e => setEventLocation(e.target.value)}
                  placeholder="Ex: Igreja Batista Brasileira, Boston" style={inputStyle} />
              </div>
            </>
          )}

          {type === 'classified' && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Tipo
                  </label>
                  <select value={classifiedKind} onChange={e => setKind(e.target.value)} style={inputStyle}>
                    <option value="sell">Vendendo</option>
                    <option value="buy">Procurando</option>
                    <option value="donate">Doação</option>
                    <option value="rent">Alugando</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Preço (USD)
                  </label>
                  <input type="number" min="0" step="0.01" value={classifiedPrice} onChange={e => setPrice(e.target.value)}
                    placeholder="ex: 200" style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  Contato (WhatsApp/email)
                </label>
                <input type="text" value={classifiedContact} onChange={e => setClassifiedContact(e.target.value)}
                  placeholder="(555) 555-5555 ou email" style={inputStyle} />
              </div>
            </>
          )}

          {type === 'job' && (
            <>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  Categoria
                </label>
                <select value={jobCategory} onChange={e => setJobCategory(e.target.value)} style={inputStyle}>
                  <option value="">Selecione...</option>
                  <option value="cleaning">Limpeza</option>
                  <option value="construction">Construção</option>
                  <option value="restaurant">Restaurante</option>
                  <option value="nanny">Babá / cuidado</option>
                  <option value="driver">Motorista</option>
                  <option value="cdl">CDL / Caminhoneiro</option>
                  <option value="tech">Tecnologia</option>
                  <option value="other">Outra</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Pagamento
                  </label>
                  <input type="text" value={jobPay} onChange={e => setJobPay(e.target.value)}
                    placeholder="$20/h ou $200/dia" style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Local
                  </label>
                  <input type="text" value={jobLocation} onChange={e => setJobLocation(e.target.value)}
                    placeholder="Boston, MA" style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  Contato
                </label>
                <input type="text" value={jobContact} onChange={e => setJobContact(e.target.value)}
                  placeholder="(555) 555-5555 ou email" style={inputStyle} />
              </div>
            </>
          )}

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: '#FEE2E2', color: '#991B1B', fontSize: 12 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting || !title || !communityId} style={{
            padding: '12px 0', borderRadius: 10,
            background: submitting ? '#9ca3af' : GREEN, color: '#fff',
            fontSize: 14, fontWeight: 700, border: 'none', cursor: submitting ? 'default' : 'pointer',
            fontFamily: 'inherit',
          }}>
            {submitting ? 'Publicando…' : 'Publicar →'}
          </button>
        </form>
      </div>
    </div>
  )
}
