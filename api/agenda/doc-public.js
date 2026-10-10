/**
 * Orçamento ou fatura aberto pela cliente final, pelo link /d/<token> (public/doc.html).
 * Público, sem login: quem tem o link vê o documento (o token é o segredo). Link trocado pela
 * profissional (documents.js, action 'rotate_link'): o token antigo não acha nada → 404.
 *
 * GET  /api/agenda/doc-public?t=TOKEN
 *      → { document, items, provider: { name, slug, avatar_url, cover_color, specialty, business,
 *          show_branding }, can_pay_online, related }
 *      document.updated_at = versão que a página manda de volta no aceite; depois do aceite,
 *      document.signed_hash + consent_at (o snapshot assinado fica só no banco).
 *      Rascunho/inexistente → 404 { code: 'not_found' } · anulada → 410 { code: 'void', language, provider }.
 *      Primeira abertura (viewed_at vazio): marca visto (+ status 'viewed' se estava 'sent'),
 *      evento e push pra profissional. Não conta: &preview=1 (o app abre assim pra ela conferir)
 *      nem o JWT da própria profissional no header.
 * POST { t, action: 'accept', name (2–120), signature? (data URL PNG até ~60 KB), consent: true, version }
 *      Só orçamento 'sent'/'viewed' dentro da validade (vencido → 410 'expired').
 *      consent ≠ true → 400 'consent_required'. version (o updated_at que a página carregou)
 *      diferente do banco → 409 'changed' (a página recarrega e mostra a versão nova).
 *      Grava nome, assinatura, IP, navegador, consent_at + consent_text_version ('esign-v1') e o
 *      snapshot do que foi assinado (documento + itens + totais + empresa + quem assinou) com
 *      signed_hash = sha256 hex do JSON canônico do snapshot. Manda a cópia por e-mail pra cliente
 *      (se tiver e-mail: link + código) e push pra profissional. → mesmo formato do GET + { ok }.
 * POST { t, action: 'decline', reason? (até 500) } → idem.
 * POST { t, action: 'pay' } → { checkout_url }  Stripe Checkout do saldo da fatura, repassado à conta
 *      Connect da profissional (recurso 'invoice_payments', Pro). Anulada → 410 'void'; paga ou sem
 *      saldo → 409 'nothing_to_pay'. A sessão aberta fica no documento (stripe_checkout_session_id/
 *      _expires_at): mesmo valor → devolve a mesma URL; valor mudou → expira a anterior e cria
 *      outra; a anterior já paga e o webhook ainda não chegou → registra o pagamento antes (não
 *      cobra de novo). O webhook do Stripe (api/stripe/webhook.js) registra o pagamento.
 *
 * Nunca sai daqui: internal_notes, IP/navegador da aprovação, a imagem da assinatura, o snapshot,
 * ids internos, colunas de plano/Stripe. Erros levam `code` (a página traduz pro idioma do documento).
 * Formato e status do documento: api/_lib/documents.js (shapeDoc/publicDoc/effectiveStatus).
 */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '../_lib/rateLimit.js'
import { hasFeature } from '../_lib/agendaPlans.js'
import { sendPushToProvider } from '../_lib/agendaPush.js'
import { requireAuthOnly } from '../_lib/businessAuth.js'
import { sendTransactional } from '../_lib/mailer.js'
import { escapeHtml } from '../_lib/emailShell.js'
import {
  DOC_COLS_FULL, shapeDoc, publicDoc, effectiveStatus, balanceOf, canPayOnline, addEvent,
  providerDisplayName, cleanText, dateKeyIn, fmtMoney, isEmail, publicUrlFor, emailHidesBrand,
} from '../_lib/documents.js'

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } }

export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/
const SIG_MAX_BYTES = 61440
const SIG_MAX_CHARS = 90000
const MIN_CARD_CENTS = 50
const OPEN_INVOICE = ['sent', 'viewed', 'partial', 'overdue']
const OPEN_QUOTE = ['sent', 'viewed']
const CHECKOUT_TTL_S = 3600            // sessão do Checkout vale 1h (mínimo do Stripe: 30 min)
const REUSE_MIN_LEFT_MS = 5 * 60000    // sessão guardada com menos de 5 min de vida: cria outra

