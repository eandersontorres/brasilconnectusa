-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect — Bolão Copa 2026 — FASE 2 (mata-mata)
-- Disputa SEPARADA da fase de grupos: ranking próprio, pontuando SÓ placar exato.
-- Conta apenas partidas com phase <> 'group' (32-avos, oitavas, quartas, etc.).
-- Executar APÓS bolao_schema.sql / v2 / v3.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. VIEW: ranking da FASE 2 (mata-mata) ─────────────────────────────────
-- Regra: só vale PLACAR EXATO (3 pts). Acertar só o vencedor NÃO pontua.
-- Mesmas colunas da view global (member_id, nickname, state, country, group_id,
-- group_name, total_pts, exact_count, correct_count, played) para a API/Front
-- reaproveitarem o mesmo shape — só muda a fonte dos pontos.
CREATE OR REPLACE VIEW bc_bolao_fase2_standings AS
WITH member_points AS (
  SELECT
    p.member_id,
    SUM(
      CASE
        WHEN m.status = 'finished' AND m.home_score = p.home_score AND m.away_score = p.away_score THEN 3
        ELSE 0
      END
    ) AS total_pts,
    COUNT(*) FILTER (
      WHERE m.status = 'finished' AND m.home_score = p.home_score AND m.away_score = p.away_score
    ) AS exact_count,
    0 AS correct_count,                                   -- mata-mata: "só vencedor" não pontua
    COUNT(*) FILTER (WHERE m.status = 'finished') AS played
  FROM bc_bolao_predictions p
  JOIN bc_copa_matches m ON m.id = p.match_id
  WHERE m.phase <> 'group'                               -- ← só jogos de mata-mata
  GROUP BY p.member_id
)
SELECT
  mb.id            AS member_id,
  mb.nickname,
  mb.state,
  mb.country,
  g.id             AS group_id,
  g.name           AS group_name,
  COALESCE(mp.total_pts, 0)      AS total_pts,
  COALESCE(mp.exact_count, 0)    AS exact_count,
  COALESCE(mp.correct_count, 0)  AS correct_count,
  COALESCE(mp.played, 0)         AS played
FROM bc_bolao_members mb
JOIN bc_bolao_groups g ON g.id = mb.group_id
LEFT JOIN member_points mp ON mp.member_id = mb.id;

-- ── 2. PARTIDA: Brasil x Japão (16-avos de final / phase = 'r32') ──────────
-- 'r32' = round of 32 times = 16-avos de final (1/16, primeira eliminatória 2026).
-- 29/06/2026 12:00 Central (CDT, UTC-5) = 17:00 UTC. Apito = fechamento das apostas.
-- Idempotente: não duplica se rodar o script de novo.
INSERT INTO bc_copa_matches (phase, group_name, home_team, away_team, match_date, venue, status)
SELECT 'r32', NULL, 'Brasil', 'Japão', '2026-06-29 12:00:00-05', 'NRG Stadium, Houston', 'scheduled'
WHERE NOT EXISTS (
  SELECT 1 FROM bc_copa_matches
  WHERE phase = 'r32' AND home_team = 'Brasil' AND away_team = 'Japão'
);

-- ── 3. DEADLINE: nada a fazer ──────────────────────────────────────────────
-- O predictions_deadline global JÁ está em 2026-07-20 (depois da final), então o
-- portão global fica aberto durante todo o mata-mata. Cada jogo fecha sozinho no
-- apito pela trava por-partida (match_date). NÃO mover para a data deste jogo:
-- isso fecharia o portão global e bloquearia as próximas rodadas (oitavas+).
-- Adicionar o próximo jogo do Brasil = só um INSERT como o do item 2.

-- ── 4. VERIFICAÇÃO ─────────────────────────────────────────────────────────
SELECT 'Fase 2 (mata-mata) configurada' AS status,
       (SELECT COUNT(*) FROM bc_copa_matches WHERE phase <> 'group') AS jogos_mata_mata,
       (SELECT value FROM bc_bolao_config WHERE key = 'predictions_deadline') AS deadline;
