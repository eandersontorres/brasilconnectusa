# BrasilConnect Store — arquitetura e contrato

Marketplace de produtos aprovados. Cada vendedor tem a própria loja dentro da Store,
configura para onde entrega, posta o pacote e responde pela garantia. A BrasilConnect
é a vitrine: modera, processa o pagamento (Stripe) e repassa ao vendedor depois da
entrega, descontando a comissão e, se a etiqueta for comprada pela Store (Shippo), o
custo da etiqueta.

> Documento de referência para quem mexe no código. As decisões de negócio em aberto
> estão no fim (seção 12).

## 1. Decisões

| Tema | Decisão |
|---|---|
| Rota pública | `/store` (a `/loja` continua sendo a Coleção 01, merch da marca) |
| Front | Páginas estáticas em `public/store/*.html` + JS puro, no visual do `premium.css`. Produto e loja são renderizados no servidor (`api/store/page.js`) para SEO e prévia no WhatsApp. |
| Pagamento | **Separate charges and transfers**. Um Stripe Checkout (hospedado) por carrinho, mesmo com várias lojas. O dinheiro fica no saldo da plataforma; cada pedido vira um `transfer` para a conta Express do vendedor quando é liberado. A BrasilConnect é o merchant of record perante o cartão; a responsabilidade do vendedor (envio, garantia, devolução) fica no Contrato do Vendedor. |
| Liberação do repasse | Entregue + 3 dias (7 para loja nova, menos de 5 pedidos concluídos), ou na hora em que o comprador confirma o recebimento. Envio próprio (rastreio informado pela loja, sem etiqueta da Store) usa sempre o prazo maior (7 dias). Envio sem confirmação de entrega: 30 dias (`safety_release_days`) após o envio, **só se a transportadora já escaneou o pacote** (`tracking_status = TRANSIT`). Envio que não dá para acompanhar (transportadora "Outro", que a Shippo não conhece, ou Shippo desligada) libera em `shipped_at` + `safety_release_days`, sem exigir leitura. Entrega local/retirada: 3 dias após a loja marcar como entregue. Antes de cada transfer o servidor confere a cobrança no Stripe (situação de cada contestação, reembolso feito fora da Store) e a situação da loja (suspensa ou dono banido = repasse retido). Tudo configurável no admin (seção 2.1). |
| Comissão | `bc_store_config.fee_bps` (padrão **10%, provisório**), sobre itens + frete, descontada do repasse. O comprador não vê comissão. Override por loja em `fee_bps_override`. |
| Frete | Cada loja cadastra regiões (`bc_store_shipping_zones`): envio por transportadora (estados), entrega local (CEPs) ou retirada. Preço fixo: primeiro item + adicional, grátis acima de X. O comprador só consegue comprar se o endereço estiver numa região da loja. |
| Etiqueta | Shippo. A loja compra a etiqueta pelo painel; a BrasilConnect paga a Shippo e desconta do repasse. Também aceita envio próprio (transportadora + rastreio). Com a Platform Account da Shippo (`SHIPPO_PLATFORM_MODE=1`), cada loja ganha uma managed account. |
| Moderação | Nada aparece sem aprovação humana: loja (`bc_store_sellers.status`) e produto (`bc_store_products.status`). A IA (cron de moderação) só sinaliza. Editar título, descrição, fotos ou categoria de um produto aprovado volta para análise. Preço e estoque não. Loja aprovada que muda nome, logo ou capa: a mudança fica em `pending_changes` até o admin aprovar (frase e texto vão direto, com revisão da IA). Avaliação de comprador é publicada na hora; a IA esconde a de alto risco até o admin revisar. |
| Lançamento | `bc_store_config.public_enabled` (vitrine) e `checkout_enabled` (compras) começam desligados. Vendedores já podem se cadastrar e montar o catálogo. `?preview=brasil2026` mostra a vitrine fechada. A lista de espera (`bc_interest_waitlist`, `interest_id = 'store'`) recebe o aviso "a Store abriu para compras" só quando a Store fica aberta para **compras**: depois do `save_config`, `public_enabled` **e** `checkout_enabled` ligados, e antes não estavam os dois. Abrir só a vitrine não avisa. |

## 2. Estados

**Loja:** `pending → approved | rejected`; `approved → suspended → approved`.
Loja vende quando `status='approved'` **e** `stripe_transfers_active` **e** não está em férias (`sellerCanSell`).

**Produto:** `draft → pending_review → approved | rejected`; `approved ↔ paused` (vendedor); `approved → suspended` (admin); `archived`.
Para sair de `draft`: pelo menos 1 foto (máx. 8), descrição com 80+ caracteres, sem contato direto (telefone, e-mail, link, @), peso em oz se a loja envia por transportadora.

**Pedido (`bc_store_orders`, um por loja dentro do checkout):**
```
pending_payment ─(pago)→ paid ─(etiqueta/rastreio)→ shipped ─(rastreio DELIVERED / loja marca / comprador confirma)→ delivered ─(repasse)→ completed
pending_payment ─(checkout expira)→ expired
paid ─(cancelamento: comprador, loja, admin ou prazo vencido)→ canceled   (reembolso integral, estoque volta)
shipped|delivered|completed ─(reembolso integral)→ refunded
```
`payout_status`: `pending` (aguardando) · `held` (retido; motivo em `hold_reason`) · `blocked` (loja sem Stripe ativo) · `releasing` (transfer em andamento desde `releasing_at`: trava contra reembolso e repasse duplo; no admin aparece como "Repasse em processamento"; travado há 10 min+ é retomado, seção 2.1) · `released` · `reversed` · `none`.
`hold_reason` (em PT no admin): `seller_suspended` (loja suspensa ou dono banido) · `stripe_incomplete` · `chargeback` (contestação aberta no Stripe) · `chargeback_lost` (contestação perdida no Stripe que a Store não registrou: conferir e reembolsar/estornar) · `refund_mismatch` (o Stripe tem mais reembolso do que a Store registrou) · `tracking_date_invalid` (rastreio diz que entregou antes do envio) · `tracking_address_mismatch` (envio próprio entregue em outro CEP/estado) · `tracking_returned` · `tracking_failure` · `reversal_failed` (o estorno do repasse falhou e virou débito; o `payout_status` continua `released`) · `admin: <motivo>`.
`label_status`: `none · purchasing (compra em andamento, com label_locked_at) · purchased · failed · refund_requested · refunded`.
`dispute_status` (Garantia BrasilConnect): `none · open · escalated · resolved_refund · resolved_release · chargeback`. Com `open/escalated/chargeback` o repasse não sai.
Eventos de pedido (`bc_store_order_events`) com `kind = 'hold'` são internos (retenção por rastreio suspeito, contestação): o comprador não vê e a loja vê só "Repasse retido pela BrasilConnect". Também ficam fora das telas de loja/comprador: `payout_failed`, `auto_cancel_failed`, `note`, `admin_note`.

