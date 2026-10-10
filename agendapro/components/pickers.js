// Campos de data e hora. No celular abrem o seletor nativo; no preview web viram
// campo de texto (o seletor nativo não existe no navegador).
//   <DateField label="Dia" value="2026-10-14" onChange={setDay} />
//   <TimeField label="Hora" value="10:30" onChange={setTime} minuteInterval={15} />
// Valores sempre em texto: data 'YYYY-MM-DD', hora 'HH:MM' (hora de parede).
import { useState } from 'react'
import { Modal, Platform, Pressable, Text, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, spacing, type } from '../lib/theme'
import { dateKey, fmtDay } from '../lib/format'
import { Button, Input } from './ui'

const pad = (n) => String(n).padStart(2, '0')

function keyToDate(key) {
  const [y, m, d] = String(key || '').split('-').map(Number)
  return y ? new Date(y, m - 1, d, 12, 0, 0) : new Date()
}
function hhmmToDate(v) {
  const [h, m] = String(v || '09:00').split(':').map(Number)
  const d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d
}

function Field({ label, text, icon, onPress, placeholder }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? <Text style={{ fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginBottom: 6 }}>{label}</Text> : null}
      <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.white, paddingHorizontal: spacing.md, gap: 8 }}>
        <Ionicons name={icon} size={18} color={colors.green} />
        <Text style={[type.body, !text && { color: colors.inkMuted }]}>{text || placeholder}</Text>
      </Pressable>
    </View>
  )
}

function IosSheet({ visible, onClose, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }} onPress={onClose} />
      <View style={{ backgroundColor: colors.white, padding: spacing.lg, paddingBottom: spacing.xxl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }}>
        {children}
        <Button title="Pronto" onPress={onClose} />
      </View>
    </Modal>
  )
}

export function DateField({ label, value, onChange, minimumDate, maximumDate, placeholder = 'Escolher dia' }) {
  const [open, setOpen] = useState(false)
  if (Platform.OS === 'web') {
    return <Input label={label} value={value || ''} onChangeText={onChange} placeholder="AAAA-MM-DD" autoCapitalize="none" />
  }
  const picker = (
    <DateTimePicker
      value={keyToDate(value)}
      mode="date"
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      minimumDate={minimumDate}
      maximumDate={maximumDate}
      locale="pt-BR"
      accentColor={colors.green}
      onChange={(ev, d) => {
        if (Platform.OS === 'android') setOpen(false)
        if (ev.type === 'dismissed' || !d) return
        onChange(dateKey(d))
      }}
    />
  )
  return (
    <>
      <Field label={label} icon="calendar-outline" text={value ? fmtDay(value) : ''} placeholder={placeholder} onPress={() => setOpen(true)} />
      {open && Platform.OS === 'android' ? picker : null}
      {Platform.OS === 'ios' ? <IosSheet visible={open} onClose={() => setOpen(false)}>{picker}</IosSheet> : null}
    </>
  )
}

export function TimeField({ label, value, onChange, minuteInterval = 5, placeholder = 'Escolher hora' }) {
  const [open, setOpen] = useState(false)
  if (Platform.OS === 'web') {
    return <Input label={label} value={value || ''} onChangeText={onChange} placeholder="HH:MM" autoCapitalize="none" />
  }
  const picker = (
    <DateTimePicker
      value={hhmmToDate(value)}
      mode="time"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      minuteInterval={minuteInterval}
      is24Hour
      locale="pt-BR"
      onChange={(ev, d) => {
        if (Platform.OS === 'android') setOpen(false)
        if (ev.type === 'dismissed' || !d) return
        onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
      }}
    />
  )
  return (
    <>
      <Field label={label} icon="time-outline" text={value || ''} placeholder={placeholder} onPress={() => setOpen(true)} />
      {open && Platform.OS === 'android' ? picker : null}
      {Platform.OS === 'ios' ? <IosSheet visible={open} onClose={() => setOpen(false)}>{picker}</IosSheet> : null}
    </>
  )
}
