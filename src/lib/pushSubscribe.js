/**
 * Helper compartilhado pra fazer subscribe de push em momentos contextuais
 * (após criar bolão, criar alerta de câmbio etc), sem abrir o modal
 * completo do PushPrompt.
 *
 * Uso:
 *   const result = await subscribePushTopic('bolao', userId)
 *   if (result.ok) toast('Show!')
 *   else if (result.error) toast(result.error)
 */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
}

/**
 * Inscreve o navegador no push (cria subscription) e envia pro backend
 * com o tópico solicitado. Se já estava inscrito, só adiciona o tópico
 * à lista existente via PATCH.
 *
 * @returns {Promise<{ok: boolean, alreadySubscribed?: boolean, error?: string, denied?: boolean}>}
 */
export async function subscribePushTopic(topic, userId = null) {
  if (!pushSupported()) return { ok: false, error: 'Navegador não suporta notificações push' }

  try {
    // 1) VAPID key do servidor
    const vapidRes = await fetch('/api/push/vapid')
    const vapidData = await vapidRes.json()
    if (!vapidData.configured) return { ok: false, error: 'Push não configurado no servidor' }

    // 2) Service worker
    let reg = await navigator.serviceWorker.getRegistration()
    if (!reg) reg = await navigator.serviceWorker.register('/sw.js')

    // 3) Já tem subscription? Adiciona o tópico via PATCH
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      try {
        const r = await fetch('/api/push/subscribe?endpoint=' + encodeURIComponent(existing.endpoint))
        const d = await r.json()
        const currentTopics = d.subscription?.topics || []
        if (currentTopics.includes(topic)) return { ok: true, alreadySubscribed: true }
        const newTopics = [...currentTopics, topic]
        const patchRes = await fetch('/api/push/subscribe', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint, topics: newTopics }),
        })
        if (!patchRes.ok) return { ok: false, error: 'Erro ao adicionar tópico' }
        return { ok: true, alreadySubscribed: true }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    }

    // 4) Pede permissão (precisa ser dentro de gesto do usuário — call site garante isso)
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      return { ok: false, denied: true, error: perm === 'denied' ? 'Você negou permissão. Habilita nas configs do navegador.' : 'Permissão não concedida' }
    }

    // 5) Subscribe novo
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidData.public_key),
    })

    // 6) Salva no backend
    const saveRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId || null,
        subscription: sub.toJSON(),
        topics: [topic],
      }),
    })
    const saveData = await saveRes.json()
    if (!saveRes.ok) return { ok: false, error: saveData.error || 'Erro ao salvar subscription' }

    return { ok: true }
  } catch (e) {
    console.error('[pushSubscribe]', e.message)
    return { ok: false, error: e.message }
  }
}
