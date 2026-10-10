// Configuração lida do app.config.js (extra). Um lugar só pra não espalhar Constants.
import { Platform } from 'react-native'
import Constants from 'expo-constants'

const extra = Constants.expoConfig?.extra || {}

export const SUPABASE_URL = extra.supabaseUrl || ''
export const SUPABASE_ANON_KEY = extra.supabaseAnonKey || ''
export const API_BASE = String(extra.apiBase || 'https://brasilconnectusa.com').replace(/\/$/, '')
// Como o app trata a assinatura, por plataforma:
//   'companion' → app companheiro: sem preço, sem botão de compra e sem "assine no
//                 site" (Apple 3.1.3(f); Google sem programa de cobrança). A assinatura
//                 é feita no site e o app só mostra o plano ativo. Padrão nas lojas.
//   'link'      → mostra preços e abre o checkout do Stripe no navegador (só usar
//                 depois de confirmar com a revisão da Apple/Google; ver docs/agendapro-ideias.md §4).
const MODES = ['companion', 'link']
const pick = (v, def) => (MODES.includes(v) ? v : def)
export const PURCHASE_MODE = Platform.OS === 'ios' ? pick(extra.purchaseModeIos, 'companion')
  : Platform.OS === 'android' ? pick(extra.purchaseModeAndroid, 'companion')
  : 'link'
export const EXTERNAL_PURCHASE = PURCHASE_MODE === 'link'
export const EAS_PROJECT_ID = extra.eas?.projectId || Constants.easConfig?.projectId || null

// Modo demonstração (EXPO_PUBLIC_DEMO=1): sem login e sem backend, com dados de exemplo
// (lib/demo). Pra preview web, capturas das lojas e demo de vendas. Nunca em build de loja.
export const DEMO = extra.demo === true
export const DEMO_PLAN = extra.demoPlan || 'trial'                                // trial|starter|pro|premium|none
export const DEMO_VERTICAL = extra.demoVertical === 'cleaning' ? 'cleaning' : 'services'

export const PUBLIC_PAGE = (slug) => `${API_BASE}/agenda/${slug}`
export const SUPPORT_EMAIL = 'oi@brasilconnectusa.com'
export const PRIVACY_URL = `${API_BASE}/privacidade`
export const TERMS_URL = `${API_BASE}/termos`
