/**
 * Financas da profissional: faturamento, despesas, milhagem, relatorios e CSV.
 *
 * GET  /api/agenda/finance   com JWT
 *      ?view=summary&month=YYYY-MM   faturamento do mes (sempre liberado, so leitura);
 *                                    despesas, lucro, reserva pro imposto e milhagem
 *                                    vem nulos sem o recurso 'finance' (finance_locked)
 *      ?view=expenses&month=YYYY-MM  despesas do mes + totais por categoria
 *      ?view=expense&id=             uma despesa (tela de edicao)
 *      ?view=mileage&month=YYYY-MM   viagens do mes + totais do mes e do ano + sugestoes
 *      ?view=year&year=YYYY          12 meses: receita, despesas, lucro, reserva (exige 'finance')
 *      ?view=report&month= | &year=  relatorio por servico, cliente, equipe, dia (exige 'reports')
 *      ?view=export&kind=appointments|expenses|mileage|clients&from=YYYY-MM-DD&to=YYYY-MM-DD[&lang=en]
 *                                    CSV com BOM (exige 'reports'); aceita &month= ou &year= no lugar de from/to
 * POST /api/agenda/finance   com JWT
 *      Body: { action, ... }
 *        expense_create  { spent_on, category, amount_cents, description?, payment_method?, receipt_url? }
 *        expense_update  { id, ...mesmos campos (parcial) }
 *        expense_delete  { id }
 *        expense_copy    { from_month, to_month }  repete as despesas fixas (aluguel, celular, seguro)
 *        mileage_create  { driven_on, miles, purpose?, from_label?, to_label?, appointment_id? }
 *        mileage_update  { id, ...parcial }
 *        mileage_delete  { id }
 *
 * Regra de horario: scheduled_for e hora de parede gravada como UTC, entao o mes e
 * a faixa de datas UTC ('2026-10-01T00:00Z' ate '2026-11-01T00:00Z').
 * Valor recebido = paid_cents (marcado no app) ou total_cents quando vazio.
 * Gorjeta (tip_cents) fica separada do faturamento e entra no lucro.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature, hasFeature } from '../_lib/agendaPlans.js'

const CATEGORIES = ['produtos', 'gasolina', 'aluguel', 'equipamento', 'marketing', 'taxas', 'celular', 'seguro', 'alimentacao', 'outros']
const PAY_METHODS = ['card', 'cash', 'zelle', 'venmo', 'cashapp', 'paypal', 'check', 'debit', 'other']
const FIXED_CATEGORIES = ['aluguel', 'celular', 'seguro']
const DEFAULT_TAX_PCT = 25
const DEFAULT_MILEAGE_RATE = 70        // taxa padrao do IRS de 2025: 70 centavos por milha
const PAGE = 1000
const MAX_ROWS = 20000
const MAX_EXPORT_DAYS = 731

const EXP_COLS = 'id, spent_on, category, description, amount_cents, payment_method, receipt_url, created_at, updated_at'
const MIL_COLS = 'id, driven_on, miles, purpose, from_label, to_label, appointment_id, created_at'

// Colunas novas (agenda/equipe) podem ainda nao existir no banco: tenta da mais
// completa pra mais simples e guarda a que funcionou por 5 minutos (depois de
// aplicar o SQL, volta a ler as colunas novas sem esperar a funcao reiniciar).
const APT_BASE = 'id, scheduled_for, status, total_cents, deposit_cents, deposit_paid, payment_method, client_id, client_name, client_whatsapp, client_email, service_id, external_uid, ag_services(name), ag_ical_feeds(label)'
const APT_COLS = [
  APT_BASE + ', service_label, paid_cents, tip_cents, paid_method, source, staff_id',   // + ag_app_agenda.sql e ag_app_team.sql
  APT_BASE + ', service_label, paid_cents, tip_cents, paid_method, source',             // so ag_app_agenda.sql
  APT_BASE,
]
const COLS_RETRY_MS = 5 * 60e3
let aptColsAt = 0
let aptColsSince = 0

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Rotulos do CSV ──────────────────────────────────────────────────────────
const CATEGORY_LABEL = {
  pt: { produtos: 'Produtos', gasolina: 'Gasolina', aluguel: 'Aluguel', equipamento: 'Equipamento', marketing: 'Marketing', taxas: 'Taxas e tarifas', celular: 'Celular e internet', seguro: 'Seguro', alimentacao: 'Alimentação', outros: 'Outros' },
  en: { produtos: 'Supplies', gasolina: 'Gas', aluguel: 'Rent', equipamento: 'Equipment', marketing: 'Marketing', taxas: 'Fees', celular: 'Phone/internet', seguro: 'Insurance', alimentacao: 'Meals', outros: 'Other' },
}
// Sugestao de linha do Schedule C (formulario do IRS pra autonomos) pro contador
const SCHEDULE_C = {
  produtos: 'Supplies (line 22)',
  gasolina: 'Car and truck (line 9; not with mileage rate)',
  aluguel: 'Rent or lease (line 20)',
  equipamento: 'Supplies (22) or Depreciation (13)',
  marketing: 'Advertising (line 8)',
  taxas: 'Commissions and fees (line 10)',
  celular: 'Utilities (line 25)',
  seguro: 'Insurance (line 15)',
  alimentacao: 'Meals (line 24b, 50%)',
  outros: 'Other expenses (line 27a)',
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

// ── Erro com status (validacao e cadeado) ───────────────────────────────────
class HttpError extends Error {
  constructor(status, body) { super(body?.error || 'Erro'); this.status = status; this.body = body }
}
const fail = (status, error) => { throw new HttpError(status, { error }) }
function gate(provider, key) {
  const g = requireFeature(provider, key)
  if (!g.ok) throw new HttpError(g.status, g.body)
}

// ── Datas (sempre 'YYYY-MM-DD' / 'YYYY-MM', sem fuso) ───────────────────────
const pad = (n) => String(n).padStart(2, '0')
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)

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
function addDaysKey(k, n) {
  const d = new Date(k + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400e3)

/** Data de hoje no fuso da profissional ('YYYY-MM-DD'). */
function todayIn(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    const get = (t) => parts.find((p) => p.type === t)?.value
    const s = `${get('year')}-${get('month')}-${get('day')}`
    if (DATE_RE.test(s)) return s
  } catch (_) {}
  return new Date().toISOString().slice(0, 10)
}

