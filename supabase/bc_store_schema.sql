-- ═════════════════════════════════════════════════════════════════════════════
-- 10/10/2026 · BrasilConnect Store · marketplace de produtos aprovados
-- AINDA NAO APLICADO. Aplicar como migration bc_store_schema. Idempotente.
--
-- Quem le e escreve: so o backend (api/store/*.js, api/admin/store.js,
-- api/cron/store.js, api/stripe/webhook.js), com service_role. O navegador
-- nunca le estas tabelas: RLS ligado, sem policy, REVOKE de anon/authenticated.
--
-- Modelo:
--   bc_store_sellers         a loja de cada vendedor (1 por usuario), aprovada pelo admin
--   bc_store_shipping_zones  para onde a loja entrega (estados/CEPs) e quanto cobra
--   bc_store_products        produtos; so aparecem com status 'approved'
--   bc_store_checkouts       um pagamento (Stripe Checkout) por carrinho
--   bc_store_orders          um pedido por loja dentro do checkout (o "pacote")
--   bc_store_order_items     itens com foto/titulo/preco congelados
-- Pagamento: separate charges and transfers. O dinheiro fica no saldo da
-- plataforma e o repasse (transfer) so sai depois da entrega.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Trigger de updated_at proprio (search_path fixo, sem EXECUTE para anon) ──
CREATE OR REPLACE FUNCTION public.bc_store_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bc_store_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bc_store_set_updated_at() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Configuracao (linha unica, editada no admin)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_config (
  id                          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_enabled              boolean NOT NULL DEFAULT false,  -- vitrine aberta ao publico
  checkout_enabled            boolean NOT NULL DEFAULT false,  -- compras liberadas
  fee_bps                     integer NOT NULL DEFAULT 1000 CHECK (fee_bps BETWEEN 0 AND 5000),  -- comissao (1000 = 10%), PROVISORIO
  fee_fixed_cents             integer NOT NULL DEFAULT 0 CHECK (fee_fixed_cents >= 0),           -- taxa fixa por pedido
  fee_on_shipping             boolean NOT NULL DEFAULT true,   -- comissao incide tambem sobre o frete
  release_days_after_delivery integer NOT NULL DEFAULT 3 CHECK (release_days_after_delivery BETWEEN 0 AND 60),
  release_days_new_seller     integer NOT NULL DEFAULT 7 CHECK (release_days_new_seller BETWEEN 0 AND 60),
  new_seller_orders           integer NOT NULL DEFAULT 5 CHECK (new_seller_orders >= 0),  -- abaixo disso a loja e "nova"
  safety_release_days         integer NOT NULL DEFAULT 30 CHECK (safety_release_days BETWEEN 7 AND 120),  -- enviado sem rastreio final
  local_release_days          integer NOT NULL DEFAULT 3 CHECK (local_release_days BETWEEN 0 AND 60),     -- entrega local/retirada
  auto_cancel_grace_days      integer NOT NULL DEFAULT 2 CHECK (auto_cancel_grace_days BETWEEN 0 AND 30), -- dias uteis apos o prazo de postagem
  dispute_window_days         integer NOT NULL DEFAULT 30 CHECK (dispute_window_days BETWEEN 1 AND 120),  -- apos a entrega
  seller_response_days        integer NOT NULL DEFAULT 2 CHECK (seller_response_days BETWEEN 1 AND 14),   -- dias uteis antes de escalar
  checkout_expires_minutes    integer NOT NULL DEFAULT 30 CHECK (checkout_expires_minutes BETWEEN 30 AND 1440),
  tax_enabled                 boolean NOT NULL DEFAULT false,  -- Stripe Tax (exige registro no painel Stripe)
  agreement_version           text NOT NULL DEFAULT '2026-10-10',
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text
);
INSERT INTO public.bc_store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- Categorias (lista fechada). gated = exige atencao extra do admin
-- (rotulo em ingles, nota fiscal do importador, licenca etc.)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_categories (
  slug          text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name          text NOT NULL,
  description   text,
  gated         boolean NOT NULL DEFAULT false,
  requirements  text,            -- o que o vendedor precisa informar (mostrado no formulario)
  sort          integer NOT NULL DEFAULT 100,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bc_store_categories (slug, name, description, gated, requirements, sort) VALUES
  ('moda',        'Moda e acessórios',        'Roupas, calçados, bolsas, bijuterias. Só produto original.', false, NULL, 10),
  ('artesanato',  'Artesanato e feito à mão', 'Peças feitas pelo próprio vendedor.', false, NULL, 20),
  ('casa',        'Casa e decoração',         'Decoração, cozinha, cama, mesa e banho.', false, NULL, 30),
  ('livros',      'Livros e papelaria',       'Livros, revistas, cadernos, material escolar.', false, NULL, 40),
  ('festas',      'Festas e lembrancinhas',   'Itens de festa, lembrancinhas e personalizados.', false, NULL, 50),
  ('esporte',     'Esporte e torcida',        'Camisas e artigos esportivos. Só produto original, nada de réplica.', false, 'Camisas de time ou seleção só originais. Informe a origem (loja oficial, nota fiscal).', 60),
  ('musica',      'Música e instrumentos',    'Instrumentos, acessórios, discos.', false, NULL, 70),
  ('beleza',      'Beleza e cuidados',        'Cosméticos e higiene lacrados, com rótulo.', true, 'Produto lacrado, com rótulo em inglês (ingredientes) e validade. Nada com alegação de cura. Perfume, esmalte e aerossol só por transporte terrestre (marque "material perigoso").', 80),
  ('alimentos',   'Alimentos e mercearia',    'Industrializados lacrados, de prateleira.', true, 'Só industrializado lacrado, de prateleira, com rótulo em inglês e validade. Proibido: carnes, laticínios, perecíveis, bebidas alcoólicas e comida caseira enviada para outro estado.', 90),
  ('bebe',        'Bebê e infantil',          'Roupas, brinquedos e acessórios infantis.', true, 'Brinquedos e artigos de bebê precisam seguir as normas dos EUA (CPSIA). Nada usado em itens de segurança (cadeirinha, berço).', 100),
  ('eletronicos', 'Eletrônicos e acessórios', 'Acessórios, cabos, capas. Sem baterias soltas.', true, 'Proibido bateria de lítio solta. Informe voltagem (110V) e se tem bateria embutida.', 110),
  ('outros',      'Outros',                   'O que não cabe nas outras categorias.', false, NULL, 900)
ON CONFLICT (slug) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- Lojas (vendedores)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_sellers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email                     text NOT NULL,                 -- e-mail de aviso (vem da conta)
  slug                      text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name                      text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  tagline                   text CHECK (tagline IS NULL OR char_length(tagline) <= 120),
  bio                       text CHECK (bio IS NULL OR char_length(bio) <= 2000),
  logo_url                  text,
  banner_url                text,
  city                      text,
  state                     text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  phone                     text,                          -- privado (so admin)
  status                    text NOT NULL DEFAULT 'pending',
  rejection_reason          text,
  submitted_at              timestamptz NOT NULL DEFAULT now(),
  reviewed_by               text,
  reviewed_at               timestamptz,
  -- Endereco de postagem (privado; vai so para a etiqueta)
  ship_from                 jsonb,   -- {name, company, street1, street2, city, state, zip, phone}
  return_address            jsonb,   -- opcional: endereco/caixa postal de devolucao
  handling_days             integer NOT NULL DEFAULT 2 CHECK (handling_days BETWEEN 1 AND 30),  -- prazo de postagem (dias uteis)
  -- Politicas do vendedor (ele responde pela garantia e devolucao)
  accepts_returns           boolean NOT NULL DEFAULT true,
  return_window_days        integer NOT NULL DEFAULT 7 CHECK (return_window_days BETWEEN 0 AND 90),
  return_policy             text CHECK (return_policy IS NULL OR char_length(return_policy) <= 3000),
  warranty_policy           text CHECK (warranty_policy IS NULL OR char_length(warranty_policy) <= 3000),
  -- Aceite do contrato do vendedor
  agreement_version         text,
  agreement_accepted_at     timestamptz,
  agreement_ip              text,
  -- Stripe Connect (Express) para receber os repasses
  stripe_account_id         text UNIQUE,
  stripe_details_submitted  boolean NOT NULL DEFAULT false,
  stripe_payouts_enabled    boolean NOT NULL DEFAULT false,
  stripe_transfers_active   boolean NOT NULL DEFAULT false,
  stripe_requirements       jsonb,
  -- Shippo (conta gerenciada por vendedor quando a Platform Account estiver ativa)
  shippo_account_id         text,
  shippo_carrier_account_id text,
  -- Regras comerciais
  fee_bps_override          integer CHECK (fee_bps_override IS NULL OR fee_bps_override BETWEEN 0 AND 5000),
  vacation_mode             boolean NOT NULL DEFAULT false,
  -- Saldo devedor da loja (estorno de repasse que o Stripe recusou). Abatido dos proximos repasses.
  debt_cents                integer NOT NULL DEFAULT 0 CHECK (debt_cents >= 0),
  -- Nome/logo/capa novos de loja aprovada esperam o admin aprovar
  pending_changes           jsonb,
  pending_changes_at        timestamptz,
  -- Numeros publicos
  sales_count               integer NOT NULL DEFAULT 0,
  rating_avg                numeric(3,2),
  rating_count              integer NOT NULL DEFAULT 0,
  -- Triagem por IA (mesmo padrao de bc_agent_moderation)
  agent_status              text DEFAULT 'pending',
  agent_severity            text,
  agent_categories          text[],
  agent_reasoning           text,
  agent_checked_at          timestamptz,
  admin_notes               text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_sellers_status_check') THEN
    ALTER TABLE public.bc_store_sellers ADD CONSTRAINT bc_store_sellers_status_check
      CHECK (status IN ('pending','approved','rejected','suspended'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bc_store_sellers_status ON public.bc_store_sellers (status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_bc_store_sellers_pending ON public.bc_store_sellers (submitted_at) WHERE status = 'pending';
DROP TRIGGER IF EXISTS trg_bc_store_sellers_updated ON public.bc_store_sellers;
CREATE TRIGGER trg_bc_store_sellers_updated BEFORE UPDATE ON public.bc_store_sellers
  FOR EACH ROW EXECUTE FUNCTION public.bc_store_set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- Para onde a loja entrega
--   ship            envio por transportadora (etiqueta Shippo ou envio proprio)
--   local_delivery  o vendedor entrega em maos (CEPs listados)
--   pickup          o comprador retira com o vendedor
-- Preco: primeiro item + cada item adicional; gratis acima de free_over_cents.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_shipping_zones (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id             uuid NOT NULL REFERENCES public.bc_store_sellers(id) ON DELETE CASCADE,
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  method                text NOT NULL DEFAULT 'ship',
  states                text[] NOT NULL DEFAULT '{}',   -- siglas de 2 letras (vale para ship e pickup)
  zip_prefixes          text[] NOT NULL DEFAULT '{}',   -- para local_delivery (ex.: '787', '78664')
  rate_first_cents      integer NOT NULL DEFAULT 0 CHECK (rate_first_cents BETWEEN 0 AND 100000),
  rate_additional_cents integer NOT NULL DEFAULT 0 CHECK (rate_additional_cents BETWEEN 0 AND 100000),
  free_over_cents       integer CHECK (free_over_cents IS NULL OR free_over_cents > 0),
  est_days_min          integer CHECK (est_days_min IS NULL OR est_days_min BETWEEN 0 AND 60),
  est_days_max          integer CHECK (est_days_max IS NULL OR est_days_max BETWEEN 0 AND 90),
  pickup_note           text CHECK (pickup_note IS NULL OR char_length(pickup_note) <= 500),  -- mostrado so depois da compra
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_shipping_zones_method_check') THEN
    ALTER TABLE public.bc_store_shipping_zones ADD CONSTRAINT bc_store_shipping_zones_method_check
      CHECK (method IN ('ship','local_delivery','pickup'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bc_store_shipping_zones_seller ON public.bc_store_shipping_zones (seller_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_bc_store_shipping_zones_states ON public.bc_store_shipping_zones USING gin (states);
DROP TRIGGER IF EXISTS trg_bc_store_shipping_zones_updated ON public.bc_store_shipping_zones;
CREATE TRIGGER trg_bc_store_shipping_zones_updated BEFORE UPDATE ON public.bc_store_shipping_zones
  FOR EACH ROW EXECUTE FUNCTION public.bc_store_set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- Produtos
--   draft -> pending_review -> approved | rejected
--   approved -> paused (pelo vendedor) | suspended (pelo admin) | archived
--   Editar titulo, descricao, fotos ou categoria de um aprovado volta para pending_review.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_products (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id          uuid NOT NULL REFERENCES public.bc_store_sellers(id) ON DELETE CASCADE,
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,100}$'),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description        text NOT NULL DEFAULT '' CHECK (char_length(description) <= 8000),
  category_slug      text NOT NULL REFERENCES public.bc_store_categories(slug),
  condition          text NOT NULL DEFAULT 'new',
  origin             text NOT NULL DEFAULT 'other',
  price_cents        integer NOT NULL CHECK (price_cents BETWEEN 50 AND 10000000),
  compare_at_cents   integer CHECK (compare_at_cents IS NULL OR compare_at_cents > 0),
  stock              integer NOT NULL DEFAULT 1 CHECK (stock >= 0),
  sku                text CHECK (sku IS NULL OR char_length(sku) <= 60),
  weight_oz          numeric(8,2) CHECK (weight_oz IS NULL OR weight_oz > 0),
  length_in          numeric(6,2) CHECK (length_in IS NULL OR length_in > 0),
  width_in           numeric(6,2) CHECK (width_in IS NULL OR width_in > 0),
  height_in          numeric(6,2) CHECK (height_in IS NULL OR height_in > 0),
  images             text[] NOT NULL DEFAULT '{}',
  hazmat             boolean NOT NULL DEFAULT false,   -- perfume, esmalte, aerossol: so transporte terrestre
  tags               text[] NOT NULL DEFAULT '{}',
  compliance_notes   text CHECK (compliance_notes IS NULL OR char_length(compliance_notes) <= 2000),  -- so admin
  compliance_images  text[] NOT NULL DEFAULT '{}',     -- rotulo, nota fiscal (so admin)
  search_text        text NOT NULL DEFAULT '',         -- titulo+tags+categoria normalizados (minusculo, sem acento)
  status             text NOT NULL DEFAULT 'draft',
  rejection_reason   text,
  submitted_at       timestamptz,
  reviewed_by        text,
  reviewed_at        timestamptz,
  published_at       timestamptz,
  sales_count        integer NOT NULL DEFAULT 0,
  rating_avg         numeric(3,2),
  rating_count       integer NOT NULL DEFAULT 0,
  agent_status       text DEFAULT 'pending',
  agent_severity     text,
  agent_categories   text[],
  agent_reasoning    text,
  agent_checked_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bc_store_products_images_max CHECK (coalesce(array_length(images, 1), 0) <= 8),
  CONSTRAINT bc_store_products_ready CHECK (
    status IN ('draft','rejected','archived')
    OR (coalesce(array_length(images, 1), 0) >= 1 AND char_length(description) >= 80)
  )
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_products_status_check') THEN
    ALTER TABLE public.bc_store_products ADD CONSTRAINT bc_store_products_status_check
      CHECK (status IN ('draft','pending_review','approved','rejected','paused','suspended','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_products_condition_check') THEN
    ALTER TABLE public.bc_store_products ADD CONSTRAINT bc_store_products_condition_check
      CHECK (condition IN ('new','used_like_new','used_good','handmade'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_products_origin_check') THEN
    ALTER TABLE public.bc_store_products ADD CONSTRAINT bc_store_products_origin_check
      CHECK (origin IN ('handmade','made_in_usa','imported_brazil','other'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bc_store_products_seller ON public.bc_store_products (seller_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_store_products_public ON public.bc_store_products (category_slug, published_at DESC) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_bc_store_products_review ON public.bc_store_products (submitted_at) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_bc_store_products_agent ON public.bc_store_products (agent_status, submitted_at) WHERE agent_status = 'pending';
DROP TRIGGER IF EXISTS trg_bc_store_products_updated ON public.bc_store_products;
CREATE TRIGGER trg_bc_store_products_updated BEFORE UPDATE ON public.bc_store_products
  FOR EACH ROW EXECUTE FUNCTION public.bc_store_set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- Checkout (um pagamento Stripe por carrinho)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_checkouts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_email               text NOT NULL,
  ship_to                   jsonb NOT NULL,  -- {name, line1, line2, city, state, zip, phone}
  items_cents               integer NOT NULL DEFAULT 0 CHECK (items_cents >= 0),
  shipping_cents            integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents                 integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents               integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  status                    text NOT NULL DEFAULT 'pending',
  stripe_session_id         text UNIQUE,
  stripe_payment_intent_id  text,
  stripe_charge_id          text,
  stock_released            boolean NOT NULL DEFAULT false,
  expires_at                timestamptz,
  closed_at                 timestamptz,   -- quando expirou/foi cancelado sem pagamento (mede quanto tempo segurou estoque)
  paid_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_checkouts_status_check') THEN
    ALTER TABLE public.bc_store_checkouts ADD CONSTRAINT bc_store_checkouts_status_check
      CHECK (status IN ('pending','paid','expired','canceled'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bc_store_checkouts_buyer ON public.bc_store_checkouts (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_store_checkouts_pending ON public.bc_store_checkouts (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bc_store_checkouts_pi ON public.bc_store_checkouts (stripe_payment_intent_id);
DROP TRIGGER IF EXISTS trg_bc_store_checkouts_updated ON public.bc_store_checkouts;
CREATE TRIGGER trg_bc_store_checkouts_updated BEFORE UPDATE ON public.bc_store_checkouts
  FOR EACH ROW EXECUTE FUNCTION public.bc_store_set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- Pedido por loja
--   pending_payment -> paid -> shipped -> delivered -> completed
--   paid -> canceled (antes do envio; reembolso integral)
--   pending_payment -> expired (checkout nao pago)
--   shipped/delivered/completed -> refunded (reembolso integral apos envio)
-- payout_status: pending | held | releasing (transfer em andamento) | released | reversed | blocked | none
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bc_store_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number             bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001),
  checkout_id              uuid NOT NULL REFERENCES public.bc_store_checkouts(id) ON DELETE CASCADE,
  seller_id                uuid NOT NULL REFERENCES public.bc_store_sellers(id),
  buyer_user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_email              text NOT NULL,
  ship_to                  jsonb NOT NULL,
  fulfillment              text NOT NULL DEFAULT 'ship',
  zone_id                  uuid REFERENCES public.bc_store_shipping_zones(id) ON DELETE SET NULL,
  zone_snapshot            jsonb,     -- nome, metodo, prazos, pickup_note no momento da compra
  items_cents              integer NOT NULL DEFAULT 0 CHECK (items_cents >= 0),
  shipping_cents           integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents                integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents              integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),  -- itens + frete + imposto
  fee_bps                  integer NOT NULL DEFAULT 0 CHECK (fee_bps >= 0),
  fee_fixed_cents          integer NOT NULL DEFAULT 0 CHECK (fee_fixed_cents >= 0),
  fee_on_shipping          boolean NOT NULL DEFAULT true,
  fee_cents                integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  label_cost_cents         integer NOT NULL DEFAULT 0 CHECK (label_cost_cents >= 0),
  refunded_cents           integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  payout_cents             integer CHECK (payout_cents IS NULL OR payout_cents >= 0),  -- valor transferido a loja
  reversed_cents           integer NOT NULL DEFAULT 0 CHECK (reversed_cents >= 0),     -- estornado da loja depois do repasse
  debt_applied_cents       integer NOT NULL DEFAULT 0 CHECK (debt_applied_cents >= 0), -- divida antiga abatida deste repasse
  debt_restored_cents      integer NOT NULL DEFAULT 0 CHECK (debt_restored_cents >= 0), -- divida devolvida a loja por reembolso posterior
  releasing_at             timestamptz,  -- inicio do repasse em andamento (destrava se a funcao morrer)
  debt_taken_cents         integer NOT NULL DEFAULT 0 CHECK (debt_taken_cents >= 0),   -- divida abatida no repasse em andamento
  status                   text NOT NULL DEFAULT 'pending_payment',
  cancel_reason            text,
  canceled_by              text,      -- buyer | seller | admin | system
  ship_by                  timestamptz,
  paid_at                  timestamptz,
  shipped_at               timestamptz,
  delivered_at             timestamptz,
  completed_at             timestamptz,
  canceled_at              timestamptz,
  buyer_confirmed_at       timestamptz,
  -- Envio
  carrier                  text,
  service                  text,
  tracking_number          text,
  tracking_url             text,
  tracking_status          text,      -- PRE_TRANSIT | TRANSIT | DELIVERED | RETURNED | FAILURE | UNKNOWN
  tracking_substatus       text,
  tracking_updated_at      timestamptz,
  label_status             text NOT NULL DEFAULT 'none',
  label_url                text,
  label_rate_id            text,
  shippo_shipment_id       text,
  shippo_transaction_id    text,
  parcel                   jsonb,     -- {length,width,height,weight_oz} usado na etiqueta
  label_locked_at          timestamptz,  -- compra de etiqueta em andamento (o cron confere na Shippo se travar)
  handoff_scheduled_at     timestamptz,  -- retirada/entrega local combinada para esta data
  -- Repasse
  payout_status            text NOT NULL DEFAULT 'pending',
  release_at               timestamptz,
  stripe_transfer_id       text,
  stripe_reversal_ids      text[] NOT NULL DEFAULT '{}',
  stripe_refund_ids        text[] NOT NULL DEFAULT '{}',
  hold_reason              text,
  -- Garantia BrasilConnect (problema com o pedido)
  dispute_status           text NOT NULL DEFAULT 'none',
  dispute_reason           text,
  dispute_details          text,
  dispute_opened_at        timestamptz,
  dispute_escalated_at     timestamptz,
  dispute_resolved_at      timestamptz,
  dispute_resolution       text,
  last_message_at          timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bc_store_orders_number_unique UNIQUE (order_number)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_orders_status_check') THEN
    ALTER TABLE public.bc_store_orders ADD CONSTRAINT bc_store_orders_status_check
      CHECK (status IN ('pending_payment','paid','shipped','delivered','completed','canceled','refunded','expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_orders_fulfillment_check') THEN
    ALTER TABLE public.bc_store_orders ADD CONSTRAINT bc_store_orders_fulfillment_check
      CHECK (fulfillment IN ('ship','local_delivery','pickup'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_orders_label_status_check') THEN
    ALTER TABLE public.bc_store_orders ADD CONSTRAINT bc_store_orders_label_status_check
      CHECK (label_status IN ('none','purchasing','purchased','failed','refund_requested','refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_orders_payout_status_check') THEN
    ALTER TABLE public.bc_store_orders ADD CONSTRAINT bc_store_orders_payout_status_check
      CHECK (payout_status IN ('pending','held','releasing','released','reversed','blocked','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bc_store_orders_dispute_status_check') THEN
    ALTER TABLE public.bc_store_orders ADD CONSTRAINT bc_store_orders_dispute_status_check
      CHECK (dispute_status IN ('none','open','escalated','resolved_refund','resolved_release','chargeback'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_checkout ON public.bc_store_orders (checkout_id);
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_seller ON public.bc_store_orders (seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_buyer ON public.bc_store_orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_tracking ON public.bc_store_orders (upper(tracking_number)) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_label_lock ON public.bc_store_orders (label_locked_at) WHERE label_status = 'purchasing';
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_to_ship ON public.bc_store_orders (ship_by) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_release ON public.bc_store_orders (status, payout_status) WHERE payout_status IN ('pending','blocked');
CREATE INDEX IF NOT EXISTS idx_bc_store_orders_dispute ON public.bc_store_orders (dispute_status, dispute_opened_at) WHERE dispute_status IN ('open','escalated','chargeback');
DROP TRIGGER IF EXISTS trg_bc_store_orders_updated ON public.bc_store_orders;
CREATE TRIGGER trg_bc_store_orders_updated BEFORE UPDATE ON public.bc_store_orders
  FOR EACH ROW EXECUTE FUNCTION public.bc_store_set_updated_at();

CREATE TABLE IF NOT EXISTS public.bc_store_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.bc_store_orders(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES public.bc_store_products(id) ON DELETE SET NULL,
  title             text NOT NULL,
  image_url         text,
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  subtotal_cents    integer NOT NULL CHECK (subtotal_cents >= 0),
  weight_oz         numeric(8,2),
  reviewed          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_store_order_items_order ON public.bc_store_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_bc_store_order_items_product ON public.bc_store_order_items (product_id);

-- Linha do tempo do pedido (tudo que aconteceu, por quem)
CREATE TABLE IF NOT EXISTS public.bc_store_order_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES public.bc_store_orders(id) ON DELETE CASCADE,
  kind        text NOT NULL,     -- paid, label_purchased, shipped, tracking, delivered, completed, canceled, refunded, payout, dispute_*, note
  actor       text NOT NULL DEFAULT 'system',  -- buyer | seller | admin | system | stripe | shippo
  actor_id    text,
  message     text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_store_order_events_order ON public.bc_store_order_events (order_id, created_at);

-- Conversa do pedido (comprador <-> vendedor; admin entra em disputa)
CREATE TABLE IF NOT EXISTS public.bc_store_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.bc_store_orders(id) ON DELETE CASCADE,
  sender_role     text NOT NULL CHECK (sender_role IN ('buyer','seller','admin')),
  sender_user_id  uuid,
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_store_messages_order ON public.bc_store_messages (order_id, created_at);

-- Avaliacoes (so compra entregue; uma por item do pedido)
CREATE TABLE IF NOT EXISTS public.bc_store_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.bc_store_orders(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES public.bc_store_products(id) ON DELETE SET NULL,
  seller_id         uuid NOT NULL REFERENCES public.bc_store_sellers(id) ON DELETE CASCADE,
  buyer_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating            integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body              text CHECK (body IS NULL OR char_length(body) <= 2000),
  seller_reply      text CHECK (seller_reply IS NULL OR char_length(seller_reply) <= 1000),
  seller_replied_at timestamptz,
  status            text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  agent_status      text DEFAULT 'pending',
  agent_severity    text,
  agent_categories  text[],
  agent_reasoning   text,
  agent_checked_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bc_store_reviews_one UNIQUE (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_bc_store_reviews_product ON public.bc_store_reviews (product_id, created_at DESC) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS idx_bc_store_reviews_seller ON public.bc_store_reviews (seller_id, created_at DESC) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS idx_bc_store_reviews_agent ON public.bc_store_reviews (created_at) WHERE agent_status = 'pending';

-- Denuncias de anuncio (canal exigido pelo INFORM Consumers Act)
CREATE TABLE IF NOT EXISTS public.bc_store_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid REFERENCES public.bc_store_products(id) ON DELETE CASCADE,
  seller_id         uuid REFERENCES public.bc_store_sellers(id) ON DELETE CASCADE,
  reporter_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_email    text,
  reason            text NOT NULL CHECK (reason IN ('prohibited','counterfeit','misleading','offensive','scam','other')),
  details           text CHECK (details IS NULL OR char_length(details) <= 2000),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  resolved_by       text,
  resolved_at       timestamptz,
  admin_notes       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_store_reports_pending ON public.bc_store_reports (created_at) WHERE status = 'pending';

-- Decisoes de moderacao (antes/depois; bc_admin_audit guarda so a requisicao)
CREATE TABLE IF NOT EXISTS public.bc_store_moderation_log (
  id           bigserial PRIMARY KEY,
  target_type  text NOT NULL CHECK (target_type IN ('seller','product','review','report','order','config')),
  target_id    text NOT NULL,
  action       text NOT NULL,
  from_status  text,
  to_status    text,
  reason       text,
  actor        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bc_store_moderation_log_target ON public.bc_store_moderation_log (target_type, target_id, created_at DESC);

-- Idempotencia dos webhooks
CREATE TABLE IF NOT EXISTS public.bc_store_stripe_events (
  event_id      text PRIMARY KEY,
  type          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz          -- nulo = processamento interrompido; pode ser refeito
);

CREATE TABLE IF NOT EXISTS public.bc_store_tracking_events (
  id               bigserial PRIMARY KEY,
  order_id         uuid REFERENCES public.bc_store_orders(id) ON DELETE CASCADE,
  tracking_number  text NOT NULL,
  status           text NOT NULL,
  substatus        text,
  status_details   text,
  status_date      timestamptz,
  source           text NOT NULL DEFAULT 'webhook',  -- webhook | poll | manual
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bc_store_tracking_events_unique UNIQUE (order_id, status, status_date)
);
CREATE INDEX IF NOT EXISTS idx_bc_store_tracking_events_order ON public.bc_store_tracking_events (order_id, created_at);

-- ═════════════════════════════════════════════════════════════════════════════
-- Estoque atomico (reserva no checkout, devolve se expirar ou cancelar)
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.bc_store_reserve_stock(p_product uuid, p_qty integer)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.bc_store_products
       SET stock = stock - p_qty
     WHERE id = p_product AND status = 'approved' AND p_qty > 0 AND stock >= p_qty
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM u);
$$;

CREATE OR REPLACE FUNCTION public.bc_store_release_stock(p_product uuid, p_qty integer)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.bc_store_products SET stock = stock + p_qty
   WHERE id = p_product AND p_qty > 0;
$$;

CREATE OR REPLACE FUNCTION public.bc_store_product_sold(p_product uuid, p_qty integer)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.bc_store_products SET sales_count = sales_count + p_qty
   WHERE id = p_product AND p_qty > 0;
$$;

-- Divida da loja: soma (estorno recusado) e abate (proximo repasse), atomicos
CREATE OR REPLACE FUNCTION public.bc_store_add_debt(p_seller uuid, p_cents integer)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.bc_store_sellers SET debt_cents = debt_cents + GREATEST(p_cents, 0)
   WHERE id = p_seller
  RETURNING debt_cents;
$$;

CREATE OR REPLACE FUNCTION public.bc_store_take_debt(p_seller uuid, p_max integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  cur integer;
  taken integer;
BEGIN
  SELECT debt_cents INTO cur FROM public.bc_store_sellers WHERE id = p_seller FOR UPDATE;
  IF cur IS NULL THEN RETURN 0; END IF;
  taken := LEAST(cur, GREATEST(p_max, 0));
  IF taken > 0 THEN
    UPDATE public.bc_store_sellers SET debt_cents = cur - taken WHERE id = p_seller;
  END IF;
  RETURN taken;
END;
$$;

REVOKE ALL ON FUNCTION public.bc_store_add_debt(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bc_store_take_debt(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bc_store_add_debt(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bc_store_take_debt(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.bc_store_reserve_stock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bc_store_release_stock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bc_store_product_sold(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bc_store_reserve_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bc_store_release_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bc_store_product_sold(uuid, integer) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Volume por estado de entrega (12 meses) para acompanhar os limites de
-- marketplace facilitator (sales tax). Lida so pelo admin.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.bc_store_state_volume AS
SELECT
  upper(o.ship_to->>'state')                AS state,
  count(DISTINCT o.checkout_id)             AS transactions,
  count(*)                                  AS orders,
  coalesce(sum(o.items_cents + o.shipping_cents - o.refunded_cents), 0) AS gross_cents,
  coalesce(sum(o.tax_cents), 0)             AS tax_cents
FROM public.bc_store_orders o
WHERE o.paid_at >= now() - interval '12 months'
  AND o.status IN ('paid','shipped','delivered','completed')
GROUP BY 1;
ALTER VIEW public.bc_store_state_volume SET (security_invoker = true);

-- ═════════════════════════════════════════════════════════════════════════════
-- Fechamento: RLS ligado, nada para anon/authenticated, tudo para service_role
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.bc_store_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_sellers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_shipping_zones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_checkouts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_order_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_moderation_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_stripe_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_store_tracking_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.bc_store_config, public.bc_store_categories, public.bc_store_sellers,
  public.bc_store_shipping_zones, public.bc_store_products, public.bc_store_checkouts,
  public.bc_store_orders, public.bc_store_order_items, public.bc_store_order_events,
  public.bc_store_messages, public.bc_store_reviews, public.bc_store_reports,
  public.bc_store_moderation_log, public.bc_store_stripe_events, public.bc_store_tracking_events,
  public.bc_store_state_volume
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.bc_store_config, public.bc_store_categories, public.bc_store_sellers,
  public.bc_store_shipping_zones, public.bc_store_products, public.bc_store_checkouts,
  public.bc_store_orders, public.bc_store_order_items, public.bc_store_order_events,
  public.bc_store_messages, public.bc_store_reviews, public.bc_store_reports,
  public.bc_store_moderation_log, public.bc_store_stripe_events, public.bc_store_tracking_events
TO service_role;
GRANT SELECT ON public.bc_store_state_volume TO service_role;

REVOKE ALL ON SEQUENCE
  public.bc_store_orders_order_number_seq, public.bc_store_order_events_id_seq,
  public.bc_store_moderation_log_id_seq, public.bc_store_tracking_events_id_seq
FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE
  public.bc_store_orders_order_number_seq, public.bc_store_order_events_id_seq,
  public.bc_store_moderation_log_id_seq, public.bc_store_tracking_events_id_seq
TO service_role;
