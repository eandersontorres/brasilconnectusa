import { useState, useEffect, useMemo, useCallback } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'

const CATEGORIES = [
  { id: 'festa-junina',  label: 'Festa Junina',  emoji: '🌽' },
  { id: 'show',          label: 'Show',          emoji: '🎤' },
  { id: 'jogo-brasil',   label: 'Jogo do Brasil',emoji: '⚽' },
  { id: 'gastronomia',   label: 'Gastronomia',   emoji: '🍽️' },
  { id: 'religioso',     label: 'Religioso',     emoji: '⛪' },
  { id: 'encontro',      label: 'Encontro',      emoji: '🤝' },
  { id: 'cultural',      label: 'Cultural',      emoji: '🎭' },
  { id: 'outro',         label: 'Outro',         emoji: '📌' },
]

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
}
function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function categoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]
}

export default function EventsScreen() {
  const { user } = useAuth()
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [state, setState]   = useState('')
  const [city, setCity]     = useState('')
  const [showSubmit, setShowSubmit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (state) params.set('state', state)
      if (city)  params.set('city', city.trim())
      const res = await fetch('/api/events/list?' + params)
      if (!res.ok) throw new Error('Erro ao carregar eventos')
      const data = await res.json()
      setEvents(data.events || [])
    } catch (e) {
      setError(e.message)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [state, city])

  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => {
    if (!events) return []
    const map = new Map()
    for (const e of events) {
      const key = e.starts_at ? new Date(e.starts_at).toISOString().slice(0, 10) : 'sem-data'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(e)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [events])

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #009c3b 0%, #006428 100%)',
        borderRadius: 14, padding: '20px 18px', marginBottom: 16, color: '#fff',
      }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Eventos da Comunidade
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
          Festas, shows, jogos, encontros — tudo que junta brasileiro nos EUA.
        </div>
      </div>

      {/* Filtros */}
      <div style={{
        display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, marginBottom: 14,
      }}>
        <select
          value={state}
          onChange={e => setState(e.target.value)}
          style={{
            padding: '10px 12px', borderRadius: 9, border: '1.5px solid ' + C.line,
            background: C.white, fontSize: 14, color: C.ink, outline: 'none',
            fontFamily: 'inherit',
          }}
        >
          <option value="">Todos estados</option>
          {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="Cidade (ex: Orlando, Round Rock)"
          style={{
            padding: '10px 12px', borderRadius: 9, border: '1.5px solid ' + C.line,
            background: C.white, fontSize: 14, color: C.ink, outline: 'none',
            boxSizing: 'border-box', width: '100%',
          }}
        />
      </div>

      {(state || city) && (
        <button
          onClick={() => { setState(''); setCity('') }}
          style={{
            background: 'transparent', color: C.inkMuted, border: 'none',
            padding: 0, fontSize: 12, cursor: 'pointer', marginBottom: 12,
            fontFamily: 'inherit',
          }}
        >
          ✕ Limpar filtros
        </button>
      )}

      {/* Estado da lista */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.inkMuted, fontSize: 13 }}>
          Carregando eventos…
        </div>
      )}

      {error && !loading && (
        <div style={{
          background: '#fee2e2', color: '#991b1b', padding: '12px 14px',
          borderRadius: 10, fontSize: 13, marginBottom: 12,
        }}>{error}</div>
      )}

      {!loading && events && events.length === 0 && (
        <div style={{
          background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
          padding: '32px 20px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
            Nenhum evento {state || city ? 'nesse filtro' : 'agendado ainda'}
          </div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
            {state || city
              ? 'Tente outro estado ou cidade.'
              : 'É dono de negócio brasileiro? Cadastre o seu primeiro evento abaixo.'}
          </div>
        </div>
      )}

      {/* Lista agrupada por dia */}
      {grouped.map(([day, items]) => (
        <div key={day} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 8, paddingLeft: 2,
          }}>
            {day === 'sem-data' ? 'Sem data' : fmtDate(day)}
          </div>
          {items.map(ev => <EventCard key={ev.id} ev={ev} />)}
        </div>
      ))}

      {/* CTA: submeter evento */}
      <div style={{
        marginTop: 24,
        background: C.white, border: '1px dashed ' + C.line, borderRadius: 12,
        padding: 16, textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5, marginBottom: 10 }}>
          É dono de um negócio brasileiro nos EUA? Promova seus eventos aqui.
        </div>
        <button
          onClick={() => setShowSubmit(true)}
          style={{
            background: C.navy, color: C.white, border: 'none',
            padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          + Cadastrar evento
        </button>
      </div>

      {showSubmit && (
        <SubmitModal
          defaultEmail={user?.email || ''}
          onClose={() => setShowSubmit(false)}
          onCreated={() => { setShowSubmit(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Card ──────────────────────────────────────────────────────────────────
function EventCard({ ev }) {
  const meta = categoryMeta(ev.category)
  const dayBadge = ev.starts_at ? new Date(ev.starts_at) : null

  return (
    <div style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
      padding: 14, marginBottom: 10, display: 'flex', gap: 12,
    }}>
      {/* Date column */}
      {dayBadge && (
        <div style={{
          width: 54, flexShrink: 0,
          background: C.greenSoft, color: C.green,
          borderRadius: 8, padding: '8px 4px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
            {dayBadge.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
          </div>
          <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
            {dayBadge.getDate()}
          </div>
          <div style={{ fontSize: 10, marginTop: 2, opacity: 0.8 }}>
            {fmtTime(ev.starts_at)}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: C.inkSoft,
            background: C.soft, padding: '2px 8px', borderRadius: 6,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{meta.emoji} {meta.label}</span>
          {ev.featured && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#8C6D3D',
              background: '#F5EFE0', padding: '2px 8px', borderRadius: 6,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>★ destaque</span>
          )}
        </div>
        <div style={{
          fontFamily: FONT.serif, fontSize: 16, fontWeight: 600, color: C.ink,
          lineHeight: 1.25, marginBottom: 4,
        }}>
          {ev.title}
        </div>
        <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5, marginBottom: 4 }}>
          📍 {[ev.venue_name, ev.city, ev.state].filter(Boolean).join(' · ')}
        </div>
        {ev.organizer_name && (
          <div style={{ fontSize: 11, color: C.inkMuted, marginBottom: 6 }}>
            por <strong style={{ color: C.inkSoft }}>{ev.organizer_name}</strong>
            {ev.organizer_verified && <span style={{ marginLeft: 4, color: C.green }}>✓</span>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          {ev.price_label && (
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{ev.price_label}</span>
          )}
          {ev.ticket_url && (
            <a
              href={ev.ticket_url} target="_blank" rel="noopener noreferrer"
              style={{
                background: C.green, color: C.white, padding: '6px 12px',
                borderRadius: 8, fontSize: 12, fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Garantir →
            </a>
          )}
          {ev.contact_whatsapp && (
            <a
              href={`https://wa.me/${ev.contact_whatsapp.replace(/\D/g, '')}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                background: '#25D366', color: C.white, padding: '6px 12px',
                borderRadius: 8, fontSize: 12, fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal de submit ───────────────────────────────────────────────────────
function SubmitModal({ defaultEmail, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', category: 'encontro',
    venue_name: '', address: '', city: '', state: '',
    starts_at: '', ends_at: '',
    cover_image_url: '', ticket_url: '', price_label: '',
    contact_whatsapp: '',
    organizer_business_id: '',
    submitted_email: defaultEmail || '',
  })
  const [myBusinesses, setMyBusinesses] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  // Busca negócios do email pra popular o select
  useEffect(() => {
    if (!form.submitted_email) { setMyBusinesses([]); return }
    fetch(`/api/businesses/list?owner_email=${encodeURIComponent(form.submitted_email)}&status=approved&limit=20`)
      .then(r => r.json())
      .then(d => setMyBusinesses(d.businesses || []))
      .catch(() => setMyBusinesses([]))
  }, [form.submitted_email])

  function update(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/events/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          state: form.state ? form.state.toUpperCase() : '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')
      setResult({ ok: true, msg: data.message || 'Evento enviado!' })
      setTimeout(onCreated, 1600)
    } catch (err) {
      setResult({ ok: false, msg: err.message })
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 9,
    border: '1.5px solid ' + C.line, fontSize: 14, fontFamily: 'inherit',
    background: C.white, color: C.ink, outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block', fontSize: 12, fontWeight: 600, color: C.inkSoft, marginBottom: 4,
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.white, borderRadius: '16px 16px 0 0',
          width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
          padding: '20px 18px 32px',
        }}
      >
        <div style={{ width: 36, height: 4, background: C.line, borderRadius: 4, margin: '0 auto 14px' }} />
        <div style={{ fontFamily: FONT.serif, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
          Cadastrar evento
        </div>
        <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 16, lineHeight: 1.5 }}>
          Eventos passam por aprovação rápida (até 48h). Apenas negócios já cadastrados em /negocio podem submeter.
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Email do dono do negócio *</label>
            <input
              type="email" required style={inputStyle}
              value={form.submitted_email}
              onChange={e => update('submitted_email', e.target.value)}
              placeholder="seu@email.com"
            />
            {form.submitted_email && myBusinesses.length === 0 && (
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>
                Nenhum negócio aprovado encontrado pra esse email. Cadastre seu negócio antes em <a href="/negocio" target="_blank" rel="noopener noreferrer" style={{ color: C.navy }}>/negocio</a>.
              </div>
            )}
          </div>

          {myBusinesses.length > 0 && (
            <div>
              <label style={labelStyle}>Negócio organizador *</label>
              <select
                required style={inputStyle}
                value={form.organizer_business_id}
                onChange={e => update('organizer_business_id', e.target.value)}
              >
                <option value="">Selecione…</option>
                {myBusinesses.map(b => (
                  <option key={b.id} value={b.id}>{b.short_name || b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={labelStyle}>Título *</label>
            <input
              type="text" required style={inputStyle}
              value={form.title}
              onChange={e => update('title', e.target.value)}
              placeholder="Festa Junina 2026"
            />
          </div>

          <div>
            <label style={labelStyle}>Categoria *</label>
            <select
              required style={inputStyle}
              value={form.category}
              onChange={e => update('category', e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Início *</label>
              <input
                type="datetime-local" required style={inputStyle}
                value={form.starts_at}
                onChange={e => update('starts_at', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Fim</label>
              <input
                type="datetime-local" style={inputStyle}
                value={form.ends_at}
                onChange={e => update('ends_at', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Local (nome) </label>
            <input
              type="text" style={inputStyle}
              value={form.venue_name}
              onChange={e => update('venue_name', e.target.value)}
              placeholder="Casa do Brasil, Praça Central…"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
            <div>
              <label style={labelStyle}>Cidade *</label>
              <input
                type="text" required style={inputStyle}
                value={form.city}
                onChange={e => update('city', e.target.value)}
                placeholder="Orlando"
              />
            </div>
            <div>
              <label style={labelStyle}>Estado *</label>
              <select
                required style={inputStyle}
                value={form.state}
                onChange={e => update('state', e.target.value)}
              >
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Endereço (opcional)</label>
            <input
              type="text" style={inputStyle}
              value={form.address}
              onChange={e => update('address', e.target.value)}
              placeholder="123 Main St"
            />
          </div>

          <div>
            <label style={labelStyle}>Descrição</label>
            <textarea
              rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
              value={form.description}
              onChange={e => update('description', e.target.value)}
              placeholder="O que vai rolar no evento…"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Preço</label>
              <input
                type="text" style={inputStyle}
                value={form.price_label}
                onChange={e => update('price_label', e.target.value)}
                placeholder="Gratuito · $25 · $15–40"
              />
            </div>
            <div>
              <label style={labelStyle}>WhatsApp</label>
              <input
                type="tel" style={inputStyle}
                value={form.contact_whatsapp}
                onChange={e => update('contact_whatsapp', e.target.value)}
                placeholder="+1 512 555 0123"
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Link de ingresso</label>
            <input
              type="url" style={inputStyle}
              value={form.ticket_url}
              onChange={e => update('ticket_url', e.target.value)}
              placeholder="https://eventbrite.com/…"
            />
          </div>

          <div>
            <label style={labelStyle}>Capa (URL da imagem)</label>
            <input
              type="url" style={inputStyle}
              value={form.cover_image_url}
              onChange={e => update('cover_image_url', e.target.value)}
              placeholder="https://…"
            />
          </div>

          {result && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: result.ok ? '#dcfce7' : '#fee2e2',
              color: result.ok ? '#166534' : '#991b1b',
            }}>
              {result.msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              type="button" onClick={onClose}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 9,
                background: C.soft, color: C.ink, border: 'none',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Cancelar</button>
            <button
              type="submit" disabled={loading || myBusinesses.length === 0}
              style={{
                flex: 2, padding: '12px 0', borderRadius: 9,
                background: loading || myBusinesses.length === 0 ? C.inkLight : C.green,
                color: C.white, border: 'none',
                fontSize: 14, fontWeight: 600,
                cursor: loading || myBusinesses.length === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {loading ? 'Enviando…' : 'Enviar pra aprovação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
