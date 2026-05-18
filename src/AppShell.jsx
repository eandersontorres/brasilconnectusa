import { useState, useEffect } from 'react'
import { C, FONT, useIsMobile } from './lib/colors'
import { useAuth } from './AuthModal'
import OnboardingFlow from './OnboardingFlow'
import NotificationBell from './NotificationBell'
import PostButton from './PostButton'

// ────────────────────────────────────────────────────────────────────────────
//   AppShell — layout responsivo (mobile bottom nav + desktop 3 colunas)
// ────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'feed',      icon: '⌂',  label: 'Feed' },
  { id: 'discover',  icon: '⌕',  label: 'Buscar' },
  { id: 'eventos',   icon: '🎉', label: 'Eventos' },
  { id: 'remessas',  icon: '$',  label: 'Câmbio' },
  { id: 'bolao',     icon: '⚽', label: 'Bolão' },
  { id: 'voos',      icon: '✈',  label: 'Voos' },
]

// ────────────────────────────────────────────────────────────────────────────
//   Logo
// ────────────────────────────────────────────────────────────────────────────
function Logo({ size = 22 }) {
  return (
    <a href="/?preview=brasil2026" style={{
      textDecoration: 'none',
      fontFamily: FONT.serif,
      fontSize: size,
      fontWeight: 600,
      color: C.navy,
      letterSpacing: '-0.01em',
      flexShrink: 0,
    }}>
      Brasil<em style={{ color: C.gold, fontStyle: 'normal', fontWeight: 600 }}>Connect</em>
    </a>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   UserMenu — popover do avatar com email + botão Sair
// ────────────────────────────────────────────────────────────────────────────
function UserMenu({ user, onSignOut, size = 32 }) {
  const [open, setOpen] = useState(false)

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (!e.target.closest('[data-usermenu]')) setOpen(false)
    }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const initial = (user.email || '?').charAt(0).toUpperCase()

  return (
    <div data-usermenu style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Menu do usuário"
        aria-expanded={open}
        style={{
          width: size, height: size, borderRadius: '50%', background: C.green,
          color: C.white, border: 'none', cursor: 'pointer',
          fontFamily: FONT.sans, fontSize: size > 32 ? 14 : 13, fontWeight: 600,
        }}
      >
        {initial}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: size + 8, right: 0, zIndex: 200,
          background: C.white, border: '1px solid ' + C.line,
          borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
          minWidth: 240, overflow: 'hidden', fontFamily: FONT.sans,
        }}>
          {/* Header com email */}
          <div style={{
            padding: '12px 14px', borderBottom: '1px solid ' + C.line,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: C.green,
              color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 600, flexShrink: 0,
            }}>{initial}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: C.inkMuted,
                textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2,
              }}>Logado como</div>
              <div style={{
                fontSize: 13, color: C.ink, fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{user.email || '—'}</div>
            </div>
          </div>

          {/* Ações */}
          <button
            onClick={() => { setOpen(false); onSignOut() }}
            style={{
              width: '100%', textAlign: 'left', padding: '12px 14px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 13, color: '#dc2626', fontWeight: 600,
              fontFamily: FONT.sans,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ fontSize: 14 }}>↪</span> Sair da conta
          </button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Mobile Top Bar
// ────────────────────────────────────────────────────────────────────────────
function MobileTopBar({ user, onSignIn, onSignOut }) {
  return (
    <div style={{
      background: C.white, borderBottom: '1px solid ' + C.line,
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <Logo size={20} />
      <div style={{ flex: 1 }} />
      {user && <NotificationBell user={user} />}
      {user ? (
        <UserMenu user={user} onSignOut={onSignOut} size={32} />
      ) : (
        <button onClick={onSignIn} style={{
          background: C.navy, color: C.white, border: 'none', borderRadius: 8,
          padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          fontFamily: FONT.sans,
        }}>
          Entrar
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Mobile Bottom Nav
// ────────────────────────────────────────────────────────────────────────────
function MobileBottomNav({ tab, setTab }) {
  return (
    <div style={{
      background: C.white, borderTop: '1px solid ' + C.line,
      display: 'flex', position: 'sticky', bottom: 0, zIndex: 100,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex: 1, padding: '10px 0 8px', border: 'none', background: 'transparent',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          cursor: 'pointer', fontFamily: FONT.sans,
          color: tab === t.id ? C.navy : C.inkMuted,
          borderTop: '2px solid ' + (tab === t.id ? C.green : 'transparent'),
        }}>
          <span style={{ fontSize: 18, fontFamily: FONT.serif }}>{t.icon}</span>
          <span style={{ fontSize: 10, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Desktop Top Bar (com busca)
// ────────────────────────────────────────────────────────────────────────────
function DesktopTopBar({ user, onSignIn, onSignOut, search, setSearch }) {
  return (
    <div style={{
      background: C.white, borderBottom: '1px solid ' + C.line,
      padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 24,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <Logo size={22} />

      <div style={{ flex: 1, maxWidth: 480, position: 'relative' }}>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar comunidades, posts, negócios..."
          style={{
            width: '100%', padding: '9px 14px 9px 36px', borderRadius: 18,
            border: '1px solid ' + C.line, background: C.paper,
            fontSize: 13, fontFamily: FONT.sans, outline: 'none',
            color: C.ink,
          }}
        />
        <span style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          fontSize: 14, color: C.inkMuted, pointerEvents: 'none',
        }}>⌕</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user && <NotificationBell user={user} />}
        {user ? (
          <UserMenu user={user} onSignOut={onSignOut} size={34} />
        ) : (
          <button onClick={onSignIn} style={{
            background: C.navy, color: C.white, border: 'none', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: FONT.sans,
          }}>
            Entrar
          </button>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Sidebar Esquerda (desktop)
// ────────────────────────────────────────────────────────────────────────────
function LeftSidebar({ tab, setTab, user, myCommunities }) {
  const sectionTitle = (txt) => (
    <div style={{
      fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase',
      letterSpacing: 1, padding: '14px 12px 6px',
    }}>{txt}</div>
  )

  const item = (active, icon, label, onClick) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      padding: '8px 12px', background: active ? C.greenSoft : 'transparent',
      color: active ? C.green : C.ink,
      border: 'none', borderRadius: 8, cursor: 'pointer',
      fontFamily: FONT.sans, fontSize: 13, fontWeight: 500,
      textAlign: 'left', marginBottom: 2,
    }}>
      <span style={{ fontSize: 16, opacity: 0.7 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  )

  return (
    <div style={{
      background: C.white, borderRadius: 12, border: '1px solid ' + C.line,
      padding: 8, position: 'sticky', top: 80, alignSelf: 'start',
    }}>
      <div style={{ padding: '6px 4px 10px' }}>
        <PostButton variant="sidebar" />
      </div>
      {sectionTitle('Navegação')}
      {item(tab === 'feed',         '⌂', 'Feed',        () => setTab('feed'))}
      {item(tab === 'discover',     '⌕', 'Buscar',      () => setTab('discover'))}
      {item(tab === 'comunidades',  '🌐','Comunidades', () => setTab('comunidades'))}

      {user && myCommunities.length > 0 && (
        <>
          {sectionTitle('Suas comunidades')}
          {myCommunities.slice(0, 8).map(c =>
            item(false, '#', c.name, () => alert('Comunidade: ' + c.slug))
          )}
        </>
      )}

      {sectionTitle('Ferramentas')}
      {item(tab === 'eventos',  '🎉', 'Eventos',    () => setTab('eventos'))}
      {item(tab === 'remessas', '$',  'Câmbio',     () => setTab('remessas'))}
      {item(tab === 'voos',     '✈',  'Voos',       () => setTab('voos'))}
      {item(false, '◫',  'Negócios', () => { window.location.href = '/negocio' })}
      {item(tab === 'bolao',    '⚽', 'Bolão',      () => setTab('bolao'))}
      {item(tab === 'marketplace','🏷️','Marketplace',() => setTab('marketplace'))}

      {sectionTitle('Conteúdo')}
      {item(false, '📖', 'Guias',          () => { window.location.href = '/guias/' })}
      {item(false, '🏠', 'Custo de vida',  () => { window.location.href = '/custo-de-vida/' })}
      {item(false, '🛬', 'Guia de chegada',() => { window.location.href = '/guia-chegada/' })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Sidebar Direita (desktop)
// ────────────────────────────────────────────────────────────────────────────
function RightSidebar({ rate, setTab, upcomingEvents }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 80, alignSelf: 'start' }}>
      <div style={{
        background: C.navy, color: C.white, borderRadius: 12, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>
          USD → BRL agora
        </div>
        <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 600 }}>
          {rate ? 'R$ ' + rate.toFixed(4) : 'Carregando...'}
        </div>
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Compare 5 parceiros →</div>
      </div>

      <div style={{
        background: C.white, border: '1px solid ' + C.line, borderRadius: 12, padding: '14px 16px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
            Eventos próximos
          </div>
          {upcomingEvents.length > 0 && (
            <button
              onClick={() => setTab('eventos')}
              style={{
                background: 'transparent', border: 'none', color: C.green,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0,
                fontFamily: FONT.sans,
              }}
            >Ver todos →</button>
          )}
        </div>
        {upcomingEvents.length === 0 ? (
          <div style={{ fontSize: 12, color: C.inkSoft, fontStyle: 'italic' }}>
            Nenhum evento agendado.
          </div>
        ) : (
          upcomingEvents.slice(0, 3).map(ev => {
            const d = ev.starts_at ? new Date(ev.starts_at) : null
            return (
              <button
                key={ev.id}
                onClick={() => setTab('eventos')}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  background: 'transparent', border: 'none', padding: '6px 0',
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  borderTop: '1px solid ' + C.lineSoft,
                  fontFamily: FONT.sans,
                }}
              >
                {d && (
                  <div style={{
                    width: 36, flexShrink: 0, textAlign: 'center',
                    background: C.greenSoft, color: C.green, borderRadius: 6, padding: '4px 0',
                  }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' }}>
                      {d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                    </div>
                    <div style={{ fontFamily: FONT.serif, fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
                      {d.getDate()}
                    </div>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.3,
                    overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {ev.title}
                  </div>
                  <div style={{ fontSize: 10, color: C.inkMuted, marginTop: 2 }}>
                    {[ev.city, ev.state].filter(Boolean).join(', ')}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>

      <div style={{
        background: C.greenSoft, border: '1px solid ' + C.green, borderRadius: 12, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 4 }}>
          Convide amigos
        </div>
        <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 8 }}>
          Quanto mais brasileiros, melhor a comunidade.
        </div>
        <button onClick={() => {
          const text = 'Conhece o BrasilConnect? https://brasilconnectusa.com'
          if (navigator.share) navigator.share({ text }).catch(() => {})
          else navigator.clipboard.writeText(text)
        }} style={{
          width: '100%', padding: '7px 0', borderRadius: 8, background: C.green,
          color: C.white, border: 'none', cursor: 'pointer',
          fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
        }}>Compartilhar →</button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   AuthModalLazy
// ────────────────────────────────────────────────────────────────────────────
function AuthModalLazy({ onClose }) {
  const [Mod, setMod] = useState(null)
  useEffect(() => {
    import('./AuthModal').then(m => setMod(() => m.default))
  }, [])
  if (!Mod) return null
  return <Mod onClose={onClose} onAuthenticated={onClose} />
}

// ────────────────────────────────────────────────────────────────────────────
//   AppShell — wrapper principal
// ────────────────────────────────────────────────────────────────────────────
export default function AppShell({ tab, setTab, children }) {
  const isMobile = useIsMobile()
  const { user, signOut } = useAuth()
  const [search, setSearch] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [rate, setRate] = useState(null)
  const [myCommunities, setMyCommunities] = useState([])
  const [upcomingEvents, setUpcomingEvents] = useState([])

  useEffect(() => {
    fetch('/api/rates').then(r => r.json()).then(d => { if (d.mid_rate) setRate(d.mid_rate) }).catch(() => {})
    fetch('/api/events/list?limit=5').then(r => r.json()).then(d => setUpcomingEvents(d.events || [])).catch(() => {})
  }, [])

  // LoginGate (em App.jsx) e outras telas pedem o modal via CustomEvent
  useEffect(() => {
    const handler = () => setShowAuth(true)
    window.addEventListener('bc-open-auth', handler)
    return () => window.removeEventListener('bc-open-auth', handler)
  }, [])

  useEffect(() => {
    if (!user) { setMyCommunities([]); setShowOnboarding(false); return }

    // Respeita snooze de 7 dias (user pulou onboarding)
    let snoozed = false
    try {
      const until = localStorage.getItem('onboarding_snoozed_until')
      if (until && Date.now() < parseInt(until, 10)) snoozed = true
    } catch (_) {}

    if (!snoozed) {
      fetch('/api/profile?user_id=' + user.id)
        .then(r => r.json())
        .then(d => { if (d.needs_onboarding) setShowOnboarding(true) })
        .catch(() => {})
    }

    fetch('/api/social?action=my-communities&user_id=' + user.id)
      .then(r => r.json())
      .then(d => setMyCommunities(d.communities || []))
      .catch(() => {})
  }, [user])

  function handleOnboardingComplete() {
    setShowOnboarding(false)
    try { localStorage.removeItem('onboarding_snoozed_until') } catch (_) {}
    if (user) {
      fetch('/api/social?action=my-communities&user_id=' + user.id)
        .then(r => r.json())
        .then(d => setMyCommunities(d.communities || []))
        .catch(() => {})
    }
  }

  function handleOnboardingDismiss() {
    // Pula por 7 dias — modal nao aparece de novo nesse navegador ate la
    try {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      localStorage.setItem('onboarding_snoozed_until', String(Date.now() + sevenDaysMs))
    } catch (_) {}
    setShowOnboarding(false)
  }

  const baseStyle = {
    minHeight: '100dvh',
    background: C.paper,
    color: C.ink,
    fontFamily: FONT.sans,
  }

  // ── MOBILE LAYOUT ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ ...baseStyle, display: 'flex', flexDirection: 'column' }}>
        <MobileTopBar user={user} onSignIn={() => setShowAuth(true)} onSignOut={signOut} />
        <div style={{ flex: 1, maxWidth: 600, width: '100%', margin: '0 auto', padding: tab === 'agenda' ? 0 : '12px' }}>
          {children}
        </div>
        <MobileBottomNav tab={tab} setTab={setTab} />
        <PostButton variant="fab" />
        {showAuth && <AuthModalLazy onClose={() => setShowAuth(false)} />}
        {user && showOnboarding && <OnboardingFlow user={user} onComplete={handleOnboardingComplete} onDismiss={handleOnboardingDismiss} />}
      </div>
    )
  }

  // ── DESKTOP LAYOUT (3 colunas) ────────────────────────────────────────
  return (
    <div style={baseStyle}>
      <DesktopTopBar
        user={user} onSignIn={() => setShowAuth(true)} onSignOut={signOut}
        search={search} setSearch={setSearch}
      />

      <div style={{
        maxWidth: 1400, margin: '0 auto', padding: '20px 24px',
        display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr) 360px', gap: 20,
        alignItems: 'start',
      }}>
        <LeftSidebar tab={tab} setTab={setTab} user={user} myCommunities={myCommunities} />

        <div style={{ minWidth: 0 }}>
          {children}
        </div>

        <RightSidebar rate={rate} setTab={setTab} upcomingEvents={upcomingEvents} />
      </div>

      {showAuth && <AuthModalLazy onClose={() => setShowAuth(false)} />}
      {user && showOnboarding && <OnboardingFlow user={user} onComplete={handleOnboardingComplete} onDismiss={handleOnboardingDismiss} />}
    </div>
  )
}
