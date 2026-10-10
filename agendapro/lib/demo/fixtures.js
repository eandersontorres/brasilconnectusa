// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — dados de exemplo (estado inicial do "servidor" em memória).
//
//   Ana Torres, brasileira em Boston (America/New_York). Tudo é calculado a partir
//   de HOJE no relógio do aparelho, com aleatório de semente fixa: abre igual toda
//   vez (bom pras capturas das lojas). Nomes, telefones (555-01xx) e e-mails
//   (@example.com) são fictícios.
//
//   vertical 'services' → Ana Torres Hair (cabeleireira)
//   vertical 'cleaning' → Ana Torres Cleaning (faxina e turnover de Airbnb)
//   plan: trial (Premium em teste, 9 dias) | starter | pro | premium | none
// ════════════════════════════════════════════════════════════════════════════
import { addDays, fold, keyOf, toMin, toWall, uid, resetIds, rng, weekdayOf, wallToReal } from './util.js'

export const DEMO_USER = { id: 'de000000-0000-4000-9000-000000000001', email: 'demo@agendapro.app' }
export const DEMO_PLANS = ['trial', 'starter', 'pro', 'premium', 'none']
const DAY = 86400e3

/** Imagem de exemplo (PNG: o Image do React Native não lê SVG). */
export const placeholderImage = (text, bg = '1F4D3F', fg = 'FAF7F0', size = '800x800') =>
  `https://placehold.co/${size}/${bg}/${fg}/png?text=${encodeURIComponent(text).replace(/%20/g, '+')}`

// ── Catálogo ────────────────────────────────────────────────────────────────
const SERVICES = {
  services: [
    { key: 'corte', name: 'Corte feminino', category: 'Corte', description: 'Corte com lavagem e finalização.', duration_min: 60, price_cents: 6500, deposit_cents: 0 },
    { key: 'escova', name: 'Escova modelada', category: 'Finalização', description: 'Escova com babyliss ou chapinha.', duration_min: 45, price_cents: 4500, deposit_cents: 0 },
    { key: 'raiz', name: 'Coloração (raiz)', category: 'Cor', description: 'Retoque de raiz com tinta sem amônia.', duration_min: 120, price_cents: 12000, deposit_cents: 3000 },
    { key: 'mechas', name: 'Mechas / balayage', category: 'Cor', description: 'Mechas iluminadas com tonalização. Inclui escova.', duration_min: 180, price_cents: 26000, deposit_cents: 6000 },
    { key: 'progressiva', name: 'Progressiva', category: 'Tratamento', description: 'Alisamento brasileiro com selagem. Dura de 3 a 4 meses.', duration_min: 180, price_cents: 28000, deposit_cents: 7000 },
    { key: 'hidratacao', name: 'Hidratação + escova', category: 'Tratamento', description: 'Máscara de tratamento e escova.', duration_min: 75, price_cents: 8500, deposit_cents: 0 },
  ],
  cleaning: [
    { key: 'padrao', name: 'Limpeza padrão', category: 'Casa', description: 'Casa de até 3 quartos: cozinha, banheiros, pó e chão.', duration_min: 180, price_cents: 16000, deposit_cents: 0 },
    { key: 'pesada', name: 'Limpeza pesada (deep clean)', category: 'Casa', description: 'Inclui forno, geladeira por dentro, rodapés e janelas.', duration_min: 300, price_cents: 28000, deposit_cents: 5000 },
    { key: 'mudanca', name: 'Mudança (move-in / move-out)', category: 'Casa', description: 'Casa vazia, pronta pra entrega das chaves.', duration_min: 360, price_cents: 35000, deposit_cents: 8000 },
    { key: 'apto', name: 'Apartamento ou studio', category: 'Casa', description: 'Até 1 quarto.', duration_min: 120, price_cents: 11000, deposit_cents: 0 },
    { key: 'escritorio', name: 'Escritório', category: 'Comercial', description: 'Escritório pequeno, fora do horário comercial.', duration_min: 150, price_cents: 14000, deposit_cents: 0 },
    { key: 'roupa', name: 'Passar roupa (por hora)', category: 'Extra', description: 'Mínimo de 1 hora.', duration_min: 60, price_cents: 3500, deposit_cents: 0 },
  ],
}
// Mais comuns aparecem mais (índices do catálogo)
const SERVICE_WEIGHTS = { services: [0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 5, 5], cleaning: [0, 0, 0, 0, 1, 1, 2, 3, 3, 4, 5] }

// Seg–sex com pausa pro almoço (cabeleireira) / corrido (faxina); sábado mais curto
const HOURS = {
  services: { week: [['09:00', '12:30'], ['13:30', '19:00']], sat: [['08:00', '16:00']] },
  cleaning: { week: [['08:00', '17:00']], sat: [['08:00', '14:00']] },
}
const STARTS = {
  services: ['08:00', '09:00', '09:30', '10:00', '10:30', '11:00', '13:30', '14:00', '14:30', '15:00', '16:00', '16:30', '17:00', '17:30'],
  cleaning: ['08:00', '08:30', '09:00', '09:30', '12:30', '13:00', '13:30'],
}

const STAFF = {
  services: [
    { name: 'Juliana Costa', color: '#6D28D9', role: 'profissional', members: [], whatsapp: '16175550178', email: 'juliana.costa@example.com' },
    { name: 'Camila Rocha', color: '#0E7490', role: 'profissional', members: [], whatsapp: '18575550186', email: 'camila.rocha@example.com' },
  ],
  cleaning: [
    { name: 'Equipe da Maria', color: '#B8943B', role: 'equipe', members: ['Maria Souza', 'Rosa Lima'], whatsapp: '16175550178', email: 'maria.souza@example.com' },
    { name: 'Equipe do Paulo', color: '#1B2845', role: 'equipe', members: ['Paulo Santos', 'Lucas Pereira'], whatsapp: '18575550186', email: 'paulo.santos@example.com' },
  ],
}

