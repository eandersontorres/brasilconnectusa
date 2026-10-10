// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — /api/agenda/finance em memória. Mesmas contas e formatos
//   de api/agenda/finance.js (summary, expenses, expense, mileage, year, report,
//   export CSV e as ações de despesa/milhagem). JS puro, sem react-native.
// ════════════════════════════════════════════════════════════════════════════
import { hasFeature, requireFeature } from './plans.js'
import { addDays, clip, diffDays, pad, uid } from './util.js'

const CATEGORIES = ['produtos', 'gasolina', 'aluguel', 'equipamento', 'marketing', 'taxas', 'celular', 'seguro', 'alimentacao', 'outros']
const PAY_METHODS = ['card', 'cash', 'zelle', 'venmo', 'cashapp', 'paypal', 'check', 'debit', 'other']
const FIXED_CATEGORIES = ['aluguel', 'celular', 'seguro']
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const CATEGORY_LABEL = {
  pt: { produtos: 'Produtos', gasolina: 'Gasolina', aluguel: 'Aluguel', equipamento: 'Equipamento', marketing: 'Marketing', taxas: 'Taxas e tarifas', celular: 'Celular e internet', seguro: 'Seguro', alimentacao: 'Alimentação', outros: 'Outros' },
  en: { produtos: 'Supplies', gasolina: 'Gas', aluguel: 'Rent', equipamento: 'Equipment', marketing: 'Marketing', taxas: 'Fees', celular: 'Phone/internet', seguro: 'Insurance', alimentacao: 'Meals', outros: 'Other' },
}
const SCHEDULE_C = {
  produtos: 'Supplies (line 22)', gasolina: 'Car and truck (line 9; not with mileage rate)', aluguel: 'Rent or lease (line 20)',
  equipamento: 'Supplies (22) or Depreciation (13)', marketing: 'Advertising (line 8)', taxas: 'Commissions and fees (line 10)',
  celular: 'Utilities (line 25)', seguro: 'Insurance (line 15)', alimentacao: 'Meals (line 24b, 50%)', outros: 'Other expenses (line 27a)',
}
const METHOD_LABEL = {
  pt: { card: 'Cartão', cash: 'Dinheiro', zelle: 'Zelle', venmo: 'Venmo', cashapp: 'Cash App', paypal: 'PayPal', check: 'Cheque', debit: 'Débito', stripe: 'Cartão (online)', other: 'Outro', free: 'Cortesia' },
  en: { card: 'Card', cash: 'Cash', zelle: 'Zelle', venmo: 'Venmo', cashapp: 'Cash App', paypal: 'PayPal', check: 'Check', debit: 'Debit', stripe: 'Card (online)', other: 'Other', free: 'Complimentary' },
}
const STATUS_LABEL = {
  pt: { pending: 'Aguardando sinal', confirmed: 'Confirmado', completed: 'Realizado', canceled: 'Cancelado', no_show: 'Faltou' },
  en: { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', canceled: 'Canceled', no_show: 'No-show' },
}
const SOURCE_LABEL = {
  pt: { online: 'Online', manual: 'Manual', recurring: 'Recorrente', ical: 'Turnover' },
  en: { online: 'Online', manual: 'Manual', recurring: 'Recurring', ical: 'Turnover' },
}

export class HttpError extends Error {
  constructor(status, body) { super(body?.error || 'Erro'); this.status = status; this.body = body }
}
const fail = (status, error) => { throw new HttpError(status, { error }) }
function gate(provider, key) {
  const g = requireFeature(provider, key)
  if (!g.ok) throw new HttpError(g.status, g.body)
}

// ── Datas ───────────────────────────────────────────────────────────────────
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
function parseMonth(v) {
  const s = String(v || '')
  if (!MONTH_RE.test(s)) return null
  const y = Number(s.slice(0, 4))
  return y >= 2000 && y <= 2100 ? s : null
}
function parseYear(v) {
  const y = Number(v)
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null
}
function parseDate(v) {
  const s = String(v || '').slice(0, 10)
  if (!DATE_RE.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  const y = Number(s.slice(0, 4))
  return y >= 2000 && y <= 2100 ? s : null
}
function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number)
  const t = y * 12 + (mo - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}
function daysIn(m) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}
const lastDay = (m) => `${m}-${pad(daysIn(m))}`
const monthStartIso = (m) => `${m}-01T00:00:00.000Z`

