-- ════════════════════════════════════════════════════════════════════════════
-- RESTAURANT MODE — Schema completo
-- Permite negocios (restaurantes, bakeries, grocery) terem cardapio +
-- aceitar pedidos online com pagamento via Stripe Connect Express.
--
-- Premium feature: gate pelo campo accepts_orders em bc_businesses.
-- Admin libera no /admin/manage por enquanto.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Estende bc_businesses com campos de restaurante ──────────────────────
ALTER TABLE bc_businesses
  ADD COLUMN IF NOT EXISTS accepts_orders BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,                  -- acct_XXXXX
  ADD COLUMN IF NOT EXISTS stripe_onboarded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS prep_time_min INT DEFAULT 30,             -- tempo medio total
  ADD COLUMN IF NOT EXISTS pickup_only BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_radius_miles INT,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_order_cents INT DEFAULT 1000,         -- $10 minimo
  ADD COLUMN IF NOT EXISTS platform_fee_pct DECIMAL(4,2) DEFAULT 2.5,-- 2.5% nossa fee
  ADD COLUMN IF NOT EXISTS owner_email TEXT;                         -- pra notif de pedido novo

CREATE INDEX IF NOT EXISTS idx_businesses_orders ON bc_businesses(accepts_orders) WHERE accepts_orders = true;
CREATE INDEX IF NOT EXISTS idx_businesses_owner_email ON bc_businesses(owner_email);

-- ── 2. Categorias do menu (entradas, pratos, sobremesas, bebidas) ───────────
CREATE TABLE IF NOT EXISTS bc_menu_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES bc_businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  display_order INT DEFAULT 0,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_cat_biz ON bc_menu_categories(business_id, display_order);

-- ── 3. Itens do menu ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES bc_businesses(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES bc_menu_categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  price_cents     INT NOT NULL CHECK (price_cents >= 0),
  photo_url       TEXT,
  available       BOOLEAN DEFAULT true,
  is_featured     BOOLEAN DEFAULT false,
  prep_time_min   INT,                              -- override do tempo do negocio
  ingredients     TEXT,                             -- "Frango, arroz, feijao preto..."
  allergens       TEXT[],                           -- ['gluten', 'lactose', 'amendoim']
  is_vegetarian   BOOLEAN DEFAULT false,
  is_gluten_free  BOOLEAN DEFAULT false,
  is_spicy        BOOLEAN DEFAULT false,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_biz ON bc_menu_items(business_id, available);
CREATE INDEX IF NOT EXISTS idx_menu_items_cat ON bc_menu_items(category_id, display_order);

-- ── 4. Modificadores (opcional, pra Fase 3) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_menu_modifiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       UUID NOT NULL REFERENCES bc_menu_items(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                     -- "Adicional de bacon"
  price_cents   INT DEFAULT 0,                     -- +200 = +$2.00
  is_required   BOOLEAN DEFAULT false,
  group_name    TEXT,                              -- "Tamanho" | "Acompanhamento"
  display_order INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_modifiers_item ON bc_menu_modifiers(item_id, display_order);

-- ── 5. Pedidos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      INT GENERATED ALWAYS AS IDENTITY,           -- humano-friendly: #1, #2...
  business_id       UUID NOT NULL REFERENCES bc_businesses(id),
  customer_email    TEXT NOT NULL,
  customer_name     TEXT,
  customer_phone    TEXT,
  customer_user_id  UUID,                                       -- se logado
  type              TEXT NOT NULL DEFAULT 'pickup',             -- 'pickup' | 'delivery'
  delivery_address  TEXT,
  delivery_city     TEXT,
  delivery_state    TEXT,
  delivery_zip      TEXT,
  delivery_notes    TEXT,                                       -- "Apt 3B, deixar na portaria"
  scheduled_for     TIMESTAMPTZ,                                -- pedido agendado, NULL = ASAP
  status            TEXT DEFAULT 'pending',                     -- pending | confirmed | preparing | ready | delivered | canceled
  notes             TEXT,                                       -- observacoes do cliente
  -- Valores (centavos)
  subtotal_cents    INT NOT NULL,
  delivery_fee_cents INT DEFAULT 0,
  tax_cents         INT DEFAULT 0,
  tip_cents         INT DEFAULT 0,
  total_cents       INT NOT NULL,
  platform_fee_cents INT NOT NULL,                              -- nossa parte (2-3%)
  -- Stripe
  stripe_payment_intent_id TEXT,
  stripe_charge_id  TEXT,
  payment_status    TEXT DEFAULT 'unpaid',                      -- unpaid | paid | refunded | failed
  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT now(),
  confirmed_at      TIMESTAMPTZ,
  preparing_at      TIMESTAMPTZ,
  ready_at          TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  canceled_at       TIMESTAMPTZ,
  cancel_reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_biz ON bc_orders(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON bc_orders(customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON bc_orders(payment_status);

-- ── 6. Itens de cada pedido (snapshot, nao quebra se item for editado depois) ──
CREATE TABLE IF NOT EXISTS bc_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES bc_orders(id) ON DELETE CASCADE,
  menu_item_id      UUID REFERENCES bc_menu_items(id) ON DELETE SET NULL,
  item_name         TEXT NOT NULL,                              -- snapshot
  unit_price_cents  INT NOT NULL,
  quantity          INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  modifiers_json    JSONB,                                      -- snapshot dos modificadores
  notes             TEXT,                                       -- "Sem cebola por favor"
  subtotal_cents    INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON bc_order_items(order_id);

-- ── 7. RLS off (APIs usam service key) ──────────────────────────────────────
ALTER TABLE bc_menu_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_menu_items      DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_menu_modifiers  DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_orders          DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_order_items     DISABLE ROW LEVEL SECURITY;

-- ── 8. Verificacao ──────────────────────────────────────────────────────────
SELECT
  'bc_businesses' AS tabela, COUNT(*) AS total FROM bc_businesses
UNION ALL SELECT 'bc_menu_categories', COUNT(*) FROM bc_menu_categories
UNION ALL SELECT 'bc_menu_items',      COUNT(*) FROM bc_menu_items
UNION ALL SELECT 'bc_menu_modifiers',  COUNT(*) FROM bc_menu_modifiers
UNION ALL SELECT 'bc_orders',          COUNT(*) FROM bc_orders
UNION ALL SELECT 'bc_order_items',     COUNT(*) FROM bc_order_items;
