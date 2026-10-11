/**
 * BrasilConnect — Assistente (fase 1: chat dentro do app)
 *
 * POST /api/assistente
 *   Header: Authorization: Bearer <access_token>
 *   Body:   { messages: [{ role: 'user'|'assistant', content: string }] }  (até 8, alternadas, última = user)
 *   200 -> { success, reply, posts:[card], suggestions:{ communities:[{slug,name,url}] }, quota:{used,limit} }
 *   400 corpo inválido · 401 sem login · 429 cota (com quota) · 503 sem chave/teto global/log ausente · 500
 *
 * O agente (Claude Haiku 5.5) busca nos posts com a ferramenta buscar_posts; o servidor só
 * monta cards de ids que a busca devolveu nesta requisição. Detalhes: docs/spec-assistente-chat.md
 *
 * Cota: a linha do log é reservada ANTES de chamar o modelo e fechada no fim (quota.js).
 * Prazo: o agente termina até 25 s depois do início da requisição (maxDuration 30 s no
 * vercel.json), para sempre sobrar tempo de gravar o log e responder.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from './_lib/businessAuth.js'
import { rateLimit } from './_lib/rateLimit.js'
import { runAssistant, MODEL, HARD_DEADLINE_MS } from './_lib/assistant/agent.js'
import { searchPosts, toCard, SEARCH_TOOL } from './_lib/assistant/search.js'
import { loadCommunities, cityCommunities } from './_lib/assistant/places.js'
import { buildContext } from './_lib/assistant/prompt.js'
import { costUsd, emptyUsage } from './_lib/assistant/cost.js'
import {
  reserveRun, checkUserQuota, cancelRun, checkBudget, finishRun, STOP_ERROR, STOP_UNAVAILABLE,
} from './_lib/assistant/quota.js'

const MAX_MESSAGES = 8
const MAX_QUESTION = 500
const MAX_ASSISTANT = 1500

const MSG_UNAVAILABLE = 'Assistente indisponível no momento'
const MSG_TRY_AGAIN = 'Assistente indisponível no momento. Tente de novo em instantes.'
const MSG_BUSY = 'O assistente está muito procurado agora. Tente de novo em instantes.'
const MSG_BUDGET = 'O assistente atingiu o limite de uso de hoje. Tente de novo mais tarde.'
const MSG_INTERNAL = 'Não consegui responder agora. Tente de novo em instantes.'

function defaultSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

let anthropic = null
function defaultAnthropic() {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 20_000 })
  }
  return anthropic
}

function err(res, code, msg) {
  return res.status(code).json({ error: msg })
}

/** Valida o corpo. -> { ok, messages, question } | { ok:false, error } */
export function validateBody(body) {
  let b = body
  if (typeof b === 'string') {
    try { b = JSON.parse(b) } catch { return { ok: false, error: 'Corpo inválido: envie JSON.' } }
  }
  if (!b || typeof b !== 'object') return { ok: false, error: 'Corpo inválido: envie { messages: [...] }.' }

  const list = b.messages
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'Envie messages com pelo menos uma pergunta.' }
  if (list.length > MAX_MESSAGES) return { ok: false, error: `Envie no máximo ${MAX_MESSAGES} mensagens.` }

  const msgs = []
  for (const m of list) {
    if (!m || typeof m !== 'object' || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return { ok: false, error: 'Cada mensagem precisa de role (user ou assistant) e content (texto).' }
    }
    msgs.push({ role: m.role, content: m.content.trim() })
  }

  // O cliente manda as últimas 8: pode começar por uma resposta do assistente
  while (msgs.length && msgs[0].role === 'assistant') msgs.shift()
  if (!msgs.length) return { ok: false, error: 'A última mensagem precisa ser do usuário.' }

  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].role === msgs[i - 1].role) return { ok: false, error: 'As mensagens precisam alternar entre user e assistant.' }
  }
  const last = msgs[msgs.length - 1]
  if (last.role !== 'user') return { ok: false, error: 'A última mensagem precisa ser do usuário.' }
  if (!last.content) return { ok: false, error: 'Escreva uma pergunta.' }
  if (last.content.length > MAX_QUESTION) return { ok: false, error: `Pergunta muito longa (máximo ${MAX_QUESTION} caracteres).` }

  for (const m of msgs) {
    if (m.role === 'user') m.content = m.content.slice(0, MAX_QUESTION) || '(mensagem vazia)'
    else m.content = m.content.slice(0, MAX_ASSISTANT) || '(sem resposta)'
  }
  return { ok: true, messages: msgs, question: last.content }
}

