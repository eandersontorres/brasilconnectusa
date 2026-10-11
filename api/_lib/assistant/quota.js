/**
 * Assistente — cota por usuário, teto global de custo e log (bc_assistant_log).
 *
 * A linha do log é RESERVADA antes de chamar o modelo (stop_reason 'pending') e
 * atualizada no fim (finishRun). Assim:
 *   - requisições simultâneas do mesmo usuário se enxergam (cada uma insere e só
 *     depois conta: no pior caso todas ficam de fora, nunca passam do limite);
 *   - se a função morrer no meio (maxDuration), a linha 'pending' continua contando
 *     na cota e entra no teto global com um custo estimado.
 *
 * Se a tabela ainda não existir (migration não aplicada), as funções devolvem
 * { ok: false, unavailable: true } para o chamador responder 503, nunca 500.
 */
const DAY_MS = 24 * 3600_000
const BUDGET_CACHE_MS = 60_000
const PAGE = 1000
const MAX_PAGES = 20
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const STOP_PENDING = 'pending'
// Falha do lado da Anthropic (429/5xx): não conta na cota do usuário (conta no teto pelo custo)
export const STOP_UNAVAILABLE = 'unavailable'
// Outras falhas (conexão, prazo, erro interno): contam na cota
export const STOP_ERROR = 'error'

// Custo máximo estimado de uma pergunta (4 chamadas, max_tokens 2048): ~US$ 0,006
export const PENDING_COST_USD = 0.006

export function dailyLimit() {
  const n = parseInt(process.env.ASSISTANT_DAILY_LIMIT, 10)
  return Number.isFinite(n) && n > 0 ? n : 30
}

export function dailyBudgetUsd() {
  const n = parseFloat(process.env.ASSISTANT_DAILY_BUDGET_USD)
  return Number.isFinite(n) && n > 0 ? n : 5
}

function describe(error) {
  if (!error) return 'sem detalhes'
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(' | ') || 'sem detalhes'
}

/**
 * Reserva a linha da pergunta. -> { ok, id } | { ok:false, unavailable:true }
 * row: { user_id, question, model }
 */
export async function reserveRun(supabase, row) {
  try {
    const { data, error, status } = await supabase
      .from('bc_assistant_log')
      .insert({
        user_id: row.user_id,
        question: String(row.question || '').slice(0, 500),
        model: row.model || null,
        cost_usd: 0,
        stop_reason: STOP_PENDING,
      })
      .select('id')
      .single()
    if (error || !data?.id) {
      console.error('[assistente] reserva indisponível (bc_assistant_log existe?): status', status, '|', describe(error))
      return { ok: false, unavailable: true }
    }
    addSpent(PENDING_COST_USD)
    return { ok: true, id: data.id }
  } catch (e) {
    console.error('[assistente] reserva indisponível:', e?.message || e)
    return { ok: false, unavailable: true }
  }
}

/**
 * Perguntas do usuário nas últimas 24h, já contando a reservada agora.
 * Falha do lado da Anthropic ('unavailable') não conta.
 * -> { ok, used, limit } | { ok:false, unavailable:true }
 */
export async function checkUserQuota(supabase, userId, limit = dailyLimit()) {
  const since = new Date(Date.now() - DAY_MS).toISOString()
  const { count, error, status } = await supabase
    .from('bc_assistant_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
    .or(`stop_reason.is.null,stop_reason.neq.${STOP_UNAVAILABLE}`)
  if (error || typeof count !== 'number') {
    // HEAD não traz corpo: o status (404 = tabela não existe) ajuda no diagnóstico
    console.error('[assistente] cota indisponível (bc_assistant_log existe?): status', status, '|', describe(error))
    return { ok: false, unavailable: true, used: 0, limit }
  }
  return { ok: count <= limit, used: Math.min(count, limit), limit }
}

/** Desfaz a reserva (pergunta recusada antes de chamar o modelo). Nunca lança. */
export async function cancelRun(supabase, id) {
  if (!id) return
  try {
    const { error } = await supabase.from('bc_assistant_log').delete().eq('id', id)
    if (error) console.error('[assistente] falha ao desfazer reserva:', describe(error))
    else addSpent(-PENDING_COST_USD)
  } catch (e) {
    console.error('[assistente] falha ao desfazer reserva:', e?.message || e)
  }
}

// Soma do custo das últimas 24h, com cache curto por instância (evita ler o log a cada pergunta)
let spent = { at: 0, total: 0 }

/** Teto global: custo gravado + reservas pendentes pelo custo estimado. */
export async function checkBudget(supabase, budget = dailyBudgetUsd()) {
  if (Date.now() - spent.at < BUDGET_CACHE_MS) {
    return { ok: spent.total < budget, spent: spent.total, budget }
  }
  const since = new Date(Date.now() - DAY_MS).toISOString()
  let total = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from('bc_assistant_log')
      .select('cost_usd, stop_reason')
      .gte('created_at', since)
      .or(`cost_usd.gt.0,stop_reason.eq.${STOP_PENDING}`)
      .order('created_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error || !Array.isArray(data)) {
      console.error('[assistente] teto global indisponível (bc_assistant_log existe?):', describe(error))
      return { ok: false, unavailable: true, spent: 0, budget }
    }
    for (const r of data) {
      const cost = Number(r.cost_usd) || 0
      total += r.stop_reason === STOP_PENDING ? Math.max(cost, PENDING_COST_USD) : cost
    }
    if (data.length < PAGE) break
  }
  spent = { at: Date.now(), total }
  return { ok: total < budget, spent: total, budget }
}

/** Soma (ou desconta) um valor no cache local do teto (até a próxima leitura). */
export function addSpent(usd) {
  if (spent.at) spent.total = Math.max(0, spent.total + (Number(usd) || 0))
}

/** Só para testes. */
export function _resetBudgetCache() { spent = { at: 0, total: 0 } }

function logFields(row) {
  const u = row.usage || {}
  return {
    tool_calls: Array.isArray(row.tool_calls) ? row.tool_calls : [],
    result_ids: (row.result_ids || []).map(String).filter(id => UUID.test(id)),
    model: row.model || null,
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_tokens: u.cache_read_input_tokens || 0,
    cache_write_tokens: u.cache_creation_input_tokens || 0,
    cost_usd: Number(row.cost_usd) || 0,
    stop_reason: row.stop_reason ? String(row.stop_reason).slice(0, 40) : null,
    duration_ms: Number.isFinite(row.duration_ms) ? Math.round(row.duration_ms) : null,
    error: row.error ? String(row.error).slice(0, 500) : null,
  }
}

/**
 * Fecha a linha reservada com usage, custo e resultado. Sem id (reserva sem retorno),
 * grava uma linha nova. Nunca lança: falha no log não derruba a resposta.
 * row: { user_id, question, tool_calls, result_ids, model, usage, cost_usd, stop_reason, duration_ms, error }
 */
export async function finishRun(supabase, id, row) {
  try {
    const fields = logFields(row)
    const { error } = id
      ? await supabase.from('bc_assistant_log').update(fields).eq('id', id)
      : await supabase.from('bc_assistant_log').insert({
          user_id: row.user_id,
          question: String(row.question || '').slice(0, 500),
          ...fields,
        })
    if (error) console.error('[assistente] falha ao gravar bc_assistant_log:', describe(error))
    else addSpent(fields.cost_usd - (id ? PENDING_COST_USD : 0))
  } catch (e) {
    console.error('[assistente] falha ao gravar bc_assistant_log:', e?.message || e)
  }
}