// ── Preferencias (app_settings) ─────────────────────────────────────────────
function taxPct(settings) {
  const v = settings?.tax_reserve_pct
  const n = Math.round(Number(v))
  return v == null || !Number.isFinite(n) ? DEFAULT_TAX_PCT : clamp(n, 0, 60)
}
function mileageRate(settings) {
  const v = settings?.mileage_rate_cents
  const n = Math.round(Number(v))
  return v == null || !Number.isFinite(n) ? DEFAULT_MILEAGE_RATE : clamp(n, 0, 500)
}
function goalCents(settings) {
  const n = Math.round(Number(settings?.monthly_goal_cents))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── Leitura ─────────────────────────────────────────────────────────────────
const isSchemaError = (e) => ['42703', '42P01', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(e?.code)
  || /does not exist|could not find|relationship/i.test(e?.message || '')

/** Lê todas as páginas (o PostgREST corta em 1000 linhas). */
async function fetchAll(makeQuery) {
  const out = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: out, error: null }
}

function shapeApt(a) {
  const { ag_services, ag_ical_feeds, ...rest } = a
  return {
    ...rest,
    service_name: ag_services?.name || a.service_label || (ag_ical_feeds?.label ? `Limpeza · ${ag_ical_feeds.label}` : null),
    paid_cents: a.paid_cents ?? null,
    tip_cents: a.tip_cents ?? 0,
    paid_method: a.paid_method ?? null,
    source: a.source ?? (a.external_uid ? 'ical' : null),
    staff_id: a.staff_id ?? null,
  }
}

async function loadAppointments(ctx, fromIso, toIso, statuses = null) {
  if (aptColsAt > 0 && Date.now() - aptColsSince > COLS_RETRY_MS) aptColsAt = 0
  const start = aptColsAt
  for (let i = start; i < APT_COLS.length; i++) {
    const r = await fetchAll(() => {
      let q = ctx.supabase.from('ag_appointments').select(APT_COLS[i])
        .eq('provider_id', ctx.pid).gte('scheduled_for', fromIso).lt('scheduled_for', toIso)
      if (statuses) q = q.in('status', statuses)
      return q.order('scheduled_for', { ascending: true }).order('id', { ascending: true })
    })
    if (!r.error) {
      if (i !== start) { aptColsAt = i; aptColsSince = Date.now() }
      return r.data.map(shapeApt)
    }
    if (!isSchemaError(r.error)) throw new Error(r.error.message)
  }
  throw new Error('Não foi possível ler os agendamentos')
}

async function loadExpenses(ctx, from, to, categories = null) {
  const r = await fetchAll(() => {
    let q = ctx.supabase.from('ag_expenses').select(EXP_COLS)
      .eq('provider_id', ctx.pid).gte('spent_on', from).lte('spent_on', to)
    if (categories) q = q.in('category', categories)
    return q.order('spent_on', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true })
  })
  if (r.error) throw new Error(r.error.message)
  return r.data
}

