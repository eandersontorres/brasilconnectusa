-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Schema Social (Feed estilo Reddit/Nextdoor)
-- Cria: bc_communities, bc_posts, bc_comments, bc_votes, bc_community_members
-- + Seeds das comunidades default (1 por estado USA + cidades grandes + interesses)
-- Executar no SQL Editor do Supabase
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. COMMUNITIES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_communities (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,                  -- ex: 'brasil-tx', 'austin-br'
  name          TEXT NOT NULL,                         -- ex: 'Brasileiros no Texas'
  type          TEXT NOT NULL,                         -- 'general' | 'state' | 'city' | 'interest'
  geo_state     TEXT,                                  -- 'TX', 'FL' (NULL pra interesses)
  geo_city      TEXT,                                  -- 'Austin', 'Boston' (opcional)
  description   TEXT,
  rules         TEXT,                                  -- regras da comunidade (markdown)
  icon          TEXT,                                  -- emoji ou URL
  cover_image   TEXT,
  is_official   BOOLEAN DEFAULT false,                 -- comunidade default vs criada por user
  is_private    BOOLEAN DEFAULT false,                 -- futuro: comunidades privadas
  member_count  INT DEFAULT 0,
  post_count    INT DEFAULT 0,
  created_by    UUID,                                  -- references auth.users(id)
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_type    ON bc_communities(type);
CREATE INDEX IF NOT EXISTS idx_comm_state   ON bc_communities(geo_state);
CREATE INDEX IF NOT EXISTS idx_comm_slug    ON bc_communities(slug);

-- ── 2. COMMUNITY MEMBERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_community_members (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  community_id  UUID NOT NULL REFERENCES bc_communities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,                         -- auth.users(id)
  role          TEXT DEFAULT 'member',                 -- 'member' | 'moderator' | 'admin'
  joined_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_user      ON bc_community_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cm_community ON bc_community_members(community_id);

-- ── 3. POSTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_posts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  community_id    UUID NOT NULL REFERENCES bc_communities(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL,                       -- auth.users(id)
  type            TEXT NOT NULL,                       -- 'question' | 'recommendation' | 'event' | 'classified' | 'job' | 'announcement'
  title           TEXT NOT NULL,
  body            TEXT,
  image_urls      TEXT[],                              -- array de URLs de fotos
  -- Para tipo 'event':
  event_date      TIMESTAMPTZ,
  event_location  TEXT,
  event_rsvp_count INT DEFAULT 0,
  -- Para tipo 'classified':
  classified_price NUMERIC(10,2),                      -- USD
  classified_currency TEXT DEFAULT 'USD',
  classified_kind TEXT,                                -- 'sell' | 'buy' | 'donate' | 'rent'
  classified_contact TEXT,                             -- whatsapp/email visível
  -- Para tipo 'job':
  job_category    TEXT,                                -- 'cleaning' | 'construction' | 'restaurant' | 'nanny' | 'other'
  job_pay         TEXT,                                -- texto livre ('$20/hora', '$200/dia')
  job_location    TEXT,
  job_contact     TEXT,
  -- Engajamento
  upvotes         INT DEFAULT 0,
  downvotes       INT DEFAULT 0,
  comment_count   INT DEFAULT 0,
  view_count      INT DEFAULT 0,
  -- Moderação
  is_pinned       BOOLEAN DEFAULT false,
  is_locked       BOOLEAN DEFAULT false,               -- não aceita mais comentários
  is_deleted      BOOLEAN DEFAULT false,
  reported_count  INT DEFAULT 0,
  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_community  ON bc_posts(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author     ON bc_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_type       ON bc_posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_pinned     ON bc_posts(community_id, is_pinned, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_score      ON bc_posts(community_id, (upvotes - downvotes) DESC, created_at DESC);

-- ── 4. COMMENTS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_comments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id         UUID NOT NULL REFERENCES bc_posts(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES bc_comments(id) ON DELETE CASCADE,  -- threading
  author_id       UUID NOT NULL,
  body            TEXT NOT NULL,
  upvotes         INT DEFAULT 0,
  downvotes       INT DEFAULT 0,
  is_deleted      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_post    ON bc_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent  ON bc_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_author  ON bc_comments(author_id);

-- ── 5. VOTES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_votes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  target_type     TEXT NOT NULL,                       -- 'post' | 'comment'
  target_id       UUID NOT NULL,
  value           SMALLINT NOT NULL,                   -- 1 | -1
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_target ON bc_votes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_votes_user   ON bc_votes(user_id);

-- ── 6. EVENT RSVPs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_event_rsvps (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id     UUID NOT NULL REFERENCES bc_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  status      TEXT NOT NULL,                           -- 'going' | 'maybe' | 'not_going'
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rsvp_post    ON bc_event_rsvps(post_id);
CREATE INDEX IF NOT EXISTS idx_rsvp_user    ON bc_event_rsvps(user_id);

-- ── 7. REPORTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_reports (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id     UUID NOT NULL,
  target_type     TEXT NOT NULL,                       -- 'post' | 'comment' | 'user'
  target_id       UUID NOT NULL,
  reason          TEXT NOT NULL,                       -- 'spam' | 'offensive' | 'fake' | 'other'
  details         TEXT,
  status          TEXT DEFAULT 'open',                 -- 'open' | 'resolved' | 'dismissed'
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON bc_reports(status, created_at DESC);

-- ── 8. RLS desabilitado (APIs usam service key) ────────────────────────────
ALTER TABLE bc_communities         DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_community_members   DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_posts               DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_comments            DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_votes               DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_event_rsvps         DISABLE ROW LEVEL SECURITY;
ALTER TABLE bc_reports             DISABLE ROW LEVEL SECURITY;

-- ── 9. TRIGGERS pra manter contadores em sincronia ────────────────────────

-- Atualiza member_count em bc_communities
CREATE OR REPLACE FUNCTION bc_update_community_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bc_communities SET member_count = member_count + 1 WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE bc_communities SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.community_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_member_count ON bc_community_members;
CREATE TRIGGER trg_member_count
AFTER INSERT OR DELETE ON bc_community_members
FOR EACH ROW EXECUTE FUNCTION bc_update_community_member_count();

-- Atualiza post_count em bc_communities + comment_count em bc_posts
CREATE OR REPLACE FUNCTION bc_update_post_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bc_communities SET post_count = post_count + 1 WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE bc_communities SET post_count = GREATEST(0, post_count - 1) WHERE id = OLD.community_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_count ON bc_posts;
CREATE TRIGGER trg_post_count
AFTER INSERT OR DELETE ON bc_posts
FOR EACH ROW EXECUTE FUNCTION bc_update_post_count();

CREATE OR REPLACE FUNCTION bc_update_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bc_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE bc_posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_count ON bc_comments;
CREATE TRIGGER trg_comment_count
AFTER INSERT OR DELETE ON bc_comments
FOR EACH ROW EXECUTE FUNCTION bc_update_comment_count();

-- Atualiza upvotes/downvotes
CREATE OR REPLACE FUNCTION bc_update_vote_counts()
RETURNS TRIGGER AS $$
DECLARE
  vote_change INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    vote_change := NEW.value;
  ELSIF TG_OP = 'DELETE' THEN
    vote_change := -OLD.value;
  ELSIF TG_OP = 'UPDATE' THEN
    vote_change := NEW.value - OLD.value;
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.target_type = 'post' THEN
      IF vote_change > 0 THEN
        UPDATE bc_posts SET upvotes = upvotes + ABS(vote_change) WHERE id = NEW.target_id;
      ELSIF vote_change < 0 THEN
        UPDATE bc_posts SET downvotes = downvotes + ABS(vote_change) WHERE id = NEW.target_id;
      END IF;
    ELSIF NEW.target_type = 'comment' THEN
      IF vote_change > 0 THEN
        UPDATE bc_comments SET upvotes = upvotes + ABS(vote_change) WHERE id = NEW.target_id;
      ELSIF vote_change < 0 THEN
        UPDATE bc_comments SET downvotes = downvotes + ABS(vote_change) WHERE id = NEW.target_id;
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.target_type = 'post' THEN
      IF OLD.value > 0 THEN
        UPDATE bc_posts SET upvotes = GREATEST(0, upvotes - 1) WHERE id = OLD.target_id;
      ELSE
        UPDATE bc_posts SET downvotes = GREATEST(0, downvotes - 1) WHERE id = OLD.target_id;
      END IF;
    ELSIF OLD.target_type = 'comment' THEN
      IF OLD.value > 0 THEN
        UPDATE bc_comments SET upvotes = GREATEST(0, upvotes - 1) WHERE id = OLD.target_id;
      ELSE
        UPDATE bc_comments SET downvotes = GREATEST(0, downvotes - 1) WHERE id = OLD.target_id;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vote_counts ON bc_votes;
CREATE TRIGGER trg_vote_counts
AFTER INSERT OR UPDATE OR DELETE ON bc_votes
FOR EACH ROW EXECUTE FUNCTION bc_update_vote_counts();

-- ── 10. SEEDS — Comunidades default ────────────────────────────────────────

-- Comunidade GERAL (sempre)
INSERT INTO bc_communities (slug, name, type, description, icon, is_official) VALUES
  ('brasil', 'Brasileiros nos EUA', 'general', 'A comunidade geral. Tudo que interessa a brasileiros vivendo nos Estados Unidos.', '🇧🇷', true)
ON CONFLICT (slug) DO NOTHING;

-- Comunidades por ESTADO (USA)
INSERT INTO bc_communities (slug, name, type, geo_state, description, icon, is_official) VALUES
  ('brasil-al', 'Brasileiros no Alabama',       'state', 'AL', 'Comunidade dos brasileiros no Alabama',       '🌟', true),
  ('brasil-ak', 'Brasileiros no Alasca',        'state', 'AK', 'Comunidade dos brasileiros no Alasca',        '🌟', true),
  ('brasil-az', 'Brasileiros no Arizona',       'state', 'AZ', 'Comunidade dos brasileiros no Arizona',       '🌵', true),
  ('brasil-ar', 'Brasileiros no Arkansas',      'state', 'AR', 'Comunidade dos brasileiros no Arkansas',      '🌟', true),
  ('brasil-ca', 'Brasileiros na California',    'state', 'CA', 'Comunidade dos brasileiros na California',    '☀️', true),
  ('brasil-co', 'Brasileiros no Colorado',      'state', 'CO', 'Comunidade dos brasileiros no Colorado',      '🏔', true),
  ('brasil-ct', 'Brasileiros no Connecticut',   'state', 'CT', 'Comunidade dos brasileiros no Connecticut',   '🌟', true),
  ('brasil-de', 'Brasileiros no Delaware',      'state', 'DE', 'Comunidade dos brasileiros no Delaware',      '🌟', true),
  ('brasil-dc', 'Brasileiros em D.C.',          'state', 'DC', 'Comunidade dos brasileiros em Washington D.C.', '🏛', true),
  ('brasil-fl', 'Brasileiros na Flórida',       'state', 'FL', 'A maior comunidade brasileira nos EUA. Miami, Orlando, Tampa.', '🌴', true),
  ('brasil-ga', 'Brasileiros na Geórgia',       'state', 'GA', 'Comunidade dos brasileiros na Geórgia (Atlanta)', '🍑', true),
  ('brasil-hi', 'Brasileiros no Havaí',         'state', 'HI', 'Comunidade dos brasileiros no Havaí',         '🌺', true),
  ('brasil-id', 'Brasileiros no Idaho',         'state', 'ID', 'Comunidade dos brasileiros no Idaho',         '🌟', true),
  ('brasil-il', 'Brasileiros em Illinois',      'state', 'IL', 'Comunidade dos brasileiros em Illinois (Chicago)', '🌆', true),
  ('brasil-in', 'Brasileiros em Indiana',       'state', 'IN', 'Comunidade dos brasileiros em Indiana',       '🌟', true),
  ('brasil-ia', 'Brasileiros em Iowa',          'state', 'IA', 'Comunidade dos brasileiros em Iowa',          '🌟', true),
  ('brasil-ks', 'Brasileiros no Kansas',        'state', 'KS', 'Comunidade dos brasileiros no Kansas',        '🌟', true),
  ('brasil-ky', 'Brasileiros no Kentucky',      'state', 'KY', 'Comunidade dos brasileiros no Kentucky',      '🌟', true),
  ('brasil-la', 'Brasileiros na Louisiana',     'state', 'LA', 'Comunidade dos brasileiros na Louisiana',     '🌟', true),
  ('brasil-me', 'Brasileiros no Maine',         'state', 'ME', 'Comunidade dos brasileiros no Maine',         '🌟', true),
  ('brasil-md', 'Brasileiros em Maryland',      'state', 'MD', 'Comunidade dos brasileiros em Maryland',      '🌟', true),
  ('brasil-ma', 'Brasileiros em Massachusetts', 'state', 'MA', 'Boston e arredores. Uma das maiores comunidades.', '🎓', true),
  ('brasil-mi', 'Brasileiros em Michigan',      'state', 'MI', 'Comunidade dos brasileiros em Michigan',      '🌟', true),
  ('brasil-mn', 'Brasileiros em Minnesota',     'state', 'MN', 'Comunidade dos brasileiros em Minnesota',     '❄️', true),
  ('brasil-ms', 'Brasileiros no Mississippi',   'state', 'MS', 'Comunidade dos brasileiros no Mississippi',   '🌟', true),
  ('brasil-mo', 'Brasileiros no Missouri',      'state', 'MO', 'Comunidade dos brasileiros no Missouri',      '🌟', true),
  ('brasil-mt', 'Brasileiros em Montana',       'state', 'MT', 'Comunidade dos brasileiros em Montana',       '🌟', true),
  ('brasil-ne', 'Brasileiros em Nebraska',      'state', 'NE', 'Comunidade dos brasileiros em Nebraska',      '🌟', true),
  ('brasil-nv', 'Brasileiros em Nevada',        'state', 'NV', 'Comunidade dos brasileiros em Nevada (Las Vegas)', '🎰', true),
  ('brasil-nh', 'Brasileiros em New Hampshire', 'state', 'NH', 'Comunidade dos brasileiros em New Hampshire', '🌟', true),
  ('brasil-nj', 'Brasileiros em New Jersey',    'state', 'NJ', 'Newark é casa de muitos brasileiros',          '🏙', true),
  ('brasil-nm', 'Brasileiros em New Mexico',    'state', 'NM', 'Comunidade dos brasileiros em New Mexico',    '🌟', true),
  ('brasil-ny', 'Brasileiros em New York',      'state', 'NY', 'Manhattan, Astoria, Newark — a comunidade NY/NJ', '🗽', true),
  ('brasil-nc', 'Brasileiros na Carolina do Norte', 'state', 'NC', 'Comunidade dos brasileiros na NC',        '🌟', true),
  ('brasil-nd', 'Brasileiros na Dakota do Norte', 'state', 'ND', 'Comunidade dos brasileiros na ND',          '🌟', true),
  ('brasil-oh', 'Brasileiros em Ohio',          'state', 'OH', 'Comunidade dos brasileiros em Ohio',          '🌟', true),
  ('brasil-ok', 'Brasileiros em Oklahoma',      'state', 'OK', 'Comunidade dos brasileiros em Oklahoma',      '🌟', true),
  ('brasil-or', 'Brasileiros no Oregon',        'state', 'OR', 'Comunidade dos brasileiros no Oregon',        '🌲', true),
  ('brasil-pa', 'Brasileiros na Pensilvânia',   'state', 'PA', 'Comunidade dos brasileiros na PA',            '🌟', true),
  ('brasil-ri', 'Brasileiros em Rhode Island',  'state', 'RI', 'Comunidade dos brasileiros em RI',            '🌟', true),
  ('brasil-sc', 'Brasileiros na Carolina do Sul', 'state', 'SC', 'Comunidade dos brasileiros na SC',          '🌟', true),
  ('brasil-sd', 'Brasileiros na Dakota do Sul', 'state', 'SD', 'Comunidade dos brasileiros na SD',            '🌟', true),
  ('brasil-tn', 'Brasileiros no Tennessee',     'state', 'TN', 'Comunidade dos brasileiros no Tennessee',     '🎵', true),
  ('brasil-tx', 'Brasileiros no Texas',         'state', 'TX', 'Austin, Houston, Dallas — os brasileiros do Texas', '🤠', true),
  ('brasil-ut', 'Brasileiros em Utah',          'state', 'UT', 'Comunidade dos brasileiros em Utah',          '🌟', true),
  ('brasil-vt', 'Brasileiros em Vermont',       'state', 'VT', 'Comunidade dos brasileiros em Vermont',       '🌟', true),
  ('brasil-va', 'Brasileiros na Virgínia',      'state', 'VA', 'Comunidade dos brasileiros na Virgínia',      '🌟', true),
  ('brasil-wa', 'Brasileiros em Washington',    'state', 'WA', 'Seattle e arredores',                          '☔', true),
  ('brasil-wv', 'Brasileiros na West Virginia', 'state', 'WV', 'Comunidade dos brasileiros na WV',            '🌟', true),
  ('brasil-wi', 'Brasileiros em Wisconsin',     'state', 'WI', 'Comunidade dos brasileiros em Wisconsin',     '🌟', true),
  ('brasil-wy', 'Brasileiros em Wyoming',       'state', 'WY', 'Comunidade dos brasileiros em Wyoming',       '🌟', true)
ON CONFLICT (slug) DO NOTHING;

-- Comunidades por CIDADE (principais hubs brasileiros)
INSERT INTO bc_communities (slug, name, type, geo_state, geo_city, description, icon, is_official) VALUES
  ('boston-br',     'Boston Brasileira',      'city', 'MA', 'Boston',      'Brasileiros em Boston e Massachusetts metro', '🎓', true),
  ('miami-br',      'Miami Brasileira',       'city', 'FL', 'Miami',       'Brasileiros em Miami, Aventura, Doral',       '🌴', true),
  ('orlando-br',    'Orlando Brasileira',     'city', 'FL', 'Orlando',     'Brasileiros em Orlando e arredores',          '🏰', true),
  ('austin-br',     'Austin Brasileira',      'city', 'TX', 'Austin',      'Brasileiros em Austin, Round Rock, Cedar Park', '🤠', true),
  ('houston-br',    'Houston Brasileira',     'city', 'TX', 'Houston',     'Brasileiros em Houston e Sugar Land',         '🛢', true),
  ('dallas-br',     'Dallas Brasileira',      'city', 'TX', 'Dallas',      'Brasileiros em Dallas-Fort Worth',            '⭐', true),
  ('newyork-br',    'NY/NJ Brasileira',       'city', 'NY', 'New York',    'Brasileiros em NY metro (incluindo NJ)',      '🗽', true),
  ('atlanta-br',    'Atlanta Brasileira',     'city', 'GA', 'Atlanta',     'Brasileiros em Atlanta metro',                '🍑', true),
  ('chicago-br',    'Chicago Brasileira',     'city', 'IL', 'Chicago',     'Brasileiros em Chicago metro',                '🌆', true),
  ('losangeles-br', 'LA Brasileira',          'city', 'CA', 'Los Angeles', 'Brasileiros em LA metro',                     '🌴', true),
  ('tampa-br',      'Tampa Brasileira',       'city', 'FL', 'Tampa',       'Brasileiros em Tampa Bay',                    '🌴', true)
ON CONFLICT (slug) DO NOTHING;

-- Comunidades de INTERESSE
INSERT INTO bc_communities (slug, name, type, description, icon, is_official) VALUES
  ('maes-brasileiras',     'Mães Brasileiras',         'interest', 'Espaço para mães brasileiras nos EUA: educação, saúde, dicas e apoio', '👶', true),
  ('empreendedoras',       'Empreendedoras Brasileiras', 'interest', 'Mulheres brasileiras empreendendo nos EUA', '💼', true),
  ('caminhoneiros-cdl',    'Caminhoneiros & CDL',      'interest', 'Brasileiros que dirigem caminhão (CDL): rotas, vagas, dicas', '🚛', true),
  ('construcao',           'Construção Civil',         'interest', 'Trabalhadores brasileiros na construção: vagas, segurança, dicas', '🔨', true),
  ('limpeza',              'Limpeza & Faxina',         'interest', 'Profissionais de limpeza: clientes, materiais, organização',  '🧹', true),
  ('imigracao',            'Imigração & Documentos',   'interest', 'Visto, Green Card, ITIN, cidadania — dúvidas e experiências', '📋', true),
  ('imoveis',              'Imóveis & Mortgage',       'interest', 'Comprar/alugar/vender casa nos EUA',           '🏡', true),
  ('comida-brasileira',    'Comida Brasileira',        'interest', 'Onde achar ingredientes, restaurantes, receitas', '🍛', true),
  ('religiao',             'Igrejas & Comunidades de Fé', 'interest', 'Igrejas brasileiras nos EUA, eventos religiosos',   '⛪', true),
  ('estudantes',           'Estudantes Internacionais', 'interest', 'Brasileiros estudando nos EUA: universidades, vistos F-1, OPT', '🎒', true),
  ('au-pair',              'Au Pair Brasileiras',      'interest', 'Au pairs brasileiras: experiências, host families, J-1', '👩‍👧', true),
  ('tech-brasileiros',     'Tech & Engenharia',        'interest', 'Brasileiros em tech nos EUA: vagas, H-1B, networking', '💻', true)
ON CONFLICT (slug) DO NOTHING;

-- ── 11. VERIFICAÇÃO ────────────────────────────────────────────────────────
SELECT
  'Schema social aplicado com sucesso' AS status,
  (SELECT COUNT(*) FROM bc_communities WHERE type='general')   AS comunidades_geral,
  (SELECT COUNT(*) FROM bc_communities WHERE type='state')     AS comunidades_estado,
  (SELECT COUNT(*) FROM bc_communities WHERE type='city')      AS comunidades_cidade,
  (SELECT COUNT(*) FROM bc_communities WHERE type='interest')  AS comunidades_interesse,
  (SELECT COUNT(*) FROM bc_communities)                        AS total;
