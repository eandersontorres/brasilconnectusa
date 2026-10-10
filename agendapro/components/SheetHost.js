// Folha de opções do choose() (lib/dialog.js) no Android e no web. Fica montada
// uma vez no app/_layout.js; no iPhone o choose() usa a folha nativa.
import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { registerSheetHost } from '../lib/dialog'
import { colors, radius, spacing, type } from '../lib/theme'

export default function SheetHost() {
  const [sheet, setSheet] = useState(null)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (Platform.OS === 'ios') return undefined
    return registerSheetHost((s) => setSheet(s))
  }, [])

  if (!sheet) return null
  const done = (value) => { const s = sheet; setSheet(null); s.resolve(value) }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => done(null)}>
      <Pressable style={s.backdrop} onPress={() => done(null)} accessibilityLabel="Fechar" />
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
        {sheet.title ? <Text style={[type.h3, s.title]}>{sheet.title}</Text> : null}
        {sheet.message ? <Text style={[type.muted, s.message]}>{sheet.message}</Text> : null}
        <ScrollView style={{ maxHeight: 420 }}>
          {sheet.options.map((o, i) => (
            <Pressable key={`${i}-${String(o.value)}`} onPress={() => done(o.value)}
              style={({ pressed }) => [s.option, i > 0 && s.border, pressed && { backgroundColor: colors.paperSoft }]}>
              <Text style={[type.body, { fontWeight: '500', color: o.destructive ? colors.danger : colors.ink }]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable onPress={() => done(null)} style={({ pressed }) => [s.cancel, pressed && { opacity: 0.8 }]}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.inkSoft }}>{sheet.cancel || 'Cancelar'}</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,31,28,0.35)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.lg, paddingHorizontal: spacing.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { textAlign: 'center', marginBottom: 4 },
  message: { textAlign: 'center', marginBottom: spacing.sm },
  option: { paddingVertical: 15, alignItems: 'center' },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  cancel: { marginTop: spacing.sm, paddingVertical: 14, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.paperSoft },
})
