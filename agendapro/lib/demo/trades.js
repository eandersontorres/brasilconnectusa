// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — dados de exemplo do WorkPro (vertical 'trades').
//
//   Silva Remodeling: Carlos Silva, construção e reforma em Framingham, MA
//   (America/New_York), com a "Equipe do João" e o ajudante Rafael. Agenda com
//   visitas técnicas e obras (agendamentos sem service_id, com service_label),
//   clientes americanas, brasileiras e uma hispânica, despesas de obra e milhagem.
//   Orçamentos, faturas, tabela de preços e pedidos: lib/demo/docFixtures.js.
//   Datas relativas a HOJE, aleatório de semente fixa (abre igual toda vez).
//   Telefones 555-01xx e e-mails @example.com são fictícios.
// ════════════════════════════════════════════════════════════════════════════
import { addDays, fold, keyOf, toWall, uid, rng, weekdayOf, wallToReal } from './util.js'
import { DAY, DEMO_USER, placeholderImage, planFields } from './common.js'

// key, nome, idioma, telefone, endereço, cidade, ZIP, observação da casa/obra, notas, tags, cadastrada há N dias
const CLIENTS = [
  ['jennifer', 'Jennifer Walsh', 'en', '5085550101', '42 Oak Hill Rd', 'Natick', '01760', 'Park in the driveway. Dog (Buddy) stays inside during the work.', 'Prefers updates by text. Works from home.', ['Indicação'], 52],
  ['michael', 'Michael Brennan', 'en', '9785550102', '15 Pine Ridge Dr', 'Sudbury', '01776', 'Backyard access through the side gate.', null, [], 20],
  ['sarah', 'Sarah Mitchell', 'en', '7815550103', '88 Grove St', 'Wellesley', '02482', null, 'Very detail-oriented. Asked for daily cleanup at the end of each day.', ['VIP'], 40],
  ['david', 'David Kim', 'en', '5085550104', '7 Cedar Ln', 'Hopkinton', '01748', 'Garage code 4417.', 'Fatura vencida: já mandei lembrete.', [], 30],
  ['emily', 'Emily Carter', 'en', '5085550105', '230 Union Ave', 'Framingham', '01702', 'Apartment 2B. Ring the bell twice.', null, [], 48],
  ['robert', 'Robert Johnson', 'en', '5085550106', '19 Maple Ave', 'Southborough', '01772', null, 'Pediu pra rever o orçamento da cozinha na primavera.', [], 56],
  ['lauren', 'Lauren Davis', 'en', '5085550107', '64 Pleasant St', 'Ashland', '01721', null, null, [], 25],
  ['kevin', 'Kevin O\'Brien', 'en', '7815550108', '12 Summer St', 'Needham', '02492', 'Basement entrance on the left side of the house.', null, [], 18],
  ['patricia', 'Patrícia Lima', 'pt', '5085550109', '41 Highland St', 'Marlborough', '01752', 'Entrada pelo porão, pela garagem.', 'Indicou a Juliana.', ['Indicação'], 14],
  ['fernanda', 'Fernanda Oliveira', 'pt', '5085550110', '230 Hollis St', 'Framingham', '01702', null, 'Quer a cozinha pronta antes do Natal.', ['VIP'], 12],
  ['marcos', 'Marcos Souza', 'pt', '5085550111', '9 Concord St', 'Framingham', '01702', null, null, [], 8],
  ['juliana', 'Juliana Costa', 'pt', '5085550112', '77 Main St', 'Milford', '01757', null, 'Veio pelo pedido de orçamento da página.', ['Página'], 6],
  ['carmen', 'Carmen Rodríguez', 'es', '5085550113', '55 Waverly St', 'Framingham', '01702', null, null, [], 9],
  ['nicole', 'Nicole Thompson', 'en', '5085550114', '18 Elm St', 'Natick', '01760', null, 'Veio pelo pedido de orçamento da página.', ['Página'], 3],
  ['luis', 'Luis Hernández', 'es', '5085550115', '102 Concord St', 'Framingham', '01702', null, 'Veio pelo pedido de orçamento da página.', ['Página'], 5],
  ['renata', 'Renata Gomes', 'pt', '9785550116', '310 Main St', 'Hudson', '01749', 'Cachorro bravo no quintal: avisar antes de entrar.', null, [], 70],
]

