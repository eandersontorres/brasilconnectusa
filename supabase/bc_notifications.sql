-- ════════════════════════════════════════════════════════════════════════
-- Notificacoes in-app (sino com badge)
-- Disparadas em eventos: novo comentario, mention, RSVP, pedido novo, etc.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_notifications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID,                                 -- destinatario (auth user)
  user_email    TEXT,                                 -- ou destinatario por email (se sem user_id)
  type          TEXT NOT NULL,                        -- mention | comment | rsvp | order_new | order_status | community_join | system
  title         TEXT NOT NULL,
  body          TEXT,
  url           TEXT,                                 -- link pra abrir
  icon          TEXT,                                 -- emoji opcional
  metadata      JSONB,                                -- dados extras (post_id, order_id, etc)
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user      ON bc_notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_email     ON bc_notifications(user_email, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_created   ON bc_notifications(created_at DESC);

ALTER TABLE bc_notifications DISABLE ROW LEVEL SECURITY;