**Valores de repasse no pedido:** `payout_cents` = valor transferido; `reversed_cents` = estornado da loja depois do repasse; `debt_applied_cents` = débito antigo da loja abatido deste repasse; `debt_restored_cents` = parte desse débito que voltou para a loja porque o pedido foi reembolsado depois; `debt_taken_cents` = débito abatido pelo repasse em andamento (volta para a loja se a rodada morrer antes do transfer); `releasing_at` = início do repasse em andamento.
**Débito da loja:** `bc_store_sellers.debt_cents` (seção 2.1).

## 2.1 Regras de operação

**Dias úteis e prazos.** Contados no horário de Nova York, de segunda a sexta, sem feriados federais
(`usFederalHolidays`, dias sem coleta da USPS). Prazos vencem às 23:59:59 de Nova York
(`nyEndOfBusinessDay`). `ship_by` = pagamento + `handling_days` dias úteis.

**Cancelamento automático** (`orderAutoCancelAt(pedido, cfg)` = `autoCancelAt(orderDeadline(pedido),
auto_cancel_grace_days)`, cron de hora em hora; a mesma data aparece no painel, para o comprador e nos avisos):
- Prazo do pedido (`orderDeadline`) = `ship_by`. Entrega local: o maior entre `ship_by` e `paid_at` +
  `zone_snapshot.est_days_max` dias (fim do dia em Nova York).
- Retirada/entrega local combinada para outra data: a loja registra no painel (`schedule-handoff`, uma vez,
  até 14 dias depois do pagamento). `ship_by` passa a ser o fim do dia combinado (nunca encurta) e
  `handoff_scheduled_at` guarda a data.
- Vencido o prazo + carência, o pedido `paid` é cancelado (reembolso integral, estoque volta). Pedido com
  etiqueta em `purchasing` espera o reparo da etiqueta; pedido com contestação no cartão fica com o admin.
- **Etiqueta da Store comprada e nunca escaneada** (`shipped` + `label_status = purchased` + rastreio nulo,
  `PRE_TRANSIT` ou `UNKNOWN`, sem confirmação do comprador nem problema aberto) tem **+2 dias úteis de
  carência extra** (`addBusinessDays`) sobre a data de um pedido sem etiqueta. Antes de cancelar, o cron
  consulta o rastreio **ao vivo** (`getTrack`, timeout de 5 s): `TRANSIT/DELIVERED/RETURNED/FAILURE` → aplica a
  leitura (`applyTracking`) e não cancela; consulta falhou (rede, 5xx, 429) → não cancela nesta rodada;
  número que a Shippo não conhece (4xx) conta como sem leitura. Sem leitura: o cron volta o pedido para `paid`
  (update condicional; limpa `shipped_at` e `tracking_*`, mantém a etiqueta) e cancela: o comprador é
  reembolsado, o estoque volta e o reembolso da etiqueta é pedido à Shippo. A loja também pode anular antes
  pelo painel (`label-void`).
- O rastreio parado (etapa do cron) roda **antes** do aviso e do cancelamento, para pacote já lido não ser
  avisado nem cancelado com o rastreio gravado velho.

**Aviso de prazo** (cron, só das 8h às 22h de Nova York; evento `ship_by_warning`):
- Pedido `paid` cujo prazo (`orderDeadline`) vence nas próximas 24 h. Com data combinada
  (`handoff_scheduled_at`) o texto é "Retirada/Entrega combinada para X: marque como entregue até Y", sem
  sugerir novo registro (o registro é único). Sem data combinada, a entrega local/retirada também lembra que
  dá para registrar a data combinada.
- Etiqueta da Store comprada e pacote ainda sem leitura, entre a data em que um pedido sem etiqueta seria
  cancelado e o fim da carência extra: "a transportadora ainda não registrou seu pacote; se não houver
  leitura até X, o pedido é cancelado e o comprador reembolsado" (confere o rastreio ao vivo antes).
- **Um aviso por prazo:** o evento guarda em `data` o tipo (`warn: deadline|unscanned`) e o prazo avisado
  (`deadline`, ISO). Só avisa de novo se o prazo mudar (ex.: data combinada registrada). Aviso antigo, sem
  `data.deadline`, vale até um `handoff_scheduled` registrado depois dele.

**Etiqueta em processamento.** `label-buy` trava `label_status = purchasing` com `label_rate_id` e
`label_locked_at`. A compra na Shippo é **assíncrona** (`POST /transactions` com `async: true`): a resposta
traz o `object_id` na hora, gravado em `shippo_transaction_id`; um erro na consulta seguinte vira `QUEUED`
(continua `purchasing`, resposta 202 "em processamento"). Depois de 10 min o cron confere
`GET /transactions/<id>` na Shippo: `SUCCESS` → marca enviado com a etiqueta (custo pela rate) e avisa a loja;
se o pedido já não estava `paid`, pede o reembolso da etiqueta · `QUEUED/WAITING` → espera · `ERROR` →
`failed`. **Sem o id** (timeout ou rede no POST): antes de liberar, procura a transação na Shippo
(`findTransaction`: metadata `order:<id>` ou a rate `label_rate_id`; transação com outra rate, de etiqueta
anulada antes, não serve). Achou → grava o id e segue o caminho acima. Não achou → `failed` + aviso ao admin
para conferir a fatura da Shippo. Busca falhando (rede/5xx) → tenta de novo na próxima rodada; passadas 24 h
do `label_locked_at`, libera com o aviso ao admin. O admin faz o mesmo na hora com `unlock_label` (compra
iniciada há 2 min+). `api/store/seller.js` tem `maxDuration` 60 s.

**Repasse: travas e conferências** (`releaseOrder`):
1. Loja não aprovada ou dono banido → `held/seller_suspended` (o `force` do admin passa por cima); loja sem
   Stripe ativo → `blocked`.
