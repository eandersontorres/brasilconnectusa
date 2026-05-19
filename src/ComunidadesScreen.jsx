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
  const [showCreate, setShowCreate] = useState(false)

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
      <div style={{
        marginBottom: 20, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 260 }}>
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
        <button onClick={() => {
          if (!user) { window.dispatchEvent(new CustomEvent('bc-open-auth')); return }
          setShowCreate(true)
        }} style={{
          background: C.green, color: C.white, border: 'none',
          padding: '10px 18px', borderRadius: 20, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: FONT.sans, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Criar comunidade
        </button>
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
                    onOpen={() => onNavigate && onNavigate('community', c.slug)}
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
                    onOpen={() => onNavigate && onNavigate('community', c.slug)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showCreate && user && (
        <CreateCommunityModal
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={async (community) => {
            setShowCreate(false)
            await Promise.all([loadAll(), loadMine()])
            // Navegar pro Feed pra ver a nova comunidade — opcional
            onNavigate && onNavigate('feed')
          }}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   CreateCommunityModal
// ────────────────────────────────────────────────────────────────────────────
function CreateCommunityModal({ user, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('interest')
  const [geoState, setGeoState] = useState('')
  const [geoCity, setGeoCity] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [uploadingCover, setUploadingCover] = useState(false)
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleCoverFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setUploadingCover(true)
    try {
      // Comprime via canvas se grande (max 800px largura, JPEG 80%)
      const dataUrl = await compressImage(file, 1200, 0.82)
      const r = await fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: dataUrl, folder: 'communities', email: user.email }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setCoverImage(d.url)
    } catch (err) {
      setError('Upload falhou: ' + (err.message || ''))
    } finally { setUploadingCover(false); e.target.value = '' }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (name.trim().length < 3) { setError('Nome muito curto (mín 3)'); return }
    if ((type === 'city' || type === 'state') && !geoState.trim()) {
      setError('Tipo cidade/estado precisa de Estado (2 letras)'); return
    }
    if (type === 'city' && !geoCity.trim()) {
      setError('Tipo cidade precisa de Cidade'); return
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/social?action=create-community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          name: name.trim(),
          type,
          geo_state: geoState.trim() || null,
          geo_city: geoCity.trim() || null,
          description: description.trim() || null,
          icon: icon.trim() || null,
          cover_image: coverImage || null,
          requires_approval: requiresApproval,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro ao criar')
      onCreated(d.community)
    } catch (err) {
      setError(err.message || 'Erro ao criar comunidade')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid ' + C.line, fontSize: 14, outline: 'none',
    background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans, color: C.ink,
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <form onClick={e => e.stopPropagation()} onSubmit={handleSubmit} style={{
        background: C.white, borderRadius: 16, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflow: 'auto', fontFamily: FONT.sans,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid ' + C.line,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: 1 }}>
              Nova comunidade
            </div>
            <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 600, color: C.ink, marginTop: 2 }}>
              Criar comunidade
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{
            background: 'transparent', border: 'none', fontSize: 24, color: C.inkMuted,
            cursor: 'pointer', padding: 4, lineHeight: 1,
          }}>×</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
              Nome da comunidade *
            </label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex: Brasileiros em Boston" maxLength={60} required style={inputStyle} />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
              Tipo *
            </label>
            <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
              <option value="interest">Interesse (ex: vinho, tech, mães)</option>
              <option value="city">Cidade (ex: Boston, MA)</option>
              <option value="state">Estado (ex: Massachusetts)</option>
              <option value="general">Geral</option>
            </select>
          </div>

          {(type === 'city' || type === 'state') && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: type === 'city' ? 2 : 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
                  Estado (2 letras) *
                </label>
                <input value={geoState} onChange={e => setGeoState(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="MA" maxLength={2} style={{ ...inputStyle, textTransform: 'uppercase' }} required />
              </div>
              {type === 'city' && (
                <div style={{ flex: 3 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
                    Cidade *
                  </label>
                  <input value={geoCity} onChange={e => setGeoCity(e.target.value)}
                    placeholder="Boston" maxLength={60} style={inputStyle} required />
                </div>
              )}
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
              Ícone (emoji, opcional)
            </label>
            <input value={icon} onChange={e => setIcon(e.target.value.slice(0, 4))}
              placeholder="🍷 ou 🍼 ou 💻" maxLength={4}
              style={{ ...inputStyle, fontSize: 20, width: 100, textAlign: 'center' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
              Capa (opcional)
            </label>
            {coverImage ? (
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <img src={coverImage} alt="" style={{
                  width: '100%', height: 100, objectFit: 'cover', borderRadius: 8,
                  border: '1px solid ' + C.line,
                }} />
                <button type="button" onClick={() => setCoverImage('')} style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none',
                  width: 24, height: 24, borderRadius: '50%', cursor: 'pointer',
                  fontSize: 14, lineHeight: 1,
                }}>×</button>
              </div>
            ) : null}
            <input value={coverImage} onChange={e => setCoverImage(e.target.value)}
              placeholder="https://... ou faça upload abaixo" style={inputStyle} />
            <input type="file" accept="image/*" onChange={handleCoverFile}
              disabled={uploadingCover}
              style={{ marginTop: 6, fontSize: 12 }} />
            {uploadingCover && <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 4 }}>Enviando…</div>}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
              Descrição (opcional, máx 500 chars)
            </label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="O que essa comunidade vai discutir? Quem deve entrar?"
              maxLength={500} rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }} />
            <div style={{ textAlign: 'right', fontSize: 11, color: C.inkMuted, marginTop: 2 }}>
              {description.length} / 500
            </div>
          </div>

          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: 12, background: '#F0FDF4', border: '1px solid #BBF7D0',
            borderRadius: 8, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={requiresApproval}
              onChange={e => setRequiresApproval(e.target.checked)}
              style={{ marginTop: 2, accentColor: C.green }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                Aprovar novos membros manualmente
              </div>
              <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 3, lineHeight: 1.5 }}>
                Quando alguém pedir pra entrar, você (admin) recebe e aprova/rejeita.
                Desmarque pra comunidade <b>aberta</b> — qualquer um entra direto.
              </div>
            </div>
          </label>

          {error && (
            <div style={{
              background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
              padding: '10px 12px', borderRadius: 8, fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ fontSize: 11, color: C.inkMuted, lineHeight: 1.5 }}>
            Você vira admin da comunidade automaticamente. O slug é gerado a partir do nome.
          </div>
        </div>

        <div style={{
          padding: '14px 20px', borderTop: '1px solid ' + C.line,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: '1px solid ' + C.line, color: C.ink,
            padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: FONT.sans,
          }}>Cancelar</button>
          <button type="submit" disabled={submitting} style={{
            background: C.green, color: C.white, border: 'none',
            padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700,
            cursor: submitting ? 'wait' : 'pointer', fontFamily: FONT.sans,
            opacity: submitting ? 0.6 : 1,
          }}>{submitting ? 'Criando…' : 'Criar comunidade'}</button>
        </div>
      </form>
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
function CommunityCard({ community: c, isJoining, onJoin, onOpen }) {
  const [bgColor, fgColor] = TYPE_BG[c.type] || TYPE_BG.default
  const initial = (c.icon || c.name || '?').trim().charAt(0).toUpperCase()
  const typeLabel = TYPE_LABEL[c.type] || c.type || 'Geral'
  const geo = c.geo_city ? `${c.geo_city}${c.geo_state ? ' / ' + c.geo_state : ''}` : c.geo_state || null

  return (
    <article onClick={onOpen} style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 14,
      display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      cursor: onOpen ? 'pointer' : 'default',
      overflow: 'hidden',
    }}
      onMouseEnter={e => { if (onOpen) { e.currentTarget.style.borderColor = C.gold } }}
      onMouseLeave={e => { if (onOpen) { e.currentTarget.style.borderColor = C.line } }}
    >
      {/* Banner de capa */}
      <div style={{
        height: 90,
        background: c.cover_image
          ? `url("${c.cover_image}") center/cover no-repeat`
          : `linear-gradient(135deg, ${bgColor} 0%, ${fgColor}33 100%)`,
        position: 'relative',
      }}>
        {c.is_official && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(255,255,255,0.95)', color: C.green,
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>✓ Oficial</div>
        )}
      </div>

      {/* Conteúdo */}
      <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {/* Avatar sobrepondo o banner */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: -28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', background: bgColor,
            color: fgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: c.icon ? 26 : 22, fontWeight: 700, flexShrink: 0,
            fontFamily: FONT.serif, border: '3px solid ' + C.white,
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}>{c.icon || initial}</div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: fgColor,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2,
          }}>
            {typeLabel}{geo ? ' · ' + geo : ''}
          </div>
          <h3 style={{
            fontFamily: FONT.serif, fontSize: 17, fontWeight: 600, color: C.ink,
            margin: 0, lineHeight: 1.25,
          }}>{c.name}</h3>
        </div>

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
          <button onClick={e => { e.stopPropagation(); onJoin() }} disabled={isJoining} style={{
            background: C.green, color: C.white, border: 'none',
            padding: '8px 18px', borderRadius: 18, fontSize: 13, fontWeight: 700,
            cursor: isJoining ? 'wait' : 'pointer', fontFamily: FONT.sans,
            opacity: isJoining ? 0.6 : 1,
          }}>{isJoining ? '…' : 'Entrar'}</button>
        </div>
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

// ────────────────────────────────────────────────────────────────────────────
//   compressImage — exportado pra reuso (CommunityDetailScreen edit modal)
// ────────────────────────────────────────────────────────────────────────────
export function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
    reader.onload = e => {
      const img = new Image()
      img.onerror = () => reject(new Error('Imagem inválida'))
      img.onload = () => {
        const ratio = img.width > maxWidth ? maxWidth / img.width : 1
        const w = Math.round(img.width * ratio)
        const h = Math.round(img.height * ratio)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}
