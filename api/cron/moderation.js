/**
 * GET /api/cron/moderation
 *
 * Agente de moderação IA — roda a cada 5 minutos via Vercel cron.
 *
 * Pega até MAX_BATCH itens com agent_status='pending' (posts, comments,
 * businesses, profiles), manda em batch pro Claude Haiku 4.5 com prompt
 * caching no system, e aplica ação por severity:
 *
 *   critical → is_deleted=true (auto-hide pesado) + agent_status='auto_hidden'
 *   high     → agent_status='flagged' (visível, ranqueia primeiro na fila)
 *   medium   → agent_status='flagged'
 *   low      → agent_status='clean'
 *
 * Autenticação: `x-cron-secret` header ou `?secret=` query param igual a CRON_SECRET.
 *
 * Modelo: claude-haiku-4-5 (claude-haiku-4-5-20251001)
 *   ~$1/M input, $5/M output, $0.10/M cache read, $1.25/M cache write
 *   System cacheado → ~80% economia em runs subsequentes
 */

import { createClient } from '@supabase/supabase-js'

const MODEL          = 'claude-haiku-4-5-20251001'
const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VER  = '2023-06-01'
const MAX_BATCH      = 30           // itens por chamada de Claude (~3000 tokens entrada)
const MAX_TOTAL      = 120          // teto por execução do cron (4 batches max)
const MAX_CONTENT_CH = 1500         // trunca conteúdo longo

// Precificação (USD por milhão de tokens) — Haiku 4.5
const PRICE_IN   = 1.00 / 1_000_000
const PRICE_OUT  = 5.00 / 1_000_000
const PRICE_READ = 0.10 / 1_000_000
const PRICE_WRITE = 1.25 / 1_000_000

// ────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — cacheado (paga 1x, lê barato nas próximas chamadas)
// ────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é o agente de moderação do BrasilConnect USA — uma plataforma comunitária pra brasileiros que vivem nos Estados Unidos.

A galera publica posts (feed, eventos, classifieds, jobs), comments, listings de negócios e bio de perfil. Seu trabalho é classificar cada item por risco e categoria pra triagem automática.

═══════════════════════════════════════════════════════════════
TOM E TOLERÂNCIA — IMPORTANTE
═══════════════════════════════════════════════════════════════

Brasileiros falam soltos. Palavrão casual ("porra meu", "que rolê do caralho", "tá foda") NÃO é tóxico, é fala normal. Humor pesado entre amigos também passa. Só marque TÓXICO quando há ataque direcionado, ódio, doxing ou assédio real.

A maioria do conteúdo é LEGÍTIMO. Seu default é "low" (limpo). Só escale severity quando tiver sinal claro.

═══════════════════════════════════════════════════════════════
CATEGORIAS
═══════════════════════════════════════════════════════════════

**scam** (golpe) — Conteúdo enganoso visando explorar imigrante brasileiro:
  - Promessa de visto/green card/regularização fácil sem advogado credenciado
  - "Faço seu visto em 30 dias garantido" / "tenho contato na imigração"
  - Câmbio pessoal suspeito ("envio R$ rápido", "dólar barato", taxa irreal)
  - MMN/pirâmide disfarçado: "renda extra trabalhando de casa $5000/mês", "negócio online sem experiência"
  - "Trabalho fácil cash sem documento" prometendo valores altos
  - Empréstimo fácil sem score / "aprovação garantida"
  - Vendas de documentos: SSN, ITIN, driver's license, status migratório

**illegal** — Conteúdo claramente ilegal:
  - Drogas (venda, uso indutivo)
  - Armas (venda sem licença, modificação)
  - Documentos falsos (passport, green card, license, SSN forjados)
  - Recrutamento pra trabalho ilegal explícito
  - Tráfico de pessoas, exploração sexual

**spam** — Sem conteúdo de valor:
  - Mesmo link/contato repostado várias vezes (você não tem histórico, mas use sinais: link nu sem contexto, "DM me", "WhatsApp 555...")
  - Autopromoção pura sem agregar valor à comunidade
  - Link encurtador sem contexto (bit.ly, tinyurl) — sinal forte
  - Texto de copy-paste genérico que não responde nada

