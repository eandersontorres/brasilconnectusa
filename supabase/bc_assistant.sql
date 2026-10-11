-- ═════════════════════════════════════════════════════════════════════════════
-- 10/10/2026 · assistente do app (fase 1) · busca nos posts + log de uso
-- Migration bc_assistant. APLICADO em produção em 10/10/2026. Idempotente.
-- Spec: docs/spec-assistente-chat.md (Contrato 1).
--
-- Quem usa: só api/assistente.js, com a SUPABASE_SERVICE_KEY. Nada aqui fica
-- exposto para anon/authenticated (RLS ligado, GRANT só para service_role).
--
-- 1. unaccent no schema extensions + wrapper IMMUTABLE (o unaccent() da
--    extensão é STABLE e não pode entrar em índice).
-- 2. Índice GIN de full-text em bc_posts (config portuguese, sem acento).
-- 3. RPC bc_assistant_search_posts: texto + visibilidade + moderação + lugar.
-- 4. Tabela bc_assistant_log: cota por usuário, teto de custo e auditoria.
--
-- pg_trgm (citado na spec) não é instalado: a busca não usa trigramas.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. unaccent ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Com SET search_path a função não é inlinada; o índice só exige IMMUTABLE.
-- Atenção: quem grava em bc_posts precisa de EXECUTE aqui (o índice avalia a
-- função no INSERT/UPDATE). Hoje só service_role e postgres gravam posts.
CREATE OR REPLACE FUNCTION public.bc_unaccent_immutable(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$fn$;

REVOKE ALL ON FUNCTION public.bc_unaccent_immutable(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bc_unaccent_immutable(text) TO service_role;

-- 2. Índice de full-text ─────────────────────────────────────────────────────
-- A expressão tem que ser idêntica à do WHERE da RPC, senão o índice não é usado.
CREATE INDEX IF NOT EXISTS idx_posts_fts ON public.bc_posts USING gin (
  to_tsvector('portuguese'::regconfig, public.bc_unaccent_immutable(lower(coalesce(title, '') || ' ' || coalesce(body, ''))))
);

-- 3. RPC de busca ────────────────────────────────────────────────────────────
-- p_terms:         cada termo vira palavras pelo radical (stemming portuguese),
--                  SEM prefixo (casa:* virava 'cas':* e casava cash/casselberry;
--                  moto:* casava motorista). AND dentro do termo, OR entre
--                  termos. O stemmer junta plural/gênero do português, mas não o
--                  plural do inglês (job/jobs, car/cars), então cada palavra leva
--                  também a forma com "s" (e "ies" para -y): {"bike usada","car"}
--                  => ((bike|bikes) & (usada|usadas)) | ((car|cars)).
--                  Stopwords ("de", "a") ficam de fora. Só [a-z0-9] chega na
--                  tsquery, então nada que o usuário digita vira operador.
--                  Null ou vazio = sem filtro de texto (mais recentes, rank 0).
--                  Termos enviados mas que não sobram (só stopwords, escrita não
--                  latina) = nenhum resultado, nunca "os mais recentes".
-- p_community_ids: null = sem filtro de lugar. Com lista (mesmo vazia), entram
--                  os posts dessas comunidades e os das demais comunidades que
--                  NÃO são de cidade/estado oficiais (general/interest/national
--                  e as criadas por usuários) que citam algum p_place_terms no
--                  título, corpo ou local do evento/vaga.
-- rank:            ts_rank_cd normalizado (rank/(rank+1), flag 32) com teto 0,3
--                  + 0,1 se o título casa + 0,1 * exp(-idade/30 dias). Sem
--                  normalização o ts_rank_cd soma 0,1 por ocorrência sem teto e
--                  quem repete a palavra 8x passava na frente do post novo.
-- plan_cache_mode: força plano com os valores reais a cada chamada, para o
--                  "v_query IS NULL OR ..." sumir e o índice GIN ser usado.
CREATE OR REPLACE FUNCTION public.bc_assistant_search_posts(
  p_user_id         uuid,
  p_terms           text[]      DEFAULT NULL,
  p_types           text[]      DEFAULT NULL,
  p_classified_kind text        DEFAULT NULL,
  p_community_ids   uuid[]      DEFAULT NULL,
  p_place_terms     text[]      DEFAULT NULL,
  p_since           timestamptz DEFAULT NULL,
  p_limit           integer     DEFAULT 8
)
RETURNS TABLE (
  id                uuid,
  type              text,
  title             text,
  snippet           text,
  classified_price  numeric,
  classified_kind   text,
  classified_status text,
  event_date        timestamptz,
  event_location    text,
  job_pay           text,
  job_location      text,
  community_slug    text,
  community_name    text,
  geo_city          text,
  geo_state         text,
  created_at        timestamptz,
  rank              real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $fn$
DECLARE
  v_qtext     text;
  v_query     tsquery;
  v_has_terms boolean;
  v_patterns  text[];
  v_limit     integer := least(greatest(coalesce(p_limit, 8), 1), 20);
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  v_has_terms := EXISTS (
    SELECT 1 FROM unnest(p_terms[1:20]) AS t(term) WHERE btrim(coalesce(t.term, '')) <> ''
  );

  -- Monta a tsquery (até 20 termos, 100 caracteres cada)
  SELECT string_agg('(' || t.expr || ')', ' | ' ORDER BY t.n)
    INTO v_qtext
    FROM (
      SELECT u.n,
             string_agg(
               CASE WHEN length(w.word) < 3 OR w.word ~ '[0-9]' OR w.word ~ 's$' THEN w.word
                    ELSE '(' || w.word || ' | ' || w.word || 's'
                         || CASE WHEN w.word ~ '[^aeiou]y$' THEN ' | ' || left(w.word, -1) || 'ies' ELSE '' END
                         || ')'
               END,
               ' & ' ORDER BY w.pos) AS expr
        FROM unnest(p_terms[1:20]) WITH ORDINALITY AS u(term, n)
       CROSS JOIN LATERAL regexp_split_to_table(
               regexp_replace(public.bc_unaccent_immutable(lower(left(u.term, 100))), '[^a-z0-9]+', ' ', 'g'),
               ' ') WITH ORDINALITY AS w(word, pos)
       WHERE w.word <> ''
         -- stopword sai aqui (senão "de" viraria "de | des" e "des" ficaria na query)
         AND length(to_tsvector('portuguese'::regconfig, w.word)) > 0
       GROUP BY u.n
    ) t;

  IF v_qtext IS NOT NULL THEN
    v_query := to_tsquery('portuguese'::regconfig, v_qtext);
    IF numnode(v_query) = 0 THEN
      v_query := NULL;
    END IF;
  END IF;

  -- Mandou termos, mas nenhum sobrou: nada casa (não devolve "os mais recentes")
  IF v_has_terms AND v_query IS NULL THEN
    RETURN;
  END IF;

  -- Nomes do lugar normalizados (sem acento, sem caixa, só [a-z0-9 ]) já como
  -- padrões LIKE de palavra inteira: o texto do post é normalizado uma vez só
  SELECT array_agg(DISTINCT '% ' || x.pl || ' %')
    INTO v_patterns
    FROM (
      SELECT btrim(regexp_replace(public.bc_unaccent_immutable(lower(left(t.term, 100))), '[^a-z0-9]+', ' ', 'g')) AS pl
        FROM unnest(p_place_terms[1:10]) AS t(term)
    ) x
   WHERE x.pl <> '';

  RETURN QUERY
  SELECT p.id,
         p.type,
         p.title,
         CASE WHEN char_length(s.txt) > 240 THEN rtrim(left(s.txt, 239)) || '…' ELSE s.txt END,
         p.classified_price,
         p.classified_kind,
         p.classified_status,
         p.event_date,
         p.event_location,
         p.job_pay,
         p.job_location,
         c.slug,
         c.name,
         c.geo_city,
         c.geo_state,
         p.created_at,
         CASE WHEN v_query IS NULL THEN 0::real ELSE (
           least(ts_rank_cd(to_tsvector('portuguese'::regconfig, public.bc_unaccent_immutable(lower(coalesce(p.title, '') || ' ' || coalesce(p.body, '')))), v_query, 32), 0.3)::float8
           + CASE WHEN to_tsvector('portuguese'::regconfig, public.bc_unaccent_immutable(lower(coalesce(p.title, '')))) @@ v_query
                  THEN 0.1::float8 ELSE 0::float8 END
           + 0.1::float8 * exp(-greatest(coalesce(extract(epoch FROM now() - p.created_at)::float8, 0), 0) / 86400.0 / 30.0)
         )::real END AS r_score
    FROM public.bc_posts p
    JOIN public.bc_communities c ON c.id = p.community_id
   CROSS JOIN LATERAL (
     -- Snippet: tira link/imagem markdown, marcador de lista/citação/título no
     -- começo da linha, ** __ ~~ `, *ênfase* e _ênfase_, • e colapsa espaços
     SELECT btrim(regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(coalesce(p.body, ''), '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
                    '^[ \t]*(>|[-*+][ \t]|#+[ \t]*)', '', 'gn'),
                  '\*\*|__|~~|`+', '', 'g'),
                '(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)', '\1\2', 'g'),
              '•', ' ', 'g'),
            '\s+', ' ', 'g')) AS txt
   ) s
   WHERE NOT coalesce(p.is_deleted, false)
     AND coalesce(p.agent_status, '') NOT IN ('flagged', 'auto_hidden')
     AND NOT (p.type = 'classified' AND coalesce(p.classified_status, '') = 'sold')
     AND NOT (p.type = 'event' AND p.event_date IS NOT NULL AND p.event_date < now() - interval '12 hours')
     -- Visibilidade: comunidade pública ou o usuário é membro
     AND (
       (c.visibility = 'public' AND NOT coalesce(c.is_private, false))
       OR EXISTS (
         SELECT 1 FROM public.bc_community_members m
          WHERE m.community_id = p.community_id
            AND m.user_id = p_user_id
       )
     )
     AND (p_types IS NULL OR cardinality(p_types) = 0 OR p.type = ANY (p_types))
     AND (p_classified_kind IS NULL OR p.type <> 'classified' OR p.classified_kind = p_classified_kind)
     AND (p_since IS NULL OR p.created_at >= p_since)
     -- Lugar. Fora do escopo, só comunidade que não é de cidade/estado oficial
     -- entra, e só se o texto citar o lugar (texto normalizado uma vez por post;
     -- v_patterns NULL => LIKE ANY dá NULL => fica de fora)
     AND (
       p_community_ids IS NULL
       OR p.community_id = ANY (p_community_ids)
       OR (
         (c.type NOT IN ('city', 'state') OR NOT coalesce(c.is_official, false))
         AND (' ' || regexp_replace(public.bc_unaccent_immutable(lower(
                coalesce(p.title, '') || ' ' || coalesce(p.body, '') || ' ' ||
                coalesce(p.event_location, '') || ' ' || coalesce(p.job_location, ''))),
              '[^a-z0-9]+', ' ', 'g') || ' ') LIKE ANY (v_patterns)
       )
     )
     -- Texto (mesma expressão do idx_posts_fts)
     AND (
       v_query IS NULL
       OR to_tsvector('portuguese'::regconfig, public.bc_unaccent_immutable(lower(coalesce(p.title, '') || ' ' || coalesce(p.body, '')))) @@ v_query
     )
   ORDER BY r_score DESC, p.created_at DESC NULLS LAST, p.id
   LIMIT v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bc_assistant_search_posts(uuid, text[], text[], text, uuid[], text[], timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bc_assistant_search_posts(uuid, text[], text[], text, uuid[], text[], timestamptz, integer) TO service_role;

-- 4. Log do assistente ───────────────────────────────────────────────────────
-- Uma linha por pergunta, reservada ANTES de chamar o modelo (stop_reason
-- 'pending') e atualizada no fim. Cota: count(*) do usuário nas últimas 24h,
-- fora as falhas do lado da Anthropic (stop_reason 'unavailable'). Teto global:
-- sum(cost_usd) nas últimas 24h + reservas 'pending' por um custo estimado.
CREATE TABLE IF NOT EXISTS public.bc_assistant_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question           text NOT NULL,
  tool_calls         jsonb DEFAULT '[]'::jsonb,
  result_ids         uuid[] DEFAULT '{}',
  model              text,
  input_tokens       integer DEFAULT 0,
  output_tokens      integer DEFAULT 0,
  cache_read_tokens  integer DEFAULT 0,
  cache_write_tokens integer DEFAULT 0,
  cost_usd           numeric(10,6) DEFAULT 0,
  stop_reason        text,
  duration_ms        integer,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_assistant_log_user    ON public.bc_assistant_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_assistant_log_created ON public.bc_assistant_log (created_at);

ALTER TABLE public.bc_assistant_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bc_assistant_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bc_assistant_log TO service_role;

-- PostgREST enxerga a RPC nova sem esperar o reload automático
NOTIFY pgrst, 'reload schema';
