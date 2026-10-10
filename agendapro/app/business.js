// Dados da empresa (cabeçalho de orçamentos e faturas) e padrões dos documentos:
// imposto, vencimento, validade, entrada, idioma, condições, recado e como pagar.
// Salva em app_settings.business e app_settings.doc_defaults (saveSettings),
// mesclando com o que já existe.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useNavigation } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useApp } from '../lib/session'
import { showError } from '../lib/gate'
import { confirm, notify } from '../lib/dialog'
import { phoneDigits } from '../lib/format'
import { cleanPct } from '../lib/docCalc'
import { DOC_LANGS, businessHeader, docLabel, docTitle } from '../lib/documents'
import { colors, radius, spacing, type } from '../lib/theme'
import { Avatar, Banner, Button, Card, Input, Label, Muted, Screen, Section, Segmented, ToggleRow } from '../components/ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DOMAIN_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i

const PAY_EXAMPLE = {
  en: (n, p) => `Zelle: ${p || '(000) 000-0000'}${n ? ` (${n})` : ''}\nCheck payable to: ${n || 'Your Company LLC'}\nCash or card accepted on completion.`,
  pt: (n, p) => `Zelle: ${p || '(000) 000-0000'}${n ? ` (${n})` : ''}\nCheque nominal a: ${n || 'Sua Empresa LLC'}\nDinheiro ou cartão na entrega.`,
  es: (n, p) => `Zelle: ${p || '(000) 000-0000'}${n ? ` (${n})` : ''}\nCheque a nombre de: ${n || 'Su Empresa LLC'}\nEfectivo o tarjeta al terminar.`,
}
const TERMS_EXAMPLE = {
  en: (d) => `This quote is valid for ${d} days. Work starts within 7 days of approval and deposit. 1-year warranty on labor. Any change to the scope will be quoted separately.`,
  pt: (d) => `Orçamento válido por ${d} dias. O serviço começa em até 7 dias após a aprovação e a entrada. Garantia de 1 ano na mão de obra. Mudanças no escopo são orçadas à parte.`,
  es: (d) => `Este presupuesto es válido por ${d} días. El trabajo empieza hasta 7 días después de la aprobación y el anticipo. Garantía de 1 año en la mano de obra. Cualquier cambio se cotiza aparte.`,
}

function formOf(settings = {}) {
  const b = settings.business || {}
  const d = settings.doc_defaults || {}
  const num = (v, def) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? def : String(v))
  return {
    legal_name: b.legal_name || '',
    license_no: b.license_no || '',
    address_line: b.address_line || '',
    city: b.city || '',
    state: b.state || '',
    zip: b.zip || '',
    phone: b.phone || '',
    email: b.email || '',
    website: b.website || '',
    insurance: b.insurance || '',
    tax: Number(d.tax_rate_bps) > 0 ? String(Number(d.tax_rate_bps) / 100) : '',
    due_days: num(d.due_days, '14'),
    quote_valid_days: num(d.quote_valid_days, '30'),
    deposit_pct: Number(d.deposit_pct) > 0 ? String(d.deposit_pct) : '',
    language: ['en', 'pt', 'es'].includes(d.language) ? d.language : 'en',
    terms: d.terms || '',
    notes: d.notes || '',
    payment_instructions: d.payment_instructions || '',
    notify_documents: settings.notify_documents !== false,
  }
}

function validate(f) {
  const e = {}
  if (f.state.trim() && !/^[A-Za-z]{2}$/.test(f.state.trim())) e.state = 'Sigla de 2 letras (ex.: TX)'
  if (f.zip.trim() && !/^[0-9]{5}(-[0-9]{4})?$/.test(f.zip.trim())) e.zip = 'ZIP com 5 números'
  if (f.phone.trim() && phoneDigits(f.phone).length < 11) e.phone = 'Número incompleto. Coloque com o código de área.'
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'E-mail inválido'
  if (f.website.trim() && !DOMAIN_RE.test(f.website.trim())) e.website = 'Ex.: www.suaempresa.com'
  const tax = String(f.tax).trim() ? cleanPct(f.tax) : 0
  if (tax === null || tax > 25) e.tax = 'Entre 0 e 25%'
  const due = Number(f.due_days)
  if (!/^\d{1,3}$/.test(String(f.due_days).trim()) || due > 120) e.due_days = 'De 0 a 120 dias'
  const valid = Number(f.quote_valid_days)
  if (!/^\d{1,3}$/.test(String(f.quote_valid_days).trim()) || valid < 1 || valid > 180) e.quote_valid_days = 'De 1 a 180 dias'
  if (String(f.deposit_pct).trim() && (!/^\d{1,3}$/.test(String(f.deposit_pct).trim()) || Number(f.deposit_pct) > 100)) e.deposit_pct = 'De 0 a 100'
  return e
}

