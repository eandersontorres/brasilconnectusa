# Setup Stripe TEST mode — AgendaPro

Pra simular a criação dos planos sem cobrar de ninguém de verdade. Tempo total: ~15 minutos.

## Passo 1 — Criar conta Stripe (se ainda não tem)

Acessa <https://dashboard.stripe.com/register> e cria conta. Pode pular o setup de "informações da empresa"
por enquanto — você só vai usar o modo TEST.

## Passo 2 — Ativar o modo de teste

No dashboard, no canto superior direito tem um toggle **"Test mode"** (laranja/amarelo).
**Liga ele.** Tudo que você fizer agora fica isolado dos dados de produção.

## Passo 3 — Criar os 3 produtos + preços

Acessa **Products** no menu lateral (`https://dashboard.stripe.com/test/products`).

### Produto 1: Starter

1. Clica **+ Add product**
2. **Name:** `AgendaPro Starter`
3. **Description:** `1 profissional, agendamentos ilimitados, lembrete por email`
4. Em **Pricing:**
   - **Pricing model:** Standard pricing
   - **Price:** `19.00 USD`
   - **Recurring** (não one-time)
   - **Billing period:** Monthly
5. Clica **Save product**
6. Na tela do produto, copia o **Price ID** (formato `price_1XXXXXXXXXX`) — vai colar no Vercel depois

### Produto 2: Pro

Repete o processo:
- **Name:** `AgendaPro Pro`
- **Description:** `1 profissional, SMS, página customizada, reviews, galeria`
- **Price:** `39.00 USD` recorrente mensal
- Copia o **Price ID**

### Produto 3: Premium

- **Name:** `AgendaPro Premium`
- **Description:** `Até 10 profissionais, SMS, relatórios, sem branding`
- **Price:** `79.00 USD` recorrente mensal
- Copia o **Price ID**

## Passo 4 — Pegar a Secret Key de teste

1. Vai em **Developers → API keys** (`https://dashboard.stripe.com/test/apikeys`)
2. Copia a **Secret key** (formato `sk_test_XXXXXXX`) — clica em "Reveal test key" pra ver

## Passo 5 — Setar as env vars no Vercel

Acessa <https://vercel.com/torresbee/brasilconnectusa/settings/environment-variables>
e adiciona (uma de cada vez, **Environment: Production + Preview + Development**):

| Variável | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (do passo 4) |
| `STRIPE_PRICE_STARTER` | `price_...` (Starter, passo 3) |
| `STRIPE_PRICE_PRO` | `price_...` (Pro, passo 3) |
| `STRIPE_PRICE_PREMIUM` | `price_...` (Premium, passo 3) |

> **Importante:** depois de adicionar, faz um **Redeploy** (Deployments → último → ⋯ → Redeploy)
> pra Vercel pegar as novas envs.

## Passo 6 — Webhook (pra atualizar status da assinatura)

O webhook é o que avisa o seu app quando o pagamento completa, falha, ou o cliente cancela.

1. **Stripe Dashboard → Developers → Webhooks** (`https://dashboard.stripe.com/test/webhooks`)
2. Clica **+ Add endpoint**
3. **Endpoint URL:** `https://brasilconnectusa.com/api/stripe/webhook`
4. **Events to listen to:** Selecione esses 4:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Clica **Add endpoint**
6. Na tela do endpoint, copia o **Signing secret** (formato `whsec_...`)
7. Adiciona no Vercel:

| Variável | Valor |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |

8. Redeploy de novo.

## Passo 7 — Testar

1. Abre <https://brasilconnectusa.com/agenda/planos>
2. No topo deve aparecer banner **amarelo "🧪 MODO TESTE"** com instruções de cartão fake
3. Faz login com email do seu cadastro de profissional (do `/assinante`)
4. Clica **"Começar trial 14 dias"** num dos planos
5. Vai redirecionar pro Stripe Checkout
6. Preenche assim:
   - **Cartão:** `4242 4242 4242 4242`
   - **Validade:** qualquer data futura (ex: `12/30`)
   - **CVC:** qualquer 3 dígitos (`123`)
   - **CEP:** qualquer (`12345`)
7. Clica **Subscribe**
8. Volta pro `/agenda/{seu-slug}?subscribed=1`
9. Confere em **Stripe Dashboard → Customers** que o cliente apareceu
10. Confere no Supabase (`SELECT * FROM ag_providers WHERE email='seu@email'`) que `plan_status = 'active'` ou `'trialing'`

## Cartões de teste úteis

| Cartão | Comportamento |
|---|---|
| `4242 4242 4242 4242` | ✅ Aprova normal |
| `4000 0000 0000 9995` | ❌ Recusa por falta de fundo |
| `4000 0025 0000 3155` | 🔐 Pede 3D Secure (autenticação) |
| `4000 0000 0000 0341` | ⏱️ Aprova mas falha na renovação (pra testar `invoice.payment_failed`) |

Lista completa: <https://stripe.com/docs/testing>

## Quando estiver pronto pra LIVE

1. Vai em **Stripe Dashboard → Activate account** e preenche dados da empresa (LLC, EIN, conta bancária)
2. Stripe aprova em ~24h
3. Desliga o toggle **"Test mode"** no canto
4. Cria os 3 produtos de novo (em modo LIVE eles são separados dos test)
5. Cria webhook LIVE também
6. Troca as 5 env vars no Vercel pelos valores **live** (`sk_live_`, `price_` LIVE, `whsec_` LIVE)
7. Redeploy

O código não muda nada — só as variáveis de ambiente.

## Troubleshooting

**Banner mostra "Stripe não configurado":**
- `STRIPE_SECRET_KEY` não tá no Vercel ou não fez redeploy

**Banner mostra "Faltam env vars: STRIPE_PRICE_X":**
- Algum dos 3 prices não foi setado

**Erro "No such price":**
- O `STRIPE_PRICE_STARTER/PRO/PREMIUM` no Vercel é de LIVE mode mas a chave é de TEST (ou vice-versa)
- Os Price IDs são diferentes entre TEST e LIVE — precisa criar novos

**Webhook não atualiza `plan_status`:**
- Confere em Stripe Dashboard → Webhooks → seu endpoint → aba **"Logs"**
- Se mostrar 400, é signature verification — o `STRIPE_WEBHOOK_SECRET` tá errado
- Se mostrar 500, abre o log do Vercel pra ver o erro real

**Quero limpar tudo e começar do zero:**
- Stripe Test mode tem botão **"Delete all test data"** em Developers → API keys
- Apaga todos customers, subscriptions, invoices test (LIVE não é afetado)
