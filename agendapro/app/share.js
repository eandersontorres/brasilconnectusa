// Link e QR code: a página pública pra divulgar (copiar, compartilhar, QR pro
// balcão) e textos prontos pra bio do Instagram, status do WhatsApp e Google.
// Imprimir/salvar o QR é recurso do plano (share_qr).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Stack, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as WebBrowser from 'expo-web-browser'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { File, Paths } from 'expo-file-system'
import QRCode from 'react-native-qrcode-svg'
import genMatrix from 'react-native-qrcode-svg/src/genMatrix'
import transformMatrixIntoPath from 'react-native-qrcode-svg/src/transformMatrixIntoPath'
import { api } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, openPlans, showError } from '../lib/gate'
import { choose, notify } from '../lib/dialog'
import { API_BASE, PUBLIC_PAGE } from '../lib/config'
import { openWhatsApp } from '../lib/whatsapp'
import { BRAND } from '../lib/variant'
import { colors, radius, spacing, type } from '../lib/theme'
import { Badge, Banner, Button, Card, Empty, H3, Loading, Muted, P, Screen, Section, Segmented, Small } from '../components/ui'

const isWeb = Platform.OS === 'web'
const HOST = API_BASE.replace(/^https?:\/\//, '')

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]))
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || ''

// Checklist da tela Hoje: passo "compartilhar link" (mescla com o que já está salvo)
const CHECK_KEY = 'agendapro.checklist.v1'
async function markShared() {
  try {
    let cur = {}
    try { cur = JSON.parse((await AsyncStorage.getItem(CHECK_KEY)) || '{}') || {} } catch (_) {}
    if (cur.shared) return
    await AsyncStorage.setItem(CHECK_KEY, JSON.stringify({ ...cur, shared: true }))
  } catch (_) {}
}

// ── Textos prontos (PT grátis; EN/ES = mensagens em outros idiomas, Pro) ──
const LANG_OPTIONS = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

function readyTexts(lang, p, url) {
  const name = p?.name || ''
  const first = firstName(name)
  const where = [p?.city, p?.state].filter(Boolean).join(', ')
  const spec = p?.specialty || ''
  const T = {
    pt: {
      instagram: [spec || name, where ? `em ${where}` : ''].filter(Boolean).join(' ') + '\nAgende seu horário online, 24h\nLink abaixo',
      whatsapp: `Agenda aberta! Agora você marca seu horário comigo direto pelo link, a qualquer hora do dia: ${url}`,
      clients: `Oi! Agora dá pra marcar seu horário comigo direto por este link, sem precisar esperar eu responder: ${url}\n\nVocê vê os horários livres e já fica agendado. Obrigada! ${first}`,
      google: `${name}${spec ? ` · ${spec}` : ''}${where ? ` em ${where}` : ''}. Profissional brasileira, atendimento em português. Agende seu horário online, a qualquer hora: ${url}`,
    },
    en: {
      instagram: `${name}${where ? ` · ${where}` : ''}\nBook your appointment online 24/7\nLink below`,
      whatsapp: `Now booking! Schedule your appointment with me online, anytime: ${url}`,
      clients: `Hi! You can now book your appointment with me through this link, no need to wait for my reply: ${url}\n\nYou'll see my open times and get booked right away. Thank you! ${first}`,
      google: `${name}${where ? ` in ${where}` : ''}. Brazilian professional, service in English and Portuguese. Book your appointment online, anytime: ${url}`,
    },
    es: {
      instagram: `${name}${where ? ` · ${where}` : ''}\nAgenda tu cita en línea 24/7\nLink abajo`,
      whatsapp: `¡Agenda abierta! Ahora puedes reservar tu cita conmigo directo por el link, a cualquier hora: ${url}`,
      clients: `¡Hola! Ahora puedes reservar tu cita conmigo por este link, sin esperar mi respuesta: ${url}\n\nVes los horarios libres y quedas agendada al instante. ¡Gracias! ${first}`,
      google: `${name}${where ? ` en ${where}` : ''}. Profesional brasileña, atención en español, inglés y portugués. Reserva tu cita en línea, a cualquier hora: ${url}`,
    },
  }
  return T[lang] || T.pt
}

