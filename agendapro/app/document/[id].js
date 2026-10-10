// Detalhe do orçamento ou da fatura: valores, itens, fotos, assinatura de quem
// aprovou, pagamentos e linha do tempo, com as ações de cada status — enviar,
// ver como a cliente, editar, duplicar, aprovar/recusar, converter em fatura,
// registrar pagamento, lembrar, anular, excluir. Push e links abrem aqui.
import { useCallback, useRef, useState } from 'react'
import { Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import * as Haptics from 'expo-haptics'
import { api, post } from '../../lib/api'
import { DEMO } from '../../lib/config'
import { BRAND } from '../../lib/variant'
import { useApp } from '../../lib/session'
import { ensureFeature, featureInfo, showError } from '../../lib/gate'
import { choose, confirm, notify } from '../../lib/dialog'
import { centsToInput, dateKey, fmtAgo, fmtDay, fmtMoney, fmtPhone, parseMoney, todayKey } from '../../lib/format'
import { cleanPct } from '../../lib/docCalc'
import { sendSms } from '../../lib/whatsapp'
import {
  DOC_LANGS, DocStatusBadge, INVOICE_METHODS, OPEN_INVOICE, OPEN_QUOTE, docKindLabel, eventInfo, fmtQty, fmtRate,
  paymentMethodLabel, shareDocLink, sharePdf, takePendingSend, totalsOf, unitLabel,
} from '../../lib/documents'
import { colors, radius, spacing, type } from '../../lib/theme'
import { Button, Card, Chip, Divider, Empty, ErrorBox, H2, H3, Input, Label, Loading, Muted, P, Row, Screen, Section, Small } from '../../components/ui'
import { DateField } from '../../components/pickers'

const isWeb = Platform.OS === 'web'
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const FEATURE = { quote: 'quotes', invoice: 'invoices' }
const DECLINE_REASONS = ['Achou caro', 'Fechou com outra pessoa', 'Desistiu do serviço', 'Outro motivo']
const pad = (n) => String(n).padStart(2, '0')
const haptic = () => { if (!isWeb) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}) }
const one = (v) => (Array.isArray(v) ? v[0] : v) || ''
const diffDays = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400e3)

/** Data pura ('YYYY-MM-DD') ou instante real → 'ter, 14 out' (+ hora se instante). */
function whenOf(v, withTime = false) {
  const s = String(v || '')
  if (!s) return ''
  if (KEY_RE.test(s)) return fmtDay(s)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return withTime ? `${fmtDay(dateKey(d))} · ${pad(d.getHours())}:${pad(d.getMinutes())}` : fmtDay(dateKey(d))
}

/** Etapas sugeridas: entrada (ou 30%), meio da obra e entrega, somando 100. */
function defaultStages(depPct) {
  const first = Math.min(90, Math.max(10, Math.round(depPct || 30)))
  const mid = Math.round((100 - first) / 2)
  return [
    { key: 's1', label: 'Entrada', pct: String(first) },
    { key: 's2', label: 'Meio da obra', pct: String(mid) },
    { key: 's3', label: 'Entrega', pct: String(100 - first - mid) },
  ]
}

