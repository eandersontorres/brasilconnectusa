// Nova despesa ou edição (?id=). Categoria, valor, data, descrição, forma de
// pagamento e foto do comprovante (opcional). ?date= sugere o dia da despesa nova.
import { useEffect, useState } from 'react'
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as WebBrowser from 'expo-web-browser'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { api, post } from '../../lib/api'
import { showError } from '../../lib/gate'
import { choose, confirm, notify } from '../../lib/dialog'
import { colors, radius, spacing, type } from '../../lib/theme'
import { centsToInput, fmtMoney, parseMoney, todayKey } from '../../lib/format'
import { EXPENSE_CATEGORIES, EXPENSE_METHODS, categoryInfo, methodLabel } from '../../lib/receipt'
import { BRAND } from '../../lib/variant'
import { Button, Card, Chip, ErrorBox, Input, Label, Loading, Muted, Screen, Section } from '../../components/ui'
import { DateField } from '../../components/pickers'
import Locked from '../../components/Locked'

const isWeb = Platform.OS === 'web'
const MAX_UPLOAD = 480 * 1024                                // servidor aceita 500 KB
const SIZES = [[1400, 0.7], [1200, 0.6], [1000, 0.5]]        // comprovante precisa de letra legível
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const endOfThisMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12) }

export default function ExpenseEditScreen() {
  const { id } = useLocalSearchParams()
  return (
    <>
      <Stack.Screen options={{ title: id ? 'Editar despesa' : 'Nova despesa' }} />
      <Locked feature="finance"><ExpenseForm /></Locked>
    </>
  )
}

/** Redimensiona e comprime a foto até caber no limite do upload. */
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

async function pickPhoto(source) {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      notify('Sem acesso à câmera', `Libere a câmera para o ${BRAND.name} nos Ajustes do celular.`)
      return null
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    return res.canceled ? null : res.assets?.[0] || null
  }
  if (!isWeb) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      notify('Sem acesso às fotos', `Libere o acesso às fotos para o ${BRAND.name} nos Ajustes do celular.`)
      return null
    }
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
  return res.canceled ? null : res.assets?.[0] || null
}