const SERVICES = [
  { name: 'Visita técnica para orçamento', category: 'Visita', description: 'Vou até a sua casa, meço e mando o orçamento em até 48 horas. Sem compromisso.', duration_min: 60, price_cents: 0, deposit_cents: 0 },
  { name: 'Hora de handyman', category: 'Reparos', description: 'Pequenos reparos: portas, prateleiras, luminárias, drywall. Mínimo de 2 horas.', duration_min: 120, price_cents: 8500, deposit_cents: 0 },
  { name: 'Diária da equipe (2 pessoas)', category: 'Obra', description: 'Equipe de 2 pessoas por dia de trabalho (8 horas). Material à parte.', duration_min: 480, price_cents: 96000, deposit_cents: 0 },
]

const STAFF = [
  { name: 'Equipe do João', color: '#B8943B', role: 'equipe', members: ['João Pereira', 'Diego Ramos'], whatsapp: '15085550178', email: 'joao.pereira@example.com' },
  { name: 'Rafael Lima', color: '#0E7490', role: 'profissional', members: [], whatsapp: '15085550186', email: 'rafael.lima@example.com' },
]

const ascii = (s) => fold(s).replace(/[^a-z ]/g, '')
const emailOf = (name) => { const p = ascii(name).split(/\s+/); return `${p[0]}.${p[p.length - 1]}@example.com` }

