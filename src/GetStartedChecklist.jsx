import { useState, useEffect } from 'react'
import { C, FONT } from './lib/colors'

// ════════════════════════════════════════════════════════════════════════════
//   GetStartedChecklist — cards horizontais de "primeiros passos"
//   Aparece no topo do Feed pra usuários novos. Some quando todos completos.
// ════════════════════════════════════════════════════════════════════════════

const STEPS = [
  {
    key: 'introduce',
    title: 'Apresente-se',
    desc: 'Diga oi pra comunidade num post curto.',
    cta: 'Apresentar',
    icon: '👋',
  },
  {
    key: 'first_question',
    title: 'Faça uma pergunta',
    desc: 'O que você gostaria de saber sobre viver nos EUA?',
    cta: 'Perguntar',
    icon: '?',
  },
  {
    key: 'invite',
    title: 'Convide um brasileiro',
    desc: 'Quanto mais gente, mais legal a comunidade.',
    cta: 'Compartilhar',
    icon: '+',
  },
  {
    key: 'add_photo',
    title: 'Adicione foto de perfil',
    desc: 'Posts com foto são mais respondidos.',
    cta: 'Adicionar',
    icon: '◯',
  },
  {
    key: 'attend_event',
    title: 'Confirme presença num evento',
    desc: 'Conheça outros brasileiros pessoalmente.',
    cta: 'Ver eventos',
    icon: '⊙',
  },
]

export default function GetStartedChecklist({ user, onAction }) {
  const [completed, setCompleted] = useState(new Set())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    fetch('/api/profile?user_id=' + user.id)
      .then(r => r.json())
      .then(d => {
        const done = new Set((d.checklist || []).map(c => c.step_key))
        // Se tem avatar_url, marca add_photo como done
        if (d.profile?.avatar_url) done.add('add_photo')
        setCompleted(done)
      })
      .catch(() => {})
  }, [user])

  if (!user) return null
  if (dismissed) return null

  const total = STEPS.length
  const doneCount = completed.size
  if (doneCount === total) return null  // some quando tudo completo

  function handleAction(stepKey) {
    if (stepKey === 'introduce' || stepKey === 'first_question') {
      onAction && onAction('create-post', stepKey)
    } else if (stepKey === 'invite') {
      const text = 'Conhece o BrasilConnect? https://brasilconnectusa.com'
      if (navigator.share) navigator.share({ text }).catch(() => {})
      else {
        navigator.clipboard.writeText(text)
        markDone(stepKey)
      }
    } else if (stepKey === 'add_photo') {
      onAction && onAction('open-profile')
    } else if (stepKey === 'attend_event') {
      onAction && onAction('navigate', 'discover')
    }
  }

  function markDone(stepKey) {
    fetch('/api/profile?action=checklist-mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, step_key: stepKey }),
    }).then(() => setCompleted(s => new Set([...s, stepKey])))
      .catch(() => {})
  }

  return (
    <div style={{
      background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
      padding: '14px 16px', marginBottom: 12, fontFamily: FONT.sans,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>
          Primeiros passos no BrasilConnect
        </div>
        <button onClick={() => setDismissed(true)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: C.inkMuted, fontSize: 18, padding: 0, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>
        {doneCount} de {total} concluídos
      </div>

      <div style={{
        height: 4, background: C.lineSoft, borderRadius: 2, overflow: 'hidden', marginBottom: 12,
      }}>
        <div style={{
          height: '100%', width: ((doneCount / total) * 100) + '%',
          background: C.green, transition: 'width .3s ease',
        }} />
      </div>

      <div style={{
        display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4,
        scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        <style>{'.gs-scroll::-webkit-scrollbar{display:none}'}</style>
        {STEPS.map(s => {
          const done = completed.has(s.key)
          return (
            <div key={s.key} className="gs-scroll" style={{
              flexShrink: 0, width: 220,
              background: done ? C.greenSoft : C.paper,
              border: '1px solid ' + (done ? C.green : C.line),
              borderRadius: 10, padding: '12px 14px',
              opacity: done ? 0.7 : 1,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: done ? C.green : C.white, color: done ? C.white : C.inkSoft,
                  border: done ? 'none' : '1.5px solid ' + C.line,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                }}>{done ? '✓' : s.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>
                  {s.title}
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.inkSoft, lineHeight: 1.4, marginBottom: 10 }}>
                {s.desc}
              </div>
              <button onClick={() => handleAction(s.key)} disabled={done} style={{
                width: '100%', padding: '7px 0', borderRadius: 6,
                background: done ? 'transparent' : C.navy,
                color: done ? C.green : C.white,
                border: done ? 'none' : 'none',
                fontSize: 12, fontWeight: 600, cursor: done ? 'default' : 'pointer',
                fontFamily: FONT.sans,
              }}>
                {done ? '✓ Feito' : s.cta}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
