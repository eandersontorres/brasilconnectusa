// ════════════════════════════════════════════════════════════════════════════
//   Feature flags — controla o que está visível na UI sem deletar código.
//   Re-habilitar uma feature = mudar `false` pra `true` aqui.
// ════════════════════════════════════════════════════════════════════════════

// Diretório de Negócios + área do assinante (dono de business).
// false = esconde item da sidebar, card no Discover, link em Settings, etc.
// Quando estiver pronto pra lançar essa parte, vira `true`.
//
// IMPORTANTE: o HTML estático (public/index.html) NÃO lê esta flag. Os
// cards/links de business naquele arquivo estão comentados manualmente.
// Pra re-habilitar tudo, lembra de descomentar lá também.
export const SHOW_BUSINESS = false