// ── Preferências ────────────────────────────────────────────────────────────
function taxPct(s) {
  const v = s?.tax_reserve_pct
  const n = Math.round(Number(v))
  return v == null || !Number.isFinite(n) ? 25 : clamp(n, 0, 60)
}
function mileageRate(s) {
  const v = s?.mileage_rate_cents
  const n = Math.round(Number(v))
  return v == null || !Number.isFinite(n) ? 70 : clamp(n, 0, 500)
}
function goalCents(s) {
  const n = Math.round(Number(s?.monthly_goal_cents))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── Leitura em memória ──────────────────────────────────────────────────────
function shapeApt(S, a) {
  const svc = a.service_id ? S.services.find((s) => s.id === a.service_id) : null
  const feed = a.ical_feed_id ? S.feeds.find((f) => f.id === a.ical_feed_id) : null
  return {
    id: a.id, scheduled_for: a.scheduled_for, status: a.status, total_cents: a.total_cents, deposit_cents: a.deposit_cents,
    deposit_paid: a.deposit_paid, payment_method: a.payment_method, client_id: a.client_id, client_name: a.client_name,
    client_whatsapp: a.client_whatsapp, client_email: a.client_email, service_id: a.service_id, external_uid: a.external_uid,
    service_label: a.service_label,
    service_name: svc?.name || a.service_label || (feed?.label ? `Limpeza · ${feed.label}` : null),
    paid_cents: a.paid_cents ?? null, tip_cents: a.tip_cents ?? 0, paid_method: a.paid_method ?? null,
    source: a.source ?? (a.external_uid ? 'ical' : null), staff_id: a.staff_id ?? null,
  }
}
function loadAppointments(S, fromIso, toIso, statuses = null) {
  return S.appointments
    .filter((a) => a.scheduled_for >= fromIso && a.scheduled_for < toIso && (!statuses || statuses.includes(a.status)))
    .sort((x, y) => x.scheduled_for.localeCompare(y.scheduled_for) || x.id.localeCompare(y.id))
    .map((a) => shapeApt(S, a))
}
const EXP_KEYS = ['id', 'spent_on', 'category', 'description', 'amount_cents', 'payment_method', 'receipt_url', 'created_at', 'updated_at']
const MIL_KEYS = ['id', 'driven_on', 'miles', 'purpose', 'from_label', 'to_label', 'appointment_id', 'created_at']
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))
function loadExpenses(S, from, to, categories = null) {
  return S.expenses
    .filter((e) => e.spent_on >= from && e.spent_on <= to && (!categories || categories.includes(e.category)))
    .sort((x, y) => y.spent_on.localeCompare(x.spent_on) || String(y.created_at).localeCompare(String(x.created_at)))
    .map((e) => pick(e, EXP_KEYS))
}
function loadMileage(S, from, to) {
  return S.mileage
    .filter((t) => t.driven_on >= from && t.driven_on <= to)
    .sort((x, y) => y.driven_on.localeCompare(x.driven_on) || String(y.created_at).localeCompare(String(x.created_at)))
    .map((t) => ({ ...pick(t, MIL_KEYS), miles: Number(t.miles) || 0 }))
}

// ── Contas (iguais às do servidor) ──────────────────────────────────────────
const monthOf = (a) => String(a.scheduled_for).slice(0, 7)
const dayKeyOf = (a) => String(a.scheduled_for).slice(0, 10)
export function incomeOf(a) {
  if (a.status === 'completed') return Math.max(0, a.paid_cents != null ? Number(a.paid_cents) : (Number(a.total_cents) || 0))
  if (a.status === 'no_show' || a.status === 'canceled') {
    if (a.paid_cents != null) return Math.max(0, Number(a.paid_cents) || 0)
    return a.status === 'no_show' && a.deposit_paid ? Math.max(0, Number(a.deposit_cents) || 0) : 0
  }
  return 0
}
const tipOf = (a) => (['completed', 'no_show', 'canceled'].includes(a.status) ? Math.max(0, Number(a.tip_cents) || 0) : 0)
const methodOf = (a) => a.paid_method || a.payment_method || 'unknown'
const serviceOf = (a) => a.service_name || 'Sem serviço'
const digits = (v) => String(v || '').replace(/\D/g, '')
function clientKey(a) {
  if (a.client_id) return 'id:' + a.client_id
  const d = digits(a.client_whatsapp)
  if (d.length >= 7) return 'wa:' + (d.length === 10 ? '1' + d : d)
  const n = String(a.client_name || '').trim().toLowerCase()
  return n ? 'nm:' + n : null
}
function sumIncome(apts, filter = null) {
  let cents = 0
  for (const a of apts) if (!filter || filter(a)) cents += incomeOf(a)
  return cents
}
function profit({ revenue, tips, expenses, gas, miles, rate, pct, gasExcluded }) {
  const income = revenue + tips
  const deduction = Math.round((Number(miles) || 0) * rate)
  const deductible = expenses - (gasExcluded ? gas : 0)
  const raw = income - deductible - deduction
  const taxable = Math.max(0, raw)
  return { net_cents: income - expenses, mileage_deduction_cents: deduction, taxable_raw_cents: raw, taxable_cents: taxable, tax_reserve_cents: Math.round((taxable * pct) / 100) }
}
function summarizeMonth(apts, month, today) {
  const daily = Array.from({ length: daysIn(month) }, (_, i) => ({ date: `${month}-${pad(i + 1)}`, cents: 0 }))
  const byMethod = {}
  const bySvc = new Map()
  const out = { revenue_cents: 0, tips_cents: 0, no_show_deposits_cents: 0, expected_cents: 0, expected_count: 0, unmarked_count: 0, unmarked_cents: 0, completed: 0, completed_cents: 0, no_shows: 0, cancellations: 0 }
  for (const a of apts) {
    const key = dayKeyOf(a)
    const inc = incomeOf(a)
    if (a.status === 'completed') {
      out.completed++
      out.completed_cents += inc
      const name = serviceOf(a)
      const s = bySvc.get(name) || { name, count: 0, cents: 0 }
      s.count++; s.cents += inc
      bySvc.set(name, s)
    } else if (a.status === 'no_show') {
      out.no_shows++
      out.no_show_deposits_cents += inc
    } else if (a.status === 'canceled') {
      out.cancellations++
    } else if (a.status === 'pending' || a.status === 'confirmed') {
      if (key >= today) { out.expected_cents += Number(a.total_cents) || 0; out.expected_count++ }
      else { out.unmarked_count++; out.unmarked_cents += Number(a.total_cents) || 0 }
    }
    out.tips_cents += tipOf(a)
    if (inc > 0) {
      out.revenue_cents += inc
      const d = Number(key.slice(8, 10)) - 1
      if (daily[d]) daily[d].cents += inc
      const m = methodOf(a)
      byMethod[m] = (byMethod[m] || 0) + inc
    }
  }
  out.avg_ticket_cents = out.completed ? Math.round(out.completed_cents / out.completed) : 0
  out.by_method = byMethod
  out.by_service = [...bySvc.values()].sort((a, b) => b.cents - a.cents || b.count - a.count).slice(0, 10)
  out.daily = daily
  return out
}

