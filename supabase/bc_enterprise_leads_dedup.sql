-- ════════════════════════════════════════════════════════════════════════════
-- bc_enterprise_leads — dedup por email + touches counter
-- ════════════════════════════════════════════════════════════════════════════
-- Hoje a tabela aceita o mesmo email N vezes (não tem UNIQUE), o que suja a
-- fila do admin quando um lead preenche o form mais de uma vez.
--
-- Esta migration:
--   1. Normaliza todos os emails pra lowercase
--   2. Remove duplicatas (mantém o registro mais recente por email)
--   3. Adiciona UNIQUE em email
--   4. Adiciona `touches` (quantas vezes o lead reenviou) e `last_contact_at`
--      pra preservar a info "lead voltando = sinal forte"
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Normaliza emails existentes pra lowercase
UPDATE bc_enterprise_leads
   SET email = lower(email)
 WHERE email IS NOT NULL AND email != lower(email);

-- 2. Adiciona campos novos antes do dedup (pra preservar o histórico de touches)
ALTER TABLE bc_enterprise_leads
  ADD COLUMN IF NOT EXISTS touches INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;

-- 3. Pra cada email duplicado, soma os touches no registro mais recente
WITH dups AS (
  SELECT
    lower(email) AS email_norm,
    COUNT(*) AS total,
    MAX(created_at) AS latest
  FROM bc_enterprise_leads
  WHERE email IS NOT NULL
  GROUP BY lower(email)
  HAVING COUNT(*) > 1
)
UPDATE bc_enterprise_leads bel
   SET touches = (SELECT total FROM dups WHERE email_norm = lower(bel.email))
 WHERE created_at = (SELECT latest FROM dups WHERE email_norm = lower(bel.email))
   AND lower(bel.email) IN (SELECT email_norm FROM dups);

-- 4. Backfill last_contact_at = created_at (pra registros que ainda não tinham)
UPDATE bc_enterprise_leads
   SET last_contact_at = created_at
 WHERE last_contact_at IS NULL;

-- 5. Dedupe: mantém o registro mais recente por email
DELETE FROM bc_enterprise_leads
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at DESC, id DESC) AS rn
       FROM bc_enterprise_leads
      WHERE email IS NOT NULL
   ) sub
  WHERE rn > 1
 );

-- 6. UNIQUE constraint (case-sensitive, mas API sempre lowercase no insert)
ALTER TABLE bc_enterprise_leads
  ADD CONSTRAINT bc_enterprise_leads_email_key UNIQUE (email);
