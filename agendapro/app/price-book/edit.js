// Item novo da tabela de preços ou edição (?id=): nome, descrição, tipo, unidade,
// preço, tributável (sales tax), ativo/pausado e excluir.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { confirm } from '../../lib/dialog'
import { centsToInput, fmtMoney, parseMoney } from '../../lib/format'
import { KIND_OPTIONS, UNIT_OPTIONS, kindLabel, unitLabel } from '../../lib/documents'
import { colors, radius, spacing } from '../../lib/theme'
import { Banner, Button, Card, Chip, ErrorBox, Input, Label, Loading, Muted, P, Screen, Section, ToggleRow } from '../../components/ui'
import Locked from '../../components/Locked'

const EMPTY = { name: '', description: '', kind: 'service', unit: 'un', price: '', taxable: false, active: true }
const TAX_HINT = {
  material: 'Material costuma pagar sales tax. Confira a regra do seu estado.',
  labor: 'Em muitos estados a mão de obra não paga sales tax. Confira a regra do seu estado.',
}

export default function PriceItemScreen() {
  const { id } = useLocalSearchParams()
  return (
    <>
      <Stack.Screen options={{ title: id ? 'Editar item' : 'Novo item' }} />
      <Locked feature="price_book"><PriceItemForm /></Locked>
    </>
  )
}

