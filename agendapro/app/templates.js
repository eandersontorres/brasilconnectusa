// Mensagens prontas do WhatsApp: a profissional reescreve cada modelo em PT (e EN/ES
// no plano Pro), com variáveis que o app completa sozinho e prévia com dados de
// exemplo. Salva em app_settings.message_templates (saveSettings), mesclando com o
// que já existe; texto igual ao padrão não é guardado.
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { useApp } from '../lib/session'
import { ensureFeature, showError } from '../lib/gate'
import { confirm, notify } from '../lib/dialog'
import { colors, radius, spacing } from '../lib/theme'
import { PUBLIC_PAGE } from '../lib/config'
import { ALL_TEMPLATES, LANGS, TEMPLATE_VARS, defaultTemplateText, fillTemplate, openWhatsApp, sampleVars, templateTextAll } from '../lib/whatsapp'
import { Badge, Button, Card, Chip, H3, Input, Label, Muted, P, Screen, Section, Segmented, Small } from '../components/ui'
import { LockedCard } from '../components/Locked'

// Ordem e grupos na tela (modelos novos sem grupo caem em "Outras")
const GROUPS = [
  { title: 'Antes do atendimento', keys: ['confirm', 'reminder', 'deposit', 'on_the_way', 'late'] },
  { title: 'Depois do atendimento', keys: ['thanks', 'review'] },
  { title: 'Trazer clientes de volta', keys: ['comeback', 'birthday', 'slot_open', 'waitlist_added'] },
  { title: 'Casa e limpeza', keys: ['home_access'] },
]
const KNOWN_VARS = new Set(TEMPLATE_VARS.map((v) => v.key))
const MAX_LEN = 1000

