-- ═════════════════════════════════════════════════════════════════════════════
-- 30/09/2026 · pacote P2 da auditoria · admin com login proprio
-- APLICADO em producao (migration bc_admin_audit). Idempotente.
--
-- Registro de acoes do painel admin: quem fez (e-mail da sessao Supabase, ou
-- 'secret' quando veio pela senha compartilhada), rota, acao e ids envolvidos.
-- Escrito por api/_lib/adminAuth.js em toda chamada que altera algo.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_admin_audit (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_email  text NOT NULL,
  actor_kind   text NOT NULL DEFAULT 'user',   -- user | secret
  method       text NOT NULL,
  path         text NOT NULL,
  action       text,
  target_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           text,
  user_agent   text
);

CREATE INDEX IF NOT EXISTS idx_bc_admin_audit_at     ON public.bc_admin_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_admin_audit_target ON public.bc_admin_audit (target_id) WHERE target_id IS NOT NULL;

ALTER TABLE public.bc_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bc_admin_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.bc_admin_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.bc_admin_audit_id_seq TO service_role;
