-- ════════════════════════════════════════════════════════════════════════════
-- Cache de geocoding (city, state -> lat, lng)
-- Evita bater no Nominatim/Mapbox toda hora.
-- TTL: forever (cidades nao mudam de lugar)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_geocode_cache (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  city_norm   TEXT NOT NULL,                          -- "boston" (lowercase, trimmed)
  state_norm  TEXT NOT NULL,                          -- "MA" (uppercase)
  country     TEXT DEFAULT 'USA',
  display     TEXT,                                   -- "Boston, MA, USA" (pretty)
  latitude    DECIMAL(9, 6),
  longitude   DECIMAL(9, 6),
  source      TEXT DEFAULT 'nominatim',               -- nominatim | mapbox | manual
  geocoded_at TIMESTAMPTZ DEFAULT now(),
  hits        INT DEFAULT 1,                          -- contador de uso
  UNIQUE (city_norm, state_norm, country)
);

CREATE INDEX IF NOT EXISTS idx_geocode_lookup ON bc_geocode_cache(city_norm, state_norm);

-- Lat/lng nas comunidades (pra filtrar feed por raio)
ALTER TABLE bc_communities
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(9, 6),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(9, 6);

CREATE INDEX IF NOT EXISTS idx_communities_geo ON bc_communities(latitude, longitude)
  WHERE latitude IS NOT NULL;

ALTER TABLE bc_geocode_cache DISABLE ROW LEVEL SECURITY;

-- Verificacao
SELECT 'OK' AS status;
