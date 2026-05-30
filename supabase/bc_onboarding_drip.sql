-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Drip de emails pra completar onboarding
--
-- Quem recebe:
--   auth.users com bc_profiles.onboarding_completed = false
--   D+1  → Email 1: Quase la, falta 1 minuto
--   D+4  → Email 2: Veja o que a comunidade ta discutindo
--   D+10 → Email 3: Ultimo lembrete (depois para)
--
-- Anti-spam: tabela bc_onboarding_drip_log com UNIQUE (user_id, email_step)
-- garante que cada user recebe cada step exatamente 1x.
--
-- Quem nao recebe:
--   - Sem email no auth.users
--   - Onboarding ja completo
--   - @brasilconnectusa.com (contas oficiais nao precisam)
--
-- Roda no Supabase SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Tabela de log (deduplica envios) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_onboarding_drip_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL,
  email         TEXT NOT NULL,
  email_step    INT  NOT NULL,                  -- 1, 2 ou 3
  resend_id     TEXT,
  status        TEXT DEFAULT 'sent',            -- 'sent' | 'failed'
  error_message TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, email_step)
);

CREATE INDEX IF NOT EXISTS idx_onb_drip_log_user ON bc_onboarding_drip_log(user_id);
CREATE INDEX IF NOT EXISTS idx_onb_drip_log_sent ON bc_onboarding_drip_log(sent_at DESC);

ALTER TABLE bc_onboarding_drip_log DISABLE ROW LEVEL SECURITY;

-- ── 2. View de candidatos ───────────────────────────────────────────────────
-- Retorna pro cron: user_id, email, city, signed_up_at, next_step_due
-- next_step_due = numero do proximo email a enviar (ou NULL se nenhum)
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

-- ── 3. Verificacao ──────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM bc_onboarding_drip_candidates)                              AS total_candidatos,
  (SELECT COUNT(*) FROM bc_onboarding_drip_candidates WHERE next_step_due IS NOT NULL) AS prontos_pra_enviar,
  (SELECT COUNT(*) FROM bc_onboarding_drip_candidates WHERE next_step_due = 1)      AS step_1,
  (SELECT COUNT(*) FROM bc_onboarding_drip_candidates WHERE next_step_due = 2)      AS step_2,
  (SELECT COUNT(*) FROM bc_onboarding_drip_candidates WHERE next_step_due = 3)      AS step_3;
