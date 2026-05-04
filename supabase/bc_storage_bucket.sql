-- ════════════════════════════════════════════════════════════════════════
-- Bucket "uploads" — fotos de negocios, profissionais, posts
-- Publico de leitura, upload via API com service key
-- ════════════════════════════════════════════════════════════════════════

-- Cria bucket se nao existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  true,                                                    -- public = true (URLs lidas direto)
  524288,                                                  -- 512KB max por arquivo
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 524288,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Policy: leitura publica
DROP POLICY IF EXISTS "uploads_public_read" ON storage.objects;
CREATE POLICY "uploads_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'uploads');

-- Policy: insert com service_role (API valida e faz upload com service key)
DROP POLICY IF EXISTS "uploads_service_insert" ON storage.objects;
CREATE POLICY "uploads_service_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'uploads');

-- Verificacao
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'uploads';
