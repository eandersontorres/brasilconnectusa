-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Schema Extras
-- Adiciona:
--   1. bc_contact_messages (formulario Fale Conosco)
--   2. Estende bc_communities com pre-requisitos e visibilidade
--   3. bc_community_join_requests (aprovacao pra comunidades restritas)
--   4. Estende bc_businesses com fotos/videos/portfolio
--   5. Estende ag_providers com fotos/videos/portfolio
--   6. Cria comunidades especiais (Maes Atipicas com pre-requisitos)
-- Executar no SQL Editor do Supabase
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. CONTACT MESSAGES (Fale Conosco) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_contact_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  message     TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  status      TEXT DEFAULT 'new',           -- 'new' | 'read' | 'replied' | 'archived'
  reply_notes TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_status ON bc_contact_messages(status, created_at DESC);
ALTER TABLE bc_contact_messages DISABLE ROW LEVEL SECURITY;

-- ── 2. ESTENDE bc_communities com pre-requisitos ────────────────────────
ALTER TABLE bc_communities
  ADD COLUMN IF NOT EXISTS requires_approval   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS prerequisites_text  TEXT,
  ADD COLUMN IF NOT EXISTS join_question       TEXT,
  ADD COLUMN IF NOT EXISTS visibility          TEXT DEFAULT 'public';
  -- visibility: 'public' (qualquer um ve) | 'restricted' (so membros veem posts)

-- ── 3. JOIN REQUESTS pra comunidades restritas ──────────────────────────
CREATE TABLE IF NOT EXISTS bc_community_join_requests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  community_id    UUID NOT NULL REFERENCES bc_communities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  answer          TEXT,
  status          TEXT DEFAULT 'pending',     -- 'pending' | 'approved' | 'rejected'
  reviewer_id     UUID,
  reviewed_at     TIMESTAMPTZ,
  reviewer_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_join_req_status ON bc_community_join_requests(community_id, status);
CREATE INDEX IF NOT EXISTS idx_join_req_user ON bc_community_join_requests(user_id);
ALTER TABLE bc_community_join_requests DISABLE ROW LEVEL SECURITY;

-- ── 4. ESTENDE bc_businesses com fotos/videos/portfolio ─────────────────
ALTER TABLE bc_businesses
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS cover_url       TEXT,
  ADD COLUMN IF NOT EXISTS gallery_urls    TEXT[],
  ADD COLUMN IF NOT EXISTS video_url       TEXT,
  ADD COLUMN IF NOT EXISTS instagram       TEXT,
  ADD COLUMN IF NOT EXISTS facebook        TEXT,
  ADD COLUMN IF NOT EXISTS tiktok          TEXT,
  ADD COLUMN IF NOT EXISTS owner_email     TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id   UUID;

CREATE INDEX IF NOT EXISTS idx_biz_owner ON bc_businesses(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_biz_owner_email ON bc_businesses(owner_email);

-- ── 5. ESTENDE ag_providers com portfolio ────────────────────────────────
ALTER TABLE ag_providers
  ADD COLUMN IF NOT EXISTS avatar_url      TEXT,
  ADD COLUMN IF NOT EXISTS cover_url       TEXT,
  ADD COLUMN IF NOT EXISTS gallery_urls    TEXT[],
  ADD COLUMN IF NOT EXISTS video_url       TEXT,
  ADD COLUMN IF NOT EXISTS bio             TEXT,
  ADD COLUMN IF NOT EXISTS instagram       TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id   UUID;

CREATE INDEX IF NOT EXISTS idx_prov_owner ON ag_providers(owner_user_id);

-- ── 6. SEEDS — Comunidades especiais com pre-requisitos ─────────────────
INSERT INTO bc_communities (slug, name, type, description, is_official, requires_approval, prerequisites_text, join_question, visibility) VALUES
  (
    'maes-atipicas',
    'Mães de Crianças Atípicas',
    'interest',
    'Espaço seguro para mães brasileiras nos EUA com filhos atípicos: TEA (autismo), TDAH, deficiência física, intelectual ou outras condições.',
    true,
    true,
    'Esse grupo é exclusivo para mães e cuidadoras de crianças atípicas. Pedimos que você se apresente brevemente para garantir um espaço seguro.',
    'Conta um pouco sobre você e a condição do seu filho(a). (Não precisa de detalhes médicos — só pra gente confirmar que é o grupo certo pra você.)',
    'restricted'
  ),
  (
    'lgbt-brasileiros',
    'LGBT+ Brasileiros nos EUA',
    'interest',
    'Comunidade LGBT+ brasileira nos EUA: networking, eventos, suporte mutuo.',
    true,
    true,
    'Espaço seguro pra membros e aliados da comunidade LGBT+.',
    'Como você se identifica? (LGBT+ ou aliado(a))',
    'restricted'
  ),
  (
    'maes-solo',
    'Mães Solo Brasileiras',
    'interest',
    'Mães que criam os filhos sozinhas nos EUA. Suporte, dicas práticas, networking.',
    true,
    true,
    'Grupo exclusivo para mães solo.',
    'Conta brevemente sua situação (mãe solo por escolha, separação, etc.)',
    'restricted'
  ),
  (
    'pre-cidadania',
    'Pré-Cidadania Americana',
    'interest',
    'Brasileiros se preparando pro teste de cidadania americana: dicas, recursos, simulados.',
    true,
    false,  -- aberto
    NULL,
    NULL,
    'public'
  ),
  (
    'criadores-conteudo',
    'Criadores de Conteúdo BR-USA',
    'interest',
    'YouTubers, podcasters, influencers brasileiros nos EUA: networking, parcerias, dicas.',
    true,
    false,
    NULL,
    NULL,
    'public'
  )
ON CONFLICT (slug) DO UPDATE SET
  requires_approval = EXCLUDED.requires_approval,
  prerequisites_text = EXCLUDED.prerequisites_text,
  join_question = EXCLUDED.join_question,
  visibility = EXCLUDED.visibility;

-- ── 7. VERIFICAÇÃO ─────────────────────────────────────────────────────
SELECT
  'Schema extras aplicado' AS status,
  (SELECT COUNT(*) FROM bc_contact_messages)                              AS contact_msgs,
  (SELECT COUNT(*) FROM bc_communities WHERE requires_approval = true)    AS comunidades_restritas,
  (SELECT COUNT(*) FROM bc_communities)                                   AS total_comunidades,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'bc_businesses' AND column_name = 'gallery_urls')   AS biz_tem_gallery,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'ag_providers' AND column_name = 'gallery_urls')    AS prov_tem_gallery;
