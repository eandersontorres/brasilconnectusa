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
  const [mode, setMode]       = useState(initialMode)            // 'signin' | 'check-email'
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Email inválido')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: window.location.origin + '/?preview=brasil2026',
        },
      })
      if (error) throw error
      setMode('check-email')
    } catch (err) {
      setError(err.message || 'Erro ao enviar link')
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
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Entrar ou criar conta</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
              Sem senha. Mandamos um link mágico no seu email — clica e tá dentro.
            </div>
            <form onSubmit={handleSubmit}>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoFocus required
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
                {loading ? 'Enviando link…' : 'Enviar link mágico →'}
              </button>
            </form>
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
              Ao entrar você aceita nossos termos. Sem spam, prometemos.
            </div>
          </>
        )}

        {mode === 'check-email' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📧</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Confere seu email!</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 16 }}>
              Mandamos um link mágico pra <strong>{email}</strong>.
              Clica nele pra entrar — sem precisar digitar senha.
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 16 }}>
              Se não chegar em 1 minuto, confere o spam.
            </div>
            <button onClick={() => { setMode('signin'); setEmail('') }} style={{
              background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8,
              padding: '8px 14px', fontSize: 12, color: '#6b7280', cursor: 'pointer',
            }}>
              Voltar
            </button>
          </div>
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
