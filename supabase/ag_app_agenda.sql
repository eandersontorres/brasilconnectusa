-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · agenda
-- Agendamento manual pelo app, servico avulso, pagamento no atendimento (valor,
-- gorjeta e forma) e anotacao interna. Rota: api/agenda/appointments.js.
-- APLICADO em producao em 09/10/2026 (migration ag_app_agenda). Idempotente. Ordem: ag_app_base.sql → ag_app_team.sql → este.
-- ═════════════════════════════════════════════════════════════════════════════

-- Servico avulso (sem service_id) e turnover: service_id ja pode ser NULL
-- (ag_turnover_ical.sql). Repetido aqui pra este arquivo valer sozinho.
ALTER TABLE public.ag_appointments ALTER COLUMN service_id DROP NOT NULL;

ALTER TABLE public.ag_appointments
  ADD COLUMN IF NOT EXISTS source         text NOT NULL DEFAULT 'online',  -- 'online' | 'manual' | 'recurring' | 'ical'
  ADD COLUMN IF NOT EXISTS service_label  text,                            -- servico avulso ("Escova + hidratacao")
  ADD COLUMN IF NOT EXISTS paid_cents     int,                             -- valor do servico recebido no total (inclui o sinal; sem gorjeta). NULL = nao registrado
  ADD COLUMN IF NOT EXISTS tip_cents      int NOT NULL DEFAULT 0,          -- gorjeta
  ADD COLUMN IF NOT EXISTS paid_method    text,                            -- zelle | cash | card | venmo | cashapp | check | other
  ADD COLUMN IF NOT EXISTS paid_at        timestamptz,                     -- quando marcou como pago (data real, com fuso)
  ADD COLUMN IF NOT EXISTS internal_notes text;                            -- anotacao da profissional (a cliente nao ve)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_appointments_source_check') THEN
    ALTER TABLE public.ag_appointments
      ADD CONSTRAINT ag_appointments_source_check CHECK (source IN ('online', 'manual', 'recurring', 'ical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_appointments_paid_method_check') THEN
    ALTER TABLE public.ag_appointments
      ADD CONSTRAINT ag_appointments_paid_method_check
      CHECK (paid_method IS NULL OR paid_method IN ('zelle', 'cash', 'card', 'venmo', 'cashapp', 'check', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_appointments_paid_amounts_check') THEN
    ALTER TABLE public.ag_appointments
      ADD CONSTRAINT ag_appointments_paid_amounts_check
      CHECK ((paid_cents IS NULL OR paid_cents >= 0) AND tip_cents >= 0);
  END IF;
END $$;

-- Limpezas que ja vieram do Airbnb/Vrbo/Booking contam como 'ical'
UPDATE public.ag_appointments SET source = 'ical'
 WHERE external_uid IS NOT NULL AND source = 'online';

-- Tela "Hoje": pendencias (sinal pendente, atendimento passado sem marcar)
CREATE INDEX IF NOT EXISTS idx_apt_provider_status_date
  ON public.ag_appointments(provider_id, status, scheduled_for);

-- Pagamentos registrados no atendimento (ag_payments.type 'service' e 'tip')
CREATE INDEX IF NOT EXISTS idx_payments_provider_paid ON public.ag_payments(provider_id, paid_at);
