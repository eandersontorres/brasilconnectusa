/**
 * Assistente — loop do agente (Claude Haiku 5.5 + ferramenta buscar_posts).
 *
 * Não depende de req/res: o chat web (api/assistente.js) e, na fase 2, o WhatsApp chamam
 * runAssistant com o próprio client, histórico, contexto e executor de ferramenta.
 *
 *   runAssistant({ client, history, context, executeTool, deadlineAt? })
 *     history: [{ role: 'user'|'assistant', content: string }] (última = user)
 *     context: texto do system[1] (data, perfil, cidades)
 *     executeTool(name, input) -> { content, isError?, posts?, normalized?, suggestions? }
 *     deadlineAt: prazo duro (epoch ms) para terminar; padrão agora + 25 s. O chamador passa
 *       o prazo contado do início da requisição, para sobrar tempo de gravar o log.
 *   -> { reply, posts, toolCalls, usage, stopReason, suggestions, fallback }
 *
 * Erros da API sobem (o chamador traduz); o usage parcial vai em err.assistantUsage.
 */
import { SEARCH_TOOL } from './search.js'
import { SYSTEM_STATIC } from './prompt.js'
import { emptyUsage, addUsage } from './cost.js'

export const MODEL = 'claude-haiku-5-5'
// O JSON final é curto, mas o thinking adaptativo também conta no max_tokens: 2048 dá folga
// sem pesar no custo (só os tokens gerados são cobrados)
export const MAX_TOKENS = 2048

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    resposta: { type: 'string' },
    ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['resposta', 'ids'],
  additionalProperties: false,
}

const MAX_TOOL_TURNS = 3        // chamadas ao modelo que podem usar ferramenta (depois, uma final sem ferramenta)
const MAX_SEARCHES = 3          // buscas executadas por pergunta (o prompt pede no máximo 2)
const MAX_CARDS = 6
const FALLBACK_CARDS = 4
const MAX_REPLY_CHARS = 1000
const SOFT_DEADLINE_MS = 18_000 // passou disso, a próxima chamada já é a final (função tem 30 s)
export const HARD_DEADLINE_MS = 25_000 // prazo total padrão (maxDuration 30 s menos folga para o log)
const CALL_TIMEOUT_MS = 20_000  // teto por tentativa
const MIN_CALL_MS = 3_000       // menos que isso de prazo: nem chama a API, responde com o que tem
const FINAL_BELOW_MS = 10_000   // menos que isso: a próxima chamada já é a final
const RETRY_ABOVE_MS = 15_000   // só repete a chamada (1 vez) se ainda houver esse prazo

export const REPLY_REFUSAL = 'Não posso ajudar com esse pedido. Posso procurar posts, classificados, vagas e eventos da comunidade: tente perguntar de outro jeito.'
export const REPLY_FOUND = 'Encontrei estes posts:'
export const REPLY_FAILED = 'Não consegui completar a busca agora. Tente de novo em instantes.'

/** Concatena os blocos de texto (a resposta pode começar com blocos thinking). */
export function readText(content) {
  return (Array.isArray(content) ? content : [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
    .trim()
}

/** JSON final { resposta, ids } ou null se inválido. */
export function parseFinal(text) {
  if (!text) return null
  let obj = null
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { obj = JSON.parse(m[0]) } catch { return null }
  }
  if (!obj || typeof obj !== 'object' || typeof obj.resposta !== 'string') return null
  const ids = Array.isArray(obj.ids) ? obj.ids.filter(x => typeof x === 'string') : []
  return { resposta: obj.resposta, ids }
}

// Contato que um post malicioso pode tentar pôr na voz do assistente: vira "(veja no post)"
const CONTACT_MASK = '(veja no post)'
const EMAIL_RE = /[^\s@()<>]+@[^\s@()<>]+\.[a-z]{2,}/gi
const DOMAIN_RE = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|io|ly|me|co|br|us|app|dev|ai|gg|to|cc|tv|xyz|site|online|link|shop|store|page|club|top|vip|live|pro)\b(?:\/\S*)?/gi
const PHONE_RE = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{3,5}[\s.-]?\d{4}(?!\d)/g

