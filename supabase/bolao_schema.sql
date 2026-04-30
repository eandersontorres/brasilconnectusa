-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect – Bolão Copa 2026
-- Execute no SQL Editor do Supabase (https://supabase.com/dashboard)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Partidas da Copa ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_copa_matches (
  id          SERIAL PRIMARY KEY,
  phase       TEXT NOT NULL DEFAULT 'group',      -- group | r32 | r16 | qf | sf | final
  group_name  TEXT,                               -- A–L (fase de grupos)
  home_team   TEXT NOT NULL,
  away_team   TEXT NOT NULL,
  match_date  TIMESTAMPTZ,
  venue       TEXT,
  home_score  INT,                                -- NULL até a partida terminar
  away_score  INT,
  status      TEXT NOT NULL DEFAULT 'scheduled'  -- scheduled | live | finished
);

-- ── 2. Grupos de bolão ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_bolao_groups (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  admin_email  TEXT NOT NULL,
  join_code    TEXT NOT NULL UNIQUE,             -- código de convite 6 chars
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── 3. Membros do bolão ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_bolao_members (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id    UUID NOT NULL REFERENCES bc_bolao_groups(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  email       TEXT,
  joined_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, nickname)
);

-- ── 4. Palpites ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_bolao_predictions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id   UUID NOT NULL REFERENCES bc_bolao_members(id) ON DELETE CASCADE,
  match_id    INT NOT NULL REFERENCES bc_copa_matches(id),
  home_score  INT NOT NULL,
  away_score  INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, match_id)
);

