-- ═════════════════════════════════════════════════════════════════════════════
-- 28/09/2026 · pacote P1 da auditoria · entrega C (planos do diretorio)
-- APLICADO em producao (migration bc_listing_subscriptions). Idempotente.
--
-- stripe_account_id (ja existia) e a conta Connect pra RECEBER pedidos.
-- stripe_customer_id / stripe_subscription_id sao do negocio como CLIENTE que
-- paga o plano Pro/Premium.
--
-- listing_plan_status espelha o status da assinatura no Stripe:
--   active | trialing | past_due  → plano valendo
--   canceled | unpaid | incomplete | incomplete_expired → volta pro Free
--   NULL → sem assinatura (plano grátis ou dado pelo admin)
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.bc_businesses
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS listing_plan_status    text,
  ADD COLUMN IF NOT EXISTS listing_period_end     timestamptz;

CREATE INDEX IF NOT EXISTS idx_bc_businesses_stripe_subscription
  ON public.bc_businesses (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
