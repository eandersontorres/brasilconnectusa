import { useState, useEffect, useCallback, useRef } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { apiFetch } from './lib/apiFetch'
import { requireOnboarding } from './lib/onboardingGate'

// ════════════════════════════════════════════════════════════════════════════
//   MessagesScreen — mensagens diretas
//
//   /app/mensagens              → lista de conversas
//   /app/mensagens/<threadId>   → conversa
//   /app/mensagens/u-<userId>   → conversa nova com essa pessoa (ainda sem mensagens)
//
//   Regras (api/messages.js): só inicia conversa quem divide uma comunidade;
//   bloqueio dos dois lados; denúncia vai pra fila de moderação.
// ════════════════════════════════════════════════════════════════════════════

function when(iso) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function peerName(p) {
  if (!p) return 'Membro'
  return p.username ? '@' + p.username : (p.display_name || 'Membro')
}

function Avatar({ p, size = 36 }) {
  const initial = ((p && (p.display_name || p.username)) || '?').charAt(0).toUpperCase()
  if (p && p.avatar_url) return <img src={p.avatar_url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: (p && p.avatar_color) || C.green, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
    }}>{initial}</span>
  )
}

export default function MessagesScreen({ slug, onNavigate }) {
  if (!slug) return <ThreadList onNavigate={onNavigate} />
  return <Conversation key={slug} slug={slug} onNavigate={onNavigate} />
}

