/**
 * Orçamentos (quote) e faturas (invoice) da profissional — app WorkPro / AgendaPro.
 * Formatos fixos em agendapro/CONTRACT.md ("WorkPro — orçamentos e faturas").
 *
 * GET  /api/agenda/documents   com JWT (leitura liberada mesmo sem plano)
 *   ?kind=quote|invoice&status=all|open|draft|sent|viewed|accepted|declined|expired|converted|partial|paid|overdue|void&q=&client_id=
 *       → { documents: [Doc], summary: { open_quotes_cents, open_quotes_count, awaiting_cents,
 *           overdue_cents, overdue_count, paid_month_cents, acceptance_rate } }
 *       open = aguardando a cliente: orçamento sent/viewed e fatura sent/viewed/partial/overdue.
 *       Status sai efetivo (fatura vencida → overdue; orçamento vencido → expired) antes do cron.
 *       acceptance_rate = aceitos / (aceitos + recusados + expirados), orçamentos emitidos nos
 *       últimos 180 dias, de 0 a 1 (null sem dado). paid_month_cents = pagamentos de fatura no
 *       mês corrente (fuso da profissional).
 *   ?id=UUID → { document: Doc (com accepted_signature), items: [Item], payments: [Payment], events: [Event] }
 *
 * POST /api/agenda/documents   com JWT   Body: { action, ... }
 *   create | update | duplicate | send | mark_sent | mark_accepted | decline | convert |
 *   record_payment | remove_payment | remind | void | delete | rotate_link   (campos no CONTRACT)
 *   Recursos: quote → 'quotes', invoice → 'invoices' (create/update/duplicate/send/mark_sent);
 *   create/duplicate/convert contam no limite 'documents_month'; foto nova → 'job_photos';
 *   convert deposit|stages → 'progress_billing'; record_payment/remove_payment/void → 'invoices';
 *   remind → 'invoices' (fatura com saldo) ou 'quotes' (orçamento aguardando resposta).
 *   send/remind → { document, public_url, message, email_sent, email_error? } (message no idioma do documento).
 *     Por e-mail (sai pelo nosso domínio) → 429 { code: 'email_limit' } antes de mandar quando passa:
 *     do teto diário da profissional (docEmailDailyCap, 24h, envios + lembretes), de 3 envios por
 *     documento em 24h, ou de 1 lembrete por e-mail por documento em 24h.
 *   Fatura saindo pela 1ª vez (send/mark_sent): emissão = hoje (fuso dela) e vencimento = hoje + o
 *     prazo que ela tinha (vencimento − emissão), pra rascunho/etapa mandado depois não sair vencido.
 *   record_payment aceita valor acima do saldo (o app confirma antes), até o dobro do total.
 *   mark_accepted, decline e delete (rascunho) ficam liberados: só registram o que aconteceu.
 *   rotate_link { id } → { document } com public_token novo: o link antigo para de abrir na hora.
 *     Liberado mesmo sem plano (é proteção: link foi pra pessoa errada).
 *
 * Toda conta de valores: api/_lib/docCalc.js (via saveDocument em api/_lib/documents.js).
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature, requireLimit, limitFor, hasFeature } from '../_lib/agendaPlans.js'
import { cleanPct } from '../_lib/docCalc.js'
import {
  DOC_KINDS, DOC_COLS, DOC_COLS_FULL, PAY_METHODS, SEND_CHANNELS, MAX_DOC_CENTS, DOC_EMAIL_PER_DOC_DAY,
  shapeDoc, shapeItem, saveDocument, recomputeInvoice, addEvent, docMessage, sendDocEmail,
  loadItems, loadPayments, loadEvents, effectiveStatus, balanceOf, docDefaults, normalizePhotos,
  isUuid, parseDateKey, addDaysKey, diffDaysKey, addMonthsKey, dateKeyIn, zonedDayStartIso, fmtMoney, fmtPct,
  newToken, docEmailDailyCap, countDocEmails,
} from '../_lib/documents.js'

const LIST_LIMIT = 300
const PAGE = 1000
const MAX_ROWS = 10000

// Filtro de status: o que buscar no banco e o status efetivo que fica na lista.
// open = aguardando a cliente (orçamento enviado/visto; fatura enviada/vista/parcial/vencida)
const OPEN_QUOTE = ['sent', 'viewed']
const OPEN_INVOICE = ['sent', 'viewed', 'partial', 'overdue']
const STATUS_FILTERS = {
  all: null,
  open: { db: ['sent', 'viewed', 'partial', 'overdue'] },
  draft: { db: ['draft'] },
  sent: { db: ['sent'] },
  viewed: { db: ['viewed'] },
  accepted: { db: ['accepted'] },
  declined: { db: ['declined'] },
  expired: { db: ['sent', 'viewed', 'expired'] },
  converted: { db: ['converted'] },
  partial: { db: ['partial'] },
  paid: { db: ['paid'] },
  overdue: { db: ['sent', 'viewed', 'partial', 'overdue'] },
  void: { db: ['void'] },
}
const STATUS_PT = {
  draft: 'rascunho', sent: 'enviado', viewed: 'visto', accepted: 'aprovado', declined: 'recusado',
  expired: 'vencido', converted: 'faturado', partial: 'pago em parte', paid: 'pago', overdue: 'vencido', void: 'anulado',
}
// Rótulos das faturas geradas do orçamento (idioma do documento)
const CONVERT_L = {
  pt: { deposit: 'Entrada', stage: 'Etapa', of: 'de', balance: 'Saldo restante' },
  en: { deposit: 'Deposit', stage: 'Stage', of: 'of', balance: 'Remaining balance' },
  es: { deposit: 'Anticipo', stage: 'Etapa', of: 'de', balance: 'Saldo restante' },
}

class HttpError extends Error {
  constructor(status, body) { super(body?.error || 'Erro'); this.status = status; this.body = body }
}
const fail = (status, error, extra = {}) => { throw new HttpError(status, { error, ...extra }) }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const clip = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null)
const featureOf = (kind) => (kind === 'quote' ? 'quotes' : 'invoices')

function gate(provider, key) {
  const g = requireFeature(provider, key)
  if (!g.ok) throw new HttpError(g.status, g.body)
}

async function fetchAll(makeQuery) {
  const out = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Busca livre: tira o que quebra o filtro or() do PostgREST. */
