import { useState, useEffect } from 'react'
import { C, FONT, useIsMobile } from './lib/colors'
import { useAuth } from './AuthModal'
import OnboardingFlow from './OnboardingFlow'
import NotificationBell from './NotificationBell'
import PostButton from './PostButton'
import FeedbackButton from './FeedbackButton'
import { apiFetch } from './lib/apiFetch'
import { SHOW_BUSINESS } from './lib/features'

// ─── Ícones monocromáticos Lucide-style (currentColor, sidebar 18px) ────────
const ICP = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
}
const SIcons = {
  home:     <svg {...ICP}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/></svg>,
  search:   <svg {...ICP}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  globe:    <svg {...ICP}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12a15.3 15.3 0 0 1 4-10z"/></svg>,
  hash:     <svg {...ICP}><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>,
  calendar: <svg {...ICP}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  dollar:   <svg {...ICP}><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  plane:    <svg {...ICP}><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>,
  store:    <svg {...ICP}><path d="M2 7l1-4h18l1 4M3 7v13h18V7M3 7h18M9 22V12h6v10"/></svg>,
  trophy:   <svg {...ICP}><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 4H5a2 2 0 0 0-2 2v1a3 3 0 0 0 3 3"/><path d="M17 4h2a2 2 0 0 1 2 2v1a3 3 0 0 1-3 3"/><line x1="12" y1="15" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg>,
  tag:      <svg {...ICP}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  book:     <svg {...ICP}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  building: <svg {...ICP}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/><line x1="8" y1="6" x2="10" y2="6"/><line x1="14" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/></svg>,
  landing:  <svg {...ICP}><path d="M3.2 14.8L21 19l-1.5 2.3L4 19.5l-.8-4.7z"/><path d="M14 11L9 5.2a2 2 0 0 0-2.6-.4l-.2.2 5 8.5 4 1 .5-2.8a2 2 0 0 0-.3-1.2L14 11z"/></svg>,
  settings: <svg {...ICP}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
}

