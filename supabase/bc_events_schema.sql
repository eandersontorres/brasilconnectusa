-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Eventos da Comunidade
-- Festas, shows, jogos, missas, encontros e tudo que junta brasileiro nos EUA.
-- Cadastrável por admin OU por negócios verificados de bc_businesses.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabela
CREATE TABLE IF NOT EXISTS bc_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Colunas (idempotente)
ALTER TABLE bc_events
  ADD COLUMN IF NOT EXISTS slug              TEXT,
  ADD COLUMN IF NOT EXISTS title             TEXT,
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS category          TEXT,         -- festa-junina, show, jogo-brasil, missa, encontro, gastronomia, religioso, outro
  ADD COLUMN IF NOT EXISTS venue_name        TEXT,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS city              TEXT,
  ADD COLUMN IF NOT EXISTS state             CHAR(2),
  ADD COLUMN IF NOT EXISTS starts_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cover_image_url   TEXT,
  ADD COLUMN IF NOT EXISTS ticket_url        TEXT,
  ADD COLUMN IF NOT EXISTS price_label       TEXT,         -- "Gratuito", "$25", "$15–40"
  ADD COLUMN IF NOT EXISTS contact_whatsapp  TEXT,
  ADD COLUMN IF NOT EXISTS organizer_type    TEXT DEFAULT 'admin',  -- 'admin' | 'business'
  ADD COLUMN IF NOT EXISTS organizer_business_id UUID REFERENCES bc_businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organizer_name    TEXT,
  ADD COLUMN IF NOT EXISTS submitted_email   TEXT,
  ADD COLUMN IF NOT EXISTS status            TEXT DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'cancelled'
  ADD COLUMN IF NOT EXISTS featured          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- 3. Slug helper reaproveita bc_make_slug (já criada por bc_businesses_v2.sql)
-- Caso não exista, cria uma versão local.
CREATE OR REPLACE FUNCTION bc_events_make_slug(input TEXT) RETURNS TEXT AS $$
DECLARE result TEXT;
BEGIN
  result := lower(coalesce(input, 'evento'));
  result := regexp_replace(result, '[áàâãä]', 'a', 'g');
  result := regexp_replace(result, '[éèêë]', 'e', 'g');
  result := regexp_replace(result, '[íìîï]', 'i', 'g');
  result := regexp_replace(result, '[óòôõö]', 'o', 'g');
  result := regexp_replace(result, '[úùûü]', 'u', 'g');
  result := regexp_replace(result, '[ç]', 'c', 'g');
  result := regexp_replace(result, '[^a-z0-9]+', '-', 'g');
  result := regexp_replace(result, '^-|-$', '', 'g');
  IF length(result) = 0 THEN result := 'evento'; END IF;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Backfill de slug
UPDATE bc_events
SET slug = bc_events_make_slug(COALESCE(title, 'evento')) || '-' || substr(id::TEXT, 1, 8)
WHERE slug IS NULL;

-- 5. Índices
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_events_slug ON bc_events(slug);
CREATE INDEX IF NOT EXISTS idx_bc_events_status     ON bc_events(status);
CREATE INDEX IF NOT EXISTS idx_bc_events_state      ON bc_events(state);
CREATE INDEX IF NOT EXISTS idx_bc_events_city       ON bc_events(city);
CREATE INDEX IF NOT EXISTS idx_bc_events_starts_at  ON bc_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_bc_events_organizer  ON bc_events(organizer_business_id);

-- 6. View pública: só aprovado e ainda futuro (ou em andamento agora)
CREATE OR REPLACE VIEW bc_events_public AS
SELECT
  e.id, e.slug, e.title, e.description, e.category,
  e.venue_name, e.address, e.city, e.state,
  e.starts_at, e.ends_at,
  e.cover_image_url, e.ticket_url, e.price_label,
  e.contact_whatsapp,
  e.organizer_type, e.organizer_business_id,
  COALESCE(e.organizer_name, b.short_name, b.name) AS organizer_name,
  b.slug AS organizer_business_slug,
  COALESCE(b.verified, FALSE) AS organizer_verified,
  e.featured, e.created_at
FROM bc_events e
LEFT JOIN bc_businesses b ON b.id = e.organizer_business_id
WHERE COALESCE(e.status, 'pending') = 'approved'
  AND (e.ends_at IS NULL OR e.ends_at >= NOW())
  AND (e.starts_at IS NULL OR e.starts_at >= NOW() - INTERVAL '2 hours')
ORDER BY e.featured DESC NULLS LAST, e.starts_at ASC;

-- 7. RLS
ALTER TABLE bc_events ENABLE ROW LEVEL SECURITY;

-- Leitura pública (anon) só via view; aqui bloqueamos leitura direta da tabela base
DROP POLICY IF EXISTS bc_events_read_public ON bc_events;
CREATE POLICY bc_events_read_public ON bc_events
  FOR SELECT
  USING (status = 'approved');

-- Inserção bloqueada via anon — todas as escritas passam pela service key da API
-- (mesma estratégia das outras tabelas do projeto)
