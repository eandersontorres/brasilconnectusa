import { useState } from 'react'

// ─── Dados ─────────────────────────────────────────────────────────────────────

const CATEGORIES = ['Todos', 'Restaurante', 'Mercado', 'Salão & Beleza', 'Serviços', 'Saúde']

const BUSINESSES = [
  {
    id: 1,
    name: 'TorresBee Brazilian Cafe & Restaurant',
    short_name: 'TorresBee',
    category: 'Restaurante',
    short_desc: 'Sabores autênticos do Brasil com ingredientes importados diretamente do Brasil. Picanha, pizzas, coxinha e muito mais.',
    address: '1901 Town Centre Dr, Ste 150',
    city: 'Round Rock',
    state: 'TX',
    zip: '78664',
    phone: '(512) 987-2578',
    website: 'https://www.torresbeebrazil.com',
    doordash: 'https://www.doordash.com/en/store/torresbee-brazilian-cafe-&-restaurant-round-rock-29864021/',
    ubereats: 'https://www.ubereats.com/store/torresbee-brazilian-cafe-&-restaurant/jgk0XjAeSHyCcubTazo8Bw',
    hours: [
      { day: 'Segunda', time: 'Fechado' },
      { day: 'Terça–Quinta', time: '11h–21h' },
      { day: 'Sexta–Sábado', time: '11h–22h' },
      { day: 'Domingo', time: '11h–21h' },
    ],
    plan: 'pro',
    tags: ['Picanha', 'Pizza', 'Coxinha', 'Churrasco', 'Sobremesas', 'Delivery'],
    rating: 4.5,
    reviews: 71,
    featured: true,
    emoji: '🐝',
    color: '#f59e0b',
  },
]

const PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    price: 0,
    color: '#6b7280',
    bg: '#f9fafb',
    border: '#e5e7eb',
    features: [
      'Perfil com nome e endereço',
      'Número de telefone',
      'Categoria do negócio',
    ],
    cta: 'Cadastrar grátis',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29,
    color: '#009c3b',
    bg: '#f0fdf4',
    border: '#86efac',
    popular: true,
    features: [
      'Tudo do Basic',
      'Horários de funcionamento',
      'Tags de produto/serviço',
      'Link para website',
      'Destaque na busca',
      'Badge "Pro"',
    ],
    cta: 'Começar Pro',
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 79,
    color: '#002776',
    bg: '#eff6ff',
    border: '#93c5fd',
    features: [
      'Tudo do Pro',
      'Posição #1 na categoria',
      'Links de delivery (DoorDash, Uber Eats)',
      'Analytics de cliques e visualizações',
      'Badge "Verificado" ✓',
      'Suporte prioritário',
    ],
    cta: 'Começar Premium',
  },
]

// ─── Componentes ───────────────────────────────────────────────────────────────

function StarRating({ rating, reviews }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ display: 'flex', gap: 1 }}>
        {[1,2,3,4,5].map(i => (
          <span key={i} style={{ fontSize: 13, color: i <= full ? '#f59e0b' : i === full + 1 && half ? '#f59e0b' : '#d1d5db' }}>
            {i <= full ? '★' : i === full + 1 && half ? '⯨' : '★'}
          </span>
        ))}
      </div>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{rating.toFixed(1)} ({reviews} avaliações)</span>
    </div>
  )
}

function PlanBadge({ plan }) {
  const config = {
    pro: { label: 'Pro', color: '#009c3b', bg: '#dcfce7' },
    premium: { label: '✓ Verificado', color: '#002776', bg: '#dbeafe' },
    basic: null,
  }
  const c = config[plan]
  if (!c) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px',
      borderRadius: 20, background: c.bg, color: c.color,
    }}>
      {c.label}
    </span>
  )
}

