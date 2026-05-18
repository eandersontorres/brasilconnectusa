import { useState, useEffect, useCallback, useMemo } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'

// ════════════════════════════════════════════════════════════════════════════
//   ComunidadesScreen — descoberta de comunidades estilo Nextdoor
//
//   Seções:
//     - Search + filtros (todos / cidade / estado / interesse)
//     - "Suas comunidades" (compacta no topo, só se logado e tem)
//     - "Comunidades pra você" (grid de cards visual)
//
//   Card: emoji + nome + descrição + member count + botão Join/Joined.
// ════════════════════════════════════════════════════════════════════════════

const TYPE_LABEL = {
  general: 'Geral',
  city:    'Cidade',
  state:   'Estado',
  interest:'Interesse',
}

const TYPE_FILTERS = [
  { key: '',         label: 'Todas' },
  { key: 'general',  label: 'Geral' },
  { key: 'city',     label: 'Cidade' },
  { key: 'state',    label: 'Estado' },
  { key: 'interest', label: 'Interesse' },
]

// Paleta de fundo por tipo (avatar do card)
const TYPE_BG = {
  general:  ['#DBEAFE', '#1E40AF'],
  city:     ['#FEF3C7', '#92400E'],
  state:    ['#D1FAE5', '#065F46'],
  interest: ['#EDE9FE', '#5B21B6'],
  default:  ['#F3F4F6', '#374151'],
}

