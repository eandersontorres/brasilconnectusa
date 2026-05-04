# RESTAURANT MODE — Plano de implementação

Modo "restaurante / bakery / grocery" pra negócios que querem **menu + pedidos online + pagamento na hora**, com BrasilConnect cobrando taxa de plataforma + processing fee. Disponível **só pro plano Premium** (e Enterprise).

## Por que existe

Hoje em /negocio o user só vê telefone, endereço e horário. Pra concorrer com Uber Eats / DoorDash / Grubhub pra clientela brasileira:

- **Cliente brasileiro** quer pedir feijoada do brasileiro do bairro sem precisar do gringo intermediário caro
- **Dono brasileiro** quer cardápio em PT, sem fee de 30% do iFood gringo
- **BrasilConnect** ganha fee de plataforma justo (2-3%) + processing fee (3% do Stripe)

## Modelo financeiro

```
Cliente paga:           $20.00
─────────────────────────────────
BrasilConnect fee (2%): -$0.40   ← nossa receita
Stripe fee (~3%):       -$0.60   ← Stripe (pass-through)
─────────────────────────────────
Restaurante recebe:     $19.00   (deposita direto na conta dele via Stripe Connect)
```

Por que 2% e não mais? Concorrer com gigantes: iFood/DoorDash cobram 15-30%. Cobrar 2% é absurdamente competitivo e cria forte word-of-mouth na comunidade.

## Pré-requisitos pro restaurante

| Requisito | Por quê |
|---|---|
| **Plano Premium ou Enterprise** ($79+) | Self-service basic não comporta toda essa infra |
| **LLC + EIN** | Stripe Connect exige entidade legal pra payouts |
| **Conta bancária US** | Stripe envia o dinheiro via ACH |
| **Endereço comercial** | Verificação Stripe |
| **Photo ID do owner** | KYC do Stripe |

Se o restaurante não tem LLC ainda, podemos referer ao guia interno `/guias/abrir-llc/` (que já existe) + parceiro tipo ZenBusiness.

## Arquitetura técnica

### 1. Stripe Connect (Express accounts)

A cada restaurante é criada uma **Stripe Express account**. BrasilConnect é a plataforma master, restaurantes são subaccounts. Quando o cliente paga:

- Stripe processa pagamento
- Automaticamente split: 95% pro restaurante (após processing fee), 2-3% pra BrasilConnect (`application_fee_amount`)
- Restaurante vê suas vendas no dashboard próprio (Stripe gera URL)

### 2. Schema novo