**toxic** — Ataques reais a pessoas ou grupos:
  - Racismo, xenofobia, homofobia, antissemitismo (não confundir com discussão política)
  - Ódio direcionado a grupos protegidos
  - Doxing (expor endereço, telefone, local de trabalho de outro user)
  - Assédio sexual, ameaças
  - Bullying repetido a usuário específico

═══════════════════════════════════════════════════════════════
SEVERITY
═══════════════════════════════════════════════════════════════

- **critical**: Golpe claro e direto / ilegal óbvio / doxing / ameaça / ódio explícito. Vai ser ESCONDIDO automaticamente. Só use quando 95%+ certeza.
- **high**: Forte indício de uma das categorias mas com alguma ambiguidade. Vai pra fila do admin com prioridade.
- **medium**: Suspeito mas pode ser legítimo. Sinaliza pra admin revisar sem urgência.
- **low**: Limpo. Conteúdo normal de comunidade. (DEFAULT)

═══════════════════════════════════════════════════════════════
EXEMPLOS BRASILEIROS NOS EUA
═══════════════════════════════════════════════════════════════

✓ low: "Alguém sabe um dentista bom em Orlando que fale português?"
✓ low: "Vendo geladeira Samsung $200, retirar em Round Rock TX"
✓ low: "Caralho que jogo bom do Brasil ontem"
✓ low: "Igreja batista brasileira em Boston, cultos sábado 19h"
✓ low: "Tô procurando job de housekeeping em Miami, tenho referência"

⚠ medium: "Faço imposto $50, mando seu refund em 24h" (preço suspeito, prazo irreal)
⚠ medium: "Quem quer ganhar $3000/semana trabalhando de casa? DM"
⚠ medium: "Vendo iPhone 15 lacrado $300" (preço muito abaixo do mercado, possível golpe)

🚨 high: "Faço documento que parece original, license, SSN, passport" (clara venda de doc falso)
🚨 high: "Renda passiva $10k/mês com nosso sistema, só investir uma vez" (pirâmide)
🚨 high: "Mando dólar pra qualquer banco do Brasil sem taxa, sem perguntas" (câmbio ilegal)

🛑 critical: "Vendo green card R$30 mil, processo garantido" (golpe + ilegal)
🛑 critical: "Mata esses [grupo étnico]" (ódio explícito)
🛑 critical: "O telefone da [nome] é 555-1234 e ela mora na [endereço]" (doxing)

═══════════════════════════════════════════════════════════════
FORMATO DE RESPOSTA — JSON ESTRITO
═══════════════════════════════════════════════════════════════

Responda APENAS um JSON array com um objeto por item, na mesma ordem recebida. Sem markdown, sem comentário, sem texto antes ou depois.

[
  {
    "ref": "<o ref do item>",
    "severity": "low|medium|high|critical",
    "categories": ["scam"|"illegal"|"spam"|"toxic"],
    "reasoning": "frase curta em PT-BR explicando o motivo (máx 140 chars)"
  }
]

