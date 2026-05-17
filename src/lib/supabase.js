import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️  Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env')
}

// Auth config EXPLÍCITO — mesmos valores que o Supabase usa por default,
// mas declarados aqui pra:
//   1) blindar contra mudança de default em upgrade do @supabase/supabase-js
//      (já aconteceu antes — viraria bug silencioso de "ninguém fica logado")
//   2) deixar intenção visível pra quem ler o código
//
// IMPORTANTE — NÃO mexer em storageKey nem flowType sem coordenação:
//   - storageKey: trocar invalida sessões existentes (todo mundo desloga)
//   - flowType: trocar pra 'pkce' muda o callback do magic link
//
// Tempo de sessão é controlado no Supabase Dashboard (não aqui):
//   Authentication → Sessions → JWT expiry + Inactivity timeout
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      persistSession:     true,  // salva sessão em storage
      autoRefreshToken:   true,  // refresca JWT em background
      detectSessionInUrl: true,  // pega callback do magic link
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  }
)
