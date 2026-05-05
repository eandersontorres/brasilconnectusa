// NotificationBell.jsx — Sino com badge + lista dropdown
// Fetcha /api/notifications a cada 60s e quando user clica no sino.
import { useEffect, useState } from 'react'

const C = { navy: '#002776', green: '#009c3b', white: '#fff', line: '#e5e7eb', ink: '#0b1928', inkSoft: '#374151', inkMuted: '#6b7280', red: '#dc2626' }

function timeAgo(d) {
  if (!d) return ''
  const ms = Date.now() - new Date(d).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

export default function NotificationBell({ user }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)

  async function fetchNotifs() {
    if (!user?.id && !user?.email) return
    try {
      const param = user.id ? 'user_id=' + user.id : 'email=' + encodeURIComponent(user.email)
      const r = await fetch('/api/notifications?' + param + '&limit=20')
      const d = await r.json()
      if (d.success) {
        setItems(d.notifications || [])
        setUnread(d.unread || 0)
      }
    } catch (_) {}
  }

  useEffect(() => {
    if (!user) return
    fetchNotifs()
    const id = setInterval(fetchNotifs, 60_000)
    return () => clearInterval(id)
  }, [user?.id, user?.email])

  async function markAllRead() {
    if (!user?.id && !user?.email) return
    try {
      await fetch('/api/notifications?action=mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, email: user.email, all: true }),
      })
      setUnread(0)
      setItems(items.map(i => ({ ...i, read_at: i.read_at || new Date().toISOString() })))
    } catch (_) {}
  }

  function handleClick(notif) {
    // Marca lido + navega
    fetch('/api/notifications?action=mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user?.id, email: user?.email, ids: [notif.id] }),
    }).catch(() => {})
    if (notif.url) window.location.href = notif.url
  }

  if (!user) return null

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 8, borderRadius: '50%', position: 'relative', fontSize: 20,
        }}
        title="Notificações"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            background: C.red, color: C.white,
            fontSize: 9, fontWeight: 700,
            padding: '2px 5px', borderRadius: 10,
            minWidth: 16, textAlign: 'center',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 340, maxWidth: 'calc(100vw - 32px)',
            background: C.white, border: `1px solid ${C.line}`,
            borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            zIndex: 90, overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 14, color: C.navy }}>Notificações</strong>
              {unread > 0 && (
                <button onClick={markAllRead} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.inkMuted, textDecoration: 'underline' }}>Marcar todas lidas</button>
              )}
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {items.length === 0 ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: C.inkMuted, fontSize: 13 }}>
                  📭 Nenhuma notificação ainda
                </div>
              ) : items.map(n => (
                <div key={n.id} onClick={() => handleClick(n)} style={{
                  padding: '12px 14px', borderBottom: `1px solid ${C.line}`,
                  cursor: 'pointer', display: 'flex', gap: 10,
                  background: n.read_at ? C.white : '#f0fdf4',
                }}>
                  <div style={{ fontSize: 22 }}>{n.icon || '🔔'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: n.read_at ? 500 : 700, color: C.ink, marginBottom: 2 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4 }}>{n.body.length > 80 ? n.body.slice(0, 80) + '...' : n.body}</div>}
                    <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 4 }}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
