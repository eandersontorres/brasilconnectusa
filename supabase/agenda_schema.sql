-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — AgendaPro
-- Módulo de agendamento monetizável para profissionais
-- (cabeleireira, manicure, esteticista, personal trainer, etc.)
--
-- 11 tabelas + views + funções
-- Executar no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ───────────────────────────────────────────────────────────────
-- ag_providers — profissionais cadastradas no AgendaPro
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_providers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL UNIQUE,
  whatsapp        TEXT,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,    -- ex: 'ana-torres', vira /agenda/ana-torres
  specialty       TEXT,                    -- 'Cabeleireira', 'Manicure', 'Personal Trainer'
  bio             TEXT,
  city            TEXT,
  state           TEXT,
  avatar_url      TEXT,
  cover_color     TEXT DEFAULT '#0F5132',  -- cor de destaque do perfil
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Campos Stripe (preenchidos quando pagar plano)
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan                   TEXT DEFAULT 'starter',  -- 'starter', 'pro', 'salao'
  plan_status            TEXT DEFAULT 'trialing', -- 'trialing', 'active', 'past_due', 'canceled'
  trial_ends_at          TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_providers_slug   ON ag_providers(slug);
CREATE INDEX IF NOT EXISTS idx_providers_city   ON ag_providers(city);
CREATE INDEX IF NOT EXISTS idx_providers_active ON ag_providers(active);
CREATE INDEX IF NOT EXISTS idx_providers_plan   ON ag_providers(plan, plan_status);

-- ───────────────────────────────────────────────────────────────
-- ag_services — catálogo de serviços de cada profissional
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_services (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id      UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  category         TEXT,                  -- 'Cabelo', 'Mãos', 'Pés', 'Estética'
  description      TEXT,
  duration_min     INT NOT NULL DEFAULT 60,  -- duração em minutos
  price_cents      INT NOT NULL,             -- valor em centavos USD
  deposit_cents    INT DEFAULT 0,            -- depósito antecipado (anti no-show)
  active           BOOLEAN DEFAULT TRUE,
  display_order    INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_provider ON ag_services(provider_id);
CREATE INDEX IF NOT EXISTS idx_services_active   ON ag_services(active) WHERE active = TRUE;

-- ───────────────────────────────────────────────────────────────
-- ag_availability — janelas semanais de trabalho
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_availability (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo, 6=sábado
  start_time      TIME NOT NULL,           -- ex: 09:00
  end_time        TIME NOT NULL,           -- ex: 18:00
  active          BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_availability_provider ON ag_availability(provider_id);

-- ───────────────────────────────────────────────────────────────
-- ag_blocked_dates — feriados, férias, dias bloqueados
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_blocked_dates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  reason          TEXT,                    -- 'Feriado', 'Férias', 'Doente'
  full_day        BOOLEAN DEFAULT TRUE,
  start_time      TIME,                    -- se não for dia inteiro
  end_time        TIME,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, date)
);

CREATE INDEX IF NOT EXISTS idx_blocked_provider ON ag_blocked_dates(provider_id);
CREATE INDEX IF NOT EXISTS idx_blocked_date     ON ag_blocked_dates(date);

-- ───────────────────────────────────────────────────────────────
-- ag_clients — clientes que já agendaram
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  whatsapp        TEXT,
  email           TEXT,
  notes           TEXT,                    -- alergias, preferências
  total_visits    INT DEFAULT 0,
  total_spent_cents INT DEFAULT 0,
  first_visit_at  TIMESTAMPTZ,
  last_visit_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, whatsapp)
);

CREATE INDEX IF NOT EXISTS idx_clients_provider ON ag_clients(provider_id);
CREATE INDEX IF NOT EXISTS idx_clients_whatsapp ON ag_clients(whatsapp);

