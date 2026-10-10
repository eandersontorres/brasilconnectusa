// ════════════════════════════════════════════════════════════════════════════
//   Componentes base do AgendaPro. Toda tela usa estes, pra manter o visual igual.
//
//   <Screen onRefresh={load} refreshing={loading}> … </Screen>
//   <Card onPress?> · <Section title right?> · <Row title subtitle right onPress chevron />
//   <Button title onPress variant="primary|secondary|ghost|danger|gold" loading small icon />
//   <Input label value onChangeText hint error multiline keyboardType secure />
//   <Badge text tone="green|gold|gray|red|navy|orange" /> · <StatusBadge status />
//   <Empty icon title text action /> · <Loading /> · <ErrorBox error onRetry />
//   <Segmented options={[{value,label}]} value onChange /> · <Chip label selected onPress />
//   <KPI label value sub /> · <ToggleRow title subtitle value onValueChange /> · <Divider />
//   <Avatar name uri size /> · <H1>/<H2>/<H3>/<P>/<Muted>/<Label>
// ════════════════════════════════════════════════════════════════════════════
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, shadow, spacing, statusStyle, type } from '../lib/theme'
import { initials } from '../lib/format'

// ── Texto ────────────────────────────────────────────────────────────────
export const H1 = ({ style, ...p }) => <Text style={[type.h1, style]} {...p} />
export const H2 = ({ style, ...p }) => <Text style={[type.h2, style]} {...p} />
export const H3 = ({ style, ...p }) => <Text style={[type.h3, style]} {...p} />
export const P = ({ style, ...p }) => <Text style={[type.body, style]} {...p} />
export const Small = ({ style, ...p }) => <Text style={[type.small, style]} {...p} />
export const Muted = ({ style, ...p }) => <Text style={[type.muted, style]} {...p} />
export const Label = ({ style, ...p }) => <Text style={[type.label, style]} {...p} />

// ── Estrutura ────────────────────────────────────────────────────────────
/**
 * Tela com fundo creme, rolagem e "puxar pra atualizar".
 * `edges` padrão sem 'top' porque o cabeçalho nativo já ocupa o topo.
 */
export function Screen({ children, scroll = true, padded = true, refreshing = false, onRefresh, edges = ['bottom', 'left', 'right'], style, contentStyle, footer }) {
  const inner = padded ? { padding: spacing.lg, paddingBottom: spacing.xxl * 2 } : null
  return (
    <SafeAreaView edges={edges} style={[s.screen, style]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.green} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  )
}

export function Card({ children, style, onPress, padded = true }) {
  const body = <View style={[s.card, padded && { padding: spacing.lg }, style]}>{children}</View>
  if (!onPress) return body
  return <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>{body}</Pressable>
}

export function Section({ title, right, children, style }) {
  return (
    <View style={[{ marginTop: spacing.xl }, style]}>
      {(title || right) ? (
        <View style={s.sectionHead}>
          {title ? <Label>{title}</Label> : <View />}
          {right || null}
        </View>
      ) : null}
      {children}
    </View>
  )
}

export const Divider = ({ style }) => <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: spacing.md }, style]} />