2. Cobrança sem `stripe_charge_id`: recupera pelo PaymentIntent.
3. Confere a cobrança no Stripe: `stripe.disputes.list` da cobrança e o **status de cada disputa** (o
   `charge.disputed` continua `true` depois de uma contestação ganha, então não vale). Alguma aberta
   (`warning_needs_response`, `warning_under_review`, `needs_response`, `under_review`) → `held/chargeback`
   (+ `dispute_status = chargeback`) e aviso; alguma `lost` → `held/chargeback_lost` e aviso; todas
   `won`/`warning_closed` → segue. `amount_refunded` maior que a soma de `refunded_cents` do checkout →
   `held/refund_mismatch` + aviso.
4. Trava `payout_status = releasing` com `releasing_at` (update condicional; reembolso em andamento impede).
5. `transfers.list` do `transfer_group`: transfer de rodada anterior com `metadata.order_id` é reaproveitado.
6. Senão, abate o débito da loja (`bc_store_take_debt`), anota em `debt_taken_cents` e faz o
   `transfers.create` com idempotency key.
O reembolso reserva o valor somando `refunded_cents` com guarda no valor antigo (um reembolso por vez).

**Repasse retomável.** Se a função morrer com o pedido em `releasing`, o pedido não fica preso: com
`releasing_at` há mais de 10 min (ou nulo), ou com `force` do admin, `releaseOrder` chama `recoverRelease`,
que confere no Stripe (`transfers.list` por `transfer_group` e `metadata.order_id`). Transfer feito → grava
como `released`. Não feito → devolve à loja o débito abatido (`debt_taken_cents`), volta para `pending` e
segue a regra normal. O cron tem uma etapa para pedidos em `releasing` há 10 min+ (e avisa o admin uma vez
por travamento se não conseguir conferir). No admin, o pedido mostra "Repasse em processamento" e, se
travado há 10 min+, o botão **"Destravar repasse"** (`action=release`, com `force`). Repasse em andamento há
menos de 10 min não é mexido (409 no admin). Contestação perdida com o pedido em `releasing`: o webhook acerta
o repasse antes (`recoverRelease`) para estornar o transfer, ou falha para o evento ser refeito se o repasse
estiver em andamento agora.

**Reembolso depois do repasse e débito da loja** (`refundOrder`):
- Pela **loja**: estorna da conta da loja **antes** de reembolsar. Sem saldo no Stripe, nada é reembolsado e a
  loja vê "Seu saldo no Stripe não cobre o estorno… fale com a BrasilConnect".
- Pelo **admin/sistema** (garantia, contestação perdida): reembolsa primeiro (protege o comprador). Se o
  estorno falhar, o valor vira débito (`bc_store_sellers.debt_cents`, `hold_reason = reversal_failed`),
  abatido dos próximos repasses. O admin vê o débito na aba Lojas e pode zerar (`clear_seller_debt`, com
  motivo registrado) se a loja pagar por fora.
- **Débito devolvido:** o valor que a loja recebeu por um pedido é `payout_cents + debt_applied_cents` (o
  débito antigo que esse repasse quitou também é dinheiro dela). Se esse pedido for reembolsado depois, o que
  não voltar por estorno (até o transferido) volta a ser débito da loja (`bc_store_add_debt`), anotado em
  `debt_restored_cents` para não devolver duas vezes. Vale também para o pedido concluído sem transfer (todo o
  repasse abateu débito).

**Rastreio suspeito** (`applyTracking`/`markDelivered`, webhook da Shippo e cron):
- Data de entrega mais de 24 h antes do piso do pedido: não marca entregue; retém (`tracking_date_invalid`) e
  avisa o admin. Piso: etiqueta da Store → `shipped_at` (compra da etiqueta); envio próprio → `paid_at` (a loja
  pode digitar o rastreio depois de o pacote ser entregue, então isso não é suspeito).
- Envio próprio (sem etiqueta da Store): o destino do pacote (`address_to` da Shippo) precisa bater com o
  CEP/estado do pedido; senão retém (`tracking_address_mismatch`).
- O mesmo número de rastreio não pode estar em pedido de outro comprador (`ship-manual` recusa com 409).
- Pedido retido como suspeito não é reprocessado pelo webhook/cron: o admin decide (soltar ou reembolsar).

**Pagamento interrompido.** `bc_store_stripe_events.processed_at` é gravado ao terminar. Reenvio de evento
já processado = 200 duplicado; evento registrado sem `processed_at` há menos de 5 min = 409 (o Stripe
reenvia depois); há mais de 5 min = a função morreu no meio e o evento é refeito (`markCheckoutPaid` é
retomável). O cron também repara checkout `paid` com pedido ainda `pending_payment` (pago há 5 min+).
E-mail (Resend) e push têm timeout de 8 s para não estourar o tempo da função.

**Contestação no cartão.** Pelo webhook (`charge.dispute.*`) e, como rede de segurança, pelo cron:
`stripe.disputes.list` das disputas criadas nos últimos 3 dias e das cobranças com pedido em `chargeback`,
aplicando o que faltou (`reconcileStoreDispute`; marca `sweep_*` em `bc_store_stripe_events` para não
repetir). Perdida: pedidos `refunded`, repasse estornado (ou débito, se o Stripe recusar). Ganha: o repasse
volta ao prazo normal; o `releaseOrder` olha o status de cada disputa, então uma contestação ganha não
retém o repasse de novo.

**Loja suspensa ou dono banido.** `suspend_seller` retém os repasses (`seller_suspended`) e expira os
checkouts ainda abertos no Stripe com produto da loja (estoque volta). Banir o dono (`/api/admin/user-action`
`ban` ou `/api/admin/moderation-action` `ban_user`) faz o mesmo com a loja aprovada dele. Pagamento que
chega para loja suspensa entra com o repasse retido e o admin é avisado. Desbanir não reativa a loja
(`reinstate_seller` na aba Store).

**Alterações de loja aprovada.** Nome, logo e capa novos ficam em `pending_changes` (`pending_changes_at`)
até o admin decidir na aba Lojas (`approve_shop_changes` aplica, `reject_shop_changes` descarta com motivo;
os dois avisam a loja e vão para `bc_store_moderation_log`). Remover logo/capa vale na hora.

**Avaliações.** Publicadas na hora (sem contato direto no texto). O cron de moderação lê as `pending`:
`high/critical` → `status = hidden` (médias da loja e do produto recalculadas) e aparece na aba Avaliações do
admin, que esconde ou mostra (`hide_review`/`show_review`). Só nota, sem texto, sai da fila como limpa.

