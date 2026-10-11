/**
 * Assistente — resolução de lugar.
 *
 * O post não tem cidade: o lugar vem da comunidade. Só as comunidades type=city têm
 * geo_city + latitude/longitude; as type=state têm só geo_state.
 *
 * Escopo de lugar, sugestões ("Postar na comunidade") e a lista do system prompt usam SÓ
 * comunidades oficiais (is_official) e públicas: qualquer usuário pode criar comunidade
 * city/state com geo_city livre, e isso não pode tirar a oficial do escopo, virar botão
 * nem entrar no prompt. Posts de comunidades de usuário continuam aparecendo pelo texto
 * (filtro de lugar da RPC) ou para quem é membro.
 *
 *   resolvePlace({ cidade, estado }, profile, { supabase, geocode? })
 *     -> { community_ids|null, place_terms|null, label, suggestions:[{slug,name,url}], unresolved? }
 *
 * Regras:
 *   - cidade com comunidade própria -> essa comunidade + a do estado
 *   - cidade sem comunidade e UF conhecida -> geocode + comunidades de cidade num raio de 75 mi + a do estado
 *     (geocode falhou -> só a do estado)
 *   - só UF -> comunidades de cidade daquela UF + a do estado
 *   - sem lugar -> community_ids/place_terms null (o modelo decide se usa a cidade do perfil)
 */
import { geocodeWithCache } from '../../geocode.js'

export const RADIUS_MILES = 75
const CACHE_MS = 10 * 60_000
const MAX_SUGGESTIONS = 3

// Comunidade de cidade que cobre mais de um estado (NY/NJ Brasileira)
const EXTRA_STATES = { 'newyork-br': ['NJ'] }

// ── Normalização ─────────────────────────────────────────────────────────────
export function normalizeText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// UF -> nome em inglês (usado em label e place_terms)
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

// Nomes em português que diferem do inglês depois de normalizar (sem acento, minúsculo)
const STATE_NAMES_PT = {
  CA: ['california'], GA: ['georgia'], HI: ['havai'], LA: ['luisiana'], MS: ['mississipi'], MO: ['missuri'],
  NH: ['nova hampshire'], NJ: ['nova jersey', 'nova jersei'], NM: ['novo mexico'],
  NY: ['nova york', 'nova iorque'], NC: ['carolina do norte'], ND: ['dakota do norte'], OR: ['oregao'],
  PA: ['pensilvania'], SC: ['carolina do sul'], SD: ['dakota do sul'], TN: ['tenessi'],
  VA: ['virginia'], WV: ['virginia ocidental'], DC: ['distrito de columbia', 'washington dc'],
}

const STATE_LOOKUP = (() => {
  const m = new Map()
  for (const [uf, name] of Object.entries(STATE_NAMES)) {
    m.set(uf.toLowerCase(), uf)
    m.set(normalizeText(name), uf)
  }
  for (const [uf, names] of Object.entries(STATE_NAMES_PT)) for (const n of names) m.set(n, uf)
  m.set('washington state', 'WA')
  m.set('estado de washington', 'WA')
  m.set('dc', 'DC')
  m.set('washington d c', 'DC')
  return m
})()

/** 'Flórida' | 'FL' | 'florida' | 'Nova Jersey' -> 'FL' | 'NJ' | null */
export function toUF(s) {
  const k = normalizeText(s).replace(/^(estado de|estado do|state of)\s+/, '')
  if (!k) return null
  return STATE_LOOKUP.get(k) || null
}

// Apelidos de cidade -> nome canônico + UF
const CITY_ALIASES = (() => {
  const m = new Map()
  const add = (keys, city, state) => keys.forEach(k => m.set(k, { city, state }))
  add(['nyc', 'ny', 'new york', 'new york city', 'nova york', 'nova iorque', 'manhattan', 'brooklyn',
       'queens', 'bronx', 'the bronx', 'staten island'], 'New York', 'NY')
  add(['la', 'l a', 'los angeles', 'los angeles ca'], 'Los Angeles', 'CA')
  add(['washington', 'washington dc', 'washington d c', 'dc', 'distrito de columbia', 'district of columbia'], 'Washington', 'DC')
  add(['sf', 'san francisco', 'sao francisco'], 'San Francisco', 'CA')
  add(['philly', 'philadelphia', 'filadelfia'], 'Philadelphia', 'PA')
  add(['new orleans', 'nova orleans'], 'New Orleans', 'LA')
  add(['las vegas', 'vegas'], 'Las Vegas', 'NV')
  add(['miami beach'], 'Miami Beach', 'FL')
  add(['st petersburg', 'saint petersburg', 'sao petersburgo'], 'St. Petersburg', 'FL')
  return m
})()

