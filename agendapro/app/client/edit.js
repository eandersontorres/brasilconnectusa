// Cadastro e edição da cliente. /client/edit?id= edita; sem id cria (aceita
// ?name=&whatsapp= pra vir preenchido, ex.: da lista de espera).
// Endereço e acesso da casa aparecem direto pra quem faz limpeza; pros outros
// ficam em "Mais detalhes".
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../../lib/api'
import { useApp } from '../../lib/session'
import { ensureFeature, featureInfo, showError } from '../../lib/gate'
import { confirm, notify } from '../../lib/dialog'
import { colors, spacing } from '../../lib/theme'
import { phoneDigits } from '../../lib/format'
import { LANGS } from '../../lib/whatsapp'
import { Button, Card, Chip, Divider, ErrorBox, Input, Label, Loading, Muted, Row, Screen, Section, Segmented } from '../../components/ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const TAGS_SERVICES = ['VIP', 'Fixa', 'Indicação', 'Pontual', 'Paga com Zelle', 'Prefere manhã', 'Alergia']
const TAGS_CLEANING = ['Semanal', 'Quinzenal', 'Mensal', 'Tem pet', 'Tem chave', 'Airbnb', 'Paga com Zelle']

const EMPTY = { name: '', whatsapp: '', email: '', language: 'pt', birthday: '', address_line: '', city: '', state: '', zip: '', home_notes: '', notes: '', tags: [] }

