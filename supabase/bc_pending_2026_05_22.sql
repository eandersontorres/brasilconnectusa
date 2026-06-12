-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — SQL consolidado dos pendentes (22/05/2026)
--
-- Junta 3 migrations que ainda nao foram rodadas + 1 update de config:
--   1. anonymous_ranking em bc_bolao_groups (ranking anonimo do bolao)
--   2. bc_onboarding_drip_log + view bc_onboarding_drip_candidates
--   3. UPDATE predictions_deadline = 2026-07-20 (apos a final)
--
-- Tudo idempotente (IF NOT EXISTS / ON CONFLICT). Pode rodar de novo sem erro.
-- Cola no SQL Editor do Supabase e Run.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RANKING ANONIMO (toggle do admin do grupo)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bc_bolao_groups
  ADD COLUMN IF NOT EXISTS anonymous_ranking BOOLEAN DEFAULT false NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DRIP DE ONBOARDING (cron diario manda email pra quem nao completou)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_onboarding_drip_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL,
  email         TEXT NOT NULL,
  email_step    INT  NOT NULL,
  resend_id     TEXT,
  status        TEXT DEFAULT 'sent',
  error_message TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, email_step)
);

CREATE INDEX IF NOT EXISTS idx_onb_drip_log_user ON bc_onboarding_drip_log(user_id);
CREATE INDEX IF NOT EXISTS idx_onb_drip_log_sent ON bc_onboarding_drip_log(sent_at DESC);

ALTER TABLE bc_onboarding_drip_log DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW bc_onboarding_drip_candidates AS
SELECT
  u.id              AS user_id,
  u.email,
  u.created_at      AS signed_up_at,
  p.city,
  p.full_name,
  CASE
    WHEN NOW() - u.created_at > INTERVAL '10 days'
      AND NOT EXISTS (
        SELECT 1 FROM bc_onboarding_drip_log
        WHERE user_id = u.id AND email_step = 3
      )
    THEN 3
    WHEN NOW() - u.created_at > INTERVAL '4 days'
      AND NOT EXISTS (
        SELECT 1 FROM bc_onboarding_drip_log
        WHERE user_id = u.id AND email_step = 2
      )
    THEN 2
    WHEN NOW() - u.created_at > INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM bc_onboarding_drip_log
        WHERE user_id = u.id AND email_step = 1
      )
    THEN 1
    ELSE NULL
  END               AS next_step_due
FROM auth.users u
INNER JOIN bc_profiles p ON p.user_id = u.id
WHERE COALESCE(p.onboarding_completed, false) = false
  AND u.email IS NOT NULL
  AND u.email NOT LIKE '%@brasilconnectusa.com';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DEADLINE DOS PALPITES — depois da final da Copa (regra: trava por jogo)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE bc_bolao_config
SET value = '2026-07-20T00:00:00Z'
WHERE key = 'predictions_deadline';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACAO FINAL
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  '1. anonymous_ranking column'              AS check_,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bc_bolao_groups' AND column_name='anonymous_ranking'
  ) THEN '✓ OK' ELSE '✗ FALHOU' END         AS status_
UNION ALL
SELECT
  '2. bc_onboarding_drip_log table',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name='bc_onboarding_drip_log'
  ) THEN '✓ OK' ELSE '✗ FALHOU' END
UNION ALL
SELECT
  '3. bc_onboarding_drip_candidates view',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.views WHERE table_name='bc_onboarding_drip_candidates'
  ) THEN '✓ OK' ELSE '✗ FALHOU' END
UNION ALL
SELECT
  '4. predictions_deadline atualizado',
  (SELECT value FROM bc_bolao_config WHERE key='predictions_deadline');

-- Bonus: ja mostra quantos candidatos o drip vai pegar no proximo cron
SELECT
  COUNT(*)                                            AS candidatos_total,
  COUNT(*) FILTER (WHERE next_step_due IS NOT NULL)   AS prontos_pra_email,
  COUNT(*) FILTER (WHERE next_step_due = 1)           AS step_1,
  COUNT(*) FILTER (WHERE next_step_due = 2)           AS step_2,
  COUNT(*) FILTER (WHERE next_step_due = 3)           AS step_3
FROM bc_onboarding_drip_candidates;
