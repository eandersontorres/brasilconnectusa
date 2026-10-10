// Cadastro do perfil de profissional (primeira vez). Cria o ag_providers pelo
// POST /api/agenda/provider e marca o tipo de negócio e o fuso pelo /api/agenda/me.
import { useState } from 'react'
import { View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { post } from '../lib/api'
import { useApp } from '../lib/session'
import { colors, spacing } from '../lib/theme'
import { Button, Chip, ErrorBox, H2, Input, Label, Muted, P, Screen } from '../components/ui'
import { BRAND, SPECIALTY_OPTIONS } from '../lib/variant'

// Especialidades por app (lib/variant.js)
const SPECIALTIES = SPECIALTY_OPTIONS

const deviceTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York' } catch (_) { return 'America/New_York' }
}

export default function Onboarding() {
  const { user, authReady, session, refresh, signOut } = useApp()
  const [name, setName] = useState('')
  const [specialty, setSpecialty] = useState(null)
  const [other, setOther] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Saiu da conta com esta tela aberta: volta pro login
  if (authReady && !session) return <Redirect href="/login" />

  async function save() {
    if (!name.trim()) return setError('Diga o nome que aparece pras clientes.')
    if (!specialty) return setError('Escolha o que você faz.')
    setSaving(true); setError(null)
    try {
      const spec = specialty.label === 'Outro' ? (other.trim() || 'Profissional') : specialty.label
      await post('/api/agenda/provider', {
        name: name.trim(),
        specialty: spec,
        city: city.trim(),
        state: state.trim().toUpperCase().slice(0, 2),
        whatsapp: whatsapp.trim(),
      })
      await post('/api/agenda/me', { action: 'vertical', vertical: specialty.vertical, timezone: deviceTimezone() })
      await refresh()
      router.replace('/hoje')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen>
      <H2>{BRAND.name === 'WorkPro' ? 'Vamos montar seu negócio' : 'Vamos montar sua agenda'}</H2>
      <P style={{ color: colors.inkSoft, marginTop: 6, marginBottom: spacing.xl }}>
        {BRAND.name === 'WorkPro'
          ? 'Leva 1 minuto. Você ganha 14 dias com tudo liberado: orçamentos, faturas, agenda e uma página pra receber pedidos.'
          : 'Leva 1 minuto. Você ganha 14 dias com tudo liberado e uma página pra receber agendamentos.'}
      </P>

      <Input label="Nome do seu negócio ou seu nome" value={name} onChangeText={setName} placeholder="Ex.: Ana Torres Hair" autoCapitalize="words" />

      <Label style={{ marginBottom: spacing.sm }}>O que você faz</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
        {SPECIALTIES.map((s) => (
          <Chip key={s.label} label={s.label} selected={specialty?.label === s.label} onPress={() => setSpecialty(s)} />
        ))}
      </View>
      {specialty?.label === 'Outro' ? <Input label="Qual?" value={other} onChangeText={setOther} placeholder="Ex.: Podóloga" /> : null}
      {specialty?.vertical === 'cleaning' ? (
        <Muted style={{ marginBottom: spacing.lg }}>Vamos ligar as ferramentas de limpeza: casas fixas, equipes e turnover do Airbnb.</Muted>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Input label="Cidade" value={city} onChangeText={setCity} placeholder="Boston" style={{ flex: 2 }} autoCapitalize="words" />
        <Input label="Estado" value={state} onChangeText={setState} placeholder="MA" style={{ flex: 1 }} autoCapitalize="characters" maxLength={2} />
      </View>
      <Input label="WhatsApp" value={whatsapp} onChangeText={setWhatsapp} placeholder="(617) 555-0101" keyboardType="phone-pad"
        hint="Aparece pras clientes falarem com você." />

      <ErrorBox error={error} />
      <Button title={BRAND.name === 'WorkPro' ? 'Começar' : 'Criar minha agenda'} onPress={save} loading={saving} />
      <Muted style={{ textAlign: 'center', marginTop: spacing.lg }}>Conectado como {user?.email}</Muted>
      <Button title="Usar outra conta" variant="ghost" onPress={async () => { await signOut(); router.replace('/login') }} />
    </Screen>
  )
}