const cleanSearch = (q) => String(q || '').replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

// ── GET ─────────────────────────────────────────────────────────────────────
async function listDocuments(ctx, q) {
  const { supabase, pid, today } = ctx
  const kind = DOC_KINDS.includes(q.kind) ? q.kind : null
  const status = String(q.status || 'all')
  if (!has(STATUS_FILTERS, status)) fail(400, 'Filtro de status inválido')
  let clientId = null
  if (q.client_id) {
    if (!isUuid(q.client_id)) fail(400, 'Cliente inválida')
    clientId = String(q.client_id)
  }
  const search = cleanSearch(q.q)

  let qb = supabase.from('ag_documents').select(DOC_COLS).eq('provider_id', pid)
  if (kind) qb = qb.eq('kind', kind)
  if (clientId) qb = qb.eq('client_id', clientId)
  const f = STATUS_FILTERS[status]
  if (f) qb = qb.in('status', f.db)
  if (search) qb = qb.or(`client_name.ilike.%${search}%,number.ilike.%${search}%,title.ilike.%${search}%`)
  const { data, error } = await qb.order('issue_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIST_LIMIT)
  if (error) throw new Error(error.message)

  let rows = (data || []).map((r) => ({ r, s: effectiveStatus(r, today) }))
  if (status === 'open') rows = rows.filter(({ r, s }) => (r.kind === 'quote' ? OPEN_QUOTE : OPEN_INVOICE).includes(s))
  else if (f) rows = rows.filter(({ s }) => s === status)
  return rows.map(({ r }) => shapeDoc(r, { today }))
}

async function summary(ctx) {
  const { supabase, pid, today, tz } = ctx
  const cutoff = addDaysKey(today, -180)
  const month = today.slice(0, 7)
  const monthStart = zonedDayStartIso(`${month}-01`, tz)
  const monthEnd = zonedDayStartIso(`${addMonthsKey(month, 1)}-01`, tz)
  const base = () => supabase.from('ag_documents')
  const [openQuotes, decided, openInvoices, pays] = await Promise.all([
    fetchAll(() => base().select('id, kind, status, total_cents, valid_until, issue_date').eq('provider_id', pid)
      .eq('kind', 'quote').in('status', ['sent', 'viewed']).order('id', { ascending: true })),
    fetchAll(() => base().select('id, status').eq('provider_id', pid).eq('kind', 'quote')
      .in('status', ['accepted', 'declined', 'expired', 'converted']).gte('issue_date', cutoff).order('id', { ascending: true })),
    fetchAll(() => base().select('id, kind, status, total_cents, amount_paid_cents, due_date, sent_at, viewed_at').eq('provider_id', pid)
      .eq('kind', 'invoice').in('status', ['sent', 'viewed', 'partial', 'overdue']).order('id', { ascending: true })),
    fetchAll(() => supabase.from('ag_payments').select('id, amount_cents').eq('provider_id', pid)
      .eq('type', 'invoice').eq('status', 'paid').gte('paid_at', monthStart).lt('paid_at', monthEnd).order('id', { ascending: true })),
  ])

  const out = { open_quotes_cents: 0, open_quotes_count: 0, awaiting_cents: 0, overdue_cents: 0, overdue_count: 0, paid_month_cents: 0, acceptance_rate: null }
  let accepted = 0, declined = 0, expired = 0
  for (const r of openQuotes) {
    if (effectiveStatus(r, today) === 'expired') {
      if (String(r.issue_date || '') >= cutoff) expired++
      continue
    }
    out.open_quotes_count++
    out.open_quotes_cents += Number(r.total_cents) || 0
  }
  for (const r of decided) {
    if (r.status === 'accepted' || r.status === 'converted') accepted++
    else if (r.status === 'declined') declined++
    else expired++
  }
  const decidedTotal = accepted + declined + expired
  out.acceptance_rate = decidedTotal ? Math.round((accepted / decidedTotal) * 1000) / 1000 : null

  for (const r of openInvoices) {
    const bal = balanceOf(r)
    if (bal <= 0) continue
    out.awaiting_cents += bal
    if (effectiveStatus(r, today) === 'overdue') { out.overdue_count++; out.overdue_cents += bal }
  }
  out.paid_month_cents = pays.reduce((s, p) => s + Math.max(0, Number(p.amount_cents) || 0), 0)
  return out
}

async function detail(ctx, id) {
  const { supabase, pid, today } = ctx
  if (!isUuid(id)) fail(400, 'Documento inválido')
  const { data: doc, error } = await supabase.from('ag_documents').select(DOC_COLS_FULL)
    .eq('id', id).eq('provider_id', pid).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) fail(404, 'Documento não encontrado')
  const [items, payments, events] = await Promise.all([
    loadItems(supabase, pid, doc.id),
    doc.kind === 'invoice' ? loadPayments(supabase, pid, doc.id) : [],
    loadEvents(supabase, pid, doc.id),
  ])
  return { document: shapeDoc(doc, { today, withSignature: true }), items, payments, events }
}