// Plano (hasFeature) + Stripe + marca. Nada disso sai cru na resposta.
const PROV_COLS = 'id, name, slug, email, whatsapp, avatar_url, cover_color, specialty, timezone, app_settings, deposit_instructions, stripe_account_id, stripe_charges_enabled, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at'
// Colunas da assinatura e do Checkout aberto (supabase/ag_app_documents.sql), além das de sempre
const EXTRA_DOC_COLS = ['signed_hash', 'consent_at', 'stripe_checkout_session_id', 'stripe_checkout_expires_at']
const DOC_SELECT = [...new Set([...DOC_COLS_FULL.split(',').map((c) => c.trim()).filter(Boolean), ...EXTRA_DOC_COLS])].join(', ')
const PUBLIC_ITEM_COLS = 'position, kind, description, quantity, unit, unit_price_cents, taxable, line_total_cents'
const BIZ_KEYS = ['legal_name', 'license_no', 'address_line', 'city', 'state', 'zip', 'phone', 'email', 'website', 'insurance']
// Além do que publicDoc já tira: ids internos e o snapshot (updated_at fica: é a versão do aceite)
const CLIENT_OMIT = ['id', 'quote_id', 'created_at', 'signed_snapshot']

const KIND_PT = { quote: 'Orçamento', invoice: 'Fatura' }
const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-US' }

// Consentimento ESIGN. Mesmo texto da caixa de public/doc.html (mudou o texto → versão nova).
export const CONSENT_VERSION = 'esign-v1'
export const CONSENT_TEXT = {
  en: 'I agree to use electronic records and signatures for this document, and I am able to save or print a copy.',
  pt: 'Concordo em usar registros e assinatura eletrônicos neste documento e tenho como guardar ou imprimir uma cópia.',
  es: 'Acepto usar registros y firmas electrónicos para este documento y puedo guardar o imprimir una copia.',
}

// ── Funções puras (exportadas pra testes) ─────────────────────────────────────

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const int0 = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0 }
const httpUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : null)
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Cliente'
const usd = (cents) => fmtMoney(cents, 'en')
const langOf = (l) => (LOCALES[l] ? l : 'en')

/** Dados da empresa (app_settings.business) só com texto curto; telefone cai pro WhatsApp do perfil. */
export function publicBusiness(settings, provider = {}) {
  const b = settings && typeof settings.business === 'object' && settings.business ? settings.business : {}
  const out = {}
  for (const k of BIZ_KEYS) {
    if (k === 'insurance' && b[k] === true) { out[k] = true; continue }
    const v = str(b[k], k === 'website' ? 200 : 160)
    if (v) out[k] = v
  }
  if (!out.phone && str(provider.whatsapp, 40)) out.phone = str(provider.whatsapp, 40)
  return out
}

/**
 * Assinatura desenhada: data URL PNG válido até ~60 KB. Vazio → { value: null }.
 * Inválido → { error }.
 */
export function cleanSignature(v) {
  if (v === undefined || v === null || v === '') return { value: null }
  if (typeof v !== 'string' || v.length > SIG_MAX_CHARS) return { error: 'too_big' }
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(v)
  if (!m) return { error: 'format' }
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > SIG_MAX_BYTES) return { error: 'too_big' }
  // Assinatura de arquivo PNG
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return { error: 'format' }
  return { value: v }
}

/** Nome digitado na aprovação: 2–120 letras, espaços normalizados, sem caracteres de controle. */
export function cleanSignerName(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length < 2 || s.length > 120) return null
  return s
}

/** IP da cliente (primeiro do x-forwarded-for). */
export function clientIp(req) {
  const raw = String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '').split(',')[0].trim()
  return raw.slice(0, 64) || null
}

/** A página aprovou a mesma versão que está no banco? (version = updated_at que ela carregou) */
export function sameVersion(sent, current) {
  if (!sent || !current || typeof sent !== 'string') return false
  if (sent === String(current)) return true
  const a = Date.parse(sent), b = Date.parse(current)
  return Number.isFinite(a) && a === b
}

/** Item como a cliente vê (e como entra no snapshot assinado). */
export function publicItem(it) {
  return {
    position: int0(it.position),
    kind: it.kind,
    description: it.description,
    quantity: Number(it.quantity) || 0,
    unit: it.unit,
    unit_price_cents: int0(it.unit_price_cents),
    taxable: !!it.taxable,
    line_total_cents: int0(it.line_total_cents),
  }
}

/**
 * Documento como a cliente vê: publicDoc(shapeDoc) sem ids internos, com o status de hoje,
 * fotos só http(s), has_signature (a imagem não sai), o número do orçamento de origem e o
 * código da assinatura eletrônica. "Como pagar" é só o do próprio documento, igual ao PDF e ao
 * e-mail: se a profissional apagou, fica vazio (o padrão dela entra só na criação, saveDocument).
 */
export function clientDoc(row, todayKey, extra = {}) {
  const doc = publicDoc(shapeDoc(row, { today: todayKey }))
  for (const k of CLIENT_OMIT) delete doc[k]
  doc.photos = (doc.photos || []).map(httpUrl).filter(Boolean).slice(0, 20)
  doc.has_signature = !!row.accepted_signature
  doc.quote_number = extra.quoteNumber || null
  doc.signed_hash = /^[0-9a-f]{64}$/.test(String(row.signed_hash || '')) ? row.signed_hash : null
  doc.consent_at = row.consent_at || null
  return doc
}

