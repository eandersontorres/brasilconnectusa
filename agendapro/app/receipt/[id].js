// Recibo do atendimento (Premium): prévia, PDF bilíngue pra compartilhar/imprimir
// e resumo em texto pro WhatsApp da cliente.
import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { File as FsFile, Paths } from 'expo-file-system'
import { useApp } from '../../lib/session'
import { api } from '../../lib/api'
import { showError } from '../../lib/gate'
import { notify } from '../../lib/dialog'
import { PUBLIC_PAGE } from '../../lib/config'
import { colors, radius, spacing, type } from '../../lib/theme'
import { fmtMoney, fmtPhone } from '../../lib/format'
import { openWhatsApp } from '../../lib/whatsapp'
import { buildReceiptHtml, buildReceiptText, fmtReceiptWhen, methodLabel, receiptAmounts, receiptNumber } from '../../lib/receipt'
import { Banner, Button, Card, Divider, ErrorBox, H3, Label, Loading, Muted, Screen, Segmented, Small } from '../../components/ui'
import Locked from '../../components/Locked'

const isWeb = Platform.OS === 'web'
const LANG_OPTIONS = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'both', label: 'PT + EN' },
]

export default function ReceiptScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Recibo' }} />
      <Locked feature="receipts"><Receipt /></Locked>
    </>
  )
}