**Limites de checkout e mensagens.**
- Checkout: o carrinho fica reservado por `checkout_expires_minutes` (padrão **30 min**, o mínimo do Stripe;
  o admin pode subir até 1440). Checkouts abandonados nas últimas 24 h: 5 por conta (3 para quem nunca pagou)
  → 429. Só conta como abandono o checkout que segurou estoque por mais de 10 min (`closed_at - created_at`;
  `closed_at` é gravado por `expireCheckout`, inclusive quando o próprio comprador refaz o checkout). Quem
  nunca pagou reserva no máximo `max(5, metade do estoque)` de cada produto. Mais o rate limit por IP.
- Conversa do pedido: até 30 mensagens de cada lado por pedido em 24 h (429); fecha 30 dias depois de o pedido
  ser cancelado, reembolsado ou concluído (409); aviso (sino/push/e-mail) só na primeira mensagem de uma
  sequência de 30 min.
- Mensagens ao vendedor e ao comprador em PT-BR, sem código cru do Stripe/Shippo (`won`, `lost`,
  `PRE_TRANSIT`…): rastreio por `TRACKING_PT`, situação da contestação por `DISPUTE_STATUS_PT` no webhook.

## 3. Arquivos

| Área | Arquivo |
|---|---|
| Banco | `supabase/bc_store_schema.sql` |
| Regras compartilhadas | `api/_lib/store.js` (config, taxa, repasse, frete, auth, avisos, serialização) |
| Operações com dinheiro | `api/_lib/storeOrders.js` (pago, expirado, cancelar, reembolsar, repassar, rastreio) |
| Shippo | `api/_lib/shippo.js` |
| Vitrine pública (JSON) | `api/store/catalog.js` |
| Páginas SSR (produto, loja, sitemap) | `api/store/page.js` |
| Carrinho e checkout | `api/store/checkout.js` |
| Área do comprador | `api/store/buyer.js` |
| Painel do vendedor | `api/store/seller.js` |
| Webhook Shippo | `api/store/shippo-webhook.js` |
| Admin | `api/admin/store.js` |
| Cron (cancelamento, rastreio, repasse) | `api/cron/store.js` (de hora em hora) |
| Webhook Stripe | `api/stripe/webhook.js` (ramos `store_checkout`, `account.updated`, disputas) |
| Front compartilhado | `public/js/store.js` (`window.BCStore`), `public/css/store.css` (prefixo `st-`) |
| Páginas | `public/store/index.html`, `carrinho.html`, `pedidos.html`, `vender.html`, `painel.html`, `regras.html` |
| Painel do vendedor (widget) | `public/js/store-painel.js` |
| Admin (aba Store) | `public/admin/manage.html` + `public/js/admin-store.js` |

## 4. Rotas (vercel.json)

Rotas específicas antes das genéricas:

```
/store                    → /store/index.html
/store/carrinho           → /store/carrinho.html
/store/vender             → /store/vender.html
/store/painel             → /store/painel.html
/store/regras             → /store/regras.html
/store/pedidos            → /store/pedidos.html
/store/pedidos/:id        → /store/pedidos.html
/store/sitemap.xml        → /api/store/page?type=sitemap
/store/p/:slug            → /api/store/page?type=product&slug=:slug
/store/loja/:slug         → /api/store/page?type=shop&slug=:slug
```
`X-Robots-Tag: noindex` em `/store/carrinho`, `/store/painel`, `/store/pedidos(.*)`.
Cron: `/api/cron/store` a cada hora (`0 * * * *`).

Slugs reservados (não podem ser loja): ver `RESERVED_SLUGS` em `api/_lib/store.js`.

## 5. Convenções do backend

- Handler Vercel `export default async function handler(req, res)`; `OPTIONS` → 200; `?action=` multiplexa.
- `getSupabase()`, `getStripe()`, `getConfig()`, `err(res, status, msg)` de `api/_lib/store.js`.
- Erros `{ error: 'mensagem em PT-BR' }`. Sucesso `{ ok: true, ... }` ou o objeto pedido.
- Auth: `requireUser(req, supabase)` (comprador) e `requireSeller(req, supabase, { approvedOnly })`. Admin: `requireAdmin(req)`.
- Preço, frete, comissão e estoque **sempre** recalculados no servidor.
- Rate limit (`api/_lib/rateLimit.js`) em toda escrita pública.
- Nunca devolver: `ship_from`, `phone`, `stripe_*`, `shippo_*`, `compliance_*`, `agent_*`, `admin_notes` fora do dono/admin. Endereço do comprador só para a loja do pedido, e só depois de pago.
- Avisos com `notify()` / `notifyOrderParties()` / `notifyAdmin()` (best effort).
- Toda mudança de pedido registra `logEvent()`.
- `Cache-Control`: públicos `public, s-maxage=60, stale-while-revalidate=300`; autenticados `private, no-store`.

## 6. API

Todas respondem JSON. `🔒` = exige `Authorization: Bearer <JWT Supabase>`.

### 6.1 `GET /api/store/catalog`

| action | Parâmetros | Resposta |
|---|---|---|
| `home` | — | `{ config, categories:[Category], featured:[Product], newest:[Product], sellers:[SellerCard] }` |
| `search` | `q, category, state, seller (slug), sort (relevance\|newest\|price_asc\|price_desc\|best_selling), min, max (centavos), page (1..), per (≤48)` | `{ items:[Product], total, page, per, has_more }` |
| `product` | `slug` | `{ product: Product, seller: Seller, category: Category, delivery:[ZoneSummary], ships_to:[UF], reviews:[Review], related:[Product] }` · 404 se não estiver à venda |
| `seller` | `slug` | `{ seller: Seller, products:[Product], delivery:[ZoneSummary], ships_to:[UF], reviews:[Review], categories:[{slug,name,count}] }` |
| `estimate` | `product_id, state, zip, qty` | `{ options:[DeliveryOption] }` |
| `config` | — | `{ config, categories }` |

Só entram produtos `approved` de lojas que podem vender (`sellerCanSell`). Filtro `state`: lojas com alguma região ativa que inclua o estado.

