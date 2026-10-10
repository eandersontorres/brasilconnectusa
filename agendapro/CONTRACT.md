# AgendaPro app — contrato de construção

Documento interno para quem constrói o app em paralelo. Cada entrega é dona de
arquivos específicos; ninguém edita arquivo de outra entrega. Precisa de algo
num arquivo que não é seu? Escreva em "Pedidos para outras entregas" no seu
relatório final.

Raiz do worktree: `C:\Dev\brasilconnectusa\.claude\worktrees\agendapro-app`
(app em `agendapro/`, backend em `api/`, SQL em `supabase/`, site em `public/`).

## Regras gerais

- **Não** faça commit, push, PR, deploy, nem aplique SQL no Supabase. Não rode `npm install`/`expo install` (os pacotes já estão instalados; lista abaixo). Precisa de pacote novo? Peça no relatório.
- Não suba servidor (`expo start`) — a integração roda o bundle depois.
- Textos da interface em **português do Brasil**, tom direto e acolhedor (a usuária é a profissional brasileira nos EUA: cabeleireira, manicure, faxineira…). Sem jargão técnico na tela.
- JavaScript puro (sem TypeScript). Comentários em português, curtos, no estilo do arquivo vizinho.
- Checagem obrigatória antes de terminar:
  - app: `cd agendapro && node scripts/check.js <seus arquivos>` (sintaxe + imports)
  - API: `node --check api/agenda/<arquivo>.js` e, se possível, importar o módulo: `node --input-type=module -e "await import('./api/agenda/<arquivo>.js')"`

## Plano e recursos (fonte única: `api/_lib/agendaPlans.js`)

Chaves de recurso (`FEATURES`) e plano mínimo:

| Starter $19 | Pro $39 | Premium $79 |
|---|---|---|
| agenda, online_booking, services, hours, clients, email_reminders, push_notifications, whatsapp_templates, calendar_sync, deposit_offline, payments_log, share_qr, turnover_ical | deposit_stripe, reviews, gallery, recurring, reactivation, waitlist, finance, mileage, multilang_messages | team, team_day_link, reports, receipts, no_branding |

Limites (`LIMITS`): `staff` (premium 10), `ical_feeds` (starter 3, pro 15, premium ilimitado), `recurring` (pro+ ilimitado).

Teste grátis de 14 dias (sem cartão) = tudo do Premium. Plano inativo (`tier: 'none'`) = só leitura.

**Servidor** (toda rota nova que cria/edita algo pago):
```js
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature, requireLimit, hasFeature } from '../_lib/agendaPlans.js'
const auth = await requireProviderAuth(req, supabase)
if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
const gate = requireFeature(auth.provider, 'finance')
if (!gate.ok) return res.status(gate.status).json(gate.body)
```
Leitura (GET) dos próprios dados pode ficar liberada mesmo sem plano — a profissional não perde acesso ao histórico.

**App**:
```js
import { useApp } from '../lib/session'          // can(key), limit(key), ent, provider, settings, saveSettings, refresh, setProvider
import Locked from '../components/Locked'          // <Locked feature="finance">…</Locked> (tela inteira)
import { ensureFeature, showError } from '../lib/gate'  // antes de ação / no catch de chamada à API
```

## Convenções de backend (`api/`)

- Padrão Vercel Functions ESM igual a `api/agenda/hours.js`: `OPTIONS → 200`, método errado → 405, `try/catch` → 500 `{ error }`, `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })`.
- Uma rota por domínio com `action` no corpo (modelo: `api/agenda/ical.js`). Respostas JSON com nomes em inglês (`{ clients: [...] }`), mensagens de erro em português.
- Sempre filtre por `provider_id = auth.provider.id` (nunca confie em provider_id vindo do corpo).
- `res.setHeader('Cache-Control', 'private, no-store')` em GET autenticado.
- Corte e valide toda entrada (`String(x).slice(0, N)`, números com limites, enum com lista).

