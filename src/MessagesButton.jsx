import { useState, useEffect, useCallback } from 'react'
import { C } from './lib/colors'
import { apiFetch } from './lib/apiFetch'

// Botão de mensagens da barra do topo, com o total de não lidas.
// Navega pela mesma via dos outros atalhos (evento bc-navigate, ouvido no App).
export default function MessagesButton({ user }) {
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    if (!user?.id || document.hidden) return
    try {
      const r = await apiFetch('/api/messages?action=unread')
      if (!r.ok) return
      const d = await r.json()
      setUnread(d.unread || 0)
    } catch (_) {}
  }, [user?.id])

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    window.addEventListener('bc-dm-read', load)
    return () => { clearInterval(t); window.removeEventListener('bc-dm-read', load) }
  }, [load])

  if (!user) return null

  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('bc-navigate', { detail: { tab: 'mensagens' } }))}
      title="Mensagens" aria-label={unread > 0 ? `Mensagens, ${unread} não lidas` : 'Mensagens'}
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', position: 'relative', color: C.ink, display: 'flex' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: 2, right: 2, background: C.green, color: '#fff',
          fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center',
        }}>{unread > 99 ? '99+' : unread}</span>
      )}
    </button>
  )
}
