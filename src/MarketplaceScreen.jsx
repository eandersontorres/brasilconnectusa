import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthModal'
import { C, FONT } from './lib/colors'

// ────────────────────────────────────────────────────────────────────────────
//   MarketplaceScreen — aba dedicada ao classified em grid visual
// ────────────────────────────────────────────────────────────────────────────

const KIND_LABELS = { sell: 'Vendendo', buy: 'Procurando', donate: 'Doação', rent: 'Alugando' }

const KIND_FILTERS = [
  { id: 'all',    label: 'Todos' },
  { id: 'sell',   label: 'Vendendo' },
  { id: 'buy',    label: 'Procurando' },
  { id: 'donate', label: 'Doação' },
  { id: 'rent',   label: 'Aluguel' },
]

function whatsappLink(contact, postTitle) {
  if (!contact) return null
  const digits = String(contact).replace(/\D/g, '')
  if (digits.length >= 10) {
    const text = encodeURIComponent(`Oi! Vi seu anúncio "${postTitle || 'no BrasilConnect'}" e tenho interesse.`)
    return `https://wa.me/${digits}?text=${text}`
  }
  if (String(contact).includes('@')) return 'mailto:' + contact
  return null
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// ────────────────────────────────────────────────────────────────────────────
//   ItemCard
// ────────────────────────────────────────────────────────────────────────────
function ItemCard({ post, onClick }) {
  const isSold = post.classified_status === 'sold'
  const cover = (post.image_urls && post.image_urls[0]) || null

  return (
    <div onClick={() => onClick(post)} style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 14,
      overflow: 'hidden', cursor: 'pointer',
      transition: 'border-color .15s, transform .15s',
      opacity: isSold ? 0.65 : 1,
    }}
      onMouseEnter={e => { if (!isSold) e.currentTarget.style.borderColor = C.gold }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.line }}
    >
      {/* Capa */}
      <div style={{
        aspectRatio: '4/3', background: cover ? `url(${cover}) center/cover` : 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {!cover && <span style={{ fontSize: 42, opacity: 0.4 }}>📦</span>}
        {isSold && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: '#1F2937', color: '#fff', fontSize: 10, fontWeight: 800,
            padding: '3px 10px', borderRadius: 4, letterSpacing: 0.8,
          }}>VENDIDO</div>
        )}
        {!isSold && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: 'rgba(30,64,175,0.92)', color: '#fff', fontSize: 10, fontWeight: 700,
            padding: '3px 10px', borderRadius: 4, letterSpacing: 0.4, textTransform: 'uppercase',
          }}>{KIND_LABELS[post.classified_kind] || 'Anúncio'}</div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px' }}>
        {post.classified_price != null && (
          <div style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 22, fontWeight: 700,
            color: isSold ? '#9CA3AF' : '#1F2937',
            textDecoration: isSold ? 'line-through' : 'none',
            lineHeight: 1, marginBottom: 4,
          }}>
            ${Number(post.classified_price).toLocaleString('en-US')}
          </div>
        )}
        <div style={{
          fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.35,
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
          overflow: 'hidden', minHeight: 34,
        }}>
          {post.title}
        </div>
        <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 6 }}>
          {timeAgo(post.created_at)}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   ItemModal — detalhe do anúncio
