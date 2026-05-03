// ════════════════════════════════════════════════════════════════════════════
//   BrasilConnect — Paleta minimalista
//   Base: branco e cinza claro. Cores fortes só em CTAs, badges e acentos.
// ════════════════════════════════════════════════════════════════════════════

export const COLORS = {
  // ── Brand (cores fortes — usar com moderação) ───────────────────────────
  brand: {
    navy:       '#001a5e',   // Azul Brasil escuro — primary
    navyLight:  '#0a2548',
    navySoft:   '#E5EAF1',
    green:      '#009c3b',   // Verde Brasil — success/CTA
    greenDark:  '#006428',
    greenSoft:  '#E6F4EB',
    yellow:     '#ffdf00',   // Amarelo Brasil — usar muito pouco (acentos)
    gold:       '#FFD700',   // Dourado — usar em badges e logo
    goldSoft:   '#FFF8DC',
  },

  // ── Surfaces (base do app) ──────────────────────────────────────────────
  surface: {
    white:      '#FFFFFF',     // Card / fundo principal
    paper:      '#FAFAF9',     // Base do app (cinza muito claro com hint de creme)
    soft:       '#F5F5F4',     // Hover, áreas secundárias
    elevated:   '#FFFFFF',     // Cards em destaque
  },

  // ── Text (preto suave + tons de cinza) ──────────────────────────────────
  text: {
    primary:    '#0B1928',     // Quase preto, com hint de navy
    secondary:  '#4B5563',     // Texto secundário
    tertiary:   '#9CA3AF',     // Hints, metadata
    muted:      '#D1D5DB',     // Disabled, dividers
    onDark:     '#FFFFFF',
    onDarkSoft: 'rgba(255,255,255,.72)',
  },

  // ── Borders / dividers ──────────────────────────────────────────────────
  border: {
    default:    '#E5E7EB',     // Divider padrão
    soft:       '#F3F4F6',     // Mais sutil
    strong:     '#D1D5DB',     // Hover/focus
  },

  // ── Semantic (status, alertas, etc) ─────────────────────────────────────
  semantic: {
    success:    '#10B981',
    successBg:  '#D1FAE5',
    danger:     '#EF4444',
    dangerBg:   '#FEE2E2',
    warning:    '#F59E0B',
    warningBg:  '#FEF3C7',
    info:       '#3B82F6',
    infoBg:     '#DBEAFE',
  },
}

// ── Atalhos curtos pra usar nos componentes ────────────────────────────────
export const C = {
  // Brand
  navy:    COLORS.brand.navy,
  navySoft: COLORS.brand.navySoft,
  green:   COLORS.brand.green,
  greenSoft: COLORS.brand.greenSoft,
  gold:    COLORS.brand.gold,
  yellow:  COLORS.brand.yellow,

  // Text
  ink:     COLORS.text.primary,
  inkSoft: COLORS.text.secondary,
  inkMuted: COLORS.text.tertiary,
  inkLight: COLORS.text.muted,

  // Surface
  white:   COLORS.surface.white,
  paper:   COLORS.surface.paper,
  soft:    COLORS.surface.soft,

  // Borders
  line:    COLORS.border.default,
  lineSoft: COLORS.border.soft,
}

// ── Tipografia ─────────────────────────────────────────────────────────────
export const FONT = {
  serif: "'Fraunces', Georgia, serif",
  sans:  "'Sora', -apple-system, BlinkMacSystemFont, sans-serif",
}

// ── Breakpoints ────────────────────────────────────────────────────────────
export const BREAKPOINTS = {
  mobile:  768,
  tablet:  1024,
  desktop: 1280,
}

// ── Hook: detectar se é mobile (cliente) ──────────────────────────────────
import { useState, useEffect } from 'react'

export function useIsMobile(breakpoint = BREAKPOINTS.mobile) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isMobile
}
