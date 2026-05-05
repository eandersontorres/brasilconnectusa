import { useState, useEffect } from 'react'
import { C, FONT, useIsMobile } from './lib/colors'
import { useAuth } from './AuthModal'
import OnboardingFlow from './OnboardingFlow'
import NotificationBell from './NotificationBell'

// ────────────────────────────────────────────────────────────────────────────
//   AppShell — layout responsivo (mobile bottom nav + desktop 3 colunas)
// ────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'feed',      icon: '⌂',  label: 'Feed' },
  { id: 'discover',  icon: '⌕',  label: 'Buscar' },
  { id: 'remessas',  icon: '$',  label: 'Câmbio' },
  { id: 'negocios',  icon: '◫',  label: 'Negócios' },
  { id: 'bolao',     icon: '⚽', label: 'Bolão' },
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
        <button onClick={onSignOut} title="Sair" style={{
          width: 32, height: 32, borderRadius: '50%', background: C.green,
          color: C.white, border: 'none', cursor: 'pointer',
          fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
        }}>
          {(user.email || '?').charAt(0).toUpperCase()}
        </button>
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
          <button onClick={onSignOut} title={user.email + ' — clique pra sair'} style={{
            width: 34, height: 34, borderRadius: '50%', background: C.green,
            color: C.white, border: 'none', cursor: 'pointer',
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          }}>
            {(user.email || '?').charAt(0).toUpperCase()}
          </button>
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
      {sectionTitle('Navegação')}
      {item(tab === 'feed',     '⌂', 'Feed',     () => setTab('feed'))}
      {item(tab === 'discover', '⌕', 'Buscar',   () => setTab('discover'))}

      {user && myCommunities.length > 0 && (
        <>
          {sectionTitle('Suas comunidades')}
          {myCommunities.slice(0, 8).map(c =>
            item(false, '#', c.name, () => alert('Comunidade: ' + c.slug))
          )}
        </>
      )}

      {sectionTitle('Ferramentas')}
      {item(tab === 'remessas', '$',  'Câmbio',   () => setTab('remessas'))}
      {item(tab === 'voos',     '✈',  'Voos',     () => setTab('voos'))}
      {item(tab === 'negocios', '◫',  'Negócios', () => setTab('negocios'))}
      {item(tab === 'bolao',    '⚽', 'Bolão',    () => setTab('bolao'))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Sidebar Direita (desktop)
// ────────────────────────────────────────────────────────────────────────────
function RightSidebar({ rate }) {
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
        <div style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Eventos próximos
        </div>
        <div style={{ fontSize: 12, color: C.inkSoft, fontStyle: 'italic' }}>
          Nenhum evento agendado.
        </div>
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

  useEffect(() => {
    fetch('/api/rates').then(r => r.json()).then(d => { if (d.mid_rate) setRate(d.mid_rate) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) { setMyCommunities([]); setShowOnboarding(false); return }

    fetch('/api/profile?user_id=' + user.id)
      .then(r => r.json())
      .then(d => { if (d.needs_onboarding) setShowOnboarding(true) })
      .catch(() => {})

    fetch('/api/social?action=my-communities&user_id=' + user.id)
      .then(r => r.json())
      .then(d => setMyCommunities(d.communities || []))
      .catch(() => {})
  }, [user])

  function handleOnboardingComplete() {
    setShowOnboarding(false)
    if (user) {
      fetch('/api/social?action=my-communities&user_id=' + user.id)
        .then(r => r.json())
        .then(d => setMyCommunities(d.communities || []))
        .catch(() => {})
    }
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
        {showAuth && <AuthModalLazy onClose={() => setShowAuth(false)} />}
        {user && showOnboarding && <OnboardingFlow user={user} onComplete={handleOnboardingComplete} />}
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
        maxWidth: 1280, margin: '0 auto', padding: '20px 24px',
        display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr) 280px', gap: 16,
        alignItems: 'start',
      }}>
        <LeftSidebar tab={tab} setTab={setTab} user={user} myCommunities={myCommunities} />

        <div style={{ minWidth: 0 }}>
          {children}
        </div>

        <RightSidebar rate={rate} />
      </div>

      {showAuth && <AuthModalLazy onClose={() => setShowAuth(false)} />}
      {user && showOnboarding && <OnboardingFlow user={user} onComplete={handleOnboardingComplete} />}
    </div>
  )
}
