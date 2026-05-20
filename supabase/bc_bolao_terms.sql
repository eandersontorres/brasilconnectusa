-- ════════════════════════════════════════════════════════════════════════
-- Aceite dos termos do Bolão (paper trail legal pre-lancamento)
--
-- bc_profiles.bolao_terms_accepted_at — timestamp do aceite + IP + UA
-- pro caso de necessidade de comprovacao em alguma jurisdicao.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS bolao_terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bolao_terms_accepted_ip TEXT,
  ADD COLUMN IF NOT EXISTS bolao_terms_accepted_ua TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_bolao_terms
  ON bc_profiles(bolao_terms_accepted_at) WHERE bolao_terms_accepted_at IS NOT NULL;

-- Verificacao
SELECT
  COUNT(*) AS total_profiles,
  COUNT(*) FILTER (WHERE bolao_terms_accepted_at IS NOT NULL) AS aceitaram_bolao
FROM bc_profiles;