// ── POST: apoio ─────────────────────────────────────────────────────────────
/**
 * Fatura mudou (anulada, apagada, paga por fora, total editado): o Checkout do
 * Stripe que a cliente abriu pelo link (vale 1h) é encerrado, pra ela não pagar o
 * valor antigo. Best effort: falha no Stripe não derruba a ação.
 */
async function expireCheckout(ctx, doc) {
  const sid = doc && doc.stripe_checkout_session_id
  if (!sid) return
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = (await import('stripe')).default
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
      await stripe.checkout.sessions.expire(sid)
    } catch (_) { /* já paga, já expirada ou fora do ar: o webhook trata o excesso */ }
  }
  try {
    await ctx.supabase.from('ag_documents')
      .update({ stripe_checkout_session_id: null, stripe_checkout_expires_at: null })
      .eq('id', doc.id).eq('provider_id', ctx.pid).eq('stripe_checkout_session_id', sid)
  } catch (_) {}
}

async function loadOwn(ctx, id) {
  if (!isUuid(id)) fail(400, 'Documento inválido')
  const { data, error } = await ctx.supabase.from('ag_documents').select(DOC_COLS + ', stripe_checkout_session_id')
    .eq('id', id).eq('provider_id', ctx.pid).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) fail(404, 'Documento não encontrado')
  return data
}

/** Limite de documentos criados no mês (Starter). adding = quantos esta ação cria. */
async function checkMonthLimit(ctx, adding = 1) {
  if (limitFor(ctx.provider, 'documents_month') === null) return
  const start = zonedDayStartIso(`${ctx.today.slice(0, 7)}-01`, ctx.tz)
  const { count, error } = await ctx.supabase.from('ag_documents').select('id', { count: 'exact', head: true })
    .eq('provider_id', ctx.pid).gte('created_at', start)
  if (error) throw new Error(error.message)
  const g = requireLimit(ctx.provider, 'documents_month', (count || 0) + Math.max(1, adding) - 1)
  if (!g.ok) throw new HttpError(g.status, g.body)
}

/** Foto nova no documento exige 'job_photos' (tirar foto ou manter as antigas não). */
function gatePhotos(ctx, photos, current = []) {
  if (!Array.isArray(photos) || !photos.length) return
  const r = normalizePhotos(photos)
  if (r.error) fail(400, r.error)
  const cur = new Set(Array.isArray(current) ? current : [])
  if (r.photos.some((u) => !cur.has(u))) gate(ctx.provider, 'job_photos')
}

const reply = (ctx, row) => shapeDoc(row, { today: ctx.today })

async function patchDoc(ctx, doc, patch) {
  const { data, error } = await ctx.supabase.from('ag_documents').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', doc.id).eq('provider_id', ctx.pid).select(DOC_COLS).single()
  if (error) throw new Error(error.message)
  return data
}

/** Fatura do orçamento saiu (anulada/apagada) e não sobrou nenhuma: o orçamento volta a poder faturar. */
async function releaseQuote(ctx, quoteId) {
  if (!quoteId) return
  const { count, error } = await ctx.supabase.from('ag_documents').select('id', { count: 'exact', head: true })
    .eq('provider_id', ctx.pid).eq('kind', 'invoice').eq('quote_id', quoteId).neq('status', 'void')
  if (error || (count || 0) > 0) return
  const { data: q } = await ctx.supabase.from('ag_documents').select('id, provider_id, status, accepted_at, viewed_at, sent_at')
    .eq('id', quoteId).eq('provider_id', ctx.pid).maybeSingle()
  if (!q || q.status !== 'converted') return
  const status = q.accepted_at ? 'accepted' : q.viewed_at ? 'viewed' : q.sent_at ? 'sent' : 'draft'
  await ctx.supabase.from('ag_documents').update({ status, updated_at: new Date().toISOString() })
    .eq('id', q.id).eq('provider_id', ctx.pid)
  await addEvent(ctx.supabase, q, 'updated', 'app', { reopened: true, status })
}

function wrongStatus(doc) {
  fail(400, `Esse ${doc.kind === 'quote' ? 'orçamento' : 'documento'} está ${STATUS_PT[doc.status] || doc.status}.`, { code: 'invalid_status' })
}

// ── POST: ações ─────────────────────────────────────────────────────────────
async function actCreate(ctx, b, res) {
  if (!DOC_KINDS.includes(b.kind)) fail(400, 'Escolha orçamento (quote) ou fatura (invoice)')
  gate(ctx.provider, featureOf(b.kind))
  gatePhotos(ctx, b.photos)
  await checkMonthLimit(ctx, 1)
  const r = await saveDocument(ctx.supabase, ctx.provider, b)
  if (!r.ok) return res.status(r.status).json(r.body)
  return res.status(201).json({ ok: true, document: r.document, items: r.items })
}

async function actUpdate(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  gate(ctx.provider, featureOf(doc.kind))
  if (has(b, 'photos')) gatePhotos(ctx, b.photos, doc.photos)
  const { id, kind, ...input } = b
  const r = await saveDocument(ctx.supabase, ctx.provider, input, { existing: doc })
  if (!r.ok) return res.status(r.status).json(r.body)
  // Total ou saldo mudou (itens, ou ligou a um atendimento que já tinha pagamento): encerra o Checkout aberto
  if (doc.kind === 'invoice' && r.document
    && (r.document.total_cents !== doc.total_cents || r.document.amount_paid_cents !== doc.amount_paid_cents)) await expireCheckout(ctx, doc)
  return res.status(200).json({ ok: true, document: r.document, items: r.items })
}

