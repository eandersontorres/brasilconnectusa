-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Security Hardening v2 (complemento do v1)
-- Cobre tabelas/views que sobraram após v1 (descobertas pela auditoria).
-- Idempotente — pode rodar quantas vezes precisar.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- TABELAS PII / internas — deny-all pra anon
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  tables_to_protect TEXT[] := ARRAY[
    'bc_profiles',     -- perfis dos usuários (PII)
    'bc_cron_logs'     -- logs internos de cron (não interessa pra ninguém de fora)
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_protect
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS deny_all_anon ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY deny_all_anon ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t
      );
      RAISE NOTICE '✓ RLS deny-all em %', t;
    ELSE
      RAISE NOTICE '⊘ % não existe — pulando', t;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- TABELAS de referência (lookup) — RLS + policy permissiva de leitura
-- ─────────────────────────────────────────────────────────────────────────
-- bc_regions é tipo "lookup" (estados/regiões). Pode ser lido publicamente,
-- só não pode ser escrito. RLS + policy SELECT-only pra anon resolve.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'bc_regions') THEN
    ALTER TABLE public.bc_regions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS allow_public_read ON public.bc_regions;
    CREATE POLICY allow_public_read ON public.bc_regions
      FOR SELECT TO anon, authenticated
      USING (true);
    -- NOTE: sem policy de INSERT/UPDATE/DELETE — só SERVICE_KEY escreve
    RAISE NOTICE '✓ bc_regions: RLS + leitura pública (sem escrita pra anon)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- VIEWS sensíveis — REVOKE SELECT do anon
-- ─────────────────────────────────────────────────────────────────────────
-- Analytics internos, dados de campanhas, status de drip, top referrers,
-- estatísticas de waitlist — tudo isso é dashboard admin, não público.
DO $$
DECLARE
  v TEXT;
  views_to_protect TEXT[] := ARRAY[
    'bc_clicks_by_campaign',
    'bc_clicks_by_provider',
    'bc_clicks_by_source',
    'bc_clicks_daily',
    'bc_clicks_last_7_days',
    'bc_drip_candidates',
    'bc_drip_progress',
    'bc_recent_triggers',
    'bc_reward_eligible',
    'bc_top_referrers',
    'bc_waitlist_by_city',
    'bc_waitlist_progress',
    'bc_waitlist_stats'
  ];
BEGIN
  FOREACH v IN ARRAY views_to_protect
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema = 'public' AND table_name = v) THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v);
      EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', v);
      RAISE NOTICE '✓ SELECT revogado de % (anon + authenticated)', v;
    ELSE
      RAISE NOTICE '⊘ View % não existe — pulando', v;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- VIEWS que CONTINUAM públicas — propositalmente (não tocar)
-- ─────────────────────────────────────────────────────────────────────────
--   bc_businesses_public         → diretório /negocio
--   bc_bolao_global_standings    → ranking público do bolão
--   bc_bolao_state_standings     → ranking por estado
--   bc_events_public             → eventos públicos (quando ativar)
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO FINAL
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Tabelas que AINDA estão sem RLS (idealmente só as 3 públicas, ou zero)
SELECT
  '⚠️ TABELAS sem RLS após v2' AS check_type,
  t.tablename AS nome
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = t.tablename
      AND c.relrowsecurity = true
  )
ORDER BY t.tablename;

-- 2) Views ainda públicas (deve mostrar SÓ as 4 propositais)
SELECT
  '✅ VIEWS ainda públicas (deve ter só rankings/diretório/eventos públicos)' AS check_type,
  v.table_name AS view_name
FROM information_schema.views v
WHERE v.table_schema = 'public'
  AND EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
    WHERE g.table_name = v.table_name
      AND g.grantee = 'anon'
      AND g.privilege_type = 'SELECT'
  )
ORDER BY v.table_name;

-- 3) Total de policies de proteção criadas (v1 + v2)
SELECT
  '📊 Total de policies deny_all_anon' AS check_type,
  COUNT(*) AS qtd
FROM pg_policies
WHERE schemaname = 'public' AND policyname = 'deny_all_anon';

SELECT '✅ bc_security_hardening_v2 aplicado' AS status, now() AS executed_at;
