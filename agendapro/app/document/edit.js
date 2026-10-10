// Novo orçamento ou fatura (?kind=quote|invoice) ou edição (?id=). Atalhos que
// pré-preenchem: ?client_id= (cliente da ficha), ?appointment_id= (fatura do
// atendimento), ?from_quote_request= (pedido de orçamento). Totais ao vivo com a
// conta única (lib/docCalc.js); o servidor recalcula ao gravar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, featureInfo, showError } from '../../lib/gate'
import { choose, confirm, notify } from '../../lib/dialog'
import { addDays, centsToInput, fmtMoney, fmtPhone, keyOf, parseMoney, todayKey } from '../../lib/format'
import { cleanPct, cleanQty, computeTotals } from '../../lib/docCalc'
import { DOC_LANGS, KIND_OPTIONS, addressOf, appointmentReceived, docLang, fmtRate, kindLabel, setPendingSend, unitLabel, UNIT_OPTIONS } from '../../lib/documents'
import { colors, radius, spacing, type } from '../../lib/theme'
import { Avatar, Badge, Banner, Button, Card, Chip, Divider, ErrorBox, H3, Input, Label, Loading, Muted, Row, Screen, Section, Segmented, Small } from '../../components/ui'
import { DateField } from '../../components/pickers'
import { LockedCard } from '../../components/Locked'

const isWeb = Platform.OS === 'web'
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_ITEMS = 100
const MAX_PHOTOS = 10
const MAX_UPLOAD = 480 * 1024                       // servidor aceita até 500 KB
const SIZES = [[1400, 0.7], [1200, 0.6], [1000, 0.5]] // tenta menor se passar do limite
const FEATURE = { quote: 'quotes', invoice: 'invoices' }
const DEPOSIT_CHIPS = [0, 25, 30, 50]
const EMPTY_CLIENT = { id: null, name: '', email: '', phone: '', address: '', language: null }

const one = (v) => (Array.isArray(v) ? v[0] : v) || ''
const newKey = () => Math.random().toString(36).slice(2, 10)
const emptyItem = (patch = {}) => ({ key: newKey(), catalog_item_id: null, kind: 'service', description: '', quantity: '1', unit: 'un', price: '', taxable: false, ...patch })
const numOr = (v, def) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? def : Number(v))
const dateOrEmpty = (v) => (v ? String(v).slice(0, 10) : '')
const clip = (v, n) => String(v || '').trim().slice(0, n)

/** '6,25' → 625 (pontos-base, até 25%). Vazio → 0. Inválido → null. */
function taxBps(v) {
  if (String(v ?? '').trim() === '') return 0
  const p = cleanPct(v)
  if (p === null) return null
  return Math.min(2500, Math.round(p * 100))
}

function newForm(kind, dd = {}, fallbackPay = '') {
  const today = todayKey()
  return {
    client: { ...EMPTY_CLIENT },
    clientMode: 'pick',
    title: '',
    job_address: '',
    language: docLang(dd.language || 'en'),
    issue_date: today,
    due_date: kind === 'invoice' ? addDays(today, Math.max(0, numOr(dd.due_days, 14))) : '',
    valid_until: kind === 'quote' ? addDays(today, Math.max(1, numOr(dd.quote_valid_days, 30))) : '',
    items: [emptyItem()],
    discount_mode: 'pct',
    discount: '',
    tax: dd.tax_rate_bps ? String(Number(dd.tax_rate_bps) / 100) : '',
    deposit_mode: 'pct',
    deposit: kind === 'quote' && Number(dd.deposit_pct) > 0 ? String(dd.deposit_pct) : '',
    notes: dd.notes || '',
    terms: dd.terms || '',
    payment_instructions: dd.payment_instructions || fallbackPay || '',
    internal_notes: '',
    photos: [],
  }
}

function formFromDoc(doc, items) {
  const dPct = cleanPct(doc.discount_pct)
  const depPct = cleanPct(doc.deposit_pct)
  return {
    client: { id: doc.client_id || null, name: doc.client_name || '', email: doc.client_email || '', phone: doc.client_phone || '', address: doc.client_address || '', language: null },
    clientMode: doc.client_id ? 'pick' : 'new',
    title: doc.title || '',
    job_address: doc.job_address || '',
    language: docLang(doc.language),
    issue_date: dateOrEmpty(doc.issue_date) || todayKey(),
    due_date: dateOrEmpty(doc.due_date),
    valid_until: dateOrEmpty(doc.valid_until),
    items: [...(items || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((it) => emptyItem({
      catalog_item_id: it.catalog_item_id || null,
      kind: it.kind || 'service',
      description: it.description || '',
      quantity: String(cleanQty(it.quantity) ?? 1),
      unit: it.unit || 'un',
      price: centsToInput(it.unit_price_cents ?? 0),
      taxable: !!it.taxable,
    })),
    discount_mode: dPct ? 'pct' : (Number(doc.discount_cents) > 0 ? 'amount' : 'pct'),
    discount: dPct ? String(dPct) : (Number(doc.discount_cents) > 0 ? centsToInput(doc.discount_cents) : ''),
    tax: Number(doc.tax_rate_bps) > 0 ? String(Number(doc.tax_rate_bps) / 100) : '',
    deposit_mode: depPct ? 'pct' : (Number(doc.deposit_cents) > 0 ? 'amount' : 'pct'),
    deposit: depPct ? String(depPct) : (Number(doc.deposit_cents) > 0 ? centsToInput(doc.deposit_cents) : ''),
    notes: doc.notes || '',
    terms: doc.terms || '',
    payment_instructions: doc.payment_instructions || '',
    internal_notes: doc.internal_notes || '',
    photos: Array.isArray(doc.photos) ? doc.photos.filter((u) => typeof u === 'string') : [],
  }
}

/** Itens válidos pra API (linhas vazias saem). */
function itemsForApi(items) {
  return items
    .filter((it) => it.description.trim() || String(it.price).trim())
    .slice(0, MAX_ITEMS)
    .map((it, i) => ({
      position: i,
      catalog_item_id: it.catalog_item_id || null,
      kind: it.kind,
      description: clip(it.description, 500),
      quantity: cleanQty(it.quantity) ?? 1,
      unit: it.unit,
      unit_price_cents: parseMoney(it.price) ?? 0,
      taxable: !!it.taxable,
    }))
}

// ── Fotos ────────────────────────────────────────────────────────────────
async function prepareImage(asset) {
  const w = asset.width || 0
  const h = asset.height || 0
  for (const [max, q] of SIZES) {
    const ctx = ImageManipulator.manipulate(asset.uri)
    if (!w || !h) ctx.resize({ width: max })
    else if (Math.max(w, h) > max) ctx.resize(w >= h ? { width: max } : { height: max })
    const img = await ctx.renderAsync()
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: q, base64: true })
    if (out.base64 && out.base64.length * 0.75 <= MAX_UPLOAD) return out.base64
  }
  throw new Error('A foto ficou grande demais. Tente outra.')
}