async function loadMileage(ctx, from, to) {
  const r = await fetchAll(() => ctx.supabase.from('ag_mileage').select(MIL_COLS)
    .eq('provider_id', ctx.pid).gte('driven_on', from).lte('driven_on', to)
    .order('driven_on', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true }))
  if (r.error) throw new Error(r.error.message)
  return r.data.map((t) => ({ ...t, miles: Number(t.miles) || 0 }))
}

async function countMileage(ctx, from, to) {
  const { count, error } = await ctx.supabase.from('ag_mileage').select('id', { count: 'exact', head: true })
    .eq('provider_id', ctx.pid).gte('driven_on', from).lte('driven_on', to)
  if (error) throw new Error(error.message)
  return count || 0
}

/** Equipe (Premium). Tabela pode nao existir ainda: sem equipe. */
async function loadStaff(ctx) {
  const { data, error } = await ctx.supabase.from('ag_staff').select('id, name, color').eq('provider_id', ctx.pid)
  return error ? [] : (data || [])
}

/** Endereco das clientes (colunas da entrega clientes; sem elas, sem endereco). */
async function loadClientPlaces(ctx, ids) {
  if (!ids.length) return {}
  const { data, error } = await ctx.supabase.from('ag_clients').select('id, address_line, city, state')
    .eq('provider_id', ctx.pid).in('id', ids.slice(0, 200))
  if (error) return {}
  const out = {}
  for (const c of data || []) {
    const place = [c.address_line, c.city, c.state].filter(Boolean).join(', ')
    if (place) out[c.id] = place
  }
  return out
}

// ── Contas ──────────────────────────────────────────────────────────────────
const monthOf = (a) => String(a.scheduled_for).slice(0, 7)
const dayKeyOf = (a) => String(a.scheduled_for).slice(0, 10)

/** Dinheiro que entrou por este agendamento (sem gorjeta). */
function incomeOf(a) {
  if (a.status === 'completed') return Math.max(0, a.paid_cents != null ? Number(a.paid_cents) : (Number(a.total_cents) || 0))
  if (a.status === 'no_show' || a.status === 'canceled') {
    if (a.paid_cents != null) return Math.max(0, Number(a.paid_cents) || 0)
    // Falta com sinal pago: o sinal fica com a profissional
    return a.status === 'no_show' && a.deposit_paid ? Math.max(0, Number(a.deposit_cents) || 0) : 0
  }
  return 0
}
const tipOf = (a) => (['completed', 'no_show', 'canceled'].includes(a.status) ? Math.max(0, Number(a.tip_cents) || 0) : 0)
const methodOf = (a) => a.paid_method || a.payment_method || 'unknown'
const serviceOf = (a) => a.service_name || 'Sem serviço'

function digits(v) { return String(v || '').replace(/\D/g, '') }
/** Chave da cliente: id do cadastro, senão WhatsApp, senão nome. */
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

/** Lucro e imposto. Com dedução por milha, a gasolina não entra (o IRS não aceita os dois). */
function profit({ revenue, tips, expenses, gas, miles, rate, pct, gasExcluded }) {
  const income = revenue + tips
  const deduction = Math.round((Number(miles) || 0) * rate)
  const deductible = expenses - (gasExcluded ? gas : 0)
  const raw = income - deductible - deduction
  const taxable = Math.max(0, raw)
  return {
    net_cents: income - expenses,
    mileage_deduction_cents: deduction,
    taxable_raw_cents: raw,
    taxable_cents: taxable,
    tax_reserve_cents: Math.round((taxable * pct) / 100),
  }
}