// ── Views ───────────────────────────────────────────────────────────────────
function viewSummary(S, c, q) {
  const month = parseMonth(q.month) || c.today.slice(0, 7)
  const prev = addMonths(month, -1)
  const year = month.slice(0, 4)
  const finance = hasFeature(S.provider, 'finance')
  const mileage = finance && hasFeature(S.provider, 'mileage')
  const apts = loadAppointments(S, monthStartIso(prev), monthStartIso(addMonths(month, 1)))
  const expenses = finance ? loadExpenses(S, `${month}-01`, lastDay(month)) : null
  const trips = mileage ? loadMileage(S, `${month}-01`, lastDay(month)) : null
  const yearTrips = mileage ? loadMileage(S, `${year}-01-01`, `${year}-12-31`).length : 0

  const cur = apts.filter((a) => monthOf(a) === month)
  const before = apts.filter((a) => monthOf(a) === prev)
  const s = summarizeMonth(cur, month, c.today)
  let previousSamePeriod = null
  if (c.today.slice(0, 7) === month) {
    const day = Number(c.today.slice(8, 10))
    previousSamePeriod = sumIncome(before, (a) => Number(dayKeyOf(a).slice(8, 10)) <= day)
  }
  const settings = S.provider.app_settings || {}
  const pct = taxPct(settings)
  const rate = mileageRate(settings)
  const out = {
    month, today: c.today, ...s,
    previous_month: prev, previous_revenue_cents: sumIncome(before), previous_same_period_cents: previousSamePeriod,
    goal_cents: goalCents(settings), finance_locked: !finance, mileage_locked: !hasFeature(S.provider, 'mileage'),
    tax_reserve_pct: pct, mileage_rate_cents: rate,
    expenses_cents: null, expenses_by_category: null, net_cents: null, taxable_cents: null, tax_reserve_cents: null,
    gas_excluded: false, miles: null, trips: null, mileage_deduction_cents: null,
  }
  if (mileage && trips) {
    out.miles = Math.round(trips.reduce((t, x) => t + x.miles, 0) * 10) / 10
    out.trips = trips.length
    out.mileage_deduction_cents = Math.round(out.miles * rate)
  }
  if (finance && expenses) {
    const byCat = {}
    let total = 0, gas = 0
    for (const e of expenses) {
      total += e.amount_cents
      byCat[e.category] = (byCat[e.category] || 0) + e.amount_cents
      if (e.category === 'gasolina') gas += e.amount_cents
    }
    const gasExcluded = mileage && yearTrips > 0
    const p = profit({ revenue: s.revenue_cents, tips: s.tips_cents, expenses: total, gas, miles: out.miles || 0, rate, pct, gasExcluded })
    out.expenses_cents = total
    out.expenses_count = expenses.length
    out.expenses_by_category = Object.entries(byCat).map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents)
    out.net_cents = p.net_cents
    out.taxable_cents = p.taxable_cents
    out.tax_reserve_cents = p.tax_reserve_cents
    out.gas_excluded = gasExcluded && gas > 0
    out.gas_cents = gas
  }
  return out
}

function viewExpenses(S, c, q) {
  const month = parseMonth(q.month) || c.today.slice(0, 7)
  const prev = addMonths(month, -1)
  const expenses = loadExpenses(S, `${month}-01`, lastDay(month))
  const prevFixed = loadExpenses(S, `${prev}-01`, lastDay(prev), FIXED_CATEGORIES)
  const byCat = new Map()
  let total = 0
  for (const e of expenses) {
    total += e.amount_cents
    const x = byCat.get(e.category) || { category: e.category, cents: 0, count: 0 }
    x.cents += e.amount_cents; x.count++
    byCat.set(e.category, x)
  }
  const hasFixed = expenses.some((e) => FIXED_CATEGORIES.includes(e.category))
  const fixed = !hasFixed && prevFixed.length
    ? { from_month: prev, count: prevFixed.length, cents: prevFixed.reduce((t, e) => t + e.amount_cents, 0), categories: [...new Set(prevFixed.map((e) => e.category))] }
    : null
  return { month, expenses, total_cents: total, count: expenses.length, by_category: [...byCat.values()].sort((a, b) => b.cents - a.cents), fixed_suggestion: fixed }
}

