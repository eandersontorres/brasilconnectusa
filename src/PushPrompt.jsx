// PushPrompt.jsx — Botão flutuante "Receber alertas" + modal de subscribe
//
// Uso: <PushPrompt user={user} />  (importar no App.jsx ou AppShell)
//
// Fluxo:
//  1. Verifica se browser suporta + permissão atual
//  2. Se nunca pediu, mostra botão "🔔 Ativar alertas"
//  3. Clica → solicita permissão → registra Service Worker → subscribe
//  4. Manda subscription pro /api/push/subscribe
//  5. Se ja subscrito, mostra "🔔 Ativo" (clica pra desativar)

import { useEffect, useState } from 'react'

const COLORS = {
  navy: '#002776',
  green: '#009c3b',
  gold: '#ffdf00',
  white: '#ffffff',
  inkSoft: '#374151',
  inkMuted: '#6b7280',
  line: '#e5e7eb',
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function PushPrompt({ user }) {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState('default')   // 'default' | 'granted' | 'denied'
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ok = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
    setSupported(ok)
    if (!ok) return

    setPermission(Notification.permission)

    // Checa se ja tem subscription
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setSubscribed(!!sub)
      })
    }).catch(() => {})
  }, [])

  async function handleSubscribe() {
    setError('')
    setLoading(true)
    try {
      // 1. Pega VAPID key
      const vapidRes = await fetch('/api/push/vapid')
      const vapidData = await vapidRes.json()
      if (!vapidData.configured) throw new Error(vapidData.error || 'Push nao configurado')

      // 2. Pede permissao
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') throw new Error('Permissao negada. Habilita nas configuracoes do browser.')

      // 3. Registra SW se ainda nao
      let reg = await navigator.serviceWorker.getRegistration()
      if (!reg) reg = await navigator.serviceWorker.register('/sw.js')

      // 4. Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.public_key),
      })

      // 5. Manda pro servidor
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id || null,
          subscription: sub.toJSON(),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro ao salvar subscription')

      setSubscribed(true)
      setShowModal(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUnsubscribe() {
    setLoading(true)
    setError('')
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) { setSubscribed(false); return }
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setSubscribed(false)
      setShowModal(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!supported) return null

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        title={subscribed ? 'Notificações ativas' : 'Ativar notificações'}
        style={{
          position: 'fixed',
          bottom: 76,
          right: 16,
          width: 48, height: 48,
          borderRadius: '50%',
          background: subscribed ? COLORS.green : COLORS.white,
          color: subscribed ? COLORS.white : COLORS.navy,
          border: `1px solid ${COLORS.line}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          cursor: 'pointer',
          fontSize: 20,
          zIndex: 90,
        }}
      >
        {subscribed ? '🔔' : '🔕'}
      </button>

      {showModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.6)',
            zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '60px 16px',
          }}
        >
          <div style={{
            background: COLORS.white, borderRadius: 14, padding: 24,
            maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 36, marginBottom: 8, textAlign: 'center' }}>🔔</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: COLORS.navy, textAlign: 'center' }}>
              {subscribed ? 'Notificações ativas' : 'Receber alertas'}
            </h2>
            <p style={{ fontSize: 14, color: COLORS.inkSoft, lineHeight: 1.5, marginBottom: 16, textAlign: 'center' }}>
              {subscribed
                ? 'Você vai receber alertas de pedidos, mensagens, eventos e câmbio importante.'
                : 'Avisamos quando: pedido novo (restaurante), mensagem na comunidade, evento perto de você, câmbio bater taxa alvo, ou bolão tem palpite pendente.'}
            </p>

            {error && (
              <div style={{
                background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b',
                padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12,
              }}>{error}</div>
            )}

            {permission === 'denied' && !subscribed && (
              <div style={{
                background: '#fef3c7', border: '1px solid #fbbf24', color: '#78350f',
                padding: '10px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12, lineHeight: 1.4,
              }}>
                Você bloqueou notificações nesse browser. Habilita pelo cadeado da URL → Notificações → Permitir.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 9, background: 'transparent',
                  color: COLORS.inkMuted, border: `1px solid ${COLORS.line}`,
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                }}
              >Fechar</button>
              {subscribed ? (
                <button
                  onClick={handleUnsubscribe}
                  disabled={loading}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 9,
                    background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
                    fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
                  }}
                >{loading ? '...' : 'Desativar'}</button>
              ) : (
                <button
                  onClick={handleSubscribe}
                  disabled={loading || permission === 'denied'}
                  style={{
                    flex: 2, padding: '11px 0', borderRadius: 9,
                    background: permission === 'denied' ? '#9ca3af' : COLORS.navy,
                    color: COLORS.white, border: 'none',
                    fontSize: 14, fontWeight: 600,
                    cursor: loading || permission === 'denied' ? 'not-allowed' : 'pointer',
                  }}
                >{loading ? 'Ativando...' : 'Ativar alertas'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
