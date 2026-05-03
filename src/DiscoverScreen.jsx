import { useState, useEffect } from 'react'
import { C, FONT } from './lib/colors'

// ════════════════════════════════════════════════════════════════════════════
//   DiscoverScreen — tela de busca + descoberta de categorias
//   Estilo Nextdoor: search topo + trending pills + grid de cards visuais
// ════════════════════════════════════════════════════════════════════════════

const TRENDING_SEARCHES = [
  'Babá', 'Limpeza', 'CDL', 'ITIN', 'Casa pra alugar',
  'Restaurante brasileiro', 'Igreja', 'Pediatra', 'Imóveis',
]

const CATEGORIES = [
  {
    key: 'comunidades', title: 'Comunidades', sub: '75+ grupos pra participar',
    bg: '#E0F2FE', color: '#075985', cta: 'Explorar',
  },
  {
    key: 'eventos', title: 'Eventos', sub: 'Festas, encontros, esportes',
    bg: '#FEF3C7', color: '#92400E', cta: 'Ver agenda',
  },
  {
    key: 'classificados', title: 'Marketplace', sub: 'Compre, venda, doe',
    bg: '#FECACA', color: '#991B1B', cta: 'Navegar',
  },
  {
    key: 'vagas', title: 'Vagas de Emprego', sub: 'Limpeza, construção, baby-sitter',
    bg: '#D1FAE5', color: '#065F46', cta: 'Ver vagas',
  },
  {
    key: 'negocios', title: 'Negócios Brasileiros', sub: 'Restaurantes, mercados, salões',
    bg: '#EDE9FE', color: '#5B21B6', cta: 'Explorar',
  },
  {
    key: 'cambio', title: 'Câmbio & Remessas', sub: 'Compare 5 parceiros ao vivo',
    bg: '#DBEAFE', color: '#1E40AF', cta: 'Comparar',
  },
  {
    key: 'voos', title: 'Voos pro Brasil', sub: 'A partir de $480',
    bg: '#FCE7F3', color: '#9D174D', cta: 'Buscar',
  },
  {
    key: 'bolao', title: 'Bolão Copa 2026', sub: 'Crie ou entre num bolão',
    bg: '#FEF3C7', color: '#92400E', cta: 'Participar',
  },
]

export default function DiscoverScreen({ onNavigate }) {
  const [search, setSearch] = useState('')
  const [communities, setCommunities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/social?action=communities')
      .then(r => r.json())
      .then(d => setCommunities(d.communities || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Filtra busca
  const filtered = search.trim()
    ? communities.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : []

  function handleCategoryClick(key) {
    // Mapeia categoria para tab existente do app
    if (key === 'cambio')        onNavigate && onNavigate('remessas')
    else if (key === 'voos')     onNavigate && onNavigate('voos')
    else if (key === 'bolao')    onNavigate && onNavigate('bolao')
    else if (key === 'negocios') onNavigate && onNavigate('negocios')
    else if (key === 'comunidades' || key === 'eventos' || key === 'classificados' || key === 'vagas') {
      onNavigate && onNavigate('feed')
    }
  }

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 24px' }}>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 18 }}>
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar comunidades, vagas, eventos…"
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

      {/* Resultados de busca */}
      {search.trim() && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Comunidades encontradas ({filtered.length})
          </div>
          {filtered.length === 0 && (
            <div style={{ fontSize: 13, color: C.inkMuted, fontStyle: 'italic', padding: '12px 0' }}>
              Nada encontrado. Tente outro termo.
            </div>
          )}
          {filtered.slice(0, 10).map(c => (
            <div key={c.id} style={{
              padding: '10px 14px', background: C.white, borderRadius: 10,
              border: '1px solid ' + C.line, marginBottom: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{c.name}</div>
                <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 2 }}>
                  {c.member_count || 0} membros · {c.post_count || 0} posts
                </div>
              </div>
              <button onClick={() => onNavigate && onNavigate('feed')} style={{
                background: 'transparent', color: C.green, border: '1.5px solid ' + C.green,
                borderRadius: 16, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: FONT.sans,
              }}>
                Entrar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Trending searches */}
      {!search.trim() && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Em alta
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
            {TRENDING_SEARCHES.map(t => (
              <button key={t} onClick={() => setSearch(t)} style={{
                padding: '7px 14px', borderRadius: 18, background: C.white,
                border: '1px solid ' + C.line, color: C.ink,
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
              }}>
                {t}
              </button>
            ))}
          </div>

          {/* Grid de categorias */}
          <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Explorar
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
          }}>
            {CATEGORIES.map(cat => (
              <button key={cat.key} onClick={() => handleCategoryClick(cat.key)} style={{
                background: cat.bg, border: 'none', borderRadius: 14,
                padding: '20px 16px', textAlign: 'left', cursor: 'pointer',
                fontFamily: FONT.sans, position: 'relative', overflow: 'hidden',
                minHeight: 130, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                transition: 'transform .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: cat.color, marginBottom: 4, lineHeight: 1.2 }}>
                    {cat.title}
                  </div>
                  <div style={{ fontSize: 12, color: cat.color, opacity: 0.8, lineHeight: 1.4 }}>
                    {cat.sub}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: cat.color, fontWeight: 600, marginTop: 12 }}>
                  {cat.cta} →
                </div>
              </button>
            ))}
          </div>

          {/* Comunidades populares */}
          {!loading && communities.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Comunidades populares
              </div>
              {communities.slice(0, 5).map(c => (
                <div key={c.id} style={{
                  padding: '10px 14px', background: C.white, borderRadius: 10,
                  border: '1px solid ' + C.line, marginBottom: 6,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 2 }}>
                      {c.member_count || 0} membros
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
