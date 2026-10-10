/**
 * Orçamentos e faturas (WorkPro / AgendaPro) — funções compartilhadas.
 * NÃO é rota (subdir _lib não vira endpoint Vercel).
 *
 * Quem usa: api/agenda/documents.js (profissional), api/agenda/doc-public.js (cliente
 * pelo link /d/<token>), api/agenda/quote-requests.js, api/stripe/webhook.js e
 * api/cron/agenda-documents.js.
 *
 *   shapeDoc(row, { today?, withSignature? })  → Doc do CONTRACT (balance_cents, public_url,
 *                                                signed_hash, consent_at). withSignature (?id) traz
 *                                                também accepted_signature e signed_snapshot.
 *                                                Com today ('YYYY-MM-DD' no fuso dela), o status
 *                                                sai efetivo (fatura vencida → overdue, orçamento
 *                                                vencido → expired) mesmo antes do cron gravar.
 *   publicDoc(doc)                             → Doc sem campos internos (página da cliente)
 *   newToken()                                 → segredo do link /d/<token>
 *   saveDocument(supabase, provider, input, { existing?, extra?, channel?, eventDetail? })
 *        → { ok: true, document, items } | { ok: false, status, body: { error, code? } }
 *        valida, recalcula (computeTotals), numera (ag_next_doc_seq), grava documento + itens + evento.
 *        extra (só criação, uso interno): { quote_id, stage_label }.
 *        Fatura ligada a atendimento: o que a cliente já pagou nele vira pagamento da fatura
 *        (creditFromAppointment, metadata.source 'appointment'), pra não cobrar de novo.
 *   recomputeInvoice(supabase, docId, { provider?, providerId? })
 *        → { document, previous_status, status, amount_paid_cents, became_paid } | null
 *        soma ag_payments (type 'invoice', status 'paid': reembolsado 'refunded' não conta) e acerta
 *        status/paid_at. Gravação condicionada (trava otimista) e sem regravar o que já está certo.
 *   addEvent(supabase, { id, provider_id }, type, channel?, detail?)   best effort
 *   docMessage(doc, provider, publicUrl, { reminder? })  → texto pronto pra WhatsApp/SMS/e-mail
 *   sendDocEmail(supabase, doc, provider, 'send'|'reminder') → { ok, skipped? }
 *   docEmailDailyCap(provider) / countDocEmails(supabase, providerId, sinceIso)
 *        teto diário de e-mails de documento por profissional (eventos sent/reminder com email_sent).
 *   emailHidesBrand(provider) → só assinatura paga ativa do Premium tira a marca do e-mail.
 *
 * Conta dos valores: sempre computeTotals de ./docCalc.js (nunca reimplementar aqui).
 * Datas de documento ('YYYY-MM-DD') são do calendário da profissional; paid_at/sent_at são
 * instantes reais (timestamptz) e viram data pelo fuso dela (dateKeyIn).
 */
import crypto from 'node:crypto'
import { computeTotals, docNumber, invoiceStatus, cleanQty, cleanPct, UNITS, ITEM_KINDS } from './docCalc.js'
import { normalizePhone } from './phone.js'
import { hasFeature, effectivePlan } from './agendaPlans.js'
import { sendTransactional } from './mailer.js'
import { escapeHtml } from './emailShell.js'

export const DOC_KINDS = ['quote', 'invoice']
export const DOC_LANGS = ['pt', 'en', 'es']
export const QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted']
export const INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void']
export const PAY_METHODS = ['zelle', 'cash', 'check', 'card', 'ach', 'venmo', 'cashapp', 'other']
export const SEND_CHANNELS = ['whatsapp', 'email', 'sms', 'link']
export const EVENT_CHANNELS = ['whatsapp', 'email', 'sms', 'link', 'app', 'stripe', 'cron']
export const MAX_ITEMS = 200
export const MAX_PHOTOS = 12
export const MAX_UNIT_PRICE_CENTS = 100000000      // US$ 1.000.000 por unidade
export const MAX_DOC_CENTS = 1000000000            // US$ 10.000.000 por documento (cabe no int do banco)
export const DEFAULT_DUE_DAYS = 14                 // vencimento padrão sem doc_defaults.due_days (igual ao app)

// E-mail de documento sai pelo nosso domínio: teto por profissional (24h) e por documento
export const DOC_EMAIL_DAILY = { trial: 20, paid: 100 }
export const DOC_EMAIL_PER_DOC_DAY = 3

// Colunas do documento (a assinatura desenhada e a cópia assinada são pesadas: só no detalhe)
export const DOC_COLS = 'id, provider_id, kind, seq, number, status, client_id, client_name, client_email, client_phone, client_address, title, job_address, language, issue_date, due_date, valid_until, subtotal_cents, discount_pct, discount_cents, tax_rate_bps, tax_cents, total_cents, deposit_pct, deposit_cents, amount_paid_cents, notes, terms, payment_instructions, internal_notes, photos, stage_label, public_token, quote_id, appointment_id, quote_request_id, sent_at, viewed_at, accepted_at, accepted_name, declined_at, decline_reason, paid_at, voided_at, last_reminder_at, reminders_sent, signed_hash, consent_at, created_at, updated_at'
export const DOC_COLS_FULL = DOC_COLS + ', accepted_signature, signed_snapshot'
export const ITEM_COLS = 'id, document_id, position, catalog_item_id, kind, description, quantity, unit, unit_price_cents, taxable, line_total_cents'
export const EVENT_COLS = 'id, type, channel, detail, created_at'
export const PAYMENT_COLS = 'id, amount_cents, method, paid_at, created_at, metadata, stripe_session_id, stripe_payment_intent_id, status, document_id'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LEGACY_ERR = /column|relationship|schema cache|does not exist/i

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const clip = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null)
/** Texto com quebras de linha (notas, condições): tira caractere de controle e corta. */
export function cleanText(v, n) {
  if (v == null) return null
  const s = String(v).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n').trim().slice(0, n)
  return s || null
}
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null)
export const isUuid = (v) => UUID_RE.test(String(v || ''))
export const isEmail = (v) => EMAIL_RE.test(String(v || ''))

// ── Datas ───────────────────────────────────────────────────────────────────
/** 'YYYY-MM-DD' válido (2000–2100) → a própria string; senão null. */
export function parseDateKey(v) {
  const s = String(v ?? '').trim().slice(0, 10)
  if (!DATE_RE.test(s)) return null
  const d = new Date(s + 'T12:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  const y = Number(s.slice(0, 4))
  return y >= 2000 && y <= 2100 ? s : null
}

export function addDaysKey(key, n) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const diffDaysKey = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400e3)

/** 'YYYY-MM' + n meses. */
export function addMonthsKey(month, n) {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

const fmtCache = new Map()
function dayFormatter(tz) {
  const key = tz || 'America/New_York'
  if (!fmtCache.has(key)) {
    let f
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: key, year: 'numeric', month: '2-digit', day: '2-digit' })
    } catch (_) {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    }
    fmtCache.set(key, f)
  }
  return fmtCache.get(key)
}

/** Data ('YYYY-MM-DD') de um instante no fuso da profissional. */
export function dateKeyIn(tz, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  try {
    const parts = dayFormatter(tz).formatToParts(d)
    const g = (t) => parts.find((p) => p.type === t)?.value
    const s = `${g('year')}-${g('month')}-${g('day')}`
    if (DATE_RE.test(s)) return s
  } catch (_) {}
  return d.toISOString().slice(0, 10)
}

/** Diferença (ms) entre o relógio do fuso e o UTC num instante. */
function tzOffsetMs(tz, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date)
    const g = (t) => Number(parts.find((p) => p.type === t)?.value)
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
    return asUtc - Math.floor(date.getTime() / 1000) * 1000
  } catch (_) {
    return 0
  }
}

/** Instante (ISO) da meia-noite de 'YYYY-MM-DD' no fuso da profissional. */
export function zonedDayStartIso(key, tz) {
  const guess = Date.parse(key + 'T00:00:00Z')
  let t = guess - tzOffsetMs(tz, new Date(guess))
  t = guess - tzOffsetMs(tz, new Date(t))      // segunda passada acerta a virada do horário de verão
  return new Date(t).toISOString()
}

export const todayFor = (provider, now = new Date()) => dateKeyIn(provider?.timezone, now)

// ── Formatação (idioma do documento) ────────────────────────────────────────
const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-US' }
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const langOf = (l) => (DOC_LANGS.includes(l) ? l : 'en')

export function fmtMoney(cents, lang = 'en') {
  const v = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat(LOCALES[langOf(lang)], { style: 'currency', currency: 'USD' }).format(v)
  } catch (_) {
    return '$' + v.toFixed(2)
  }
}

/** 'YYYY-MM-DD' → 'Oct 15, 2026' (en) ou '15/10/2026' (pt/es). */
export function fmtDate(key, lang = 'en') {
  const k = dateOnly(key)
  if (!k || !DATE_RE.test(k)) return ''
  const [y, m, d] = k.split('-')
  if (langOf(lang) === 'en') return `${MONTHS_EN[Number(m) - 1]} ${Number(d)}, ${y}`
  return `${d}/${m}/${y}`
}

/** 33.33 → '33,33' (pt/es) ou '33.33' (en); 30 → '30'. */
export function fmtPct(p, lang = 'en') {
  const s = String(Math.round(Number(p) * 100) / 100)
  return langOf(lang) === 'en' ? s : s.replace('.', ',')
}

// ── Link público e formatos ─────────────────────────────────────────────────
export const appUrl = () => String(process.env.APP_URL || 'https://brasilconnectusa.com').replace(/\/+$/, '')
export const publicUrlFor = (token) => (token ? `${appUrl()}/d/${token}` : null)