/** No navegador: abre o recibo numa aba e chama a impressão (dá pra salvar em PDF). */
function printOnWeb(html) {
  const w = window.open('', '_blank')
  if (!w) {
    notify('Janela bloqueada', 'Libere pop-ups deste site pra gerar o recibo.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch (_) {} }, 400)
}

function Receipt() {
  const { id } = useLocalSearchParams()
  const app = useApp()
  const provider = app.provider || {}
  const [apt, setApt] = useState(null)
  const [client, setClient] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState('pt')
  const [busy, setBusy] = useState(null)      // 'pdf' | 'print'

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await api(`/api/agenda/appointments?id=${encodeURIComponent(String(id || ''))}`)
      setApt(r.appointment)
      setClient(r.client || null)
      // Cliente que fala inglês ou espanhol recebe o recibo em inglês
      if (r.client?.language === 'en' || r.client?.language === 'es') setLang('en')
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  if (loading) return <Screen><Loading text="Preparando o recibo…" /></Screen>
  if (error || !apt) return <Screen><ErrorBox error={error || 'Atendimento não encontrado'} onRetry={load} /></Screen>

  const v = receiptAmounts(apt)
  const num = receiptNumber(apt)
  const clientName = client?.name || apt.client_name || 'Cliente'
  const phone = client?.whatsapp || apt.client_whatsapp || ''
  const opts = {
    clientName,
    pageUrl: provider.slug ? PUBLIC_PAGE(provider.slug) : null,
    branding: !app.can('no_branding'),
  }
  const method = apt.paid_method || apt.payment_method
  const notDone = apt.status !== 'completed' && apt.status !== 'no_show'
  const unpaid = apt.status === 'completed' && apt.paid_cents == null && !apt.paid_at

  async function sharePdf() {
    const html = buildReceiptHtml(apt, provider, lang, opts)
    if (isWeb) { printOnWeb(html); return }
    setBusy('pdf')
    try {
      const { uri } = await Print.printToFileAsync({ html })
      // Nome legível no compartilhar ("Recibo-20261014-3F9A.pdf")
      let shareUri = uri
      try {
        const dest = new FsFile(Paths.cache, `Recibo-${num}.pdf`)
        if (dest.exists) dest.delete()
        new FsFile(uri).move(dest)
        shareUri = dest.uri
      } catch (_) {}
      if (!(await Sharing.isAvailableAsync())) {
        notify('PDF pronto', 'Este aparelho não permite compartilhar arquivos daqui.')
        return
      }
      await Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Recibo ${num}` })
    } catch (e) {
      showError(e, 'Não deu pra gerar o PDF')
    } finally {
      setBusy(null)
    }
  }

  async function printNow() {
    setBusy('print')
    try {
      await Print.printAsync({ html: buildReceiptHtml(apt, provider, lang, opts) })
    } catch (e) {
      // Fechar a tela de impressão sem imprimir também cai aqui (no iPhone vem
      // "Printing did not complete"), então não é erro
      if (!/cancel|did not complete|dismiss/i.test(String(e?.message || ''))) showError(e, 'Não deu pra imprimir')
    } finally {
      setBusy(null)
    }
  }

  async function sendWhatsApp() {
    const ok = await openWhatsApp(phone, buildReceiptText(apt, provider, lang, opts))
    if (!ok) notify('WhatsApp não abriu', 'Confira se o WhatsApp está instalado neste celular.')
  }

  const lbl = (pt, en) => (lang === 'en' ? en : lang === 'both' ? `${pt} / ${en}` : pt)

  return (
    <Screen>
      {notDone ? (
        <Banner tone="orange" icon="alert-circle-outline"
          text="Este atendimento ainda não foi marcado como realizado. O recibo sai como pendente."
          action="Abrir" onPress={() => router.push(`/appointment/${apt.id}`)} />
      ) : unpaid ? (
        <Banner tone="orange" icon="cash-outline"
          text="O pagamento não foi registrado: o recibo usa o valor do serviço. Registre o valor e a gorjeta no atendimento."
          action="Abrir" onPress={() => router.push(`/appointment/${apt.id}`)} />
      ) : null}

      <Label style={{ marginBottom: spacing.sm }}>Idioma do recibo</Label>
      <Segmented options={LANG_OPTIONS} value={lang} onChange={setLang} />

      <Card style={st.paper}>
        <View style={st.bar} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <H3 numberOfLines={2}>{provider.name || 'Seu negócio'}</H3>
            {[provider.specialty, [provider.city, provider.state].filter(Boolean).join(', ')].filter(Boolean).length ? (
              <Muted>{[provider.specialty, [provider.city, provider.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</Muted>
            ) : null}
            {provider.whatsapp ? <Muted>{fmtPhone(provider.whatsapp)}</Muted> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={st.title}>{lbl('Recibo', 'Receipt')}</Text>
            <Small>{lang === 'en' ? 'No.' : 'Nº'} {num}</Small>
            <View style={[st.stamp, { borderColor: v.paidInFull && apt.status !== 'canceled' ? colors.success : colors.warning }]}>
              <Text style={{ color: v.paidInFull && apt.status !== 'canceled' ? colors.success : colors.warning, fontWeight: '700', fontSize: 11, letterSpacing: 1 }}>
                {apt.status === 'canceled' ? lbl('CANCELADO', 'CANCELED') : v.paidInFull ? lbl('PAGO', 'PAID') : lbl('PENDENTE', 'PENDING')}
              </Text>
            </View>
          </View>
        </View>

        <View style={st.box}>
          <Field k={lbl('Cliente', 'Client')} v={clientName} />
          <Field k={lbl('Serviço', 'Service')} v={apt.service_name || apt.service_label || (apt.feed_label ? `Limpeza · ${apt.feed_label}` : '—')} />
          <Field k={lbl('Data', 'Date')} v={fmtReceiptWhen(apt.scheduled_for, lang === 'en' ? 'en' : 'pt')} />
          <Field k={lbl('Forma de pagamento', 'Payment method')} v={methodLabel(method, lang === 'en' ? 'en' : 'pt')} last />
        </View>

        <Line k={lbl('Valor do serviço', 'Service price')} v={fmtMoney(v.service, { decimals: 2 })} />
        {v.paid !== v.service ? <Line k={lbl('Valor cobrado', 'Amount charged')} v={fmtMoney(v.paid, { decimals: 2 })} /> : null}
        {v.deposit > 0 ? <Line k={lbl('Sinal pago antes (incluso)', 'Deposit paid (included)')} v={fmtMoney(v.deposit, { decimals: 2 })} muted /> : null}
        {v.tip > 0 ? <Line k={lbl('Gorjeta', 'Tip')} v={fmtMoney(v.tip, { decimals: 2 })} /> : null}
        <Divider style={{ backgroundColor: colors.ink, height: 1.5 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[type.h3, { fontWeight: '700' }]}>{lbl('Total pago', 'Total paid')}</Text>
          <Text style={[type.h3, { fontWeight: '700' }]}>{fmtMoney(v.total, { decimals: 2 })}</Text>
        </View>
        {v.balance > 0 ? <Line k={lbl('Saldo a pagar', 'Balance due')} v={fmtMoney(v.balance, { decimals: 2 })} /> : null}
        <Text style={st.thanks}>{lbl('Obrigada pela preferência!', 'Thank you for your business!')}</Text>
      </Card>

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button title={isWeb ? 'Gerar PDF / imprimir' : 'Compartilhar PDF'} icon="share-outline" onPress={sharePdf} loading={busy === 'pdf'} disabled={!!busy} />
        <Button title={phone ? `Enviar resumo no WhatsApp` : 'Enviar resumo no WhatsApp (escolher contato)'} variant="whatsapp" icon="logo-whatsapp" onPress={sendWhatsApp} disabled={!!busy} />
        {!isWeb ? <Button title="Imprimir" variant="secondary" icon="print-outline" onPress={printNow} loading={busy === 'print'} disabled={!!busy} /> : null}
      </View>
      <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>
        {isWeb
          ? 'Na janela de impressão, escolha “Salvar como PDF”.'
          : 'Pra mandar o PDF pelo WhatsApp, toque em Compartilhar PDF e escolha o WhatsApp.'}
      </Muted>
    </Screen>
  )
}

function Field({ k, v, last }) {
  return (
    <View style={[{ paddingVertical: 6 }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
      <Text style={st.k}>{k}</Text>
      <Text style={[type.body, { fontWeight: '600' }]}>{v}</Text>
    </View>
  )
}

function Line({ k, v, muted }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: spacing.md }}>
      <Text style={[type.body, { flex: 1 }, muted && { color: colors.inkMuted }]}>{k}</Text>
      <Text style={[type.body, { fontWeight: '600' }, muted && { color: colors.inkMuted }]}>{v}</Text>
    </View>
  )
}

const st = StyleSheet.create({
  paper: { marginTop: spacing.lg, paddingTop: spacing.md },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.green, marginBottom: spacing.lg },
  title: { fontSize: 16, fontWeight: '700', color: colors.green, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  stamp: { marginTop: 6, borderWidth: 2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  box: { backgroundColor: colors.paper, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginVertical: spacing.lg },
  k: { fontSize: 11, fontWeight: '600', color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  thanks: { textAlign: 'center', marginTop: spacing.lg, fontSize: 15, fontWeight: '600', color: colors.green },
})
