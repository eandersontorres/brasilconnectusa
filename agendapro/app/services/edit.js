// Novo serviço ou edição (?id=). Nome, categoria, duração, preço, sinal anti-falta,
// ativo/pausado e excluir.
import { useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, del, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { centsToInput, fmtDuration, fmtMoney, parseMoney } from '../../lib/format'
import { colors, radius, spacing } from '../../lib/theme'
import { Button, Card, Chip, ErrorBox, H3, Input, Label, Loading, Muted, P, Screen, Section, ToggleRow } from '../../components/ui'

const DURATIONS = [15, 30, 45, 60, 90, 120, 180]
const DEPOSIT_PCTS = [0, 20, 30, 50]
const BASE_CATEGORIES = {
  services: ['Cabelo', 'Mãos', 'Pés', 'Estética', 'Cílios', 'Sobrancelha', 'Maquiagem'],
  cleaning: ['Limpeza', 'Limpeza pesada', 'Turnover', 'Pós-obra', 'Mudança'],
}

export default function ServiceEdit() {
  const app = useApp()
  const { id: rawId } = useLocalSearchParams()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const editing = !!id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [others, setOthers] = useState([])
  const [form, setForm] = useState({ name: '', category: '', description: '', duration: '60', price: '', deposit: '', active: true })
  const [durText, setDurText] = useState('')   // campo "outra duração" (separado dos chips)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: null })) }

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const r = await api('/api/agenda/services?mine=1')
      const all = r.services || []
      setOthers(all.filter((s) => s.id !== id))
      if (editing) {
        const s = all.find((x) => x.id === id)
        if (!s) throw new Error('Serviço não encontrado. Ele pode ter sido excluído.')
        setForm({
          name: s.name || '',
          category: s.category || '',
          description: s.description || '',
          duration: String(s.duration_min || 60),
          price: centsToInput(s.price_cents),
          deposit: s.deposit_cents ? centsToInput(s.deposit_cents) : '',
          active: s.active !== false,
        })
        setDurText(DURATIONS.includes(s.duration_min) ? '' : String(s.duration_min || ''))
      }
    } catch (e) {
      // Serviço novo funciona mesmo sem a lista (só perde as categorias sugeridas)
      if (editing) setLoadError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  const categories = useMemo(() => {
    const mine = others.map((s) => s.category).filter(Boolean)
    const base = BASE_CATEGORIES[app.provider?.vertical === 'cleaning' ? 'cleaning' : 'services']
    return [...new Set([...mine, ...base])].slice(0, 10)
  }, [others, app.provider?.vertical])

  const priceCents = parseMoney(form.price)
  const depositCents = form.deposit.trim() ? parseMoney(form.deposit) : 0
  const duration = Math.round(Number(form.duration))
  const canDeposit = app.can('deposit_offline') || app.can('deposit_stripe')
  const cardDeposit = app.can('deposit_stripe') && !!app.provider?.stripe_charges_enabled

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Dê um nome pro serviço'
    if (priceCents == null) e.price = 'Informe o preço (ex.: 45 ou 45.50)'
    if (!Number.isFinite(duration) || duration < 5 || duration > 600) e.duration = 'Duração entre 5 e 600 minutos'
    if (depositCents == null) e.deposit = 'Valor do sinal inválido'
    else if (priceCents != null && depositCents > priceCents) e.deposit = 'O sinal não pode passar do preço'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    if (!(await ensureFeature(app, 'services'))) return
    if (depositCents > 0 && !canDeposit && !(await ensureFeature(app, 'deposit_offline'))) return
    setSaving(true)
    try {
      await post('/api/agenda/services', {
        id: editing ? id : undefined,
        name: form.name.trim(),
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        duration_min: duration,
        price_cents: priceCents,
        deposit_cents: depositCents || 0,
        active: form.active,
      })
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!(await ensureFeature(app, 'services'))) return
    const ok = await confirm('Excluir serviço?', 'Se ele já tem agendamentos no histórico, fica pausado em vez de sumir.', { ok: 'Excluir', destructive: true })
    if (!ok) return
    setDeleting(true)
    try {
      const r = await del(`/api/agenda/services?id=${encodeURIComponent(id)}`)
      if (r.paused) notify('Serviço pausado', 'Ele tem agendamentos no histórico, então ficou pausado: não aparece mais na sua página.')
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setDeleting(false)
    }
  }

  function depositPct(pct) {
    if (!pct) return set('deposit')('')
    if (priceCents == null || priceCents === 0) {
      setErrors((e) => ({ ...e, price: 'Informe o preço primeiro' }))
      return
    }
    // Arredonda pro dólar cheio (mais fácil pra cliente pagar)
    const cents = Math.max(100, Math.round((priceCents * pct) / 100 / 100) * 100)
    set('deposit')(centsToInput(Math.min(cents, priceCents)))
  }

  const title = editing ? 'Editar serviço' : 'Novo serviço'

  if (loading) {
    return <Screen><Stack.Screen options={{ title }} /><Loading /></Screen>
  }
  if (loadError) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorBox error={loadError} onRetry={load} />
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </Screen>
    )
  }

  const preview = form.name.trim()
    ? `${form.name.trim()} · ${Number.isFinite(duration) && duration > 0 ? fmtDuration(duration) : '—'} · ${priceCents != null ? fmtMoney(priceCents) : '—'}${depositCents > 0 ? ` (sinal ${fmtMoney(depositCents)})` : ''}`
    : null

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title }} />
      <Screen footer={<Button title={editing ? 'Salvar alterações' : 'Criar serviço'} onPress={save} loading={saving} disabled={deleting} />}>
        <Input label="Nome do serviço" value={form.name} onChangeText={set('name')} error={errors.name}
          placeholder="Ex.: Corte feminino" autoCapitalize="sentences" maxLength={120} />

        <Label style={{ marginBottom: spacing.sm }}>Categoria (opcional)</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {categories.map((c) => (
            <Chip key={c} label={c} selected={form.category === c} onPress={() => set('category')(form.category === c ? '' : c)} />
          ))}
        </View>
        <Input value={form.category} onChangeText={set('category')} placeholder="Ou escreva outra" maxLength={60} />

        <Input label="Descrição (opcional)" value={form.description} onChangeText={set('description')} multiline maxLength={600}
          placeholder="O que está incluso, cuidados, pra quem é…" hint="Aparece na sua página, abaixo do nome." />

        <Section title="Duração" style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {DURATIONS.map((d) => (
              <Chip key={d} label={fmtDuration(d)} selected={!durText && duration === d} onPress={() => { setDurText(''); set('duration')(String(d)) }} />
            ))}
          </View>
          <Input label="Outra duração (minutos)" value={durText}
            onChangeText={(v) => { const t = v.replace(/\D/g, '').slice(0, 3); setDurText(t); set('duration')(t) }} keyboardType="number-pad"
            placeholder="Ex.: 75" error={errors.duration}
            hint="Inclua o tempo de arrumar entre uma cliente e outra." />
        </Section>

        <Input label="Preço (US$)" value={form.price} onChangeText={set('price')} keyboardType="decimal-pad"
          placeholder="Ex.: 60" error={errors.price} />

        <Card style={{ backgroundColor: colors.goldSoft, borderColor: colors.goldSoft, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.goldDark} />
            <H3 style={{ color: colors.goldDark }}>Sinal anti-falta</H3>
          </View>
          <P style={{ color: colors.inkSoft, marginTop: spacing.sm }}>
            A cliente paga uma parte antes pra garantir o horário, e o valor é descontado do total no dia. Quem paga sinal quase nunca falta.
          </P>
          {canDeposit ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md }}>
                {DEPOSIT_PCTS.map((p) => (
                  <Chip key={p} label={p ? `${p}%` : 'Sem sinal'} onPress={() => depositPct(p)}
                    selected={p === 0 ? !depositCents : (priceCents > 0 && depositCents === Math.max(100, Math.round((priceCents * p) / 100 / 100) * 100))} />
                ))}
              </View>
              <Input label="Valor do sinal (US$)" value={form.deposit} onChangeText={set('deposit')} keyboardType="decimal-pad"
                placeholder="0 = sem sinal" error={errors.deposit} style={{ marginBottom: spacing.sm }} />
              <Muted>
                {cardDeposit
                  ? 'A cliente paga o sinal no cartão na hora de agendar.'
                  : 'A cliente vê suas instruções (Zelle, dinheiro) e você confirma quando receber.'}
              </Muted>
              <Button title="Como recebo o sinal" variant="ghost" small full={false} icon="card-outline" onPress={() => router.push('/deposit')} style={{ marginTop: spacing.xs, paddingHorizontal: 0 }} />
            </>
          ) : (
            <Muted style={{ marginTop: spacing.sm }}>Pra pedir sinal, seu plano precisa estar ativo.</Muted>
          )}
        </Card>

        <Card padded={false} style={{ marginBottom: spacing.lg }}>
          <ToggleRow title="Aparece na minha página" subtitle={form.active ? 'Clientes podem agendar este serviço.' : 'Pausado: some da página, mas fica no histórico.'}
            value={form.active} onValueChange={set('active')} />
        </Card>

        {preview ? (
          <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.paperSoft, marginBottom: spacing.lg }}>
            <Muted>Como fica na página</Muted>
            <P style={{ fontWeight: '600', marginTop: 2 }}>{preview}</P>
          </View>
        ) : null}

        {editing ? (
          <Button title="Excluir serviço" variant="danger" icon="trash-outline" onPress={remove} loading={deleting} disabled={saving} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}
