# WorkPro — visão do produto para o time

O WorkPro é o app de **orçamento e fatura** da BrasilConnect para o autônomo
brasileiro nos EUA que vive de orçamento: construção e reforma, handyman,
marceneiro, pintor, eletricista, encanador, drywall, pisos, telhado,
paisagismo, mudança, tradutor juramentado, contador, fotógrafo. É o segundo app
do mesmo projeto do AgendaPro (`agendapro/`, `APP_VARIANT=workpro`): mesma
conta, mesma assinatura, mesmas APIs e os mesmos planos ($19 / $39 / $79).

Documentos relacionados:
- [`agendapro/README.md`](../agendapro/README.md#dois-apps-agendapro-e-workpro) — rodar cada app, EAS por variante, checklist do WorkPro.
- [`agendapro/CONTRACT.md`](../agendapro/CONTRACT.md) — seção "WorkPro — orçamentos e faturas": formatos fixos das APIs e donos de arquivo.
- [`supabase/ag_app_documents.sql`](../supabase/ag_app_documents.sql) — tabelas, status permitidos e numeração (**aplicado em produção em 10/10/2026**).
- [`api/_lib/docCalc.js`](../api/_lib/docCalc.js) — a conta dos valores (cópia no app em `agendapro/lib/docCalc.js`).
- [`api/_lib/agendaPlans.js`](../api/_lib/agendaPlans.js) — o que cada plano libera (fonte única).
- [`agendapro/store/workpro/`](../agendapro/store/workpro/) — textos das lojas, notas de revisão, privacidade e capturas.
- [`docs/agendapro-app.md`](agendapro-app.md) — arquitetura comum (login, APIs, push, assinatura).

---

## Para quem e por quê

**Quem:** o profissional que não vende horário, vende **serviço orçado**. O dia
dele é visita técnica, orçamento, aprovação, execução e cobrança. Hoje isso vive
em papel, bloco de notas, foto no WhatsApp e planilha; o orçamento sai em
português mal traduzido ou em template genérico, e a cobrança depende de ele
lembrar de cobrar.

**O que ele precisa:**
1. montar um orçamento bonito **em inglês** (cliente americano) na frente do
   cliente, pelo celular, em minutos;
2. o cliente aprovar sem imprimir nada (link + assinatura na tela);
3. transformar o aprovado em fatura sem digitar de novo, com entrada e etapas
   de obra;
4. saber quem deve e cobrar sem constrangimento (lembrete automático);
5. receber no cartão quando quiser, sem perder Zelle e cheque.

**Diferencial:** app em português, documento no idioma do cliente (en/pt/es),
preço único com teste grátis de 14 dias sem cartão, sem comissão do
BrasilConnect sobre o serviço, e a mesma conta da comunidade BrasilConnect
(diretório de negócios, página pública, pedidos de orçamento).

---

## Um projeto, dois apps

| | AgendaPro | WorkPro |
|---|---|---|
| Centro do app | Agenda e agendamento online | Orçamento, fatura e cobrança |
| Abas | Hoje, Agenda, Clientes, Finanças, Mais | Hoje, Agenda, **Vendas**, Clientes, Mais |
| Tipo de negócio (`ag_providers.vertical`) | `services`, `cleaning` | `trades` (e `cleaning`, se escolher House cleaning) |
| Cor | Verde `#1F4D3F` | Azul-marinho `#1B2845` |
| Bundle id | `com.brasilconnect.agendapro` | `com.brasilconnect.workpro` |

Orçamento e fatura **existem nos dois apps** (no AgendaPro ficam em Mais →
Vendas — útil pra faxineira que orça casa nova). O WorkPro muda a ordem das
coisas, o cadastro (especialidades de obra e serviço técnico em
`lib/variant.js`), a marca e a ficha nas lojas. No código:
`import { VARIANT, IS_WORKPRO, BRAND, SPECIALTY_OPTIONS } from '../lib/variant'`.

Cuidado na revisão das lojas: dois apps do mesmo código podem ser lidos como
"app duplicado" (Apple 4.3). O WorkPro precisa parecer e funcionar como outro
produto — veja `agendapro/store/workpro/review-notes.md`.

---

## Recursos por plano

Os recursos do AgendaPro continuam valendo nos dois apps. Os de documentos
(`api/_lib/agendaPlans.js`):

| Plano | Preço | Documentos |
|---|---|---|
| Starter | US$ 19/mês | `quotes` (orçamentos com itens, desconto, sales tax, aprovação com assinatura), `invoices` (fatura em PDF e link, pagamentos manuais), `price_book` (tabela de preços), `quote_requests` (formulário "Pedir orçamento" na página). Limite `documents_month` = **20 documentos criados por mês** |
| Pro | US$ 39/mês | + `invoice_payments` (fatura paga no cartão via Stripe Connect), `payment_reminders` (cobrança automática por e-mail), `progress_billing` (fatura de entrada e por etapas a partir do orçamento), `job_photos` (fotos no documento), documentos **ilimitados** |
| Premium | US$ 79/mês | + `no_branding` também nos documentos (orçamento, fatura e página só com a marca dele) |

- **Teste grátis:** 14 dias com tudo do Premium, sem cartão (cadastro pelo app).
- **Plano inativo:** continua vendo clientes, orçamentos e faturas (GET liberado),
  mas não cria nem envia documento novo. O que a página pública faz com plano
  inativo (aprovar, pagar) fica definido em `api/agenda/doc-public.js`.
- **Servidor decide:** toda rota que cria ou edita usa `requireFeature` /
  `requireLimit` (402 com `code: 'plan_required'` ou `'limit_reached'`); o app só
  desenha o cadeado (`Locked`, `ensureFeature`, `showError`).

Os mesmos recursos aparecem em `public/para/workpro/index.html`,
`agendapro/store/workpro/listing-*.md` e na tela de planos do app. **Mudou a
matriz, muda nesses lugares** (e em `agendapro/lib/demo/plans.js`).

---

## Fluxo: orçamento → aprovação → fatura → pagamento

```
 Pedido de orçamento (página pública, opcional)
          │ convert
          ▼
 ┌──────────────┐  send   ┌──────┐  cliente abre  ┌────────┐  aprova + assina  ┌──────────┐
 │ Orçamento    │───────▶ │ sent │──────────────▶ │ viewed │─────────────────▶ │ accepted │
 │ draft        │         └──────┘   o link       └────────┘                   └────┬─────┘
 └──────────────┘             │                       │ recusa (motivo)            │ convert
                              └── passou da validade ─┴──▶ expired / declined      │ full | deposit | stages
                                                                                    ▼
                                         orçamento → converted          ┌──────────────────────┐
                                                                        │ Fatura(s) draft/sent │
                                                                        └──────────┬───────────┘
                                   pagamento manual (Zelle, dinheiro, cheque...)   │  ou cartão (Stripe, Pro)
                                                                                    ▼
                                         sent → viewed → partial → paid   ·   vencida → overdue   ·   void (anulada)
```

1. **Orçamento** (`kind: 'quote'`): cliente da ficha ou digitado na hora, título
   ("Reforma do banheiro"), endereço da obra, idioma do documento (en/pt/es),
   itens (da tabela de preços ou avulsos: serviço, mão de obra, material, taxa;
   quantidade com unidade — hora, dia, ft², m², página, palavra, visita,
   projeto…), desconto (% ou valor), sales tax (pontos-base: 6,25% = 625) só nos
   itens tributáveis, **entrada** pedida na aprovação (% ou valor), validade,
   condições/garantia, recado e anotação interna. Fotos do trabalho no plano Pro.
2. **Envio** (`action: 'send'`, canal whatsapp | email | sms | link): o servidor
   devolve o link público e a mensagem pronta no idioma do documento. WhatsApp e
   SMS saem do celular do profissional; e-mail sai pelo servidor (Resend).
3. **Visto:** a primeira abertura do link marca `viewed_at` e manda push
   (`notify_documents`).
4. **Aprovação:** o cliente digita o nome e desenha a assinatura na página; o
   servidor grava nome, assinatura (PNG, até ~60 KB), data, IP e navegador.
   Recusa grava o motivo. Os dois mandam push.
5. **Conversão** (`action: 'convert'`): `full` (uma fatura do total), `deposit`
   (fatura da entrada agora, o resto depois) ou `stages` (etapas com % —
   "Entrada (30%)", "Etapa 2 de 3"). `deposit` e `stages` são do plano Pro
   (`progress_billing`). O orçamento vira `converted` e cada fatura guarda
   `quote_id` e `stage_label`.
6. **Fatura** (`kind: 'invoice'`): vencimento (`due_date`), instruções de
   pagamento (Zelle, cheque…), PDF no app e link público.
7. **Pagamento:** manual (`record_payment`: valor, forma, data, nota — vira uma
   linha em `ag_payments` com `type 'invoice'`, `document_id` e `method`) ou
   online pelo link (Pro, Stripe Connect da profissional, `source 'stripe'`). O
   status sai de `invoiceStatus()`: `partial` → `paid`; vencida sem pagar tudo
   → `overdue`. `void` anula sem apagar; rascunho pode ser apagado.

**Numeração:** `ag_next_doc_seq(provider_id, kind)` dá a sequência sem repetir,
por profissional e tipo: `Q-0001`, `INV-0001` (`docNumber()`).

**Conta dos valores:** sempre `computeTotals()` de `docCalc.js` — o desconto
vale pro documento todo e é rateado entre itens tributáveis e não tributáveis
(o imposto incide depois do desconto); entrada e saldo saem do total. **O
servidor recalcula antes de gravar** e nunca confia no total que veio do app.
Ninguém reimplementa essa conta.

**Preferências** (em `ag_providers.app_settings`, tela "Dados da empresa"):
`business` (razão social, licença, endereço, telefone, e-mail, site, seguro),
`doc_defaults` (imposto, prazo de vencimento, validade do orçamento, entrada,
idioma, condições, recado, instruções de pagamento) e `notify_documents`.

---

## Página pública do documento

`https://brasilconnectusa.com/d/<public_token>` → `public/doc.html` (rewrite no
`vercel.json`) → `GET /api/agenda/doc-public?t=`.

- Mostra o documento no idioma dele, com a marca do profissional (logo, nome,
  dados da empresa) e "feito com BrasilConnect" — que some no Premium
  (`no_branding`).
- Ações do cliente: **aprovar** (nome + assinatura), **recusar** (motivo) e,
  na fatura, **pagar no cartão** quando o profissional tem Stripe conectado e o
  recurso `invoice_payments`.
- **Segurança:** o token é longo e aleatório e funciona como senha (quem tem o
  link vê o documento). A resposta pública não traz campos internos (anotação
  interna, linha do tempo, IP, assinatura guardada); a página não deve ser
  indexada. Nenhum dado financeiro do profissional além do documento em si.

---

## Pedidos de orçamento

Formulário "Pedir orçamento" na página pública do profissional
(`public/agenda/profile.html`) → `POST /api/agenda/quote-requests` (público):
nome, telefone, e-mail, endereço, serviço, descrição, data preferida, idioma e
até 3 fotos. Proteções: campo isca `website` (anti-robô), IP guardado só como
hash, limites de tamanho.

No app (tela "Pedidos de orçamento"): lista com contadores, status `new →
contacted → quoted → closed | spam` e **converter** num toque, que cria o
orçamento em rascunho já com o cliente e a descrição (`document_id` liga os dois).
Pedido novo manda push.

---

## Cobrança automática e cron

`/api/cron/agenda-documents`, todo dia às 15:00 UTC (`vercel.json`, protegido
por `CRON_SECRET`):
- fatura vencida e não paga → `overdue`;
- orçamento enviado/visto fora da validade → `expired`;
- **lembrete de pagamento por e-mail** pro cliente (plano Pro,
  `payment_reminders`), registrado em `reminders_sent` / `last_reminder_at` e na
  linha do tempo. O profissional também pode mandar um lembrete na hora
  (`action: 'remind'`).

---

## Notificações (push)

Kind `documents` em `api/_lib/agendaPush.js`, ligado por `notify_documents`
(padrão: ligado): orçamento visto, aprovado ou recusado, fatura paga e pedido de
orçamento novo.

---

## Mapa do código

| Parte | Arquivos |
|---|---|
| Variante e marca | `agendapro/app.config.js`, `agendapro/lib/variant.js`, `agendapro/lib/theme.js` |
| Telas | `app/(tabs)/vendas.js`, `app/document/[id].js`, `app/document/edit.js`, `app/price-book/*`, `app/business.js`, `app/quote-requests.js`, `lib/documents.js` |
| APIs (profissional) | `api/agenda/documents.js`, `api/agenda/catalog.js`, `api/_lib/documents.js` |
| APIs (público) | `api/agenda/doc-public.js`, `api/agenda/quote-requests.js`, `public/doc.html` |
| Pagamento online | `api/agenda/doc-public.js` (`action: 'pay'`) + `api/stripe/webhook.js` |
| Cron | `api/cron/agenda-documents.js` |
| Banco | `supabase/ag_app_documents.sql` |
| Loja e site | `agendapro/assets/workpro/*`, `agendapro/store/workpro/*`, `public/para/workpro/index.html`, `public/privacidade.html` (seção 11) |
| Demonstração | `agendapro/lib/demo/*`, `npm run web:demo -- trial trades 8095 workpro` |

---

## O que falta

**Antes de lançar**
- [ ] Aplicar `supabase/ag_app_documents.sql` (sem ela o cadastro `trades` falha)
      e publicar rotas, `public/doc.html` e o cron.
- [ ] **Marca:** existe a marca de ferramentas WORKPRO nos EUA — advogado de
      marcas antes da loja (ou trocar o nome; lista de onde trocar em
      `store/workpro/review-notes.md`).
- [ ] Projeto `workpro` na Expo, app nas duas lojas, Firebase com o segundo app
      Android, conta de demonstração e capturas (checklist no README).
- [ ] Testar ponta a ponta num aparelho: orçamento → link → aprovação com
      assinatura no Safari e no Chrome → fatura de entrada → pagamento manual →
      pagamento no cartão (Stripe em modo de teste) → lembrete do cron.
- [ ] Exclusão de conta apagando documentos, tabela de preços, pedidos e as
      fotos deles (Storage).
- [ ] `public/excluir-conta.html` citar o WorkPro (hoje fala só do AgendaPro).
- [ ] Ligar a lista de espera da página `/para/workpro/` (fonte `workpro` em
      `bc_waitlist`) ao e-mail de lançamento.

**Decisões em aberto**
- **Taxa do cartão no pagamento online:** o sinal do AgendaPro usa *destination
  charge* sem `application_fee` (`api/agenda/checkout.js`); nesse modelo a taxa
  do Stripe sai do saldo da plataforma, não do profissional. Em fatura de obra
  (valores altos) isso pesa. Decidir: cobrança direta na conta conectada,
  repassar a taxa, ou cobrar uma pequena taxa de plataforma (e então tirar "sem
  comissão" dos textos).
- **Painel web de documentos:** hoje orçamento e fatura só existem no app. Um
  painel no site ajuda quem orça no computador e fortalece o argumento de "app
  companheiro" na revisão da Apple.
- **Sales tax:** hoje é uma taxa digitada por documento. Estados e cidades têm
  regras diferentes (e serviço muitas vezes não é tributável) — ajuda de taxa
  sugerida por estado pode vir depois, sem prometer cálculo fiscal.

**Próximas versões (ideias, por ordem de pedido provável)**
- Recibo de pagamento por e-mail pro cliente ao registrar pagamento.
- Itens opcionais no orçamento (o cliente escolhe na página) e pacotes
  "bom / melhor / ótimo".
- Aditivo de obra (change order) ligado ao orçamento aprovado.
- Assinatura do profissional e contrato com cláusulas padrão por especialidade.
- Lembrete de pagamento por SMS/WhatsApp automático (hoje WhatsApp é manual).
- Exportação de faturas em CSV e integração contábil.
- Retenção (retainage) e medição para obras maiores; equipe com horas por obra.

**O que medir**
- Orçamentos enviados por conta por semana e taxa de aprovação.
- Tempo de envio → aprovação e de fatura → pagamento (dias até receber).
- % de faturas pagas online (adoção do Pro) e uso da cobrança automática.
- Conversão do teste grátis em plano pago no tipo `trades` x `services`.