export function Row({ title, subtitle, left, right, onPress, chevron, icon, iconColor, style, danger, numberOfLines = 1 }) {
  const content = (
    <View style={[s.row, style]}>
      {icon ? (
        <View style={[s.rowIcon, danger && { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name={icon} size={18} color={danger ? colors.danger : (iconColor || colors.green)} />
        </View>
      ) : null}
      {left || null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? <Text style={[type.body, { fontWeight: '500' }, danger && { color: colors.danger }]} numberOfLines={numberOfLines}>{title}</Text> : title}
        {subtitle ? (typeof subtitle === 'string' ? <Muted numberOfLines={2}>{subtitle}</Muted> : subtitle) : null}
      </View>
      {right != null ? (typeof right === 'string' ? <Small style={{ color: colors.inkSoft }}>{right}</Small> : right) : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
    </View>
  )
  if (!onPress) return content
  return <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: colors.paperSoft }}>{content}</Pressable>
}

// ── Ações ────────────────────────────────────────────────────────────────
const BTN = {
  primary:   { bg: colors.green, fg: colors.white, border: colors.green },
  secondary: { bg: colors.white, fg: colors.ink, border: colors.line },
  ghost:     { bg: 'transparent', fg: colors.green, border: 'transparent' },
  danger:    { bg: colors.white, fg: colors.danger, border: '#F3C7C2' },
  gold:      { bg: colors.gold, fg: colors.white, border: colors.gold },
  whatsapp:  { bg: '#25D366', fg: colors.white, border: '#25D366' },
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, small, icon, style, full = true }) {
  const v = BTN[variant] || BTN.primary
  const off = disabled || loading
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        !full && { alignSelf: 'flex-start' },
        { backgroundColor: v.bg, borderColor: v.border },
        off && { opacity: 0.5 },
        pressed && !off && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={v.fg} /> : null}
          <Text style={{ color: v.fg, fontSize: small ? 14 : 16, fontWeight: '600' }}>{title}</Text>
        </View>
      )}
    </Pressable>
  )
}

/** Botão redondo pequeno só com ícone (barra de ações do card). */
export function IconButton({ icon, onPress, color = colors.green, bg = colors.greenSoft, label, size = 40 }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} accessibilityRole="button"
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={size * 0.48} color={color} />
    </Pressable>
  )
}

/** Botão flutuante (+) no canto da tela. */
export function Fab({ icon = 'add', onPress, label }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label || 'Adicionar'} accessibilityRole="button"
      style={({ pressed }) => [s.fab, pressed && { opacity: 0.85 }]}>
      <Ionicons name={icon} size={28} color={colors.white} />
    </Pressable>
  )
}

// ── Formulário ───────────────────────────────────────────────────────────
export function Input({ label, hint, error, style, inputStyle, multiline, secure, right, ...p }) {
  return (
    <View style={[{ marginBottom: spacing.lg }, style]}>
      {label ? <Text style={s.inputLabel}>{label}</Text> : null}
      <View style={[s.inputWrap, error && { borderColor: colors.danger }, multiline && { alignItems: 'flex-start' }]}>
        <TextInput
          placeholderTextColor={colors.inkMuted}
          style={[s.input, multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }, inputStyle]}
          multiline={multiline}
          secureTextEntry={secure}
          {...p}
        />
        {right || null}
      </View>
      {error ? <Text style={[type.muted, { color: colors.danger, marginTop: 4 }]}>{error}</Text>
        : hint ? <Muted style={{ marginTop: 4 }}>{hint}</Muted> : null}
    </View>
  )
}

export function ToggleRow({ title, subtitle, value, onValueChange, disabled }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: '500' }]}>{title}</Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      <Switch value={!!value} onValueChange={onValueChange} disabled={disabled}
        trackColor={{ true: colors.green, false: colors.line }} thumbColor={colors.white} />
    </View>
  )
}

export function Segmented({ options, value, onChange, style }) {
  return (
    <View style={[s.seg, style]}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[s.segItem, on && s.segOn]}>
            <Text style={{ fontSize: 14, fontWeight: on ? '600' : '500', color: on ? colors.ink : colors.inkSoft }}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Chip({ label, selected, onPress, icon, style }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && { backgroundColor: colors.green, borderColor: colors.green }, style]}>
      {icon ? <Ionicons name={icon} size={14} color={selected ? colors.white : colors.inkSoft} style={{ marginRight: 4 }} /> : null}
      <Text style={{ fontSize: 14, fontWeight: '500', color: selected ? colors.white : colors.inkSoft }}>{label}</Text>
    </Pressable>
  )
}

// ── Indicadores ──────────────────────────────────────────────────────────
const TONES = {
  green:  [colors.green, colors.greenSoft],
  gold:   [colors.goldDark, colors.goldSoft],
  gray:   [colors.inkSoft, colors.paperSoft],
  red:    [colors.danger, colors.dangerSoft],
  navy:   [colors.navy, colors.navySoft],
  orange: [colors.warning, colors.warningSoft],
  blue:   [colors.info, colors.infoSoft],
}