// UF provável de cidades com muitos brasileiros e sem comunidade própria (quando o modelo não manda o estado)
const CITY_STATE_HINT = {
  // FL
  'kissimmee': 'FL', 'pompano beach': 'FL', 'fort lauderdale': 'FL', 'ft lauderdale': 'FL', 'boca raton': 'FL',
  'deerfield beach': 'FL', 'coconut creek': 'FL', 'weston': 'FL', 'doral': 'FL', 'davie': 'FL',
  'celebration': 'FL', 'winter garden': 'FL', 'clermont': 'FL', 'jacksonville': 'FL', 'west palm beach': 'FL',
  'palm beach': 'FL', 'sarasota': 'FL', 'fort myers': 'FL', 'hialeah': 'FL', 'aventura': 'FL',
  'port st lucie': 'FL', 'delray beach': 'FL', 'altamonte springs': 'FL', 'windermere': 'FL',
  // MA
  'framingham': 'MA', 'marlborough': 'MA', 'somerville': 'MA', 'everett': 'MA', 'revere': 'MA',
  'malden': 'MA', 'lowell': 'MA', 'worcester': 'MA', 'brockton': 'MA', 'peabody': 'MA', 'woburn': 'MA',
  'cambridge': 'MA',
  // NJ / CT
  'newark': 'NJ', 'kearny': 'NJ', 'long branch': 'NJ', 'jersey city': 'NJ', 'hoboken': 'NJ', 'paterson': 'NJ',
  'danbury': 'CT', 'bridgeport': 'CT', 'stamford': 'CT', 'hartford': 'CT', 'waterbury': 'CT',
  // TX
  'round rock': 'TX', 'pflugerville': 'TX', 'cedar park': 'TX', 'leander': 'TX', 'liberty hill': 'TX',
  'san marcos': 'TX', 'san antonio': 'TX', 'plano': 'TX', 'frisco': 'TX', 'irving': 'TX', 'fort worth': 'TX',
  'sugar land': 'TX', 'katy': 'TX', 'the woodlands': 'TX', 'kyle': 'TX', 'buda': 'TX', 'el paso': 'TX',
  'mckinney': 'TX', 'allen': 'TX',
  // GA
  'marietta': 'GA', 'alpharetta': 'GA', 'sandy springs': 'GA', 'lawrenceville': 'GA',
  // outros
  'san diego': 'CA', 'san jose': 'CA', 'sacramento': 'CA', 'oakland': 'CA', 'irvine': 'CA',
  'santa monica': 'CA', 'long beach': 'CA', 'phoenix': 'AZ', 'denver': 'CO', 'seattle': 'WA',
  'salt lake city': 'UT', 'charlotte': 'NC', 'raleigh': 'NC', 'nashville': 'TN', 'pittsburgh': 'PA',
  'baltimore': 'MD', 'detroit': 'MI', 'minneapolis': 'MN', 'honolulu': 'HI',
}

// ── Comunidades (cache de módulo) ────────────────────────────────────────────
let cache = { at: 0, list: null }

export async function loadCommunities(supabase) {
  if (cache.list && Date.now() - cache.at < CACHE_MS) return cache.list
  const { data, error } = await supabase
    .from('bc_communities')
    .select('id, slug, name, type, geo_city, geo_state, latitude, longitude, visibility, is_private, is_official, member_count')
    // Ordem estável: o corte de linhas do PostgREST nunca derruba as oficiais
    .order('is_official', { ascending: false, nullsFirst: false })
    .order('member_count', { ascending: false, nullsFirst: false })
    .order('slug', { ascending: true })
  if (error || !Array.isArray(data)) {
    if (cache.list) return cache.list // usa o cache vencido se o banco falhar
    throw error || new Error('bc_communities vazio')
  }
  const list = data.map(c => ({
    ...c,
    latitude: c.latitude == null ? null : Number(c.latitude),
    longitude: c.longitude == null ? null : Number(c.longitude),
    _city: normalizeText(c.geo_city),
  }))
  cache = { at: Date.now(), list }
  return list
}

/** Só para testes. */
export function _resetCommunitiesCache() { cache = { at: 0, list: null } }

function isVisible(c) {
  return c.visibility === 'public' && !c.is_private
}

function isOfficial(c) {
  return c?.is_official === true
}

/** Comunidades de cidade oficiais e públicas (escopo, sugestões e system prompt). */
export function cityCommunities(list) {
  return (list || []).filter(c => c.type === 'city' && c.geo_city && isOfficial(c) && isVisible(c))
}

function statesOf(c) {
  return [c.geo_state, ...(EXTRA_STATES[c.slug] || [])].filter(Boolean)
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8
  const rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

// 'round rock' -> 'Round Rock' (só quando veio tudo minúsculo; preserva 'McKinney')
function titleCase(s) {
  if (s !== s.toLowerCase()) return s
  return s.replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase())
}

function suggestionOf(c) {
  return { slug: c.slug, name: c.name, url: '/app/community/' + c.slug }
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))]
}

async function safeGeocode(geocode, city, uf) {
  try {
    const r = await geocode(city, uf)
    const lat = toNum(r?.latitude)
    const lng = toNum(r?.longitude)
    if (lat != null && lng != null) return { latitude: lat, longitude: lng }
  } catch (e) {
    console.error('[assistente] geocode falhou:', city, uf, e?.message)
  }
  return null
}

