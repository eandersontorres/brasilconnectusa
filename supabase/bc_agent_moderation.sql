-- ════════════════════════════════════════════════════════════════════════════
-- Agente de Moderação IA — Claude Haiku 4.5
-- ════════════════════════════════════════════════════════════════════════════
-- Adiciona campos `agent_*` nas tabelas de conteúdo gerado pelo usuário pra
-- triagem automática (a cada 5 min via /api/cron/moderation).
--
-- Fluxo:
--   1. Conteúdo novo entra com agent_status='pending'
--   2. Cron pega lote pendente, manda pro Claude
--   3. Severity 'critical' → is_deleted=true + report automático (humano confirma)
--   4. Severity 'high'     → flagged + fila admin (não esconde, ranqueia primeiro)
--   5. Severity 'medium'   → fila admin (sinal pra revisar)
--   6. Severity 'low'      → agent_status='clean', sai da fila
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Posts (cobre feed, eventos, classifieds/marketplace, jobs) ──────────
ALTER TABLE bc_posts
  ADD COLUMN IF NOT EXISTS agent_status     TEXT DEFAULT 'pending',  -- pending | clean | flagged | auto_hidden | reviewed
  ADD COLUMN IF NOT EXISTS agent_severity   TEXT,                    -- low | medium | high | critical
  ADD COLUMN IF NOT EXISTS agent_categories TEXT[],                  -- ['scam','illegal','spam','toxic']
  ADD COLUMN IF NOT EXISTS agent_reasoning  TEXT,
  ADD COLUMN IF NOT EXISTS agent_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posts_agent_pending
  ON bc_posts(agent_status, created_at)
  WHERE agent_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_posts_agent_queue
  ON bc_posts(agent_severity, agent_checked_at DESC)
  WHERE agent_status IN ('flagged', 'auto_hidden');

-- ── 2. Comments ────────────────────────────────────────────────────────────
ALTER TABLE bc_comments
  ADD COLUMN IF NOT EXISTS agent_status     TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS agent_severity   TEXT,
  ADD COLUMN IF NOT EXISTS agent_categories TEXT[],
  ADD COLUMN IF NOT EXISTS agent_reasoning  TEXT,
  ADD COLUMN IF NOT EXISTS agent_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comments_agent_pending
  ON bc_comments(agent_status, created_at)
  WHERE agent_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_comments_agent_queue
  ON bc_comments(agent_severity, agent_checked_at DESC)
  WHERE agent_status IN ('flagged', 'auto_hidden');

-- ── 3. Businesses (diretório) ──────────────────────────────────────────────
ALTER TABLE bc_businesses
  ADD COLUMN IF NOT EXISTS agent_status     TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS agent_severity   TEXT,
  ADD COLUMN IF NOT EXISTS agent_categories TEXT[],
  ADD COLUMN IF NOT EXISTS agent_reasoning  TEXT,
  ADD COLUMN IF NOT EXISTS agent_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_businesses_agent_pending
  ON bc_businesses(agent_status, created_at)
  WHERE agent_status = 'pending';

-- ── 4. Profiles (bio, display_name) ────────────────────────────────────────
ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS agent_status     TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS agent_severity   TEXT,
  ADD COLUMN IF NOT EXISTS agent_categories TEXT[],
  ADD COLUMN IF NOT EXISTS agent_reasoning  TEXT,
  ADD COLUMN IF NOT EXISTS agent_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_agent_pending
  ON bc_profiles(agent_status, updated_at)
  WHERE agent_status = 'pending';

-- ── 5. Log de cada classificação (auditoria + custo) ───────────────────────
CREATE TABLE IF NOT EXISTS bc_agent_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  target_type     TEXT NOT NULL,           -- post | comment | business | profile
  target_id       UUID NOT NULL,
  severity        TEXT NOT NULL,           -- low | medium | high | critical | error
  categories      TEXT[],
  reasoning       TEXT,
  action          TEXT,                    -- clean | flagged | auto_hidden | error
  model           TEXT,                    -- claude-haiku-4-5
  tokens_in       INT,
  tokens_out      INT,
  cache_read      INT DEFAULT 0,
  cache_write     INT DEFAULT 0,
  cost_usd        NUMERIC(10, 6),
  duration_ms     INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_log_target  ON bc_agent_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_agent_log_recent  ON bc_agent_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_log_severe  ON bc_agent_log(severity, created_at DESC)
  WHERE severity IN ('high', 'critical');

ALTER TABLE bc_agent_log DISABLE ROW LEVEL SECURITY;

-- ── 6. View pra fila do admin (unifica todas as fontes flagged/hidden) ────
CREATE OR REPLACE VIEW bc_agent_queue AS
SELECT * FROM (
  SELECT
    'post'::text                AS target_type,
    p.id                        AS target_id,
    p.author_id                 AS user_id,
    COALESCE(p.title, '')       AS title,
    COALESCE(p.body, '')        AS content,
    p.agent_status,
    p.agent_severity,
    p.agent_categories,
    p.agent_reasoning,
    p.agent_checked_at,
    p.created_at,
    p.is_deleted
  FROM bc_posts p
  WHERE p.agent_status IN ('flagged', 'auto_hidden')

  UNION ALL

  SELECT
    'comment'::text             AS target_type,
    c.id                        AS target_id,
    c.author_id                 AS user_id,
    ''::text                    AS title,
    COALESCE(c.body, '')        AS content,
    c.agent_status,
    c.agent_severity,
    c.agent_categories,
    c.agent_reasoning,
    c.agent_checked_at,
    c.created_at,
    c.is_deleted
  FROM bc_comments c
  WHERE c.agent_status IN ('flagged', 'auto_hidden')

  UNION ALL

  SELECT
    'business'::text            AS target_type,
    b.id                        AS target_id,
    NULL::uuid                  AS user_id,
    COALESCE(b.name, '')        AS title,
    COALESCE(b.description, '') AS content,
    b.agent_status,
    b.agent_severity,
    b.agent_categories,
    b.agent_reasoning,
    b.agent_checked_at,
    b.created_at,
    NOT COALESCE(b.active, TRUE) AS is_deleted
  FROM bc_businesses b
  WHERE b.agent_status IN ('flagged', 'auto_hidden')

  UNION ALL

  SELECT
    'profile'::text             AS target_type,
    pr.id                       AS target_id,
    pr.user_id                  AS user_id,
    COALESCE(pr.display_name, pr.full_name, pr.email) AS title,
    COALESCE(pr.bio, '')        AS content,
    pr.agent_status,
    pr.agent_severity,
    pr.agent_categories,
    pr.agent_reasoning,
    pr.agent_checked_at,
    pr.created_at,
    FALSE                       AS is_deleted
  FROM bc_profiles pr
  WHERE pr.agent_status IN ('flagged', 'auto_hidden')
) q
ORDER BY
  CASE q.agent_severity
    WHEN 'critical' THEN 1
    WHEN 'high'     THEN 2
    WHEN 'medium'   THEN 3
    ELSE 4
  END,
  q.agent_checked_at DESC NULLS LAST;
