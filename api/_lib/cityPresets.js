/**
 * Preset de raio sugerido por cidade.
 *
 * Logica:
 *  - Cidades MUITO grandes (densas, NYC/LA/Chi): 10mi (toda a comunidade local cabe)
 *  - Cidades GRANDES (Boston/Miami/Houston): 25mi (suburbios ao redor)
 *  - Cidades MEDIAS (Austin/Orlando/Atlanta): 50mi
 *  - Cidades PEQUENAS / interior: 100mi (precisa raio bem maior pra ter massa)
 */

// Lista curta de major brazilian-heavy metros nos USA
const MAJOR_METROS = {
  // 10mi (dense urban core)
  'new york':         10,
  'manhattan':        10,
  'brooklyn':         10,
  'queens':           10,
  'bronx':            10,
  'jersey city':      10,
  'newark':           10,
  'philadelphia':     10,
  'chicago':          10,
  'los angeles':      10,
  'san francisco':    10,
  'oakland':          10,
  'washington':       10,
  'boston':           10,
  'cambridge':        10,
  'somerville':       10,

  // 25mi (suburbs heavy with brasileiros)
  'miami':            25,
  'pompano beach':    25,
  'fort lauderdale':  25,
  'hialeah':          25,
  'doral':            25,
  'aventura':         25,
  'orlando':          25,
  'kissimmee':        25,
  'tampa':            25,
  'houston':          25,
  'dallas':           25,
  'fort worth':       25,
  'austin':           25,
  'san antonio':      25,
  'atlanta':          25,
  'marietta':         25,
  'duluth':           25,

  // 50mi (medium with growing brazilian presence)
  'denver':           50,
  'phoenix':          50,
  'seattle':          50,
  'portland':         50,
  'minneapolis':      50,
  'detroit':          50,
  'cleveland':        50,
  'pittsburgh':       50,
  'st. louis':        50,
  'kansas city':      50,
  'nashville':        50,
  'charlotte':        50,
  'raleigh':          50,
  'jacksonville':     50,
  'las vegas':        50,
  'salt lake city':   50,
  'sacramento':       50,
  'san diego':        50,
}

// Estados rurais → 100mi
const RURAL_STATES = new Set([
  'AK', 'WY', 'MT', 'ND', 'SD', 'VT', 'ME', 'WV', 'NM', 'ID',
])

export function suggestRadius(city, state) {
  if (!city) return 50
  const norm = String(city).trim().toLowerCase()
  if (MAJOR_METROS[norm] != null) return MAJOR_METROS[norm]

  // Match parcial (ex: "miami beach" → encontra "miami")
  for (const [metro, radius] of Object.entries(MAJOR_METROS)) {
    if (norm.includes(metro) || metro.includes(norm)) return radius
  }

  // Estado rural → raio maior
  if (state && RURAL_STATES.has(String(state).toUpperCase())) return 100

  return 50  // default razoavel
}

// Util: nome bonitinho do raio pra UI
export function radiusLabel(miles) {
  if (miles == null || miles === 9999) return 'Nacional'
  if (miles === 999)  return 'Estado todo'
  if (miles === 0)    return 'Só minha cidade'
  return miles + ' milhas'
}