function build({ cities, states, uf, terms, label }) {
  const stateComms = states
  const all = [...cities, ...stateComms]
  return {
    community_ids: uniq(all.map(c => c.id)),
    place_terms: uniq(terms.map(normalizeText)).slice(0, 8),
    label,
    uf,
    suggestions: all.filter(c => isOfficial(c) && isVisible(c)).slice(0, MAX_SUGGESTIONS).map(suggestionOf),
  }
}

/**
 * Converte o lugar pedido em comunidades.
 * profile (opcional): { city, state, latitude, longitude } — usado para inferir a UF e evitar geocode
 * quando a cidade pedida é a do perfil.
 */
export async function resolvePlace(input = {}, profile = {}, deps = {}) {
  const { supabase, geocode = geocodeWithCache } = deps
  const list = await loadCommunities(supabase)
  const cityComms = cityCommunities(list)
  // Na ordem das UFs pedidas (NY antes de NJ para Nova York)
  const stateCommsOf = ufs => ufs.flatMap(uf => list.filter(c => c.type === 'state' && isOfficial(c) && c.geo_state === uf))

  let cityRaw = cleanName(input?.cidade)
  let stateRaw = cleanName(input?.estado)

  // "Austin, TX" no campo cidade
  if (cityRaw.includes(',')) {
    const [c, ...rest] = cityRaw.split(',')
    const s = rest.join(',')
    if (toUF(s)) { cityRaw = cleanName(c); if (!stateRaw) stateRaw = s }
  }

  let uf = toUF(stateRaw)
  let cityKey = normalizeText(cityRaw)

  // Estado escrito no campo cidade ("Flórida"), exceto quando também é cidade (Nova York, Washington)
  if (cityKey && !CITY_ALIASES.has(cityKey) && !cityComms.some(c => c._city === cityKey)) {
    const asUF = toUF(cityRaw)
    if (asUF && (!uf || uf === asUF)) { uf = asUF; cityRaw = ''; cityKey = '' }
  }

  // ── Sem lugar ──
  if (!cityKey && !uf) {
    const general = list.filter(c => c.type === 'general' && isOfficial(c) && isVisible(c))
    const main = general.find(c => c.slug === 'brasil') || general[0]
    return { community_ids: null, place_terms: null, label: null, uf: null, suggestions: main ? [suggestionOf(main)] : [] }
  }

  // ── Só estado ──
  if (!cityKey) {
    const cities = cityComms.filter(c => statesOf(c).includes(uf))
    const name = STATE_NAMES[uf] || uf
    return build({
      cities,
      states: stateCommsOf([uf]),
      uf,
      terms: [name, ...(STATE_NAMES_PT[uf] || []).slice(0, 1), ...cities.map(c => c.geo_city)],
      label: `${name} (${uf})`,
    })
  }

  // ── Cidade ──
  const alias = CITY_ALIASES.get(cityKey)
  const aliased = !!alias && (!uf || uf === alias.state)
  let canonical = aliased ? alias.city : cityRaw
  if (aliased) uf = alias.state
  const canonKey = normalizeText(canonical)
  const profileKey = normalizeText(profile?.city)
  const profileUF = toUF(profile?.state)
  const isProfileCity = profileKey && profileKey === canonKey && (!uf || !profileUF || uf === profileUF)
  if (!uf) uf = CITY_STATE_HINT[canonKey] || (isProfileCity ? profileUF : null)
  if (!aliased) canonical = isProfileCity ? cleanName(profile.city) : titleCase(canonical)

  const own = cityComms.find(c => c._city === canonKey && (!uf || statesOf(c).includes(uf)))
  // Termos de lugar: o que a pessoa escreveu (se não for sigla curta) + nome canônico
  const typed = cityKey.length >= 4 ? [cityRaw] : []

  if (own) {
    const ufs = uniq([own.geo_state, uf, ...(EXTRA_STATES[own.slug] || [])])
    return build({
      cities: [own],
      states: stateCommsOf(ufs),
      uf: uf || own.geo_state,
      terms: [...typed, canonical, own.geo_city],
      label: `${canonical}, ${uf || own.geo_state}`,
    })
  }

  if (!uf) {
    // Cidade desconhecida sem estado: não dá para geocodificar
    return { community_ids: null, place_terms: null, label: canonical, uf: null, suggestions: [], unresolved: true }
  }

  // Cidade do perfil com coordenadas: dispensa o geocode
  const pLat = toNum(profile?.latitude)
  const pLng = toNum(profile?.longitude)
  const coords = (isProfileCity && pLat != null && pLng != null)
    ? { latitude: pLat, longitude: pLng }
    : await safeGeocode(geocode, canonical, uf)

  let cities = []
  if (coords) {
    cities = cityComms
      .filter(c => c.latitude != null && c.longitude != null)
      .map(c => ({ c, d: haversineMiles(coords.latitude, coords.longitude, c.latitude, c.longitude) }))
      .filter(x => x.d <= RADIUS_MILES)
      .sort((a, b) => a.d - b.d)
      .map(x => x.c)
  }

  return build({
    cities,
    states: stateCommsOf([uf]),
    uf,
    terms: [...typed, canonical, ...cities.map(c => c.geo_city)],
    label: `${canonical}, ${uf}`,
  })
}
