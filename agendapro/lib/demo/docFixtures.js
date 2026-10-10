// ════════════════════════════════════════════════════════════════════════════
//   Modo demonstração — orçamentos, faturas, tabela de preços e pedidos de
//   orçamento de exemplo (estado inicial de /api/agenda/documents, catalog e
//   quote-requests). Valores sempre por computeTotals (lib/docCalc.js), via
//   applyTotals de lib/demo/documents.js; faturas geradas de orçamento seguem a
//   mesma divisão da action 'convert' (entrada, etapas, saldo).
//
//   trades   → Silva Remodeling: 10 orçamentos e 11 faturas em todos os status
//              (entrada de 30%, etapa 2 de 3, vencida, anulada...), 5 pedidos
//   cleaning → faxineira com fatura mensal de escritório (2 faturas e 1 orçamento)
//   services → cabeleireira com dia da noiva e ensaio (1 orçamento e 2 faturas)
// ════════════════════════════════════════════════════════════════════════════
import { docNumber } from '../docCalc.js'
import { addDays, rng, toWall, uid, wallToReal } from './util.js'
import { placeholderImage } from './common.js'
import { applyTotals, clientSnapshot, CONVERT_L, ensureDocState, fmtPct, newDocToken, NEW_DOC_EXTRA, signedSnapshot } from './documents.js'

// Assinaturas desenhadas (PNG 320x100, geradas pra demo)
const SIGNATURES = {
  jennifer: 'data:image/png;base64,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',
  michael: 'data:image/png;base64,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',
  fernanda: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAABkBAMAAAAF9PQNAAAAGFBMVEUAAAEbKUcKD1waJ0QaJ0QAVVUAAP9VVQA9oV2fAAAACHRSTlMA8A+dXgIBA6Md9QgAAAl7SURBVHja7VrPbxvHFf727cqi3IrcEYXGbuzl25WdOk0qkVKB5BSQtm8FAsFF0GOF/mW9FyiEnnJKBR96KAqLTYtEgdPVhEEi+UeokeJIK1mayWFmKcWxaC0ttkbBdxG1nDfzvW/erxkuMJKRjGQkIxnJSEbyfyX8SqMjEL1ikPwf/Fd7Un4H6pUC6P2QwAr8rn7FNvWERDVaONLnMdOQwJKoQzAPFls8fAa1Rx/zYPjGOo0nNPwgaV4Yl5dL7QGm0bxpXguHEV7BSTbbFSA0AzmHio0ZSvifADgWbX/1dLBZovhf9zyhhuyDr5evvD7gJJ3220Skh8sgdbYrg85i/JUfOMtwttijQXdYt7Yewww7zUSROQIW1SAh0v6YyTM0ZB8MZzUwNUg/U/Mh9bCbBdrOMgWs7meyMD5R3gBo4ruhMqg9+goAQRafQyr+LzQLkXdUsCGkMbbhT/MSQ+8HOb4wrmD80u6Z8Wm9YwCY2sGqAWEiM8MEuKMABdIXHUCqKe4f0bWdW0cKAIvyuIJBKTMYogRVAgBvyv2/SEl/hYSEsDq2Q+tp9vOJXPdO8X7Jn7YbPZUv3xA3+ztvS9wSTYCCqtUMXxQpY+xcfnGQXOaQteqcLy9EPw55RjTRCgHEU2Q1F1/I4G2HK0kK+yDH4++uAddTbgNArbo+d5C9VjrVC2nb1P7udX6yC443ftcG2As/fEHT/WT208NdAGjJ7EapYMlaEk0AIJE3//M9ap6/WlwFI6gSFht1q8kvSmgNsSCaAMei2qgWrYtu/kDcyZcH/Omx00NE1BlEIo8RIvHGCwiMxU3E00QkpkGFjz42iF2ogEWdgaB6OkBfkCWcAku632dw70SGQBDHAgka9WIAySHzpggA+dUxgILT94FbUwRgSfCYX7Wa0y/YNK8KIBEMMQ8gDouVOq01AHBTawDRe+bo+OFzpT2rAawwP9WGADAf9u9nKLzKgGb26R5w4cwl1Q3jpl4CAMUMgNqz7wN94NGXtGI/SWeTDLl/lomxIwEZqtkjBg47VIzBuuI/AuhIBQBf0MoyADo1nUaRWcoP7LaTWZJh3+PqYmRSAIxAhja7FWwgbVRZr+N4KumfObjRdMmJe0Hcn4c/2DTGsbC+astPkUsP5+k2hTQXHepTh7/hkpPLnOT3T2zkQolbLt8GopgPWp/lpgZAHdxddh52WkT6n+dcEiUAtDZ9tyx6z+TG3s0hFwGoCT6AuooA4MjPv+PTljuM3H2nNF4KAM3IjeXEpmCixBmfMID2rDPZ1wCg4T0tmAbHrNMlAOcNAz1n2whgkGjmI8Ztl8V251yXws7wXP0OBdUkz5/WkGC64D3mFDnPJc7LEAVVEHDnRzfY3HOgoGq7oF6MJLi2sMAEYrq1MA8GQElyXNZZ1DEIQI7DJYC8qWs3+djfgyqQJBYUOZzJ7dt8XDX8abTCJQB+FcAiCLeEEFVmDhpCiHkCrjWEmEcrdDY7pvPKddYrYPYqSoLjNkCT3naYAsCYFt3WPcz8g+XYb5ZBGqRv3QMw563aXok88TiuKAnEO/Xt8kdgv+uH+Mbr0pxswLQrMphEouXcP+ekBIBY5R+2lS7QD4ZxlqnkCwVqfH34WuUXawAQXD1441Ng68YaHa0loqx4aybFTLzxaDy03ZxBaa+RZQrwzMbW5rudb7X/07T7+l7WXGt8tN658XB/dqf+t4c37puDdVtPVGYv6cXeXpGGVcWlNnWbm41P1q98p3hNAcCR2FMz+uG79698E8xtZk/faQfaL3+yfnhBwa7CYi8TWANX92j+5+Of7c19+1gllfU331qd+yvF3UcXf/ZwcjUpf37B37AHqn10v7FbdumMHau75W+ZFfa7XnfsSMfquwP3sB3fA2hu/ckkiFNU4o8nOxrwpnZcjmhtKVGRHZqkSYlgcuY/lY4GECuvyxKgCuZWWILFF2UJgGiSnGpri5cLMLj4oNTZNqiVuobUxV13fNz2UjIwjy5eoPrupwc3Hm3Mtg1AmNjXznVDNbGJSk3pzbH3dyc2vA0DgFSpohSA2r6/VpNAOLG1adkYpye55odFtjh7kG3XMrBSqOXeQZxVwi0AM7sor+7E3UcX/E/sVcyeu4XZyTJ5OevcXEUd3bWdb8fnJADUGo82DQDaLs0aCWAno30DwHCGfQMAaj8744123m6xDtm/KwGZ/6CgQ3SkrXc1uahTXMUVmyvC4/IoWSLqglYkAIMOAKDTRmTvNUHSMueWCV0PRwGkLFLqZIhA4m0NgBVsTxhIl1uvoo1lgL50g9N8am18gLnTZgMA0SwiBkAejASAqAnNtrAhr+3WeP/sd4mu7MZqPFNrlnxkUECtkmEXAHaADABqYVbJFEBeyT4AONtTb6qH46oSKmAns5qGM8oMALVtH7CwU5FXAkIFIDgq7ZsiDLKUDI8s+ZZ9GTrzc1ul21ndM545YoaM4EtpB9p9Y7eRwYkH+WLWaw6aOirUUX8tA4XZCIA2Pcyw513jWGbp2q/8ATrtEHKFGG/nHmfroXJbbdzBQzqv0T1NateL3Q8e+kfSX3EObfJO7660DhTljcLukh0R5T8u35Xkm7a/4lKqWXahkAeoyWNDOb+9EvU0C/mgiS4rfclOe8OECkC4f+lrAPC8i1oBQLh/+d9tAGTcA/P7B10YvtTT/KWuKADwL322BcB4vQfZAwOAcNFGj6lNdAvftN7mAd8aeI4mP9uu41xfVeBnDyD9lfh0YD9+8BJvRiQD25ZgJCPBOb31cYZgZ/j33YdcUgBjV+3f/5VQwme6WKbkepH753NgkCKJJD0uOwzirR5vx1HshSmQgmVPLTknRk8FSL/9U74GWVhnWpDiMIW2RZuiTiSHATBJyU1M1DwBLMmJQo+qvI1wNkDLY5zuF9okvXNPnhfAns0ETrbcagmElr2ln5Od02e+SYyyoxOvLLV0W56+PEA7BxPVug5avoBdeHaZ+LRgdd8Qu/HEyC1MRJoCQDLbli/7cllSU6md3ivnnX2SHi97xtKXwvlIz0UoLqdyICZPAFzQEiCGSJ3l0C/h5LTYTu/8Obe7KwHMlD9yLq4HAUiVRBxK+ePk8lIJNJ+JONlKe0yCz8zkCYAaAK7fx/WnEucr19/6SyQBXLNMJt5jiWdTwZk2hRhDE/rA3RbeXhBCVH99MxlKLT4fJqnVlQD9KlzGqyf0ARLLZKPJeFVlqM50bkwSRjKSkYxkJCMZyUheWr4HbehV3OZzGfYAAAAASUVORK5CYII=',
}

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Acrescenta ao estado: catalog, documents, docItems, docEvents, docPayments,
 * quoteRequests, docCounters. Remove os _key auxiliares das clientes.
 */
