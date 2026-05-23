-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Ranking anonimo no bolao (opcao do admin do grupo)
--
-- Quando anonymous_ranking = true:
--   O ranking do GRUPO mostra posicoes + pontos mas esconde os nomes
--   (vira "Participante #N"). A propria linha do viewer continua marcada
--   como "Voce". Rankings estadual/nacional NAO sao afetados.
--
-- Roda no Supabase SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE bc_bolao_groups
  ADD COLUMN IF NOT EXISTS anonymous_ranking BOOLEAN DEFAULT false NOT NULL;

-- Verificacao
SELECT
  (SELECT COUNT(*) FROM bc_bolao_groups)                              AS total_grupos,
  (SELECT COUNT(*) FROM bc_bolao_groups WHERE anonymous_ranking)      AS grupos_anonimos;
