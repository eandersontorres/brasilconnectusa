/**
 * Shippo (etiquetas e rastreio) para a BrasilConnect Store. fetch puro, sem SDK.
 *
 * Variaveis:
 *   SHIPPO_API_TOKEN       shippo_test_... (desenvolvimento) ou shippo_live_...
 *   SHIPPO_PLATFORM_MODE   '1' quando a conta for Platform Account (white label).
 *                          Ai cada loja ganha uma managed account (header
 *                          SHIPPO-ACCOUNT-ID), como a Shippo exige de marketplaces.
 *                          Sem isso, tudo sai da conta principal (use so em teste).
 *   SHIPPO_WEBHOOK_TOKEN   segredo que vai na URL do webhook (?token=)
 *
 * Quem paga a etiqueta e a BrasilConnect (cartao na Shippo); o custo sai do
 * repasse do vendedor (bc_store_orders.label_cost_cents).
 */
const BASE = 'https://api.goshippo.com'

export function shippoEnabled() {
  return !!process.env.SHIPPO_API_TOKEN
}
export function shippoTestMode() {
  return String(process.env.SHIPPO_API_TOKEN || '').startsWith('shippo_test_')
}
export function platformMode() {
  return process.env.SHIPPO_PLATFORM_MODE === '1'
}

