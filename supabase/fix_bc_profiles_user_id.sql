-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: bc_profiles sem coluna user_id
-- Erro: "Could not find the 'user_id' column of 'bc_profiles' in schema cache"
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Diagnostico — ver colunas atuais
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'bc_profiles'
ORDER BY ordinal_position;

-- 2. Adiciona user_id se nao existir
ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- 2.1. Garante que a coluna 'id' (do schema antigo) tenha default gen_random_uuid()
-- Sem isso, INSERT sem 'id' explicito falha com NOT NULL violation
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bc_profiles' AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE bc_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid()';
  END IF;
END $$;

-- 2.2. Remove foreign key antigo de 'id' -> auth.users (no schema novo, eh user_id que aponta pra auth)
ALTER TABLE bc_profiles DROP CONSTRAINT IF EXISTS bc_profiles_id_fkey;

-- 3. Garante TODAS as outras colunas do onboarding
ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS email                  TEXT,
  ADD COLUMN IF NOT EXISTS full_name              TEXT,
  ADD COLUMN IF NOT EXISTS display_name           TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url             TEXT,
  ADD COLUMN IF NOT EXISTS bio                    TEXT,
  ADD COLUMN IF NOT EXISTS city                   TEXT,
  ADD COLUMN IF NOT EXISTS state                  TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp               TEXT,
  ADD COLUMN IF NOT EXISTS instagram              TEXT,
  ADD COLUMN IF NOT EXISTS role                   TEXT,
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS onboarding_completed   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step        INT     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guidelines_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcomed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS country                TEXT    DEFAULT 'USA',
  ADD COLUMN IF NOT EXISTS interests              TEXT[];

-- 4. Indice em user_id (precisa ser unique pra funcionar como chave de upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_profiles_user_id ON bc_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_state ON bc_profiles(state);
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding ON bc_profiles(onboarding_completed);

-- 5. Tabela de checklist (Get Started) — caso nao tenha rodado o SQL anterior
CREATE TABLE IF NOT EXISTS bc_profile_checklist (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL,
  step_key     TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_checklist_user ON bc_profile_checklist(user_id);

-- 6. RLS off (APIs usam service key)
ALTER TABLE bc_profiles          DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_profile_checklist DISABLE ROW LEVEL SECURITY;

-- 7. Verificacao final — confirma que user_id foi criado
SELECT
  'OK' AS status,
  COUNT(*) FILTER (WHERE column_name = 'user_id')               AS tem_user_id,
  COUNT(*) FILTER (WHERE column_name = 'onboarding_completed')  AS tem_onboarding,
  COUNT(*) FILTER (WHERE column_name = 'interests')             AS tem_interests,
  COUNT(*) FILTER (WHERE column_name = 'state')                 AS tem_state
FROM information_schema.columns
WHERE table_name = 'bc_profiles';
