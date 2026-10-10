// Alertas que funcionam no celular (Alert) e no preview web (window.confirm).
// O Alert do react-native-web não faz nada, por isso o desvio.
//
// choose(): no iPhone usa a folha nativa (ActionSheetIOS); no Android e no web
// usa a folha do components/SheetHost.js (o Alert do Android mostra só 3 botões).
import { ActionSheetIOS, Alert, Platform } from 'react-native'

const isWeb = Platform.OS === 'web'

export function notify(title, message) {
  if (isWeb) { window.alert([title, message].filter(Boolean).join('\n\n')); return }
  Alert.alert(title, message)
}

/** Promise<boolean>. */
export function confirm(title, message, { ok = 'OK', cancel = 'Cancelar', destructive = false } = {}) {
  if (isWeb) return Promise.resolve(window.confirm([title, message].filter(Boolean).join('\n\n')))
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  })
}

// ── Folha de opções ────────────────────────────────────────────────────────
let sheetHost = null
/** Usado só pelo components/SheetHost.js. */
export function registerSheetHost(fn) {
  sheetHost = fn
  return () => { if (sheetHost === fn) sheetHost = null }
}

/**
 * Escolha entre opções. Promise<value|null>.
 *   const m = await choose('Forma de pagamento', [{ label: 'Zelle', value: 'zelle' }, ...])
 *   opção com { destructive: true } aparece em vermelho
 */
export function choose(title, options, { message, cancel = 'Cancelar' } = {}) {
  if (!options?.length) return Promise.resolve(null)

  if (Platform.OS === 'ios') {
    return new Promise((resolve) => {
      const destructive = options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0)
      ActionSheetIOS.showActionSheetWithOptions({
        title,
        message,
        options: [...options.map((o) => o.label), cancel],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: destructive.length ? destructive : undefined,
      }, (i) => resolve(i < options.length ? options[i].value : null))
    })
  }

  if (sheetHost) return new Promise((resolve) => sheetHost({ title, message, options, cancel, resolve }))

  // Sem a folha montada (não deveria acontecer): Alert no Android, prompt no web
  if (isWeb) {
    const list = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
    const ans = window.prompt(`${title}${message ? '\n' + message : ''}\n\n${list}\n\nDigite o número:`)
    const i = Number(ans) - 1
    return Promise.resolve(options[i] ? options[i].value : null)
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      ...options.slice(0, 2).map((o) => ({ text: o.label, style: o.destructive ? 'destructive' : 'default', onPress: () => resolve(o.value) })),
      { text: cancel, style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) })
  })
}
