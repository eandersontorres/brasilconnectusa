/**
 * Inicializa PWA: registra SW, oferece install prompt, push subscribe.
 */
export function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW reg failed', e))
    })
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    window.__bcInstallEvent = e
  })
}

export async function subscribeToPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.ready
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return null

  const vapid = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_VAPID_PUBLIC_KEY) || ''
  if (!vapid) { console.warn('VITE_VAPID_PUBLIC_KEY ausente'); return null }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapid)
  })
  await fetch('/api/push/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, subscription: sub.toJSON() })
  })
  return sub
}

export async function showInstallPrompt() {
  if (!window.__bcInstallEvent) return false
  await window.__bcInstallEvent.prompt()
  const { outcome } = await window.__bcInstallEvent.userChoice
  return outcome === 'accepted'
}

function urlB64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)))
}