// Avatar circular pequeno por tipo de comunidade — usado no sidebar
const COMMUNITY_TYPE_COLORS = {
  general:  { bg: '#DBEAFE', fg: '#1E40AF' },
  city:     { bg: '#FEF3C7', fg: '#92400E' },
  state:    { bg: '#D1FAE5', fg: '#065F46' },
  interest: { bg: '#EDE9FE', fg: '#5B21B6' },
}
function communityAvatar(c) {
  const t = COMMUNITY_TYPE_COLORS[c.type] || { bg: '#F3F4F6', fg: '#374151' }
  const icon = (c.icon || '').trim()
  const initial = icon || (c.name || '?').trim().charAt(0).toUpperCase()
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%',
      background: t.bg, color: t.fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: icon ? 12 : 10, fontWeight: 700,
      lineHeight: 1, flexShrink: 0,
    }}>{icon || initial}</div>
  )
}

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
  const iconSize = Math.round(size * 1.25)
  return (
    <a href="/?preview=brasil2026" style={{
      textDecoration: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: FONT.serif,
      fontSize: size,
      fontWeight: 600,
      color: C.navy,
      letterSpacing: '-0.01em',
      flexShrink: 0,
    }}>
      <img src="/favicon.svg" alt="" width={iconSize} height={iconSize}
        style={{ borderRadius: Math.round(iconSize * 0.18), display: 'block' }} />
      <span>
        Brasil<em style={{ color: C.gold, fontStyle: 'normal', fontWeight: 600 }}>Connect</em>
      </span>
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
            onClick={() => {
              setOpen(false)
              window.dispatchEvent(new CustomEvent('bc-navigate', { detail: { tab: 'settings' } }))
            }}
            style={{
              width: '100%', textAlign: 'left', padding: '12px 14px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 13, color: C.ink, fontWeight: 500,
              fontFamily: FONT.sans,
              display: 'flex', alignItems: 'center', gap: 8,
              borderBottom: '1px solid ' + C.line,
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.paper}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ fontSize: 14 }}>⚙️</span> Configurações
          </button>
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

  const item = (active, icon, label, onClick) => {
    // icon pode ser SVG React node OU string (emoji do user em c.icon, ou # fallback)
    const isReactIcon = typeof icon === 'object' && icon !== null
    return (
      <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '8px 12px', background: active ? C.greenSoft : 'transparent',
        color: active ? C.green : C.ink,
        border: 'none', borderRadius: 8, cursor: 'pointer',
        fontFamily: FONT.sans, fontSize: 13, fontWeight: 500,
        textAlign: 'left', marginBottom: 2,
      }}>
        <span style={{
          width: 20, height: 20, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
          fontSize: isReactIcon ? undefined : 14,
          color: active ? C.green : C.inkSoft,
          opacity: isReactIcon ? 1 : 0.85,
        }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    )
  }

  return (
    <div style={{
      background: C.white, borderRadius: 12, border: '1px solid ' + C.line,
      padding: 8, position: 'sticky', top: 80, alignSelf: 'start',
    }}>
      <div style={{ padding: '6px 4px 10px' }}>
        <PostButton variant="sidebar" />
      </div>
      {sectionTitle('Navegação')}
      {item(tab === 'feed',         SIcons.home,   'Feed',        () => setTab('feed'))}
      {item(tab === 'discover',     SIcons.search, 'Buscar',      () => setTab('discover'))}
      {item(tab === 'comunidades',  SIcons.globe,  'Comunidades', () => setTab('comunidades'))}

      {user && myCommunities.length > 0 && (
        <>
          {sectionTitle('Suas comunidades')}
          {myCommunities.slice(0, 8).map(c =>
            item(false, communityAvatar(c), c.name, () => setTab('community', c.slug))
          )}
        </>
      )}

      {sectionTitle('Ferramentas')}
      {item(tab === 'eventos',    SIcons.calendar, 'Eventos',    () => setTab('eventos'))}
      {item(tab === 'remessas',   SIcons.dollar,   'Câmbio',     () => setTab('remessas'))}
      {item(tab === 'voos',       SIcons.plane,    'Voos',       () => setTab('voos'))}
      {SHOW_BUSINESS && item(false, SIcons.store, 'Negócios', () => { window.location.href = '/negocio' })}
      {item(tab === 'bolao',      SIcons.trophy,   'Bolão',      () => setTab('bolao'))}
      {item(tab === 'marketplace',SIcons.tag,      'Marketplace',() => setTab('marketplace'))}

      {sectionTitle('Conteúdo')}
      {item(false, SIcons.book,     'Guias',          () => { window.location.href = '/guias/' })}
      {item(false, SIcons.building, 'Custo de vida',  () => { window.location.href = '/custo-de-vida/' })}
      {item(false, SIcons.landing,  'Guia de chegada',() => { window.location.href = '/guia-chegada/' })}

      {user && (
        <div style={{ marginTop: 14, paddingTop: 8, borderTop: '1px solid ' + C.line }}>
          {item(tab === 'settings', SIcons.settings, 'Configurações', () => setTab('settings'))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Sidebar Direita (desktop)
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
//   SponsorSlot — card de patrocinador (fetch + render + tracking)
// ────────────────────────────────────────────────────────────────────────────
function SponsorSlot({ placement = 'sidebar' }) {
  const { user } = useAuth()
  const [sponsor, setSponsor] = useState(null)
  const [profileState, setProfileState] = useState(null)

  // Carrega estado do user pra targeting (se logado)
  useEffect(() => {
    if (!user) { setProfileState(null); return }
    apiFetch('/api/profile?user_id=' + user.id)
      .then(r => r.json())
      .then(d => setProfileState(d.profile?.state || null))
      .catch(() => {})
  }, [user])

  useEffect(() => {
    const qs = new URLSearchParams({ placement })
    if (profileState) qs.set('state', profileState)
    apiFetch('/api/sponsors?' + qs.toString())
      .then(r => r.json())
      .then(d => setSponsor(d.picked || null))
      .catch(() => setSponsor(null))
  }, [placement, profileState])

  // Track impression (1x quando montar com sponsor resolvido)
  useEffect(() => {
    if (!sponsor) return
    const img = new Image()
    const params = new URLSearchParams({ id: sponsor.id, type: 'impression', placement })
    if (user?.id) params.set('user_id', user.id)
    img.src = '/api/sponsors?action=track&' + params.toString()
  }, [sponsor, placement, user])

  if (!sponsor) return null

  const clickUrl = '/go/sponsor/' + sponsor.id + '?placement=' + placement + (user?.id ? '&user_id=' + user.id : '')

  return (
    <a href={clickUrl} target="_blank" rel="noopener sponsored" style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
      padding: '14px 16px', textDecoration: 'none', color: C.ink, display: 'block',
      fontFamily: FONT.sans,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.inkMuted,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
      }}>Patrocinado</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {sponsor.logo_url && (
          <img src={sponsor.logo_url} alt="" style={{
            width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.serif, fontSize: 15, fontWeight: 600, color: C.ink,
            lineHeight: 1.25, marginBottom: 2,
          }}>{sponsor.name}</div>
          {sponsor.blurb && (
            <div style={{
              fontSize: 11, color: C.inkSoft, lineHeight: 1.4,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{sponsor.blurb}</div>
          )}
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: C.green, marginTop: 8,
      }}>{sponsor.cta_label || 'Saiba mais'} →</div>
    </a>
  )
}

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

      <SponsorSlot placement="sidebar" />

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
    apiFetch('/api/rates').then(r => r.json()).then(d => { if (d.mid_rate) setRate(d.mid_rate) }).catch(() => {})
    apiFetch('/api/events/list?limit=5').then(r => r.json()).then(d => setUpcomingEvents(d.events || [])).catch(() => {})
  }, [])

  // LoginGate (em App.jsx) e outras telas pedem o modal via CustomEvent
  useEffect(() => {
    const openAuth = () => setShowAuth(true)
    const openOnboarding = () => setShowOnboarding(true)
    window.addEventListener('bc-open-auth', openAuth)
    window.addEventListener('bc-require-onboarding', openOnboarding)
    return () => {
      window.removeEventListener('bc-open-auth', openAuth)
      window.removeEventListener('bc-require-onboarding', openOnboarding)
    }
  }, [])

  useEffect(() => {
    if (!user) { setMyCommunities([]); setShowOnboarding(false); return }

    // Onboarding agora e sob demanda — dispara via requireOnboarding() helper
    // quando user tenta uma acao de criacao (postar, votar, entrar em comunidade).
    // Limpa snooze legado caso exista no localStorage de usuarios antigos.
    try { localStorage.removeItem('onboarding_snoozed_until') } catch (_) {}

    apiFetch('/api/social?action=my-communities&user_id=' + user.id)
      .then(r => r.json())
      .then(d => setMyCommunities(d.communities || []))
      .catch(() => {})
  }, [user])

  function handleOnboardingComplete() {
    setShowOnboarding(false)
    // Notifica o helper pra invalidar cache + reabilitar acoes
    try { window.dispatchEvent(new CustomEvent('bc-onboarding-done')) } catch (_) {}
    if (user) {
      apiFetch('/api/social?action=my-communities&user_id=' + user.id)
        .then(r => r.json())
        .then(d => setMyCommunities(d.communities || []))
        .catch(() => {})
    }
  }

  function handleOnboardingDismiss() {
    // Fecha modal mas SEM marcar snooze. Proxima acao critica reabre.
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
        <FeedbackButton />
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

      <FeedbackButton />
      {showAuth && <AuthModalLazy onClose={() => setShowAuth(false)} />}
      {user && showOnboarding && <OnboardingFlow user={user} onComplete={handleOnboardingComplete} onDismiss={handleOnboardingDismiss} />}
    </div>
  )
}