function viewExpense(S, q) {
  const e = S.expenses.find((x) => x.id === String(q.id || ''))
  if (!e) fail(404, 'Despesa não encontrada')
  return { expense: pick(e, EXP_KEYS) }
}

function viewMileage(S, c, q) {
  const month = parseMonth(q.month) || c.today.slice(0, 7)
  const year = month.slice(0, 4)
  const rate = mileageRate(S.provider.app_settings)
  const yearTrips = loadMileage(S, `${year}-01-01`, `${year}-12-31`)
  const completed = loadAppointments(S, monthStartIso(month), monthStartIso(addMonths(month, 1)), ['completed'])
  const trips = yearTrips.filter((t) => String(t.driven_on).slice(0, 7) === month)
  const miles = Math.round(trips.reduce((t, x) => t + x.miles, 0) * 10) / 10
  const yearMiles = Math.round(yearTrips.reduce((t, x) => t + x.miles, 0) * 10) / 10
  const linked = new Set(yearTrips.map((t) => t.appointment_id).filter(Boolean))
  const open = completed.filter((a) => !linked.has(a.id)).reverse().slice(0, 20)
  const placeOf = (id) => {
    const cl = S.clients.find((x) => x.id === id)
    return cl ? [cl.address_line, cl.city, cl.state].filter(Boolean).join(', ') || null : null
  }
  return {
    month, trips, total_miles: miles, rate_cents: rate, deduction_cents: Math.round(miles * rate),
    year: Number(year), year_trips: yearTrips.length, year_miles: yearMiles, year_deduction_cents: Math.round(yearMiles * rate),
    suggestions: open.map((a) => ({ appointment_id: a.id, date: dayKeyOf(a), client_name: a.client_name || null, service_name: a.service_name || null, place: (a.client_id && placeOf(a.client_id)) || null })),
  }
}

