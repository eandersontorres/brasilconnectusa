-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Opcao de postar/comentar como anonimo
--
-- Adiciona is_anonymous BOOLEAN em bc_posts e bc_comments.
-- Quando true: front exibe "Anonimo" em vez de @username.
-- author_id continua salvo (pra moderacao, ban, denuncia, etc),
-- apenas a exibicao publica esconde o autor.
--
-- Executar no SQL Editor do Supabase
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE bc_posts
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE bc_comments
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false NOT NULL;

-- Index pra queries de feed (filtrar/ordenar)
CREATE INDEX IF NOT EXISTS idx_bc_posts_is_anonymous ON bc_posts(is_anonymous) WHERE is_anonymous = true;

-- Verificacao
SELECT
  (SELECT COUNT(*) FROM bc_posts)                            AS total_posts,
  (SELECT COUNT(*) FROM bc_posts WHERE is_anonymous)         AS anonymous_posts,
  (SELECT COUNT(*) FROM bc_comments)                         AS total_comments,
  (SELECT COUNT(*) FROM bc_comments WHERE is_anonymous)      AS anonymous_comments;
