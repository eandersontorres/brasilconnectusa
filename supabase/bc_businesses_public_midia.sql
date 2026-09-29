-- ═════════════════════════════════════════════════════════════════════════════
-- 28/09/2026 · pacote P1 da auditoria
-- APLICADO em producao (migration bc_businesses_public_midia).
--
-- A view publica nao expunha logo, capa, galeria nem redes sociais, entao as
-- fotos enviadas pelo dono nunca apareciam no diretorio. Colunas novas entram
-- no fim (CREATE OR REPLACE VIEW so permite acrescentar no final).
--
-- accepts_orders so e TRUE quando o negocio ligou pedidos E o Stripe esta apto
-- a cobrar: e o que decide se a pagina mostra o botao "Ver cardapio e pedir".
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.bc_businesses_public AS
 SELECT id, slug, name, short_name, category, city, state, description,
    phone, whatsapp, website, address, hours,
    COALESCE(listing_plan, plan, 'free'::text) AS listing_plan,
    COALESCE(rating, 0::numeric) AS rating_avg,
    COALESCE(reviews, 0) AS reviews_count,
    COALESCE(verified, false) AS verified,
    emoji, color,
    COALESCE(featured, false) AS featured,
    created_at,
    short_desc, logo_url, cover_url, gallery_urls, video_url,
    instagram, facebook, tiktok, module,
    (COALESCE(accepts_orders, false) AND COALESCE(stripe_charges_enabled, false)) AS accepts_orders
   FROM bc_businesses
  WHERE COALESCE(status, 'approved'::text) = 'approved'::text AND COALESCE(active, true) = true
  ORDER BY (
        CASE COALESCE(listing_plan, plan, 'free'::text)
            WHEN 'premium'::text THEN 1
            WHEN 'pro'::text THEN 2
            ELSE 3
        END), rating DESC NULLS LAST, (COALESCE(featured, false)) DESC NULLS LAST;

-- So o backend (service_role) le a view; o site nunca consulta o banco direto.
ALTER VIEW public.bc_businesses_public SET (security_invoker = true);
REVOKE ALL ON public.bc_businesses_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bc_businesses_public TO service_role;
