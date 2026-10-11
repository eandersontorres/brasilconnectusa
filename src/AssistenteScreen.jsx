import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { C, FONT, useIsMobile } from './lib/colors'
import { apiFetch } from './lib/apiFetch'
import { POST_TYPES, timeAgo, classifiedKindLabel } from './FeedScreen'
import { ASSISTANT_MAX_CHARS, ASSISTANT_PENDING_EVENT, takePendingQuestion } from './lib/assistente'

// ════════════════════════════════════════════════════════════════════════════
//   AssistenteScreen — chat que procura nos posts da comunidade
//
//   Rota: /app/assistente (só logado; deslogado o App mostra o LoginGate).
//   API:  POST /api/assistente { messages } → { reply, posts, suggestions, quota }
//   Conversa só na sessão do navegador (sessionStorage); as últimas 8
//   mensagens vão pra API. Spec: docs/spec-assistente-chat.md (Contrato 3).
// ════════════════════════════════════════════════════════════════════════════

const STORE_KEY = 'bc_assistente_v1'
const HISTORY_LIMIT = 8        // mensagens mandadas pra API
const STORE_LIMIT = 40         // mensagens guardadas na sessão
const REPLY_MAX = 1500         // resposta antiga do assistente vai cortada
const COUNTER_FROM = 400       // contador de caracteres aparece daqui pra cima
const TOP_OFFSET = 72          // barra do topo (sticky) + respiro, pro auto-scroll
const CLIENT_TIMEOUT_MS = 35_000 // um pouco acima do maxDuration (30 s) da API
const DOTS_ANIM = 'bcAssistenteDots'

const EXAMPLES = [
  'Alguém vendendo bike em Austin?',
  'Preciso de helper amanhã em Orlando',
  'Eventos brasileiros em Miami',
  'Dicas de ITIN em Houston',
]

// Requisição em andamento: sobrevive à troca de aba (a tela desmonta e volta)
let inflight = null

// ────────────────────────────────────────────────────────────────────────────
//   Helpers
// ────────────────────────────────────────────────────────────────────────────
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function readStore(uid) {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    // Conversa de outra conta no mesmo navegador não aparece
    if (!d || d.uid !== uid || !Array.isArray(d.messages)) return null
    return d
  } catch (_) { return null }
}

function writeStore(data) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...data, messages: (data.messages || []).slice(-STORE_LIMIT) }))
  } catch (_) {}
}

function clearStore() {
  try { sessionStorage.removeItem(STORE_KEY) } catch (_) {}
}

// Monta o histórico da API: papéis alternados, começa e termina em 'user'.
// Bolhas de erro ficam de fora; pergunta que deu erro e foi refeita não repete.
function toApiMessages(list) {
  const out = []
  for (const m of list) {
    if (m.role === 'user') {
      if (out.length && out[out.length - 1].role === 'user') out.pop()
      out.push({ role: 'user', content: String(m.content || '').slice(0, ASSISTANT_MAX_CHARS) })
    } else if (m.role === 'assistant' && out.length && out[out.length - 1].role === 'user') {
      const content = String(m.reply || '').trim() || (m.posts?.length ? `Mostrei ${m.posts.length} posts.` : 'Não encontrei nada.')
      out.push({ role: 'assistant', content: content.slice(0, REPLY_MAX) })
    }
  }
  let tail = out.slice(-HISTORY_LIMIT)
  while (tail.length && tail[0].role !== 'user') tail = tail.slice(1)
  return tail
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n === 0) return 'Grátis'
  return 'US$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function fmtEventDate(v) {
  const d = new Date(v)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function placeLabel(c) {
  if (!c) return null
  const where = c.city && c.state ? `${c.city}/${c.state}` : (c.city || c.state || '')
  return [c.name, where].filter(Boolean).join(' · ') || null
}

function getNavHeight() {
  const nav = document.querySelector('[data-bc-bottomnav]')
  return nav ? nav.offsetHeight : 0
}

