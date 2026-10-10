// ════════════════════════════════════════════════════════════════════════════
//   Orçamentos e faturas no app: rótulos e cores de status (pt), rótulos do
//   documento no idioma da cliente (en/pt/es), unidades, formas de pagamento,
//   linha do tempo, PDF (expo-print) e envio do link.
//
//   <DocStatusBadge kind="quote" status="sent" />
//   const t = totalsOf(doc, items)            // sempre computeTotals (lib/docCalc.js)
//   const html = buildDocumentHtml(doc, items, provider, business, { branding, payments })
//   await sharePdf(doc, items, provider, business, { branding })
//   await shareDocLink(doc, message)          // WhatsApp da cliente ou folha de compartilhar
//
//   Valores em centavos. Datas 'YYYY-MM-DD' (colunas date): só getters UTC.
// ════════════════════════════════════════════════════════════════════════════
import { Platform, Share, Text, View } from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as Clipboard from 'expo-clipboard'
import { File as FsFile, Paths } from 'expo-file-system'
import { ITEM_KINDS, UNITS, cleanPct, cleanQty, computeTotals } from './docCalc'
import { fmtMoney, fmtPhone } from './format'
import { openWhatsApp } from './whatsapp'
import { notify } from './dialog'
import { colors } from './theme'

export const DOC_LANGS = [
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'es', label: 'Español' },
]
const LANG_CODES = ['en', 'pt', 'es']
export const docLang = (l) => (LANG_CODES.includes(l) ? l : 'en')

// ── Status (interface em pt) ───────────────────────────────────────────────
const TONE = {
  gray:   { fg: colors.inkSoft, bg: colors.paperSoft },
  muted:  { fg: colors.inkMuted, bg: colors.paperSoft },
  blue:   { fg: colors.info, bg: colors.infoSoft },
  gold:   { fg: colors.goldDark, bg: colors.goldSoft },
  green:  { fg: colors.success, bg: colors.successSoft },
  red:    { fg: colors.danger, bg: colors.dangerSoft },
  orange: { fg: colors.warning, bg: colors.warningSoft },
  navy:   { fg: colors.navy, bg: colors.navySoft },
}

export const QUOTE_STATUS = {
  draft:     { label: 'Rascunho', ...TONE.gray },
  sent:      { label: 'Enviado', ...TONE.blue },
  viewed:    { label: 'Visto', ...TONE.gold },
  accepted:  { label: 'Aprovado', ...TONE.green },
  declined:  { label: 'Recusado', ...TONE.red },
  expired:   { label: 'Vencido', ...TONE.orange },
  converted: { label: 'Faturado', ...TONE.navy },
}

export const INVOICE_STATUS = {
  draft:   { label: 'Rascunho', ...TONE.gray },
  sent:    { label: 'Enviada', ...TONE.blue },
  viewed:  { label: 'Vista', ...TONE.gold },
  partial: { label: 'Paga em parte', ...TONE.orange },
  paid:    { label: 'Paga', ...TONE.green },
  overdue: { label: 'Vencida', ...TONE.red },
  void:    { label: 'Anulada', ...TONE.muted },
}

export const REQUEST_STATUS = {
  new:       { label: 'Novo', ...TONE.blue },
  contacted: { label: 'Em contato', ...TONE.gold },
  quoted:    { label: 'Orçado', ...TONE.green },
  closed:    { label: 'Arquivado', ...TONE.muted },
  spam:      { label: 'Spam', ...TONE.red },
}

export function statusInfo(kind, status) {
  const map = kind === 'invoice' ? INVOICE_STATUS : kind === 'request' ? REQUEST_STATUS : QUOTE_STATUS
  return map[status] || { label: String(status || '—'), ...TONE.gray }
}

/** Selo de status do orçamento, da fatura ou do pedido (kind 'request'). */
export function DocStatusBadge({ kind, status, style }) {
  const st = statusInfo(kind, status)
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: st.bg }, style]}>
      <Text style={{ color: st.fg, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{st.label}</Text>
    </View>
  )
}

/** Chips de filtro da lista (valores aceitos por GET /api/agenda/documents?status=). */
export const QUOTE_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'open', label: 'Em aberto' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'accepted', label: 'Aprovados' },
  { value: 'declined', label: 'Recusados' },
  { value: 'expired', label: 'Vencidos' },
  { value: 'converted', label: 'Faturados' },
]
export const INVOICE_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Em aberto' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'partial', label: 'Pagas em parte' },
  { value: 'paid', label: 'Pagas' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'void', label: 'Anuladas' },
]
export const REQUEST_FILTERS = [
  { value: 'open', label: 'Em aberto' },
  { value: 'new', label: 'Novos' },
  { value: 'contacted', label: 'Em contato' },
  { value: 'quoted', label: 'Orçados' },
  { value: 'closed', label: 'Arquivados' },
  { value: 'spam', label: 'Spam' },
]

// Editor → detalhe: "salvar e enviar" abre a folha de envio quando o detalhe aparece
let pendingSend = null
export function setPendingSend(id) { pendingSend = id ? String(id) : null }
/** true (uma vez) se o editor pediu pra abrir o envio deste documento. */
export function takePendingSend(id) {
  if (!id || pendingSend !== String(id)) return false
  pendingSend = null
  return true
}

