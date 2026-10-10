# App AgendaPro — visão geral para o time

O AgendaPro é a ferramenta de agenda da BrasilConnect para a profissional
brasileira nos EUA (cabeleireira, manicure, esteticista, faxineira, personal…).
Até agora ela usava a página pública (`/agenda/<slug>`) e o painel web. O app
(`agendapro/`, Expo) é a **versão completa** no celular: tudo que o site faz e
mais o que só o celular faz bem (notificação na hora, WhatsApp em um toque,
calendário do aparelho, Face ID, câmera).

Documentos relacionados:
- [`agendapro/README.md`](../agendapro/README.md) — rodar, build, publicação, checklist.
- [`agendapro/CONTRACT.md`](../agendapro/CONTRACT.md) — regras de código, donos de arquivo, formatos de resposta.
- [`agendapro/store/`](../agendapro/store/) — textos das lojas, notas de revisão, privacidade, capturas.
- [`api/_lib/agendaPlans.js`](../api/_lib/agendaPlans.js) — o que cada plano libera (fonte única).

---

## Arquitetura

```
 ┌──────────────────────┐   login (e-mail+senha / código)   ┌────────────────────┐
 │  App AgendaPro       │ ────────────────────────────────▶ │  Supabase Auth     │
 │  Expo SDK 54         │ ◀──────────── JWT ─────────────── │  (mesma conta do   │
 │  expo-router         │                                   │   site)            │
 └─────────┬────────────┘                                   └────────────────────┘
           │ fetch com "Authorization: Bearer <JWT>"
           ▼
 ┌──────────────────────┐  service key   ┌──────────────────────────────────────┐
 │  APIs do site        │ ─────────────▶ │  Supabase Postgres                   │
 │  Vercel Functions    │                │  ag_providers, ag_appointments,      │
 │  /api/agenda/*       │                │  ag_clients, ag_services, ag_staff,  │
 │  /api/stripe/*       │                │  ag_recurring, ag_expenses, ...      │
 │  /api/upload         │                │  (RLS ligado, sem acesso anon)       │
 └──┬──────────┬────────┘                └──────────────────────────────────────┘
    │          │
    │          └── push ──▶ Expo Push API ──▶ APNs (iPhone) / FCM (Android) ──▶ celular
    │
    └── checkout / portal ──▶ Stripe (no navegador) ──▶ webhook ──▶ ag_providers.plan
```

Decisões que valem para tudo:

- **Mesmas APIs do site.** O app não fala direto com as tabelas: chama
  `/api/agenda/*` com o JWT. A rota descobre a profissional pelo token
  (`requireProviderAuth`) e filtra tudo por `provider_id` — nunca confia em id
  vindo do corpo. Tabelas novas têm RLS ligado e `REVOKE ALL` de `anon` e
  `authenticated`: só a service key (nas APIs) acessa.
- **Uma rota por domínio**, com `action` no corpo do POST (modelo:
  `api/agenda/ical.js`). Ajuda a caber no limite de funções da Vercel.
- **Plano decidido no servidor.** O app só desenha cadeados; quem bloqueia de
  verdade é `requireFeature` / `requireLimit` na rota (resposta 402).
- **Regra de horário:** `ag_appointments.scheduled_for` guarda a hora do relógio
  da profissional, sem fuso, gravada como UTC ("terça 10:00" →
  `2026-10-13T10:00:00.000Z`). No app use os helpers de `lib/format.js`; no
  servidor compare pela data UTC. Quem esquece isso mostra horário errado.
- **Cache do `/me`:** o app guarda o último `GET /api/agenda/me` no aparelho, então
  abre rápido e mostra o plano mesmo com internet ruim.
- **Expo sem pastas nativas no git** (`android/` e `ios/` são geradas no build).
  Toda configuração nativa (permissões, plugins, ícones) fica em
  `agendapro/app.config.js`.

---

## Recursos por plano

| Plano | Preço | Libera |
|---|---|---|
| Starter | US$ 19/mês | `agenda`, `online_booking`, `services`, `hours`, `clients`, `email_reminders`, `push_notifications`, `whatsapp_templates`, `calendar_sync`, `deposit_offline`, `payments_log`, `share_qr`, `turnover_ical` (3 casas) |
| Pro | US$ 39/mês | + `deposit_stripe`, `reviews`, `gallery`, `recurring`, `reactivation`, `waitlist`, `finance`, `mileage`, `multilang_messages` (turnover 15 casas) |
| Premium | US$ 79/mês | + `team` (até 10), `team_day_link`, `reports`, `receipts`, `no_branding` (turnover ilimitado) |

