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
