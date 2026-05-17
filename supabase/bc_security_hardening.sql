-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Security Hardening (RLS + permissões)
-- Resolve "UNRESTRICTED" marcados em vermelho no Table Editor.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ARQUITETURA DE ACESSO HOJE:
--   - Toda escrita acontece em api/*.js usando SUPABASE_SERVICE_KEY (bypassa RLS)
--   - Frontend usa anon key, mas todo POST passa por /api primeiro
--   - Logo: podemos negar TUDO pra anon nas tabelas sensíveis sem quebrar nada
--
-- O QUE ESSA MIGRATION FAZ:
--   1. Habilita RLS + policy deny-all em TABELAS sensíveis (bc_banned_users
--      + outras tabelas que armazenam PII/leads/dados privados)
--   2. REVOKE SELECT do anon em VIEWS sensíveis (revenue, agendamentos,
--      top clients — informação que NÃO deve ser pública)
--   3. PRESERVA leituras públicas onde fazem sentido (rankings, listings)
--
-- IDEMPOTENTE: pode rodar várias vezes sem efeito colateral.
-- SERVICE_KEY continua acessando tudo (bypass automático de RLS).
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- TABELAS — habilitar RLS + policy deny-all pra anon/authenticated
-- ─────────────────────────────────────────────────────────────────────────

-- Função helper: aplica RLS deny-all numa tabela (idempotente)
DO $$
DECLARE
  t TEXT;
  tables_to_protect TEXT[] := ARRAY[
    'bc_banned_users',          -- moderação: lista de banidos
    'bc_contact_messages',      -- form fale conosco (PII)
    'bc_enterprise_leads',      -- leads B2B (PII)
    'bc_waitlist',              -- emails da waitlist
    'bc_business_leads',        -- leads vindos dos negócios
    'bc_referral_uses',         -- uso de códigos de referral
    'bc_drip_log',              -- log de emails enviados
    'bc_admin_logs',            -- log de ações admin (se existir)
    'bc_notifications',         -- notificações in-app
    'bc_push_subscriptions',    -- subscriptions push web (endpoint/p256dh sensíveis)
    'bc_push_topics',           -- tópicos opt-in
    'bc_geocode_cache'          -- cache (IP + coords)
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_protect
  LOOP
    -- Só age se a tabela existir
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      -- Habilita RLS
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Remove policy antiga (idempotente)
      EXECUTE format('DROP POLICY IF EXISTS deny_all_anon ON public.%I', t);
      -- Cria policy deny-all
      EXECUTE format(
        'CREATE POLICY deny_all_anon ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t
      );
      RAISE NOTICE '✓ RLS aplicado em %', t;
    ELSE
      RAISE NOTICE '⊘ % não existe — pulando', t;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- VIEWS — revogar SELECT do anon em views com dados sensíveis
-- ─────────────────────────────────────────────────────────────────────────
-- Views não suportam RLS direto. Solução: revogar acesso do role anon.
-- SERVICE_KEY usa role 'postgres' (ou 'service_role') que mantém acesso.

DO $$
DECLARE
  v TEXT;
  views_to_protect TEXT[] := ARRAY[
    'ag_revenue_monthly',       -- receita mensal (NUNCA público)
    'ag_upcoming_appointments', -- agendamentos com PII (nome/telefone/data)
    'ag_top_clients',           -- top clientes (pode vazar identidade)
    'ag_providers_with_plan',   -- providers + info de assinatura
    'ag_platform_metrics'       -- métricas internas
  ];
BEGIN
  FOREACH v IN ARRAY views_to_protect
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema = 'public' AND table_name = v) THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v);
      EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', v);
      RAISE NOTICE '✓ SELECT revogado de % pra anon/authenticated', v;
    ELSE
      RAISE NOTICE '⊘ View % não existe — pulando', v;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- VIEWS que CONTINUAM públicas (não tocar — leitura proposital)
-- ─────────────────────────────────────────────────────────────────────────
-- bc_businesses_public          → diretório público
-- bc_bolao_global_standings     → ranking do bolão (público proposital)
-- bc_bolao_state_standings      → ranking por estado (público proposital)
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ─────────────────────────────────────────────────────────────────────────

-- Conta tabelas protegidas
SELECT
  'TABELAS protegidas com RLS deny-all' AS check_type,
  COUNT(*) AS qtd
FROM pg_policies
WHERE schemaname = 'public' AND policyname = 'deny_all_anon';

-- Lista views ainda públicas (deve mostrar só as 3 propositais)
SELECT
  'VIEWS ainda públicas (deve ter só rankings/diretório)' AS check_type,
  v.table_name AS view_name
FROM information_schema.views v
LEFT JOIN information_schema.role_table_grants g
  ON g.table_name = v.table_name
 AND g.grantee = 'anon'
 AND g.privilege_type = 'SELECT'
WHERE v.table_schema = 'public'
  AND g.grantee = 'anon'
ORDER BY v.table_name;

-- Status final
SELECT '✅ bc_security_hardening aplicado' AS status, now() AS executed_at;