// ────────────────────────────────────────────────────────────────────────────
function ItemModal({ post, onClose }) {
  const isSold = post.classified_status === 'sold'
  const cover = (post.image_urls && post.image_urls[0]) || null
  const wa = whatsappLink(post.classified_contact, post.title)

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: '20px 20px 0 0', maxWidth: 560, width: '100%',
        maxHeight: '92vh', overflowY: 'auto', fontFamily: FONT.sans,
      }}>
        {/* Cover */}
        <div style={{
          aspectRatio: '4/3', background: cover ? `url(${cover}) center/cover` : 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {!cover && <span style={{ fontSize: 64, opacity: 0.35 }}>📦</span>}
          <button onClick={onClose} style={{
            position: 'absolute', top: 12, right: 12,
            background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none',
            width: 32, height: 32, borderRadius: '50%', fontSize: 18, cursor: 'pointer',
          }}>×</button>
          {isSold && (
            <div style={{
              position: 'absolute', top: 16, left: 16,
              background: '#1F2937', color: '#fff', fontSize: 11, fontWeight: 800,
              padding: '4px 12px', borderRadius: 4, letterSpacing: 0.8,
            }}>VENDIDO</div>
          )}
        </div>

        <div style={{ padding: '20px 22px 28px' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#6D28D9', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
          }}>
            {KIND_LABELS[post.classified_kind] || 'Anúncio'}
          </div>

          {post.classified_price != null && (
            <div style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: 32, fontWeight: 700,
              color: isSold ? '#9CA3AF' : '#1F2937',
              textDecoration: isSold ? 'line-through' : 'none',
              lineHeight: 1, marginBottom: 8,
            }}>
              ${Number(post.classified_price).toLocaleString('en-US')}
            </div>
          )}

          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 12, lineHeight: 1.3 }}>
            {post.title}
          </div>

          {post.body && (
            <div style={{ fontSize: 14, color: C.inkSoft, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 18 }}>
              {post.body}
            </div>
          )}

          {!isSold && wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: '#25D366', color: '#fff', textDecoration: 'none',
                borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 800, marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 20 }}>💬</span>
              Falar com vendedor
            </a>
          )}
          {!isSold && !wa && (
            <div style={{
              background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10,
              padding: '12px 14px', fontSize: 13, color: '#78350F', textAlign: 'center',
            }}>
              Sem contato cadastrado. Veja se a pessoa deixou recado nos comentários do post.
            </div>
          )}

          <div style={{ fontSize: 11, color: C.inkMuted, textAlign: 'center', marginTop: 12 }}>
            Anúncio postado {timeAgo(post.created_at)} · BrasilConnect não intermedia transações
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   MarketplaceScreen
// ────────────────────────────────────────────────────────────────────────────
export default function MarketplaceScreen() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState('all')
  const [hideSold, setHideSold] = useState(true)
  const [selected, setSelected] = useState(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const base = user
        ? `/api/social?action=feed&user_id=${user.id}&type=classified`
        : '/api/social?action=feed-public&type=classified'
      const res = await fetch(base)
      const data = await res.json()
      setItems(data.posts || [])
    } catch (_) { setItems([]) }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { loadItems() }, [loadItems])

  const visible = items.filter(p => {
    if (kind !== 'all' && p.classified_kind !== kind) return false
    if (hideSold && p.classified_status === 'sold') return false
    return true
  })

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink }}>

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #001a5e 0%, #1e40af 100%)',
        borderRadius: 14, padding: '20px 18px', marginBottom: 14, color: '#fff',
      }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
          🏷️ Venda &amp; Troca
        </div>
        <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
          Marketplace gratuito da comunidade brasileira nos EUA.
          Sem taxa, sem cobrança — só a galera.
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
        {KIND_FILTERS.map(f => (
          <button key={f.id} onClick={() => setKind(f.id)} style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 20,
            background: kind === f.id ? '#1e40af' : C.white,
            color: kind === f.id ? '#fff' : C.inkSoft,
            border: '1px solid ' + (kind === f.id ? '#1e40af' : C.line),
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.sans, whiteSpace: 'nowrap',
          }}>
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setHideSold(s => !s)} style={{
          flexShrink: 0, padding: '7px 12px', borderRadius: 20,
          background: hideSold ? C.white : '#1F2937',
          color: hideSold ? C.inkSoft : '#fff',
          border: '1px solid ' + (hideSold ? C.line : '#1F2937'),
          fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.sans, whiteSpace: 'nowrap',
        }}>
          {hideSold ? 'Esconder vendidos' : 'Mostrar vendidos'}
        </button>
      </div>

      {/* CTA criar */}
      <a href="/app/feed?filter=classified" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        background: '#fff', color: '#6D28D9', textDecoration: 'none',
        border: '1.5px dashed #DDD6FE', borderRadius: 10,
        padding: '11px', fontSize: 13, fontWeight: 700, marginBottom: 14,
      }}>
        ➕ Anunciar algo seu
      </a>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.inkMuted }}>Carregando…</div>
      ) : visible.length === 0 ? (
        <div style={{
          background: C.white, border: '1px dashed ' + C.line, borderRadius: 14,
          padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
            {items.length === 0 ? 'Nenhum anúncio ainda' : 'Nada nesse filtro'}
          </div>
          <div style={{ fontSize: 12, color: C.inkMuted }}>
            {items.length === 0
              ? 'Que tal ser a primeira pessoa a vender algo aqui?'
              : 'Tenta outro filtro acima ou mostre os vendidos.'}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
        }}>
          {visible.map(p => (
            <ItemCard key={p.id} post={p} onClick={setSelected} />
          ))}
        </div>
      )}

      {selected && <ItemModal post={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