/** Erro da Anthropic -> rótulo para log (null = não é da Anthropic). Do mais específico ao geral. */
export function classifyAnthropicError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'anthropic_auth'
  if (e instanceof Anthropic.RateLimitError) return 'anthropic_rate_limit'
  if (e instanceof Anthropic.BadRequestError) return 'anthropic_bad_request'
  if (e instanceof Anthropic.APIUserAbortError) return 'anthropic_abort' // prazo da requisição (signal)
  if (e instanceof Anthropic.APIConnectionError) return 'anthropic_connection'
  if (e instanceof Anthropic.APIError) return 'anthropic_api_' + (e.status ?? 'unknown')
  // Erro vindo de outra cópia do SDK (build CJS x ESM): instanceof falha, o nome da classe não
  const byName = {
    AuthenticationError: 'anthropic_auth', RateLimitError: 'anthropic_rate_limit',
    BadRequestError: 'anthropic_bad_request', APIUserAbortError: 'anthropic_abort',
    APIConnectionError: 'anthropic_connection', APIConnectionTimeoutError: 'anthropic_connection',
  }[e?.constructor?.name]
  if (byName) return byName
  if (e instanceof Error && typeof e.status === 'number' && e.headers) return 'anthropic_api_' + e.status
  return null
}

/** Falha do lado da Anthropic (429 / 5xx): o usuário não causou e não recebeu nada, então não conta na cota. */
export function isProviderUnavailable(kind) {
  if (kind === 'anthropic_rate_limit') return true
  const m = /^anthropic_api_(\d{3})$/.exec(kind || '')
  return !!m && Number(m[1]) >= 500
}

async function loadProfile(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('bc_profiles')
      .select('city, state, latitude, longitude, radius_miles')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[assistente] perfil:', error.message)
      return null
    }
    return data || null
  } catch (e) {
    console.error('[assistente] perfil:', e?.message || e)
    return null
  }
}

