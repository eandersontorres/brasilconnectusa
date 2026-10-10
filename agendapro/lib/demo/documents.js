// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — orçamentos, faturas, tabela de preços e pedidos de
//   orçamento em memória. Mesmas rotas, actions, regras e formatos de
//   api/agenda/documents.js, api/agenda/catalog.js, api/agenda/quote-requests.js,
//   api/agenda/doc-public.js e api/_lib/documents.js (textos e mensagens copiados
//   de lá; mudou lá, copie aqui). Toda conta de valor sai de lib/docCalc.js.
//   Plano sem o recurso → 402 igual ao servidor. JS puro, sem react-native.
// ════════════════════════════════════════════════════════════════════════════
import { computeTotals, docNumber, invoiceStatus, cleanQty, cleanPct, UNITS, ITEM_KINDS } from '../docCalc.js'
import { effectivePlan, hasFeature, limitFor, requireFeature, requireLimit } from './plans.js'
import { HttpError } from './finance.js'
import { addDays, canonicalJson, diffDays, fold, localToday, normalizePhone, sha256Hex, uid, wallToReal } from './util.js'

export const DOC_KINDS = ['quote', 'invoice']
export const DOC_LANGS = ['pt', 'en', 'es']
export const PAY_METHODS = ['zelle', 'cash', 'check', 'card', 'ach', 'venmo', 'cashapp', 'other']
const SEND_CHANNELS = ['whatsapp', 'email', 'sms', 'link']
const EVENT_CHANNELS = ['whatsapp', 'email', 'sms', 'link', 'app', 'stripe', 'cron']
const REQUEST_STATUSES = ['new', 'contacted', 'quoted', 'closed', 'spam']
const MAX_ITEMS = 200
const MAX_PHOTOS = 12
const MAX_UNIT_PRICE_CENTS = 100000000      // US$ 1.000.000 por unidade
const MAX_DOC_CENTS = 1000000000            // US$ 10.000.000 por documento
const MAX_CATALOG = 1000
const LIST_LIMIT = 300
// "Em aberto" = aguardando a cliente (rascunho nunca entra), igual ao servidor
const OPEN_QUOTE = ['sent', 'viewed']
const OPEN_INVOICE = ['sent', 'viewed', 'partial', 'overdue']
const PUBLIC_OPEN_INVOICE = OPEN_INVOICE
const PUBLIC_OPEN_QUOTE = OPEN_QUOTE
const STATUS_FILTERS = {
  all: null,
  open: ['sent', 'viewed', 'partial', 'overdue'],
  draft: ['draft'], sent: ['sent'], viewed: ['viewed'], accepted: ['accepted'], declined: ['declined'],
  expired: ['sent', 'viewed', 'expired'], converted: ['converted'], partial: ['partial'], paid: ['paid'],
  overdue: ['sent', 'viewed', 'partial', 'overdue'], void: ['void'],
}
const STATUS_PT = {
  draft: 'rascunho', sent: 'enviado', viewed: 'visto', accepted: 'aprovado', declined: 'recusado',
  expired: 'vencido', converted: 'faturado', partial: 'pago em parte', paid: 'pago', overdue: 'vencido', void: 'anulado',
}
// Rótulos das faturas geradas do orçamento (idioma do documento)
export const CONVERT_L = {
  pt: { deposit: 'Entrada', stage: 'Etapa', of: 'de', balance: 'Saldo restante' },
  en: { deposit: 'Deposit', stage: 'Stage', of: 'of', balance: 'Remaining balance' },
  es: { deposit: 'Anticipo', stage: 'Etapa', of: 'de', balance: 'Saldo restante' },
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/
const MIN_CARD_CENTS = 50
const DEFAULT_DUE_DAYS = 14                 // vencimento padrão sem doc_defaults.due_days (servidor e app)
const CONSENT_TEXT_VERSION = 'esign-v1'     // texto do consentimento de assinatura eletrônica
// Teto de e-mail de documento (anti-spam): por conta em 24h, por documento e lembrete por e-mail
const EMAIL_DAY_TRIAL = 20
const EMAIL_DAY_PAID = 100
const EMAIL_SENDS_PER_DOC_DAY = 3

const ok = (body, status = 200) => ({ status, body })
const fail = (status, error, extra = {}) => { throw new HttpError(status, { error, ...extra }) }
const notAllowed = () => ok({ error: 'Method not allowed' }, 405)
function gate(P, key) {
  const g = requireFeature(P, key)
  if (!g.ok) throw new HttpError(g.status, g.body)
}
const featureOf = (kind) => (kind === 'quote' ? 'quotes' : 'invoices')
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const clip = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null)
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null)
const isUuid = (v) => UUID_RE.test(String(v || ''))
const nowIso = () => new Date().toISOString()
const langOf = (l) => (DOC_LANGS.includes(l) ? l : 'en')
/** Data local ('YYYY-MM-DD') de um instante real (paid_at, created_at). */
const dayOf = (iso) => localToday(new Date(iso))

/** Texto com quebras de linha (notas, condições): tira caractere de controle e corta. */
export function cleanText(v, n) {
  if (v == null) return null
  const s = String(v).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n').trim().slice(0, n)
  return s || null
}
export function parseDateKey(v) {
  const s = String(v ?? '').trim().slice(0, 10)
  if (!DATE_RE.test(s)) return null
  const d = new Date(s + 'T12:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  const y = Number(s.slice(0, 4))
  return y >= 2000 && y <= 2100 ? s : null
}

/** Token do link da cliente (/d/<token>). Na demo não precisa ser criptográfico. */
export function newDocToken(rand = Math.random) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let s = ''
  for (let i = 0; i < 32; i++) s += abc[Math.floor(rand() * abc.length)]
  return s
}

/** Colunas do aceite eletrônico e do Checkout aberto (nascem vazias em todo documento novo). */
export const NEW_DOC_EXTRA = Object.freeze({
  signed_snapshot: null, signed_hash: null, consent_at: null, consent_text_version: null,
  stripe_checkout_session_id: null, stripe_checkout_expires_at: null,
})

/** Estado das tabelas novas (fixtures antigas ou conta excluída começam vazias). */
export function ensureDocState(S) {
  for (const k of ['catalog', 'documents', 'docItems', 'docEvents', 'docPayments', 'quoteRequests']) if (!Array.isArray(S[k])) S[k] = []
  if (!isObj(S.docCounters)) S.docCounters = { quote: 0, invoice: 0 }
  return S
}

// ── Formatação (idioma do documento) ────────────────────────────────────────
const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-US' }
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtMoney(cents, lang = 'en') {
  const v = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat(LOCALES[langOf(lang)], { style: 'currency', currency: 'USD' }).format(v)
  } catch (_) {
    return '$' + v.toFixed(2)
  }
}
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

// ── Formatos (iguais ao CONTRACT / api/_lib/documents.js) ───────────────────
export const publicUrlOf = (site, token) => (token ? `${site}/d/${token}` : null)

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

export function shapeDoc(row, site, opts = {}) {
  if (!row) return null
  const doc = {
    id: row.id, kind: row.kind, number: row.number,
    status: opts.today ? effectiveStatus(row, opts.today) : row.status,
    client_id: row.client_id ?? null, client_name: row.client_name || '', client_email: row.client_email || null,
    client_phone: row.client_phone || null, client_address: row.client_address || null,
    title: row.title || null, job_address: row.job_address || null, language: langOf(row.language),
    issue_date: dateOnly(row.issue_date), due_date: dateOnly(row.due_date), valid_until: dateOnly(row.valid_until),
    subtotal_cents: toInt(row.subtotal_cents), discount_pct: numOrNull(row.discount_pct), discount_cents: toInt(row.discount_cents),
    tax_rate_bps: toInt(row.tax_rate_bps), tax_cents: toInt(row.tax_cents), total_cents: toInt(row.total_cents),
    deposit_pct: numOrNull(row.deposit_pct), deposit_cents: toInt(row.deposit_cents), amount_paid_cents: toInt(row.amount_paid_cents),
    balance_cents: balanceOf(row),
    notes: row.notes || null, terms: row.terms || null, payment_instructions: row.payment_instructions || null,
    internal_notes: row.internal_notes || null, photos: Array.isArray(row.photos) ? row.photos.slice() : [],
    stage_label: row.stage_label || null, quote_id: row.quote_id ?? null, appointment_id: row.appointment_id ?? null,
    quote_request_id: row.quote_request_id ?? null,
    sent_at: row.sent_at || null, viewed_at: row.viewed_at || null, accepted_at: row.accepted_at || null,
    accepted_name: row.accepted_name || null, declined_at: row.declined_at || null, decline_reason: row.decline_reason || null,
    paid_at: row.paid_at || null, voided_at: row.voided_at || null, reminders_sent: toInt(row.reminders_sent),
    signed_hash: row.signed_hash || null, consent_at: row.consent_at || null,
    created_at: row.created_at || null, updated_at: row.updated_at || null,
    public_url: publicUrlOf(site, row.public_token),
  }
  if (opts.withSignature) {
    doc.accepted_signature = row.accepted_signature || null
    doc.signed_snapshot = isObj(row.signed_snapshot) ? row.signed_snapshot : null      // o que a cliente aprovou (só no ?id)
  }
  return doc
}
export function shapeItem(r) {
  return {
    id: r.id, position: toInt(r.position), catalog_item_id: r.catalog_item_id ?? null,
    kind: ITEM_KINDS.includes(r.kind) ? r.kind : 'service', description: r.description || '',
    quantity: Number(r.quantity) || 0, unit: r.unit || 'un', unit_price_cents: toInt(r.unit_price_cents),
    taxable: r.taxable === true, line_total_cents: toInt(r.line_total_cents),
  }
}
const shapePayment = (p) => ({
  id: p.id, amount_cents: toInt(p.amount_cents), method: p.method || (p.source === 'stripe' ? 'card' : 'other'),
  paid_at: p.paid_at || p.created_at || null, note: p.note || null, source: p.source === 'stripe' ? 'stripe' : 'manual',
})
const shapeEvent = (e) => ({ id: e.id, type: e.type, channel: e.channel || null, detail: isObj(e.detail) ? e.detail : {}, created_at: e.created_at })

const byPos = (a, b) => a.position - b.position
export const itemsOf = (S, id) => S.docItems.filter((it) => it.document_id === id).sort(byPos)
export const paymentsOf = (S, id) => S.docPayments.filter((p) => p.document_id === id && p.type === 'invoice' && p.status === 'paid')
  .sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)))
