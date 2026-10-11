# Assistente do BrasilConnect (fase 1: chat dentro do app)

Data: 10/10/2026. Branch: `feat/assistente-chat`.

## O que é

Um chat dentro do app (`/app/assistente`) em que o usuário logado pergunta em linguagem
natural ("alguém vendendo bike em Austin?", "preciso de helper amanhã em Orlando") e o
agente procura nas postagens da plataforma e responde com cards clicáveis para os posts.

- Modelo: Claude Haiku 5.5 (`claude-haiku-5-5`), effort `low`, thinking adaptativo (padrão).
- Busca: full-text search do Postgres (config `portuguese` + `unaccent`) numa RPC.
- Custo alvo: ~US$ 0,0005 por pergunta. Sem WhatsApp nesta fase (fase 2: WhatsApp para premium).

## Decisões da fase 1

| Tema | Decisão |
|---|---|
| Quem usa | Só usuário logado (JWT do Supabase via `requireAuthOnly`). |
| Fontes | Só `bc_posts` (todos os tipos). Negócios ficam de fora enquanto `SHOW_BUSINESS=false`. |
| Privacidade | Só posts de comunidade pública (`visibility='public' AND NOT is_private`) **ou** de comunidade em que o usuário é membro (`bc_community_members`). Nunca devolver autor, `classified_contact` ou `job_contact`. O card leva ao post (`/post/<id>`), onde o contato já aparece com login. |
| Moderação | `is_deleted = false` e `agent_status NOT IN ('flagged','auto_hidden')`. Classificado vendido (`classified_status='sold'`) fica de fora. Evento com `event_date` no passado fica de fora. |
| Links | O modelo só cita IDs. O servidor aceita apenas IDs que a busca devolveu nesta requisição e monta os cards. O texto do modelo não tem URL. |
| Cidade | O post não tem cidade: vem da comunidade (`geo_city`, `geo_state`, `latitude`, `longitude`). Escopo, sugestões e a lista de cidades do prompt usam só comunidades oficiais (`is_official`) e públicas. Cidade sem comunidade própria (Round Rock, Kissimmee) é geocodificada (`geocodeWithCache`) e mapeada para comunidades de cidade num raio de 75 mi. Sem cidade na pergunta, vale a cidade do perfil. |
| Helper procurando x disponível | Não existe campo estruturado. O modelo expande os termos e interpreta o texto. Campos de vaga ficam para depois. |
| Cota | 30 perguntas por usuário em 24h (`ASSISTANT_DAILY_LIMIT`), contadas em `bc_assistant_log`. A linha é reservada antes de chamar o modelo (`stop_reason='pending'`) e fechada no fim; falha do lado da Anthropic (429/5xx) não conta. Teto global de US$ 5 em 24h (`ASSISTANT_DAILY_BUDGET_USD`, reservas pendentes entram com custo estimado): acima disso responde 503. Prazo do agente: 25 s a partir do início da requisição (`maxDuration` 30 s). |
| Histórico | Só na sessão do navegador (`sessionStorage`). O cliente manda até 8 mensagens de texto. |
| SDK | `@anthropic-ai/sdk` (oficial). `api/cron/moderation.js` continua com fetch cru por enquanto (há uma migração dele em andamento em outra sessão). |

## Contrato 1: banco (`supabase/bc_assistant.sql`, migration `bc_assistant`)

- Extensões `unaccent` e `pg_trgm` no schema `extensions`.
- `public.bc_unaccent_immutable(text) returns text` IMMUTABLE STRICT PARALLEL SAFE, `search_path=''`.
- Índice GIN de expressão em `bc_posts`:
  `to_tsvector('portuguese', public.bc_unaccent_immutable(lower(coalesce(title,'') || ' ' || coalesce(body,''))))`.
- RPC `public.bc_assistant_search_posts(...)` (SECURITY INVOKER, `search_path=''`, EXECUTE só para `service_role`):

