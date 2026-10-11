/**
 * GET /api/cron/moderation
 *
 * Agente de moderação IA — roda a cada 5 minutos via Vercel cron.
 *
 * Pega até MAX_BATCH itens com agent_status='pending' (posts, comments,
 * businesses, profiles e, da Store, produtos, lojas e avaliações), manda em
 * batch pro Claude Haiku 5.5 com prompt caching no system, e aplica ação por severity:
 *
 * Store: produto e loja só são sinalizados (aprovação humana). Avaliação de
 * comprador high/critical vira status 'hidden' (sai da loja e do produto, médias
 * recalculadas) e aparece na aba Store > Avaliações do admin.
 *
 *   critical → is_deleted=true (auto-hide pesado) + agent_status='auto_hidden'
 *   high     → agent_status='flagged' (visível, ranqueia primeiro na fila)
 *   medium   → agent_status='flagged'
 *   low      → agent_status='clean'
 *
 * Autenticação: `x-cron-secret` header ou `?secret=` query param igual a CRON_SECRET.
 *
 * Modelo: claude-haiku-5-5
 *   $0.10/M input, $0.50/M output, $0.01/M cache read, $0.125/M cache write
 *   (tabela pra prompts até 100K tokens — nossos batches ficam bem abaixo)
 *   System cacheado → ~80% economia em runs subsequentes
 *   Haiku 5.5 vem com thinking adaptativo ligado por padrão; effort 'low' deixa
 *   custo e latência perto do Haiku 4.5, que rodava sem thinking.
 */

import { createClient } from '@supabase/supabase-js'

const MODEL          = 'claude-haiku-5-5'
const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VER  = '2023-06-01'
const MAX_BATCH      = 30           // itens por chamada de Claude (~3000 tokens entrada)
const MAX_TOTAL      = 120          // teto por execução do cron (4 batches max)
const MAX_CONTENT_CH = 1500         // trunca conteúdo longo

// Precificação (USD por milhão de tokens) — Haiku 5.5, prompt ≤ 100K tokens
// (output_tokens já inclui os tokens de thinking)
const PRICE_IN   = 0.10 / 1_000_000
const PRICE_OUT  = 0.50 / 1_000_000
const PRICE_READ = 0.01 / 1_000_000
const PRICE_WRITE = 0.125 / 1_000_000

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

**prohibited** — Produto da BrasilConnect Store (meta começa com "store-product") que não pode ser vendido:
  - Bebida alcoólica (cachaça, cerveja, vinho), tabaco, vape, essência
  - Remédio ou medicamento (inclusive brasileiro: dipirona, Dorflex, Neosaldina), suplemento ou chá com promessa de cura/emagrecimento, CBD/THC
  - Carne, embutido, queijo, laticínio, perecível, comida caseira enviada para outro estado
  - Réplica ou falsificação ("primeira linha", "réplica", "AAA", camisa de time sem ser original)
  - Arma, munição, faca, spray de pimenta, fogos, bateria de lítio solta, animal, planta, semente, gift card, documento
  - Anúncio com telefone, WhatsApp, e-mail, @ ou link para fechar a venda fora da Store
  Produto e loja da Store NUNCA são escondidos pelo agente: um humano aprova tudo. Use high quando o item é claramente proibido e medium quando há dúvida. Para loja (meta "store-seller"), avalie nome e descrição como em business.

**Avaliação da Store** (meta começa com "store-review"): texto que o comprador escreveu sobre um produto que recebeu. Crítica dura, nota baixa e reclamação de atraso ou defeito são LEGÍTIMAS (low). Marque:
  - high + spam: telefone, WhatsApp, e-mail, @ ou link para comprar fora da Store ("chama no zap", "faço mais barato por fora")
  - high + toxic: ofensa pessoal ao vendedor, ódio, ameaça, ou dados pessoais de alguém (endereço, telefone, nome completo de terceiro)
  - medium: dúvida entre crítica legítima e ataque
  Avaliação high ou critical sai do ar até o admin revisar.

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
    "categories": ["scam"|"illegal"|"spam"|"toxic"|"prohibited"],
    "reasoning": "frase curta em PT-BR explicando o motivo (máx 140 chars)"
  }
]

