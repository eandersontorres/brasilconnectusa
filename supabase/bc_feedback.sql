-- ════════════════════════════════════════════════════════════════════════════
-- Feedback in-app — botão "Reportar problema" disponível em todas as telas
-- ════════════════════════════════════════════════════════════════════════════
-- Diferente de bc_contact_messages (Fale Conosco do site público), esta
-- tabela captura feedback dentro do app SPA, com contexto automático
-- (URL atual, user_agent, user_id se logado).
--
-- Aba "Feedback" no admin/manage prioriza bugs reportados.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,                                -- NULL se anônimo
  user_email    TEXT,                                -- copia denormalizada pra resposta sem JOIN
  type          TEXT NOT NULL DEFAULT 'bug',         -- bug | suggestion | question
  message       TEXT NOT NULL,
  url           TEXT,                                -- onde o user estava (window.location.href)
  user_agent    TEXT,                                -- navegador / OS
  status        TEXT NOT NULL DEFAULT 'open',        -- open | reviewing | resolved | dismissed
  admin_notes   TEXT,
  reviewed_by   TEXT,                                -- admin que mexeu
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_status  ON bc_feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_type    ON bc_feedback(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user    ON bc_feedback(user_id) WHERE user_id IS NOT NULL;

-- RLS: habilitado sem politicas (default-deny) pro anon/authenticated.
-- A API /api/feedback usa SUPABASE_SERVICE_KEY que bypassa RLS, entao
-- inserts da API funcionam normalmente. Browser/anon nao consegue ler
-- feedback dos outros (emails, URLs visitadas) pelo client direto.
ALTER TABLE bc_feedback ENABLE ROW LEVEL SECURITY;
