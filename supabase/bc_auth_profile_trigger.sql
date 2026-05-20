-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Garante bc_profiles para todo auth.users
--
-- Objetivo: eliminar usuarios fantasma (logam mas nao aparecem em /admin/manage)
--   1. Trigger AFTER INSERT em auth.users cria linha vazia em bc_profiles
--   2. Backfill de orfaos atuais (auth.users sem bc_profiles)
--
-- Executar no SQL Editor do Supabase
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Funcao do trigger ────────────────────────────────────────────────────
-- security definer: roda com privilegios do owner, ignora RLS
-- on conflict do nothing: idempotente (re-rodar nao quebra)
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO bc_profiles (user_id, email, created_at, onboarding_completed, onboarding_step)
  VALUES (NEW.id, NEW.email, NEW.created_at, false, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── 2. Trigger em auth.users ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_auth_user();

-- ── 3. Backfill: cria profile pra todo auth.users sem profile ───────────────
-- (exclui emails com typo obvio como ".con" — auto-exclusao opcional)
INSERT INTO bc_profiles (user_id, email, created_at, onboarding_completed, onboarding_step)
SELECT u.id, u.email, u.created_at, false, 0
FROM auth.users u
LEFT JOIN bc_profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ── 4. Verificacao ──────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM auth.users)                                          AS auth_total,
  (SELECT COUNT(*) FROM bc_profiles)                                         AS profiles_total,
  (SELECT COUNT(*) FROM bc_profiles WHERE onboarding_completed = false)     AS pendentes,
  (SELECT COUNT(*) FROM auth.users u
     LEFT JOIN bc_profiles p ON p.user_id = u.id
     WHERE p.user_id IS NULL)                                                AS orfaos_restantes;
-- Esperado: auth_total = profiles_total, orfaos_restantes = 0