/** Nome do tipo na interface: 'Orçamento' | 'Fatura'. */
export const docKindLabel = (kind) => (kind === 'invoice' ? 'Fatura' : 'Orçamento')
export const OPEN_INVOICE = ['sent', 'viewed', 'partial', 'overdue']
export const OPEN_QUOTE = ['sent', 'viewed']

// ── Itens: tipo e unidade ──────────────────────────────────────────────────
const KIND_LABELS = {
  pt: { service: 'Serviço', labor: 'Mão de obra', material: 'Material', fee: 'Taxa', other: 'Outro' },
  en: { service: 'Service', labor: 'Labor', material: 'Material', fee: 'Fee', other: 'Other' },
  es: { service: 'Servicio', labor: 'Mano de obra', material: 'Material', fee: 'Cargo', other: 'Otro' },
}
export const KIND_OPTIONS = ITEM_KINDS.map((k) => ({ value: k, label: KIND_LABELS.pt[k] }))
export const kindLabel = (kind, lang = 'pt') => (KIND_LABELS[lang] || KIND_LABELS.pt)[kind] || KIND_LABELS.pt.other
/** Plural pros títulos de grupo da tabela de preços. */
export const KIND_GROUPS = { service: 'Serviços', labor: 'Mão de obra', material: 'Materiais', fee: 'Taxas', other: 'Outros' }

const UNIT_LABELS = {
  // Rótulo na tela do app (escolher unidade)
  app: { un: 'Unidade', hora: 'Hora', dia: 'Dia', semana: 'Semana', 'm²': 'm²', 'ft²': 'ft² (pé quadrado)', ft: 'ft (pé linear)', m: 'Metro', 'página': 'Página', palavra: 'Palavra', projeto: 'Projeto', visita: 'Visita', 'cômodo': 'Cômodo', lote: 'Lote' },
  // Abreviação no documento, no idioma da cliente
  en: { un: 'ea', hora: 'hr', dia: 'day', semana: 'wk', 'm²': 'm²', 'ft²': 'sq ft', ft: 'ft', m: 'm', 'página': 'page', palavra: 'word', projeto: 'project', visita: 'visit', 'cômodo': 'room', lote: 'lot' },
  pt: { un: 'un', hora: 'hora', dia: 'dia', semana: 'semana', 'm²': 'm²', 'ft²': 'ft²', ft: 'ft', m: 'm', 'página': 'página', palavra: 'palavra', projeto: 'projeto', visita: 'visita', 'cômodo': 'cômodo', lote: 'lote' },
  es: { un: 'ud', hora: 'hora', dia: 'día', semana: 'semana', 'm²': 'm²', 'ft²': 'pie²', ft: 'pie', m: 'm', 'página': 'página', palavra: 'palabra', projeto: 'proyecto', visita: 'visita', 'cômodo': 'habitación', lote: 'lote' },
}
export const UNIT_OPTIONS = UNITS.map((u) => ({ value: u, label: UNIT_LABELS.app[u] || u }))
/** lang 'app' = rótulo da tela; en/pt/es = abreviação do documento. */
export function unitLabel(unit, lang = 'app') {
  const t = UNIT_LABELS[lang] || UNIT_LABELS.app
  return t[unit] || String(unit || '')
}

// ── Formas de pagamento da fatura (mesma lista que record_payment aceita) ──
export const INVOICE_METHODS = [
  { value: 'zelle', label: 'Zelle', en: 'Zelle', es: 'Zelle', icon: 'flash-outline' },
  { value: 'cash', label: 'Dinheiro', en: 'Cash', es: 'Efectivo', icon: 'cash-outline' },
  { value: 'check', label: 'Cheque', en: 'Check', es: 'Cheque', icon: 'document-text-outline' },
  { value: 'card', label: 'Cartão', en: 'Card', es: 'Tarjeta', icon: 'card-outline' },
  { value: 'venmo', label: 'Venmo', en: 'Venmo', es: 'Venmo', icon: 'phone-portrait-outline' },
  { value: 'cashapp', label: 'Cash App', en: 'Cash App', es: 'Cash App', icon: 'phone-portrait-outline' },
  { value: 'ach', label: 'Transferência (ACH)', en: 'Bank transfer (ACH)', es: 'Transferencia (ACH)', icon: 'business-outline' },
  { value: 'other', label: 'Outro', en: 'Other', es: 'Otro', icon: 'ellipsis-horizontal' },
]
export function paymentMethodLabel(value, lang = 'pt') {
  if (value === 'stripe') return lang === 'en' ? 'Card (online)' : lang === 'es' ? 'Tarjeta (en línea)' : 'Cartão (online)'
  const m = INVOICE_METHODS.find((x) => x.value === value)
  if (!m) return value ? String(value) : (lang === 'en' ? 'Not specified' : lang === 'es' ? 'No indicado' : 'Não informado')
  return lang === 'en' ? m.en : lang === 'es' ? m.es : m.label
}

