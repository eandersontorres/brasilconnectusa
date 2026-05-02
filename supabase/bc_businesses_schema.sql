-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect – Diretório de Negócios Brasileiros
-- Tabela: bc_businesses
-- Execute no SQL Editor do Supabase
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Criar tabela ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_businesses (
  id              SERIAL PRIMARY KEY,
  name            TEXT        NOT NULL,
  short_name      TEXT,
  category        TEXT        NOT NULL,  -- Restaurante | Mercado | Salão & Beleza | Serviços | Saúde
  short_desc      TEXT,
  address         TEXT,
  city            TEXT,
  state           CHAR(2),
  zip             TEXT,
  phone           TEXT,
  website         TEXT,
  doordash        TEXT,
  ubereats        TEXT,
  hours           JSONB,                 -- [{ day, time }, ...]
  plan            TEXT        NOT NULL DEFAULT 'basic',  -- basic | pro | premium
  tags            TEXT[],
  rating          NUMERIC(3,1) DEFAULT 0,
  reviews         INT          DEFAULT 0,
  featured        BOOLEAN      DEFAULT false,
  emoji           TEXT,
  color           TEXT,
  active          BOOLEAN      DEFAULT true,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── RLS (Row Level Security) ─────────────────────────────────────────────────
ALTER TABLE bc_businesses ENABLE ROW LEVEL SECURITY;

-- Leitura pública (qualquer um pode ver negócios ativos)
CREATE POLICY "public_read_businesses"
  ON bc_businesses FOR SELECT
  USING (active = true);

-- ─── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bc_businesses_category ON bc_businesses (category);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_plan     ON bc_businesses (plan);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_featured ON bc_businesses (featured);
CREATE INDEX IF NOT EXISTS idx_bc_businesses_city     ON bc_businesses (city, state);

-- ─── Trigger: atualiza updated_at automaticamente ─────────────────────────────
CREATE OR REPLACE FUNCTION update_bc_businesses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bc_businesses_updated_at
  BEFORE UPDATE ON bc_businesses
  FOR EACH ROW EXECUTE FUNCTION update_bc_businesses_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- DADOS INICIAIS: TorresBee (primeiro negócio cadastrado)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO bc_businesses (
  name, short_name, category, short_desc,
  address, city, state, zip,
  phone, website, doordash, ubereats,
  hours, plan, tags, rating, reviews, featured, emoji, color
) VALUES (
  'TorresBee Brazilian Cafe & Restaurant',
  'TorresBee',
  'Restaurante',
  'Sabores autênticos do Brasil com ingredientes importados diretamente do Brasil. Picanha, pizzas, coxinha e muito mais.',
  '1901 Town Centre Dr, Ste 150',
  'Round Rock',
  'TX',
  '78664',
  '(512) 987-2578',
  'https://www.torresbeebrazil.com',
  'https://www.doordash.com/en/store/torresbee-brazilian-cafe-&-restaurant-round-rock-29864021/',
  'https://www.ubereats.com/store/torresbee-brazilian-cafe-&-restaurant/jgk0XjAeSHyCcubTazo8Bw',
  '[
    {"day": "Segunda",      "time": "Fechado"},
    {"day": "Terça–Quinta", "time": "11h–21h"},
    {"day": "Sexta–Sábado", "time": "11h–22h"},
    {"day": "Domingo",      "time": "11h–21h"}
  ]'::jsonb,
  'pro',
  ARRAY['Picanha', 'Pizza', 'Coxinha', 'Churrasco', 'Sobremesas', 'Delivery'],
  4.5,
  71,
  true,
  '🐝',
  '#f59e0b'
);

-- ─── Verificar resultado ───────────────────────────────────────────────────────
SELECT
  id, name, category, plan, city, state,
  rating, reviews, featured
FROM bc_businesses
ORDER BY id;
