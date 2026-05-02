-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Drip Campaign Tracking
-- Registra qual email do drip cada usuário da waitlist já recebeu
-- Executar APÓS bc_waitlist.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_drip_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL,
  email_step      INT NOT NULL,           -- 1, 2, 3, 4, 5
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  resend_id       TEXT,                   -- ID retornado pela Resend (para tracking)
  status          TEXT DEFAULT 'sent',    -- 'sent', 'failed', 'bounced'
  error_message   TEXT,
  UNIQUE(email, email_step)               -- impede duplicação acidental
);

CREATE INDEX IF NOT EXISTS idx_drip_log_email      ON bc_drip_log(email);
CREATE INDEX IF NOT EXISTS idx_drip_log_step       ON bc_drip_log(email_step);
CREATE INDEX IF NOT EXISTS idx_drip_log_sent_at    ON bc_drip_log(sent_at DESC);

ALTER TABLE bc_drip_log ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────
-- View: progresso do drip por usuário
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_drip_progress AS
SELECT
  w.email,
  w.city,
  w.created_at,
  COALESCE(MAX(d.email_step), 0)                          AS last_step_sent,
  COUNT(d.id)                                              AS total_emails_sent,
  EXTRACT(DAY FROM NOW() - w.created_at)::INT             AS days_since_signup,
  MAX(d.sent_at)                                           AS last_email_at
FROM bc_waitlist w
LEFT JOIN bc_drip_log d ON d.email = w.email AND d.status = 'sent'
GROUP BY w.email, w.city, w.created_at
ORDER BY w.created_at DESC;

-- ───────────────────────────────────────────────────────────────
-- View: candidatos para próximo passo do drip
-- (usuários que devem receber o próximo email AGORA)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_drip_candidates AS
SELECT
  email,
  city,
  created_at,
  last_step_sent,
  CASE
    WHEN last_step_sent = 0 AND days_since_signup >= 0 THEN 1
    WHEN last_step_sent = 1 AND days_since_signup >= 3 THEN 2
    WHEN last_step_sent = 2 AND days_since_signup >= 7 THEN 3
    WHEN last_step_sent = 3 AND days_since_signup >= 14 THEN 4
    WHEN last_step_sent = 4 AND days_since_signup >= 21 THEN 5
    ELSE NULL
  END AS next_step_due
FROM bc_drip_progress
WHERE last_step_sent < 5;
