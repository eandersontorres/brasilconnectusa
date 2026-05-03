-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Estende bc_profiles para suportar onboarding
-- Adiciona colunas, cria tabela de checklist e re-cria perfis necessários
-- Executar no SQL Editor do Supabase
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Cria/garante bc_profiles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_profiles (
  user_id              UUID PRIMARY KEY,                  -- auth.users(id)
  email                TEXT,
  full_name            TEXT,
  display_name         TEXT,
  avatar_url           TEXT,
  bio                  TEXT,
  city                 TEXT,
  state                TEXT,                              -- USPS code
  whatsapp             TEXT,
  instagram            TEXT,
  role                 TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Garante TODAS as colunas (caso bc_profiles ja exista de schema antigo) ──
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

CREATE INDEX IF NOT EXISTS idx_profiles_state ON bc_profiles(state);
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding ON bc_profiles(onboarding_completed);

-- ── 3. Tabela de checklist (Get Started) ────────────────────────────────
-- Cada step que o usuário completa é registrado aqui.
DROP TABLE IF EXISTS bc_profile_checklist CASCADE;

CREATE TABLE bc_profile_checklist (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL,
  step_key     TEXT NOT NULL,                            -- 'introduce'|'first_question'|'invite'|'add_photo'|'attend_event'
  completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, step_key)
);

CREATE INDEX idx_checklist_user ON bc_profile_checklist(user_id);

-- ── 4. RLS off (APIs usam service key) ───────────────────────────────────
ALTER TABLE bc_profiles            DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_profile_checklist   DISABLE ROW LEVEL SECURITY;

-- ── 5. Verificação ───────────────────────────────────────────────────────
SELECT
  'bc_profiles atualizado' AS status,
  (SELECT COUNT(*) FROM bc_profiles) AS profiles_existentes,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'bc_profiles' AND column_name IN ('onboarding_completed','interests','country')) AS novas_colunas;