// ── Linha do tempo ─────────────────────────────────────────────────────────
const EVENTS = {
  created:   { q: 'Orçamento criado', i: 'Fatura criada', icon: 'add-circle-outline' },
  updated:   { q: 'Orçamento editado', i: 'Fatura editada', icon: 'create-outline' },
  sent:      { q: 'Enviado pra cliente', i: 'Enviada pra cliente', icon: 'paper-plane-outline' },
  viewed:    { q: 'A cliente abriu o link', i: 'A cliente abriu o link', icon: 'eye-outline' },
  accepted:  { q: 'Aprovado', i: 'Aprovada', icon: 'checkmark-circle-outline' },
  declined:  { q: 'Recusado', i: 'Recusada', icon: 'close-circle-outline' },
  payment:   { q: 'Pagamento registrado', i: 'Pagamento registrado', icon: 'cash-outline' },
  reminder:  { q: 'Lembrete enviado', i: 'Lembrete de pagamento enviado', icon: 'alarm-outline' },
  converted: { q: 'Virou fatura', i: 'Criada a partir do orçamento', icon: 'swap-horizontal-outline' },
  voided:    { q: 'Anulado', i: 'Anulada', icon: 'ban-outline' },
  expired:   { q: 'Validade venceu', i: 'Validade venceu', icon: 'hourglass-outline' },
  overdue:   { q: 'Venceu sem pagamento', i: 'Venceu sem pagamento', icon: 'alert-circle-outline' },
  overpaid:  { q: 'Pagamento a mais', i: 'Pagamento a mais no cartão: precisa reembolsar', icon: 'warning-outline' },
  refund:    { q: 'Reembolso', i: 'Pagamento reembolsado no cartão', icon: 'return-down-back-outline' },
}
const CHANNELS = { whatsapp: 'por WhatsApp', email: 'por e-mail', sms: 'por SMS', link: 'pelo link', app: 'pelo app', stripe: 'no cartão online', cron: 'automático' }

/** Evento da API → { title, sub, icon } em pt. */
export function eventInfo(ev = {}, kind = 'quote') {
  const e = EVENTS[ev.type] || { q: String(ev.type || 'Atualização'), i: String(ev.type || 'Atualização'), icon: 'ellipse-outline' }
  const d = ev.detail && typeof ev.detail === 'object' ? ev.detail : {}
  const parts = []
  if (ev.type === 'payment') {
    if (Number(d.amount_cents) > 0) parts.push(fmtMoney(d.amount_cents, { decimals: 2 }))
    if (ev.channel === 'stripe') parts.push(CHANNELS.stripe)
    else if (d.method) parts.push(paymentMethodLabel(d.method))
    if (d.removed) return { title: 'Pagamento apagado', sub: parts.join(' · '), icon: 'trash-outline' }
    if (d.fully_paid) parts.push('quitou a fatura')
  } else if (ev.channel && ev.channel !== 'app' && CHANNELS[ev.channel]) parts.push(CHANNELS[ev.channel])
  if (ev.type === 'accepted' && d.name) parts.push(`por ${String(d.name).slice(0, 80)}`)
  if (ev.type === 'declined' && d.reason) parts.push(String(d.reason).slice(0, 120))
  if (ev.type === 'converted' && Array.isArray(d.invoices) && d.invoices.length) parts.push(d.invoices.slice(0, 5).join(', '))
  if (ev.type === 'created' && d.from_quote) parts.push(`do orçamento ${String(d.from_quote).slice(0, 20)}`)
  if (ev.type === 'created' && d.duplicated_from) parts.push(`cópia de ${String(d.duplicated_from).slice(0, 20)}`)
  if ((ev.type === 'sent' || ev.type === 'reminder') && d.email_sent === false) parts.push('o e-mail não saiu')
  if (ev.type === 'updated' && d.reopened) parts.push('voltou a poder faturar')
  return { title: kind === 'invoice' ? e.i : e.q, sub: parts.join(' · '), icon: e.icon }
}

// ── Valores ────────────────────────────────────────────────────────────────
/** Totais do documento — sempre pela conta única (docCalc). */
export function totalsOf(doc = {}, items = []) {
  return computeTotals({
    items: (items || []).map((it) => ({ quantity: it.quantity, unit_price_cents: it.unit_price_cents, taxable: !!it.taxable })),
    discount_pct: doc.discount_pct,
    discount_cents: doc.discount_cents,
    tax_rate_bps: doc.tax_rate_bps,
    deposit_pct: doc.kind === 'invoice' ? null : doc.deposit_pct,
    deposit_cents: doc.kind === 'invoice' ? 0 : doc.deposit_cents,
    amount_paid_cents: doc.kind === 'invoice' ? doc.amount_paid_cents : 0,
  })
}

/** 625 → '6.25%' (en) / '6,25%' (pt, es). */
export function fmtRate(bps, lang = 'pt') {
  const n = Math.round(Number(bps) || 0) / 100
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')
  return (lang === 'en' ? s : s.replace('.', ',')) + '%'
}

/** Percentual com casas: 12.5 → '12.5%' / '12,5%'. */
export function fmtPct(v, lang = 'pt') {
  const n = cleanPct(v)
  if (n === null) return ''
  return (lang === 'en' ? String(n) : String(n).replace('.', ',')) + '%'
}

/** Quantidade: 1 → '1', 2.5 → '2.5' / '2,5'. */
export function fmtQty(q, lang = 'pt') {
  const n = cleanQty(q)
  if (n === null) return '0'
  return lang === 'en' ? String(n) : String(n).replace('.', ',')
}