Cada chave tem `label` e `desc` em `agendaPlans.js`; esses textos aparecem no app
(cadeado e tela de planos), então escreva pensando na profissional.

Os mesmos preços e recursos aparecem em `public/agenda/planos.html`,
`public/para/agenda-pro/index.html` e `agendapro/store/listing-*.md`. **Mudou a
matriz, muda nos quatro lugares.**

---

## Como adicionar um recurso novo (com cadeado)

Exemplo: "pacotes de sessões" no plano Pro.

1. **Matriz** — em `api/_lib/agendaPlans.js`, acrescente em `FEATURES`:
   ```js
   packages: { min: 'pro', label: 'Pacotes de sessões', desc: 'Venda 5 ou 10 sessões com desconto e acompanhe o saldo da cliente' },
   ```
   Se tiver limite numérico, acrescente a chave em `LIMITS` para cada plano
   (`null` = ilimitado).
2. **Banco** — se precisar de tabela, crie `supabase/ag_app_<nome>.sql`
   (idempotente, `provider_id ... REFERENCES ag_providers(id) ON DELETE CASCADE`,
   RLS + `REVOKE ALL`, cabeçalho com `NAO APLICADO ainda`). Acrescente a tabela
   na lista de exclusão de conta (`DELETE_ORDER` em `api/agenda/me.js`); se
   guardar fotos numa pasta nova do Storage, acrescente a pasta em
   `AGENDA_UPLOAD_FOLDERS` no mesmo arquivo, e atualize a seção 11 de
   `public/privacidade.html` e a `public/excluir-conta.html`.
3. **Rota** — `api/agenda/packages.js`, no padrão de `api/agenda/hours.js`:
   ```js
   const auth = await requireProviderAuth(req, supabase)
   if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
   if (req.method === 'POST') {
     const gate = requireFeature(auth.provider, 'packages')
     if (!gate.ok) return res.status(gate.status).json(gate.body)
     // limite: const lim = requireLimit(auth.provider, 'packages', jaTem)
   }
   // GET dos próprios dados fica liberado: ela não perde o histórico se o plano cair
   ```
   Sempre `.eq('provider_id', auth.provider.id)`, corte e valide toda entrada,
   `Cache-Control: private, no-store` no GET.
4. **Tela** — `agendapro/app/packages.js`:
   ```js
   import Locked from '../components/Locked'
   import { ensureFeature, showError } from '../lib/gate'
   export default function Packages() {
     return <Locked feature="packages">{/* tela */}</Locked>
   }
   // antes de uma ação:  if (!(await ensureFeature(app, 'packages'))) return
   // no catch da API:    catch (e) { showError(e) }   // 402 vira convite pro plano certo
   ```
   Estados de carregando (`<Loading>`), vazio (`<Empty>` com ação), erro
   (`<ErrorBox>`) e "puxar pra atualizar" (`<Screen onRefresh refreshing>`).
5. **Menu** — em `app/(tabs)/mais.js`, item com `feature: 'packages'`: o menu já
   mostra o selo do plano quando está bloqueado.
6. **Textos de venda** — atualize planos no site, landing e `store/`.
7. **Checagem** — `node scripts/check.js` no app; `node --check` e import do
   módulo na rota.

---

## Teste grátis

- Todo perfil novo nasce com `plan_status = 'trialing'` e `trial_ends_at = now() +
  14 dias` (padrão da coluna, `supabase/ag_app_base.sql`).
- O teste libera **tudo do Premium até o fim**, mesmo se ela assinar um plano no
  meio (o Stripe só cobra no fim do teste; daí em diante vale o plano escolhido).
- Faltando 7 dias ou menos, o `PlanBanner` avisa no topo das telas principais.
- Acabou e não assinou: `tier = 'none'`. O app continua abrindo e mostrando agenda
  e clientes (leitura), mas não cria nada novo e a página pública para de aceitar
  agendamento. Nada é apagado.
- Regras completas: `effectivePlan()` em `api/_lib/agendaPlans.js`.

---

## Fluxo de assinatura (pelo site)

1. A profissional toca em "Meu plano" (Mais) ou num cadeado → tela `/plans`.
2. "Assinar" chama `POST /api/stripe/subscribe` e abre a URL do checkout do Stripe
   no navegador (`expo-web-browser`).
3. O Stripe chama `api/stripe/webhook.js`, que grava `plan`, `plan_status`,
   `current_period_end` e `stripe_subscription_id` em `ag_providers`.
4. Ao voltar para o app, a sessão percebe (evento de app ativo) e recarrega o
   `/api/agenda/me`: cadeados somem sozinhos.