async function uploadImage(asset) {
  const b64 = await prepareImage(asset)
  const r = await post('/api/upload', { file_data: `data:image/jpeg;base64,${b64}`, folder: 'providers' })
  if (!r?.url) throw new Error('Não deu pra enviar a foto. Tente de novo.')
  return r.url
}

async function pickImages(source, limit) {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { notify('Sem acesso à câmera', 'Libere a câmera para o app nos Ajustes do celular.'); return [] }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    return res.canceled ? [] : (res.assets || [])
  }
  if (!isWeb) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { notify('Sem acesso às fotos', 'Libere o acesso às fotos para o app nos Ajustes do celular.'); return [] }
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, selectionLimit: limit })
  return res.canceled ? [] : (res.assets || []).slice(0, limit)
}

// ── Tela ─────────────────────────────────────────────────────────────────
export default function DocumentEdit() {
  const app = useApp()
  const navigation = useNavigation()
  const params = useLocalSearchParams()
  const id = one(params.id)
  const editing = !!id
  const from = one(params.from)
  const prefill = { client_id: one(params.client_id), appointment_id: one(params.appointment_id), quote_request_id: one(params.from_quote_request) }
  const dd = app.settings?.doc_defaults || {}

  const [kind, setKind] = useState(one(params.kind) === 'invoice' ? 'invoice' : 'quote')
  const [doc, setDoc] = useState(null)              // documento salvo (edição)
  const payFallback = String(app.provider?.deposit_instructions || '').slice(0, 1000)
  const [form, setForm] = useState(() => newForm(one(params.kind) === 'invoice' ? 'invoice' : 'quote', dd, payFallback))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [prefillError, setPrefillError] = useState(null)
  const [prefillNote, setPrefillNote] = useState(null)   // aviso do que já foi pago no atendimento
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(null)        // 'draft' | 'send'
  const [clientDirty, setClientDirty] = useState(!editing)
  const [langTouched, setLangTouched] = useState(editing)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(null)  // { done, total }
  const [viewer, setViewer] = useState(null)

  const base = useRef(null)          // retrato do formulário carregado (pra saber se mudou)
  const leaving = useRef(false)
  const dirtyRef = useRef(false)
  const isQuote = kind === 'quote'
  const feature = FEATURE[kind]
  // Mesmas travas do servidor: orçamento faturado não muda nada; fatura paga/anulada e
  // orçamento aprovado só mudam fotos e anotação interna.
  const st0 = doc?.status
  const allLocked = editing && isQuote && st0 === 'converted'
  const valuesLocked = editing && !allLocked && ((!isQuote && (st0 === 'paid' || st0 === 'void')) || (isQuote && st0 === 'accepted'))

  const snapshot = (f) => JSON.stringify({ ...f, items: f.items.map(({ key, ...it }) => it) })
  const dirty = !loading && base.current !== null && snapshot(form) !== base.current
  dirtyRef.current = dirty && !leaving.current

  // ── Carregar ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      if (editing) {
        const r = await api(`/api/agenda/documents?id=${encodeURIComponent(id)}`)
        if (!r?.document) throw new Error('Documento não encontrado.')
        setDoc(r.document)
        setKind(r.document.kind === 'invoice' ? 'invoice' : 'quote')
        const f = formFromDoc(r.document, r.items || [])
        if (!f.items.length) f.items = [emptyItem()]
        setForm(f)
        base.current = snapshot(f)
        return
      }
      const k = one(params.kind) === 'invoice' ? 'invoice' : 'quote'
      const f = newForm(k, dd, payFallback)
      try {
        await applyPrefill(f, k)
      } catch (e) {
        setPrefillError(e)
      }
      setForm(f)
      base.current = snapshot(f)
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
    }
  }, [id])

  /** Pré-preenche a partir da ficha, do atendimento ou do pedido de orçamento. */
  async function applyPrefill(f, k) {
    const takeClient = (c) => {
      if (!c) return
      f.client = { id: c.id, name: c.name || '', email: c.email || '', phone: c.whatsapp || '', address: addressOf(c), language: c.language || null }
      f.clientMode = 'pick'
      if (['pt', 'en', 'es'].includes(c.language)) f.language = c.language
    }
    if (prefill.appointment_id) {
      const r = await api(`/api/agenda/appointments?id=${encodeURIComponent(prefill.appointment_id)}`)
      const a = r?.appointment
      if (a) {
        if (r.client) takeClient({ ...r.client, whatsapp: r.client.whatsapp || a.client_whatsapp, email: r.client.email || a.client_email })
        else {
          f.client = { ...EMPTY_CLIENT, name: a.client_name || '', phone: a.client_whatsapp || '', email: a.client_email || '' }
          f.clientMode = 'new'
        }
        const name = a.service_name || a.service_label || 'Serviço'
        const when = keyOf(a.scheduled_for).split('-').reverse().join('/')
        const total = Math.max(0, Number(a.total_cents) || 0)
        // Fatura com o valor cheio do atendimento. O que já entrou nele (sinal ou
        // pagamento registrado) o servidor lança na fatura como pagamento "Já pago"
        // (creditFromAppointment em api/_lib/documents.js), e o saldo sai certo.
        const got = k === 'invoice' ? appointmentReceived(a) : { cents: 0, kind: null }
        const credit = Math.min(got.cents, total)
        f.title = name
        f.items = [emptyItem({ description: `${name} · ${when}`, price: centsToInput(total) })]
        if (credit > 0) {
          const what = got.kind === 'deposit' ? 'sinal' : 'pagamento'
          setPrefillNote(total - credit > 0
            ? `Esse atendimento já tem ${fmtMoney(credit, { decimals: 2 })} recebido (${what}). Ele entra na fatura como pagamento e a cliente vê só o saldo de ${fmtMoney(total - credit, { decimals: 2 })} a pagar.`
            : `Esse atendimento já está todo pago (${fmtMoney(credit, { decimals: 2 })}). A fatura sai como paga e serve de comprovante; se preferir, use o recibo.`)
        }
      }
      return
    }
    if (prefill.client_id) {
      const r = await api(`/api/agenda/clients?id=${encodeURIComponent(prefill.client_id)}`)
      takeClient(r?.client)
    }
    if (prefill.quote_request_id) {
      const r = await api('/api/agenda/quote-requests')
      const req = (r?.requests || []).find((x) => x.id === prefill.quote_request_id)
      if (!req) throw new Error('Pedido de orçamento não encontrado.')
      if (!f.client.id) {
        f.client = { ...EMPTY_CLIENT, id: req.client_id || null, name: req.name || '', email: req.email || '', phone: req.phone || '', address: req.address || '' }
        f.clientMode = req.client_id ? 'pick' : 'new'
      }
      f.title = req.service || ''
      f.job_address = req.address || ''
      if (['pt', 'en', 'es'].includes(req.language)) f.language = req.language
      if (req.description) f.internal_notes = `Pedido da cliente: ${String(req.description).slice(0, 1500)}`
    }
  }

  useEffect(() => { load() }, [load])

  // Aviso ao sair com alterações não salvas
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || leaving.current) return
      e.preventDefault()
      confirm('Sair sem salvar?', 'O que você mudou neste documento vai se perder.', { ok: 'Sair sem salvar', cancel: 'Continuar editando', destructive: true })
        .then((ok) => { if (ok) { leaving.current = true; navigation.dispatch(e.data.action) } })
    })
    return unsub
  }, [navigation])

  // ── Edição ─────────────────────────────────────────────────────────────
  const set = (key) => (v) => {
    setForm((f) => ({ ...f, [key]: v }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }))
  }
  const setClient = (patch) => {
    setForm((f) => ({ ...f, client: { ...f.client, ...patch } }))
    setClientDirty(true)
    if (errors.client) setErrors((e) => ({ ...e, client: null }))
  }
  const setItem = (key, patch) => {
    setForm((f) => ({ ...f, items: f.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }))
    if (errors.items) setErrors((e) => ({ ...e, items: null }))
  }
  const moveItem = (key, dir) => setForm((f) => {
    const i = f.items.findIndex((it) => it.key === key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= f.items.length) return f
    const next = f.items.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    return { ...f, items: next }
  })
  async function removeItem(it) {
    const filled = it.description.trim() || String(it.price).trim()
    if (filled && !(await confirm('Tirar este item?', it.description.trim() || 'Item sem descrição', { ok: 'Tirar', destructive: true }))) return
    setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((x) => x.key !== it.key) : [emptyItem()] }))
  }
  function addItem(patch) {
    if (form.items.length >= MAX_ITEMS) { notify('Muitos itens', `Até ${MAX_ITEMS} itens por documento.`); return }
    setForm((f) => {
      // Primeira linha ainda vazia é substituída pelo item escolhido
      const onlyEmpty = f.items.length === 1 && !f.items[0].description.trim() && !String(f.items[0].price).trim()
      return { ...f, items: onlyEmpty && patch ? [emptyItem(patch)] : [...f.items, emptyItem(patch)] }
    })
    if (errors.items) setErrors((e) => ({ ...e, items: null }))
  }
  function pickClient(c) {
    setForm((f) => ({
      ...f,
      client: { id: c.id, name: c.name || '', email: c.email || '', phone: c.whatsapp || '', address: addressOf(c), language: c.language || null },
      clientMode: 'pick',
      language: !langTouched && ['pt', 'en', 'es'].includes(c.language) ? c.language : f.language,
    }))
    setClientDirty(true)
    if (errors.client) setErrors((e) => ({ ...e, client: null }))
  }

  // ── Totais ao vivo ─────────────────────────────────────────────────────
  const bps = taxBps(form.tax)
  const totals = useMemo(() => computeTotals({
    items: form.items.map((it) => ({ quantity: it.quantity, unit_price_cents: parseMoney(it.price) ?? 0, taxable: it.taxable })),
    discount_pct: form.discount_mode === 'pct' ? cleanPct(form.discount) : null,
    discount_cents: form.discount_mode === 'amount' ? (parseMoney(form.discount) ?? 0) : 0,
    tax_rate_bps: bps ?? 0,
    deposit_pct: isQuote && form.deposit_mode === 'pct' ? cleanPct(form.deposit) : null,
    deposit_cents: isQuote && form.deposit_mode === 'amount' ? (parseMoney(form.deposit) ?? 0) : 0,
    amount_paid_cents: !isQuote ? Number(doc?.amount_paid_cents) || 0 : 0,
  }), [form, bps, isQuote, doc?.amount_paid_cents])

  // ── Validar e salvar ───────────────────────────────────────────────────
  function validate() {
    const e = {}
    const c = form.client
    if (form.clientMode === 'pick' ? !c.id && !c.name.trim() : !c.name.trim()) e.client = 'Escolha a cliente ou cadastre uma nova'
    if (form.clientMode === 'new' && c.email.trim() && !EMAIL_RE.test(c.email.trim())) e.client_email = 'E-mail inválido'
    const used = form.items.filter((it) => it.description.trim() || String(it.price).trim())
    if (!used.length) e.items = 'Coloque pelo menos um item com descrição e preço'
    const itemErr = {}
    for (const it of used) {
      const m = []
      if (!it.description.trim()) m.push('descrição')
      if (cleanQty(it.quantity) === null) m.push('quantidade')
      if (parseMoney(it.price) === null) m.push('preço')
      if (m.length) itemErr[it.key] = `Falta ${m.join(', ')}`
    }
    if (Object.keys(itemErr).length) e.itemErr = itemErr
    if (bps === null || (String(form.tax).trim() && cleanPct(form.tax) > 25)) e.tax = 'Imposto entre 0 e 25%'
    if (String(form.discount).trim()) {
      if (form.discount_mode === 'pct' ? cleanPct(form.discount) === null : parseMoney(form.discount) === null) e.discount = 'Desconto inválido'
    }
    if (isQuote && String(form.deposit).trim()) {
      if (form.deposit_mode === 'pct' ? cleanPct(form.deposit) === null : parseMoney(form.deposit) === null) e.deposit = 'Entrada inválida'
    }
    if (!KEY_RE.test(form.issue_date)) e.issue_date = 'Data inválida (AAAA-MM-DD)'
    if (isQuote && form.valid_until && !KEY_RE.test(form.valid_until)) e.valid_until = 'Data inválida (AAAA-MM-DD)'
    if (isQuote && form.valid_until && KEY_RE.test(form.issue_date) && form.valid_until < form.issue_date) e.valid_until = 'A validade não pode ser antes da data do orçamento'
    if (!isQuote && form.due_date && !KEY_RE.test(form.due_date)) e.due_date = 'Data inválida (AAAA-MM-DD)'
    if (!isQuote && form.due_date && KEY_RE.test(form.issue_date) && form.due_date < form.issue_date) e.due_date = 'O vencimento não pode ser antes da data da fatura'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function buildBody() {
    if (valuesLocked) {
      return { internal_notes: clip(form.internal_notes, 2000) || null, photos: form.photos.slice(0, MAX_PHOTOS) }
    }
    const body = {
      title: clip(form.title, 160) || null,
      job_address: clip(form.job_address, 300) || null,
      language: docLang(form.language),
      issue_date: form.issue_date,
      items: itemsForApi(form.items),
      discount_pct: form.discount_mode === 'pct' ? (cleanPct(form.discount) || null) : null,
      discount_cents: form.discount_mode === 'amount' ? (parseMoney(form.discount) || 0) : 0,
      tax_rate_bps: bps || 0,
      notes: clip(form.notes, 1000) || null,
      terms: clip(form.terms, 3000) || null,
      payment_instructions: clip(form.payment_instructions, 1000) || null,
      internal_notes: clip(form.internal_notes, 2000) || null,
      photos: form.photos.slice(0, MAX_PHOTOS),
    }
    if (isQuote) {
      body.valid_until = form.valid_until || null
      body.deposit_pct = form.deposit_mode === 'pct' ? (cleanPct(form.deposit) || null) : null
      body.deposit_cents = form.deposit_mode === 'amount' ? (parseMoney(form.deposit) || 0) : 0
    } else {
      body.due_date = form.due_date || null
    }
    if (clientDirty) {
      const c = form.client
      if (form.clientMode === 'pick' && c.id) body.client_id = c.id
      else body.client = { name: clip(c.name, 120), email: clip(c.email, 254).toLowerCase() || null, phone: clip(c.phone, 40) || null, address: clip(c.address, 300) || null }
    }
    return body
  }

  async function save(andSend) {
    if (allLocked) return
    if (!valuesLocked && !validate()) {
      notify('Confira o documento', 'Tem informação faltando ou com erro (marcada em vermelho).')
      return
    }
    if (!(await ensureFeature(app, feature))) return
    setSaving(andSend ? 'send' : 'draft')
    try {
      const body = buildBody()
      if (!editing) {
        body.kind = kind
        if (prefill.appointment_id) body.appointment_id = prefill.appointment_id
        if (prefill.quote_request_id) body.quote_request_id = prefill.quote_request_id
      }
      const r = await post('/api/agenda/documents', editing ? { action: 'update', id, ...body } : { action: 'create', ...body })
      const docId = r?.document?.id || (editing ? id : null)
      if (!docId) throw new Error('Não deu pra salvar. Tente de novo.')
      leaving.current = true
      if (andSend) setPendingSend(docId)
      if (editing && from === 'detail' && router.canGoBack()) router.back()
      else router.replace(`/document/${docId}`)
    } catch (e) {
      showError(e, 'Não deu pra salvar')
    } finally {
      setSaving(null)
    }
  }

  // ── Fotos ──────────────────────────────────────────────────────────────
  async function addPhotos() {
    if (!(await ensureFeature(app, 'job_photos'))) return
    const room = MAX_PHOTOS - form.photos.length
    if (room <= 0) { notify('Limite de fotos', `Até ${MAX_PHOTOS} fotos por documento.`); return }
    let source = 'library'
    if (!isWeb) {
      source = await choose('Fotos do trabalho', [{ label: 'Tirar foto', value: 'camera' }, { label: 'Escolher da galeria', value: 'library' }])
      if (!source) return
    }
    let assets = []
    try { assets = await pickImages(source, room) } catch (e) { showError(e, 'Não deu pra abrir as fotos'); return }
    if (!assets.length) return
    setPhotoBusy({ done: 0, total: assets.length })
    const urls = []
    let failure = null
    for (const a of assets) {
      try {
        urls.push(await uploadImage(a))
        setPhotoBusy({ done: urls.length, total: assets.length })
      } catch (e) { failure = e; break }
    }
    if (urls.length) setForm((f) => ({ ...f, photos: [...f.photos, ...urls].slice(0, MAX_PHOTOS) }))
    setPhotoBusy(null)
    if (failure) showError(failure, urls.length ? `Só ${urls.length} foto(s) entraram` : 'Não deu pra enviar a foto')
  }

  async function photoMenu(url, index) {
    const act = await choose(`Foto ${index + 1}`, [
      { label: 'Ver foto', value: 'view' },
      ...(index > 0 ? [{ label: 'Mostrar primeiro', value: 'first' }] : []),
      { label: 'Tirar do documento', value: 'remove', destructive: true },
    ])
    if (act === 'view') setViewer(url)
    if (act === 'first') setForm((f) => ({ ...f, photos: [url, ...f.photos.filter((u) => u !== url)] }))
    if (act === 'remove') setForm((f) => ({ ...f, photos: f.photos.filter((u) => u !== url) }))
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const title = editing ? (doc?.number ? `Editar ${doc.number}` : 'Editar') : isQuote ? 'Novo orçamento' : 'Nova fatura'

  if (loading) return <Screen><Stack.Screen options={{ title }} /><Loading text="Abrindo…" /></Screen>
  if (loadError) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorBox error={loadError} onRetry={load} />
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </Screen>
    )
  }
  if (!app.can(feature)) {
    return <Screen><Stack.Screen options={{ title }} /><LockedCard feature={feature} /></Screen>
  }

  const status = doc?.status
  const voided = allLocked
  const warnSent = editing && status && status !== 'draft' && !allLocked && !valuesLocked
  const canPhotos = app.can('job_photos')
  const photosInfo = featureInfo(app.ent, 'job_photos')
  const lang = form.language
  const footer = (
    <View style={{ gap: spacing.sm }}>
      {dirty ? <Muted style={{ textAlign: 'center' }}>Alterações ainda não salvas</Muted> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={editing && status !== 'draft' ? 'Salvar' : 'Salvar rascunho'} variant="secondary" style={{ flex: 1 }}
          loading={saving === 'draft'} disabled={!!saving || voided} onPress={() => save(false)} />
        {!valuesLocked ? (
          <Button title={editing && status && status !== 'draft' ? 'Salvar e reenviar' : 'Salvar e enviar'} icon="paper-plane-outline" style={{ flex: 1.3 }}
            loading={saving === 'send'} disabled={!!saving || voided} onPress={() => save(true)} />
        ) : null}
      </View>
    </View>
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title }} />
      <Screen footer={footer}>
        {allLocked ? <Banner tone="red" icon="lock-closed-outline" text="Este orçamento já virou fatura e não muda mais. Duplique pra fazer outro." /> : null}
        {valuesLocked ? (
          <Banner tone="gold" icon="lock-closed-outline"
            text={st0 === 'accepted' ? 'A cliente já aprovou: itens, valores e textos ficam como estão. Aqui dá pra mudar só as fotos e a anotação interna. Pra mudar o resto, duplique.'
              : st0 === 'paid' ? 'Fatura paga: itens e valores não mudam. Aqui dá pra mudar só as fotos e a anotação interna.'
                : 'Fatura anulada: só as fotos e a anotação interna mudam. Duplique pra emitir outra.'} />
        ) : null}
        {warnSent ? (
          <Banner tone="gold" icon="information-circle-outline"
            text={status === 'paid' ? 'Esta fatura já foi paga. Mude só se precisar corrigir algo.' : 'Já foi enviado: a cliente vê a versão nova no mesmo link.'} />
        ) : null}
        {prefillError ? <Banner tone="orange" icon="alert-circle-outline" text={`Não deu pra puxar tudo: ${prefillError.message || 'tente de novo'}. Preencha o que faltar.`} /> : null}
        {prefillNote ? <Banner tone="gold" icon="information-circle-outline" text={prefillNote} /> : null}

        <View pointerEvents={valuesLocked || allLocked ? 'none' : 'auto'} style={valuesLocked || allLocked ? { opacity: 0.55 } : null}>
        {/* Cliente */}
        <ClientSection form={form} errors={errors} onPick={pickClient} onChange={setClient}
          onMode={(m) => { setForm((f) => ({ ...f, clientMode: m, client: m === 'new' ? { ...EMPTY_CLIENT } : f.client })); setClientDirty(true) }}
          onClear={() => { setForm((f) => ({ ...f, client: { ...EMPTY_CLIENT }, clientMode: 'pick' })); setClientDirty(true) }} />

        {/* Serviço e idioma */}
        <Section title={isQuote ? 'O que é o orçamento' : 'O que é a fatura'}>
          <Input label="Título (opcional)" value={form.title} onChangeText={set('title')} maxLength={160}
            placeholder={isQuote ? 'Ex.: Reforma do banheiro' : 'Ex.: Pintura da sala'} />
          <Input label="Endereço da obra / do serviço (se for outro)" value={form.job_address} onChangeText={set('job_address')} maxLength={300}
            placeholder="Ex.: 22 Oak Ave, Round Rock, TX" />
          <Label style={{ marginBottom: spacing.sm }}>Idioma do documento</Label>
          <Segmented options={DOC_LANGS} value={lang} onChange={(v) => { setLangTouched(true); set('language')(v) }} />
          <Muted style={{ marginTop: 6, marginBottom: spacing.lg }}>É o idioma que a cliente vê no PDF e no link. Os itens ficam como você escrever.</Muted>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <DateField label="Data" value={form.issue_date} onChange={set('issue_date')} />
              {errors.issue_date ? <Text style={st.err}>{errors.issue_date}</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              {isQuote ? (
                <DateField label="Válido até" value={form.valid_until} onChange={set('valid_until')} placeholder="Escolher" />
              ) : (
                <DateField label="Vencimento" value={form.due_date} onChange={set('due_date')} placeholder="Escolher" />
              )}
              {errors.valid_until || errors.due_date ? <Text style={st.err}>{errors.valid_until || errors.due_date}</Text> : null}
            </View>
          </View>
        </Section>

        {/* Itens */}
        <Section title={`Itens (${form.items.length})`}>
          {errors.items ? <ErrorBox error={errors.items} /> : null}
          {form.items.map((it, i) => (
            <ItemEditor key={it.key} it={it} index={i} count={form.items.length} taxOn={(bps || 0) > 0}
              error={errors.itemErr?.[it.key]}
              onChange={(patch) => setItem(it.key, patch)}
              onMove={(dir) => moveItem(it.key, dir)}
              onRemove={() => removeItem(it)} />
          ))}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="Da tabela de preços" icon="pricetags-outline" variant="secondary" style={{ flex: 1 }} onPress={async () => {
              if (!(await ensureFeature(app, 'price_book'))) return
              setCatalogOpen(true)
            }} />
            <Button title="Item livre" icon="add" variant="secondary" style={{ flex: 1 }} onPress={() => addItem(null)} />
          </View>
        </Section>

        {/* Desconto, imposto e entrada */}
        <Section title="Desconto e imposto">
          <Card>
            <Label style={{ marginBottom: spacing.sm }}>Desconto</Label>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
              <Segmented options={[{ value: 'pct', label: '%' }, { value: 'amount', label: '$' }]} value={form.discount_mode}
                onChange={(v) => setForm((f) => ({ ...f, discount_mode: v, discount: '' }))} style={{ width: 110 }} />
              <Input value={form.discount} onChangeText={set('discount')} keyboardType="decimal-pad" style={{ flex: 1, marginBottom: 0 }}
                placeholder={form.discount_mode === 'pct' ? 'Ex.: 10' : 'Ex.: 50'} error={errors.discount} maxLength={12} />
            </View>
            <Divider style={{ marginVertical: spacing.lg }} />
            <Input label="Sales tax (%)" value={form.tax} onChangeText={set('tax')} keyboardType="decimal-pad" placeholder="Ex.: 6.25 · vazio = sem imposto"
              error={errors.tax} maxLength={6} style={{ marginBottom: spacing.sm }}
              hint="Entra só nos itens marcados como tributáveis, depois do desconto." />
            {isQuote ? (
              <>
                <Divider style={{ marginVertical: spacing.lg }} />
                <Label style={{ marginBottom: spacing.sm }}>Entrada pedida na aprovação</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {DEPOSIT_CHIPS.map((p) => (
                    <Chip key={p} label={p ? `${p}%` : 'Sem entrada'}
                      selected={p === 0 ? !String(form.deposit).trim() || cleanPct(form.deposit) === 0 : form.deposit_mode === 'pct' && cleanPct(form.deposit) === p}
                      onPress={() => setForm((f) => ({ ...f, deposit_mode: 'pct', deposit: p ? String(p) : '' }))} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
                  <Segmented options={[{ value: 'pct', label: '%' }, { value: 'amount', label: '$' }]} value={form.deposit_mode}
                    onChange={(v) => setForm((f) => ({ ...f, deposit_mode: v, deposit: '' }))} style={{ width: 110 }} />
                  <Input value={form.deposit} onChangeText={set('deposit')} keyboardType="decimal-pad" style={{ flex: 1, marginBottom: 0 }}
                    placeholder={form.deposit_mode === 'pct' ? 'Ex.: 30' : 'Ex.: 500'} error={errors.deposit} maxLength={12} />
                </View>
              </>
            ) : null}
          </Card>
        </Section>

        {/* Totais */}
        <Card style={{ marginTop: spacing.lg, borderColor: colors.green, borderWidth: 1 }}>
          <TotalLine k="Subtotal" v={fmtMoney(totals.subtotal_cents, { decimals: 2 })} />
          {totals.discount_cents > 0 ? <TotalLine k={`Desconto${form.discount_mode === 'pct' && cleanPct(form.discount) ? ` (${cleanPct(form.discount)}%)` : ''}`} v={`−${fmtMoney(totals.discount_cents, { decimals: 2 })}`} /> : null}
          {(bps || 0) > 0 ? <TotalLine k={`Imposto (${fmtRate(bps, 'pt')} sobre ${fmtMoney(totals.taxable_cents, { decimals: 2 })})`} v={fmtMoney(totals.tax_cents, { decimals: 2 })} /> : null}
          <Divider style={{ backgroundColor: colors.ink, height: 1.5, marginVertical: spacing.sm }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[type.h3, { fontWeight: '700' }]}>Total</Text>
            <Text style={[type.h2]}>{fmtMoney(totals.total_cents, { decimals: 2 })}</Text>
          </View>
          {isQuote && totals.deposit_cents > 0 ? <TotalLine k="Entrada na aprovação" v={fmtMoney(totals.deposit_cents, { decimals: 2 })} strong /> : null}
          {!isQuote && Number(doc?.amount_paid_cents) > 0 ? (
            <>
              <TotalLine k="Já pago" v={`−${fmtMoney(doc.amount_paid_cents, { decimals: 2 })}`} />
              <TotalLine k="Saldo" v={fmtMoney(totals.balance_cents, { decimals: 2 })} strong />
            </>
          ) : null}
          {(bps || 0) > 0 && !form.items.some((it) => it.taxable) ? (
            <Muted style={{ marginTop: spacing.sm }}>Nenhum item está marcado como tributável, então o imposto fica zero.</Muted>
          ) : null}
        </Card>

        {/* Textos pra cliente */}
        <Section title="Pra cliente">
          <Input label="Recado" value={form.notes} onChangeText={set('notes')} multiline maxLength={1000}
            placeholder="Ex.: Obrigado pela oportunidade! O material está incluso." />
          <Input label="Condições" value={form.terms} onChangeText={set('terms')} multiline maxLength={3000}
            placeholder="Ex.: Garantia de 1 ano na mão de obra. Início em até 7 dias após a aprovação." />
          <Input label="Como pagar" value={form.payment_instructions} onChangeText={set('payment_instructions')} multiline maxLength={1000}
            placeholder="Ex.: Zelle (512) 555-0101 · Cheque nominal a Sua Empresa LLC"
            hint={!form.payment_instructions && !dd.payment_instructions ? 'Dica: salve isso em Dados da empresa e não precisa digitar de novo.' : undefined} />
        </Section>

        </View>

        {/* Fotos */}
        <Section title="Fotos do trabalho" right={!canPhotos ? <Badge text={photosInfo.minName} tone="gold" icon="lock-closed" /> : <Small>{form.photos.length}/{MAX_PHOTOS}</Small>}>
          <Card>
            <Muted style={{ marginBottom: spacing.md }}>Antes e depois, o local, o projeto. Saem também no PDF.</Muted>
            <View style={st.grid}>
              {form.photos.map((u, i) => (
                <Pressable key={u} onPress={() => (allLocked ? setViewer(u) : photoMenu(u, i))} style={st.thumb} accessibilityLabel={`Foto ${i + 1}`}>
                  <Image source={{ uri: u }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </Pressable>
              ))}
              {form.photos.length < MAX_PHOTOS ? (
                <Pressable onPress={photoBusy || allLocked ? undefined : addPhotos} style={[st.thumb, st.addTile]} accessibilityRole="button" accessibilityLabel="Adicionar fotos">
                  {photoBusy ? (
                    <>
                      <ActivityIndicator color={colors.green} />
                      {photoBusy.total ? <Small style={{ marginTop: 4 }}>{photoBusy.done}/{photoBusy.total}</Small> : null}
                    </>
                  ) : (
                    <>
                      <Ionicons name={canPhotos ? 'camera-outline' : 'lock-closed-outline'} size={24} color={colors.green} />
                      <Small style={{ color: colors.green, fontWeight: '600' }}>Adicionar</Small>
                    </>
                  )}
                </Pressable>
              ) : null}
            </View>
            {/* Anexou foto: lembra quem vê */}
            {form.photos.length || photoBusy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md }}>
                <Ionicons name="eye-outline" size={15} color={colors.inkMuted} />
                <Small style={{ flex: 1 }}>As fotos aparecem pra quem tem o link do documento (a cliente).</Small>
              </View>
            ) : null}
          </Card>
        </Section>

        {/* Anotação interna */}
        <Section title="Só pra você">
          <Input label="Anotação interna" value={form.internal_notes} onChangeText={set('internal_notes')} multiline maxLength={2000} editable={!allLocked}
            placeholder="Custo do material, medidas, o que combinou… (a cliente não vê)" style={{ marginBottom: 0 }} />
        </Section>
      </Screen>

      <CatalogPicker visible={catalogOpen} onClose={() => setCatalogOpen(false)}
        onPick={(c) => {
          setCatalogOpen(false)
          // Descrição = nome do item (a descrição da tabela é anotação dela; nos exemplos diz "Preço de exemplo…")
          addItem({ catalog_item_id: c.id, kind: c.kind || 'service', description: String(c.name || '').trim().slice(0, 500), quantity: '1', unit: c.unit || 'un', price: centsToInput(c.unit_price_cents ?? 0), taxable: !!c.taxable })
        }} />

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={st.viewer} onPress={() => setViewer(null)} accessibilityLabel="Fechar foto">
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <View style={st.viewerClose}><Ionicons name="close" size={26} color={colors.white} /></View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

// ── Cliente ──────────────────────────────────────────────────────────────
function ClientSection({ form, errors, onPick, onChange, onMode, onClear }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const seq = useRef(0)
  const c = form.client

  useEffect(() => {
    const term = q.trim()
    if (form.clientMode !== 'pick' || c.id || !term) { setResults(null); setSearchError(null); return undefined }
    const my = ++seq.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api(`/api/agenda/clients?q=${encodeURIComponent(term.slice(0, 60))}&limit=20`)
        if (my === seq.current) { setResults((r.clients || []).slice(0, 8)); setSearchError(null) }
      } catch (e) {
        if (my === seq.current) setSearchError(e)
      } finally {
        if (my === seq.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q, form.clientMode, c.id])

  return (
    <Section title="Cliente" style={{ marginTop: spacing.sm }}>
      {form.clientMode === 'pick' && (c.id || c.name) ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={c.name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <H3 numberOfLines={1}>{c.name || 'Cliente'}</H3>
            {[c.phone ? fmtPhone(c.phone) : '', c.email].filter(Boolean).length ? <Muted numberOfLines={1}>{[c.phone ? fmtPhone(c.phone) : '', c.email].filter(Boolean).join(' · ')}</Muted> : null}
            {c.address ? <Muted numberOfLines={1}>{c.address}</Muted> : null}
            {!c.phone && !c.email ? <Small style={{ color: colors.warning, marginTop: 2 }}>Sem telefone nem e-mail: dá pra mandar pelo link copiado.</Small> : null}
          </View>
          <Button title="Trocar" small variant="secondary" full={false} onPress={() => { setQ(''); onClear() }} />
        </Card>
      ) : form.clientMode === 'pick' ? (
        <>
          <Input placeholder="Buscar cliente por nome, telefone ou e-mail" value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none"
            maxLength={60} error={errors.client} style={{ marginBottom: spacing.sm }}
            right={searching ? <ActivityIndicator color={colors.green} style={{ paddingHorizontal: spacing.md }} /> : <Ionicons name="search" size={18} color={colors.inkMuted} style={{ paddingHorizontal: spacing.md }} />} />
          {searchError ? <ErrorBox error={searchError} /> : null}
          {results && results.length ? (
            <Card padded={false} style={{ marginBottom: spacing.sm }}>
              {results.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 68 }} /> : null}
                  <Row left={<Avatar name={r.name} size={36} />} title={r.name}
                    subtitle={[r.whatsapp ? fmtPhone(r.whatsapp) : '', r.email].filter(Boolean).join(' · ') || 'Sem contato'}
                    onPress={() => onPick(r)} />
                </View>
              ))}
            </Card>
          ) : results && q.trim() ? <Muted style={{ marginBottom: spacing.sm, marginLeft: 2 }}>Ninguém com "{q.trim()}" nas suas clientes.</Muted> : null}
          <Button title={q.trim() && results && !results.length ? `Cadastrar "${q.trim().slice(0, 30)}"` : 'Cliente nova'} icon="person-add-outline" variant="ghost" full={false}
            onPress={() => { const name = q.trim(); onMode('new'); if (name && !/^[\d\s()+-]+$/.test(name) && !name.includes('@')) onChange({ name }) }} />
        </>
      ) : (
        <Card>
          <Input label="Nome" value={c.name} onChangeText={(v) => onChange({ name: v })} error={errors.client} maxLength={120} autoCapitalize="words" placeholder="Ex.: John Smith" />
          <Input label="Telefone / WhatsApp" value={c.phone} onChangeText={(v) => onChange({ phone: v })} maxLength={40} keyboardType="phone-pad" placeholder="(512) 555-0101" />
          <Input label="E-mail" value={c.email} onChangeText={(v) => onChange({ email: v })} error={errors.client_email} maxLength={254}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="cliente@email.com" hint="Com e-mail, o documento sai por e-mail também." />
          <Input label="Endereço" value={c.address} onChangeText={(v) => onChange({ address: v })} maxLength={300} placeholder="Rua, cidade, estado, ZIP" style={{ marginBottom: spacing.sm }} />
          <Muted style={{ marginBottom: spacing.sm }}>A cliente entra na sua lista de clientes.</Muted>
          <Button title="Escolher da minha lista" icon="people-outline" variant="ghost" full={false} onPress={() => onMode('pick')} />
        </Card>
      )}
    </Section>
  )
}

