/**
 * Pedidos de orçamento (WorkPro): formulário "Pedir orçamento" da página /agenda/:slug.
 *
 * Público (sem login):
 *   GET  ?slug=  → { enabled }   a página pergunta se mostra o formulário
 *   POST { slug, name, phone?, email?, address?, service?, description?, preferred_date?
 *          ('YYYY-MM-DD'), language? ('pt'|'en'|'es'), photos?: [data URL jpeg/png/webp ≤ 500 KB, até 3],
 *          website (isca anti-robô: preenchida → finge sucesso e não grava) } → 201 { ok: true }
 *        Nome + telefone ou e-mail obrigatórios. Fotos vão pro bucket 'uploads' em
 *        requests/<provider_id>/<uuid>.<ext>. NÃO cria ficha de cliente (spam não deixa lixo em
 *        Clientes): só liga o pedido a uma ficha que já existe com o mesmo telefone (ou e-mail),
 *        sem desarquivar. A ficha nova nasce no convert. Grava o pedido, push 'documents' e
 *        e-mail pra profissional.
 *        Limite por IP (memória) + no máximo 5 pedidos por IP/profissional em 24h (ip_hash).
 * Com JWT (profissional):
 *   GET  ?status=new|contacted|quoted|closed|spam|open  → { requests: [Req], counts }
 *        Sem status: todos (o app filtra). counts: { new, contacted, quoted, closed, spam, open, total }.
 *   POST { action: 'update_status', id, status } → { ok, request }       recurso 'quote_requests'
 *   POST { action: 'convert', id } → 201 { document }                     recurso 'quotes' + limite documents_month
 *        Orçamento rascunho pelo saveDocument (api/_lib/documents.js): cliente, título = serviço,
 *        notas = descrição, fotos (com 'job_photos'), quote_request_id e os padrões dela (imposto,
 *        validade, condições); o pedido vira 'quoted'. Já convertido → 200 com o mesmo documento.
 *        Cliente: sem ficha ligada, acha/cria pelo telefone ou e-mail do pedido. Com ficha, o
 *        documento leva o e-mail/telefone/endereço digitados no pedido e a ficha ganha os que
 *        faltavam nela (nada que ela já tinha é trocado).
 *
 * Quando o formulário aparece: plano com 'quote_requests' e app_settings.quote_requests_public
 * (true/false); sem a preferência, liga sozinho pra quem é do tipo 'trades' (quoteFormEnabled).
 */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { rateLimit } from '../_lib/rateLimit.js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { hasFeature, requireFeature, requireLimit, limitFor } from '../_lib/agendaPlans.js'
import { sendPushToProvider } from '../_lib/agendaPush.js'
import { normalizePhone } from '../_lib/phone.js'
import { addDays, isDateKey, todayIn } from '../_lib/recurring.js'
import { DOC_COLS, shapeDoc, saveDocument, zonedDayStartIso, dateKeyIn } from '../_lib/documents.js'

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } }

export const REQUEST_STATUSES = ['new', 'contacted', 'quoted', 'closed', 'spam']
const LANGS = ['pt', 'en', 'es']
const EMAIL_RE = /^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9-]{1,80}$/
const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 500 * 1024
const PER_IP_DAY = 5
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const REQ_COLS = 'id, name, phone, email, address, service, description, photos, preferred_date, language, status, client_id, document_id, created_at, updated_at'
const PUBLIC_PROV_COLS = 'id, name, email, slug, vertical, timezone, app_settings, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at'

// ── Funções puras (exportadas pra testes e pra api/agenda/provider.js) ─────────

const int = (v, min, max, def) => {
  const n = Math.round(Number(v))
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}
const clip = (v, n) => {
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n)
  return s || null
}
const oneLine = (v, n) => {
  const s = clip(v, n * 2)
  return s ? s.replace(/\s+/g, ' ').trim().slice(0, n) || null : null
}

/** O formulário "Pedir orçamento" aparece na página pública dessa profissional? */
export function quoteFormEnabled(provider) {
  if (!provider || provider.active === false) return false
  if (!hasFeature(provider, 'quote_requests')) return false
  const pref = provider.app_settings && typeof provider.app_settings === 'object' ? provider.app_settings.quote_requests_public : undefined
  if (pref === true || pref === false) return pref
  return provider.vertical === 'trades'
}

/**
 * Foto do formulário: data URL jpeg/png/webp até 500 KB, conferindo o começo do arquivo.
 * → { mime, ext, buf } ou { error }
 */