function ExpenseForm() {
  const params = useLocalSearchParams()
  const id = params.id ? String(params.id) : null
  const startDate = DATE_RE.test(String(params.date || '')) ? String(params.date) : todayKey()

  const [loading, setLoading] = useState(!!id)
  const [loadError, setLoadError] = useState(null)
  const [category, setCategory] = useState(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(startDate)
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState(null)
  const [receiptUrl, setReceiptUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(null)       // 'save' | 'again' | 'delete'
  const [errors, setErrors] = useState({})

  async function load() {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const { expense: e } = await api(`/api/agenda/finance?view=expense&id=${encodeURIComponent(id)}`)
      setCategory(e.category)
      setAmount(centsToInput(e.amount_cents))
      setDate(String(e.spent_on).slice(0, 10))
      setDescription(e.description || '')
      setMethod(e.payment_method || null)
      setReceiptUrl(e.receipt_url || null)
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  async function addPhoto() {
    const options = []
    if (!isWeb) options.push({ label: 'Tirar foto', value: 'camera' })
    options.push({ label: isWeb ? 'Escolher arquivo' : 'Escolher da galeria', value: 'library' })
    const source = options.length === 1 ? options[0].value : await choose('Foto do comprovante', options)
    if (!source) return
    try {
      const asset = await pickPhoto(source)
      if (!asset) return
      setUploading(true)
      const b64 = await prepareImage(asset)
      const r = await post('/api/upload', { file_data: `data:image/jpeg;base64,${b64}`, folder: 'receipts' })
      if (!r?.url) throw new Error('Não deu pra enviar a foto. Tente de novo.')
      setReceiptUrl(r.url)
    } catch (e) {
      showError(e, 'Não deu pra enviar a foto')
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto() {
    if (await confirm('Tirar o comprovante?', 'A foto sai desta despesa quando você salvar.', { ok: 'Tirar', destructive: true })) setReceiptUrl(null)
  }

  function validate() {
    const e = {}
    const cents = parseMoney(amount)
    if (!category) e.category = 'Escolha a categoria'
    if (cents == null || cents <= 0) e.amount = 'Informe o valor, ex.: 45,90'
    else if (cents > 10000000) e.amount = 'Valor muito alto (máximo $100.000)'
    if (!DATE_RE.test(String(date || ''))) e.date = 'Data inválida. Use AAAA-MM-DD'
    else if (date > todayKey() && date.slice(0, 7) > todayKey().slice(0, 7)) e.date = 'Essa data ainda não chegou'
    setErrors(e)
    return Object.keys(e).length ? null : cents
  }

  async function save(again = false) {
    const cents = validate()
    if (cents == null) return
    setSaving(again ? 'again' : 'save')
    const body = {
      spent_on: date,
      category,
      amount_cents: cents,
      description: description.trim() || null,
      payment_method: method,
      receipt_url: receiptUrl,
    }
    try {
      if (id) await post('/api/agenda/finance', { action: 'expense_update', id, ...body })
      else await post('/api/agenda/finance', { action: 'expense_create', ...body })
      if (again) {
        // Mantém data e forma de pagamento: comum lançar várias notas do mesmo dia
        notify('Despesa salva', `${categoryInfo(category).label} · ${fmtMoney(cents)}`)
        setAmount('')
        setDescription('')
        setReceiptUrl(null)
        setErrors({})
      } else {
        router.back()
      }
    } catch (e) {
      showError(e)
    } finally {
      setSaving(null)
    }
  }

  async function remove() {
    const ok = await confirm('Excluir esta despesa?', 'Ela sai das suas finanças e dos relatórios. Não dá pra desfazer.', { ok: 'Excluir', destructive: true })
    if (!ok) return
    setSaving('delete')
    try {
      await post('/api/agenda/finance', { action: 'expense_delete', id })
      router.back()
    } catch (e) {
      showError(e)
      setSaving(null)
    }
  }

  if (loading) return <Screen><Loading text="Carregando despesa…" /></Screen>
  if (loadError) return <Screen><ErrorBox error={loadError} onRetry={load} /></Screen>

  const info = category ? categoryInfo(category) : null
  const busy = !!saving || uploading

  return (
    <Screen>
      <Label style={{ marginBottom: spacing.sm }}>Categoria</Label>
      <View style={st.chips}>
        {EXPENSE_CATEGORIES.map((c) => (
          <Chip key={c.value} label={c.label} icon={c.icon} selected={category === c.value}
            onPress={() => { setCategory(c.value); setErrors((x) => ({ ...x, category: null })) }} />
        ))}
      </View>
      {errors.category ? <Text style={st.err}>{errors.category}</Text> : info?.hint ? <Muted style={{ marginBottom: spacing.sm }}>{info.hint}</Muted> : null}
      {category === 'gasolina' ? (
        <Muted style={{ marginBottom: spacing.md }}>
          Se você registra milhagem, o IRS não aceita deduzir a gasolina também. A reserva do imposto já leva isso em conta.
        </Muted>
      ) : null}

      <Section>
        <Input label="Valor (US$)" value={amount} onChangeText={(t) => { setAmount(t); setErrors((x) => ({ ...x, amount: null })) }}
          keyboardType="decimal-pad" placeholder="0,00" error={errors.amount} />
        <DateField label="Data" value={date} onChange={(v) => { setDate(v); setErrors((x) => ({ ...x, date: null })) }} maximumDate={endOfThisMonth()} />
        {errors.date ? <Text style={[st.err, { marginTop: -spacing.sm }]}>{errors.date}</Text> : null}
        <Input label="Descrição (opcional)" value={description} onChangeText={setDescription} maxLength={300}
          placeholder={info?.hint ? `Ex.: ${info.hint.split(',')[0]}` : 'Ex.: Loja, produto, serviço'} returnKeyType="done" />
      </Section>

      <Label style={{ marginBottom: spacing.sm }}>Forma de pagamento</Label>
      <View style={st.chips}>
        {EXPENSE_METHODS.map((m) => (
          <Chip key={m} label={methodLabel(m)} selected={method === m} onPress={() => setMethod(method === m ? null : m)} />
        ))}
      </View>

      <Section title="Comprovante (opcional)">
        {uploading ? (
          <Card><Loading text="Enviando a foto…" style={{ padding: spacing.lg }} /></Card>
        ) : receiptUrl ? (
          <Card padded={false} style={{ overflow: 'hidden' }}>
            <Pressable onPress={() => WebBrowser.openBrowserAsync(receiptUrl).catch(() => {})} accessibilityLabel="Ver comprovante">
              <Image source={{ uri: receiptUrl }} style={st.photo} resizeMode="cover" />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }}>
              <Button title="Trocar foto" small variant="secondary" icon="camera-outline" onPress={addPhoto} style={{ flex: 1 }} disabled={busy} />
              <Button title="Tirar" small variant="danger" icon="trash-outline" onPress={removePhoto} style={{ flex: 1 }} disabled={busy} />
            </View>
          </Card>
        ) : (
          <Pressable onPress={addPhoto} disabled={busy} style={({ pressed }) => [st.photoEmpty, pressed && { opacity: 0.8 }]}>
            <Ionicons name="camera-outline" size={26} color={colors.green} />
            <Text style={{ color: colors.green, fontWeight: '600', marginTop: 6 }}>{isWeb ? 'Anexar foto do comprovante' : 'Fotografar ou escolher o comprovante'}</Text>
            <Muted style={{ textAlign: 'center', marginTop: 2 }}>Fica guardado junto da despesa e vai no CSV pro contador.</Muted>
          </Pressable>
        )}
      </Section>

      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Button title={id ? 'Salvar alterações' : 'Salvar despesa'} onPress={() => save(false)} loading={saving === 'save'} disabled={busy && saving !== 'save'} />
        {!id ? <Button title="Salvar e lançar outra" variant="secondary" onPress={() => save(true)} loading={saving === 'again'} disabled={busy && saving !== 'again'} /> : null}
        {id ? <Button title="Excluir despesa" variant="danger" icon="trash-outline" onPress={remove} loading={saving === 'delete'} disabled={busy && saving !== 'delete'} /> : null}
      </View>
    </Screen>
  )
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  err: { ...type.muted, color: colors.danger, marginBottom: spacing.sm },
  photo: { width: '100%', height: 220, backgroundColor: colors.paperSoft },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.white },
})