```sql
-- Restaurantes (extensão de bc_businesses)
ALTER TABLE bc_businesses
  ADD COLUMN IF NOT EXISTS accepts_orders BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,        -- acct_XXX
  ADD COLUMN IF NOT EXISTS stripe_onboarded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS prep_time_min INT DEFAULT 30,  -- tempo médio de preparo
  ADD COLUMN IF NOT EXISTS pickup_only BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_radius_miles INT,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INT,
  ADD COLUMN IF NOT EXISTS min_order_cents INT DEFAULT 1000;

-- Categorias do menu (entradas, pratos, sobremesas, bebidas, etc)
CREATE TABLE bc_menu_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES bc_businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INT DEFAULT 0,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Itens do menu
CREATE TABLE bc_menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES bc_businesses(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES bc_menu_categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  price_cents     INT NOT NULL,
  photo_url       TEXT,
  available       BOOLEAN DEFAULT true,
  is_featured     BOOLEAN DEFAULT false,
  prep_time_min   INT,                  -- override do tempo do negócio
  ingredients     TEXT,                 -- "Frango, arroz, feijão preto..."
  allergens       TEXT[],               -- ['gluten', 'lactose', 'amendoim']
  is_vegetarian   BOOLEAN DEFAULT false,
  is_gluten_free  BOOLEAN DEFAULT false,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Modificadores (ex: "Adicional de bacon +$2", "Sem cebola")
CREATE TABLE bc_menu_modifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      UUID NOT NULL REFERENCES bc_menu_items(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,           -- "Adicional de bacon"
  price_cents  INT DEFAULT 0,           -- +200 = +$2.00
  is_required  BOOLEAN DEFAULT false,
  group_name   TEXT,                    -- "Tamanho" ou "Acompanhamento"
  display_order INT DEFAULT 0
);

-- Pedidos
CREATE TABLE bc_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES bc_businesses(id),
  customer_email    TEXT NOT NULL,
  customer_name     TEXT,
  customer_phone    TEXT,
  customer_user_id  UUID,                          -- se logado
  type              TEXT NOT NULL,                  -- 'pickup' | 'delivery'
  delivery_address  TEXT,
  delivery_city     TEXT,
  delivery_zip      TEXT,
  scheduled_for     TIMESTAMPTZ,                   -- pedido agendado, NULL = ASAP
  status            TEXT DEFAULT 'pending',         -- pending | confirmed | preparing | ready | delivered | canceled
  notes             TEXT,                          -- observações do cliente
  -- Valores
  subtotal_cents    INT NOT NULL,
  delivery_fee_cents INT DEFAULT 0,
  tax_cents         INT DEFAULT 0,
  tip_cents         INT DEFAULT 0,
  total_cents       INT NOT NULL,
  platform_fee_cents INT NOT NULL,                 -- nossa parte (2-3%)
  -- Stripe
  stripe_payment_intent_id TEXT,
  stripe_charge_id  TEXT,
  payment_status    TEXT DEFAULT 'unpaid',         -- unpaid | paid | refunded | failed
  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT now(),
  confirmed_at      TIMESTAMPTZ,
  ready_at          TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  canceled_at       TIMESTAMPTZ
);

-- Itens de cada pedido
CREATE TABLE bc_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES bc_orders(id) ON DELETE CASCADE,
  menu_item_id    UUID REFERENCES bc_menu_items(id),
  item_name       TEXT NOT NULL,                   -- snapshot (não muda se item for editado depois)
  unit_price_cents INT NOT NULL,
  quantity        INT NOT NULL DEFAULT 1,
  modifiers_json  JSONB,                           -- snapshot dos modificadores escolhidos
  notes           TEXT,                            -- "Sem cebola por favor"
  subtotal_cents  INT NOT NULL
);

CREATE INDEX idx_orders_business ON bc_orders(business_id, status);
CREATE INDEX idx_orders_customer ON bc_orders(customer_email);
CREATE INDEX idx_menu_items_biz ON bc_menu_items(business_id, available);
```

### 3. APIs novas

**Pra dono do restaurante:**
- `POST /api/restaurant/onboard` — cria conta Stripe Express + retorna URL de onboarding
- `GET /api/restaurant/menu?business_id=X` — lista menu completo
- `POST /api/restaurant/menu/category` — CRUD categorias
- `POST /api/restaurant/menu/item` — CRUD itens (com upload de foto)
- `GET /api/restaurant/orders?business_id=X` — lista pedidos pendentes
- `POST /api/restaurant/orders/:id/status` — confirmar/marcar pronto/cancelar

**Pra cliente:**
- `GET /api/restaurant/menu-public?business_slug=X` — menu pra mostrar no /negocio/:slug
- `POST /api/restaurant/order` — criar pedido + Stripe PaymentIntent
- `GET /api/restaurant/order/:id` — status do pedido (cliente acompanha)

### 4. UI novas páginas

- **`/negocio/:slug`** — adiciona seção "Cardápio" embaixo se `accepts_orders=true`
- **`/negocio/:slug/cardapio`** — página dedicada do menu
- **`/negocio/:slug/checkout`** — carrinho + endereço + pagamento (Stripe Elements embed)
- **`/pedido/:id`** — confirmação + tracker (em preparo / pronto / entregue)
- **`/assinante`** → nova aba **"Cardápio"** (só aparece se Premium+) — gerencia categorias/itens, recebe pedidos
- **`/assinante`** → nova aba **"Pedidos"** — fila de pedidos novos com som de alerta tipo iFood

### 5. Fluxo de Stripe Connect