export function parsePhoto(v) {
  if (typeof v !== 'string' || v.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 64) return { error: 'big' }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(v)
  if (!m) return { error: 'format' }
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length) return { error: 'format' }
  if (buf.length > MAX_PHOTO_BYTES) return { error: 'big' }
  const mime = m[1]
  const ok = mime === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    : mime === 'image/png' ? buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      : buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'
  if (!ok) return { error: 'format' }
  return { mime, ext: EXT_BY_MIME[mime], buf }
}

/**
 * Lê e valida o pedido público. `todayKey` = hoje no fuso da profissional.
 * → { fields, photos: [{ mime, ext, buf }] } ou { error }
 */
export function readPublicRequest(b, todayKey) {
  const name = oneLine(b.name, 120)
  if (!name || name.length < 2) return { error: 'Diga seu nome.' }

  const rawPhone = clip(b.phone, 40)
  let phone = null
  if (rawPhone) {
    phone = normalizePhone(rawPhone)
    if (!phone) return { error: 'Telefone inválido. Coloque o código de área e o número, ex.: (512) 555-0101.' }
  }
  const email = clip(b.email, 254)?.toLowerCase() || null
  if (email && !EMAIL_RE.test(email)) return { error: 'E-mail inválido.' }
  if (!phone && !email) return { error: 'Informe telefone ou e-mail pra receber o orçamento.' }

  let preferred = null
  const pd = clip(b.preferred_date, 10)
  if (pd) {
    if (!isDateKey(pd)) return { error: 'Data inválida.' }
    if (todayKey && pd < todayKey) return { error: 'Escolha uma data a partir de hoje.' }
    if (todayKey && pd > addDays(todayKey, 730)) return { error: 'Escolha uma data mais próxima.' }
    preferred = pd
  }

  const list = b.photos == null ? [] : b.photos
  if (!Array.isArray(list)) return { error: 'Fotos inválidas.' }
  const sent = list.filter((p) => p !== null && p !== undefined && p !== '')
  if (sent.length > MAX_PHOTOS) return { error: `No máximo ${MAX_PHOTOS} fotos.` }
  const photos = []
  for (const p of sent) {
    const ph = parsePhoto(p)
    if (ph.error === 'big') return { error: 'Foto grande demais. Cada foto pode ter até 500 KB.' }
    if (ph.error) return { error: 'Foto inválida. Use JPG, PNG ou WebP.' }
    photos.push(ph)
  }

  return {
    fields: {
      name,
      phone,
      email,
      address: oneLine(b.address, 300),
      service: oneLine(b.service, 120),
      description: clip(b.description, 3000),
      preferred_date: preferred,
      language: LANGS.includes(b.language) ? b.language : 'pt',
    },
    photos,
  }
}

/** Hash do IP pro anti-abuso (nunca guarda o IP cru). */
export function ipHash(ip, salt = process.env.IP_HASH_SALT || process.env.CRON_SECRET || 'bc-quote-requests') {
  return createHash('sha256').update(`${salt}|${String(ip || '')}`).digest('hex')
}

/** Contagem por situação; open = new + contacted; total = tudo menos spam. */
export function countByStatus(rows) {
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
    id: r.id,
    name: r.name,
    phone: r.phone || null,
    email: r.email || null,
    address: r.address || null,
    service: r.service || null,
    description: r.description || null,
    photos: Array.isArray(r.photos) ? r.photos : [],
    preferred_date: r.preferred_date || null,
    language: LANGS.includes(r.language) ? r.language : 'en',
    status: r.status,
    client_id: r.client_id || null,
    document_id: r.document_id || null,
    created_at: r.created_at,
    updated_at: r.updated_at || null,
  }
}

const fmtBR = (key) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '')

// ── Banco ────────────────────────────────────────────────────────────────────

/**
 * Ficha que já existe com o telefone (ou, sem telefone, o e-mail) do pedido → id, senão null.
 * Pedido público nunca cria nem desarquiva ficha: isso só acontece quando a profissional converte.
 */
async function findExistingClient(supabase, pid, f) {
  try {
    if (!f.phone && !f.email) return null
    // Fichas antigas podem ter o número sem '+' (mesma ideia de appointments.js)
    const digits = f.phone ? f.phone.slice(1) : ''
    const variants = f.phone ? [...new Set([f.phone, digits, digits.startsWith('1') ? digits.slice(1) : digits])] : []
    const q = supabase.from('ag_clients').select('id').eq('provider_id', pid)
    const { data } = await (f.phone ? q.in('whatsapp', variants) : q.eq('email', f.email)).limit(1)
    return data?.[0]?.id || null
  } catch (e) {
    console.error('[quote-requests] ficha:', e.message)
    return null
  }
}