async function actDuplicate(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  gate(ctx.provider, featureOf(doc.kind))
  await checkMonthLimit(ctx, 1)
  const items = await loadItems(ctx.supabase, ctx.pid, doc.id)
  const input = {
    kind: doc.kind,
    client: { name: doc.client_name, email: doc.client_email, phone: doc.client_phone, address: doc.client_address },
    title: doc.title,
    job_address: doc.job_address,
    language: doc.language,
    items: items.map(({ id, position, line_total_cents, ...it }) => it),
    tax_rate_bps: doc.tax_rate_bps,
    notes: doc.notes,
    terms: doc.terms,
    payment_instructions: doc.payment_instructions,
    internal_notes: doc.internal_notes,
    // Sem o recurso de fotos, a cópia sai sem as fotos (não bloqueia)
    photos: hasFeature(ctx.provider, 'job_photos') ? (doc.photos || []) : [],
  }
  if (doc.client_id) input.client_id = doc.client_id
  if (doc.discount_pct != null && Number(doc.discount_pct) > 0) input.discount_pct = Number(doc.discount_pct)
  else input.discount_cents = doc.discount_cents || 0
  if (doc.kind === 'quote') {
    if (doc.deposit_pct != null && Number(doc.deposit_pct) > 0) input.deposit_pct = Number(doc.deposit_pct)
    else input.deposit_cents = doc.deposit_cents || 0
  }
  const r = await saveDocument(ctx.supabase, ctx.provider, input, { eventDetail: { duplicated_from: doc.number } })
  if (!r.ok) return res.status(r.status).json(r.body)
  return res.status(201).json({ ok: true, document: r.document, items: r.items })
}

async function countItems(ctx, docId) {
  const { count, error } = await ctx.supabase.from('ag_document_items').select('id', { count: 'exact', head: true })
    .eq('document_id', docId).eq('provider_id', ctx.pid)
  if (error) throw new Error(error.message)
  return count || 0
}

/**
 * Fatura que nunca saiu (rascunho, etapa criada na conversão, ou já com pagamento do atendimento):
 * no 1º envio a emissão vira hoje (fuso dela) e o vencimento hoje + o prazo que ela tinha
 * (vencimento − emissão; sem datas, o padrão doc_defaults.due_days). Fatura paga (recibo) fica igual.
 * → { issue_date, due_date, from } ou null (nada muda)
 */
function firstSendDates(ctx, doc) {
  if (doc.kind !== 'invoice' || doc.sent_at || doc.status === 'paid' || doc.status === 'void') return null
  const issue = parseDateKey(doc.issue_date)
  const due = parseDateKey(doc.due_date)
  // Vencimento escolhido ainda no prazo: respeita a data dela (só a emissão vira hoje)
  if (due && due >= ctx.today) {
    if (issue === ctx.today || (issue && issue > ctx.today)) return null
    return { issue_date: ctx.today, due_date: due, from: { issue_date: issue, due_date: due } }
  }
  const term = issue && due ? Math.max(0, diffDaysKey(issue, due)) : docDefaults(ctx.provider).due_days
  const next = { issue_date: ctx.today, due_date: addDaysKey(ctx.today, term) }
  if (issue === next.issue_date && due === next.due_date) return null
  return { ...next, from: { issue_date: issue, due_date: due } }
}

/** draft → sent; orçamento vencido com validade estendida volta a valer. */
async function markSent(ctx, doc) {
  if (doc.kind === 'invoice' && doc.status === 'void') fail(400, 'Fatura anulada não pode ser enviada')
  if (!(await countItems(ctx, doc.id))) fail(400, 'Adicione pelo menos um item antes de enviar')
  if (doc.kind === 'quote' && ['draft', 'sent', 'viewed', 'expired'].includes(doc.status)
    && doc.valid_until && String(doc.valid_until).slice(0, 10) < ctx.today) {
    fail(400, 'A validade desse orçamento já passou. Mude a data de validade antes de enviar.')
  }
  const now = new Date().toISOString()
  const patch = {}
  const first = doc.status === 'draft'
  if (first) patch.status = 'sent'
  else if (doc.kind === 'quote' && doc.status === 'expired') patch.status = doc.viewed_at ? 'viewed' : 'sent'
  if (!doc.sent_at) patch.sent_at = now
  const dates = firstSendDates(ctx, doc)
  if (dates) { patch.issue_date = dates.issue_date; patch.due_date = dates.due_date }
  let row = doc
  if (Object.keys(patch).length) row = await patchDoc(ctx, doc, patch)
  // Fatura: status certo pelo vencimento (novo) e pelos pagamentos
  if (row.kind === 'invoice' && (first || dates || doc.status !== row.status)) {
    const r = await recomputeInvoice(ctx.supabase, row.id, { provider: ctx.provider })
    if (r?.row) row = r.row
  }
  const datesMoved = dates ? { from: dates.from, to: { issue_date: dates.issue_date, due_date: dates.due_date } } : null
  return { row, first, datesMoved }
}

/**
 * E-mail sai pelo nosso domínio: confere os limites ANTES de mandar (e antes de mudar o status).
 * kind 'send': até DOC_EMAIL_PER_DOC_DAY envios por e-mail do documento em 24h.
 * kind 'reminder': 1 lembrete por e-mail do documento em 24h (manual ou automático).
 * Os dois: teto diário da profissional (docEmailDailyCap), contando todos os documentos.
 */
