-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Tabelas de Cron / Logs
-- Executar APÓS supabase_schema.sql
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- Logs do cron (check-alerts, etc.)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bc_cron_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name          TEXT NOT NULL,
  current_rate      NUMERIC(8,4),
  alerts_checked    INTEGER DEFAULT 0,
  alerts_triggered  INTEGER DEFAULT 0,
  duration_ms       INTEGER,
  error             TEXT,
  ran_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_cron_logs_job    ON bc_cron_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_bc_cron_logs_ran_at ON bc_cron_logs(ran_at DESC);

-- View: últimas 50 execuções do cron
CREATE OR REPLACE VIEW bc_recent_triggers AS
SELECT
  l.ran_at,
  l.job_name,
  l.current_rate,
  l.alerts_checked,
  l.alerts_triggered,
  l.duration_ms,
  l.error
FROM bc_cron_logs l
ORDER BY l.ran_at DESC
LIMIT 50;

-- ───────────────────────────────────────────────────────────────
-- OPCIONAL: Agendar via pg_cron (Supabase Pro)
-- Isso é um complemento ao cron do Vercel (vercel.json)
-- Descomente se quiser usar o pg_cron do Supabase em vez do Vercel
-- ───────────────────────────────────────────────────────────────
/*
SELECT cron.schedule(
  'bc-check-alerts',      -- nome do job
  '*/30 * * * *',         -- a cada 30 minutos
  $$
    SELECT net.http_post(
      url := 'https://brasilconnectusa.com/api/check-alerts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    )
  $$
);
*/