/**
 * Convert com ficha ligada: completa na ficha o que estava vazio (e-mail, WhatsApp, endereço) com o
 * que a cliente digitou no pedido. Nunca troca o que já tinha. Best effort.
 */
async function fillClientGaps(supabase, pid, ficha, qr) {
  try {
    const patch = {}
    if (qr.email && !ficha.email) patch.email = qr.email
    if (qr.phone && !ficha.whatsapp) patch.whatsapp = qr.phone
    if (qr.address && 'address_line' in ficha && !ficha.address_line) patch.address_line = String(qr.address).slice(0, 160)
    if (!Object.keys(patch).length) return
    const { error } = await supabase.from('ag_clients').update(patch).eq('id', ficha.id).eq('provider_id', pid)
    // Telefone já usado por outra ficha (índice único): grava o resto
    if (error && patch.whatsapp) {
      delete patch.whatsapp
      if (Object.keys(patch).length) await supabase.from('ag_clients').update(patch).eq('id', ficha.id).eq('provider_id', pid)
    } else if (error) console.error('[quote-requests] completar ficha:', error.message)
  } catch (e) {
    console.error('[quote-requests] completar ficha:', e.message)
  }
}

async function uploadPhotos(supabase, pid, photos) {
  const urls = []
  for (const ph of photos) {
    const path = `requests/${pid}/${randomUUID()}.${ph.ext}`
    const { error } = await supabase.storage.from('uploads').upload(path, ph.buf, { contentType: ph.mime, upsert: false })
    if (error) { console.error('[quote-requests] foto:', error.message); continue }
    const { data } = supabase.storage.from('uploads').getPublicUrl(path)
    if (data?.publicUrl) urls.push(data.publicUrl)
  }
  return urls
}

async function notifyProvider(supabase, prov, req) {
  const title = `Pedido de orçamento: ${req.name}${req.service ? ' · ' + req.service : ''}`
  const body = req.description ? req.description.replace(/\s+/g, ' ').slice(0, 160) : (req.address || 'Toque pra ver e responder')
  await sendPushToProvider(supabase, prov.id, { kind: 'documents', title, body, data: { type: 'quote_request', id: req.id } })

  // E-mail (quem não tem o app no celular também fica sabendo). Mutado junto com o push.
  if (!prov.email || (prov.app_settings && prov.app_settings.notify_documents === false)) return
  try {
    const { sendTransactional } = await import('../_lib/mailer.js')
    const { escapeHtml } = await import('../_lib/emailShell.js')
    await sendTransactional({
      to: prov.email,
      subject: title.slice(0, 140),
      kicker: 'PEDIDO DE ORÇAMENTO',
      title: 'Novo pedido de orçamento',
      paragraphs: [
        `<strong>${escapeHtml(req.name)}</strong> pediu orçamento pela sua página${req.service ? `: <strong>${escapeHtml(req.service)}</strong>` : ''}.`,
        req.description ? `“${escapeHtml(req.description.slice(0, 600))}”` : '',
        [req.phone ? `Telefone: ${escapeHtml(req.phone)}` : '', req.email ? `E-mail: ${escapeHtml(req.email)}` : ''].filter(Boolean).join(' · '),
        req.address ? `Endereço: ${escapeHtml(req.address)}` : '',
        req.preferred_date ? `Data desejada: ${escapeHtml(fmtBR(req.preferred_date))}` : '',
        req.photos?.length ? `${req.photos.length} foto(s) no pedido.` : '',
        'Abra o app pra ver as fotos e fazer o orçamento em poucos toques. Quem responde primeiro costuma fechar o serviço.',
      ].filter(Boolean),
    })
  } catch (e) {
    console.error('[quote-requests] e-mail:', e.message)
  }
}

// ── Rotas ────────────────────────────────────────────────────────────────────

function limited(req, bucket, windowMs, max) {
  return rateLimit({ headers: req.headers || {}, url: `/api/agenda/quote-requests:${bucket}` }, { windowMs, max })
}

async function loadPublicProvider(supabase, slugRaw) {
  const slug = String(slugRaw || '').toLowerCase().trim()
  if (!SLUG_RE.test(slug)) return null
  let { data, error } = await supabase.from('ag_providers').select(PUBLIC_PROV_COLS).eq('slug', slug).eq('active', true).maybeSingle()
  if (error) {
    // Banco sem a coluna vertical/app_settings: só o plano decide (formulário desligado)
    const retry = await supabase.from('ag_providers').select('id, name, email, slug, active, plan, plan_status, trial_ends_at, current_period_end, stripe_subscription_id, created_at')
      .eq('slug', slug).eq('active', true).maybeSingle()
    data = retry.data || null
  }
  return data || null
}