export function buildDocFixtures(S, { today, now = new Date(), vertical = 'services' }) {
  ensureDocState(S)
  const R = rng(vertical === 'trades' ? 9091 : vertical === 'cleaning' ? 4242 : 7171)
  const nowMs = now.getTime()
  let tick = 0
  // Instante real de um evento no dia (offset) às HH:MM; nunca depois de agora
  const at = (off, hhmm = '09:00') => {
    tick++
    const ms = Date.parse(wallToReal(toWall(addDays(today, off), hhmm)))
    return new Date(Math.min(ms, nowMs - (90 - Math.min(tick, 80)) * 60e3)).toISOString()
  }
  const P = S.provider
  const findClient = (key) => S.clients.find((c) => c._key === key) || S.clients.find((c) => c.name.startsWith(key))
  const ctx = { S, P, R, today, at, findClient, catalog: {}, counters: { quote: 0, invoice: 0 }, order: 0 }

  if (vertical === 'trades') tradesDocs(ctx)
  else if (vertical === 'cleaning') cleaningDocs(ctx)
  else beautyDocs(ctx)

  // Os documentos nascem numerados na ordem de criação (igual a ag_next_doc_seq):
  // aqui só confere a sequência e guarda o contador.
  for (const kind of ['quote', 'invoice']) {
    const list = S.documents.filter((d) => d.kind === kind).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a._order - b._order)
    list.forEach((d, i) => { d.seq = i + 1; d.number = docNumber(kind, i + 1) })
    S.docCounters[kind] = list.length
  }
  for (const d of S.documents) { delete d._order; delete d._clientKey }
  for (const c of S.clients) delete c._key
  return S
}

// ── Construtor declarativo ──────────────────────────────────────────────────
function catalogRows(ctx, list) {
  const { S, P } = ctx
  list.forEach(([key, name, description, kind, unit, price, taxable], i) => {
    const row = { id: uid(), provider_id: P.id, name, description, kind, unit, unit_price_cents: price, taxable, active: true, display_order: i, created_at: ctx.at(-70 + i, '20:00'), updated_at: null }
    S.catalog.push(row)
    ctx.catalog[key] = row
  })
}

/**
 * spec: { kind, client, title, lang, issue (offset), due | valid (offset), items: [[desc, kind, unit, qty, cents, taxable, catalogKey?]],
 *   discount_pct, discount_cents, tax_bps, deposit_pct, notes, terms, pi, internal, photos, job_address,
 *   stage_label, quote, created (offset, padrão = issue), createdDetail, status (orçamento / rascunho / anulada),
 *   tl: { sent: [off, canal, hh], viewed: [off, hh], accepted: [off, nome, assinatura|null, canal], declined: [off, motivo],
 *         converted: [off, modo], voided: off, expired: off, overdue: off, reminders: [[off, canal]],
 *         payments: [[off, cents|'rest', método, nota, origem]] } }
 */