## Convenções de SQL (`supabase/`)

- Um arquivo por entrega: `supabase/ag_app_<entrega>.sql`. Cabeçalho igual a `supabase/ag_turnover_ical.sql`, com a linha `NAO APLICADO ainda`.
- Idempotente (`IF NOT EXISTS`, `DO $$ … $$` pra constraint). Tabela nova: `uuid_generate_v4()`, `provider_id ... REFERENCES ag_providers(id) ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated` (só a service key acessa, pelas APIs).
- Ordem de aplicação: `ag_app_base.sql` → `ag_app_team.sql` → demais.
- Hoje as tabelas `ag_*` estão vazias em produção (sem profissionais): pode mudar schema sem migrar dados.

## Regra de horário (crítica)

`ag_appointments.scheduled_for` guarda a **hora do relógio da profissional sem fuso, gravada como UTC**. "Terça 10:00" → `'2026-10-13T10:00:00.000Z'`.
- Mostrar: helpers de `agendapro/lib/format.js` (`fmtTime`, `fmtDay`, `fmtWhen`, `hhmmOf`, `keyOf`) — usam getters UTC.
- Gravar: `toWallIso('2026-10-13', '10:00')`.
- Hoje: `todayKey()` (data local do celular). Faixa do dia na API: `dayRange(key)`.
- No servidor: compare pela data UTC (`String(iso).slice(0,10)`), como `api/agenda/reminders.js`.

## Convenções do app (`agendapro/`)

- Expo SDK 54 + expo-router 6, React 19, RN 0.81. Rotas = arquivos em `app/`. Cada tela define o título com `<Stack.Screen options={{ title: '…' }} />` (abas usam o título do `_layout`).
- UI só com `components/ui.js` (Screen, Card, Row, Button, Input, Badge, StatusBadge, KPI, Empty, Loading, ErrorBox, Segmented, Chip, ToggleRow, Avatar, Fab, IconButton, Banner, H1…Muted, Label, Section, Divider) e `components/pickers.js` (DateField, TimeField). Cores/espaços de `lib/theme.js`. Ícones: `Ionicons` de `@expo/vector-icons`.
- Dados: `api(path)`, `post(path, body)`, `del(path)` de `lib/api.js` (já mandam o JWT). Erros → `showError(e)`.
- Diálogos: `notify`, `confirm`, `choose` de `lib/dialog.js` (funcionam no celular e no preview web). Nunca use `Alert` direto.
- Dinheiro em centavos: `fmtMoney`, `parseMoney`, `centsToInput`. Telefone: `fmtPhone`, `phoneDigits`.
- WhatsApp: `openWhatsApp(phone, text)`, `renderTemplate(key, lang, vars, settings)` de `lib/whatsapp.js` (modelos PT/EN/ES). Idioma ≠ pt exige `can('multilang_messages')`.
- Navegação: `router.push('/client/123')`, `router.push({ pathname: '/appointment/new', params: { client_id } })`.
- Telas com lista: "puxar pra atualizar" (`<Screen onRefresh refreshing>`), estado vazio com `<Empty>` e ação, carregando com `<Loading>`.
- Sem `localStorage`; persistência local com `@react-native-async-storage/async-storage`.
- Código que só existe no celular (notificações, calendário, Face ID, câmera): proteja com `Platform.OS !== 'web'` pra não quebrar o preview web.

Pacotes instalados: expo-router, expo-image-manipulator, expo-notifications, expo-device, expo-calendar, expo-local-authentication, expo-image-picker, expo-sharing, expo-file-system, expo-print, expo-clipboard, expo-haptics, expo-web-browser, expo-secure-store, expo-linking, expo-constants, expo-system-ui, react-native-svg, react-native-qrcode-svg, @react-native-community/datetimepicker, @react-native-async-storage/async-storage, @supabase/supabase-js, @expo/vector-icons, react-native-safe-area-context, react-native-screens.

## Rotas e donos