/** Tira links/markdown/contatos do texto do modelo (o card é o único link) e limita o tamanho. */
export function sanitizeReply(s) {
  return String(s || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(EMAIL_RE, CONTACT_MASK)
    .replace(DOMAIN_RE, CONTACT_MASK)
    .replace(PHONE_RE, CONTACT_MASK)
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
    .slice(0, MAX_REPLY_CHARS)
}

const TOOL_FAILED = 'Erro ao executar a ferramenta. Responda com o que já tem ou diga que não foi possível buscar agora.'
const TOOL_NO_TIME = 'Sem tempo para mais buscas nesta pergunta. Responda com o que já encontrou.'

// Corre a ferramenta contra o prazo: se estourar, segue sem ela (a promessa original é ignorada)
function withDeadline(promise, ms) {
  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ content: TOOL_FAILED, isError: true, timedOut: true }), Math.max(0, ms))
  })
  promise.catch(() => {})
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function runAssistant({
  client,
  history,
  context = '',
  executeTool,
  model = MODEL,
  maxTokens = MAX_TOKENS,
  deadlineMs = SOFT_DEADLINE_MS,
  deadlineAt,
}) {
  const startedAt = Date.now()
  const hardDeadline = Number.isFinite(deadlineAt) ? deadlineAt : startedAt + HARD_DEADLINE_MS
  const usage = emptyUsage()
  const toolCalls = []
  const found = new Map()  // id -> linha da RPC (só o que as buscas devolveram nesta requisição)
  let suggestions = []
  let searches = 0
  let stopReason = null

  // Histórico append-only: depois daqui só entra push
  const messages = (history || []).map(m => ({ role: m.role, content: m.content }))

  const system = [
    { type: 'text', text: SYSTEM_STATIC, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: context || 'Sem contexto adicional.' },
  ]

  const finish = (extra) => ({
    toolCalls,
    usage,
    stopReason,
    suggestions,
    fallback: null,
    ...extra,
  })

  const fallbackResult = (why) => {
    const posts = [...found.values()].slice(0, FALLBACK_CARDS)
    return finish({ reply: posts.length ? REPLY_FOUND : REPLY_FAILED, posts, fallback: why })
  }

  try {
    for (let turn = 1; turn <= MAX_TOOL_TURNS + 1; turn++) {
      const remaining = hardDeadline - Date.now()
      // Sem prazo para mais uma chamada: responde com os posts já encontrados
      if (remaining < MIN_CALL_MS) return fallbackResult('deadline')
      const late = Date.now() - startedAt > deadlineMs || remaining < FINAL_BELOW_MS
      const final = turn > MAX_TOOL_TURNS || (late && turn > 1)

      const params = {
        model,
        max_tokens: maxTokens,
        system,
        tools: [SEARCH_TOOL],
        messages,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      }
      if (final) params.tool_choice = { type: 'none' }

      // Prazo por chamada: o signal corta também a espera de retry-after do SDK
      const response = await client.messages.create(params, {
        timeout: Math.floor(Math.min(CALL_TIMEOUT_MS, remaining)),
        maxRetries: remaining > RETRY_ABOVE_MS ? 1 : 0,
        signal: AbortSignal.timeout(Math.floor(remaining)),
      })
      addUsage(usage, response?.usage)
      stopReason = response?.stop_reason || null

      // Recusa vem com HTTP 200: checar antes de ler o conteúdo
      if (stopReason === 'refusal') {
        return finish({ reply: REPLY_REFUSAL, posts: [], suggestions: [], fallback: 'refusal' })
      }

      const content = Array.isArray(response?.content) ? response.content : []
      const toolUses = content.filter(b => b?.type === 'tool_use')

      if (stopReason === 'tool_use' && !final && toolUses.length) {
        // Reenvia a resposta sem modificar (inclusive os blocos thinking)
        messages.push({ role: 'assistant', content: response.content })

        const results = []
        for (const block of toolUses) {
          if (searches >= MAX_SEARCHES) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Limite de buscas desta pergunta atingido. Responda com o que já encontrou.', is_error: true })
            continue
          }
          const left = hardDeadline - Date.now()
          if (left < MIN_CALL_MS) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: TOOL_NO_TIME, is_error: true })
            continue
          }
          searches++
          let out
          try {
            out = await withDeadline(Promise.resolve().then(() => executeTool(block.name, block.input)), left - MIN_CALL_MS / 2)
            if (out?.timedOut) console.error('[assistente] busca passou do prazo:', block.name)
          } catch (e) {
            console.error('[assistente] executeTool lançou:', e?.message || e)
            out = { content: TOOL_FAILED, isError: true }
          }
          if (out?.normalized) toolCalls.push(out.normalized)
          else toolCalls.push({ ferramenta: block.name, entrada: block.input ?? null })
          for (const row of out?.posts || []) {
            if (row?.id && !found.has(String(row.id))) found.set(String(row.id), row)
          }
          if (Array.isArray(out?.suggestions) && out.suggestions.length) suggestions = out.suggestions
          const result = {
            type: 'tool_result',
            tool_use_id: block.id,
            content: String(out?.content || 'Sem resultado.'),
          }
          if (out?.isError) result.is_error = true
          results.push(result)
        }

        // Todos os tool_result numa única mensagem user
        messages.push({ role: 'user', content: results })
        continue
      }

      // Resposta final (end_turn, max_tokens ou qualquer outro motivo)
      const parsed = parseFinal(readText(content))
      if (!parsed) return fallbackResult(stopReason === 'max_tokens' ? 'max_tokens' : 'invalid_json')

      const ids = []
      for (const id of parsed.ids) {
        const k = String(id).trim()
        if (found.has(k) && !ids.includes(k)) ids.push(k)
        if (ids.length >= MAX_CARDS) break
      }
      const posts = ids.map(id => found.get(id))
      let reply = sanitizeReply(parsed.resposta)
      if (!reply) reply = posts.length ? REPLY_FOUND : REPLY_FAILED
      return finish({ reply, posts })
    }
  } catch (e) {
    if (e && typeof e === 'object') {
      e.assistantUsage = usage
      e.assistantToolCalls = toolCalls
    }
    throw e
  }

  return fallbackResult('no_final')
}