function makeDoc(ctx, spec) {
  const { S, P, R, today, at } = ctx
  const D = P.app_settings?.doc_defaults || {}
  const cl = ctx.findClient(spec.client)
  const kind = spec.kind
  const issue = addDays(today, spec.issue)
  const created = at(spec.created ?? spec.issue, spec.createdAt || '08:40')
  const tl = spec.tl || {}
  ctx.counters[kind]++
  const doc = {
    id: uid(), provider_id: P.id, kind, seq: ctx.counters[kind], number: docNumber(kind, ctx.counters[kind]), status: 'draft',
    ...clientSnapshot(cl),
    title: spec.title || null, job_address: spec.job_address || null, language: spec.lang || D.language || 'en',
    issue_date: issue,
    due_date: kind === 'invoice' ? addDays(today, spec.due ?? spec.issue + (D.due_days ?? 14)) : null,
    valid_until: kind === 'quote' ? addDays(today, spec.valid ?? spec.issue + (D.quote_valid_days ?? 30)) : null,
    subtotal_cents: 0, discount_pct: spec.discount_pct ?? null, discount_cents: spec.discount_cents || 0,
    tax_rate_bps: spec.tax_bps ?? (D.tax_rate_bps || 0), tax_cents: 0, total_cents: 0,
    deposit_pct: kind === 'quote' ? (spec.deposit_pct === undefined ? (D.deposit_pct || null) : spec.deposit_pct) : null, deposit_cents: 0, amount_paid_cents: 0,
    notes: spec.notes === undefined ? (D.notes || null) : spec.notes,
    terms: spec.terms === undefined ? (D.terms || null) : spec.terms,
    payment_instructions: spec.pi === undefined ? (D.payment_instructions || P.deposit_instructions || null) : spec.pi,
    internal_notes: spec.internal || null, photos: spec.photos || [], stage_label: spec.stage_label || null,
    public_token: newDocToken(R.next), quote_id: spec.quote?.id || null, appointment_id: null, quote_request_id: null,
    sent_at: null, viewed_at: null, accepted_at: null, accepted_name: null, accepted_signature: null, accepted_ip: null, accepted_user_agent: null,
    declined_at: null, decline_reason: null, paid_at: null, voided_at: null, last_reminder_at: null, reminders_sent: 0,
    ...NEW_DOC_EXTRA, created_at: created, updated_at: created, _order: ctx.order++, _clientKey: spec.client,
  }
  const rows = (spec.items || []).map(([description, k, unit, quantity, unit_price_cents, taxable, catKey], i) => ({
    id: uid(), document_id: doc.id, provider_id: P.id, position: i, catalog_item_id: catKey ? ctx.catalog[catKey]?.id || null : null,
    kind: k, description, quantity, unit, unit_price_cents, taxable: !!taxable, line_total_cents: 0,
  }))
  S.documents.push(doc)
  S.docItems.push(...rows)
  const ev = (type, channel, detail, when) => {
    S.docEvents.push({ id: uid(), document_id: doc.id, provider_id: P.id, type, channel, detail: detail || {}, created_at: when })
    if (when > doc.updated_at) doc.updated_at = when
  }
  ev('created', 'app', spec.createdDetail || {}, created)
  applyTotals(doc, rows, 0, today)

  if (tl.sent) {
    const channel = tl.sent[1] || 'email'
    doc.sent_at = at(tl.sent[0], tl.sent[2] || '18:30')
    ev('sent', channel, { first: true, ...(channel === 'email' ? { email_sent: true } : {}) }, doc.sent_at)
    doc.status = 'sent'
  }
  if (tl.viewed !== undefined) {
    const [off, hh] = Array.isArray(tl.viewed) ? tl.viewed : [tl.viewed, '20:10']
    doc.viewed_at = at(off, hh)
    ev('viewed', 'link', {}, doc.viewed_at)
    doc.status = 'viewed'
  }
  if (tl.accepted) {
    const [off, name, sig, channel = 'link'] = tl.accepted
    doc.accepted_at = at(off, '20:45')
    doc.accepted_name = name
    doc.accepted_signature = sig ? SIGNATURES[sig] : null
    if (channel === 'link') {
      // Aprovado pelo link: consentimento e retrato assinado (hash), como o doc-public grava
      doc.accepted_user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)'
      const { snapshot, hash } = signedSnapshot(S, P, doc, { name, signed_at: doc.accepted_at, user_agent: doc.accepted_user_agent, signature: doc.accepted_signature })
      Object.assign(doc, { signed_snapshot: snapshot, signed_hash: hash, consent_at: doc.accepted_at, consent_text_version: snapshot.consent.version })
    }
    ev('accepted', channel, channel === 'link'
      ? { by: 'client', name, signed: !!sig, total_cents: doc.total_cents, deposit_cents: doc.deposit_cents, signed_hash: doc.signed_hash, consent: doc.consent_text_version, copy_emailed: !!doc.client_email }
      : { by: 'provider', name }, doc.accepted_at)
    doc.status = 'accepted'
  }
  if (tl.declined) {
    doc.declined_at = at(tl.declined[0], '12:20')
    doc.decline_reason = tl.declined[1] || null
    ev('declined', 'link', { by: 'client', ...(doc.decline_reason ? { reason: doc.decline_reason.slice(0, 200) } : {}) }, doc.declined_at)
    doc.status = 'declined'
  }
  if (tl.expired !== undefined) { ev('expired', 'cron', { valid_until: doc.valid_until }, at(tl.expired, '11:00')); doc.status = 'expired' }
  let paid = 0
  for (const [off, cents, method, note, source = 'manual'] of tl.payments || []) {
    applyTotals(doc, rows, paid, today)
    const amount = cents === 'rest' ? doc.total_cents - paid : cents
    const paidOn = addDays(today, off)
    // Manual: meio-dia do dia (como record_payment), nunca depois de agora
    const when = source === 'stripe' ? at(off, '21:12') : at(off, '12:00')
    const pay = { id: uid(), provider_id: P.id, document_id: doc.id, appointment_id: null, type: 'invoice', status: 'paid', amount_cents: amount, method, paid_at: when, note: note || null, source, created_at: at(off, '19:05') }
    S.docPayments.push(pay)
    paid += amount
    const full = paid >= doc.total_cents
    ev('payment', source === 'stripe' ? 'stripe' : 'app', source === 'stripe'
      ? { amount_cents: amount, method: 'card', payment_id: pay.id }
      : { payment_id: pay.id, amount_cents: amount, method, paid_on: paidOn, ...(full ? { fully_paid: true } : {}) }, pay.created_at)
  }
  if (tl.overdue !== undefined) ev('overdue', 'cron', { due_date: doc.due_date }, at(tl.overdue, '11:00'))
  for (const [off, channel] of tl.reminders || []) {
    const when = at(off, '11:05')
    ev('reminder', channel, channel === 'cron' ? { auto: true, n: doc.reminders_sent + 1, days_late: Math.max(0, -off - (spec.due ?? 0)), email_sent: true } : { manual: true, ...(channel === 'email' ? { email_sent: true } : {}) }, when)
    doc.reminders_sent++
    doc.last_reminder_at = when
  }
  if (tl.voided !== undefined) {
    doc.voided_at = at(tl.voided, '17:40')
    ev('voided', 'app', {}, doc.voided_at)
  }
  // Valores finais e status (fatura: pelo que foi pago e pelo vencimento)
  applyTotals(doc, rows, paid, today)
  if (kind === 'invoice' && doc.status === 'paid') doc.paid_at = S.docPayments.filter((p) => p.document_id === doc.id).map((p) => p.paid_at).sort().pop() || null
  if (tl.voided !== undefined) { doc.status = 'void'; doc.paid_at = null }
  if (spec.status) doc.status = spec.status
  if (tl.converted) ev('converted', 'app', { mode: tl.converted[1], invoices: [] }, at(tl.converted[0], '10:05'))
  return doc
}