// ── Item ─────────────────────────────────────────────────────────────────
function ItemEditor({ it, index, count, taxOn, error, onChange, onMove, onRemove }) {
  const total = computeTotals({ items: [{ quantity: it.quantity, unit_price_cents: parseMoney(it.price) ?? 0 }] }).subtotal_cents
  async function pickUnit() {
    const v = await choose('Unidade', UNIT_OPTIONS)
    if (v) onChange({ unit: v })
  }
  async function pickKind() {
    const v = await choose('Tipo do item', KIND_OPTIONS)
    if (v) onChange({ kind: v })
  }
  return (
    <Card style={[{ marginBottom: spacing.md }, error && { borderColor: colors.danger, borderWidth: 1 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: 4 }}>
        <Label style={{ flex: 1 }}>Item {index + 1}</Label>
        <IconTap icon="chevron-up" label="Subir item" disabled={index === 0} onPress={() => onMove(-1)} />
        <IconTap icon="chevron-down" label="Descer item" disabled={index === count - 1} onPress={() => onMove(1)} />
        <IconTap icon="trash-outline" label="Tirar item" color={colors.danger} onPress={onRemove} />
      </View>
      <Input value={it.description} onChangeText={(v) => onChange({ description: v })} multiline maxLength={500}
        placeholder="Descrição (ex.: Instalação de piso laminado)" inputStyle={{ minHeight: 48 }} style={{ marginBottom: spacing.sm }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="Qtd." value={it.quantity} onChangeText={(v) => onChange({ quantity: v.replace(/[^0-9.,]/g, '').slice(0, 10) })} keyboardType="decimal-pad" style={{ flex: 1, marginBottom: spacing.sm }} />
        <View style={{ flex: 1.2 }}>
          <Text style={st.lbl}>Unidade</Text>
          <Pressable onPress={pickUnit} style={st.select} accessibilityRole="button" accessibilityLabel="Escolher unidade">
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{unitLabel(it.unit, 'app')}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
          </Pressable>
        </View>
        <Input label="Preço (US$)" value={it.price} onChangeText={(v) => onChange({ price: v })} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1.3, marginBottom: spacing.sm }} maxLength={12} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Pressable onPress={pickKind} style={st.kindChip} accessibilityRole="button" accessibilityLabel="Escolher tipo do item">
          <Text style={{ fontSize: 13, color: colors.inkSoft, fontWeight: '500' }}>{kindLabel(it.kind)}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.inkMuted} />
        </Pressable>
        <Pressable onPress={() => onChange({ taxable: !it.taxable })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="switch" accessibilityState={{ checked: !!it.taxable }}>
          <Switch value={!!it.taxable} onValueChange={(v) => onChange({ taxable: v })} trackColor={{ true: colors.green, false: colors.line }} thumbColor={colors.white}
            style={Platform.OS === 'ios' ? { transform: [{ scale: 0.8 }] } : undefined} />
          <Text style={{ fontSize: 13, color: taxOn ? colors.ink : colors.inkMuted }}>Tributável</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={[type.body, { fontWeight: '700' }]}>{fmtMoney(total, { decimals: 2 })}</Text>
      </View>
      {error ? <Text style={[st.err, { marginTop: spacing.sm, marginBottom: 0 }]}>{error}</Text> : null}
    </Card>
  )
}