/** Fábrica para permitir mocks em teste; o default export usa Supabase e Anthropic reais. */
export function createHandler({ getSupabase = defaultSupabase, getAnthropic = defaultAnthropic, geocode } = {}) {
  return async function handler(req, res) {
    // Prazo duro do agente, contado do início da requisição (antes de auth, cota e perfil)
    const deadlineAt = Date.now() + HARD_DEADLINE_MS

    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return err(res, 405, 'Método não permitido')

    // Proteção extra por IP (a cota real é por usuário, abaixo)
    const limited = rateLimit(req, { windowMs: 60_000, max: 20 })
    if (limited) {
      res.setHeader('Retry-After', String(limited.retryAfter))
      return err(res, 429, `Muitas perguntas seguidas. Tente de novo em ${limited.retryAfter}s.`)
    }

    const supabase = getSupabase()
    const auth = await requireAuthOnly(req, supabase)
    if (!auth.ok) return err(res, 401, 'Entre na sua conta para usar o assistente.')

    const body = validateBody(req.body)
    if (!body.ok) return err(res, 400, body.error)

    if (!process.env.ANTHROPIC_API_KEY) return err(res, 503, MSG_UNAVAILABLE)

    const me = auth.user.id
    const startedAt = Date.now()
    let runId = null // linha reservada no log e ainda não fechada

    try {
      const budget = await checkBudget(supabase)
      if (budget.unavailable) return err(res, 503, MSG_UNAVAILABLE)
      if (!budget.ok) {
        console.warn('[assistente] teto global atingido: US$', budget.spent.toFixed(4), '>=', budget.budget)
        return err(res, 503, MSG_BUDGET)
      }

      // Reserva a linha e só depois conta: requisições simultâneas se enxergam
      const reserved = await reserveRun(supabase, { user_id: me, question: body.question, model: MODEL })
      if (!reserved.ok) return err(res, 503, MSG_UNAVAILABLE)
      runId = reserved.id

      const quota = await checkUserQuota(supabase, me)
      if (quota.unavailable || !quota.ok) {
        const id = runId
        runId = null
        await cancelRun(supabase, id)
        if (quota.unavailable) return err(res, 503, MSG_UNAVAILABLE)
        return res.status(429).json({
          error: `Você chegou ao limite de ${quota.limit} perguntas por dia. Tente de novo amanhã.`,
          quota: { used: quota.limit, limit: quota.limit },
        })
      }

      const [profile, communities] = await Promise.all([
        loadProfile(supabase, me),
        loadCommunities(supabase).catch(e => {
          console.error('[assistente] comunidades:', e?.message || e)
          return []
        }),
      ])
      const context = buildContext({ now: new Date(), profile, cityCommunities: cityCommunities(communities) })

      const executeTool = async (name, input) => {
        if (name !== SEARCH_TOOL.name) return { content: 'Ferramenta desconhecida.', isError: true }
        return searchPosts({ supabase, userId: me, input, profile, geocode })
      }

      let result
      try {
        result = await runAssistant({ client: getAnthropic(), history: body.messages, context, executeTool, deadlineAt })
      } catch (e) {
        const kind = classifyAnthropicError(e)
        const usage = e?.assistantUsage || emptyUsage()
        console.error('[assistente] falha no agente:', kind || 'interno', e?.status ?? '', e?.requestID ?? '', e?.message || e)
        const id = runId
        runId = null
        await finishRun(supabase, id, {
          user_id: me,
          question: body.question,
          tool_calls: e?.assistantToolCalls || [],
          result_ids: [],
          model: MODEL,
          usage,
          cost_usd: costUsd(usage),
          stop_reason: isProviderUnavailable(kind) ? STOP_UNAVAILABLE : STOP_ERROR,
          duration_ms: Date.now() - startedAt,
          error: (kind || 'interno') + ': ' + String(e?.message || e).slice(0, 300),
        })
        if (kind === 'anthropic_rate_limit') return err(res, 503, MSG_BUSY)
        if (kind) return err(res, 503, MSG_TRY_AGAIN)
        return err(res, 500, MSG_INTERNAL)
      }

      const posts = result.posts.map(toCard)
      const id = runId
      runId = null
      await finishRun(supabase, id, {
        user_id: me,
        question: body.question,
        tool_calls: result.toolCalls,
        result_ids: posts.map(p => p.id),
        model: MODEL,
        usage: result.usage,
        cost_usd: costUsd(result.usage),
        // Sem chamada nenhuma (prazo antes do 1º turno) o stop_reason vem null: não pode ficar 'pending'
        stop_reason: result.stopReason || 'fallback',
        duration_ms: Date.now() - startedAt,
        error: result.fallback && result.fallback !== 'refusal' ? 'fallback: ' + result.fallback : null,
      })

      return res.status(200).json({
        success: true,
        reply: result.reply,
        posts,
        suggestions: { communities: result.suggestions || [] },
        quota: { used: quota.used, limit: quota.limit },
      })
    } catch (e) {
      console.error('[assistente] erro inesperado:', e?.stack || e)
      // Linha reservada e não fechada: fecha como erro (continua contando na cota)
      if (runId) {
        await finishRun(supabase, runId, {
          user_id: me,
          question: body.question,
          tool_calls: [],
          result_ids: [],
          model: MODEL,
          usage: emptyUsage(),
          cost_usd: 0,
          stop_reason: STOP_ERROR,
          duration_ms: Date.now() - startedAt,
          error: 'interno: ' + String(e?.message || e).slice(0, 300),
        })
      }
      return err(res, 500, MSG_INTERNAL)
    }
  }
}

export default createHandler()
