-- ════════════════════════════════════════════════════════════════════════
-- Moderacao: status nos reports + acoes de admin
-- ════════════════════════════════════════════════════════════════════════

-- Estende bc_reports com status de moderacao
ALTER TABLE bc_reports
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',  -- pending | reviewed | dismissed | actioned
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,               -- admin email/id
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS action_taken TEXT;              -- removed_post | banned_user | warned | none

CREATE INDEX IF NOT EXISTS idx_reports_status ON bc_reports(status, created_at DESC);

-- Lista de users banidos
CREATE TABLE IF NOT EXISTS bc_banned_users (
  user_id     UUID PRIMARY KEY,
  email       TEXT,
  reason      TEXT,
  banned_by   TEXT,
  banned_at   TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ                                  -- NULL = permanente
);

ALTER TABLE bc_banned_users DISABLE ROW LEVEL SECURITY;