// kind: fixa (recorrência) | regular | sumida (última visita há `gone` dias) | nova (sem visita)
// bday: 'MM-DD', 'today' ou '+N' (daqui a N dias)
const CLIENTS = [
  { name: 'Patrícia Lima', lang: 'pt', phone: '6175550101', kind: 'fixa', bday: '03-14', tags: ['Fixa', 'Indicação'], addr: '41 Highland Ave, Apt 2', city: 'Somerville', zip: '02143',
    notes: ['Cabelo fino: escova com pouco calor. Gosta de café sem açúcar.', 'Prefere produtos sem cheiro forte.'], home: 'Portão lateral, código 2468. Cachorro dócil (Max).' },
  { name: 'Jennifer Walsh', lang: 'en', phone: '6175550102', kind: 'fixa', bday: '07-22', tags: ['Fixa'], addr: '18 Beacon St', city: 'Brookline', zip: '02446',
    notes: ['Sensitive scalp — use the gentle shampoo.', 'Two cats. Keep the basement door closed.'], home: 'Key under the blue pot by the back door.' },
  { name: 'Fernanda Oliveira', lang: 'pt', phone: '8575550103', kind: 'fixa', bday: 'today', tags: ['Fixa', 'VIP'], addr: '230 Broadway', city: 'Everett', zip: '02149',
    notes: ['Coloração 6.1 + 20 vol. Alergia a amônia.', 'Limpar o quarto do bebê com produto neutro.'], home: 'Apartamento 3B, interfone "Oliveira".' },
  { name: 'Mariana Santos', lang: 'pt', phone: '6175550104', kind: 'regular', bday: '11-02', tags: ['Instagram'], addr: '77 Elm St', city: 'Somerville', zip: '02144', notes: [null, null], home: null },
  { name: 'Ashley Johnson', lang: 'en', phone: '6175550105', kind: 'regular', bday: '05-30', tags: [], addr: '9 Commonwealth Ave', city: 'Boston', zip: '02116', notes: ['Loves the balayage, wants it subtle.', null], home: 'Doorman building, sign in at the front desk.' },
  { name: 'Luciana Pereira', lang: 'pt', phone: '7815550106', kind: 'regular', bday: '01-19', tags: ['Indicação'], addr: '15 Pleasant St', city: 'Malden', zip: '02148', notes: [null, null], home: null },
  { name: 'Emily Carter', lang: 'en', phone: '6175550107', kind: 'regular', bday: '09-05', tags: [], addr: '402 Mass Ave', city: 'Cambridge', zip: '02139', notes: [null, 'Allergic to bleach.'], home: null },
  { name: 'Carolina Alves', lang: 'pt', phone: '8575550108', kind: 'regular', bday: '12-24', tags: ['VIP'], addr: '61 Main St', city: 'Framingham', zip: '01702', notes: ['Sempre pede o mesmo tom de loiro (9.1).', null], home: 'Casa amarela, estacionar na rua.' },
  { name: 'Beatriz Souza', lang: 'pt', phone: '6175550109', kind: 'regular', bday: '04-08', tags: [], addr: '28 Hancock St', city: 'Quincy', zip: '02169', notes: [null, null], home: null },
  { name: 'Sarah Mitchell', lang: 'en', phone: '7815550110', kind: 'regular', bday: '08-17', tags: [], addr: '5 Winter St', city: 'Waltham', zip: '02451', notes: [null, null], home: 'Alarm code 1970.' },
  { name: 'Renata Gomes', lang: 'pt', phone: '6175550111', kind: 'sumida', gone: 62, bday: '06-11', tags: [], addr: '310 Medford St', city: 'Somerville', zip: '02145', notes: [null, null], home: null },
  { name: 'Jessica Brown', lang: 'en', phone: '6175550112', kind: 'sumida', gone: 75, bday: '02-03', tags: [], addr: '44 Center St', city: 'Newton', zip: '02458', notes: [null, null], home: null },
  { name: 'Aline Ribeiro', lang: 'pt', phone: '5085550113', kind: 'sumida', gone: 91, bday: '10-29', tags: ['Indicação'], addr: '12 Union St', city: 'Marlborough', zip: '01752', notes: [null, null], home: null },
  { name: 'Megan O\'Connor', lang: 'en', phone: '6175550114', kind: 'sumida', gone: 118, bday: '03-27', tags: [], addr: '87 Dorchester Ave', city: 'Boston', zip: '02127', notes: [null, null], home: null },
  { name: 'Tatiane Martins', lang: 'pt', phone: '8575550115', kind: 'regular', bday: '07-01', tags: [], addr: '19 Revere Beach Pkwy', city: 'Revere', zip: '02151', notes: [null, null], home: null },
  { name: 'Rachel Cohen', lang: 'en', phone: '6175550116', kind: 'regular', bday: '12-09', tags: [], addr: '3 Harvard St', city: 'Brookline', zip: '02445', notes: [null, null], home: null },
  { name: 'Vanessa Costa', lang: 'pt', phone: '7815550117', kind: 'regular', bday: '05-05', tags: [], addr: '50 Salem St', city: 'Medford', zip: '02155', notes: [null, null], home: null },
  { name: 'Lauren Davis', lang: 'en', phone: '6175550118', kind: 'regular', bday: '11-21', tags: [], addr: '120 Boylston St', city: 'Boston', zip: '02116', notes: [null, null], home: null },
  { name: 'Daniela Ferreira', lang: 'pt', phone: '8575550119', kind: 'regular', bday: '+3', tags: ['Instagram'], addr: '8 Ferry St', city: 'Everett', zip: '02149', notes: [null, null], home: null },
  { name: 'Amanda Rodrigues', lang: 'pt', phone: '6175550120', kind: 'regular', bday: '09-15', tags: [], addr: '66 Washington St', city: 'Somerville', zip: '02143', notes: [null, null], home: null },
  { name: 'Priscila Barbosa', lang: 'pt', phone: '7815550121', kind: 'nova', bday: '02-14', tags: ['Instagram'], addr: '25 Lowell St', city: 'Peabody', zip: '01960', notes: [null, null], home: null },
  { name: 'Nicole Thompson', lang: 'en', phone: '6175550122', kind: 'regular', bday: '06-28', tags: [], addr: '14 Prospect St', city: 'Cambridge', zip: '02139', notes: [null, null], home: null },
  { name: 'Gabriela Nunes', lang: 'pt', phone: '8575550123', kind: 'regular', bday: '08-08', tags: ['VIP'], addr: '90 Broadway', city: 'Chelsea', zip: '02150', notes: ['Indica muitas amigas. Mimar!', null], home: null },
  { name: 'Kelly Martinez', lang: 'es', phone: '6175550124', kind: 'regular', bday: '10-02', tags: [], addr: '33 Shirley Ave', city: 'Revere', zip: '02151', notes: [null, null], home: null },
  { name: 'Débora Almeida', lang: 'pt', phone: '5085550125', kind: 'nova', bday: '01-31', tags: [], addr: null, city: 'Framingham', zip: null, notes: [null, null], home: null },
]