const quoteItems = (ctx, doc) => ctx.S.docItems.filter((it) => it.document_id === doc.id).sort((a, b) => a.position - b.position)

/**
 * Faturas de um orçamento convertido, com a mesma divisão da action 'convert':
 * full = mesmos itens; deposit = 1 linha "Entrada (30%)"; stages = 1 linha por etapa.
 * parts (deposit/stages): [{ label?, pct }]. specs[i] = campos extras de cada fatura (status, timeline...).
 */
function convertInvoices(ctx, quote, { mode, created, parts = [], specs = [] }) {
  const lang = quote.language
  const L = CONVERT_L[lang] || CONVERT_L.en
  const total = quote.total_cents
  const single = (description, cents) => [[description, 'other', 'un', 1, cents, false]]
  let list
  if (mode === 'full') {
    list = [{ items: quoteItems(ctx, quote).map((it) => [it.description, it.kind, it.unit, it.quantity, it.unit_price_cents, it.taxable, null]), stage_label: null, full: true }]
  } else if (mode === 'deposit') {
    const pct = parts[0].pct
    const label = `${L.deposit} (${fmtPct(pct, lang)}%)`
    list = [{ items: single(label, Math.round((total * pct) / 100)), stage_label: label }]
  } else {
    const n = parts.length
    let used = 0
    list = parts.map((s, i) => {
      let cents = Math.round((total * s.pct) / 100)
      if (i === n - 1) cents = total - used
      used += cents
      return { items: single(`${L.stage} ${i + 1}: ${s.label || `${fmtPct(s.pct, lang)}%`}`, cents), stage_label: `${L.stage} ${i + 1} ${L.of} ${n} (${fmtPct(s.pct, lang)}%)` }
    })
  }
  const out = list.map((x, i) => makeDoc(ctx, {
    kind: 'invoice', client: quote._clientKey, title: quote.title, lang, job_address: quote.job_address,
    issue: created, created, items: x.items, quote, stage_label: x.stage_label,
    discount_pct: x.full ? quote.discount_pct : null, discount_cents: x.full && quote.discount_pct == null ? quote.discount_cents : 0,
    tax_bps: x.full ? quote.tax_rate_bps : 0, notes: quote.notes, terms: quote.terms, pi: quote.payment_instructions,
    photos: quote.photos.slice(), createdDetail: { from_quote: quote.number, mode },
    ...(specs[i] || {}),
  }))
  const conv = ctx.S.docEvents.filter((e) => e.document_id === quote.id && e.type === 'converted').pop()
  if (conv) conv.detail.invoices = out.map((d) => d.number)
  return out
}

