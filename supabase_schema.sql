-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Schema Principal
-- Executar no SQL Editor do Supabase
-- ═══════════════════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";       -- para jobs agendados (Supabase Pro)

-- ───────────────────────────────────────────────────────────────
-- Regiões / Cidades dos EUA
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_regions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,          -- "Austin, TX"
  state       TEXT NOT NULL,          -- "TX"
  country     TEXT NOT NULL DEFAULT 'US',
  slug        TEXT UNIQUE NOT NULL,   -- "austin-tx"
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bc_regions (name, state, slug) VALUES
  ('Austin, TX',       'TX', 'austin-tx'),
  ('Round Rock, TX',   'TX', 'round-rock-tx'),
  ('Dallas, TX',       'TX', 'dallas-tx'),
  ('Houston, TX',      'TX', 'houston-tx'),
  ('San Antonio, TX',  'TX', 'san-antonio-tx'),
  ('Miami, FL',        'FL', 'miami-fl'),
  ('Orlando, FL',      'FL', 'orlando-fl'),
  ('New York, NY',     'NY', 'new-york-ny'),
  ('Los Angeles, CA',  'CA', 'los-angeles-ca'),
  ('Chicago, IL',      'IL', 'chicago-il'),
  ('Boston, MA',       'MA', 'boston-ma'),
  ('Newark, NJ',       'NJ', 'newark-nj')
ON CONFLICT (slug) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- Perfis de usuário (mapeados ao Supabase Auth)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT,
  region_id   UUID REFERENCES bc_regions(id),
  whatsapp    TEXT,
  bio         TEXT,
  avatar_url  TEXT,
  plan        TEXT DEFAULT 'free' CHECK (plan IN ('free','pro','premium','sponsor')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bc_profiles_updated_at
  BEFORE UPDATE ON bc_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───────────────────────────────────────────────────────────────
-- Negócios brasileiros
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID REFERENCES bc_profiles(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  category      TEXT NOT NULL,        -- 'restaurant','beauty','service','market','other'
  region_id     UUID REFERENCES bc_regions(id),
  address       TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  instagram     TEXT,
  website       TEXT,
  description   TEXT,
  logo_url      TEXT,
  approved      BOOLEAN DEFAULT FALSE,
  plan          TEXT DEFAULT 'basic' CHECK (plan IN ('basic','pro','premium','sponsor')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER bc_businesses_updated_at
  BEFORE UPDATE ON bc_businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_bc_businesses_region ON bc_businesses(region_id);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_category ON bc_businesses(category);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_approved ON bc_businesses(approved);

-- ───────────────────────────────────────────────────────────────
-- Alertas de câmbio
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_rate_alerts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email          TEXT NOT NULL,
  target_rate    NUMERIC(8,4) NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('above','below')),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','triggered','cancelled','trigger_failed')),
  triggered_at   TIMESTAMPTZ,
  triggered_rate NUMERIC(8,4),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_rate_alerts_status  ON bc_rate_alerts(status);
CREATE INDEX IF NOT EXISTS idx_bc_rate_alerts_email   ON bc_rate_alerts(email);

-- RLS: ninguém lê alertas de outros — operações via service key no backend
ALTER TABLE bc_rate_alerts ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────
-- Row Level Security — bc_businesses (leitura pública dos aprovados)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE bc_businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read approved businesses"
  ON bc_businesses FOR SELECT
  USING (approved = TRUE);

CREATE POLICY "Owners manage their businesses"
  ON bc_businesses FOR ALL
  USING (owner_id = auth.uid());
