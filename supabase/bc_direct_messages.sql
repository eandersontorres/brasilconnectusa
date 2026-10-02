-- ═════════════════════════════════════════════════════════════════════════════
-- 01/10/2026 · pacote P2 da auditoria · mensagens diretas
-- APLICADO em producao (migration bc_direct_messages). Idempotente.
--
-- Uma conversa por par de pessoas (user_a < user_b). So o backend le e escreve
-- (api/messages.js, service_role). Regras de quem pode escrever pra quem ficam
-- no backend: comunidade em comum pra iniciar, e bloqueio dos dois lados.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_dm_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_message_at      timestamptz,
  last_message_preview text,
  last_sender_id       uuid,
  unread_a             integer NOT NULL DEFAULT 0,
  unread_b             integer NOT NULL DEFAULT 0,
  CONSTRAINT bc_dm_threads_order CHECK (user_a < user_b),
  CONSTRAINT bc_dm_threads_pair UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_bc_dm_threads_a ON public.bc_dm_threads (user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_dm_threads_b ON public.bc_dm_threads (user_b, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.bc_dm_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES public.bc_dm_threads(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_dm_messages_thread ON public.bc_dm_messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_dm_messages_sender ON public.bc_dm_messages (sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bc_user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_bc_user_blocks_blocked ON public.bc_user_blocks (blocked_id);

ALTER TABLE public.bc_dm_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_dm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_user_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bc_dm_threads, public.bc_dm_messages, public.bc_user_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bc_dm_threads, public.bc_dm_messages, public.bc_user_blocks TO service_role;
