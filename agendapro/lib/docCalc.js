// ════════════════════════════════════════════════════════════════════════════
//   Orçamentos e faturas — CÓPIA de api/_lib/docCalc.js (conta dos valores).
//   O app não importa nada de api/ (o Metro só enxerga agendapro/). Mudou lá?
//   Copie de novo pra cá (o scripts/check.js acusa diferença).
// ════════════════════════════════════════════════════════════════════════════

export const UNITS = ['un', 'hora', 'dia', 'semana', 'm²', 'ft²', 'ft', 'm', 'página', 'palavra', 'projeto', 'visita', 'cômodo', 'lote']
export const ITEM_KINDS = ['service', 'labor', 'material', 'fee', 'other']

const toInt = (v) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : 0
}

/** Quantidade válida: > 0, até 2 casas, no máximo 1.000.000. Inválida → null. */
export function cleanQty(v) {
  const n = Number(String(v ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(1000000, Math.round(n * 100) / 100)
}

/** Percentual 0–100 com até 2 casas; vazio → null. */
export function cleanPct(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100))
}

export function lineTotal(qty, unitPriceCents) {
  const q = cleanQty(qty)
  if (q === null) return 0
  return Math.max(0, Math.round(q * Math.max(0, toInt(unitPriceCents))))
}

/**
 * computeTotals({ items, discount_pct, discount_cents, tax_rate_bps, deposit_pct,
 *                 deposit_cents, amount_paid_cents })
 * items: [{ quantity, unit_price_cents, taxable }]
 * → { lines: [{ ...item, line_total_cents }], subtotal_cents, discount_cents,
 *     taxable_cents, tax_cents, total_cents, deposit_cents, balance_cents }
 */
export function computeTotals(doc = {}) {
  const items = Array.isArray(doc.items) ? doc.items : []
  const lines = items.map((it) => ({ ...it, line_total_cents: lineTotal(it.quantity, it.unit_price_cents) }))
  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0)

  const dPct = cleanPct(doc.discount_pct)
  let discount = dPct !== null && dPct > 0 ? Math.round(subtotal * dPct / 100) : Math.max(0, toInt(doc.discount_cents))
  discount = Math.min(discount, subtotal)

  const taxableSum = lines.filter((l) => l.taxable).reduce((s, l) => s + l.line_total_cents, 0)
  const taxableDiscount = subtotal > 0 ? Math.round(discount * taxableSum / subtotal) : 0
  const taxable = Math.max(0, taxableSum - taxableDiscount)
  const bps = Math.min(2500, Math.max(0, toInt(doc.tax_rate_bps)))
  const tax = Math.round(taxable * bps / 10000)

  const total = subtotal - discount + tax

  const depPct = cleanPct(doc.deposit_pct)
  let deposit = depPct !== null && depPct > 0 ? Math.round(total * depPct / 100) : Math.max(0, toInt(doc.deposit_cents))
  deposit = Math.min(deposit, total)

  const paid = Math.max(0, toInt(doc.amount_paid_cents))
  return {
    lines,
    subtotal_cents: subtotal,
    discount_cents: discount,
    taxable_cents: taxable,
    tax_cents: tax,
    total_cents: total,
    deposit_cents: deposit,
    balance_cents: Math.max(0, total - paid),
  }
}

/** Número de exibição: Q-0007 / INV-0042. */
export function docNumber(kind, seq) {
  const n = String(Math.max(0, toInt(seq))).padStart(4, '0')
  return (kind === 'quote' ? 'Q-' : 'INV-') + n
}

/**
 * Status da fatura a partir do que foi pago e do vencimento (não mexe em
 * draft/void). todayKey = 'YYYY-MM-DD' no fuso da profissional.
 */
export function invoiceStatus({ status, total_cents, amount_paid_cents, due_date, viewed_at, sent_at }, todayKey) {
  if (status === 'draft' || status === 'void') return status
  const total = Math.max(0, toInt(total_cents))
  const paid = Math.max(0, toInt(amount_paid_cents))
  if (total > 0 && paid >= total) return 'paid'
  if (due_date && todayKey && String(due_date).slice(0, 10) < todayKey) return 'overdue'
  if (paid > 0) return 'partial'
  if (viewed_at) return 'viewed'
  if (sent_at || status === 'sent') return 'sent'
  return 'draft'   // nunca 'paid'/'partial' sem pagamento nem envio
}
