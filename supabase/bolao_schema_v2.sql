-- ─────────────────────────────────────────────────────────────────────────────
-- BrasilConnect – Bolão Copa 2026 – DADOS OFICIAIS
-- Sorteio: 05/12/2025, Kennedy Center, Washington D.C.
-- Calendário: FIFA / Fox Sports / NBC Sports / ESPN
-- Execute no SQL Editor do Supabase
-- ─────────────────────────────────────────────────────────────────────────────

-- Limpar dados antigos
DELETE FROM bc_bolao_predictions;
DELETE FROM bc_copa_matches;
ALTER SEQUENCE bc_copa_matches_id_seq RESTART WITH 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE DE GRUPOS
-- Horários em UTC (EDT = UTC-4 no verão)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO bc_copa_matches (phase, group_name, home_team, away_team, match_date, venue) VALUES

-- ══ GRUPO A: México · África do Sul · Coreia do Sul · Rep. Tcheca ════════════
-- R1: 11 jun
('group','A','México',        'África do Sul', '2026-06-11 19:00+00', 'Estadio Azteca, Cidade do México'),
('group','A','Coreia do Sul', 'Rep. Tcheca',   '2026-06-12 02:00+00', 'Estadio Akron, Guadalajara'),
-- R2: 17 jun
('group','A','México',        'Coreia do Sul', '2026-06-17 22:00+00', 'Estadio Akron, Guadalajara'),
('group','A','África do Sul', 'Rep. Tcheca',   '2026-06-18 01:00+00', 'Estadio BBVA, Monterrey'),
-- R3: 22 jun (simultâneas)
('group','A','México',        'Rep. Tcheca',   '2026-06-22 22:00+00', 'Estadio Azteca, Cidade do México'),
('group','A','África do Sul', 'Coreia do Sul', '2026-06-22 22:00+00', 'Estadio BBVA, Monterrey'),

-- ══ GRUPO B: Canadá · Bósnia · Qatar · Suíça ════════════════════════════════
-- R1
('group','B','Canadá',  'Bósnia', '2026-06-12 19:00+00', 'BMO Field, Toronto'),
('group','B','Qatar',   'Suíça',  '2026-06-13 19:00+00', 'Levi''s Stadium, Santa Clara'),
-- R2
('group','B','Suíça',   'Bósnia', '2026-06-18 19:00+00', 'SoFi Stadium, Inglewood'),
('group','B','Canadá',  'Qatar',  '2026-06-18 22:00+00', 'BC Place, Vancouver'),
-- R3 (simultâneas)
('group','B','Suíça',   'Canadá', '2026-06-24 19:00+00', 'BC Place, Vancouver'),
('group','B','Bósnia',  'Qatar',  '2026-06-24 19:00+00', 'Lumen Field, Seattle'),

-- ══ GRUPO C: Brasil · Marrocos · Haiti · Escócia ═════════════════════════════
-- R1: 13 jun
('group','C','Brasil',   'Marrocos', '2026-06-13 22:00+00', 'MetLife Stadium, East Rutherford NJ'),
('group','C','Haiti',    'Escócia',  '2026-06-14 01:00+00', 'Gillette Stadium, Foxborough MA'),
-- R2: 19 jun
('group','C','Escócia',  'Marrocos', '2026-06-19 22:00+00', 'Gillette Stadium, Foxborough MA'),
('group','C','Brasil',   'Haiti',    '2026-06-20 01:00+00', 'Lincoln Financial, Filadélfia'),
-- R3: 24 jun (simultâneas)
('group','C','Escócia',  'Brasil',   '2026-06-24 22:00+00', 'Hard Rock Stadium, Miami'),
('group','C','Marrocos', 'Haiti',    '2026-06-24 22:00+00', 'Mercedes-Benz, Atlanta'),

-- ══ GRUPO D: EUA · Paraguai · Austrália · Turquia ═══════════════════════════
-- R1
('group','D','EUA',       'Paraguai',  '2026-06-13 01:00+00', 'SoFi Stadium, Inglewood'),
('group','D','Austrália', 'Turquia',   '2026-06-14 04:00+00', 'BC Place, Vancouver'),
-- R2
('group','D','EUA',       'Austrália', '2026-06-19 19:00+00', 'Lumen Field, Seattle'),
('group','D','Turquia',   'Paraguai',  '2026-06-20 04:00+00', 'Levi''s Stadium, Santa Clara'),
-- R3 (simultâneas)
('group','D','Turquia',   'EUA',       '2026-06-26 02:00+00', 'SoFi Stadium, Inglewood'),
('group','D','Paraguai',  'Austrália', '2026-06-26 02:00+00', 'Levi''s Stadium, Santa Clara'),