const TEXT_CARDS = [
  { key: 'instagram', icon: 'logo-instagram', title: 'Bio do Instagram', hint: 'Cole na bio e coloque o link no campo "Site" do perfil.' },
  { key: 'whatsapp', icon: 'logo-whatsapp', title: 'Status do WhatsApp', hint: 'Poste no status. Vale repetir toda semana.', wa: true },
  { key: 'clients', icon: 'chatbubbles-outline', title: 'Mensagem pras suas clientes', hint: 'Mande numa lista de transmissão do WhatsApp.', wa: true },
  { key: 'google', icon: 'logo-google', title: 'Perfil da empresa no Google', hint: 'No Google, cole o link em "Link de agendamento" e este texto na descrição.' },
]

// ── QR pra imprimir ──────────────────────────────────────────────────────
/** PNG do QR que está na tela (celular). No navegador não existe: volta null. */
function qrPng(ref) {
  return new Promise((resolve) => {
    const svg = ref.current
    if (isWeb || !svg || typeof svg.toDataURL !== 'function') return resolve(null)
    const t = setTimeout(() => resolve(null), 4000)
    try {
      svg.toDataURL((b64) => { clearTimeout(t); resolve(b64 || null) }, { width: 1024, height: 1024 })
    } catch (_) {
      clearTimeout(t)
      resolve(null)
    }
  })
}

/** QR em SVG puro (reserva quando o PNG não sai, e no navegador). */
function qrSvg(value, size = 600) {
  const { path, cellSize } = transformMatrixIntoPath(genMatrix(value, 'M'), size)
  const q = cellSize * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${size + q * 2} ${size + q * 2}" width="100%" height="100%"><rect x="${-q}" y="${-q}" width="${size + q * 2}" height="${size + q * 2}" fill="#fff"/><path d="${path}" stroke="#1A1F1C" stroke-width="${cellSize}" stroke-linecap="butt" fill="none"/></svg>`
}

function qrMarkup(png, url) {
  return png ? `<img src="data:image/png;base64,${png}" alt="QR code" />` : qrSvg(url)
}

const PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1F1C; background: #fff; }
  .qr img, .qr svg { width: 100%; height: 100%; display: block; }
  @page { margin: 0.4in; }
`

function posterHtml({ p, url, qr, branding }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR ${esc(p.name)}</title><style>${PRINT_CSS}
    .page { min-height: 9.6in; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; border: 2px solid #1F4D3F; border-radius: 24px; padding: 0.5in; }
    .eyebrow { font-size: 14px; letter-spacing: 4px; text-transform: uppercase; color: #8C6D3D; font-weight: 700; }
    h1 { font-size: 46px; margin-top: 14px; line-height: 1.1; }
    .spec { font-size: 20px; color: #4B4F4D; margin-top: 8px; }
    .qr { width: 4in; height: 4in; margin: 0.45in auto 0.3in; }
    .cta { font-size: 24px; font-weight: 700; color: #1F4D3F; }
    .sub { font-size: 16px; color: #4B4F4D; margin-top: 6px; }
    .url { font-size: 15px; color: #8B8E89; margin-top: 18px; word-break: break-all; }
    .brand { font-size: 11px; color: #8B8E89; margin-top: 28px; }
  </style></head><body><div class="page">
    <div class="eyebrow">Agende seu horário</div>
    <h1>${esc(p.name)}</h1>
    ${p.specialty ? `<div class="spec">${esc(p.specialty)}</div>` : ''}
    <div class="qr">${qr}</div>
    <div class="cta">Aponte a câmera do celular</div>
    <div class="sub">Escolha o serviço, o dia e o horário. Leva 1 minuto.</div>
    <div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div>
    ${branding ? `<div class="brand">${esc(BRAND.name)} · BrasilConnect</div>` : ''}
  </div></body></html>`
}