/** Pode pagar no cartão agora? (Pro + Stripe conectado + fatura em aberto com saldo) */
export function docCanPayOnline(row, provider, todayKey) {
  if (!row || row.kind !== 'invoice') return false
  if (!OPEN_INVOICE.includes(effectiveStatus(row, todayKey))) return false
  if (balanceOf(row) < MIN_CARD_CENTS) return false
  return canPayOnline(provider)
}

/** Fatura pode ir pro cartão agora? → null (pode) ou [status http, code, mensagem]. */
export function payBlock(row, todayKey) {
  if (!row || row.kind !== 'invoice') return [409, 'not_open', 'Este documento não é uma fatura.']
  if (row.status === 'void') return [410, 'void', 'Esta fatura foi anulada.']
  const status = effectiveStatus(row, todayKey)
  const balance = balanceOf(row)
  if (status === 'paid' || balance <= 0) return [409, 'nothing_to_pay', 'Esta fatura já está paga.']
  if (!OPEN_INVOICE.includes(status)) return [409, 'not_open', 'Esta fatura não está aberta para pagamento.']
  if (balance < MIN_CARD_CENTS) return [400, 'amount_too_small', 'Valor pequeno demais para pagar no cartão.']
  return null
}

/** Sessão do Checkout guardada ainda serve? (aberta, desta fatura, mesmo valor, com tempo de sobra) */
export function sessionReusable(s, balance, docId, now = Date.now()) {
  return !!(s && s.status === 'open' && s.url && int0(s.amount_total) === balance
    && String(s.metadata?.document_id || '') === String(docId)
    && Number(s.expires_at) * 1000 - now > REUSE_MIN_LEFT_MS)
}

/** JSON canônico: chaves em ordem alfabética em todos os níveis, sem undefined. Mesmo conteúdo → mesma string. */
export function canonicalJson(v) {
  if (v === undefined || v === null || typeof v === 'function') return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'
}

export const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
export const snapshotHash = (snapshot) => sha256Hex(canonicalJson(snapshot))

/**
 * O que a cliente assinou, como estava na hora: documento + itens + totais + empresa + quem
 * assinou + consentimento. A imagem da assinatura entra só pelo sha256 (ela fica em
 * accepted_signature). signer: { name, signed_at, ip, user_agent, signature }.
 */
export function buildSignedSnapshot({ row, items, prov, signer = {}, consentAt }) {
  const d = shapeDoc(row)
  const settings = prov?.app_settings && typeof prov.app_settings === 'object' ? prov.app_settings : {}
  const lang = langOf(d.language)
  return {
    format: 'workpro-signed-v1',
    document: {
      id: row.id,
      kind: d.kind,
      number: d.number,
      title: d.title,
      language: d.language,
      issue_date: d.issue_date,
      valid_until: d.valid_until,
      client_name: d.client_name,
      client_email: d.client_email,
      client_phone: d.client_phone,
      client_address: d.client_address,
      job_address: d.job_address,
      notes: d.notes,
      terms: d.terms,
      payment_instructions: d.payment_instructions,
      photos: (d.photos || []).map(httpUrl).filter(Boolean).slice(0, 20),
      version: row.updated_at || null,
    },
    items: (items || []).map(publicItem),
    totals: {
      subtotal_cents: d.subtotal_cents,
      discount_pct: d.discount_pct,
      discount_cents: d.discount_cents,
      tax_rate_bps: d.tax_rate_bps,
      tax_cents: d.tax_cents,
      total_cents: d.total_cents,
      deposit_pct: d.deposit_pct,
      deposit_cents: d.deposit_cents,
    },
    business: { name: providerDisplayName(prov), ...publicBusiness(settings, prov || {}) },
    signer: {
      name: signer.name || null,
      signed_at: signer.signed_at || null,
      ip: signer.ip || null,
      user_agent: signer.user_agent || null,
      signature_sha256: signer.signature ? sha256Hex(signer.signature) : null,
    },
    consent: { version: CONSENT_VERSION, text: CONSENT_TEXT[lang], at: consentAt || signer.signed_at || null },
  }
}

/** Instante → '10 de outubro de 2026 14:32 CDT' no idioma do documento e no fuso da profissional. */
export function fmtInstant(iso, lang = 'en', tz = 'America/New_York') {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const opts = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
  for (const zone of [tz || 'America/New_York', 'America/New_York']) {
    try { return new Intl.DateTimeFormat(LOCALES[langOf(lang)], { ...opts, timeZone: zone }).format(d) } catch (_) {}
  }
  return d.toISOString()
}

