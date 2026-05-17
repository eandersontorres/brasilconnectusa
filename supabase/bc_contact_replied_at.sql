-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect — bc_contact_messages: adicionar replied_at
-- Coluna usada pelo novo endpoint /api/admin/contact-reply pra rastrear
-- quando o admin respondeu uma mensagem (alem do status='replied').
-- Idempotente — pode rodar varias vezes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bc_contact_messages
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- Backfill: mensagens ja com status='replied' mas sem replied_at recebem
-- created_at como timestamp aproximado (so pra nao ficar NULL — proximas
-- respostas terao timestamp correto).
UPDATE bc_contact_messages
SET replied_at = created_at
WHERE status = 'replied' AND replied_at IS NULL;

-- Verificacao
SELECT
  'bc_contact_replied_at aplicado' AS status,
  COUNT(*)                                       AS total_msgs,
  COUNT(*) FILTER (WHERE status = 'replied')     AS replied,
  COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS com_timestamp;