| Entrega | Arquivos do app | Backend / SQL / site |
|---|---|---|
| **fundação** (pronta) | `app/_layout.js`, `app/index.js`, `app/(auth)/*`, `app/onboarding.js`, `app/(tabs)/_layout.js`, `app/(tabs)/mais.js`, `lib/{config,supabase,api,session,theme,format,dialog,gate,whatsapp}.js`, `components/{ui,pickers,Locked,PlanBanner}.js`, `scripts/check.js` | `api/_lib/agendaPlans.js`, `api/_lib/providerAuth.js`, `supabase/ag_app_base.sql` |
| **agenda** | `app/(tabs)/hoje.js`, `app/(tabs)/agenda.js`, `app/appointment/[id].js`, `app/appointment/new.js` | `api/agenda/appointments.js` |
| **clientes** | `app/(tabs)/clientes.js`, `app/client/[id].js`, `app/client/edit.js`, `app/waitlist.js`, `app/reactivation.js`, `app/templates.js`; pode **acrescentar** exports em `lib/whatsapp.js` sem mudar os existentes | `api/agenda/clients.js`, `api/agenda/waitlist.js`, `supabase/ag_app_clients.sql` |
| **configuração** | `app/services/index.js`, `app/services/edit.js`, `app/hours.js`, `app/blocked.js`, `app/deposit.js`, `app/turnover/index.js`, `app/turnover/edit.js` | `api/agenda/services.js`, `api/agenda/hours.js`, `api/agenda/blocked.js` (nova), `api/agenda/ical.js`, `api/agenda/connect.js`, `api/agenda/availability.js`, `supabase/ag_app_setup.sql` |
| **perfil** | `app/profile.js`, `app/share.js`, `app/reviews.js` | `api/agenda/provider.js`, `api/agenda/reviews.js` (nova), `api/agenda/request-review.js`, `public/agenda/profile.html`, `public/agenda/review.html` |
| **finanças** | `app/(tabs)/financas.js`, `app/finance/*`, `app/receipt/[id].js`, `lib/receipt.js` | `api/agenda/finance.js` (nova), `supabase/ag_app_finance.sql` |
| **equipe** | `app/team.js`, `app/team-edit.js`, `app/recurring/index.js`, `app/recurring/edit.js` | `api/agenda/staff.js`, `api/agenda/recurring.js`, `api/agenda/team-day.js`, `api/_lib/recurring.js`, `api/cron/agenda-recurring.js`, `public/agenda/equipe.html`, `vercel.json`, `supabase/ag_app_team.sql` |
| **conta** | `app/plans.js`, `app/settings.js`, `components/BiometricGate.js`, `components/PushManager.js`, `lib/push.js`, `lib/calendar.js`, `lib/biometric.js` | `api/agenda/me.js`, `api/agenda/push-token.js` (nova), `api/_lib/agendaPush.js` (nova), `api/agenda/book.js`, `api/agenda/review.js`, `api/agenda/reminders.js`, `api/stripe/subscribe.js`, `api/stripe/webhook.js`, `api/stripe/portal.js`, `public/agenda/planos.html`, `supabase/ag_app_push.sql` |
| **loja** | `assets/*`, `README.md`, `eas.json`, `store/*` | `public/para/agenda-pro/index.html`, `docs/agendapro-app.md` |

## Contratos entre entregas

Colunas novas em `ag_appointments` (cada uma criada pela entrega indicada, mas
qualquer rota pode ler/gravar depois de aplicadas):
- **agenda** (`supabase/ag_app_agenda.sql`, dono adicional da entrega agenda): `source text` ('online'|'manual'|'recurring'|'ical'), `paid_cents int`, `tip_cents int`, `paid_method text`, `paid_at timestamptz`, `internal_notes text`.
- **equipe** (`ag_app_team.sql`): `staff_id uuid → ag_staff`, `recurring_id uuid → ag_recurring`.