// Aniversário: a tela usa DD/MM (jeito brasileiro), a API guarda MM-DD
const mdToBr = (md) => (md ? `${md.slice(3, 5)}/${md.slice(0, 2)}` : '')
function brToMd(br) {
  const m = String(br || '').match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  const dd = Number(m[1]), mm = Number(m[2])
  if (mm < 1 || mm > 12 || dd < 1 || dd > MONTH_DAYS[mm - 1]) return null
  return `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}
function maskBirthday(t) {
  const d = String(t || '').replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

export default function ClientEdit() {
  const params = useLocalSearchParams()
  const id = params.id ? String(params.id) : null
  const app = useApp()
  const isCleaning = app.provider?.vertical === 'cleaning'
  const canMulti = app.can('multilang_messages')

  const [form, setForm] = useState(() => ({
    ...EMPTY,
    name: params.name ? String(params.name) : '',
    whatsapp: params.whatsapp ? String(params.whatsapp) : '',
  }))
  const [archived, setArchived] = useState(false)
  const [loaded, setLoaded] = useState(!id)
  const [loadError, setLoadError] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(isCleaning)
  const [tagInput, setTagInput] = useState('')

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => ({ ...e, [k]: null })) }

  async function load() {
    setLoadError(null)
    try {
      const { client: c } = await api(`/api/agenda/clients?id=${encodeURIComponent(id)}`)
      setForm({
        name: c.name || '',
        whatsapp: c.whatsapp || '',
        email: c.email || '',
        language: c.language || 'pt',
        birthday: mdToBr(c.birthday_md),
        address_line: c.address_line || '',
        city: c.city || '',
        state: c.state || '',
        zip: c.zip || '',
        home_notes: c.home_notes || '',
        notes: c.notes || '',
        tags: c.tags || [],
      })
      setArchived(!!c.archived)
      if (c.address_line || c.city || c.zip || c.home_notes || c.birthday_md || c.email || (c.language && c.language !== 'pt')) setMore(true)
      setLoaded(true)
    } catch (e) {
      setLoadError(e)
    }
  }
  useEffect(() => { if (id) load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  function addTag(raw) {
    const t = String(raw ?? tagInput).replace(/[,{}"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24)
    if (!t) return
    setForm((f) => (f.tags.some((x) => x.toLowerCase() === t.toLowerCase()) || f.tags.length >= 12 ? f : { ...f, tags: [...f.tags, t] }))
    if (raw === undefined) setTagInput('')
  }
  const removeTag = (t) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }))

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Diga o nome da cliente'
    const digits = phoneDigits(form.whatsapp)
    if (form.whatsapp.trim() && (digits.length < 10 || digits.length > 15)) e.whatsapp = 'Confira o número: precisa do DDD (ex.: 512 555 0101)'
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = 'Confira o e-mail'
    if (form.birthday.trim() && !brToMd(form.birthday)) e.birthday = 'Use dia/mês, ex.: 14/10'
    if (form.zip.trim() && !/^[0-9A-Za-z -]{3,12}$/.test(form.zip.trim())) e.zip = 'ZIP inválido'
    return e
  }

  async function save() {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) {
      if (e.birthday || e.zip || e.email) setMore(true)
      return
    }
    if (!(await ensureFeature(app, 'clients'))) return

    // Etiqueta digitada e não adicionada também vale
    const pending = tagInput.trim()
    const tags = pending && !form.tags.some((x) => x.toLowerCase() === pending.toLowerCase()) ? [...form.tags, pending.slice(0, 24)] : form.tags
    const body = {
      name: form.name.trim(),
      whatsapp: form.whatsapp.trim(),
      email: form.email.trim(),
      language: form.language,
      birthday_md: form.birthday.trim() ? brToMd(form.birthday) : '',
      tags,
      address_line: form.address_line.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip: form.zip.trim(),
      home_notes: form.home_notes.trim(),
      notes: form.notes.trim(),
    }
    setSaving(true)
    try {
      if (id) {
        await post('/api/agenda/clients', { action: 'update', id, ...body })
        router.back()
      } else {
        const r = await post('/api/agenda/clients', { action: 'create', ...body })
        router.replace(`/client/${r.client.id}`)
      }
    } catch (err) {
      if (err.status === 409 && err.body?.client_id && err.body.client_id !== id) {
        const go = await confirm('Cliente já cadastrada', err.message, { ok: 'Abrir a ficha', cancel: 'Corrigir' })
        if (go) router.replace(`/client/${err.body.client_id}`)
      } else showError(err)
    } finally {
      setSaving(false)
    }
  }

  function leave() {
    if (router.canDismiss()) router.dismissAll()
    else router.replace('/clientes')
  }

  async function toggleArchive() {
    if (!(await ensureFeature(app, 'clients'))) return
    if (!archived) {
      const ok = await confirm('Arquivar a ficha?', 'Ela some das listas, mas o histórico continua salvo. Dá pra desarquivar quando quiser.', { ok: 'Arquivar' })
      if (!ok) return
    }
    setBusy(true)
    try {
      await post('/api/agenda/clients', { action: archived ? 'unarchive' : 'archive', id })
      if (archived) { setArchived(false); router.back() } else leave()
    } catch (e) { showError(e) } finally { setBusy(false) }
  }

  async function remove() {
    if (!(await ensureFeature(app, 'clients'))) return
    const ok = await confirm('Excluir a ficha?', 'Os atendimentos antigos continuam na agenda, só sem a ficha. Isso não tem volta.', { ok: 'Excluir', destructive: true })
    if (!ok) return
    setBusy(true)
    try {
      const r = await post('/api/agenda/clients', { action: 'delete', id })
      if (r.archived) notify('Ficha arquivada', r.message)
      leave()
    } catch (e) { showError(e) } finally { setBusy(false) }
  }

  const title = id ? 'Editar cliente' : 'Nova cliente'
  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        {loadError ? <ErrorBox error={loadError} onRetry={load} /> : <Loading />}
      </Screen>
    )
  }

  const suggestions = (isCleaning ? TAGS_CLEANING : TAGS_SERVICES).filter((t) => !form.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
  const multiInfo = featureInfo(app.ent, 'multilang_messages')

  const addressBlock = (
    <>
      <Input label="Endereço" value={form.address_line} onChangeText={set('address_line')} placeholder="123 Main St, Apt 4" autoCapitalize="words" textContentType="fullStreetAddress" />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Input label="Cidade" value={form.city} onChangeText={set('city')} placeholder="Boston" autoCapitalize="words" style={{ flex: 2 }} />
        <Input label="Estado" value={form.state} onChangeText={(v) => set('state')(v.length <= 2 ? v.toUpperCase() : v)} placeholder="MA" autoCapitalize="characters" maxLength={30} style={{ flex: 1 }} />
      </View>
      <Input label="ZIP code" value={form.zip} onChangeText={set('zip')} placeholder="02134" keyboardType="numbers-and-punctuation" maxLength={12} error={errors.zip} />
      <Input label="Acesso e cuidados da casa" value={form.home_notes} onChangeText={set('home_notes')} multiline
        placeholder="Código do portão, alarme, onde fica a chave, pet, produtos que ela prefere…" maxLength={1000} />
    </>
  )

  return (
    <Screen footer={<Button title={id ? 'Salvar' : 'Cadastrar cliente'} onPress={save} loading={saving} disabled={busy} />}>
      <Stack.Screen options={{ title }} />

      <Input label="Nome *" value={form.name} onChangeText={set('name')} placeholder="Maria Silva" autoCapitalize="words" autoFocus={!id && !form.name} error={errors.name} maxLength={120} textContentType="name" />
      <Input label="WhatsApp" value={form.whatsapp} onChangeText={set('whatsapp')} placeholder="(512) 555-0101" keyboardType="phone-pad" error={errors.whatsapp}
        hint="Número dos EUA com DDD. Do Brasil, comece com +55." maxLength={30} textContentType="telephoneNumber" />

      {isCleaning ? (
        <Section title="Casa" style={{ marginTop: spacing.sm }}>{addressBlock}</Section>
      ) : null}

      <Input label="Observações" value={form.notes} onChangeText={set('notes')} multiline maxLength={2000}
        placeholder={isCleaning ? 'Cômodos, o que priorizar, dia preferido…' : 'Alergias, preferências, fórmula da cor…'} />

      <Label style={{ marginBottom: spacing.sm }}>Etiquetas</Label>
      {form.tags.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {form.tags.map((t) => <Chip key={t} label={t} selected icon="close" onPress={() => removeTag(t)} />)}
        </View>
      ) : <Muted style={{ marginBottom: spacing.sm }}>Ajudam a achar e separar as clientes (ex.: VIP, Tem pet).</Muted>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
        {suggestions.slice(0, 7).map((t) => <Chip key={t} label={`+ ${t}`} onPress={() => addTag(t)} />)}
      </View>
      <Input value={tagInput} onChangeText={setTagInput} placeholder="Nova etiqueta" maxLength={24} returnKeyType="done"
        onSubmitEditing={() => addTag()} blurOnSubmit={false} style={{ marginTop: spacing.xs }}
        right={tagInput.trim() ? (
          <Pressable onPress={() => addTag()} hitSlop={8} style={{ paddingHorizontal: spacing.md }} accessibilityLabel="Adicionar etiqueta">
            <Ionicons name="add-circle" size={22} color={colors.green} />
          </Pressable>
        ) : null} />

      {!more ? (
        <Card padded={false}>
          <Row icon="ellipsis-horizontal-circle-outline" title="Mais detalhes" subtitle="E-mail, idioma, aniversário, endereço" chevron onPress={() => setMore(true)} />
        </Card>
      ) : (
        <Section title="Mais detalhes" style={{ marginTop: spacing.sm }}>
          <Input label="E-mail" value={form.email} onChangeText={set('email')} placeholder="maria@email.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            error={errors.email} hint="Pra confirmação e lembrete automáticos por e-mail." maxLength={254} textContentType="emailAddress" />

          <Label style={{ marginBottom: spacing.sm }}>Idioma das mensagens</Label>
          <Segmented options={LANGS} value={form.language} onChange={set('language')} />
          <Muted style={{ marginTop: 6, marginBottom: spacing.lg }}>
            {form.language !== 'pt' && !canMulti
              ? `Mensagens em inglês e espanhol fazem parte do plano ${multiInfo.minName}. Até lá, saem em português.`
              : 'As mensagens prontas do WhatsApp saem nesse idioma.'}
          </Muted>

          <Input label="Aniversário" value={form.birthday} onChangeText={(t) => set('birthday')(maskBirthday(t))} placeholder="DD/MM (ex.: 14/10)"
            keyboardType="number-pad" maxLength={5} error={errors.birthday} hint="Sem o ano. O app lembra você de mandar parabéns." />

          {!isCleaning ? (
            <>
              <Divider style={{ marginTop: 0, marginBottom: spacing.lg }} />
              <Label style={{ marginBottom: spacing.sm }}>Endereço (atendimento em casa)</Label>
              {addressBlock}
            </>
          ) : null}
        </Section>
      )}

      {id ? (
        <Section title="Ficha">
          <View style={{ gap: spacing.sm }}>
            <Button title={archived ? 'Desarquivar' : 'Arquivar'} icon="archive-outline" variant="secondary" onPress={toggleArchive} loading={busy} disabled={saving} />
            <Button title="Excluir ficha" icon="trash-outline" variant="danger" onPress={remove} disabled={busy || saving} />
          </View>
          <Muted style={{ marginTop: spacing.sm }}>Quem tem horário marcado é arquivada em vez de excluída.</Muted>
        </Section>
      ) : null}
    </Screen>
  )
}
