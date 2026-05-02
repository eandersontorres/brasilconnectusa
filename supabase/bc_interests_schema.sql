-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Grupos de Interesse (cold-start lógica)
-- 26 interesses + 8 grupos família com threshold configurável
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Waitlist por interesse
CREATE TABLE IF NOT EXISTS bc_interest_waitlist (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL,
  interest_id   TEXT NOT NULL,
  state         TEXT NOT NULL,
  city          TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  notified      BOOLEAN DEFAULT FALSE,
  UNIQUE(email, interest_id, state)
);
CREATE INDEX IF NOT EXISTS idx_iwl_interest_state ON bc_interest_waitlist(interest_id, state);
CREATE INDEX IF NOT EXISTS idx_iwl_email ON bc_interest_waitlist(email);

-- Configuração de thresholds (editável via Supabase Dashboard)
CREATE TABLE IF NOT EXISTS bc_interest_config (
  interest_id          TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  category             TEXT,                 -- 'esporte', 'cultura', 'familia', 'tech', 'outros'
  description          TEXT,
  threshold            INT DEFAULT 10,       -- valor padrão de pessoas pra ativar
  threshold_overrides  JSONB DEFAULT '{}',   -- { "TX": 6, "FL": 8 } — override por estado
  is_sensitive         BOOLEAN DEFAULT FALSE,
  display_order        INT DEFAULT 0,
  active               BOOLEAN DEFAULT TRUE
);

-- Grupos ativos
CREATE TABLE IF NOT EXISTS bc_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interest_id     TEXT NOT NULL REFERENCES bc_interest_config(interest_id),
  state           TEXT NOT NULL,
  city            TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  members_count   INT DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(interest_id, state, city)
);
CREATE INDEX IF NOT EXISTS idx_groups_interest ON bc_groups(interest_id);
CREATE INDEX IF NOT EXISTS idx_groups_state ON bc_groups(state);

-- Membros dos grupos (paying users)
CREATE TABLE IF NOT EXISTS bc_group_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES bc_groups(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  display_name    TEXT,
  role            TEXT DEFAULT 'member',  -- 'member', 'organizer', 'admin'
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  is_active       BOOLEAN DEFAULT TRUE,
  UNIQUE(group_id, email)
);
CREATE INDEX IF NOT EXISTS idx_gm_group ON bc_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_gm_email ON bc_group_members(email);

-- Eventos dos grupos
CREATE TABLE IF NOT EXISTS bc_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES bc_groups(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  location        TEXT,
  starts_at       TIMESTAMPTZ NOT NULL,
  max_attendees   INT,
  rsvp_count      INT DEFAULT 0,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_group ON bc_events(group_id);
CREATE INDEX IF NOT EXISTS idx_events_starts ON bc_events(starts_at);

CREATE TABLE IF NOT EXISTS bc_event_rsvps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id        UUID NOT NULL REFERENCES bc_events(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  display_name    TEXT,
  status          TEXT DEFAULT 'going',  -- 'going', 'maybe', 'not_going'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, email)
);

-- RLS
ALTER TABLE bc_interest_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_interest_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_event_rsvps       ENABLE ROW LEVEL SECURITY;

-- Triggers de contadores
CREATE OR REPLACE FUNCTION bc_inc_group_members()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bc_groups SET members_count = members_count + 1 WHERE id = NEW.group_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE bc_groups SET members_count = GREATEST(members_count - 1, 0) WHERE id = OLD.group_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS bc_gm_count ON bc_group_members;
CREATE TRIGGER bc_gm_count AFTER INSERT OR DELETE ON bc_group_members FOR EACH ROW EXECUTE FUNCTION bc_inc_group_members();

CREATE OR REPLACE FUNCTION bc_inc_rsvp()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'going' THEN
    UPDATE bc_events SET rsvp_count = rsvp_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'going' THEN
    UPDATE bc_events SET rsvp_count = GREATEST(rsvp_count - 1, 0) WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS bc_rsvp_count ON bc_event_rsvps;
CREATE TRIGGER bc_rsvp_count AFTER INSERT OR DELETE ON bc_event_rsvps FOR EACH ROW EXECUTE FUNCTION bc_inc_rsvp();

-- View: contagem de waitlist por interesse + estado
CREATE OR REPLACE VIEW bc_waitlist_progress AS
SELECT
  w.interest_id,
  w.state,
  COUNT(*) AS waiting,
  c.threshold AS default_threshold,
  COALESCE((c.threshold_overrides->>w.state)::INT, c.threshold) AS effective_threshold,
  c.name AS interest_name,
  c.is_sensitive
