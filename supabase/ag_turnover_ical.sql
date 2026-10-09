-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · AgendaPro Cleaner · turnover de Airbnb, Vrbo e Booking
-- A profissional cola o link .ics de cada casa; a sincronizacao (api/_lib/icalSync.js,
-- cron api/cron/ical-sync de hora em hora) cria a limpeza no dia do checkout.
-- APLICADO em producao em 09/10/2026 (migration ag_turnover_ical). Idempotente.
-- ═════════════════════════════════════════════════════════════════════════════

-- ag_ical_feeds — uma linha por casa sincronizada
CREATE TABLE IF NOT EXISTS public.ag_ical_feeds (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id        uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  label              text NOT NULL,                     -- 'Casa do lago (Kissimmee)'
  url                text NOT NULL,                     -- link .ics exportado pelo host: tem token, tratar como segredo
  source             text NOT NULL DEFAULT 'outro',     -- 'airbnb' | 'vrbo' | 'booking' | 'outro'
  checkout_time      time NOT NULL DEFAULT '11:00',     -- a limpeza comeca no horario do checkout
  duration_min       int  NOT NULL DEFAULT 180 CHECK (duration_min BETWEEN 15 AND 720),
  price_cents        int  NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  notes              text,                              -- endereco, codigo da porta, roupa de cama
  active             boolean NOT NULL DEFAULT true,
  last_synced_at     timestamptz,
  last_status        text,                              -- 'ok' | 'error'
  last_error         text,
  reservations_count int NOT NULL DEFAULT 0,            -- reservas por vir na ultima sincronizacao
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, url)
);

CREATE INDEX IF NOT EXISTS idx_ical_feeds_provider ON public.ag_ical_feeds(provider_id);
CREATE INDEX IF NOT EXISTS idx_ical_feeds_sync     ON public.ag_ical_feeds(last_synced_at NULLS FIRST) WHERE active;

-- Mesmo modelo das outras ag_*: RLS ligado e sem policy, so a service key (APIs) acessa
ALTER TABLE public.ag_ical_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_ical_feeds FROM anon, authenticated;

-- ag_appointments: a limpeza de turnover nao e um servico da pagina publica
ALTER TABLE public.ag_appointments ALTER COLUMN service_id DROP NOT NULL;

ALTER TABLE public.ag_appointments
  ADD COLUMN IF NOT EXISTS ical_feed_id      uuid REFERENCES public.ag_ical_feeds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_uid      text,   -- UID da reserva no .ics
  ADD COLUMN IF NOT EXISTS ical_next_checkin date;   -- proximo check-in da casa (mesmo dia = turnover apertado)

-- Uma limpeza por reserva. NULLs nao conflitam: agendamentos normais ficam de fora.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_appointments_ical_uid_key') THEN
    ALTER TABLE public.ag_appointments
      ADD CONSTRAINT ag_appointments_ical_uid_key UNIQUE (ical_feed_id, external_uid);
  END IF;
END $$;

-- A agenda de hoje/amanha incluia so agendamento com servico (JOIN): turnover entra agora
CREATE OR REPLACE VIEW public.ag_upcoming_appointments AS
SELECT
  a.id,
  a.provider_id,
  a.scheduled_for,
  a.duration_min,
  a.status,
  a.client_name,
  a.client_whatsapp,
  a.client_notes,
  COALESCE(s.name, 'Turnover')  AS service_name,
  s.category                    AS service_category,
  a.total_cents,
  a.deposit_paid,
  CASE
    WHEN DATE(a.scheduled_for AT TIME ZONE 'America/Chicago') = CURRENT_DATE THEN 'hoje'
    WHEN DATE(a.scheduled_for AT TIME ZONE 'America/Chicago') = CURRENT_DATE + 1 THEN 'amanha'
    ELSE 'futuro'
  END AS bucket
FROM public.ag_appointments a
LEFT JOIN public.ag_services s ON s.id = a.service_id
WHERE a.scheduled_for >= NOW()
  AND a.status NOT IN ('canceled', 'no_show')
ORDER BY a.scheduled_for ASC;
