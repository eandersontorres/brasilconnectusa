import { useState, useEffect } from 'react'
import { subscribePushTopic, pushSupported } from './lib/pushSubscribe'

/**
 * Banner sutil pra pedir push em momento contextual (logo após criar bolão,
 * criar alerta de câmbio, etc). Esconde sozinho se:
 *   - Navegador não suporta push
 *   - Permission já foi negada antes
 *   - Usuário já tem push ativo pro tópico (oculta após 2s mostrando "✓ Já ativado")
 *
 * Props:
 *   - topic: string — id do tópico (ex: 'bolao', 'cambio')
 *   - title: string — pergunta principal (ex: "Receber lembrete dos palpites?")
 *   - description?: string — explicação curta
 *   - userId?: string
 *   - onDismiss?: function — chamado quando usuário fecha
 */
export default function PushOptInBanner({ topic, title, description, userId, onDismiss }) {
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!pushSupported()) return
    if (Notification.permission === 'denied') return
    setVisible(true)
  }, [])

  if (!visible) return null

  async function handleAccept() {
    setLoading(true)
    setError('')
    const r = await subscribePushTopic(topic, userId)
    setLoading(false)
    if (r.ok) {
      setDone(true)
      setTimeout(() => { setVisible(false); onDismiss?.() }, 2200)
    } else if (r.denied) {
      setVisible(false)
      onDismiss?.()
    } else {
      setError(r.error || 'Erro ao ativar push')
    }
  }

  function handleDecline() {
    setVisible(false)
    onDismiss?.()
  }

  if (done) {
    return (
      <div style={{
        background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 12,
        padding: '12px 14px', fontSize: 13, color: '#166534', textAlign: 'center', fontWeight: 600,
      }}>
        ✓ Notificações ativadas. Vamos te avisar.
      </div>
    )
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #BFDBFE', borderRadius: 12,
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>🔔</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1E40AF', marginBottom: 2 }}>{title}</div>
        {description && (
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{description}</div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: '#991B1B', marginTop: 4 }}>{error}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={handleDecline}
          disabled={loading}
          style={{
            background: 'transparent', border: 'none', color: '#9ca3af',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '8px 6px',
          }}
        >
          Agora não
        </button>
        <button
          onClick={handleAccept}
          disabled={loading}
          style={{
            background: '#1E40AF', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Ativando…' : 'Sim'}
        </button>
      </div>
    </div>
  )
}