const ascii = (s) => fold(s).replace(/[^a-z ]/g, '')
const emailOf = (name) => { const p = ascii(name).split(/\s+/); return `${p[0]}.${p[p.length - 1]}@example.com` }

function planFields(plan, nowMs) {
  const iso = (d) => new Date(nowMs + d * DAY).toISOString()
  if (plan === 'none') {
    return { plan: 'pro', plan_status: 'canceled', trial_ends_at: iso(-80), current_period_end: iso(-8), stripe_customer_id: 'cus_demo', stripe_subscription_id: null, created_at: iso(-94) }
  }
  if (plan === 'starter' || plan === 'pro' || plan === 'premium') {
    return { plan, plan_status: 'active', trial_ends_at: iso(-60), current_period_end: iso(18), stripe_customer_id: 'cus_demo', stripe_subscription_id: 'sub_demo', created_at: iso(-74) }
  }
  // trial: 14 dias com tudo do Premium, faltando 9 (sem cartão)
  return { plan: 'starter', plan_status: 'trialing', trial_ends_at: new Date(nowMs + 9 * DAY - 3600e3).toISOString(), current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null, created_at: iso(-5) }
}

/**
 * Estado inicial. today = 'YYYY-MM-DD' local; nowWall = agora em hora de parede.
 * → { user, provider, services, hours, blocked, staff, clients, appointments,
 *     recurring, feeds, reviews, expenses, mileage, waitlist, pushTokens }
 */
