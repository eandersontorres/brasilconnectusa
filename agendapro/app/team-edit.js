// Nova pessoa da equipe ou edição (?id=). Nome, cor na agenda, WhatsApp, e-mail,
// tipo (profissional ou equipe de limpeza com os nomes de quem vai), ativo,
// link da rota do dia (copiar, mandar, gerar outro) e excluir.
import { useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { confirm, notify } from '../lib/dialog'
import { fmtPhone, phoneDigits } from '../lib/format'
import { colors, radius, spacing, teamColors, type } from '../lib/theme'
import Locked from '../components/Locked'
import { Badge, Button, Card, ErrorBox, IconButton, Input, Label, Loading, Muted, Screen, Section, Segmented, ToggleRow } from '../components/ui'
import { shareDayLink } from './team'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_MEMBERS = 12
const ROLES = [
  { value: 'profissional', label: 'Profissional' },
  { value: 'equipe', label: 'Equipe de limpeza' },
]

function TeamEdit() {
  const app = useApp()
  const { id: rawId } = useLocalSearchParams()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const editing = !!id
  const cleaning = app.provider?.vertical === 'cleaning'

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [all, setAll] = useState([])
  const [member, setMember] = useState(null)
  const [form, setForm] = useState({ name: '', color: teamColors[0], whatsapp: '', email: '', role: cleaning ? 'equipe' : 'profissional', members: [''], active: true })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rotating, setRotating] = useState(false)

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: null })) }

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const r = await api('/api/agenda/staff')
      const list = r.staff || []
      setAll(list)
      if (editing) {
        const m = list.find((x) => x.id === id)
        if (!m) throw new Error('Pessoa não encontrada. Ela pode ter sido excluída.')
        setMember(m)
        setForm({
          name: m.name || '',
          color: m.color || teamColors[0],
          whatsapp: m.whatsapp ? fmtPhone(m.whatsapp) : '',
          email: m.email || '',
          role: m.role === 'equipe' ? 'equipe' : 'profissional',
          members: m.members && m.members.length ? m.members : [''],
          active: m.active !== false,
        })
      } else {
        // Cor nova: a primeira da paleta que ninguém usa ainda
        const used = new Set(list.map((x) => String(x.color || '').toUpperCase()))
        const free = teamColors.find((c) => !used.has(c.toUpperCase())) || teamColors[list.length % teamColors.length]
        setForm((f) => ({ ...f, color: free }))
      }
    } catch (e) {
      if (editing) setLoadError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  const usedColors = useMemo(() => new Set(all.filter((x) => x.id !== id).map((x) => String(x.color || '').toUpperCase())), [all, id])

  // ── Membros da equipe ────────────────────────────────────────────────────
  const setMemberName = (i, v) => setForm((f) => ({ ...f, members: f.members.map((x, k) => (k === i ? v : x)) }))
  const addMember = () => setForm((f) => (f.members.length >= MAX_MEMBERS ? f : { ...f, members: [...f.members, ''] }))
  const removeMember = (i) => setForm((f) => {
    const next = f.members.filter((_, k) => k !== i)
    return { ...f, members: next.length ? next : [''] }
  })

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = cleaning && form.role === 'equipe' ? 'Dê um nome pra equipe (ex.: Equipe da Maria)' : 'Escreva o nome'
    else if (form.name.trim().length > 60) e.name = 'Nome muito longo'
    const d = phoneDigits(form.whatsapp)
    if (form.whatsapp.trim() && d.length < 11) e.whatsapp = 'Número incompleto. Coloque com o DDD (ex.: 508 555 0101).'
    if (form.email.trim() && !EMAIL.test(form.email.trim())) e.email = 'E-mail inválido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!(await ensureFeature(app, 'team'))) return
    if (!validate()) return
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        color: form.color,
        whatsapp: phoneDigits(form.whatsapp),
        email: form.email.trim(),
        role: form.role,
        members: form.role === 'equipe' ? form.members.map((x) => x.trim()).filter(Boolean) : [],
        active: form.active,
      }
      const r = editing
        ? await post('/api/agenda/staff', { action: 'update', id, ...body })
        : await post('/api/agenda/staff', { action: 'create', ...body })
      // Pessoa nova: já oferece mandar o link da rota do dia
      if (!editing && r.staff?.day_link_url && app.can('team_day_link')) {
        const go = await confirm('Pronto!', `${r.staff.name} já aparece na agenda. Quer mandar agora o link da rota do dia?`, { ok: 'Mandar link', cancel: 'Depois' })
        if (go) await shareDayLink(r.staff, app.provider)
      }
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setSaving(false)
    }
  }

  async function rotate() {
    if (!(await ensureFeature(app, 'team_day_link'))) return
    const ok = await confirm('Gerar link novo?', 'O link antigo para de funcionar na hora. Use quando alguém saiu da equipe ou o link foi parar onde não devia.', { ok: 'Gerar novo', destructive: true })
    if (!ok) return
    setRotating(true)
    try {
      const r = await post('/api/agenda/staff', { action: 'rotate_token', id })
      setMember(r.staff)
      const send = await confirm('Link novo pronto', 'Quer mandar o link novo agora?', { ok: 'Mandar', cancel: 'Depois' })
      if (send) await shareDayLink(r.staff, app.provider)
    } catch (e) {
      showError(e)
    } finally {
      setRotating(false)
    }
  }

  async function remove() {
    const ok = await confirm(`Excluir ${member?.name || 'esta pessoa'}?`,
      'Os atendimentos antigos continuam no histórico. Se ela tiver horário marcado pela frente, fica só desativada.',
      { ok: 'Excluir', destructive: true })
    if (!ok) return
    setDeleting(true)
    try {
      const r = await post('/api/agenda/staff', { action: 'delete', id })
      if (r.deactivated) {
        const n = r.future_count || 0
        notify('Ficou desativada', `${member?.name || 'Ela'} tem ${n} ${n === 1 ? 'horário marcado' : 'horários marcados'} pela frente. Desativamos em vez de excluir. Troque quem atende nesses horários na agenda e depois exclua.`)
      }
      router.back()
    } catch (e) {
      showError(e)
    } finally {
      setDeleting(false)
    }
  }

  const title = editing ? (form.role === 'equipe' ? 'Editar equipe' : 'Editar profissional') : (form.role === 'equipe' ? 'Nova equipe' : 'Nova pessoa')

  if (loading) return <Screen><Stack.Screen options={{ title }} /><Loading /></Screen>
  if (loadError) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorBox error={loadError} onRetry={load} />
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </Screen>
    )
  }

  const canLink = app.can('team_day_link')

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title }} />
      <Screen footer={<Button title={editing ? 'Salvar alterações' : 'Adicionar na equipe'} onPress={save} loading={saving} disabled={deleting} />}>
        <Label style={{ marginBottom: spacing.sm }}>Tipo</Label>
        <Segmented options={ROLES} value={form.role} onChange={set('role')} style={{ marginBottom: spacing.lg }} />

        <Input label={form.role === 'equipe' ? 'Nome da equipe' : 'Nome'} value={form.name} onChangeText={set('name')}
          placeholder={form.role === 'equipe' ? 'Ex.: Equipe da Maria' : 'Ex.: Ana'} error={errors.name} maxLength={60} autoCapitalize="words" />

        {form.role === 'equipe' ? (
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginBottom: 6 }}>Quem vai nessa equipe</Text>
            {form.members.map((name, i) => (
              <Input key={i} value={name} onChangeText={(v) => setMemberName(i, v)} placeholder={`Pessoa ${i + 1}`} maxLength={40}
                autoCapitalize="words" style={{ marginBottom: spacing.sm }}
                right={form.members.length > 1 || name ? (
                  <Pressable onPress={() => removeMember(i)} accessibilityLabel={`Tirar ${name || 'pessoa'} da equipe`} style={{ padding: spacing.md }}>
                    <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
                  </Pressable>
                ) : null} />
            ))}
            {form.members.length < MAX_MEMBERS ? (
              <Button title="Adicionar pessoa" icon="add" variant="ghost" small full={false} onPress={addMember} />
            ) : null}
            <Muted style={{ marginTop: 4 }}>Os nomes aparecem no topo da rota do dia.</Muted>
          </View>
        ) : null}

        <Label style={{ marginBottom: spacing.sm }}>Cor na agenda</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: spacing.sm }}>
          {teamColors.map((c) => {
            const on = c.toUpperCase() === String(form.color).toUpperCase()
            const taken = usedColors.has(c.toUpperCase())
            return (
              <Pressable key={c} onPress={() => set('color')(c)} accessibilityRole="button" accessibilityLabel={`Cor ${c}${taken ? ', já usada' : ''}`} accessibilityState={{ selected: on }}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 3 : 0, borderColor: colors.white, opacity: taken && !on ? 0.45 : 1,
                  ...(on ? { shadowColor: c, shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 3 } : null) }}>
                {on ? <Ionicons name="checkmark" size={20} color={colors.white} /> : null}
              </Pressable>
            )
          })}
        </View>
        <Muted style={{ marginBottom: spacing.lg }}>As cores mais apagadas já são de outra pessoa (pode repetir se quiser).</Muted>

        <Input label="WhatsApp" value={form.whatsapp} onChangeText={set('whatsapp')} placeholder="(508) 555-0101" keyboardType="phone-pad"
          error={errors.whatsapp} hint="Pra mandar a rota do dia e conversar em 1 toque." maxLength={20} />
        <Input label="E-mail (opcional)" value={form.email} onChangeText={set('email')} placeholder="nome@email.com" keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} error={errors.email} maxLength={120} />

        <Card padded={false} style={{ marginBottom: spacing.lg }}>
          <ToggleRow title="Ativa na agenda" subtitle={form.active ? 'Aparece pra escolher nos agendamentos.' : 'Não aparece pra escolher. O histórico continua.'}
            value={form.active} onValueChange={set('active')} />
        </Card>

        {editing && member ? (
          <Section title="Rota do dia" style={{ marginTop: spacing.sm }}>
            <Card>
              {canLink ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                    <Ionicons name="navigate-outline" size={18} color={colors.green} />
                    <Text style={[type.body, { fontWeight: '600', flex: 1 }]}>Link sem senha</Text>
                    {!member.active ? <Badge text="Desativado" tone="gray" /> : null}
                  </View>
                  <Muted style={{ marginBottom: spacing.md }}>
                    {cleaning
                      ? 'Mostra as casas do dia em ordem, com endereço, botão de navegar e as observações (portão, alarme, pets).'
                      : 'Mostra os atendimentos do dia em ordem, com horário, endereço e observações.'}
                  </Muted>
                  {member.day_link_url ? (
                    <View style={{ backgroundColor: colors.paperSoft, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md }}>
                      <Text selectable numberOfLines={2} style={[type.small, { color: colors.inkSoft }]}>{member.day_link_url}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button small title="Mandar link" icon="share-outline" onPress={() => shareDayLink(member, app.provider)} disabled={!member.day_link_url || !member.active} style={{ flex: 1 }} />
                    <Button small title="Gerar novo" icon="refresh" variant="secondary" onPress={rotate} loading={rotating} style={{ flex: 1 }} />
                  </View>
                  {!member.active ? <Muted style={{ marginTop: spacing.sm }}>Com a pessoa desativada, o link não abre.</Muted> : null}
                </>
              ) : (
                <Pressable onPress={() => ensureFeature(app, 'team_day_link')} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <IconButton icon="lock-closed" color={colors.goldDark} bg={colors.goldSoft} size={36} onPress={() => ensureFeature(app, 'team_day_link')} label="Ver plano" />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { fontWeight: '600' }]}>Rota do dia por link</Text>
                    <Muted>Faz parte do plano Premium.</Muted>
                  </View>
                </Pressable>
              )}
            </Card>
          </Section>
        ) : null}

        {editing ? (
          <Button title="Excluir da equipe" variant="danger" icon="trash-outline" onPress={remove} loading={deleting} disabled={saving} style={{ marginTop: spacing.xl }} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

export default function TeamEditRoute() {
  const app = useApp()
  if (!app.can('team')) {
    return (
      <>
        <Stack.Screen options={{ title: 'Equipe' }} />
        <Locked feature="team" />
      </>
    )
  }
  return <TeamEdit />
}