`api/agenda/appointments.js` (agenda) aceita/devolve `staff_id` e `recurring_id`; mostra `staff_name`/`staff_color` (join em `ag_staff`) — a entrega agenda escreve o join pressupondo a tabela da entrega equipe.

Telas que outras entregas abrem (parâmetros fixos):
- `/appointment/new?client_id=&date=YYYY-MM-DD&time=HH:MM&service_id=&staff_id=` — novo agendamento pré-preenchido.
- `/appointment/[id]` — detalhe. Tem botões: WhatsApp (modelos), pagar, recibo (`/receipt/[id]`), pedir avaliação, adicionar ao calendário (`addToCalendar` de `lib/calendar.js`).
- `/client/[id]` — ficha. `/client/edit?id=` (vazio = nova).
- `/services/edit?id=` · `/turnover/edit?id=` · `/recurring/edit?id=&client_id=` · `/team-edit?id=` · `/finance/expense-edit?id=`
- `/plans?feature=<chave>` — tela de planos destacando o recurso.

APIs que o app chama (donos acima):
- `GET /api/agenda/me` · `POST /api/agenda/me { action: 'settings'|'vertical'|'delete_account' }`
- `GET /api/agenda/appointments?scope=upcoming|past|range&from=ISO&to=ISO&staff_id=` · `POST { action: 'create'|'update'|'reschedule'|'confirm'|'confirm_deposit'|'complete'|'no_show'|'cancel'|'mark_paid', ... }`
- `GET /api/agenda/clients?q=&filter=all|inactive|birthday` · `GET ?id=` (com histórico) · `POST { action: 'create'|'update'|'delete', ... }`
- `GET /api/agenda/waitlist` · `POST { action: 'create'|'update'|'delete'|'match', ... }`
- `GET/POST/DELETE /api/agenda/services` · `GET/POST /api/agenda/hours` · `GET/POST /api/agenda/blocked` · `GET/POST /api/agenda/ical` · `GET/POST /api/agenda/connect`
- `GET/POST /api/agenda/provider` · `GET/POST /api/agenda/reviews` · `POST /api/agenda/request-review`
- `GET /api/agenda/finance?view=summary|expenses|mileage|report&month=YYYY-MM` · `POST { action: ... }` · `GET ?view=export&month=&format=csv`
- `GET/POST /api/agenda/staff` · `GET/POST /api/agenda/recurring` · `GET /api/agenda/team-day?t=TOKEN&date=` (público)
- `POST /api/agenda/push-token` · `POST /api/stripe/subscribe` · `POST /api/stripe/portal` · `POST /api/upload`

## Formatos de resposta (pra quem consome a API de outra entrega)

- **Agendamento** (`GET /api/agenda/appointments` → `{ appointments: [...] }`; `?id=` → `{ appointment, client }`):
  `id, scheduled_for, duration_min, status, client_id, client_name, client_whatsapp, client_email, client_notes, service_id, service_name, service_label, total_cents, deposit_cents, deposit_paid, payment_method, paid_cents, tip_cents, paid_method, paid_at, internal_notes, source, staff_id, staff_name, staff_color, recurring_id, review_requested, external_uid, feed_label, feed_source, feed_notes, ical_next_checkin, created_at, cancel_reason`.
  `client` no detalhe: `{ id, name, whatsapp, email, language, home_notes, address_line, city, state, zip }`.
- **Cliente** (`GET /api/agenda/clients` → `{ clients: [...] }`):
  `id, name, whatsapp, email, language ('pt'|'en'|'es'), birthday_md ('MM-DD'), tags[], address_line, city, state, zip, home_notes, notes, total_visits, total_spent_cents, first_visit_at, last_visit_at, archived`.
  `?id=` → `{ client, appointments: [...últimos 50], stats: { visits, spent_cents, avg_ticket_cents, no_shows, cancellations, next_appointment } }`.
