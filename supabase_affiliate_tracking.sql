-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Tracking de Afiliados
-- Executar APÓS supabase_schema.sql
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- Cliques em links de afiliado
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_affiliate_clicks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider    TEXT NOT NULL,          -- 'wise', 'remitly', 'western_union', 'flight_skyscanner'...
  amount_usd  NUMERIC(10,2),          -- valor que o usuário estava enviando (remessas)
  ip_address  TEXT,
  user_agent  TEXT,
  referer     TEXT,
  clicked_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_clicks_provider   ON bc_affiliate_clicks(provider);
CREATE INDEX IF NOT EXISTS idx_bc_clicks_clicked_at ON bc_affiliate_clicks(clicked_at DESC);

-- RLS: somente service key pode inserir/ler
ALTER TABLE bc_affiliate_clicks ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────
-- View: analytics de cliques por dia e provedor
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_clicks_daily AS
SELECT
  DATE(clicked_at AT TIME ZONE 'America/Chicago') AS day,
  provider,
  COUNT(*)                                          AS total_clicks,
  COUNT(DISTINCT ip_address)                        AS unique_visitors,
  ROUND(AVG(amount_usd)::NUMERIC, 2)                AS avg_amount_usd,
  ROUND(SUM(amount_usd)::NUMERIC, 2)                AS total_amount_usd
FROM bc_affiliate_clicks
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

-- ───────────────────────────────────────────────────────────────
-- View: resumo por provedor (all-time)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_clicks_by_provider AS
SELECT
  provider,
  COUNT(*)                           AS total_clicks,
  COUNT(DISTINCT ip_address)         AS unique_visitors,
  ROUND(AVG(amount_usd)::NUMERIC, 2) AS avg_amount_usd,
  MIN(clicked_at)                    AS first_click,
  MAX(clicked_at)                    AS last_click
FROM bc_affiliate_clicks
GROUP BY provider
ORDER BY total_clicks DESC;

-- ───────────────────────────────────────────────────────────────
-- View: cliques dos últimos 7 dias
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_clicks_last_7_days AS
SELECT
  provider,
  COUNT(*) AS clicks,
  COUNT(DISTINCT ip_address) AS unique_visitors,
  ROUND(SUM(COALESCE(amount_usd, 0))::NUMERIC, 2) AS total_volume_usd
FROM bc_affiliate_clicks
WHERE clicked_at >= NOW() - INTERVAL '7 days'
GROUP BY provider
ORDER BY clicks DESC;