-- ══ GRUPO E: Alemanha · Curaçau · Costa do Marfim · Equador ═════════════════
-- R1: 15 jun
('group','E','Alemanha',        'Equador',         '2026-06-15 22:00+00', 'AT&T Stadium, Arlington TX'),
('group','E','Curaçau',         'Costa do Marfim', '2026-06-16 01:00+00', 'Arrowhead, Kansas City'),
-- R2: 20 jun
('group','E','Alemanha',        'Costa do Marfim', '2026-06-20 20:00+00', 'BMO Field, Toronto'),
('group','E','Equador',         'Curaçau',          '2026-06-21 00:00+00', 'Arrowhead, Kansas City'),
-- R3: 25 jun (simultâneas)
('group','E','Equador',         'Alemanha',         '2026-06-25 20:00+00', 'MetLife Stadium, East Rutherford NJ'),
('group','E','Curaçau',         'Costa do Marfim',  '2026-06-25 20:00+00', 'Lincoln Financial, Filadélfia'),

-- ══ GRUPO F: Holanda · Japão · Suécia · Tunísia ═════════════════════════════
-- R1: 14 jun
('group','F','Holanda', 'Japão',   '2026-06-14 20:00+00', 'AT&T Stadium, Arlington TX'),
('group','F','Suécia',  'Tunísia', '2026-06-15 02:00+00', 'Estadio BBVA, Monterrey'),
-- R2: 20 jun
('group','F','Holanda', 'Suécia',  '2026-06-20 17:00+00', 'NRG Stadium, Houston'),
('group','F','Tunísia', 'Japão',   '2026-06-20 22:00+00', 'Estadio BBVA, Monterrey'),
-- R3: 25 jun (simultâneas)
('group','F','Japão',   'Suécia',  '2026-06-25 22:00+00', 'Levi''s Stadium, Santa Clara'),
('group','F','Tunísia', 'Holanda', '2026-06-25 22:00+00', 'NRG Stadium, Houston'),

-- ══ GRUPO G: Bélgica · Egito · Irã · Nova Zelândia ══════════════════════════
-- R1: 15 jun
('group','G','Bélgica', 'Egito',         '2026-06-15 19:00+00', 'Arrowhead, Kansas City'),
('group','G','Irã',     'Nova Zelândia', '2026-06-16 01:00+00', 'SoFi Stadium, Inglewood'),
-- R2: 21 jun
('group','G','Bélgica',       'Irã',           '2026-06-21 20:00+00', 'Arrowhead, Kansas City'),
('group','G','Nova Zelândia', 'Egito',          '2026-06-22 01:00+00', 'BC Place, Vancouver'),
-- R3: 26 jun (simultâneas)
('group','G','Bélgica',       'Nova Zelândia',  '2026-06-26 22:00+00', 'SoFi Stadium, Inglewood'),
('group','G','Egito',         'Irã',            '2026-06-26 22:00+00', 'Lumen Field, Seattle'),

-- ══ GRUPO H: Espanha · Cabo Verde · Arábia Saudita · Uruguai ════════════════
-- R1: 15 jun
('group','H','Espanha',        'Cabo Verde',      '2026-06-15 16:00+00', 'Hard Rock Stadium, Miami'),
('group','H','Arábia Saudita', 'Uruguai',         '2026-06-15 22:00+00', 'Mercedes-Benz, Atlanta'),
-- R2: 21 jun
('group','H','Espanha',        'Arábia Saudita',  '2026-06-21 16:00+00', 'Hard Rock Stadium, Miami'),
('group','H','Cabo Verde',     'Uruguai',         '2026-06-21 22:00+00', 'Mercedes-Benz, Atlanta'),
-- R3: 26 jun (simultâneas)
('group','H','Cabo Verde',     'Arábia Saudita',  '2026-06-26 20:00+00', 'Camping World, Orlando'),
('group','H','Uruguai',        'Espanha',         '2026-06-26 20:00+00', 'Hard Rock Stadium, Miami'),

