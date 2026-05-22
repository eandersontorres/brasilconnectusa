import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

// ════════════════════════════════════════════════════════════════════════════
//   AuthModal — Login/Cadastro via Magic Link (Supabase Auth)
// ════════════════════════════════════════════════════════════════════════════

const GREEN = '#009c3b'
const BLUE  = '#002776'
const GOLD  = '#FFD700'
const NAVY  = '#0B1928'

export default function AuthModal({ onClose, onAuthenticated, initialMode = 'signin' }) {
  const [mode, setMode]       = useState(initialMode)            // 'signin' | 'verify-code'
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [resendIn, setResendIn] = useState(0)                    // segundos até poder reenviar

  // Contador regressivo do "Reenviar código"
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  async function sendCode(emailToUse) {
    const { error } = await supabase.auth.signInWithOtp({
      email: emailToUse.trim().toLowerCase(),
      options: {
        // emailRedirectTo continua válido — magic link no email funciona como
        // fallback pra quem preferir clicar em vez de digitar o código
        emailRedirectTo: window.location.origin + '/app/feed',
        shouldCreateUser: true,
      },
    })
    if (error) throw error
  }

  async function handleSubmitEmail(e) {
    e.preventDefault()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Email inválido')
      return
    }
    setLoading(true); setError(null)
    try {
      await sendCode(email)
      setMode('verify-code')
      setResendIn(45)
    } catch (err) {
      setError(err.message || 'Erro ao enviar código')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitCode(e) {
    e.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) {
      setError('O código tem 6 dígitos')
      return
    }
    setLoading(true); setError(null)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: digits,
        type: 'email',
      })
      if (error) throw error
      // Sessão criada — Supabase persiste no localStorage automaticamente
      if (onAuthenticated) onAuthenticated(data?.user)
      onClose()
    } catch (err) {
      setError(err.message?.includes('expired') ? 'Código expirou. Peça um novo abaixo.' : (err.message || 'Código inválido'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendIn > 0 || !email) return
    setLoading(true); setError(null)
    try {
      await sendCode(email)
      setResendIn(45)
      setCode('')
    } catch (err) {
      setError(err.message || 'Erro ao reenviar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: '32px 24px',
          maxWidth: 400, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{
              fontFamily: "'Fraunces', Georgia, serif",
              fontSize: 22, fontWeight: 600, color: NAVY,
            }}>
              Brasil<em style={{ color: GOLD, fontStyle: 'normal', fontWeight: 600 }}>Connect</em>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Comunidade de brasileiros nos EUA</div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 22, color: '#9ca3af',
            cursor: 'pointer', padding: 0, lineHeight: 1,
          }}>×</button>
        </div>

        {mode === 'signin' && (
          <>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>Bora entrar na conversa?</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14, lineHeight: 1.5 }}>
              Criando conta você pode:
            </div>

            {/* Benefícios concretos — o que o user GANHA cadastrando */}
            <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['💬', 'Postar perguntas e comentar nas comunidades'],
                ['⚽', 'Criar ou entrar em bolões da Copa 2026'],
                ['🏷️', 'Anunciar no marketplace e ver contatos completos'],
                ['🔔', 'Notificações de eventos brasileiros perto de você'],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#374151' }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmitEmail}>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoFocus required inputMode="email" autoComplete="email"
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  border: '1.5px solid #e5e7eb', fontSize: 15, outline: 'none',
                  background: '#f9fafb', boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
              {error && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 8,
                  background: '#FEE2E2', color: '#991B1B', fontSize: 12,
                }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || !email} style={{
                width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10,
                background: loading ? '#9ca3af' : GREEN, color: '#fff',
                fontSize: 15, fontWeight: 600, border: 'none', cursor: loading ? 'default' : 'pointer',
              }}>
                {loading ? 'Enviando código…' : 'Receber código por email →'}
              </button>
            </form>
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
              Sem senha · Sem spam · Você decide quem vê o seu perfil
            </div>

            {/* Opt-out: continuar navegando sem conta */}
            <div style={{ textAlign: 'center', marginTop: 16, paddingTop: 14, borderTop: '1px solid #F3F4F6' }}>
              <button type="button" onClick={onClose} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12, color: '#6b7280', padding: '4px 8px',
                textDecoration: 'underline', textDecorationColor: '#D1D5DB',
                fontFamily: 'inherit',
              }}>
                Continuar navegando sem conta
              </button>
            </div>
          </>
        )}

        {mode === 'verify-code' && (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Digite o código</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
              Mandamos um código pra <strong>{email}</strong>. Cola ou digita aqui:
            </div>
            <form onSubmit={handleSubmitCode}>
              <input
                type="text" value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus required
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                maxLength={6}
                style={{
                  width: '100%', padding: '14px 10px', borderRadius: 10,
                  border: '1.5px solid #e5e7eb', fontSize: 24, outline: 'none',
                  background: '#f9fafb', boxSizing: 'border-box',
                  fontFamily: 'monospace', fontWeight: 600,
                  textAlign: 'center', letterSpacing: 5,
                }}
              />
              {error && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 8,
                  background: '#FEE2E2', color: '#991B1B', fontSize: 12,
                }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || code.length !== 6} style={{
                width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10,
                background: (loading || code.length !== 6) ? '#9ca3af' : GREEN, color: '#fff',
                fontSize: 15, fontWeight: 600, border: 'none',
                cursor: (loading || code.length !== 6) ? 'default' : 'pointer',
              }}>
                {loading ? 'Verificando…' : 'Entrar →'}
              </button>
            </form>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
              <button onClick={() => { setMode('signin'); setCode(''); setError(null) }}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                ← Trocar email
              </button>
              <button onClick={handleResend} disabled={resendIn > 0 || loading}
                style={{
                  background: 'none', border: 'none',
                  color: resendIn > 0 ? '#9ca3af' : GREEN,
                  cursor: resendIn > 0 ? 'default' : 'pointer',
                  padding: 0, fontSize: 12, fontWeight: 600,
                }}>
                {resendIn > 0 ? `Reenviar em ${resendIn}s` : 'Reenviar código'}
              </button>
            </div>

            <div style={{
              marginTop: 18, padding: '10px 12px', borderRadius: 8,
              background: '#F0F9FF', border: '1px solid #BAE6FD',
              fontSize: 11, color: '#075985', lineHeight: 1.5,
            }}>
              💡 <strong>Dica:</strong> se o código demorar, confere o spam. Ou clica direto no link mágico que vem no mesmo email.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   useAuth — hook que devolve { user, loading, signOut }
// ════════════════════════════════════════════════════════════════════════════
export function useAuth() {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        setUser(session?.user || null)
        setLoading(false)
      }
    }).catch(() => {
      if (mounted) setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })

    return () => {
      mounted = false
      subscription?.unsubscribe?.()
    }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, loading, signOut }
}
