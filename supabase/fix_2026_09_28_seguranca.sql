-- ═════════════════════════════════════════════════════════════════════════════
-- Correção de segurança · 28/09/2026 · auditoria da plataforma
--
-- Problema (confirmado ao vivo com a chave anon pública do site):
--   1. A view bc_onboarding_drip_candidates expõe e-mail, nome, cidade e data
--      de cadastro de todo usuário sem onboarding completo (28 linhas hoje).
--   2. A tabela bc_onboarding_drip_log foi criada com RLS desligado e tem
--      e-mails (86 linhas hoje), legíveis e graváveis por qualquer pessoa.
--   3. Funções de métricas (MAU, tamanho do banco/storage, total de usuários)
--      e a função de trigger handle_new_auth_user podem ser chamadas pela anon
--      via /rest/v1/rpc.
--
-- Quem usa esses objetos: só api/cron/drip.js, com a SUPABASE_SERVICE_KEY
-- (service_role ignora RLS e grants). Nada quebra.
--
-- APLICADO em producao em 28/09/2026 (migration fix_2026_09_28_seguranca).
-- Idempotente: pode rodar de novo sem erro.
-- Depois: Dashboard → Advisors → Security → conferir que os 3 ERROs sumiram.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. View de candidatos do drip: só o service_role
REVOKE ALL ON public.bc_onboarding_drip_candidates FROM PUBLIC, anon, authenticated;

-- 2. Log do drip: liga RLS (sem policy = bloqueado pra anon/authenticated)
ALTER TABLE public.bc_onboarding_drip_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bc_onboarding_drip_log FROM PUBLIC, anon, authenticated;

-- 3. Funções SECURITY DEFINER que não devem ser públicas
REVOKE EXECUTE ON FUNCTION public.bc_get_db_size()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bc_get_mau()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bc_get_storage_size()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bc_get_storage_by_bucket() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bc_get_total_users()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user()     FROM PUBLIC, anon, authenticated;

-- 3b. service_role mantem acesso (painel de admin e crons)
GRANT SELECT ON public.bc_onboarding_drip_candidates TO service_role;
GRANT ALL ON public.bc_onboarding_drip_log TO service_role;
GRANT EXECUTE ON FUNCTION public.bc_get_db_size(), public.bc_get_mau(), public.bc_get_storage_size(), public.bc_get_storage_by_bucket(), public.bc_get_total_users() TO service_role;

-- 4. Verificação (deve retornar 0 linhas para anon)
--   Com a chave anon:
--   GET /rest/v1/bc_onboarding_drip_candidates?select=next_step_due  → 401/403
--   GET /rest/v1/bc_onboarding_drip_log?select=email_step            → 401/403 ou []

-- Pendente no painel (não é SQL): Auth → Settings → "Leaked password protection" → ligar.
-- Pendente no repo: remover os "DISABLE ROW LEVEL SECURITY" de
--   supabase/bc_onboarding_drip.sql:37, bc_social_schema_v3.sql:146-152,
--   bc_restaurant_schema.sql:139-143, bolao_schema.sql:56-59, bc_sponsors.sql:78,
--   bc_extras_schema.sql:27, bc_enterprise_leads.sql:27
--   (se alguém rodar esses arquivos de novo, as tabelas voltam a ficar expostas).
