-- ════════════════════════════════════════════════════════════════════════
-- Resgates de prêmio do Bolão (Top 3 · fase de grupos · Pizza TorresBee)
--
-- Cada linha = um vencedor que preencheu a página /bolao-premio.
-- Gravado pelo endpoint POST /api/bolao?action=prize-claim (service role).
-- Sem policies públicas: só o backend (SERVICE_KEY) escreve/lê.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_bolao_prize_claims (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  position         SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  prize_label      TEXT,                       -- ex: "1 pizza assada por semana"
  nickname         TEXT NOT NULL,              -- apelido no bolão
  full_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  whatsapp         TEXT NOT NULL,
  delivery_address TEXT,                       -- opcional (único, sem alteração)
  companion_name   TEXT,                       -- acompanhante autorizado (1 familiar)
  notes            TEXT,
  accepted_terms   BOOLEAN NOT NULL DEFAULT false,
  accepted_ip      TEXT,                       -- paper trail do aceite
  accepted_ua      TEXT
);

CREATE INDEX IF NOT EXISTS idx_prize_claims_created ON bc_bolao_prize_claims(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prize_claims_email   ON bc_bolao_prize_claims(lower(email));

-- RLS ligado, sem policies = nenhum acesso via anon/authenticated key.
-- O backend usa SERVICE_KEY (bypassa RLS) para inserir e listar.
ALTER TABLE bc_bolao_prize_claims ENABLE ROW LEVEL SECURITY;

-- Verificação
SELECT COUNT(*) AS total_resgates FROM bc_bolao_prize_claims;