function cardsHtml({ p, url, qr, branding }) {
  const card = `<div class="card">
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        ${p.specialty ? `<div class="spec">${esc(p.specialty)}</div>` : ''}
        <div class="cta">Agende pelo QR code</div>
        <div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div>
        ${branding ? `<div class="brand">${esc(BRAND.name)} · BrasilConnect</div>` : ''}
      </div>
      <div class="qr">${qr}</div>
    </div>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cartões ${esc(p.name)}</title><style>${PRINT_CSS}
    .sheet { display: grid; grid-template-columns: 3.5in 3.5in; grid-auto-rows: 2in; gap: 0; justify-content: center; }
    .card { border: 1px dashed #B8B4A8; padding: 0.18in; display: flex; align-items: center; gap: 0.15in; overflow: hidden; }
    .info { flex: 1; min-width: 0; }
    .name { font-size: 15px; font-weight: 700; line-height: 1.2; }
    .spec { font-size: 11px; color: #4B4F4D; margin-top: 2px; }
    .cta { font-size: 11px; font-weight: 700; color: #1F4D3F; margin-top: 10px; }
    .url { font-size: 8.5px; color: #8B8E89; margin-top: 3px; word-break: break-all; }
    .brand { font-size: 7px; color: #8B8E89; margin-top: 6px; }
    .qr { width: 1.45in; height: 1.45in; flex-shrink: 0; }
  </style></head><body><div class="sheet">${Array.from({ length: 10 }, () => card).join('')}</div></body></html>`
}

function printOnWeb(html) {
  const w = window.open('', '_blank')
  if (!w) { notify('Janela bloqueada', 'Libere pop-ups deste site pra imprimir.'); return }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch (_) {} }, 400)
}