export default function Templates() {
  const app = useApp()
  const { settings, saveSettings, provider } = app
  const canMulti = app.can('multilang_messages')

  const [lang, setLang] = useState('pt')
  const [openKey, setOpenKey] = useState(null)
  const [draft, setDraft] = useState('')
  const [sel, setSel] = useState(null)        // posição do cursor pra inserir variável
  const [saving, setSaving] = useState(false)

  const custom = settings.message_templates || {}
  const locked = lang !== 'pt' && !canMulti
  const sample = useMemo(() => sampleVars(lang, {
    profissional: provider?.name,
    link: provider?.slug ? PUBLIC_PAGE(provider.slug) : undefined,
  }), [lang, provider?.name, provider?.slug])

  const groups = useMemo(() => {
    const used = new Set(GROUPS.flatMap((g) => g.keys))
    const rest = Object.keys(ALL_TEMPLATES).filter((k) => !used.has(k))
    const list = GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => ALL_TEMPLATES[k]) }))
    if (rest.length) list.push({ title: 'Outras', keys: rest })
    if (provider?.vertical !== 'cleaning') {
      // Pra quem não faz limpeza, o grupo da casa vai pro fim
      const i = list.findIndex((g) => g.title === 'Casa e limpeza')
      if (i >= 0) list.push(list.splice(i, 1)[0])
    }
    return list.filter((g) => g.keys.length)
  }, [provider?.vertical])

  const isDirty = openKey && draft !== templateTextAll(openKey, lang, settings)

  async function open(key) {
    if (key === openKey) return
    if (isDirty && !(await confirm('Descartar a edição?', 'Você mudou o texto e não salvou.', { ok: 'Descartar', destructive: true }))) return
    setOpenKey(key)
    const text = templateTextAll(key, lang, settings)
    setDraft(text)
    setSel({ start: text.length, end: text.length })
  }

  async function switchLang(v) {
    if (v === lang) return
    if (isDirty && !(await confirm('Descartar a edição?', 'Você mudou o texto e não salvou.', { ok: 'Descartar', destructive: true }))) return
    setOpenKey(null)
    setLang(v)
  }

  function insertVar(key) {
    const token = `{${key}}`
    const s = sel && sel.start <= draft.length ? sel : { start: draft.length, end: draft.length }
    const before = draft.slice(0, s.start)
    const after = draft.slice(s.end)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    const next = (before + pad + token + after).slice(0, MAX_LEN)
    setDraft(next)
    const pos = before.length + pad.length + token.length
    setSel({ start: pos, end: pos })
  }

  /** Grava a versão nova (ou tira a personalizada) mesclando com os outros modelos. */
  async function persist(key, text) {
    const all = { ...(settings.message_templates || {}) }
    const cur = { ...(all[key] || {}) }
    if (!text || text === defaultTemplateText(key, lang)) delete cur[lang]
    else cur[lang] = text
    if (Object.keys(cur).length) all[key] = cur
    else delete all[key]
    setSaving(true)
    try {
      await saveSettings({ message_templates: all })
      setOpenKey(null)
      return true
    } catch (e) {
      showError(e, 'Não salvou')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function save(key) {
    if (!(await ensureFeature(app, 'whatsapp_templates'))) return
    if (lang !== 'pt' && !(await ensureFeature(app, 'multilang_messages'))) return
    const text = draft.trim()
    if (!text) return notify('Mensagem vazia', 'Escreva o texto ou toque em "Voltar ao padrão".')
    await persist(key, text)
  }

  async function restore(key) {
    if (!(await ensureFeature(app, 'whatsapp_templates'))) return
    const ok = await confirm('Voltar ao texto padrão?', 'Sua versão desse modelo, nesse idioma, será apagada.', { ok: 'Voltar ao padrão' })
    if (!ok) return
    await persist(key, '')
  }

  const unknownVars = openKey
    ? [...new Set((draft.match(/\{(\w+)\}/g) || []).map((t) => t.slice(1, -1)).filter((k) => !KNOWN_VARS.has(k)))]
    : []

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Mensagens prontas' }} />

      <P style={{ color: colors.inkSoft, marginBottom: spacing.md }}>
        Toque numa mensagem pra deixar com o seu jeito. As palavras entre chaves, como {'{nome}'} e {'{hora}'}, o app completa sozinho na hora de mandar.
      </P>

      <Segmented options={LANGS} value={lang} onChange={switchLang} />

      {locked ? (
        <LockedCard feature="multilang_messages" style={{ marginTop: spacing.lg }} />
      ) : groups.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.keys.map((key) => {
            const t = ALL_TEMPLATES[key]
            const isCustom = !!custom[key]?.[lang]
            const editing = openKey === key
            const text = templateTextAll(key, lang, settings)
            return (
              <Card key={key} onPress={editing ? undefined : () => open(key)} style={[{ marginBottom: spacing.md }, editing && { borderColor: colors.green, borderWidth: 1.5 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <H3 style={{ flex: 1 }} numberOfLines={1}>{t.title}</H3>
                  {isCustom ? <Badge text="Sua versão" tone="green" /> : null}
                </View>

                {!editing ? (
                  <Muted style={{ marginTop: 6 }} numberOfLines={3}>{fillTemplate(text, sample)}</Muted>
                ) : (
                  <View style={{ marginTop: spacing.md }}>
                    <Input value={draft} onChangeText={(v) => setDraft(v.slice(0, MAX_LEN))} multiline autoFocus
                      onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
                      inputStyle={{ minHeight: 120 }} style={{ marginBottom: 4 }} />
                    <Small style={{ textAlign: 'right', color: draft.length >= MAX_LEN ? colors.danger : colors.inkMuted }}>{draft.length}/{MAX_LEN}</Small>

                    <Label style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>Toque pra inserir</Label>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {TEMPLATE_VARS.map((v) => <Chip key={v.key} label={v.label} icon="add" onPress={() => insertVar(v.key)} />)}
                    </View>
                    {unknownVars.length ? (
                      <Small style={{ color: colors.warning, marginBottom: spacing.sm }}>
                        {unknownVars.map((k) => `{${k}}`).join(', ')} não {unknownVars.length > 1 ? 'são variáveis conhecidas e vão' : 'é uma variável conhecida e vai'} sair em branco.
                      </Small>
                    ) : null}

                    <Label style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>Prévia</Label>
                    <View style={{ backgroundColor: '#E7F8EE', borderRadius: radius.md, padding: spacing.md }}>
                      <P>{fillTemplate(draft, sample) || ' '}</P>
                    </View>
                    <Muted style={{ marginTop: 4 }}>Com dados de exemplo. A variável sem valor some da mensagem.</Muted>

                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                      <Button title="Cancelar" variant="secondary" onPress={() => setOpenKey(null)} disabled={saving} style={{ flex: 1 }} />
                      <Button title="Salvar" onPress={() => save(key)} loading={saving} disabled={!isDirty} style={{ flex: 1.4 }} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <Button title="Testar no WhatsApp" icon="logo-whatsapp" variant="ghost" small onPress={() => openWhatsApp('', fillTemplate(draft, sample))} style={{ flex: 1 }} />
                      {(isCustom || draft !== defaultTemplateText(key, lang)) ? (
                        <Button title="Voltar ao padrão" icon="refresh-outline" variant="ghost" small onPress={() => (isCustom ? restore(key) : setDraft(defaultTemplateText(key, lang)))} disabled={saving} style={{ flex: 1 }} />
                      ) : null}
                    </View>
                  </View>
                )}
              </Card>
            )
          })}
        </Section>
      ))}
    </Screen>
  )
}
