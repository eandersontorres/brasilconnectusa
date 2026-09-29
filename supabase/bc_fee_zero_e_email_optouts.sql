-- ═════════════════════════════════════════════════════════════════════════════
-- 28/09/2026 · pacote P0 da auditoria
-- APLICADO em producao (migration platform_fee_zero_and_email_optouts).
-- Idempotente: pode rodar de novo sem erro.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Comissao nos pedidos online: 0% (a receita vem da assinatura, como o site promete).
ALTER TABLE public.bc_businesses ALTER COLUMN platform_fee_pct SET DEFAULT 0;
UPDATE public.bc_businesses SET platform_fee_pct = 0 WHERE platform_fee_pct IS DISTINCT FROM 0;

-- 2. Descadastro de e-mails de marketing.
--    Quem clica em "Cancelar inscricao" (api/unsubscribe.js) entra aqui;
--    os crons de drip, onboarding e alertas pulam esses e-mails.
CREATE TABLE IF NOT EXISTS public.bc_email_optouts (
  email      text PRIMARY KEY,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bc_email_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bc_email_optouts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bc_email_optouts TO service_role;