// ════════════════════════════════════════════════════════════════════════════
//   WorkPro: Silva Remodeling
// ════════════════════════════════════════════════════════════════════════════
function tradesDocs(ctx) {
  const { S, today } = ctx
  catalogRows(ctx, [
    ['labor', 'Labor — general carpentry', 'Skilled carpenter, per hour.', 'labor', 'hora', 7500, false],
    ['helper', 'Labor — helper', 'Helper / laborer, per hour.', 'labor', 'hora', 4500, false],
    ['crewday', 'Crew day (2 people)', 'Two-person crew, 8-hour day.', 'labor', 'dia', 96000, false],
    ['drywall', 'Drywall install & finish', 'Hang, tape, 3 coats of mud, sand. Ready for paint.', 'service', 'ft²', 325, false],
    ['paint', 'Interior painting (walls, 2 coats)', 'Includes light patching and caulking.', 'service', 'ft²', 210, false],
    ['lvp', 'LVP flooring installation', 'Floating floor over prepared subfloor.', 'service', 'ft²', 350, false],
    ['tile', 'Tile installation (floor/wall)', 'Thinset, leveling clips, grout and sealer.', 'service', 'ft²', 1200, false],
    ['lumber', 'Pressure-treated lumber package', 'Framing and decking lumber for ~100 ft² of deck.', 'material', 'lote', 145000, true],
    ['paintgal', 'Paint — premium interior (gallon)', null, 'material', 'un', 6200, true],
    ['sheet', 'Drywall sheet 1/2" 4x8', null, 'material', 'un', 1850, true],
    ['dumpster', 'Dumpster rental (10 yd)', 'Drop-off, pickup and disposal.', 'fee', 'un', 49500, false],
    ['permit', 'Building permit', 'Town permit and inspections.', 'fee', 'un', 25000, false],
  ])
  const before = (t) => placeholderImage(t, 'E8EBF1', '1B2845', '1200x900')
  const PT = {
    notes: 'Obrigado pela confiança!',
    terms: 'Garantia de 1 ano na mão de obra, a partir da entrega. Materiais com a garantia do fabricante. Mudanças no projeto são orçadas à parte antes de fazer. Entrada de 30% para agendar a obra. Licença CSL-123456 (MA).',
    pi: 'Zelle: (508) 555-0142 (Silva Remodeling LLC). Cheque nominal a Silva Remodeling LLC.',
  }

  // ── Orçamentos (na ordem em que foram feitos) ─────────────────────────────
  const q = {}
  q.robert = makeDoc(ctx, {
    kind: 'quote', client: 'robert', title: 'Kitchen backsplash', issue: -45, valid: -15,
    items: [
      ['Remove existing backsplash and prep wall', 'labor', 'hora', 4, 7500, false, 'labor'],
      ['Tile installation — subway tile backsplash', 'service', 'ft²', 45, 1400, false, 'tile'],
      ['White subway tile 3x6 + trim pieces', 'material', 'ft²', 52, 650, true],
      ['Grout, thinset and sealer', 'material', 'lote', 1, 8500, true],
      ['Outlet box extenders', 'material', 'un', 4, 600, true],
    ],
    tl: { sent: [-45, 'email', '18:10'], viewed: [-44, '07:55'], expired: -14 },
    status: 'expired',
  })
  q.jennifer = makeDoc(ctx, {
    kind: 'quote', client: 'jennifer', title: 'Master bathroom remodel', issue: -38,
    photos: [before('Before: master bath'), before('Before: shower')],
    items: [
      ['Demolition & disposal of existing tub, tile and vanity', 'labor', 'projeto', 1, 180000, false],
      ['Dumpster rental (10 yd)', 'fee', 'un', 1, 49500, false, 'dumpster'],
      ['Plumbing rough-in and fixture hookup (licensed plumber)', 'labor', 'projeto', 1, 240000, false],
      ['Tile installation — floor and shower walls', 'service', 'ft²', 180, 1200, false, 'tile'],
      ['Porcelain tile 12x24 (material)', 'material', 'ft²', 200, 650, true],
      ['48" vanity with quartz top', 'material', 'un', 1, 125000, true],
      ['Frameless glass shower door', 'material', 'un', 1, 145000, true],
      ['Greenboard, drywall patch and paint', 'service', 'projeto', 1, 95000, false],
      ['Building permit (Natick)', 'fee', 'un', 1, 35000, false, 'permit'],
    ],
    tl: { sent: [-38, 'email', '19:30'], viewed: [-38, '21:05'], accepted: [-37, 'Jennifer Walsh', 'jennifer'], converted: [-36, 'stages'] },
    status: 'converted',
  })
  q.sarah = makeDoc(ctx, {
    kind: 'quote', client: 'sarah', title: 'Interior painting — living room, dining room and hallway', issue: -30, discount_pct: 5,
    items: [
      ['Interior painting (walls, 2 coats)', 'service', 'ft²', 1150, 210, false, 'paint'],
      ['Ceiling painting', 'service', 'ft²', 420, 140, false],
      ['Trim and doors', 'labor', 'hora', 10, 7500, false, 'labor'],
      ['Paint — premium interior (gallon)', 'material', 'un', 14, 6200, true, 'paintgal'],
      ['Patch and sand prep', 'labor', 'hora', 6, 4500, false, 'helper'],
    ],
    notes: 'Thank you for choosing Silva Remodeling! 5% returning-client discount applied.',
    tl: { sent: [-30, 'email', '17:45'], viewed: [-30, '19:20'], accepted: [-29, 'Sarah Mitchell', null, 'app'], converted: [-22, 'full'] },
    status: 'converted',
  })
  q.david = makeDoc(ctx, {
    kind: 'quote', client: 'david', title: 'LVP flooring — first floor (620 ft²)', issue: -23,
    items: [
      ['Remove carpet and haul away', 'labor', 'ft²', 620, 90, false],
      ['LVP flooring installation', 'service', 'ft²', 620, 350, false, 'lvp'],
      ['LVP planks 7mm + underlayment', 'material', 'ft²', 680, 310, true],
      ['Baseboard and quarter round', 'service', 'ft', 240, 425, false],
      ['Transitions and thresholds', 'material', 'un', 4, 3800, true],
    ],
    tl: { sent: [-23, 'whatsapp', '18:05'], viewed: [-23, '18:40'], accepted: [-22, 'David Kim', null, 'app'], converted: [-17, 'full'] },
    status: 'converted',
  })
  q.lauren = makeDoc(ctx, {
    kind: 'quote', client: 'lauren', title: 'Backyard fence repair (40 ft)', issue: -13,
    items: [
      ['Replace damaged fence posts (set in concrete)', 'service', 'un', 5, 18500, false],
      ['Replace pickets and rails', 'service', 'ft', 40, 2800, false],
      ['Cedar pickets, rails and hardware', 'material', 'lote', 1, 62000, true],
      ['Labor — general carpentry', 'labor', 'hora', 6, 7500, false, 'labor'],
    ],
    tl: { sent: [-13, 'email', '17:20'], viewed: [-12, '08:30'], declined: [-10, 'We decided to go with another contractor. Thank you for your time!'] },
    status: 'declined',
  })
  q.michael = makeDoc(ctx, {
    kind: 'quote', client: 'michael', title: 'New pressure-treated deck 16\' x 12\' with stairs', issue: -12,
    photos: [before('Backyard: deck area')],
    items: [
      ['Deck framing and decking installation', 'labor', 'ft²', 192, 2800, false],
      ['Pressure-treated lumber package', 'material', 'lote', 2, 145000, true, 'lumber'],
      ['Stairs (4 steps) with handrail', 'service', 'un', 1, 115000, false],
      ['Concrete footings', 'service', 'un', 9, 9500, false],
      ['Joist hangers, fasteners and hardware', 'material', 'lote', 1, 42000, true],
      ['Building permit (Sudbury)', 'fee', 'un', 1, 25000, false, 'permit'],
    ],
    tl: { sent: [-12, 'email', '20:00'], viewed: [-11, '07:40'], accepted: [-9, 'Michael Brennan', 'michael'], converted: [-9, 'deposit'] },
    status: 'converted',
  })
  q.fernanda = makeDoc(ctx, {
    kind: 'quote', client: 'fernanda', title: 'Reforma da cozinha — armários e bancada', lang: 'pt', issue: -5, discount_cents: 40000,
    items: [
      ['Retirada dos armários e bancada antigos', 'labor', 'projeto', 1, 65000, false],
      ['Instalação de armários (15 pés lineares)', 'service', 'ft', 15, 12000, false],
      ['Armários shaker brancos (material)', 'material', 'lote', 1, 520000, true],
      ['Bancada de quartzo com instalação', 'material', 'ft²', 42, 7500, true],
      ['Backsplash de azulejo metrô', 'service', 'ft²', 30, 1400, false, 'tile'],
      ['Ajustes de elétrica e hidráulica', 'labor', 'hora', 8, 8500, false],
    ],
    notes: 'Obrigado pela confiança! Desconto de indicação de US$ 400 já aplicado.', terms: PT.terms, pi: PT.pi,
    tl: { sent: [-5, 'whatsapp', '19:10'], viewed: [-5, '19:32'], accepted: [-3, 'Fernanda Oliveira', 'fernanda'] },
    status: 'accepted',
  })
  q.carmen = makeDoc(ctx, {
    kind: 'quote', client: 'carmen', title: 'Pintura exterior de la casa', lang: 'es', issue: -5,
    items: [
      ['Lavado a presión de la fachada', 'service', 'projeto', 1, 45000, false],
      ['Pintura exterior (2 manos)', 'service', 'ft²', 1800, 240, false],
      ['Reparación de madera podrida', 'labor', 'hora', 6, 7500, false, 'labor'],
      ['Pintura exterior premium (galón)', 'material', 'un', 18, 6800, true],
    ],
    notes: '¡Gracias por elegir Silva Remodeling!',
    terms: 'Garantía de 1 año en la mano de obra. Los materiales tienen la garantía del fabricante. Se requiere un anticipo del 30% para programar el trabajo.',
    pi: 'Zelle: (508) 555-0142 (Silva Remodeling LLC). Cheques a nombre de Silva Remodeling LLC.',
    tl: { sent: [-5, 'whatsapp', '11:30'], viewed: [-4, '21:15'] },
    status: 'viewed',
  })
  q.juliana = makeDoc(ctx, {
    kind: 'quote', client: 'juliana', title: 'Piso laminado em 2 quartos', lang: 'pt', issue: -2,
    items: [
      ['Instalação de piso laminado', 'service', 'ft²', 360, 325, false],
      ['Piso laminado 12mm + manta', 'material', 'ft²', 400, 280, true],
      ['Rodapé novo (cliente já comprou o material)', 'service', 'ft', 130, 425, false],
    ],
    notes: PT.notes, terms: 'Garantia de 1 ano na mão de obra. Entrada de 30% para agendar.', pi: PT.pi,
    tl: { sent: [-2, 'whatsapp', '18:50'] },
    status: 'sent',
  })
  q.kevin = makeDoc(ctx, {
    kind: 'quote', client: 'kevin', title: 'Basement finishing — framing, drywall and paint', issue: -1,
    internal: 'Confirmar a altura do teto e onde fica o quadro de luz antes de mandar.',
    items: [
      ['Wall framing (2x4)', 'labor', 'ft', 96, 1800, false],
      ['Drywall install & finish', 'service', 'ft²', 1100, 325, false, 'drywall'],
      ['Drywall sheet 1/2" 4x8', 'material', 'un', 38, 1850, true, 'sheet'],
      ['Interior painting (walls, 2 coats)', 'service', 'ft²', 1100, 210, false, 'paint'],
    ],
    status: 'draft',
  })

  // ── Faturas (na ordem em que foram feitas) ────────────────────────────────
  // Jennifer: etapas 30/40/30 → etapa 1 (entrada) paga, etapa 2 de 3 paga em parte, etapa 3 rascunho
  convertInvoices(ctx, q.jennifer, {
    mode: 'stages', created: -36,
    parts: [{ label: 'Deposit', pct: 30 }, { label: 'Rough-in and tile', pct: 40 }, { label: 'Final walkthrough', pct: 30 }],
    specs: [
      { tl: { sent: [-36, 'email', '10:20'], viewed: [-36, '12:02'], payments: [[-34, 'rest', 'check', 'Check #1042']] } },
      { issue: -2, due: 13, tl: { sent: [-2, 'email', '17:30'], viewed: [-1, '07:15'], payments: [[-1, 200000, 'check', 'Check #1088']] } },
      { status: 'draft' },
    ],
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'emily', title: 'Drywall repair — water damage (kitchen ceiling)', issue: -33, due: -18,
    items: [
      ['Remove damaged drywall and dispose', 'labor', 'hora', 3, 7500, false, 'labor'],
      ['Drywall install & finish', 'service', 'ft²', 64, 325, false, 'drywall'],
      ['Drywall sheet 1/2" 4x8', 'material', 'un', 3, 1850, true, 'sheet'],
      ['Ceiling paint (2 coats)', 'service', 'ft²', 160, 140, false],
    ],
    tl: { sent: [-33, 'email', '16:40'], viewed: [-33, '18:05'], payments: [[-30, 'rest', 'zelle', 'Zelle ref. 7781']] },
  })
  convertInvoices(ctx, q.sarah, {
    mode: 'full', created: -22,
    specs: [{ tl: { sent: [-22, 'email', '16:00'], viewed: [-22, '16:45'], payments: [[-21, 'rest', 'card', null, 'stripe']] } }],
  })
  convertInvoices(ctx, q.david, {
    mode: 'full', created: -17,
    // Lembrete automático há 2 dias: o "Cobrar" por e-mail da demo ainda funciona (1 por e-mail a cada 24h)
    specs: [{ due: -3, tl: { sent: [-17, 'email', '18:15'], viewed: [-16, '09:30'], overdue: -2, reminders: [[-2, 'cron']] } }],
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'kevin', title: 'Door repair and new lockset', issue: -10, due: 5,
    items: [
      ['Labor — door and frame repair', 'labor', 'hora', 2, 8500, false],
      ['Keyed entry lockset + deadbolt', 'material', 'un', 1, 4800, true],
    ],
    internal: 'Pagou US$ 221 em dinheiro na hora. Fatura anulada pra não cobrar duas vezes.',
    tl: { sent: [-10, 'whatsapp', '11:20'], voided: -10 },
    status: 'void',
  })
  // Michael: entrada de 30% (vista; o saldo sai depois em "Gerar fatura do saldo")
  convertInvoices(ctx, q.michael, {
    mode: 'deposit', created: -9, parts: [{ pct: 30 }],
    specs: [{ due: 6, tl: { sent: [-9, 'email', '21:10'], viewed: [-8, '07:05'] } }],
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'patricia', title: 'Drywall e pintura do porão', lang: 'pt', issue: -6, due: 9,
    items: [
      ['Instalação de drywall com acabamento', 'service', 'ft²', 280, 325, false, 'drywall'],
      ['Placa de drywall 1/2" 4x8', 'material', 'un', 10, 1850, true, 'sheet'],
      ['Pintura das paredes (2 demãos)', 'service', 'ft²', 280, 210, false, 'paint'],
      ['Tinta premium (galão)', 'material', 'un', 3, 6200, true, 'paintgal'],
    ],
    notes: 'Obrigado pela confiança, Patrícia!', terms: 'Garantia de 1 ano na mão de obra.', pi: PT.pi,
    tl: { sent: [-6, 'whatsapp', '18:00'] },
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'sarah', title: 'Touch-up painting — hallway and stairwell', issue: -1, due: 14,
    items: [
      ['Labor — touch-up painting', 'labor', 'hora', 6, 7500, false, 'labor'],
      ['Paint — premium interior (gallon)', 'material', 'un', 2, 6200, true, 'paintgal'],
    ],
    tl: { sent: [-1, 'email', '17:10'], viewed: [-1, '18:02'], payments: [[0, 'rest', 'zelle', 'Zelle']] },
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'marcos', title: 'Instalação de prateleiras na garagem', lang: 'pt', issue: -3,
    items: [
      ['Mão de obra — instalação', 'labor', 'hora', 3, 8500, false],
      ['Prateleiras e suportes de madeira (material)', 'material', 'lote', 1, 18600, true],
    ],
    notes: 'Obrigado!', terms: null, pi: PT.pi,
    status: 'draft',
  })

  // ── Pedidos de orçamento pela página ──────────────────────────────────────
  const reqPhoto = (t) => placeholderImage(t, 'E8EBF1', '1B2845', '1200x900')
  const REQS = [
    { name: 'Ashley Johnson', phone: '+15085550131', email: 'ashley.johnson@example.com', address: '27 Fiske St, Framingham, MA 01702', service: 'Bathroom vanity replacement',
      description: 'Looking to replace a 36" vanity and faucet in the hall bathroom. Happy to send more photos.', photos: [reqPhoto('Vanity'), reqPhoto('Faucet')], preferred: 6, language: 'en', status: 'new', ago: 0.08 },
    { name: 'Rodrigo Almeida', phone: '+19785550132', email: null, address: '14 Lincoln St, Hudson, MA 01749', service: 'Troca de piso da sala',
      description: 'Sala e corredor, uns 300 ft². Quero piso vinílico. Pode vir num sábado?', photos: [reqPhoto('Sala')], preferred: 4, language: 'pt', status: 'new', ago: 1.1 },
    { client: 'nicole', name: 'Nicole Thompson', phone: '+15085550114', email: 'nicole.thompson@example.com', address: '18 Elm St, Natick, MA 01760', service: 'Water-damaged ceiling drywall',
      description: 'The leak from the upstairs bathroom was fixed. Now the ceiling needs repair and paint (about 8x10 ft).', photos: [reqPhoto('Ceiling'), reqPhoto('Stain')], preferred: 0, language: 'en', status: 'contacted', ago: 3 },
    { client: 'luis', name: 'Luis Hernández', phone: '+15085550115', email: 'luis.hernandez@example.com', address: '102 Concord St, Framingham, MA 01702', service: 'Closet a medida',
      description: 'Quiero un closet de madera en el cuarto principal, unos 8 pies de ancho, con cajones.', photos: [], preferred: 1, language: 'es', status: 'contacted', ago: 5 },
    { client: 'juliana', name: 'Juliana Costa', phone: '+15085550112', email: 'juliana.costa@example.com', address: '77 Main St, Milford, MA 01757', service: 'Piso laminado em 2 quartos',
      description: 'Dois quartos de uns 12x15. Já comprei o rodapé. Indicação da Patrícia.', photos: [reqPhoto('Quarto')], preferred: null, language: 'pt', status: 'quoted', ago: 6, doc: q.juliana },
  ]
  for (const r of REQS) {
    // Pedido pela página não cria ficha (ela nasce ao converter): os novos ficam sem ficha,
    // os de quem já é cliente ficam ligados à ficha que existe
    const cl = r.client ? ctx.findClient(r.client) : null
    const created = new Date(Date.now() - r.ago * 86400e3).toISOString()
    const row = {
      id: uid(), provider_id: ctx.P.id, name: r.name, phone: r.phone, email: r.email, address: r.address, service: r.service, description: r.description,
      photos: r.photos, preferred_date: r.preferred == null ? null : addDays(today, r.preferred), language: r.language, status: r.status,
      client_id: cl?.id || null, document_id: r.doc?.id || null, ip_hash: null, created_at: created, updated_at: created,
    }
    S.quoteRequests.push(row)
    if (r.doc) r.doc.quote_request_id = row.id
  }
}

