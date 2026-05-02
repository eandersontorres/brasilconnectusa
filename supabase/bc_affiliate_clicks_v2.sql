-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Migração v2 do tracking de afiliados
-- Adiciona colunas de UTM e campanha (Fase 3 / Módulo 01 + 03)
-- Executar UMA vez no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE bc_affiliate_clicks
  ADD COLUMN IF NOT EXISTS campaign     TEXT,
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT;

CREATE INDEX IF NOT EXISTS idx_bc_clicks_campaign ON bc_affiliate_clicks(campaign);
CREATE INDEX IF NOT EXISTS idx_bc_clicks_utm_source ON bc_affiliate_clicks(utm_source);

-- ───────────────────────────────────────────────────────────────
-- View: cliques por campanha (saber qual conteúdo gera mais clique)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_clicks_by_campaign AS
SELECT
  COALESCE(campaign, '(sem campanha)') AS campaign,
  provider,
  COUNT(*)                             AS total_clicks,
  COUNT(DISTINCT ip_address)           AS unique_visitors,
  MIN(clicked_at)                      AS first_click,
  MAX(clicked_at)                      AS last_click
FROM bc_affiliate_clicks
GROUP BY 1, 2
ORDER BY total_clicks DESC;

-- ───────────────────────────────────────────────────────────────
-- View: funil por origem (utm_source) — aferir efetividade de canal
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_clicks_by_source AS
SELECT
  COALESCE(utm_source, '(direto)') AS source,
  COALESCE(utm_medium, '(none)')   AS medium,
  COUNT(*)                          AS total_clicks,
  COUNT(DISTINCT provider)          AS distinct_providers,
  COUNT(DISTINCT ip_address)        AS unique_visitors
FROM bc_affiliate_clicks
WHERE clicked_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY total_clicks DESC;