function summarizeMonth(apts, month, today) {
  const daily = Array.from({ length: daysIn(month) }, (_, i) => ({ date: `${month}-${pad(i + 1)}`, cents: 0 }))
  const byMethod = {}
  const bySvc = new Map()
  const out = {
    revenue_cents: 0, tips_cents: 0, no_show_deposits_cents: 0,
    expected_cents: 0, expected_count: 0, unmarked_count: 0, unmarked_cents: 0,
    completed: 0, completed_cents: 0, no_shows: 0, cancellations: 0,
  }
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
      // Passou e ninguém marcou: não é previsto, é "esqueceu de marcar"
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
async function viewSummary(ctx, q) {
  const month = parseMonth(q.month) || ctx.today.slice(0, 7)
  const prev = addMonths(month, -1)
  const year = month.slice(0, 4)
  const finance = hasFeature(ctx.provider, 'finance')
  // Milhagem entra no bloco de lucro/imposto: sem 'finance', fica nula também
  const mileage = finance && hasFeature(ctx.provider, 'mileage')

  const [apts, expenses, trips, yearTrips] = await Promise.all([
    loadAppointments(ctx, monthStartIso(prev), monthStartIso(addMonths(month, 1))),
    finance ? loadExpenses(ctx, `${month}-01`, lastDay(month)) : null,
    mileage ? loadMileage(ctx, `${month}-01`, lastDay(month)) : null,
    mileage ? countMileage(ctx, `${year}-01-01`, `${year}-12-31`) : 0,
  ])

  const cur = apts.filter((a) => monthOf(a) === month)
  const before = apts.filter((a) => monthOf(a) === prev)
  const s = summarizeMonth(cur, month, ctx.today)

  // Mês corrente: compara com o mesmo pedaço do mês passado (dia 1 até hoje)
  let previousSamePeriod = null
  if (ctx.today.slice(0, 7) === month) {
    const day = Number(ctx.today.slice(8, 10))
    previousSamePeriod = sumIncome(before, (a) => Number(dayKeyOf(a).slice(8, 10)) <= day)
  }

  const pct = taxPct(ctx.settings)
  const rate = mileageRate(ctx.settings)
  const out = {
    month,
    today: ctx.today,
    ...s,
    previous_month: prev,
    previous_revenue_cents: sumIncome(before),
    previous_same_period_cents: previousSamePeriod,
    goal_cents: goalCents(ctx.settings),
    finance_locked: !finance,
    mileage_locked: !hasFeature(ctx.provider, 'mileage'),
    tax_reserve_pct: pct,
    mileage_rate_cents: rate,
    expenses_cents: null,
    expenses_by_category: null,
    net_cents: null,
    taxable_cents: null,
    tax_reserve_cents: null,
    gas_excluded: false,
    miles: null,
    trips: null,
    mileage_deduction_cents: null,
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

async function viewExpenses(ctx, q) {
  const month = parseMonth(q.month) || ctx.today.slice(0, 7)
  const prev = addMonths(month, -1)
  const [expenses, prevFixed] = await Promise.all([
    loadExpenses(ctx, `${month}-01`, lastDay(month)),
    loadExpenses(ctx, `${prev}-01`, lastDay(prev), FIXED_CATEGORIES),
  ])
  const byCat = new Map()
  let total = 0
  for (const e of expenses) {
    total += e.amount_cents
    const c = byCat.get(e.category) || { category: e.category, cents: 0, count: 0 }
    c.cents += e.amount_cents; c.count++
    byCat.set(e.category, c)
  }
  // Mês sem aluguel/celular/seguro e o anterior com: oferece repetir
  const hasFixed = expenses.some((e) => FIXED_CATEGORIES.includes(e.category))
  const fixed = !hasFixed && prevFixed.length
    ? {
        from_month: prev,
        count: prevFixed.length,
        cents: prevFixed.reduce((t, e) => t + e.amount_cents, 0),
        categories: [...new Set(prevFixed.map((e) => e.category))],
      }
    : null
  return {
    month,
    expenses,
    total_cents: total,
    count: expenses.length,
    by_category: [...byCat.values()].sort((a, b) => b.cents - a.cents),
    fixed_suggestion: fixed,
  }
}

async function viewExpense(ctx, q) {
  const id = String(q.id || '')
  if (!UUID_RE.test(id)) fail(400, 'Despesa inválida')
  const { data, error } = await ctx.supabase.from('ag_expenses').select(EXP_COLS)
    .eq('id', id).eq('provider_id', ctx.pid).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) fail(404, 'Despesa não encontrada')
  return { expense: data }
}

async function viewMileage(ctx, q) {
  const month = parseMonth(q.month) || ctx.today.slice(0, 7)
  const year = month.slice(0, 4)
  const rate = mileageRate(ctx.settings)
  const [yearTrips, completed] = await Promise.all([
    loadMileage(ctx, `${year}-01-01`, `${year}-12-31`),
    loadAppointments(ctx, monthStartIso(month), monthStartIso(addMonths(month, 1)), ['completed']),
  ])
  const trips = yearTrips.filter((t) => String(t.driven_on).slice(0, 7) === month)
  const miles = Math.round(trips.reduce((t, x) => t + x.miles, 0) * 10) / 10
  const yearMiles = Math.round(yearTrips.reduce((t, x) => t + x.miles, 0) * 10) / 10

  // Atendimentos do mês ainda sem viagem: registra com 1 toque
  const linked = new Set(yearTrips.map((t) => t.appointment_id).filter(Boolean))
  const open = completed.filter((a) => !linked.has(a.id)).reverse().slice(0, 20)
  const places = await loadClientPlaces(ctx, [...new Set(open.map((a) => a.client_id).filter(Boolean))])
  const suggestions = open.map((a) => ({
    appointment_id: a.id,
    date: dayKeyOf(a),
    client_name: a.client_name || null,
    service_name: a.service_name || null,
    place: (a.client_id && places[a.client_id]) || null,
  }))

  return {
    month,
    trips,
    total_miles: miles,
    rate_cents: rate,
    deduction_cents: Math.round(miles * rate),
    year: Number(year),
    year_trips: yearTrips.length,
    year_miles: yearMiles,
    year_deduction_cents: Math.round(yearMiles * rate),
    suggestions,
  }
}

async function viewYear(ctx, q) {
  gate(ctx.provider, 'finance')
  const year = parseYear(q.year) || Number(ctx.today.slice(0, 4))
  const mileage = hasFeature(ctx.provider, 'mileage')
  const pct = taxPct(ctx.settings)
  const rate = mileageRate(ctx.settings)
  const [apts, expenses, trips] = await Promise.all([
    loadAppointments(ctx, `${year}-01-01T00:00:00.000Z`, `${year + 1}-01-01T00:00:00.000Z`),
    loadExpenses(ctx, `${year}-01-01`, `${year}-12-31`),
    mileage ? loadMileage(ctx, `${year}-01-01`, `${year}-12-31`) : [],
  ])

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
    return {
      month: m.month, revenue_cents: m.revenue_cents, tips_cents: m.tips_cents, completed: m.completed,
      expenses_cents: m.expenses_cents, miles, ...p,
    }
  })

  const sum = (k) => months.reduce((t, m) => t + (m[k] || 0), 0)
  const totalTaxable = Math.max(0, sum('taxable_raw_cents'))
  const totals = {
    revenue_cents: sum('revenue_cents'),
    tips_cents: sum('tips_cents'),
    completed: sum('completed'),
    expenses_cents: sum('expenses_cents'),
    net_cents: sum('net_cents'),
    miles: Math.round(sum('miles') * 10) / 10,
    mileage_deduction_cents: sum('mileage_deduction_cents'),
    taxable_cents: totalTaxable,
    tax_reserve_cents: Math.round((totalTaxable * pct) / 100),
  }

  // Pagamentos trimestrais estimados do IRS (1040-ES): períodos e vencimentos
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
    year,
    months: months.map(({ taxable_raw_cents, ...m }) => m),
    totals,
    quarters,
    tax_reserve_pct: pct,
    mileage_rate_cents: rate,
    mileage_locked: !mileage,
    gas_excluded: gasExcluded && expenses.some((e) => e.category === 'gasolina'),
  }
}

