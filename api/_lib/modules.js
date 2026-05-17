/**
 * Server-side spelhamento da taxonomia de modulos de /js/bc-modules.js.
 *
 * Mantem APENAS o que o backend precisa pra validar/persistir:
 *   - lista de modulos canonicos
 *   - mapping categoria -> modulo default
 *
 * Se mudar o conjunto canonico aqui, atualize tambem public/js/bc-modules.js.
 */

export const VALID_MODULES = new Set([
  'restaurant',
  'grocery',
  'retail',
  'agenda_pro',
  'showcase',
])

export const CATEGORY_TO_MODULE = {
  restaurante:   'restaurant',
  mercado:       'grocery',
  beleza:        'agenda_pro',
  saude:         'agenda_pro',
  educacao:      'agenda_pro',
  juridico:      'showcase',
  contabilidade: 'showcase',
  igreja:        'showcase',
  imoveis:       'showcase',
  transporte:    'showcase',
}

export function categoryToModule(category) {
  return CATEGORY_TO_MODULE[String(category || '').toLowerCase()] || 'showcase'
}

export function normalizeModule(input, fallbackCategory) {
  const m = String(input || '').toLowerCase()
  if (VALID_MODULES.has(m)) return m
  return categoryToModule(fallbackCategory)
}