export default function DocumentDetail() {
  const params = useLocalSearchParams()
  const id = one(params.id)
  const app = useApp()
  const { provider, settings } = app

  const [data, setData] = useState(null)        // { document, items, payments, events }
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(null)
  const [sheet, setSheet] = useState(null)      // 'send' | 'convert'
  const [panel, setPanel] = useState(null)      // 'pay' | 'decline'
  const [pay, setPay] = useState({ amount: '', method: 'zelle', date: todayKey(), note: '' })
  const [payErr, setPayErr] = useState({})
  const [decline, setDecline] = useState({ reason: DECLINE_REASONS[0], text: '' })
  const [conv, setConv] = useState({ mode: 'full', depositPct: '30', stages: defaultStages(30) })
  const [viewer, setViewer] = useState(null)
  const wantSend = useRef(one(params.send) === '1')
  const loadedOnce = useRef(false)

  const load = useCallback(async (kind = 'initial') => {
    if (!id) return
    if (kind === 'refresh') setRefreshing(true)
    try {
      const r = await api(`/api/agenda/documents?id=${encodeURIComponent(id)}`)
      if (!r?.document) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 })
      setData({ document: r.document, items: r.items || [], payments: r.payments || [], events: r.events || [] })
      setError(null)
      if (wantSend.current) { wantSend.current = false; setSheet('send') }
    } catch (e) {
      setError(e)
    } finally {
      setRefreshing(false)
    }
  }, [id])

  useFocusEffect(useCallback(() => {
    if (takePendingSend(id)) wantSend.current = true
    load(loadedOnce.current ? 'silent' : 'initial')
    loadedOnce.current = true
  }, [load, id]))

  // ── Carregando / erro ──────────────────────────────────────────────────
  if (!data) {
    return (
      <Screen onRefresh={() => load('refresh')} refreshing={refreshing}>
        <Stack.Screen options={{ title: 'Documento' }} />
        {error ? (
          error.status === 404 ? (
            <Empty icon="document-outline" title="Documento não encontrado" text="Ele pode ter sido excluído ou é de outra conta."
              action={<Button title="Voltar" variant="secondary" onPress={() => router.back()} />} />
          ) : <ErrorBox error={error} onRetry={() => load('refresh')} />
        ) : <Loading text="Abrindo…" />}
      </Screen>
    )
  }

  // ── Dados derivados ────────────────────────────────────────────────────
  const doc = data.document
  const items = [...data.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const payments = data.payments
  const events = [...data.events].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const isQuote = doc.kind !== 'invoice'
  const feature = FEATURE[doc.kind] || 'quotes'
  const t = totalsOf(doc, items)
  const today = todayKey()
  const st = doc.status
  const openInvoice = !isQuote && OPEN_INVOICE.includes(st)
  const waitingQuote = isQuote && OPEN_QUOTE.includes(st)
  const due = doc.due_date ? String(doc.due_date).slice(0, 10) : ''
  const lateDays = openInvoice && due && due < today ? diffDays(due, today) : 0
  const noun = docKindLabel(doc.kind).toLowerCase()
  const langName = DOC_LANGS.find((l) => l.value === doc.language)?.label || 'English'
  const branding = !app.can('no_branding')
  const business = settings?.business || {}
  // Mesmas travas do servidor (editBlock → 409 locked): orçamento faturado não muda nada;
  // aprovado e fatura paga/anulada só mudam fotos e anotação interna (editor em modo travado).
  const allLocked = isQuote && st === 'converted'
  const valuesLocked = (isQuote && st === 'accepted') || (!isQuote && (st === 'paid' || st === 'void'))
  const editable = !allLocked
  const lockNote = allLocked ? 'Este orçamento já virou fatura: itens e valores não mudam mais. Pra fazer outro, duplique.'
    : st === 'accepted' ? 'A cliente já aprovou: itens e valores não mudam mais. Pra mudar, duplique e envie de novo.'
      : st === 'paid' ? 'Fatura paga: itens e valores não mudam. Pra corrigir, apague o pagamento antes.'
        : st === 'void' ? 'Fatura anulada: itens e valores não mudam. Duplique pra emitir outra.' : ''
  // E-mail da cliente só muda no editor enquanto os valores não estão travados
  const canFixEmail = editable && !valuesLocked

  // ── Chamadas ───────────────────────────────────────────────────────────
  /** POST /api/agenda/documents com a ação. → resposta ou null (erro já mostrado). */
  async function act(action, extra = {}, { reload = true } = {}) {
    setBusy(action)
    try {
      const r = await post('/api/agenda/documents', { action, id: doc.id, ...extra })
      haptic()
      if (r?.document && r.document.id === doc.id) setData((d) => (d ? { ...d, document: { ...d.document, ...r.document } } : d))
      if (reload) load('silent')
      return r || {}
    } catch (e) {
      // Teto de e-mail do dia: oferece o WhatsApp/link no lugar do alerta genérico
      if (e?.code === 'email_limit' && (action === 'send' || action === 'remind')) {
        const go = await choose('Limite de e-mail de hoje', [
          { label: 'Mandar pelo WhatsApp', value: 'whatsapp' },
          { label: 'Copiar o link', value: 'link' },
        ], { message: e.message })
        if (go === 'whatsapp') await shareDocLink(doc, `${docKindLabel(doc.kind)} ${doc.number}: ${doc.public_url || ''}`, { via: 'whatsapp' })
        else if (go === 'link') { await Clipboard.setStringAsync(doc.public_url || '').catch(() => {}); notify('Link copiado', 'Cole na conversa com a cliente.') }
        return null
      }
      showError(e)
      return null
    } finally {
      setBusy(null)
    }
  }

  /**
   * E-mail que não saiu (send/remind sem email_sent: true, ou documento sem e-mail):
   * explica o porquê e oferece o WhatsApp — e cadastrar o e-mail, quando ainda dá.
   * r = resposta da API (null = nem tentou); onWhatsApp = o que fazer se escolher WhatsApp.
   */
  async function emailNotSent(r, onWhatsApp, { reminder = false } = {}) {
    const noEmail = !(r?.document?.client_email || doc.client_email)
    const options = [{ label: reminder ? 'Cobrar pelo WhatsApp' : 'Mandar pelo WhatsApp', value: 'whatsapp' }]
    if (noEmail && canFixEmail) options.push({ label: 'Cadastrar o e-mail da cliente', value: 'edit' })
    const message = !noEmail
      ? (r?.email_error || 'Não conseguimos mandar o e-mail agora. Mande pelo WhatsApp ou pelo link.')
      : canFixEmail
        ? 'Este documento não tem o e-mail da cliente. Cadastre o e-mail (em Editar) ou mande pelo WhatsApp.'
        : 'Este documento não tem o e-mail da cliente. Mande pelo WhatsApp ou copie o link.'
    const v = await choose(noEmail ? 'Cliente sem e-mail' : 'O e-mail não saiu', options, { message, cancel: 'Agora não' })
    if (v === 'whatsapp') await onWhatsApp()
    else if (v === 'edit') edit()
  }

  async function send(channel) {
    if (!(await ensureFeature(app, feature))) return
    if (channel === 'email' && !doc.client_email) {
      setSheet(null)
      await new Promise((r) => setTimeout(r, 350))   // folha de envio fecha antes (iPhone não abre uma sobre a outra fechando)
      await emailNotSent(null, () => send('whatsapp'))
      return
    }
    if (channel === 'sms' && !doc.client_phone) {
      notify('Sem telefone', 'Essa cliente não tem telefone no documento.')
      return
    }
    setSheet(null)
    const apiChannel = channel === 'share' || channel === 'pdf' ? 'link' : channel
    const r = await act('send', { channel: apiChannel })
    if (!r) return
    const url = r.public_url || doc.public_url || ''
    const message = r.message || url
    const fresh = { ...doc, ...(r.document || {}), public_url: url }
    if (channel === 'whatsapp') await shareDocLink(fresh, message, { via: 'whatsapp' })
    else if (channel === 'sms') sendSms(doc.client_phone, message)
    else if (channel === 'share') await shareDocLink(fresh, message, { via: 'share' })
    else if (channel === 'email') {
      // Só confirma com email_sent: true (sem e-mail ou falha no envio → orienta e oferece o WhatsApp)
      if (r.email_sent === true) notify('E-mail enviado', `${docKindLabel(doc.kind)} ${fresh.number || doc.number} foi pro e-mail ${fresh.client_email || doc.client_email}.`)
      else await emailNotSent(r, () => shareDocLink(fresh, message, { via: 'whatsapp' }))
    }
    else if (channel === 'link') {
      await Clipboard.setStringAsync(url).catch(() => {})
      notify('Link copiado', 'Cole na conversa com a cliente. Ela abre, vê tudo e ' + (isQuote ? 'aprova com assinatura.' : 'paga.'))
    } else if (channel === 'pdf') await makePdf(fresh)
  }

  async function makePdf(base = doc) {
    setBusy('pdf')
    try {
      await sharePdf(base, items, provider || {}, business, { branding, payments, brandName: BRAND.name })
    } catch (e) {
      showError(e, 'Não deu pra gerar o PDF')
    } finally {
      setBusy(null)
    }
  }

  async function viewAsClient() {
    // Demonstração: o link aponta pro site de verdade, que não tem os dados de exemplo
    if (DEMO) { notify('Modo demonstração', 'O link da cliente só funciona com dados reais. Use o PDF pra ver o documento.'); return }
    // Rascunho não abre no link (a página pública só mostra o que já foi enviado)
    if (!doc.public_url || st === 'draft') { notify('Ainda é rascunho', 'A cliente só vê pelo link depois que você enviar. Pra conferir antes, use o PDF.'); return }
    // preview=1: a página não conta como "visto pela cliente"
    const url = `${doc.public_url}${doc.public_url.includes('?') ? '&' : '?'}preview=1`
    if (isWeb) { window.open(url, '_blank'); return }
    try { await WebBrowser.openBrowserAsync(url, { controlsColor: colors.green }) } catch (_) { Linking.openURL(url).catch(() => {}) }
  }

  const edit = () => router.push({ pathname: '/document/edit', params: { id: doc.id, from: 'detail' } })

  async function duplicate() {
    if (!(await ensureFeature(app, feature))) return
    const r = await act('duplicate', {}, { reload: false })
    const newId = r?.document?.id
    if (newId) router.push({ pathname: '/document/edit', params: { id: newId } })
  }

  async function markAccepted() {
    const expired = st === 'expired'
    const ok = await confirm('Marcar como aprovado?', expired
      ? `A validade venceu${doc.valid_until ? ` em ${whenOf(doc.valid_until)}` : ''}. Use quando a cliente aprovou por fora (WhatsApp, pessoalmente, por telefone). Se precisar, a validade passa pra hoje.`
      : 'Use quando a cliente aprovou por fora (WhatsApp, pessoalmente, por telefone).', { ok: 'Aprovado' })
    if (!ok) return
    if (!expired) { await act('mark_accepted'); return }
    // Vencido: se o servidor recusar (o cron já gravou 'expired'), estende a validade até
    // hoje (update reabre o orçamento) e aprova de novo.
    setBusy('mark_accepted')
    try {
      try {
        await post('/api/agenda/documents', { action: 'mark_accepted', id: doc.id })
      } catch (e) {
        if (e?.code !== 'invalid_status') throw e
        const issued = doc.issue_date ? String(doc.issue_date).slice(0, 10) : ''
        await post('/api/agenda/documents', { action: 'update', id: doc.id, valid_until: issued > today ? issued : today })
        await post('/api/agenda/documents', { action: 'mark_accepted', id: doc.id })
      }
      haptic()
    } catch (e) {
      showError(e)
    } finally {
      setBusy(null)
      load('silent')
    }
  }

  /** Link novo (o antigo para de abrir): mandou pra pessoa errada ou o link vazou. */
  async function rotateLink() {
    const ok = await confirm('Trocar o link?', `O link antigo para de funcionar: quem abrir a mensagem antiga não vê mais ${isQuote ? 'o orçamento' : 'a fatura'}. Use se mandou pra pessoa errada ou se o link foi parar onde não devia. Depois, mande o link novo pra cliente.`, { ok: 'Trocar o link', destructive: true })
    if (!ok) return
    const r = await act('rotate_link')
    if (!r?.document) return
    const again = await confirm('Link trocado', 'O link antigo não abre mais. Mandar o link novo pra cliente agora?', { ok: 'Mandar', cancel: 'Depois' })
    if (again) setSheet('send')
  }

  async function doDecline() {
    const other = decline.reason === 'Outro motivo'
    const reason = (other ? decline.text.trim() : decline.reason).slice(0, 300)
    if (other && !reason) { notify('Qual o motivo?', 'Escreva o motivo, ou escolha um da lista.'); return }
    const r = await act('decline', { reason })
    if (r) setPanel(null)
  }

  /** Cobrança da fatura (POST remind): por e-mail (sai do servidor) ou WhatsApp (mensagem pronta). */
  async function remind() {
    if (!(await ensureFeature(app, 'invoices'))) return
    const options = []
    if (doc.client_email) options.push({ label: `E-mail (${doc.client_email})`, value: 'email' })
    options.push({ label: doc.client_phone ? `WhatsApp (${fmtPhone(doc.client_phone)})` : 'WhatsApp (escolher contato)', value: 'whatsapp' })
    if (doc.client_phone) options.push({ label: 'SMS', value: 'sms' })
    const channel = await choose('Lembrar a cliente', options, { message: `Saldo de ${fmtMoney(t.balance_cents, { decimals: 2 })}, com o link pra pagar.` })
    if (!channel) return
    const r = await act('remind', { channel })
    if (!r) return
    const message = r.message || r.public_url || doc.public_url || ''
    if (channel === 'whatsapp') await shareDocLink(doc, message, { via: 'whatsapp' })
    else if (channel === 'sms') sendSms(doc.client_phone, message)
    else if (r.email_sent === true) notify('Lembrete enviado', `Foi pro e-mail ${r.document?.client_email || doc.client_email}.`)
    else await emailNotSent(r, () => shareDocLink(doc, message, { via: 'whatsapp' }), { reminder: true })
  }

  async function doVoid() {
    if (Number(doc.amount_paid_cents) > 0) {
      notify('Tem pagamento registrado', 'Apague os pagamentos desta fatura antes de anular.')
      return
    }
    const ok = await confirm('Anular a fatura?', 'Ela fica marcada como anulada, sai do "a receber" e o link para de aceitar pagamento. Não dá pra desfazer.', { ok: 'Anular', destructive: true })
    if (ok) await act('void')
  }

  async function remove() {
    const ok = await confirm(`Excluir ${noun}?`, 'O rascunho some de vez. Não dá pra desfazer.', { ok: 'Excluir', destructive: true })
    if (!ok) return
    const r = await act('delete', {}, { reload: false })
    if (r) router.back()
  }

  // ── Converter em fatura ────────────────────────────────────────────────
  async function openConvert() {
    if (!(await ensureFeature(app, 'invoices'))) return
    // Entrada sugerida: a do orçamento, senão a padrão, senão 30%
    const fromCents = t.total_cents > 0 && t.deposit_cents > 0 ? Math.round((t.deposit_cents / t.total_cents) * 100) : 0
    const dep = cleanPct(doc.deposit_pct) || fromCents || Number(settings?.doc_defaults?.deposit_pct) || 30
    setConv({ mode: 'full', depositPct: String(dep), stages: defaultStages(dep) })
    setSheet('convert')
  }

  /** Orçamento já faturado em parte (entrada/etapas): fatura do saldo que falta. */
  async function invoiceRest() {
    if (!(await ensureFeature(app, 'invoices'))) return
    const ok = await confirm('Faturar o restante?', 'Criamos uma fatura em rascunho com o valor do orçamento que ainda não foi faturado.', { ok: 'Criar fatura' })
    if (!ok) return
    const r = await act('convert', { mode: 'full' })
    const inv = Array.isArray(r?.invoices) ? r.invoices[0] : null
    if (inv?.id) router.push(`/document/${inv.id}`)
  }

  const stageSum = conv.stages.reduce((s, x) => s + (cleanPct(x.pct) || 0), 0)

  async function doConvert() {
    const mode = conv.mode
    if (mode !== 'full' && !(await ensureFeature(app, 'progress_billing'))) return
    const extra = {}
    if (mode === 'deposit') {
      const pct = cleanPct(conv.depositPct)
      if (!pct || pct <= 0 || pct >= 100) { notify('Entrada', 'Coloque o percentual da entrada (de 1 a 99%).'); return }
      extra.deposit_pct = pct
    }
    if (mode === 'stages') {
      const stages = conv.stages.map((x) => ({ label: x.label.trim().slice(0, 60), pct: cleanPct(x.pct) || 0 }))
      if (stages.length < 2) { notify('Etapas', 'Coloque pelo menos 2 etapas.'); return }
      if (stages.some((x) => !x.label || x.pct <= 0)) { notify('Etapas', 'Cada etapa precisa de nome e percentual.'); return }
      const sum = Math.round(stageSum * 100) / 100
      if (sum > 100) { notify('Etapas', `As etapas somam ${sum}%. O máximo é 100%.`); return }
      if (sum < 100) {
        const ok = await confirm('Etapas somam menos de 100%', `As etapas somam ${sum}%. Os ${Math.round((100 - sum) * 100) / 100}% que faltam você fatura depois em "Faturar o restante". Continuar?`, { ok: 'Continuar' })
        if (!ok) return
      }
      extra.stages = stages
    }
    const r = await act('convert', { mode, ...extra })
    if (!r) return
    setSheet(null)
    const invoices = Array.isArray(r.invoices) ? r.invoices : []
    if (!invoices.length) return
    if (invoices.length > 1) notify('Faturas criadas', `${invoices.length} faturas em rascunho, uma por etapa. Mande cada uma quando chegar a hora.`)
    router.push(`/document/${invoices[0].id}`)
  }

  // ── Pagamento ──────────────────────────────────────────────────────────
  async function openPay() {
    if (!(await ensureFeature(app, 'invoices'))) return
    setPay({ amount: centsToInput(t.balance_cents), method: 'zelle', date: todayKey(), note: '' })
    setPayErr({})
    setPanel('pay')
  }

  async function savePay() {
    const amount = parseMoney(pay.amount)
    // Acima do saldo vale (gorjeta, troco), com confirmação; teto igual ao do servidor: o dobro do total
    const cap = Math.max(t.balance_cents, t.total_cents * 2)
    const e = {}
    if (!amount || amount <= 0) e.amount = 'Valor inválido. Ex.: 500 ou 500.50'
    else if (amount > cap) e.amount = `Valor muito acima do saldo da fatura (${fmtMoney(t.balance_cents, { decimals: 2 })})`
    if (!KEY_RE.test(pay.date)) e.date = 'Data inválida (AAAA-MM-DD)'
    else if (pay.date > today) e.date = 'A data não pode ser no futuro'
    setPayErr(e)
    if (Object.keys(e).length) return
    if (amount > t.balance_cents) {
      const ok = await confirm('Valor maior que o saldo', `Registrar mesmo assim? ${fmtMoney(amount, { decimals: 2 })} passa ${fmtMoney(amount - t.balance_cents, { decimals: 2 })} do saldo de ${fmtMoney(t.balance_cents, { decimals: 2 })}. O que passar conta como gorjeta ou acréscimo.`, { ok: 'Registrar' })
      if (!ok) return
    }
    const r = await act('record_payment', { amount_cents: amount, method: pay.method, paid_on: pay.date, note: pay.note.trim().slice(0, 300) || null })
    if (r) setPanel(null)
  }

  async function removePayment(p) {
    const ok = await confirm('Apagar este pagamento?', `${fmtMoney(p.amount_cents, { decimals: 2 })} · ${paymentMethodLabel(p.method)}. O saldo da fatura volta a subir.`, { ok: 'Apagar', destructive: true })
    if (ok) await act('remove_payment', { payment_id: p.id })
  }

  // Menu do cabeçalho (ações menos comuns)
  async function moreMenu() {
    const options = []
    if (editable) options.push({ label: valuesLocked ? 'Editar notas e fotos' : 'Editar', value: 'edit' })
    options.push({ label: 'Duplicar', value: 'duplicate' })
    options.push({ label: isWeb ? 'Gerar PDF / imprimir' : 'Compartilhar PDF', value: 'pdf' })
    if (doc.public_url && st !== 'draft') options.push({ label: 'Ver como a cliente', value: 'view' })
    if (doc.public_url && st !== 'draft') options.push({ label: 'Trocar o link', value: 'rotate' })
    if (st === 'draft') options.push({ label: 'Marcar como enviado', value: 'mark_sent' })
    if (isQuote && ['sent', 'viewed', 'expired'].includes(st)) options.push({ label: 'Converter em fatura', value: 'convert' })
    if (!isQuote && st !== 'draft' && st !== 'void' && st !== 'paid') options.push({ label: 'Anular fatura', value: 'void', destructive: true })
    if (st === 'draft') options.push({ label: `Excluir ${noun}`, value: 'delete', destructive: true })
    const v = await choose(`${docKindLabel(doc.kind)} ${doc.number || ''}`.trim(), options)
    if (v === 'edit') edit()
    if (v === 'duplicate') duplicate()
    if (v === 'pdf') makePdf()
    if (v === 'view') viewAsClient()
    if (v === 'rotate') rotateLink()
    if (v === 'mark_sent') act('mark_sent')
    if (v === 'convert') openConvert()
    if (v === 'void') doVoid()
    if (v === 'delete') remove()
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const statusText = (() => {
    if (isQuote) {
      if (st === 'draft') return 'Rascunho: a cliente ainda não viu.'
      if (st === 'sent') return `Enviado${doc.sent_at ? ' ' + fmtAgo(doc.sent_at) : ''}. Esperando a cliente abrir o link.`
      if (st === 'viewed') return `A cliente abriu o link${doc.viewed_at ? ' ' + fmtAgo(doc.viewed_at) : ''}. Bom momento pra dar um alô.`
      if (st === 'accepted') return `Aprovado${doc.accepted_name ? ` por ${doc.accepted_name}` : ''}${doc.accepted_at ? ` em ${whenOf(doc.accepted_at)}` : ''}. Hora de faturar!`
      if (st === 'declined') return `Recusado${doc.decline_reason ? `: ${doc.decline_reason}` : '.'}`
      if (st === 'expired') return `A validade venceu${doc.valid_until ? ` em ${whenOf(doc.valid_until)}` : ''}. Ajuste a data e mande de novo.`
      if (st === 'converted') return 'Este orçamento já virou fatura.'
      return ''
    }
    if (st === 'draft') return 'Rascunho: a cliente ainda não viu.'
    if (st === 'paid') return `Paga${doc.paid_at ? ` em ${whenOf(doc.paid_at)}` : ''}. Tudo certo!`
    if (st === 'void') return `Anulada${doc.voided_at ? ` em ${whenOf(doc.voided_at)}` : ''}.`
    if (lateDays) return `Venceu há ${lateDays} dia${lateDays === 1 ? '' : 's'}. Falta receber ${fmtMoney(t.balance_cents, { decimals: 2 })}.`
    if (st === 'partial') return `Recebido ${fmtMoney(doc.amount_paid_cents, { decimals: 2 })}. Falta ${fmtMoney(t.balance_cents, { decimals: 2 })}${due ? `, vence ${whenOf(due)}` : ''}.`
    if (st === 'viewed') return `A cliente abriu a fatura${doc.viewed_at ? ' ' + fmtAgo(doc.viewed_at) : ''}${due ? `. Vence ${whenOf(due)}` : ''}.`
    return `Enviada${doc.sent_at ? ' ' + fmtAgo(doc.sent_at) : ''}${due ? `. Vence ${whenOf(due)}` : ''}.`
  })()

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <Stack.Screen options={{
        title: doc.number || docKindLabel(doc.kind),
        headerRight: () => (
          <Pressable onPress={moreMenu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Mais ações">
            <Ionicons name="ellipsis-horizontal-circle-outline" size={26} color={colors.green} />
          </Pressable>
        ),
      }} />
      <Screen onRefresh={() => load('refresh')} refreshing={refreshing}>
        <ErrorBox error={error} onRetry={() => load('refresh')} />

        {/* Cabeçalho */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Label style={{ flex: 1 }}>{docKindLabel(doc.kind)} {doc.number}</Label>
            <DocStatusBadge kind={doc.kind} status={st} />
          </View>
          <Pressable onPress={doc.client_id ? () => router.push(`/client/${doc.client_id}`) : undefined} disabled={!doc.client_id}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }, pressed && { opacity: 0.7 }]}>
            <H2 style={{ flexShrink: 1 }} numberOfLines={2}>{doc.client_name || 'Sem cliente'}</H2>
            {doc.client_id ? <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
          </Pressable>
          {doc.title ? <P style={{ color: colors.inkSoft, marginTop: 2 }}>{doc.title}</P> : null}
          {doc.stage_label ? <Small style={{ marginTop: 2, fontWeight: '600' }}>{doc.stage_label}</Small> : null}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.md, gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Muted>Total</Muted>
              <Text style={[type.kpi, st === 'void' && { color: colors.inkMuted, textDecorationLine: 'line-through' }]}>{fmtMoney(t.total_cents, { decimals: 2 })}</Text>
            </View>
            {!isQuote && st !== 'void' && st !== 'draft' ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Muted>{st === 'paid' ? 'Recebido' : 'Falta receber'}</Muted>
                <Text style={[type.h2, { color: st === 'paid' ? colors.success : lateDays ? colors.danger : colors.ink }]}>
                  {fmtMoney(st === 'paid' ? doc.amount_paid_cents || t.total_cents : t.balance_cents, { decimals: 2 })}
                </Text>
              </View>
            ) : isQuote && t.deposit_cents > 0 ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Muted>Entrada</Muted>
                <Text style={[type.h3]}>{fmtMoney(t.deposit_cents, { decimals: 2 })}</Text>
              </View>
            ) : null}
          </View>

          <Divider />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Meta k="Data" v={whenOf(doc.issue_date) || '—'} />
            {isQuote ? <Meta k="Válido até" v={doc.valid_until ? whenOf(doc.valid_until) : 'Sem validade'} warn={waitingQuote && doc.valid_until && String(doc.valid_until).slice(0, 10) < today} />
              : <Meta k="Vencimento" v={due ? whenOf(due) : 'Na entrega'} warn={!!lateDays} />}
            <Meta k="Idioma" v={langName} />
          </View>
          {doc.quote_id || doc.appointment_id ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md }}>
              {doc.quote_id ? <LinkText icon="document-text-outline" text="Ver o orçamento" onPress={() => router.push(`/document/${doc.quote_id}`)} /> : null}
              {doc.appointment_id ? <LinkText icon="calendar-outline" text="Ver o atendimento" onPress={() => router.push(`/appointment/${doc.appointment_id}`)} /> : null}
            </View>
          ) : null}
        </Card>

        {/* O que fazer */}
        <Section title="O que fazer">
          <Card>
            <Muted style={{ marginBottom: spacing.md }}>{statusText}</Muted>
            <View style={{ gap: spacing.sm }}>
              {st === 'draft' ? (
                <>
                  <Button title={`Enviar pra cliente`} icon="paper-plane-outline" onPress={() => setSheet('send')} loading={busy === 'send'} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button small title="Editar" icon="create-outline" variant="secondary" style={{ flex: 1 }} onPress={edit} />
                    <Button small title={isWeb ? 'Prévia (PDF)' : 'Prévia em PDF'} icon="document-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'pdf'} onPress={() => makePdf()} />
                  </View>
                </>
              ) : null}

              {waitingQuote ? (
                <>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button small title="Aprovado" icon="checkmark-circle-outline" style={{ flex: 1 }} loading={busy === 'mark_accepted'} onPress={markAccepted} />
                    <Button small title="Recusado" icon="close-circle-outline" variant="danger" style={{ flex: 1 }} onPress={() => { setDecline({ reason: DECLINE_REASONS[0], text: '' }); setPanel('decline') }} />
                  </View>
                  <Button small title="Reenviar pra cliente" icon="paper-plane-outline" variant="secondary" onPress={() => setSheet('send')} />
                </>
              ) : null}

              {isQuote && st === 'accepted' ? (
                <>
                  <Button title="Converter em fatura" icon="swap-horizontal-outline" variant="gold" onPress={openConvert} />
                  <Button small title="Mandar de novo pra cliente" icon="paper-plane-outline" variant="secondary" onPress={() => setSheet('send')} />
                </>
              ) : null}

              {isQuote && st === 'expired' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button small title="Mudar validade" icon="calendar-outline" variant="secondary" style={{ flex: 1 }} onPress={edit} />
                  <Button small title="Foi aprovado" icon="checkmark-circle-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'mark_accepted'} onPress={markAccepted} />
                </View>
              ) : null}

              {isQuote && st === 'declined' ? (
                <Button small title="Duplicar e ajustar" icon="copy-outline" variant="secondary" loading={busy === 'duplicate'} onPress={duplicate} />
              ) : null}

              {isQuote && st === 'converted' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button small title="Ver faturas" icon="receipt-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.navigate({ pathname: '/vendas', params: { tab: 'invoices', status: 'all' } })} />
                  <Button small title="Faturar o restante" icon="add-circle-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'convert'} onPress={invoiceRest} />
                </View>
              ) : null}

              {openInvoice ? (
                <>
                  <Button title="Registrar pagamento" icon="cash-outline" onPress={openPay} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button small title="Lembrar cliente" icon="alarm-outline" variant={lateDays ? 'gold' : 'secondary'} style={{ flex: 1 }} loading={busy === 'remind'} onPress={remind} />
                    <Button small title="Reenviar" icon="paper-plane-outline" variant="secondary" style={{ flex: 1 }} onPress={() => setSheet('send')} />
                  </View>
                </>
              ) : null}

              {!isQuote && st === 'paid' ? (
                <Button small title={isWeb ? 'PDF da fatura paga' : 'Compartilhar PDF (pago)'} icon="share-outline" variant="secondary" loading={busy === 'pdf'} onPress={() => makePdf()} />
              ) : null}

              {st === 'void' ? (
                <Button small title="Duplicar" icon="copy-outline" variant="secondary" loading={busy === 'duplicate'} onPress={duplicate} />
              ) : null}
            </View>
          </Card>
        </Section>

        {/* Painéis */}
        {panel === 'decline' ? (
          <Card style={[s.panel, { borderColor: '#F3C7C2' }]}>
            <H3 style={{ marginBottom: spacing.sm }}>Orçamento recusado</H3>
            <Muted style={{ marginBottom: spacing.md }}>Anotar o motivo ajuda a ajustar os próximos.</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {DECLINE_REASONS.map((r) => <Chip key={r} label={r} selected={decline.reason === r} onPress={() => setDecline((d) => ({ ...d, reason: r }))} />)}
            </View>
            {decline.reason === 'Outro motivo' ? (
              <Input label="Motivo" value={decline.text} onChangeText={(v) => setDecline((d) => ({ ...d, text: v }))} maxLength={300} placeholder="Ex.: vai fazer só no ano que vem" style={{ marginTop: spacing.sm }} />
            ) : null}
            <Button title="Marcar como recusado" variant="danger" icon="close-circle-outline" loading={busy === 'decline'} onPress={doDecline} style={{ marginTop: spacing.sm }} />
            <Button title="Voltar" variant="ghost" onPress={() => setPanel(null)} style={{ marginTop: spacing.xs }} />
          </Card>
        ) : null}

        {panel === 'pay' ? (
          <Card style={s.panel}>
            <H3>Registrar pagamento</H3>
            <Muted style={{ marginBottom: spacing.md }}>Saldo: {fmtMoney(t.balance_cents, { decimals: 2 })} de {fmtMoney(t.total_cents, { decimals: 2 })}</Muted>
            <Input label="Valor recebido (US$)" value={pay.amount} keyboardType="decimal-pad" error={payErr.amount} maxLength={12}
              onChangeText={(v) => setPay((p) => ({ ...p, amount: v }))} />
            <Label style={{ marginBottom: spacing.sm }}>Forma de pagamento</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
              {INVOICE_METHODS.map((m) => <Chip key={m.value} label={m.label} icon={m.icon} selected={pay.method === m.value} onPress={() => setPay((p) => ({ ...p, method: m.value }))} />)}
            </View>
            <DateField label="Dia que recebeu" value={pay.date} onChange={(v) => setPay((p) => ({ ...p, date: v }))} maximumDate={new Date()} />
            {payErr.date ? <Text style={s.err}>{payErr.date}</Text> : null}
            <Input label="Anotação (opcional)" value={pay.note} onChangeText={(v) => setPay((p) => ({ ...p, note: v }))} maxLength={300} placeholder="Ex.: cheque nº 1023" />
            <Button title="Salvar pagamento" icon="checkmark" loading={busy === 'record_payment'} onPress={savePay} />
            <Button title="Fechar" variant="ghost" onPress={() => setPanel(null)} style={{ marginTop: spacing.xs }} />
          </Card>
        ) : null}

        {/* Itens e valores */}
        <Section title={`Itens (${items.length})`}>
          <Card padded={false}>
            {items.length ? items.map((it, i) => {
              const [first, ...rest] = String(it.description || '').split(/\r?\n/)
              const line = t.lines[i]?.line_total_cents ?? 0
              return (
                <View key={it.id || i}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: spacing.lg }} /> : null}
                  <View style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.body, { fontWeight: '600' }]}>{first || '—'}</Text>
                      {rest.length ? <Muted>{rest.join('\n')}</Muted> : null}
                      <Muted style={{ marginTop: 2 }}>
                        {fmtQty(it.quantity, 'pt')} {unitLabel(it.unit, 'pt')} × {fmtMoney(it.unit_price_cents || 0, { decimals: 2 })}{it.taxable && Number(doc.tax_rate_bps) > 0 ? ' · tributável' : ''}
                      </Muted>
                    </View>
                    <Text style={[type.body, { fontWeight: '700' }]}>{fmtMoney(line, { decimals: 2 })}</Text>
                  </View>
                </View>
              )
            }) : <Muted style={{ padding: spacing.lg }}>Nenhum item.</Muted>}
            <View style={{ backgroundColor: colors.paperDeep, padding: spacing.lg, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg }}>
              <TotalLine k="Subtotal" v={fmtMoney(t.subtotal_cents, { decimals: 2 })} />
              {t.discount_cents > 0 ? <TotalLine k={`Desconto${cleanPct(doc.discount_pct) ? ` (${cleanPct(doc.discount_pct)}%)` : ''}`} v={`−${fmtMoney(t.discount_cents, { decimals: 2 })}`} /> : null}
              {Number(doc.tax_rate_bps) > 0 ? <TotalLine k={`Imposto (${fmtRate(doc.tax_rate_bps, 'pt')})`} v={fmtMoney(t.tax_cents, { decimals: 2 })} /> : null}
              <TotalLine k="Total" v={fmtMoney(t.total_cents, { decimals: 2 })} strong />
              {isQuote && t.deposit_cents > 0 ? <TotalLine k={`Entrada na aprovação${cleanPct(doc.deposit_pct) ? ` (${cleanPct(doc.deposit_pct)}%)` : ''}`} v={fmtMoney(t.deposit_cents, { decimals: 2 })} /> : null}
              {!isQuote && Number(doc.amount_paid_cents) > 0 ? <TotalLine k="Pago" v={`−${fmtMoney(doc.amount_paid_cents, { decimals: 2 })}`} /> : null}
              {!isQuote ? <TotalLine k="Saldo" v={fmtMoney(t.balance_cents, { decimals: 2 })} strong /> : null}
            </View>
          </Card>
          {lockNote ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.sm, paddingHorizontal: spacing.xs }}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.inkMuted} style={{ marginTop: 2 }} />
              <Muted style={{ flex: 1 }}>{lockNote}</Muted>
            </View>
          ) : null}
        </Section>

        {/* Pagamentos */}
        {!isQuote ? (
          <Section title="Pagamentos" right={openInvoice && panel !== 'pay' ? <Pressable onPress={openPay} hitSlop={8}><Text style={s.link}>Registrar</Text></Pressable> : null}>
            <Card padded={false}>
              {payments.length ? payments.map((p, i) => (
                <View key={p.id || i}>
                  {i > 0 ? <Divider style={{ marginVertical: 0, marginLeft: 60 }} /> : null}
                  <Row icon={p.source === 'stripe' ? 'card-outline' : (INVOICE_METHODS.find((m) => m.value === p.method)?.icon || 'cash-outline')}
                    iconColor={colors.success}
                    title={`${fmtMoney(p.amount_cents, { decimals: 2 })} · ${paymentMethodLabel(p.source === 'stripe' && !p.method ? 'stripe' : p.method)}`}
                    subtitle={[whenOf(p.paid_at), p.source === 'stripe' ? 'pago online' : null, p.note].filter(Boolean).join(' · ')}
                    right={p.source !== 'stripe' && st !== 'void' ? (
                      <Pressable onPress={() => removePayment(p)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Apagar pagamento">
                        <Ionicons name="trash-outline" size={18} color={colors.inkMuted} />
                      </Pressable>
                    ) : null} />
                </View>
              )) : <Muted style={{ padding: spacing.lg }}>{st === 'draft' ? 'Depois de enviar, registre aqui o que a cliente pagar.' : 'Nenhum pagamento ainda.'}</Muted>}
            </Card>
            {openInvoice ? <ExtrasForInvoice app={app} provider={provider} doc={doc} /> : null}
          </Section>
        ) : null}

        {/* Aprovação */}
        {isQuote && (doc.accepted_at || doc.accepted_name || doc.accepted_signature) ? (
          <Section title="Aprovação">
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={[type.body, { fontWeight: '600', flex: 1 }]}>
                  {doc.accepted_name ? `Aprovado por ${doc.accepted_name}` : 'Aprovado'}
                </Text>
              </View>
              {doc.accepted_at ? <Muted style={{ marginTop: 2 }}>{whenOf(doc.accepted_at, true)}</Muted> : null}
              {doc.signed_hash ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
                  <Ionicons name="shield-checkmark-outline" size={15} color={colors.inkMuted} />
                  <Muted style={{ flex: 1 }}>Assinado eletronicamente · código {String(doc.signed_hash).slice(0, 8)}</Muted>
                </View>
              ) : null}
              {/^data:image\/(png|jpeg);base64,/.test(String(doc.accepted_signature || '')) ? (
                <Pressable onPress={() => setViewer(doc.accepted_signature)} style={s.signature} accessibilityLabel="Ver assinatura">
                  <Image source={{ uri: doc.accepted_signature }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                </Pressable>
              ) : null}
            </Card>
          </Section>
        ) : null}
        {isQuote && st === 'declined' && doc.decline_reason ? (
          <Section title="Motivo da recusa"><Card><P>{doc.decline_reason}</P></Card></Section>
        ) : null}

        {/* Fotos */}
        {Array.isArray(doc.photos) && doc.photos.length ? (
          <Section title={`Fotos (${doc.photos.length})`}>
            <View style={s.grid}>
              {doc.photos.map((u, i) => (
                <Pressable key={u + i} onPress={() => setViewer(u)} style={s.thumb} accessibilityLabel={`Foto ${i + 1}`}>
                  <Image source={{ uri: u }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {/* Textos */}
        {doc.notes || doc.terms || doc.payment_instructions ? (
          <Section title="Pra cliente">
            <Card>
              <TextBlock k="Recado" v={doc.notes} />
              <TextBlock k="Condições" v={doc.terms} />
              <TextBlock k="Como pagar" v={doc.payment_instructions} last />
            </Card>
          </Section>
        ) : null}
        {doc.internal_notes ? (
          <Section title="Só pra você">
            <Card><P selectable>{doc.internal_notes}</P></Card>
          </Section>
        ) : null}

        {/* Contato da cliente */}
        {doc.client_phone || doc.client_email || doc.client_address || doc.job_address ? (
          <Section title="Cliente">
            <Card padded={false}>
              {doc.client_phone ? <Row icon="call-outline" title={fmtPhone(doc.client_phone)} subtitle="Telefone / WhatsApp" /> : null}
              {doc.client_email ? <Row icon="mail-outline" title={doc.client_email} subtitle="E-mail" /> : null}
              {doc.client_address ? <Row icon="home-outline" title={doc.client_address} subtitle="Endereço" numberOfLines={2} /> : null}
              {doc.job_address ? <Row icon="location-outline" title={doc.job_address} subtitle="Local do serviço" numberOfLines={2} /> : null}
            </Card>
          </Section>
        ) : null}

        {/* Linha do tempo */}
        <Section title="Linha do tempo">
          <Card>
            {events.length ? events.map((ev, i) => {
              const info = eventInfo(ev, doc.kind)
              return (
                <View key={ev.id || i} style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: 6 }}>
                  <View style={{ alignItems: 'center' }}>
                    <View style={s.dot}><Ionicons name={info.icon} size={15} color={colors.green} /></View>
                    {i < events.length - 1 ? <View style={s.line} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: spacing.xs }}>
                    <Text style={[type.body, { fontWeight: '500' }]}>{info.title}</Text>
                    <Muted>{[info.sub, whenOf(ev.created_at, true)].filter(Boolean).join(' · ')}</Muted>
                  </View>
                </View>
              )
            }) : <Muted>{doc.created_at ? `Criado ${fmtAgo(doc.created_at)}.` : 'Sem movimentação ainda.'}</Muted>}
            {!isQuote && Number(doc.reminders_sent) > 0 ? <Muted style={{ marginTop: spacing.sm }}>{doc.reminders_sent} lembrete{doc.reminders_sent > 1 ? 's' : ''} de pagamento enviado{doc.reminders_sent > 1 ? 's' : ''}.</Muted> : null}
          </Card>
        </Section>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
          <Button small title={isWeb ? 'PDF / imprimir' : 'PDF'} icon="document-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'pdf'} onPress={() => makePdf()} />
          <Button small title="Duplicar" icon="copy-outline" variant="secondary" style={{ flex: 1 }} loading={busy === 'duplicate'} onPress={duplicate} />
          {editable ? (
            <Button small title={valuesLocked ? 'Notas e fotos' : 'Editar'} icon={valuesLocked ? 'images-outline' : 'create-outline'} variant="secondary"
              style={{ flex: valuesLocked ? 1.4 : 1 }} onPress={edit} />
          ) : null}
        </View>
        {st === 'draft' ? (
          <Button title={`Excluir rascunho`} variant="ghost" icon="trash-outline" onPress={remove} loading={busy === 'delete'} style={{ marginTop: spacing.sm }} />
        ) : null}
        {!isQuote && st !== 'draft' && st !== 'void' && st !== 'paid' ? (
          <Button title="Anular fatura" variant="ghost" icon="ban-outline" onPress={doVoid} loading={busy === 'void'} style={{ marginTop: spacing.sm }} />
        ) : null}
      </Screen>

      {/* Enviar */}
      <Sheet visible={sheet === 'send'} onClose={() => setSheet(null)} title={`Enviar ${noun}`}
        subtitle={`Pra ${doc.client_name || 'a cliente'} · ela abre o link, vê tudo e ${isQuote ? 'aprova com assinatura' : 'paga'}. Mensagem em ${langName}.`}>
        <SheetRow icon="logo-whatsapp" iconBg="#25D366" iconColor={colors.white} title="WhatsApp"
          sub={doc.client_phone ? `Abre a conversa com ${fmtPhone(doc.client_phone)} e a mensagem pronta` : 'Escolher o contato no WhatsApp'} onPress={() => send('whatsapp')} />
        {/* Sem e-mail a linha fica apagada, mas o toque explica o que fazer (cadastrar ou WhatsApp) */}
        <SheetRow icon="mail-outline" title="E-mail" sub={doc.client_email ? `Mandamos pra ${doc.client_email}` : canFixEmail ? 'Sem e-mail no documento (dá pra cadastrar em Editar)' : 'Sem e-mail no documento'}
          dim={!doc.client_email} onPress={() => send('email')} />
        {doc.client_phone ? <SheetRow icon="chatbubble-outline" title="SMS" sub="Mensagem de texto com o link" onPress={() => send('sms')} /> : null}
        <SheetRow icon="link-outline" title="Copiar link" sub="Pra colar onde quiser" onPress={() => send('link')} />
        <SheetRow icon="document-outline" title={isWeb ? 'PDF / imprimir' : 'Compartilhar PDF'} sub="O PDF sai com o link pra aprovar ou pagar" onPress={() => send('pdf')} />
        {!isWeb ? <SheetRow icon="share-outline" title="Outro app" sub="Mensagem com o link pelo compartilhar do celular" onPress={() => send('share')} /> : null}
        {st === 'draft' ? (
          <SheetRow icon="checkmark-done-outline" title="Já entreguei de outro jeito" sub="Só marca como enviado" onPress={async () => { setSheet(null); await act('mark_sent') }} />
        ) : null}
      </Sheet>

      {/* Converter em fatura */}
      <Sheet visible={sheet === 'convert'} onClose={() => setSheet(null)} title="Converter em fatura"
        subtitle={`Total do orçamento: ${fmtMoney(t.total_cents, { decimals: 2 })}. A fatura sai em rascunho pra você conferir antes de mandar.`}>
        <ModeOption selected={conv.mode === 'full'} title="Fatura integral" sub={`Uma fatura de ${fmtMoney(t.total_cents, { decimals: 2 })}`} onPress={() => setConv((c) => ({ ...c, mode: 'full' }))} />
        <ModeOption selected={conv.mode === 'deposit'}
          title={`Só a entrada (${cleanPct(conv.depositPct) || 0}%)`}
          sub={`Fatura de ${fmtMoney(Math.round(t.total_cents * (cleanPct(conv.depositPct) || 0) / 100), { decimals: 2 })} agora; o resto você fatura depois`}
          locked={!app.can('progress_billing')} lockLabel={featureInfo(app.ent, 'progress_billing').minName}
          onPress={() => setConv((c) => ({ ...c, mode: 'deposit' }))} />
        {conv.mode === 'deposit' ? (
          <Input label="Entrada (%)" value={conv.depositPct} keyboardType="decimal-pad" maxLength={5}
            onChangeText={(v) => setConv((c) => ({ ...c, depositPct: v.replace(/[^0-9.,]/g, '').slice(0, 5) }))} />
        ) : null}
        <ModeOption selected={conv.mode === 'stages'} title="Por etapas" sub="Uma fatura por etapa da obra, cada uma com sua %"
          locked={!app.can('progress_billing')} lockLabel={featureInfo(app.ent, 'progress_billing').minName}
          onPress={() => setConv((c) => ({ ...c, mode: 'stages' }))} />
        {conv.mode === 'stages' ? (
          <View style={{ marginTop: spacing.sm }}>
            {conv.stages.map((x, i) => (
              <View key={x.key} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Input value={x.label} onChangeText={(v) => setConv((c) => ({ ...c, stages: c.stages.map((y) => (y.key === x.key ? { ...y, label: v } : y)) }))}
                  placeholder={`Etapa ${i + 1}`} maxLength={60} style={{ flex: 2, marginBottom: spacing.sm }} />
                <Input value={x.pct} onChangeText={(v) => setConv((c) => ({ ...c, stages: c.stages.map((y) => (y.key === x.key ? { ...y, pct: v.replace(/[^0-9.,]/g, '').slice(0, 6) } : y)) }))}
                  keyboardType="decimal-pad" placeholder="%" style={{ flex: 1, marginBottom: spacing.sm }}
                  right={<Text style={{ paddingRight: spacing.md, color: colors.inkMuted }}>%</Text>} />
                <Pressable onPress={() => setConv((c) => ({ ...c, stages: c.stages.filter((y) => y.key !== x.key) }))} disabled={conv.stages.length <= 2}
                  hitSlop={8} style={{ opacity: conv.stages.length <= 2 ? 0.3 : 1, marginBottom: spacing.sm }} accessibilityLabel="Tirar etapa">
                  <Ionicons name="close-circle-outline" size={22} color={colors.inkMuted} />
                </Pressable>
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              {conv.stages.length < 10 ? (
                <Button small full={false} variant="ghost" icon="add" title="Etapa" onPress={() => setConv((c) => ({ ...c, stages: [...c.stages, { key: 's' + Date.now(), label: '', pct: '' }] }))} />
              ) : <View />}
              <Small style={{ fontWeight: '600', color: stageSum > 100.001 ? colors.danger : Math.abs(stageSum - 100) > 0.01 ? colors.warning : colors.success }}>
                Soma: {Math.round(stageSum * 100) / 100}%
              </Small>
            </View>
          </View>
        ) : null}
        <Button title={conv.mode === 'stages' ? `Criar ${conv.stages.length} faturas` : 'Criar fatura'} icon="receipt-outline" loading={busy === 'convert'}
          onPress={doConvert} style={{ marginTop: spacing.md }} />
      </Sheet>

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewer} onPress={() => setViewer(null)} accessibilityLabel="Fechar">
          {viewer ? <Image source={{ uri: viewer }} style={[{ width: '100%', height: '80%' }, viewer.startsWith('data:') && { backgroundColor: colors.white }]} resizeMode="contain" /> : null}
          <View style={s.viewerClose}><Ionicons name="close" size={26} color={colors.white} /></View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

// ── Peças ───────────────────────────────────────────────────────────────────
/** Cobrança automática e pagamento online (recursos Pro) na fatura em aberto. */
function ExtrasForInvoice({ app, provider, doc }) {
  const canAuto = app.can('payment_reminders')
  const canOnline = app.can('invoice_payments')
  const stripeOn = !!provider?.stripe_charges_enabled
  return (
    <Card padded={false} style={{ marginTop: spacing.md }}>
      <Row icon="alarm-outline" title="Cobrança automática"
        subtitle={canAuto ? (doc.client_email ? 'Ligada: mandamos lembrete por e-mail quando vencer.' : 'Precisa do e-mail da cliente no documento.') : 'Lembrete por e-mail quando a fatura vence, sem você cobrar.'}
        right={!canAuto ? <LockBadge app={app} feature="payment_reminders" /> : null}
        onPress={!canAuto ? () => ensureFeature(app, 'payment_reminders') : undefined} />
      <Divider style={{ marginVertical: 0, marginLeft: 60 }} />
      <Row icon="card-outline" title="Pagamento online no cartão"
        subtitle={!canOnline ? 'A cliente paga pelo link e o dinheiro cai na sua conta Stripe.'
          : stripeOn ? 'Ligado: a cliente pode pagar no cartão pelo link.' : 'Conecte sua conta Stripe pra liberar o botão de pagar.'}
        right={!canOnline ? <LockBadge app={app} feature="invoice_payments" /> : null}
        chevron={canOnline && !stripeOn}
        onPress={!canOnline ? () => ensureFeature(app, 'invoice_payments') : !stripeOn ? () => router.push('/deposit') : undefined} />
    </Card>
  )
}

function LockBadge({ app, feature }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.goldSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
      <Ionicons name="lock-closed" size={12} color={colors.goldDark} />
      <Text style={{ color: colors.goldDark, fontSize: 12, fontWeight: '600' }}>{featureInfo(app.ent, feature).minName}</Text>
    </View>
  )
}

function Meta({ k, v, warn }) {
  return (
    <View>
      <Text style={s.k}>{k}</Text>
      <Text style={[type.body, { fontWeight: '600' }, warn && { color: colors.danger }]}>{v}</Text>
    </View>
  )
}

function LinkText({ icon, text, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.7 }]} accessibilityRole="link">
      <Ionicons name={icon} size={15} color={colors.green} />
      <Text style={s.link}>{text}</Text>
    </Pressable>
  )
}

function TotalLine({ k, v, strong }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: spacing.md }}>
      <Text style={[type.body, { flex: 1, color: strong ? colors.ink : colors.inkSoft }, strong && { fontWeight: '700' }]}>{k}</Text>
      <Text style={[type.body, { fontWeight: strong ? '700' : '600' }]}>{v}</Text>
    </View>
  )
}

