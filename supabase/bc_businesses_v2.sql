-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Businesses v2 (ultra defensivo)
-- Funciona se a tabela existir, vazia, ou parcial.
-- ═══════════════════════════════════════════════════════════════

-- 1. Garante que a tabela existe (cria se não)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS bc_businesses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Adiciona TODAS as colunas (não dá erro se já existirem)
ALTER TABLE bc_businesses
  ADD COLUMN IF NOT EXISTS name             TEXT,
  ADD COLUMN IF NOT EXISTS short_name       TEXT,
  ADD COLUMN IF NOT EXISTS slug             TEXT,
  ADD COLUMN IF NOT EXISTS category         TEXT,
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS short_desc       TEXT,
  ADD COLUMN IF NOT EXISTS address          TEXT,
  ADD COLUMN IF NOT EXISTS city             TEXT,
  ADD COLUMN IF NOT EXISTS state            CHAR(2),
  ADD COLUMN IF NOT EXISTS zip              TEXT,
  ADD COLUMN IF NOT EXISTS phone            TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp         TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS doordash         TEXT,
  ADD COLUMN IF NOT EXISTS ubereats         TEXT,
  ADD COLUMN IF NOT EXISTS hours            JSONB,
  ADD COLUMN IF NOT EXISTS plan             TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS listing_plan     TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS tags             TEXT[],
  ADD COLUMN IF NOT EXISTS rating           NUMERIC(3,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews          INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS featured         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emoji            TEXT,
  ADD COLUMN IF NOT EXISTS color            TEXT,
  ADD COLUMN IF NOT EXISTS active           BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_email  TEXT,
  ADD COLUMN IF NOT EXISTS clicks_count     INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- 3. Função slug
CREATE OR REPLACE FUNCTION bc_make_slug(input TEXT) RETURNS TEXT AS $$
DECLARE result TEXT;
BEGIN
  result := lower(coalesce(input, 'business'));
  result := regexp_replace(result, '[áàâãä]', 'a', 'g');
  result := regexp_replace(result, '[éèêë]', 'e', 'g');
  result := regexp_replace(result, '[íìîï]', 'i', 'g');
  result := regexp_replace(result, '[óòôõö]', 'o', 'g');
  result := regexp_replace(result, '[úùûü]', 'u', 'g');
  result := regexp_replace(result, '[ç]', 'c', 'g');
  result := regexp_replace(result, '[^a-z0-9]+', '-', 'g');
  result := regexp_replace(result, '^-|-$', '', 'g');
  IF length(result) = 0 THEN result := 'business'; END IF;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Backfill simples: agora todas as colunas existem, é só rodar
UPDATE bc_businesses SET description  = COALESCE(description, short_desc, name, '') WHERE description IS NULL;
UPDATE bc_businesses SET listing_plan = COALESCE(listing_plan, plan, 'free') WHERE listing_plan IS NULL;
UPDATE bc_businesses SET slug = bc_make_slug(COALESCE(short_name, name, 'biz')) || '-' || substr(id::TEXT, 1, 8) WHERE slug IS NULL;

-- 5. Index único no slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_businesses_slug ON bc_businesses(slug);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_status ON bc_businesses(status);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_category ON bc_businesses(category);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_state ON bc_businesses(state);

-- 6. Tabelas auxiliares
CREATE TABLE IF NOT EXISTS bc_business_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES bc_businesses(id) ON DELETE CASCADE,
  reviewer_email TEXT NOT NULL,
  reviewer_name TEXT,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_breviews_biz ON bc_business_reviews(business_id);

CREATE TABLE IF NOT EXISTS bc_business_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES bc_businesses(id),
  source_email TEXT,
  type TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bc_business_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES bc_businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Trigger de rating
CREATE OR REPLACE FUNCTION bc_update_business_rating()
RETURNS TRIGGER AS $$
DECLARE biz_id UUID;
BEGIN
  biz_id := COALESCE(NEW.business_id, OLD.business_id);
  UPDATE bc_businesses SET
    rating  = COALESCE((SELECT ROUND(AVG(r.rating)::NUMERIC, 1) FROM bc_business_reviews r WHERE r.business_id = biz_id), 0),
    reviews = COALESCE((SELECT COUNT(*) FROM bc_business_reviews r WHERE r.business_id = biz_id), 0)
  WHERE id = biz_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bc_business_rating_trigger ON bc_business_reviews;
CREATE TRIGGER bc_business_rating_trigger
  AFTER INSERT OR UPDATE OR DELETE ON bc_business_reviews
  FOR EACH ROW EXECUTE FUNCTION bc_update_business_rating();

-- 8. View pública
CREATE OR REPLACE VIEW bc_businesses_public AS
SELECT
  id, slug, name, short_name, category, city, state, description,
  phone, whatsapp, website, address, hours,
  COALESCE(listing_plan, plan, 'free') AS listing_plan,
  COALESCE(rating, 0)  AS rating_avg,
  COALESCE(reviews, 0) AS reviews_count,
  COALESCE(verified, FALSE) AS verified,
  emoji, color, COALESCE(featured, FALSE) AS featured, created_at
FROM bc_businesses
WHERE COALESCE(status, 'approved') = 'approved'
  AND COALESCE(active, TRUE) = TRUE
ORDER BY
  CASE COALESCE(listing_plan, plan, 'free')
    WHEN 'premium' THEN 1
    WHEN 'pro'     THEN 2
    ELSE 3
  END,
  rating DESC NULLS LAST,
  featured DESC NULLS LAST;

-- 9. RLS
ALTER TABLE bc_businesses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_business_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_business_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_business_clicks   ENABLE ROW LEVEL SECURITY;
