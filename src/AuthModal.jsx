import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

// ════════════════════════════════════════════════════════════════════════════
//   AuthModal — Login/Cadastro
//   Caminhos (do mais simples pro mais fricção):
//     1. Continuar com Google  → OAuth (1 clique, sem senha, sem código)
//     2. Email + senha         → entrar OU criar conta
//     3. Código por email      → fallback (magic link / OTP) p/ quem não quer senha
// ════════════════════════════════════════════════════════════════════════════

const GREEN = '#009c3b'
const GOLD  = '#FFD700'
const NAVY  = '#0B1928'

const REDIRECT_TO = (typeof window !== 'undefined' ? window.location.origin : '') + '/app/feed'

// Botão "Continuar com Google" só aparece quando o provider estiver habilitado
// no Supabase (Auth → Providers → Google, com credenciais OAuth do Google Cloud).
// Enquanto não estiver, virar false evita mostrar um botão que sempre erra.
// Pra religar: trocar pra true depois de configurar o provider no painel.
const GOOGLE_LOGIN_ENABLED = false

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  )
}

export default function AuthModal({ onClose, onAuthenticated, initialMode = 'signin' }) {
  const [mode, setMode]         = useState(initialMode)   // 'signin' | 'signup' | 'verify-code'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)          // mensagem informativa (ex: confirme email)
  const [resendIn, setResendIn] = useState(0)

  // Contador regressivo do "Reenviar código"
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  // ── 1. Google OAuth ────────────────────────────────────────────────────────
  async function handleGoogle() {
    setLoading(true); setError(null); setNotice(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT_TO },
      })
      // signInWithOAuth redireciona a página inteira; se voltar erro, o provider
      // provavelmente não está habilitado no painel do Supabase.
      if (error) throw error
    } catch (err) {
      setError(err.message?.includes('provider is not enabled')
        ? 'Login com Google ainda não está ativo. Use email e senha por enquanto.'
        : (err.message || 'Erro ao entrar com Google'))
      setLoading(false)
    }
  }

  // ── 2. Email + senha (entrar OU criar conta) ───────────────────────────────
  async function handlePassword(e) {
    e.preventDefault()
    if (!emailOk) { setError('Email inválido'); return }
    if (password.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres'); return }
    setLoading(true); setError(null); setNotice(null)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { emailRedirectTo: REDIRECT_TO },
        })
        if (error) throw error
        if (data?.session) {
          // Confirmação de email desligada → já entra direto
          if (onAuthenticated) onAuthenticated(data.user)
          onClose()
        } else {
          // Confirmação ligada → precisa clicar no link do email
          setNotice('Conta criada! Confirme pelo link que enviamos no seu email pra entrar.')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })
        if (error) throw error
        if (onAuthenticated) onAuthenticated(data?.user)
        onClose()
      }
    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('Invalid login credentials')) setError('Email ou senha incorretos.')
      else if (msg.includes('already registered')) setError('Esse email já tem conta. Entre com a senha ou use "código por email".')
      else setError(msg || 'Erro ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  // ── 3. Código por email (fallback) ─────────────────────────────────────────
  async function sendCode(emailToUse) {
    const { error } = await supabase.auth.signInWithOtp({
      email: emailToUse.trim().toLowerCase(),
      options: { emailRedirectTo: REDIRECT_TO, shouldCreateUser: true },
    })
    if (error) throw error
  }

  async function handleUseCode() {
    if (!emailOk) { setError('Digite seu email acima primeiro'); return }
    setLoading(true); setError(null); setNotice(null)
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
    if (digits.length < 6 || digits.length > 10) {
      setError('O código tem entre 6 e 8 dígitos')
      return
    }
    setLoading(true); setError(null)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(), token: digits, type: 'email',
      })
      if (error) throw error
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
      await sendCode(email); setResendIn(45); setCode('')
    } catch (err) {
      setError(err.message || 'Erro ao reenviar')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1.5px solid #e5e7eb', fontSize: 15, outline: 'none',
    background: '#f9fafb', boxSizing: 'border-box', fontFamily: 'inherit',
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.7)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: '32px 24px',
        maxWidth: 400, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
      }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 600, color: NAVY }}>
              Brasil<em style={{ color: GOLD, fontStyle: 'normal', fontWeight: 600 }}>Connect</em>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Comunidade de brasileiros nos EUA</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
              {mode === 'signup' ? 'Criar sua conta' : 'Bora entrar na conversa?'}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
              Pra criar/entrar em bolões, postar e ver contatos do marketplace.
            </div>

            {/* 1. Google (escondido enquanto GOOGLE_LOGIN_ENABLED = false) */}
            {GOOGLE_LOGIN_ENABLED && (
              <>
                <button type="button" onClick={handleGoogle} disabled={loading} style={{
                  width: '100%', padding: '12px 0', borderRadius: 10, background: '#fff',
                  border: '1.5px solid #d1d5db', cursor: loading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  fontSize: 15, fontWeight: 600, color: '#1f2937', fontFamily: 'inherit',
                }}>
                  <GoogleIcon /> Continuar com Google
                </button>

                {/* divisor */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                  <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>ou com email</span>
                  <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                </div>
              </>
            )}

            {/* 2. Email + senha */}
            <form onSubmit={handlePassword}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" required inputMode="email" autoComplete="email"
                style={{ ...inputStyle, marginBottom: 10 }} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Sua senha (mín. 6 caracteres)" required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                style={inputStyle} />

              {error && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 12 }}>{error}</div>
              )}
              {notice && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#ECFDF5', color: '#065F46', fontSize: 12 }}>{notice}</div>
              )}

              <button type="submit" disabled={loading || !emailOk || password.length < 6} style={{
                width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10,
                background: (loading || !emailOk || password.length < 6) ? '#9ca3af' : GREEN, color: '#fff',
                fontSize: 15, fontWeight: 600, border: 'none',
                cursor: (loading || !emailOk || password.length < 6) ? 'default' : 'pointer',
              }}>
                {loading ? 'Aguarde…' : mode === 'signup' ? 'Criar conta →' : 'Entrar →'}
              </button>
            </form>

            {/* alterna entrar/criar */}
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: '#6b7280' }}>
              {mode === 'signup' ? 'Já tem conta? ' : 'Não tem conta ainda? '}
              <button type="button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); setNotice(null) }}
                style={{ background: 'none', border: 'none', color: GREEN, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13 }}>
                {mode === 'signup' ? 'Entrar' : 'Criar conta'}
              </button>
            </div>

            {/* 3. fallback código */}
            <div style={{ textAlign: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid #F3F4F6' }}>
              <button type="button" onClick={handleUseCode} disabled={loading}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b7280', textDecoration: 'underline', textDecorationColor: '#D1D5DB', fontFamily: 'inherit' }}>
                Prefiro receber um código por email
              </button>
              <div style={{ height: 8 }} />
              <button type="button" onClick={onClose}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: '6px 8px', fontFamily: 'inherit' }}>
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
              <input type="text" value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="00000000" autoFocus required
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10}
                style={{ width: '100%', padding: '14px 10px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 24, outline: 'none', background: '#f9fafb', boxSizing: 'border-box', fontFamily: 'monospace', fontWeight: 600, textAlign: 'center', letterSpacing: 5 }} />
              {error && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 12 }}>{error}</div>
              )}
              <button type="submit" disabled={loading || code.length < 6} style={{
                width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 10,
                background: (loading || code.length < 6) ? '#9ca3af' : GREEN, color: '#fff',
                fontSize: 15, fontWeight: 600, border: 'none', cursor: (loading || code.length < 6) ? 'default' : 'pointer',
              }}>
                {loading ? 'Verificando…' : 'Entrar →'}
              </button>
            </form>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
              <button onClick={() => { setMode('signin'); setCode(''); setError(null) }}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                ← Voltar
              </button>
              <button onClick={handleResend} disabled={resendIn > 0 || loading}
                style={{ background: 'none', border: 'none', color: resendIn > 0 ? '#9ca3af' : GREEN, cursor: resendIn > 0 ? 'default' : 'pointer', padding: 0, fontSize: 12, fontWeight: 600 }}>
                {resendIn > 0 ? `Reenviar em ${resendIn}s` : 'Reenviar código'}
              </button>
            </div>

            <div style={{ marginTop: 18, padding: '10px 12px', borderRadius: 8, background: '#F0F9FF', border: '1px solid #BAE6FD', fontSize: 11, color: '#075985', lineHeight: 1.5 }}>
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