async function checkEmailQuota(ctx, doc, kind) {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString()
  const { data, error } = await ctx.supabase.from('ag_document_events').select('type, detail')
    .eq('document_id', doc.id).eq('provider_id', ctx.pid).in('type', ['sent', 'reminder']).gte('created_at', since).limit(500)
  if (error) throw new Error(error.message)
  const mailed = (data || []).filter((e) => e.detail && e.detail.email_sent === true)
  if (kind === 'send' && mailed.filter((e) => e.type === 'sent').length >= DOC_EMAIL_PER_DOC_DAY) {
    const what = doc.kind === 'quote' ? 'Esse orçamento já foi enviado' : 'Essa fatura já foi enviada'
    fail(429, `${what} por e-mail ${DOC_EMAIL_PER_DOC_DAY} vezes nas últimas 24 horas. Mande pelo WhatsApp ou pelo link.`, { code: 'email_limit' })
  }
  if (kind === 'reminder' && mailed.some((e) => e.type === 'reminder')) {
    fail(429, 'Já saiu um lembrete por e-mail desse documento nas últimas 24 horas. Lembre pelo WhatsApp ou tente amanhã.', { code: 'email_limit' })
  }
  const cap = docEmailDailyCap(ctx.provider)
  if ((await countDocEmails(ctx.supabase, ctx.pid, since)) >= cap) {
    fail(429, `Você chegou ao limite de ${cap} e-mails de orçamentos e faturas em 24 horas. Mande pelo WhatsApp ou pelo link, ou tente mais tarde.`, { code: 'email_limit' })
  }
}

async function actSend(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  gate(ctx.provider, featureOf(doc.kind))
  const channel = SEND_CHANNELS.includes(b.channel) ? b.channel : 'link'
  if (channel === 'email' && doc.client_email) await checkEmailQuota(ctx, doc, 'send')
  const { row, first, datesMoved } = await markSent(ctx, doc)
  const document = reply(ctx, row)

  let emailSent = false
  let emailError = null
  if (channel === 'email') {
    if (!row.client_email) emailError = 'Essa cliente não tem e-mail no documento. Mande pelo WhatsApp ou pelo link.'
    else {
      const r = await sendDocEmail(ctx.supabase, document, ctx.provider, 'send')
      emailSent = !!r.ok
      if (!emailSent) emailError = 'Não conseguimos mandar o e-mail agora. Mande pelo WhatsApp ou pelo link.'
    }
  }
  await addEvent(ctx.supabase, row, 'sent', channel, {
    first, ...(channel === 'email' ? { email_sent: emailSent } : {}), ...(datesMoved ? { dates_moved: datesMoved } : {}),
  })
  return res.status(200).json({
    ok: true,
    document,
    public_url: document.public_url,
    message: docMessage(document, ctx.provider, document.public_url),
    email_sent: emailSent,
    ...(emailError ? { email_error: emailError } : {}),
  })
}

async function actMarkSent(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  gate(ctx.provider, featureOf(doc.kind))
  // Fatura que já nasceu com pagamento do atendimento (parcial, nunca enviada) também passa por aqui
  if (doc.status !== 'draft' && (doc.kind !== 'invoice' || doc.sent_at || doc.status === 'void' || doc.status === 'paid')) {
    if (doc.kind === 'invoice' && doc.status === 'void') fail(400, 'Fatura anulada não pode ser enviada')
    return res.status(200).json({ ok: true, document: reply(ctx, doc) })
  }
  const { row, datesMoved } = await markSent(ctx, doc)
  await addEvent(ctx.supabase, row, 'sent', 'app', { manual: true, ...(datesMoved ? { dates_moved: datesMoved } : {}) })
  return res.status(200).json({ ok: true, document: reply(ctx, row) })
}

async function actMarkAccepted(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  if (doc.kind !== 'quote') fail(400, 'Só orçamento pode ser aprovado')
  if (doc.status === 'accepted') return res.status(200).json({ ok: true, document: reply(ctx, doc) })
  if (!['draft', 'sent', 'viewed'].includes(doc.status)) wrongStatus(doc)
  const name = clip(b.name ?? b.accepted_name, 120)
  const row = await patchDoc(ctx, doc, {
    status: 'accepted', accepted_at: new Date().toISOString(), accepted_name: name,
    declined_at: null, decline_reason: null,
  })
  await addEvent(ctx.supabase, row, 'accepted', 'app', { by: 'provider', ...(name ? { name } : {}) })
  return res.status(200).json({ ok: true, document: reply(ctx, row) })
}

async function actDecline(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  if (doc.kind !== 'quote') fail(400, 'Só orçamento pode ser recusado. Para fatura, use "Anular".')
  const reason = clip(b.reason, 500)
  if (doc.status === 'declined') {
    if (!reason || reason === doc.decline_reason) return res.status(200).json({ ok: true, document: reply(ctx, doc) })
    const row = await patchDoc(ctx, doc, { decline_reason: reason })
    return res.status(200).json({ ok: true, document: reply(ctx, row) })
  }
  if (doc.status === 'converted') wrongStatus(doc)
  const row = await patchDoc(ctx, doc, { status: 'declined', declined_at: new Date().toISOString(), decline_reason: reason })
  await addEvent(ctx.supabase, row, 'declined', 'app', { by: 'provider', ...(reason ? { reason } : {}) })
  return res.status(200).json({ ok: true, document: reply(ctx, row) })
}

/**
 * Orçamento → fatura(s).
 *   full    → uma fatura com os mesmos itens, desconto e imposto. Se o orçamento já tem fatura
 *             (entrada/etapas), cria a fatura do saldo restante.
 *   deposit → fatura de entrada (deposit_pct do corpo, senão a entrada do orçamento, senão o padrão).
 *   stages  → uma fatura por etapa: [{ label, pct }] somando até 100%.
 * Entrada/etapa/saldo = 1 item sem imposto com a parte do total (o total do orçamento já tem o imposto).
 */