/** Segredo do link da cliente (192 bits). */
export function newToken() {
  return crypto.randomBytes(24).toString('base64url')
}

/** Status que a profissional vê hoje (o cron grava overdue/expired uma vez por dia). */
export function effectiveStatus(row, today) {
  if (!row) return null
  if (!today) return row.status
  if (row.kind === 'invoice') {
    if (toInt(row.total_cents) <= 0) return row.status
    return invoiceStatus(row, today)
  }
  if (row.kind === 'quote' && (row.status === 'sent' || row.status === 'viewed')
    && row.valid_until && dateOnly(row.valid_until) < today) return 'expired'
  return row.status
}

export function balanceOf(row) {
  if (!row || (row.kind === 'invoice' && row.status === 'void')) return 0
  return Math.max(0, toInt(row.total_cents) - toInt(row.amount_paid_cents))
}

export function shapeDoc(row, opts = {}) {
  if (!row) return null
  const doc = {
    id: row.id,
    kind: row.kind,
    number: row.number,
    status: opts.today ? effectiveStatus(row, opts.today) : row.status,
    client_id: row.client_id ?? null,
    client_name: row.client_name || '',
    client_email: row.client_email || null,
    client_phone: row.client_phone || null,
    client_address: row.client_address || null,
    title: row.title || null,
    job_address: row.job_address || null,
    language: langOf(row.language),
    issue_date: dateOnly(row.issue_date),
    due_date: dateOnly(row.due_date),
    valid_until: dateOnly(row.valid_until),
    subtotal_cents: toInt(row.subtotal_cents),
    discount_pct: numOrNull(row.discount_pct),
    discount_cents: toInt(row.discount_cents),
    tax_rate_bps: toInt(row.tax_rate_bps),
    tax_cents: toInt(row.tax_cents),
    total_cents: toInt(row.total_cents),
    deposit_pct: numOrNull(row.deposit_pct),
    deposit_cents: toInt(row.deposit_cents),
    amount_paid_cents: toInt(row.amount_paid_cents),
    balance_cents: balanceOf(row),
    notes: row.notes || null,
    terms: row.terms || null,
    payment_instructions: row.payment_instructions || null,
    internal_notes: row.internal_notes || null,
    photos: Array.isArray(row.photos) ? row.photos : [],
    stage_label: row.stage_label || null,
    quote_id: row.quote_id ?? null,
    appointment_id: row.appointment_id ?? null,
    quote_request_id: row.quote_request_id ?? null,
    sent_at: row.sent_at || null,
    viewed_at: row.viewed_at || null,
    accepted_at: row.accepted_at || null,
    accepted_name: row.accepted_name || null,
    declined_at: row.declined_at || null,
    decline_reason: row.decline_reason || null,
    paid_at: row.paid_at || null,
    voided_at: row.voided_at || null,
    reminders_sent: toInt(row.reminders_sent),
    signed_hash: row.signed_hash || null,
    consent_at: row.consent_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    public_url: publicUrlFor(row.public_token),
  }
  if (opts.withSignature) {
    doc.accepted_signature = row.accepted_signature || null
    doc.signed_snapshot = row.signed_snapshot && typeof row.signed_snapshot === 'object' ? row.signed_snapshot : null
  }
  return doc
}

// Campos que a cliente nunca vê na página pública
const PUBLIC_OMIT = ['internal_notes', 'client_id', 'appointment_id', 'quote_request_id', 'reminders_sent', 'accepted_signature', 'signed_snapshot']
export function publicDoc(doc) {
  if (!doc) return null
  const out = { ...doc }
  for (const k of PUBLIC_OMIT) delete out[k]
  return out
}

export function shapeItem(r) {
  return {
    id: r.id,
    position: toInt(r.position),
    catalog_item_id: r.catalog_item_id ?? null,
    kind: ITEM_KINDS.includes(r.kind) ? r.kind : 'service',
    description: r.description || '',
    quantity: Number(r.quantity) || 0,
    unit: r.unit || 'un',
    unit_price_cents: toInt(r.unit_price_cents),
    taxable: r.taxable === true,
    line_total_cents: toInt(r.line_total_cents),
  }
}

export function shapePayment(p) {
  const meta = p.metadata && typeof p.metadata === 'object' ? p.metadata : {}
  const stripe = !!(p.stripe_session_id || p.stripe_payment_intent_id || meta.source === 'stripe')
  return {
    id: p.id,
    amount_cents: toInt(p.amount_cents),
    method: p.method || meta.method || (stripe ? 'card' : 'other'),
    paid_at: p.paid_at || p.created_at || null,
    note: meta.note || null,
    source: stripe ? 'stripe' : 'manual',
  }
}

export function shapeEvent(e) {
  return {
    id: e.id,
    type: e.type,
    channel: e.channel || null,
    detail: e.detail && typeof e.detail === 'object' ? e.detail : {},
    created_at: e.created_at,
  }
}

// ── Leitura ─────────────────────────────────────────────────────────────────
export async function loadItems(supabase, providerId, docId) {
  const { data, error } = await supabase.from('ag_document_items').select(ITEM_COLS)
    .eq('document_id', docId).eq('provider_id', providerId)
    .order('position', { ascending: true }).order('id', { ascending: true }).limit(MAX_ITEMS + 50)
  if (error) throw new Error(error.message)
  return (data || []).map(shapeItem)
}

export async function loadPayments(supabase, providerId, docId) {
  const { data, error } = await supabase.from('ag_payments').select(PAYMENT_COLS)
    .eq('provider_id', providerId).eq('document_id', docId).eq('type', 'invoice').eq('status', 'paid')
    .order('paid_at', { ascending: true }).limit(500)
  if (error) throw new Error(error.message)
  return (data || []).map(shapePayment)
}

export async function loadEvents(supabase, providerId, docId) {
  const { data, error } = await supabase.from('ag_document_events').select(EVENT_COLS)
    .eq('document_id', docId).eq('provider_id', providerId)
    .order('created_at', { ascending: true }).limit(300)
  if (error) throw new Error(error.message)
  return (data || []).map(shapeEvent)
}

/**
 * Pagamentos de fatura recebidos entre duas datas do calendário da profissional
 * (inclusive). → [{ id, amount_cents, method, paid_at, day, document_id, source, origin, doc? }]
 * origin: 'stripe' (cartão pelo link) | 'appointment' (já pago no atendimento) | 'manual'.
 * withDoc: traz { number, client_id, client_name } do documento. Sem o SQL novo → [].
 */