/** Período do relatório/CSV: mês (padrão) ou ano. */
function reportPeriod(ctx, q) {
  const y = parseYear(q.year)
  if (y && !q.month) {
    return { kind: 'year', year: y, from: `${y}-01-01`, to: `${y}-12-31`, fromIso: `${y}-01-01T00:00:00.000Z`, toIso: `${y + 1}-01-01T00:00:00.000Z` }
  }
  const m = parseMonth(q.month) || ctx.today.slice(0, 7)
  return { kind: 'month', month: m, from: `${m}-01`, to: lastDay(m), fromIso: monthStartIso(m), toIso: monthStartIso(addMonths(m, 1)) }
}

async function viewReport(ctx, q) {
  gate(ctx.provider, 'reports')
  const period = reportPeriod(ctx, q)
  const [apts, staff] = await Promise.all([
    loadAppointments(ctx, period.fromIso, period.toIso),
    loadStaff(ctx),
  ])

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
      const c = byClient.get(ck) || { key: ck, client_id: a.client_id || null, name: a.client_name || 'Sem nome', count: 0, cents: 0, tips_cents: 0 }
      c.count++; c.cents += inc; c.tips_cents += tip
      if (a.client_name) c.name = a.client_name
      byClient.set(ck, c)
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

  // Clientes novas x recorrentes: nova = nenhum atendimento realizado antes do período
  const prior = new Set()
  if (byClient.size) {
    const r = await fetchAll(() => ctx.supabase.from('ag_appointments').select('id, client_id, client_whatsapp, client_name')
      .eq('provider_id', ctx.pid).eq('status', 'completed').lt('scheduled_for', period.fromIso)
      .order('scheduled_for', { ascending: true }).order('id', { ascending: true }))
    if (r.error) throw new Error(r.error.message)
    for (const a of r.data) { const k = clientKey(a); if (k) prior.add(k) }
  }
  const clients = { new_count: 0, returning_count: 0, new_cents: 0, returning_cents: 0 }
  for (const c of byClient.values()) {
    if (prior.has(c.key)) { clients.returning_count++; clients.returning_cents += c.cents }
    else { clients.new_count++; clients.new_cents += c.cents }
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
    top_clients: [...byClient.values()].sort((a, b) => b.cents - a.cents || b.count - a.count).slice(0, 10)
      .map(({ key, ...c }) => c),
    by_staff: byStaffOut,
    by_weekday: byWeekday,
    by_hour: byHour,
    by_source: bySource.size > 1 || !bySource.has('unknown') ? [...bySource.values()].sort((a, b) => b.count - a.count) : null,
    by_month: byMonth,
    clients,
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────
const BOM = '﻿'
function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
// Texto livre (nome, descrição): neutraliza fórmula no Excel (=, +, -, @)
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
function toCsv(header, rows) {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function exportRange(ctx, q) {
  if (q.from || q.to) {
    const from = parseDate(q.from), to = parseDate(q.to)
    if (!from || !to) fail(400, 'Período inválido. Use AAAA-MM-DD')
    if (from > to) fail(400, 'A data inicial precisa ser antes da final')
    if (daysBetween(from, to) > MAX_EXPORT_DAYS) fail(400, 'Exporte no máximo 2 anos de cada vez')
    return { from, to, label: `${from}_${to}` }
  }
  const p = reportPeriod(ctx, q)
  return { from: p.from, to: p.to, label: p.kind === 'year' ? String(p.year) : p.month }
}

async function buildExport(ctx, q) {
  gate(ctx.provider, 'reports')
  const kind = String(q.kind || '')
  const lang = q.lang === 'en' ? 'en' : 'pt'
  const en = lang === 'en'
  const r = exportRange(ctx, q)
  const fromIso = `${r.from}T00:00:00.000Z`
  const toIso = `${addDaysKey(r.to, 1)}T00:00:00.000Z`

  if (kind === 'appointments') {
    const [apts, staff] = await Promise.all([loadAppointments(ctx, fromIso, toIso), loadStaff(ctx)])
    const staffById = Object.fromEntries(staff.map((s) => [s.id, s.name]))
    const header = en
      ? ['Date', 'Time', 'Client', 'WhatsApp', 'Email', 'Service', 'Status', 'Service price', 'Amount received', 'Tip', 'Payment method', 'Deposit', 'Deposit paid', 'Staff', 'Source', 'ID']
      : ['Data', 'Hora', 'Cliente', 'WhatsApp', 'E-mail', 'Serviço', 'Status', 'Valor do serviço', 'Valor recebido', 'Gorjeta', 'Forma de pagamento', 'Sinal', 'Sinal pago', 'Profissional', 'Origem', 'ID']
    const rows = apts.map((a) => {
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
    return { csv: toCsv(header, rows), name: `agendapro-${en ? 'appointments' : 'agendamentos'}-${r.label}.csv` }
  }

  if (kind === 'expenses') {
    const list = (await loadExpenses(ctx, r.from, r.to)).reverse()
    const header = en
      ? ['Date', 'Category', 'Description', 'Amount', 'Payment method', 'Schedule C (suggested)', 'Receipt']
      : ['Data', 'Categoria', 'Descrição', 'Valor', 'Forma de pagamento', 'Schedule C (sugestão)', 'Comprovante']
    const rows = list.map((e) => [
      e.spent_on, CATEGORY_LABEL[lang][e.category] || e.category, txt(e.description), usd(e.amount_cents),
      e.payment_method ? (METHOD_LABEL[lang][e.payment_method] || txt(e.payment_method)) : '',
      SCHEDULE_C[e.category] || '', e.receipt_url || '',
    ])
    return { csv: toCsv(header, rows), name: `agendapro-${en ? 'expenses' : 'despesas'}-${r.label}.csv` }
  }

  if (kind === 'mileage') {
    const rate = mileageRate(ctx.settings)
    const list = (await loadMileage(ctx, r.from, r.to)).reverse()
    const header = en
      ? ['Date', 'Miles', 'Business purpose', 'From', 'To', 'Rate per mile', 'Estimated deduction']
      : ['Data', 'Milhas', 'Motivo', 'De', 'Para', 'Taxa por milha', 'Dedução estimada']
    const rows = list.map((t) => [
      t.driven_on, t.miles.toFixed(1), txt(t.purpose), txt(t.from_label), txt(t.to_label),
      usd(rate), usd(Math.round(t.miles * rate)),
    ])
    return { csv: toCsv(header, rows), name: `agendapro-${en ? 'mileage' : 'milhagem'}-${r.label}.csv` }
  }

  if (kind === 'clients') {
    const CL_COLS = [
      'id, name, whatsapp, email, city, state, birthday_md, language, total_visits, total_spent_cents, first_visit_at, last_visit_at, archived',
      'id, name, whatsapp, email, total_visits, total_spent_cents, first_visit_at, last_visit_at',
    ]
    let clients = null
    for (const cols of CL_COLS) {
      const res = await fetchAll(() => ctx.supabase.from('ag_clients').select(cols).eq('provider_id', ctx.pid)
        .order('name', { ascending: true }).order('id', { ascending: true }))
      if (!res.error) { clients = res.data; break }
      if (!isSchemaError(res.error)) throw new Error(res.error.message)
    }
    if (!clients) throw new Error('Não foi possível ler as clientes')
    // Atendimentos e gasto dentro do período escolhido
    const apts = await loadAppointments(ctx, fromIso, toIso, ['completed'])
    const inPeriod = {}
    for (const a of apts) {
      if (!a.client_id) continue
      const c = inPeriod[a.client_id] || (inPeriod[a.client_id] = { count: 0, cents: 0 })
      c.count++; c.cents += incomeOf(a)
    }
    const header = en
      ? ['Name', 'WhatsApp', 'Email', 'City', 'State', 'Birthday (MM-DD)', 'Language', 'Visits in period', 'Spent in period', 'Total visits', 'Total spent', 'First visit', 'Last visit']
      : ['Nome', 'WhatsApp', 'E-mail', 'Cidade', 'Estado', 'Aniversário (MM-DD)', 'Idioma', 'Atendimentos no período', 'Gasto no período', 'Atendimentos (total)', 'Gasto total', 'Primeira visita', 'Última visita']
    const rows = clients.filter((c) => c.archived !== true).map((c) => [
      txt(c.name), phoneOut(c.whatsapp), txt(c.email), txt(c.city), txt(c.state), c.birthday_md || '', c.language || '',
      inPeriod[c.id]?.count || 0, usd(inPeriod[c.id]?.cents || 0), c.total_visits || 0, usd(c.total_spent_cents || 0),
      c.first_visit_at ? String(c.first_visit_at).slice(0, 10) : '', c.last_visit_at ? String(c.last_visit_at).slice(0, 10) : '',
    ])
    return { csv: toCsv(header, rows), name: `agendapro-${en ? 'clients' : 'clientes'}-${r.label}.csv` }
  }

  fail(400, 'Tipo de exportação inválido')
}

// ── Escrita ─────────────────────────────────────────────────────────────────
function safeUrl(v) {
  const s = clip(v, 500)
  if (!s) return null
  return /^https:\/\//i.test(s) ? s : null
}

function readExpense(b, partial, today) {
  const out = {}
  if (!partial || b.spent_on !== undefined) {
    const d = parseDate(b.spent_on)
    if (!d) return { error: 'Data inválida' }
    if (d > addDaysKey(today, 366)) return { error: 'Essa data está muito no futuro' }
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
    if (d > addDaysKey(today, 1)) return { error: 'Registre só viagens que já aconteceram' }
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

async function ownAppointmentId(ctx, v) {
  if (v == null || v === '') return null
  const id = String(v)
  if (!UUID_RE.test(id)) fail(400, 'Atendimento inválido')
  const { data } = await ctx.supabase.from('ag_appointments').select('id').eq('id', id).eq('provider_id', ctx.pid).maybeSingle()
  if (!data) fail(404, 'Atendimento não encontrado')
  return id
}

async function handlePost(ctx, b, res) {
  const action = b.action
  const sb = ctx.supabase
  const now = new Date().toISOString()

  if (action === 'expense_create' || action === 'expense_update' || action === 'expense_delete' || action === 'expense_copy') {
    gate(ctx.provider, 'finance')

    if (action === 'expense_create') {
      const r = readExpense(b, false, ctx.today)
      if (r.error) fail(400, r.error)
      const { data, error } = await sb.from('ag_expenses').insert({ provider_id: ctx.pid, ...r.fields }).select(EXP_COLS).single()
      if (error) throw new Error(error.message)
      return res.status(201).json({ ok: true, expense: data })
    }

    if (action === 'expense_copy') {
      const from = parseMonth(b.from_month), to = parseMonth(b.to_month)
      if (!from || !to || from === to) fail(400, 'Meses inválidos')
      const [src, dest] = await Promise.all([
        loadExpenses(ctx, `${from}-01`, lastDay(from), FIXED_CATEGORIES),
        loadExpenses(ctx, `${to}-01`, lastDay(to), FIXED_CATEGORIES),
      ])
      const seen = new Set(dest.map((e) => `${e.category}|${e.amount_cents}|${e.description || ''}`))
      const maxDay = daysIn(to)
      const rows = []
      for (const e of src.slice(0, 50)) {
        const k = `${e.category}|${e.amount_cents}|${e.description || ''}`
        if (seen.has(k)) continue
        seen.add(k)
        const day = Math.min(Number(String(e.spent_on).slice(8, 10)) || 1, maxDay)
        rows.push({
          provider_id: ctx.pid, spent_on: `${to}-${pad(day)}`, category: e.category,
          description: e.description, amount_cents: e.amount_cents, payment_method: e.payment_method,
        })
      }
      if (!rows.length) return res.status(200).json({ ok: true, created: 0, expenses: [] })
      const { data, error } = await sb.from('ag_expenses').insert(rows).select(EXP_COLS)
      if (error) throw new Error(error.message)
      return res.status(201).json({ ok: true, created: (data || []).length, expenses: data || [] })
    }

    const id = String(b.id || '')
    if (!UUID_RE.test(id)) fail(400, 'Despesa inválida')
    const { data: cur } = await sb.from('ag_expenses').select('id').eq('id', id).eq('provider_id', ctx.pid).maybeSingle()
    if (!cur) fail(404, 'Despesa não encontrada')

    if (action === 'expense_update') {
      const r = readExpense(b, true, ctx.today)
      if (r.error) fail(400, r.error)
      const { data, error } = await sb.from('ag_expenses').update({ ...r.fields, updated_at: now })
        .eq('id', id).eq('provider_id', ctx.pid).select(EXP_COLS).single()
      if (error) throw new Error(error.message)
      return res.status(200).json({ ok: true, expense: data })
    }

    const { error } = await sb.from('ag_expenses').delete().eq('id', id).eq('provider_id', ctx.pid)
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true })
  }

  if (action === 'mileage_create' || action === 'mileage_update' || action === 'mileage_delete') {
    gate(ctx.provider, 'mileage')
    const shape = (t) => ({ ...t, miles: Number(t.miles) || 0 })

    if (action === 'mileage_create') {
      const r = readTrip(b, false, ctx.today)
      if (r.error) fail(400, r.error)
      const appointment_id = await ownAppointmentId(ctx, b.appointment_id)
      const { data, error } = await sb.from('ag_mileage').insert({ provider_id: ctx.pid, ...r.fields, appointment_id })
        .select(MIL_COLS).single()
      if (error) throw new Error(error.message)
      return res.status(201).json({ ok: true, trip: shape(data) })
    }

    const id = String(b.id || '')
    if (!UUID_RE.test(id)) fail(400, 'Viagem inválida')
    const { data: cur } = await sb.from('ag_mileage').select('id').eq('id', id).eq('provider_id', ctx.pid).maybeSingle()
    if (!cur) fail(404, 'Viagem não encontrada')

    if (action === 'mileage_update') {
      const r = readTrip(b, true, ctx.today)
      if (r.error) fail(400, r.error)
      const patch = { ...r.fields, updated_at: now }
      if (b.appointment_id !== undefined) patch.appointment_id = await ownAppointmentId(ctx, b.appointment_id)
      const { data, error } = await sb.from('ag_mileage').update(patch)
        .eq('id', id).eq('provider_id', ctx.pid).select(MIL_COLS).single()
      if (error) throw new Error(error.message)
      return res.status(200).json({ ok: true, trip: shape(data) })
    }

    const { error } = await sb.from('ag_mileage').delete().eq('id', id).eq('provider_id', ctx.pid)
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true })
  }

  fail(400, 'Ação inválida')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    res.setHeader('Cache-Control', 'private, no-store')

    const ctx = {
      supabase,
      provider,
      pid: provider.id,
      settings: provider.app_settings || {},
      today: todayIn(provider.timezone),
    }

    if (req.method === 'GET') {
      const q = req.query || {}
      const view = String(q.view || 'summary')
      if (view === 'summary') return res.status(200).json(await viewSummary(ctx, q))
      if (view === 'expenses') return res.status(200).json(await viewExpenses(ctx, q))
      if (view === 'expense') return res.status(200).json(await viewExpense(ctx, q))
      if (view === 'mileage') return res.status(200).json(await viewMileage(ctx, q))
      if (view === 'year') return res.status(200).json(await viewYear(ctx, q))
      if (view === 'report') return res.status(200).json(await viewReport(ctx, q))
      if (view === 'export') {
        const { csv, name } = await buildExport(ctx, q)
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        return res.status(200).send(csv)
      }
      return res.status(400).json({ error: 'Visão inválida' })
    }

    return await handlePost(ctx, req.body || {}, res)
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json(e.body)
    return res.status(500).json({ error: e.message })
  }
}

// Funcoes puras expostas pros testes locais (node -e)
export const _test = {
  parseMonth, parseDate, addMonths, daysIn, lastDay, addDaysKey, daysBetween, todayIn, incomeOf, tipOf, profit,
  summarizeMonth, clientKey, csvCell, txt, toCsv, phoneOut, readExpense, readTrip, taxPct, mileageRate,
  viewSummary, viewExpenses, viewExpense, viewMileage, viewYear, viewReport, buildExport, handlePost, HttpError,
  resetColumns: () => { aptColsAt = 0; aptColsSince = 0 },
}
