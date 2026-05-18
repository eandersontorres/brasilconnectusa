import { useState } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { CreatePostModal } from './FeedScreen'

// ════════════════════════════════════════════════════════════════════════════
//   PostButton — botão global de criar conteúdo (inspirado no Nextdoor)
//
//   Variantes:
//     - "sidebar" : botão verde grande no LeftSidebar desktop
//     - "fab"     : floating action button (+ verde) bottom-right no mobile
//
//   Click → abre picker com 4 opções → abre CreatePostModal com type certo
//   (ou navega pra outra tab quando faz sentido).
//
//   Sem login: dispara CustomEvent('bc-open-auth') (AppShell pega e abre modal)
// ════════════════════════════════════════════════════════════════════════════

const ACTIONS = [
  {
    key:   'question',
    icon:  '📝',
    title: 'Postar pergunta',
    desc:  'Pergunte algo pra comunidade brasileira',
  },
  {
    key:   'classified',
    icon:  '🏷️',
    title: 'Vender, comprar ou doar',
    desc:  'Anuncie no marketplace',
  },
  {
    key:   'event',
    icon:  '🎉',
    title: 'Criar evento',
    desc:  'Encontro, festa, esportes, churrasco',
  },
  {
    key:   'recommendation',
    icon:  '💬',
    title: 'Indicar negócio ou pessoa',
    desc:  'Recomende quem te atendeu bem',
  },
]

export default function PostButton({ variant = 'sidebar' }) {
  const { user } = useAuth()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modalType, setModalType] = useState(null)

  function handleClick() {
    if (!user) {
      window.dispatchEvent(new CustomEvent('bc-open-auth'))
      return
    }
    setPickerOpen(true)
  }

  function pickAction(actionKey) {
    setPickerOpen(false)
    // 'event' não tem flow de criação inline ainda — type=event no post serve por ora
    setModalType(actionKey === 'event' ? 'event' : actionKey)
  }

  function handleCreated() {
    setModalType(null)
    // Avisa FeedScreen (se montado) pra recarregar
    window.dispatchEvent(new CustomEvent('bc-post-created'))
  }

  return (
    <>
      {variant === 'sidebar' && (
        <button onClick={handleClick} style={{
          width: '100%', padding: '14px 16px', background: C.green, color: C.white,
          border: 'none', borderRadius: 24, fontWeight: 700, fontSize: 17,
          letterSpacing: '0.02em',
          cursor: 'pointer', fontFamily: FONT.sans, textAlign: 'center',
        }}>
          Post
        </button>
      )}

      {variant === 'fab' && (
        <button onClick={handleClick} aria-label="Postar" style={{
          position: 'fixed', bottom: 84, right: 18, zIndex: 50,
          width: 56, height: 56, borderRadius: '50%', background: C.green, color: C.white,
          border: 'none', cursor: 'pointer', fontFamily: FONT.sans,
          fontSize: 28, lineHeight: 1, fontWeight: 300,
          boxShadow: '0 8px 24px rgba(0,156,59,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>+</button>
      )}

      {pickerOpen && <ActionPicker onClose={() => setPickerOpen(false)} onPick={pickAction} user={user} />}

      {modalType && (
        <CreatePostModal
          user={user}
          defaultType={modalType}
          onClose={() => setModalType(null)}
          onCreated={handleCreated}
        />
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   ActionPicker — modal estilo Nextdoor com cards de opção
// ────────────────────────────────────────────────────────────────────────────
function ActionPicker({ onClose, onPick, user }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: 16, maxWidth: 540, width: '100%',
        maxHeight: '90vh', overflow: 'auto', fontFamily: FONT.sans,
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid ' + C.line,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
              Criar algo
            </div>
            <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 600, color: C.ink, marginTop: 2 }}>
              O que você quer fazer?
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{
            background: 'transparent', border: 'none', fontSize: 24, color: C.inkMuted,
            cursor: 'pointer', padding: 4, lineHeight: 1,
          }}>×</button>
        </div>

        {/* User row */}
        {user && (
          <div style={{
            padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 10,
            background: C.paper, borderBottom: '1px solid ' + C.line,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: C.green,
              color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600,
            }}>{(user.email || '?').charAt(0).toUpperCase()}</div>
            <div style={{ fontSize: 13, color: C.ink, fontWeight: 500 }}>
              Publicando como <span style={{ color: C.inkMuted }}>{user.email}</span>
            </div>
          </div>
        )}

        {/* Cards */}
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
          {ACTIONS.map(a => (
            <button key={a.key} onClick={() => onPick(a.key)} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
              cursor: 'pointer', textAlign: 'left', fontFamily: FONT.sans,
              transition: 'border-color 0.15s ease, background 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.background = '#F0FDF4' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.background = C.white }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: C.paper,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
              }}>{a.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 2 }}>
                  {a.title}
                </div>
                <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.4 }}>{a.desc}</div>
              </div>
              <div style={{ fontSize: 18, color: C.inkMuted, flexShrink: 0 }}>→</div>
            </button>
          ))}
        </div>

        <div style={{ padding: '0 24px 20px', fontSize: 11, color: C.inkMuted, textAlign: 'center' }}>
          Você escolhe a comunidade no próximo passo.
        </div>
      </div>
    </div>
  )
}
