import { useState } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { apiFetch } from './lib/apiFetch'

// ════════════════════════════════════════════════════════════════════════════
//   FeedbackButton — FAB discreto canto inferior esquerdo + modal
//   Botão fica em todas as telas do app. Captura contexto (URL atual,
//   user_agent) automaticamente pra ajudar a debugar.
// ════════════════════════════════════════════════════════════════════════════

const TYPES = [
  { key: 'bug',        label: '🐛 Bug / problema',  hint: 'Algo travou, sumiu, não funcionou como esperado' },
  { key: 'suggestion', label: '💡 Sugestão',         hint: 'Ideia pra deixar o app melhor' },
  { key: 'question',   label: '❓ Dúvida',           hint: 'Não entendi alguma coisa, preciso de ajuda' },
]

export default function FeedbackButton() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit() {
    setError(null)
    if (message.trim().length < 5) {
      setError('Conta um pouco mais (mínimo 5 caracteres).')
      return
    }
    setSending(true)
    try {
      const r = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id || null,
          user_email: user?.email || email.trim() || null,
          type,
          message: message.trim(),
          url: typeof window !== 'undefined' ? window.location.href : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro ao enviar')
      setSent(true)
      setTimeout(() => {
        setOpen(false)
        // reset depois de fechar
        setTimeout(() => {
          setSent(false)
          setMessage('')
          setEmail('')
          setType('bug')
        }, 300)
      }, 1400)
    } catch (e) {
      setError(e.message || 'Erro de rede')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* FAB canto inferior esquerdo */}
      <button
        onClick={() => setOpen(true)}
        title="Reportar problema ou dar feedback"
        aria-label="Feedback"
        style={{
          position: 'fixed',
          bottom: 84,
          left: 18,
          zIndex: 50,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: C.white,
          border: '1px solid ' + C.line,
          boxShadow: '0 4px 14px rgba(0,0,0,.12)',
          cursor: 'pointer',
          fontSize: 20,
          fontFamily: FONT.sans,
          color: C.inkSoft,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform .15s, box-shadow .15s, border-color .15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.08)'
          e.currentTarget.style.borderColor = C.navy
          e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,26,94,.18)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.borderColor = C.line
          e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,.12)'
        }}
      >
        💬
      </button>

      {/* Modal */}
      {open && (
        <div
          onClick={() => !sending && setOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(11,25,40,0.7)',
            zIndex: 2100,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: 0,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: C.white,
              borderRadius: '16px 16px 0 0',
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '20px 22px 24px',
              fontFamily: FONT.sans,
              animation: 'fbSlideUp .25s ease',
            }}
          >
            <style>{`@keyframes fbSlideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ fontFamily: FONT.serif, fontSize: 20, fontWeight: 600, color: C.ink, margin: 0 }}>
                Achou algo errado?
              </h3>
              <button
                onClick={() => !sending && setOpen(false)}
                style={{
                  background: 'transparent', border: 'none', fontSize: 22,
                  color: C.inkMuted, cursor: 'pointer', padding: 4, lineHeight: 1,
                }}
                aria-label="Fechar"
              >×</button>
            </div>
            <p style={{ fontSize: 13, color: C.inkSoft, margin: '0 0 16px', lineHeight: 1.5 }}>
              Conta pra gente — bug, sugestão ou dúvida. A gente lê tudo e usa pra melhorar o app.
            </p>

            {sent ? (
              <div style={{
                padding: '20px 16px', background: '#DCFCE7', borderRadius: 10,
                color: '#166534', fontSize: 14, fontWeight: 600, textAlign: 'center',
              }}>
                ✅ Recebido! Valeu pelo feedback.
              </div>
            ) : (
              <>
                {/* Tipo */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {TYPES.map(t => (
                    <label key={t.key} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '10px 12px',
                      background: type === t.key ? C.navySoft : C.paper,
                      border: '1.5px solid ' + (type === t.key ? C.navy : C.line),
                      borderRadius: 10,
                      cursor: 'pointer',
                      transition: 'border-color .12s, background .12s',
                    }}>
                      <input
                        type="radio"
                        name="feedback-type"
                        value={t.key}
                        checked={type === t.key}
                        onChange={() => setType(t.key)}
                        style={{ marginTop: 3, accentColor: C.navy }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{t.hint}</div>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Mensagem */}
                <label style={{ display: 'block', marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    Mensagem
                  </div>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder={type === 'bug' ? 'O que você estava tentando fazer? O que aconteceu?' : 'Conta pra gente…'}
                    rows={5}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1.5px solid ' + C.line,
                      borderRadius: 10,
                      fontSize: 14,
                      fontFamily: FONT.sans,
                      color: C.ink,
                      background: C.white,
                      outline: 'none',
                      resize: 'vertical',
                      minHeight: 90,
                      boxSizing: 'border-box',
                    }}
                  />
                </label>

                {/* Email se anônimo */}
                {!user && (
                  <label style={{ display: 'block', marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      Email (opcional, pra gente responder)
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1.5px solid ' + C.line,
                        borderRadius: 10,
                        fontSize: 14,
                        fontFamily: FONT.sans,
                        color: C.ink,
                        background: C.white,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </label>
                )}

                {error && (
                  <div style={{
                    padding: '8px 12px', background: '#FEE2E2', borderRadius: 8,
                    color: '#991B1B', fontSize: 12, fontWeight: 600, marginBottom: 12,
                  }}>
                    ⚠ {error}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={sending}
                  style={{
                    width: '100%',
                    background: C.green,
                    color: C.white,
                    border: 'none',
                    padding: '12px',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: sending ? 'wait' : 'pointer',
                    fontFamily: FONT.sans,
                    opacity: sending ? 0.7 : 1,
                  }}
                >
                  {sending ? 'Enviando…' : 'Enviar feedback'}
                </button>

                <div style={{ fontSize: 10, color: C.inkMuted, textAlign: 'center', marginTop: 10 }}>
                  A gente recebe automaticamente a URL e o navegador pra ajudar a debugar.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