/** Estado inicial do WorkPro (mesmo formato de buildFixtures). */
export function buildTradesFixtures({ today, nowWall, plan = 'trial', now = new Date() }) {
  const R = rng(5082026)
  const nowMs = now.getTime()
  const nowW = Date.parse(nowWall)
  const realAgo = (days) => new Date(nowMs - days * DAY).toISOString()
  const pid = uid()

  // ── Perfil ────────────────────────────────────────────────────────────────
  const provider = {
    id: pid,
    name: 'Silva Remodeling',
    email: DEMO_USER.email,
    slug: 'silva-remodeling',
    specialty: 'Construção e reforma',
    bio: 'Carlos Silva, brasileiro de Minas, há 12 anos reformando casas em MetroWest. Banheiros, cozinhas, decks, pisos e pintura, com equipe própria, licença e seguro. Orçamento sem compromisso. We speak English, Português y Español.',
    city: 'Framingham',
    state: 'MA',
    owner_user_id: DEMO_USER.id,
    ...planFields(plan, nowMs),
    active: true,
    stripe_account_id: 'acct_demo',
    stripe_onboarded: true,
    stripe_charges_enabled: true,
    deposit_instructions: 'Zelle: (508) 555-0142 · Silva Remodeling LLC. Cheque nominal a Silva Remodeling LLC.',
    vertical: 'trades',
    timezone: 'America/New_York',
    app_settings: {
      monthly_goal_cents: 2500000,
      tax_reserve_pct: 25,
      default_language: 'pt',
      reactivation_days: 90,
      mileage_rate_cents: 70,
      week_starts_monday: true,
      notify_new_booking: true,
      notify_cancellation: true,
      notify_review: true,
      notify_documents: true,
      business: {
        legal_name: 'Silva Remodeling LLC',
        license_no: 'CSL-123456',
        address_line: '120 Waverly St',
        city: 'Framingham',
        state: 'MA',
        zip: '01702',
        phone: '(508) 555-0142',
        email: 'carlos.silva@example.com',
        website: 'https://silvaremodeling.example.com',
        insurance: 'General liability US$ 1M · apólice GL-778201',
      },
      doc_defaults: {
        tax_rate_bps: 625,
        due_days: 15,
        quote_valid_days: 30,
        deposit_pct: 30,
        language: 'en',
        terms: 'All labor is guaranteed for 1 year from completion. Materials carry the manufacturer warranty. Any change to the scope of work will be quoted separately before it is done. A 30% deposit is required to schedule the work. Massachusetts CSL-123456 · HIC #198765.',
        notes: 'Thank you for choosing Silva Remodeling!',
        payment_instructions: 'Zelle: (508) 555-0142 (Silva Remodeling LLC). Checks payable to Silva Remodeling LLC.',
      },
    },
    whatsapp: '(508) 555-0142',
    instagram: 'silvaremodeling',
    avatar_url: null,
    cover_color: '#1B2845',
    cover_url: null,
    video_url: null,
    gallery_urls: ['Banheiro', 'Deck', 'Cozinha', 'Piso'].map((t, i) => placeholderImage(t, ['1B2845', 'B8943B', '1F4D3F', '8C6D3D'][i])),
  }

  // ── Serviços (página pública), horário, equipe, folgas ────────────────────
  const services = SERVICES.map((s, i) => ({ id: uid(), provider_id: pid, ...s, active: true, display_order: i, created_at: realAgo(80 - i) }))
  const hours = []
  for (let d = 1; d <= 6; d++) {
    const [a, b] = d === 6 ? ['08:00', '13:00'] : ['07:00', '17:00']
    hours.push({ id: uid(), day_of_week: d, start_time: a, end_time: b, active: true })
  }
  const staff = STAFF.map((s, i) => ({
    id: uid(), provider_id: pid, ...s, active: true, display_order: i + 1,
    day_link_token: `demo${i + 1}trXk2v9Qp4`, created_at: realAgo(60 - i * 10),
  }))
  const [crew, rafael] = staff
  const workday = (key) => (weekdayOf(key) === 0 ? addDays(key, 1) : key)
  const blocked = [
    { id: uid(), date: workday(addDays(today, 4)), full_day: false, start_time: '07:00', end_time: '10:00', reason: 'Inspeção da prefeitura na casa da Jennifer', created_at: realAgo(3) },
    { id: uid(), date: workday(addDays(today, 18)), full_day: true, start_time: null, end_time: null, reason: 'Curso de atualização da licença (CSL)', created_at: realAgo(10) },
  ]

  // ── Clientes ──────────────────────────────────────────────────────────────
  const clients = CLIENTS.map(([key, name, lang, phone, addr, city, zip, home, notes, tags, ago]) => ({
    id: uid(), provider_id: pid, name, whatsapp: '+1' + phone, email: emailOf(name), language: lang, birthday_md: null, tags,
    address_line: addr, city, state: 'MA', zip, home_notes: home, notes,
    total_visits: 0, total_spent_cents: 0, first_visit_at: null, last_visit_at: null, archived: false,
    created_at: realAgo(ago), updated_at: null, _key: key,
  }))
  const client = (key) => clients.find((c) => c._key === key)

  // ── Agenda: visitas técnicas e obras (service_label, sem service_id) ──────
  const appointments = []
  const iso = (ms) => new Date(ms).toISOString()
  function add({ day, time, dur = 60, label, who, st = null, total = 0, notes = null, pay = null, keep = false }) {
    const cl = who ? client(who) : null
    const start = toWall(day, time)
    const created = Math.min(nowMs - 3600e3, Date.parse(wallToReal(start)) - R.int(2, 9) * DAY)
    appointments.push({
      id: uid(), provider_id: pid, scheduled_for: start, duration_min: dur, status: 'confirmed',
      client_id: cl?.id || null, client_name: cl?.name || 'Cliente', client_whatsapp: cl?.whatsapp || null, client_email: cl?.email || null, client_notes: notes,
      service_id: null, service_label: label, total_cents: total, deposit_cents: 0, deposit_paid: false, payment_method: null,
      paid_cents: null, tip_cents: 0, paid_method: null, paid_at: null, internal_notes: null,
      source: 'manual', staff_id: st?.id || null, recurring_id: null, occurrence_date: null, review_requested: false,
      external_uid: null, ical_feed_id: null, ical_next_checkin: null,
      created_at: iso(created), confirmed_at: iso(created), completed_at: null, canceled_at: null, cancel_reason: null,
      _pay: pay, _keep: keep,
    })
  }
  const visit = (who, off, time, label = 'Visita técnica · orçamento') => add({ day: workday(addDays(today, off)), time, dur: 60, label, who })
  // Obra em dias úteis (hoje e amanhã sempre entram: a demo nunca abre vazia)
  function job(who, label, fromOff, toOff, st, { time = '07:30', dur = 480, notes = null } = {}) {
    const days = []
    for (let off = fromOff; off <= toOff; off++) {
      const d = addDays(today, off)
      const wd = weekdayOf(d)
      if ((wd !== 0 && wd !== 6) || off === 0 || off === 1) days.push(d)
    }
    days.forEach((d, i) => add({ day: d, time, dur, label: `${label} · dia ${i + 1} de ${days.length}`, who, st, notes: i === 0 ? notes : null }))
  }

  visit('renata', -64, '10:00', 'Visita técnica · deck e corrimão')
  add({ day: workday(addDays(today, -60)), time: '09:00', dur: 240, label: 'Conserto do deck e corrimão', who: 'renata', total: 38000, pay: 'zelle' })
  visit('robert', -47, '16:00', 'Visita técnica · backsplash da cozinha')
  visit('emily', -44, '09:00', 'Visita técnica · teto com infiltração')
  visit('jennifer', -41, '16:30', 'Visita técnica · banheiro da suíte')
  job('emily', 'Reparo de drywall no teto da cozinha', -36, -35, crew)
  visit('sarah', -33, '10:00', 'Visita técnica · pintura interna')
  job('sarah', 'Pintura interna (sala, jantar e corredor)', -28, -25, crew, { notes: 'Cobrir os móveis da sala. Limpar tudo no fim do dia.' })
  visit('david', -26, '15:00', 'Visita técnica · piso do 1º andar')
  job('david', 'Piso vinílico (LVP) no 1º andar', -21, -19, crew)
  visit('lauren', -15, '11:00', 'Visita técnica · cerca')
  visit('michael', -14, '16:30', 'Visita técnica · deck novo')
  add({ day: workday(addDays(today, -10)), time: '09:00', dur: 120, label: 'Conserto de porta e fechadura', who: 'kevin', total: 22100, pay: 'cash' })
  job('jennifer', 'Reforma do banheiro da suíte', -9, 6, crew, { notes: 'Equipe chega 7h30. O banheiro de hóspedes fica livre pra equipe.' })
  job('patricia', 'Drywall e pintura do porão', -8, -7, rafael, { time: '08:00', dur: 420 })
  visit('fernanda', -7, '17:00', 'Visita técnica · cozinha')
  visit('carmen', -6, '10:00', 'Visita técnica · pintura externa')
  visit('juliana', -4, '17:00', 'Visita técnica · piso laminado')
  add({ day: workday(addDays(today, -3)), time: '13:00', dur: 180, label: 'Instalação de prateleiras na garagem', who: 'marcos' })
  add({ day: workday(addDays(today, -2)), time: '16:00', dur: 60, label: 'Visita técnica · acabamento do porão', who: 'kevin', keep: true })
  add({ day: today, time: '16:00', dur: 60, label: 'Visita técnica · teto com infiltração', who: 'nicole', notes: 'Pedido pela página. Levar o medidor de umidade.' })
  add({ day: addDays(today, 1), time: '10:00', dur: 60, label: 'Visita técnica · closet sob medida', who: 'luis', notes: 'Pedido pela página. Ele fala espanhol.' })
  visit('renata', 3, '09:00', 'Visita técnica · telhado do galpão')
  add({ day: workday(addDays(today, 5)), time: '14:00', dur: 120, label: 'Instalação de luminárias', who: 'patricia', total: 24000 })
  job('michael', 'Deck novo 16x12 com escada', 9, 12, crew, { notes: 'Material entregue na véspera (lumber package).' })
  job('fernanda', 'Reforma da cozinha', 14, 18, crew)

  // ── Status conforme o relógio de agora ────────────────────────────────────
  const endMs = (a) => Date.parse(a.scheduled_for) + a.duration_min * 60e3
  for (const a of appointments) {
    if (endMs(a) > nowW || a._keep) continue                  // futuro, ou "esqueceu de marcar"
    a.status = 'completed'
    a.completed_at = wallToReal(new Date(endMs(a)).toISOString())
    if (a._pay) { a.paid_cents = a.total_cents; a.paid_method = a._pay; a.paid_at = a.completed_at }
  }
  for (const a of appointments) { delete a._pay; delete a._keep }

  // ── Avaliações ────────────────────────────────────────────────────────────
  const REVIEWS = [
    ['sarah', 5, 'Carlos and his crew did an amazing job painting our first floor. Clean, on time and very professional. Highly recommend!', 'Thank you, Sarah! It was a pleasure working in your home.'],
    ['emily', 5, 'Fast and tidy ceiling repair after a leak. You can\'t even tell where the damage was.', null],
    ['david', 4, 'Floors look great. The job took one extra day, but Carlos kept me updated the whole time.', 'Thanks, David! The subfloor needed leveling, glad you like the result.'],
    ['renata', 5, 'O Carlos é super caprichoso e honesto. Consertou o deck num dia só. Recomendo demais!', 'Obrigado, Renata! Até a próxima.'],
  ]
  const reviews = []
  for (const [who, rating, comment, response] of REVIEWS) {
    const cl = client(who)
    const a = appointments.filter((x) => x.client_id === cl.id && x.status === 'completed').pop()
    if (!a) continue
    a.review_requested = true
    const atMs = Math.min(nowMs - 20 * 60e3, Date.parse(wallToReal(new Date(endMs(a)).toISOString(), R.int(120, 900))))
    reviews.push({
      id: uid(), provider_id: pid, appointment_id: a.id, client_name: cl.name, rating, comment,
      provider_response: response, responded_at: response ? new Date(Math.min(nowMs - 60e3, atMs + 5 * 3600e3)).toISOString() : null,
      is_published: true, created_at: new Date(atMs).toISOString(),
    })
  }

  // ── Finanças: despesas de obra (mês atual e anterior) e milhagem ──────────
  const month = today.slice(0, 7)
  const dayOfMonth = Number(today.slice(8, 10))
  const prevMonth = addDays(month + '-01', -1).slice(0, 7)
  const inMonth = (d) => `${month}-${String(Math.max(1, Math.min(d, dayOfMonth))).padStart(2, '0')}`
  const EXP = [
    [1, 'seguro', 'Seguro de responsabilidade (general liability)', 32500, 'card'],
    [3, 'outros', 'Caçamba 10 jardas (Walsh)', 49500, 'card'], [4, 'gasolina', 'Posto Shell (caminhonete)', 8740, 'debit'],
    [5, 'equipamento', 'Serra de esquadria nova', 39900, 'card'], [6, 'celular', 'T-Mobile (2 linhas)', 12000, 'card'],
    [7, 'taxas', 'Permit da prefeitura de Natick', 35000, 'check'], [8, 'produtos', 'Lowe\'s: massa, fita e lixa', 21480, 'card'],
    [9, 'marketing', 'Placas de obra (yard signs)', 12000, 'card'], [9, 'gasolina', 'Posto Mobil', 9120, 'debit'],
  ]
  const PREV = [
    [1, 'seguro', 'Seguro de responsabilidade (general liability)', 32500, 'card'], [3, 'produtos', 'Sherwin-Williams: tinta (Mitchell)', 86800, 'card'],
    [26, 'produtos', 'Home Depot: material do banheiro (Walsh)', 184760, 'card'],
    [6, 'celular', 'T-Mobile (2 linhas)', 12000, 'card'], [10, 'produtos', 'Floor & Decor: piso vinílico (Kim)', 210800, 'card'],
    [12, 'gasolina', 'Posto Shell (caminhonete)', 9460, 'debit'], [15, 'outros', 'Pagamento do ajudante (1099)', 180000, 'zelle'],
    [20, 'alimentacao', 'Almoço da equipe', 6400, 'cash'],
  ]
  const expenses = [
    ...EXP.map(([d, category, description, amount_cents, payment_method]) => ({ spent_on: inMonth(d), category, description, amount_cents, payment_method })),
    ...PREV.map(([d, category, description, amount_cents, payment_method]) => ({ spent_on: `${prevMonth}-${String(d).padStart(2, '0')}`, category, description, amount_cents, payment_method })),
  ].map((e) => ({ id: uid(), ...e, receipt_url: null, created_at: new Date(Math.min(nowMs, Date.parse(wallToReal(e.spent_on + 'T18:00:00.000Z')))).toISOString(), updated_at: null }))

  // Milhagem: uma ida por cliente atendida no mês (obras contam só o 1º dia)
  const seen = new Set()
  const doneThisMonth = appointments.filter((a) => a.status === 'completed' && a.scheduled_for.slice(0, 7) === month && a.client_id && !seen.has(a.client_id) && seen.add(a.client_id))
  const MILES = { Natick: 7.8, Sudbury: 11.4, Wellesley: 12.6, Hopkinton: 9.9, Framingham: 2.4, Southborough: 8.1, Ashland: 5.2, Needham: 17.3, Marlborough: 10.7, Milford: 13.5, Hudson: 14.2 }
  const mileage = doneThisMonth.slice(0, 6).map((a) => {
    const cl = clients.find((c) => c.id === a.client_id)
    return {
      id: uid(), driven_on: keyOf(a.scheduled_for), miles: (MILES[cl.city] || 6) * 2, purpose: `Obra/visita: ${a.service_label}`,
      from_label: 'Escritório (Framingham)', to_label: [cl.address_line, cl.city].filter(Boolean).join(', '), appointment_id: a.id, created_at: realAgo(0.5),
    }
  })
  mileage.push({ id: uid(), driven_on: inMonth(2), miles: 6.6, purpose: 'Home Depot (material)', from_label: 'Escritório (Framingham)', to_label: 'Home Depot, Framingham', appointment_id: null, created_at: realAgo(Math.max(0, dayOfMonth - 2)) })

  return {
    user: { ...DEMO_USER },
    provider,
    services,
    hours,
    blocked,
    staff,
    clients,
    appointments: appointments.sort((x, y) => x.scheduled_for.localeCompare(y.scheduled_for)),
    recurring: [],
    feeds: [],
    reviews,
    expenses,
    mileage: mileage.filter((t) => t.driven_on <= today),
    waitlist: [],
    pushTokens: [],
  }
}