Se severity='low', categories pode ser [] (vazio).
Se você não conseguir avaliar um item (texto vazio, ilegível), use severity='low' e reasoning='conteúdo vazio ou ilegível'.`

// ────────────────────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY ausente' })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars ausentes' })
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const stats = { processed: 0, batches: 0, errors: 0, by_severity: { low: 0, medium: 0, high: 0, critical: 0 }, total_cost_usd: 0 }

  // Junta itens pendentes de todas as fontes
  const items = await fetchPending(sb, MAX_TOTAL)
  if (items.length === 0) {
    return res.status(200).json({ ok: true, message: 'Nada pendente', stats })
  }

  // Processa em batches
  for (let i = 0; i < items.length; i += MAX_BATCH) {
    const batch = items.slice(i, i + MAX_BATCH)
    try {
      const verdicts = await classifyBatch(batch)
      await applyVerdicts(sb, batch, verdicts, stats)
      stats.batches++
    } catch (err) {
      console.error('[moderation] batch error:', err.message)
      stats.errors++
      // marca todos do batch como erro pra não travar (próximo cron tenta de novo)
      for (const it of batch) {
        await sb.from('bc_agent_log').insert({
          target_type: it.target_type, target_id: it.target_id,
          severity: 'error', action: 'error', model: MODEL, reasoning: err.message?.slice(0, 500),
        })
      }
    }
  }

  return res.status(200).json({ ok: true, stats })
}

// ────────────────────────────────────────────────────────────────────────────
// FETCH — pega itens pendentes de todas as tabelas
// ────────────────────────────────────────────────────────────────────────────
async function fetchPending(sb, limit) {
  const items = []
  const perTable = Math.ceil(limit / 4)

  // Posts (cobre feed/event/classified/job)
  const { data: posts } = await sb
    .from('bc_posts')
    .select('id, title, body, type, classified_kind, job_category, author_id')
    .eq('agent_status', 'pending')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(perTable)
  for (const p of posts || []) {
    items.push({
      target_type: 'post', target_id: p.id, user_id: p.author_id,
      title: p.title || '',
      content: p.body || '',
      meta: `type=${p.type}${p.classified_kind ? ` kind=${p.classified_kind}` : ''}${p.job_category ? ` job=${p.job_category}` : ''}`,
    })
  }

  // Comments
  const { data: comments } = await sb
    .from('bc_comments')
    .select('id, body, author_id')
    .eq('agent_status', 'pending')
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(perTable)
  for (const c of comments || []) {
    items.push({
      target_type: 'comment', target_id: c.id, user_id: c.author_id,
      title: '', content: c.body || '', meta: 'comment',
    })
  }

  // Businesses
  const { data: businesses } = await sb
    .from('bc_businesses')
    .select('id, name, short_desc, description, category')
    .eq('agent_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(perTable)
  for (const b of businesses || []) {
    items.push({
      target_type: 'business', target_id: b.id, user_id: null,
      title: b.name || '',
      content: b.description || b.short_desc || '',
      meta: `business category=${b.category || '?'}`,
    })
  }

  // Profiles (bio)
  const { data: profiles } = await sb
    .from('bc_profiles')
    .select('id, display_name, full_name, bio, user_id')
    .eq('agent_status', 'pending')
    .not('bio', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(perTable)
  for (const pr of profiles || []) {
    items.push({
      target_type: 'profile', target_id: pr.id, user_id: pr.user_id,
      title: pr.display_name || pr.full_name || '',
      content: pr.bio || '',
      meta: 'profile-bio',
    })
  }

  return items.slice(0, limit)
}

// ────────────────────────────────────────────────────────────────────────────
// CLASSIFY — manda batch pro Claude
// ────────────────────────────────────────────────────────────────────────────
async function classifyBatch(batch) {
  const userMsg = batch.map((it, idx) => {
    const ref = `${it.target_type}-${idx}`
    const title = (it.title || '').slice(0, 200).replace(/\n/g, ' ')
    const body  = (it.content || '').slice(0, MAX_CONTENT_CH).replace(/\n/g, '\\n')
    return `[ref=${ref}] [${it.meta}]\nTÍTULO: ${title}\nCONTEÚDO: ${body}`
  }).join('\n\n---\n\n')

  const t0 = Date.now()
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VER,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: `Classifique os ${batch.length} itens abaixo:\n\n${userMsg}` },
      ],
    }),
  })

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    throw new Error(`Anthropic ${resp.status}: ${errBody.slice(0, 300)}`)
  }

  const data = await resp.json()
  const duration = Date.now() - t0
  const text = data.content?.[0]?.text || ''
  const usage = data.usage || {}

  // Parse JSON da resposta
  let parsed
  try {
    const jsonStart = text.indexOf('[')
    const jsonEnd   = text.lastIndexOf(']') + 1
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd))
  } catch (e) {
    throw new Error(`JSON parse: ${e.message} | raw: ${text.slice(0, 200)}`)
  }

  // Casa cada verdict com seu item pelo ref
  const verdicts = batch.map((it, idx) => {
    const ref = `${it.target_type}-${idx}`
    const v = parsed.find(x => x.ref === ref) || {}
    return {
      severity: v.severity || 'low',
      categories: Array.isArray(v.categories) ? v.categories : [],
      reasoning: (v.reasoning || '').slice(0, 500),
    }
  })

  // Custo (rateado igual entre itens do batch)
  const cost = (
    (usage.input_tokens || 0) * PRICE_IN +
    (usage.output_tokens || 0) * PRICE_OUT +
    (usage.cache_read_input_tokens || 0) * PRICE_READ +
    (usage.cache_creation_input_tokens || 0) * PRICE_WRITE
  )

  for (const v of verdicts) {
    v._tokens_in = Math.round((usage.input_tokens || 0) / batch.length)
    v._tokens_out = Math.round((usage.output_tokens || 0) / batch.length)
    v._cache_read = Math.round((usage.cache_read_input_tokens || 0) / batch.length)
    v._cache_write = Math.round((usage.cache_creation_input_tokens || 0) / batch.length)
    v._cost = cost / batch.length
    v._duration = Math.round(duration / batch.length)
  }

  return verdicts
}

// ────────────────────────────────────────────────────────────────────────────
// APPLY — atualiza tabela origem + grava log
// ────────────────────────────────────────────────────────────────────────────
async function applyVerdicts(sb, batch, verdicts, stats) {
  for (let i = 0; i < batch.length; i++) {
    const it = batch[i]
    const v = verdicts[i]

    const action = decideAction(v.severity)
    const updateBase = {
      agent_status: action.status,
      agent_severity: v.severity,
      agent_categories: v.categories,
      agent_reasoning: v.reasoning,
      agent_checked_at: new Date().toISOString(),
    }

    // Critical: auto-esconde (is_deleted=true ou active=false)
    if (action.hide) {
      if (it.target_type === 'post' || it.target_type === 'comment') {
        updateBase.is_deleted = true
      } else if (it.target_type === 'business') {
        // não desativa business via agente — só flag; admin decide
        // (negócios pagos não podem sumir sem revisão humana)
        updateBase.agent_status = 'flagged'
        action.hide = false
      }
      // profile: só flag, admin banimento separado
    }

    const tableName = TABLE_BY_TYPE[it.target_type]
    await sb.from(tableName).update(updateBase).eq('id', it.target_id)

    // Log
    await sb.from('bc_agent_log').insert({
      target_type: it.target_type,
      target_id: it.target_id,
      severity: v.severity,
      categories: v.categories,
      reasoning: v.reasoning,
      action: updateBase.agent_status,
      model: MODEL,
      tokens_in: v._tokens_in,
      tokens_out: v._tokens_out,
      cache_read: v._cache_read,
      cache_write: v._cache_write,
      cost_usd: v._cost,
      duration_ms: v._duration,
    })

    // Critical: cria report automático pra deixar rastro
    if (v.severity === 'critical' && (it.target_type === 'post' || it.target_type === 'comment')) {
      await sb.from('bc_reports').insert({
        reporter_id: null,
        target_type: it.target_type,
        target_id: it.target_id,
        reason: v.categories[0] || 'other',
        details: `[Agente IA] ${v.reasoning}`,
        status: 'pending',
      }).single().then(() => {}).catch(() => {})
    }

    stats.processed++
    stats.by_severity[v.severity] = (stats.by_severity[v.severity] || 0) + 1
    stats.total_cost_usd += v._cost || 0
  }
}

function decideAction(severity) {
  if (severity === 'critical') return { status: 'auto_hidden', hide: true }
  if (severity === 'high')     return { status: 'flagged',     hide: false }
  if (severity === 'medium')   return { status: 'flagged',     hide: false }
  return { status: 'clean', hide: false }
}

const TABLE_BY_TYPE = {
  post: 'bc_posts',
  comment: 'bc_comments',
  business: 'bc_businesses',
  profile: 'bc_profiles',
}