function TextBlock({ k, v, last }) {
  if (!v) return null
  return (
    <View style={{ marginBottom: last ? 0 : spacing.md }}>
      <Label style={{ marginBottom: 4 }}>{k}</Label>
      <P selectable>{v}</P>
    </View>
  )
}

function SheetRow({ icon, title, sub, onPress, disabled, dim, iconBg = colors.greenSoft, iconColor = colors.green }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} disabled={disabled}
      style={({ pressed }) => [s.sheetRow, (disabled || dim) && { opacity: 0.45 }, pressed && { backgroundColor: colors.paperSoft }]}>
      <View style={[s.sheetIcon, { backgroundColor: iconBg }]}><Ionicons name={icon} size={18} color={iconColor} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { fontWeight: '600' }]}>{title}</Text>
        {sub ? <Muted numberOfLines={2}>{sub}</Muted> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
    </Pressable>
  )
}

function ModeOption({ selected, title, sub, onPress, disabled, locked, lockLabel }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} disabled={disabled}
      style={({ pressed }) => [s.mode, selected && { borderColor: colors.green, backgroundColor: colors.greenSoft }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.green : colors.inkMuted} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: '600' }]}>{title}</Text>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      {locked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="lock-closed" size={12} color={colors.goldDark} />
          <Text style={{ color: colors.goldDark, fontSize: 12, fontWeight: '600' }}>{lockLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

/** Folha que sobe de baixo (o Alert do Android só tem 3 botões). */
function Sheet({ visible, title, subtitle, onClose, children }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fechar">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
        </Pressable>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={s.handle} />
          <H3>{title}</H3>
          {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
          <ScrollView style={{ maxHeight: 480, marginTop: spacing.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <Button title="Fechar" variant="secondary" onPress={onClose} style={{ marginTop: spacing.sm }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  panel: { marginTop: spacing.lg, borderColor: colors.green, borderWidth: 1 },
  err: { color: colors.danger, fontSize: 13, marginTop: -spacing.md, marginBottom: spacing.md },
  link: { color: colors.green, fontWeight: '600', fontSize: 14 },
  k: { fontSize: 11, fontWeight: '600', color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  signature: { marginTop: spacing.md, height: 110, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: '31%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.paperSoft },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 10, backgroundColor: colors.line, marginTop: 2 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingTop: spacing.sm, width: '100%', maxWidth: 640, alignSelf: 'center' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: spacing.md },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  sheetIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mode: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginBottom: spacing.sm },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 56, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
})
