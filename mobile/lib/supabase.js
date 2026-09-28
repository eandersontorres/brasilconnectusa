// ════════════════════════════════════════════════════════════════════════════
//   Supabase client — RN/Expo
//   Reaproveita o mesmo backend do web. URL e anon key vêm de app.json (extra).
// ════════════════════════════════════════════════════════════════════════════
import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'

const url = Constants.expoConfig?.extra?.supabaseUrl || ''
const anon = Constants.expoConfig?.extra?.supabaseAnonKey || ''

if (!url || !anon) {
  // Avisa em dev — em prod o app não deve ser publicado sem isso preenchido.
  console.warn('[supabase] supabaseUrl/supabaseAnonKey ausentes em app.json → extra')
}

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
