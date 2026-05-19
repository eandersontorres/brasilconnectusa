-- ════════════════════════════════════════════════════════════════════════
-- Sponsors / Patrocinadores
--
-- Cobre 4 use cases num modelo só:
--   A) Negocio listado promovido (business_id != null + plano premium)
--   B) Marca externa (Wise, advogado, etc — business_id null)
--   C) Post patrocinado no feed (placement = ['feed'])
--   D) Banner sidebar (placement = ['sidebar'])
--
-- Sem cobranca por enquanto — admin cadastra manual. Stripe Billing
-- self-serve fica pra fase 2.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_sponsors (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  logo_url      TEXT,
  website_url   TEXT NOT NULL,                -- destino do click
  blurb         TEXT,                         -- 1-2 linhas curtas
  cta_label     TEXT DEFAULT 'Saiba mais',

  -- Targeting (null/array vazio = qualquer)
  geo_state     TEXT[],                       -- ex: ['MA','NY']
  geo_city      TEXT[],                       -- ex: ['Boston','Cambridge'] (raro usar)
  interests     TEXT[],                       -- ex: ['tech','imigracao']
  module        TEXT,                         -- ex: 'restaurant' (so sponsors p/ aquele modulo)

  -- Onde aparece
  placement     TEXT[] NOT NULL DEFAULT ARRAY['sidebar'],
                                              -- ['sidebar','feed','events_top','category_top']

  -- Status
  active        BOOLEAN DEFAULT true,
  start_date    DATE,
  end_date      DATE,                         -- null = sem fim
  status        TEXT DEFAULT 'approved',      -- pending|approved|paused|expired

  -- Linkagem opcional pra business listado
  business_id   UUID REFERENCES bc_businesses(id) ON DELETE SET NULL,

  -- Pricing (opcional, dashboard interno apenas — sem cobranca automatica)
  monthly_price NUMERIC(10,2),
  notes         TEXT,                         -- admin notes (contrato, contato)

  -- Cache de stats (atualizado por trigger ou job)
  impressions_count INT DEFAULT 0,
  clicks_count      INT DEFAULT 0,

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  reviewed_by   UUID                          -- admin que aprovou
);

CREATE INDEX IF NOT EXISTS idx_sponsors_active    ON bc_sponsors(active, status) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_sponsors_business  ON bc_sponsors(business_id);
CREATE INDEX IF NOT EXISTS idx_sponsors_placement ON bc_sponsors USING GIN (placement);
CREATE INDEX IF NOT EXISTS idx_sponsors_state     ON bc_sponsors USING GIN (geo_state);

-- ════════════════════════════════════════════════════════════════════════
-- Eventos de impression/click (log granular, vira metrica)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bc_sponsor_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sponsor_id  UUID NOT NULL REFERENCES bc_sponsors(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,                  -- 'impression' | 'click'
  user_id     UUID,                           -- null se anonimo
  placement   TEXT,                           -- onde foi visto/clicado
  user_geo    JSONB,                          -- { state, city } pra analytics
  user_agent  TEXT,
  referer     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sp_events_sponsor ON bc_sponsor_events(sponsor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_events_type    ON bc_sponsor_events(event_type, created_at DESC);

-- RLS off (API usa service key)
ALTER TABLE bc_sponsors        DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_sponsor_events  DISABLE ROW LEVEL SECURITY;
