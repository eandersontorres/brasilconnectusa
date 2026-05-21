/**
 * Registry canônico de companhias aéreas que voam Brasil ⇄ USA.
 *
 * Usado por:
 *   /api/flights/airlines  (lista pro frontend)
 *   /api/flights/search    (enriquece resultados Amadeus/Travelpayouts com logo/nome PT)
 *
 * Códigos:
 *   iata — 2 letras (LA, G3, AA, UA, DL, CM, AF, KL, IB, TP)
 *   icao — 3 letras (LAN, GLO, AAL, UAL, DAL, CMP, AFR, KLM, IBE, TAP)
 *
 * Hubs principais nos EUA pra rotas BR: MIA, MCO, JFK, EWR, IAH, ATL, FLL, BOS.
 * Hubs principais no BR: GRU, GIG, BSB, CNF, REC, FOR.
 *
 * deep_link: padrão pra montar URL de busca direta no site da cia.
 *            Tokens: {origin} {destination} {date_yyyy_mm_dd} {return_date}
 */

export const AIRLINES = [
  {
    iata: 'LA',
    icao: 'LAN',
    id: 'latam',
    name: 'LATAM Airlines',
    name_pt: 'LATAM',
    country: 'CL',
    logo: 'https://logo.clearbit.com/latamairlines.com',
    hubs_us: ['MIA', 'JFK', 'MCO', 'LAX', 'BOS'],
    hubs_br: ['GRU', 'GIG', 'BSB', 'FOR'],
    direct_routes: [
      ['MIA', 'GRU'], ['MIA', 'GIG'], ['MIA', 'BSB'], ['MIA', 'FOR'],
      ['JFK', 'GRU'], ['MCO', 'GRU'], ['LAX', 'GRU'], ['BOS', 'GRU'],
    ],
    has_alliance: 'oneworld',
    deep_link: 'https://www.latamairlines.com/br/pt/oferta-voos?origin={origin}&destination={destination}&outbound={date}&inbound={return_date}&adt=1&chd=0&inf=0&trip=RT',
    booking_class_pt: ['Promo', 'Light', 'Plus', 'Top', 'Premium Business'],
  },
  {
    iata: 'G3',
    icao: 'GLO',
    id: 'gol',
    name: 'GOL Linhas Aéreas',
    name_pt: 'GOL',
    country: 'BR',
    logo: 'https://logo.clearbit.com/voegol.com.br',
    hubs_us: ['MIA', 'MCO', 'FLL'],
    hubs_br: ['GRU', 'GIG', 'BSB', 'CNF', 'REC'],
    direct_routes: [
      ['MIA', 'GRU'], ['MIA', 'BSB'], ['MCO', 'GRU'], ['MCO', 'BSB'],
    ],
    has_alliance: 'star_alliance',
    deep_link: 'https://b2c.voegol.com.br/booking/search?o1={origin}&d1={destination}&dt1={date}&dt2={return_date}&ADT=1&CHD=0&INF=0',
    booking_class_pt: ['Light', 'Plus', 'Max', 'Smiles'],
  },
  {
    iata: 'AD',
    icao: 'AZU',
    id: 'azul',
    name: 'Azul Linhas Aéreas',
    name_pt: 'Azul',
    country: 'BR',
    logo: 'https://logo.clearbit.com/voeazul.com.br',
    hubs_us: ['FLL', 'MCO', 'JFK'],
    hubs_br: ['VCP', 'REC', 'CNF', 'BSB'],
    direct_routes: [
      ['FLL', 'VCP'], ['FLL', 'REC'], ['MCO', 'VCP'], ['JFK', 'VCP'],
    ],
    has_alliance: null,
    deep_link: 'https://www.voeazul.com.br/br/en/home/flight-booking?from={origin}&to={destination}&out={date}&in={return_date}',
    booking_class_pt: ['Promo', 'Mais Azul', 'Azul Viagens', 'Business'],
  },
  {
    iata: 'AA',
    icao: 'AAL',
    id: 'american',
    name: 'American Airlines',
    name_pt: 'American',
    country: 'US',
    logo: 'https://logo.clearbit.com/aa.com',
    hubs_us: ['MIA', 'DFW', 'JFK', 'CLT', 'PHL'],
    hubs_br: ['GRU', 'GIG', 'BSB'],
    direct_routes: [
      ['MIA', 'GRU'], ['MIA', 'GIG'], ['MIA', 'BSB'],
      ['DFW', 'GRU'], ['JFK', 'GRU'],
    ],
    has_alliance: 'oneworld',
    deep_link: 'https://www.aa.com/booking/find-flights?tripType=roundTrip&searchType=Award&from={origin}&to={destination}&departDate={date}&returnDate={return_date}&adult=1',
    booking_class_pt: ['Basic Economy', 'Main Cabin', 'Premium Economy', 'Business', 'Flagship First'],
  },
  {
    iata: 'UA',
    icao: 'UAL',
    id: 'united',
    name: 'United Airlines',
    name_pt: 'United',
    country: 'US',
    logo: 'https://logo.clearbit.com/united.com',
    hubs_us: ['IAH', 'EWR', 'ORD', 'IAD', 'SFO'],
    hubs_br: ['GRU', 'GIG'],
    direct_routes: [
      ['IAH', 'GRU'], ['EWR', 'GRU'], ['ORD', 'GRU'], ['IAD', 'GRU'],
      ['EWR', 'GIG'],
    ],
    has_alliance: 'star_alliance',
    deep_link: 'https://www.united.com/en/us/fsr/choose-flights?f={origin}&t={destination}&d={date}&r={return_date}&px=1&taxng=1&clm=7&st=bestmatches',
    booking_class_pt: ['Basic Economy', 'Economy', 'Economy Plus', 'Business', 'Polaris'],
  },
  {
    iata: 'DL',
    icao: 'DAL',
    id: 'delta',
    name: 'Delta Air Lines',
    name_pt: 'Delta',
    country: 'US',
    logo: 'https://logo.clearbit.com/delta.com',
    hubs_us: ['ATL', 'JFK', 'DTW', 'LAX', 'SEA'],
    hubs_br: ['GRU', 'GIG'],
    direct_routes: [
      ['ATL', 'GRU'], ['ATL', 'GIG'], ['JFK', 'GRU'],
    ],
    has_alliance: 'skyteam',
    deep_link: 'https://www.delta.com/flight-search/book-a-flight?tripType=ROUND_TRIP&origin={origin}&destination={destination}&departureDate={date}&returnDate={return_date}',
    booking_class_pt: ['Basic Economy', 'Main Cabin', 'Comfort+', 'Premium Select', 'Delta One'],
  },
  {
    iata: 'CM',
    icao: 'CMP',
    id: 'copa',
    name: 'Copa Airlines',
    name_pt: 'Copa',
    country: 'PA',
    logo: 'https://logo.clearbit.com/copaair.com',
    hubs_us: ['MIA', 'JFK', 'MCO', 'LAX', 'IAD'],
    hubs_br: ['GRU', 'GIG', 'BSB', 'CNF', 'REC', 'FOR'],
    direct_routes: [],  // sempre via PTY (Cidade do Panamá)
    has_alliance: 'star_alliance',
    deep_link: 'https://shop.copaair.com/?date1={date}&date2={return_date}&from0={origin}&to0={destination}&adults=1',
    booking_class_pt: ['Economy Promo', 'Economy Classic', 'Economy Full', 'Business Promo', 'Business Full'],
    notes: 'Sempre faz conexão em PTY. Boa opção pra cidades menores do BR.',
  },
  {
    iata: 'AF',
    icao: 'AFR',
    id: 'air_france',
    name: 'Air France',
    name_pt: 'Air France',
    country: 'FR',
    logo: 'https://logo.clearbit.com/airfrance.com',
    hubs_us: ['JFK', 'MIA', 'IAH', 'BOS'],
    hubs_br: ['GRU', 'GIG'],
    direct_routes: [],  // sempre via CDG
    has_alliance: 'skyteam',
    deep_link: 'https://www.airfrance.com/search?origin={origin}&destination={destination}&date={date}',
    booking_class_pt: ['Economy', 'Premium Economy', 'Business', 'La Première'],
    notes: 'Conexão em CDG. Bom pra quem tá no nordeste dos EUA.',
  },
  {
    iata: 'IB',
    icao: 'IBE',
    id: 'iberia',
    name: 'Iberia',
    name_pt: 'Iberia',
    country: 'ES',
    logo: 'https://logo.clearbit.com/iberia.com',
    hubs_us: ['JFK', 'MIA', 'ORD', 'BOS'],
    hubs_br: ['GRU', 'GIG', 'REC', 'SSA'],
    direct_routes: [],  // sempre via MAD
    has_alliance: 'oneworld',
    deep_link: 'https://www.iberia.com/web/flightSearchResults.do?origin={origin}&destination={destination}&date={date}',
    booking_class_pt: ['Basic', 'Economy', 'Premium Economy', 'Business'],
  },
  {
    iata: 'TP',
    icao: 'TAP',
    id: 'tap',
    name: 'TAP Air Portugal',
    name_pt: 'TAP',
    country: 'PT',
    logo: 'https://logo.clearbit.com/flytap.com',
    hubs_us: ['JFK', 'EWR', 'MIA', 'BOS', 'IAD'],
    hubs_br: ['GRU', 'GIG', 'REC', 'SSA', 'FOR', 'CNF'],
    direct_routes: [],  // sempre via LIS
    has_alliance: 'star_alliance',
    deep_link: 'https://www.flytap.com/en-us/book-a-flight?from={origin}&to={destination}&depart={date}&return={return_date}',
    booking_class_pt: ['Discount', 'Basic', 'Classic', 'Plus', 'Top Executive'],
    notes: 'Conexão em LIS. Diáspora portuguesa-brasileira no nordeste.',
  },
]