// ── Tela ─────────────────────────────────────────────────────────────────
export default function ShareScreen() {
  const app = useApp()
  const { provider } = app
  const { width } = useWindowDimensions()
  const qrRef = useRef(null)

  const [status, setStatus] = useState({ loading: true, hours: null, services: null })
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(null)
  const [lang, setLang] = useState('pt')
  const [busy, setBusy] = useState(null)

  const slug = provider?.slug
  const url = slug ? PUBLIC_PAGE(slug) : ''
  const shortUrl = url.replace(/^https?:\/\//, '')
  const qrSize = Math.min(Math.max(width - spacing.lg * 2 - spacing.xl * 2, 180), 280)
  const branding = !app.can('no_branding')

  // A página está aceitando agendamento? (plano, horários e serviços)
  const loadStatus = useCallback(async () => {
    const [h, sv] = await Promise.allSettled([api('/api/agenda/hours'), api('/api/agenda/services?mine=1')])
    setStatus({
      loading: false,
      hours: h.status === 'fulfilled' ? (h.value?.hours || []).length : null,
      services: sv.status === 'fulfilled' ? (sv.value?.services || []).filter((x) => x.active !== false).length : null,
    })
    setRefreshing(false)
  }, [])

  useEffect(() => { if (slug) loadStatus() }, [slug, loadStatus])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(t)
  }, [copied])

  async function copy(text, key) {
    try {
      await Clipboard.setStringAsync(text)
      setCopied(key)
      if (url && String(text).includes(url)) markShared()
      if (!isWeb) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (e) {
      notify('Não deu pra copiar', 'Segure o texto e copie manualmente.')
    }
  }

  async function shareLink() {
    // Link dentro do texto: funciona igual no WhatsApp, Instagram e SMS, no iPhone e no Android
    const message = `${provider?.name ? provider.name + ': a' : 'A'}gende seu horário online, a qualquer hora: ${url}`
    try {
      const r = await Share.share({ message, title: 'Minha agenda online' })
      if (r?.action !== Share.dismissedAction) markShared()
    } catch (e) {
      if (e?.name === 'AbortError') return
      // Navegador sem compartilhamento: copia
      await copy(url, 'link')
      notify('Link copiado', 'Cole onde quiser compartilhar.')
    }
  }

  async function openPage() {
    if (isWeb) { window.open(url, '_blank'); return }
    try { await WebBrowser.openBrowserAsync(url, { controlsColor: colors.green }) } catch (_) {}
  }

  async function changeLang(v) {
    if (v !== 'pt' && !(await ensureFeature(app, 'multilang_messages'))) return
    setLang(v)
  }

  async function printQr() {
    if (!(await ensureFeature(app, 'share_qr'))) return
    const options = [
      { label: 'Cartaz para o balcão', value: 'print_poster' },
      { label: 'Cartõezinhos para recortar (10 por folha)', value: 'print_cards' },
    ]
    if (!isWeb) {
      options.push({ label: 'Salvar cartaz em PDF', value: 'pdf_poster' })
      options.push({ label: 'Enviar imagem do QR', value: 'image' })
    }
    const act = await choose('Imprimir ou salvar o QR', options)
    if (!act) return
    setBusy(act)
    try {
      const png = await qrPng(qrRef)
      if (act === 'image') {
        if (!png) { notify('Não deu pra gerar a imagem', 'Tente "Salvar cartaz em PDF".'); return }
        const file = new File(Paths.cache, `qr-${slug}.png`)
        if (file.exists) file.delete()
        file.create()
        file.write(png, { encoding: 'base64' })
        if (!(await Sharing.isAvailableAsync())) { notify('Compartilhar indisponível', 'Seu celular não deixou compartilhar arquivos.'); return }
        await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'QR code da sua agenda' })
        return
      }
      const data = { p: provider, url, qr: qrMarkup(png, url), branding }
      const html = act === 'print_cards' ? cardsHtml(data) : posterHtml(data)
      if (isWeb) { printOnWeb(html); return }
      if (act === 'pdf_poster') {
        const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 })
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'QR code da sua agenda' })
        return
      }
      await Print.printAsync({ html, width: 612, height: 792 })
    } catch (e) {
      // Fechar a janela de impressão no iOS também cai aqui
      if (!/cancel|did not complete|dismiss/i.test(String(e?.message || ''))) showError(e, 'Não deu pra imprimir')
    } finally {
      setBusy(null)
    }
  }

  if (!slug) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Link e QR code' }} />
        <Empty icon="qr-code-outline" title="Sua página ainda não existe" text="Complete seu perfil pra ganhar o link de agendamento."
          action={<Button title="Completar perfil" onPress={() => router.push('/profile')} />} />
      </Screen>
    )
  }

  const texts = readyTexts(lang, provider, url)
  const planOff = !app.can('online_booking')
  const noHours = status.hours === 0
  const noServices = status.services === 0
  const allGood = !status.loading && !planOff && status.hours > 0 && status.services > 0

  return (
    <Screen onRefresh={() => { setRefreshing(true); app.refresh({ silent: true }); loadStatus() }} refreshing={refreshing}>
      <Stack.Screen options={{ title: 'Link e QR code' }} />

      {/* Situação da página */}
      {status.loading ? <Loading text="Conferindo sua página…" style={{ padding: spacing.md }} /> : null}
      {planOff ? (
        <Banner tone="red" icon="lock-closed-outline" text="Seu plano não está ativo: a página mostra seus serviços, mas não aceita agendamentos." action="Ver planos" onPress={() => openPlans('online_booking')} />
      ) : null}
      {noHours ? (
        <Banner tone="orange" icon="time-outline" text="Falta o horário de atendimento. Sem ele, a página não mostra horários livres." action="Definir" onPress={() => router.push('/hours')} />
      ) : null}
      {noServices ? (
        <Banner tone="orange" icon="pricetags-outline" text="Cadastre pelo menos um serviço pra cliente conseguir agendar." action="Cadastrar" onPress={() => router.push('/services/edit')} />
      ) : null}
      {allGood ? <Banner tone="green" icon="checkmark-circle-outline" text="Sua página está aceitando agendamentos." /> : null}

      {/* Link */}
      <Card>
        <Small style={{ fontWeight: '600', color: colors.inkSoft }}>Sua página de agendamento</Small>
        <Text selectable style={s.link}>{shortUrl}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button title={copied === 'link' ? 'Copiado!' : 'Copiar'} icon={copied === 'link' ? 'checkmark' : 'copy-outline'} small onPress={() => copy(url, 'link')} style={{ flex: 1 }} />
          <Button title="Compartilhar" icon="share-outline" variant="secondary" small onPress={shareLink} style={{ flex: 1 }} />
        </View>
        <Button title="Abrir minha página" icon="open-outline" variant="ghost" small onPress={openPage} style={{ marginTop: spacing.xs }} />
      </Card>

      {/* QR */}
      <Section title="QR code">
        <Card style={{ alignItems: 'center' }}>
          <View style={s.qrBox}>
            <QRCode value={url} size={qrSize} color={colors.ink} backgroundColor={colors.white} ecl="M" getRef={(c) => { qrRef.current = c }} />
          </View>
          <H3 style={{ textAlign: 'center', marginTop: spacing.md }} numberOfLines={2}>{provider?.name}</H3>
          {provider?.specialty ? <Muted style={{ textAlign: 'center' }}>{provider.specialty}</Muted> : null}
          <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>Aponte a câmera do celular pra agendar</Muted>
          <Button title="Imprimir ou salvar QR" icon={app.can('share_qr') ? 'print-outline' : 'lock-closed'} variant={app.can('share_qr') ? 'primary' : 'gold'}
            onPress={printQr} loading={!!busy} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} />
          <Muted style={{ textAlign: 'center', marginTop: spacing.sm }}>Cartaz pro espelho ou balcão e cartõezinhos pra entregar às clientes.</Muted>
        </Card>
      </Section>

      {/* Textos prontos */}
      <Section title="Textos prontos pra divulgar">
        <Segmented options={LANG_OPTIONS} value={lang} onChange={changeLang} style={{ marginBottom: spacing.md }} />
        {TEXT_CARDS.map((c) => (
          <Card key={c.key} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={s.textIcon}><Ionicons name={c.icon} size={16} color={colors.green} /></View>
              <Text style={[type.h3, { flex: 1 }]}>{c.title}</Text>
              {c.key === 'instagram' ? <Badge text={`${texts.instagram.length}/150`} tone={texts.instagram.length > 150 ? 'red' : 'gray'} /> : null}
            </View>
            <View style={s.textBox}><P selectable style={{ color: colors.ink }}>{texts[c.key]}</P></View>
            <Muted>{c.hint}</Muted>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button title={copied === c.key ? 'Copiado!' : 'Copiar texto'} icon={copied === c.key ? 'checkmark' : 'copy-outline'} variant="secondary" small onPress={() => copy(texts[c.key], c.key)} style={{ flex: 1 }} />
              {c.wa ? <Button title="WhatsApp" icon="logo-whatsapp" variant="whatsapp" small onPress={() => openWhatsApp('', texts[c.key]).then((ok) => { if (ok && texts[c.key].includes(url)) markShared() })} style={{ flex: 1 }} /> : null}
              {c.key === 'instagram' ? <Button title={copied === 'ig-link' ? 'Copiado!' : 'Copiar link'} icon="link-outline" variant="secondary" small onPress={() => copy(url, 'ig-link')} style={{ flex: 1 }} /> : null}
            </View>
          </Card>
        ))}
      </Section>

      {/* Dicas */}
      <Section title="Dicas pra encher a agenda">
        <Card>
          {[
            ['chatbubble-ellipses-outline', 'Quando pedirem horário no WhatsApp, responda com o link: a cliente escolhe sozinha e você não perde tempo.'],
            ['qr-code-outline', 'Deixe o QR no espelho ou no balcão e entregue um cartãozinho no fim de cada atendimento.'],
            ['star-outline', 'Peça avaliação depois do atendimento: as estrelas aparecem na sua página e passam confiança.'],
            ['images-outline', 'Página com foto, bio e galeria recebe mais agendamentos.'],
          ].map(([icon, text]) => (
            <View key={icon} style={s.tip}>
              <Ionicons name={icon} size={18} color={colors.goldDark} style={{ marginTop: 1 }} />
              <P style={{ flex: 1, color: colors.inkSoft }}>{text}</P>
            </View>
          ))}
          <Button title="Melhorar meu perfil" variant="ghost" small onPress={() => router.push('/profile')} style={{ marginTop: spacing.xs }} />
        </Card>
      </Section>

      <Muted style={{ textAlign: 'center', marginTop: spacing.lg }}>{HOST}</Muted>
    </Screen>
  )
}

const s = StyleSheet.create({
  link: { fontSize: 17, fontWeight: '600', color: colors.green, marginTop: 6 },
  qrBox: { padding: spacing.md, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  textIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  textBox: { backgroundColor: colors.paperDeep, borderRadius: radius.md, padding: spacing.md, marginVertical: spacing.md },
  tip: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
})
