-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Adiciona @username unico em bc_profiles
--
-- Conceito:
--   full_name     = nome real (privado, padrao)        ex: "Anderson Torres"
--   display_name  = como aparecer em posts (informal)  ex: "Anderson T."
--   username      = handle unico tipo @anderson_t      ex: "anderson_t"
--                   - 3 a 20 chars, [a-z0-9_], case-insensitive unique
--                   - usado pra @mentions e perfis publicos
--                   - quem so quer mostrar isso pode esconder full_name/display_name
--
-- Executar no SQL Editor do Supabase
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Coluna + constraints ─────────────────────────────────────────────────
ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

-- Regex check: 3-20 chars, minusculas + digitos + underscore.
-- NULL permitido (pre-onboarding).
ALTER TABLE bc_profiles
  DROP CONSTRAINT IF EXISTS bc_profiles_username_format;
ALTER TABLE bc_profiles
  ADD CONSTRAINT bc_profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');

-- Unique case-insensitive — index funcional, ignora NULL.
DROP INDEX IF EXISTS idx_bc_profiles_username_lower;
CREATE UNIQUE INDEX idx_bc_profiles_username_lower
  ON bc_profiles (LOWER(username))
  WHERE username IS NOT NULL;

-- ── 2. Funcao: sugere username livre baseado num seed ───────────────────────
-- Sanitiza o seed (full_name ou display_name ou email-prefix) pro formato valido,
-- e adiciona sufixo numerico se ja existir.
CREATE OR REPLACE FUNCTION bc_suggest_username(seed TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  i INT := 0;
BEGIN
  -- Normaliza: lowercase, remove diacriticos via unaccent (se extension), trim
  base := LOWER(COALESCE(seed, ''));
  -- Substitui qualquer coisa fora de [a-z0-9_] por _
  base := REGEXP_REPLACE(base, '[^a-z0-9_]+', '_', 'g');
  -- Remove _ no inicio/fim e colapsa multiplos _
  base := REGEXP_REPLACE(base, '^_+|_+$', '', 'g');
  base := REGEXP_REPLACE(base, '_+', '_', 'g');

  IF LENGTH(base) < 3 THEN
    base := 'user';
  END IF;
  IF LENGTH(base) > 17 THEN
    base := SUBSTRING(base, 1, 17);
  END IF;

  candidate := base;
  WHILE EXISTS (SELECT 1 FROM bc_profiles WHERE LOWER(username) = candidate) LOOP
    i := i + 1;
    candidate := SUBSTRING(base, 1, 17) || '_' || i::TEXT;
    IF i > 999 THEN EXIT; END IF;
  END LOOP;

  RETURN candidate;
END;
$$;

-- ── 3. Backfill: gera username pros profiles atuais sem username ────────────
-- Usa display_name -> full_name -> email-prefix como seed.
UPDATE bc_profiles
SET username = bc_suggest_username(
  COALESCE(
    NULLIF(TRIM(display_name), ''),
    NULLIF(TRIM(full_name), ''),
    SPLIT_PART(email, '@', 1)
  )
)
WHERE username IS NULL
  AND (display_name IS NOT NULL OR full_name IS NOT NULL OR email IS NOT NULL);

-- ── 4. Verificacao ──────────────────────────────────────────────────────────
SELECT
  user_id,
  email,
  full_name,
  display_name,
  username,
  CASE WHEN username IS NULL THEN 'falta' ELSE 'ok' END AS status
FROM bc_profiles
ORDER BY created_at DESC
LIMIT 20;
