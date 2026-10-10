-- ═════════════════════════════════════════════════════════════════════════════
-- 10/10/2026 · WorkPro / AgendaPro · orçamentos, faturas, tabela de preços e pedidos de orçamento
-- Rotas: api/agenda/documents.js (profissional), api/agenda/doc-public.js (cliente pelo
-- link /d/<token>), api/agenda/catalog.js, api/agenda/quote-requests.js.
-- NAO APLICADO ainda. Idempotente. Aplicar depois das ag_app_* (base → … → push).
-- Valores em centavos de dólar; quantidade com 2 casas; imposto em pontos-base (6,25% = 625).
-- ═════════════════════════════════════════════════════════════════════════════

-- Tipo de negócio do WorkPro: obra, reparo, serviço técnico e profissional (tradutor...)
ALTER TABLE public.ag_providers DROP CONSTRAINT IF EXISTS ag_providers_vertical_check;
ALTER TABLE public.ag_providers
  ADD CONSTRAINT ag_providers_vertical_check CHECK (vertical IN ('services', 'cleaning', 'trades'));

-- ── ag_catalog_items: tabela de preços (serviços, mão de obra, materiais, taxas) ─────
CREATE TABLE IF NOT EXISTS public.ag_catalog_items (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id      uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  name             text NOT NULL,                       -- 'Instalação de porta', 'Tradução juramentada'
  description      text,
  kind             text NOT NULL DEFAULT 'service',     -- service | labor | material | fee | other
  unit             text NOT NULL DEFAULT 'un',          -- un, hora, dia, m², ft², ft, página, palavra, projeto, visita
  unit_price_cents int  NOT NULL DEFAULT 0,
  taxable          boolean NOT NULL DEFAULT false,      -- entra na base do sales tax
  active           boolean NOT NULL DEFAULT true,
  display_order    int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ag_catalog_items_kind_check  CHECK (kind IN ('service', 'labor', 'material', 'fee', 'other')),
  CONSTRAINT ag_catalog_items_price_check CHECK (unit_price_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_catalog_provider ON public.ag_catalog_items (provider_id, active, display_order);

-- ── ag_documents: orçamento (quote) e fatura (invoice) na mesma tabela ──────────────
CREATE TABLE IF NOT EXISTS public.ag_documents (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id         uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  kind                text NOT NULL,                    -- 'quote' | 'invoice'
  seq                 int  NOT NULL,                    -- sequência por profissional e tipo (ag_next_doc_seq)
  number              text NOT NULL,                    -- 'Q-0001' | 'INV-0001'
  status              text NOT NULL DEFAULT 'draft',
  -- Cliente (cópia na hora de emitir: o documento não muda se a ficha mudar)
  client_id           uuid REFERENCES public.ag_clients(id) ON DELETE SET NULL,
  client_name         text NOT NULL,
  client_email        text,
  client_phone        text,
  client_address      text,
  title               text,                             -- 'Reforma do banheiro'
  job_address         text,                             -- endereço da obra (se diferente)
  language            text NOT NULL DEFAULT 'en',       -- idioma do documento: pt | en | es
  issue_date          date NOT NULL DEFAULT CURRENT_DATE,
  due_date            date,                             -- fatura: vencimento
  valid_until         date,                             -- orçamento: validade
  -- Valores (recalculados pelo servidor a cada gravação: api/_lib/documents.js)
  subtotal_cents      int NOT NULL DEFAULT 0,
  discount_pct        numeric(5,2),                     -- desconto em %, ou
  discount_cents      int NOT NULL DEFAULT 0,           -- desconto em valor (o efetivo fica aqui)
  tax_rate_bps        int NOT NULL DEFAULT 0,
  tax_cents           int NOT NULL DEFAULT 0,
  total_cents         int NOT NULL DEFAULT 0,
  deposit_pct         numeric(5,2),                     -- orçamento: entrada pedida na aprovação (%), ou
  deposit_cents       int NOT NULL DEFAULT 0,           -- em valor (o efetivo fica aqui)
  amount_paid_cents   int NOT NULL DEFAULT 0,           -- fatura: soma dos pagamentos
  -- Textos
  notes               text,                             -- recado pra cliente
  terms               text,                             -- condições, garantia, prazo
  payment_instructions text,                            -- Zelle, cheque...
  internal_notes      text,                             -- só a profissional vê
  photos              text[] NOT NULL DEFAULT '{}',     -- URLs (antes/depois, projeto)
  stage_label         text,                             -- fatura por etapa: 'Entrada (30%)', 'Etapa 2 de 3'
  -- Ligações
  public_token        text NOT NULL UNIQUE,             -- link da cliente /d/<token>: tratar como segredo
  quote_id            uuid REFERENCES public.ag_documents(id) ON DELETE SET NULL,  -- fatura gerada do orçamento
  appointment_id      uuid REFERENCES public.ag_appointments(id) ON DELETE SET NULL,
  quote_request_id    uuid,                             -- pedido de orçamento de origem (FK abaixo)
  -- Linha do tempo
  sent_at             timestamptz,
  viewed_at           timestamptz,
  accepted_at         timestamptz,
  accepted_name       text,                             -- nome digitado na aprovação
  accepted_signature  text,                             -- assinatura desenhada (data URL PNG, até ~60 KB)
  accepted_ip         text,
  accepted_user_agent text,
  declined_at         timestamptz,
  decline_reason      text,
  paid_at             timestamptz,
  voided_at           timestamptz,
  last_reminder_at    timestamptz,
  reminders_sent      int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ag_documents_kind_check   CHECK (kind IN ('quote', 'invoice')),
  CONSTRAINT ag_documents_status_check CHECK (
    (kind = 'quote'   AND status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted')) OR
    (kind = 'invoice' AND status IN ('draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'))
  ),
  CONSTRAINT ag_documents_language_check CHECK (language IN ('pt', 'en', 'es')),
  CONSTRAINT ag_documents_amounts_check  CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
    AND deposit_cents >= 0 AND amount_paid_cents >= 0 AND tax_rate_bps BETWEEN 0 AND 2500
  ),
  CONSTRAINT ag_documents_seq_key UNIQUE (provider_id, kind, seq)
);
CREATE INDEX IF NOT EXISTS idx_documents_provider_list ON public.ag_documents (provider_id, kind, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_client        ON public.ag_documents (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_quote         ON public.ag_documents (quote_id) WHERE quote_id IS NOT NULL;
-- Cron de cobrança/validade: faturas em aberto e orçamentos enviados
CREATE INDEX IF NOT EXISTS idx_documents_open_due      ON public.ag_documents (due_date) WHERE kind = 'invoice' AND status IN ('sent', 'viewed', 'partial', 'overdue');
CREATE INDEX IF NOT EXISTS idx_documents_open_quote    ON public.ag_documents (valid_until) WHERE kind = 'quote' AND status IN ('sent', 'viewed');

-- ── ag_document_items: linhas do documento ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ag_document_items (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id      uuid NOT NULL REFERENCES public.ag_documents(id) ON DELETE CASCADE,
  provider_id      uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  position         int  NOT NULL DEFAULT 0,
  catalog_item_id  uuid REFERENCES public.ag_catalog_items(id) ON DELETE SET NULL,
  kind             text NOT NULL DEFAULT 'service',
  description      text NOT NULL,
  quantity         numeric(12,2) NOT NULL DEFAULT 1,
  unit             text NOT NULL DEFAULT 'un',
  unit_price_cents int  NOT NULL DEFAULT 0,
  taxable          boolean NOT NULL DEFAULT false,
  line_total_cents int  NOT NULL DEFAULT 0,
  CONSTRAINT ag_document_items_kind_check CHECK (kind IN ('service', 'labor', 'material', 'fee', 'other')),
  CONSTRAINT ag_document_items_qty_check  CHECK (quantity > 0),
  CONSTRAINT ag_document_items_price_check CHECK (unit_price_cents >= 0 AND line_total_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_document_items_doc ON public.ag_document_items (document_id, position);

-- ── Assinatura com valor de prova e Checkout aberto da fatura (pagamento-público) ─────
-- Aprovação pelo link (api/agenda/doc-public.js, action 'accept'):
--   signed_snapshot      documento + itens + totais + empresa + quem assinou, como estavam na hora
--   signed_hash          sha256 (hex) do JSON canônico do snapshot; os 8 primeiros = código da cliente
--   consent_at           aceite do uso de registro e assinatura eletrônicos (ESIGN)
--   consent_text_version versão do texto de consentimento mostrado ('esign-v1')
-- Pagamento no cartão (action 'pay'): a sessão do Stripe Checkout aberta da fatura. O pay
-- reaproveita (mesmo valor) ou expira (valor mudou); o webhook limpa quando a sessão é paga.
ALTER TABLE public.ag_documents
  ADD COLUMN IF NOT EXISTS signed_snapshot            jsonb,
  ADD COLUMN IF NOT EXISTS signed_hash                text,
  ADD COLUMN IF NOT EXISTS consent_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS consent_text_version       text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_expires_at timestamptz;

-- ── ag_document_events: linha do tempo (enviado, visto, aprovado, pago, lembrete) ───
CREATE TABLE IF NOT EXISTS public.ag_document_events (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id  uuid NOT NULL REFERENCES public.ag_documents(id) ON DELETE CASCADE,
  provider_id  uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  type         text NOT NULL,     -- created | updated | sent | viewed | accepted | declined | payment | reminder | converted | voided | expired | overdue
  channel      text,              -- whatsapp | email | sms | link | app | stripe | cron
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_events_doc ON public.ag_document_events (document_id, created_at);

-- ── Pagamentos de fatura: reaproveita ag_payments (type 'invoice') ───────────────────
ALTER TABLE public.ag_payments
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.ag_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS method      text;   -- card | ach | zelle | cash | check | venmo | cashapp | other
CREATE INDEX IF NOT EXISTS idx_payments_document ON public.ag_payments (document_id) WHERE document_id IS NOT NULL;
-- Webhook do Stripe idempotente: a mesma sessão de checkout nunca vira dois pagamentos
-- (api/stripe/webhook.js trata o 23505 como evento repetido). Conferido em 09/10/2026:
-- nenhum stripe_session_id repetido em ag_payments (tabela vazia).
CREATE UNIQUE INDEX IF NOT EXISTS ag_payments_stripe_session_uniq ON public.ag_payments (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
-- Reembolso (webhook charge.refunded) acha o pagamento pelo PaymentIntent. Pagamento de fatura
-- reembolsado inteiro fica com status 'refunded' (fora da soma, que só conta 'paid'); no parcial,
-- amount_cents = o que ficou e metadata guarda original_amount_cents / refunded_cents.
CREATE INDEX IF NOT EXISTS idx_payments_intent ON public.ag_payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ── ag_quote_requests: pedido de orçamento pela página pública ───────────────────────
CREATE TABLE IF NOT EXISTS public.ag_quote_requests (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  name            text NOT NULL,
  phone           text,
  email           text,
  address         text,
  service         text,                               -- o que precisa
  description     text,
  photos          text[] NOT NULL DEFAULT '{}',
  preferred_date  date,
  language        text NOT NULL DEFAULT 'en',
  status          text NOT NULL DEFAULT 'new',        -- new | contacted | quoted | closed | spam
  client_id       uuid REFERENCES public.ag_clients(id) ON DELETE SET NULL,
  document_id     uuid REFERENCES public.ag_documents(id) ON DELETE SET NULL,  -- orçamento feito a partir dele
  ip_hash         text,                               -- anti-abuso (hash, nunca o IP cru)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ag_quote_requests_status_check   CHECK (status IN ('new', 'contacted', 'quoted', 'closed', 'spam')),
  CONSTRAINT ag_quote_requests_language_check CHECK (language IN ('pt', 'en', 'es'))
);
CREATE INDEX IF NOT EXISTS idx_quote_requests_provider ON public.ag_quote_requests (provider_id, status, created_at DESC);
-- Anti-abuso do formulário público: pedidos do mesmo IP (hash) pra profissional nas últimas 24h
CREATE INDEX IF NOT EXISTS idx_quote_requests_iphash ON public.ag_quote_requests (provider_id, ip_hash, created_at) WHERE ip_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_documents_quote_request_fkey') THEN
    ALTER TABLE public.ag_documents
      ADD CONSTRAINT ag_documents_quote_request_fkey FOREIGN KEY (quote_request_id)
      REFERENCES public.ag_quote_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Numeração sem buraco nem repetição, por profissional e tipo ──────────────────────
CREATE TABLE IF NOT EXISTS public.ag_doc_counters (
  provider_id uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  last_seq    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, kind)
);

CREATE OR REPLACE FUNCTION public.ag_next_doc_seq(p_provider_id uuid, p_kind text)
RETURNS int
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO ag_doc_counters (provider_id, kind, last_seq) VALUES (p_provider_id, p_kind, 1)
  ON CONFLICT (provider_id, kind) DO UPDATE SET last_seq = ag_doc_counters.last_seq + 1
  RETURNING last_seq;
$$;
REVOKE EXECUTE ON FUNCTION public.ag_next_doc_seq(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ag_next_doc_seq(uuid, text) TO service_role;

-- ── Push: AgendaPro e WorkPro no mesmo aparelho/conta (cada app tem o seu projeto na Expo)
ALTER TABLE public.ag_push_tokens ADD COLUMN IF NOT EXISTS app text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_push_tokens_app_check') THEN
    ALTER TABLE public.ag_push_tokens
      ADD CONSTRAINT ag_push_tokens_app_check CHECK (app IS NULL OR app IN ('agendapro', 'workpro'));
  END IF;
END $$;

-- ── Mesmo modelo das outras ag_*: RLS ligado e sem policy, só a service key (APIs) acessa
ALTER TABLE public.ag_catalog_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ag_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ag_document_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ag_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ag_quote_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ag_doc_counters    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_catalog_items   FROM anon, authenticated;
REVOKE ALL ON public.ag_documents       FROM anon, authenticated;
REVOKE ALL ON public.ag_document_items  FROM anon, authenticated;
REVOKE ALL ON public.ag_document_events FROM anon, authenticated;
REVOKE ALL ON public.ag_quote_requests  FROM anon, authenticated;
REVOKE ALL ON public.ag_doc_counters    FROM anon, authenticated;