const COPY_TEXT = {
  en: {
    subject: (n, p) => `Your signed copy: quote ${n} from ${p}`,
    kicker: 'QUOTE APPROVED', title: (n) => `You approved quote ${n}`,
    hi: (f) => (f ? `Hi ${f},` : 'Hello,'),
    lead: (n, p, total, t) => `You approved and electronically signed quote <strong>${n}</strong>${t ? ` (${t})` : ''} from ${p} for <strong>${total}</strong>.`,
    when: (d, who) => `Signed on ${d} by ${who}.`,
    deposit: (a) => `Deposit due to get started: <strong>${a}</strong>.`,
    code: (c, h) => `Verification code: <strong>${c}</strong><br><span style="font-size:12px;word-break:break-all;">SHA-256: ${h}</span>`,
    keep: 'Keep this email for your records. You can open, save or print the signed quote at any time with the button below.',
    contact: (p, ph, em) => `Questions? Contact ${p}${ph ? ` at ${ph}` : ''}${em ? `${ph ? ' or' : ' at'} ${em}` : ''}.`,
    btn: 'View signed quote',
  },
  pt: {
    subject: (n, p) => `Sua cópia assinada: orçamento ${n} de ${p}`,
    kicker: 'ORÇAMENTO APROVADO', title: (n) => `Você aprovou o orçamento ${n}`,
    hi: (f) => (f ? `Olá, ${f}!` : 'Olá!'),
    lead: (n, p, total, t) => `Você aprovou e assinou eletronicamente o orçamento <strong>${n}</strong>${t ? ` (${t})` : ''} de ${p}, no valor de <strong>${total}</strong>.`,
    when: (d, who) => `Assinado em ${d} por ${who}.`,
    deposit: (a) => `Entrada para começar: <strong>${a}</strong>.`,
    code: (c, h) => `Código de verificação: <strong>${c}</strong><br><span style="font-size:12px;word-break:break-all;">SHA-256: ${h}</span>`,
    keep: 'Guarde este e-mail como comprovante. Você pode abrir, salvar ou imprimir o orçamento assinado quando quiser pelo botão abaixo.',
    contact: (p, ph, em) => `Dúvidas? Fale com ${p}${ph ? ` pelo telefone ${ph}` : ''}${em ? `${ph ? ' ou' : ''} pelo e-mail ${em}` : ''}.`,
    btn: 'Ver orçamento assinado',
  },
  es: {
    subject: (n, p) => `Su copia firmada: cotización ${n} de ${p}`,
    kicker: 'COTIZACIÓN APROBADA', title: (n) => `Usted aprobó la cotización ${n}`,
    hi: (f) => (f ? `Hola, ${f}:` : 'Hola:'),
    lead: (n, p, total, t) => `Usted aprobó y firmó electrónicamente la cotización <strong>${n}</strong>${t ? ` (${t})` : ''} de ${p} por <strong>${total}</strong>.`,
    when: (d, who) => `Firmada el ${d} por ${who}.`,
    deposit: (a) => `Anticipo para comenzar: <strong>${a}</strong>.`,
    code: (c, h) => `Código de verificación: <strong>${c}</strong><br><span style="font-size:12px;word-break:break-all;">SHA-256: ${h}</span>`,
    keep: 'Guarde este correo como comprobante. Puede abrir, guardar o imprimir la cotización firmada cuando quiera con el botón de abajo.',
    contact: (p, ph, em) => `¿Preguntas? Comuníquese con ${p}${ph ? ` al ${ph}` : ''}${em ? `${ph ? ' o' : ''} en ${em}` : ''}.`,
    btn: 'Ver cotización firmada',
  },
}

/**
 * E-mail com a cópia da aprovação pra cliente guardar (função pura → opções do sendTransactional):
 * idioma do documento, reply-to da profissional, nome da empresa no From e, no Premium
 * (no_branding), sem a marca BrasilConnect — igual ao e-mail do documento (api/_lib/documents.js).
 */