// ────────────────────────────────────────────────────────────────────────────
//   Lista de conversas
// ────────────────────────────────────────────────────────────────────────────
function ThreadList({ onNavigate }) {
  const [threads, setThreads] = useState(null)
  const [error, setError] = useState(null)
  const [handle, setHandle] = useState('')
  const [finding, setFinding] = useState(false)
  const [findMsg, setFindMsg] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/messages?action=threads')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não deu pra carregar as conversas.')
      setThreads(d.threads || [])
    } catch (e) { setError(e.message); setThreads([]) }
  }, [])
  useEffect(() => { load() }, [load])

  async function start(e) {
    e.preventDefault()
    const u = handle.trim().replace(/^@/, '')
    if (!u || finding) return
    setFinding(true); setFindMsg(null)
    try {
      const r = await apiFetch('/api/messages?action=peer&username=' + encodeURIComponent(u))
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não encontramos essa pessoa.')
      if (d.thread_id) return onNavigate('mensagens', d.thread_id)
      if (!d.allowed) throw new Error(d.reason || 'Não dá pra escrever pra essa pessoa.')
      onNavigate('mensagens', 'u-' + d.peer.user_id)
    } catch (err) { setFindMsg(err.message) }
    finally { setFinding(false) }
  }

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 24px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>Mensagens</div>
      <h1 style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.01em' }}>Conversas</h1>
      <p style={{ fontSize: 14, color: C.inkMuted, lineHeight: 1.6, margin: '0 0 16px', maxWidth: 580 }}>
        Converse em particular com quem participa das mesmas comunidades que você.
      </p>

      <form onSubmit={start} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@usuario"
          aria-label="Nome de usuário pra iniciar conversa"
          style={{ flex: 1, minWidth: 180, padding: '10px 12px', border: '1px solid ' + C.line, borderRadius: 8, fontFamily: FONT.sans, fontSize: 14 }} />
        <button type="submit" disabled={finding || !handle.trim()} style={{
          fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 8, border: 'none',
          background: C.green, color: '#fff', cursor: 'pointer', opacity: finding || !handle.trim() ? 0.6 : 1,
        }}>{finding ? 'Procurando…' : 'Nova conversa'}</button>
      </form>
      {findMsg && <div style={{ fontSize: 13, color: '#991B1B', marginBottom: 10 }}>{findMsg}</div>}

      {error && <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: 8, fontSize: 13, margin: '12px 0' }}>{error}</div>}

      <div style={{ marginTop: 14 }}>
        {threads === null ? (
          <div style={{ textAlign: 'center', padding: 32, color: C.inkMuted }}>Carregando…</div>
        ) : threads.length === 0 ? (
          <div style={{ background: C.white, border: '1px dashed ' + C.line, borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Nenhuma conversa ainda</div>
            <div style={{ fontSize: 12, color: C.inkMuted }}>Digite o @usuario de alguém acima, ou toque em “Mensagem” num comentário.</div>
          </div>
        ) : threads.map(t => (
          <button key={t.id} onClick={() => onNavigate('mensagens', t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer',
            background: C.white, border: '1px solid ' + C.line, borderRadius: 12, padding: '12px 14px', marginBottom: 8, fontFamily: FONT.sans,
          }}>
            <Avatar p={t.peer} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: t.unread ? 700 : 600, color: C.ink }}>{peerName(t.peer)}</span>
                <span style={{ fontSize: 11, color: C.inkMuted, flexShrink: 0 }}>{when(t.last_message_at)}</span>
              </span>
              <span style={{ display: 'block', fontSize: 13, color: t.unread ? C.ink : C.inkMuted, fontWeight: t.unread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.last_from_me ? 'Você: ' : ''}{t.last_message_preview}
              </span>
            </span>
            {t.unread > 0 && (
              <span style={{ background: C.green, color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 7px', flexShrink: 0 }}>{t.unread}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Conversa
// ────────────────────────────────────────────────────────────────────────────
function Conversation({ slug, onNavigate }) {
  const { user } = useAuth()
  const isNew = slug.startsWith('u-')
  const [threadId, setThreadId] = useState(isNew ? null : slug)
  const [peer, setPeer] = useState(null)
  const [blocks, setBlocks] = useState({ blocked_by_me: false, blocked_me: false })
  const [notice, setNotice] = useState(null)       // motivo de não poder escrever
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [menu, setMenu] = useState(false)
  const endRef = useRef(null)

  const load = useCallback(async (quiet) => {
    try {
      if (!threadId) {
        const r = await apiFetch('/api/messages?action=peer&user_id=' + encodeURIComponent(slug.slice(2)))
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Não deu pra abrir a conversa.')
        if (d.thread_id) { setThreadId(d.thread_id); return }
        setPeer(d.peer)
        setBlocks({ blocked_by_me: d.blocked_by_me, blocked_me: d.blocked_me })
        setNotice(d.allowed ? null : d.reason)
      } else {
        const r = await apiFetch('/api/messages?action=thread&id=' + encodeURIComponent(threadId))
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Não deu pra abrir a conversa.')
        setPeer(d.thread.peer)
        setBlocks({ blocked_by_me: d.thread.blocked_by_me, blocked_me: d.thread.blocked_me })
        setMessages(d.messages || [])
        window.dispatchEvent(new CustomEvent('bc-dm-read'))
      }
      setError(null)
    } catch (e) { if (!quiet) setError(e.message) }
    finally { setLoading(false) }
  }, [threadId, slug])

  useEffect(() => { load() }, [load])

  // Atualiza a conversa aberta a cada 15s (só com a aba visível)
  useEffect(() => {
    if (!threadId) return
    const t = setInterval(() => { if (!document.hidden) load(true) }, 15000)
    return () => clearInterval(t)
  }, [threadId, load])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  async function send(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text || sending) return
    if (!(await requireOnboarding(user))) return
    setSending(true)
    try {
      const r = await apiFetch('/api/messages?action=send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(threadId ? { thread_id: threadId, body: text } : { to_user_id: slug.slice(2), body: text }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Não deu pra enviar.')
      setBody('')
      setMessages(prev => [...prev, d.message])
      if (!threadId) {
        setThreadId(d.thread_id)
        try { window.history.replaceState({ tab: 'mensagens', slug: d.thread_id }, '', '/app/mensagens/' + d.thread_id) } catch (_) {}
      }
    } catch (err) { alert(err.message) }
    finally { setSending(false) }
  }

  async function toggleBlock() {
    setMenu(false)
    if (!peer) return
    const blocking = !blocks.blocked_by_me
    if (blocking && !confirm('Bloquear ' + peerName(peer) + '? Vocês não vão mais conseguir trocar mensagens.')) return
    const r = await apiFetch('/api/messages?action=' + (blocking ? 'block' : 'unblock'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: peer.user_id }),
    })
    if (r.ok) setBlocks(b => ({ ...b, blocked_by_me: blocking }))
  }

  async function report(m) {
    if (!confirm('Denunciar essa mensagem pra moderação? A equipe vai ler o trecho denunciado.')) return
    const r = await apiFetch('/api/social?action=report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'dm_message', target_id: m.id, reason: 'harassment', details: String(m.body).slice(0, 500) }),
    })
    alert(r.ok ? 'Denúncia enviada. Obrigado por avisar.' : 'Não deu pra enviar a denúncia.')
  }

  const cantWrite = blocks.blocked_by_me ? 'Você bloqueou essa pessoa.'
    : blocks.blocked_me ? 'Essa pessoa não está recebendo mensagens.'
    : notice

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, position: 'relative' }}>
        <button onClick={() => onNavigate('mensagens')} style={linkBtn}>← Conversas</button>
        <div style={{ flex: 1 }} />
        {peer && (
          <button onClick={() => setMenu(v => !v)} aria-label="Opções da conversa" style={{ ...linkBtn, fontSize: 20, lineHeight: 1, padding: '0 6px' }}>⋯</button>
        )}
        {menu && (
          <div style={{ position: 'absolute', right: 0, top: 26, background: C.white, border: '1px solid ' + C.line, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 20, minWidth: 180 }}>
            <button onClick={toggleBlock} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT.sans, fontSize: 13, color: blocks.blocked_by_me ? C.ink : '#B91C1C' }}>
              {blocks.blocked_by_me ? 'Desbloquear' : 'Bloquear essa pessoa'}
            </button>
          </div>
        )}
      </div>

      {peer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Avatar p={peer} size={40} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{peerName(peer)}</div>
            {peer.username && peer.display_name && <div style={{ fontSize: 12, color: C.inkMuted }}>{peer.display_name}</div>}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 32, color: C.inkMuted }}>Carregando…</div>}
      {error && <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ background: C.white, border: '1px solid ' + C.line, borderRadius: 12, padding: 12, minHeight: 220, maxHeight: '55vh', overflowY: 'auto' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: C.inkMuted, fontSize: 13, padding: '40px 12px' }}>
                Nenhuma mensagem ainda. Escreva a primeira.
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ maxWidth: '78%' }}>
                  <div style={{
                    background: m.mine ? C.green : C.soft, color: m.mine ? '#fff' : C.ink,
                    padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{m.body}</div>
                  <div style={{ fontSize: 10, color: C.inkMuted, marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>
                    {when(m.created_at)}
                    {!m.mine && <> · <button onClick={() => report(m)} style={{ ...linkBtn, fontSize: 10, fontWeight: 500, color: C.inkMuted }}>denunciar</button></>}
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {cantWrite ? (
            <div style={{ fontSize: 13, color: C.inkSoft, background: C.soft, borderRadius: 10, padding: '10px 14px', marginTop: 10 }}>{cantWrite}</div>
          ) : (
            <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} maxLength={2000}
                placeholder="Escreva uma mensagem…" aria-label="Mensagem"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) } }}
                style={{ flex: 1, boxSizing: 'border-box', border: '1px solid ' + C.line, borderRadius: 10, padding: '10px 12px', fontFamily: FONT.sans, fontSize: 14, resize: 'none' }} />
              <button type="submit" disabled={sending || !body.trim()} style={{
                fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, padding: '11px 18px', borderRadius: 10, border: 'none',
                background: C.green, color: '#fff', cursor: 'pointer', opacity: sending || !body.trim() ? 0.6 : 1,
              }}>{sending ? '…' : 'Enviar'}</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

const linkBtn = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
  color: C.navy, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
}
