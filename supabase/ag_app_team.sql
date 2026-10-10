-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · equipe (Premium) e clientes fixas (Pro)
-- ag_staff: profissionais/equipes com cor na agenda e link "rota do dia" sem senha.
-- ag_recurring: cliente fixa (semanal, quinzenal, 3 ou 4 semanas); api/_lib/recurring.js
-- gera os agendamentos das proximas 6 semanas (ao salvar e no cron diario
-- api/cron/agenda-recurring).
-- NAO APLICADO ainda. Idempotente. Ordem: ag_app_base.sql → ag_app_team.sql → demais.
-- ═════════════════════════════════════════════════════════════════════════════

-- ag_staff — uma linha por profissional ou equipe de limpeza
CREATE TABLE IF NOT EXISTS public.ag_staff (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  name            text NOT NULL,                              -- 'Ana' ou 'Equipe da Maria'
  color           text NOT NULL DEFAULT '#1F4D3F',            -- cor na agenda (paleta teamColors do app)
  whatsapp        text,                                       -- so digitos com DDI
  email           text,
  role            text NOT NULL DEFAULT 'profissional',       -- 'profissional' | 'equipe'
  members         jsonb NOT NULL DEFAULT '[]'::jsonb,         -- nomes de quem vai na equipe de limpeza
  day_link_token  text UNIQUE,                                -- link /agenda/equipe?t=... (sem login): tratar como segredo
  active          boolean NOT NULL DEFAULT true,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_staff_role_check') THEN
    ALTER TABLE public.ag_staff ADD CONSTRAINT ag_staff_role_check CHECK (role IN ('profissional', 'equipe'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_staff_color_check') THEN
    ALTER TABLE public.ag_staff ADD CONSTRAINT ag_staff_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_staff_members_check') THEN
    ALTER TABLE public.ag_staff ADD CONSTRAINT ag_staff_members_check CHECK (jsonb_typeof(members) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_provider ON public.ag_staff(provider_id, display_order);

ALTER TABLE public.ag_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_staff FROM anon, authenticated;

-- ag_recurring — cliente fixa: a regra que preenche a agenda sozinha
CREATE TABLE IF NOT EXISTS public.ag_recurring (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.ag_clients(id) ON DELETE CASCADE,
  service_id      uuid REFERENCES public.ag_services(id) ON DELETE SET NULL,   -- opcional (preco/duracao avulsos)
  staff_id        uuid REFERENCES public.ag_staff(id) ON DELETE SET NULL,      -- quem atende (Premium)
  frequency       text NOT NULL DEFAULT 'weekly',              -- 'weekly' | 'biweekly' | 'every3weeks' | 'every4weeks'
  day_of_week     int  NOT NULL,                               -- 0 = domingo
  start_time      time NOT NULL,                               -- hora do relogio da profissional
  duration_min    int  NOT NULL DEFAULT 60,
  price_cents     int  NOT NULL DEFAULT 0,
  anchor_date     date NOT NULL,                               -- primeira data (ja no dia da semana): base da quinzena
  end_date        date,                                        -- ultima data possivel (NULL = sem fim)
  skip_dates      date[] NOT NULL DEFAULT '{}',                -- semanas puladas
  active          boolean NOT NULL DEFAULT true,               -- false = pausada
  notes           text,                                        -- vai junto em cada agendamento gerado
  generated_until date,                                        -- ate onde a agenda ja foi gerada
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_recurring_frequency_check') THEN
    ALTER TABLE public.ag_recurring ADD CONSTRAINT ag_recurring_frequency_check
      CHECK (frequency IN ('weekly', 'biweekly', 'every3weeks', 'every4weeks'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_recurring_dow_check') THEN
    ALTER TABLE public.ag_recurring ADD CONSTRAINT ag_recurring_dow_check CHECK (day_of_week BETWEEN 0 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_recurring_duration_check') THEN
    ALTER TABLE public.ag_recurring ADD CONSTRAINT ag_recurring_duration_check CHECK (duration_min BETWEEN 5 AND 720);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_recurring_price_check') THEN
    ALTER TABLE public.ag_recurring ADD CONSTRAINT ag_recurring_price_check CHECK (price_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_recurring_end_check') THEN
    ALTER TABLE public.ag_recurring ADD CONSTRAINT ag_recurring_end_check CHECK (end_date IS NULL OR end_date >= anchor_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recurring_provider ON public.ag_recurring(provider_id, day_of_week, start_time);
-- Fila do cron (ordem generated_until, id; le em paginas pulando quem esta sem plano)
CREATE INDEX IF NOT EXISTS idx_recurring_active   ON public.ag_recurring(generated_until NULLS FIRST, id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_recurring_client   ON public.ag_recurring(client_id);

ALTER TABLE public.ag_recurring ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_recurring FROM anon, authenticated;

-- ag_appointments: quem atende e de qual recorrencia veio
ALTER TABLE public.ag_appointments
  ADD COLUMN IF NOT EXISTS staff_id        uuid REFERENCES public.ag_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurring_id    uuid REFERENCES public.ag_recurring(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_date date;   -- data original da ocorrencia (fica mesmo se remarcar)

-- Uma ocorrencia por data por regra, inclusive cancelada (a geracao nunca recria).
-- UNIQUE comum em vez de indice parcial: o upsert do PostgREST (on_conflict) nao
-- consegue usar indice parcial. NULLs nao conflitam, entao agendamento avulso fica de fora.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_appointments_recurring_occ_key') THEN
    ALTER TABLE public.ag_appointments
      ADD CONSTRAINT ag_appointments_recurring_occ_key UNIQUE (recurring_id, occurrence_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_apt_staff_date ON public.ag_appointments(staff_id, scheduled_for) WHERE staff_id IS NOT NULL;
