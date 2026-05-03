-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect — Bolão Copa 2026 — V3
-- Adiciona:
--   1. Campo state (US) em bc_bolao_members  → ranking por estado
--   2. Campos prize_* em bc_bolao_groups     → premiação configurável
--   3. View bc_bolao_global_standings        → ranking nacional (USA)
--   4. View bc_bolao_state_standings         → ranking por estado
-- Executar APÓS bolao_schema.sql e bolao_schema_v2.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. MEMBERS: adicionar state, country, full_name, whatsapp ───────────────
ALTER TABLE bc_bolao_members
  ADD COLUMN IF NOT EXISTS state       TEXT,
  ADD COLUMN IF NOT EXISTS country     TEXT DEFAULT 'USA',
  ADD COLUMN IF NOT EXISTS full_name   TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp    TEXT;

CREATE INDEX IF NOT EXISTS idx_members_state   ON bc_bolao_members(state);
CREATE INDEX IF NOT EXISTS idx_members_country ON bc_bolao_members(country);

-- ── 2. GROUPS: adicionar premiação e deadline opcional ─────────────────────
ALTER TABLE bc_bolao_groups
  ADD COLUMN IF NOT EXISTS prize_title       TEXT,
  ADD COLUMN IF NOT EXISTS prize_description TEXT,
  ADD COLUMN IF NOT EXISTS prize_first       TEXT,
  ADD COLUMN IF NOT EXISTS prize_second      TEXT,
  ADD COLUMN IF NOT EXISTS prize_third       TEXT,
  ADD COLUMN IF NOT EXISTS prize_updated_at  TIMESTAMPTZ;

-- ── 3. CONFIG GLOBAL ───────────────────────────────────────────────────────
-- Tabela simples para guardar deadline e configs gerais.
-- O deadline é a data MÁXIMA para palpitar/alterar palpites.
CREATE TABLE IF NOT EXISTS bc_bolao_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO bc_bolao_config (key, value) VALUES
  ('predictions_deadline', '2026-06-10T23:59:00Z'),
  ('copa_start_date',      '2026-06-11T19:00:00Z'),
  ('brasil_first_match',   '2026-06-13T22:00:00Z')
ON CONFLICT (key) DO NOTHING;

-- ── 4. VIEW: Ranking GLOBAL (todos os membros do país, USA) ────────────────
CREATE OR REPLACE VIEW bc_bolao_global_standings AS
WITH member_points AS (
  SELECT
    p.member_id,
    SUM(
      CASE
        WHEN m.status = 'finished' AND m.home_score = p.home_score AND m.away_score = p.away_score THEN 3
        WHEN m.status = 'finished' AND SIGN(p.home_score - p.away_score) = SIGN(m.home_score - m.away_score) THEN 1
        ELSE 0
      END
    ) AS total_pts,
    COUNT(*) FILTER (
      WHERE m.status = 'finished' AND m.home_score = p.home_score AND m.away_score = p.away_score
    ) AS exact_count,
    COUNT(*) FILTER (
      WHERE m.status = 'finished'
        AND NOT (m.home_score = p.home_score AND m.away_score = p.away_score)
        AND SIGN(p.home_score - p.away_score) = SIGN(m.home_score - m.away_score)
    ) AS correct_count,
    COUNT(*) FILTER (WHERE m.status = 'finished') AS played
  FROM bc_bolao_predictions p
  JOIN bc_copa_matches m ON m.id = p.match_id
  GROUP BY p.member_id
)
SELECT
  mb.id            AS member_id,
  mb.nickname,
  mb.state,
  mb.country,
  g.id             AS group_id,
  g.name           AS group_name,
  COALESCE(mp.total_pts, 0)      AS total_pts,
  COALESCE(mp.exact_count, 0)    AS exact_count,
  COALESCE(mp.correct_count, 0)  AS correct_count,
  COALESCE(mp.played, 0)         AS played
FROM bc_bolao_members mb
JOIN bc_bolao_groups g ON g.id = mb.group_id
LEFT JOIN member_points mp ON mp.member_id = mb.id;

-- ── 5. RLS desabilitado (API usa service key) ──────────────────────────────
ALTER TABLE bc_bolao_config DISABLE ROW LEVEL SECURITY;

-- ── 6. VERIFICAÇÃO ─────────────────────────────────────────────────────────
SELECT 'Schema v3 aplicado com sucesso' AS status,
       (SELECT COUNT(*) FROM bc_bolao_config) AS configs,
       (SELECT value FROM bc_bolao_config WHERE key = 'predictions_deadline') AS deadline;