function PriceItemForm() {
  const app = useApp()
  const navigation = useNavigation()
  const { id: rawId } = useLocalSearchParams()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const editing = !!id

  const [form, setForm] = useState(EMPTY)
  const [base, setBase] = useState(EMPTY)
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(null)      // 'save' | 'again' | 'delete'
  const [savedName, setSavedName] = useState('')
  const leaving = useRef(false)
  const dirtyRef = useRef(false)

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(base), [form, base])
  dirtyRef.current = dirty && !leaving.current

  const load = useCallback(async () => {
    if (!editing) return
    setLoading(true)
    setLoadError(null)
    try {
      const r = await api('/api/agenda/catalog')
      const x = (r.items || []).find((it) => it.id === id)
      if (!x) throw new Error('Item não encontrado. Ele pode ter sido excluído.')
      const f = {
        name: x.name || '',
        description: x.description || '',
        kind: KIND_OPTIONS.some((k) => k.value === x.kind) ? x.kind : 'other',
        unit: x.unit || 'un',
        price: centsToInput(x.unit_price_cents ?? 0),
        taxable: !!x.taxable,
        active: x.active !== false,
      }
      setForm(f)
      setBase(f)
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
    }
  }, [id, editing])

  useEffect(() => { load() }, [load])

  // Aviso ao sair com alterações não salvas
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || leaving.current) return
      e.preventDefault()
      confirm('Sair sem salvar?', 'O que você mudou neste item vai se perder.', { ok: 'Sair sem salvar', cancel: 'Continuar editando', destructive: true })
        .then((ok) => { if (ok) { leaving.current = true; navigation.dispatch(e.data.action) } })
    })
    return unsub
  }, [navigation])

  const set = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: null }))
  }

  const priceCents = parseMoney(form.price)

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Dê um nome pro item'
    if (priceCents == null) e.price = 'Informe o preço (ex.: 45 ou 45.50)'
    else if (priceCents > 100000000) e.price = 'Preço alto demais'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save(again = false) {
    if (!validate()) return
    if (!(await ensureFeature(app, 'price_book'))) return
    setSaving(again ? 'again' : 'save')
    try {
      const body = {
        name: form.name.trim().slice(0, 120),
        description: form.description.trim().slice(0, 500) || null,
        kind: form.kind,
        unit: form.unit,
        unit_price_cents: priceCents,
        taxable: !!form.taxable,
        active: !!form.active,
      }
      await post('/api/agenda/catalog', editing ? { action: 'update', id, ...body } : { action: 'create', ...body })
      if (again) {
        // Mantém tipo, unidade e imposto pro próximo item (cadastro em sequência)
        const next = { ...EMPTY, kind: form.kind, unit: form.unit, taxable: form.taxable }
        setForm(next)
        setBase(next)
        setSavedName(body.name)
        return
      }
      leaving.current = true
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(null)
    }
  }

  async function remove() {
    if (!(await ensureFeature(app, 'price_book'))) return
    const ok = await confirm('Excluir item?', 'Ele sai da tabela de preços. Orçamentos e faturas que já usaram o item não mudam.', { ok: 'Excluir', destructive: true })
    if (!ok) return
    setSaving('delete')
    try {
      await post('/api/agenda/catalog', { action: 'delete', id })
      leaving.current = true
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <Screen><Loading /></Screen>
  if (loadError) {
    return (
      <Screen>
        <ErrorBox error={loadError} onRetry={load} />
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </Screen>
    )
  }

  const preview = form.name.trim()
    ? `${form.name.trim()} · ${priceCents != null ? fmtMoney(priceCents, { decimals: 2 }) : '—'} / ${unitLabel(form.unit, 'pt')}${form.taxable ? ' · tributável' : ''}`
    : null

  const footer = (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {!editing ? <Button title="Salvar e criar outro" variant="secondary" style={{ flex: 1 }} loading={saving === 'again'} disabled={!!saving} onPress={() => save(true)} /> : null}
      <Button title={editing ? 'Salvar alterações' : 'Salvar'} style={{ flex: 1 }} loading={saving === 'save'} disabled={!!saving} onPress={() => save(false)} />
    </View>
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Screen footer={footer}>
        {savedName ? <Banner tone="green" icon="checkmark-circle" text={`"${savedName}" salvo. Pode cadastrar o próximo.`} /> : null}

        <Input label="Nome" value={form.name} onChangeText={set('name')} error={errors.name} maxLength={120} autoCapitalize="sentences"
          placeholder="Ex.: Instalação de porta, Hora de pintura, Tradução juramentada" />
        <Input label="Descrição (opcional)" value={form.description} onChangeText={set('description')} multiline maxLength={500}
          placeholder="O que está incluso, material, prazo…" hint="Vai junto pro orçamento, embaixo do nome." />

        <Label style={{ marginBottom: spacing.sm }}>Tipo</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
          {KIND_OPTIONS.map((k) => <Chip key={k.value} label={k.label} selected={form.kind === k.value} onPress={() => set('kind')(k.value)} />)}
        </View>

        <Label style={{ marginBottom: spacing.sm }}>Cobrado por</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
          {UNIT_OPTIONS.map((u) => <Chip key={u.value} label={u.label} selected={form.unit === u.value} onPress={() => set('unit')(u.value)} />)}
        </View>

        <Input label={`Preço por ${unitLabel(form.unit, 'pt')} (US$)`} value={form.price} onChangeText={set('price')} keyboardType="decimal-pad"
          placeholder="Ex.: 85" error={errors.price} maxLength={12} />

        <Card padded={false} style={{ marginBottom: spacing.lg }}>
          <ToggleRow title="Tributável (sales tax)" subtitle={TAX_HINT[form.kind] || 'Ligue se o imposto do seu estado vale pra este item.'}
            value={form.taxable} onValueChange={set('taxable')} />
          {editing ? (
            <ToggleRow title="Ativo" subtitle={form.active ? 'Aparece na hora de montar o orçamento.' : 'Pausado: não aparece pra escolher.'}
              value={form.active} onValueChange={set('active')} />
          ) : null}
        </Card>

        {preview ? (
          <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.paperSoft, marginBottom: spacing.lg }}>
            <Muted>Como aparece pra escolher · {kindLabel(form.kind)}</Muted>
            <P style={{ fontWeight: '600', marginTop: 2 }}>{preview}</P>
          </View>
        ) : null}

        {editing ? (
          <Section style={{ marginTop: 0 }}>
            <Button title="Excluir item" variant="danger" icon="trash-outline" onPress={remove} loading={saving === 'delete'} disabled={!!saving && saving !== 'delete'} />
          </Section>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}
