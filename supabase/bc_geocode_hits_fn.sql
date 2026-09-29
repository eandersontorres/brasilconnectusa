-- ═════════════════════════════════════════════════════════════════════════════
-- 29/09/2026 · pacote P2 da auditoria
-- APLICADO em producao (migration bc_geocode_hits_fn). Idempotente.
--
-- api/geocode.js chamava increment_geocode_hits, que nunca existiu: o contador
-- de uso do cache de cidades ficava sempre em 1.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.increment_geocode_hits(city_in text, state_in text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.bc_geocode_cache
     SET hits = COALESCE(hits, 0) + 1
   WHERE city_norm = city_in
     AND state_norm = state_in
     AND country = 'USA';
$$;

REVOKE ALL ON FUNCTION public.increment_geocode_hits(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_geocode_hits(text, text) TO service_role;
