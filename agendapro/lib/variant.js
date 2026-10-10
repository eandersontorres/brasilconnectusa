// ════════════════════════════════════════════════════════════════════════════
//   Qual app está rodando: AgendaPro ou WorkPro (app.config.js → APP_VARIANT).
//   Mesmo código, mesma conta e mesma assinatura; muda marca, cores, abas, o tipo
//   de negócio padrão e as especialidades do cadastro.
//
//   import { VARIANT, IS_WORKPRO, BRAND } from '../lib/variant'
//   BRAND.name → 'AgendaPro' | 'WorkPro'
// ════════════════════════════════════════════════════════════════════════════
import Constants from 'expo-constants'

export const VARIANT = Constants.expoConfig?.extra?.variant === 'workpro' ? 'workpro' : 'agendapro'
export const IS_WORKPRO = VARIANT === 'workpro'

const BRANDS = {
  agendapro: {
    name: 'AgendaPro',
    letter: 'A',
    tagline: 'Sua agenda, seus clientes e seu dinheiro num lugar só.',
    // Abas na ordem (arquivos em app/(tabs)/). Aba fora da lista fica escondida.
    tabs: ['hoje', 'agenda', 'clientes', 'financas', 'mais'],
    defaultVertical: 'services',
    primary: '#1F4D3F',
    primaryDark: '#143527',
    primarySoft: '#E8F0E9',
  },
  workpro: {
    name: 'WorkPro',
    letter: 'W',
    tagline: 'Orçamento, fatura e agenda do seu serviço, direto do celular.',
    tabs: ['hoje', 'agenda', 'vendas', 'clientes', 'mais'],
    defaultVertical: 'trades',
    primary: '#1B2845',
    primaryDark: '#111A2E',
    primarySoft: '#E8EBF1',
  },
}

export const BRAND = BRANDS[VARIANT]

/**
 * Especialidades do cadastro. `vertical` liga as ferramentas certas:
 *   services → agenda online (beleza, bem-estar)
 *   cleaning → casas fixas, equipes, turnover do Airbnb
 *   trades   → orçamento, fatura, pedidos de orçamento (obra, reparo, serviço técnico)
 */
const SPECIALTIES = {
  agendapro: [
    { label: 'Cabeleireira', vertical: 'services' },
    { label: 'Manicure e pedicure', vertical: 'services' },
    { label: 'Esteticista', vertical: 'services' },
    { label: 'Lash designer', vertical: 'services' },
    { label: 'Design de sobrancelha', vertical: 'services' },
    { label: 'Barbeiro', vertical: 'services' },
    { label: 'Massagista', vertical: 'services' },
    { label: 'Maquiadora', vertical: 'services' },
    { label: 'Personal trainer', vertical: 'services' },
    { label: 'House cleaning', vertical: 'cleaning' },
    { label: 'Limpeza de Airbnb', vertical: 'cleaning' },
    { label: 'Outro', vertical: 'services' },
  ],
  workpro: [
    { label: 'Construção e reforma', vertical: 'trades' },
    { label: 'Handyman', vertical: 'trades' },
    { label: 'Marceneiro', vertical: 'trades' },
    { label: 'Pintor', vertical: 'trades' },
    { label: 'Eletricista', vertical: 'trades' },
    { label: 'Encanador', vertical: 'trades' },
    { label: 'Drywall', vertical: 'trades' },
    { label: 'Pisos e azulejos', vertical: 'trades' },
    { label: 'Telhado', vertical: 'trades' },
    { label: 'Paisagismo', vertical: 'trades' },
    { label: 'Mudança', vertical: 'trades' },
    { label: 'Tradutor juramentado', vertical: 'trades' },
    { label: 'Contabilidade e impostos', vertical: 'trades' },
    { label: 'Fotógrafo', vertical: 'trades' },
    { label: 'House cleaning', vertical: 'cleaning' },
    { label: 'Outro', vertical: 'trades' },
  ],
}

export const SPECIALTY_OPTIONS = SPECIALTIES[VARIANT]