export async function loadInvoicePayments(supabase, providerId, fromKey, toKey, tz, { withDoc = false, maxRows = 20000 } = {}) {
  const fromIso = zonedDayStartIso(fromKey, tz)
  const toIso = zonedDayStartIso(addDaysKey(toKey, 1), tz)
  const cols = PAYMENT_COLS + (withDoc ? ', ag_documents(number, client_id, client_name)' : '')
  const out = []
  for (let from = 0; from < maxRows; from += 1000) {
    const { data, error } = await supabase.from('ag_payments').select(cols)
      .eq('provider_id', providerId).eq('type', 'invoice').eq('status', 'paid')
      .not('document_id', 'is', null)
      .gte('paid_at', fromIso).lt('paid_at', toIso)
      .order('paid_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + 999)
    if (error) {
      if (LEGACY_ERR.test(error.message || '') || ['42703', '42P01', 'PGRST200', 'PGRST204'].includes(error.code)) return []
      throw new Error(error.message)
    }
    for (const p of data || []) {
      const s = shapePayment(p)
      const day = dateKeyIn(tz, p.paid_at || p.created_at)
      if (!day || day < fromKey || day > toKey) continue
      const fromAppointment = p.metadata && typeof p.metadata === 'object' && p.metadata.source === 'appointment'
      const row = { ...s, day, document_id: p.document_id || null, origin: s.source === 'stripe' ? 'stripe' : fromAppointment ? 'appointment' : 'manual' }
      if (withDoc) {
        const d = p.ag_documents || {}
        row.doc = { number: d.number || null, client_id: d.client_id || null, client_name: d.client_name || null }
      }
      out.push(row)
    }
    if (!data || data.length < 1000) break
  }
  return out
}

// ── Padrões da profissional (app_settings.doc_defaults) ─────────────────────
const clampInt = (v, min, max, def) => {
  if (v === null || v === undefined || v === '') return def
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

export function docDefaults(provider) {
  const d = provider?.app_settings?.doc_defaults
  const s = d && typeof d === 'object' ? d : {}
  return {
    tax_rate_bps: clampInt(s.tax_rate_bps, 0, 2500, 0),
    due_days: clampInt(s.due_days, 0, 120, DEFAULT_DUE_DAYS),
    quote_valid_days: clampInt(s.quote_valid_days, 1, 180, 30),
    deposit_pct: clampInt(s.deposit_pct, 0, 100, 0),
    language: DOC_LANGS.includes(s.language) ? s.language : 'en',
    terms: cleanText(s.terms, 5000),
    notes: cleanText(s.notes, 2000),
    payment_instructions: cleanText(s.payment_instructions, 1000),
  }
}

/** Nome que aparece pra cliente: nome legal da empresa, senão o nome do perfil. */
export function providerDisplayName(provider) {
  const b = provider?.app_settings?.business
  return clip(b?.legal_name, 120) || clip(provider?.name, 120) || 'BrasilConnect'
}

function providerContact(provider) {
  const b = provider?.app_settings?.business || {}
  return {
    phone: clip(b.phone, 30) || clip(provider?.whatsapp, 30) || null,
    email: (isEmail(b.email) ? String(b.email).trim() : null) || (isEmail(provider?.email) ? String(provider.email).trim() : null),
  }
}

/** A cliente consegue pagar a fatura no cartão pelo link? */
export function canPayOnline(provider) {
  return !!(provider?.stripe_account_id && provider?.stripe_charges_enabled && hasFeature(provider, 'invoice_payments'))
}

/** Assinatura paga e em dia (status 'active'). Teste grátis e cobrança atrasada não contam. */
function paidSubscription(provider, now = new Date()) {
  const eff = effectivePlan(provider, now)
  return eff.status === 'active' && eff.tier !== 'none' && !eff.trial
}

/**
 * E-mail do documento sem a marca BrasilConnect (From só com o nome da empresa): só com assinatura
 * paga ativa do Premium. No teste grátis o From sai sempre "<empresa> via BrasilConnect".
 */
export function emailHidesBrand(provider, now = new Date()) {
  return paidSubscription(provider, now) && effectivePlan(provider, now).plan === 'premium' && hasFeature(provider, 'no_branding', now)
}

/** Teto de e-mails de documento (envio + lembrete, manual ou automático) por profissional em 24h. */
export function docEmailDailyCap(provider, now = new Date()) {
  return paidSubscription(provider, now) ? DOC_EMAIL_DAILY.paid : DOC_EMAIL_DAILY.trial
}

/** E-mails de documento que saíram de fato desde sinceIso (eventos sent/reminder com email_sent). */
export async function countDocEmails(supabase, providerId, sinceIso) {
  const { count, error } = await supabase.from('ag_document_events').select('id', { count: 'exact', head: true })
    .eq('provider_id', providerId).in('type', ['sent', 'reminder']).eq('detail->>email_sent', 'true')
    .gte('created_at', sinceIso)
  if (error) throw new Error(error.message)
  return count || 0
}

// ── Validação de entrada ────────────────────────────────────────────────────
export function cleanUnit(v) {
  const s = clip(v, 16)
  if (!s) return 'un'
  return UNITS.includes(s) ? s : s.replace(/[<>{}"\\]/g, '') || 'un'
}

/** Lista de itens do app → itens normalizados ou { error }. Não confia em total vindo do app. */
export function normalizeItems(list) {
  if (list == null) return { items: [] }
  if (!Array.isArray(list)) return { error: 'Itens inválidos' }
  if (list.length > MAX_ITEMS) return { error: `No máximo ${MAX_ITEMS} itens por documento` }
  const items = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const n = i + 1
    if (!it || typeof it !== 'object') return { error: `Item ${n} inválido` }
    const description = cleanText(it.description ?? it.name, 500)
    if (!description) return { error: `Escreva a descrição do item ${n}` }
    const quantity = cleanQty(it.quantity ?? 1)
    if (quantity === null) return { error: `Quantidade inválida no item ${n}` }
    const priceRaw = it.unit_price_cents ?? 0
    const price = Math.round(Number(priceRaw === '' ? 0 : priceRaw))
    if (!Number.isFinite(price) || price < 0) return { error: `Preço inválido no item ${n}` }
    if (price > MAX_UNIT_PRICE_CENTS) return { error: `Preço muito alto no item ${n}` }
    items.push({
      position: i,
      catalog_item_id: isUuid(it.catalog_item_id) ? String(it.catalog_item_id) : null,
      kind: ITEM_KINDS.includes(it.kind) ? it.kind : 'service',
      description,
      quantity,
      unit: cleanUnit(it.unit),
      unit_price_cents: price,
      taxable: it.taxable === true || it.taxable === 'true',
    })
  }
  return { items }
}

/** Fotos: URLs https (até 12). Inválida → { error }. */
export function normalizePhotos(list) {
  if (list == null || list === '') return { photos: [] }
  if (!Array.isArray(list)) return { error: 'Fotos inválidas' }
  const out = []
  for (const u of list) {
    const s = String(u ?? '').trim()
    if (!s) continue
    if (s.length > 500 || !/^https:\/\/[^\s"'<>]+$/i.test(s)) return { error: 'Foto inválida: envie a imagem pelo app' }
    if (!out.includes(s)) out.push(s)
  }
  if (out.length > MAX_PHOTOS) return { error: `No máximo ${MAX_PHOTOS} fotos por documento` }
  return { photos: out }
}

const itemSig = (items) => JSON.stringify((items || []).map((i) => [
  String(i.description || ''), Number(i.quantity) || 0, i.unit || 'un', toInt(i.unit_price_cents), i.taxable === true, i.kind || 'service',
]))

/**
 * O que não pode mudar no documento por causa do status.
 * → null | { all: true, error } (nada muda) | { values: true, error } (só notas internas e fotos)
 */
export function editBlock(doc) {
  if (!doc) return null
  if (doc.kind === 'quote' && doc.status === 'converted') {
    return { all: true, error: 'Esse orçamento já virou fatura e não pode mais ser editado. Duplique para fazer outro.' }
  }
  if (doc.kind === 'invoice' && doc.status === 'void') {
    return { values: true, error: 'Fatura anulada não pode ser alterada. Duplique para emitir outra.' }
  }
  if (doc.kind === 'invoice' && doc.status === 'paid') {
    return { values: true, error: 'Fatura paga não muda itens nem valores. Remova o pagamento antes, se precisar corrigir.' }
  }
  if (doc.kind === 'quote' && doc.status === 'accepted') {
    return { values: true, error: 'A cliente já aprovou esse orçamento. Para mudar itens ou valores, duplique e envie de novo.' }
  }
  return null
}

function addressOf(c) {
  if (!c) return null
  const stateZip = [c.state, c.zip].filter(Boolean).join(' ')
  return [c.address_line, c.city, stateZip].filter(Boolean).join(', ') || null
}

const CLIENT_FULL = 'id, name, whatsapp, email, address_line, city, state, zip, archived'
const CLIENT_BASE = 'id, name, whatsapp, email'

async function selectClients(supabase, build) {
  const r = await build(supabase.from('ag_clients').select(CLIENT_FULL))
  if (r.error && LEGACY_ERR.test(r.error.message || '')) return build(supabase.from('ag_clients').select(CLIENT_BASE))
  return r
}

/**
 * Cliente do documento: ficha escolhida (client_id) ou cliente nova (client {name,email,phone,address}).
 * Cliente nova com telefone ou e-mail ganha ficha (ou reaproveita a que já existe), igual ao
 * agendamento manual. Os dados ficam copiados no documento (a ficha pode mudar depois).
 * → { ok, fields|null } (null = mantém o que o documento já tem) ou { ok: false, status, body }
 */
async function resolveDocClient(supabase, pid, b, existing) {
  const fail = (status, error) => ({ ok: false, status, body: { error } })
  const wants = has(b, 'client_id') || has(b, 'client') || has(b, 'client_name')
  if (existing && !wants) return { ok: true, fields: null }

  const c = b.client && typeof b.client === 'object' && !Array.isArray(b.client)
    ? b.client
    : { name: b.client_name, email: b.client_email, phone: b.client_phone ?? b.client_whatsapp, address: b.client_address }
  const name = clip(c.name, 120)
  let phone = null
  if (c.phone != null && String(c.phone).trim()) {
    phone = normalizePhone(String(c.phone).slice(0, 30))
    if (!phone) return fail(400, 'Telefone da cliente inválido. Use código de área + número.')
  }
  let email = null
  if (c.email != null && String(c.email).trim()) {
    email = String(c.email).trim().toLowerCase().slice(0, 254)
    if (!EMAIL_RE.test(email)) return fail(400, 'E-mail da cliente inválido')
  }
  const address = cleanText(c.address, 300)

  if (b.client_id) {
    if (!isUuid(b.client_id)) return fail(400, 'Cliente inválida')
    const { data: rows, error } = await selectClients(supabase, (q) => q.eq('id', b.client_id).eq('provider_id', pid).limit(1))
    if (error) return fail(500, error.message)
    const f = rows?.[0]
    if (!f) return fail(404, 'Cliente não encontrada')
    return {
      ok: true,
      fields: {
        client_id: f.id,
        client_name: name || f.name,
        client_email: email || f.email || null,
        client_phone: phone || f.whatsapp || null,
        client_address: address || addressOf(f),
      },
    }
  }

  if (!name) return fail(400, 'Informe o nome da cliente')

  const reuse = async (f) => {
    const patch = {}
    if (f.archived === true) patch.archived = false
    if (email && !f.email) patch.email = email
    if (Object.keys(patch).length) await supabase.from('ag_clients').update(patch).eq('id', f.id).eq('provider_id', pid)
    return f
  }
  const insertClient = async (row, upsert) => {
    const run = (r) => (upsert
      ? supabase.from('ag_clients').upsert(r, { onConflict: 'provider_id,whatsapp', ignoreDuplicates: false })
      : supabase.from('ag_clients').insert(r)).select(CLIENT_BASE).single()
    let ins = await run(row)
    if (ins.error && 'address_line' in row && LEGACY_ERR.test(ins.error.message || '')) {
      const { address_line, ...rest } = row
      ins = await run(rest)
    }
    return ins
  }

  let ficha = null
  const base = { provider_id: pid, name }
  if (address) base.address_line = address.replace(/\n+/g, ', ').slice(0, 160)
  if (phone) {
    // Fichas antigas podem ter o número sem '+' ou só com 10 dígitos
    const digits = phone.slice(1)
    const variants = [...new Set([phone, digits, digits.startsWith('1') ? digits.slice(1) : digits])]
    const { data: found } = await selectClients(supabase, (q) => q.eq('provider_id', pid).in('whatsapp', variants).limit(1))
    if (found?.[0]) ficha = await reuse(found[0])
    else {
      const ins = await insertClient({ ...base, whatsapp: phone, ...(email ? { email } : {}) }, true)
      if (ins.error) return fail(500, ins.error.message)
      ficha = ins.data
    }
  } else if (email) {
    const { data: found } = await selectClients(supabase, (q) => q.eq('provider_id', pid).eq('email', email).limit(1))
    if (found?.[0]) ficha = await reuse(found[0])
    else {
      const ins = await insertClient({ ...base, email }, false)
      if (ins.error) return fail(500, ins.error.message)
      ficha = ins.data
    }
  }
  return {
    ok: true,
    fields: {
      client_id: ficha?.id || null,
      client_name: name,
      client_email: email || ficha?.email || null,
      client_phone: phone || ficha?.whatsapp || null,
      client_address: address || addressOf(ficha),
    },
  }
}

// Campos comparados quando o status trava os valores
const LOCK_COMPARE = ['client_id', 'client_name', 'client_email', 'client_phone', 'client_address', 'title', 'job_address',
  'language', 'issue_date', 'due_date', 'valid_until', 'discount_pct', 'discount_cents', 'tax_rate_bps', 'deposit_pct',
  'deposit_cents', 'notes', 'terms', 'payment_instructions', 'appointment_id', 'quote_request_id']
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/
function sameVal(a, b) {
  const x = a === undefined || a === '' ? null : a
  const y = b === undefined || b === '' ? null : b
  if (x === null || y === null) return x === y
  if (typeof x === 'number' || typeof y === 'number') {
    const nx = Number(x), ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx === ny
  }
  const sx = String(x), sy = String(y)
  if (DATE_PREFIX.test(sx) && DATE_PREFIX.test(sy) && (sx.length <= 10 || sy.length <= 10)) return sx.slice(0, 10) === sy.slice(0, 10)
  return sx === sy
}

/**
 * Cria (sem existing) ou atualiza (com existing = linha do banco, já conferida como da profissional)
 * um orçamento/fatura. Recalcula tudo no servidor. Ver o cabeçalho do arquivo.
 */
export async function saveDocument(supabase, provider, input = {}, opts = {}) {
  const fail = (status, error, extra = {}) => ({ ok: false, status, body: { error, ...extra } })
  try {
    const pid = provider?.id
    if (!pid) return fail(400, 'Profissional inválida')
    const b = input && typeof input === 'object' ? input : {}
    const existing = opts.existing || null
    if (existing && existing.provider_id && existing.provider_id !== pid) return fail(404, 'Documento não encontrado')
    const kind = existing ? existing.kind : b.kind
    if (!DOC_KINDS.includes(kind)) return fail(400, 'Escolha orçamento (quote) ou fatura (invoice)')

    const block = existing ? editBlock(existing) : null
    if (block?.all) return fail(409, block.error, { code: 'locked' })

    const defs = docDefaults(provider)
    const today = todayFor(provider)
    const now = new Date().toISOString()
    const isQuote = kind === 'quote'
    const ex = existing || {}

    // Cliente
    const cr = await resolveDocClient(supabase, pid, b, existing)
    if (!cr.ok) return cr
    const client = cr.fields || {
      client_id: ex.client_id ?? null, client_name: ex.client_name, client_email: ex.client_email ?? null,
      client_phone: ex.client_phone ?? null, client_address: ex.client_address ?? null,
    }
    if (!client.client_name) return fail(400, 'Informe o nome da cliente')

    // Textos
    const title = has(b, 'title') ? clip(b.title, 160) : (ex.title ?? null)
    const job_address = has(b, 'job_address') ? cleanText(b.job_address, 300) : (ex.job_address ?? null)
    let language = existing ? langOf(ex.language) : defs.language
    if (has(b, 'language')) {
      if (!DOC_LANGS.includes(b.language)) return fail(400, 'Idioma do documento inválido (pt, en ou es)')
      language = b.language
    }
    const textField = (k, n, def) => (has(b, k) ? cleanText(b[k], n) : (existing ? (ex[k] ?? null) : def))
    const notes = textField('notes', 2000, defs.notes)
    const terms = textField('terms', 5000, defs.terms)
    const payment_instructions = textField('payment_instructions', 1000,
      defs.payment_instructions || cleanText(provider.deposit_instructions, 1000))
    const internal_notes = textField('internal_notes', 2000, null)

    // Datas
    let issue_date = existing ? dateOnly(ex.issue_date) : today
    if (has(b, 'issue_date') && b.issue_date !== null && b.issue_date !== '') {
      issue_date = parseDateKey(b.issue_date)
      if (!issue_date) return fail(400, 'Data de emissão inválida')
    }
    let due_date = null, valid_until = null
    const dateField = (k, defDays) => {
      if (has(b, k)) {
        if (b[k] === null || b[k] === '') return { v: addDaysKey(issue_date, defDays) }
        const d = parseDateKey(b[k])
        return d ? { v: d } : { error: true }
      }
      return { v: existing ? (dateOnly(ex[k]) || addDaysKey(issue_date, defDays)) : addDaysKey(issue_date, defDays) }
    }
    if (isQuote) {
      const r = dateField('valid_until', defs.quote_valid_days)
      if (r.error) return fail(400, 'Data de validade inválida')
      valid_until = r.v
      if (valid_until < issue_date) return fail(400, 'A validade precisa ser no dia da emissão ou depois')
    } else {
      const r = dateField('due_date', defs.due_days)
      if (r.error) return fail(400, 'Data de vencimento inválida')
      due_date = r.v
      if (due_date < issue_date) return fail(400, 'O vencimento precisa ser no dia da emissão ou depois')
    }

    // Itens
    let items
    const itemsGiven = has(b, 'items')
    let oldItems = null
    if (itemsGiven) {
      const r = normalizeItems(b.items)
      if (r.error) return fail(400, r.error)
      items = r.items
      // Item da tabela de preços precisa ser dela (senão só perde o vínculo)
      const ids = [...new Set(items.map((i) => i.catalog_item_id).filter(Boolean))]
      if (ids.length) {
        const { data: own } = await supabase.from('ag_catalog_items').select('id').eq('provider_id', pid).in('id', ids)
        const ok = new Set((own || []).map((x) => x.id))
        for (const it of items) if (it.catalog_item_id && !ok.has(it.catalog_item_id)) it.catalog_item_id = null
      }
    } else if (existing) {
      oldItems = await loadItems(supabase, pid, existing.id)
      items = oldItems.map(({ id, line_total_cents, ...it }) => it)
    } else {
      items = []
    }

    // Desconto, imposto, entrada
    let discount_pct = existing ? numOrNull(ex.discount_pct) : null
    let discount_input = existing ? toInt(ex.discount_cents) : 0
    if (has(b, 'discount_pct') || has(b, 'discount_cents')) {
      const pct = cleanPct(b.discount_pct)
      if (pct !== null && pct > 0) { discount_pct = pct; discount_input = 0 }
      else {
        const n = Math.round(Number(b.discount_cents ?? 0))
        if (!Number.isFinite(n) || n < 0 || n > MAX_DOC_CENTS) return fail(400, 'Desconto inválido')
        discount_pct = null; discount_input = n
      }
    }
    let tax_rate_bps = existing ? toInt(ex.tax_rate_bps) : defs.tax_rate_bps
    if (has(b, 'tax_rate_bps')) {
      const n = Math.round(Number(b.tax_rate_bps ?? 0))
      if (!Number.isFinite(n) || n < 0 || n > 2500) return fail(400, 'Imposto inválido (de 0% a 25%)')
      tax_rate_bps = n
    }
    let deposit_pct = existing ? numOrNull(ex.deposit_pct) : (isQuote && defs.deposit_pct > 0 ? defs.deposit_pct : null)
    let deposit_input = existing ? toInt(ex.deposit_cents) : 0
    if (has(b, 'deposit_pct') || has(b, 'deposit_cents')) {
      const pct = cleanPct(b.deposit_pct)
      if (pct !== null && pct > 0) { deposit_pct = pct; deposit_input = 0 }
      else {
        const n = Math.round(Number(b.deposit_cents ?? 0))
        if (!Number.isFinite(n) || n < 0 || n > MAX_DOC_CENTS) return fail(400, 'Entrada inválida')
        deposit_pct = null; deposit_input = n
      }
    }

    // Fotos e ligações
    let photos = existing ? (Array.isArray(ex.photos) ? ex.photos : []) : []
    if (has(b, 'photos')) {
      const r = normalizePhotos(b.photos)
      if (r.error) return fail(400, r.error)
      photos = r.photos
    }
    let appointment_id = existing ? (ex.appointment_id ?? null) : null
    if (has(b, 'appointment_id')) {
      if (b.appointment_id === null || b.appointment_id === '') appointment_id = null
      else {
        if (!isUuid(b.appointment_id)) return fail(400, 'Agendamento inválido')
        const { data } = await supabase.from('ag_appointments').select('id').eq('id', b.appointment_id).eq('provider_id', pid).maybeSingle()
        if (!data) return fail(404, 'Agendamento não encontrado')
        appointment_id = data.id
      }
    }
    let quote_request_id = existing ? (ex.quote_request_id ?? null) : null
    if (has(b, 'quote_request_id')) {
      if (b.quote_request_id === null || b.quote_request_id === '') quote_request_id = null
      else {
        if (!isUuid(b.quote_request_id)) return fail(400, 'Pedido de orçamento inválido')
        const { data } = await supabase.from('ag_quote_requests').select('id').eq('id', b.quote_request_id).eq('provider_id', pid).maybeSingle()
        if (!data) return fail(404, 'Pedido de orçamento não encontrado')
        quote_request_id = data.id
      }
    }

    // Conta (fonte única: docCalc)
    const paid = existing ? toInt(ex.amount_paid_cents) : 0
    const t = computeTotals({
      items, discount_pct, discount_cents: discount_input, tax_rate_bps,
      deposit_pct, deposit_cents: deposit_input, amount_paid_cents: paid,
    })
    if (t.subtotal_cents > MAX_DOC_CENTS || t.total_cents > MAX_DOC_CENTS || t.lines.some((l) => l.line_total_cents > MAX_DOC_CENTS)) {
      return fail(400, 'Valor total muito alto (máximo US$ 10.000.000 por documento)')
    }

    const row = {
      ...client,
      title, job_address, language, issue_date,
      due_date: isQuote ? null : due_date,
      valid_until: isQuote ? valid_until : null,
      subtotal_cents: t.subtotal_cents,
      discount_pct: discount_pct !== null && discount_pct > 0 ? discount_pct : null,
      discount_cents: t.discount_cents,
      tax_rate_bps,
      tax_cents: t.tax_cents,
      total_cents: t.total_cents,
      deposit_pct: deposit_pct !== null && deposit_pct > 0 ? deposit_pct : null,
      deposit_cents: t.deposit_cents,
      notes, terms, payment_instructions, internal_notes, photos,
      appointment_id, quote_request_id,
      updated_at: now,
    }
    const itemRows = (docId) => t.lines.map((l, i) => ({
      document_id: docId, provider_id: pid, position: i,
      catalog_item_id: l.catalog_item_id || null, kind: l.kind, description: l.description,
      quantity: l.quantity, unit: l.unit, unit_price_cents: l.unit_price_cents,
      taxable: l.taxable === true, line_total_cents: l.line_total_cents,
    }))

    // ── Criação ───────────────────────────────────────────────────────────
    if (!existing) {
      const { data: seq, error: seqErr } = await supabase.rpc('ag_next_doc_seq', { p_provider_id: pid, p_kind: kind })
      const n = Number(seq)
      if (seqErr || !Number.isInteger(n) || n < 1) return fail(500, 'Não foi possível numerar o documento. Tente de novo.')
      const extra = opts.extra || {}
      const insertRow = {
        provider_id: pid, kind, seq: n, number: docNumber(kind, n), status: 'draft',
        public_token: newToken(), ...row, created_at: now,
      }
      if (extra.quote_id && isUuid(extra.quote_id)) insertRow.quote_id = extra.quote_id
      if (extra.stage_label) insertRow.stage_label = clip(extra.stage_label, 120)

      let ins = await supabase.from('ag_documents').insert(insertRow).select(DOC_COLS).single()
      if (ins.error && ins.error.code === '23505' && /token/i.test(ins.error.message || '')) {
        insertRow.public_token = newToken()
        ins = await supabase.from('ag_documents').insert(insertRow).select(DOC_COLS).single()
      }
      if (ins.error) return fail(500, ins.error.message)
      const doc = ins.data

      let shapedItems = []
      if (t.lines.length) {
        const ir = await supabase.from('ag_document_items').insert(itemRows(doc.id)).select(ITEM_COLS)
        if (ir.error) {
          await supabase.from('ag_documents').delete().eq('id', doc.id).eq('provider_id', pid)
          return fail(500, ir.error.message)
        }
        shapedItems = (ir.data || []).map(shapeItem).sort((a, z) => a.position - z.position)
      }
      await addEvent(supabase, doc, 'created', opts.channel || 'app', opts.eventDetail || {})

      // Pedido de orçamento de origem: fica ligado e marcado como respondido
      if (quote_request_id) {
        await supabase.from('ag_quote_requests').update({ document_id: doc.id, status: 'quoted', updated_at: now })
          .eq('id', quote_request_id).eq('provider_id', pid).in('status', ['new', 'contacted'])
      }
      // Fatura do atendimento: o que já foi pago nele entra como pagamento (não cobra de novo)
      const credited = kind === 'invoice' && appointment_id ? await creditFromAppointment(supabase, provider, doc) : null
      return { ok: true, document: shapeDoc(credited?.row || doc, { today }), items: shapedItems }
    }

    // ── Atualização ───────────────────────────────────────────────────────
    const oldSig = itemsGiven ? itemSig(await loadItems(supabase, pid, existing.id)) : null
    const itemsChanged = itemsGiven && itemSig(t.lines) !== oldSig
    if (block?.values) {
      const changed = LOCK_COMPARE.some((k) => !sameVal(row[k], ex[k]))
      if (changed || itemsChanged) return fail(409, block.error, { code: 'locked' })
    }

    // Status que depende de valores/datas
    if (kind === 'invoice' && ex.status !== 'draft' && ex.status !== 'void') {
      row.status = invoiceStatus({ ...ex, ...row, amount_paid_cents: paid }, today)
      if (row.status === 'paid') row.paid_at = ex.paid_at || now
      else row.paid_at = null
    }
    if (kind === 'quote' && ex.status === 'expired' && valid_until >= today) {
      row.status = ex.viewed_at ? 'viewed' : 'sent'   // validade estendida: volta a valer
    }

    let newIds = []
    let oldIds = []
    if (itemsChanged) {
      const { data: old, error: oErr } = await supabase.from('ag_document_items').select('id')
        .eq('document_id', existing.id).eq('provider_id', pid)
      if (oErr) return fail(500, oErr.message)
      oldIds = (old || []).map((x) => x.id)
      if (t.lines.length) {
        const ir = await supabase.from('ag_document_items').insert(itemRows(existing.id)).select('id')
        if (ir.error) return fail(500, ir.error.message)
        newIds = (ir.data || []).map((x) => x.id)
      }
    }
    const up = await supabase.from('ag_documents').update(row)
      .eq('id', existing.id).eq('provider_id', pid).select(DOC_COLS).single()
    if (up.error) {
      if (newIds.length) await supabase.from('ag_document_items').delete().in('id', newIds).eq('provider_id', pid)
      return fail(500, up.error.message)
    }
    if (oldIds.length) {
      const del = await supabase.from('ag_document_items').delete().in('id', oldIds).eq('provider_id', pid)
      if (del.error) console.error('[documents] itens antigos:', del.error.message)
    }
    await addEvent(supabase, up.data, 'updated', opts.channel || 'app', {
      ...(itemsChanged ? { items: t.lines.length } : {}),
      ...(up.data.total_cents !== ex.total_cents ? { total_cents: up.data.total_cents } : {}),
      ...(opts.eventDetail || {}),
    })
    // Fatura ligada agora a um atendimento: lança o que já foi pago nele
    const credited = kind === 'invoice' && appointment_id && !ex.appointment_id && up.data.status !== 'void'
      ? await creditFromAppointment(supabase, provider, up.data) : null
    return { ok: true, document: shapeDoc(credited?.row || up.data, { today }), items: await loadItems(supabase, pid, existing.id) }
  } catch (e) {
    return fail(500, e.message)
  }
}

// ── Pagamentos e status da fatura ───────────────────────────────────────────
const RECOMPUTE_TRIES = 4

/**
 * Sem transação: lê a fatura, soma os pagamentos numa consulta só e grava condicionado à versão
 * lida (updated_at + amount_paid_cents). Se outro pagamento/edição gravou no meio, relê e soma de
 * novo (até RECOMPUTE_TRIES; a última tentativa grava com a soma que acabou de ler). Já certo → não
 * regrava (evento repetido do Stripe, recálculo duplo). Pagamento reembolsado ('refunded') não conta.
 */
export async function recomputeInvoice(supabase, docId, opts = {}) {
  if (!isUuid(docId)) return null
  const providerId = opts.providerId || opts.provider?.id
  let tz = null
  for (let attempt = 1; attempt <= RECOMPUTE_TRIES; attempt++) {
    const { data: doc, error } = await supabase.from('ag_documents').select(DOC_COLS).eq('id', docId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!doc || doc.kind !== 'invoice') return null
    if (providerId && doc.provider_id !== providerId) return null

    const { data: pays, error: pErr } = await supabase.from('ag_payments').select('amount_cents, paid_at, created_at')
      .eq('provider_id', doc.provider_id).eq('document_id', doc.id).eq('type', 'invoice').eq('status', 'paid')
    if (pErr) throw new Error(pErr.message)
    const paid = (pays || []).reduce((s, p) => s + Math.max(0, toInt(p.amount_cents)), 0)

    if (!tz) {
      tz = opts.provider && opts.provider.id === doc.provider_id ? opts.provider.timezone : null
      if (!tz) {
        const { data: prov } = await supabase.from('ag_providers').select('timezone').eq('id', doc.provider_id).maybeSingle()
        tz = prov?.timezone || 'America/New_York'
      }
    }
    const today = dateKeyIn(tz)
    // Fatura que a cliente ainda não recebeu continua rascunho, mesmo com pagamento
    // lançado (ex.: o que o atendimento já recebeu): fora de "A receber", do cron e
    // apagável. O status de verdade (paga/parcial/vencida) vem no primeiro envio.
    const status = doc.status !== 'void' && !doc.sent_at
      ? 'draft'
      : invoiceStatus({ ...doc, amount_paid_cents: paid }, today)
    let paid_at = null
    if (status === 'paid') {
      const last = (pays || []).map((p) => p.paid_at || p.created_at).filter(Boolean).sort().pop()
      paid_at = doc.status === 'paid' && doc.paid_at ? doc.paid_at : (last || new Date().toISOString())
    }
    const result = (row) => ({
      document: shapeDoc(row, { today }),
      row,
      previous_status: doc.status,
      status,
      amount_paid_cents: paid,
      became_paid: status === 'paid' && doc.status !== 'paid',
    })

    if (toInt(doc.amount_paid_cents) === paid && doc.status === status && (doc.paid_at || null) === (paid_at || null)) {
      return result(doc)
    }

    const patch = { amount_paid_cents: paid, status, paid_at, updated_at: new Date().toISOString() }
    let q = supabase.from('ag_documents').update(patch).eq('id', doc.id).eq('provider_id', doc.provider_id)
    if (attempt < RECOMPUTE_TRIES) q = q.eq('updated_at', doc.updated_at).eq('amount_paid_cents', toInt(doc.amount_paid_cents))
    const { data: rows, error: uErr } = await q.select(DOC_COLS)
    if (uErr) throw new Error(uErr.message)
    if (rows?.length) return result(rows[0])
    // Ninguém atualizado: alguém gravou depois da nossa leitura (ou a fatura sumiu) → relê
  }
  return null
}

const APPT_COLS = [
  'id, scheduled_for, status, deposit_cents, deposit_paid, payment_method, paid_cents, paid_method',
  'id, scheduled_for, status, deposit_cents, deposit_paid, payment_method',   // sem ag_app_agenda.sql
]
const toPayMethod = (m) => (PAY_METHODS.includes(m) ? m : (m === 'stripe' || m === 'debit' ? 'card' : 'other'))

/**
 * Fatura ligada a atendimento: o que a cliente já pagou nele (paid_cents marcado no app, senão o
 * sinal pago) entra como pagamento da fatura (metadata.source 'appointment', data do atendimento),
 * menos o que outras faturas do mesmo atendimento já lançaram assim. A fatura não cobra de novo, a
 * cobrança automática não vai pra quem já pagou e api/agenda/finance.js tira do atendimento o que a
 * fatura recebeu (sem contar duas vezes). A profissional pode remover esse pagamento na fatura.
 * Best effort: nunca lança. → { amount_cents, row } (row = fatura recalculada) | null
 */
export async function creditFromAppointment(supabase, provider, doc) {
  try {
    if (!doc || doc.kind !== 'invoice' || !doc.appointment_id || doc.status === 'void') return null
    const pid = doc.provider_id
    const room = toInt(doc.total_cents) - toInt(doc.amount_paid_cents)
    if (!pid || room <= 0) return null
    let a = null
    for (const cols of APPT_COLS) {
      const r = await supabase.from('ag_appointments').select(cols).eq('id', doc.appointment_id).eq('provider_id', pid).maybeSingle()
      if (!r.error) { a = r.data; break }
      if (!LEGACY_ERR.test(r.error.message || '')) throw new Error(r.error.message)
    }
    if (!a) return null
    // Mesma regra das Finanças: valor marcado como pago (já conta o sinal), senão o sinal pago
    const received = a.paid_cents != null ? Math.max(0, toInt(a.paid_cents))
      : (a.deposit_paid && a.status !== 'canceled' ? Math.max(0, toInt(a.deposit_cents)) : 0)
    if (received <= 0) return null

    const { data: prev, error: pErr } = await supabase.from('ag_payments').select('amount_cents')
      .eq('provider_id', pid).eq('type', 'invoice').eq('status', 'paid')
      .eq('metadata->>source', 'appointment').eq('metadata->>appointment_id', a.id)
      .not('document_id', 'is', null).limit(500)
    if (pErr) throw new Error(pErr.message)
    const already = (prev || []).reduce((s, p) => s + Math.max(0, toInt(p.amount_cents)), 0)
    const amount = Math.min(room, received - already)
    if (amount <= 0) return null

    const tz = provider && provider.id === pid ? provider.timezone : null
    const today = dateKeyIn(tz || 'America/New_York')
    const day = parseDateKey(String(a.scheduled_for || '').slice(0, 10)) || today
    const onDay = day < today ? day : today
    // Dia do atendimento (meio-dia no fuso dela): a receita fica no mesmo mês de antes
    const paidAt = onDay === today
      ? new Date().toISOString()
      : new Date(Date.parse(zonedDayStartIso(onDay, tz)) + 12 * 3600e3).toISOString()
    const method = toPayMethod(a.paid_cents != null ? (a.paid_method || a.payment_method) : a.payment_method)
    const { data: pay, error: iErr } = await supabase.from('ag_payments').insert({
      provider_id: pid, document_id: doc.id, amount_cents: amount, type: 'invoice', status: 'paid',
      paid_at: paidAt, method,
      metadata: { method, source: 'appointment', appointment_id: a.id, paid_on: onDay, note: 'Recebido no atendimento', recorded_by: 'system' },
    }).select('id').single()
    if (iErr) throw new Error(iErr.message)
    const r = await recomputeInvoice(supabase, doc.id, { provider, providerId: pid })
    await addEvent(supabase, doc, 'payment', 'app', {
      payment_id: pay.id, amount_cents: amount, method, paid_on: onDay, from_appointment: true,
      ...(r?.became_paid ? { fully_paid: true } : {}),
    })
    return { amount_cents: amount, row: r?.row || null }
  } catch (e) {
    console.error('[documents] pagamento do atendimento:', e.message)
    return null
  }
}

/** Linha do tempo. doc precisa de { id, provider_id }. Best effort: nunca lança. */
export async function addEvent(supabase, doc, type, channel = 'app', detail = {}) {
  try {
    if (!supabase || !doc?.id || !doc?.provider_id || !type) return false
    const row = {
      document_id: doc.id,
      provider_id: doc.provider_id,
      type: String(type).slice(0, 30),
      channel: EVENT_CHANNELS.includes(channel) ? channel : null,
      detail: detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {},
    }
    const { error } = await supabase.from('ag_document_events').insert(row)
    if (error) { console.error('[documents] evento:', error.message); return false }
    return true
  } catch (e) {
    console.error('[documents] evento:', e.message)
    return false
  }
}

// ── Mensagens pra cliente (idioma do documento) ─────────────────────────────
const firstName = (n) => clip(String(n || '').split(' ')[0], 40) || ''

function docFacts(doc, tz) {
  const lang = langOf(doc.language)
  const total = toInt(doc.total_cents)
  const balance = doc.balance_cents != null ? toInt(doc.balance_cents) : balanceOf(doc)
  const due = dateOnly(doc.due_date)
  const issue = dateOnly(doc.issue_date)
  return {
    lang,
    // Orçamento já aprovado/faturado: reenviar vira cópia (sem "revise e aprove")
    approvedCopy: doc.kind === 'quote' && (doc.status === 'accepted' || doc.status === 'converted'),
    acceptedOn: doc.accepted_at ? dateKeyIn(tz, doc.accepted_at) : null,
    acceptedName: clip(doc.accepted_name, 120),
    signedHash: /^[0-9a-f]{64}$/i.test(String(doc.signed_hash || '')) ? String(doc.signed_hash).toLowerCase() : null,
    first: firstName(doc.client_name),
    title: clip(doc.title, 80),
    number: doc.number || '',
    total,
    balance,
    deposit: toInt(doc.deposit_cents),
    validUntil: dateOnly(doc.valid_until),
    due,
    uponReceipt: !due || due === issue,
    paid: doc.kind === 'invoice' && (doc.status === 'paid' || (total > 0 && balance === 0 && doc.status !== 'void')),
    overdue: doc.status === 'overdue',
  }
}

/**
 * Texto curto pronto pra WhatsApp/SMS no idioma do documento, com valor e
 * validade/vencimento. opts.reminder = lembrete (orçamento aguardando ou fatura em aberto).
 */
export function docMessage(doc, provider, publicUrl, opts = {}) {
  if (!doc) return ''
  const f = docFacts(doc, provider?.timezone)
  const prov = providerDisplayName(provider)
  const url = publicUrl || doc.public_url || publicUrlFor(doc.public_token) || ''
  const m = (c) => fmtMoney(c, f.lang)
  const d = (k) => fmtDate(k, f.lang)
  const tt = f.title ? ` (${f.title})` : ''
  const hi = { pt: f.first ? `Olá, ${f.first}!` : 'Olá!', en: f.first ? `Hi ${f.first}!` : 'Hi!', es: f.first ? `¡Hola, ${f.first}!` : '¡Hola!' }[f.lang]

  if (f.approvedCopy) {
    // Sem data de aprovação (faturado sem aprovar): cópia neutra
    const on = f.acceptedOn ? d(f.acceptedOn) : ''
    return {
      pt: `${hi} Aqui está a cópia do orçamento ${f.number}${tt} de ${prov}${on ? `, que você aprovou em ${on}` : ''}: total de ${m(f.total)}. Veja quando quiser: ${url}`,
      en: `${hi} Here is a copy of quote ${f.number}${tt} from ${prov}${on ? `, which you approved on ${on}` : ''}: total ${m(f.total)}. View it anytime: ${url}`,
      es: `${hi} Aquí está la copia del presupuesto ${f.number}${tt} de ${prov}${on ? `, que usted aprobó el ${on}` : ''}: total ${m(f.total)}. Véalo cuando quiera: ${url}`,
    }[f.lang]
  }

  if (doc.kind === 'quote' && opts.reminder) {
    return {
      pt: `${hi} Passando para lembrar do orçamento ${f.number}${tt} de ${prov}: total de ${m(f.total)}.`
        + (f.validUntil ? ` Válido até ${d(f.validUntil)}.` : '') + ` Veja e aprove pelo link: ${url}`,
      en: `${hi} Just a reminder about quote ${f.number}${tt} from ${prov}: total ${m(f.total)}.`
        + (f.validUntil ? ` Valid until ${d(f.validUntil)}.` : '') + ` Review and approve it here: ${url}`,
      es: `${hi} Le recordamos el presupuesto ${f.number}${tt} de ${prov}: total ${m(f.total)}.`
        + (f.validUntil ? ` Válido hasta el ${d(f.validUntil)}.` : '') + ` Revíselo y apruébelo aquí: ${url}`,
    }[f.lang]
  }

  if (doc.kind === 'quote') {
    const T = {
      pt: `${hi} Aqui está o orçamento ${f.number}${tt} de ${prov}: total de ${m(f.total)}.`
        + (f.validUntil ? ` Válido até ${d(f.validUntil)}.` : '')
        + (f.deposit > 0 ? ` Entrada na aprovação: ${m(f.deposit)}.` : '')
        + ` Veja os detalhes e aprove pelo link: ${url}`,
      en: `${hi} Here is quote ${f.number}${tt} from ${prov}: total ${m(f.total)}.`
        + (f.validUntil ? ` Valid until ${d(f.validUntil)}.` : '')
        + (f.deposit > 0 ? ` Deposit due on approval: ${m(f.deposit)}.` : '')
        + ` Review and approve it here: ${url}`,
      es: `${hi} Aquí está el presupuesto ${f.number}${tt} de ${prov}: total ${m(f.total)}.`
        + (f.validUntil ? ` Válido hasta el ${d(f.validUntil)}.` : '')
        + (f.deposit > 0 ? ` Anticipo al aprobar: ${m(f.deposit)}.` : '')
        + ` Revíselo y apruébelo aquí: ${url}`,
    }
    return T[f.lang]
  }

  if (f.paid) {
    return {
      pt: `${hi} A fatura ${f.number} de ${prov} está paga. Obrigado! Comprovante: ${url}`,
      en: `${hi} Invoice ${f.number} from ${prov} is paid in full. Thank you! Receipt: ${url}`,
      es: `${hi} La factura ${f.number} de ${prov} está pagada. ¡Gracias! Comprobante: ${url}`,
    }[f.lang]
  }

  if (opts.reminder) {
    return {
      pt: `${hi} Passando para lembrar da fatura ${f.number} de ${prov}: saldo de ${m(f.balance)}`
        + (f.due ? (f.overdue ? `, vencida em ${d(f.due)}` : `, vence em ${d(f.due)}`) : '')
        + `. Veja e pague pelo link: ${url}`,
      en: `${hi} Friendly reminder about invoice ${f.number} from ${prov}: balance of ${m(f.balance)}`
        + (f.due ? (f.overdue ? `, past due since ${d(f.due)}` : `, due ${d(f.due)}`) : '')
        + `. View and pay here: ${url}`,
      es: `${hi} Le recordamos la factura ${f.number} de ${prov}: saldo de ${m(f.balance)}`
        + (f.due ? (f.overdue ? `, vencida el ${d(f.due)}` : `, vence el ${d(f.due)}`) : '')
        + `. Véala y páguela aquí: ${url}`,
    }[f.lang]
  }

  return {
    pt: `${hi} Aqui está a fatura ${f.number}${tt} de ${prov}: ${m(f.balance)} `
      + (f.uponReceipt ? 'com vencimento na entrega' : `para pagar até ${d(f.due)}`) + `. Veja e pague pelo link: ${url}`,
    en: `${hi} Here is invoice ${f.number}${tt} from ${prov}: ${m(f.balance)} `
      + (f.uponReceipt ? 'due upon receipt' : `due by ${d(f.due)}`) + `. View and pay here: ${url}`,
    es: `${hi} Aquí está la factura ${f.number}${tt} de ${prov}: ${m(f.balance)} `
      + (f.uponReceipt ? 'a pagar al recibirla' : `a pagar hasta el ${d(f.due)}`) + `. Véala y páguela aquí: ${url}`,
  }[f.lang]
}

const EMAIL_TEXT = {
  pt: {
    quoteKicker: 'ORÇAMENTO', invoiceKicker: 'FATURA', reminderKicker: 'LEMBRETE DE PAGAMENTO', quoteReminderKicker: 'LEMBRETE',
    quoteReminderSubject: (n, p) => `Lembrete: orçamento ${n} de ${p}`,
    quoteReminderTitle: (n) => `Lembrete do orçamento ${n}`,
    quoteReminderLead: (p, n, t) => `Passando para lembrar do orçamento <strong>${n}</strong> de ${p}${t ? ` para <strong>${t}</strong>` : ''}.`,
    quoteSubject: (n, p) => `Orçamento ${n} de ${p}`,
    invoiceSubject: (n, p) => `Fatura ${n} de ${p}`,
    reminderSubject: (n, p) => `Lembrete: fatura ${n} de ${p}`,
    quoteTitle: (n) => `Orçamento ${n}`, invoiceTitle: (n) => `Fatura ${n}`,
    reminderTitle: (n, late) => (late ? `Fatura ${n} vencida` : `Lembrete da fatura ${n}`),
    hi: (f) => (f ? `Olá, ${f}!` : 'Olá!'),
    sentQuote: (p, n, t) => `${p} enviou o orçamento <strong>${n}</strong>${t ? ` para <strong>${t}</strong>` : ''}.`,
    sentInvoice: (p, n, t) => `${p} enviou a fatura <strong>${n}</strong>${t ? ` referente a <strong>${t}</strong>` : ''}.`,
    total: 'Total', validUntil: 'Válido até', depositOnApproval: 'Entrada na aprovação',
    amountDue: 'Valor a pagar', due: 'Vencimento', uponReceipt: 'na entrega',
    quoteCta: 'Abra o link para ver cada item, aprovar e assinar on-line.',
    invoiceCta: (online) => `Abra o link para ver os detalhes${online ? ' e pagar on-line com cartão' : ''}.`,
    paidNote: 'Essa fatura está paga. Obrigado!',
    howToPay: 'Como pagar',
    reminderLead: (p, n, late) => `Passando para lembrar que a fatura <strong>${n}</strong> de ${p} ${late ? 'está vencida' : 'está em aberto'}.`,
    balance: 'Saldo',
    alreadyPaid: 'Se você já pagou, desconsidere esta mensagem.',
    contact: (p, ph, em) => `Dúvidas? Fale com ${p}${ph ? ` pelo telefone ${ph}` : ''}${em ? `${ph ? ' ou' : ''} pelo e-mail ${em}` : ''}.`,
    quoteBtn: 'Ver e aprovar', invoiceBtn: 'Ver fatura', payBtn: 'Ver e pagar',
    copySubject: (n, p) => `Cópia do orçamento ${n} de ${p}`,
    copyKicker: 'ORÇAMENTO APROVADO', copyTitle: (n) => `Orçamento ${n} aprovado`,
    copyLead: (p, n, t, on, by) => `Aqui está a cópia do orçamento <strong>${n}</strong> de ${p}${t ? ` para <strong>${t}</strong>` : ''}${on ? `, aprovado em ${on}${by ? ` por ${by}` : ''}` : ''}.`,
    copyHash: 'Código de verificação do documento assinado (SHA-256):',
    copyCta: 'Guarde este e-mail. O link abre o orçamento quando você quiser.',
    copyBtn: 'Ver orçamento',
  },
  en: {
    quoteKicker: 'QUOTE', invoiceKicker: 'INVOICE', reminderKicker: 'PAYMENT REMINDER', quoteReminderKicker: 'REMINDER',
    quoteReminderSubject: (n, p) => `Reminder: quote ${n} from ${p}`,
    quoteReminderTitle: (n) => `Reminder: quote ${n}`,
    quoteReminderLead: (p, n, t) => `Just a friendly reminder about quote <strong>${n}</strong> from ${p}${t ? ` for <strong>${t}</strong>` : ''}.`,
    quoteSubject: (n, p) => `Quote ${n} from ${p}`,
    invoiceSubject: (n, p) => `Invoice ${n} from ${p}`,
    reminderSubject: (n, p) => `Reminder: invoice ${n} from ${p}`,
    quoteTitle: (n) => `Quote ${n}`, invoiceTitle: (n) => `Invoice ${n}`,
    reminderTitle: (n, late) => (late ? `Invoice ${n} is past due` : `Reminder: invoice ${n}`),
    hi: (f) => (f ? `Hi ${f},` : 'Hello,'),
    sentQuote: (p, n, t) => `${p} sent you quote <strong>${n}</strong>${t ? ` for <strong>${t}</strong>` : ''}.`,
    sentInvoice: (p, n, t) => `${p} sent you invoice <strong>${n}</strong>${t ? ` for <strong>${t}</strong>` : ''}.`,
    total: 'Total', validUntil: 'Valid until', depositOnApproval: 'Deposit due on approval',
    amountDue: 'Amount due', due: 'Due', uponReceipt: 'upon receipt',
    quoteCta: 'Open the link to see every item, approve and sign online.',
    invoiceCta: (online) => `Open the link to see the details${online ? ' and pay online by card' : ''}.`,
    paidNote: 'This invoice is paid in full. Thank you!',
    howToPay: 'How to pay',
    reminderLead: (p, n, late) => `This is a friendly reminder that invoice <strong>${n}</strong> from ${p} ${late ? 'is past due' : 'is still open'}.`,
    balance: 'Balance',
    alreadyPaid: 'If you have already paid, please disregard this message.',
    contact: (p, ph, em) => `Questions? Contact ${p}${ph ? ` at ${ph}` : ''}${em ? `${ph ? ' or' : ' at'} ${em}` : ''}.`,
    quoteBtn: 'Review and approve', invoiceBtn: 'View invoice', payBtn: 'View and pay',
    copySubject: (n, p) => `Copy of quote ${n} from ${p}`,
    copyKicker: 'APPROVED QUOTE', copyTitle: (n) => `Quote ${n} approved`,
    copyLead: (p, n, t, on, by) => `Here is a copy of quote <strong>${n}</strong> from ${p}${t ? ` for <strong>${t}</strong>` : ''}${on ? `, approved on ${on}${by ? ` by ${by}` : ''}` : ''}.`,
    copyHash: 'Verification code of the signed document (SHA-256):',
    copyCta: 'Keep this e-mail for your records. The link opens the quote anytime.',
    copyBtn: 'View quote',
  },
  es: {
    quoteKicker: 'PRESUPUESTO', invoiceKicker: 'FACTURA', reminderKicker: 'RECORDATORIO DE PAGO', quoteReminderKicker: 'RECORDATORIO',
    quoteReminderSubject: (n, p) => `Recordatorio: presupuesto ${n} de ${p}`,
    quoteReminderTitle: (n) => `Recordatorio: presupuesto ${n}`,
    quoteReminderLead: (p, n, t) => `Le recordamos el presupuesto <strong>${n}</strong> de ${p}${t ? ` para <strong>${t}</strong>` : ''}.`,
    quoteSubject: (n, p) => `Presupuesto ${n} de ${p}`,
    invoiceSubject: (n, p) => `Factura ${n} de ${p}`,
    reminderSubject: (n, p) => `Recordatorio: factura ${n} de ${p}`,
    quoteTitle: (n) => `Presupuesto ${n}`, invoiceTitle: (n) => `Factura ${n}`,
    reminderTitle: (n, late) => (late ? `Factura ${n} vencida` : `Recordatorio: factura ${n}`),
    hi: (f) => (f ? `Hola, ${f}:` : 'Hola:'),
    sentQuote: (p, n, t) => `${p} le envió el presupuesto <strong>${n}</strong>${t ? ` para <strong>${t}</strong>` : ''}.`,
    sentInvoice: (p, n, t) => `${p} le envió la factura <strong>${n}</strong>${t ? ` por <strong>${t}</strong>` : ''}.`,
    total: 'Total', validUntil: 'Válido hasta', depositOnApproval: 'Anticipo al aprobar',
    amountDue: 'Monto a pagar', due: 'Vence', uponReceipt: 'al recibirla',
    quoteCta: 'Abra el enlace para ver cada concepto, aprobar y firmar en línea.',
    invoiceCta: (online) => `Abra el enlace para ver los detalles${online ? ' y pagar en línea con tarjeta' : ''}.`,
    paidNote: 'Esta factura está pagada. ¡Gracias!',
    howToPay: 'Cómo pagar',
    reminderLead: (p, n, late) => `Le recordamos que la factura <strong>${n}</strong> de ${p} ${late ? 'está vencida' : 'sigue pendiente'}.`,
    balance: 'Saldo',
    alreadyPaid: 'Si ya pagó, por favor ignore este mensaje.',
    contact: (p, ph, em) => `¿Preguntas? Comuníquese con ${p}${ph ? ` al ${ph}` : ''}${em ? `${ph ? ' o' : ''} en ${em}` : ''}.`,
    quoteBtn: 'Ver y aprobar', invoiceBtn: 'Ver factura', payBtn: 'Ver y pagar',
    copySubject: (n, p) => `Copia del presupuesto ${n} de ${p}`,
    copyKicker: 'PRESUPUESTO APROBADO', copyTitle: (n) => `Presupuesto ${n} aprobado`,
    copyLead: (p, n, t, on, by) => `Aquí está la copia del presupuesto <strong>${n}</strong> de ${p}${t ? ` para <strong>${t}</strong>` : ''}${on ? `, aprobado el ${on}${by ? ` por ${by}` : ''}` : ''}.`,
    copyHash: 'Código de verificación del documento firmado (SHA-256):',
    copyCta: 'Guarde este correo. El enlace abre el presupuesto cuando quiera.',
    copyBtn: 'Ver presupuesto',
  },
}

/**
 * Conteúdo do e-mail (assunto, título, parágrafos em HTML escapado, botão). Função pura.
 * kind: 'send' (orçamento ou fatura) | 'reminder' (orçamento aguardando ou fatura em aberto).
 */
export function docEmailContent(doc, provider, kind = 'send') {
  const f = docFacts(doc, provider?.timezone)
  const L = EMAIL_TEXT[f.lang]
  const provRaw = providerDisplayName(provider)
  const prov = escapeHtml(provRaw)
  const subjProv = provRaw.replace(/[\r\n]+/g, ' ').slice(0, 80)
  const number = escapeHtml(f.number)
  const title = f.title ? escapeHtml(f.title) : ''
  const m = (c) => escapeHtml(fmtMoney(c, f.lang))
  const d = (k) => escapeHtml(fmtDate(k, f.lang))
  const contact = providerContact(provider)
  const online = doc.kind === 'invoice' && canPayOnline(provider)
  const instructions = doc.kind === 'invoice' && doc.payment_instructions
    ? escapeHtml(String(doc.payment_instructions).slice(0, 1000)).replace(/\n/g, '<br>')
    : ''
  const url = doc.public_url || publicUrlFor(doc.public_token)
  const contactLine = L.contact(prov, contact.phone ? escapeHtml(contact.phone) : '', contact.email ? escapeHtml(contact.email) : '')
  const p = [escapeHtml(L.hi(f.first))]
  let subject, kicker, title2, ctaLabel

  if (f.approvedCopy) {
    // Orçamento já aprovado/faturado: cópia pra guardar (sem validade nem pedido de aprovação)
    subject = L.copySubject(f.number, subjProv)
    kicker = f.acceptedOn ? L.copyKicker : L.quoteKicker
    title2 = f.acceptedOn ? L.copyTitle(f.number) : L.quoteTitle(f.number)
    ctaLabel = L.copyBtn
    p.push(L.copyLead(prov, number, title, f.acceptedOn ? d(f.acceptedOn) : '', f.acceptedName ? escapeHtml(f.acceptedName) : ''))
    p.push(`${L.total}: <strong>${m(f.total)}</strong>`)
    if (f.signedHash) p.push(`${L.copyHash}<br><span style="font-family:monospace;word-break:break-all">${f.signedHash}</span>`)
    p.push(L.copyCta)
  } else if (doc.kind === 'quote') {
    const reminder = kind === 'reminder'
    subject = reminder ? L.quoteReminderSubject(f.number, subjProv) : L.quoteSubject(f.number, subjProv)
    kicker = reminder ? L.quoteReminderKicker : L.quoteKicker
    title2 = reminder ? L.quoteReminderTitle(f.number) : L.quoteTitle(f.number)
    ctaLabel = L.quoteBtn
    p.push(reminder ? L.quoteReminderLead(prov, number, title) : L.sentQuote(prov, number, title))
    p.push(`${L.total}: <strong>${m(f.total)}</strong>${f.validUntil ? ` · ${L.validUntil} ${d(f.validUntil)}` : ''}`)
    if (f.deposit > 0) p.push(`${L.depositOnApproval}: <strong>${m(f.deposit)}</strong>`)
    p.push(L.quoteCta)
  } else if (kind === 'reminder') {
    subject = L.reminderSubject(f.number, subjProv)
    kicker = L.reminderKicker
    title2 = L.reminderTitle(f.number, f.overdue)
    ctaLabel = online ? L.payBtn : L.invoiceBtn
    p.push(L.reminderLead(prov, number, f.overdue))
    p.push(`${L.balance}: <strong>${m(f.balance)}</strong>${f.due ? ` · ${L.due} ${d(f.due)}` : ''}`)
    if (instructions) p.push(`<strong>${L.howToPay}:</strong><br>${instructions}`)
    p.push(L.invoiceCta(online))
    p.push(L.alreadyPaid)
  } else {
    subject = L.invoiceSubject(f.number, subjProv)
    kicker = L.invoiceKicker
    title2 = L.invoiceTitle(f.number)
    ctaLabel = online && !f.paid ? L.payBtn : L.invoiceBtn
    p.push(L.sentInvoice(prov, number, title))
    if (f.paid) p.push(L.paidNote)
    else {
      p.push(`${L.amountDue}: <strong>${m(f.balance)}</strong> · ${L.due} ${f.uponReceipt ? L.uponReceipt : d(f.due)}`)
      if (instructions) p.push(`<strong>${L.howToPay}:</strong><br>${instructions}`)
    }
    p.push(L.invoiceCta(online && !f.paid))
  }
  p.push(contactLine)
  const biz = provider?.app_settings?.business
  return {
    subject, kicker, title: title2, paragraphs: p, ctaUrl: url, ctaLabel,
    replyTo: contact.email,                                   // resposta da cliente vai pra profissional
    lang: f.lang,                                             // shell e rodapé no idioma do documento
    fromName: clip(biz?.legal_name, 120) || clip(provider?.name, 120) || null,   // "Empresa via BrasilConnect"
    hideBrand: emailHidesBrand(provider),                     // só Premium pago e ativo (nunca no teste grátis)
  }
}

/**
 * Manda o documento por e-mail pra cliente (via api/_lib/mailer.js). Não lança.
 * Vai com reply-to da profissional (business.email ou e-mail do perfil), idioma do documento,
 * From "<empresa> via BrasilConnect" e, só com Premium pago e ativo, sem a marca BrasilConnect.
 * Orçamento aprovado/faturado sai como cópia (com o código SHA-256 da versão assinada, se houver).
 * Limite de envios: quem chama confere (docEmailDailyCap / countDocEmails) e grava o evento
 * com detail.email_sent.
 */
export async function sendDocEmail(supabase, doc, provider, kind = 'send') {
  try {
    const to = String(doc?.client_email || '').trim().toLowerCase()
    if (!to || !EMAIL_RE.test(to)) return { ok: false, skipped: 'no_email' }
    let prov = provider
    if ((!prov || !prov.name) && supabase && doc.provider_id) {
      const { data } = await supabase.from('ag_providers')
        .select('id, name, email, whatsapp, timezone, app_settings, stripe_account_id, stripe_charges_enabled, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at')
        .eq('id', doc.provider_id).maybeSingle()
      prov = data || prov
    }
    const c = docEmailContent(doc, prov, kind === 'reminder' ? 'reminder' : 'send')
    return await sendTransactional({ to, ...c })
  } catch (e) {
    console.error('[documents] e-mail:', e.message)
    return { ok: false }
  }
}