function viewYear(S, c, q) {
  gate(S.provider, 'finance')
  const year = parseYear(q.year) || Number(c.today.slice(0, 4))
  const mileage = hasFeature(S.provider, 'mileage')
  const pct = taxPct(S.provider.app_settings)
  const rate = mileageRate(S.provider.app_settings)
  const apts = loadAppointments(S, `${year}-01-01T00:00:00.000Z`, `${year + 1}-01-01T00:00:00.000Z`)
  const expenses = loadExpenses(S, `${year}-01-01`, `${year}-12-31`)
  const trips = mileage ? loadMileage(S, `${year}-01-01`, `${year}-12-31`) : []
  const base = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${pad(i + 1)}`, revenue_cents: 0, tips_cents: 0, completed: 0, expenses_cents: 0, gas: 0, miles: 0 }))
  for (const a of apts) {
    const m = base[Number(String(a.scheduled_for).slice(5, 7)) - 1]
    if (!m) continue
    m.revenue_cents += incomeOf(a)
    m.tips_cents += tipOf(a)
    if (a.status === 'completed') m.completed++
  }
  for (const e of expenses) {
    const m = base[Number(String(e.spent_on).slice(5, 7)) - 1]
    if (!m) continue
    m.expenses_cents += e.amount_cents
    if (e.category === 'gasolina') m.gas += e.amount_cents
  }
  for (const t of trips) {
    const m = base[Number(String(t.driven_on).slice(5, 7)) - 1]
    if (m) m.miles += t.miles
  }
  const gasExcluded = trips.length > 0
  const months = base.map((m) => {
    const miles = Math.round(m.miles * 10) / 10
    const p = profit({ revenue: m.revenue_cents, tips: m.tips_cents, expenses: m.expenses_cents, gas: m.gas, miles, rate, pct, gasExcluded })
    return { month: m.month, revenue_cents: m.revenue_cents, tips_cents: m.tips_cents, completed: m.completed, expenses_cents: m.expenses_cents, miles, ...p }
  })
  const sum = (k) => months.reduce((t, m) => t + (m[k] || 0), 0)
  const totalTaxable = Math.max(0, sum('taxable_raw_cents'))
  const totals = {
    revenue_cents: sum('revenue_cents'), tips_cents: sum('tips_cents'), completed: sum('completed'), expenses_cents: sum('expenses_cents'),
    net_cents: sum('net_cents'), miles: Math.round(sum('miles') * 10) / 10, mileage_deduction_cents: sum('mileage_deduction_cents'),
    taxable_cents: totalTaxable, tax_reserve_cents: Math.round((totalTaxable * pct) / 100),
  }
  const Q = [
    { months: [1, 2, 3], due: `${year}-04-15` },
    { months: [4, 5], due: `${year}-06-15` },
    { months: [6, 7, 8], due: `${year}-09-15` },
    { months: [9, 10, 11, 12], due: `${year + 1}-01-15` },
  ]
  const quarters = Q.map((qq) => {
    const raw = qq.months.reduce((t, i) => t + months[i - 1].taxable_raw_cents, 0)
    const taxable = Math.max(0, raw)
    return { ...qq, taxable_cents: taxable, tax_reserve_cents: Math.round((taxable * pct) / 100) }
  })
  return {
    year, months: months.map(({ taxable_raw_cents, ...m }) => m), totals, quarters, tax_reserve_pct: pct, mileage_rate_cents: rate,
    mileage_locked: !mileage, gas_excluded: gasExcluded && expenses.some((e) => e.category === 'gasolina'),
  }
}

function reportPeriod(c, q) {
  const y = parseYear(q.year)
  if (y && !q.month) return { kind: 'year', year: y, from: `${y}-01-01`, to: `${y}-12-31`, fromIso: `${y}-01-01T00:00:00.000Z`, toIso: `${y + 1}-01-01T00:00:00.000Z` }
  const m = parseMonth(q.month) || c.today.slice(0, 7)
  return { kind: 'month', month: m, from: `${m}-01`, to: lastDay(m), fromIso: monthStartIso(m), toIso: monthStartIso(addMonths(m, 1)) }
}

function viewReport(S, c, q) {
  gate(S.provider, 'reports')
  const period = reportPeriod(c, q)
  const apts = loadAppointments(S, period.fromIso, period.toIso)
  const staff = S.staff
  const totals = { appointments: apts.length, completed: 0, no_shows: 0, cancellations: 0, revenue_cents: 0, tips_cents: 0, completed_cents: 0 }
  const bySvc = new Map(), byClient = new Map(), byStaff = new Map(), bySource = new Map()
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({ weekday: i, count: 0, cents: 0 }))
  const byHour = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }))
  const byMonth = period.kind === 'year' ? Array.from({ length: 12 }, (_, i) => ({ month: `${period.year}-${pad(i + 1)}`, count: 0, cents: 0 })) : null
  let anyStaff = false
  for (const a of apts) {
    const inc = incomeOf(a)
    const tip = tipOf(a)
    totals.revenue_cents += inc
    totals.tips_cents += tip
    if (a.status === 'no_show') totals.no_shows++
    if (a.status === 'canceled') totals.cancellations++
    if (a.staff_id) anyStaff = true
    if (a.status !== 'completed') continue
    totals.completed++
    totals.completed_cents += inc
    const d = new Date(a.scheduled_for)
    byWeekday[d.getUTCDay()].count++
    byWeekday[d.getUTCDay()].cents += inc
    byHour[d.getUTCHours()].count++
    if (byMonth) { const m = byMonth[d.getUTCMonth()]; m.count++; m.cents += inc }
    const svcName = serviceOf(a)
    const s = bySvc.get(svcName) || { name: svcName, count: 0, cents: 0 }
    s.count++; s.cents += inc
    bySvc.set(svcName, s)
    const ck = clientKey(a)
    if (ck) {
      const x = byClient.get(ck) || { key: ck, client_id: a.client_id || null, name: a.client_name || 'Sem nome', count: 0, cents: 0, tips_cents: 0 }
      x.count++; x.cents += inc; x.tips_cents += tip
      if (a.client_name) x.name = a.client_name
      byClient.set(ck, x)
    }
    const sk = a.staff_id || 'none'
    const st = byStaff.get(sk) || { staff_id: a.staff_id || null, count: 0, cents: 0 }
    st.count++; st.cents += inc
    byStaff.set(sk, st)
    const src = a.source || 'unknown'
    const so = bySource.get(src) || { source: src, count: 0, cents: 0 }
    so.count++; so.cents += inc
    bySource.set(src, so)
  }
  const prior = new Set(S.appointments.filter((a) => a.status === 'completed' && a.scheduled_for < period.fromIso).map(clientKey).filter(Boolean))
  const clients = { new_count: 0, returning_count: 0, new_cents: 0, returning_cents: 0 }
  for (const x of byClient.values()) {
    if (prior.has(x.key)) { clients.returning_count++; clients.returning_cents += x.cents }
    else { clients.new_count++; clients.new_cents += x.cents }
  }
  const staffById = Object.fromEntries(staff.map((s) => [s.id, s]))
  const byStaffOut = anyStaff
    ? [...byStaff.values()].map((s) => ({
        ...s,
        name: s.staff_id ? (staffById[s.staff_id]?.name || 'Profissional removida') : 'Sem profissional definida',
        color: s.staff_id ? (staffById[s.staff_id]?.color || null) : null,
      })).sort((a, b) => b.cents - a.cents)
    : null
  const decided = totals.completed + totals.no_shows
  return {
    period: { kind: period.kind, month: period.month || null, year: period.year || Number(period.from.slice(0, 4)), from: period.from, to: period.to },
    totals: {
      ...totals,
      avg_ticket_cents: totals.completed ? Math.round(totals.completed_cents / totals.completed) : 0,
      no_show_rate: decided ? Math.round((totals.no_shows / decided) * 1000) / 10 : 0,
      cancel_rate: totals.appointments ? Math.round((totals.cancellations / totals.appointments) * 1000) / 10 : 0,
      unique_clients: byClient.size,
    },
    by_service: [...bySvc.values()].sort((a, b) => b.cents - a.cents || b.count - a.count),
    top_clients: [...byClient.values()].sort((a, b) => b.cents - a.cents || b.count - a.count).slice(0, 10).map(({ key, ...x }) => x),
    by_staff: byStaffOut,
    by_weekday: byWeekday,
    by_hour: byHour,
    by_source: bySource.size > 1 || !bySource.has('unknown') ? [...bySource.values()].sort((a, b) => b.count - a.count) : null,
    by_month: byMonth,
    clients,
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────
const BOM = '\uFEFF'
function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const txt = (v) => {
  if (v == null || v === '') return ''
  const s = String(v)
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}
const usd = (cents) => (cents == null || cents === '' ? '' : (Number(cents) / 100).toFixed(2))
function phoneOut(v) {
  const d = digits(v)
  if (!d) return ''
  const n = d.length === 10 ? '1' + d : d
  if (n.length === 11 && n.startsWith('1')) return `(${n.slice(1, 4)}) ${n.slice(4, 7)}-${n.slice(7)}`
  return txt('+' + n)
}
const toCsv = (header, rows) => BOM + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

function exportRange(c, q) {
  if (q.from || q.to) {
    const from = parseDate(q.from), to = parseDate(q.to)
    if (!from || !to) fail(400, 'Período inválido. Use AAAA-MM-DD')
    if (from > to) fail(400, 'A data inicial precisa ser antes da final')
    if (diffDays(from, to) > 731) fail(400, 'Exporte no máximo 2 anos de cada vez')
    return { from, to, label: `${from}_${to}` }
  }
  const p = reportPeriod(c, q)
  return { from: p.from, to: p.to, label: p.kind === 'year' ? String(p.year) : p.month }
}

function buildExport(S, c, q) {
  gate(S.provider, 'reports')
  const kind = String(q.kind || '')
  const lang = q.lang === 'en' ? 'en' : 'pt'
  const en = lang === 'en'
  const r = exportRange(c, q)
  const fromIso = `${r.from}T00:00:00.000Z`
  const toIso = `${addDays(r.to, 1)}T00:00:00.000Z`
  const rate = mileageRate(S.provider.app_settings)

  if (kind === 'appointments') {
    const staffById = Object.fromEntries(S.staff.map((s) => [s.id, s.name]))
    const header = en
      ? ['Date', 'Time', 'Client', 'WhatsApp', 'Email', 'Service', 'Status', 'Service price', 'Amount received', 'Tip', 'Payment method', 'Deposit', 'Deposit paid', 'Staff', 'Source', 'ID']
      : ['Data', 'Hora', 'Cliente', 'WhatsApp', 'E-mail', 'Serviço', 'Status', 'Valor do serviço', 'Valor recebido', 'Gorjeta', 'Forma de pagamento', 'Sinal', 'Sinal pago', 'Profissional', 'Origem', 'ID']
    const rows = loadAppointments(S, fromIso, toIso).map((a) => {
      const iso = String(a.scheduled_for)
      const received = ['completed', 'no_show', 'canceled'].includes(a.status) ? incomeOf(a) : null
      const method = a.paid_method || a.payment_method
      return [
        iso.slice(0, 10), iso.slice(11, 16), txt(a.client_name), phoneOut(a.client_whatsapp), txt(a.client_email),
        txt(a.service_name), STATUS_LABEL[lang][a.status] || a.status, usd(a.total_cents),
        received != null ? usd(received) : '', a.tip_cents ? usd(a.tip_cents) : '',
        method ? (METHOD_LABEL[lang][method] || txt(method)) : '',
        a.deposit_cents ? usd(a.deposit_cents) : '', a.deposit_cents ? (a.deposit_paid ? (en ? 'Yes' : 'Sim') : (en ? 'No' : 'Não')) : '',
        a.staff_id ? txt(staffById[a.staff_id] || '') : '', a.source ? (SOURCE_LABEL[lang][a.source] || a.source) : '', a.id,
      ]
    })
    return toCsv(header, rows)
  }
  if (kind === 'expenses') {
    const header = en
      ? ['Date', 'Category', 'Description', 'Amount', 'Payment method', 'Schedule C (suggested)', 'Receipt']
      : ['Data', 'Categoria', 'Descrição', 'Valor', 'Forma de pagamento', 'Schedule C (sugestão)', 'Comprovante']
    const rows = loadExpenses(S, r.from, r.to).reverse().map((e) => [
      e.spent_on, CATEGORY_LABEL[lang][e.category] || e.category, txt(e.description), usd(e.amount_cents),
      e.payment_method ? (METHOD_LABEL[lang][e.payment_method] || txt(e.payment_method)) : '', SCHEDULE_C[e.category] || '', e.receipt_url || '',
    ])
    return toCsv(header, rows)
  }
  if (kind === 'mileage') {
    const header = en
      ? ['Date', 'Miles', 'Business purpose', 'From', 'To', 'Rate per mile', 'Estimated deduction']
      : ['Data', 'Milhas', 'Motivo', 'De', 'Para', 'Taxa por milha', 'Dedução estimada']
    const rows = loadMileage(S, r.from, r.to).reverse().map((t) => [
      t.driven_on, t.miles.toFixed(1), txt(t.purpose), txt(t.from_label), txt(t.to_label), usd(rate), usd(Math.round(t.miles * rate)),
    ])
    return toCsv(header, rows)
  }
  if (kind === 'clients') {
    const done = loadAppointments(S, fromIso, toIso, ['completed'])
    const all = S.appointments.filter((a) => a.status === 'completed')
    const inPeriod = {}
    const total = {}
    for (const a of done) { if (!a.client_id) continue; const x = inPeriod[a.client_id] || (inPeriod[a.client_id] = { count: 0, cents: 0 }); x.count++; x.cents += incomeOf(a) }
    for (const a of all) {
      if (!a.client_id) continue
      const x = total[a.client_id] || (total[a.client_id] = { count: 0, cents: 0, first: null, last: null })
      x.count++; x.cents += a.total_cents || 0
      if (!x.first || a.scheduled_for < x.first) x.first = a.scheduled_for
      if (!x.last || a.scheduled_for > x.last) x.last = a.scheduled_for
    }
    const header = en
      ? ['Name', 'WhatsApp', 'Email', 'City', 'State', 'Birthday (MM-DD)', 'Language', 'Visits in period', 'Spent in period', 'Total visits', 'Total spent', 'First visit', 'Last visit']
      : ['Nome', 'WhatsApp', 'E-mail', 'Cidade', 'Estado', 'Aniversário (MM-DD)', 'Idioma', 'Atendimentos no período', 'Gasto no período', 'Atendimentos (total)', 'Gasto total', 'Primeira visita', 'Última visita']
    const rows = S.clients.filter((x) => x.archived !== true).sort((a, b) => a.name.localeCompare(b.name)).map((x) => [
      txt(x.name), phoneOut(x.whatsapp), txt(x.email), txt(x.city), txt(x.state), x.birthday_md || '', x.language || '',
      inPeriod[x.id]?.count || 0, usd(inPeriod[x.id]?.cents || 0), total[x.id]?.count || 0, usd(total[x.id]?.cents || 0),
      total[x.id]?.first ? total[x.id].first.slice(0, 10) : '', total[x.id]?.last ? total[x.id].last.slice(0, 10) : '',
    ])
    return toCsv(header, rows)
  }
  fail(400, 'Tipo de exportação inválido')
}

// ── Escrita ─────────────────────────────────────────────────────────────────
function safeUrl(v) {
  const s = clip(v, 500)
  return s && /^https:\/\//i.test(s) ? s : null
}
function readExpense(b, partial, today) {
  const out = {}
  if (!partial || b.spent_on !== undefined) {
    const d = parseDate(b.spent_on)
    if (!d) return { error: 'Data inválida' }
    if (d > addDays(today, 366)) return { error: 'Essa data está muito no futuro' }
    out.spent_on = d
  }
  if (!partial || b.category !== undefined) {
    if (!CATEGORIES.includes(b.category)) return { error: 'Escolha uma categoria' }
    out.category = b.category
  }
  if (!partial || b.amount_cents !== undefined) {
    const n = Math.round(Number(b.amount_cents))
    if (!Number.isFinite(n) || n <= 0) return { error: 'Informe um valor maior que zero' }
    if (n > 10000000) return { error: 'Valor muito alto (máximo $100.000)' }
    out.amount_cents = n
  }
  if (!partial || b.description !== undefined) out.description = clip(b.description, 300)
  if (!partial || b.payment_method !== undefined) out.payment_method = PAY_METHODS.includes(b.payment_method) ? b.payment_method : null
  if (!partial || b.receipt_url !== undefined) {
    if (b.receipt_url && !safeUrl(b.receipt_url)) return { error: 'Link do comprovante inválido' }
    out.receipt_url = safeUrl(b.receipt_url)
  }
  if (partial && !Object.keys(out).length) return { error: 'Nada pra atualizar' }
  return { fields: out }
}
function readTrip(b, partial, today) {
  const out = {}
  if (!partial || b.driven_on !== undefined) {
    const d = parseDate(b.driven_on)
    if (!d) return { error: 'Data inválida' }
    if (d > addDays(today, 1)) return { error: 'Registre só viagens que já aconteceram' }
    out.driven_on = d
  }
  if (!partial || b.miles !== undefined) {
    const n = Math.round(Number(String(b.miles ?? '').replace(',', '.')) * 10) / 10
    if (!Number.isFinite(n) || n < 0.1 || n > 2000) return { error: 'Informe as milhas (entre 0,1 e 2.000)' }
    out.miles = n
  }
  if (!partial || b.purpose !== undefined) out.purpose = clip(b.purpose, 200)
  if (!partial || b.from_label !== undefined) out.from_label = clip(b.from_label, 120)
  if (!partial || b.to_label !== undefined) out.to_label = clip(b.to_label, 120)
  if (partial && !Object.keys(out).length && b.appointment_id === undefined) return { error: 'Nada pra atualizar' }
  return { fields: out }
}
function ownAppointmentId(S, v) {
  if (v == null || v === '') return null
  const id = String(v)
  if (!S.appointments.some((a) => a.id === id)) fail(404, 'Atendimento não encontrado')
  return id
}

function handlePost(S, c, b) {
  const action = b.action
  const now = new Date().toISOString()

  if (['expense_create', 'expense_update', 'expense_delete', 'expense_copy'].includes(action)) {
    gate(S.provider, 'finance')
    if (action === 'expense_create') {
      const r = readExpense(b, false, c.today)
      if (r.error) fail(400, r.error)
      const row = { id: uid(), ...r.fields, created_at: now, updated_at: now }
      S.expenses.push(row)
      return { status: 201, body: { ok: true, expense: pick(row, EXP_KEYS) } }
    }
    if (action === 'expense_copy') {
      const from = parseMonth(b.from_month), to = parseMonth(b.to_month)
      if (!from || !to || from === to) fail(400, 'Meses inválidos')
      const src = loadExpenses(S, `${from}-01`, lastDay(from), FIXED_CATEGORIES)
      const dest = loadExpenses(S, `${to}-01`, lastDay(to), FIXED_CATEGORIES)
      const seen = new Set(dest.map((e) => `${e.category}|${e.amount_cents}|${e.description || ''}`))
      const rows = []
      for (const e of src.slice(0, 50)) {
        const k = `${e.category}|${e.amount_cents}|${e.description || ''}`
        if (seen.has(k)) continue
        seen.add(k)
        const day = Math.min(Number(String(e.spent_on).slice(8, 10)) || 1, daysIn(to))
        rows.push({ id: uid(), spent_on: `${to}-${pad(day)}`, category: e.category, description: e.description, amount_cents: e.amount_cents, payment_method: e.payment_method, receipt_url: null, created_at: now, updated_at: now })
      }
      S.expenses.push(...rows)
      return { status: rows.length ? 201 : 200, body: { ok: true, created: rows.length, expenses: rows.map((e) => pick(e, EXP_KEYS)) } }
    }
    const row = S.expenses.find((e) => e.id === String(b.id || ''))
    if (!row) fail(404, 'Despesa não encontrada')
    if (action === 'expense_update') {
      const r = readExpense(b, true, c.today)
      if (r.error) fail(400, r.error)
      Object.assign(row, r.fields, { updated_at: now })
      return { status: 200, body: { ok: true, expense: pick(row, EXP_KEYS) } }
    }
    S.expenses.splice(S.expenses.indexOf(row), 1)
    return { status: 200, body: { ok: true } }
  }

  if (['mileage_create', 'mileage_update', 'mileage_delete'].includes(action)) {
    gate(S.provider, 'mileage')
    const out = (t) => ({ ...pick(t, MIL_KEYS), miles: Number(t.miles) || 0 })
    if (action === 'mileage_create') {
      const r = readTrip(b, false, c.today)
      if (r.error) fail(400, r.error)
      const row = { id: uid(), ...r.fields, appointment_id: ownAppointmentId(S, b.appointment_id), created_at: now }
      S.mileage.push(row)
      return { status: 201, body: { ok: true, trip: out(row) } }
    }
    const row = S.mileage.find((t) => t.id === String(b.id || ''))
    if (!row) fail(404, 'Viagem não encontrada')
    if (action === 'mileage_update') {
      const r = readTrip(b, true, c.today)
      if (r.error) fail(400, r.error)
      Object.assign(row, r.fields)
      if (b.appointment_id !== undefined) row.appointment_id = ownAppointmentId(S, b.appointment_id)
      return { status: 200, body: { ok: true, trip: out(row) } }
    }
    S.mileage.splice(S.mileage.indexOf(row), 1)
    return { status: 200, body: { ok: true } }
  }

  fail(400, 'Ação inválida')
}

/** GET/POST /api/agenda/finance. c = { today }. → { status, body } (body string no CSV). */
export function financeRoute(S, c, method, q, body) {
  if (method === 'GET') {
    const view = String(q.view || 'summary')
    if (view === 'summary') return { status: 200, body: viewSummary(S, c, q) }
    if (view === 'expenses') return { status: 200, body: viewExpenses(S, c, q) }
    if (view === 'expense') return { status: 200, body: viewExpense(S, q) }
    if (view === 'mileage') return { status: 200, body: viewMileage(S, c, q) }
    if (view === 'year') return { status: 200, body: viewYear(S, c, q) }
    if (view === 'report') return { status: 200, body: viewReport(S, c, q) }
    if (view === 'export') return { status: 200, body: buildExport(S, c, q) }
    fail(400, 'Visão inválida')
  }
  if (method === 'POST') return handlePost(S, c, body || {})
  return { status: 405, body: { error: 'Method not allowed' } }
}
