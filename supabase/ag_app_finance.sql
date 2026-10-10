-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · financas
-- Despesas e milhagem da profissional (recursos Pro 'finance' e 'mileage').
-- Faturamento vem de ag_appointments (paid_cents/tip_cents/paid_method da entrega
-- agenda); preferencias (meta, % do imposto, taxa por milha) ficam em
-- ag_providers.app_settings. Quem le e grava: api/agenda/finance.js.
-- APLICADO em producao em 09/10/2026 (migration ag_app_finance). Idempotente. Ordem: ag_app_base.sql → ag_app_team.sql → este.
-- ═════════════════════════════════════════════════════════════════════════════

-- ag_expenses — uma linha por despesa do negocio
CREATE TABLE IF NOT EXISTS public.ag_expenses (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id    uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  spent_on       date NOT NULL DEFAULT CURRENT_DATE,
  category       text NOT NULL DEFAULT 'outros',   -- lista no CHECK abaixo (mesma de finance.js)
  description    text,                              -- 'Tinta e oxidante', 'Aluguel da cadeira'
  amount_cents   int  NOT NULL CHECK (amount_cents > 0),
  payment_method text,                              -- 'card' | 'cash' | 'zelle' | 'venmo' | 'cashapp' | 'paypal' | 'check' | 'debit' | 'other'
  receipt_url    text,                              -- foto do comprovante (bucket uploads)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Constraint com nome: da pra trocar a lista de categorias depois sem recriar a tabela
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_expenses_category_check') THEN
    ALTER TABLE public.ag_expenses
      ADD CONSTRAINT ag_expenses_category_check CHECK (category IN (
        'produtos', 'gasolina', 'aluguel', 'equipamento', 'marketing',
        'taxas', 'celular', 'seguro', 'alimentacao', 'outros'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_provider_date ON public.ag_expenses(provider_id, spent_on DESC);

-- ag_mileage — viagens a trabalho (deducao por milha no imposto)
CREATE TABLE IF NOT EXISTS public.ag_mileage (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id    uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  driven_on      date NOT NULL DEFAULT CURRENT_DATE,
  miles          numeric(7,1) NOT NULL CHECK (miles > 0),
  purpose        text,                              -- 'Atendimento: Maria (faxina)', 'Compra de produtos'
  from_label     text,                              -- 'Casa'
  to_label       text,                              -- 'Cliente em Kissimmee'
  appointment_id uuid REFERENCES public.ag_appointments(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mileage_provider_date ON public.ag_mileage(provider_id, driven_on DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_appointment   ON public.ag_mileage(appointment_id) WHERE appointment_id IS NOT NULL;

-- Mesmo modelo das outras ag_*: RLS ligado e sem policy, so a service key (APIs) acessa
ALTER TABLE public.ag_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ag_mileage  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_expenses FROM anon, authenticated;
REVOKE ALL ON public.ag_mileage  FROM anon, authenticated;