export function buildFixtures({ today, nowWall, plan = 'trial', vertical = 'services', now = new Date() }) {
  resetIds()
  const cleaning = vertical === 'cleaning'
  const V = cleaning ? 'cleaning' : 'services'
  const R = rng(cleaning ? 7713 : 20261009)
  const nowMs = now.getTime()
  const nowW = Date.parse(nowWall)
  const realAgo = (days) => new Date(nowMs - days * DAY).toISOString()
  const pid = uid()

  // ── Perfil ────────────────────────────────────────────────────────────────
  const pf = planFields(DEMO_PLANS.includes(plan) ? plan : 'trial', nowMs)
  const provider = {
    id: pid,
    name: cleaning ? 'Ana Torres Cleaning' : 'Ana Torres Hair',
    email: DEMO_USER.email,
    slug: cleaning ? 'ana-torres-cleaning' : 'ana-torres-hair',
    specialty: cleaning ? 'Faxineira' : 'Cabeleireira',
    bio: cleaning
      ? 'Limpeza residencial e turnover de Airbnb em Boston e região. Equipe de confiança, produtos inclusos e seguro. Falamos português, inglês e espanhol.'
      : 'Cabeleireira brasileira em Boston há 8 anos. Especialista em mechas, coloração e progressiva. Atendo em português, inglês e um pouquinho de espanhol!',
    city: 'Boston',
    state: 'MA',
    owner_user_id: DEMO_USER.id,
    ...pf,
    active: true,
    stripe_account_id: 'acct_demo',
    stripe_onboarded: true,
    stripe_charges_enabled: true,
    deposit_instructions: 'Zelle: (617) 555-0142 · Ana Torres. Mande o comprovante pelo WhatsApp.',
    vertical: V,
    timezone: 'America/New_York',
    app_settings: {
      monthly_goal_cents: cleaning ? 800000 : 600000,
      tax_reserve_pct: 25,
      default_language: 'pt',
      reactivation_days: 45,
      mileage_rate_cents: 70,
      week_starts_monday: false,
      notify_new_booking: true,
      notify_cancellation: true,
      notify_review: true,
    },
    whatsapp: '(617) 555-0142',
    instagram: cleaning ? 'anatorres.cleaning' : 'anatorres.hair',
    avatar_url: null,
    cover_color: '#1F4D3F',
    cover_url: null,
    video_url: null,
    gallery_urls: (cleaning ? ['Cozinha', 'Banheiro', 'Sala', 'Airbnb'] : ['Balayage', 'Corte', 'Progressiva', 'Coloração'])
      .map((t, i) => placeholderImage(t, ['1F4D3F', 'B8943B', '1B2845', '8C6D3D'][i])),
  }

  // ── Serviços, horário, equipe ─────────────────────────────────────────────
  const services = SERVICES[V].map((s, i) => {
    const { key, ...rest } = s
    return { id: uid(), provider_id: pid, ...rest, active: true, display_order: i, created_at: realAgo(60 - i), key }
  })
  const svc = (key) => services.find((s) => s.key === key)
  const weighted = () => services[R.pick(SERVICE_WEIGHTS[V])]

  const H = HOURS[V]
  const hours = []
  for (let d = 1; d <= 6; d++) {
    for (const [a, b] of d === 6 ? H.sat : H.week) hours.push({ id: uid(), day_of_week: d, start_time: a, end_time: b, active: true })
  }
  const windowsOf = (day) => {
    const wd = weekdayOf(day)
    // Domingo só aparece em hoje/amanhã (a demo nunca abre vazia): usa o horário da semana
    return wd === 6 ? H.sat : H.week
  }

  const staff = STAFF[V].map((s, i) => ({
    id: uid(), provider_id: pid, ...s, active: true, display_order: i + 1,
    day_link_token: `demo${i + 1}${cleaning ? 'cl' : 'sv'}Xk2v9Qp4`, created_at: realAgo(40 - i * 5),
  }))

  // ── Folgas: uma tarde e um dia inteiro (nunca hoje/amanhã) ────────────────
  const workday = (key) => (weekdayOf(key) === 0 ? addDays(key, 1) : key)
  const partialDay = workday(addDays(today, 3))
  const fullDay = workday(addDays(today, 10))
  const blocked = [
    { id: uid(), date: partialDay, full_day: false, start_time: '12:00', end_time: '15:00', reason: 'Reunião na escola do filho', created_at: realAgo(4) },
    { id: uid(), date: fullDay, full_day: true, start_time: null, end_time: null, reason: 'Viagem: casamento da prima em NY', created_at: realAgo(9) },
  ]
  const isBlocked = (day, s, e) => blocked.some((b) => b.date === day && (b.full_day || (s < toMin(b.end_time) && e > toMin(b.start_time))))

  // ── Clientes ──────────────────────────────────────────────────────────────
  const clients = CLIENTS.map((c, i) => {
    let md = c.bday
    if (md === 'today') md = today.slice(5)
    else if (/^\+\d+$/.test(md)) md = addDays(today, Number(md.slice(1))).slice(5)
    if (md === '02-29') md = '02-28'
    return {
      id: uid(), provider_id: pid, name: c.name, whatsapp: '+1' + c.phone, email: emailOf(c.name),
      language: c.lang, birthday_md: md, tags: c.tags,
      address_line: c.addr, city: c.city, state: 'MA', zip: c.zip,
      home_notes: cleaning ? c.home : null,
      notes: c.notes[cleaning ? 1 : 0] || null,
      total_visits: 0, total_spent_cents: 0, first_visit_at: null, last_visit_at: null,
      archived: false,
      created_at: realAgo(c.kind === 'nova' ? 3 + i % 4 : 140 - i * 3),
      updated_at: null,
      _kind: c.kind, _gone: c.gone || 0,
    }
  })
  const client = (first) => clients.find((c) => c.name.startsWith(first))
  const regulars = clients.filter((c) => c._kind === 'regular')

  // ── Agenda ────────────────────────────────────────────────────────────────
  const appointments = []
  const occ = {}                                  // 'dia|recurso' → [[início, fim]] em minutos
  const resOf = (st) => (st ? st.id : 'ana')
  const fits = (day, st, time, dur, { ignoreHours = false } = {}) => {
    const s = toMin(time)
    const e = s + dur
    if (!ignoreHours && !windowsOf(day).some(([a, b]) => s >= toMin(a) && e <= toMin(b))) return false
    if (isBlocked(day, s, e)) return false
    return !(occ[day + '|' + resOf(st)] || []).some(([a, b]) => s < b && a < e)
  }
  const take = (day, st, time, dur) => {
    const k = day + '|' + resOf(st)
    if (!occ[k]) occ[k] = []
    occ[k].push([toMin(time), toMin(time) + dur])
  }

  function addApt({ day, time, service = null, cl = null, st = null, source = 'online', rule = null, feed = null, notes = null, status = null, deposit = null, script = false }) {
    const dur = feed ? feed.duration_min : (rule ? rule.duration_min : service?.duration_min || 60)
    const start = toWall(day, time)
    take(day, st, time, dur)
    const created = Math.min(nowMs - 3600e3, Date.parse(wallToReal(start)) - R.int(2, 14) * DAY)
    const a = {
      id: uid(), provider_id: pid, scheduled_for: start, duration_min: dur, status: 'confirmed',
      client_id: cl?.id || null, client_name: feed ? feed.label : (cl?.name || 'Cliente'),
      client_whatsapp: cl?.whatsapp || null, client_email: cl?.email || null, client_notes: notes,
      service_id: service?.id || null, service_label: null,
      total_cents: feed ? feed.price_cents : (rule ? rule.price_cents : service?.price_cents || 0),
      deposit_cents: 0, deposit_paid: false, payment_method: null,
      paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null, internal_notes: null,
      source: feed ? 'ical' : source, staff_id: st?.id || null, recurring_id: rule?.id || null,
      occurrence_date: rule ? day : null, review_requested: false,
      external_uid: feed ? `demo-${day}-${feed.id.slice(-4)}@${feed.source}.com` : null,
      ical_feed_id: feed?.id || null, ical_next_checkin: null,
      created_at: new Date(created).toISOString(), confirmed_at: new Date(created).toISOString(),
      completed_at: null, canceled_at: null, cancel_reason: null,
      _status: status, _deposit: deposit, _script: script,
    }
    appointments.push(a)
    return a
  }

  /** Tenta o horário pedido; não cabe → o próximo da lista que couber. */
  function placeNear(day, pref, dur, st, opts) {
    const list = STARTS[V].filter((t) => t >= pref).concat(STARTS[V].filter((t) => t < pref))
    return list.find((t) => fits(day, st, t, dur, opts)) || null
  }

  // Clientes fixas (3 recorrências), geradas de 45 dias atrás até as próximas 6 semanas
  const RULES = cleaning
    ? [
        { who: 'Patrícia', svc: 'padrao', freq: 'weekly', dow: 1, time: '09:00', staff: 0, notes: 'Toda segunda. Chave com o porteiro.' },
        { who: 'Jennifer', svc: 'padrao', freq: 'biweekly', dow: 4, time: '13:00', staff: 1, notes: null },
        { who: 'Fernanda', svc: 'pesada', freq: 'every4weeks', dow: 3, time: '08:30', staff: null, notes: 'Uma vez por mês: limpeza pesada.' },
      ]
    : [
        { who: 'Patrícia', svc: 'escova', freq: 'weekly', dow: 2, time: '10:00', staff: null, notes: 'Escova toda terça antes do trabalho.' },
        { who: 'Jennifer', svc: 'hidratacao', freq: 'biweekly', dow: 5, time: '14:00', staff: 1, notes: null },
        { who: 'Fernanda', svc: 'raiz', freq: 'every4weeks', dow: 6, time: '09:00', staff: null, notes: 'Raiz a cada 4 semanas. Tinta 6.1.' },
      ]
  const STEP = { weekly: 7, biweekly: 14, every3weeks: 21, every4weeks: 28 }
  const recurring = RULES.map((r, i) => {
    const s = svc(r.svc)
    const back = (weekdayOf(addDays(today, -45)) - r.dow + 7) % 7
    const anchor = addDays(addDays(today, -45), (7 - back) % 7)
    return {
      id: uid(), provider_id: pid, client_id: client(r.who).id, service_id: s.id,
      staff_id: r.staff == null ? null : staff[r.staff].id,
      frequency: r.freq, day_of_week: r.dow, start_time: r.time, duration_min: s.duration_min, price_cents: s.price_cents,
      anchor_date: anchor, end_date: null, skip_dates: [], active: true, notes: r.notes,
      generated_until: addDays(today, 42), created_at: realAgo(50 - i), updated_at: null,
    }
  })
  // Patrícia viaja daqui a ~2 semanas: essa data foi pulada
  const pat = recurring[0]
  for (let d = pat.anchor_date; d <= addDays(today, 42); d = addDays(d, STEP[pat.frequency])) {
    if (d >= addDays(today, 10)) { pat.skip_dates = [d]; break }
  }
  for (const rule of recurring) {
    const s = services.find((x) => x.id === rule.service_id)
    const st = staff.find((x) => x.id === rule.staff_id) || null
    const cl = clients.find((x) => x.id === rule.client_id)
    for (let d = rule.anchor_date; d <= addDays(today, 42); d = addDays(d, STEP[rule.frequency])) {
      if (rule.skip_dates.includes(d)) continue
      if (!fits(d, st, rule.start_time, rule.duration_min, { ignoreHours: true })) continue
      addApt({ day: d, time: rule.start_time, service: s, cl, st, source: 'recurring', rule })
    }
  }

  // Turnover: 2 casas (uma do Airbnb). Limpezas na agenda só na versão faxina.
  const feeds = [
    { label: 'Apartamento Back Bay', source: 'airbnb', url: 'https://www.airbnb.com/calendar/ical/48213377.ics?s=9f2c41d07be6a3e8', checkout_time: '11:00', duration_min: 180, price_cents: 12000,
      notes: 'Chave no cofre da porta (código 4821). Trocar roupa de cama: armário do corredor.', reservations: [-20, -9, -2, 2, 6, 13, 19] },
    { label: 'Casa em Cape Cod', source: 'vrbo', url: 'https://www.vrbo.com/icalendar/7c1e5b2a90d84f6e.ics?nonTentative', checkout_time: '10:00', duration_min: 240, price_cents: 18000,
      notes: 'Levar o aspirador grande. Lixo sai na terça.', reservations: [-15, 4, 11] },
  ].map((f, i) => ({
    id: uid(), provider_id: pid, label: f.label, url: f.url, source: f.source, checkout_time: f.checkout_time,
    duration_min: f.duration_min, price_cents: f.price_cents, notes: f.notes, active: true,
    last_synced_at: new Date(nowMs - (35 + i * 12) * 60e3).toISOString(), last_status: 'ok', last_error: null,
    reservations_count: f.reservations.filter((d) => d >= 0).length, created_at: realAgo(30 - i * 6), _res: f.reservations,
  }))
  if (cleaning) {
    for (const f of feeds) {
      const days = f._res.map((n) => addDays(today, n))
      days.forEach((d, i) => {
        const time = f.checkout_time
        if (!fits(d, null, time, f.duration_min, { ignoreHours: true })) return
        const a = addApt({ day: d, time, feed: f })
        a.ical_next_checkin = days[i + 1] || null
      })
    }
  }

  // Histórico das sumidas (última visita há 60+ dias, nada marcado)
  for (const c of clients.filter((x) => x._kind === 'sumida')) {
    for (const back of [c._gone, c._gone + 35, c._gone + 70]) {
      const d = workday(addDays(today, -back))
      const s = cleaning ? svc('padrao') : services[R.pick([0, 1, 2, 5])]
      const t = placeNear(d, '10:00', s.duration_min, null)
      if (t) addApt({ day: d, time: t, service: s, cl: c, source: R.chance(0.5) ? 'online' : 'manual' })
    }
  }

  // Hoje e amanhã cheios (roteiro fixo, fica bonito na captura)
  const T = cleaning
    ? {
        today: [['08:30', 'padrao', 'Mariana', 0], ['09:00', 'apto', 'Ashley', null, 'paid'], ['12:30', 'pesada', 'Carolina', 1, 'paid'], ['13:00', 'escritorio', 'Emily', null], ['15:30', 'roupa', 'Beatriz', null]],
        tomorrow: [['08:00', 'mudanca', 'Sarah', null, 'pending'], ['09:00', 'padrao', 'Priscila', 0], ['13:00', 'apto', 'Lauren', 1], ['13:30', 'padrao', 'Luciana', 0]],
      }
    : {
        today: [['09:00', 'corte', 'Mariana', null], ['10:30', 'raiz', 'Ashley', null, 'paid'], ['13:30', 'mechas', 'Carolina', 0, 'paid'], ['14:00', 'escova', 'Emily', null], ['15:30', 'progressiva', 'Gabriela', null, 'pending']],
        tomorrow: [['09:30', 'escova', 'Sarah', null], ['11:00', 'corte', 'Priscila', null], ['14:00', 'mechas', 'Luciana', null, 'pending'], ['15:00', 'corte', 'Lauren', 1]],
      }
  const NOTES = cleaning
    ? { Priscila: 'Primeira vez! Casa de 2 quartos, tenho um gato.', Sarah: 'Moving out on Friday, need it spotless for the landlord.' }
    : { Priscila: 'Primeira vez! Quero tirar uns 10 cm e repicar.', Luciana: 'Quero um loiro mais natural, mando foto de referência.' }
  for (const [offset, list] of [[0, T.today], [1, T.tomorrow]]) {
    const day = addDays(today, offset)
    for (const [pref, sk, who, si, dep] of list) {
      const s = svc(sk)
      const st = si == null ? null : staff[si]
      const t = placeNear(day, pref, s.duration_min, st, { ignoreHours: true })
      if (!t) continue
      addApt({ day, time: t, service: s, cl: client(who), st, source: R.chance(0.6) ? 'online' : 'manual', notes: NOTES[who] || null, deposit: dep || null, script: true })
    }
  }

  // Poucos dias antes, roteiro fixo (avaliações e "esqueceu de marcar" saem daqui)
  const PAST = cleaning
    ? [[-1, '09:00', 'pesada', 'Tatiane'], [-2, '13:00', 'padrao', 'Vanessa', 'unmarked'], [-3, '08:30', 'apto', 'Ashley'], [-12, '09:00', 'padrao', 'Mariana'], [-6, '13:30', 'escritorio', 'Rachel']]
    : [[-1, '11:00', 'progressiva', 'Tatiane'], [-2, '15:00', 'corte', 'Vanessa', 'unmarked'], [-3, '10:00', 'mechas', 'Ashley'], [-12, '14:00', 'raiz', 'Mariana'], [-6, '16:30', 'hidratacao', 'Rachel']]
  for (const [off, pref, sk, who, flag] of PAST) {
    const day = workday(addDays(today, off)) <= addDays(today, -1) ? workday(addDays(today, off)) : addDays(today, off - 1)
    const s = svc(sk)
    const t = placeNear(day, pref, s.duration_min, null)
    if (t) addApt({ day, time: t, service: s, cl: client(who), source: 'manual', status: flag === 'unmarked' ? 'unmarked' : null, script: true })
  }

  // O resto: espalhado de -45 a +21 dias (menos domingos e folgas)
  for (let off = -45; off <= 21; off++) {
    if (off === 0 || off === 1) continue
    const day = addDays(today, off)
    if (weekdayOf(day) === 0) continue
    const n = off < 0 ? R.pick([0, 0, 1, 1, 1]) : R.pick([0, 0, 0, 1, 1])
    for (let k = 0; k < n; k++) {
      const s = weighted()
      const st = staff.length && R.chance(cleaning ? 0.45 : 0.25) ? R.pick(staff) : null
      const t = placeNear(day, R.pick(STARTS[V]), s.duration_min, st)
      if (!t) continue
      addApt({ day, time: t, service: s, cl: R.pick(regulars), st, source: R.chance(0.55) ? 'online' : 'manual' })
    }
  }

  // ── Status e pagamentos conforme o relógio de agora ───────────────────────
  const METHODS = ['zelle', 'zelle', 'zelle', 'cash', 'cash', 'card', 'card', 'venmo']
  const endMs = (a) => Date.parse(a.scheduled_for) + a.duration_min * 60e3
  const pay = (a) => {
    a.status = 'completed'
    a.completed_at = wallToReal(new Date(endMs(a)).toISOString())
    if (a.deposit_cents > 0 && !a.deposit_paid) { a.deposit_paid = true; a.payment_method = 'zelle' }
    a.paid_cents = a.total_cents
    a.tip_cents = a.source === 'ical' ? 0
      : cleaning ? (R.chance(0.35) ? R.int(1, 3) * 1000 : 0)
      : (R.chance(0.6) ? Math.max(500, Math.round((a.total_cents * R.int(10, 20)) / 100 / 500) * 500) : 0)
    a.paid_method = a.source === 'ical' ? 'zelle' : R.pick(METHODS)
    a.paid_at = a.completed_at
  }
  const SVC_DEPOSIT = (a) => services.find((s) => s.id === a.service_id)?.deposit_cents || 0
  const CANCEL = ['Cliente pediu pra remarcar', 'Imprevisto com os filhos', 'Ficou doente', 'Viajou de última hora']

  let futureCanceled = 0
  for (const a of appointments.sort((x, y) => x.scheduled_for.localeCompare(y.scheduled_for))) {
    const dep = SVC_DEPOSIT(a)
    const past = endMs(a) <= nowW
    if (a._deposit === 'paid' || a._deposit === 'pending') a.deposit_cents = dep || Math.round(a.total_cents * 0.25 / 500) * 500
    if (a._deposit === 'paid') { a.deposit_paid = true; a.payment_method = R.pick(['zelle', 'card']) }

    if (past) {
      if (a._status === 'unmarked') continue                 // confirmado que já passou: "esqueceu de marcar"
      if (a._script) { pay(a); continue }                    // roteiro fixo: sempre realizado
      if (a.recurring_id || a.source === 'ical') {
        if (R.chance(0.06) && a.recurring_id) { a.status = 'canceled'; a.canceled_at = wallToReal(a.scheduled_for, -1440); a.cancel_reason = 'Cliente viajou' }
        else pay(a)
        continue
      }
      const r = R.next()
      if (r < 0.06) {
        a.status = 'no_show'
        if (dep) { a.deposit_cents = dep; a.deposit_paid = true; a.payment_method = 'zelle' }
      } else if (r < 0.14) {
        a.status = 'canceled'
        a.canceled_at = wallToReal(a.scheduled_for, -R.int(3, 48) * 60)
        a.cancel_reason = R.pick(CANCEL)
      } else {
        if (dep && a.deposit_cents === 0 && R.chance(0.5)) a.deposit_cents = dep
        pay(a)
        if (R.chance(0.08)) { a.paid_cents = null; a.tip_cents = 0; a.paid_method = null; a.paid_at = null }   // realizado sem registrar pagamento
      }
      continue
    }

    // Daqui pra frente
    if (a._deposit === 'pending') { a.status = 'pending'; a.confirmed_at = null; continue }
    if (a.recurring_id || a.source === 'ical' || a._deposit) continue
    if (!futureCanceled && keyOf(a.scheduled_for) > addDays(today, 3) && keyOf(a.scheduled_for) <= addDays(today, 12)) {
      futureCanceled++
      a.status = 'canceled'
      a.canceled_at = realAgo(1)
      a.cancel_reason = 'Cliente pediu pra remarcar'
      continue
    }
    if (dep) {
      a.deposit_cents = dep
      if (R.chance(0.3)) { a.status = 'pending'; a.confirmed_at = null }
      else { a.deposit_paid = true; a.payment_method = R.pick(['zelle', 'card']) }
    }
  }
  // Passou hoje e ninguém marcou: o mais recente de hoje fica "Confirmado" (aparece no Hoje)
  const todayPast = appointments.filter((a) => keyOf(a.scheduled_for) === today && a.status === 'completed' && !a.recurring_id && a.source !== 'ical')
  if (todayPast.length > 1) {
    const a = todayPast[todayPast.length - 1]
    Object.assign(a, { status: 'confirmed', completed_at: null, paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null })
  }
  for (const a of appointments) { delete a._status; delete a._deposit; delete a._script }

  // ── Avaliações (4) ────────────────────────────────────────────────────────
  const REVIEWS = cleaning
    ? [
        ['Patrícia', 5, 'A equipe da Ana é maravilhosa! Casa impecável e super pontuais.', 'Obrigada, Patrícia! É um prazer cuidar da sua casa.'],
        ['Jennifer', 5, 'Best cleaning service in Brookline. Reliable, friendly and thorough!', null],
        ['Mariana', 4, 'Ficou tudo muito limpo. Só atrasaram uns 15 minutinhos, mas valeu a pena.', 'Obrigada pelo carinho, Mariana! Vamos caprichar no horário da próxima.'],
        ['Ashley', 5, 'They left my apartment spotless. Worth every penny!', null],
      ]
    : [
        ['Patrícia', 5, 'A Ana é maravilhosa! Meu cabelo nunca ficou tão bonito. Super pontual e caprichosa.', 'Obrigada, Patrícia! Até terça.'],
        ['Jennifer', 5, 'Best blowout in Boston. Ana is so sweet and professional, highly recommend!', null],
        ['Mariana', 4, 'Amei o resultado da coloração. Só atrasou uns 10 minutinhos, mas valeu a pena.', 'Obrigada pelo carinho, Mariana! Vou caprichar no horário da próxima.'],
        ['Ashley', 5, 'Ana did an amazing balayage. Worth every penny!', null],
      ]
  const reviews = []
  for (const [who, rating, comment, response] of REVIEWS) {
    const c = client(who)
    const a = appointments.filter((x) => x.client_id === c.id && x.status === 'completed').pop()
    if (!a) continue
    a.review_requested = true
    const atMs = Math.min(nowMs - 20 * 60e3, Date.parse(wallToReal(new Date(endMs(a)).toISOString(), R.int(60, 600))))
    reviews.push({
      id: uid(), provider_id: pid, appointment_id: a.id, client_name: c.name, rating, comment,
      provider_response: response, responded_at: response ? new Date(Math.min(nowMs - 60e3, atMs + 3 * 3600e3)).toISOString() : null,
      is_published: true, created_at: new Date(atMs).toISOString(),
    })
  }

  // ── Finanças: despesas do mês (e do anterior) e milhagem ──────────────────
  const month = today.slice(0, 7)
  const dayOfMonth = Number(today.slice(8, 10))
  const prevMonth = addDays(month + '-01', -1).slice(0, 7)
  const inMonth = (d) => `${month}-${String(Math.max(1, Math.min(d, dayOfMonth))).padStart(2, '0')}`
  const EXP = cleaning
    ? [[1, 'seguro', 'Seguro de responsabilidade (liability)', 8900, 'card'], [2, 'produtos', 'Costco: produtos de limpeza', 14280, 'card'], [4, 'equipamento', 'Aspirador Shark', 24999, 'card'],
       [5, 'celular', 'T-Mobile', 6500, 'card'], [6, 'gasolina', 'Posto Shell', 5800, 'debit'], [8, 'alimentacao', 'Almoço da equipe', 3850, 'cash'], [9, 'gasolina', 'Posto Mobil', 4720, 'debit']]
    : [[1, 'aluguel', 'Aluguel da cadeira no salão (booth rent)', 60000, 'zelle'], [2, 'produtos', 'Sally Beauty: tintas e oxidante', 18640, 'card'], [3, 'taxas', 'Taxa da maquininha', 1230, 'card'],
       [5, 'celular', 'T-Mobile', 6500, 'card'], [7, 'marketing', 'Impulsionamento no Instagram', 4000, 'card'], [8, 'gasolina', 'Posto Shell', 5200, 'debit']]
  const PREV = cleaning
    ? [[1, 'seguro', 'Seguro de responsabilidade (liability)', 8900, 'card'], [3, 'produtos', 'Costco: produtos de limpeza', 12650, 'card'], [5, 'celular', 'T-Mobile', 6500, 'card'], [12, 'gasolina', 'Posto Shell', 6100, 'debit']]
    : [[1, 'aluguel', 'Aluguel da cadeira no salão (booth rent)', 60000, 'zelle'], [4, 'produtos', 'Sally Beauty: tintas e oxidante', 14230, 'card'], [5, 'celular', 'T-Mobile', 6500, 'card'], [14, 'gasolina', 'Posto Shell', 4800, 'debit']]
  const expenses = [
    ...EXP.map(([d, category, description, amount_cents, payment_method]) => ({ spent_on: inMonth(d), category, description, amount_cents, payment_method })),
    ...PREV.map(([d, category, description, amount_cents, payment_method]) => ({ spent_on: `${prevMonth}-${String(d).padStart(2, '0')}`, category, description, amount_cents, payment_method })),
  ].map((e) => ({ id: uid(), ...e, receipt_url: null, created_at: new Date(Math.min(nowMs, Date.parse(wallToReal(e.spent_on + 'T18:00:00.000Z')))).toISOString(), updated_at: null }))

  const doneThisMonth = appointments.filter((a) => a.status === 'completed' && a.scheduled_for.slice(0, 7) === month && a.client_id)
  const TRIPS = cleaning
    ? [[6.4, 'Limpeza na casa da cliente'], [11.2, 'Limpeza na casa da cliente'], [8.9, 'Limpeza na casa da cliente'], [3.1, 'Compra de produtos (Costco)'], [14.7, 'Limpeza na casa da cliente'], [9.6, 'Limpeza na casa da cliente']]
    : [[6.2, 'Compra de produtos (Sally Beauty)'], [9.8, 'Atendimento em domicílio'], [22.5, 'Curso de colorimetria em Framingham']]
  const mileage = TRIPS.map(([miles, purpose], i) => {
    const linked = purpose.startsWith('Limpeza') || purpose.startsWith('Atendimento') ? doneThisMonth[i] : null
    const cl = linked ? clients.find((c) => c.id === linked.client_id) : null
    return {
      id: uid(), driven_on: linked ? keyOf(linked.scheduled_for) : inMonth(2 + i * 3), miles, purpose,
      from_label: 'Casa (Boston)', to_label: cl ? [cl.address_line, cl.city].filter(Boolean).join(', ') : purpose.includes('Framingham') ? 'Framingham, MA' : 'Somerville, MA',
      appointment_id: linked?.id || null, created_at: realAgo(Math.max(0, dayOfMonth - (2 + i * 3))),
    }
  }).filter((t) => t.driven_on <= today)

  // ── Lista de espera (3) ───────────────────────────────────────────────────
  const waitlist = [
    { client_id: client('Daniela').id, client_name: client('Daniela').name, client_whatsapp: client('Daniela').whatsapp, service_id: services[cleaning ? 1 : 3].id,
      preferred_days: [5, 6], preferred_period: 'manha', date_from: null, date_to: addDays(today, 30), notes: 'Pode ser em cima da hora, mora perto.', ago: 6 },
    { client_id: null, client_name: 'Larissa Mendes', client_whatsapp: '+17815550131', service_id: services[0].id,
      preferred_days: [], preferred_period: 'tarde', date_from: null, date_to: null, notes: 'Indicação da Gabriela.', ago: 3 },
    { client_id: client('Nicole').id, client_name: client('Nicole').name, client_whatsapp: client('Nicole').whatsapp, service_id: services[cleaning ? 0 : 5].id,
      preferred_days: [1, 2, 3], preferred_period: 'qualquer', date_from: addDays(today, 1), date_to: addDays(today, 21), notes: null, ago: 1 },
  ].map(({ ago, ...w }) => ({ id: uid(), provider_id: pid, ...w, status: 'waiting', notified_at: null, created_at: realAgo(ago), updated_at: null }))

  for (const c of clients) { delete c._kind; delete c._gone }
  for (const s of services) delete s.key
  for (const f of feeds) delete f._res

  return {
    user: { ...DEMO_USER },
    provider,
    services,
    hours,
    blocked,
    staff,
    clients,
    appointments: appointments.sort((x, y) => x.scheduled_for.localeCompare(y.scheduled_for)),
    recurring,
    feeds,
    reviews,
    expenses,
    mileage,
    waitlist,
    pushTokens: [],
  }
}
