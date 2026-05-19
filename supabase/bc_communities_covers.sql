-- ════════════════════════════════════════════════════════════════════════
-- Capa (cover_image) das comunidades semeadas
--
-- Usa Unsplash CDN. Se uma URL parar de funcionar, o admin da comunidade
-- pode substituir via o botão ⚙️ Editar (upload ou URL) no painel.
--
-- Parametros usados: w=1200 (largura), h=400 (altura), fit=crop, q=82
-- ════════════════════════════════════════════════════════════════════════

-- ─── COMUNIDADE GERAL ────────────────────────────────────────────────────
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil';
-- Cristo Redentor Rio de Janeiro

-- ─── CIDADES (principais hubs brasileiros) ──────────────────────────────
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1501979376754-91d5b97c5be7?w=1200&h=400&fit=crop&q=82' WHERE slug = 'boston-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1571410023346-d63b3d6fc8da?w=1200&h=400&fit=crop&q=82' WHERE slug = 'miami-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1597466599360-3b9775841aec?w=1200&h=400&fit=crop&q=82' WHERE slug = 'orlando-br';
-- Orlando: Disney castle
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1545194445-dddb8f4487c6?w=1200&h=400&fit=crop&q=82' WHERE slug = 'austin-br';
-- Austin: Texas capitol/skyline
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1572974050075-bea076c46d52?w=1200&h=400&fit=crop&q=82' WHERE slug = 'houston-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?w=1200&h=400&fit=crop&q=82' WHERE slug = 'dallas-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&h=400&fit=crop&q=82' WHERE slug = 'newyork-br';
-- NYC: Manhattan skyline
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1575917649705-5b59aaa12e6b?w=1200&h=400&fit=crop&q=82' WHERE slug = 'atlanta-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1494522855154-9297ac14b55f?w=1200&h=400&fit=crop&q=82' WHERE slug = 'chicago-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=1200&h=400&fit=crop&q=82' WHERE slug = 'losangeles-br';
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1565122256874-1f87cd1f7427?w=1200&h=400&fit=crop&q=82' WHERE slug = 'tampa-br';

-- ─── ESTADOS PRINCIPAIS (com paisagem icônica) ──────────────────────────
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1571410023346-d63b3d6fc8da?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-fl';
-- FL: palmeiras Miami
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1545194445-dddb8f4487c6?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-tx';
-- TX: Texas state
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1501979376754-91d5b97c5be7?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-ma';
-- MA: Boston skyline
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-ny';
-- NY: Manhattan
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1505761671935-60b3a7427bad?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-nj';
-- NJ: Newark skyline view
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-ca';
-- CA: Golden Gate / LA
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1575917649705-5b59aaa12e6b?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-ga';
-- GA: Atlanta
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1494522855154-9297ac14b55f?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-il';
-- IL: Chicago
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1605191622805-d3eb33ac8d18?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-ct';
-- CT: New England fall
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1610918471715-9b0ed516a07c?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-pa';
-- PA: Philadelphia
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1542228262-3d663b306a53?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-co';
-- CO: Rocky Mountains
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-nv';
-- NV: Las Vegas Strip
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1530593474787-c0e2573a309d?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-wa';
-- WA: Seattle Space Needle
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1597762470488-3877b1f538c6?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-az';
-- AZ: desert/cactus
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1602002418082-a4443e081dd1?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-hi';
-- HI: praia
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1576502200272-341a4b8d5ba8?w=1200&h=400&fit=crop&q=82' WHERE slug = 'brasil-dc';
-- DC: Capitol

-- ─── ESTADOS RESTANTES — fallback genérico USA (paisagem americana) ─────
UPDATE bc_communities
SET cover_image = 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=1200&h=400&fit=crop&q=82'
WHERE type = 'state' AND cover_image IS NULL;
-- Estrada/road trip USA

-- ─── COMUNIDADES DE INTERESSE ───────────────────────────────────────────
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=400&fit=crop&q=82' WHERE slug = 'tech-brasileiros';
-- Tech: código no notebook
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=1200&h=400&fit=crop&q=82' WHERE slug = 'comida-brasileira';
-- Comida: prato brasileiro
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1438032005730-c779502df39b?w=1200&h=400&fit=crop&q=82' WHERE slug = 'religiao';
-- Igreja
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&h=400&fit=crop&q=82' WHERE slug = 'imoveis';
-- Casa
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1200&h=400&fit=crop&q=82' WHERE slug = 'construcao';
-- Construção
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&h=400&fit=crop&q=82' WHERE slug = 'limpeza';
-- Limpeza/produtos
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1200&h=400&fit=crop&q=82' WHERE slug = 'caminhoneiros-cdl';
-- Caminhão na estrada
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200&h=400&fit=crop&q=82' WHERE slug = 'imigracao';
-- Passaporte/documentos
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1531983412531-1f49a365ffed?w=1200&h=400&fit=crop&q=82' WHERE slug = 'maes-brasileiras';
-- Mãe e bebê
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1573164713988-8665fc963095?w=1200&h=400&fit=crop&q=82' WHERE slug = 'empreendedoras';
-- Mulher empreendedora
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200&h=400&fit=crop&q=82' WHERE slug = 'estudantes';
-- Estudantes universitários
UPDATE bc_communities SET cover_image = 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=1200&h=400&fit=crop&q=82' WHERE slug = 'au-pair';
-- Au pair / crianças

-- ─── SERVIÇOS NACIONAIS (caso existam — bc_servicos_nacional.sql) ───────
-- Fallback genérico pra qualquer outra comunidade sem cover
UPDATE bc_communities
SET cover_image = 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=1200&h=400&fit=crop&q=82'
WHERE cover_image IS NULL;

-- ─── VERIFICAÇÃO ────────────────────────────────────────────────────────
SELECT
  type,
  COUNT(*) FILTER (WHERE cover_image IS NOT NULL) AS com_capa,
  COUNT(*) FILTER (WHERE cover_image IS NULL)     AS sem_capa,
  COUNT(*)                                         AS total
FROM bc_communities
GROUP BY type
ORDER BY type;
