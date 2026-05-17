-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect — Bolão: vínculo com auth.users do Supabase
-- Resolve o problema "bolão grudado no navegador, não na pessoa".
--
-- DEPOIS DESSA MIGRATION:
--   - bc_bolao_members.user_id pode existir (FK pra auth.users)
--   - Membros existentes (criados anônimos) ficam com user_id = NULL
--   - Backfill: tenta linkar anônimos a auth.users pelo email
--   - Novos membros (via API com Bearer token) ganham user_id no INSERT
--
-- COMPATIBILIDADE:
--   - Membros anônimos continuam funcionando (user_id NULL é aceito)
--   - A API trata os 2 casos: com user_id (preferido) e por email (fallback)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bc_bolao_members
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bc_bolao_members_user_id ON bc_bolao_members(user_id);
CREATE INDEX IF NOT EXISTS idx_bc_bolao_members_email   ON bc_bolao_members(lower(email));

-- ── BACKFILL: liga membros anônimos a auth.users pelo email ─────────────────
-- Roda apenas em membros sem user_id. Idempotente — pode rodar várias vezes.
UPDATE bc_bolao_members m
SET user_id = u.id
FROM auth.users u
WHERE m.user_id IS NULL
  AND m.email IS NOT NULL
  AND lower(trim(m.email)) = lower(trim(u.email));

-- ── VERIFICAÇÃO ─────────────────────────────────────────────────────────────
SELECT
  'bc_bolao_user_link aplicado' AS status,
  COUNT(*)                                      AS total_members,
  COUNT(*) FILTER (WHERE user_id IS NOT NULL)   AS members_linked,
  COUNT(*) FILTER (WHERE user_id IS NULL)       AS members_anon
FROM bc_bolao_members;