| Parâmetro | Tipo | Significado |
|---|---|---|
| `p_user_id` | uuid | Usuário logado (para visibilidade de comunidades restritas). Obrigatório. |
| `p_terms` | text[] | Termos e sinônimos (PT/EN). Vazio ou null = sem filtro de texto (lista os mais recentes). Cada termo vira palavras pelo radical (stemming `portuguese`), **sem prefixo** (`casa:*` casava `cash`), mais a forma com "s" para o plural do inglês (`job`/`jobs`); AND dentro do termo, OR entre termos. Termos enviados que não sobram (só stopwords) = nenhum resultado. |
| `p_types` | text[] | `question, recommendation, event, classified, job, announcement`. Null = todos. |
| `p_classified_kind` | text | `sell, buy, donate, rent` ou null. Só filtra posts `classified`. |
| `p_community_ids` | uuid[] | Escopo geográfico. Null = sem filtro de lugar. |
| `p_place_terms` | text[] | Nomes do lugar (ex.: `{austin,round rock}`). Quando há `p_community_ids`, posts das comunidades que **não são de cidade/estado oficiais** (general/interest/national e as criadas por usuários) entram só se o texto citar um destes nomes. |
| `p_since` | timestamptz | Só posts criados depois disso. Null = sem limite. |
| `p_limit` | int | Padrão 8, máximo 20. |

Retorno (uma linha por post): `id, type, title, snippet` (até 240 caracteres do body, sem markdown),
`classified_price, classified_kind, classified_status, event_date, event_location, job_pay,
job_location, community_slug, community_name, geo_city, geo_state, created_at, rank`.
Ordenação: relevância de texto (`ts_rank_cd` normalizado, teto 0,3) + bônus de título e de recência; sem termos, mais recentes primeiro.

- Tabela `public.bc_assistant_log` (RLS ligado, sem policy): `id, user_id, question, tool_calls jsonb,
  result_ids uuid[], model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_usd numeric(10,6), stop_reason, duration_ms, error, created_at`. Índices `(user_id, created_at desc)` e `(created_at)`.

## Contrato 2: API (`POST /api/assistente`)

Header `Authorization: Bearer <access_token>` (o `apiFetch` já manda).

Corpo:

```json
{ "messages": [ { "role": "user", "content": "alguém vendendo bike em Austin?" } ] }
```

- Até 8 mensagens, papéis alternados, a última é `user`. Pergunta do usuário com no máximo 500 caracteres; respostas antigas do assistente cortadas em 1.500.

Resposta 200:

```json
{
  "success": true,
  "reply": "Achei 2 anúncios de bike em Austin:",
  "posts": [
    {
      "id": "uuid", "type": "classified", "title": "...", "snippet": "...",
      "price": 120, "classified_kind": "sell", "classified_status": "available",
      "event_date": null, "event_location": null, "job_pay": null,
      "community": { "slug": "austin-br", "name": "Austin Brasileira", "city": "Austin", "state": "TX" },
      "created_at": "2026-10-09T...", "url": "/post/uuid"
    }
  ],
  "suggestions": { "communities": [ { "slug": "austin-br", "name": "Austin Brasileira", "url": "/app/community/austin-br" } ] },
  "quota": { "used": 3, "limit": 30 }
}
```

`suggestions.communities` traz as comunidades do lugar pesquisado (até 3), para o botão
"Postar na comunidade" quando nada foi encontrado.

Erros: `400 {error}` (corpo inválido), `401 {error}` (sem login), `429 {error, quota}` (cota),
`503 {error}` (sem chave da Anthropic ou teto global atingido), `500 {error}` com mensagem amigável.

## Contrato 3: tela (`src/AssistenteScreen.jsx`)

- Rota `/app/assistente` (aba `assistente` em `VALID_TABS`), atrás de `SHOW_ASSISTANT` em `src/lib/features.js`.
- Entradas: botão ✨ no topo mobile, campo de busca do topo desktop (hoje sem função) e um card na aba Buscar.
  A pergunta digitada nessas entradas vai em `sessionStorage['bc_assistente_pending']` e a tela envia sozinha ao abrir.
- Conversa salva em `sessionStorage['bc_assistente_v1']`. Botão "Nova conversa" limpa.
- Cards compactos de post (tipo, título, 2 linhas, preço/data/cidade). Clique abre o post com
  `window.dispatchEvent(new CustomEvent('bc-navigate', { detail: { tab: 'post', slug: id } }))`.
- Sem resultado: mostra a resposta do assistente e os botões das comunidades sugeridas.
- Sem login: chamada para entrar (mesmo padrão das outras telas).

## Próximos passos (fora da fase 1)

- Campos estruturados de vaga (`job_kind` contratando/disponível, data) no formulário de post.
- "Me avisa quando aparecer" via push (já existe `bc_push_subscriptions`).
- WhatsApp para assinantes premium (fase 2), reaproveitando `runAssistant`.