// ════════════════════════════════════════════════════════════════════════════
//   AgendaPro: faxineira (fatura mensal) e cabeleireira (dia da noiva)
// ════════════════════════════════════════════════════════════════════════════
function withDocSettings(P, { legal, tax = 0 }) {
  P.app_settings = {
    ...(P.app_settings || {}),
    notify_documents: true,
    business: { legal_name: legal, license_no: '', address_line: '', city: P.city || 'Boston', state: P.state || 'MA', zip: '', phone: '(617) 555-0142', email: 'ana.torres@example.com', website: '', insurance: '' },
    doc_defaults: {
      tax_rate_bps: tax, due_days: 7, quote_valid_days: 15, deposit_pct: 0, language: 'pt',
      terms: 'Cancelamento com menos de 24 horas de aviso: cobrança de 50% do valor.',
      notes: 'Obrigada pela confiança!',
      payment_instructions: P.deposit_instructions || 'Zelle: (617) 555-0142 · Ana Torres',
    },
  }
}

function cleaningDocs(ctx) {
  const { P, today } = ctx
  withDocSettings(P, { legal: 'Ana Torres Cleaning LLC' })
  catalogRows(ctx, [
    ['padrao', 'Limpeza padrão (até 3 quartos)', 'Cozinha, banheiros, pó e chão.', 'service', 'visita', 16000, false],
    ['pesada', 'Limpeza pesada (deep clean)', 'Forno, geladeira por dentro, rodapés e janelas.', 'service', 'visita', 28000, false],
    ['mudanca', 'Mudança (move-in / move-out)', 'Casa vazia, pronta pra entrega das chaves.', 'service', 'visita', 35000, false],
    ['escritorio', 'Limpeza de escritório', 'Fora do horário comercial.', 'service', 'visita', 14000, false],
    ['produtos', 'Produtos de limpeza', null, 'fee', 'un', 1500, false],
  ])
  // Fatura mensal de escritório (cliente comercial fora da agenda: não soma duas vezes nas Finanças)
  const office = (name, lang, phone, email, addr, zip) => {
    const row = {
      id: uid(), provider_id: P.id, name, whatsapp: phone, email, language: lang, birthday_md: null, tags: ['Comercial'],
      address_line: addr, city: 'Boston', state: 'MA', zip, home_notes: 'Limpeza fora do horário comercial. Chave com a recepção.', notes: 'Fatura mensal.',
      total_visits: 0, total_spent_cents: 0, first_visit_at: null, last_visit_at: null, archived: false, created_at: ctx.at(-120, '10:00'), updated_at: null,
    }
    ctx.S.clients.push(row)
    return row
  }
  office('Lima & Costa Advogados', 'pt', '+16175550151', 'contato@limacosta.example.com', '100 Federal St, Sala 1200', '02110')
  office('Back Bay Dental', 'en', '+16175550152', 'office@backbaydental.example.com', '250 Newbury St', '02116')
  const prevMonthKey = addDays(today.slice(0, 8) + '01', -1)
  const mm = prevMonthKey.slice(5, 7)
  const m = Number(mm) - 1
  const issueOff = -(Number(today.slice(8, 10)) - 1)          // dia 1º deste mês
  makeDoc(ctx, {
    kind: 'invoice', client: 'Lima & Costa', title: `Limpeza do escritório — ${MONTHS_PT[m]}`, lang: 'pt', issue: issueOff, due: issueOff + 7,
    items: [4, 11, 18, 25].map((d) => [`Limpeza do escritório — ${String(d).padStart(2, '0')}/${mm}`, 'service', 'visita', 1, 14000, false, 'escritorio']),
    tl: { sent: [issueOff, 'whatsapp', '09:10'], viewed: [issueOff, '12:30'], payments: [[Math.min(issueOff + 2, 0), 'rest', 'zelle', 'Zelle']] },
  })
  makeDoc(ctx, {
    kind: 'quote', client: 'Sarah', title: 'Move-out deep clean', lang: 'en', issue: -2,
    items: [['Move-out cleaning (3 bedrooms)', 'service', 'visita', 1, 35000, false, 'mudanca'], ['Inside oven and fridge', 'service', 'un', 1, 6000, false]],
    notes: 'Thank you!', terms: 'Please make sure water and electricity are on.', pi: 'Zelle: (617) 555-0142 · Ana Torres',
    tl: { sent: [-2, 'whatsapp', '15:00'], viewed: [-2, '16:10'] },
    status: 'viewed',
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'Back Bay Dental', title: `Office cleaning — ${MONTHS_EN[m]}`, lang: 'en', issue: -1, due: 6,
    items: [2, 9, 16, 23].map((d) => [`Office cleaning (after hours) — ${mm}/${String(d).padStart(2, '0')}`, 'service', 'visita', 1, 14000, false, 'escritorio']).concat([['Cleaning supplies', 'fee', 'un', 1, 1500, false, 'produtos']]),
    notes: 'Thank you!', terms: null, pi: 'Zelle: (617) 555-0142 · Ana Torres',
    tl: { sent: [-1, 'email', '18:20'] },
  })
  ctx.S.quoteRequests.push({
    id: uid(), provider_id: P.id, name: 'Monica Reyes', phone: '+16175550141', email: 'monica.reyes@example.com', address: '9 Park Dr, Boston, MA 02215',
    service: 'Move-out cleaning', description: '2 bedroom apartment, moving out at the end of the month.', photos: [], preferred_date: addDays(today, 12),
    language: 'en', status: 'new', client_id: null, document_id: null, ip_hash: null, created_at: new Date(Date.now() - 5 * 3600e3).toISOString(), updated_at: null,
  })
}

