// Cadeado de tela inteira: mostra o conteúdo se o plano libera; senão, um convite
// explicando o recurso e o plano que libera.
//   <Locked feature="finance"> …tela… </Locked>
import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '../lib/session'
import { featureInfo, openPlans } from '../lib/gate'
import { EXTERNAL_PURCHASE } from '../lib/config'
import { colors, spacing } from '../lib/theme'
import { Button, Card, H2, Muted, P, Screen } from './ui'

export default function Locked({ feature, children, inline = false }) {
  const app = useApp()
  if (app.can(feature)) return children
  const body = <LockedCard feature={feature} />
  if (inline) return body
  return <Screen>{body}</Screen>
}

export function LockedCard({ feature, style }) {
  const app = useApp()
  const f = featureInfo(app.ent, feature)
  const inactive = app.ent.tier === 'none'
  return (
    <Card style={[{ alignItems: 'center', paddingVertical: spacing.xl }, style]}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="lock-closed" size={24} color={colors.goldDark} />
      </View>
      <H2 style={{ marginTop: spacing.md, textAlign: 'center' }}>{f.label}</H2>
      {f.desc ? <P style={{ textAlign: 'center', marginTop: spacing.sm, color: colors.inkSoft }}>{f.desc}</P> : null}
      <Muted style={{ textAlign: 'center', marginTop: spacing.md }}>
        {inactive ? 'Seu plano não está ativo.' : `Disponível a partir do plano ${f.minName}.`}
      </Muted>
      <Button title={!EXTERNAL_PURCHASE ? 'Ver o que cada plano inclui' : inactive ? 'Ver planos' : `Conhecer o ${f.minName}`} variant="gold" onPress={() => openPlans(feature)} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} />
    </Card>
  )
}
