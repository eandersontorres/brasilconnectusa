// ════════════════════════════════════════════════════════════════════════════
//   useAuth — hook simples em cima do supabase.auth
//   Sem Context dedicado: cada componente assina onAuthStateChange direto.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => {
      mounted = false
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  return { session, user: session?.user || null, loading }
}

export async function signInWithEmail(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: 'brasilconnect://auth/callback',
    },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}