**Onboarding do restaurante (1x):**
```
1. Dono clica "Ativar pedidos" no /assinante
2. Backend cria Stripe Express account (account.create)
3. Gera Account Link com return_url
4. Redireciona dono pro Stripe (preenche LLC, banco, ID, etc)
5. Dono volta pro /assinante autenticado
6. Webhook account.updated → atualiza stripe_onboarded=true
```

**Cliente faz pedido:**
```
1. Cliente monta carrinho em /negocio/:slug/cardapio
2. Vai pra /negocio/:slug/checkout
3. Preenche endereço/pickup, clica Finalizar
4. Backend cria PaymentIntent com:
   - amount = total
   - application_fee_amount = nosso fee (2-3%)
   - transfer_data.destination = stripe_account_id do restaurante
5. Cliente paga com Stripe Elements (cartão)
6. Webhook payment_intent.succeeded → status=confirmed
7. Restaurante vê pedido no /assinante → toca alarme
8. Restaurante muda status (preparing → ready → delivered)
9. Cliente acompanha em /pedido/:id (real-time via SSE ou polling)
```

## Fases de entrega

### Fase 1 — MVP (3-4 dias)
- ✅ SQL completo (acima)
- ✅ Onboarding Stripe Express
- ✅ CRUD menu (categorias + itens, sem modificadores ainda)
- ✅ Página /cardapio embebida em /negocio/:slug
- ✅ Carrinho + checkout simples (só pickup, sem delivery)
- ✅ Aba "Pedidos" no /assinante
- ✅ Confirmação por email pro cliente

### Fase 2 — Delivery (2-3 dias)
- Calcular delivery fee por raio
- Integrar Google Maps pra endereço autocomplete
- Tracker /pedido/:id com polling
- SMS de notificação (Twilio)

### Fase 3 — Polish (2 dias)
- Modificadores ("sem cebola", "tamanho M/G")
- Cupons / desconto
- Avaliação pós-pedido
- Cardápio com fotos zoomáveis
- Pedido recorrente ("repetir último")

### Fase 4 — Marketing (futuro)
- Notificação push pra clientes regulares ("Padaria do João tem pão de queijo fresquinho!")
- Featured no feed nacional pra restaurantes Premium
- Referral: cliente que indica ganha $5 de crédito

## Custos estimados (Stripe Connect)

- **Express accounts:** $0.50/mês por restaurante ativo (Stripe cobra)
- **Processing fee:** 2.9% + $0.30 por transação (Stripe, pago pelo cliente)
- **Application fee:** o que a gente cobra (sugestão 2-3%)
- **Payouts:** $2.00 cada (Stripe) — restaurante decide frequência (diário/semanal)

## Concorrência: o que o iFood/DoorDash cobram?

| Plataforma | Fee restaurante | Fee cliente |
|---|---|---|
| iFood (BR) | 12-23% | $4 entrega |
| DoorDash | 15-30% | $5-7 entrega + tip + service fee |
| Uber Eats | 15-30% | $5+ entrega + service fee |
| **BrasilConnect (proposto)** | **2-3%** | só Stripe processing |

Posicionamento óbvio: "ferramenta de comunidade, não tubarão de comissão".

## Decisões pendentes (precisam discussão)

- [ ] **Delivery próprio ou só pickup?** Delivery exige logística (motoboy, raio, etc). MVP recomendo **só pickup**.
- [ ] **Tax automática?** US tem sales tax estadual variável. Pode usar Stripe Tax ($) ou deixar manual.
- [ ] **Tip vai pro restaurante 100%?** Sim, sem split.
- [ ] **Cancelamento:** prazo? quem decide? refund automático ou manual?
- [ ] **Disputa:** se cliente reclama do pedido, quem media? Política clara.
- [ ] **Inventory tracking:** marcar "esgotado" item por item, ou contador?

---

## Próximo passo

Quando você quiser começar, eu faço:
1. SQL acima
2. Onboarding Stripe Express
3. CRUD menu básico (sem modificadores)
4. Cardápio público no /negocio
5. Checkout com Stripe Elements

E vamos iterando. Estimativa Fase 1: **3-4 dias de dev** (várias conversas).
