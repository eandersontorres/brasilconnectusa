import { useState, useEffect, useCallback, useMemo } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { PostCard, CreatePostModal } from './FeedScreen'

// ════════════════════════════════════════════════════════════════════════════
//   CommunityDetailScreen — página de 1 comunidade (header + posts)
//
//   Props:
//     - slug: string (vem da URL /app/community/<slug>)
//     - onNavigate(tab, slug?): pra voltar / abrir post / etc
// ════════════════════════════════════════════════════════════════════════════

const TYPE_LABEL = {
  general: 'Geral', city: 'Cidade', state: 'Estado', interest: 'Interesse',
}
const TYPE_BG = {
  general:  ['#DBEAFE', '#1E40AF'],
  city:     ['#FEF3C7', '#92400E'],
  state:    ['#D1FAE5', '#065F46'],
  interest: ['#EDE9FE', '#5B21B6'],
  default:  ['#F3F4F6', '#374151'],
}

export default function CommunityDetailScreen({ slug, onNavigate }) {
  const { user } = useAuth()
  const [community, setCommunity] = useState(null)
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [myMembership, setMyMembership] = useState(null) // null = não membro, obj = membro
  const [actionBusy, setActionBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    if (!slug) { setError('slug obrigatório'); setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/social?action=community&slug=' + encodeURIComponent(slug))
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      setCommunity(d.community)
      setPosts(d.posts || [])
    } catch (e) {
      setError(e.message || 'Erro')
    } finally {
      setLoading(false)
    }
  }, [slug])

  const loadMembership = useCallback(async () => {
    if (!user || !community) { setMyMembership(null); return }
    try {
      const r = await fetch('/api/social?action=my-communities&user_id=' + user.id)
      const d = await r.json()
      const found = (d.communities || []).find(c => c.id === community.id)
      setMyMembership(found || null)
    } catch (_) { setMyMembership(null) }
  }, [user, community])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadMembership() }, [loadMembership])

  // Refresh ao postar de outra tela
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('bc-post-created', handler)
    return () => window.removeEventListener('bc-post-created', handler)
  }, [load])

  async function handleJoin() {
    if (!user) { window.dispatchEvent(new CustomEvent('bc-open-auth')); return }
    setActionBusy(true)
    try {
      const r = await fetch('/api/social?action=join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, community_id: community.id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      if (d.pending_approval) alert('Pedido enviado! Os admins vão revisar.')
      else await loadMembership()
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally { setActionBusy(false) }
  }

  async function handleLeave() {
    if (!confirm(`Sair da comunidade "${community.name}"?`)) return
    setActionBusy(true)
    try {
      const r = await fetch('/api/social?action=leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, community_id: community.id }),
      })
      if (!r.ok) throw new Error('Erro')
      setMyMembership(null)
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally { setActionBusy(false) }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40, color: C.inkMuted }}>Carregando comunidade…</div>
  }
  if (error || !community) {
    return (
      <div style={{
        background: C.white, border: '1px dashed ' + C.line, borderRadius: 12,
        padding: 32, textAlign: 'center', color: C.inkMuted,
      }}>
        <div style={{ fontSize: 14, color: C.ink, fontWeight: 600, marginBottom: 6 }}>
          Comunidade não encontrada
        </div>
        <div style={{ fontSize: 12, marginBottom: 16 }}>{error || 'A URL pode estar quebrada.'}</div>
        <button onClick={() => onNavigate && onNavigate('comunidades')} style={{
          background: C.green, color: C.white, border: 'none',
          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT.sans,
        }}>← Voltar pra Comunidades</button>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 24px' }}>
      <Header
        community={community}
        myMembership={myMembership}
        actionBusy={actionBusy}
        onBack={() => onNavigate && onNavigate('comunidades')}
        onJoin={handleJoin}
        onLeave={handleLeave}
        onPost={() => {
          if (!user) { window.dispatchEvent(new CustomEvent('bc-open-auth')); return }
          setShowCreate(true)
        }}
      />

      {/* Lista de posts */}
      <div style={{ marginTop: 18 }}>
        {posts.length === 0 ? (
          <div style={{
            background: C.white, border: '1px dashed ' + C.line, borderRadius: 12,
            padding: 40, textAlign: 'center', color: C.inkMuted, fontSize: 13,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
              Sem posts ainda
            </div>
            <div>Seja a primeira pessoa a postar aqui!</div>
          </div>
        ) : (
          posts.map(p => (
            <PostCard key={p.id} post={p} currentUser={user}
              onClick={() => alert('Detalhe do post — em breve')}
              onVote={() => {}} onClassifiedSold={() => load()}
            />
          ))
        )}
      </div>

      {showCreate && user && (
        <CreatePostModal
          user={user}
          defaultType="question"
          defaultCommunityId={community.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            load()
            window.dispatchEvent(new CustomEvent('bc-post-created'))
          }}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Header
// ────────────────────────────────────────────────────────────────────────────
function Header({ community: c, myMembership, actionBusy, onBack, onJoin, onLeave, onPost }) {
  const [bgColor, fgColor] = TYPE_BG[c.type] || TYPE_BG.default
  const initial = (c.icon || c.name || '?').trim().charAt(0).toUpperCase()
  const typeLabel = TYPE_LABEL[c.type] || c.type || 'Geral'
  const geo = c.geo_city ? `${c.geo_city}${c.geo_state ? ' / ' + c.geo_state : ''}` : c.geo_state || null
  const isMember = !!myMembership

  return (
    <div style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 14,
      overflow: 'hidden', marginBottom: 4,
    }}>
      {/* Faixa colorida no topo */}
      <div style={{
        height: 64,
        background: c.cover_image
          ? `url(${c.cover_image}) center/cover`
          : `linear-gradient(135deg, ${bgColor} 0%, ${fgColor}22 100%)`,
        position: 'relative',
      }}>
        <button onClick={onBack} aria-label="Voltar" style={{
          position: 'absolute', top: 12, left: 12,
          background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: 18,
          padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          fontFamily: FONT.sans, color: C.ink,
        }}>← Voltar</button>
      </div>

      <div style={{
        padding: '0 20px 20px', position: 'relative',
      }}>
        {/* Avatar grande sobrepondo a faixa */}
        <div style={{
          width: 88, height: 88, borderRadius: '50%', background: bgColor,
          color: fgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: c.icon ? 42 : 32, fontWeight: 700, marginTop: -44,
          border: '4px solid ' + C.white, fontFamily: FONT.serif,
        }}>{c.icon || initial}</div>

        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 14, flexWrap: 'wrap', marginTop: 12,
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: fgColor,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
            }}>
              {typeLabel}{geo ? ' · ' + geo : ''}
              {c.is_official && ' · ✓ Oficial'}
            </div>
            <h1 style={{
              fontFamily: FONT.serif, fontSize: 26, fontWeight: 600, color: C.ink,
              margin: 0, lineHeight: 1.2, letterSpacing: '-0.01em',
            }}>{c.name}</h1>
            <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 6 }}>
              <b style={{ color: C.ink }}>{c.member_count || 0}</b> membros
              {c.post_count > 0 && <> · <b style={{ color: C.ink }}>{c.post_count}</b> posts</>}
              {isMember && <> · você é {myMembership.role === 'admin' ? '👑 admin' : 'membro'}</>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {isMember ? (
              <>
                <button onClick={onPost} style={{
                  background: C.green, color: C.white, border: 'none',
                  padding: '8px 16px', borderRadius: 18, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: FONT.sans,
                }}>✏️ Postar</button>
                <button onClick={onLeave} disabled={actionBusy} style={{
                  background: 'transparent', color: C.inkMuted,
                  border: '1px solid ' + C.line,
                  padding: '8px 14px', borderRadius: 18, fontSize: 12, fontWeight: 600,
                  cursor: actionBusy ? 'wait' : 'pointer', fontFamily: FONT.sans,
                  opacity: actionBusy ? 0.6 : 1,
                }}>Sair</button>
              </>
            ) : (
              <button onClick={onJoin} disabled={actionBusy} style={{
                background: C.green, color: C.white, border: 'none',
                padding: '10px 22px', borderRadius: 20, fontSize: 14, fontWeight: 700,
                cursor: actionBusy ? 'wait' : 'pointer', fontFamily: FONT.sans,
                opacity: actionBusy ? 0.6 : 1,
              }}>{actionBusy ? '…' : 'Entrar'}</button>
            )}
          </div>
        </div>

        {c.description && (
          <p style={{
            fontSize: 14, color: C.inkSoft, lineHeight: 1.6, margin: '14px 0 0 0',
          }}>{c.description}</p>
        )}

        {c.rules && (
          <details style={{ marginTop: 12 }}>
            <summary style={{
              cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.green,
              userSelect: 'none',
            }}>Regras da comunidade</summary>
            <div style={{
              fontSize: 13, color: C.inkSoft, lineHeight: 1.6, margin: '8px 0 0 0',
              whiteSpace: 'pre-wrap',
            }}>{c.rules}</div>
          </details>
        )}
      </div>
    </div>
  )
}