/** Endereço numa linha a partir da ficha da cliente. */
export function addressOf(c) {
  if (!c) return ''
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [c.address_line, cityLine].filter(Boolean).join(', ')
}

// ── Rótulos do documento (idioma da cliente) ───────────────────────────────
const L = {
  en: {
    quote: 'Quote', invoice: 'Invoice', number: 'No.', issued: 'Date', valid_until: 'Valid until', due_date: 'Due date',
    bill_to: 'Bill to', prepared_for: 'Prepared for', job_address: 'Job address', project: 'Project', stage: 'Stage',
    license: 'License #', insurance: 'Insurance', phone: 'Phone', email: 'Email',
    description: 'Description', qty: 'Qty', unit: 'Unit', price: 'Price', amount: 'Amount',
    subtotal: 'Subtotal', discount: 'Discount', tax: 'Tax', total: 'Total', deposit: 'Deposit due on approval',
    amount_paid: 'Amount paid', balance_due: 'Balance due', payments: 'Payments received',
    notes: 'Notes', terms: 'Terms & conditions', payment_instructions: 'How to pay', photos: 'Photos',
    accepted_by: 'Accepted by', signature: 'Signature', signed_on: 'Signed on', decline_reason: 'Reason',
    signed_e: 'Signed electronically', code: 'code',
    view_quote: 'Review and approve online', view_invoice: 'View this invoice online',
    taxable_note: '* Taxable item', made_with: 'Made with', thanks: 'Thank you for your business!',
    stamp_paid: 'PAID', stamp_void: 'VOID', stamp_accepted: 'ACCEPTED', stamp_declined: 'DECLINED',
    stamp_expired: 'EXPIRED', stamp_overdue: 'OVERDUE', stamp_partial: 'PARTIALLY PAID',
  },
  pt: {
    quote: 'Orçamento', invoice: 'Fatura', number: 'Nº', issued: 'Data', valid_until: 'Válido até', due_date: 'Vencimento',
    bill_to: 'Cliente', prepared_for: 'Preparado para', job_address: 'Local do serviço', project: 'Projeto', stage: 'Etapa',
    license: 'Licença nº', insurance: 'Seguro', phone: 'Telefone', email: 'E-mail',
    description: 'Descrição', qty: 'Qtd.', unit: 'Unid.', price: 'Preço', amount: 'Valor',
    subtotal: 'Subtotal', discount: 'Desconto', tax: 'Imposto', total: 'Total', deposit: 'Entrada na aprovação',
    amount_paid: 'Valor pago', balance_due: 'Saldo a pagar', payments: 'Pagamentos recebidos',
    notes: 'Observações', terms: 'Condições', payment_instructions: 'Como pagar', photos: 'Fotos',
    accepted_by: 'Aprovado por', signature: 'Assinatura', signed_on: 'Assinado em', decline_reason: 'Motivo',
    signed_e: 'Assinado eletronicamente', code: 'código',
    view_quote: 'Veja e aprove online', view_invoice: 'Veja a fatura online',
    taxable_note: '* Item tributável', made_with: 'Feito com', thanks: 'Obrigado pela preferência!',
    stamp_paid: 'PAGA', stamp_void: 'ANULADA', stamp_accepted: 'APROVADO', stamp_declined: 'RECUSADO',
    stamp_expired: 'VENCIDO', stamp_overdue: 'VENCIDA', stamp_partial: 'PAGA EM PARTE',
  },
  es: {
    quote: 'Presupuesto', invoice: 'Factura', number: 'N.º', issued: 'Fecha', valid_until: 'Válido hasta', due_date: 'Vencimiento',
    bill_to: 'Facturar a', prepared_for: 'Preparado para', job_address: 'Dirección del trabajo', project: 'Proyecto', stage: 'Etapa',
    license: 'Licencia n.º', insurance: 'Seguro', phone: 'Teléfono', email: 'Correo',
    description: 'Descripción', qty: 'Cant.', unit: 'Unidad', price: 'Precio', amount: 'Importe',
    subtotal: 'Subtotal', discount: 'Descuento', tax: 'Impuesto', total: 'Total', deposit: 'Anticipo al aprobar',
    amount_paid: 'Pagado', balance_due: 'Saldo pendiente', payments: 'Pagos recibidos',
    notes: 'Notas', terms: 'Términos y condiciones', payment_instructions: 'Cómo pagar', photos: 'Fotos',
    accepted_by: 'Aprobado por', signature: 'Firma', signed_on: 'Firmado el', decline_reason: 'Motivo',
    signed_e: 'Firmado electrónicamente', code: 'código',
    view_quote: 'Revise y apruebe en línea', view_invoice: 'Vea la factura en línea',
    taxable_note: '* Artículo sujeto a impuesto', made_with: 'Hecho con', thanks: '¡Gracias por su preferencia!',
    stamp_paid: 'PAGADA', stamp_void: 'ANULADA', stamp_accepted: 'APROBADO', stamp_declined: 'RECHAZADO',
    stamp_expired: 'VENCIDO', stamp_overdue: 'VENCIDA', stamp_partial: 'PAGO PARCIAL',
  },
}