- **Serviço** (`GET /api/agenda/services?mine=1` → `{ services: [...] }`): `id, name, category, description, duration_min, price_cents, deposit_cents, active, display_order`.
- **Equipe** (`GET /api/agenda/staff` → `{ staff: [...] }`): `id, name, color, whatsapp, email, role, members, active, display_order, day_link_url`. Sem plano Premium a rota responde 402 com `code: 'plan_required'` — trate como "sem equipe".
- **Perfil**: `POST /api/agenda/provider` é **atualização parcial** (só as chaves enviadas mudam). Ex.: `post('/api/agenda/provider', { deposit_instructions })`. Devolve `{ ok, provider }`.
- Imagens: `expo-image-manipulator` (redimensionar pra ~1200px, JPEG 0.7, `base64: true`) → `post('/api/upload', { file_data: 'data:image/jpeg;base64,...', folder: 'providers' })` → `{ url }`. Limite do servidor: 500 KB.


---

# WorkPro — orçamentos e faturas (rodada 2)

Um projeto, dois apps nas lojas: `APP_VARIANT=agendapro` (padrão) ou `workpro` (app.config.js).
No código: `import { VARIANT, IS_WORKPRO, BRAND, SPECIALTY_OPTIONS } from '../lib/variant'`.
`colors.green` agora é a cor principal da variante (verde no AgendaPro, azul-marinho `#1B2845`
no WorkPro); em código novo prefira `colors.primary` / `primarySoft` / `primaryDark`.
Abas: AgendaPro = hoje, agenda, clientes, financas, mais. WorkPro = hoje, agenda, **vendas**,
clientes, mais (Finanças vai pro Mais). Aba fora da lista fica escondida (`href: null`), mas
a rota continua navegável: o AgendaPro abre `/vendas` pelo menu Mais.
Tipo de negócio novo: `vertical = 'trades'` (obra, reparo, serviço técnico, tradutor...).
Mesma conta e mesma assinatura nos dois apps.

## Recursos novos na matriz (`api/_lib/agendaPlans.js`)

| Starter | Pro | Premium |
|---|---|---|
| quotes, invoices, price_book, quote_requests (limite `documents_month` = 20 documentos criados por mês) | invoice_payments (fatura paga no cartão via Stripe Connect), payment_reminders (cobrança automática por e-mail), progress_billing (fatura de entrada/etapas a partir do orçamento), job_photos (fotos no documento), documentos ilimitados | no_branding também nos documentos |

## Banco (`supabase/ag_app_documents.sql`, aplicado em produção em 10/10/2026)

`ag_catalog_items`, `ag_documents` (quote e invoice), `ag_document_items`, `ag_document_events`,
`ag_quote_requests`, `ag_doc_counters` + função `ag_next_doc_seq(provider_id, kind)` (número
sem repetição), `ag_payments.document_id` e `ag_payments.method` (pagamento de fatura = linha com
`type 'invoice'`), índice único `ag_payments_stripe_session_uniq` (`stripe_session_id`, o webhook trata
o 23505 como evento repetido) e `idx_quote_requests_iphash` (anti-abuso do formulário público).
Leia o arquivo inteiro: colunas, CHECKs e status permitidos estão lá.

Status: orçamento `draft → sent → viewed → accepted | declined | expired → converted`;
fatura `draft → sent → viewed → partial → paid`, `overdue` (vencida), `void` (anulada).

## Conta dos valores (`api/_lib/docCalc.js`, cópia no app em `lib/docCalc.js`)

`computeTotals({ items, discount_pct, discount_cents, tax_rate_bps, deposit_pct, deposit_cents,
amount_paid_cents })` → `{ lines, subtotal_cents, discount_cents, taxable_cents, tax_cents,
total_cents, deposit_cents, balance_cents }`; `docNumber(kind, seq)` → `Q-0007` / `INV-0042`;
`invoiceStatus(doc, todayKey)`; `cleanQty`, `cleanPct`, `UNITS`, `ITEM_KINDS`.
**O servidor sempre recalcula** com essa função antes de gravar (nunca confia no total do app).

## Preferências (em `ag_providers.app_settings`, via `saveSettings` / POST /api/agenda/me)

