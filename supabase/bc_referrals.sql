-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Programa de Indicação (Módulo 05)
-- Cada email da waitlist tem um código único. Cliques nos códigos
-- e cadastros via código são rastreados. 3 indicações qualificadas
-- = gift card de US$ 10 Amazon (resgate manual via admin).
-- Executar APÓS bc_waitlist.sql
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- bc_referral_codes — 1 código por email da waitlist
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_referral_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL UNIQUE,           -- ex: BRA-XR8K9
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  total_clicks  INT DEFAULT 0,                  -- visitantes que clicaram no link /r/CODIGO
  total_signups INT DEFAULT 0,                  -- desses, quantos viraram cadastro na waitlist
  total_qualified INT DEFAULT 0,                -- desses, quantos clicaram em afiliado Tier 1
  rewarded_at   TIMESTAMPTZ,                    -- quando foi pago o gift card
  reward_status TEXT DEFAULT 'pending',         -- 'pending', 'eligible', 'paid', 'declined'
  reward_notes  TEXT
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_email ON bc_referral_codes(email);
CREATE INDEX IF NOT EXISTS idx_referral_codes_status ON bc_referral_codes(reward_status);

-- ───────────────────────────────────────────────────────────────
-- bc_referral_uses — cada visita / cadastro via código
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_referral_uses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            TEXT NOT NULL,                -- código do indicador
  visitor_email   TEXT,                         -- email do indicado (preenchido só após cadastro)
  ip_address      TEXT,
  user_agent      TEXT,
  status          TEXT DEFAULT 'click',         -- 'click', 'signup', 'qualified'
  clicked_at      TIMESTAMPTZ DEFAULT NOW(),
  signed_up_at    TIMESTAMPTZ,
  qualified_at    TIMESTAMPTZ,
  qualified_via   TEXT,                         -- nome do afiliado Tier 1 que clicou
  CONSTRAINT fk_code FOREIGN KEY (code) REFERENCES bc_referral_codes(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_referral_uses_code ON bc_referral_uses(code);
CREATE INDEX IF NOT EXISTS idx_referral_uses_email ON bc_referral_uses(visitor_email);
CREATE INDEX IF NOT EXISTS idx_referral_uses_status ON bc_referral_uses(status);

ALTER TABLE bc_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_referral_uses  ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────
-- Função: gerar código único do tipo BRA-XR8K9
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bc_generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- sem letras/números ambíguos
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..5 LOOP
    result := result || substr(alphabet, ceil(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN 'BRA-' || result;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- Função: criar código para um email (chamada pelo /api/waitlist)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bc_ensure_referral_code(p_email TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_attempts INT := 0;
BEGIN
  SELECT code INTO v_code FROM bc_referral_codes WHERE email = p_email;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'Não foi possível gerar código único após 10 tentativas';
    END IF;
    v_code := bc_generate_referral_code();
    BEGIN
      INSERT INTO bc_referral_codes (email, code) VALUES (p_email, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- Trigger: incrementa contadores quando uses muda de status
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bc_update_referral_counters()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bc_referral_codes
      SET total_clicks = total_clicks + 1
      WHERE code = NEW.code;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'signup' AND NEW.status = 'signup' THEN
      UPDATE bc_referral_codes
        SET total_signups = total_signups + 1
        WHERE code = NEW.code;
    END IF;
    IF OLD.status != 'qualified' AND NEW.status = 'qualified' THEN
      UPDATE bc_referral_codes
        SET total_qualified = total_qualified + 1,
            reward_status = CASE
              WHEN total_qualified + 1 >= 3 AND reward_status = 'pending' THEN 'eligible'
              ELSE reward_status
            END
        WHERE code = NEW.code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bc_referral_uses_counters ON bc_referral_uses;
CREATE TRIGGER bc_referral_uses_counters
  AFTER INSERT OR UPDATE ON bc_referral_uses
  FOR EACH ROW EXECUTE FUNCTION bc_update_referral_counters();

-- ───────────────────────────────────────────────────────────────
-- View: top indicadores
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_top_referrers AS
SELECT
  email,
  code,
  total_clicks,
  total_signups,
  total_qualified,
  reward_status,
  rewarded_at,
  created_at
FROM bc_referral_codes
WHERE total_qualified > 0
ORDER BY total_qualified DESC, total_signups DESC, total_clicks DESC;

-- ───────────────────────────────────────────────────────────────
-- View: candidatos a recompensa (3+ qualificados, ainda não pagos)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bc_reward_eligible AS
SELECT
  email,
  code,
  total_qualified,
  total_signups,
  total_clicks,
  created_at
FROM bc_referral_codes
WHERE total_qualified >= 3
  AND reward_status IN ('pending', 'eligible')
ORDER BY total_qualified DESC, created_at ASC;
