-- ════════════════════════════════════════════════════════════════════════════
--   Marketplace MVP — adiciona status de "vendido/disponível" em classifieds
-- ════════════════════════════════════════════════════════════════════════════
-- Aplicar em: Supabase Dashboard → SQL Editor → cola e roda
-- Ou: psql -f supabase/bc_classified_status.sql

ALTER TABLE bc_posts
  ADD COLUMN IF NOT EXISTS classified_status TEXT;
  -- 'available' (default) | 'sold' | 'reserved'

-- Default pra registros existentes do tipo classified
UPDATE bc_posts
   SET classified_status = 'available'
 WHERE type = 'classified' AND classified_status IS NULL;

-- Index pra filtrar listagem de marketplace por status (poucos sold ficam indexados)
CREATE INDEX IF NOT EXISTS idx_posts_classified_status
  ON bc_posts(community_id, classified_status, created_at DESC)
  WHERE type = 'classified' AND is_deleted = false;