Formatos:
```
Category     { slug, name, description, gated, requirements, count? }
Product      publicProduct(): { id, slug, title, description, category_slug, condition, origin, price_cents,
               compare_at_cents, in_stock, stock, images[], hazmat, tags[], sales_count, rating_avg,
               rating_count, published_at, seller:{ id, slug, name, logo_url, state, city, rating_avg, rating_count } }
Seller       publicSeller(): { id, slug, name, tagline, bio, logo_url, banner_url, city, state, handling_days,
               accepts_returns, return_window_days, return_policy, warranty_policy, sales_count, rating_avg,
               rating_count, vacation_mode, member_since }
SellerCard   { slug, name, logo_url, city, state, rating_avg, rating_count, sales_count }
ZoneSummary  { method, name, states[], rate_first_cents, rate_additional_cents, free_over_cents, est_days_min, est_days_max }
             (local_delivery mostra só a quantidade de CEPs; pickup_note nunca aparece aqui)
DeliveryOption { zone_id, method, name, shipping_cents, est_days_min, est_days_max }
Review       { rating, body, seller_reply, created_at, buyer_name ("Ana S."), product_title? }
```

### 6.2 `/api/store/page` (HTML)

`?type=product&slug=` e `?type=shop&slug=`: documento HTML completo (head com title, description, canonical,
OG com a foto, JSON-LD `Product`/`Offer`/`AggregateRating` ou `Store`), nav e footer padrão (seção 9), conteúdo
renderizado no servidor e os dados em `<script type="application/json" id="st-data">`. Carrega
`/css/premium.css`, `/css/store.css`, `/js/site.js` e `/js/store.js` e um script inline que liga o botão de
carrinho, a galeria, a estimativa de frete e a denúncia. 404 → página "Produto não encontrado" com status 404.
`?type=sitemap`: XML com `/store`, `/store/regras`, produtos e lojas à venda.

### 6.3 `/api/store/checkout`

| | action | Body | Resposta |
|---|---|---|---|
| POST | `quote` | `{ items:[{product_id, qty}], ship_to?:{state, zip}, choices?:{[seller_id]: method} }` | Quote |
| POST 🔒 | `create` | `{ items, ship_to:{name, line1, line2, city, state, zip, phone}, choices }` | `{ url, checkout_id }` (redirecionar para `url`) |
| GET 🔒 | `status` | `?id=checkout_id` | `{ status, orders:[{id, order_number, seller_name}] }` |

```
Quote {
  groups: [{
    seller: { id, slug, name, logo_url },
    items: [{ product_id, slug, title, image, price_cents, qty, stock, ok, problem }],
    options: [DeliveryOption], selected: 'ship'|'local_delivery'|'pickup'|null,
    items_cents, shipping_cents, subtotal_cents, ok, problem
  }],
  items_cents, shipping_cents, total_cents,
  can_checkout, problems: [string], checkout_enabled
}
```
`create` refaz o `quote`, exige `can_checkout`, valida o endereço (Shippo, quando configurada), reserva o
estoque (`bc_store_reserve_stock`, desfazendo se algo faltar), cria `bc_store_checkouts` + um `bc_store_orders`
por loja + itens (`pending_payment`) e o Stripe Checkout:
- `mode: 'payment'`, `customer_email`, `locale: 'pt-BR'`, `client_reference_id: checkout_id`
- `line_items` por produto (`price_data`, nome "Título · Loja", foto)
- `shipping_options`: um valor fixo = soma dos fretes (se > 0)
- `payment_intent_data: { transfer_group: 'STORE_<checkout_id>', shipping: {name, phone, address}, metadata: { type: 'store_checkout', checkout_id } }`
- `metadata: { type: 'store_checkout', checkout_id }`, `expires_at` = agora + `checkout_expires_minutes`
- `automatic_tax: { enabled: true, liability: { type: 'self' } }` só se `tax_enabled`
- `success_url: /store/pedidos?checkout=<id>&ok=1`, `cancel_url: /store/carrinho?cancelado=1`
- idempotency key `store_cs_<checkout_id>`
Não pode comprar da própria loja. Máx. 30 itens distintos, quantidade 1..99 limitada ao estoque.

### 6.4 `/api/store/buyer` 🔒

| | action | Body/params | Resposta |
|---|---|---|---|
| GET | `orders` | — | `{ orders:[BuyerOrderCard] }` (sem `pending_payment`/`expired`) |
| GET | `order` | `id` | BuyerOrderDetail |
| POST | `cancel` | `{ order_id, reason }` | `{ ok }` — só `paid` sem etiqueta |
| POST | `confirm` | `{ order_id }` | `{ ok }` — marca recebido e libera o repasse |
| POST | `dispute` | `{ order_id, reason: not_received\|not_as_described\|damaged\|other, details }` | `{ ok }` |
| POST | `escalate` | `{ order_id }` | `{ ok }` — após `seller_response_days` dias úteis ou se a loja já respondeu |
| POST | `close-dispute` | `{ order_id }` | `{ ok }` — problema resolvido com a loja |
| POST | `message` | `{ order_id, body }` | `{ message }` |
| POST | `review` | `{ order_id, product_id, rating 1..5, body }` | `{ review }` — pedido `delivered`/`completed`, sem disputa aberta |
| POST | `report` | `{ product_id, reason: prohibited\|counterfeit\|misleading\|offensive\|scam\|other, details }` | `{ ok }` |

```
BuyerOrderCard   { id, order_number, status, status_label, fulfillment, created_at, total_cents,
                   seller:{ slug, name, logo_url }, items:[{ title, image_url, quantity }], tracking_number,
                   tracking_url, carrier, dispute_status }
BuyerOrderDetail { order: { id, order_number, status, status_label, fulfillment, created_at, paid_at, ship_by,
                     shipped_at, delivered_at, completed_at, canceled_at, cancel_reason, items_cents,
                     shipping_cents, tax_cents, total_cents, refunded_cents, carrier, service,
                     tracking_number, tracking_url, tracking_status, dispute_status, dispute_reason,
                     dispute_details, dispute_opened_at, buyer_confirmed_at, ship_to,
                     zone:{ name, method, est_days_min, est_days_max, pickup_note } },
                   items:[{ id, product_id, product_slug, title, image_url, unit_price_cents, quantity,
                     subtotal_cents, reviewed }],
                   seller: { slug, name, logo_url, city, state, accepts_returns, return_window_days,
                     return_policy, warranty_policy },
                   events:[{ kind, actor, message, created_at }],
                   messages:[{ id, sender_role, body, created_at, mine }],
                   can:{ cancel, confirm, dispute, escalate, close_dispute, review, message } }
```

### 6.5 `/api/store/seller` 🔒

