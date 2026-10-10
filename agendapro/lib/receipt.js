// ════════════════════════════════════════════════════════════════════════════
//   Recibo da cliente (PDF e texto pro WhatsApp) e rótulos de dinheiro usados
//   pelas telas de finanças (formas de pagamento, categorias de despesa, mês).
//
//   const html = buildReceiptHtml(appointment, provider, 'pt' | 'en' | 'both', { branding, pageUrl })
//   const text = buildReceiptText(appointment, provider, 'pt' | 'en' | 'both')
//   receiptNumber(appointment)   → '20261014-3F9A'
//   receiptAmounts(appointment)  → { service, paid, tip, total, deposit, balance, paidInFull }
//
//   Sem imports de react-native: dá pra testar com node. Regra de horário:
//   scheduled_for é hora de parede → só getters UTC (ver format.js).
// ════════════════════════════════════════════════════════════════════════════
import { fmtMoney } from './format'

// ── Formas de pagamento ────────────────────────────────────────────────────
export const PAYMENT_METHODS = [
  { value: 'cash', pt: 'Dinheiro', en: 'Cash', icon: 'cash-outline' },
  { value: 'zelle', pt: 'Zelle', en: 'Zelle', icon: 'flash-outline' },
  { value: 'card', pt: 'Cartão', en: 'Card', icon: 'card-outline' },
  { value: 'venmo', pt: 'Venmo', en: 'Venmo', icon: 'phone-portrait-outline' },
  { value: 'cashapp', pt: 'Cash App', en: 'Cash App', icon: 'phone-portrait-outline' },
  { value: 'paypal', pt: 'PayPal', en: 'PayPal', icon: 'logo-paypal' },
  { value: 'check', pt: 'Cheque', en: 'Check', icon: 'document-text-outline' },
  { value: 'debit', pt: 'Débito', en: 'Debit', icon: 'card-outline' },
  { value: 'stripe', pt: 'Cartão (online)', en: 'Card (online)', icon: 'globe-outline' },
  { value: 'other', pt: 'Outro', en: 'Other', icon: 'ellipsis-horizontal' },
  { value: 'free', pt: 'Cortesia', en: 'Complimentary', icon: 'gift-outline' },
]

/** Formas que a profissional escolhe numa despesa (as mesmas que a API aceita). */
export const EXPENSE_METHODS = ['card', 'cash', 'zelle', 'venmo', 'cashapp', 'paypal', 'check', 'debit', 'other']

export function methodLabel(value, lang = 'pt') {
  const l = lang === 'en' ? 'en' : 'pt'
  const m = PAYMENT_METHODS.find((x) => x.value === value)
  if (m) return m[l]
  if (!value || value === 'unknown') return l === 'en' ? 'Not specified' : 'Não informado'
  return String(value)
}

// ── Categorias de despesa (mesma lista do CHECK em ag_app_finance.sql) ──────
export const EXPENSE_CATEGORIES = [
  { value: 'produtos', label: 'Produtos', icon: 'basket-outline', hint: 'Esmalte, tinta, material de limpeza' },
  { value: 'gasolina', label: 'Gasolina', icon: 'car-outline', hint: 'Combustível do carro de trabalho' },
  { value: 'aluguel', label: 'Aluguel', icon: 'home-outline', hint: 'Cadeira, sala, suíte' },
  { value: 'equipamento', label: 'Equipamento', icon: 'construct-outline', hint: 'Secador, aspirador, maca' },
  { value: 'marketing', label: 'Marketing', icon: 'megaphone-outline', hint: 'Anúncio, cartão de visita, Instagram' },
  { value: 'taxas', label: 'Taxas e tarifas', icon: 'receipt-outline', hint: 'Taxa do cartão, licença, banco' },
  { value: 'celular', label: 'Celular e internet', icon: 'call-outline', hint: 'Plano do celular, internet' },
  { value: 'seguro', label: 'Seguro', icon: 'shield-checkmark-outline', hint: 'Seguro de responsabilidade, carro' },
  { value: 'alimentacao', label: 'Alimentação', icon: 'restaurant-outline', hint: 'Refeição a trabalho' },
  { value: 'outros', label: 'Outros', icon: 'ellipsis-horizontal-circle-outline', hint: '' },
]

export function categoryInfo(value) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
}

// ── Mês ('YYYY-MM') ────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')

