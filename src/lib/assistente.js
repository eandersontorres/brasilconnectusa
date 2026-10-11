// ════════════════════════════════════════════════════════════════════════════
//   Assistente — ponte entre as entradas (topo mobile/desktop, aba Buscar) e a
//   tela do assistente (src/AssistenteScreen.jsx).
//
//   Fica fora da tela pra não puxar o AssistenteScreen (lazy) pro bundle
//   principal só porque o AppShell precisa abrir ele.
// ════════════════════════════════════════════════════════════════════════════

export const ASSISTANT_MAX_CHARS = 500
export const ASSISTANT_PENDING_KEY = 'bc_assistente_pending'
export const ASSISTANT_PENDING_EVENT = 'bc-assistente-pending'

// Reserva em memória se o sessionStorage estiver bloqueado (aba anônima etc.)
let memPending = null

// Abre o assistente. Com texto, a tela envia a pergunta sozinha ao abrir.
export function openAssistant(question) {
  const q = String(question || '').trim().slice(0, ASSISTANT_MAX_CHARS)
  if (q) {
    memPending = q
    try { sessionStorage.setItem(ASSISTANT_PENDING_KEY, q) } catch (_) {}
  }
  window.dispatchEvent(new CustomEvent('bc-navigate', { detail: { tab: 'assistente' } }))
  // Se a tela já estiver aberta o bc-navigate não remonta nada: avisa direto
  if (q) window.dispatchEvent(new CustomEvent(ASSISTANT_PENDING_EVENT))
}

// Lê e apaga a pergunta pendente (uma vez só).
export function takePendingQuestion() {
  let q = null
  try {
    q = sessionStorage.getItem(ASSISTANT_PENDING_KEY)
    sessionStorage.removeItem(ASSISTANT_PENDING_KEY)
  } catch (_) {}
  q = q || memPending
  memPending = null
  q = q ? String(q).trim().slice(0, ASSISTANT_MAX_CHARS) : ''
  return q || null
}