| | action | Body/params | Resposta |
|---|---|---|---|
| GET | `me` | — | `{ seller: SellerPrivate\|null, zones:[Zone], stats, fee:{fee_bps, fee_fixed_cents, fee_on_shipping}, policy:{release_days_after_delivery, release_days_new_seller, auto_cancel_grace_days, dispute_window_days, agreement_version}, categories:[Category], stripe:{connected, details_submitted, payouts_enabled, transfers_active, requirements_due:[]}, shippo:{enabled, test_mode} }` |
| POST | `apply` | `{ name, slug, tagline, bio, logo_url, banner_url, city, state, phone, ship_from:{name, street1, street2, city, state, zip, phone}, handling_days, accepts_returns, return_window_days, return_policy, warranty_policy, agree:true }` | `{ seller }` (status `pending`; reenvio se estava `rejected`) |
| POST | `update-shop` | mesmos campos (parcial; `slug` só antes da aprovação) + `vacation_mode` | `{ seller }` |
| POST | `connect` | — | `{ url }` (onboarding Stripe Express) |
| GET | `connect-status` | — | `{ stripe }` (sincroniza com `accounts.retrieve`) |
| POST | `stripe-login` | — | `{ url }` (Express Dashboard) |
| POST | `save-zone` | `{ id?, name, method, states[], zip_prefixes[], rate_first_cents, rate_additional_cents, free_over_cents, est_days_min, est_days_max, pickup_note, active }` | `{ zone }` |
| POST | `delete-zone` | `{ id }` | `{ ok }` |
| GET | `products` | `status?` | `{ products:[ProductPrivate] }` |
| GET | `product` | `id` | `{ product: ProductPrivate }` |
| POST | `save-product` | `{ id?, title, description, category_slug, condition, origin, price_cents, compare_at_cents, stock, sku, weight_oz, length_in, width_in, height_in, images[], hazmat, tags[], compliance_notes, compliance_images[], submit }` | `{ product, needs_review }` |
| POST | `product-status` | `{ id, status: paused\|approved\|archived }` (`approved` = reativar pausado) | `{ product }` |
| GET | `orders` | `filter: to_ship\|open\|done\|all` | `{ orders:[SellerOrderCard], counts:{to_ship, open, done, disputes} }` |
| GET | `order` | `id` | SellerOrderDetail |
| POST | `label-rates` | `{ order_id, parcel:{length, width, height, weight_oz} }` | `{ shipment_id, rates:[{rate_id, provider, service, amount_cents, days, net_payout_cents}], messages }` |
| POST | `label-buy` | `{ order_id, rate_id }` | `{ ok, label_url, tracking_number }` · 202 `{ ok, pending, message }` se a Shippo ainda estiver gerando (o cron conclui) |
| POST | `label-void` | `{ order_id }` | `{ ok }` — etiqueta da Store nunca escaneada: volta para `paid` e pede o reembolso da etiqueta |
| POST | `ship-manual` | `{ order_id, carrier, tracking_number }` | `{ ok }` (409 se o rastreio já está em pedido de outro comprador) |
| POST | `mark-delivered` | `{ order_id }` | `{ ok }` (só entrega local/retirada) |
| POST | `schedule-handoff` | `{ order_id, date: 'YYYY-MM-DD' }` | `{ ok, ship_by, handoff_scheduled_at }` — retirada/entrega local combinada (uma vez, até 14 dias após o pagamento) |
| POST | `cancel` | `{ order_id, reason }` | `{ ok }` |
| POST | `refund` | `{ order_id, amount_cents, reason }` | `{ ok }` |
| POST | `message` | `{ order_id, body }` | `{ message }` |
| POST | `reply-review` | `{ review_id, body }` | `{ review }` |
| GET | `payouts` | — | `{ pending_cents, released_cents_30d, orders:[{ id, order_number, status, payout_status, payout_cents, payout_preview_cents, release_at, completed_at }] }` |
| GET | `reviews` | — | `{ reviews:[Review + id, product_title, seller_reply] }` |

```
SellerPrivate   bc_store_sellers sem agent_*, admin_notes, fee_bps_override, shippo_*, stripe_account_id
ProductPrivate  bc_store_products sem agent_*, search_text
SellerOrderCard { id, order_number, status, status_label, fulfillment, created_at, paid_at, ship_by, late,
                  items:[{ title, image_url, quantity }], items_cents, shipping_cents, buyer_name,
                  ship_to_city, ship_to_state, tracking_number, label_status, dispute_status, payout_status }
SellerOrderDetail { order:{ ...pedido, ship_to (completo), zone_snapshot, auto_cancel_at, handoff_scheduled_at },
                    items, events, messages, handoff:{ min_date, max_date }|null,
                    payout_preview:{ gross_cents, fee_cents, label_cost_cents, refunded_cents, payout_cents, release_at },
                    can:{ buy_label, ship_manual, void_label, mark_delivered, schedule_handoff, cancel, refund, message } }
```

### 6.6 `/api/admin/store` (requireAdmin)