export function signedCopyEmail(row, prov, { name, hash, signedAt, url }) {
  const d = shapeDoc(row)
  const lang = langOf(d.language)
  const L = COPY_TEXT[lang]
  const provRaw = providerDisplayName(prov)
  const provHtml = escapeHtml(provRaw)
  const b = prov?.app_settings?.business || {}
  const phone = str(b.phone, 30) || str(prov?.whatsapp, 30)
  const email = (isEmail(b.email) ? String(b.email).trim() : null) || (isEmail(prov?.email) ? String(prov.email).trim() : null)
  const first = String(name || '').trim().split(/\s+/)[0] || ''
  const p = [
    escapeHtml(L.hi(first)),
    L.lead(escapeHtml(d.number), provHtml, escapeHtml(fmtMoney(d.total_cents, lang)), d.title ? escapeHtml(d.title) : ''),
    L.when(escapeHtml(fmtInstant(signedAt, lang, prov?.timezone)), escapeHtml(name || d.client_name)),
  ]
  if (d.deposit_cents > 0) p.push(L.deposit(escapeHtml(fmtMoney(d.deposit_cents, lang))))
  p.push(L.code(escapeHtml(String(hash || '').slice(0, 8)), escapeHtml(hash || '')))
  p.push(L.keep)
  if (phone || email) p.push(L.contact(provHtml, phone ? escapeHtml(phone) : '', email ? escapeHtml(email) : ''))
  return {
    subject: L.subject(d.number, provRaw.replace(/[\r\n]+/g, ' ').slice(0, 80)),
    kicker: L.kicker,
    title: L.title(d.number),
    paragraphs: p,
    ctaUrl: url || publicUrlFor(row.public_token),
    ctaLabel: L.btn,
    replyTo: email,
    lang,
    fromName: str(b.legal_name, 120) || str(prov?.name, 120) || null,
    // Igual ao e-mail do documento: sem a marca só com Premium pago (nunca no teste grátis)
    hideBrand: emailHidesBrand(prov),
  }
}

// ── Banco ────────────────────────────────────────────────────────────────────

async function loadByToken(supabase, token) {
  const { data: doc, error } = await supabase.from('ag_documents').select(DOC_SELECT).eq('public_token', token).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) return { doc: null, prov: null }
  const { data: prov, error: pErr } = await supabase.from('ag_providers').select(PROV_COLS).eq('id', doc.provider_id).maybeSingle()
  if (pErr) throw new Error(pErr.message)
  return { doc, prov: prov || null }
}

