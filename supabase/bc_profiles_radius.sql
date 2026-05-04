-- ═══════════════════════════════════════════════════════════════════════
-- bc_profiles: cidade + raio de interesse
-- Permite ao usuario escolher quao longe quer ver posts/eventos
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS radius_miles INT DEFAULT 25;
  -- 0 = so minha cidade
  -- 25, 50, 100 = raio em milhas (precisa lat/lng pra filtro real)
  -- 999 = estado inteiro
  -- 9999 = nacional (todos os estados)

ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(9, 6),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(9, 6);
  -- Ficam NULL ate integrarmos geocoding (Google/Mapbox).
  -- Quando preenchidos, permitem filtro real por raio.

CREATE INDEX IF NOT EXISTS idx_profiles_radius ON bc_profiles(radius_miles);
CREATE INDEX IF NOT EXISTS idx_profiles_city ON bc_profiles(city) WHERE city IS NOT NULL;

-- Verificacao
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bc_profiles' AND column_name IN ('radius_miles', 'latitude', 'longitude', 'city');