async function publicCreate(req, res, supabase) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}

  const rl = limited(req, 'pub', 60000, 5) || limited(req, 'pub-hour', 3600000, 20)
  if (rl) return res.status(429).json({ error: `Muitos pedidos seguidos. Tente de novo em ${rl.retryAfter}s.`, code: 'rate_limited' })

  // Isca: robô preenche o campo escondido. Finge que deu certo e não grava nada.
  if (b.website !== undefined && b.website !== null && String(b.website).trim() !== '') return res.status(201).json({ ok: true })

  const prov = await loadPublicProvider(supabase, b.slug)
  if (!prov) return res.status(404).json({ error: 'Profissional não encontrado(a).', code: 'not_found' })
  if (!quoteFormEnabled(prov)) {
    return res.status(403).json({ error: 'Este perfil não está recebendo pedidos de orçamento pela página no momento. Fale direto pelo telefone ou WhatsApp.', code: 'disabled' })
  }

  const today = todayIn(prov.timezone || 'America/New_York')
  const read = readPublicRequest(b, today)
  if (read.error) return res.status(400).json({ error: read.error, code: 'invalid' })

  const ip = String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '').split(',')[0].trim()
  const hash = ipHash(ip || 'sem-ip')
  const since = new Date(Date.now() - 24 * 3600e3).toISOString()
  const { count } = await supabase.from('ag_quote_requests').select('id', { count: 'exact', head: true })
    .eq('provider_id', prov.id).eq('ip_hash', hash).gte('created_at', since)
  if ((count || 0) >= PER_IP_DAY) {
    return res.status(429).json({ error: 'Recebemos vários pedidos seus hoje. Aguarde o retorno ou fale direto com o profissional.', code: 'rate_limited' })
  }

  const f = read.fields
  const photos = await uploadPhotos(supabase, prov.id, read.photos)
  const clientId = await findExistingClient(supabase, prov.id, f)

  const { data: row, error } = await supabase.from('ag_quote_requests').insert({
    provider_id: prov.id, ...f, photos, status: 'new', client_id: clientId, ip_hash: hash,
  }).select(REQ_COLS).single()
  if (error) {
    console.error('[quote-requests] gravar:', error.message)
    return res.status(500).json({ error: 'Não conseguimos enviar seu pedido agora. Tente de novo em instantes.', code: 'server_error' })
  }

  await notifyProvider(supabase, prov, row)
  return res.status(201).json({ ok: true, photos_saved: photos.length, photos_failed: read.photos.length - photos.length })
}