// Texto do assistente: quebras de linha e **negrito**, nada de HTML
function ReplyText({ text }) {
  const parts = String(text || '').split(/\*\*(.+?)\*\*/g)
  return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>))
}

// ────────────────────────────────────────────────────────────────────────────
//   Card compacto de post (clique abre /post/<id>)
// ────────────────────────────────────────────────────────────────────────────
function PostResultCard({ post, onOpen }) {
  const t = POST_TYPES[post.type] || POST_TYPES.question
  const lead = []   // preço/kind, data do evento ou pagamento (destaque)
  if (post.type === 'classified') {
    const price = fmtPrice(post.price ?? post.classified_price)
    if (price) lead.push(price)
    if (post.classified_kind) lead.push(classifiedKindLabel(post.classified_kind))
  } else if (post.type === 'event' && post.event_date) {
    const d = fmtEventDate(post.event_date)
    if (d) lead.push(d)
  } else if (post.type === 'job' && post.job_pay) {
    lead.push(String(post.job_pay))
  }
  const rest = [placeLabel(post.community), post.created_at ? timeAgo(post.created_at) : null].filter(Boolean)
  const title = post.title || 'Post sem título'

  return (
    <button
      type="button" onClick={() => onOpen(post)}
      aria-label={[`Abrir post (${t.label}): ${title}`, ...lead, ...rest].join('. ')}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        background: C.white, border: '1px solid ' + C.line, borderRadius: 12,
        padding: '10px 12px', fontFamily: FONT.sans, color: C.ink,
        transition: 'border-color .15s, box-shadow .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.04)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.boxShadow = 'none' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 11 }}>
        <span style={{ background: t.bg, color: t.color, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
          {t.icon} {t.label}
        </span>
        {post.classified_status === 'reserved' && (
          <span style={{ background: C.soft, color: C.inkSoft, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
            Reservado
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span aria-hidden="true" style={{ color: C.inkMuted, fontSize: 13 }}>›</span>
      </span>
      <span style={{
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: C.ink, wordBreak: 'break-word',
      }}>{title}</span>
      {post.snippet && (
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          fontSize: 12.5, lineHeight: 1.45, color: C.inkSoft, marginTop: 3, wordBreak: 'break-word',
        }}>{post.snippet}</span>
      )}
      {(lead.length > 0 || rest.length > 0) && (
        <span style={{ display: 'block', fontSize: 11.5, color: C.inkMuted, marginTop: 6, lineHeight: 1.4 }}>
          {lead.length > 0 && <span style={{ color: C.ink, fontWeight: 700 }}>{lead.join(' · ')}</span>}
          {lead.length > 0 && rest.length > 0 && ' · '}
          {rest.join(' · ')}
        </span>
      )}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Bolhas
// ────────────────────────────────────────────────────────────────────────────
const bubbleBase = {
  padding: '9px 13px', fontSize: 14.5, lineHeight: 1.5,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
}

function UserBubble({ text }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        ...bubbleBase, maxWidth: '85%', background: C.navy, color: C.white,
        borderRadius: '16px 16px 4px 16px',
      }}>{text}</div>
    </div>
  )
}

function AssistantBubble({ children, tone }) {
  const err = tone === 'error'
  return (
    <div style={{
      ...bubbleBase, maxWidth: '92%', alignSelf: 'flex-start',
      background: err ? '#FEF2F2' : C.white, color: err ? '#991B1B' : C.ink,
      border: '1px solid ' + (err ? '#FECACA' : C.line),
      borderRadius: '16px 16px 16px 4px',
    }}>{children}</div>
  )
}

function LoadingBubble() {
  return (
    <div role="status" style={{ display: 'flex' }}>
      <AssistantBubble>
        <span style={{ color: C.inkSoft }}>Procurando nos posts</span>
        <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3, marginLeft: 6, verticalAlign: 'middle' }}>
          {[0, 1, 2].map(i => (
            <span key={i} data-bc-assistente-dot style={{
              width: 5, height: 5, borderRadius: '50%', background: C.inkMuted,
              animationDelay: (i * 0.16) + 's',
            }} />
          ))}
        </span>
      </AssistantBubble>
    </div>
  )
}

const pillBtn = {
  background: C.white, color: C.navy, border: '1px solid ' + C.line, borderRadius: 18,
  padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.sans,
}

// ────────────────────────────────────────────────────────────────────────────
//   AssistenteScreen
// ────────────────────────────────────────────────────────────────────────────
export default function AssistenteScreen({ user }) {
  const isMobile = useIsMobile()
  const uid = user?.id || null

  const initial = useRef(null)
  if (initial.current === null) initial.current = readStore(uid) || { messages: [], quota: null }

  const [messages, setMessages] = useState(initial.current.messages)
  const [quota, setQuota] = useState(initial.current.quota || null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [navH, setNavH] = useState(0)
  const [minH, setMinH] = useState(0)

  const messagesRef = useRef(messages)
  const quotaRef = useRef(quota)
  const sendingRef = useRef(false)
  const mountedRef = useRef(false)
  const scrollPlan = useRef(
    typeof initial.current.scrollY === 'number' ? { mode: 'restore', y: initial.current.scrollY }
      : initial.current.messages.length ? { mode: 'instant' } : null
  )
  const rootRef = useRef(null)
  const barRef = useRef(null)
  const inputRef = useRef(null)
  const lastRef = useRef(null)

  const commit = useCallback((list) => {
    messagesRef.current = list
    setMessages(list)
  }, [])

  // Salva a conversa na sessão (dona = uid)
  useEffect(() => {
    if (!messages.length && !quota) { clearStore(); return }
    writeStore({ uid, messages, quota })
  }, [uid, messages, quota])

  // ── Envio ─────────────────────────────────────────────────────────────────
  const request = useCallback(async (list) => {
    commit(list)
    sendingRef.current = true
    setSending(true)
    scrollPlan.current = { mode: 'smooth' }

    const run = (async () => {
      let entry
      let nextQuota = quotaRef.current
      // Conexão travada sem erro (túnel, troca de rede) não fica em "Procurando" pra sempre
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = ctrl ? setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS) : null
      try {
        const r = await apiFetch('/api/assistente', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: toApiMessages(list) }),
          signal: ctrl ? ctrl.signal : undefined,
        })
        let d = {}
        let parsed = false
        try { d = (await r.json()) || {}; parsed = true } catch (_) {}
        // Corpo cortado pelo timeout: trata como "demorou demais", não como resposta vazia
        if (!parsed && ctrl && ctrl.signal.aborted) throw new Error('timeout')
        if (d.quota && typeof d.quota.used === 'number' && typeof d.quota.limit === 'number') nextQuota = d.quota

        if (r.ok && d.success === true) {
          entry = {
            role: 'assistant',
            reply: String(d.reply || ''),
            posts: Array.isArray(d.posts) ? d.posts.filter(p => p && p.id) : [],
            communities: Array.isArray(d.suggestions?.communities) ? d.suggestions.communities.filter(c => c && c.slug) : [],
          }
        } else if (r.status === 429 && d.quota) {
          // Cota diária (vem com quota). 429 sem quota é o freio por IP: cai no "Tentar de novo"
          entry = { role: 'error', kind: 'quota', text: d.error || 'Você chegou ao limite de perguntas por hoje. Tente de novo amanhã.', quota: nextQuota }
        } else if (r.status === 401) {
          entry = { role: 'error', kind: 'auth', text: 'Sua sessão expirou. Entre de novo pra continuar perguntando.' }
        } else {
          entry = { role: 'error', kind: 'retry', text: d.error || 'Não consegui procurar agora. Tente de novo em instantes.' }
        }
      } catch (_) {
        entry = ctrl && ctrl.signal.aborted
          ? { role: 'error', kind: 'retry', text: 'Demorou demais. Tente de novo.' }
          : { role: 'error', kind: 'retry', text: 'Sem conexão. Confira sua internet e tente de novo.' }
      } finally {
        if (timer) clearTimeout(timer)
      }
      const next = [...list, { id: newId(), ...entry }]
      // Salva já: se a pessoa trocou de aba no meio, a resposta está lá quando voltar
      writeStore({ uid, messages: next, quota: nextQuota })
      return { next, quota: nextQuota }
    })()

    inflight = run
    const res = await run
    if (inflight === run) inflight = null
    sendingRef.current = false
    if (!mountedRef.current) return
    quotaRef.current = res.quota
    setQuota(res.quota)
    scrollPlan.current = { mode: 'answer' }
    commit(res.next)
    setSending(false)
  }, [commit, uid])

  const ask = useCallback((text) => {
    const q = String(text || '').trim().slice(0, ASSISTANT_MAX_CHARS)
    if (!q) return
    // Chegou pergunta (de outra entrada) no meio de um envio: deixa no campo
    if (sendingRef.current) { setDraft(q); return }
    setDraft('')
    request([...messagesRef.current, { id: newId(), role: 'user', content: q }])
  }, [request])

  const retry = useCallback((errId) => {
    if (sendingRef.current) return
    const list = messagesRef.current.filter(m => m.id !== errId)
    if (!list.length || list[list.length - 1].role !== 'user') return
    request(list)
  }, [request])

  function newChat() {
    if (sendingRef.current) return
    commit([])
    setDraft('')
    scrollPlan.current = null
    try { window.scrollTo({ top: 0 }) } catch (_) {}
    if (!isMobile) inputRef.current?.focus()
  }

  const openPost = useCallback((post) => {
    // Guarda onde a pessoa estava pra voltar no mesmo ponto
    writeStore({ uid, messages: messagesRef.current, quota: quotaRef.current, scrollY: window.scrollY })
    window.dispatchEvent(new CustomEvent('bc-navigate', { detail: { tab: 'post', slug: post.id } }))
    try { window.scrollTo({ top: 0 }) } catch (_) {}
  }, [uid])

  function openCommunity(slug) {
    window.dispatchEvent(new CustomEvent('bc-navigate', { detail: { tab: 'community', slug } }))
    try { window.scrollTo({ top: 0 }) } catch (_) {}
  }

  // ── Montagem: requisição pendurada de antes ou pergunta vinda de outra entrada
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    if (inflight) {
      sendingRef.current = true
      setSending(true)
      inflight.then(() => {
        if (cancelled) return
        const d = readStore(uid)
        if (d) {
          quotaRef.current = d.quota || null
          setQuota(d.quota || null)
          scrollPlan.current = { mode: 'answer' }
          commit(d.messages)
        }
        sendingRef.current = false
        setSending(false)
        const q = takePendingQuestion()
        if (q) ask(q)
      })
    } else {
      // Recarregou no meio do envio: a pergunta ficou sem resposta (e sem botão). Oferece tentar de novo
      const list = messagesRef.current
      if (list.length && list[list.length - 1].role === 'user') {
        commit([...list, { id: newId(), role: 'error', kind: 'retry', text: 'A resposta se perdeu. Tente de novo.' }])
      }
      const q = takePendingQuestion()
      if (q) ask(q)
    }
    if (!isMobile) inputRef.current?.focus()
    return () => { mountedRef.current = false; cancelled = true }
    // Só na montagem (as funções são estáveis por usuário)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tela já aberta e a pergunta veio do topo/aba Buscar
  useEffect(() => {
    function onPending() {
      const q = takePendingQuestion()
      if (q) ask(q)
    }
    window.addEventListener(ASSISTANT_PENDING_EVENT, onPending)
    return () => window.removeEventListener(ASSISTANT_PENDING_EVENT, onPending)
  }, [ask])

  // ── Layout: barra de pergunta acima da bottom nav e tela com altura mínima
  useLayoutEffect(() => {
    function measure() {
      const nav = isMobile ? getNavHeight() : 0
      setNavH(nav)
      const root = rootRef.current
      if (!root) return
      const top = root.getBoundingClientRect().top + window.scrollY
      setMinH(Math.max(320, Math.round(window.innerHeight - top - nav - (isMobile ? 12 : 20))))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [isMobile])

  // Campo cresce até ~5 linhas
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [draft])

  // ── Auto-scroll (a página rola, não a lista)
  useEffect(() => {
    const plan = scrollPlan.current
    if (!plan) return
    scrollPlan.current = null
    let done = false
    const raf = requestAnimationFrame(() => {
      done = true
      const root = rootRef.current
      if (!root) return
      if (plan.mode === 'restore') { window.scrollTo({ top: plan.y }); return }
      const viewBottom = window.innerHeight - (isMobile ? getNavHeight() : 0)
      let target = window.scrollY + root.getBoundingClientRect().bottom - viewBottom
      // Resposta comprida: mostra o começo dela, não o fim dos cards
      if (plan.mode === 'answer' && lastRef.current) {
        const r = lastRef.current.getBoundingClientRect()
        const barH = barRef.current ? barRef.current.offsetHeight : 0
        if (r.height > viewBottom - barH - TOP_OFFSET) target = Math.min(target, window.scrollY + r.top - TOP_OFFSET)
      }
      window.scrollTo({ top: Math.max(0, target), behavior: plan.mode === 'instant' ? 'auto' : 'smooth' })
    })
    // Re-render antes do frame (aba em segundo plano): o plano fica pro próximo
    return () => { cancelAnimationFrame(raf); if (!done && !scrollPlan.current) scrollPlan.current = plan }
  }, [messages, sending, isMobile])

  // Devolve o foco ao campo quando a resposta chega (só desktop: no celular abriria o teclado)
  useEffect(() => {
    if (!sending && !isMobile && messagesRef.current.length) inputRef.current?.focus()
  }, [sending, isMobile])

  function onSubmit(e) {
    e.preventDefault()
    ask(draft)
  }

  const canSend = !sending && draft.trim().length > 0
  const lastIdx = messages.length - 1

  return (
    <div ref={rootRef} style={{
      fontFamily: FONT.sans, color: C.ink,
      maxWidth: 720, width: '100%', margin: '0 auto',
      minHeight: minH || undefined,
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes ${DOTS_ANIM} { 0%, 80%, 100% { opacity: .25; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-3px) } }
        [data-bc-assistente-dot] { display: inline-block; animation: ${DOTS_ANIM} 1.2s infinite ease-in-out; }
        @media (prefers-reduced-motion: reduce) { [data-bc-assistente-dot] { animation: none; opacity: .6; } }
      `}</style>

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, paddingTop: isMobile ? 2 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            fontFamily: FONT.serif, fontSize: isMobile ? 21 : 24, fontWeight: 700,
            color: C.ink, lineHeight: 1.2, margin: 0,
          }}><span aria-hidden="true">✨ </span>Pergunte ao BrasilConnect</h1>
          <p style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.45, margin: '4px 0 0' }}>
            Eu procuro nos posts da comunidade e te mostro os links.
          </p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={newChat} disabled={sending} style={{
            ...pillBtn, flexShrink: 0, padding: '6px 12px', fontSize: 12,
            opacity: sending ? 0.5 : 1, cursor: sending ? 'default' : 'pointer',
          }}>Nova conversa</button>
        )}
      </div>

      {/* Conversa */}
      <div role="log" aria-label="Conversa com o assistente" aria-busy={sending || undefined}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 12 }}>

        {messages.length === 0 && !sending && (
          <div style={{
            background: C.white, border: '1px solid ' + C.line, borderRadius: 14,
            padding: isMobile ? '18px 16px' : '22px 22px',
          }}>
            <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.55, marginBottom: 14 }}>
              Pergunte do seu jeito: classificados, vagas, eventos, indicações e dicas das
              comunidades. Eu te mostro os posts que achar, com link pra cada um.
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Experimente
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EXAMPLES.map(q => (
                <button key={q} type="button" onClick={() => ask(q)} style={pillBtn}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isLast = i === lastIdx
          if (m.role === 'user') return <UserBubble key={m.id} text={m.content} />

          if (m.role === 'error') {
            return (
              <div key={m.id} ref={isLast ? lastRef : null} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <AssistantBubble tone="error">
                  {m.text}
                  {m.kind === 'quota' && m.quota && (
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
                      Você usou {m.quota.used} de {m.quota.limit} perguntas hoje.
                    </div>
                  )}
                </AssistantBubble>
                {isLast && m.kind === 'retry' && (
                  <button type="button" onClick={() => retry(m.id)} disabled={sending} style={pillBtn}>↻ Tentar de novo</button>
                )}
                {isLast && m.kind === 'auth' && (
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('bc-open-auth'))}
                    style={{ ...pillBtn, background: C.green, color: C.white, border: '1px solid ' + C.green }}>
                    Entrar
                  </button>
                )}
              </div>
            )
          }

          // Assistente: texto + cards (ou comunidades pra postar, se não achou nada)
          const posts = m.posts || []
          const communities = posts.length === 0 ? (m.communities || []) : []
          return (
            <div key={m.id} ref={isLast ? lastRef : null} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              {(m.reply || posts.length === 0) && (
                <AssistantBubble>
                  {m.reply ? <ReplyText text={m.reply} /> : 'Não encontrei posts sobre isso.'}
                </AssistantBubble>
              )}
              {posts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: isMobile ? '100%' : 560 }}>
                  {posts.map(p => <PostResultCard key={p.id} post={p} onOpen={openPost} />)}
                </div>
              )}
              {communities.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {communities.slice(0, 3).map(c => (
                    <button key={c.slug} type="button" onClick={() => openCommunity(c.slug)} style={{
                      ...pillBtn, background: C.greenSoft, color: C.green, border: '1px solid ' + C.green,
                    }}>Postar em {c.name || c.slug} →</button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {sending && <LoadingBubble />}
      </div>

      {/* Barra de pergunta: fixa no fim da área de conteúdo, acima da bottom nav */}
      <div ref={barRef} style={{
        position: 'sticky', bottom: navH, zIndex: 10,
        background: C.paper, paddingTop: 8, paddingBottom: isMobile ? 8 : 14,
      }}>
        <form onSubmit={onSubmit} style={{
          display: 'flex', alignItems: 'flex-end', gap: 6,
          background: C.white, border: '1px solid ' + C.line, borderRadius: 22,
          padding: '4px 4px 4px 14px', boxShadow: '0 2px 10px rgba(0,0,0,.05)',
          opacity: sending ? 0.75 : 1,
        }}>
          <textarea
            ref={inputRef} value={draft} rows={1}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                ask(draft)
              }
            }}
            disabled={sending} maxLength={ASSISTANT_MAX_CHARS} enterKeyHint="send"
            aria-label="Sua pergunta"
            placeholder={messages.length ? 'Pergunte outra coisa…' : (isMobile ? 'Escreva sua pergunta…' : 'Pergunte: alguém vendendo bike em Austin?')}
            style={{
              flex: 1, minWidth: 0, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
              fontFamily: FONT.sans, fontSize: isMobile ? 16 : 14.5, lineHeight: 1.4, color: C.ink,
              padding: '8px 0', maxHeight: 120, overflowY: 'auto', display: 'block',
            }}
          />
          <button type="submit" disabled={!canSend} aria-label="Enviar pergunta" style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0, border: 'none',
            background: canSend ? C.navy : C.inkLight, color: C.white,
            cursor: canSend ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </form>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 6, padding: '0 8px', fontSize: 11, color: C.inkMuted, lineHeight: 1.4 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            Respostas geradas por IA a partir dos posts. Confira os detalhes no post.
          </span>
          {draft.length > COUNTER_FROM ? (
            <span aria-live="polite" style={{ flexShrink: 0, fontWeight: 600, color: draft.length >= ASSISTANT_MAX_CHARS ? '#B91C1C' : C.inkSoft }}>
              {draft.length}/{ASSISTANT_MAX_CHARS}
            </span>
          ) : quota && quota.limit ? (
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{quota.used} de {quota.limit} perguntas hoje</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
