import { useState, useEffect, useCallback, useMemo } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { apiFetch } from './lib/apiFetch'

// ════════════════════════════════════════════════════════════════════════════
//   EventsScreen — lista de eventos da rede do user
//
//   Eventos sao posts com type='event' (vivem em bc_posts). Listamos via
//   /api/social?action=feed&type=event. Separamos em Proximos / Passados
//   com base em event_date.
// ════════════════════════════════════════════════════════════════════════════

const MONTH_PT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ']
const DAY_PT = ['DOM','SEG','TER','QUA','QUI','SEX','SAB']

function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDateLong(iso) {
  const d = new Date(iso)
  return `${DAY_PT[d.getDay()]}, ${d.getDate()} de ${MONTH_PT[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`
}

export default function EventsScreen({ onNavigate }) {
  const { user } = useAuth()
  const [events, setEvents] = useState([])
  const [myRsvps, setMyRsvps] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true); setError(null)
    try {
      const r = await apiFetch('/api/social?action=feed&user_id=' + user.id + '&type=event&limit=100')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      setEvents(d.posts || [])
      apiFetch('/api/social?action=my-rsvps').then(r => r.json()).then(x => setMyRsvps(x.rsvps || {})).catch(() => {})
    } catch (e) {
      setError(e.message)
      setEvents([])
    } finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])

  // Refresh ao criar evento
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('bc-post-created', handler)
    return () => window.removeEventListener('bc-post-created', handler)
  }, [load])

  const { upcoming, past } = useMemo(() => {
    const now = Date.now()
    const up = [], ps = []
    for (const e of events) {
      if (!e.event_date) continue
      const t = new Date(e.event_date).getTime()
      if (t >= now) up.push(e)
      else ps.push(e)
    }
    up.sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    ps.sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    return { upcoming: up, past: ps }
  }, [events])

  async function rsvp(post, status) {
    if (!user) return
    try {
      const r = await apiFetch('/api/social?action=rsvp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, status }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não deu pra confirmar.')
      setMyRsvps(prev => ({ ...prev, [post.id]: status }))
      setEvents(prev => prev.map(e => e.id === post.id ? { ...e, event_rsvp_count: d.going_count } : e))
    } catch (e) { alert(e.message) }
  }

  function openCreate() {
    // Reusa o PostButton picker direto no flow de eventos
    window.dispatchEvent(new CustomEvent('bc-open-create-post', { detail: { type: 'event' } }))
    // Fallback: se PostButton não escutar, abre direto setando default
    // (PostButton renderiza o picker; aqui só pedimos o tipo evento)
  }

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 24px' }}>
      <div style={{
        marginBottom: 20, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.green,
            textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6,
          }}>Eventos</div>
          <h1 style={{
            fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink,
            margin: '0 0 6px 0', letterSpacing: '-0.01em',
          }}>
            Encontros, festas, esportes
          </h1>
          <p style={{ fontSize: 14, color: C.inkMuted, lineHeight: 1.6, margin: 0, maxWidth: 580 }}>
            Eventos das comunidades que você participa. Crie pelo botão Post.
          </p>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: C.inkMuted }}>Carregando…</div>
      )}

      {error && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
          padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16,
        }}>{error}</div>
      )}

      {!loading && !error && (
        <>
          <Section
            label="Próximos"
            count={upcoming.length}
            empty={(
              <EmptyBlock
                title="Sem eventos próximos"
                msg="Crie o primeiro pelo botão Post no menu lateral."
              />
            )}
            events={upcoming}
            myRsvps={myRsvps}
            onRsvp={rsvp}
            onOpen={e => onNavigate && onNavigate('post', e.id)}
          />

          {past.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <Section label="Passados" count={past.length} events={past} compact onOpen={e => onNavigate && onNavigate('post', e.id)} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Section
// ────────────────────────────────────────────────────────────────────────────
function Section({ label, count, events, empty, compact, myRsvps, onRsvp, onOpen }) {
  return (
    <div>
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
      {events.length === 0 ? empty : (
        <div>{events.map(e => <EventCard key={e.id} event={e} compact={compact} mine={myRsvps ? myRsvps[e.id] : null} onRsvp={onRsvp} onOpen={onOpen} />)}</div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   EventCard — date badge + content
// ────────────────────────────────────────────────────────────────────────────
const RSVP_OPTS = [
  { key: 'going', label: 'Vou', color: C.green },
  { key: 'maybe', label: 'Talvez', color: '#B45309' },
  { key: 'not_going', label: 'Não vou', color: '#6B7280' },
]

function EventCard({ event: e, compact, mine, onRsvp, onOpen }) {
  const d = new Date(e.event_date)
  const day = d.getDate()
  const month = MONTH_PT[d.getMonth()]
  return (
    <article style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
      padding: compact ? '10px 14px' : '14px 16px', marginBottom: 10,
      display: 'flex', gap: 14, alignItems: 'flex-start',
      opacity: compact ? 0.7 : 1,
      cursor: onOpen ? 'pointer' : 'default',
    }} onClick={() => onOpen && onOpen(e)}>
      {/* Badge da data */}
      <div style={{
        width: 56, height: 64, flexShrink: 0,
        background: compact ? C.paper : '#FFFBEB',
        border: '1px solid ' + (compact ? C.line : '#FDE68A'),
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: compact ? C.inkMuted : '#92400E', letterSpacing: 1 }}>
          {month}
        </div>
        <div style={{
          fontFamily: FONT.serif, fontSize: 24, fontWeight: 700,
          color: compact ? C.ink : '#92400E', lineHeight: 1, marginTop: 2,
        }}>{day}</div>
        <div style={{ fontSize: 10, color: C.inkMuted, marginTop: 2 }}>
          {fmtTime(e.event_date)}
        </div>
      </div>

      {/* Conteúdo */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.inkMuted, marginBottom: 3 }}>
          {fmtDateLong(e.event_date)}
          {e.community && <> · {e.community.name}</>}
        </div>
        <div style={{
          fontFamily: FONT.serif, fontSize: 17, fontWeight: 600, color: C.ink,
          margin: '0 0 4px 0', lineHeight: 1.3,
        }}>{e.title}</div>
        {e.event_location && (
          <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 4 }}>
            📍 {e.event_location}
          </div>
        )}
        {e.body && !compact && (
          <p style={{
            fontSize: 13, color: C.inkSoft, lineHeight: 1.5, margin: '4px 0 0 0',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{e.body}</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {!compact && onRsvp && RSVP_OPTS.map(o => {
            const on = mine === o.key
            return (
              <button key={o.key} type="button" onClick={ev => { ev.stopPropagation(); onRsvp(e, o.key) }} style={{
                fontFamily: FONT.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 16, cursor: 'pointer',
                background: on ? o.color : C.white, color: on ? '#fff' : o.color, border: '1px solid ' + (on ? o.color : C.line),
              }}>{o.label}</button>
            )
          })}
          {e.event_rsvp_count > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: C.green }}>
              ✓ {e.event_rsvp_count} confirmado{e.event_rsvp_count > 1 ? 's' : ''}
            </span>
          )}
          <span style={{ fontSize: 11, color: C.inkMuted, marginLeft: 'auto' }}>{e.comment_count || 0} comentários</span>
        </div>
      </div>
    </article>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   EmptyBlock
// ────────────────────────────────────────────────────────────────────────────
function EmptyBlock({ title, msg }) {
  return (
    <div style={{
      background: C.white, border: '1px dashed ' + C.line, borderRadius: 12,
      padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: C.inkMuted }}>{msg}</div>
    </div>
  )
}
