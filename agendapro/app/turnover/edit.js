// Nova casa ou edição (?id=): apelido, link .ics, horário do checkout, duração,
// valor da limpeza e observações. O servidor testa o link antes de salvar.
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { centsToInput, fmtDuration, parseMoney } from '../../lib/format'
import { colors, spacing } from '../../lib/theme'
import Locked from '../../components/Locked'
import { TimeField } from '../../components/pickers'
import { Badge, Banner, Button, Chip, ErrorBox, Input, Label, Loading, Muted, Screen, Section } from '../../components/ui'

const DURATIONS = [60, 90, 120, 180, 240, 300]
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const SOURCE_LABEL = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking: 'Booking.com' }

/** Plataforma pelo endereço (só pra mostrar; quem decide é o servidor). */
function detectSource(url) {
  const m = /^(?:webcal|https?):\/\/([^/?#]+)/i.exec(String(url || '').trim())
  const host = m ? m[1].toLowerCase() : ''
  if (/(^|\.)airbnb\./.test(host)) return 'airbnb'
  if (/(^|\.)(vrbo|homeaway|abritel|fewo-direkt|stayz|bookabach)\./.test(host)) return 'vrbo'
  if (/(^|\.)booking\.com$/.test(host)) return 'booking'
  return host ? 'outro' : null
}

function syncSummary(sync) {
  if (!sync) return ''
  if (sync.ok === false) return `Mas não deu pra ler o calendário agora: ${sync.error || 'erro desconhecido'}. Vamos tentar de novo na próxima sincronização.`
  const n = sync.reservations || 0
  const made = sync.created ? ` ${sync.created} limpeza${sync.created > 1 ? 's' : ''} entr${sync.created > 1 ? 'aram' : 'ou'} na agenda.` : ''
  return `${n} reserva${n === 1 ? '' : 's'} por vir encontrada${n === 1 ? '' : 's'}.${made}`
}

export default function TurnoverEditScreen() {
  const { id: rawId } = useLocalSearchParams()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  return (
    <>
      <Stack.Screen options={{ title: id ? 'Editar casa' : 'Nova casa' }} />
      <Locked feature="turnover_ical"><TurnoverEdit id={id} /></Locked>
    </>
  )
}

function TurnoverEdit({ id }) {
  const app = useApp()
  const editing = !!id
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState(null)
  const [feed, setFeed] = useState(null)
  const [form, setForm] = useState({ label: '', url: '', checkout: '11:00', duration: '180', price: '', notes: '' })
  const [durText, setDurText] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: null })); setError(null) }

  async function load() {
    if (!editing) return
    setLoading(true)
    setLoadError(null)
    try {
      const r = await api('/api/agenda/ical')
      const f = (r.feeds || []).find((x) => x.id === id)
      if (!f) throw new Error('Casa não encontrada. Ela pode ter sido removida.')
      setFeed(f)
      setForm({
        label: f.label || '',
        url: '',
        checkout: String(f.checkout_time || '11:00').slice(0, 5),
        duration: String(f.duration_min || 180),
        price: f.price_cents ? centsToInput(f.price_cents) : '',
        notes: f.notes || '',
      })
      setDurText(DURATIONS.includes(f.duration_min) ? '' : String(f.duration_min || ''))
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  async function paste() {
    try {
      const t = (await Clipboard.getStringAsync()) || ''
      if (!t.trim()) { notify('Nada copiado', 'Copie o link do calendário no Airbnb, Vrbo ou Booking e toque em Colar.'); return }
      set('url')(t.trim())
    } catch (_) {
      notify('Não deu pra colar', 'Segure no campo e escolha Colar.')
    }
  }

  const duration = Math.round(Number(form.duration))
  const priceCents = form.price.trim() ? parseMoney(form.price) : 0
  const source = detectSource(form.url)
  // Casa fora do limite do plano (depois de descer de plano): só dá pra remover
  const outOfLimit = editing && feed?.within_limit === false
  const OUT_MSG = 'Essa casa ficou fora do limite do seu plano e não sincroniza. Pra editar, remova outra casa ou veja os planos.'

  function validate() {
    const e = {}
    if (!form.label.trim()) e.label = 'Dê um nome pra casa (ex.: Casa do lago, Kissimmee)'
    const url = form.url.trim()
    if (!editing && !url) e.url = 'Cole o link do calendário (.ics)'
    else if (url && !/^(webcal|https?):\/\//i.test(url)) e.url = 'O link começa com https:// (copie o link de exportar calendário)'
    if (!HHMM.test(form.checkout)) e.checkout = 'Horário do checkout inválido. Use HH:MM'
    if (!Number.isFinite(duration) || duration < 15 || duration > 720) e.duration = 'Duração entre 15 e 720 minutos'
    if (priceCents == null) e.price = 'Valor inválido (ex.: 120)'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    if (!(await ensureFeature(app, 'turnover_ical'))) return
    if (outOfLimit) {
      showError({ code: 'limit_reached', message: OUT_MSG, feature: 'turnover_ical' })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        label: form.label.trim(),
        checkout_time: form.checkout,
        duration_min: duration,
        price_cents: priceCents || 0,
        notes: form.notes.trim() || null,
      }
      const url = form.url.trim()
      const r = editing
        ? await post('/api/agenda/ical', { action: 'update', id, ...body, url: url || undefined })
        : await post('/api/agenda/ical', { action: 'create', ...body, url })
      notify(editing ? 'Casa atualizada' : 'Casa adicionada', syncSummary(r.sync) || 'As limpezas por vir já seguem os dados novos.')
      router.back()
    } catch (e) {
      // Link com problema volta como texto pra mostrar aqui; plano vira convite
      if (e?.isPlan) showError(e)
      else setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const ok = await confirm('Remover casa?', 'As limpezas futuras dessa casa saem da agenda. As que já aconteceram ficam no histórico.', { ok: 'Remover', destructive: true })
    if (!ok) return
    setDeleting(true)
    try {
      await post('/api/agenda/ical', { action: 'delete', id })
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setDeleting(false)
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Screen footer={
        <View>
          <ErrorBox error={error} />
          {saving ? <Muted style={{ textAlign: 'center', marginBottom: spacing.sm }}>Testando o link e buscando as reservas…</Muted> : null}
          <Button title={editing ? 'Salvar alterações' : 'Adicionar casa'} onPress={save} loading={saving} disabled={deleting} />
        </View>
      }>
        {outOfLimit ? <Banner tone="gold" icon="lock-closed-outline" text={OUT_MSG} /> : null}
        <Input label="Nome da casa" value={form.label} onChangeText={set('label')} error={errors.label}
          placeholder="Ex.: Casa do lago (Kissimmee)" autoCapitalize="sentences" maxLength={80} />

        <Input
          label="Link do calendário (.ics)"
          value={form.url}
          onChangeText={set('url')}
          error={errors.url}
          placeholder={editing ? 'Deixe vazio pra manter o atual' : 'https://www.airbnb.com/calendar/ical/…'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint={editing && feed?.url_hint ? `Link atual: ${feed.url_hint}` : 'No anúncio: Calendário › Exportar calendário. Veja o passo a passo na tela anterior.'}
          right={
            <Pressable onPress={paste} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md }}>
              <Ionicons name="clipboard-outline" size={16} color={colors.green} />
              <Muted style={{ color: colors.green, fontWeight: '600' }}>Colar</Muted>
            </Pressable>
          }
        />
        {source ? (
          <View style={{ flexDirection: 'row', marginTop: -spacing.sm, marginBottom: spacing.lg }}>
            <Badge text={SOURCE_LABEL[source] ? `${SOURCE_LABEL[source]} reconhecido` : 'Outro calendário'} tone={SOURCE_LABEL[source] ? 'green' : 'gray'}
              icon={SOURCE_LABEL[source] ? 'checkmark-circle' : 'help-circle-outline'} />
          </View>
        ) : null}

        <TimeField label="Horário do checkout" value={form.checkout} onChange={set('checkout')} minuteInterval={15} />
        {errors.checkout ? <Muted style={{ color: colors.danger, marginTop: -spacing.md, marginBottom: spacing.md }}>{errors.checkout}</Muted> : (
          <Muted style={{ marginTop: -spacing.md, marginBottom: spacing.lg }}>A limpeza entra na agenda nesse horário, no dia de cada checkout.</Muted>
        )}

        <Section title="Quanto tempo leva" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {DURATIONS.map((d) => (
              <Chip key={d} label={fmtDuration(d)} selected={!durText && duration === d} onPress={() => { setDurText(''); set('duration')(String(d)) }} />
            ))}
          </View>
          <Input label="Outra duração (minutos)" value={durText} keyboardType="number-pad" placeholder="Ex.: 150" error={errors.duration}
            onChangeText={(v) => { const t = v.replace(/\D/g, '').slice(0, 3); setDurText(t); set('duration')(t) }} />
        </Section>

        <Input label="Valor da limpeza (US$)" value={form.price} onChangeText={set('price')} keyboardType="decimal-pad"
          placeholder="Ex.: 120" error={errors.price} hint="Entra no agendamento pra você controlar o que recebe. Opcional." />

        <Label style={{ marginBottom: spacing.sm }}>Observações da casa</Label>
        <Input value={form.notes} onChangeText={set('notes')} multiline maxLength={500}
          placeholder={'Endereço\nCódigo da porta / da garagem\nOnde fica a roupa de cama e o lixo'}
          hint={`Aparece em cada limpeza dessa casa (pra você e sua equipe). ${form.notes.length}/500`} />

        {editing ? (
          <Button title="Remover casa" variant="danger" icon="trash-outline" onPress={remove} loading={deleting} disabled={saving} style={{ marginTop: spacing.md }} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}