async function convertRequest(res, supabase, provider, id) {
  const pid = provider.id
  const tz = provider.timezone || 'America/New_York'
  const today = dateKeyIn(tz)
  const { data: qr, error } = await supabase.from('ag_quote_requests').select(REQ_COLS).eq('id', id).eq('provider_id', pid).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!qr) return res.status(404).json({ error: 'Pedido não encontrado' })

  // Já virou orçamento: devolve o mesmo
  if (qr.document_id) {
    const { data: existing } = await supabase.from('ag_documents').select(DOC_COLS).eq('id', qr.document_id).eq('provider_id', pid).maybeSingle()
    if (existing) return res.status(200).json({ document: shapeDoc(existing, { today }), existing: true })
  }

  // Limite de documentos do mês (Starter), mesma conta de api/agenda/documents.js
  if (limitFor(provider, 'documents_month') !== null) {
    const { count, error: cErr } = await supabase.from('ag_documents').select('id', { count: 'exact', head: true })
      .eq('provider_id', pid).gte('created_at', zonedDayStartIso(`${today.slice(0, 7)}-01`, tz))
    if (cErr) return res.status(500).json({ error: cErr.message })
    const lim = requireLimit(provider, 'documents_month', count || 0)
    if (!lim.ok) return res.status(lim.status).json(lim.body)
  }

  // Cliente: a ficha ligada ao pedido (se ainda existir) ou os dados do pedido (acha/cria a ficha)
  let clientId = null
  if (qr.client_id) {
    let r = await supabase.from('ag_clients').select('id, email, whatsapp, address_line').eq('id', qr.client_id).eq('provider_id', pid).maybeSingle()
    if (r.error) r = await supabase.from('ag_clients').select('id, email, whatsapp').eq('id', qr.client_id).eq('provider_id', pid).maybeSingle()
    if (r.data) {
      clientId = r.data.id
      await fillClientGaps(supabase, pid, r.data, qr)
    }
  }
  // Com ficha: o nome fica o da ficha; e-mail/telefone/endereço digitados no pedido vão pro documento
  const typed = { email: qr.email || null, phone: qr.phone || null, address: qr.address || null }
  const input = {
    kind: 'quote',
    ...(clientId
      ? { client_id: clientId, client: typed }
      : { client: { name: qr.name || 'Cliente', ...typed } }),
    language: LANGS.includes(qr.language) ? qr.language : 'en',
    quote_request_id: qr.id,
    internal_notes: [
      `Pedido pela página em ${fmtBR(dateKeyIn(tz, new Date(qr.created_at || Date.now())) || '')}.`,
      qr.preferred_date ? `Data desejada: ${fmtBR(String(qr.preferred_date).slice(0, 10))}.` : '',
      qr.phone ? `Telefone: ${qr.phone}.` : '',
      qr.email ? `E-mail: ${qr.email}.` : '',
    ].filter(Boolean).join(' '),
  }
  if (qr.service) input.title = qr.service
  if (qr.address) input.job_address = qr.address
  if (qr.description) input.notes = qr.description
  // Fotos do pedido no orçamento: recurso 'job_photos' (Pro); só links https do nosso storage
  const photos = (Array.isArray(qr.photos) ? qr.photos : []).filter((u) => /^https:\/\/[^\s"'<>]+$/i.test(String(u || ''))).slice(0, 12)
  if (photos.length && hasFeature(provider, 'job_photos')) input.photos = photos

  const saved = await saveDocument(supabase, provider, input, { eventDetail: { from: 'quote_request', request_id: qr.id } })
  if (!saved.ok) return res.status(saved.status).json(saved.body)

  // saveDocument já liga e marca 'quoted' quando o pedido estava novo/em contato; aqui cobre arquivado/spam
  // e liga o pedido à ficha (criada agora, se ainda não havia)
  const up = await supabase.from('ag_quote_requests').update({
    status: 'quoted', document_id: saved.document.id, client_id: saved.document.client_id || clientId || null, updated_at: new Date().toISOString(),
  }).eq('id', qr.id).eq('provider_id', pid)
  if (up.error) console.error('[quote-requests] marcar quoted:', up.error.message)

  return res.status(201).json({ document: saved.document })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const hasAuth = String(req.headers?.authorization || req.headers?.Authorization || '').startsWith('Bearer ')
    const body = req.body && typeof req.body === 'object' ? req.body : {}

    // ── Público ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && !hasAuth && req.query?.slug) {
      const rl = limited(req, 'check', 60000, 60)
      if (rl) return res.status(429).json({ error: 'Muitas requisições. Tente de novo em instantes.' })
      const prov = await loadPublicProvider(supabase, req.query.slug)
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      return res.status(200).json({ enabled: quoteFormEnabled(prov) })
    }
    if (req.method === 'POST' && !body.action) {
      res.setHeader('Cache-Control', 'no-store')
      return await publicCreate(req, res, supabase)
    }

    // ── Profissional ─────────────────────────────────────────────────────
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    const pid = provider.id
    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      const status = String(req.query?.status || '')
      const limit = int(req.query?.limit, 1, 500, 300)
      let q = supabase.from('ag_quote_requests').select(REQ_COLS).eq('provider_id', pid)
        .order('created_at', { ascending: false }).limit(limit)
      if (REQUEST_STATUSES.includes(status)) q = q.eq('status', status)
      else if (status === 'open') q = q.in('status', ['new', 'contacted'])
      const [list, all] = await Promise.all([
        q,
        supabase.from('ag_quote_requests').select('status').eq('provider_id', pid).limit(5000),
      ])
      if (list.error) return res.status(500).json({ error: list.error.message })
      return res.status(200).json({ requests: (list.data || []).map(shapeRequest), counts: countByStatus(all.data || []) })
    }

    const action = String(body.action || '')
    const id = String(body.id || '')
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Pedido inválido' })

    if (action === 'update_status') {
      const gate = requireFeature(provider, 'quote_requests')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const status = String(body.status || '')
      if (!REQUEST_STATUSES.includes(status)) return res.status(400).json({ error: 'Situação inválida' })
      const { data, error } = await supabase.from('ag_quote_requests')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id).eq('provider_id', pid).select(REQ_COLS).maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      if (!data) return res.status(404).json({ error: 'Pedido não encontrado' })
      return res.status(200).json({ ok: true, request: shapeRequest(data) })
    }

    if (action === 'convert') {
      const gate = requireFeature(provider, 'quotes')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      return await convertRequest(res, supabase, provider, id)
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    console.error('[quote-requests] erro:', e.message)
    return res.status(500).json({ error: 'Erro no pedido de orçamento. Tente de novo.' })
  }
}
