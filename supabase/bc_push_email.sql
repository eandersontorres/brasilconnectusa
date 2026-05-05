-- ════════════════════════════════════════════════════════════════════════
-- Push subscriptions: adiciona user_email para targeting por email
-- (necessario quando o user nao tem auth.users.id mas se identifica por email)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE bc_push_subscriptions
  ADD COLUMN IF NOT EXISTS user_email TEXT;

CREATE INDEX IF NOT EXISTS idx_push_user_email ON bc_push_subscriptions(user_email)
  WHERE active = true AND user_email IS NOT NULL;