const withScheme = (u) => {
  const s = String(u || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export default function BusinessScreen() {
  const app = useApp()
  const { settings, provider } = app
  const navigation = useNavigation()

  const [base, setBase] = useState(() => formOf(settings))
  const [form, setForm] = useState(() => formOf(settings))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(base), [form, base])
  dirtyRef.current = dirty
  savingRef.current = saving

  // Preferências chegaram (ou mudaram em outra tela) e nada foi editado aqui
  useEffect(() => {
    const next = formOf(settings)
    setBase(next)
    if (!dirtyRef.current) setForm(next)
  }, [settings])

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || savingRef.current) return
      e.preventDefault()
      confirm('Sair sem salvar?', 'O que você mudou nos dados da empresa vai se perder.', { ok: 'Sair sem salvar', cancel: 'Continuar editando', destructive: true })
        .then((ok) => { if (ok) navigation.dispatch(e.data.action) })
    })
    return unsub
  }, [navigation])

  useEffect(() => {
    if (!savedAt) return undefined
    const t = setTimeout(() => setSavedAt(0), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  const set = (key) => (v) => {
    setForm((f) => ({ ...f, [key]: v }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }))
  }

  async function save() {
    const e = validate(form)
    setErrors(e)
    if (Object.keys(e).length) {
      notify('Confira os campos', 'Tem informação com erro (marcada em vermelho).')
      return
    }
    const f = form
    const business = {
      ...(settings.business || {}),
      legal_name: f.legal_name.trim().slice(0, 120),
      license_no: f.license_no.trim().slice(0, 60),
      address_line: f.address_line.trim().slice(0, 160),
      city: f.city.trim().slice(0, 80),
      state: f.state.trim().toUpperCase().slice(0, 2),
      zip: f.zip.trim().slice(0, 10),
      phone: f.phone.trim().slice(0, 30),
      email: f.email.trim().toLowerCase().slice(0, 120),
      website: withScheme(f.website).slice(0, 200),
      insurance: f.insurance.trim().slice(0, 160),
    }
    const tax = String(f.tax).trim() ? cleanPct(f.tax) : 0
    const doc_defaults = {
      ...(settings.doc_defaults || {}),
      tax_rate_bps: Math.min(2500, Math.round((tax || 0) * 100)),
      due_days: Math.min(120, Math.max(0, Math.round(Number(f.due_days) || 0))),
      quote_valid_days: Math.min(180, Math.max(1, Math.round(Number(f.quote_valid_days) || 30))),
      deposit_pct: Math.min(100, Math.max(0, Math.round(Number(f.deposit_pct) || 0))),
      language: f.language,
      terms: f.terms.trim().slice(0, 3000),
      notes: f.notes.trim().slice(0, 1000),
      payment_instructions: f.payment_instructions.trim().slice(0, 1000),
    }
    setSaving(true)
    try {
      const saved = await app.saveSettings({ business, doc_defaults, notify_documents: !!f.notify_documents })
      const next = formOf(saved || {})
      setBase(next)
      setForm(next)
      setSavedAt(Date.now())
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (err) {
      showError(err, 'Não deu pra salvar')
    } finally {
      setSaving(false)
    }
  }

  async function fillExample(key) {
    const lang = form.language
    const name = form.legal_name.trim() || provider?.name || ''
    const text = key === 'payment_instructions'
      ? PAY_EXAMPLE[lang](name, form.phone.trim() || provider?.whatsapp || '')
      : TERMS_EXAMPLE[lang](Number(form.quote_valid_days) || 30)
    if (String(form[key]).trim() && !(await confirm('Trocar o texto?', 'O texto que está escrito vai ser substituído pelo exemplo.', { ok: 'Trocar' }))) return
    set(key)(text)
  }

  // Prévia do cabeçalho com o que está no formulário
  const previewBusiness = {
    legal_name: form.legal_name.trim(), license_no: form.license_no.trim(), address_line: form.address_line.trim(),
    city: form.city.trim(), state: form.state.trim().toUpperCase(), zip: form.zip.trim(), phone: form.phone.trim(),
    email: form.email.trim(), website: form.website.trim() ? withScheme(form.website) : '', insurance: form.insurance.trim(),
  }
  const head = businessHeader(provider || {}, previewBusiness, form.language)

  const footer = dirty ? (
    <View style={{ gap: spacing.sm }}>
      <Muted style={{ textAlign: 'center' }}>Mudanças ainda não salvas</Muted>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Desfazer" variant="secondary" onPress={() => { setForm(base); setErrors({}) }} style={{ flex: 1 }} disabled={saving} />
        <Button title="Salvar" icon="checkmark" onPress={save} loading={saving} style={{ flex: 2 }} />
      </View>
    </View>
  ) : null

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: 'Dados da empresa' }} />
      <Screen footer={footer}>
        {savedAt ? <Banner tone="green" icon="checkmark-circle" text="Salvo. Os próximos orçamentos e faturas já saem assim." /> : null}

        {/* Prévia */}
        <Label style={{ marginBottom: spacing.sm }}>Como aparece no documento</Label>
        <Card style={st.preview}>
          <View style={[st.bar, { backgroundColor: /^#[0-9a-f]{6}$/i.test(provider?.cover_color || '') ? provider.cover_color : colors.navy }]} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flex: 1, minWidth: 0 }}>
              {head.logo ? <Image source={{ uri: head.logo }} style={st.logo} /> : <Avatar name={head.name} size={44} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.h3, { fontWeight: '700' }]} numberOfLines={2}>{head.name || 'Nome da empresa'}</Text>
                {head.lines.length ? head.lines.map((l, i) => <Text key={i} style={st.line} numberOfLines={2}>{l}</Text>)
                  : <Text style={[st.line, { color: colors.inkMuted }]}>Licença, endereço, telefone e e-mail aparecem aqui.</Text>}
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.title}>{docTitle('quote', form.language)}</Text>
              <Text style={st.line}>{docLabel('number', form.language)} Q-0001</Text>
            </View>
          </View>
        </Card>
        <Pressable onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }} hitSlop={6}>
          <Ionicons name="image-outline" size={15} color={colors.green} />
          <Text style={{ color: colors.green, fontWeight: '600', fontSize: 13 }}>A logo é a sua foto de perfil. Trocar no Perfil</Text>
        </Pressable>

        <Section title="Empresa">
          <Input label="Nome da empresa (como sai no documento)" value={form.legal_name} onChangeText={set('legal_name')} maxLength={120}
            placeholder={provider?.name ? `Ex.: ${provider.name} LLC` : 'Ex.: Silva Remodeling LLC'} autoCapitalize="words"
            hint="Vazio = usa o nome do seu perfil." />
          <Input label="Licença / registro (opcional)" value={form.license_no} onChangeText={set('license_no')} maxLength={60}
            placeholder="Ex.: HIC #123456" autoCapitalize="characters" hint="Alguns estados exigem o número da licença no orçamento." />
          <Input label="Seguro (opcional)" value={form.insurance} onChangeText={set('insurance')} maxLength={160}
            placeholder="Ex.: Insured · General liability $1M" />
        </Section>

        <Section title="Endereço e contato">
          <Input label="Endereço" value={form.address_line} onChangeText={set('address_line')} maxLength={160} placeholder="Ex.: 123 Main St, Suite 4" />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Input label="Cidade" value={form.city} onChangeText={set('city')} maxLength={80} style={{ flex: 2 }} autoCapitalize="words" placeholder="Austin" />
            <Input label="Estado" value={form.state} onChangeText={(v) => set('state')(v.toUpperCase().replace(/[^A-Z]/gi, '').slice(0, 2))}
              error={errors.state} style={{ flex: 1 }} autoCapitalize="characters" maxLength={2} placeholder="TX" />
            <Input label="ZIP" value={form.zip} onChangeText={(v) => set('zip')(v.replace(/[^0-9-]/g, '').slice(0, 10))} error={errors.zip}
              style={{ flex: 1.3 }} keyboardType="number-pad" maxLength={10} placeholder="78701" />
          </View>
          <Input label="Telefone" value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" maxLength={30}
            placeholder={provider?.whatsapp ? 'Vazio = usa o WhatsApp do perfil' : '(512) 555-0101'} />
          <Input label="E-mail" value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none"
            autoCorrect={false} maxLength={120} placeholder="contato@suaempresa.com" />
          <Input label="Site (opcional)" value={form.website} onChangeText={set('website')} error={errors.website} autoCapitalize="none"
            autoCorrect={false} keyboardType="url" maxLength={200} placeholder="www.suaempresa.com" />
        </Section>

        <Section title="Padrões dos documentos">
          <Muted style={{ marginBottom: spacing.md }}>Já vêm preenchidos em todo orçamento e fatura novos. Dá pra mudar em cada um.</Muted>
          <Label style={{ marginBottom: spacing.sm }}>Idioma padrão</Label>
          <Segmented options={DOC_LANGS} value={form.language} onChange={set('language')} />
          <Muted style={{ marginTop: 6, marginBottom: spacing.lg }}>Cliente que fala outro idioma recebe no idioma da ficha dela.</Muted>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Input label="Sales tax (%)" value={form.tax} onChangeText={set('tax')} error={errors.tax} keyboardType="decimal-pad" maxLength={6}
              placeholder="Ex.: 8.25" style={{ flex: 1 }} />
            <Input label="Entrada (%)" value={form.deposit_pct} onChangeText={(v) => set('deposit_pct')(v.replace(/\D/g, '').slice(0, 3))} error={errors.deposit_pct}
              keyboardType="number-pad" maxLength={3} placeholder="Ex.: 30" style={{ flex: 1 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Input label="Fatura vence em (dias)" value={form.due_days} onChangeText={(v) => set('due_days')(v.replace(/\D/g, '').slice(0, 3))} error={errors.due_days}
              keyboardType="number-pad" maxLength={3} style={{ flex: 1 }} hint="0 = na entrega" />
            <Input label="Orçamento vale (dias)" value={form.quote_valid_days} onChangeText={(v) => set('quote_valid_days')(v.replace(/\D/g, '').slice(0, 3))}
              error={errors.quote_valid_days} keyboardType="number-pad" maxLength={3} style={{ flex: 1 }} />
          </View>

          <Input label="Como pagar" value={form.payment_instructions} onChangeText={set('payment_instructions')} multiline maxLength={1000}
            placeholder="Ex.: Zelle (512) 555-0101 · Cheque nominal a Silva Remodeling LLC" style={{ marginBottom: spacing.xs }} />
          <ExampleLink text="Usar exemplo com Zelle e cheque" onPress={() => fillExample('payment_instructions')} />
          <Input label="Condições" value={form.terms} onChangeText={set('terms')} multiline maxLength={3000}
            placeholder="Garantia, prazo de início, o que não está incluso…" style={{ marginBottom: spacing.xs }} />
          <ExampleLink text="Usar exemplo de condições" onPress={() => fillExample('terms')} />
          <Input label="Recado pra cliente" value={form.notes} onChangeText={set('notes')} multiline maxLength={1000}
            placeholder="Ex.: Obrigado pela confiança! Qualquer dúvida, me chame no WhatsApp." />
        </Section>

        <Section title="Avisos">
          <Card padded={false}>
            <ToggleRow title="Avisar no celular" subtitle="Orçamento visto, aprovado ou recusado, fatura paga e pedido de orçamento novo."
              value={form.notify_documents} onValueChange={set('notify_documents')} />
          </Card>
        </Section>

        {!dirty ? <Button title="Ver orçamentos e faturas" icon="document-text-outline" variant="ghost" onPress={() => router.navigate('/vendas')} style={{ marginTop: spacing.xl }} /> : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

function ExampleLink({ text, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.lg, alignSelf: 'flex-start' }} accessibilityRole="button">
      <Ionicons name="sparkles-outline" size={14} color={colors.green} />
      <Text style={{ color: colors.green, fontWeight: '600', fontSize: 13 }}>{text}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  preview: { paddingTop: spacing.md },
  bar: { height: 5, borderRadius: 3, marginBottom: spacing.md },
  logo: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.paperSoft },
  line: { fontSize: 12, color: colors.inkSoft, lineHeight: 16 },
  title: { fontSize: 15, fontWeight: '700', color: colors.navy, textTransform: 'uppercase', letterSpacing: 0.8 },
})