export function shiftMonth(month, n) {
  const [y, m] = String(month).split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

export function lastDayOfMonth(month) {
  const [y, m] = String(month).split('-').map(Number)
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}

/** Variação percentual arredondada (null quando não dá pra comparar). */
export function pctChange(now, before) {
  const a = Number(now) || 0, b = Number(before) || 0
  if (!b) return null
  return Math.round(((a - b) / b) * 100)
}

/**
 * Próximo vencimento do imposto estimado trimestral (IRS 1040-ES) a partir de
 * uma data 'YYYY-MM-DD'. → { due: 'YYYY-MM-DD', months: 'set–dez' }
 */
export function nextEstimatedTaxDue(todayKey) {
  const y = Number(String(todayKey).slice(0, 4))
  const list = [
    { due: `${y}-01-15`, months: 'set–dez' },
    { due: `${y}-04-15`, months: 'jan–mar' },
    { due: `${y}-06-15`, months: 'abr–mai' },
    { due: `${y}-09-15`, months: 'jun–ago' },
    { due: `${y + 1}-01-15`, months: 'set–dez' },
  ]
  return list.find((d) => d.due >= todayKey) || list[list.length - 1]
}

// ── Recibo ─────────────────────────────────────────────────────────────────
const MONTHS = {
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
const WEEKDAYS = {
  pt: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

const L = {
  pt: {
    receipt: 'Recibo', number: 'Nº', issued: 'Emitido em', client: 'Cliente', service: 'Serviço',
    date: 'Data', amount: 'Valor', servicePrice: 'Valor do serviço', charged: 'Valor cobrado',
    deposit: 'Sinal pago antecipadamente (incluso)', tip: 'Gorjeta', totalPaid: 'Total pago',
    balance: 'Saldo a pagar', method: 'Forma de pagamento', paid: 'PAGO', pending: 'PENDENTE',
    thanks: 'Obrigada pela preferência!', madeWith: 'Recibo gerado pelo AgendaPro · BrasilConnect',
    page: 'Agende de novo', noShow: 'Falta (sinal retido)', canceled: 'Cancelado',
  },
  en: {
    receipt: 'Receipt', number: 'No.', issued: 'Issued on', client: 'Client', service: 'Service',
    date: 'Date', amount: 'Amount', servicePrice: 'Service price', charged: 'Amount charged',
    deposit: 'Deposit paid in advance (included)', tip: 'Tip', totalPaid: 'Total paid',
    balance: 'Balance due', method: 'Payment method', paid: 'PAID', pending: 'PENDING',
    thanks: 'Thank you for your business!', madeWith: 'Receipt generated by AgendaPro · BrasilConnect',
    page: 'Book again', noShow: 'No-show (deposit kept)', canceled: 'Canceled',
  },
}

/** Rótulo no idioma; 'both' junta os dois ("Recibo / Receipt"). */
function lbl(key, lang) {
  if (lang === 'both') return L.pt[key] === L.en[key] ? L.pt[key] : `${L.pt[key]} / ${L.en[key]}`
  return (L[lang] || L.pt)[key]
}

export function receiptNumber(a) {
  const day = String(a?.scheduled_for || '').slice(0, 10).replace(/-/g, '')
  const id = String(a?.id || '').replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase()
  return [day, id].filter(Boolean).join('-') || '—'
}

/** Data/hora de parede por extenso. lang 'both' usa o português. */
export function fmtReceiptWhen(iso, lang = 'pt') {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const l = lang === 'en' ? 'en' : 'pt'
  const day = d.getUTCDate(), mon = d.getUTCMonth(), year = d.getUTCFullYear(), wd = d.getUTCDay()
  const h = d.getUTCHours(), m = d.getUTCMinutes()
  if (l === 'en') {
    const h12 = h % 12 || 12
    return `${WEEKDAYS.en[wd]}, ${MONTHS.en[mon]} ${day}, ${year} · ${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
  }
  return `${WEEKDAYS.pt[wd]}, ${day} de ${MONTHS.pt[mon]} de ${year} · ${pad(h)}:${pad(m)}`
}

/** Data real (paid_at, agora) → data curta no idioma. */
function fmtIssued(date, lang) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  if (lang === 'en') return `${MONTHS.en[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  return `${d.getDate()} de ${MONTHS.pt[d.getMonth()]} de ${d.getFullYear()}`
}

/**
 * Valores do recibo. Valor cobrado = paid_cents quando marcado no app; sem isso,
 * o total do serviço (realizado) ou só o sinal (pago antes).
 */
export function receiptAmounts(a = {}) {
  const service = Math.max(0, Number(a.total_cents) || 0)
  const deposit = a.deposit_paid ? Math.max(0, Number(a.deposit_cents) || 0) : 0
  let paid
  if (a.paid_cents != null) paid = Math.max(0, Number(a.paid_cents) || 0)
  else if (a.status === 'completed') paid = service
  else paid = deposit
  const tip = Math.max(0, Number(a.tip_cents) || 0)
  const settled = a.status === 'completed' || a.paid_cents != null || !!a.paid_at
  const balance = a.status === 'completed' || a.status === 'no_show' || a.status === 'canceled' ? 0 : Math.max(0, service - paid)
  return { service, paid, tip, total: paid + tip, deposit, balance, paidInFull: settled && balance === 0 }
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function serviceName(a) {
  return a?.service_name || a?.service_label || (a?.feed_label ? `Limpeza · ${a.feed_label}` : '') || '—'
}

function providerLines(p = {}) {
  const place = [p.city, p.state].filter(Boolean).join(', ')
  return {
    name: p.name || 'AgendaPro',
    sub: [p.specialty, place].filter(Boolean).join(' · '),
    contact: [p.whatsapp ? fmtPhoneLite(p.whatsapp) : '', p.email || ''].filter(Boolean).join(' · '),
  }
}

// Telefone sem depender do format.js inteiro no HTML (mesma regra: EUA por padrão)
function fmtPhoneLite(v) {
  let d = String(v || '').replace(/\D/g, '')
  if (d.length === 10) d = '1' + d
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return d ? '+' + d : ''
}

/**
 * HTML do recibo (carta americana) pro expo-print gerar o PDF.
 * opts: { branding: true mostra "gerado pelo AgendaPro", pageUrl: link pra agendar de novo,
 *         clientName: nome da ficha (sobrepõe o do agendamento), issuedAt: Date }
 */
export function buildReceiptHtml(a, provider, lang = 'pt', opts = {}) {
  const lg = ['pt', 'en', 'both'].includes(lang) ? lang : 'pt'
  const v = receiptAmounts(a)
  const p = providerLines(provider)
  const num = receiptNumber(a)
  const color = /^#[0-9a-f]{6}$/i.test(provider?.cover_color || '') ? provider.cover_color : '#1F4D3F'
  const whenPt = fmtReceiptWhen(a?.scheduled_for, 'pt')
  const whenEn = fmtReceiptWhen(a?.scheduled_for, 'en')
  const when = lg === 'en' ? whenEn : lg === 'both' ? `${whenPt}<br><span class="muted">${esc(whenEn)}</span>` : whenPt
  const issued = opts.issuedAt || new Date()
  const issuedTxt = lg === 'both' ? `${fmtIssued(issued, 'pt')} / ${fmtIssued(issued, 'en')}` : fmtIssued(issued, lg)
  const method = lg === 'both'
    ? (methodLabel(a?.paid_method || a?.payment_method, 'pt') === methodLabel(a?.paid_method || a?.payment_method, 'en')
      ? methodLabel(a?.paid_method || a?.payment_method, 'pt')
      : `${methodLabel(a?.paid_method || a?.payment_method, 'pt')} / ${methodLabel(a?.paid_method || a?.payment_method, 'en')}`)
    : methodLabel(a?.paid_method || a?.payment_method, lg)
  const client = opts.clientName || a?.client_name || '—'
  const stamp = a?.status === 'canceled' ? lbl('canceled', lg) : v.paidInFull ? lbl('paid', lg) : lbl('pending', lg)
  const stampColor = v.paidInFull && a?.status !== 'canceled' ? '#027A48' : '#B54708'

  const lines = []
  lines.push(`<tr><td>${esc(lbl('servicePrice', lg))}</td><td class="r">${esc(fmtMoney(v.service, { decimals: 2 }))}</td></tr>`)
  if (a?.status === 'no_show') lines.push(`<tr><td colspan="2" class="muted">${esc(lbl('noShow', lg))}</td></tr>`)
  if (v.paid !== v.service) lines.push(`<tr><td>${esc(lbl('charged', lg))}</td><td class="r">${esc(fmtMoney(v.paid, { decimals: 2 }))}</td></tr>`)
  if (v.deposit > 0) lines.push(`<tr><td class="muted">${esc(lbl('deposit', lg))}</td><td class="r muted">${esc(fmtMoney(v.deposit, { decimals: 2 }))}</td></tr>`)
  if (v.tip > 0) lines.push(`<tr><td>${esc(lbl('tip', lg))}</td><td class="r">${esc(fmtMoney(v.tip, { decimals: 2 }))}</td></tr>`)
  lines.push(`<tr class="total"><td>${esc(lbl('totalPaid', lg))}</td><td class="r">${esc(fmtMoney(v.total, { decimals: 2 }))}</td></tr>`)
  if (v.balance > 0) lines.push(`<tr><td>${esc(lbl('balance', lg))}</td><td class="r">${esc(fmtMoney(v.balance, { decimals: 2 }))}</td></tr>`)

  const htmlLang = lg === 'en' ? 'en' : 'pt-BR'
  return `<!DOCTYPE html>
<html lang="${htmlLang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(lbl('receipt', lg))} ${esc(num)}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1A1F1C; margin: 0; font-size: 13px; line-height: 1.45; }
  .wrap { max-width: 620px; margin: 0 auto; padding: 8px 4px; }
  .bar { height: 6px; background: ${color}; border-radius: 3px; margin-bottom: 22px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .biz { font-size: 22px; font-weight: 700; letter-spacing: -0.2px; }
  .muted { color: #6B6F6C; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 20px; color: ${color}; letter-spacing: 0.5px; text-transform: uppercase; }
  .stamp { display: inline-block; margin-top: 8px; padding: 3px 10px; border: 2px solid ${stampColor}; color: ${stampColor}; border-radius: 6px; font-weight: 700; font-size: 12px; letter-spacing: 1px; }
  .box { margin-top: 26px; padding: 14px 16px; background: #FAF7F0; border-radius: 10px; }
  .grid { display: flex; gap: 24px; flex-wrap: wrap; }
  .grid > div { flex: 1; min-width: 180px; }
  .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #6B6F6C; font-weight: 600; }
  .v { font-size: 14px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  td { padding: 9px 0; border-bottom: 1px solid #E5E1D6; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; padding-left: 12px; }
  tr.total td { font-size: 16px; font-weight: 700; border-bottom: 2px solid #1A1F1C; padding-top: 12px; }
  .foot { margin-top: 30px; text-align: center; }
  .thanks { font-size: 15px; font-weight: 600; color: ${color}; }
  .small { font-size: 10.5px; color: #8B8E89; margin-top: 10px; }
</style></head>
<body><div class="wrap">
  <div class="bar"></div>
  <div class="head">
    <div>
      <div class="biz">${esc(p.name)}</div>
      ${p.sub ? `<div class="muted">${esc(p.sub)}</div>` : ''}
      ${p.contact ? `<div class="muted">${esc(p.contact)}</div>` : ''}
    </div>
    <div class="title">
      <h1>${esc(lbl('receipt', lg))}</h1>
      <div class="muted">${esc(lbl('number', lg))} ${esc(num)}</div>
      <div class="muted">${esc(lbl('issued', lg))} ${esc(issuedTxt)}</div>
      <div class="stamp">${esc(stamp)}</div>
    </div>
  </div>

  <div class="box"><div class="grid">
    <div><div class="k">${esc(lbl('client', lg))}</div><div class="v">${esc(client)}</div></div>
    <div><div class="k">${esc(lbl('service', lg))}</div><div class="v">${esc(serviceName(a))}</div></div>
  </div>
  <div class="grid" style="margin-top:12px">
    <div><div class="k">${esc(lbl('date', lg))}</div><div class="v">${lg === 'both' ? when : esc(when)}</div></div>
    <div><div class="k">${esc(lbl('method', lg))}</div><div class="v">${esc(method)}</div></div>
  </div></div>

  <table>${lines.join('')}</table>

  <div class="foot">
    <div class="thanks">${esc(lbl('thanks', lg))}</div>
    ${opts.pageUrl ? `<div class="muted" style="margin-top:6px">${esc(lbl('page', lg))}: ${esc(opts.pageUrl)}</div>` : ''}
    ${opts.branding ? `<div class="small">${esc(lbl('madeWith', lg))}</div>` : ''}
  </div>
</div></body></html>`
}

/** Resumo do recibo em texto pro WhatsApp (negrito com *asteriscos*). */
export function buildReceiptText(a, provider, lang = 'pt', opts = {}) {
  if (lang === 'both') return `${buildReceiptText(a, provider, 'pt', opts)}\n\n— — —\n\n${buildReceiptText(a, provider, 'en', opts)}`
  const lg = lang === 'en' ? 'en' : 'pt'
  const v = receiptAmounts(a)
  const p = providerLines(provider)
  const t = L[lg]
  const money = (c) => fmtMoney(c, { decimals: 2 })
  const rows = [
    `*${t.receipt} ${t.number} ${receiptNumber(a)}*`,
    p.name,
    '',
    `${t.client}: ${opts.clientName || a?.client_name || '—'}`,
    `${t.service}: ${serviceName(a)}`,
    `${t.date}: ${fmtReceiptWhen(a?.scheduled_for, lg)}`,
    `${t.servicePrice}: ${money(v.service)}`,
  ]
  if (v.paid !== v.service) rows.push(`${t.charged}: ${money(v.paid)}`)
  if (v.tip > 0) rows.push(`${t.tip}: ${money(v.tip)}`)
  rows.push(`*${t.totalPaid}: ${money(v.total)}*`)
  if (v.balance > 0) rows.push(`${t.balance}: ${money(v.balance)}`)
  rows.push(`${t.method}: ${methodLabel(a?.paid_method || a?.payment_method, lg)}`)
  rows.push('', t.thanks)
  if (opts.pageUrl) rows.push(`${t.page}: ${opts.pageUrl}`)
  return rows.join('\n')
}
