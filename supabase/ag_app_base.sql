-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · base
-- Recursos por plano ficam em api/_lib/agendaPlans.js; aqui so o que o banco precisa.
-- NAO APLICADO ainda. Idempotente. Aplicar ANTES do deploy (providerAuth.js le
-- vertical, timezone e app_settings).
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ag_providers
  ADD COLUMN IF NOT EXISTS vertical     text  NOT NULL DEFAULT 'services',          -- 'services' | 'cleaning'
  ADD COLUMN IF NOT EXISTS timezone     text  NOT NULL DEFAULT 'America/New_York',  -- fuso do relogio da profissional
  ADD COLUMN IF NOT EXISTS app_settings jsonb NOT NULL DEFAULT '{}'::jsonb;         -- preferencias do app (meta, % imposto, mensagens)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_providers_vertical_check') THEN
    ALTER TABLE public.ag_providers
      ADD CONSTRAINT ag_providers_vertical_check CHECK (vertical IN ('services', 'cleaning'));
  END IF;
END $$;

-- Perfil novo nascia 'trialing' sem data de fim: teste gratis infinito.
-- Agora o teste sem cartao dura 14 dias a partir do cadastro.
ALTER TABLE public.ag_providers ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');
UPDATE public.ag_providers
   SET trial_ends_at = created_at + interval '14 days'
 WHERE plan_status = 'trialing' AND trial_ends_at IS NULL AND stripe_subscription_id IS NULL;