FROM bc_interest_waitlist w
JOIN bc_interest_config c ON c.interest_id = w.interest_id
WHERE w.notified = FALSE
GROUP BY w.interest_id, w.state, c.threshold, c.threshold_overrides, c.name, c.is_sensitive;

-- Lista de IDs de grupos sensíveis (privacidade)
CREATE TABLE IF NOT EXISTS bc_sensitive_group_ids (
  interest_id TEXT PRIMARY KEY
);
INSERT INTO bc_sensitive_group_ids(interest_id) VALUES
  ('criancas_atipicas'), ('pais_solo'), ('maes_recem_nascidos'),
  ('saude_mental'), ('luto'), ('divorcio')
ON CONFLICT DO NOTHING;

-- Seed de interesses padrão
INSERT INTO bc_interest_config(interest_id, name, category, description, threshold, is_sensitive, display_order) VALUES
  -- Esportes
  ('futebol',          'Futebol',                  'esporte',  'Pelada de domingo, futsal, society', 8, FALSE, 10),
  ('volei',            'Vôlei',                    'esporte',  'Praia, quadra, casual',              8, FALSE, 11),
  ('tennis',           'Tênis',                    'esporte',  'Court, doubles, lições',             6, FALSE, 12),
  ('corrida',          'Corrida',                  'esporte',  'Treinos, 5k, meia maratona',         8, FALSE, 13),
  ('musculacao',       'Musculação / Crossfit',    'esporte',  'Academia, Crossfit',                 6, FALSE, 14),
  -- Cultura
  ('vinho',            'Vinho',                    'cultura',  'Degustações, harmonização',          6, FALSE, 20),
  ('cerveja',          'Cerveja artesanal',        'cultura',  'Brewery tours, novidades',           8, FALSE, 21),
  ('livros',           'Clube do livro',           'cultura',  'Leituras mensais, debates',          6, FALSE, 22),
  ('cinema',           'Cinema',                   'cultura',  'Estreias, festivais',                6, FALSE, 23),
  ('musica',           'Música',                   'cultura',  'Sertanejo, samba, jazz',             6, FALSE, 24),
  ('arte',             'Arte e museus',            'cultura',  'Visitas, exposições',                6, FALSE, 25),
  ('gastronomia',      'Gastronomia',              'cultura',  'Restaurantes, churrascos',           6, FALSE, 26),
  -- Tech / profissional
  ('tech',             'Tech & Startups',          'tech',     'Engenharia, produto, IA',           10, FALSE, 30),
  ('empreendedorismo', 'Empreendedorismo',         'tech',     'LLC, Stripe, marketing, sales',     10, FALSE, 31),
  ('investimentos',    'Investimentos & Finanças', 'tech',     'IRA, 401k, ações, cripto',           8, FALSE, 32),
  -- Lazer
  ('games',            'Games & RPG',              'lazer',    'Online e presencial',                8, FALSE, 40),
  ('viagem',           'Viagem & turismo',         'lazer',    'Roadtrips, aventuras nos EUA',       6, FALSE, 41),
  ('fotografia',       'Fotografia',               'lazer',    'Workshops, fotowalks',               6, FALSE, 42),
  -- FAMÍLIA
  ('maes_recem_nascidos','Mães de recém-nascidos', 'familia',  'Suporte, dúvidas, troca',            5, TRUE, 50),
  ('maes_bebes',       'Mães de bebês (1-3 anos)', 'familia',  'Adaptação, escola, rotina',          5, TRUE, 51),
  ('pais_pequenos',    'Pais de crianças pequenas','familia',  'Escola americana, atividades',       6, TRUE, 52),
  ('criancas_atipicas','Crianças atípicas',        'familia',  'TEA, TDAH, SPD — suporte',           5, TRUE, 53),
  ('gravidas',         'Grávidas nos EUA',         'familia',  'Pré-natal, parto, seguro',           5, TRUE, 54),
  ('pais_solo',        'Pais e mães solo',         'familia',  'Comunidade de apoio',                5, TRUE, 55),
  ('gemeos',           'Gêmeos & múltiplos',       'familia',  'Casos específicos',                  4, TRUE, 56),
  ('bilingues',        'Filhos bilíngues',         'familia',  'Português em casa, escola US',       6, TRUE, 57)
ON CONFLICT (interest_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  threshold = EXCLUDED.threshold;