- `business`: `{ legal_name, license_no, address_line, city, state, zip, phone, email, website, insurance }`
- `doc_defaults`: `{ tax_rate_bps, due_days, quote_valid_days, deposit_pct, language, terms, notes, payment_instructions }`
- `notify_documents` (bool): push de orçamento visto/aprovado/recusado, fatura paga, pedido de orçamento novo.
- `quote_requests_public` (bool): formulário "Pedir orçamento" na página pública. Sem a preferência,
  liga sozinho pra `vertical = 'trades'`; sempre exige o recurso `quote_requests` (regra única:
  `quoteFormEnabled` de `api/agenda/quote-requests.js`).

## APIs (formatos fixos — quem consome confia nisso)

**`/api/agenda/documents`** (JWT)
- `GET ?kind=quote|invoice&status=all|open|draft|sent|viewed|accepted|declined|expired|converted|partial|paid|overdue|void&q=&client_id=` →
  `{ documents: [Doc], summary: { open_quotes_cents, open_quotes_count, awaiting_cents, overdue_cents, overdue_count, paid_month_cents, acceptance_rate } }`
  - `status=open` = aguardando a cliente: orçamento `sent`/`viewed` e fatura `sent`/`viewed`/`partial`/`overdue` (rascunho nunca entra).
  - O status sai efetivo (fatura vencida → `overdue`, orçamento vencido → `expired`) mesmo antes do cron gravar.
  - `acceptance_rate` = fração de **0 a 1** (aceitos ÷ aceitos + recusados + expirados, orçamentos dos últimos 180 dias) ou `null` sem dado. O app multiplica por 100 pra mostrar.
- `GET ?id=` → `{ document: Doc, items: [Item], payments: [Payment], events: [Event] }`
- `POST { action, ... }`:
  `create` (kind, client_id **ou** client {name,email,phone,address}, title, job_address, language, issue_date, due_date | valid_until, items[], discount_pct | discount_cents, tax_rate_bps, deposit_pct | deposit_cents, notes, terms, payment_instructions, internal_notes, photos[], appointment_id?, quote_request_id?) ·
  `update` (id + mesmos campos; items substitui a lista) · `duplicate` (id) ·
  `send` (id, channel whatsapp|email|sms|link) → `{ document, public_url, message, email_sent, email_error? }` (message = texto pronto no idioma do documento; `email_error` = frase pra mostrar quando o e-mail não saiu) ·
  `mark_sent` · `mark_accepted` · `decline` (id, reason) ·
  `convert` (id do orçamento, mode full|deposit|stages, stages?: [{ label, pct }]) → `{ invoices: [Doc], quote: Doc }` (quote = o orçamento já `converted`) ·
  `record_payment` (id, amount_cents, method, paid_on 'YYYY-MM-DD', note) — aceita valor acima do saldo (o app confirma antes), até **2× o total** · `remove_payment` (id, payment_id) ·
  `remind` (id, channel?) → mesmo formato do `send`; vale pra fatura com saldo **e** pra orçamento `sent`/`viewed` · `void` (id) · `delete` (id, só rascunho)
- **Edição travada** → `409 { error, code: 'locked' }`: orçamento `converted` não muda nada; orçamento `accepted` e fatura `paid`/`void` só mudam `internal_notes` e `photos` (itens, valores, cliente, datas e textos ficam como estão — duplique pra refazer).
- **Doc**: `id, kind, number, status, client_id, client_name, client_email, client_phone, client_address, title, job_address, language, issue_date, due_date, valid_until, subtotal_cents, discount_pct, discount_cents, tax_rate_bps, tax_cents, total_cents, deposit_pct, deposit_cents, amount_paid_cents, balance_cents, notes, terms, payment_instructions, internal_notes, photos, stage_label, quote_id, appointment_id, quote_request_id, sent_at, viewed_at, accepted_at, accepted_name, accepted_signature (só no ?id), declined_at, decline_reason, paid_at, voided_at, reminders_sent, created_at, updated_at, public_url`
- **Item**: `id, position, catalog_item_id, kind, description, quantity, unit, unit_price_cents, taxable, line_total_cents`
- **Payment**: `id, amount_cents, method, paid_at, note, source ('manual'|'stripe')` · **Event**: `id, type, channel, detail, created_at`

