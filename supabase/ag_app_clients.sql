-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · clientes (CRM, lista de espera)
-- Ficha completa da cliente (idioma, aniversario, etiquetas, casa), lista de espera
-- e estatisticas calculadas a partir da agenda (api/agenda/clients.js, waitlist.js).
-- NAO APLICADO ainda. Idempotente. Ordem: ag_app_base.sql → ag_app_team.sql → este.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── ag_clients: ficha completa ──────────────────────────────────────────────
ALTER TABLE public.ag_clients
  ADD COLUMN IF NOT EXISTS language     text    NOT NULL DEFAULT 'pt',   -- idioma das mensagens: 'pt' | 'en' | 'es'
  ADD COLUMN IF NOT EXISTS birthday_md  text,                            -- aniversario 'MM-DD' (sem ano)
  ADD COLUMN IF NOT EXISTS tags         text[]  NOT NULL DEFAULT '{}',   -- etiquetas livres: 'VIP', 'Tem pet'...
  ADD COLUMN IF NOT EXISTS address_line text,                            -- endereco (limpeza, atendimento em casa)
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS state        text,
  ADD COLUMN IF NOT EXISTS zip          text,
  ADD COLUMN IF NOT EXISTS home_notes   text,                            -- portao, alarme, pet, produtos
  ADD COLUMN IF NOT EXISTS archived     boolean NOT NULL DEFAULT false,  -- some das listas, historico fica
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_clients_language_check') THEN
    ALTER TABLE public.ag_clients
      ADD CONSTRAINT ag_clients_language_check CHECK (language IN ('pt', 'en', 'es'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_clients_birthday_md_check') THEN
    ALTER TABLE public.ag_clients
      ADD CONSTRAINT ag_clients_birthday_md_check
      CHECK (birthday_md IS NULL OR birthday_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
  END IF;
END $$;

-- Busca e ordenacao por nome; filtros de aniversario e arquivadas
CREATE INDEX IF NOT EXISTS idx_clients_provider_lname    ON public.ag_clients (provider_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_clients_provider_birthday ON public.ag_clients (provider_id, birthday_md) WHERE birthday_md IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_provider_archived ON public.ag_clients (provider_id, archived);
CREATE INDEX IF NOT EXISTS idx_apt_client                ON public.ag_appointments (client_id, scheduled_for) WHERE client_id IS NOT NULL;

-- ── Estatisticas guardadas na ficha (total_visits, total_spent_cents, ...) ──
-- O gatilho antigo so somava: contava em dobro quando o atendimento saia e voltava
-- pra 'completed' e nunca descontava. Agora recalcula a cliente inteira.
-- Visita guardada = atendimento 'completed'; data = horario do atendimento (parede).
CREATE OR REPLACE FUNCTION public.ag_refresh_client_stats(p_client_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE ag_clients c SET
    total_visits      = s.visits,
    total_spent_cents = s.spent,
    first_visit_at    = s.first_at,
    last_visit_at     = s.last_at
  FROM (
    SELECT count(*)::int                       AS visits,
           COALESCE(sum(a.total_cents), 0)::int AS spent,
           min(a.scheduled_for)                 AS first_at,
           max(a.scheduled_for)                 AS last_at
      FROM ag_appointments a
     WHERE a.client_id = p_client_id AND a.status = 'completed'
  ) s
  WHERE c.id = p_client_id;
$$;

CREATE OR REPLACE FUNCTION public.ag_update_client_stats()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD.client_id IS NOT NULL THEN
      PERFORM ag_refresh_client_stats(OLD.client_id);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.client_id IS NOT NULL THEN
      PERFORM ag_refresh_client_stats(NEW.client_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Mudou de cliente: a nova tambem recalcula
    IF NEW.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      PERFORM ag_refresh_client_stats(NEW.client_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ag_appointments_client_stats ON public.ag_appointments;
CREATE TRIGGER ag_appointments_client_stats
  AFTER INSERT OR DELETE OR UPDATE OF status, client_id, total_cents, scheduled_for ON public.ag_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.ag_update_client_stats();

-- O gatilho roda como quem grava (service key das APIs)
REVOKE EXECUTE ON FUNCTION public.ag_refresh_client_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ag_refresh_client_stats(uuid) TO service_role;

-- Fichas que ja existem: acerta os numeros com a regra nova
SELECT public.ag_refresh_client_stats(id) FROM public.ag_clients;

-- ── Atividade por cliente, direto da agenda (usada pelas listas do app) ──────
-- Visita = 'completed' OU 'confirmed' com horario ja passado (muita profissional
-- nao marca "realizado"). p_now = agora no relogio da profissional (regra de
-- horario: scheduled_for e hora de parede gravada como UTC).
--   p_client_ids  → so essas clientes (lista da tela)
--   p_gone_before → so quem nao vem desde essa data e nao tem horario marcado (sumidas)
CREATE OR REPLACE FUNCTION public.ag_client_activity(
  p_provider_id uuid,
  p_now         timestamptz DEFAULT now(),
  p_client_ids  uuid[]      DEFAULT NULL,
  p_gone_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  client_id      uuid,
  visits         int,
  spent_cents    bigint,
  first_visit_at timestamptz,
  last_visit_at  timestamptz,
  next_at        timestamptz,
  no_shows       int,
  cancellations  int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.client_id, s.visits, s.spent_cents, s.first_visit_at, s.last_visit_at, s.next_at, s.no_shows, s.cancellations
  FROM (
    SELECT a.client_id,
           count(*) FILTER (WHERE a.status = 'completed' OR (a.status = 'confirmed' AND a.scheduled_for < p_now))::int AS visits,
           COALESCE(sum(a.total_cents) FILTER (WHERE a.status = 'completed' OR (a.status = 'confirmed' AND a.scheduled_for < p_now)), 0)::bigint AS spent_cents,
           min(a.scheduled_for) FILTER (WHERE a.status = 'completed' OR (a.status = 'confirmed' AND a.scheduled_for < p_now)) AS first_visit_at,
           max(a.scheduled_for) FILTER (WHERE a.status = 'completed' OR (a.status = 'confirmed' AND a.scheduled_for < p_now)) AS last_visit_at,
           min(a.scheduled_for) FILTER (WHERE a.status IN ('pending', 'confirmed') AND a.scheduled_for >= p_now) AS next_at,
           count(*) FILTER (WHERE a.status = 'no_show')::int  AS no_shows,
           count(*) FILTER (WHERE a.status = 'canceled')::int AS cancellations
      FROM ag_appointments a
     WHERE a.provider_id = p_provider_id
       AND a.client_id IS NOT NULL
       AND (p_client_ids IS NULL OR a.client_id = ANY (p_client_ids))
     GROUP BY a.client_id
  ) s
  WHERE p_gone_before IS NULL
     OR (s.last_visit_at IS NOT NULL AND s.last_visit_at < p_gone_before AND s.next_at IS NULL);
$$;

REVOKE EXECUTE ON FUNCTION public.ag_client_activity(uuid, timestamptz, uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ag_client_activity(uuid, timestamptz, uuid[], timestamptz) TO service_role;

-- ── ag_waitlist: lista de espera ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ag_waitlist (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id      uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES public.ag_clients(id) ON DELETE SET NULL,
  client_name      text NOT NULL,
  client_whatsapp  text,                                         -- '+' + digitos
  service_id       uuid REFERENCES public.ag_services(id) ON DELETE SET NULL,
  preferred_days   int[] NOT NULL DEFAULT '{}',                  -- 0 = domingo … 6 = sabado; vazio = qualquer dia
  preferred_period text NOT NULL DEFAULT 'qualquer',             -- 'manha' | 'tarde' | 'noite' | 'qualquer'
  date_from        date,                                         -- a partir de (opcional)
  date_to          date,                                         -- ate (opcional)
  notes            text,
  status           text NOT NULL DEFAULT 'waiting',              -- 'waiting' | 'notified' | 'booked' | 'removed'
  notified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ag_waitlist_period_check CHECK (preferred_period IN ('manha', 'tarde', 'noite', 'qualquer')),
  CONSTRAINT ag_waitlist_status_check CHECK (status IN ('waiting', 'notified', 'booked', 'removed')),
  CONSTRAINT ag_waitlist_days_check   CHECK (preferred_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
  CONSTRAINT ag_waitlist_range_check  CHECK (date_from IS NULL OR date_to IS NULL OR date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_provider_status ON public.ag_waitlist (provider_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_client          ON public.ag_waitlist (client_id) WHERE client_id IS NOT NULL;

-- Mesmo modelo das outras ag_*: RLS ligado e sem policy, so a service key (APIs) acessa
ALTER TABLE public.ag_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_waitlist FROM anon, authenticated;