function beautyDocs(ctx) {
  const { P } = ctx
  withDocSettings(P, { legal: 'Ana Torres Hair' })
  catalogRows(ctx, [
    ['noiva', 'Penteado de noiva', 'Com teste uma semana antes.', 'service', 'un', 25000, false],
    ['madrinha', 'Penteado de madrinha', null, 'service', 'un', 12000, false],
    ['make', 'Maquiagem', null, 'service', 'un', 15000, false],
    ['desloc', 'Taxa de deslocamento', 'Atendimento no local do evento.', 'fee', 'un', 5000, false],
  ])
  makeDoc(ctx, {
    kind: 'invoice', client: 'Ashley', title: 'Hair & makeup — engagement photoshoot', lang: 'en', issue: -12, due: -5,
    items: [['Hair styling', 'service', 'un', 1, 9000, false], ['Makeup', 'service', 'un', 1, 15000, false, 'make'], ['Travel fee', 'fee', 'un', 1, 5000, false, 'desloc']],
    notes: 'Thank you!', terms: null, pi: 'Zelle: (617) 555-0142 · Ana Torres',
    tl: { sent: [-12, 'email', '19:00'], viewed: [-12, '19:40'], payments: [[-11, 'rest', 'zelle', 'Zelle']] },
  })
  makeDoc(ctx, {
    kind: 'quote', client: 'Gabriela', title: 'Dia da noiva — penteado e maquiagem (noiva + 3 madrinhas)', lang: 'pt', issue: -4, deposit_pct: 30,
    items: [
      ['Penteado de noiva', 'service', 'un', 1, 25000, false, 'noiva'], ['Maquiagem da noiva', 'service', 'un', 1, 15000, false, 'make'],
      ['Penteado de madrinha', 'service', 'un', 3, 12000, false, 'madrinha'], ['Taxa de deslocamento', 'fee', 'un', 1, 5000, false, 'desloc'],
    ],
    terms: 'Entrada de 30% pra reservar a data. Cancelamento com menos de 15 dias: a entrada não é devolvida.',
    tl: { sent: [-4, 'whatsapp', '20:00'], viewed: [-4, '20:25'] },
    status: 'viewed',
  })
  makeDoc(ctx, {
    kind: 'invoice', client: 'Carolina', title: 'Pacote de 3 hidratações', lang: 'pt', issue: -2, due: 5,
    items: [['Hidratação + escova (pacote com 3 sessões)', 'service', 'un', 3, 7500, false]],
    tl: { sent: [-2, 'whatsapp', '17:15'] },
  })
}
