-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Lista de Espera (Coming Soon)
-- Capturada na página "Em Breve" durante a Fase 3 de implementação
-- Executar no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS bc_waitlist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL UNIQUE,
  city        TEXT,
  source      TEXT,                    -- 'coming_soon', 'instagram', 'whatsapp', etc.
  ip_address  TEXT,
  user_agent  TEXT,
  referer     TEXT,
  notified    BOOLEAN DEFAULT FALSE,   -- marcar TRUE quando enviarmos email de lançamento
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_waitlist_created  ON bc_waitlist(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_waitlist_city     ON bc_waitlist(city);
CREATE INDEX IF NOT EXISTS idx_bc_waitlist_source   ON bc_waitlist(source);
CREATE INDEX IF NOT EXISTS idx_bc_waitlist_notified ON bc_waitlist(notified) WHERE notified = FALSE;

-- RLS: somente service key pode inserir/ler (já enforced pelo .env do server)
ALTER TABLE bc_waitlist ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────
-- View: contagem por dia e por cidade
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_waitlist_stats AS
SELECT
  DATE(created_at AT TIME ZONE 'America/Chicago') AS day,
  source,
  COUNT(*)                                          AS signups,
  COUNT(DISTINCT city) FILTER (WHERE city IS NOT NULL) AS distinct_cities
FROM bc_waitlist
GROUP BY 1, 2
ORDER BY 1 DESC;

CREATE OR REPLACE VIEW bc_waitlist_by_city AS
SELECT
  COALESCE(city, '(não informada)') AS city,
  COUNT(*)                            AS total
FROM bc_waitlist
GROUP BY city
ORDER BY total DESC;

-- ───────────────────────────────────────────────────────────────
-- Trigger: atualizar updated_at no upsert
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bc_waitlist_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bc_waitlist_updated_at ON bc_waitlist;
CREATE TRIGGER bc_waitlist_updated_at
  BEFORE UPDATE ON bc_waitlist
  FOR EACH ROW
  EXECUTE FUNCTION bc_waitlist_set_updated_at();
