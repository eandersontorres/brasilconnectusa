-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · configuracao do negocio
-- Folgas parciais (mais de um bloqueio no mesmo dia) e horarios livres que
-- respeitam esses bloqueios. Usado por api/agenda/blocked.js e availability.js.
-- APLICADO em producao em 09/10/2026 (migration ag_app_setup). Idempotente. Aplicar depois de ag_app_base.sql.
-- ═════════════════════════════════════════════════════════════════════════════

-- ag_blocked_dates: antes era 1 bloqueio por dia (UNIQUE provider_id, date).
-- Agora: 1 dia inteiro OU varios parciais por dia (um por horario de inicio).
ALTER TABLE public.ag_blocked_dates DROP CONSTRAINT IF EXISTS ag_blocked_dates_provider_id_date_key;

UPDATE public.ag_blocked_dates SET full_day = TRUE WHERE full_day IS NULL;
ALTER TABLE public.ag_blocked_dates ALTER COLUMN full_day SET DEFAULT TRUE;
ALTER TABLE public.ag_blocked_dates ALTER COLUMN full_day SET NOT NULL;

-- Dia inteiro conta como inicio 00:00 (nao duplica o mesmo bloqueio)
CREATE UNIQUE INDEX IF NOT EXISTS ag_blocked_dates_provider_date_start_key
  ON public.ag_blocked_dates (provider_id, date, COALESCE(start_time, '00:00'::time));

CREATE INDEX IF NOT EXISTS idx_blocked_provider_date ON public.ag_blocked_dates (provider_id, date);

-- Bloqueio parcial precisa de inicio e fim validos (tabela vazia em producao)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_blocked_dates_partial_check') THEN
    ALTER TABLE public.ag_blocked_dates
      ADD CONSTRAINT ag_blocked_dates_partial_check
      CHECK (full_day OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time));
  END IF;
END $$;

-- Mesmo modelo das outras ag_*: so a service key (APIs) acessa
ALTER TABLE public.ag_blocked_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_blocked_dates FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ag_is_blocked: o periodo [p_start, p_start + duracao) cai em folga?
-- p_start e hora de parede gravada como UTC (mesma regra de scheduled_for).
-- Pra api/agenda/book.js e appointments.js checarem antes de gravar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ag_is_blocked(
  p_provider_id  uuid,
  p_start        timestamptz,
  p_duration_min int DEFAULT 60
) RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  WITH w AS (
    SELECT (p_start AT TIME ZONE 'UTC') AS s,
           (p_start AT TIME ZONE 'UTC') + make_interval(mins => GREATEST(COALESCE(p_duration_min, 60), 1)) AS e
  )
  SELECT EXISTS (
    SELECT 1
      FROM ag_blocked_dates b, w
     WHERE b.provider_id = p_provider_id
       AND b.date BETWEEN w.s::date AND (w.e - interval '1 microsecond')::date
       AND (
         b.full_day
         OR (b.date + b.start_time < w.e AND b.date + b.end_time > w.s)
       )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.ag_is_blocked(uuid, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ag_is_blocked(uuid, timestamptz, int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ag_get_available_slots: mesma assinatura de agenda_schema.sql.
-- Mudancas: bloqueio parcial tira o horario que sobrepoe [start_time, end_time);
-- conta com timestamp (nao "da a volta" na meia-noite); hora de parede em UTC
-- explicito (antes dependia do fuso da sessao); sem horario repetido.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ag_get_available_slots(
  p_provider_id   uuid,
  p_date          date,
  p_duration_min  int DEFAULT 60,
  p_slot_step_min int DEFAULT 30
) RETURNS TABLE(slot_time time)
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_dow     int := EXTRACT(DOW FROM p_date);
  v_dur_min int := LEAST(GREATEST(COALESCE(p_duration_min, 60), 5), 720);
  v_dur     interval;
  v_step    interval := make_interval(mins => LEAST(GREATEST(COALESCE(p_slot_step_min, 30), 5), 240));
  v_window  record;
  v_slot    timestamp;
  v_end     timestamp;
  v_seen    time[] := ARRAY[]::time[];
BEGIN
  v_dur := make_interval(mins => v_dur_min);

  -- Dia inteiro bloqueado: nenhum horario
  IF EXISTS (
    SELECT 1 FROM ag_blocked_dates
     WHERE provider_id = p_provider_id AND date = p_date AND full_day
  ) THEN
    RETURN;
  END IF;

  FOR v_window IN
    SELECT start_time, end_time
      FROM ag_availability
     WHERE provider_id = p_provider_id
       AND day_of_week = v_dow
       AND active = TRUE
     ORDER BY start_time
  LOOP
    v_slot := p_date + v_window.start_time;
    v_end  := p_date + v_window.end_time;
    WHILE v_slot + v_dur <= v_end LOOP
      IF NOT (v_slot::time = ANY (v_seen))
         -- folga parcial que sobrepoe o horario
         AND NOT EXISTS (
           SELECT 1 FROM ag_blocked_dates b
            WHERE b.provider_id = p_provider_id
              AND b.date = p_date
              AND NOT b.full_day
              AND p_date + b.start_time < v_slot + v_dur
              AND p_date + b.end_time > v_slot
         )
         -- agendamento ativo no horario
         AND NOT ag_check_conflict(p_provider_id, v_slot AT TIME ZONE 'UTC', v_dur_min)
      THEN
        v_seen := v_seen || v_slot::time;
        slot_time := v_slot::time;
        RETURN NEXT;
      END IF;
      v_slot := v_slot + v_step;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ag_get_available_slots(uuid, date, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ag_get_available_slots(uuid, date, int, int) TO service_role;