export default function ComunidadesScreen({ onNavigate }) {
  const { user } = useAuth()
  const [all, setAll] = useState([])
  const [mine, setMine] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [joining, setJoining] = useState(null) // community_id em ação

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/social?action=communities')
      const d = await r.json()
      setAll(d.communities || [])
    } catch (_) { setAll([]) }
    finally { setLoading(false) }
  }, [])

  const loadMine = useCallback(async () => {
    if (!user) { setMine([]); return }
    try {
      const r = await fetch('/api/social?action=my-communities&user_id=' + user.id)
      const d = await r.json()
      setMine(d.communities || [])
    } catch (_) { setMine([]) }
  }, [user])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadMine() }, [loadMine])

  const mineIds = useMemo(() => new Set(mine.map(c => c.id)), [mine])

  const filtered = useMemo(() => {
    let list = all
    if (typeFilter) list = list.filter(c => c.type === typeFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.geo_city || '').toLowerCase().includes(q) ||
        (c.geo_state || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [all, typeFilter, search])

  // "Pra você" — exclui as que já é membro
  const forYou = useMemo(
    () => filtered.filter(c => !mineIds.has(c.id)),
    [filtered, mineIds]
  )

  async function handleJoin(community) {
    if (!user) {
      window.dispatchEvent(new CustomEvent('bc-open-auth'))
      return
    }
    setJoining(community.id)
    try {
      const r = await fetch('/api/social?action=join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, community_id: community.id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      if (d.pending_approval) {
        alert('Pedido enviado! Os admins vão revisar e te avisar quando aprovar.')
      } else {
        // refresh local
        await loadMine()
      }
    } catch (e) {
      alert('Erro ao entrar: ' + (e.message || ''))
    } finally {
      setJoining(null)
    }
  }

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 24px' }}>
      {/* Hero */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: C.green,
          textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6,
        }}>Comunidades</div>
        <h1 style={{
          fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink,
          margin: '0 0 6px 0', letterSpacing: '-0.01em',
        }}>
          Encontre sua tribo brasileira nos EUA
        </h1>
        <p style={{ fontSize: 14, color: C.inkMuted, lineHeight: 1.6, margin: 0, maxWidth: 580 }}>
          Comunidades por interesse, cidade ou estado. Entre nas que você curte pra acompanhar posts, perguntas e eventos no Feed.
        </p>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, cidade, estado…"
          style={{
            width: '100%', padding: '12px 14px 12px 40px', borderRadius: 24,
            border: '1.5px solid ' + C.line, background: C.white,
            fontSize: 14, fontFamily: FONT.sans, outline: 'none',
            color: C.ink, boxSizing: 'border-box',
          }}
        />
        <span style={{
          position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          fontSize: 16, color: C.inkMuted, pointerEvents: 'none',
        }}>⌕</span>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, overflowX: 'auto' }}>
        {TYPE_FILTERS.map(f => {
          const active = typeFilter === f.key
          return (
            <button key={f.key || 'all'} onClick={() => setTypeFilter(f.key)} style={{
              padding: '7px 14px', borderRadius: 18,
              background: active ? C.green : C.white,
              border: '1px solid ' + (active ? C.green : C.line),
              color: active ? C.white : C.ink,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.sans,
              whiteSpace: 'nowrap',
            }}>{f.label}</button>
          )
        })}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: C.inkMuted }}>Carregando…</div>
      )}

      {!loading && (
        <>
          {/* Suas comunidades (compacta) */}
          {user && mine.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <SectionTitle label="Suas comunidades" count={mine.length} />
              <div style={{
                background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
                overflow: 'hidden',
              }}>
                {mine.map((c, i) => (
                  <MyRow key={c.id}
                    community={c}
                    isLast={i === mine.length - 1}
                    onOpen={() => onNavigate && onNavigate('feed')}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Grid principal */}
          <div>
            <SectionTitle
              label={user && mine.length > 0 ? 'Comunidades pra você' : 'Todas as comunidades'}
              count={forYou.length}
            />
            {forYou.length === 0 ? (
              <div style={{
                background: C.white, border: '1px dashed ' + C.line, borderRadius: 12,
                padding: 40, textAlign: 'center', color: C.inkMuted, fontSize: 13,
              }}>
                {search.trim() ? 'Nenhuma comunidade encontrada com esse filtro.' : 'Você já está em todas as comunidades disponíveis. 🎉'}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 14,
              }}>
                {forYou.map(c => (
                  <CommunityCard
                    key={c.id}
                    community={c}
                    isJoining={joining === c.id}
                    onJoin={() => handleJoin(c)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   SectionTitle
// ────────────────────────────────────────────────────────────────────────────
function SectionTitle({ label, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 12,
    }}>
      <h2 style={{
        fontFamily: FONT.serif, fontSize: 20, fontWeight: 600, color: C.ink,
        margin: 0, letterSpacing: '-0.01em',
      }}>{label}</h2>
      <div style={{ fontSize: 12, color: C.inkMuted, fontWeight: 500 }}>{count}</div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   CommunityCard — card grande estilo Nextdoor
// ────────────────────────────────────────────────────────────────────────────
function CommunityCard({ community: c, isJoining, onJoin }) {
  const [bgColor, fgColor] = TYPE_BG[c.type] || TYPE_BG.default
  const initial = (c.icon || c.name || '?').trim().charAt(0).toUpperCase()
  const typeLabel = TYPE_LABEL[c.type] || c.type || 'Geral'
  const geo = c.geo_city ? `${c.geo_city}${c.geo_state ? ' / ' + c.geo_state : ''}` : c.geo_state || null

  return (
    <article style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 14,
      padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    }}>
      {/* Avatar circular */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: bgColor,
          color: fgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: c.icon ? 26 : 22, fontWeight: 700, flexShrink: 0,
          fontFamily: FONT.serif,
        }}>{c.icon || initial}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: fgColor,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2,
          }}>
            {typeLabel}{geo ? ' · ' + geo : ''}
            {c.is_official && ' · ✓ Oficial'}
          </div>
          <h3 style={{
            fontFamily: FONT.serif, fontSize: 17, fontWeight: 600, color: C.ink,
            margin: 0, lineHeight: 1.25,
          }}>{c.name}</h3>
        </div>
      </div>

      {/* Descrição */}
      <p style={{
        fontSize: 13, color: C.inkMuted, lineHeight: 1.55, margin: 0,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {c.description || 'Comunidade brasileira no BrasilConnect.'}
      </p>

      {/* Stats + Join */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed ' + C.line,
      }}>
        <div style={{ fontSize: 12, color: C.inkMuted, fontWeight: 500 }}>
          <b style={{ color: C.ink, fontWeight: 700 }}>{c.member_count || 0}</b> membros
          {c.post_count > 0 && <> · {c.post_count} posts</>}
        </div>
        <button onClick={onJoin} disabled={isJoining} style={{
          background: C.green, color: C.white, border: 'none',
          padding: '8px 18px', borderRadius: 18, fontSize: 13, fontWeight: 700,
          cursor: isJoining ? 'wait' : 'pointer', fontFamily: FONT.sans,
          opacity: isJoining ? 0.6 : 1,
        }}>{isJoining ? '…' : 'Entrar'}</button>
      </div>
    </article>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   MyRow — linha compacta de "Suas comunidades"
// ────────────────────────────────────────────────────────────────────────────
function MyRow({ community: c, isLast, onOpen }) {
  const [bgColor, fgColor] = TYPE_BG[c.type] || TYPE_BG.default
  const initial = (c.icon || c.name || '?').trim().charAt(0).toUpperCase()
  return (
    <button onClick={onOpen} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
      padding: '12px 14px', background: 'transparent',
      border: 'none', borderBottom: isLast ? 'none' : '1px solid ' + C.line,
      cursor: 'pointer', textAlign: 'left', fontFamily: FONT.sans,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', background: bgColor,
        color: fgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: c.icon ? 17 : 14, fontWeight: 700, flexShrink: 0,
      }}>{c.icon || initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{c.name}</div>
        <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 1 }}>
          {c.member_count || 0} membros · {c.role || 'membro'}
        </div>
      </div>
      <span style={{ fontSize: 16, color: C.inkMuted }}>→</span>
    </button>
  )
}
