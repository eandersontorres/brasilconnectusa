-- ═════════════════════════════════════════════════════════════════════════════
-- 28/09/2026 · pacote P1 da auditoria · entrega B (AgendaPro operavel)
-- APLICADO em producao (migration agendapro_operavel). Idempotente.
-- ═════════════════════════════════════════════════════════════════════════════

-- Sinal direto pra profissional (Stripe Connect) ou por fora (Zelle/dinheiro)
ALTER TABLE public.ag_providers
  ADD COLUMN IF NOT EXISTS stripe_account_id      text,
  ADD COLUMN IF NOT EXISTS stripe_onboarded       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_instructions   text;

-- E-mail da cliente: confirmacao e lembrete de 24h
ALTER TABLE public.ag_appointments
  ADD COLUMN IF NOT EXISTS client_email text;

-- O plano de equipes chama 'premium' no codigo e no Stripe; o schema antigo usava 'salao'
UPDATE public.ag_providers SET plan = 'premium' WHERE plan = 'salao';

-- Tem plano valido? Exige assinatura em teste ou ativa.
-- (A versao antiga devolvia TRUE pra quem nunca assinou.)
CREATE OR REPLACE FUNCTION public.ag_provider_has_plan(p_provider_id uuid, p_min_plan text DEFAULT 'starter'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_plan TEXT;
  v_status TEXT;
  v_period_end TIMESTAMPTZ;
  v_plan_rank INT;
  v_min_rank INT;
BEGIN
  SELECT plan, plan_status, current_period_end
    INTO v_plan, v_status, v_period_end
  FROM ag_providers WHERE id = p_provider_id;

  IF v_status IS NULL OR v_status NOT IN ('trialing', 'active') THEN RETURN FALSE; END IF;
  -- 3 dias de folga: o webhook de renovacao pode atrasar
  IF v_period_end IS NOT NULL AND v_period_end < NOW() - INTERVAL '3 days' THEN RETURN FALSE; END IF;

  v_plan_rank := CASE v_plan WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 WHEN 'premium' THEN 3 WHEN 'salao' THEN 3 ELSE 0 END;
  v_min_rank  := CASE p_min_plan WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 WHEN 'premium' THEN 3 WHEN 'salao' THEN 3 ELSE 1 END;

  RETURN v_plan_rank >= v_min_rank;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.ag_provider_has_plan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ag_provider_has_plan(uuid, text) TO service_role;

-- Metricas: o Premium nao entrava no MRR (a view contava 'salao').
-- Nomes de coluna mantidos; premium_subs e trialing_providers entram no fim.
CREATE OR REPLACE VIEW public.ag_platform_metrics AS
 SELECT ( SELECT count(*) FROM ag_providers WHERE ag_providers.active = true) AS active_providers,
    ( SELECT count(*) FROM ag_providers WHERE ag_providers.plan_status = 'active'::text) AS paying_providers,
    ( SELECT count(*) FROM ag_providers WHERE ag_providers.plan = 'starter'::text AND ag_providers.plan_status = 'active'::text) AS starter_subs,
    ( SELECT count(*) FROM ag_providers WHERE ag_providers.plan = 'pro'::text AND ag_providers.plan_status = 'active'::text) AS pro_subs,
    ( SELECT count(*) FROM ag_providers WHERE ag_providers.plan = ANY (ARRAY['premium'::text, 'salao'::text]) AND ag_providers.plan_status = 'active'::text) AS salao_subs,
    ( SELECT count(*) FROM ag_appointments WHERE ag_appointments.status = 'completed'::text AND ag_appointments.completed_at >= (now() - '30 days'::interval)) AS appointments_30d,
    (( SELECT sum(ag_appointments.total_cents) FROM ag_appointments WHERE ag_appointments.status = 'completed'::text AND ag_appointments.completed_at >= (now() - '30 days'::interval)))::numeric / 100.0 AS gmv_30d_usd,
    ( SELECT count(*) FILTER (WHERE ag_providers.plan = 'starter'::text) * 19 + count(*) FILTER (WHERE ag_providers.plan = 'pro'::text) * 39 + count(*) FILTER (WHERE ag_providers.plan = ANY (ARRAY['premium'::text, 'salao'::text])) * 79
           FROM ag_providers WHERE ag_providers.plan_status = 'active'::text) AS mrr_usd,
    ( SELECT count(*) FROM ag_providers WHERE ag_providers.plan = ANY (ARRAY['premium'::text, 'salao'::text]) AND ag_providers.plan_status = 'active'::text) AS premium_subs,
    ( SELECT count(*) FROM ag_providers WHERE ag_providers.plan_status = 'trialing'::text) AS trialing_providers;