-- ══ GRUPO I: França · Senegal · Iraque · Noruega ════════════════════════════
-- R1: 16 jun
('group','I','França',   'Senegal', '2026-06-16 19:00+00', 'MetLife Stadium, East Rutherford NJ'),
('group','I','Iraque',   'Noruega', '2026-06-16 22:00+00', 'Gillette Stadium, Foxborough MA'),
-- R2: 22 jun
('group','I','Noruega',  'Senegal', '2026-06-23 00:00+00', 'Gillette Stadium, Foxborough MA'),
('group','I','França',   'Iraque',  '2026-06-22 21:00+00', 'Lincoln Financial, Filadélfia'),
-- R3: 27 jun (simultâneas)
('group','I','França',   'Noruega', '2026-06-27 20:00+00', 'MetLife Stadium, East Rutherford NJ'),
('group','I','Senegal',  'Iraque',  '2026-06-27 20:00+00', 'Gillette Stadium, Foxborough MA'),

-- ══ GRUPO J: Argentina · Argélia · Áustria · Jordânia ═══════════════════════
-- R1: 16-17 jun
('group','J','Argentina', 'Argélia', '2026-06-17 01:00+00', 'Arrowhead, Kansas City'),
('group','J','Áustria',   'Jordânia','2026-06-17 04:00+00', 'Levi''s Stadium, Santa Clara'),
-- R2: 22 jun
('group','J','Argentina', 'Áustria', '2026-06-22 22:00+00', 'Soldier Field, Chicago'),
('group','J','Argélia',   'Jordânia','2026-06-23 01:00+00', 'Bank of America, Charlotte'),
-- R3: 27 jun (simultâneas)
('group','J','Jordânia',  'Argentina','2026-06-27 22:00+00', 'Soldier Field, Chicago'),
('group','J','Argélia',   'Áustria',  '2026-06-27 22:00+00', 'Bank of America, Charlotte'),

-- ══ GRUPO K: Portugal · Rep. Congo · Uzbequistão · Colômbia ═════════════════
-- R1: 17 jun
('group','K','Portugal',    'Rep. Congo',   '2026-06-17 17:00+00', 'NRG Stadium, Houston'),
('group','K','Uzbequistão', 'Colômbia',     '2026-06-18 02:00+00', 'Estadio Azteca, Cidade do México'),
-- R2: 23 jun
('group','K','Portugal',    'Uzbequistão',  '2026-06-23 22:00+00', 'NRG Stadium, Houston'),
('group','K','Rep. Congo',  'Colômbia',     '2026-06-24 01:00+00', 'Camping World, Orlando'),
-- R3: 27 jun (simultâneas)
('group','K','Portugal',    'Colômbia',     '2026-06-28 20:00+00', 'NRG Stadium, Houston'),
('group','K','Rep. Congo',  'Uzbequistão',  '2026-06-28 20:00+00', 'Camping World, Orlando'),

-- ══ GRUPO L: Inglaterra · Croácia · Gana · Panamá ═══════════════════════════
-- R1: 17-18 jun
('group','L','Inglaterra', 'Croácia', '2026-06-17 20:00+00', 'AT&T Stadium, Arlington TX'),
('group','L','Gana',       'Panamá',  '2026-06-17 23:00+00', 'BMO Field, Toronto'),
-- R2: 23 jun
('group','L','Inglaterra', 'Gana',    '2026-06-23 20:00+00', 'MetLife Stadium, East Rutherford NJ'),
('group','L','Croácia',    'Panamá',  '2026-06-23 22:00+00', 'Lincoln Financial, Filadélfia'),
-- R3: 27-28 jun (simultâneas)
('group','L','Panamá',     'Inglaterra','2026-06-28 21:00+00', 'AT&T Stadium, Arlington TX'),
('group','L','Croácia',    'Gana',      '2026-06-28 21:00+00', 'BMO Field, Toronto');

-- Verificar resultado
SELECT group_name, home_team, away_team,
       to_char(match_date AT TIME ZONE 'America/New_York', 'DD/MM HH24:MI') AS horario_et
FROM bc_copa_matches
ORDER BY match_date;