export async function shippo(path, { method = 'GET', body, accountId, timeoutMs = 10000 } = {}) {
  if (!shippoEnabled()) {
    const e = new Error('Etiquetas ainda não configuradas (SHIPPO_API_TOKEN).')
    e.status = 503
    throw e
  }
  const headers = {
    Authorization: `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
    'Content-Type': 'application/json',
    'SHIPPO-API-VERSION': '2018-02-08',
  }
  if (accountId && platformMode()) headers['SHIPPO-ACCOUNT-ID'] = accountId
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs))
  let r
  try {
    r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detail = typeof data === 'object' ? (data.detail || data.messages?.[0]?.text || JSON.stringify(data).slice(0, 300)) : String(data)
    const e = new Error(`Shippo ${r.status}: ${detail}`)
    e.status = r.status
    e.data = data
    throw e
  }
  return data
}

const cents = (amount) => Math.round(parseFloat(amount || '0') * 100)

/** Endereco no formato da Shippo a partir do nosso {name, street1|line1, ...}. */
export function toShippoAddress(a, { email } = {}) {
  if (!a) return null
  return {
    name: String(a.name || '').slice(0, 60),
    company: a.company ? String(a.company).slice(0, 60) : undefined,
    street1: String(a.street1 || a.line1 || '').slice(0, 100),
    street2: (a.street2 || a.line2) ? String(a.street2 || a.line2).slice(0, 100) : undefined,
    city: String(a.city || '').slice(0, 60),
    state: String(a.state || '').toUpperCase().slice(0, 2),
    zip: String(a.zip || '').slice(0, 10),
    country: 'US',
    phone: a.phone ? String(a.phone).slice(0, 20) : undefined,
    email: email || undefined,
  }
}

/**
 * Valida endereco (v2). Retorna { result: valid|partially_valid|invalid|unknown,
 * address_type, recommended } ou null se a Shippo nao estiver configurada.
 */
export async function validateAddress(a) {
  if (!shippoEnabled() || !a) return null
  const q = new URLSearchParams({
    address_line_1: a.street1 || a.line1 || '',
    city_locality: a.city || '',
    state_province: String(a.state || '').toUpperCase(),
    postal_code: a.zip || '',
    country_code: 'US',
  })
  if (a.street2 || a.line2) q.set('address_line_2', a.street2 || a.line2)
  try {
    const d = await shippo('/v2/addresses/validate?' + q.toString(), { timeoutMs: 5000 })
    return {
      result: d?.analysis?.validation_result?.value || 'unknown',
      reasons: (d?.analysis?.validation_result?.reasons || []).map(x => x.description || x.code).filter(Boolean),
      address_type: d?.analysis?.address_type || 'unknown',
      recommended: d?.recommended_address || null,
    }
  } catch (e) {
    console.error('[shippo] validate falhou:', e.message)
    return { result: 'unknown', reasons: [], address_type: 'unknown', recommended: null }
  }
}

/**
 * Garante a managed account da loja (Platform Account) com USPS ativo.
 * Sem SHIPPO_PLATFORM_MODE, nao faz nada (usa a conta principal).
 */
export async function ensureSellerAccount(supabase, seller) {
  if (!platformMode()) return { accountId: null, carrierAccountId: null }
  let accountId = seller.shippo_account_id
  let carrierId = seller.shippo_carrier_account_id
  if (!accountId) {
    const parts = String(seller.ship_from?.name || seller.name || 'Loja').trim().split(/\s+/)
    const acc = await shippo('/shippo-accounts', {
      method: 'POST',
      body: {
        email: seller.email,
        first_name: parts[0] || 'Loja',
        last_name: parts.slice(1).join(' ') || 'BrasilConnect',
        company_name: String(seller.name || 'Loja').slice(0, 60),
      },
    })
    accountId = acc.object_id
    await supabase.from('bc_store_sellers').update({ shippo_account_id: accountId }).eq('id', seller.id)
  }
  if (!carrierId) {
    try {
      await shippo('/carrier_accounts/register/new', { method: 'POST', accountId, body: { carrier: 'usps', parameters: {} } })
    } catch (e) {
      // ja registrado: segue para buscar
      if (e.status && e.status >= 500) throw e
    }
    const list = await shippo('/carrier_accounts?carrier=usps', { accountId })
    carrierId = (list?.results || [])[0]?.object_id || null
    if (carrierId) await supabase.from('bc_store_sellers').update({ shippo_carrier_account_id: carrierId }).eq('id', seller.id)
  }
  return { accountId, carrierAccountId: carrierId }
}

/**
 * Cotacao para comprar a etiqueta.
 * parcel: { length, width, height (in), weight_oz }
 * Retorna { shipment_id, rates: [{rate_id, provider, service, service_token, amount_cents, days, duration_terms, attributes}] }
 */
export async function getRates({ from, to, parcel, accountId = null, carrierAccounts = null, hazmat = false, returnAddress = null, metadata = null }) {
  const body = {
    address_from: from,
    address_to: to,
    parcels: [{
      length: String(parcel.length), width: String(parcel.width), height: String(parcel.height),
      distance_unit: 'in', weight: String(parcel.weight_oz), mass_unit: 'oz',
    }],
    async: false,
  }
  if (returnAddress) body.address_return = returnAddress
  if (carrierAccounts?.length) body.carrier_accounts = carrierAccounts
  if (hazmat) body.extra = { dangerous_goods: { contains: true } }
  if (metadata) body.metadata = String(metadata).slice(0, 100)
  const sh = await shippo('/shipments/', { method: 'POST', body, accountId, timeoutMs: 15000 })
  let rates = (sh.rates || []).map(r => ({
    rate_id: r.object_id,
    provider: r.provider,
    service: r.servicelevel?.name || r.servicelevel?.token || '',
    service_token: r.servicelevel?.token || '',
    amount_cents: cents(r.amount),
    currency: r.currency,
    days: r.estimated_days ?? null,
    duration_terms: r.duration_terms || null,
    attributes: r.attributes || [],
  })).filter(r => r.currency === 'USD' && r.amount_cents > 0)
  // Material perigoso (perfume, esmalte, aerossol) so por terra
  if (hazmat) rates = rates.filter(r => /ground/i.test(r.service_token + ' ' + r.service))
  rates.sort((a, b) => a.amount_cents - b.amount_cents)
  return {
    shipment_id: sh.object_id,
    rates,
    messages: (sh.messages || []).map(m => m.text).filter(Boolean).slice(0, 5),
  }
}

/** Le uma rate (para conferir o preco no servidor antes de comprar). */
export async function getRate(rateId, accountId = null) {
  const r = await shippo('/rates/' + encodeURIComponent(rateId), { accountId, timeoutMs: 8000 })
  return {
    rate_id: r.object_id, provider: r.provider,
    service: r.servicelevel?.name || '', service_token: r.servicelevel?.token || '',
    amount_cents: cents(r.amount), currency: r.currency, shipment_id: r.shipment || null,
  }
}

/**
 * Compra a etiqueta. Espera ate sair de QUEUED/WAITING, dentro de um prazo total
 * (deadlineMs) que cabe no tempo da funcao. Se o prazo acabar, devolve o status
 * QUEUED: quem chamou mantem o pedido em 'purchasing' e o cron confere depois.
 * Retorna { transaction_id, status, label_url, tracking_number, tracking_url, messages }
 */
export async function buyLabel({ rateId, accountId = null, labelFileType = 'PDF_4x6', metadata = null, deadlineMs = 20000 }) {
  const until = Date.now() + Math.max(5000, deadlineMs)
  // async:true devolve o object_id na hora: mesmo que a etiqueta demore, o pedido
  // fica com o id da transacao e o cron consegue conferir depois.
  let tx = await shippo('/transactions', {
    method: 'POST', accountId, timeoutMs: Math.min(15000, until - Date.now()),
    body: { rate: rateId, label_file_type: labelFileType, async: true, metadata: metadata ? String(metadata).slice(0, 100) : undefined },
  })
  while ((tx.status === 'QUEUED' || tx.status === 'WAITING') && until - Date.now() > 2500) {
    await new Promise(r => setTimeout(r, 1500))
    try {
      tx = await shippo('/transactions/' + tx.object_id, { accountId, timeoutMs: Math.max(1000, Math.min(5000, until - Date.now())) })
    } catch (_) {
      // erro na consulta nao apaga o id ja criado: fica QUEUED para o cron conferir
      break
    }
  }
  return {
    transaction_id: tx.object_id,
    status: tx.status,
    label_url: tx.label_url || null,
    tracking_number: tx.tracking_number || null,
    tracking_url: tx.tracking_url_provider || null,
    messages: (tx.messages || []).map(m => m.text).filter(Boolean),
  }
}

/**
 * Procura uma transacao (etiqueta) de um pedido quando o id se perdeu (timeout
 * no POST). Casa por metadata 'order:<id>' ou pela rate usada.
 */
export async function findTransaction({ orderId, rateId = null, accountId = null }) {
  const d = await shippo('/transactions/?results=50', { accountId, timeoutMs: 8000 })
  const list = d?.results || []
  const meta = 'order:' + orderId
  const hit = list.find(t => t.metadata === meta) || (rateId ? list.find(t => (typeof t.rate === 'string' ? t.rate : t.rate?.object_id) === rateId) : null)
  if (!hit) return null
  return {
    transaction_id: hit.object_id, status: hit.status, label_url: hit.label_url || null,
    tracking_number: hit.tracking_number || null, tracking_url: hit.tracking_url_provider || null,
    rate_id: typeof hit.rate === 'string' ? hit.rate : hit.rate?.object_id || null,
  }
}

/** Pede reembolso de etiqueta nao usada (vira credito na fatura Shippo). */
export async function refundLabel({ transactionId, accountId = null }) {
  // status: QUEUED | PENDING | SUCCESS | ERROR (ERROR = etiqueta ja usada)
  const r = await shippo('/refunds/', { method: 'POST', accountId, body: { transaction: transactionId, async: false }, timeoutMs: 10000 })
  return { refund_id: r.object_id, status: r.status }
}

/** Situacao atual do rastreio. carrier: usps | ups | fedex | dhl_express | shippo (teste) */
export async function getTrack(carrier, trackingNumber) {
  const d = await shippo(`/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`)
  return {
    status: d?.tracking_status?.status || 'UNKNOWN',
    substatus: d?.tracking_status?.substatus?.code || d?.tracking_status?.substatus || null,
    details: d?.tracking_status?.status_details || null,
    date: d?.tracking_status?.status_date || null,
    eta: d?.eta || null,
    // destino do pacote segundo a transportadora (para conferir envio proprio)
    address_to: d?.address_to ? { zip: d.address_to.zip || null, state: d.address_to.state || null, city: d.address_to.city || null } : null,
  }
}

/** Registra um rastreio externo (envio proprio do vendedor) para receber webhook. */
export async function registerTrack({ carrier, trackingNumber, metadata = null }) {
  return shippo('/tracks/', { method: 'POST', body: { carrier, tracking_number: trackingNumber, metadata: metadata ? String(metadata).slice(0, 100) : undefined } })
}

/** Nome do carrier na Shippo a partir do que o vendedor digitou. */
export function normalizeCarrier(c) {
  const s = String(c || '').toLowerCase().replace(/[^a-z]/g, '')
  if (s.startsWith('usps') || s === 'correios' || s === 'postal') return 'usps'
  if (s.startsWith('ups')) return 'ups'
  if (s.startsWith('fedex')) return 'fedex'
  if (s.startsWith('dhl')) return 'dhl_express'
  if (s === 'shippo') return 'shippo'
  return null
}

/** Link publico de rastreio quando a Shippo nao devolve um. */
export function trackingUrlFor(carrier, number) {
  const n = encodeURIComponent(number || '')
  switch (carrier) {
    case 'usps': return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`
    case 'ups': return `https://www.ups.com/track?tracknum=${n}`
    case 'fedex': return `https://www.fedex.com/fedextrack/?trknbr=${n}`
    case 'dhl_express': return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`
    default: return null
  }
}

/** IPs de onde a Shippo manda webhook (regiao US). */
export const SHIPPO_WEBHOOK_IPS = ['52.4.41.98', '52.23.121.194', '52.44.110.80', '54.81.253.187', '54.81.255.221']