/** Rótulo do documento no idioma ('Balance due', 'Saldo a pagar'...). */
export const docLabel = (key, lang = 'en') => (L[docLang(lang)] || L.en)[key] || L.en[key] || key
/** 'Quote' / 'Orçamento' / 'Presupuesto' · 'Invoice' / 'Fatura' / 'Factura'. */
export const docTitle = (kind, lang = 'en') => docLabel(kind === 'invoice' ? 'invoice' : 'quote', lang)

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
}

/** 'YYYY-MM-DD' (ou ISO) → 'October 9, 2026' · '9 de outubro de 2026' · '9 de octubre de 2026'. */
export function fmtDocDate(v, lang = 'en') {
  const s = String(v || '')
  if (!s) return ''
  // Coluna date: data pura. Timestamp (accepted_at): data no relógio do aparelho.
  let y, m, d
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) [y, m, d] = s.split('-').map(Number)
  else {
    const dt = new Date(s)
    if (Number.isNaN(dt.getTime())) return ''
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate()
  }
  const l = docLang(lang)
  const mon = MONTHS[l][m - 1]
  if (!mon) return ''
  if (l === 'en') return `${mon.slice(0, 3)} ${d}, ${y}`
  return `${d} de ${mon} de ${y}`
}

/**
 * Dia do pagamento no documento. paid_at é instante real (pagamento de hoje e Stripe
 * gravam a hora): vai inteiro pro fmtDocDate, que usa o dia no relógio do aparelho
 * (cortar em 10 caracteres dava o dia UTC, o seguinte à noite nos EUA). paid_on
 * ('YYYY-MM-DD', dia no fuso dela), quando a API mandar, vale primeiro.
 */
function paymentDay(p = {}, lang = 'en') {
  const on = String(p.paid_on || '')
  return fmtDocDate(/^\d{4}-\d{2}-\d{2}$/.test(on) ? on : p.paid_at, lang)
}

// ── Fatura do atendimento ──────────────────────────────────────────────────
/**
 * Quanto do atendimento já entrou: o pagamento registrado (paid_cents já inclui o
 * sinal) ou, sem ele, o sinal recebido. → { cents, kind: 'paid' | 'deposit' | null }
 */
export function appointmentReceived(a = {}) {
  const deposit = a?.deposit_paid ? Math.max(0, Number(a.deposit_cents) || 0) : 0
  if (a?.paid_at) return { cents: Math.max(Math.max(0, Number(a.paid_cents) || 0), deposit), kind: 'paid' }
  return { cents: deposit, kind: deposit ? 'deposit' : null }
}

const PAID_SO_FAR = {
  en: { total: 'Service total', deposit: 'less deposit received', paid: 'less amount already paid' },
  pt: { total: 'Total do serviço', deposit: 'menos o sinal recebido', paid: 'menos o valor já pago' },
  es: { total: 'Total del servicio', deposit: 'menos el anticipo recibido', paid: 'menos el monto ya pagado' },
}
/** Linha do item (idioma da cliente): 'Service total $480.00, less deposit received $100.00'. */
export function paidSoFarLine(lang, totalCents, paidCents, kind = 'paid') {
  const T = PAID_SO_FAR[docLang(lang)]
  const m = (c) => fmtMoney(c, { decimals: 2 })
  return `${T.total} ${m(totalCents)}, ${kind === 'deposit' ? T.deposit : T.paid} ${m(paidCents)}`
}

// ── Cabeçalho da empresa ───────────────────────────────────────────────────
/**
 * Nome e linhas do cabeçalho (dados da empresa > perfil).
 * → { name, logo, lines: [string] } — lines no idioma do documento.
 */
