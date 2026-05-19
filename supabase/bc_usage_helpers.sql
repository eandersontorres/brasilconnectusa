-- ════════════════════════════════════════════════════════════════════════
-- Helper functions pro dashboard de Uso (limites de plataforma)
--
-- Acessa schemas privilegiados (auth, storage) via SECURITY DEFINER.
-- Chamado por /api/admin/usage com service key.
-- ════════════════════════════════════════════════════════════════════════

-- Tamanho total do banco em bytes (limite Supabase Pro: 8GB)
CREATE OR REPLACE FUNCTION public.bc_get_db_size()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT pg_database_size(current_database())
$$;

-- Tamanho total de Storage em bytes (limite Supabase Pro: 100GB)
CREATE OR REPLACE FUNCTION public.bc_get_storage_size()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)
  FROM storage.objects
$$;

-- Monthly Active Users (login nos ultimos 30 dias). Limite Supabase Pro: 100K.
CREATE OR REPLACE FUNCTION public.bc_get_mau()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COUNT(DISTINCT id)::integer
  FROM auth.users
  WHERE last_sign_in_at > NOW() - INTERVAL '30 days'
$$;

-- Total de users cadastrados (qualquer estado)
CREATE OR REPLACE FUNCTION public.bc_get_total_users()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COUNT(*)::integer FROM auth.users
$$;

-- Storage breakdown por bucket (extra contexto)
CREATE OR REPLACE FUNCTION public.bc_get_storage_by_bucket()
RETURNS TABLE(bucket_id text, total_bytes bigint, file_count bigint)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    bucket_id,
    COALESCE(SUM((metadata->>'size')::bigint), 0) AS total_bytes,
    COUNT(*)::bigint AS file_count
  FROM storage.objects
  GROUP BY bucket_id
$$;

-- Verificacao
SELECT
  bc_get_db_size()       AS db_size_bytes,
  bc_get_storage_size()  AS storage_bytes,
  bc_get_mau()           AS mau,
  bc_get_total_users()   AS total_users;
