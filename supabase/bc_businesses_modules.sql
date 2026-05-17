-- ════════════════════════════════════════════════════════════════════════
-- Modulos do painel do assinante
--
-- Cada negocio agora tem 1 modulo principal que define quais tabs
-- aparecem no painel /assinante. Modulos canonicos:
--
--   restaurant   -> Cardapio + Pedidos (cobra 2.5% via Stripe)
--   grocery      -> Catalogo + Pedidos (reusa schema de cardapio)
--   retail       -> Catalogo + Pedidos
--   agenda_pro   -> Profissional (schema ag_*)
--   showcase     -> So perfil/divulgacao (sem loja, sem agenda)
--
-- Pessoa pode trocar de modulo depois no painel. Categoria continua sendo
-- usada pra busca/filtros publicos.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE bc_businesses
  ADD COLUMN IF NOT EXISTS module TEXT;

-- Backfill baseado na categoria atual
-- (mapeamento conservador — qualquer coisa nao mapeada vira showcase)
UPDATE bc_businesses SET module = CASE
  WHEN module IS NOT NULL AND module <> '' THEN module
  WHEN category = 'restaurante'                                    THEN 'restaurant'
  WHEN category = 'mercado'                                        THEN 'grocery'
  WHEN category IN ('beleza', 'saude', 'educacao')                 THEN 'agenda_pro'
  ELSE 'showcase'
END
WHERE module IS NULL OR module = '';

-- Default pra novos inserts caso a aplicacao esqueca
ALTER TABLE bc_businesses ALTER COLUMN module SET DEFAULT 'showcase';

-- Constraint suave: aceita modulos canonicos + permite novos no futuro
-- (sem CHECK rigida pra nao quebrar evolucao)
CREATE INDEX IF NOT EXISTS idx_bc_businesses_module ON bc_businesses(module);

-- Verificacao
SELECT module, COUNT(*) AS total
FROM bc_businesses
GROUP BY module
ORDER BY total DESC;
