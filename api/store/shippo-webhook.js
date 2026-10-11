/**
 * POST /api/store/shippo-webhook?token=SHIPPO_WEBHOOK_TOKEN
 *
 * Webhook de rastreio da Shippo (evento track_updated) da BrasilConnect Store.
 *
 * Seguranca (o corpo da Shippo nao e assinado enquanto o HMAC nao for ativado):
 *   1. token na URL comparado em tempo constante; sem SHIPPO_WEBHOOK_TOKEN -> 503
 *   2. com SHIPPO_WEBHOOK_ENFORCE_IP=1, so aceita os IPs da Shippo
 *      (SHIPPO_WEBHOOK_IPS da lib, ou a variavel de mesmo nome separada por virgula)
 *   3. o status e confirmado na Shippo (GET /tracks) antes de mexer no pedido;
 *      se a consulta falhar, usa o que veio no corpo
 *   4. applyTracking (storeOrders) confere a data da entrega (anterior ao envio = retido)
 *      e, em envio proprio, o destino do pacote (address_to) contra o endereco do pedido
 *
 * A Shippo espera 2xx em ate 3s e reenvia em 408/429/5xx. Erro interno -> log e 200
 * (para nao gerar reenvio em loop); so a autenticacao devolve erro.
 */
import crypto from 'node:crypto'
import { getSupabase } from '../_lib/store.js'
import { applyTracking } from '../_lib/storeOrders.js'
import { getTrack, normalizeCarrier, shippoTestMode, SHIPPO_WEBHOOK_IPS } from '../_lib/shippo.js'
import { rateLimit } from '../_lib/rateLimit.js'

export const config = { api: { bodyParser: false } }

const MAX_BODY_BYTES = 512 * 1024
const CONFIRM_TIMEOUT_MS = 2000
const TRACK_STATUSES = new Set(['PRE_TRANSIT', 'TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'])
// Rastreio retido como suspeito (data anterior ao envio, outro endereco): fica com o admin
const SUSPECT_HOLDS = new Set(['tracking_date_invalid', 'tracking_address_mismatch'])

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' })

  const limited = rateLimit(req, { windowMs: 60_000, max: 300 })
  if (limited) return res.status(429).json({ error: 'Muitas requisições. Tente de novo em 1 minuto.' })

  const expected = process.env.SHIPPO_WEBHOOK_TOKEN
  if (!expected) return res.status(503).json({ error: 'Webhook da Shippo não configurado.' })
  const token = typeof req.query?.token === 'string' ? req.query.token : ''
  if (!token || !safeEqual(token, expected)) return res.status(401).json({ error: 'Não autorizado.' })

  if (process.env.SHIPPO_WEBHOOK_ENFORCE_IP === '1') {
    const ip = requestIp(req)
    if (!ip || !allowedIps().includes(ip)) {
      console.error('[shippo webhook] IP fora da lista:', ip)
      return res.status(403).json({ error: 'Origem não autorizada.' })
    }
  }

  let body
  try {
    const raw = await readBody(req, MAX_BODY_BYTES)
    if (raw.length) body = JSON.parse(raw.toString('utf8'))
    else body = parsedBodyFallback(req)
  } catch (e) {
    return res.status(400).json({ error: 'Corpo inválido.' })
  }

  try {
    const result = await handleTrackEvent(body)
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.error('[shippo webhook] erro:', e.message)
    return res.status(200).json({ ok: true, logged: true })
  }
}

async function handleTrackEvent(body) {
  if (!body || body.event !== 'track_updated') return { ignored: 'evento' }
  // Evento de teste so vale com token de teste da Shippo
  if (body.test === true && !shippoTestMode()) return { ignored: 'teste' }

  const data = body.data || {}
  const number = String(data.tracking_number || '').trim().slice(0, 60)
  const rawCarrier = String(data.carrier || '').trim().toLowerCase()
  const carrier = normalizeCarrier(rawCarrier) || (/^[a-z0-9_]{2,40}$/.test(rawCarrier) ? rawCarrier : null)
  if (!number || !carrier) return { ignored: 'sem rastreio' }

  const supabase = getSupabase()
  const { data: orders, error } = await supabase.from('bc_store_orders').select('*')
    .eq('tracking_number', number).in('status', ['paid', 'shipped', 'delivered']).limit(10)
  if (error) throw new Error('pedidos: ' + error.message)
  // Mesmo numero em outra transportadora nao conta
  const list = (orders || []).filter(o => {
    const oc = normalizeCarrier(o.carrier)
    return !oc || oc === carrier
  })
  if (!list.length) return { ignored: 'pedido não encontrado' }

  // Confirma na Shippo; se a consulta falhar ou demorar, usa o corpo do webhook
  let t = null
  try {
    t = await withTimeout(getTrack(carrier, number), CONFIRM_TIMEOUT_MS)
  } catch (e) {
    console.error('[shippo webhook] getTrack falhou, usando o corpo do webhook:', e.message)
  }
  if (!t) {
    const ts = data.tracking_status || {}
    const at = data.address_to || null
    t = {
      status: ts.status,
      substatus: typeof ts.substatus === 'string' ? ts.substatus : (ts.substatus?.code || null),
      details: ts.status_details || null,
      date: ts.status_date || null,
      // destino segundo a transportadora (so serve para reter envio proprio suspeito)
      address_to: at ? { zip: at.zip || null, state: at.state || null, city: at.city || null } : null,
    }
  }
  const st = String(t.status || 'UNKNOWN').toUpperCase()
  if (!TRACK_STATUSES.has(st)) return { ignored: 'status' }

  let applied = 0
  for (const o of list) {
    // Mesmo status de um rastreio ja retido como suspeito: o admin decide, nao repete o aviso
    if (st === String(o.tracking_status || '').toUpperCase() && SUSPECT_HOLDS.has(o.hold_reason)) continue
    try {
      // applyTracking e idempotente: reenvio do mesmo evento nao duplica nada
      await applyTracking(supabase, o, {
        status: st,
        substatus: typeof t.substatus === 'string' ? t.substatus.slice(0, 60) : null,
        details: t.details ? String(t.details).slice(0, 500) : null,
        date: t.date || null,
        source: 'webhook',
        address_to: t.address_to || null,
      })
      applied++
    } catch (e) {
      console.error('[shippo webhook] pedido', o.id, e.message)
    }
  }
  return { applied }
}


// ─────────────────────────────────────────────────────────────────────────────
// Utilitarios
// ─────────────────────────────────────────────────────────────────────────────
/** Comparacao em tempo constante (hash para os dois lados terem o mesmo tamanho). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function requestIp(req) {
  const real = String(req.headers?.['x-real-ip'] || '').trim()
  if (real) return real
  return String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || null
}

function allowedIps() {
  const fromEnv = String(process.env.SHIPPO_WEBHOOK_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
  return fromEnv.length ? fromEnv : SHIPPO_WEBHOOK_IPS
}

/** Se o runtime ja tiver lido o corpo (stream vazio), usa o objeto que ele montou. */
function parsedBodyFallback(req) {
  try {
    const b = req.body
    if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b
    if (typeof b === 'string' && b) return JSON.parse(b)
  } catch (_) { /* corpo invalido */ }
  return {}
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    const b = typeof c === 'string' ? Buffer.from(c) : c
    size += b.length
    if (size > limit) throw new Error('corpo grande demais')
    chunks.push(b)
  }
  return Buffer.concat(chunks)
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('tempo esgotado')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