function IconTap({ icon, label, onPress, disabled, color = colors.green }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [{ width: 34, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, disabled && { opacity: 0.25 }, pressed && { backgroundColor: colors.greenSoft }]}>
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  )
}

function TotalLine({ k, v, strong }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: spacing.md }}>
      <Text style={[type.body, { flex: 1, color: strong ? colors.ink : colors.inkSoft }, strong && { fontWeight: '700' }]}>{k}</Text>
      <Text style={[type.body, { fontWeight: strong ? '700' : '600' }]}>{v}</Text>
    </View>
  )
}

// ── Tabela de preços (escolher item) ─────────────────────────────────────
function CatalogPicker({ visible, onClose, onPick }) {
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!visible) return
    let alive = true
    setError(null)
    api('/api/agenda/catalog?active=1')
      .then((r) => { if (alive) setItems((r.items || []).filter((x) => x.active !== false)) })
      .catch((e) => { if (alive) setError(e) })
    return () => { alive = false }
  }, [visible])

  const term = q.trim().toLowerCase()
  const list = (items || []).filter((x) => !term || String(x.name || '').toLowerCase().includes(term) || String(x.description || '').toLowerCase().includes(term))

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fechar">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
        </Pressable>
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={st.handle} />
          <H3>Tabela de preços</H3>
          <Muted style={{ marginTop: 2, marginBottom: spacing.md }}>Toque pra colocar no documento. Dá pra mudar quantidade e preço depois.</Muted>
          {items && items.length > 6 ? (
            <Input placeholder="Buscar item" value={q} onChangeText={setQ} autoCorrect={false} style={{ marginBottom: spacing.sm }} maxLength={60} />
          ) : null}
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {error ? <ErrorBox error={error} /> : !items ? <Loading /> : !items.length ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                <Muted style={{ textAlign: 'center', marginBottom: spacing.md }}>Sua tabela de preços está vazia. Monte uma vez e use em todo orçamento.</Muted>
                <Button title="Montar tabela de preços" icon="pricetags-outline" onPress={() => { onClose(); router.push('/price-book') }} />
              </View>
            ) : !list.length ? <Muted style={{ textAlign: 'center', padding: spacing.lg }}>Nada com "{q.trim()}".</Muted> : list.map((x, i) => (
              <View key={x.id}>
                {i > 0 ? <Divider style={{ marginVertical: 0 }} /> : null}
                <Pressable onPress={() => onPick(x)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs }, pressed && { backgroundColor: colors.paperSoft }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.body, { fontWeight: '600' }]} numberOfLines={1}>{x.name}</Text>
                    <Muted numberOfLines={1}>{kindLabel(x.kind)}{x.taxable ? ' · tributável' : ''}{x.description ? ` · ${x.description}` : ''}</Muted>
                  </View>
                  <Text style={[type.body, { fontWeight: '600' }]}>{fmtMoney(x.unit_price_cents || 0, { decimals: 2 })}<Text style={{ color: colors.inkMuted, fontWeight: '400' }}>/{unitLabel(x.unit, 'pt')}</Text></Text>
                  <Ionicons name="add-circle" size={24} color={colors.green} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button title="Editar tabela" variant="ghost" style={{ flex: 1 }} onPress={() => { onClose(); router.push('/price-book') }} />
            <Button title="Fechar" variant="secondary" style={{ flex: 1 }} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  err: { color: colors.danger, fontSize: 13, marginTop: -spacing.md, marginBottom: spacing.md },
  lbl: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginBottom: 6 },
  select: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white, paddingHorizontal: spacing.md, gap: 4 },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: '31%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.paperSoft },
  addTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.green, backgroundColor: colors.greenSoft },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 56, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingTop: spacing.sm, width: '100%', maxWidth: 640, alignSelf: 'center' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: spacing.md },
})