| | view/action | Resposta |
|---|---|---|
| GET | `view=overview` | `{ counts:{ sellers_pending, products_pending, reports_pending, disputes_escalated, disputes_open, chargebacks, orders_late, orders_to_ship, payouts_blocked, payouts_held, shop_changes_pending, sellers_debt, reviews_flagged, labels_stuck }, gmv_30d_cents, fees_30d_cents, orders_30d, config }` |
| GET | `view=sellers&status=pending\|approved\|rejected\|suspended\|changes\|debt\|all&q=` | `{ sellers:[... + pending_changes, pending_changes_at, debt_cents], summary }` |
| GET | `view=products&status=&q=&seller_id=` | `{ products:[... + seller_name, seller_can_sell, category, agent_*], summary }` |
| GET | `view=orders&filter=all\|to_ship\|late\|disputes\|blocked\|held\|labels&q=` | `{ orders:[...] }` (`labels` = etiqueta em processamento) |
| GET | `view=order&id=` | `{ order (+ releasing_stale), items, events, messages, checkout, seller (+ debt_cents), payout_preview (+ reversed_cents, debt_applied_cents), can (+ unlock_label, unstick_release) }` (`unstick_release` = repasse em `releasing` há 10 min+: botão "Destravar repasse") |
| GET | `view=reports&status=` | `{ reports:[... seller:{ ..., can_sell }] }` |
| GET | `view=reviews&filter=flagged\|hidden\|all` | `{ reviews:[... + product, seller, agent_*] }` |
| GET | `view=state-volume` | `{ states:[{ state, transactions, orders, gross_cents, threshold_cents, pct }] }` |
| GET | `view=config` | `{ config }` |
| POST | `action=approve_seller\|reject_seller\|suspend_seller\|reinstate_seller` `{ seller_id, reason }` | `{ ok, seller, held_orders, expired_checkouts }` |
| POST | `action=approve_shop_changes\|reject_shop_changes` `{ seller_id, reason, pending_changes_at? }` | `{ ok, seller }` (motivo obrigatório na recusa; 409 se a loja mandou outra versão) |
| POST | `action=clear_seller_debt` `{ seller_id, reason }` | `{ ok, cleared_cents }` |
| POST | `action=approve_product\|reject_product\|suspend_product` `{ product_id, reason }` | `{ ok, product }` |
| POST | `action=resolve_report\|dismiss_report` `{ report_id, reason }` | `{ ok }` |
| POST | `action=refund` `{ order_id, amount_cents, reason }` | `{ ok, refunded_cents, canceled, full, reversed_cents, debt_cents }` |
| POST | `action=cancel_order` · `release` · `hold` · `unhold` · `unlock_label {order_id}` · `resolve_dispute {order_id, decision: refund\|release, amount_cents?, reason}` · `message` · `hide_review\|show_review {review_id, reason?}` | `{ ok }` (`unlock_label` → `{ ok, result: shipped\|failed\|refunded\|waiting, message }`; `release` → `{ ok, already, recovered, payout_cents }`, ou `{ ok, unlocked, payout_status, message }` quando destravou mas o repasse não pôde sair; 409 em repasse `releasing` há menos de 10 min) |
| POST | `action=save_config` `{ ...campos de bc_store_config }` · `set_seller_fee {seller_id, fee_bps_override}` | `{ ok, config, waitlist }` (`waitlist = { sent, remaining }` quando o save abriu a Store para compras; senão `null`) |
| POST | `action=notify_waitlist` | `{ ok, waitlist:{ sent, remaining } }` — próximo lote do aviso "a Store abriu para compras" |

Toda aprovação usa update com guarda de status (`.eq('status', ...)`) → 409 se mudou, grava `reviewed_by`,
`logModeration()` e avisa a loja. O aviso de produto aprovado aponta para o produto só se a loja já vende;
senão leva ao painel (Recebimentos ou Loja), porque `/store/p/<slug>` daria 404. O admin só mostra "Ver na
Store"/"Ver anúncio" para produto aprovado de loja que vende (`seller_can_sell`/`can_sell`).

### 6.7 Outros

- `POST /api/store/shippo-webhook?token=SHIPPO_WEBHOOK_TOKEN` — `track_updated`: acha o pedido pelo
  `tracking_number`, confirma com `getTrack()` (que devolve também o `address_to` do pacote) e chama
  `applyTracking()` (idempotente). Responde 200 rápido.
- `GET /api/cron/store` (`CRON_SECRET`), de hora em hora, nesta ordem: (1) expira checkouts vencidos
  (conferindo a sessão no Stripe); (2) repara checkout `paid` com pedido `pending_payment`; (3) confere na
  Shippo etiqueta em `purchasing` há 10 min+ (sem id: `findTransaction`); (4) aplica contestação sem evento
  (`stripe.disputes.list`); (5) consulta rastreios parados (6h+) com `applyTracking`, deixando 15 s para as
  etapas seguintes; (6) avisa o prazo e o pacote sem leitura (8h às 22h de Nova York, um aviso por prazo);
  (7) cancela pedido vencido (`orderAutoCancelAt`; etiqueta nunca escaneada com +2 dias úteis e rastreio ao
  vivo); (8) retoma repasse travado em `releasing` há 10 min+; (9) libera repasses vencidos.
- `api/stripe/webhook.js` — `checkout.session.completed` / `async_payment_succeeded` com
  `metadata.type === 'store_checkout'` → `markCheckoutPaid`; `checkout.session.expired` /
  `async_payment_failed` → `expireCheckout`; `account.updated` → atualiza `bc_store_sellers`;
  `charge.dispute.created/closed` → disputa de cartão nos pedidos (perdida: estorno do repasse ou débito da
  loja). Idempotência em `bc_store_stripe_events` com `processed_at` (seção 2.1).

**Configuração obrigatória no Stripe (Developers → Webhooks), antes de abrir as compras.** O Stripe só
entrega os eventos selecionados; o teste ponta a ponta injeta os eventos direto no handler e não cobre isso.
1. Endpoint da **plataforma** → `https://brasilconnectusa.com/api/stripe/webhook`, segredo em
   `STRIPE_WEBHOOK_SECRET`. Eventos da Store (além dos que o AgendaPro e o diretório já usam):
   `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.dispute.created`, `charge.dispute.closed`.
2. Endpoint **Connect** ("Events on connected accounts") na **mesma URL**, com `account.updated`, segredo em
   `STRIPE_CONNECT_WEBHOOK_SECRET`. Obrigatório para a Store: sem ele `stripe_transfers_active` só atualiza
   quando a loja abre o painel.
Redes de segurança se um evento faltar: o `releaseOrder` confere contestação/reembolso na cobrança antes de
cada repasse, o cron aplica contestações sem evento e repara pagamentos interrompidos, e checkout vencido é
conferido no Stripe pelo cron.

## 7. `window.BCStore` (public/js/store.js)

Carregado com `<script src="/js/store.js" defer></script>` em toda página da Store. Expõe:

```
BCStore.ready                 Promise que resolve quando o Supabase carregou e a sessão foi lida
BCStore.user()                usuário logado ou null
BCStore.session()             sessão Supabase ou null
BCStore.onAuth(cb)            chama cb(user) agora e a cada mudança
BCStore.login({ reason })     abre o modal de login (e-mail+senha ou código por e-mail); Promise<user|null>
BCStore.logout()
BCStore.api(path, { method='GET', body, auth=true })
                              fetch na mesma origem; JSON; Bearer se houver sessão; lança Error(d.error)
                              com err.status. 401 em rota 🔒 abre o login.
BCStore.esc(s)                escape HTML
BCStore.safeUrl(u)            só http(s), senão ''
BCStore.money(cents)          "$12.34"
BCStore.fmtDate(iso, opts?)   "12 de out." (pt-BR, America/New_York)
BCStore.stars(avg, count?)    HTML de estrelas
BCStore.toast(msg, kind?)     kind: 'ok' | 'err'
BCStore.states                [{ code:'TX', name:'Texas' }, ...] (50 + DC)
BCStore.labels                { status, condition, origin, fulfillment, dispute_reason } em PT-BR
BCStore.shipTo.get()          { state, zip } salvos (localStorage 'bc_store_shipto')
BCStore.shipTo.set({ state, zip })
BCStore.cart.get()            [{ product_id, qty, slug, title, image, price_cents, seller_id, seller_name }]
BCStore.cart.add(product, qty)   product = Product (catálogo); soma à quantidade
BCStore.cart.set(product_id, qty) (0 remove)
BCStore.cart.remove(product_id)
BCStore.cart.clear()
BCStore.cart.count()          total de unidades
                              (localStorage 'bc_store_cart_v1'; dispara window 'bc-store-cart')
BCStore.uploadImage(file)     comprime (≤1200px, JPEG, abaixo de 480KB) e envia a /api/upload com folder
                              'store'; Promise<url>
BCStore.productCard(p, { showSeller=true })   HTML do card de produto (st-card)
BCStore.isPreview()           ?preview=brasil2026 grava e devolve true (mesma chave do app: bc_preview_mode)
BCStore.config()              Promise<config público> (cache em memória)
```
`store.js` também atualiza sozinho o contador do carrinho (`[data-st-cart-count]`) e o link de conta
(`[data-st-account]`: "Entrar" ou "Minha conta" com menu Meus pedidos / Minha loja / Sair).

Sessão: a mesma do resto do site (Supabase, `localStorage` `sb-ggwppcbdnemjuddnzbdw-auth-token`),
carregando `https://esm.sh/@supabase/supabase-js@2.45.4` com `persistSession`, `autoRefreshToken`,
`detectSessionInUrl` e `storage: localStorage`. Não mudar `storageKey` nem `flowType`.

## 8. Visual

`premium.css` + `store.css` (prefixo `st-`). Tokens: `--paper`, `--paper-elevated`, `--ink`, `--ink-soft`,
`--ink-muted`, `--green-deep`, `--accent`, `--line`, `--r-*`, `--shadow-*`. Sem hex novos, sem dark mode
(o site é só claro). Preço em `--green-deep` com `font-variant-numeric: tabular-nums`. Card de produto com
foto quadrada (`aspect-ratio:1/1; object-fit:cover`). Mobile primeiro: grid de 2 colunas abaixo de 720px,
gutter de 16px, sem rolagem horizontal. Nada de emoji como ícone de interface (SVG inline simples ou texto).

## 9. Nav e footer (copiar igual em todas as páginas)

```html
<body class="has-flag-stripe st-page">
<div class="flag-stripe" aria-hidden="true"></div>
<nav class="bc-nav">
  <a class="bc-logo" href="/">Brasil<em>Connect</em></a>
  <div class="bc-nav-r">
    <a class="bc-nl active" href="/store">Store</a>
    <a class="bc-nl" href="/store/pedidos">Meus pedidos</a>
    <a class="st-nav-cart" href="/store/carrinho" aria-label="Carrinho">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
      <span class="st-nav-count" data-st-cart-count hidden>0</span>
    </a>
    <span class="st-nav-account" data-st-account></span>
    <a class="bc-nl" href="/store/vender">Vender</a>
  </div>
</nav>
```
(`.active` muda conforme a página. "Vender" fica por último porque no celular só o ativo e o último link
`.bc-nl` aparecem; carrinho e conta usam classes próprias e ficam sempre visíveis.)

```html
<footer class="bc-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="bc-logo" href="/">Brasil<em>Connect</em></a>
        <p class="footer-tagline">A Store da comunidade brasileira nos EUA. Cada loja vende, envia e garante os próprios produtos; a BrasilConnect aprova os anúncios e protege o pagamento.</p>
      </div>
      <div><h4>Comprar</h4><a href="/store">Vitrine</a><a href="/store/pedidos">Meus pedidos</a><a href="/store/regras#garantia">Garantia BrasilConnect</a></div>
      <div><h4>Vender</h4><a href="/store/vender">Abrir minha loja</a><a href="/store/painel">Painel da loja</a><a href="/store/regras#proibidos">Produtos proibidos</a></div>
      <div><h4>BrasilConnect</h4><a href="/">Início</a><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a><a href="mailto:oi@brasilconnectusa.com">Contato</a></div>
    </div>
    <div class="footer-bottom">© 2026 BrasilConnect USA · <a href="/store/regras">Regras da Store</a></div>
  </div>
</footer>
```

## 10. Variáveis de ambiente novas

| Variável | Uso |
|---|---|
| `SHIPPO_API_TOKEN` | `shippo_test_...` em teste; `shippo_live_...` em produção |
| `SHIPPO_PLATFORM_MODE` | `1` depois que a Shippo converter a conta em Platform Account |
| `SHIPPO_WEBHOOK_TOKEN` | segredo na URL do webhook da Shippo |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | segredo do endpoint Connect (`account.updated`) na mesma URL do webhook. **Obrigatório para a Store** (seção 6.7) |

Já existentes e usadas: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (endpoint da plataforma, com os
eventos da Store da seção 6.7), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`,
`APP_URL`, `ADMIN_SECRET`/`ADMIN_EMAILS`, `ANTHROPIC_API_KEY`.

## 11. Fora do MVP (próximas fases)

Variações (tamanho/cor), perguntas e respostas públicas no anúncio, cupons, frete calculado em tempo real
no checkout, etiqueta de devolução, termômetro automático de reputação, selo "Loja destaque", importação por
CSV, Stripe Tax coletando de fato, vendedores no Brasil, app nativo.

## 12. Decisões de negócio em aberto

1. Valor e base da comissão (hoje 10% sobre itens + frete, provisório). Abaixo de ~7% a Store perde dinheiro
   em pedido pequeno: o Stripe cobra 2,9% + 30¢ por pagamento, US$ 2 por conta ativa/mês e 0,25% + 25¢ por payout.
2. Sales tax: a BrasilConnect vira marketplace facilitator. No Texas, com presença física, coleta desde a
   primeira venda entregue no TX. Ligar Stripe Tax (`tax_enabled`) depois de registrar os estados. Falar com
   contador de sales tax antes de abrir as compras.
3. Shippo Platform Account (white label): pedir à Shippo antes do primeiro vendedor real.
4. Revisão jurídica do Contrato do Vendedor e das Regras (`/store/regras`).
5. Categorias de alimentos e cosméticos no lançamento ou só depois.
6. 1099-K: com contas Express a plataforma declara (> US$ 20 mil e > 200 transações).