async function actConvert(ctx, b, res) {
  const quote = await loadOwn(ctx, b.id)
  if (quote.kind !== 'quote') fail(400, 'Só orçamento vira fatura')
  gate(ctx.provider, 'invoices')
  const mode = ['full', 'deposit', 'stages'].includes(b.mode) ? b.mode : 'full'
  if (mode !== 'full') gate(ctx.provider, 'progress_billing')
  if (quote.status === 'declined') fail(400, 'A cliente recusou esse orçamento. Duplique e envie de novo, se precisar.')

  const items = await loadItems(ctx.supabase, ctx.pid, quote.id)
  const total = Number(quote.total_cents) || 0
  if (!items.length || total <= 0) fail(400, 'O orçamento não tem itens com valor')

  const { data: prev, error: pErr } = await ctx.supabase.from('ag_documents').select('id, total_cents, number')
    .eq('provider_id', ctx.pid).eq('kind', 'invoice').eq('quote_id', quote.id).neq('status', 'void')
  if (pErr) throw new Error(pErr.message)
  const invoiced = (prev || []).reduce((s, d) => s + (Number(d.total_cents) || 0), 0)

  const lang = ['pt', 'en', 'es'].includes(quote.language) ? quote.language : 'en'
  const L = CONVERT_L[lang]
  const single = (description, cents) => ({
    items: [{ kind: 'other', description, quantity: 1, unit: 'un', unit_price_cents: cents, taxable: false }],
    discount_cents: 0, tax_rate_bps: 0,
  })
  const specs = []

  if (prev?.length) {
    if (mode !== 'full') fail(409, 'Esse orçamento já tem fatura. Para cobrar o resto, gere a fatura do saldo.', { code: 'already_invoiced' })
    const remainder = total - invoiced
    if (remainder <= 0) fail(409, 'Esse orçamento já foi faturado por inteiro.', { code: 'already_invoiced' })
    specs.push({ ...single(`${L.balance} · ${quote.number}`, remainder), stage_label: L.balance })
  } else if (mode === 'full') {
    const spec = {
      items: items.map(({ id, position, line_total_cents, ...it }) => it),
      tax_rate_bps: Number(quote.tax_rate_bps) || 0,
      stage_label: null,
    }
    if (quote.discount_pct != null && Number(quote.discount_pct) > 0) spec.discount_pct = Number(quote.discount_pct)
    else spec.discount_cents = Number(quote.discount_cents) || 0
    specs.push(spec)
  } else if (mode === 'deposit') {
    let pct = cleanPct(b.deposit_pct)
    let cents = 0
    if (pct !== null && pct > 0) cents = Math.round((total * pct) / 100)
    else if ((Number(quote.deposit_cents) || 0) > 0) {
      cents = Math.min(total, Number(quote.deposit_cents))
      pct = quote.deposit_pct != null && Number(quote.deposit_pct) > 0 ? Number(quote.deposit_pct) : Math.round((cents / total) * 10000) / 100
    } else {
      const def = docDefaults(ctx.provider).deposit_pct
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

  await checkMonthLimit(ctx, specs.length)
  const photos = hasFeature(ctx.provider, 'job_photos') ? (quote.photos || []) : []
  const created = []
  for (const spec of specs) {
    const { stage_label, ...values } = spec
    const input = {
      kind: 'invoice',
      client: { name: quote.client_name, email: quote.client_email, phone: quote.client_phone, address: quote.client_address },
      title: quote.title,
      job_address: quote.job_address,
      language: lang,
      notes: quote.notes,
      terms: quote.terms,
      photos,
      deposit_cents: 0,
      ...values,
    }
    if (quote.client_id) input.client_id = quote.client_id
    if (quote.payment_instructions) input.payment_instructions = quote.payment_instructions
    if (quote.appointment_id) input.appointment_id = quote.appointment_id
    const r = await saveDocument(ctx.supabase, ctx.provider, input, {
      extra: { quote_id: quote.id, stage_label },
      eventDetail: { from_quote: quote.number, mode },
    })
    if (!r.ok) {
      // Desfaz as faturas desta conversão que já tinham saído (com o "Já pago" do
      // atendimento lançado nelas: ag_payments.document_id é SET NULL e ficaria solto)
      if (created.length) {
        const ids = created.map((d) => d.id)
        await ctx.supabase.from('ag_payments').delete().in('document_id', ids).eq('provider_id', ctx.pid).eq('metadata->>source', 'appointment')
        await ctx.supabase.from('ag_documents').delete().in('id', ids).eq('provider_id', ctx.pid)
      }
      return res.status(r.status).json(r.body)
    }
    created.push(r.document)
  }

  const row = quote.status === 'converted' ? quote : await patchDoc(ctx, quote, { status: 'converted' })
  await addEvent(ctx.supabase, quote, 'converted', 'app', { mode, invoices: created.map((d) => d.number) })
  return res.status(201).json({ ok: true, invoices: created, quote: reply(ctx, row) })
}

async function actRecordPayment(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  if (doc.kind !== 'invoice') fail(400, 'Pagamento só pode ser registrado em fatura')
  gate(ctx.provider, 'invoices')
  if (doc.status === 'void') fail(400, 'Fatura anulada não recebe pagamento')
  const balance = balanceOf(doc)
  if (balance <= 0) fail(400, 'Essa fatura já está paga')
  const amount = Math.round(Number(b.amount_cents))
  if (!Number.isFinite(amount) || amount <= 0) fail(400, 'Informe o valor recebido')
  // Acima do saldo vale (gorjeta, troco): o app confirma antes. Teto: o dobro do total.
  const cap = Math.min(MAX_DOC_CENTS, Math.max(balance, (Number(doc.total_cents) || 0) * 2))
  if (amount > cap) fail(400, `Valor muito acima do saldo da fatura (${fmtMoney(balance, 'pt')})`)
  if (!PAY_METHODS.includes(b.method)) fail(400, 'Escolha a forma de pagamento')
  let paidOn = ctx.today
  if (b.paid_on) {
    paidOn = parseDateKey(b.paid_on)
    if (!paidOn) fail(400, 'Data do pagamento inválida')
    if (paidOn > ctx.today) fail(400, 'A data do pagamento não pode ser no futuro')
  }
  // Pagamento de outro dia: meio-dia daquele dia no fuso dela (cai no mês certo nas Finanças)
  const paidAt = paidOn === ctx.today
    ? new Date().toISOString()
    : new Date(Date.parse(zonedDayStartIso(paidOn, ctx.tz)) + 12 * 3600e3).toISOString()
  const note = clip(b.note, 300)

  const { data: pay, error } = await ctx.supabase.from('ag_payments').insert({
    provider_id: ctx.pid, document_id: doc.id, amount_cents: amount, type: 'invoice', status: 'paid',
    paid_at: paidAt, method: b.method,
    metadata: { method: b.method, note, source: 'manual', paid_on: paidOn, recorded_by: 'provider' },
  }).select('id').single()
  if (error) throw new Error(error.message)

  // Pago por fora (Zelle, cheque...): o Checkout aberto pela cliente teria o saldo antigo
  await expireCheckout(ctx, doc)
  const r = await recomputeInvoice(ctx.supabase, doc.id, { provider: ctx.provider })
  await addEvent(ctx.supabase, doc, 'payment', 'app', {
    payment_id: pay.id, amount_cents: amount, method: b.method, paid_on: paidOn, ...(r?.became_paid ? { fully_paid: true } : {}),
  })
  return res.status(200).json({
    ok: true,
    document: r ? reply(ctx, r.row) : reply(ctx, doc),
    payments: await loadPayments(ctx.supabase, ctx.pid, doc.id),
  })
}

async function actRemovePayment(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  if (doc.kind !== 'invoice') fail(400, 'Pagamento só existe em fatura')
  gate(ctx.provider, 'invoices')
  if (!isUuid(b.payment_id)) fail(400, 'Pagamento inválido')
  const { data: pay, error } = await ctx.supabase.from('ag_payments')
    .select('id, amount_cents, stripe_session_id, stripe_payment_intent_id, metadata')
    .eq('id', b.payment_id).eq('provider_id', ctx.pid).eq('document_id', doc.id).eq('type', 'invoice').maybeSingle()
  if (error) throw new Error(error.message)
  if (!pay) fail(404, 'Pagamento não encontrado')
  if (pay.stripe_session_id || pay.stripe_payment_intent_id || pay.metadata?.source === 'stripe') {
    fail(400, 'Pagamento no cartão pelo link não sai daqui: peça o reembolso ao suporte do BrasilConnect (oi@brasilconnectusa.com). A fatura se acerta sozinha quando o reembolso sair.')
  }
  const del = await ctx.supabase.from('ag_payments').delete().eq('id', pay.id).eq('provider_id', ctx.pid)
  if (del.error) throw new Error(del.error.message)
  const r = await recomputeInvoice(ctx.supabase, doc.id, { provider: ctx.provider })
  await addEvent(ctx.supabase, doc, 'payment', 'app', { removed: true, payment_id: pay.id, amount_cents: pay.amount_cents })
  return res.status(200).json({
    ok: true,
    document: r ? reply(ctx, r.row) : reply(ctx, doc),
    payments: await loadPayments(ctx.supabase, ctx.pid, doc.id),
  })
}

/** Lembrete manual: fatura com saldo (cobrança) ou orçamento aguardando resposta. */
async function actRemind(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  gate(ctx.provider, featureOf(doc.kind))
  if (doc.kind === 'invoice') {
    if (doc.status === 'draft') fail(400, 'Envie a fatura antes de cobrar')
    if (doc.status === 'void') fail(400, 'Fatura anulada não tem cobrança')
    if (balanceOf(doc) <= 0) fail(400, 'Essa fatura não tem saldo em aberto')
  } else {
    const st = effectiveStatus(doc, ctx.today)
    if (st === 'draft') fail(400, 'Envie o orçamento antes de lembrar a cliente')
    if (st === 'expired') fail(400, 'A validade desse orçamento já passou. Mude a data de validade e envie de novo.')
    if (!OPEN_QUOTE.includes(st)) wrongStatus({ ...doc, status: st })
  }
  const channel = SEND_CHANNELS.includes(b.channel) ? b.channel : (doc.client_email ? 'email' : 'whatsapp')
  if (channel === 'email' && doc.client_email) await checkEmailQuota(ctx, doc, 'reminder')
  const document = reply(ctx, doc)

  let emailSent = false
  let emailError = null
  if (channel === 'email') {
    if (!doc.client_email) emailError = 'Essa cliente não tem e-mail no documento. Lembre pelo WhatsApp.'
    else {
      const r = await sendDocEmail(ctx.supabase, document, ctx.provider, 'reminder')
      emailSent = !!r.ok
      if (!emailSent) emailError = 'Não conseguimos mandar o e-mail agora. Lembre pelo WhatsApp.'
    }
  }
  let row = doc
  if (channel !== 'email' || emailSent) {
    row = await patchDoc(ctx, doc, { last_reminder_at: new Date().toISOString(), reminders_sent: (Number(doc.reminders_sent) || 0) + 1 })
  }
  await addEvent(ctx.supabase, doc, 'reminder', channel, { manual: true, ...(channel === 'email' ? { email_sent: emailSent } : {}) })
  const out = reply(ctx, row)
  return res.status(200).json({
    ok: true,
    document: out,
    public_url: out.public_url,
    message: docMessage(out, ctx.provider, out.public_url, { reminder: true }),
    email_sent: emailSent,
    ...(emailError ? { email_error: emailError } : {}),
  })
}

async function actVoid(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  if (doc.kind !== 'invoice') fail(400, 'Só fatura pode ser anulada. Orçamento: marque como recusado.')
  gate(ctx.provider, 'invoices')
  if (doc.status === 'void') return res.status(200).json({ ok: true, document: reply(ctx, doc) })
  if ((Number(doc.amount_paid_cents) || 0) > 0) fail(400, 'Essa fatura tem pagamento registrado. Remova os pagamentos antes de anular.')
  await expireCheckout(ctx, doc)
  const row = await patchDoc(ctx, doc, { status: 'void', voided_at: new Date().toISOString(), paid_at: null })
  await addEvent(ctx.supabase, row, 'voided', 'app', {})
  await releaseQuote(ctx, doc.quote_id)
  return res.status(200).json({ ok: true, document: reply(ctx, row) })
}

async function actDelete(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  if (doc.status !== 'draft') {
    fail(400, doc.kind === 'invoice'
      ? 'Só rascunho pode ser apagado. Fatura enviada: use "Anular".'
      : 'Só rascunho pode ser apagado. Orçamento enviado: marque como recusado.', { code: 'invalid_status' })
  }
  await expireCheckout(ctx, doc)
  if (doc.kind === 'invoice') {
    // Rascunho com pagamento registrado à mão: remova antes. O "Já pago" do atendimento sai junto.
    const { data: pays, error: pErr } = await ctx.supabase.from('ag_payments').select('id, metadata')
      .eq('document_id', doc.id).eq('provider_id', ctx.pid).eq('status', 'paid')
    if (pErr) throw new Error(pErr.message)
    if ((pays || []).some((p) => !p.metadata || p.metadata.source !== 'appointment')) {
      fail(400, 'Esse rascunho tem pagamento registrado. Remova o pagamento antes de apagar.')
    }
    if ((pays || []).length) {
      await ctx.supabase.from('ag_payments').delete().eq('document_id', doc.id).eq('provider_id', ctx.pid).eq('metadata->>source', 'appointment')
    }
  }
  const { error } = await ctx.supabase.from('ag_documents').delete().eq('id', doc.id).eq('provider_id', ctx.pid).eq('status', 'draft')
  if (error) throw new Error(error.message)
  await releaseQuote(ctx, doc.quote_id)
  // Pedido de orçamento que tinha virado este rascunho volta pra "em contato"
  if (doc.quote_request_id) {
    await ctx.supabase.from('ag_quote_requests').update({ status: 'contacted', updated_at: new Date().toISOString() })
      .eq('id', doc.quote_request_id).eq('provider_id', ctx.pid).eq('status', 'quoted').is('document_id', null)
  }
  return res.status(200).json({ ok: true })
}

/** Link novo pra cliente (o antigo foi pra pessoa errada ou vazou): o link antigo para de abrir na hora. */
async function actRotateLink(ctx, b, res) {
  const doc = await loadOwn(ctx, b.id)
  let row = null
  for (let i = 0; i < 3 && !row; i++) {
    const { data, error } = await ctx.supabase.from('ag_documents')
      .update({ public_token: newToken(), updated_at: new Date().toISOString() })
      .eq('id', doc.id).eq('provider_id', ctx.pid).select(DOC_COLS).maybeSingle()
    if (error) {
      if (error.code === '23505') continue   // token repetido (improvável): tenta outro
      throw new Error(error.message)
    }
    if (!data) fail(404, 'Documento não encontrado')
    row = data
  }
  if (!row) throw new Error('Não foi possível gerar o link novo. Tente de novo.')
  await addEvent(ctx.supabase, row, 'updated', 'app', { link_rotated: true })
  return res.status(200).json({ ok: true, document: reply(ctx, row) })
}

const ACTIONS = {
  create: actCreate,
  update: actUpdate,
  duplicate: actDuplicate,
  send: actSend,
  mark_sent: actMarkSent,
  mark_accepted: actMarkAccepted,
  decline: actDecline,
  convert: actConvert,
  record_payment: actRecordPayment,
  remove_payment: actRemovePayment,
  remind: actRemind,
  void: actVoid,
  delete: actDelete,
  rotate_link: actRotateLink,
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    const tz = provider.timezone || 'America/New_York'
    const ctx = { supabase, provider, pid: provider.id, tz, today: dateKeyIn(tz) }
    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      const q = req.query || {}
      if (q.id) return res.status(200).json(await detail(ctx, String(q.id)))
      const [documents, sum] = await Promise.all([listDocuments(ctx, q), summary(ctx)])
      return res.status(200).json({ documents, summary: sum })
    }

    const b = req.body && typeof req.body === 'object' ? req.body : {}
    const fn = ACTIONS[String(b.action || '')]
    if (!fn) return res.status(400).json({ error: 'Ação inválida' })
    return await fn(ctx, b, res)
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json(e.body)
    console.error('[documents]', e.message)
    return res.status(500).json({ error: e.message })
  }
}

// Funções expostas pros testes locais (node -e)
export const _test = { STATUS_FILTERS, cleanSearch, listDocuments, summary, detail, ACTIONS, HttpError, shapeItem, firstSendDates, checkEmailQuota, markSent }