const eventsOf = (S, id) => S.docEvents.filter((e) => e.document_id === id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

/** Linha do tempo (igual a addEvent: canal fora da lista vira null). */
export function logEvent(S, doc, type, channel = 'app', detail = {}, at = null) {
  const ev = { id: uid(), document_id: doc.id, provider_id: doc.provider_id, type: String(type).slice(0, 30), channel: EVENT_CHANNELS.includes(channel) ? channel : null, detail: isObj(detail) ? detail : {}, created_at: at || nowIso() }
  S.docEvents.push(ev)
  return ev
}

/**
 * Valores pela conta única (computeTotals) — usado pelos dados de exemplo pra
 * nascerem com os mesmos totais que o servidor gravaria.
 */
export function applyTotals(doc, items, paidCents, todayKey) {
  const t = computeTotals({
    items, discount_pct: doc.discount_pct, discount_cents: numOrNull(doc.discount_pct) > 0 ? 0 : doc.discount_cents,
    tax_rate_bps: doc.tax_rate_bps, deposit_pct: doc.deposit_pct, deposit_cents: numOrNull(doc.deposit_pct) > 0 ? 0 : doc.deposit_cents,
    amount_paid_cents: doc.kind === 'invoice' ? paidCents : 0,
  })
  t.lines.forEach((l, i) => { items[i].line_total_cents = l.line_total_cents })
  Object.assign(doc, {
    subtotal_cents: t.subtotal_cents, discount_cents: t.discount_cents, tax_cents: t.tax_cents, total_cents: t.total_cents,
    deposit_cents: t.deposit_cents, amount_paid_cents: doc.kind === 'invoice' ? Math.max(0, paidCents) : 0,
  })
  if (!(numOrNull(doc.discount_pct) > 0)) doc.discount_pct = null
  if (!(numOrNull(doc.deposit_pct) > 0)) doc.deposit_pct = null
  if (doc.kind === 'invoice' && doc.status !== 'draft' && doc.status !== 'void') doc.status = invoiceStatus(doc, todayKey)
  return t
}

/**
 * Fatura ligada a atendimento (creditFromAppointment do servidor): o que a cliente já pagou nele
 * (paid_cents marcado no app, senão o sinal pago) entra como pagamento da fatura (metadata.source
 * 'appointment', no dia do atendimento), menos o que outras faturas dele já lançaram assim. A fatura
 * não cobra de novo e as Finanças tiram do atendimento o que a fatura recebeu. → valor lançado | 0
 */
function creditFromAppointment(S, c, doc) {
  if (!doc || doc.kind !== 'invoice' || !doc.appointment_id || doc.status === 'void') return 0
  const room = toInt(doc.total_cents) - toInt(doc.amount_paid_cents)
  if (room <= 0) return 0
  const a = S.appointments.find((x) => x.id === doc.appointment_id)
  if (!a) return 0
  const received = a.paid_cents != null ? Math.max(0, toInt(a.paid_cents))
    : (a.deposit_paid && a.status !== 'canceled' ? Math.max(0, toInt(a.deposit_cents)) : 0)
  if (received <= 0) return 0
  const already = S.docPayments.filter((p) => p.type === 'invoice' && p.status === 'paid' && p.metadata?.source === 'appointment' && p.metadata?.appointment_id === a.id)
    .reduce((t, p) => t + Math.max(0, toInt(p.amount_cents)), 0)
  const amount = Math.min(room, received - already)
  if (amount <= 0) return 0
  const day = parseDateKey(String(a.scheduled_for || '').slice(0, 10)) || c.today
  const onDay = day < c.today ? day : c.today
  // Dia do atendimento (meio-dia): a receita fica no mesmo mês de antes
  const paidAt = onDay === c.today ? nowIso() : wallToReal(`${onDay}T12:00:00.000Z`)
  const m = a.paid_cents != null ? (a.paid_method || a.payment_method) : a.payment_method
  const method = PAY_METHODS.includes(m) ? m : (m === 'stripe' || m === 'debit' ? 'card' : 'other')
  const pay = {
    id: uid(), provider_id: doc.provider_id, document_id: doc.id, appointment_id: null, type: 'invoice', status: 'paid', amount_cents: amount, method,
    paid_at: paidAt, note: 'Recebido no atendimento', source: 'manual', created_at: nowIso(),
    metadata: { method, source: 'appointment', appointment_id: a.id, paid_on: onDay, note: 'Recebido no atendimento', recorded_by: 'system' },
  }
  S.docPayments.push(pay)
  const r = recomputeInvoice(S, doc, c.today)
  logEvent(S, doc, 'payment', 'app', { payment_id: pay.id, amount_cents: amount, method, paid_on: onDay, from_appointment: true, ...(r?.became_paid ? { fully_paid: true } : {}) })
  return amount
}

/** Soma os pagamentos e acerta status/paid_at da fatura (recomputeInvoice). */
function recomputeInvoice(S, doc, today) {
  if (!doc || doc.kind !== 'invoice') return null
  const pays = paymentsOf(S, doc.id)
  const paid = pays.reduce((s, p) => s + Math.max(0, toInt(p.amount_cents)), 0)
  // Igual ao servidor: fatura que a cliente não recebeu continua rascunho, mesmo com pagamento
  const status = doc.status !== 'void' && !doc.sent_at ? 'draft' : invoiceStatus({ ...doc, amount_paid_cents: paid }, today)
  let paid_at = null
  if (status === 'paid') {
    const last = pays.map((p) => p.paid_at || p.created_at).filter(Boolean).sort().pop()
    paid_at = doc.status === 'paid' && doc.paid_at ? doc.paid_at : (last || nowIso())
  }
  const became = status === 'paid' && doc.status !== 'paid'
  Object.assign(doc, { amount_paid_cents: paid, status, paid_at, updated_at: nowIso() })
  return { became_paid: became }
}

// ── Mensagens pra cliente (cópia de docMessage de api/_lib/documents.js) ────
export function providerDisplayName(P) {
  const b = P?.app_settings?.business
  return clip(b?.legal_name, 120) || clip(P?.name, 120) || 'BrasilConnect'
}
const firstName = (n) => clip(String(n || '').split(' ')[0], 40) || ''
function docFacts(doc) {
  const lang = langOf(doc.language)
  const total = toInt(doc.total_cents)
  const balance = doc.balance_cents != null ? toInt(doc.balance_cents) : balanceOf(doc)
  const due = dateOnly(doc.due_date)
  const issue = dateOnly(doc.issue_date)
  return {
    lang,
    // Orçamento já aprovado/faturado: reenviar vira cópia (sem "revise e aprove")
    approvedCopy: doc.kind === 'quote' && (doc.status === 'accepted' || doc.status === 'converted'),
    acceptedOn: doc.accepted_at ? dayOf(doc.accepted_at) : null,
    first: firstName(doc.client_name), title: clip(doc.title, 80), number: doc.number || '', total, balance,
    deposit: toInt(doc.deposit_cents), validUntil: dateOnly(doc.valid_until), due, uponReceipt: !due || due === issue,
    paid: doc.kind === 'invoice' && (doc.status === 'paid' || (total > 0 && balance === 0 && doc.status !== 'void')),
    overdue: doc.status === 'overdue',
  }
}
export function docMessage(doc, P, publicUrl, opts = {}) {
  if (!doc) return ''
  const f = docFacts(doc)
  const prov = providerDisplayName(P)
  const url = publicUrl || doc.public_url || ''
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
    return {
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
    }[f.lang]
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
        + (f.due ? (f.overdue ? `, vencida em ${d(f.due)}` : `, vence em ${d(f.due)}`) : '') + `. Veja e pague pelo link: ${url}`,
      en: `${hi} Friendly reminder about invoice ${f.number} from ${prov}: balance of ${m(f.balance)}`
        + (f.due ? (f.overdue ? `, past due since ${d(f.due)}` : `, due ${d(f.due)}`) : '') + `. View and pay here: ${url}`,
      es: `${hi} Le recordamos la factura ${f.number} de ${prov}: saldo de ${m(f.balance)}`
        + (f.due ? (f.overdue ? `, vencida el ${d(f.due)}` : `, vence el ${d(f.due)}`) : '') + `. Véala y páguela aquí: ${url}`,
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

// ── Padrões e validação de entrada (iguais ao servidor) ─────────────────────
const clampInt = (v, min, max, def) => {
  if (v === null || v === undefined || v === '') return def
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
export function docDefaults(P) {
  const d = P?.app_settings?.doc_defaults
  const s = isObj(d) ? d : {}
  return {
    tax_rate_bps: clampInt(s.tax_rate_bps, 0, 2500, 0), due_days: clampInt(s.due_days, 0, 120, DEFAULT_DUE_DAYS),
    quote_valid_days: clampInt(s.quote_valid_days, 1, 180, 30), deposit_pct: clampInt(s.deposit_pct, 0, 100, 0),
    language: DOC_LANGS.includes(s.language) ? s.language : 'en',
    terms: cleanText(s.terms, 5000), notes: cleanText(s.notes, 2000), payment_instructions: cleanText(s.payment_instructions, 1000),
  }
}
function cleanUnit(v) {
  const s = clip(v, 16)
  if (!s) return 'un'
  return UNITS.includes(s) ? s : s.replace(/[<>{}"\\]/g, '') || 'un'
}
function normalizeItems(list) {
  if (list == null) return { items: [] }
  if (!Array.isArray(list)) return { error: 'Itens inválidos' }
  if (list.length > MAX_ITEMS) return { error: `No máximo ${MAX_ITEMS} itens por documento` }
  const items = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const n = i + 1
    if (!isObj(it)) return { error: `Item ${n} inválido` }
    const description = cleanText(it.description ?? it.name, 500)
    if (!description) return { error: `Escreva a descrição do item ${n}` }
    const quantity = cleanQty(it.quantity ?? 1)
    if (quantity === null) return { error: `Quantidade inválida no item ${n}` }
    const priceRaw = it.unit_price_cents ?? 0
    const price = Math.round(Number(priceRaw === '' ? 0 : priceRaw))
    if (!Number.isFinite(price) || price < 0) return { error: `Preço inválido no item ${n}` }
    if (price > MAX_UNIT_PRICE_CENTS) return { error: `Preço muito alto no item ${n}` }
    items.push({
      position: i, catalog_item_id: isUuid(it.catalog_item_id) ? String(it.catalog_item_id) : null,
      kind: ITEM_KINDS.includes(it.kind) ? it.kind : 'service', description, quantity, unit: cleanUnit(it.unit),
      unit_price_cents: price, taxable: it.taxable === true || it.taxable === 'true',
    })
  }
  return { items }
}
function normalizePhotos(list) {
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
/** O que não pode mudar por causa do status (editBlock). */
function editBlock(doc) {
  if (!doc) return null
  if (doc.kind === 'quote' && doc.status === 'converted') return { all: true, error: 'Esse orçamento já virou fatura e não pode mais ser editado. Duplique para fazer outro.' }
  if (doc.kind === 'invoice' && doc.status === 'void') return { values: true, error: 'Fatura anulada não pode ser alterada. Duplique para emitir outra.' }
  if (doc.kind === 'invoice' && doc.status === 'paid') return { values: true, error: 'Fatura paga não muda itens nem valores. Remova o pagamento antes, se precisar corrigir.' }
  if (doc.kind === 'quote' && doc.status === 'accepted') return { values: true, error: 'A cliente já aprovou esse orçamento. Para mudar itens ou valores, duplique e envie de novo.' }
  return null
}
const LOCK_COMPARE = ['client_id', 'client_name', 'client_email', 'client_phone', 'client_address', 'title', 'job_address',
  'language', 'issue_date', 'due_date', 'valid_until', 'discount_pct', 'discount_cents', 'tax_rate_bps', 'deposit_pct',
  'deposit_cents', 'notes', 'terms', 'payment_instructions', 'appointment_id', 'quote_request_id']
function sameVal(a, b) {
  const x = a === undefined || a === '' ? null : a
  const y = b === undefined || b === '' ? null : b
  if (x === null || y === null) return x === y
  if (typeof x === 'number' || typeof y === 'number') {
    const nx = Number(x), ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx === ny
  }
  const sx = String(x), sy = String(y)
  if (/^\d{4}-\d{2}-\d{2}/.test(sx) && /^\d{4}-\d{2}-\d{2}/.test(sy) && (sx.length <= 10 || sy.length <= 10)) return sx.slice(0, 10) === sy.slice(0, 10)
  return sx === sy
}

export function addressOf(c) {
  if (!c) return null
  const stateZip = [c.state, c.zip].filter(Boolean).join(' ')
  return [c.address_line, c.city, stateZip].filter(Boolean).join(', ') || null
}
/** Cópia da ficha no documento (dados de exemplo). */
export const clientSnapshot = (cl) => ({
  client_id: cl.id, client_name: cl.name, client_email: cl.email || null, client_phone: cl.whatsapp || null, client_address: addressOf(cl),
})

function newClientRow(S, fields) {
  const now = nowIso()
  const row = {
    id: uid(), provider_id: S.provider.id, name: null, whatsapp: null, email: null, language: 'pt', birthday_md: null, tags: [],
    address_line: null, city: null, state: null, zip: null, home_notes: null, notes: null,
    total_visits: 0, total_spent_cents: 0, first_visit_at: null, last_visit_at: null, archived: false, created_at: now, updated_at: now, ...fields,
  }
  S.clients.push(row)
  return row
}
// Ficha pelo telefone (aceita o número guardado sem '+' ou com 10 dígitos)
function findByPhone(S, phone) {
  const digits = phone.slice(1)
  const variants = new Set([phone, digits, digits.startsWith('1') ? digits.slice(1) : digits])
  return S.clients.find((x) => x.whatsapp && variants.has(x.whatsapp)) || null
}

/** Cliente do documento (resolveDocClient). null = mantém o que o documento já tem. */
function resolveDocClient(S, b, existing) {
  const wants = has(b, 'client_id') || has(b, 'client') || has(b, 'client_name')
  if (existing && !wants) return null
  const c = isObj(b.client) ? b.client : { name: b.client_name, email: b.client_email, phone: b.client_phone ?? b.client_whatsapp, address: b.client_address }
  const name = clip(c.name, 120)
  let phone = null
  if (c.phone != null && String(c.phone).trim()) {
    phone = normalizePhone(String(c.phone).slice(0, 30))
    if (!phone) fail(400, 'Telefone da cliente inválido. Use código de área + número.')
  }
  let email = null
  if (c.email != null && String(c.email).trim()) {
    email = String(c.email).trim().toLowerCase().slice(0, 254)
    if (!EMAIL_RE.test(email)) fail(400, 'E-mail da cliente inválido')
  }
  const address = cleanText(c.address, 300)
  if (b.client_id) {
    if (!isUuid(b.client_id)) fail(400, 'Cliente inválida')
    const f = S.clients.find((x) => x.id === String(b.client_id))
    if (!f) fail(404, 'Cliente não encontrada')
    return { client_id: f.id, client_name: name || f.name, client_email: email || f.email || null, client_phone: phone || f.whatsapp || null, client_address: address || addressOf(f) }
  }
  if (!name) fail(400, 'Informe o nome da cliente')
  const reuse = (f) => { if (f.archived === true) f.archived = false; if (email && !f.email) f.email = email; return f }
  let ficha = null
  const base = { name }
  if (address) base.address_line = address.replace(/\n+/g, ', ').slice(0, 160)
  if (phone) {
    const found = findByPhone(S, phone)
    ficha = found ? reuse(found) : newClientRow(S, { ...base, whatsapp: phone, ...(email ? { email } : {}) })
  } else if (email) {
    const found = S.clients.find((x) => x.email === email)
    ficha = found ? reuse(found) : newClientRow(S, { ...base, email })
  }
  return {
    client_id: ficha?.id || null, client_name: name, client_email: email || ficha?.email || null,
    client_phone: phone || ficha?.whatsapp || null, client_address: address || addressOf(ficha),
  }
}

/**
 * Cria (sem existing) ou atualiza um orçamento/fatura (saveDocument): valida,
 * recalcula com computeTotals, numera, grava itens e evento. → { document, items }
 */
function saveDocument(S, c, input = {}, opts = {}) {
  const P = S.provider
  const b = isObj(input) ? input : {}
  const existing = opts.existing || null
  const kind = existing ? existing.kind : b.kind
  if (!DOC_KINDS.includes(kind)) fail(400, 'Escolha orçamento (quote) ou fatura (invoice)')
  const block = existing ? editBlock(existing) : null
  if (block?.all) fail(409, block.error, { code: 'locked' })
  const defs = docDefaults(P)
  const today = c.today
  const now = nowIso()
  const isQuote = kind === 'quote'
  const ex = existing || {}

  const client = resolveDocClient(S, b, existing) || {
    client_id: ex.client_id ?? null, client_name: ex.client_name, client_email: ex.client_email ?? null,
    client_phone: ex.client_phone ?? null, client_address: ex.client_address ?? null,
  }
  if (!client.client_name) fail(400, 'Informe o nome da cliente')

  const title = has(b, 'title') ? clip(b.title, 160) : (ex.title ?? null)
  const job_address = has(b, 'job_address') ? cleanText(b.job_address, 300) : (ex.job_address ?? null)
  let language = existing ? langOf(ex.language) : defs.language
  if (has(b, 'language')) {
    if (!DOC_LANGS.includes(b.language)) fail(400, 'Idioma do documento inválido (pt, en ou es)')
    language = b.language
  }
  const textField = (k, n, def) => (has(b, k) ? cleanText(b[k], n) : (existing ? (ex[k] ?? null) : def))
  const notes = textField('notes', 2000, defs.notes)
  const terms = textField('terms', 5000, defs.terms)
  const payment_instructions = textField('payment_instructions', 1000, defs.payment_instructions || cleanText(P.deposit_instructions, 1000))
  const internal_notes = textField('internal_notes', 2000, null)

  let issue_date = existing ? dateOnly(ex.issue_date) : today
  if (has(b, 'issue_date') && b.issue_date !== null && b.issue_date !== '') {
    issue_date = parseDateKey(b.issue_date)
    if (!issue_date) fail(400, 'Data de emissão inválida')
  }
  const dateField = (k, defDays) => {
    if (has(b, k)) {
      if (b[k] === null || b[k] === '') return addDays(issue_date, defDays)
      return parseDateKey(b[k])
    }
    return existing ? (dateOnly(ex[k]) || addDays(issue_date, defDays)) : addDays(issue_date, defDays)
  }
  let due_date = null, valid_until = null
  if (isQuote) {
    valid_until = dateField('valid_until', defs.quote_valid_days)
    if (!valid_until) fail(400, 'Data de validade inválida')
    if (valid_until < issue_date) fail(400, 'A validade precisa ser no dia da emissão ou depois')
  } else {
    due_date = dateField('due_date', defs.due_days)
    if (!due_date) fail(400, 'Data de vencimento inválida')
    if (due_date < issue_date) fail(400, 'O vencimento precisa ser no dia da emissão ou depois')
  }

  let items
  const itemsGiven = has(b, 'items')
  if (itemsGiven) {
    const r = normalizeItems(b.items)
    if (r.error) fail(400, r.error)
    items = r.items
    for (const it of items) if (it.catalog_item_id && !S.catalog.some((x) => x.id === it.catalog_item_id)) it.catalog_item_id = null
  } else if (existing) {
    items = itemsOf(S, existing.id).map(({ position, catalog_item_id, kind: k, description, quantity, unit, unit_price_cents, taxable }) => ({ position, catalog_item_id, kind: k, description, quantity, unit, unit_price_cents, taxable }))
  } else items = []

  let discount_pct = existing ? numOrNull(ex.discount_pct) : null
  let discount_input = existing ? toInt(ex.discount_cents) : 0
  if (has(b, 'discount_pct') || has(b, 'discount_cents')) {
    const pct = cleanPct(b.discount_pct)
    if (pct !== null && pct > 0) { discount_pct = pct; discount_input = 0 } else {
      const n = Math.round(Number(b.discount_cents ?? 0))
      if (!Number.isFinite(n) || n < 0 || n > MAX_DOC_CENTS) fail(400, 'Desconto inválido')
      discount_pct = null; discount_input = n
    }
  }
  let tax_rate_bps = existing ? toInt(ex.tax_rate_bps) : defs.tax_rate_bps
  if (has(b, 'tax_rate_bps')) {
    const n = Math.round(Number(b.tax_rate_bps ?? 0))
    if (!Number.isFinite(n) || n < 0 || n > 2500) fail(400, 'Imposto inválido (de 0% a 25%)')
    tax_rate_bps = n
  }
  let deposit_pct = existing ? numOrNull(ex.deposit_pct) : (isQuote && defs.deposit_pct > 0 ? defs.deposit_pct : null)
  let deposit_input = existing ? toInt(ex.deposit_cents) : 0
  if (has(b, 'deposit_pct') || has(b, 'deposit_cents')) {
    const pct = cleanPct(b.deposit_pct)
    if (pct !== null && pct > 0) { deposit_pct = pct; deposit_input = 0 } else {
      const n = Math.round(Number(b.deposit_cents ?? 0))
      if (!Number.isFinite(n) || n < 0 || n > MAX_DOC_CENTS) fail(400, 'Entrada inválida')
      deposit_pct = null; deposit_input = n
    }
  }

  let photos = existing ? (Array.isArray(ex.photos) ? ex.photos : []) : []
  if (has(b, 'photos')) {
    const r = normalizePhotos(b.photos)
    if (r.error) fail(400, r.error)
    photos = r.photos
  }
  let appointment_id = existing ? (ex.appointment_id ?? null) : null
  if (has(b, 'appointment_id')) {
    if (b.appointment_id === null || b.appointment_id === '') appointment_id = null
    else {
      if (!isUuid(b.appointment_id)) fail(400, 'Agendamento inválido')
      if (!S.appointments.some((a) => a.id === String(b.appointment_id))) fail(404, 'Agendamento não encontrado')
      appointment_id = String(b.appointment_id)
    }
  }
  let quote_request_id = existing ? (ex.quote_request_id ?? null) : null
  if (has(b, 'quote_request_id')) {
    if (b.quote_request_id === null || b.quote_request_id === '') quote_request_id = null
    else {
      if (!isUuid(b.quote_request_id)) fail(400, 'Pedido de orçamento inválido')
      if (!S.quoteRequests.some((r) => r.id === String(b.quote_request_id))) fail(404, 'Pedido de orçamento não encontrado')
      quote_request_id = String(b.quote_request_id)
    }
  }

  const paid = existing ? toInt(ex.amount_paid_cents) : 0
  const t = computeTotals({ items, discount_pct, discount_cents: discount_input, tax_rate_bps, deposit_pct, deposit_cents: deposit_input, amount_paid_cents: paid })
  if (t.subtotal_cents > MAX_DOC_CENTS || t.total_cents > MAX_DOC_CENTS || t.lines.some((l) => l.line_total_cents > MAX_DOC_CENTS)) {
    fail(400, 'Valor total muito alto (máximo US$ 10.000.000 por documento)')
  }
  const row = {
    ...client, title, job_address, language, issue_date,
    due_date: isQuote ? null : due_date, valid_until: isQuote ? valid_until : null,
    subtotal_cents: t.subtotal_cents, discount_pct: discount_pct !== null && discount_pct > 0 ? discount_pct : null,
    discount_cents: t.discount_cents, tax_rate_bps, tax_cents: t.tax_cents, total_cents: t.total_cents,
    deposit_pct: deposit_pct !== null && deposit_pct > 0 ? deposit_pct : null, deposit_cents: t.deposit_cents,
    notes, terms, payment_instructions, internal_notes, photos, appointment_id, quote_request_id, updated_at: now,
  }
  const itemRows = (docId) => t.lines.map((l, i) => ({
    id: uid(), document_id: docId, provider_id: P.id, position: i, catalog_item_id: l.catalog_item_id || null, kind: l.kind,
    description: l.description, quantity: l.quantity, unit: l.unit, unit_price_cents: l.unit_price_cents, taxable: l.taxable === true, line_total_cents: l.line_total_cents,
  }))

  // ── Criação
  if (!existing) {
    ensureDocState(S)
    S.docCounters[kind] = (Number(S.docCounters[kind]) || 0) + 1
    const n = S.docCounters[kind]
    const extra = opts.extra || {}
    const doc = {
      id: uid(), provider_id: P.id, kind, seq: n, number: docNumber(kind, n), status: 'draft', public_token: newDocToken(), ...row,
      quote_id: extra.quote_id && isUuid(extra.quote_id) ? extra.quote_id : null, stage_label: extra.stage_label ? clip(extra.stage_label, 120) : null,
      sent_at: null, viewed_at: null, accepted_at: null, accepted_name: null, accepted_signature: null, accepted_ip: null, accepted_user_agent: null,
      declined_at: null, decline_reason: null, paid_at: null, voided_at: null, last_reminder_at: null, reminders_sent: 0, amount_paid_cents: 0,
      ...NEW_DOC_EXTRA, created_at: now,
    }
    const rows = itemRows(doc.id)
    S.documents.push(doc)
    S.docItems.push(...rows)
    logEvent(S, doc, 'created', opts.channel || 'app', opts.eventDetail || {})
    // Pedido de orçamento de origem: fica ligado e marcado como respondido
    if (quote_request_id) {
      const qr = S.quoteRequests.find((r) => r.id === quote_request_id && ['new', 'contacted'].includes(r.status))
      if (qr) Object.assign(qr, { document_id: doc.id, status: 'quoted', updated_at: now })
    }
    // Fatura do atendimento: o que já foi pago nele entra como pagamento (não cobra de novo)
    if (kind === 'invoice' && appointment_id) creditFromAppointment(S, c, doc)
    return { document: shapeDoc(doc, c.site, { today }), items: rows.map(shapeItem) }
  }

  // ── Atualização
  const itemsChanged = itemsGiven && itemSig(t.lines) !== itemSig(itemsOf(S, existing.id))
  if (block?.values) {
    const changed = LOCK_COMPARE.some((k) => !sameVal(row[k], ex[k]))
    if (changed || itemsChanged) fail(409, block.error, { code: 'locked' })
  }
  if (kind === 'invoice' && ex.status !== 'draft' && ex.status !== 'void') {
    row.status = invoiceStatus({ ...ex, ...row, amount_paid_cents: paid }, today)
    row.paid_at = row.status === 'paid' ? (ex.paid_at || now) : null
  }
  if (kind === 'quote' && ex.status === 'expired' && valid_until >= today) row.status = ex.viewed_at ? 'viewed' : 'sent'
  const prevTotal = existing.total_cents
  const linkedNow = kind === 'invoice' && appointment_id && !ex.appointment_id
  if (itemsChanged) {
    S.docItems = S.docItems.filter((it) => it.document_id !== existing.id)
    S.docItems.push(...itemRows(existing.id))
  }
  Object.assign(existing, row)
  logEvent(S, existing, 'updated', opts.channel || 'app', {
    ...(itemsChanged ? { items: t.lines.length } : {}), ...(existing.total_cents !== prevTotal ? { total_cents: existing.total_cents } : {}), ...(opts.eventDetail || {}),
  })
  // Fatura ligada agora a um atendimento: lança o que já foi pago nele
  if (linkedNow && existing.status !== 'void') creditFromAppointment(S, c, existing)
  return { document: shapeDoc(existing, c.site, { today }), items: itemsOf(S, existing.id).map(shapeItem) }
}

// ════════════════════════════════════════════════════════════════════════════
//   /api/agenda/documents
// ════════════════════════════════════════════════════════════════════════════
const cleanSearch = (q) => String(q || '').replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

function listDocuments(S, c, q) {
  const kind = DOC_KINDS.includes(q.kind) ? q.kind : null
  const status = String(q.status || 'all')
  if (!has(STATUS_FILTERS, status)) fail(400, 'Filtro de status inválido')
  let clientId = null
  if (q.client_id) {
    if (!isUuid(q.client_id)) fail(400, 'Cliente inválida')
    clientId = String(q.client_id)
  }
  const search = cleanSearch(q.q).toLowerCase()
  const f = STATUS_FILTERS[status]
  const rows = S.documents.filter((d) => {
    if (kind && d.kind !== kind) return false
    if (clientId && d.client_id !== clientId) return false
    if (f && !f.includes(d.status)) return false
    if (search && ![d.client_name, d.number, d.title].some((v) => String(v || '').toLowerCase().includes(search))) return false
    return true
  }).sort((x, y) => String(y.issue_date).localeCompare(String(x.issue_date)) || String(y.created_at).localeCompare(String(x.created_at)))
    .slice(0, LIST_LIMIT)
    .map((r) => ({ r, s: effectiveStatus(r, c.today) }))
  const out = status === 'open'
    ? rows.filter(({ r, s }) => (r.kind === 'quote' ? OPEN_QUOTE : OPEN_INVOICE).includes(s))
    : f ? rows.filter(({ s }) => s === status) : rows
  return out.map(({ r }) => shapeDoc(r, c.site, { today: c.today }))
}

function summaryOf(S, today) {
  const cutoff = addDays(today, -180)
  const month = today.slice(0, 7)
  const out = { open_quotes_cents: 0, open_quotes_count: 0, awaiting_cents: 0, overdue_cents: 0, overdue_count: 0, paid_month_cents: 0, acceptance_rate: null }
  let accepted = 0, declined = 0, expired = 0
  for (const r of S.documents) {
    if (r.kind === 'quote') {
      if (r.status === 'sent' || r.status === 'viewed') {
        if (effectiveStatus(r, today) === 'expired') { if (String(r.issue_date || '') >= cutoff) expired++; continue }
        out.open_quotes_count++
        out.open_quotes_cents += toInt(r.total_cents)
      } else if (['accepted', 'declined', 'expired', 'converted'].includes(r.status) && String(r.issue_date || '') >= cutoff) {
        if (r.status === 'accepted' || r.status === 'converted') accepted++
        else if (r.status === 'declined') declined++
        else expired++
      }
    } else if (['sent', 'viewed', 'partial', 'overdue'].includes(r.status)) {
      const bal = balanceOf(r)
      if (bal <= 0) continue
      out.awaiting_cents += bal
      if (effectiveStatus(r, today) === 'overdue') { out.overdue_count++; out.overdue_cents += bal }
    }
  }
  const decided = accepted + declined + expired
  // De 0 a 1 (null sem dado), orçamentos emitidos nos últimos 180 dias
  out.acceptance_rate = decided ? Math.round((accepted / decided) * 1000) / 1000 : null
  for (const p of S.docPayments) {
    if (p.type === 'invoice' && p.status === 'paid' && dayOf(p.paid_at).slice(0, 7) === month) out.paid_month_cents += Math.max(0, toInt(p.amount_cents))
  }
  return out
}

function loadOwn(S, id) {
  if (!isUuid(id)) fail(400, 'Documento inválido')
  const d = S.documents.find((x) => x.id === String(id))
  if (!d) fail(404, 'Documento não encontrado')
  return d
}

/** Limite de documentos criados no mês (Starter). adding = quantos esta ação cria. */
function checkMonthLimit(S, c, adding = 1) {
  if (limitFor(S.provider, 'documents_month') === null) return
  const month = c.today.slice(0, 7)
  const count = S.documents.filter((d) => dayOf(d.created_at).slice(0, 7) === month).length
  const g = requireLimit(S.provider, 'documents_month', count + Math.max(1, adding) - 1)
  if (!g.ok) throw new HttpError(g.status, g.body)
}

/** Foto nova no documento exige 'job_photos' (manter as antigas não). */
function gatePhotos(P, photos, current = []) {
  if (!Array.isArray(photos) || !photos.length) return
  const r = normalizePhotos(photos)
  if (r.error) fail(400, r.error)
  const cur = new Set(Array.isArray(current) ? current : [])
  if (r.photos.some((u) => !cur.has(u))) gate(P, 'job_photos')
}

/** Fatura do orçamento saiu (anulada/apagada) e não sobrou nenhuma: o orçamento volta a poder faturar. */
function releaseQuote(S, quoteId) {
  if (!quoteId) return
  if (S.documents.some((d) => d.kind === 'invoice' && d.quote_id === quoteId && d.status !== 'void')) return
  const q = S.documents.find((d) => d.id === quoteId)
  if (!q || q.status !== 'converted') return
  const status = q.accepted_at ? 'accepted' : q.viewed_at ? 'viewed' : q.sent_at ? 'sent' : 'draft'
  Object.assign(q, { status, updated_at: nowIso() })
  logEvent(S, q, 'updated', 'app', { reopened: true, status })
}

function wrongStatus(doc) {
  fail(400, `Esse ${doc.kind === 'quote' ? 'orçamento' : 'documento'} está ${STATUS_PT[doc.status] || doc.status}.`, { code: 'invalid_status' })
}

/**
 * Fatura saindo pela 1ª vez (sem sent_at, nem paga nem anulada): emissão = hoje e vencimento =
 * hoje + o prazo que ela tinha (vencimento − emissão), pra rascunho/etapa mandado depois não sair
 * vencido. → { issue_date, due_date, from } | null (já está com as datas de hoje)
 */
function firstSendDates(S, c, doc) {
  if (doc.kind !== 'invoice' || doc.sent_at || doc.status === 'paid' || doc.status === 'void') return null
  const issue = parseDateKey(doc.issue_date)
  const due = parseDateKey(doc.due_date)
  const term = issue && due ? Math.max(0, diffDays(issue, due)) : docDefaults(S.provider).due_days
  const next = { issue_date: c.today, due_date: addDays(c.today, term) }
  if (issue === next.issue_date && due === next.due_date) return null
  return { ...next, from: { issue_date: issue, due_date: due } }
}

/** draft → sent; orçamento vencido com validade estendida volta a valer. → { first, dates_moved? } */
function markSent(S, c, doc) {
  if (doc.kind === 'invoice' && doc.status === 'void') fail(400, 'Fatura anulada não pode ser enviada')
  if (!itemsOf(S, doc.id).length) fail(400, 'Adicione pelo menos um item antes de enviar')
  if (doc.kind === 'quote' && ['draft', 'sent', 'viewed', 'expired'].includes(doc.status) && doc.valid_until && dateOnly(doc.valid_until) < c.today) {
    fail(400, 'A validade desse orçamento já passou. Mude a data de validade antes de enviar.')
  }
  const before = doc.status
  const first = doc.status === 'draft'
  const dates = firstSendDates(S, c, doc)
  if (dates) { doc.issue_date = dates.issue_date; doc.due_date = dates.due_date }
  if (first) doc.status = 'sent'
  else if (doc.kind === 'quote' && doc.status === 'expired') doc.status = doc.viewed_at ? 'viewed' : 'sent'
  if (!doc.sent_at) doc.sent_at = nowIso()
  doc.updated_at = nowIso()
  // Fatura: status certo pelo vencimento (novo) e pelos pagamentos
  if (doc.kind === 'invoice' && (first || dates || before !== doc.status)) recomputeInvoice(S, doc, c.today)
  const datesMoved = dates ? { from: dates.from, to: { issue_date: dates.issue_date, due_date: dates.due_date } } : null
  return { first, ...(datesMoved ? { dates_moved: datesMoved } : {}) }
}

/**
 * E-mail sai pelo domínio do site: confere os limites ANTES de mandar (e antes de mudar o status).
 * type 'sent': até 3 envios por e-mail do documento em 24h. type 'reminder': 1 lembrete por e-mail
 * do documento em 24h (manual ou automático). Os dois: teto da conta em 24h (assinatura paga 100,
 * senão 20), contando todos os documentos. Demo: só a conta, o e-mail é de mentira.
 */
function checkEmailLimit(S, doc, type) {
  const since = Date.now() - 86400e3
  const mailed = S.docEvents.filter((e) => (e.type === 'sent' || e.type === 'reminder') && e.detail?.email_sent === true && Date.parse(e.created_at) >= since)
  const limit = (error) => fail(429, error, { code: 'email_limit' })
  const mine = mailed.filter((e) => e.document_id === doc.id)
  if (type === 'sent' && mine.filter((e) => e.type === 'sent').length >= EMAIL_SENDS_PER_DOC_DAY) {
    const what = doc.kind === 'quote' ? 'Esse orçamento já foi enviado' : 'Essa fatura já foi enviada'
    limit(`${what} por e-mail ${EMAIL_SENDS_PER_DOC_DAY} vezes nas últimas 24 horas. Mande pelo WhatsApp ou pelo link.`)
  }
  if (type === 'reminder' && mine.some((e) => e.type === 'reminder')) {
    limit('Já saiu um lembrete por e-mail desse documento nas últimas 24 horas. Lembre pelo WhatsApp ou tente amanhã.')
  }
  const eff = effectivePlan(S.provider)
  const cap = eff.status === 'active' && eff.tier !== 'none' && !eff.trial ? EMAIL_DAY_PAID : EMAIL_DAY_TRIAL
  if (mailed.length >= cap) limit(`Você chegou ao limite de ${cap} e-mails de orçamentos e faturas em 24 horas. Mande pelo WhatsApp ou pelo link, ou tente mais tarde.`)
}

export function documentsRoute(S, c) {
  ensureDocState(S)
  const { q, method, body: b, site, today } = c
  const P = S.provider
  const reply = (row) => shapeDoc(row, site, { today })
  if (method === 'GET') {
    if (q.id) {
      const doc = loadOwn(S, q.id)
      return ok({
        document: shapeDoc(doc, site, { today, withSignature: true }),
        items: itemsOf(S, doc.id).map(shapeItem),
        payments: doc.kind === 'invoice' ? paymentsOf(S, doc.id).map(shapePayment) : [],
        events: eventsOf(S, doc.id).map(shapeEvent),
      })
    }
    return ok({ documents: listDocuments(S, c, q), summary: summaryOf(S, today) })
  }
  if (method !== 'POST') return notAllowed()
  const action = String(b.action || '')

  if (action === 'create') {
    if (!DOC_KINDS.includes(b.kind)) fail(400, 'Escolha orçamento (quote) ou fatura (invoice)')
    gate(P, featureOf(b.kind))
    gatePhotos(P, b.photos)
    checkMonthLimit(S, c, 1)
    const r = saveDocument(S, c, b)
    return ok({ ok: true, document: r.document, items: r.items }, 201)
  }
  if (action === 'update') {
    const doc = loadOwn(S, b.id)
    gate(P, featureOf(doc.kind))
    if (has(b, 'photos')) gatePhotos(P, b.photos, doc.photos)
    const { id, kind, ...input } = b
    const r = saveDocument(S, c, input, { existing: doc })
    return ok({ ok: true, document: r.document, items: r.items })
  }
  if (action === 'duplicate') {
    const doc = loadOwn(S, b.id)
    gate(P, featureOf(doc.kind))
    checkMonthLimit(S, c, 1)
    const input = {
      kind: doc.kind,
      client: { name: doc.client_name, email: doc.client_email, phone: doc.client_phone, address: doc.client_address },
      title: doc.title, job_address: doc.job_address, language: doc.language,
      items: itemsOf(S, doc.id).map(({ catalog_item_id, kind: k, description, quantity, unit, unit_price_cents, taxable }) => ({ catalog_item_id, kind: k, description, quantity, unit, unit_price_cents, taxable })),
      tax_rate_bps: doc.tax_rate_bps, notes: doc.notes, terms: doc.terms, payment_instructions: doc.payment_instructions, internal_notes: doc.internal_notes,
      photos: hasFeature(P, 'job_photos') ? (doc.photos || []) : [],     // sem o recurso, a cópia sai sem as fotos
    }
    if (doc.client_id) input.client_id = doc.client_id
    if (doc.discount_pct != null && Number(doc.discount_pct) > 0) input.discount_pct = Number(doc.discount_pct)
    else input.discount_cents = doc.discount_cents || 0
    if (doc.kind === 'quote') {
      if (doc.deposit_pct != null && Number(doc.deposit_pct) > 0) input.deposit_pct = Number(doc.deposit_pct)
      else input.deposit_cents = doc.deposit_cents || 0
    }
    const r = saveDocument(S, c, input, { eventDetail: { duplicated_from: doc.number } })
    return ok({ ok: true, document: r.document, items: r.items }, 201)
  }
  if (action === 'send') {
    const doc = loadOwn(S, b.id)
    gate(P, featureOf(doc.kind))
    const channel = SEND_CHANNELS.includes(b.channel) ? b.channel : 'link'
    if (channel === 'email' && doc.client_email) checkEmailLimit(S, doc, 'sent')   // antes de mudar qualquer coisa
    const { first, dates_moved } = markSent(S, c, doc)
    const document = reply(doc)
    let emailSent = false
    let emailError = null
    if (channel === 'email') {
      if (!doc.client_email) emailError = 'Essa cliente não tem e-mail no documento. Mande pelo WhatsApp ou pelo link.'
      else emailSent = true                                     // demo: finge que o e-mail saiu
    }
    logEvent(S, doc, 'sent', channel, { first, ...(dates_moved ? { dates_moved } : {}), ...(channel === 'email' ? { email_sent: emailSent } : {}) })
    return ok({ ok: true, document, public_url: document.public_url, message: docMessage(document, P, document.public_url), email_sent: emailSent, ...(emailError ? { email_error: emailError } : {}) })
  }
  if (action === 'mark_sent') {
    const doc = loadOwn(S, b.id)
    gate(P, featureOf(doc.kind))
    // Fatura que já nasceu com pagamento do atendimento (parcial, nunca enviada) também passa por aqui
    if (doc.status !== 'draft' && (doc.kind !== 'invoice' || doc.sent_at || doc.status === 'void' || doc.status === 'paid')) {
      if (doc.kind === 'invoice' && doc.status === 'void') fail(400, 'Fatura anulada não pode ser enviada')
      return ok({ ok: true, document: reply(doc) })
    }
    const { dates_moved } = markSent(S, c, doc)
    logEvent(S, doc, 'sent', 'app', { manual: true, ...(dates_moved ? { dates_moved } : {}) })
    return ok({ ok: true, document: reply(doc) })
  }
  if (action === 'rotate_link') {
    // Link novo pra cliente: o antigo para de abrir na hora (mandou pro e-mail errado, por exemplo)
    const doc = loadOwn(S, b.id)
    Object.assign(doc, { public_token: newDocToken(), updated_at: nowIso() })
    logEvent(S, doc, 'updated', 'app', { link_rotated: true })
    return ok({ ok: true, document: reply(doc) })
  }
  if (action === 'mark_accepted') {
    const doc = loadOwn(S, b.id)
    if (doc.kind !== 'quote') fail(400, 'Só orçamento pode ser aprovado')
    if (doc.status === 'accepted') return ok({ ok: true, document: reply(doc) })
    if (!['draft', 'sent', 'viewed'].includes(doc.status)) wrongStatus(doc)
    const name = clip(b.name ?? b.accepted_name, 120)
    Object.assign(doc, { status: 'accepted', accepted_at: nowIso(), accepted_name: name, declined_at: null, decline_reason: null, updated_at: nowIso() })
    logEvent(S, doc, 'accepted', 'app', { by: 'provider', ...(name ? { name } : {}) })
    return ok({ ok: true, document: reply(doc) })
  }
  if (action === 'decline') {
    const doc = loadOwn(S, b.id)
    if (doc.kind !== 'quote') fail(400, 'Só orçamento pode ser recusado. Para fatura, use "Anular".')
    const reason = clip(b.reason, 500)
    if (doc.status === 'declined') {
      if (reason && reason !== doc.decline_reason) Object.assign(doc, { decline_reason: reason, updated_at: nowIso() })
      return ok({ ok: true, document: reply(doc) })
    }
    if (doc.status === 'converted') wrongStatus(doc)
    Object.assign(doc, { status: 'declined', declined_at: nowIso(), decline_reason: reason, updated_at: nowIso() })
    logEvent(S, doc, 'declined', 'app', { by: 'provider', ...(reason ? { reason } : {}) })
    return ok({ ok: true, document: reply(doc) })
  }
  if (action === 'convert') return convertQuote(S, c, b)
  if (action === 'record_payment') {
    const doc = loadOwn(S, b.id)
    if (doc.kind !== 'invoice') fail(400, 'Pagamento só pode ser registrado em fatura')
    gate(P, 'invoices')
    if (doc.status === 'void') fail(400, 'Fatura anulada não recebe pagamento')
    const balance = balanceOf(doc)
    if (balance <= 0) fail(400, 'Essa fatura já está paga')
    const amount = Math.round(Number(b.amount_cents))
    if (!Number.isFinite(amount) || amount <= 0) fail(400, 'Informe o valor recebido')
    // Acima do saldo vale (gorjeta, troco): o app confirma antes. Teto: o dobro do total.
    const cap = Math.min(MAX_DOC_CENTS, Math.max(balance, toInt(doc.total_cents) * 2))
    if (amount > cap) fail(400, `Valor muito acima do saldo da fatura (${fmtMoney(balance, 'pt')})`)
    if (!PAY_METHODS.includes(b.method)) fail(400, 'Escolha a forma de pagamento')
    let paidOn = today
    if (b.paid_on) {
      paidOn = parseDateKey(b.paid_on)
      if (!paidOn) fail(400, 'Data do pagamento inválida')
      if (paidOn > today) fail(400, 'A data do pagamento não pode ser no futuro')
    }
    // Pagamento de outro dia: meio-dia daquele dia (cai no mês certo nas Finanças)
    const paidAt = paidOn === today ? nowIso() : wallToReal(`${paidOn}T12:00:00.000Z`)
    const note = clip(b.note, 300)
    const pay = { id: uid(), provider_id: P.id, document_id: doc.id, appointment_id: null, type: 'invoice', status: 'paid', amount_cents: amount, method: b.method, paid_at: paidAt, note, source: 'manual', created_at: nowIso() }
    S.docPayments.push(pay)
    const r = recomputeInvoice(S, doc, today)
    logEvent(S, doc, 'payment', 'app', { payment_id: pay.id, amount_cents: amount, method: b.method, paid_on: paidOn, ...(r?.became_paid ? { fully_paid: true } : {}) })
    return ok({ ok: true, document: reply(doc), payments: paymentsOf(S, doc.id).map(shapePayment) })
  }
  if (action === 'remove_payment') {
    const doc = loadOwn(S, b.id)
    if (doc.kind !== 'invoice') fail(400, 'Pagamento só existe em fatura')
    gate(P, 'invoices')
    if (!isUuid(b.payment_id)) fail(400, 'Pagamento inválido')
    const pay = S.docPayments.find((p) => p.id === String(b.payment_id) && p.document_id === doc.id && p.type === 'invoice')
    if (!pay) fail(404, 'Pagamento não encontrado')
    if (pay.source === 'stripe') fail(400, 'Pagamento no cartão pelo link não sai daqui: peça o reembolso ao suporte do BrasilConnect (oi@brasilconnectusa.com). A fatura se acerta sozinha quando o reembolso sair.')
    S.docPayments.splice(S.docPayments.indexOf(pay), 1)
    recomputeInvoice(S, doc, today)
    logEvent(S, doc, 'payment', 'app', { removed: true, payment_id: pay.id, amount_cents: pay.amount_cents })
    return ok({ ok: true, document: reply(doc), payments: paymentsOf(S, doc.id).map(shapePayment) })
  }
  if (action === 'remind') {
    // Lembrete manual: fatura com saldo (cobrança) ou orçamento aguardando resposta
    const doc = loadOwn(S, b.id)
    gate(P, featureOf(doc.kind))
    if (doc.kind === 'invoice') {
      if (doc.status === 'draft') fail(400, 'Envie a fatura antes de cobrar')
      if (doc.status === 'void') fail(400, 'Fatura anulada não tem cobrança')
      if (balanceOf(doc) <= 0) fail(400, 'Essa fatura não tem saldo em aberto')
    } else {
      const st = effectiveStatus(doc, today)
      if (st === 'draft') fail(400, 'Envie o orçamento antes de lembrar a cliente')
      if (st === 'expired') fail(400, 'A validade desse orçamento já passou. Mude a data de validade e envie de novo.')
      if (!OPEN_QUOTE.includes(st)) wrongStatus({ ...doc, status: st })
    }
    const channel = SEND_CHANNELS.includes(b.channel) ? b.channel : (doc.client_email ? 'email' : 'whatsapp')
    if (channel === 'email' && doc.client_email) checkEmailLimit(S, doc, 'reminder')
    let emailSent = false
    let emailError = null
    if (channel === 'email') {
      if (!doc.client_email) emailError = 'Essa cliente não tem e-mail no documento. Lembre pelo WhatsApp.'
      else emailSent = true
    }
    if (channel !== 'email' || emailSent) Object.assign(doc, { last_reminder_at: nowIso(), reminders_sent: toInt(doc.reminders_sent) + 1, updated_at: nowIso() })
    logEvent(S, doc, 'reminder', channel, { manual: true, ...(channel === 'email' ? { email_sent: emailSent } : {}) })
    const out = reply(doc)
    return ok({ ok: true, document: out, public_url: out.public_url, message: docMessage(out, P, out.public_url, { reminder: true }), email_sent: emailSent, ...(emailError ? { email_error: emailError } : {}) })
  }
  if (action === 'void') {
    const doc = loadOwn(S, b.id)
    if (doc.kind !== 'invoice') fail(400, 'Só fatura pode ser anulada. Orçamento: marque como recusado.')
    gate(P, 'invoices')
    if (doc.status === 'void') return ok({ ok: true, document: reply(doc) })
    if (toInt(doc.amount_paid_cents) > 0) fail(400, 'Essa fatura tem pagamento registrado. Remova os pagamentos antes de anular.')
    Object.assign(doc, { status: 'void', voided_at: nowIso(), paid_at: null, updated_at: nowIso() })
    logEvent(S, doc, 'voided', 'app', {})
    releaseQuote(S, doc.quote_id)
    return ok({ ok: true, document: reply(doc) })
  }
  if (action === 'delete') {
    const doc = loadOwn(S, b.id)
    if (doc.status !== 'draft') {
      fail(400, doc.kind === 'invoice' ? 'Só rascunho pode ser apagado. Fatura enviada: use "Anular".' : 'Só rascunho pode ser apagado. Orçamento enviado: marque como recusado.', { code: 'invalid_status' })
    }
    S.documents.splice(S.documents.indexOf(doc), 1)
    S.docItems = S.docItems.filter((it) => it.document_id !== doc.id)
    S.docEvents = S.docEvents.filter((e) => e.document_id !== doc.id)
    for (const p of S.docPayments) if (p.document_id === doc.id) p.document_id = null
    releaseQuote(S, doc.quote_id)
    // Pedido que tinha virado este rascunho volta pra "em contato" (ON DELETE SET NULL)
    for (const r of S.quoteRequests) {
      if (r.document_id !== doc.id) continue
      r.document_id = null
      if (r.status === 'quoted') Object.assign(r, { status: 'contacted', updated_at: nowIso() })
    }
    return ok({ ok: true })
  }
  return ok({ error: 'Ação inválida' }, 400)
}

/**
 * Orçamento → fatura(s) (actConvert).
 *   full    → uma fatura com os mesmos itens, desconto e imposto. Se o orçamento já tem fatura
 *             (entrada/etapas), cria a fatura do saldo restante.
 *   deposit → fatura de entrada (deposit_pct do corpo, senão a entrada do orçamento, senão o padrão).
 *   stages  → uma fatura por etapa: [{ label, pct }] somando até 100%.
 */
function convertQuote(S, c, b) {
  const P = S.provider
  const quote = loadOwn(S, b.id)
  if (quote.kind !== 'quote') fail(400, 'Só orçamento vira fatura')
  gate(P, 'invoices')
  const mode = ['full', 'deposit', 'stages'].includes(b.mode) ? b.mode : 'full'
  if (mode !== 'full') gate(P, 'progress_billing')
  if (quote.status === 'declined') fail(400, 'A cliente recusou esse orçamento. Duplique e envie de novo, se precisar.')
  const items = itemsOf(S, quote.id)
  const total = toInt(quote.total_cents)
  if (!items.length || total <= 0) fail(400, 'O orçamento não tem itens com valor')

  const prev = S.documents.filter((d) => d.kind === 'invoice' && d.quote_id === quote.id && d.status !== 'void')
  const invoiced = prev.reduce((s, d) => s + toInt(d.total_cents), 0)
  const lang = langOf(quote.language)
  const L = CONVERT_L[lang]
  const single = (description, cents) => ({
    items: [{ kind: 'other', description, quantity: 1, unit: 'un', unit_price_cents: cents, taxable: false }],
    discount_cents: 0, tax_rate_bps: 0,
  })
  const specs = []
  if (prev.length) {
    if (mode !== 'full') fail(409, 'Esse orçamento já tem fatura. Para cobrar o resto, gere a fatura do saldo.', { code: 'already_invoiced' })
    const remainder = total - invoiced
    if (remainder <= 0) fail(409, 'Esse orçamento já foi faturado por inteiro.', { code: 'already_invoiced' })
    specs.push({ ...single(`${L.balance} · ${quote.number}`, remainder), stage_label: L.balance })
  } else if (mode === 'full') {
    const spec = { items: items.map(({ catalog_item_id, kind, description, quantity, unit, unit_price_cents, taxable }) => ({ catalog_item_id, kind, description, quantity, unit, unit_price_cents, taxable })), tax_rate_bps: toInt(quote.tax_rate_bps), stage_label: null }
    if (quote.discount_pct != null && Number(quote.discount_pct) > 0) spec.discount_pct = Number(quote.discount_pct)
    else spec.discount_cents = toInt(quote.discount_cents)
    specs.push(spec)
  } else if (mode === 'deposit') {
    let pct = cleanPct(b.deposit_pct)
    let cents = 0
    if (pct !== null && pct > 0) cents = Math.round((total * pct) / 100)
    else if (toInt(quote.deposit_cents) > 0) {
      cents = Math.min(total, toInt(quote.deposit_cents))
      pct = quote.deposit_pct != null && Number(quote.deposit_pct) > 0 ? Number(quote.deposit_pct) : Math.round((cents / total) * 10000) / 100
    } else {
      const def = docDefaults(P).deposit_pct
      if (def > 0) { pct = def; cents = Math.round((total * pct) / 100) }
    }
    if (!cents || cents <= 0) fail(400, 'Informe o percentual da entrada')
    const label = `${L.deposit} (${fmtPct(pct, lang)}%)`
    specs.push({ ...single(label, Math.min(cents, total)), stage_label: label })
  } else {
    if (!Array.isArray(b.stages) || !b.stages.length) fail(400, 'Informe as etapas')
    if (b.stages.length > 20) fail(400, 'No máximo 20 etapas')
    const stages = b.stages.map((s, i) => {
      const pct = cleanPct(s?.pct)
      if (pct === null || pct <= 0) fail(400, `Percentual inválido na etapa ${i + 1}`)
      return { label: clip(s?.label, 80), pct }
    })
    const sum = Math.round(stages.reduce((t, s) => t + s.pct, 0) * 100) / 100
    if (sum > 100) fail(400, `As etapas somam ${String(sum).replace('.', ',')}%. O máximo é 100%.`)
    const n = stages.length
    let used = 0
    stages.forEach((s, i) => {
      let cents = Math.round((total * s.pct) / 100)
      if (sum === 100 && i === n - 1) cents = total - used   // última etapa fecha o total sem sobra de centavo
      used += cents
      if (cents <= 0) fail(400, `A etapa ${i + 1} ficou sem valor`)
      const desc = `${L.stage} ${i + 1}: ${s.label || `${fmtPct(s.pct, lang)}%`}`
      specs.push({ ...single(desc, cents), stage_label: `${L.stage} ${i + 1} ${L.of} ${n} (${fmtPct(s.pct, lang)}%)` })
    })
  }

  checkMonthLimit(S, c, specs.length)
  const photos = hasFeature(P, 'job_photos') ? (quote.photos || []) : []
  const created = []
  for (const spec of specs) {
    const { stage_label, ...values } = spec
    const input = {
      kind: 'invoice', client: { name: quote.client_name, email: quote.client_email, phone: quote.client_phone, address: quote.client_address },
      title: quote.title, job_address: quote.job_address, language: lang, notes: quote.notes, terms: quote.terms, photos, deposit_cents: 0, ...values,
    }
    if (quote.client_id) input.client_id = quote.client_id
    if (quote.payment_instructions) input.payment_instructions = quote.payment_instructions
    if (quote.appointment_id) input.appointment_id = quote.appointment_id
    created.push(saveDocument(S, c, input, { extra: { quote_id: quote.id, stage_label }, eventDetail: { from_quote: quote.number, mode } }).document)
  }
  if (quote.status !== 'converted') Object.assign(quote, { status: 'converted', updated_at: nowIso() })
  logEvent(S, quote, 'converted', 'app', { mode, invoices: created.map((d) => d.number) })
  return ok({ ok: true, invoices: created, quote: shapeDoc(quote, c.site, { today: c.today }) }, 201)
}

// ════════════════════════════════════════════════════════════════════════════
//   /api/agenda/catalog — tabela de preços (cópia das regras de api/agenda/catalog.js)
// ════════════════════════════════════════════════════════════════════════════
const SAMPLE_NOTE = 'Preço de exemplo: ajuste ao seu.'
// Exemplos por especialidade: [pt, en, es, kind, unit, preço em centavos, tributável]
export const SEEDS = {
  construcao: [
    ['Mão de obra (hora)', 'Labor (hour)', 'Mano de obra (hora)', 'labor', 'hora', 6500, false],
    ['Material', 'Materials', 'Materiales', 'material', 'lote', 10000, true],
    ['Demolição', 'Demolition', 'Demolición', 'labor', 'ft²', 300, false],
    ['Descarte de entulho (caçamba)', 'Debris disposal (dumpster)', 'Retiro de escombros (contenedor)', 'fee', 'un', 45000, false],
    ['Licença da prefeitura (permit)', 'Permit fee', 'Permiso municipal', 'fee', 'un', 25000, false],
    ['Visita para orçamento', 'Estimate visit', 'Visita para presupuesto', 'service', 'visita', 0, false],
  ],
  handyman: [
    ['Visita técnica', 'Service call', 'Visita técnica', 'service', 'visita', 8500, false],
    ['Hora de serviço', 'Hourly labor', 'Hora de servicio', 'labor', 'hora', 7500, false],
    ['Instalação (TV, prateleira, luminária)', 'Installation (TV, shelf, light fixture)', 'Instalación (TV, repisa, lámpara)', 'service', 'un', 12000, false],
    ['Montagem de móveis', 'Furniture assembly', 'Armado de muebles', 'service', 'un', 9000, false],
    ['Pequenos reparos (porta, gaveta, parede)', 'Small repairs (door, drawer, wall)', 'Reparaciones menores (puerta, cajón, pared)', 'service', 'un', 9500, false],
    ['Material', 'Materials', 'Materiales', 'material', 'lote', 5000, true],
  ],
  marceneiro: [
    ['Projeto e medição', 'Design and measurement', 'Diseño y medición', 'service', 'projeto', 25000, false],
    ['MDF/madeira (material)', 'MDF/wood (materials)', 'MDF/madera (material)', 'material', 'un', 9500, true],
    ['Ferragens (dobradiças, corrediças)', 'Hardware (hinges, slides)', 'Herrajes (bisagras, correderas)', 'material', 'lote', 12000, true],
    ['Montagem e instalação', 'Assembly and installation', 'Armado e instalación', 'labor', 'hora', 7000, false],
    ['Armário planejado (por ft linear)', 'Custom cabinet (per linear ft)', 'Gabinete a medida (por pie lineal)', 'service', 'ft', 35000, false],
  ],
  pintor: [
    ['Pintura de parede por ft²', 'Wall painting per ft²', 'Pintura de pared por pie²', 'labor', 'ft²', 250, false],
    ['Pintura de teto por ft²', 'Ceiling painting per ft²', 'Pintura de techo por pie²', 'labor', 'ft²', 175, false],
    ['Pintura de cômodo completo', 'Full room painting', 'Pintura de cuarto completo', 'service', 'cômodo', 45000, false],
    ['Massa e preparação', 'Patching and prep', 'Masilla y preparación', 'labor', 'hora', 5500, false],
    ['Tinta (material)', 'Paint (materials)', 'Pintura (material)', 'material', 'un', 5500, true],
  ],
  eletricista: [
    ['Visita técnica', 'Service call', 'Visita técnica', 'service', 'visita', 9500, false],
    ['Mão de obra (hora)', 'Labor (hour)', 'Mano de obra (hora)', 'labor', 'hora', 9500, false],
    ['Instalação de tomada ou interruptor', 'Outlet or switch installation', 'Instalación de enchufe o interruptor', 'service', 'un', 12500, false],
    ['Instalação de luminária ou ventilador de teto', 'Light fixture or ceiling fan installation', 'Instalación de lámpara o ventilador de techo', 'service', 'un', 17500, false],
    ['Troca de disjuntor', 'Breaker replacement', 'Cambio de breaker', 'service', 'un', 20000, false],
    ['Material elétrico', 'Electrical materials', 'Material eléctrico', 'material', 'lote', 7500, true],
  ],
  encanador: [
    ['Visita técnica', 'Service call', 'Visita técnica', 'service', 'visita', 9500, false],
    ['Mão de obra (hora)', 'Labor (hour)', 'Mano de obra (hora)', 'labor', 'hora', 10000, false],
    ['Desentupimento', 'Drain cleaning', 'Destape de drenaje', 'service', 'un', 17500, false],
    ['Conserto de vazamento', 'Leak repair', 'Reparación de fuga', 'service', 'un', 22500, false],
    ['Instalação de aquecedor de água (mão de obra)', 'Water heater installation (labor)', 'Instalación de calentador de agua (mano de obra)', 'service', 'un', 65000, false],
    ['Peças e material', 'Parts and materials', 'Piezas y materiales', 'material', 'lote', 8000, true],
  ],
  drywall: [
    ['Instalação de drywall por ft²', 'Drywall installation per ft²', 'Instalación de drywall por pie²', 'labor', 'ft²', 250, false],
    ['Massa e acabamento por ft²', 'Taping and finishing per ft²', 'Encintado y acabado por pie²', 'labor', 'ft²', 150, false],
    ['Reparo de buraco na parede', 'Drywall hole repair', 'Reparación de hoyo en pared', 'service', 'un', 15000, false],
    ['Placa de drywall (material)', 'Drywall sheet (materials)', 'Placa de drywall (material)', 'material', 'un', 1800, true],
  ],
  pisos: [
    ['Instalação de piso por ft²', 'Floor installation per ft²', 'Instalación de piso por pie²', 'labor', 'ft²', 400, false],
    ['Instalação de azulejo por ft²', 'Tile installation per ft²', 'Instalación de azulejo por pie²', 'labor', 'ft²', 900, false],
    ['Remoção de piso antigo por ft²', 'Old floor removal per ft²', 'Retiro de piso viejo por pie²', 'labor', 'ft²', 200, false],
    ['Rejunte, argamassa e material', 'Grout, thinset and materials', 'Boquilla, pegamento y materiales', 'material', 'lote', 12000, true],
  ],
  telhado: [
    ['Inspeção de telhado', 'Roof inspection', 'Inspección de techo', 'service', 'visita', 15000, false],
    ['Reparo de telhado', 'Roof repair', 'Reparación de techo', 'service', 'un', 45000, false],
    ['Troca de telhas (shingles) por ft²', 'Shingle replacement per ft²', 'Cambio de tejas por pie²', 'labor', 'ft²', 500, false],
    ['Material (telhas, manta)', 'Materials (shingles, underlayment)', 'Materiales (tejas, membrana)', 'material', 'lote', 30000, true],
  ],
  paisagismo: [
    ['Corte de grama', 'Lawn mowing', 'Corte de césped', 'service', 'visita', 6000, false],
    ['Limpeza de quintal (hora)', 'Yard cleanup (hour)', 'Limpieza de patio (hora)', 'labor', 'hora', 5500, false],
    ['Plantio', 'Planting', 'Plantación', 'service', 'un', 3500, false],
    ['Mulch (material)', 'Mulch (materials)', 'Mulch (material)', 'material', 'lote', 6500, true],
  ],
  mudanca: [
    ['Equipe de mudança (2 pessoas, hora)', 'Moving crew (2 people, hour)', 'Equipo de mudanza (2 personas, hora)', 'labor', 'hora', 12000, false],
    ['Caminhão', 'Truck', 'Camión', 'fee', 'dia', 15000, false],
    ['Material de embalagem', 'Packing materials', 'Material de empaque', 'material', 'lote', 6000, true],
    ['Taxa de deslocamento', 'Travel fee', 'Cargo por traslado', 'fee', 'un', 7500, false],
  ],
  tradutor: [
    ['Tradução juramentada (por página)', 'Certified translation (per page)', 'Traducción certificada (por página)', 'service', 'página', 3500, false],
    ['Apostilamento (Haia)', 'Apostille (Hague)', 'Apostilla (La Haya)', 'fee', 'un', 7500, false],
    ['Cópia certificada', 'Certified copy', 'Copia certificada', 'fee', 'un', 1500, false],
    ['Envio pelo correio', 'Shipping', 'Envío por correo', 'fee', 'un', 1500, false],
    ['Taxa de urgência', 'Rush fee', 'Cargo por urgencia', 'fee', 'un', 5000, false],
  ],
  contador: [
    ['Imposto de renda individual (1040)', 'Individual tax return (1040)', 'Declaración de impuestos individual (1040)', 'service', 'un', 25000, false],
    ['ITIN (formulário W-7)', 'ITIN application (W-7)', 'Solicitud de ITIN (W-7)', 'service', 'un', 35000, false],
    ['Bookkeeping mensal', 'Monthly bookkeeping', 'Contabilidad mensual', 'service', 'un', 30000, false],
    ['Abertura de LLC', 'LLC formation', 'Apertura de LLC', 'service', 'un', 45000, false],
    ['Imposto de empresa (1065/1120-S)', 'Business tax return (1065/1120-S)', 'Declaración de empresa (1065/1120-S)', 'service', 'un', 75000, false],
  ],
  fotografo: [
    ['Ensaio fotográfico (hora)', 'Photo session (hour)', 'Sesión de fotos (hora)', 'service', 'hora', 20000, false],
    ['Cobertura de evento (hora)', 'Event coverage (hour)', 'Cobertura de evento (hora)', 'service', 'hora', 25000, false],
    ['Foto editada extra', 'Extra edited photo', 'Foto editada adicional', 'service', 'un', 1500, false],
    ['Álbum impresso', 'Printed album', 'Álbum impreso', 'material', 'un', 30000, true],
    ['Taxa de deslocamento', 'Travel fee', 'Cargo por traslado', 'fee', 'un', 5000, false],
  ],
  limpeza: [
    ['Limpeza padrão', 'Standard cleaning', 'Limpieza estándar', 'service', 'visita', 15000, false],
    ['Limpeza pesada (deep cleaning)', 'Deep cleaning', 'Limpieza profunda', 'service', 'visita', 28000, false],
    ['Limpeza de mudança (move-out)', 'Move-out cleaning', 'Limpieza de mudanza', 'service', 'visita', 30000, false],
    ['Limpeza pós-obra', 'Post-construction cleaning', 'Limpieza post-obra', 'service', 'visita', 40000, false],
  ],
  generico: [
    ['Serviço', 'Service', 'Servicio', 'service', 'un', 10000, false],
    ['Mão de obra (hora)', 'Labor (hour)', 'Mano de obra (hora)', 'labor', 'hora', 6000, false],
    ['Material', 'Materials', 'Materiales', 'material', 'lote', 5000, true],
    ['Taxa de deslocamento', 'Travel fee', 'Cargo por traslado', 'fee', 'un', 4000, false],
  ],
}
const plain = (s) => fold(String(s || '')).trim()
/** Rótulo do cadastro ou chave → chave de SEEDS. */
export function specialtyKey(v) {
  const s = plain(v)
  if (!s) return 'generico'
  if (SEEDS[s]) return s
  const rules = [
    [/constru|reforma|remodel|general contractor|empreit/, 'construcao'], [/handyman|faz[- ]tudo|marido de aluguel/, 'handyman'],
    [/marcen|carpint|cabinet|woodwork/, 'marceneiro'], [/pint|painter/, 'pintor'], [/eletric|electric/, 'eletricista'], [/encan|plumb/, 'encanador'],
    [/drywall|gesso|sheetrock/, 'drywall'], [/piso|azulej|floor|tile/, 'pisos'], [/telhad|roof/, 'telhado'],
    [/paisag|jardin|landscap|lawn|grama/, 'paisagismo'], [/mudan|moving|frete/, 'mudanca'], [/tradu|translat|interpret/, 'tradutor'],
    [/contab|contador|imposto|tax|bookkeep|account/, 'contador'], [/fotog|photo|filmag|video/, 'fotografo'], [/limpeza|clean|faxin|airbnb/, 'limpeza'],
  ]
  for (const [re, key] of rules) if (re.test(s)) return key
  return 'generico'
}
const shapeCatalog = (r) => ({
  id: r.id, name: r.name, description: r.description || null, kind: ITEM_KINDS.includes(r.kind) ? r.kind : 'service', unit: r.unit || 'un',
  unit_price_cents: Number(r.unit_price_cents) || 0, taxable: r.taxable === true, active: r.active !== false, display_order: Number(r.display_order) || 0,
})
function readCatalogItem(b, partial) {
  const out = {}
  if (!partial || has(b, 'name')) {
    const name = clip(b.name, 120)
    if (!name) fail(400, 'Dê um nome ao item')
    out.name = name
  }
  if (!partial || has(b, 'description')) out.description = cleanText(b.description, 500)
  if (!partial || has(b, 'kind')) {
    if (b.kind != null && b.kind !== '' && !ITEM_KINDS.includes(b.kind)) fail(400, 'Tipo de item inválido')
    out.kind = ITEM_KINDS.includes(b.kind) ? b.kind : 'service'
  }
  if (!partial || has(b, 'unit')) out.unit = cleanUnit(b.unit)
  if (!partial || has(b, 'unit_price_cents')) {
    const raw = b.unit_price_cents ?? 0
    const n = Math.round(Number(raw === '' ? 0 : raw))
    if (!Number.isFinite(n) || n < 0) fail(400, 'Preço inválido')
    if (n > MAX_UNIT_PRICE_CENTS) fail(400, 'Preço muito alto (máximo US$ 1.000.000)')
    out.unit_price_cents = n
  }
  if (!partial || has(b, 'taxable')) out.taxable = b.taxable === true || b.taxable === 'true'
  if (!partial || has(b, 'active')) out.active = has(b, 'active') ? b.active !== false && b.active !== 'false' : true
  if (partial && !Object.keys(out).length) fail(400, 'Nada pra atualizar')
  return out
}
const catalogList = (S, onlyActive = false) => S.catalog.filter((x) => !onlyActive || x.active !== false)
  .sort((a, b) => (Number(a.display_order) - Number(b.display_order)) || String(a.name).localeCompare(String(b.name)))
function ownCatalogItem(S, id) {
  if (!isUuid(id)) fail(400, 'Item inválido')
  const item = S.catalog.find((x) => x.id === String(id))
  if (!item) fail(404, 'Item não encontrado')
  return item
}

export function catalogRoute(S, c) {
  ensureDocState(S)
  const { method, body: b, q } = c
  const P = S.provider
  if (method === 'GET') return ok({ items: catalogList(S, q.active === '1' || q.active === 'true').map(shapeCatalog) })
  if (method !== 'POST') return notAllowed()
  gate(P, 'price_book')
  const now = nowIso()
  const action = String(b.action || '')
  const maxOrder = () => S.catalog.reduce((m, x) => Math.max(m, Number(x.display_order) || 0), -1)
  if (action === 'create') {
    const fields = readCatalogItem(b, false)
    if (S.catalog.length >= MAX_CATALOG) fail(400, `Sua tabela já tem ${MAX_CATALOG} itens. Apague os que não usa antes de criar outro.`)
    const row = { id: uid(), provider_id: P.id, ...fields, display_order: maxOrder() + 1, created_at: now, updated_at: now }
    S.catalog.push(row)
    return ok({ ok: true, item: shapeCatalog(row) }, 201)
  }
  if (action === 'update') {
    const item = ownCatalogItem(S, b.id)
    Object.assign(item, readCatalogItem(b, true), { updated_at: now })
    return ok({ ok: true, item: shapeCatalog(item) })
  }
  if (action === 'delete') {
    const item = ownCatalogItem(S, b.id)
    for (const it of S.docItems) if (it.catalog_item_id === item.id) it.catalog_item_id = null
    S.catalog.splice(S.catalog.indexOf(item), 1)
    return ok({ ok: true })
  }
  if (action === 'reorder') {
    if (!Array.isArray(b.ids) || !b.ids.length) fail(400, 'Mande a lista de itens na ordem nova')
    if (b.ids.length > MAX_CATALOG) fail(400, 'Lista grande demais')
    const ids = [...new Set(b.ids.map(String))]
    if (ids.some((id) => !isUuid(id))) fail(400, 'Item inválido na lista')
    ids.filter((id) => S.catalog.some((x) => x.id === id)).forEach((id, i) => Object.assign(S.catalog.find((x) => x.id === id), { display_order: i, updated_at: now }))
    return ok({ ok: true, items: catalogList(S).map(shapeCatalog) })
  }
  if (action === 'seed') {
    const key = specialtyKey(clip(b.specialty, 80) || P.specialty)
    const docLang = P.app_settings?.doc_defaults?.language
    const lang = DOC_LANGS.includes(b.language) ? b.language : (DOC_LANGS.includes(docLang) ? docLang : 'pt')
    const col = { pt: 0, en: 1, es: 2 }[lang]
    if (S.catalog.length >= MAX_CATALOG) fail(400, `Sua tabela já tem ${MAX_CATALOG} itens.`)
    const taken = new Set(S.catalog.map((i) => plain(i.name)))
    let order = maxOrder() + 1
    const rows = []
    for (const s of SEEDS[key]) {
      const name = s[col]
      if (taken.has(plain(name))) continue
      taken.add(plain(name))
      rows.push({ id: uid(), provider_id: P.id, name, description: SAMPLE_NOTE, kind: s[3], unit: s[4], unit_price_cents: s[5], taxable: s[6], active: true, display_order: order++, created_at: now, updated_at: now })
    }
    const toInsert = rows.slice(0, Math.max(0, MAX_CATALOG - S.catalog.length))
    S.catalog.push(...toInsert)
    return ok({ ok: true, created: toInsert.length, specialty: key, items: catalogList(S).map(shapeCatalog) }, 201)
  }
  fail(400, 'Ação inválida')
}

// ════════════════════════════════════════════════════════════════════════════
//   /api/agenda/quote-requests — pedidos de orçamento (regras de api/agenda/quote-requests.js)
// ════════════════════════════════════════════════════════════════════════════
/** O formulário "Pedir orçamento" aparece na página pública? */
export function quoteFormEnabled(P) {
  if (!P || P.active === false) return false
  if (!hasFeature(P, 'quote_requests')) return false
  const pref = isObj(P.app_settings) ? P.app_settings.quote_requests_public : undefined
  if (pref === true || pref === false) return pref
  return P.vertical === 'trades'
}
function countByStatus(rows) {
  const c = { new: 0, contacted: 0, quoted: 0, closed: 0, spam: 0, open: 0, total: 0 }
  for (const r of rows || []) {
    if (!REQUEST_STATUSES.includes(r.status)) continue
    c[r.status]++
    if (r.status === 'new' || r.status === 'contacted') c.open++
    if (r.status !== 'spam') c.total++
  }
  return c
}
export function shapeRequest(r) {
  return {
    id: r.id, name: r.name, phone: r.phone || null, email: r.email || null, address: r.address || null, service: r.service || null,
    description: r.description || null, photos: Array.isArray(r.photos) ? r.photos.slice() : [], preferred_date: r.preferred_date || null,
    language: DOC_LANGS.includes(r.language) ? r.language : 'en', status: r.status, client_id: r.client_id || null,
    document_id: r.document_id || null, created_at: r.created_at, updated_at: r.updated_at || null,
  }
}
const fmtBR = (key) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '')
const reqClip = (v, n) => {
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n)
  return s || null
}
const oneLine = (v, n) => { const s = reqClip(v, n * 2); return s ? s.replace(/\s+/g, ' ').trim().slice(0, n) || null : null }

function publicCreateRequest(S, c, b) {
  const P = S.provider
  // Isca: robô preenche o campo escondido. Finge que deu certo e não grava nada.
  if (b.website !== undefined && b.website !== null && String(b.website).trim() !== '') return ok({ ok: true }, 201)
  if (String(b.slug || '').toLowerCase().trim() !== P.slug) return ok({ error: 'Profissional não encontrado(a).', code: 'not_found' }, 404)
  if (!quoteFormEnabled(P)) return ok({ error: 'Este perfil não está recebendo pedidos de orçamento pela página no momento. Fale direto pelo telefone ou WhatsApp.', code: 'disabled' }, 403)
  const invalid = (error) => ok({ error, code: 'invalid' }, 400)
  const name = oneLine(b.name, 120)
  if (!name || name.length < 2) return invalid('Diga seu nome.')
  const rawPhone = reqClip(b.phone, 40)
  let phone = null
  if (rawPhone) {
    phone = normalizePhone(rawPhone)
    if (!phone) return invalid('Telefone inválido. Coloque o código de área e o número, ex.: (512) 555-0101.')
  }
  const email = reqClip(b.email, 254)?.toLowerCase() || null
  if (email && !EMAIL_RE.test(email)) return invalid('E-mail inválido.')
  if (!phone && !email) return invalid('Informe telefone ou e-mail pra receber o orçamento.')
  let preferred = null
  const pd = reqClip(b.preferred_date, 10)
  if (pd) {
    if (!parseDateKey(pd)) return invalid('Data inválida.')
    if (pd < c.today) return invalid('Escolha uma data a partir de hoje.')
    if (pd > addDays(c.today, 730)) return invalid('Escolha uma data mais próxima.')
    preferred = pd
  }
  const list = b.photos == null ? [] : b.photos
  if (!Array.isArray(list)) return invalid('Fotos inválidas.')
  const sent = list.filter((p) => p !== null && p !== undefined && p !== '')
  if (sent.length > 3) return invalid('No máximo 3 fotos.')
  if (sent.some((p) => typeof p !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(p))) return invalid('Foto inválida. Use JPG, PNG ou WebP.')
  // Demo: a foto vira uma imagem de exemplo (no site vai pro bucket 'uploads')
  const photos = sent.map((_, i) => `https://placehold.co/1200x900/E8EBF1/1B2845/png?text=Foto+${i + 1}`)
  const language = DOC_LANGS.includes(b.language) ? b.language : 'pt'
  // Pedido anônimo NÃO cria ficha (spam não deixa lixo em Clientes): só liga a uma ficha que já
  // existe com o mesmo telefone (ou e-mail), sem desarquivar. A ficha nova nasce no convert.
  const existing = phone ? findByPhone(S, phone) : S.clients.find((x) => x.email === email) || null
  const now = nowIso()
  S.quoteRequests.push({
    id: uid(), provider_id: P.id, name, phone, email, address: oneLine(b.address, 300), service: oneLine(b.service, 120), description: reqClip(b.description, 3000),
    photos, preferred_date: preferred, language, status: 'new', client_id: existing?.id || null, document_id: null, ip_hash: null, created_at: now, updated_at: now,
  })
  return ok({ ok: true, photos_saved: photos.length, photos_failed: 0 }, 201)
}

function convertRequest(S, c, id) {
  const P = S.provider
  const qr = S.quoteRequests.find((r) => r.id === id)
  if (!qr) return ok({ error: 'Pedido não encontrado' }, 404)
  // Já virou orçamento: devolve o mesmo
  if (qr.document_id) {
    const existing = S.documents.find((d) => d.id === qr.document_id)
    if (existing) return ok({ document: shapeDoc(existing, c.site, { today: c.today }), existing: true })
  }
  const month = c.today.slice(0, 7)
  const count = S.documents.filter((d) => dayOf(d.created_at).slice(0, 7) === month).length
  const lim = requireLimit(P, 'documents_month', count)
  if (!lim.ok) return ok(lim.body, lim.status)
  // Cliente: a ficha ligada ao pedido (se ainda existir) ou os dados do pedido (acha/cria a ficha).
  // Com ficha: o nome fica o da ficha, o documento leva o contato digitado no pedido e a ficha
  // ganha o que faltava nela (nada que ela já tinha é trocado)
  const ficha = qr.client_id ? S.clients.find((x) => x.id === qr.client_id) || null : null
  if (ficha) {
    if (qr.email && !ficha.email) ficha.email = qr.email
    if (qr.phone && !ficha.whatsapp) ficha.whatsapp = qr.phone
    if (qr.address && !ficha.address_line) ficha.address_line = String(qr.address).slice(0, 160)
  }
  const contact = { email: qr.email || null, phone: qr.phone || null, address: qr.address || null }
  const input = {
    kind: 'quote',
    ...(ficha ? { client_id: ficha.id, client: contact } : { client: { name: qr.name || 'Cliente', ...contact } }),
    language: DOC_LANGS.includes(qr.language) ? qr.language : 'en',
    quote_request_id: qr.id,
    internal_notes: [
      `Pedido pela página em ${fmtBR(dayOf(qr.created_at || nowIso()))}.`,
      qr.preferred_date ? `Data desejada: ${fmtBR(String(qr.preferred_date).slice(0, 10))}.` : '',
      qr.phone ? `Telefone: ${qr.phone}.` : '',
      qr.email ? `E-mail: ${qr.email}.` : '',
    ].filter(Boolean).join(' '),
  }
  if (qr.service) input.title = qr.service
  if (qr.address) input.job_address = qr.address
  if (qr.description) input.notes = qr.description
  // Fotos do pedido no orçamento: recurso 'job_photos' (Pro)
  const photos = (Array.isArray(qr.photos) ? qr.photos : []).filter((u) => /^https:\/\/[^\s"'<>]+$/i.test(String(u || ''))).slice(0, 12)
  if (photos.length && hasFeature(P, 'job_photos')) input.photos = photos
  const saved = saveDocument(S, c, input, { eventDetail: { from: 'quote_request', request_id: qr.id } })
  // saveDocument já liga e marca 'quoted' quando o pedido estava novo/em contato; aqui cobre arquivado/spam
  Object.assign(qr, { status: 'quoted', document_id: saved.document.id, updated_at: nowIso() })
  return ok({ document: saved.document }, 201)
}

export function quoteRequestsRoute(S, c) {
  ensureDocState(S)
  const { method, body: b, q } = c
  const P = S.provider
  // Público: a página pergunta se mostra o formulário / manda o pedido (sem action)
  if (method === 'GET' && q.slug && !q.status) {
    return ok({ enabled: String(q.slug).toLowerCase().trim() === P.slug ? quoteFormEnabled(P) : false })
  }
  if (method === 'POST' && !b.action) return publicCreateRequest(S, c, b)
  if (method === 'GET') {
    const status = String(q.status || '')
    const n = Math.round(Number(q.limit))
    const limit = Number.isFinite(n) && q.limit != null && q.limit !== '' ? Math.min(Math.max(n, 1), 500) : 300
    const list = S.quoteRequests
      .filter((r) => (REQUEST_STATUSES.includes(status) ? r.status === status : status === 'open' ? ['new', 'contacted'].includes(r.status) : true))
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, limit)
    return ok({ requests: list.map(shapeRequest), counts: countByStatus(S.quoteRequests) })
  }
  if (method !== 'POST') return notAllowed()
  const action = String(b.action || '')
  const id = String(b.id || '')
  if (!isUuid(id)) return ok({ error: 'Pedido inválido' }, 400)
  if (action === 'update_status') {
    gate(P, 'quote_requests')
    const status = String(b.status || '')
    if (!REQUEST_STATUSES.includes(status)) return ok({ error: 'Situação inválida' }, 400)
    const r = S.quoteRequests.find((x) => x.id === id)
    if (!r) return ok({ error: 'Pedido não encontrado' }, 404)
    Object.assign(r, { status, updated_at: nowIso() })
    return ok({ ok: true, request: shapeRequest(r) })
  }
  if (action === 'convert') {
    gate(P, 'quotes')
    return convertRequest(S, c, id)
  }
  return ok({ error: 'Ação inválida' }, 400)
}

// ════════════════════════════════════════════════════════════════════════════
//   /api/agenda/doc-public — o que a cliente vê pelo link /d/<token>
// ════════════════════════════════════════════════════════════════════════════
const BIZ_KEYS = ['legal_name', 'license_no', 'address_line', 'city', 'state', 'zip', 'phone', 'email', 'website', 'insurance']
const pstr = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const httpUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : null)
function publicStatus(doc, today) {
  if (doc.kind === 'quote') {
    if (PUBLIC_OPEN_QUOTE.includes(doc.status) && doc.valid_until && String(doc.valid_until).slice(0, 10) < today) return 'expired'
    return doc.status
  }
  return invoiceStatus(doc, today)
}
function publicBusiness(settings, P = {}) {
  const b = isObj(settings?.business) ? settings.business : {}
  const out = {}
  for (const k of BIZ_KEYS) {
    if (k === 'insurance' && b[k] === true) { out[k] = true; continue }
    const v = pstr(b[k], k === 'website' ? 200 : 160)
    if (v) out[k] = v
  }
  if (!out.phone && pstr(P.whatsapp, 40)) out.phone = pstr(P.whatsapp, 40)
  return out
}
const rawBalance = (d) => Math.max(0, toInt(d?.total_cents) - toInt(d?.amount_paid_cents))
function canPayOnline(doc, P, today) {
  if (!doc || doc.kind !== 'invoice') return false
  if (!PUBLIC_OPEN_INVOICE.includes(publicStatus(doc, today))) return false
  if (rawBalance(doc) < MIN_CARD_CENTS) return false
  return !!(P?.stripe_account_id && P?.stripe_charges_enabled && hasFeature(P, 'invoice_payments'))
}
/** Documento como a cliente vê pelo link (sem campos internos). */
function publicDocument(S, P, doc, today) {
  const quote = doc.kind === 'invoice' && doc.quote_id ? S.documents.find((d) => d.id === doc.quote_id) : null
  // "Como pagar" é só o do próprio documento (o padrão dela entra na criação), igual ao PDF e ao e-mail
  const paymentInstructions = doc.payment_instructions || null
  return {
    kind: doc.kind, number: doc.number, status: publicStatus(doc, today), client_name: doc.client_name, client_email: doc.client_email || null,
    client_phone: doc.client_phone || null, client_address: doc.client_address || null, title: doc.title || null, job_address: doc.job_address || null,
    language: langOf(doc.language), issue_date: doc.issue_date || null, due_date: doc.due_date || null, valid_until: doc.valid_until || null,
    subtotal_cents: toInt(doc.subtotal_cents), discount_pct: doc.discount_pct == null ? null : Number(doc.discount_pct), discount_cents: toInt(doc.discount_cents),
    tax_rate_bps: toInt(doc.tax_rate_bps), tax_cents: toInt(doc.tax_cents), total_cents: toInt(doc.total_cents),
    deposit_pct: doc.deposit_pct == null ? null : Number(doc.deposit_pct), deposit_cents: toInt(doc.deposit_cents),
    amount_paid_cents: toInt(doc.amount_paid_cents), balance_cents: rawBalance(doc), notes: doc.notes || null, terms: doc.terms || null,
    payment_instructions: paymentInstructions, photos: (Array.isArray(doc.photos) ? doc.photos : []).map(httpUrl).filter(Boolean).slice(0, 20),
    stage_label: doc.stage_label || null, quote_number: quote?.number || null, sent_at: doc.sent_at || null, viewed_at: doc.viewed_at || null,
    accepted_at: doc.accepted_at || null, accepted_name: doc.accepted_name || null, has_signature: !!doc.accepted_signature,
    declined_at: doc.declined_at || null, decline_reason: doc.decline_reason || null, paid_at: doc.paid_at || null,
    signed_hash: doc.signed_hash || null, consent_at: doc.consent_at || null,
    // Versão que a página carregou: volta no aceite (mudou depois → 409 'changed')
    updated_at: doc.updated_at || null,
  }
}
const publicItems = (S, doc) => itemsOf(S, doc.id).map((it) => ({ position: toInt(it.position), kind: it.kind, description: it.description, quantity: Number(it.quantity) || 0, unit: it.unit, unit_price_cents: toInt(it.unit_price_cents), taxable: !!it.taxable, line_total_cents: toInt(it.line_total_cents) }))
function publicPayload(S, P, doc, c) {
  const settings = isObj(P.app_settings) ? P.app_settings : {}
  const related = doc.kind === 'quote'
    ? S.documents.filter((d) => d.kind === 'invoice' && d.quote_id === doc.id && !['draft', 'void'].includes(d.status))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).slice(0, 10)
      .map((r) => ({ number: r.number, stage_label: r.stage_label || null, status: r.status, total_cents: toInt(r.total_cents), balance_cents: rawBalance(r), url: `/d/${r.public_token}` }))
    : []
  return {
    document: publicDocument(S, P, doc, c.today),
    items: publicItems(S, doc),
    provider: {
      name: P.name || '', slug: P.slug || null, avatar_url: httpUrl(P.avatar_url), cover_color: /^#[0-9a-f]{6}$/i.test(String(P.cover_color || '')) ? P.cover_color : null,
      specialty: P.specialty || null, business: publicBusiness(settings, P), show_branding: !hasFeature(P, 'no_branding'),
    },
    can_pay_online: canPayOnline(doc, P, c.today),
    related,
  }
}

// Texto do consentimento (cópia de CONSENT_TEXT de api/agenda/doc-public.js)
const CONSENT_TEXT = {
  en: 'I agree to use electronic records and signatures for this document, and I am able to save or print a copy.',
  pt: 'Concordo em usar registros e assinatura eletrônicos neste documento e tenho como guardar ou imprimir uma cópia.',
  es: 'Acepto usar registros y firmas electrónicos para este documento y puedo guardar o imprimir una copia.',
}
/**
 * O que a cliente assinou, como estava na hora (buildSignedSnapshot do servidor): documento +
 * itens + totais + empresa + quem assinou + consentimento, com o hash SHA-256 do JSON canônico.
 * A imagem da assinatura entra só pelo sha256. signer: { name, signed_at, ip, user_agent, signature }.
 * → { snapshot, hash }
 */
export function signedSnapshot(S, P, row, signer = {}) {
  const d = shapeDoc(row, '')
  const settings = isObj(P.app_settings) ? P.app_settings : {}
  const lang = langOf(d.language)
  const snapshot = {
    format: 'workpro-signed-v1',
    document: {
      id: row.id, kind: d.kind, number: d.number, title: d.title, language: d.language, issue_date: d.issue_date, valid_until: d.valid_until,
      client_name: d.client_name, client_email: d.client_email, client_phone: d.client_phone, client_address: d.client_address,
      job_address: d.job_address, notes: d.notes, terms: d.terms, payment_instructions: d.payment_instructions,
      photos: (d.photos || []).map(httpUrl).filter(Boolean).slice(0, 20), version: row.updated_at || null,
    },
    items: publicItems(S, row),
    totals: {
      subtotal_cents: d.subtotal_cents, discount_pct: d.discount_pct, discount_cents: d.discount_cents, tax_rate_bps: d.tax_rate_bps,
      tax_cents: d.tax_cents, total_cents: d.total_cents, deposit_pct: d.deposit_pct, deposit_cents: d.deposit_cents,
    },
    business: { name: providerDisplayName(P), ...publicBusiness(settings, P) },
    signer: {
      name: signer.name || null, signed_at: signer.signed_at || null, ip: signer.ip || null, user_agent: signer.user_agent || null,
      signature_sha256: signer.signature ? sha256Hex(signer.signature) : null,
    },
    consent: { version: CONSENT_TEXT_VERSION, text: CONSENT_TEXT[lang], at: signer.signed_at || null },
  }
  return { snapshot, hash: sha256Hex(canonicalJson(snapshot)) }
}
/** Mesmo instante? (a página devolve o updated_at que carregou; tolera formato diferente) */
function sameInstant(a, b) {
  if (!a || !b || typeof a !== 'string') return false
  if (String(a) === String(b)) return true
  const x = Date.parse(a), y = Date.parse(b)
  return Number.isFinite(x) && x === y
}

export function docPublicRoute(S, c) {
  ensureDocState(S)
  const { method, body: b, q, today } = c
  const P = S.provider
  const pfail = (status, code, error, extra = {}) => ok({ error, code, ...extra }, status)
  if (method !== 'GET' && method !== 'POST') return notAllowed()
  const isGet = method === 'GET'
  const token = String((isGet ? q.t : b.t) || '').trim()
  if (!TOKEN_RE.test(token)) return pfail(404, 'not_found', 'Documento não encontrado')
  const doc = S.documents.find((d) => d.public_token === token)
  if (!doc || doc.status === 'draft') return pfail(404, 'not_found', 'Documento não encontrado')
  if (doc.status === 'void') {
    return pfail(410, 'void', 'Esta fatura foi anulada.', { language: doc.language, provider: { name: P.name || '', cover_color: /^#[0-9a-f]{6}$/i.test(String(P.cover_color || '')) ? P.cover_color : null } })
  }
  const now = nowIso()
  if (isGet) {
    if (!doc.viewed_at && (doc.status === 'sent' || PUBLIC_OPEN_INVOICE.includes(doc.status))) {
      doc.viewed_at = now
      if (doc.status === 'sent') doc.status = 'viewed'
      logEvent(S, doc, 'viewed', 'link', {})
    }
    return ok(publicPayload(S, P, doc, c))
  }
  const action = String(b.action || '')
  if (action === 'accept' || action === 'decline') {
    if (doc.kind !== 'quote') return pfail(409, 'not_open', 'Este documento não é um orçamento.')
    if (['accepted', 'converted', 'declined'].includes(doc.status)) return pfail(409, 'already_answered', 'Este orçamento já foi respondido.')
    if (publicStatus(doc, today) === 'expired') return pfail(410, 'expired', 'Este orçamento venceu. Peça um orçamento atualizado.')
    if (!PUBLIC_OPEN_QUOTE.includes(doc.status)) return pfail(409, 'not_open', 'Este orçamento não está aberto para resposta.')
    let patch, detail
    if (action === 'accept') {
      const name = String(b.name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
      if (name.length < 2 || name.length > 120) return pfail(400, 'invalid_name', 'Digite seu nome completo.')
      const sig = b.signature === undefined || b.signature === null || b.signature === '' ? null : b.signature
      if (sig !== null && (typeof sig !== 'string' || sig.length > 90000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(sig))) {
        return pfail(400, 'invalid_signature', 'Assinatura inválida ou grande demais. Limpe e assine de novo.')
      }
      if (b.consent !== true) return pfail(400, 'consent_required', 'Marque a caixa de consentimento para assinar eletronicamente.')
      // A cliente aprova a versão que viu: mudou depois de carregar a página → recarrega
      if (!sameInstant(b.version, doc.updated_at)) return pfail(409, 'changed', 'Este orçamento foi atualizado. Confira os valores e aprove de novo.')
      const { snapshot, hash } = signedSnapshot(S, P, doc, { name, signed_at: now, ip: null, user_agent: 'demo', signature: sig })
      patch = {
        status: 'accepted', accepted_at: now, accepted_name: name, accepted_signature: sig, accepted_ip: null, accepted_user_agent: 'demo',
        signed_snapshot: snapshot, signed_hash: hash, consent_at: now, consent_text_version: CONSENT_TEXT_VERSION, updated_at: now,
      }
      // Demo: a cópia por e-mail pra cliente (link + código) e o push pra profissional são de mentira
      detail = {
        by: 'client', name, signed: !!sig, total_cents: toInt(doc.total_cents), deposit_cents: toInt(doc.deposit_cents),
        signed_hash: hash, consent: CONSENT_TEXT_VERSION, copy_emailed: !!doc.client_email,
      }
    } else {
      const reason = reqClip(b.reason, 500)
      patch = { status: 'declined', declined_at: now, decline_reason: reason, updated_at: now }
      detail = { by: 'client', ...(reason ? { reason: reason.slice(0, 200) } : {}) }
    }
    if (!doc.viewed_at) patch.viewed_at = now
    Object.assign(doc, patch)
    logEvent(S, doc, action === 'accept' ? 'accepted' : 'declined', 'link', detail)
    return ok({ ok: true, ...publicPayload(S, P, doc, c) })
  }
  if (action === 'pay') {
    if (doc.kind !== 'invoice') return pfail(409, 'not_open', 'Este documento não é uma fatura.')
    const status = publicStatus(doc, today)
    const balance = rawBalance(doc)
    if (status === 'paid' || balance <= 0) return pfail(409, 'nothing_to_pay', 'Esta fatura já está paga.')
    if (!PUBLIC_OPEN_INVOICE.includes(status)) return pfail(409, 'not_open', 'Esta fatura não está aberta para pagamento.')
    if (balance < MIN_CARD_CENTS) return pfail(400, 'amount_too_small', 'Valor pequeno demais para pagar no cartão.')
    if (!canPayOnline(doc, P, today)) return pfail(409, 'pay_unavailable', 'O pagamento online não está disponível para esta fatura.', { payment_instructions: doc.payment_instructions || null })
    // Demo: o "checkout" já confirma na hora (no site quem registra é o webhook do Stripe)
    const pay = { id: uid(), provider_id: P.id, document_id: doc.id, appointment_id: null, type: 'invoice', status: 'paid', amount_cents: balance, method: 'card', paid_at: now, note: null, source: 'stripe', created_at: now }
    S.docPayments.push(pay)
    recomputeInvoice(S, doc, today)
    logEvent(S, doc, 'payment', 'stripe', { amount_cents: balance, method: 'card', payment_id: pay.id })
    return ok({ checkout_url: `${publicUrlOf(c.site, token)}?paid=1` })
  }
  return pfail(400, 'invalid_action', 'Ação inválida')
}