5. Trocar cartão, mudar de plano ou cancelar: `POST /api/stripe/portal` (portal
   de cobrança do Stripe).

Configuração no painel do Stripe (passo a passo no README do app, seção
"Assinatura"):
- **Webhook** `https://brasilconnectusa.com/api/stripe/webhook` com
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.subscription.trial_will_end` e `invoice.payment_failed` (além dos
  eventos que outros produtos do site já usam no mesmo endpoint).
- **Customer Portal** permitindo trocar entre os **três preços**
  (`STRIPE_PRICE_STARTER/PRO/PREMIUM`) e cancelar. O webhook descobre o plano
  pelo id do preço: preço fora dos três vira Starter.

Não há compra dentro do app. Isso é permitido no storefront dos EUA (Apple) e,
pela regra atual, no Google Play dos EUA — por isso o app sai só nos EUA. A
variável de build `EXPO_PUBLIC_EXTERNAL_PURCHASE=0` tira o botão e o link (fica
só um texto), caso a revisão exija; para outros países o texto ainda precisa
ficar neutro (regra anti-steering da Apple). Detalhes e plano B:
[`agendapro/store/review-notes.md`](../agendapro/store/review-notes.md#assinatura-vendida-pelo-site).

---

## Notificações push

- **Registro:** depois do login, `components/PushManager.js` chama
  `registerForPush()` (`lib/push.js`), que pede permissão, gera o token Expo com o
  `projectId` da EAS e manda para `POST /api/agenda/push-token` (tabela
  `ag_push_tokens`, até 10 aparelhos). Ao sair da conta, `unregisterPush()`.
- **Envio:** `sendPushToProvider(supabase, providerId, { kind, title, body, data })`
  em `api/_lib/agendaPush.js`. Respeita o plano (`push_notifications`) e as
  preferências do app (`notify_new_booking`, `notify_cancellation`,
  `notify_review`, `notify_daily_summary`; o resumo diário vem desligado). Tipos
  sem preferência (ex.: aviso de cobrança) sempre vão. Token que a Expo diz não existir mais é desativado.
- **Quem dispara:** agendamento novo pela página pública (`book.js`), avaliação
  nova (`review.js`), resumo do dia seguinte (`reminders.js`), avisos de cobrança
  (`webhook.js`), reservas novas e canceladas das casas de turnover
  (`_lib/icalSync.js`) e o teste em Configurações (`push-token.js`).
  Cancelamento feito pelo app ou pela página ainda não dispara push.
- **Credenciais:** APNs pela EAS (automático), FCM v1 pelo Firebase (manual) —
  passo a passo no README do app. Sem `EAS_PROJECT_ID` no build não há token de
  push; sem `google-services.json` (opcional, fora do git) o Android compila mas
  não recebe push.
- **Limitação de desenvolvimento:** push remoto não funciona no Expo Go no
  Android (SDK 53+). Teste com development build.

---

## Banco, crons e variáveis

**Migrations** (todas idempotentes; **aplicadas em produção em 09/10/2026**, nesta ordem):
`ag_app_base.sql` → `ag_app_team.sql` → `ag_app_agenda.sql` →
`ag_app_clients.sql` → `ag_app_setup.sql` → `ag_app_finance.sql` →
`ag_app_push.sql`. A `team` vem cedo porque outras rotas fazem join com
`ag_staff`; a `setup` cria `ag_get_available_slots` e `ag_is_blocked` (as APIs
tratam a falta da função como "não bloqueado").

**Crons** (`vercel.json`, autenticados por `CRON_SECRET`):
- `/api/agenda/reminders` — 17:00 UTC: lembrete por e-mail e resumo de amanhã por push.
- `/api/cron/ical-sync` — de hora em hora: reservas das casas de turnover.
- `/api/cron/agenda-recurring` — 09:30 UTC (**novo**): gera os agendamentos das
  clientes fixas até 6 semanas à frente (`api/_lib/recurring.js`).

**Variáveis**
- Vercel (servidor): as de sempre do site, com `CRON_SECRET` (sem ela os crons
  respondem 401) e `EXPO_ACCESS_TOKEN` (opcional, só com "Enhanced Push Security"
  ligado na Expo).
- Build do app (EAS): `EAS_PROJECT_ID` (sem ele não há push),
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` e `GOOGLE_SERVICES_JSON` (arquivo, opcional;
  sem ele o Android não recebe push). O `.gitignore` do app já ignora
  `secrets/`, `google-services.json` e `GoogleService-Info.plist`.

---

## Lojas

Tudo em `agendapro/store/`:

