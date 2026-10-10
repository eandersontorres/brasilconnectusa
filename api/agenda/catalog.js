/**
 * Tabela de preços da profissional (serviços, mão de obra, materiais, taxas) usada pra
 * montar orçamento e fatura em segundos.
 *
 * GET  /api/agenda/catalog   com JWT (leitura liberada mesmo sem plano)
 *      ?active=1 → só os ativos
 *      → { items: [CatalogItem] }   CatalogItem: id, name, description, kind, unit,
 *                                    unit_price_cents, taxable, active, display_order
 * POST /api/agenda/catalog   com JWT (recurso 'price_book')   Body: { action, ... }
 *      create  { name, description?, kind?, unit?, unit_price_cents?, taxable?, active? }
 *      update  { id, ...mesmos campos (parcial) }
 *      delete  { id }                         (itens já usados em documentos ficam lá, só sem o vínculo)
 *      reorder { ids: [uuid, ...] }           ordem nova (display_order = posição)
 *      seed    { specialty?, language? }      itens de EXEMPLO da especialidade (preço de referência
 *              em USD pra ajustar); não repete nome que já existe. specialty = rótulo do cadastro
 *              ('Construção e reforma', 'Tradutor juramentado'...) ou chave; vazio = a do perfil.
 *              language pt|en|es = idioma dos nomes (padrão: idioma dos documentos ou pt).
 *              → { ok, created, specialty, items }
 */
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature } from '../_lib/agendaPlans.js'
import { ITEM_KINDS } from '../_lib/docCalc.js'
import { cleanUnit, cleanText, isUuid, MAX_UNIT_PRICE_CENTS, DOC_LANGS } from '../_lib/documents.js'

const COLS = 'id, name, description, kind, unit, unit_price_cents, taxable, active, display_order'
const MAX_ITEMS = 1000
const SAMPLE_NOTE = 'Preço de exemplo: ajuste ao seu.'

/**
 * Exemplos por especialidade: [pt, en, es, kind, unit, preço em centavos, tributável].
 * Preços de REFERÊNCIA (média de mercado nos EUA), só pra começar — a profissional ajusta.
 */
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

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Rótulo do cadastro ou chave → chave de SEEDS. */
export function specialtyKey(v) {
  const s = plain(v)
  if (!s) return 'generico'
  if (SEEDS[s]) return s
  const rules = [
    [/constru|reforma|remodel|general contractor|empreit/, 'construcao'],
    [/handyman|faz[- ]tudo|marido de aluguel/, 'handyman'],
    [/marcen|carpint|cabinet|woodwork/, 'marceneiro'],
    [/pint|painter/, 'pintor'],
    [/eletric|electric/, 'eletricista'],
    [/encan|plumb/, 'encanador'],
    [/drywall|gesso|sheetrock/, 'drywall'],
    [/piso|azulej|floor|tile/, 'pisos'],
    [/telhad|roof/, 'telhado'],
    [/paisag|jardin|landscap|lawn|grama/, 'paisagismo'],
    [/mudan|moving|frete/, 'mudanca'],
    [/tradu|translat|interpret/, 'tradutor'],
    [/contab|contador|imposto|tax|bookkeep|account/, 'contador'],
    [/fotog|photo|filmag|video/, 'fotografo'],
    [/limpeza|clean|faxin|airbnb/, 'limpeza'],
  ]
  for (const [re, key] of rules) if (re.test(s)) return key
  return 'generico'
}

class HttpError extends Error {
  constructor(status, body) { super(body?.error || 'Erro'); this.status = status; this.body = body }
}
const fail = (status, error) => { throw new HttpError(status, { error }) }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const clip = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null)

function shape(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description || null,
    kind: ITEM_KINDS.includes(r.kind) ? r.kind : 'service',
    unit: r.unit || 'un',
    unit_price_cents: Number(r.unit_price_cents) || 0,
    taxable: r.taxable === true,
    active: r.active !== false,
    display_order: Number(r.display_order) || 0,
  }
}

