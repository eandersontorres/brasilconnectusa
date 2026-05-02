-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Web Push Subscriptions (PWA)
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS bc_push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID,                       -- ag_providers.id ou auth user
  endpoint      TEXT UNIQUE NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_user ON bc_push_subscriptions(user_id) WHERE active = TRUE;

ALTER TABLE bc_push_subscriptions ENABLE ROW LEVEL SECURITY;