Se severity='low', categories pode ser [] (vazio).
Se você não conseguir avaliar um item (texto vazio, ilegível), use severity='low' e reasoning='conteúdo vazio ou ilegível'.`

// ────────────────────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`; x-cron-secret e ?secret= pra chamadas manuais
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
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
  const perTable = Math.ceil(limit / 7)

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

  // Store: produtos aguardando aprovacao (a IA so sinaliza; o admin decide)
  const { data: products } = await sb
    .from('bc_store_products')
    .select('id, title, description, category_slug, price_cents, tags, condition, origin, hazmat')
    .eq('agent_status', 'pending')
    .eq('status', 'pending_review')
    .order('submitted_at', { ascending: true })
    .limit(perTable)
  for (const pr of products || []) {
    items.push({
      target_type: 'product', target_id: pr.id, user_id: null,
      title: pr.title || '',
      content: pr.description || '',
      meta: `store-product category=${pr.category_slug} price=$${((pr.price_cents || 0) / 100).toFixed(2)} condition=${pr.condition} origin=${pr.origin}${pr.hazmat ? ' hazmat' : ''}${(pr.tags || []).length ? ' tags=' + pr.tags.join(',') : ''}`,
    })
  }

  // Store: lojas (cadastro novo ou dados editados)
  const { data: sellers } = await sb
    .from('bc_store_sellers')
    .select('id, name, tagline, bio, user_id')
    .eq('agent_status', 'pending')
    .neq('status', 'rejected')
    .order('updated_at', { ascending: true })
    .limit(perTable)
  for (const se of sellers || []) {
    items.push({
      target_type: 'store_seller', target_id: se.id, user_id: se.user_id,
      title: se.name || '',
      content: [se.tagline, se.bio].filter(Boolean).join(' — '),
      meta: 'store-seller',
    })
  }

  // Store: avaliacoes de comprador (publicadas na hora; alto risco sai do ar ate o admin ver)
  try {
    // So nota, sem texto: nada para avaliar
    await sb.from('bc_store_reviews')
      .update({ agent_status: 'clean', agent_severity: 'low', agent_checked_at: new Date().toISOString() })
      .eq('agent_status', 'pending').is('body', null)
    const { data: reviews } = await sb
      .from('bc_store_reviews')
      .select('id, rating, body, product_id, seller_id, buyer_user_id')
      .eq('agent_status', 'pending')
      .not('body', 'is', null)
      .order('created_at', { ascending: true })
      .limit(perTable)
    for (const rv of reviews || []) {
      items.push({
        target_type: 'review', target_id: rv.id, user_id: rv.buyer_user_id,
        product_id: rv.product_id, seller_id: rv.seller_id,
        title: `Nota ${rv.rating} de 5`,
        content: rv.body || '',
        meta: `store-review rating=${rv.rating}`,
      })
    }
  } catch (e) {
    console.error('[moderation] avaliacoes da Store:', e.message)
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
      // thinking conta dentro do max_tokens e o tokenizer do 5.5 gera ~30% mais
      // tokens pro mesmo texto — 2048 ficava apertado pra 30 itens
      max_tokens: 8192,
      output_config: { effort: 'low' },
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
  const usage = data.usage || {}

  if (data.stop_reason === 'max_tokens') {
    throw new Error(`Anthropic max_tokens: resposta truncada (${usage.output_tokens} tokens)`)
  }

  // Recusa do classificador de segurança vem como HTTP 200. Lançar erro deixaria o lote
  // em 'pending' e o cron pegaria os mesmos itens a cada 5 min, travando a fila da
  // tabela — então o lote inteiro vai pra revisão humana (medium → flagged, sem ocultar).
  if (data.stop_reason === 'refusal') {
    const category = data.stop_details?.category || 'sem categoria'
    console.warn(`[moderation] refusal (${category}) — ${batch.length} itens enviados pra revisão`)
    const reasoning = `[recusa do modelo: ${category}] revisar manualmente`
    return withUsage(batch.map(() => ({ severity: 'medium', categories: [], reasoning })), usage, duration)
  }

  // A resposta pode começar com blocos `thinking`, então junta só os blocos `text`
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

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

  return withUsage(verdicts, usage, duration)
}

// Custo (rateado igual entre itens do batch)
function withUsage(verdicts, usage, duration) {
  const n = verdicts.length
  const cost = (
    (usage.input_tokens || 0) * PRICE_IN +
    (usage.output_tokens || 0) * PRICE_OUT +
    (usage.cache_read_input_tokens || 0) * PRICE_READ +
    (usage.cache_creation_input_tokens || 0) * PRICE_WRITE
  )

  for (const v of verdicts) {
    v._tokens_in = Math.round((usage.input_tokens || 0) / n)
    v._tokens_out = Math.round((usage.output_tokens || 0) / n)
    v._cache_read = Math.round((usage.cache_read_input_tokens || 0) / n)
    v._cache_write = Math.round((usage.cache_creation_input_tokens || 0) / n)
    v._cost = cost / n
    v._duration = Math.round(duration / n)
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
      else if (it.target_type === 'product' || it.target_type === 'store_seller') {
        // Store: aprovacao e sempre humana; o agente so ordena a fila
        updateBase.agent_status = 'flagged'
        action.hide = false
      }
    }

    // Avaliacao da Store ja publicada: alto risco ou critico sai do ar ate o admin revisar
    const hideReview = it.target_type === 'review' && (v.severity === 'high' || v.severity === 'critical')
    if (hideReview) updateBase.status = 'hidden'

    const tableName = TABLE_BY_TYPE[it.target_type]
    await sb.from(tableName).update(updateBase).eq('id', it.target_id)
    if (hideReview) await recalcStoreRatings(sb, it)

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

/** Media e quantidade de notas visiveis do produto e da loja (depois de esconder uma avaliacao). */
async function recalcStoreRatings(sb, it) {
  const targets = [['bc_store_products', 'product_id', it.product_id], ['bc_store_sellers', 'seller_id', it.seller_id]]
  for (const [table, column, id] of targets) {
    if (!id) continue
    try {
      const { data, error } = await sb.from('bc_store_reviews').select('rating').eq(column, id).eq('status', 'visible').limit(10000)
      if (error) throw new Error(error.message)
      const ratings = (data || []).map(r => Number(r.rating)).filter(n => n >= 1 && n <= 5)
      const avg = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null
      const { error: uErr } = await sb.from(table).update({ rating_avg: avg, rating_count: ratings.length }).eq('id', id)
      if (uErr) throw new Error(uErr.message)
    } catch (e) {
      console.error('[moderation] media de', table, id, e.message)
    }
  }
}

function decideAction(severity) {
  if (severity === 'critical') return { status: 'auto_hidden', hide: true }
  if (severity === 'high')     return { status: 'flagged',     hide: false }
  if (severity === 'medium')   return { status: 'flagged',     hide: false }
  return { status: 'clean', hide: false }
}

const TABLE_BY_TYPE = {
  product: 'bc_store_products',
  store_seller: 'bc_store_sellers',
  review: 'bc_store_reviews',
  post: 'bc_posts',
  comment: 'bc_comments',
  business: 'bc_businesses',
  profile: 'bc_profiles',
}