async function reloadDoc(supabase, row) {
  const { data, error } = await supabase.from('ag_documents').select(DOC_SELECT)
    .eq('id', row.id).eq('provider_id', row.provider_id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function loadPublicItems(supabase, doc) {
  const { data, error } = await supabase.from('ag_document_items').select(PUBLIC_ITEM_COLS)
    .eq('document_id', doc.id).eq('provider_id', doc.provider_id).order('position', { ascending: true }).limit(500)
  if (error) throw new Error(error.message)
  return (data || []).map(publicItem)
}

async function buildPayload(supabase, doc, prov, todayKey) {
  const settings = prov?.app_settings && typeof prov.app_settings === 'object' ? prov.app_settings : {}

  const [items, quoteQ, relatedQ] = await Promise.all([
    loadPublicItems(supabase, doc),
    doc.kind === 'invoice' && doc.quote_id
      ? supabase.from('ag_documents').select('number').eq('id', doc.quote_id).eq('provider_id', doc.provider_id).maybeSingle()
      : Promise.resolve({ data: null }),
    doc.kind === 'quote'
      ? supabase.from('ag_documents').select('kind, number, stage_label, status, total_cents, amount_paid_cents, public_token')
        .eq('provider_id', doc.provider_id).eq('quote_id', doc.id).eq('kind', 'invoice')
        .not('status', 'in', '(draft,void)').order('created_at', { ascending: true }).limit(10)
      : Promise.resolve({ data: [] }),
  ])

  const related = (relatedQ.data || []).filter((r) => TOKEN_RE.test(String(r.public_token || ''))).map((r) => ({
    number: r.number,
    stage_label: r.stage_label || null,
    status: r.status,
    total_cents: int0(r.total_cents),
    balance_cents: balanceOf(r),
    url: `/d/${r.public_token}`,
  }))

  return {
    document: clientDoc(doc, todayKey, { quoteNumber: quoteQ.data?.number || null }),
    items,
    provider: {
      name: prov?.name || '',
      slug: prov?.slug || null,
      avatar_url: httpUrl(prov?.avatar_url),
      cover_color: /^#[0-9a-f]{6}$/i.test(String(prov?.cover_color || '')) ? prov.cover_color : null,
      specialty: prov?.specialty || null,
      business: publicBusiness(settings, prov || {}),
      show_branding: !hasFeature(prov, 'no_branding'),
    },
    can_pay_online: docCanPayOnline(doc, prov, todayKey),
    related,
  }
}

/** A própria profissional abrindo o link (JWT do dono no header)? Não conta como visto. */
async function openedByOwner(req, supabase, providerId) {
  const h = req.headers?.authorization || req.headers?.Authorization
  if (!h || !String(h).startsWith('Bearer ')) return false
  try {
    const auth = await requireAuthOnly(req, supabase)
    if (!auth.ok) return false
    const { data } = await supabase.from('ag_providers').select('id').eq('id', providerId).eq('owner_user_id', auth.user.id).maybeSingle()
    return !!data
  } catch (_) {
    return false
  }
}

function pushDoc(supabase, doc, prov, title, body) {
  return sendPushToProvider(supabase, doc.provider_id, {
    kind: 'documents',
    title,
    body,
    data: { type: 'document', id: doc.id },
    provider: prov && 'plan_status' in prov ? prov : undefined,
  })
}

/** Cópia da aprovação pro e-mail da cliente. Best effort: nunca lança. → true se saiu */
async function sendSignedCopy(doc, prov, signed) {
  try {
    const to = String(doc.client_email || '').trim().toLowerCase()
    if (!isEmail(to)) return false
    const r = await sendTransactional({ to, ...signedCopyEmail(doc, prov, signed) })
    return !!r?.ok
  } catch (e) {
    console.error('[doc-public] cópia da aprovação:', e.message)
    return false
  }
}

// ── Stripe Checkout da fatura ────────────────────────────────────────────────

async function retrieveSession(stripe, id) {
  try {
    return await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent'] })
  } catch (e) {
    console.error(`[doc-public] sessão ${id}:`, e.message)
    return null
  }
}

/** Expira a sessão. Falhou (já paga ou expirada nesse meio-tempo)? Devolve o estado atual. */
async function expireSession(stripe, id) {
  try {
    return await stripe.checkout.sessions.expire(id)
  } catch (e) {
    return retrieveSession(stripe, id)
  }
}

/**
 * Sessão anterior já paga e o webhook ainda não chegou: registra o pagamento agora (mesma rotina
 * do webhook, idempotente) pra não abrir outra cobrança do mesmo saldo. → linha atual da fatura
 */
async function settlePaidSession(supabase, row, session) {
  if (String(session?.metadata?.document_id || '') !== String(row.id)) return row
  const { handleInvoicePaid } = await import('../stripe/webhook.js')
  await handleInvoicePaid(supabase, session)
  return (await reloadDoc(supabase, row)) || row
}

function createCheckout(stripe, row, prov, token, balance) {
  const baseUrl = process.env.APP_URL || 'https://brasilconnectusa.com'
  const seller = providerDisplayName(prov)
  const meta = { type: 'invoice', document_id: row.id, provider_id: row.provider_id, number: String(row.number || '') }
  const email = String(row.client_email || '').trim().toLowerCase()
  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${row.number}${row.title ? ' · ' + row.title : ''}`.slice(0, 250),
          description: String(seller).slice(0, 250),
        },
        unit_amount: balance,
      },
      quantity: 1,
    }],
    // Repasse integral pra profissional (0% de comissão), igual ao sinal do AgendaPro
    payment_intent_data: {
      transfer_data: { destination: prov.stripe_account_id },
      description: `${row.number} · ${seller}`.slice(0, 500),
      metadata: meta,
    },
    metadata: meta,
    client_reference_id: row.id,
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? { customer_email: email } : {}),
    locale: row.language === 'pt' ? 'pt-BR' : row.language === 'es' ? 'es' : 'en',
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
    success_url: `${baseUrl}/d/${token}?paid=1`,
    cancel_url: `${baseUrl}/d/${token}`,
  })
}

/**
 * Guarda a sessão nova no documento. Duas abas ao mesmo tempo: fica a que gravou primeiro (se
 * ainda servir) e a outra expira. → URL do Checkout pra devolver à página
 */
async function rememberSession(supabase, stripe, row, session, balance) {
  const patch = {
    stripe_checkout_session_id: session.id,
    stripe_checkout_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  }
  const cur = row.stripe_checkout_session_id || null
  let q = supabase.from('ag_documents').update(patch).eq('id', row.id).eq('provider_id', row.provider_id)
  q = cur ? q.eq('stripe_checkout_session_id', cur) : q.is('stripe_checkout_session_id', null)
  const { data, error } = await q.select('id').maybeSingle()
  if (error) { console.error('[doc-public] guardar sessão:', error.message); return session.url }
  if (data) return session.url

  // Outra aba gravou uma sessão nesse meio-tempo
  const fresh = await reloadDoc(supabase, row).catch(() => null)
  const otherId = fresh?.stripe_checkout_session_id
  if (otherId && otherId !== session.id) {
    const other = await retrieveSession(stripe, otherId)
    if (sessionReusable(other, balance, row.id)) {
      await expireSession(stripe, session.id)
      return other.url
    }
    if (other && other.status === 'open') await expireSession(stripe, otherId)
  }
  const force = await supabase.from('ag_documents').update(patch).eq('id', row.id).eq('provider_id', row.provider_id)
  if (force.error) console.error('[doc-public] guardar sessão:', force.error.message)
  return session.url
}

// Limites por IP (chaves separadas: GET não gasta o limite de aprovar/pagar)
function limited(req, bucket, max) {
  return rateLimit({ headers: req.headers || {}, url: `/api/agenda/doc-public:${bucket}` }, { windowMs: 60000, max })
}

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra })

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')

  const isGet = req.method === 'GET'
  const rl = limited(req, isGet ? 'get' : 'post', isGet ? 60 : 15)
  if (rl) return fail(res, 429, 'rate_limited', `Muitas tentativas. Tente de novo em ${rl.retryAfter}s.`)

  const body = !isGet && req.body && typeof req.body === 'object' ? req.body : {}
  const token = String((isGet ? req.query?.t : body.t) || '').trim()
  if (!TOKEN_RE.test(token)) return fail(res, 404, 'not_found', 'Documento não encontrado')

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const { doc, prov } = await loadByToken(supabase, token)
    if (!doc || doc.status === 'draft' || !prov) return fail(res, 404, 'not_found', 'Documento não encontrado')
    if (doc.status === 'void') {
      return fail(res, 410, 'void', 'Esta fatura foi anulada.', {
        language: doc.language,
        provider: { name: prov.name || '', cover_color: /^#[0-9a-f]{6}$/i.test(String(prov.cover_color || '')) ? prov.cover_color : null },
      })
    }
    const today = dateKeyIn(prov.timezone || 'America/New_York')
    const kindPt = KIND_PT[doc.kind] || 'Documento'

    // ── GET: mostra e marca a primeira abertura ─────────────────────────
    if (isGet) {
      const preview = String(req.query?.preview || '') === '1'
      if (!preview && !doc.viewed_at && (doc.status === 'sent' || OPEN_INVOICE.includes(doc.status)) && !(await openedByOwner(req, supabase, doc.provider_id))) {
        const now = new Date().toISOString()
        const patch = { viewed_at: now }
        if (doc.status === 'sent') patch.status = 'viewed'
        const { data: upd, error: uErr } = await supabase.from('ag_documents').update(patch)
          .eq('id', doc.id).eq('provider_id', doc.provider_id).is('viewed_at', null).select('id').maybeSingle()
        if (uErr) console.error('[doc-public] visto:', uErr.message)
        if (upd) {
          Object.assign(doc, patch)
          await addEvent(supabase, doc, 'viewed', 'link', {})
          const aberto = doc.kind === 'invoice' ? 'aberta' : 'aberto'
          await pushDoc(supabase, doc, prov,
            `${kindPt} ${doc.number} ${aberto} por ${firstName(doc.client_name)}`,
            [doc.title, usd(doc.total_cents)].filter(Boolean).join(' · '))
        }
      }
      return res.status(200).json(await buildPayload(supabase, doc, prov, today))
    }

    const action = String(body.action || '')

    // ── Aprovar / recusar orçamento ──────────────────────────────────────
    if (action === 'accept' || action === 'decline') {
      if (doc.kind !== 'quote') return fail(res, 409, 'not_open', 'Este documento não é um orçamento.')
      if (['accepted', 'converted', 'declined'].includes(doc.status)) return fail(res, 409, 'already_answered', 'Este orçamento já foi respondido.')
      if (effectiveStatus(doc, today) === 'expired') return fail(res, 410, 'expired', 'Este orçamento venceu. Peça um orçamento atualizado.')
      if (!OPEN_QUOTE.includes(doc.status)) return fail(res, 409, 'not_open', 'Este orçamento não está aberto para resposta.')

      const now = new Date().toISOString()
      let patch, eventDetail, title, pushBody
      let signed = null

      if (action === 'accept') {
        const name = cleanSignerName(body.name)
        if (!name) return fail(res, 400, 'invalid_name', 'Digite seu nome completo.')
        const sig = cleanSignature(body.signature)
        if (sig.error) return fail(res, 400, 'invalid_signature', 'Assinatura inválida ou grande demais. Limpe e assine de novo.')
        if (body.consent !== true) return fail(res, 400, 'consent_required', 'Marque a caixa de consentimento para assinar eletronicamente.')
        if (!sameVersion(body.version, doc.updated_at)) {
          return fail(res, 409, 'changed', 'Este orçamento foi atualizado. Confira os valores e aprove de novo.')
        }
        const ip = clientIp(req)
        const ua = String(req.headers?.['user-agent'] || '').slice(0, 400) || null
        // O que foi assinado, como estava agora (a versão conferida acima)
        const items = await loadPublicItems(supabase, doc)
        const snapshot = buildSignedSnapshot({
          row: doc, items, prov, consentAt: now,
          signer: { name, signed_at: now, ip, user_agent: ua, signature: sig.value },
        })
        const hash = snapshotHash(snapshot)
        signed = { name, hash, signedAt: now }
        patch = {
          status: 'accepted',
          accepted_at: now,
          accepted_name: name,
          accepted_signature: sig.value,
          accepted_ip: ip,
          accepted_user_agent: ua,
          signed_snapshot: snapshot,
          signed_hash: hash,
          consent_at: now,
          consent_text_version: CONSENT_VERSION,
          updated_at: now,
        }
        eventDetail = {
          by: 'client', name, signed: !!sig.value,
          total_cents: int0(doc.total_cents), deposit_cents: int0(doc.deposit_cents),
          signed_hash: hash, consent: CONSENT_VERSION,
        }
        title = `${kindPt} ${doc.number} aprovado por ${firstName(name)}`
        pushBody = [doc.title, usd(doc.total_cents), int0(doc.deposit_cents) > 0 ? `entrada ${usd(doc.deposit_cents)}` : null].filter(Boolean).join(' · ')
      } else {
        const reason = cleanText(body.reason, 500)
        patch = { status: 'declined', declined_at: now, decline_reason: reason, updated_at: now }
        eventDetail = { by: 'client', ...(reason ? { reason: reason.slice(0, 200) } : {}) }
        title = `${kindPt} ${doc.number} recusado por ${firstName(doc.client_name)}`
        pushBody = reason ? `Motivo: ${reason}` : [doc.title, 'Sem motivo informado'].filter(Boolean).join(' · ')
      }
      if (!doc.viewed_at) patch.viewed_at = now

      // Só muda se ainda estiver aberto (duas abas ao mesmo tempo não respondem duas vezes) e,
      // na aprovação, se ninguém editou o orçamento depois da conferência da versão
      let q = supabase.from('ag_documents').update(patch)
        .eq('id', doc.id).eq('provider_id', doc.provider_id).in('status', OPEN_QUOTE)
      if (action === 'accept') q = q.eq('updated_at', doc.updated_at)
      const { data: upd, error: uErr } = await q.select('id').maybeSingle()
      if (uErr) return fail(res, 500, 'server_error', 'Não conseguimos registrar sua resposta. Tente de novo.')
      if (!upd) {
        if (action === 'accept') {
          const { data: cur } = await supabase.from('ag_documents').select('status')
            .eq('id', doc.id).eq('provider_id', doc.provider_id).maybeSingle()
          if (cur && OPEN_QUOTE.includes(cur.status)) {
            return fail(res, 409, 'changed', 'Este orçamento foi atualizado. Confira os valores e aprove de novo.')
          }
        }
        return fail(res, 409, 'already_answered', 'Este orçamento já foi respondido.')
      }

      Object.assign(doc, patch)
      if (signed) eventDetail.copy_emailed = await sendSignedCopy(doc, prov, { ...signed, url: publicUrlFor(token) })
      await addEvent(supabase, doc, action === 'accept' ? 'accepted' : 'declined', 'link', eventDetail)
      await pushDoc(supabase, doc, prov, title, pushBody)
      return res.status(200).json({ ok: true, ...(await buildPayload(supabase, doc, prov, today)) })
    }

    // ── Pagar a fatura no cartão ─────────────────────────────────────────
    if (action === 'pay') {
      const prl = limited(req, 'pay', 6)
      if (prl) return fail(res, 429, 'rate_limited', `Muitas tentativas. Tente de novo em ${prl.retryAfter}s.`)
      let row = doc
      let block = payBlock(row, today)
      if (block) return fail(res, ...block)
      if (!process.env.STRIPE_SECRET_KEY || !docCanPayOnline(row, prov, today)) {
        return fail(res, 409, 'pay_unavailable', 'O pagamento online não está disponível para esta fatura.', {
          payment_instructions: row.payment_instructions || null,
        })
      }

      const Stripe = (await import('stripe')).default
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

      // Sessão guardada: mesma conta → reaproveita; valor mudou → expira; já paga → registra
      const prevId = row.stripe_checkout_session_id || null
      if (prevId) {
        let prev = await retrieveSession(stripe, prevId)
        if (prev && prev.status === 'open') {
          if (sessionReusable(prev, balanceOf(row), row.id)) return res.status(200).json({ checkout_url: prev.url })
          prev = await expireSession(stripe, prevId)
          // Não conseguiu expirar: não abre uma segunda cobrança em paralelo
          if (prev && prev.status === 'open') return fail(res, 503, 'server_error', 'Não conseguimos abrir o pagamento agora. Tente de novo.')
        }
        if (prev && prev.status === 'complete' && prev.payment_status === 'paid') {
          row = await settlePaidSession(supabase, row, prev)
          block = payBlock(row, today)
          if (block) return fail(res, ...block)
        }
      }

      const balance = balanceOf(row)
      const session = await createCheckout(stripe, row, prov, token, balance)
      const url = await rememberSession(supabase, stripe, row, session, balance)
      return res.status(200).json({ checkout_url: url })
    }

    return fail(res, 400, 'invalid_action', 'Ação inválida')
  } catch (e) {
    console.error('[doc-public] erro:', e.message)
    return fail(res, 500, 'server_error', 'Erro ao abrir o documento. Tente de novo.')
  }
}