**`/api/agenda/catalog`** (JWT) — `GET` → `{ items: [CatalogItem] }` · `POST { action: create|update|delete|reorder|seed, ... }` (`seed { specialty }` cria itens de exemplo da especialidade).
CatalogItem: `id, name, description, kind, unit, unit_price_cents, taxable, active, display_order`.

**`/api/agenda/quote-requests`** — `POST` público `{ slug, name, phone, email, address, service, description, preferred_date, language, photos: [data URL, até 3], website (isca anti-robô) }`;
com JWT: `GET` → `{ requests: [Req], counts }` · `POST { action: update_status|convert, id, status? }` (`convert` cria orçamento rascunho e devolve `{ document }`).
Req: `id, name, phone, email, address, service, description, photos, preferred_date, language, status, client_id, document_id, created_at`.

**`/api/agenda/doc-public`** (público, pelo token) — `GET ?t=` → `{ document (sem campos internos), items, provider: { name, slug, avatar_url, cover_color, business, show_branding }, can_pay_online }` (marca visto na primeira abertura) ·
`POST { t, action: accept, name, signature }` · `{ t, action: decline, reason }` · `{ t, action: pay }` → `{ checkout_url }`.

Link da cliente: `https://brasilconnectusa.com/d/<public_token>` (rewrite `/d/:token` → `/doc.html`, já no vercel.json).
`public_url?preview=1` = a profissional conferindo pelo app: **não** marca visto e a página desliga as ações (aprovar, recusar, pagar).

**`GET /api/agenda/provider?slug=`** (página pública) também devolve `provider.vertical` ('services'|'cleaning'|'trades')
e `provider.quote_requests_enabled` (bool, regra `quoteFormEnabled`); `app_settings` nunca sai cru.

**E-mail do documento** (`sendDocEmail` → `sendTransactional` de `api/_lib/mailer.js`): reply-to = e-mail da
profissional (`business.email`, senão o do perfil), shell/rodapé no idioma do documento, From
`"<empresa> via BrasilConnect" <oi@brasilconnectusa.com>` e, com `no_branding` (Premium), sem a marca BrasilConnect
(From só com o nome da empresa, topo com o nome dela, sem rodapé da marca). Opções do mailer: `replyTo`, `lang`,
`fromName`, `hideBrand` — sem elas, os outros e-mails do site saem iguais.

**Finanças** (`api/agenda/finance.js`): atendimento com fatura ligada (`appointment_id`, fatura fora de
`draft`/`void`) não soma o próprio valor na receita (entra pelo pagamento da fatura) — resumo, ano, relatório
e CSV. Continua contando como realizado (fora do ticket médio e de previsto/sem marcar); a gorjeta dele conta.
Campo novo `invoiced_appointments` (resumo e `report.totals`); CSV de agendamentos ganha a coluna Fatura/Invoice.
Cron: `/api/cron/agenda-documents` diário 15:00 UTC (já no vercel.json): fatura vencida → overdue; orçamento vencido → expired; lembrete automático (Pro).

## Donos de arquivo (rodada 2)