export const AIRLINE_BY_IATA = Object.fromEntries(
  AIRLINES.map(a => [a.iata, a])
)

export const AIRLINE_BY_ID = Object.fromEntries(
  AIRLINES.map(a => [a.id, a])
)

/**
 * Retorna a cia aérea pelo código IATA, ou um placeholder se não encontrar.
 */
export function lookupAirline(iata) {
  return AIRLINE_BY_IATA[iata] || {
    iata,
    name: iata,
    name_pt: iata,
    logo: null,
    has_alliance: null,
  }
}

/**
 * Constrói deep link de busca pra cia + rota.
 * Sempre retorna URL: se a cia tem deep_link proprio, usa ele;
 * senao cai pra Google Flights filtrado pelo nome da cia (garante CTA clicavel).
 */
export function buildAirlineDeepLink(iata, origin, destination, date, returnDate) {
  const airline = AIRLINE_BY_IATA[iata]
  if (airline?.deep_link) {
    return airline.deep_link
      .replace('{origin}', origin)
      .replace('{destination}', destination)
      .replace('{date}', date)
      .replace('{return_date}', returnDate || date)
  }
  // Fallback generico: Google Flights com filtro por nome da cia.
  // Cobre cias retornadas por Travelpayouts/Amadeus que ainda nao estao no registry.
  const name = airline?.name || iata
  const q = returnDate
    ? `Flights ${name} ${origin} to ${destination} ${date} ${returnDate}`
    : `Flights ${name} ${origin} to ${destination} ${date}`
  return `https://www.google.com/travel/flights/search?q=${encodeURIComponent(q)}`
}
