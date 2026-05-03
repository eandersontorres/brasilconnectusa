-- ═══════════════════════════════════════════════════════════════════════
-- Leads do plano Enterprise (AgendaPro)
-- Capturados em /agenda/planos atraves do form "Falar com a equipe"
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bc_enterprise_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  whatsapp        TEXT,
  company         TEXT,                       -- Nome do negocio/empresa
  sector          TEXT,                       -- terapia, juridico, contabil, etc
  team_size       TEXT,                       -- 1-5, 6-20, 21-50, 50+
  interest        TEXT,                       -- alcance_nacional, integracao, white_label, multiplos_estados, outro
  message         TEXT,                       -- Mensagem livre do lead
  source_url      TEXT,                       -- /agenda/planos ou outro
  status          TEXT DEFAULT 'new',         -- new, contacted, qualified, won, lost
  notes           TEXT,                       -- Notas internas (admin)
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  contacted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_enterprise_leads_status ON bc_enterprise_leads(status);
CREATE INDEX IF NOT EXISTS idx_enterprise_leads_created ON bc_enterprise_leads(created_at DESC);

ALTER TABLE bc_enterprise_leads DISABLE ROW LEVEL SECURITY;

-- Verificacao
SELECT 'OK' AS status, COUNT(*) AS total FROM bc_enterprise_leads;