| Arquivo | Conteúdo |
|---|---|
| `listing-pt-BR.md`, `listing-en-US.md` | Nome, subtítulo, textos, palavras-chave, categoria, classificação, URLs |
| `review-notes.md` | Conta de demonstração, texto para a revisão, pontos de rejeição comuns |
| `privacy-labels.md` | Respostas de App Privacy (Apple) e Data safety (Google) |
| `screenshots-plan.md` | 8 capturas com títulos PT/EN e tamanhos |
| `play-icon-512.png`, `play-feature-graphic.png` | Artes do Google Play (geradas por `scripts/make-icons.py`) |

Páginas públicas que as lojas pedem: política de privacidade
(`public/privacidade.html`, seção 11 "App AgendaPro", `/privacidade#agendapro`)
e exclusão de conta sem o app (`public/excluir-conta.html`, URL
`https://brasilconnectusa.com/excluir-conta.html`, campo "Delete account URL"
do Google Play). Mudou o que o app coleta ou apaga? Atualize as duas e
`store/privacy-labels.md`.

Página pública de divulgação: `public/para/agenda-pro/index.html` (seção "App
AgendaPro — em breve nas lojas", sem selos falsos das lojas). Quando o app for
aprovado, troque o aviso "em breve" pelos selos oficiais da Apple e do Google
(baixar dos sites deles, seguindo as regras de uso) com os links reais.

---

## O que falta

**Antes da primeira publicação**
- Decidir o **nome**: já existe uma empresa de software para salões chamada
  AgendaPro na América Latina (risco de marca e de nome repetido na App Store).
- Publicar o site com a política de privacidade (seção 11) e a página
  `/excluir-conta.html` antes de enviar o app às lojas.
- Definir `EAS_PROJECT_ID` (depois do `eas init`) e, para push no Android, o
  `google-services.json` (local ou variável de arquivo `GOOGLE_SERVICES_JSON` na
  EAS). O `expo-dev-client` já está instalado.
- Configurar no Stripe o webhook (6 eventos) e o Customer Portal (3 preços +
  cancelamento); `CRON_SECRET` na Vercel.
- Decidir se o app roda em iPad (`supportsTablet`).
- Contas: Apple Developer, Google Play, Expo, Firebase; Stripe em modo live.
- Testar num aparelho real o roteiro do README (login → cadastro → agendamento →
  push → assinatura → excluir conta).

**Depois do lançamento (ideias que ajudam a profissional)**
- **Lembrete automático por WhatsApp ou SMS** (Twilio ou WhatsApp Business API):
  é o pedido mais comum e reduz falta mais que o e-mail.
- **Cobrar no cartão pelo próprio celular** (Stripe Tap to Pay no iPhone e no
  Android): recebe na hora, sem maquininha.
- **Pacotes e fidelidade**: pacote de 5/10 sessões com saldo, "10ª escova grátis",
  vale-presente.
- **Pacote do imposto em PDF**: a visão do ano e as linhas sugeridas do
  Schedule C já existem em `api/agenda/finance.js`; falta juntar receita,
  despesas por categoria e milhagem num PDF pronto pro contador, com lembrete das
  estimated taxes trimestrais.
- **Rota otimizada e milhagem automática** para quem faz limpeza (ordem das casas
  e milhas pelo GPS, com permissão explícita).
- **Ficha de anamnese e termo de consentimento** com assinatura no celular
  (estética, lash, sobrancelha).
- **Widget na tela inicial** com o próximo atendimento e o total do dia.
- **Sincronização de duas vias com o Google Calendar** (hoje o app só escreve no
  calendário do aparelho).
- **Botão "Reservar" no Instagram** apontando para a página da profissional, com
  passo a passo dentro do app.
- **Assistente com IA** para responder clientes no WhatsApp e sugerir horários
  livres, e para escrever legenda de post com as fotos da galeria.
- **Indicação**: cliente indica cliente (com desconto) e profissional indica
  profissional (mês grátis).
- **Interface em inglês e espanhol**, para abrir o app a profissionais latinas.
- **Login com Google e Apple** (se entrar Google, Sign in with Apple é obrigatório
  na App Store).

**Dívidas conhecidas**
- Os comprovantes de despesa ficam no bucket público `uploads` (endereço longo e
  aleatório, mas abre para quem tiver o link). Se quiser fechar, mover para um
  bucket privado com URL assinada.
- Sem testes automatizados no app; a checagem é `scripts/check.js` + roteiro manual.
- Sem SDK de falhas (Sentry ou similar): se entrar, atualizar `store/privacy-labels.md`.
