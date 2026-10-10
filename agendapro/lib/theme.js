// ════════════════════════════════════════════════════════════════════════════
//   AgendaPro — tokens visuais. Paleta da marca BrasilConnect (public/css/premium.css):
//   papel creme, tinta quase preta, verde profundo como cor principal, dourado de acento.
//   Fonte: a do sistema (SF Pro no iPhone, Roboto no Android), como o site.
// ════════════════════════════════════════════════════════════════════════════
import { Platform } from 'react-native'

export const colors = {
  paper:      '#FAF7F0',
  paperSoft:  '#F1ECDF',
  paperDeep:  '#F5F1E5',
  white:      '#FFFFFF',

  ink:        '#1A1F1C',
  inkSoft:    '#4B4F4D',
  inkMuted:   '#8B8E89',

  green:      '#1F4D3F',   // cor principal (botões, abas ativas)
  greenDark:  '#143527',
  greenSoft:  '#E8F0E9',
  flag:       '#009C3B',   // verde bandeira (detalhes, sucesso)
  gold:       '#B8943B',   // acento (planos, destaques)
  goldDark:   '#8C6D3D',
  goldSoft:   '#F5EFE0',
  navy:       '#1B2845',
  navySoft:   '#E8EBF1',

  line:       '#E5E1D6',
  lineSoft:   '#F1ECDF',

  danger:     '#B42318',
  dangerSoft: '#FDECEA',
  warning:    '#B54708',
  warningSoft:'#FEF0E1',
  success:    '#027A48',
  successSoft:'#E6F4EC',
  info:       '#1D4ED8',
  infoSoft:   '#E8EEFD',
}

// Cores pra equipe/profissionais na agenda (Premium)
export const teamColors = ['#1F4D3F', '#B8943B', '#1B2845', '#B42318', '#6D28D9', '#0E7490', '#C2410C', '#4D7C0F', '#BE185D', '#475569']

// Status do agendamento → cor e rótulo (mesmo vocabulário do painel web)
export const statusStyle = {
  pending:   { label: 'Aguardando sinal', fg: colors.warning, bg: colors.warningSoft },
  confirmed: { label: 'Confirmado',       fg: colors.green,   bg: colors.greenSoft },
  completed: { label: 'Realizado',        fg: colors.success, bg: colors.successSoft },
  canceled:  { label: 'Cancelado',        fg: colors.inkMuted, bg: colors.paperSoft },
  no_show:   { label: 'Faltou',           fg: colors.danger,  bg: colors.dangerSoft },
}

export const font = {
  family: Platform.select({ ios: 'System', android: 'sans-serif', default: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, 'Segoe UI', Roboto, sans-serif" }),
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
}

export const type = {
  h1:    { fontSize: 28, fontWeight: '700', color: colors.ink, letterSpacing: -0.4 },
  h2:    { fontSize: 22, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 },
  h3:    { fontSize: 17, fontWeight: '600', color: colors.ink },
  body:  { fontSize: 15, fontWeight: '400', color: colors.ink, lineHeight: 21 },
  small: { fontSize: 13, fontWeight: '400', color: colors.inkSoft, lineHeight: 18 },
  muted: { fontSize: 13, fontWeight: '400', color: colors.inkMuted, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, letterSpacing: 0.6, textTransform: 'uppercase' },
  kpi:   { fontSize: 24, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 },
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 999 }

export const shadow = Platform.select({
  ios: { shadowColor: '#1A1F1C', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  android: { elevation: 1 },
  default: { boxShadow: '0 2px 10px rgba(26,31,28,0.06)' },
})