export function Badge({ text, tone = 'gray', icon, style }) {
  const [fg, bg] = TONES[tone] || TONES.gray
  return (
    <View style={[s.badge, { backgroundColor: bg }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} style={{ marginRight: 4 }} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  )
}

export function StatusBadge({ status }) {
  const st = statusStyle[status] || statusStyle.pending
  return (
    <View style={[s.badge, { backgroundColor: st.bg }]}>
      <Text style={{ color: st.fg, fontSize: 12, fontWeight: '600' }}>{st.label}</Text>
    </View>
  )
}

export function KPI({ label, value, sub, tone, style, onPress }) {
  // Fonte pelo tamanho do número: o encolher automático (adjustsFontSizeToFit) não existe no web
  const len = String(value ?? '').length
  const size = len > 8 ? 16 : len > 6 ? 19 : len > 4 ? 21 : type.kpi.fontSize
  const inner = (
    <View style={[s.card, { padding: spacing.md, flex: 1 }, style]}>
      <Label style={{ marginBottom: 6 }} numberOfLines={1}>{label}</Label>
      <Text style={[type.kpi, { fontSize: size }, tone === 'green' && { color: colors.green }, tone === 'gold' && { color: colors.goldDark }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
      {sub ? <Muted style={{ marginTop: 2 }} numberOfLines={2}>{sub}</Muted> : null}
    </View>
  )
  if (!onPress) return inner
  return <Pressable onPress={onPress} style={{ flex: 1 }}>{inner}</Pressable>
}

export function Avatar({ name, uri, size = 40, color = colors.green }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.paperSoft }} />
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  )
}

export function Empty({ icon = 'calendar-outline', title, text, action, style }) {
  return (
    <View style={[s.empty, style]}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={28} color={colors.green} /></View>
      {title ? <H3 style={{ textAlign: 'center', marginTop: spacing.md }}>{title}</H3> : null}
      {text ? <Muted style={{ textAlign: 'center', marginTop: 6, maxWidth: 300 }}>{text}</Muted> : null}
      {action ? <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  )
}

export function Loading({ text, style }) {
  return (
    <View style={[{ padding: spacing.xxl, alignItems: 'center' }, style]}>
      <ActivityIndicator color={colors.green} />
      {text ? <Muted style={{ marginTop: spacing.sm }}>{text}</Muted> : null}
    </View>
  )
}

export function ErrorBox({ error, onRetry, style }) {
  if (!error) return null
  const msg = typeof error === 'string' ? error : error.message
  return (
    <View style={[s.errorBox, style]}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <Text style={{ flex: 1, color: colors.danger, fontSize: 14 }}>{msg}</Text>
      {onRetry ? <Pressable onPress={onRetry}><Text style={{ color: colors.danger, fontWeight: '600' }}>Tentar de novo</Text></Pressable> : null}
    </View>
  )
}

/** Faixa de aviso (teste grátis acabando, pagamento pendente, modo offline). */
export function Banner({ text, tone = 'gold', icon = 'information-circle-outline', action, onPress }) {
  const [fg, bg] = TONES[tone] || TONES.gold
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[s.banner, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={{ flex: 1, color: fg, fontSize: 14, fontWeight: '500' }}>{text}</Text>
      {action ? <Text style={{ color: fg, fontWeight: '700', fontSize: 14 }}>{action}</Text> : null}
    </Pressable>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  footer: { padding: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.paper },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...shadow },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, paddingHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  btn: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnSmall: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.xl, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 4 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  input: { flex: 1, minHeight: 48, paddingHorizontal: spacing.md, fontSize: 16, color: colors.ink },
  seg: { flexDirection: 'row', backgroundColor: colors.paperSoft, borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: radius.sm },
  segOn: { backgroundColor: colors.white, ...shadow },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, marginRight: 8, marginBottom: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  empty: { alignItems: 'center', padding: spacing.xl },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
})