| Entrega | Arquivos |
|---|---|
| **fundação** (pronta) | `app.config.js`, `lib/variant.js`, `lib/theme.js`, `lib/docCalc.js` (cópia), `app/(tabs)/_layout.js`, `app/onboarding.js`, `app/(auth)/login.js`, `api/_lib/agendaPlans.js`, `api/_lib/docCalc.js`, `supabase/ag_app_documents.sql`, `vercel.json` |
| **docs-api** | `api/agenda/documents.js`, `api/agenda/catalog.js`, `api/_lib/documents.js`, `api/cron/agenda-documents.js`, `api/agenda/finance.js` (receita de fatura), `api/agenda/me.js` (só a lista do delete_account) |
| **docs-public** | `public/doc.html`, `api/agenda/doc-public.js`, `api/agenda/quote-requests.js`, `api/stripe/webhook.js` (pagamento de fatura), `api/_lib/agendaPush.js` (kind 'documents'), `public/agenda/profile.html` (formulário "Pedir orçamento") |
| **docs-app** | `app/(tabs)/vendas.js`, `app/document/[id].js`, `app/document/edit.js`, `app/price-book/*`, `app/business.js`, `app/quote-requests.js`, `lib/documents.js` (novo); integração mínima em `app/(tabs)/mais.js`, `app/(tabs)/hoje.js`, `app/client/[id].js`, `app/appointment/[id].js` |
| **demo** | `lib/demo/*`, `scripts/demo-web.js` |
| **loja-workpro** | `assets/workpro/*`, `scripts/make-icons.py`, `eas.json`, `store/workpro/*`, `README.md` (seção dos dois apps), `docs/workpro.md`, `public/para/workpro/index.html`, `public/para/index.html`, `public/privacidade.html` |

## WorkPro — decisões da rodada de correções (10/10/2026)

- `POST /api/agenda/documents { action: 'rotate_link', id }` → `{ document }` com link novo; o antigo para de funcionar (liberado sem plano: é proteção).
- E-mail de documento (send/remind/cron) tem teto: 20/24h por profissional no teste grátis ou sem plano pago ativo, 100/24h com plano pago; 3 envios por e-mail por documento em 24h; 1 lembrete manual por documento em 24h. Passou do teto → `429 { code: 'email_limit' }`. O From só esconde "via BrasilConnect" com Premium **pago** (`emailHidesBrand`), nunca no teste grátis.
- Fatura em rascunho ganha as datas no primeiro envio (`issue_date` = hoje no fuso dela, `due_date` = hoje + prazo). Faturas de etapa/entrada nascem rascunho. O cron só cobra fatura com `sent_at`. Vencimento padrão sem `doc_defaults.due_days` = **14 dias**.
- Fatura ligada a atendimento: o que o atendimento já recebeu entra na fatura como pagamento (`metadata.source 'appointment'`, aparece como "Já pago"). O editor do app preenche o valor cheio. Em Finanças, atendimento faturado conta só o que recebeu além da fatura.
- Pagamento online: a sessão do Checkout fica em `ag_documents.stripe_checkout_session_id`/`stripe_checkout_expires_at`; é reaproveitada se o valor não mudou e encerrada ao anular, apagar, registrar pagamento por fora ou mudar o total. Webhook marca excesso (fatura anulada/paga ou valor acima do saldo) e avisa a profissional. Reembolso (`charge.refunded`) marca o `ag_payments` como `refunded` e a fatura recalcula (só `status 'paid'` conta).
- Aceite com valor de prova: `POST doc-public { action:'accept', name, signature, consent: true, version }` (`version` = `document.updated_at` carregado; mudou → `409 code 'changed'`). Grava `signed_snapshot` (documento + itens + totais + empresa), `signed_hash` (SHA-256 do snapshot), `consent_at`, `consent_text_version 'esign-v1'`; manda cópia por e-mail à cliente e push à profissional. Doc ganha `signed_hash` e `consent_at`.
- Pedido de orçamento público não cria ficha de cliente: a ficha nasce ao converter.
- `ag_push_tokens.app` ('agendapro'|'workpro'): o app manda `app: VARIANT` no registro; o envio agrupa por app.
- Finanças: export `kind=invoice_payments` (pagamentos pela data em que entraram) e `kind=invoices`.
- Banco: tudo isso está em `supabase/ag_app_documents.sql` (aplicado em produção em 10/10/2026), inclusive as colunas de assinatura/checkout e `ag_push_tokens.app`.