-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_members_group    ON bc_bolao_members(group_id);
CREATE INDEX IF NOT EXISTS idx_predictions_mem  ON bc_bolao_predictions(member_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON bc_bolao_predictions(match_id);

-- ── RLS: desabilitar (API usa service key) ───────────────────────────────────
ALTER TABLE bc_copa_matches        DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_bolao_groups        DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_bolao_members       DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_bolao_predictions   DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Fase de Grupos – Copa 2026 (grupos A–D como exemplo)
-- Atualize os grupos e datas conforme o calendário oficial da FIFA
-- Site: https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO bc_copa_matches (phase, group_name, home_team, away_team, match_date, venue) VALUES

-- Grupo A  (3 jogos iniciais – semana 1)
('group', 'A', 'México',         'Nova Zelândia',   '2026-06-11 20:00-05', 'Azteca, Cidade do México'),
('group', 'A', 'Equador',        'Nigéria',         '2026-06-11 17:00-05', 'AT&T Stadium, Dallas'),
('group', 'A', 'México',         'Equador',         '2026-06-15 20:00-05', 'Azteca, Cidade do México'),
('group', 'A', 'Nigéria',        'Nova Zelândia',   '2026-06-15 14:00-05', 'AT&T Stadium, Dallas'),
('group', 'A', 'México',         'Nigéria',         '2026-06-19 16:00-05', 'Azteca, Cidade do México'),
('group', 'A', 'Equador',        'Nova Zelândia',   '2026-06-19 16:00-05', 'AT&T Stadium, Dallas'),

-- Grupo B
('group', 'B', 'EUA',            'Panamá',          '2026-06-12 19:00-04', 'MetLife Stadium, Nova York'),
('group', 'B', 'Uruguai',        'Costa do Marfim', '2026-06-12 13:00-04', 'Gillette Stadium, Boston'),
('group', 'B', 'EUA',            'Uruguai',         '2026-06-16 19:00-04', 'MetLife Stadium, Nova York'),
('group', 'B', 'Costa do Marfim','Panamá',          '2026-06-16 13:00-04', 'Gillette Stadium, Boston'),
('group', 'B', 'EUA',            'Costa do Marfim', '2026-06-20 16:00-04', 'MetLife Stadium, Nova York'),
('group', 'B', 'Uruguai',        'Panamá',          '2026-06-20 16:00-04', 'Gillette Stadium, Boston'),

-- Grupo C
('group', 'C', 'Canadá',         'Chile',           '2026-06-12 20:00-06', 'Arrowhead, Kansas City'),
('group', 'C', 'Colômbia',       'Egito',           '2026-06-12 17:00-06', 'Levi''s Stadium, São Francisco'),
('group', 'C', 'Canadá',         'Colômbia',        '2026-06-16 20:00-06', 'Arrowhead, Kansas City'),
('group', 'C', 'Egito',          'Chile',           '2026-06-16 17:00-06', 'Levi''s Stadium, São Francisco'),
('group', 'C', 'Canadá',         'Egito',           '2026-06-20 16:00-06', 'Arrowhead, Kansas City'),
('group', 'C', 'Colômbia',       'Chile',           '2026-06-20 16:00-06', 'Levi''s Stadium, São Francisco'),

-- Grupo D
('group', 'D', 'Argentina',      'Peru',            '2026-06-13 20:00-05', 'Rose Bowl, Los Angeles'),
('group', 'D', 'Turquia',        'Nova Zelândia',   '2026-06-13 17:00-07', 'Sofi Stadium, Los Angeles'),
('group', 'D', 'Argentina',      'Turquia',         '2026-06-17 20:00-07', 'Rose Bowl, Los Angeles'),
('group', 'D', 'Peru',           'Nova Zelândia',   '2026-06-17 17:00-07', 'Sofi Stadium, Los Angeles'),
('group', 'D', 'Argentina',      'Nova Zelândia',   '2026-06-21 16:00-07', 'Rose Bowl, Los Angeles'),
('group', 'D', 'Turquia',        'Peru',            '2026-06-21 16:00-07', 'Sofi Stadium, Los Angeles'),

-- Grupo E
('group', 'E', 'Brasil',         'Venezuela',       '2026-06-13 20:00-04', 'Hard Rock Stadium, Miami'),
('group', 'E', 'França',         'Irã',             '2026-06-13 17:00-04', 'Mercedes-Benz, Atlanta'),
('group', 'E', 'Brasil',         'França',          '2026-06-17 20:00-04', 'Hard Rock Stadium, Miami'),
('group', 'E', 'Irã',            'Venezuela',       '2026-06-17 17:00-04', 'Mercedes-Benz, Atlanta'),
('group', 'E', 'Brasil',         'Irã',             '2026-06-21 16:00-04', 'Hard Rock Stadium, Miami'),
('group', 'E', 'França',         'Venezuela',       '2026-06-21 16:00-04', 'Mercedes-Benz, Atlanta'),

-- Grupo F
('group', 'F', 'Espanha',        'Camarões',        '2026-06-14 20:00-04', 'Camping World, Orlando'),
('group', 'F', 'Alemanha',       'Austrália',       '2026-06-14 14:00-05', 'NRG Stadium, Houston'),
('group', 'F', 'Espanha',        'Alemanha',        '2026-06-18 20:00-05', 'NRG Stadium, Houston'),
('group', 'F', 'Austrália',      'Camarões',        '2026-06-18 17:00-04', 'Camping World, Orlando'),
('group', 'F', 'Espanha',        'Austrália',       '2026-06-22 16:00-05', 'NRG Stadium, Houston'),
('group', 'F', 'Alemanha',       'Camarões',        '2026-06-22 16:00-04', 'Camping World, Orlando'),

-- Grupo G
('group', 'G', 'Inglaterra',     'Jamaica',         '2026-06-14 19:00-05', 'Soldier Field, Chicago'),
('group', 'G', 'Senegal',        'Sérvia',          '2026-06-14 13:00-05', 'Lincoln Financial, Filadélfia'),
('group', 'G', 'Inglaterra',     'Senegal',         '2026-06-18 19:00-05', 'Soldier Field, Chicago'),
('group', 'G', 'Sérvia',         'Jamaica',         '2026-06-18 13:00-05', 'Lincoln Financial, Filadélfia'),
('group', 'G', 'Inglaterra',     'Sérvia',          '2026-06-22 16:00-05', 'Soldier Field, Chicago'),
('group', 'G', 'Senegal',        'Jamaica',         '2026-06-22 16:00-05', 'Lincoln Financial, Filadélfia'),

-- Grupo H
('group', 'H', 'Portugal',       'Bolívia',         '2026-06-15 20:00-06', 'Empower Field, Denver'),
('group', 'H', 'Gana',           'Japão',           '2026-06-15 13:00-06', 'Lumen Field, Seattle'),
('group', 'H', 'Portugal',       'Gana',            '2026-06-19 20:00-07', 'Lumen Field, Seattle'),
('group', 'H', 'Japão',          'Bolívia',         '2026-06-19 17:00-06', 'Empower Field, Denver'),
('group', 'H', 'Portugal',       'Japão',           '2026-06-23 16:00-07', 'Lumen Field, Seattle'),
('group', 'H', 'Gana',           'Bolívia',         '2026-06-23 16:00-06', 'Empower Field, Denver'),

-- Grupo I
('group', 'I', 'Holanda',        'El Salvador',     '2026-06-15 19:00-05', 'State Farm, Dallas'),
('group', 'I', 'África do Sul',  'Arábia Saudita',  '2026-06-15 13:00-05', 'AT&T Stadium, Arlington'),
('group', 'I', 'Holanda',        'África do Sul',   '2026-06-19 19:00-05', 'State Farm, Dallas'),
('group', 'I', 'Arábia Saudita', 'El Salvador',     '2026-06-19 13:00-05', 'AT&T Stadium, Arlington'),
('group', 'I', 'Holanda',        'Arábia Saudita',  '2026-06-23 16:00-05', 'State Farm, Dallas'),
('group', 'I', 'África do Sul',  'El Salvador',     '2026-06-23 16:00-05', 'AT&T Stadium, Arlington'),

-- Grupo J
('group', 'J', 'Bélgica',        'Costa Rica',      '2026-06-16 19:00-04', 'Inter&Co, Orlando'),
('group', 'J', 'Rep. Congo',     'Suíça',           '2026-06-16 13:00-04', 'Bank of America, Charlotte'),
('group', 'J', 'Bélgica',        'Rep. Congo',      '2026-06-20 19:00-04', 'Inter&Co, Orlando'),
('group', 'J', 'Suíça',          'Costa Rica',      '2026-06-20 13:00-04', 'Bank of America, Charlotte'),
('group', 'J', 'Bélgica',        'Suíça',           '2026-06-24 16:00-04', 'Inter&Co, Orlando'),
('group', 'J', 'Rep. Congo',     'Costa Rica',      '2026-06-24 16:00-04', 'Bank of America, Charlotte'),

-- Grupo K
('group', 'K', 'Itália',         'Paraguai',        '2026-06-16 20:00-05', 'AT&T Stadium, Dallas'),
('group', 'K', 'Coreia do Sul',  'Iraque',          '2026-06-16 17:00-07', 'SoFi Stadium, Los Angeles'),
('group', 'K', 'Itália',         'Coreia do Sul',   '2026-06-20 20:00-07', 'SoFi Stadium, Los Angeles'),
('group', 'K', 'Iraque',         'Paraguai',        '2026-06-20 17:00-05', 'AT&T Stadium, Dallas'),
('group', 'K', 'Itália',         'Iraque',          '2026-06-24 16:00-07', 'SoFi Stadium, Los Angeles'),
('group', 'K', 'Coreia do Sul',  'Paraguai',        '2026-06-24 16:00-05', 'AT&T Stadium, Dallas'),

-- Grupo L
('group', 'L', 'Marrocos',       'Honduras',        '2026-06-17 19:00-06', 'Arrowhead, Kansas City'),
('group', 'L', 'Croácia',        'Polônia',         '2026-06-17 13:00-04', 'Gillette Stadium, Boston'),
('group', 'L', 'Marrocos',       'Croácia',         '2026-06-21 19:00-04', 'Gillette Stadium, Boston'),
('group', 'L', 'Polônia',        'Honduras',        '2026-06-21 13:00-06', 'Arrowhead, Kansas City'),
('group', 'L', 'Marrocos',       'Polônia',         '2026-06-25 16:00-04', 'Gillette Stadium, Boston'),
('group', 'L', 'Croácia',        'Honduras',        '2026-06-25 16:00-06', 'Arrowhead, Kansas City');

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA: As datas e grupos acima são aproximados. Verifique o calendário oficial
-- em https://www.fifa.com e atualize conforme necessário com:
--   UPDATE bc_copa_matches SET match_date='...' WHERE id=...;
--   UPDATE bc_copa_matches SET home_score=1, away_score=0, status='finished' WHERE id=...;
-- ─────────────────────────────────────────────────────────────────────────────