function BusinessCard({ biz, onSelect }) {
  return (
    <div
      onClick={() => onSelect(biz)}
      style={{
        background: '#fff',
        border: biz.featured ? '2px solid #f59e0b' : '1.5px solid #e5e7eb',
        borderRadius: 14, padding: '16px', marginBottom: 12,
        cursor: 'pointer', position: 'relative',
        boxShadow: biz.featured ? '0 2px 12px rgba(245,158,11,0.15)' : 'none',
      }}
    >
      {biz.featured && (
        <div style={{
          position: 'absolute', top: -10, left: 14,
          background: '#f59e0b', color: '#fff',
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
        }}>
          ⭐ DESTAQUE
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Logo/emoji */}
        <div style={{
          width: 52, height: 52, borderRadius: 12, flexShrink: 0,
          background: biz.color + '20', border: `1.5px solid ${biz.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26,
        }}>
          {biz.emoji}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{biz.short_name || biz.name}</span>
            <PlanBadge plan={biz.plan} />
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
            📍 {biz.city}, {biz.state} · {biz.category}
          </div>
          <StarRating rating={biz.rating} reviews={biz.reviews} />
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#374151', marginTop: 10, lineHeight: 1.5 }}>
        {biz.short_desc}
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
        {biz.tags.slice(0, 5).map(tag => (
          <span key={tag} style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 20,
            background: '#f3f4f6', color: '#374151',
          }}>{tag}</span>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#009c3b', fontWeight: 600 }}>
        Ver detalhes →
      </div>
    </div>
  )
}

function BusinessProfile({ biz, onBack }) {
  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, padding: '0 0 12px', cursor: 'pointer' }}
      >
        ← Voltar
      </button>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${biz.color}22 0%, ${biz.color}08 100%)`,
        border: `1.5px solid ${biz.color}40`,
        borderRadius: 16, padding: '20px 16px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, flexShrink: 0,
            background: biz.color + '25', border: `2px solid ${biz.color}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34,
          }}>
            {biz.emoji}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontWeight: 800, fontSize: 17 }}>{biz.name}</span>
            </div>
            <PlanBadge plan={biz.plan} />
          </div>
        </div>
        <StarRating rating={biz.rating} reviews={biz.reviews} />
      </div>

      {/* Descrição */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Sobre</div>
        <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, margin: 0 }}>{biz.short_desc}</p>
      </div>

      {/* Tags */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Especialidades</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {biz.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 20,
              background: biz.color + '15', color: biz.color,
              fontWeight: 500, border: `1px solid ${biz.color}30`,
            }}>{tag}</span>
          ))}
        </div>
      </div>

      {/* Contato & Endereço */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Contato</div>
        {[
          { icon: '📍', text: `${biz.address}, ${biz.city}, ${biz.state} ${biz.zip}` },
          { icon: '📞', text: biz.phone, href: `tel:${biz.phone}` },
          { icon: '🌐', text: biz.website.replace('https://www.', ''), href: biz.website },
        ].map(({ icon, text, href }) => (
          <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, color: '#2563eb', textDecoration: 'underline' }}>
                {text}
              </a>
            ) : (
              <span style={{ fontSize: 13, color: '#374151' }}>{text}</span>
            )}
          </div>
        ))}
      </div>

      {/* Horários */}
      {biz.hours && (
        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Horários</div>
          {biz.hours.map(({ day, time }) => (
            <div key={day} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ color: '#6b7280' }}>{day}</span>
              <span style={{ fontWeight: 500, color: time === 'Fechado' ? '#ef4444' : '#111827' }}>{time}</span>
            </div>
          ))}
        </div>
      )}

      {/* Delivery */}
      {(biz.doordash || biz.ubereats) && (
        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Delivery</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {biz.doordash && (
              <a href={biz.doordash} target="_blank" rel="noopener noreferrer"
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 9, textAlign: 'center',
                  background: '#ff3008', color: '#fff', fontWeight: 600, fontSize: 13,
                  textDecoration: 'none',
                }}>
                🚗 DoorDash
              </a>
            )}
            {biz.ubereats && (
              <a href={biz.ubereats} target="_blank" rel="noopener noreferrer"
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 9, textAlign: 'center',
                  background: '#000', color: '#fff', fontWeight: 600, fontSize: 13,
                  textDecoration: 'none',
                }}>
                🛵 Uber Eats
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PlansSection() {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        background: 'linear-gradient(135deg, #002776 0%, #1e40af 100%)',
        borderRadius: 14, padding: '20px 16px', marginBottom: 16, color: '#fff',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          🏪 Cadastre seu negócio
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
          Apareça para milhares de brasileiros nos EUA que buscam serviços da comunidade.
        </div>
      </div>

      {PLANS.map(plan => (
        <div key={plan.id} style={{
          background: plan.bg,
          border: `1.5px solid ${plan.border}`,
          borderRadius: 14, padding: '16px', marginBottom: 12,
          position: 'relative',
        }}>
          {plan.popular && (
            <div style={{
              position: 'absolute', top: -10, left: 14,
              background: plan.color, color: '#fff',
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            }}>
              MAIS POPULAR
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: plan.color }}>{plan.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>por mês</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {plan.price === 0 ? (
                <span style={{ fontSize: 24, fontWeight: 800, color: plan.color }}>Grátis</span>
              ) : (
                <span style={{ fontSize: 24, fontWeight: 800, color: plan.color }}>${plan.price}</span>
              )}
            </div>
          </div>

          {plan.features.map(f => (
            <div key={f} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
              <span style={{ color: plan.color, fontSize: 14, flexShrink: 0, marginTop: 1 }}>✓</span>
              <span style={{ fontSize: 13, color: '#374151' }}>{f}</span>
            </div>
          ))}

          <button
            onClick={() => alert(`Em breve! Pagamentos via Stripe para o plano ${plan.name}.`)}
            style={{
              width: '100%', marginTop: 14, padding: '11px 0', borderRadius: 9,
              background: plan.color, color: '#fff',
              fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            {plan.cta} →
          </button>
        </div>
      ))}

      <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', lineHeight: 1.6, padding: '8px 0' }}>
        Planos Pro e Premium via Stripe · Cancele quando quiser · Sem fidelidade
      </div>
    </div>
  )
}

// ─── Tela Principal ────────────────────────────────────────────────────────────

export default function NegociosScreen() {
  const [selectedBiz, setSelectedBiz] = useState(null)
  const [activeCategory, setActiveCategory] = useState('Todos')
  const [showPlans, setShowPlans] = useState(false)

  if (selectedBiz) {
    return <BusinessProfile biz={selectedBiz} onBack={() => setSelectedBiz(null)} />
  }

  if (showPlans) {
    return (
      <div>
        <button
          onClick={() => setShowPlans(false)}
          style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, padding: '0 0 12px', cursor: 'pointer' }}
        >
          ← Voltar
        </button>
        <PlansSection />
      </div>
    )
  }

  const filtered = activeCategory === 'Todos'
    ? BUSINESSES
    : BUSINESSES.filter(b => b.category === activeCategory)

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #002776 0%, #1e40af 100%)',
        borderRadius: 14, padding: '18px 16px', marginBottom: 16, color: '#fff',
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>🏪 Negócios Brasileiros</div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Encontre serviços e negócios da comunidade brasileira nos EUA
        </div>
      </div>

      {/* Filtro de categorias */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 14, scrollbarWidth: 'none' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20, fontSize: 12,
              fontWeight: activeCategory === cat ? 600 : 400,
              background: activeCategory === cat ? '#002776' : '#f3f4f6',
              color: activeCategory === cat ? '#fff' : '#374151',
              border: 'none', cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Lista de negócios */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 14 }}>Nenhum negócio encontrado nesta categoria ainda.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Seja o primeiro a cadastrar!</div>
        </div>
      ) : (
        filtered.map(biz => (
          <BusinessCard key={biz.id} biz={biz} onSelect={setSelectedBiz} />
        ))
      )}

      {/* CTA cadastro */}
      <div style={{
        background: '#f0fdf4', border: '1.5px solid #86efac',
        borderRadius: 14, padding: '16px', marginTop: 8,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#166534', marginBottom: 4 }}>
          Tem um negócio brasileiro?
        </div>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 12, lineHeight: 1.5 }}>
          Apareça para brasileiros da sua região. Plano gratuito disponível.
        </div>
        <button
          onClick={() => setShowPlans(true)}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 9,
            background: '#009c3b', color: '#fff',
            fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
          }}
        >
          Cadastrar meu negócio →
        </button>
      </div>
    </div>
  )
}