/** Campos do item. partial = só o que veio no corpo. */
function readItem(b, partial) {
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

async function listItems(ctx, onlyActive = false) {
  let q = ctx.supabase.from('ag_catalog_items').select(COLS).eq('provider_id', ctx.pid)
  if (onlyActive) q = q.eq('active', true)
  const { data, error } = await q.order('display_order', { ascending: true }).order('name', { ascending: true }).limit(MAX_ITEMS)
  if (error) throw new Error(error.message)
  return (data || []).map(shape)
}

async function countAndMaxOrder(ctx) {
  const { data, count, error } = await ctx.supabase.from('ag_catalog_items').select('display_order', { count: 'exact' })
    .eq('provider_id', ctx.pid).order('display_order', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  return { count: count || 0, maxOrder: data?.[0] ? Number(data[0].display_order) || 0 : -1 }
}

async function ownItem(ctx, id) {
  if (!isUuid(id)) fail(400, 'Item inválido')
  const { data, error } = await ctx.supabase.from('ag_catalog_items').select(COLS)
    .eq('id', id).eq('provider_id', ctx.pid).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) fail(404, 'Item não encontrado')
  return data
}

async function handlePost(ctx, b, res) {
  const sb = ctx.supabase
  const action = String(b.action || '')
  const g = requireFeature(ctx.provider, 'price_book')
  if (!g.ok) return res.status(g.status).json(g.body)
  const now = new Date().toISOString()

  if (action === 'create') {
    const fields = readItem(b, false)
    const { count, maxOrder } = await countAndMaxOrder(ctx)
    if (count >= MAX_ITEMS) fail(400, `Sua tabela já tem ${MAX_ITEMS} itens. Apague os que não usa antes de criar outro.`)
    const { data, error } = await sb.from('ag_catalog_items')
      .insert({ provider_id: ctx.pid, ...fields, display_order: maxOrder + 1 }).select(COLS).single()
    if (error) throw new Error(error.message)
    return res.status(201).json({ ok: true, item: shape(data) })
  }

  if (action === 'update') {
    await ownItem(ctx, b.id)
    const fields = readItem(b, true)
    const { data, error } = await sb.from('ag_catalog_items').update({ ...fields, updated_at: now })
      .eq('id', b.id).eq('provider_id', ctx.pid).select(COLS).single()
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, item: shape(data) })
  }

  if (action === 'delete') {
    await ownItem(ctx, b.id)
    const { error } = await sb.from('ag_catalog_items').delete().eq('id', b.id).eq('provider_id', ctx.pid)
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true })
  }

  if (action === 'reorder') {
    if (!Array.isArray(b.ids) || !b.ids.length) fail(400, 'Mande a lista de itens na ordem nova')
    if (b.ids.length > MAX_ITEMS) fail(400, 'Lista grande demais')
    const ids = [...new Set(b.ids.map(String))]
    if (ids.some((id) => !isUuid(id))) fail(400, 'Item inválido na lista')
    const { data: own, error } = await sb.from('ag_catalog_items').select('id').eq('provider_id', ctx.pid).in('id', ids)
    if (error) throw new Error(error.message)
    const mine = new Set((own || []).map((x) => x.id))
    const ordered = ids.filter((id) => mine.has(id))
    for (let i = 0; i < ordered.length; i += 25) {
      const chunk = ordered.slice(i, i + 25)
      const results = await Promise.all(chunk.map((id, j) => sb.from('ag_catalog_items')
        .update({ display_order: i + j, updated_at: now }).eq('id', id).eq('provider_id', ctx.pid)))
      const bad = results.find((r) => r.error)
      if (bad) throw new Error(bad.error.message)
    }
    return res.status(200).json({ ok: true, items: await listItems(ctx) })
  }

  if (action === 'seed') {
    const key = specialtyKey(clip(b.specialty, 80) || ctx.provider.specialty)
    const docLang = ctx.provider.app_settings?.doc_defaults?.language
    const lang = DOC_LANGS.includes(b.language) ? b.language : (DOC_LANGS.includes(docLang) ? docLang : 'pt')
    const col = { pt: 0, en: 1, es: 2 }[lang]
    const current = await listItems(ctx)
    if (current.length >= MAX_ITEMS) fail(400, `Sua tabela já tem ${MAX_ITEMS} itens.`)
    const taken = new Set(current.map((i) => plain(i.name)))
    let order = current.reduce((m, i) => Math.max(m, i.display_order), -1) + 1
    const rows = []
    for (const s of SEEDS[key]) {
      const name = s[col]
      if (taken.has(plain(name))) continue
      taken.add(plain(name))
      rows.push({
        provider_id: ctx.pid, name, description: SAMPLE_NOTE, kind: s[3], unit: s[4],
        unit_price_cents: s[5], taxable: s[6], active: true, display_order: order++,
      })
    }
    const room = MAX_ITEMS - current.length
    const toInsert = rows.slice(0, Math.max(0, room))
    if (toInsert.length) {
      const { error } = await sb.from('ag_catalog_items').insert(toInsert)
      if (error) throw new Error(error.message)
    }
    return res.status(201).json({ ok: true, created: toInsert.length, specialty: key, items: await listItems(ctx) })
  }

  fail(400, 'Ação inválida')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const ctx = { supabase, provider: auth.provider, pid: auth.provider.id }
    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      const q = req.query || {}
      return res.status(200).json({ items: await listItems(ctx, q.active === '1' || q.active === 'true') })
    }
    return await handlePost(ctx, req.body && typeof req.body === 'object' ? req.body : {}, res)
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json(e.body)
    return res.status(500).json({ error: e.message })
  }
}

export const _test = { readItem, shape, specialtyKey, handlePost, HttpError }