export function businessHeader(provider = {}, business = {}, lang = 'en') {
  const p = provider || {}
  const b = business || {}
  const cityLine = [b.city, [b.state, b.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const address = [b.address_line, cityLine].filter(Boolean).join(', ')
  const phone = b.phone || p.whatsapp || ''
  const lines = []
  if (b.license_no) lines.push(`${docLabel('license', lang)} ${b.license_no}`)
  if (address) lines.push(address)
  const contact = [phone ? fmtPhone(phone) : '', b.email || p.email || ''].filter(Boolean).join(' · ')
  if (contact) lines.push(contact)
  if (b.website) lines.push(String(b.website).replace(/^https?:\/\//i, '').replace(/\/$/, ''))
  if (b.insurance) lines.push(`${docLabel('insurance', lang)}: ${b.insurance}`)
  const logo = /^https?:\/\//i.test(p.avatar_url || '') ? p.avatar_url : null
  return { name: b.legal_name || p.name || '', logo, lines }
}

// ── PDF ────────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
const escLines = (v) => esc(v).replace(/\r?\n/g, '<br>')
const SIGNATURE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/
const httpUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || ''))

function stampOf(doc) {
  const s = doc?.status
  if (doc?.kind === 'invoice') {
    if (s === 'paid') return ['stamp_paid', '#027A48']
    if (s === 'void') return ['stamp_void', '#8B8E89']
    if (s === 'overdue') return ['stamp_overdue', '#B42318']
    if (s === 'partial') return ['stamp_partial', '#B54708']
    return null
  }
  if (s === 'accepted' || s === 'converted') return ['stamp_accepted', '#027A48']
  if (s === 'declined') return ['stamp_declined', '#B42318']
  if (s === 'expired') return ['stamp_expired', '#B54708']
  return null
}

/**
 * HTML (carta americana) do orçamento ou da fatura pro expo-print.
 * opts: { branding: rodapé "Feito com WorkPro", brandName, payments: [Payment], color }
 */
export function buildDocumentHtml(doc = {}, items = [], provider = {}, business = {}, opts = {}) {
  const lang = docLang(doc.language)
  const t = (k) => docLabel(k, lang)
  const isInvoice = doc.kind === 'invoice'
  const tot = totalsOf(doc, items)
  const money = (c) => fmtMoney(c, { decimals: 2 })
  const head = businessHeader(provider, business, lang)
  const color = /^#[0-9a-f]{6}$/i.test(opts.color || '') ? opts.color
    : /^#[0-9a-f]{6}$/i.test(provider?.cover_color || '') ? provider.cover_color : '#1B2845'
  const stamp = stampOf(doc)
  const anyTaxable = Number(doc.tax_rate_bps) > 0 && (items || []).some((it) => it.taxable)
  const dPct = cleanPct(doc.discount_pct)

  const meta = [
    [t('number'), doc.number || '—'],
    [t('issued'), fmtDocDate(doc.issue_date, lang)],
    isInvoice ? [t('due_date'), fmtDocDate(doc.due_date, lang)] : [t('valid_until'), fmtDocDate(doc.valid_until, lang)],
    doc.stage_label ? [t('stage'), doc.stage_label] : null,
  ].filter((r) => r && r[1])

  const rows = tot.lines.map((it, i) => {
    const src = items[i] || {}                     // linha da conta só tem valores; o texto vem do item
    const desc = String(src.description || '').trim()
    const [first, ...rest] = desc.split(/\r?\n/)
    return `<tr>
      <td class="desc"><div class="d1">${esc(first || '—')}</div>${rest.length ? `<div class="d2">${escLines(rest.join('\n'))}</div>` : ''}</td>
      <td class="c">${esc(fmtQty(src.quantity, lang))}</td>
      <td class="c">${esc(unitLabel(src.unit, lang))}</td>
      <td class="r">${esc(money(src.unit_price_cents))}</td>
      <td class="r">${esc(money(it.line_total_cents))}${anyTaxable && src.taxable ? '<span class="tx">*</span>' : ''}</td>
    </tr>`
  }).join('')

  const totals = []
  totals.push([t('subtotal'), money(tot.subtotal_cents)])
  if (tot.discount_cents > 0) totals.push([`${t('discount')}${dPct ? ` (${fmtPct(dPct, lang)})` : ''}`, `−${money(tot.discount_cents)}`])
  if (Number(doc.tax_rate_bps) > 0) totals.push([`${t('tax')} (${fmtRate(doc.tax_rate_bps, lang)})`, money(tot.tax_cents)])
  const totalRow = [t('total'), money(tot.total_cents)]
  const after = []
  if (isInvoice) {
    if (Number(doc.amount_paid_cents) > 0) after.push([t('amount_paid'), `−${money(doc.amount_paid_cents)}`])
    after.push([t('balance_due'), money(tot.balance_cents), 'due'])
  } else if (tot.deposit_cents > 0) {
    const depPct = cleanPct(doc.deposit_pct)
    after.push([`${t('deposit')}${depPct ? ` (${fmtPct(depPct, lang)})` : ''}`, money(tot.deposit_cents), 'dep'])
  }

  const payments = isInvoice && Array.isArray(opts.payments) ? opts.payments.filter((p) => Number(p.amount_cents) > 0) : []
  const photos = (Array.isArray(doc.photos) ? doc.photos : []).filter(httpUrl).slice(0, 10)
  const signature = SIGNATURE_RE.test(String(doc.accepted_signature || '')) ? doc.accepted_signature : null
  const accepted = !isInvoice && (doc.accepted_at || doc.accepted_name)
  const signedCode = /^[0-9a-f]{8,}$/i.test(String(doc.signed_hash || '')) ? String(doc.signed_hash).slice(0, 8) : ''
  const billTo = [doc.client_address, doc.client_phone ? fmtPhone(doc.client_phone) : '', doc.client_email].filter(Boolean)
  const brand = String(opts.brandName || 'WorkPro')

  const block = (title, body) => (body ? `<div class="block"><div class="k">${esc(title)}</div><div class="txt">${escLines(body)}</div></div>` : '')

  return `<!DOCTYPE html>
<html lang="${lang === 'pt' ? 'pt-BR' : lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle(doc.kind, lang))} ${esc(doc.number || '')}</title>
<style>
  @page { size: letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1A1F1C; margin: 0; font-size: 12.5px; line-height: 1.45; }
  .wrap { max-width: 720px; margin: 0 auto; }
  .bar { height: 6px; background: ${color}; border-radius: 3px; margin-bottom: 20px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .biz { display: flex; gap: 14px; align-items: flex-start; flex: 1; min-width: 0; }
  .logo { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; }
  .bizname { font-size: 20px; font-weight: 700; letter-spacing: -0.2px; }
  .muted { color: #6B6F6C; }
  .line { color: #4B4F4D; font-size: 11.5px; }
  .title { text-align: right; min-width: 200px; }
  .title h1 { margin: 0 0 6px; font-size: 24px; color: ${color}; letter-spacing: 1px; text-transform: uppercase; }
  .meta { border-collapse: collapse; margin-left: auto; }
  .meta td { padding: 1px 0 1px 12px; font-size: 12px; border: 0; }
  .meta td.mk { color: #6B6F6C; text-align: right; }
  .meta td.mv { font-weight: 600; text-align: right; white-space: nowrap; }
  .stamp { display: inline-block; margin-top: 8px; padding: 3px 10px; border: 2px solid; border-radius: 6px; font-weight: 700; font-size: 12px; letter-spacing: 1px; }
  .parties { display: flex; gap: 16px; margin-top: 22px; }
  .party { flex: 1; background: #FAF7F0; border-radius: 10px; padding: 12px 14px; }
  .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: #6B6F6C; font-weight: 700; margin-bottom: 4px; }
  .pname { font-size: 14px; font-weight: 700; }
  .project { margin-top: 18px; font-size: 15px; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #FFFFFF; background: ${color}; padding: 7px 8px; }
  table.items th.c, table.items td.c { text-align: center; }
  table.items th.r, table.items td.r { text-align: right; white-space: nowrap; }
  table.items td { padding: 8px; border-bottom: 1px solid #E5E1D6; vertical-align: top; }
  .d1 { font-weight: 600; }
  .d2 { color: #6B6F6C; font-size: 11.5px; margin-top: 2px; }
  .tx { color: #6B6F6C; margin-left: 2px; }
  .sum { display: flex; justify-content: space-between; gap: 24px; margin-top: 12px; align-items: flex-start; }
  .sumleft { flex: 1; font-size: 11px; color: #6B6F6C; padding-top: 6px; }
  table.tot { border-collapse: collapse; min-width: 270px; }
  table.tot td { padding: 5px 0 5px 12px; font-size: 12.5px; }
  table.tot td.v { text-align: right; white-space: nowrap; font-weight: 600; }
  table.tot tr.total td { font-size: 16px; font-weight: 700; border-top: 2px solid #1A1F1C; padding-top: 9px; }
  table.tot tr.due td { font-size: 15px; font-weight: 700; color: ${color}; background: #F5F1E5; padding: 8px 10px; }
  table.tot tr.dep td { font-weight: 700; color: ${color}; }
  .block { margin-top: 18px; page-break-inside: avoid; }
  .txt { white-space: normal; color: #2D312F; }
  .pay { margin-top: 18px; padding: 12px 14px; border: 1px solid #E5E1D6; border-radius: 10px; page-break-inside: avoid; }
  .online { margin-top: 14px; font-size: 12px; }
  .online a { color: ${color}; font-weight: 600; word-break: break-all; }
  .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .photos img { width: 160px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid #E5E1D6; }
  .sign { margin-top: 22px; display: flex; gap: 24px; align-items: flex-end; page-break-inside: avoid; }
  .sign img { max-width: 260px; max-height: 90px; border-bottom: 1px solid #1A1F1C; }
  .foot { margin-top: 28px; text-align: center; }
  .thanks { font-size: 14px; font-weight: 600; color: ${color}; }
  .small { font-size: 10px; color: #8B8E89; margin-top: 8px; }
  table.pays { width: 100%; border-collapse: collapse; }
  table.pays td { padding: 3px 0; font-size: 11.5px; border-bottom: 1px solid #F1ECDF; }
  table.pays td.r { text-align: right; }
</style></head>
<body><div class="wrap">
  <div class="bar"></div>
  <div class="head">
    <div class="biz">
      ${head.logo ? `<img class="logo" src="${esc(head.logo)}">` : ''}
      <div>
        <div class="bizname">${esc(head.name || '—')}</div>
        ${head.lines.map((l) => `<div class="line">${esc(l)}</div>`).join('')}
      </div>
    </div>
    <div class="title">
      <h1>${esc(docTitle(doc.kind, lang))}</h1>
      <table class="meta">${meta.map(([k, v]) => `<tr><td class="mk">${esc(k)}</td><td class="mv">${esc(v)}</td></tr>`).join('')}</table>
      ${stamp ? `<div class="stamp" style="color:${stamp[1]};border-color:${stamp[1]}">${esc(t(stamp[0]))}</div>` : ''}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="k">${esc(isInvoice ? t('bill_to') : t('prepared_for'))}</div>
      <div class="pname">${esc(doc.client_name || '—')}</div>
      ${billTo.map((l) => `<div class="line">${esc(l)}</div>`).join('')}
    </div>
    ${doc.job_address ? `<div class="party"><div class="k">${esc(t('job_address'))}</div><div class="line" style="font-size:12.5px">${escLines(doc.job_address)}</div></div>` : ''}
  </div>

  ${doc.title ? `<div class="project">${esc(doc.title)}</div>` : ''}

  <table class="items">
    <thead><tr>
      <th>${esc(t('description'))}</th><th class="c">${esc(t('qty'))}</th><th class="c">${esc(t('unit'))}</th>
      <th class="r">${esc(t('price'))}</th><th class="r">${esc(t('amount'))}</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="muted">—</td></tr>`}</tbody>
  </table>

  <div class="sum">
    <div class="sumleft">${anyTaxable ? esc(t('taxable_note')) : ''}</div>
    <table class="tot">
      ${totals.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}
      <tr class="total"><td>${esc(totalRow[0])}</td><td class="v">${esc(totalRow[1])}</td></tr>
      ${after.map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}
    </table>
  </div>

  ${payments.length ? `<div class="block"><div class="k">${esc(t('payments'))}</div><table class="pays">${payments.map((p) => `<tr><td>${esc(paymentDay(p, lang))}</td><td>${esc(paymentMethodLabel(p.method, lang))}</td><td class="r">${esc(money(p.amount_cents))}</td></tr>`).join('')}</table></div>` : ''}

  ${doc.payment_instructions && !(isInvoice && doc.status === 'paid') && doc.status !== 'void'
    ? `<div class="pay"><div class="k">${esc(t('payment_instructions'))}</div><div class="txt">${escLines(doc.payment_instructions)}</div></div>` : ''}

  ${httpUrl(doc.public_url) && doc.status !== 'draft' && doc.status !== 'void' && !(isInvoice && doc.status === 'paid')
    ? `<div class="online">${esc(isInvoice ? t('view_invoice') : t('view_quote'))}: <a href="${esc(doc.public_url)}">${esc(doc.public_url)}</a></div>` : ''}

  ${block(t('notes'), doc.notes)}
  ${block(t('terms'), doc.terms)}

  ${photos.length ? `<div class="block"><div class="k">${esc(t('photos'))}</div><div class="photos">${photos.map((u) => `<img src="${esc(u)}">`).join('')}</div></div>` : ''}

  ${accepted ? `<div class="sign">
    ${signature ? `<div><img src="${signature}"><div class="k" style="margin-top:4px">${esc(t('signature'))}</div></div>` : ''}
    <div>
      ${doc.accepted_name ? `<div><span class="muted">${esc(t('accepted_by'))}:</span> <b>${esc(doc.accepted_name)}</b></div>` : ''}
      ${doc.accepted_at ? `<div><span class="muted">${esc(t('signed_on'))}:</span> ${esc(fmtDocDate(doc.accepted_at, lang))}</div>` : ''}
      ${signedCode ? `<div class="muted">${esc(t('signed_e'))} · ${esc(t('code'))} ${esc(signedCode)}</div>` : ''}
    </div>
  </div>` : ''}

  <div class="foot">
    <div class="thanks">${esc(t('thanks'))}</div>
    ${opts.branding ? `<div class="small">${esc(t('made_with'))} ${esc(brand)} · BrasilConnect</div>` : ''}
  </div>
</div></body></html>`
}

/** No navegador: abre numa aba e chama a impressão (dá pra salvar em PDF). */
export function printHtmlOnWeb(html) {
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null
  if (!w) {
    notify('Janela bloqueada', 'Libere pop-ups deste site pra gerar o PDF.')
    return false
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch (_) {} }, 400)
  return true
}

const fileSafe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'documento'

/**
 * PDF pra compartilhar (celular) ou imprimir (web). Erro de geração sobe pra quem
 * chamou (showError). → true quando abriu a folha / a impressão.
 */
export async function sharePdf(doc, items, provider, business, opts = {}) {
  const html = buildDocumentHtml(doc, items, provider, business, opts)
  if (Platform.OS === 'web') return printHtmlOnWeb(html)
  const { uri } = await Print.printToFileAsync({ html })
  // Nome legível no compartilhar ("Invoice-INV-0042.pdf")
  let shareUri = uri
  try {
    const dest = new FsFile(Paths.cache, `${fileSafe(docTitle(doc.kind, doc.language))}-${fileSafe(doc.number)}.pdf`)
    if (dest.exists) dest.delete()
    new FsFile(uri).move(dest)
    shareUri = dest.uri
  } catch (_) {}
  if (!(await Sharing.isAvailableAsync())) {
    notify('PDF pronto', 'Este aparelho não permite compartilhar arquivos daqui.')
    return false
  }
  await Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${docKindLabel(doc.kind)} ${doc.number || ''}`.trim() })
  return true
}

/**
 * Manda a mensagem com o link: WhatsApp da cliente (via 'whatsapp', ou 'auto' com
 * telefone) ou a folha de compartilhar do celular. Sem folha (web): copia o texto.
 */
export async function shareDocLink(doc, message, { via = 'auto' } = {}) {
  const text = String(message || doc?.public_url || '').trim()
  const phone = doc?.client_phone || ''
  if (via === 'whatsapp' || (via === 'auto' && phone)) {
    const ok = await openWhatsApp(phone, text)
    if (!ok) notify('WhatsApp não abriu', 'Confira se o WhatsApp está instalado neste celular.')
    return ok
  }
  try {
    if (Platform.OS === 'web' && !(typeof navigator !== 'undefined' && navigator.share)) throw new Error('sem folha')
    await Share.share({ message: text })
    return true
  } catch (_) {
    await Clipboard.setStringAsync(text).catch(() => {})
    notify('Mensagem copiada', 'Cole onde preferir pra mandar pra cliente.')
    return true
  }
}