-- ───────────────────────────────────────────────────────────────
-- ag_appointments — agendamentos
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_appointments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id         UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  service_id          UUID NOT NULL REFERENCES ag_services(id),
  client_id           UUID REFERENCES ag_clients(id),

  client_name         TEXT NOT NULL,
  client_whatsapp     TEXT,
  client_notes        TEXT,                -- observações do cliente

  scheduled_for       TIMESTAMPTZ NOT NULL, -- data/hora do agendamento
  duration_min        INT NOT NULL,
  status              TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'completed', 'canceled', 'no_show'

  -- Pagamento
  total_cents         INT NOT NULL,
  deposit_cents       INT DEFAULT 0,
  deposit_paid        BOOLEAN DEFAULT FALSE,
  stripe_payment_id   TEXT,
  payment_method      TEXT,                -- 'stripe', 'zelle', 'cash', 'free'

  -- Lembretes
  reminder_24h_sent   BOOLEAN DEFAULT FALSE,
  reminder_1h_sent    BOOLEAN DEFAULT FALSE,
  review_requested    BOOLEAN DEFAULT FALSE,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  cancel_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_apt_provider     ON ag_appointments(provider_id);
CREATE INDEX IF NOT EXISTS idx_apt_scheduled    ON ag_appointments(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_apt_status       ON ag_appointments(status);
CREATE INDEX IF NOT EXISTS idx_apt_provider_date ON ag_appointments(provider_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_apt_reminder     ON ag_appointments(scheduled_for, reminder_24h_sent) WHERE status = 'confirmed' AND reminder_24h_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_apt_review       ON ag_appointments(scheduled_for, review_requested) WHERE status = 'completed' AND review_requested = FALSE;

-- ───────────────────────────────────────────────────────────────
-- ag_review_tokens — tokens únicos pra deixar review (módulo 5)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_review_tokens (
  token           TEXT PRIMARY KEY,
  appointment_id  UUID NOT NULL REFERENCES ag_appointments(id) ON DELETE CASCADE,
  provider_id     UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  used            BOOLEAN DEFAULT FALSE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_tokens_provider ON ag_review_tokens(provider_id);
CREATE INDEX IF NOT EXISTS idx_review_tokens_apt      ON ag_review_tokens(appointment_id);

-- ───────────────────────────────────────────────────────────────
-- ag_reviews — avaliações dos clientes
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_reviews (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id       UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  appointment_id    UUID REFERENCES ag_appointments(id),
  client_name       TEXT NOT NULL,
  rating            INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment           TEXT,
  provider_response TEXT,                  -- resposta da profissional
  responded_at      TIMESTAMPTZ,
  is_published      BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_provider ON ag_reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating   ON ag_reviews(rating);

-- ───────────────────────────────────────────────────────────────
-- ag_payments — pagamentos via Stripe (depósitos antecipados)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_payments (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id              UUID NOT NULL REFERENCES ag_providers(id),
  appointment_id           UUID REFERENCES ag_appointments(id),
  amount_cents             INT NOT NULL,
  type                     TEXT NOT NULL,  -- 'deposit', 'subscription', 'tip'
  stripe_session_id        TEXT,
  stripe_payment_intent_id TEXT,
  status                   TEXT DEFAULT 'pending', -- 'pending', 'paid', 'refunded', 'failed'
  metadata                 JSONB,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  paid_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_provider    ON ag_payments(provider_id);
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON ag_payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status      ON ag_payments(status);

-- ───────────────────────────────────────────────────────────────
-- ag_subscriptions — histórico de assinaturas Stripe
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ag_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id              UUID NOT NULL REFERENCES ag_providers(id),
  stripe_subscription_id   TEXT UNIQUE,
  plan                     TEXT NOT NULL,
  status                   TEXT NOT NULL,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN DEFAULT FALSE,
  canceled_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_provider ON ag_subscriptions(provider_id);
CREATE INDEX IF NOT EXISTS idx_subs_stripe   ON ag_subscriptions(stripe_subscription_id);

-- ───────────────────────────────────────────────────────────────
-- RLS — apenas service_key acessa direto (APIs autenticam)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE ag_providers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_services        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_availability    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_blocked_dates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_appointments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_review_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_subscriptions   ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────
-- Função: verificar se um horário tem conflito
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ag_check_conflict(
  p_provider_id UUID,
  p_start TIMESTAMPTZ,
  p_duration_min INT,
  p_exclude_appointment_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_end TIMESTAMPTZ := p_start + (p_duration_min || ' minutes')::INTERVAL;
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM ag_appointments
  WHERE provider_id = p_provider_id
    AND status NOT IN ('canceled', 'no_show')
    AND (id <> COALESCE(p_exclude_appointment_id, '00000000-0000-0000-0000-000000000000'::UUID))
    AND (scheduled_for, scheduled_for + (duration_min || ' minutes')::INTERVAL) OVERLAPS (p_start, v_end);
  RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- Função: gerar slots disponíveis para uma data
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ag_get_available_slots(
  p_provider_id UUID,
  p_date DATE,
  p_duration_min INT DEFAULT 60,
  p_slot_step_min INT DEFAULT 30
) RETURNS TABLE(slot_time TIME) AS $$
DECLARE
  v_dow INT := EXTRACT(DOW FROM p_date);
  v_blocked BOOLEAN;
  v_window RECORD;
  v_slot TIME;
BEGIN
  -- Verifica se a data inteira está bloqueada
  SELECT EXISTS (
    SELECT 1 FROM ag_blocked_dates
    WHERE provider_id = p_provider_id AND date = p_date AND full_day = TRUE
  ) INTO v_blocked;

  IF v_blocked THEN RETURN; END IF;

  -- Itera nas janelas de disponibilidade do dia da semana
  FOR v_window IN
    SELECT start_time, end_time
    FROM ag_availability
    WHERE provider_id = p_provider_id
      AND day_of_week = v_dow
      AND active = TRUE
  LOOP
    v_slot := v_window.start_time;
    WHILE v_slot + (p_duration_min || ' minutes')::INTERVAL <= v_window.end_time::INTERVAL LOOP
      -- Verifica se este slot conflita com agendamento existente ou bloqueio parcial
      IF NOT ag_check_conflict(
        p_provider_id,
        (p_date::TEXT || ' ' || v_slot::TEXT)::TIMESTAMPTZ,
        p_duration_min
      ) THEN
        slot_time := v_slot;
        RETURN NEXT;
      END IF;
      v_slot := v_slot + (p_slot_step_min || ' minutes')::INTERVAL;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────
-- Trigger: incrementa contadores no client após appointment completo
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ag_update_client_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' AND NEW.client_id IS NOT NULL THEN
    UPDATE ag_clients SET
      total_visits = total_visits + 1,
      total_spent_cents = total_spent_cents + NEW.total_cents,
      last_visit_at = NEW.completed_at,
      first_visit_at = COALESCE(first_visit_at, NEW.completed_at)
    WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ag_appointments_client_stats ON ag_appointments;
CREATE TRIGGER ag_appointments_client_stats
  AFTER UPDATE ON ag_appointments
  FOR EACH ROW
  EXECUTE FUNCTION ag_update_client_stats();

-- ───────────────────────────────────────────────────────────────
-- View: faturamento mensal por profissional
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ag_revenue_monthly AS
SELECT
  provider_id,
  DATE_TRUNC('month', completed_at) AS month,
  COUNT(*)                          AS appointments,
  SUM(total_cents)                  AS gross_cents,
  SUM(total_cents) / 100.0          AS gross_usd,
  COUNT(DISTINCT client_id)         AS unique_clients
FROM ag_appointments
WHERE status = 'completed'
  AND completed_at IS NOT NULL
GROUP BY provider_id, DATE_TRUNC('month', completed_at)
ORDER BY month DESC;

-- ───────────────────────────────────────────────────────────────
-- View: agenda de hoje + amanhã (mais usada na home da profissional)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ag_upcoming_appointments AS
SELECT
  a.id,
  a.provider_id,
  a.scheduled_for,
  a.duration_min,
  a.status,
  a.client_name,
  a.client_whatsapp,
  a.client_notes,
  s.name           AS service_name,
  s.category       AS service_category,
  a.total_cents,
  a.deposit_paid,
  CASE
    WHEN DATE(a.scheduled_for AT TIME ZONE 'America/Chicago') = CURRENT_DATE THEN 'hoje'
    WHEN DATE(a.scheduled_for AT TIME ZONE 'America/Chicago') = CURRENT_DATE + 1 THEN 'amanha'
    ELSE 'futuro'
  END AS bucket
FROM ag_appointments a
JOIN ag_services s ON s.id = a.service_id
WHERE a.scheduled_for >= NOW()
  AND a.status NOT IN ('canceled', 'no_show')
ORDER BY a.scheduled_for ASC;

-- ───────────────────────────────────────────────────────────────
-- View: top clientes por profissional
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ag_top_clients AS
SELECT
  provider_id,
  id            AS client_id,
  name,
  whatsapp,
  total_visits,
  total_spent_cents,
  total_spent_cents / 100.0 AS total_spent_usd,
  last_visit_at
FROM ag_clients
WHERE total_visits > 0
ORDER BY provider_id, total_visits DESC;

-- ───────────────────────────────────────────────────────────────
-- View: dashboard administrativo da plataforma (admin do BC)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ag_platform_metrics AS
SELECT
  (SELECT COUNT(*) FROM ag_providers WHERE active = TRUE)                            AS active_providers,
  (SELECT COUNT(*) FROM ag_providers WHERE plan_status = 'active')                   AS paying_providers,
  (SELECT COUNT(*) FROM ag_providers WHERE plan = 'starter' AND plan_status = 'active') AS starter_subs,
  (SELECT COUNT(*) FROM ag_providers WHERE plan = 'pro' AND plan_status = 'active')     AS pro_subs,
  (SELECT COUNT(*) FROM ag_providers WHERE plan = 'salao' AND plan_status = 'active')   AS salao_subs,
  (SELECT COUNT(*) FROM ag_appointments WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '30 days') AS appointments_30d,
  (SELECT SUM(total_cents) FROM ag_appointments WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '30 days') / 100.0 AS gmv_30d_usd,
  (SELECT
    COUNT(*) FILTER (WHERE plan = 'starter') * 19
    + COUNT(*) FILTER (WHERE plan = 'pro') * 39
    + COUNT(*) FILTER (WHERE plan = 'salao') * 79
    FROM ag_providers WHERE plan_status = 'active'
  ) AS mrr_usd;

-- ───────────────────────────────────────────────────────────────
-- View: profissionais com plano ativo (cobrança em dia)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW ag_providers_with_plan AS
SELECT
  p.*,
  CASE
    WHEN p.plan_status = 'trialing' AND p.trial_ends_at > NOW() THEN TRUE
    WHEN p.plan_status = 'active'   AND p.current_period_end > NOW() THEN TRUE
    ELSE FALSE
  END AS has_active_plan
FROM ag_providers p;

-- ───────────────────────────────────────────────────────────────
-- Função: profissional tem plano ativo?
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ag_provider_has_plan(p_provider_id UUID, p_min_plan TEXT DEFAULT 'starter')
RETURNS BOOLEAN AS $$
DECLARE
  v_plan TEXT;
  v_status TEXT;
  v_period_end TIMESTAMPTZ;
  v_trial_end TIMESTAMPTZ;
  v_plan_rank INT;
  v_min_rank INT;
BEGIN
  SELECT plan, plan_status, current_period_end, trial_ends_at
    INTO v_plan, v_status, v_period_end, v_trial_end
  FROM ag_providers WHERE id = p_provider_id;

  IF v_status IN ('canceled', 'past_due') THEN RETURN FALSE; END IF;
  IF v_status = 'trialing' AND (v_trial_end IS NULL OR v_trial_end < NOW()) THEN RETURN FALSE; END IF;
  IF v_status = 'active'   AND (v_period_end IS NULL OR v_period_end < NOW()) THEN RETURN FALSE; END IF;

  v_plan_rank := CASE v_plan WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 WHEN 'salao' THEN 3 ELSE 0 END;
  v_min_rank  := CASE p_min_plan WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 WHEN 'salao' THEN 3 ELSE 1 END;

  RETURN v_plan_rank >= v_min_rank;
END;
$$ LANGUAGE plpgsql;
