# AgendaPro — app da profissional (iOS e Android)

App completo do AgendaPro para a profissional brasileira nos EUA (cabeleireira,
manicure, esteticista, faxineira…): agenda do dia e da semana, página de
agendamento online, clientes, mensagens prontas no WhatsApp, finanças, equipe e
turnover de Airbnb/Vrbo/Booking. Os recursos são liberados pelo plano de
assinatura (Starter, Pro, Premium) e todo cadastro novo ganha 14 dias com tudo
liberado.

- **Stack:** Expo SDK 54, expo-router 6, React 19, React Native 0.81, JavaScript puro.
- **Backend:** as mesmas APIs do site (`api/` na raiz do repositório, Vercel) e
  o mesmo Supabase. Não existe backend separado para o app.
- **Mesma conta do site:** quem já usa o AgendaPro pelo site entra com o mesmo e-mail.
- **Dois apps no mesmo projeto:** AgendaPro (padrão) e **WorkPro** (orçamento e
  fatura pra construção, handyman, tradutor juramentado…), escolhidos pela
  variável `APP_VARIANT`. Veja ["Dois apps: AgendaPro e WorkPro"](#dois-apps-agendapro-e-workpro).

Visão para o time (arquitetura, como adicionar recurso com cadeado, fluxo de
assinatura, push): [`docs/agendapro-app.md`](../docs/agendapro-app.md).
Regras de construção e donos de arquivo: [`CONTRACT.md`](CONTRACT.md).

---

## Rodar no seu computador

Requisitos: Node 20.19 ou mais novo, npm, e o app **Expo Go** no celular (ou um
simulador iOS/emulador Android).

```bash
cd agendapro
npm install
cp .env.example .env        # no Windows: copy .env.example .env
```

Preencha o `.env`:

| Variável | O que é |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | URL do projeto Supabase (a mesma do site) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Chave **anon/publishable** do Supabase (Project Settings → API). Nunca a service key. |
| `EXPO_PUBLIC_API_BASE` | Onde estão as APIs. Padrão: `https://brasilconnectusa.com`. Para testar API local ou um preview da Vercel, troque aqui. |
| `EXPO_PUBLIC_PURCHASE_MODE_IOS` / `EXPO_PUBLIC_PURCHASE_MODE_ANDROID` | `companion` (padrão: sem preço e sem botão de compra) ou `link` (preços e checkout do Stripe no navegador). Veja "Assinatura" |
| `EAS_PROJECT_ID` | Id do projeto do AgendaPro na Expo (`eas init` mostra; veja "Build e publicação"). Opcional no dia a dia; **sem ele o celular não gera token de push**. Está comentado no `.env.example`. |
| `APP_VARIANT` | `workpro` monta o app WorkPro; vazio = AgendaPro. Defina no terminal, não no `.env`, pra não misturar os dois apps sem perceber. Veja "Dois apps" |
| `EAS_PROJECT_ID_WORKPRO` | Id do projeto do WorkPro na Expo (cada app tem o seu). Mesmo papel do `EAS_PROJECT_ID` |

Depois:

```bash
npx expo start              # QR code pro Expo Go; "w" abre no navegador
node scripts/check.js       # checagem rápida de sintaxe e imports, sem bundler
```

### Expo Go x development build

| | Expo Go | Development build |
|---|---|---|
| Telas, login, APIs, calendário, fotos | Funciona | Funciona |
| **Notificação push remota** | **Não funciona no Android** (o Expo Go deixou de suportar push remoto no Android a partir do SDK 53). No iPhone funciona. | Funciona |
| Face ID | Não (o Expo Go cai na senha do aparelho) | Funciona |
| Ícone, nome e splash do AgendaPro | Não (aparece o Expo Go) | Sim |

Para testar push e Face ID de verdade, gere um **development build** (o
`expo-dev-client` já está no `package.json`):

```bash
npm install -g eas-cli && eas login
eas build --profile development --platform android     # APK pra instalar no celular
eas build --profile development-simulator --platform ios  # simulador (Mac)
npx expo start --dev-client
```

Com Android Studio ou Xcode instalados, dá pra compilar local com
`npx expo run:android` / `npx expo run:ios`. As pastas `android/` e `ios/` são
geradas na hora (estão no `.gitignore`): toda configuração nativa fica no
`app.config.js`.

### Preview no navegador

`npx expo start --web` abre o app no navegador, útil para revisar telas. Código
que só existe no celular (notificações, calendário, Face ID, câmera) é protegido
com `Platform.OS !== 'web'`.

### Modo demonstração

Roda todas as telas **sem login e sem backend**, com dados de exemplo realistas
(Ana Torres, cabeleireira brasileira em Boston: serviços, clientes, ~60
agendamentos de 45 dias atrás até 3 semanas pra frente, pagamentos, equipe,
recorrências, turnover, avaliações, despesas e milhagem). Serve pra testar as
telas, gravar as capturas das lojas e fazer demo de vendas.

```powershell
# PowerShell (Windows)
$env:EXPO_PUBLIC_DEMO='1'; npx expo start --web
# opcionais: plano e ramo
$env:EXPO_PUBLIC_DEMO_PLAN='pro'           # trial (padrão: Premium em teste, 9 dias) | starter | pro | premium | none
$env:EXPO_PUBLIC_DEMO_VERTICAL='cleaning'  # services (padrão) | cleaning (faxina + Airbnb)
```

No bash/macOS: `EXPO_PUBLIC_DEMO=1 npx expo start --web`. Mudou uma variável?
Pare e rode o `npx expo start` de novo.

- O login vira um botão **Entrar na demonstração**; as abas mostram o selo **DEMO**.
- Nenhum dado vai pro servidor: `lib/api.js` responde por `lib/demo/server.js`
  (mesmas rotas e formatos das APIs), com estado em memória. As fotos de
  exemplo vêm de `placehold.co`; checkout e portal abrem a página de planos do
  site. Criar, cancelar e pagar
  mudam as telas; **recarregar a página volta aos dados de exemplo**. Plano sem
  o recurso responde com o cadeado (402), como em produção.
- As datas são relativas a hoje no relógio do aparelho, com aleatório de semente
  fixa: abre sempre igual (bom pras capturas).
- Mudou a matriz de planos em `api/_lib/agendaPlans.js`? Copie de novo pra
  `lib/demo/plans.js`.
- **Nunca ligue em build de loja.** O `app.config.js` recusa o build com
  `EXPO_PUBLIC_DEMO=1` em qualquer perfil do EAS que começa com `production`
  (`production` e `production-workpro`). Não coloque a variável no `.env` nem no
  `eas.json`.

---

## Dois apps: AgendaPro e WorkPro

Um projeto, dois apps nas lojas. Mesmo código, mesma conta, mesma assinatura e
mesmas APIs; a variável `APP_VARIANT` escolhe qual app o `app.config.js` monta.

| | AgendaPro | WorkPro |
|---|---|---|
| `APP_VARIANT` | `agendapro` (padrão, ou vazio) | `workpro` |
| Para quem | Beleza, bem-estar e limpeza (agenda online) | Construção e reforma, handyman, marceneiro, pintor, eletricista, encanador, tradutor juramentado, contador (orçamento e fatura) |
| Bundle id (iOS) e pacote (Android) | `com.brasilconnect.agendapro` | `com.brasilconnect.workpro` |
| Esquema de link | `agendapro://` | `workpro://` |
| Abas | Hoje, Agenda, Clientes, Finanças, Mais | Hoje, Agenda, **Vendas**, Clientes, Mais (Finanças vai pro Mais) |
| Cor principal | Verde `#1F4D3F` | Azul-marinho `#1B2845` |
| Tipo de negócio padrão no cadastro | `services` | `trades` |
| Ícones | `assets/` | `assets/workpro/` |
| Textos e artes da loja | `store/` | `store/workpro/` |
| Página no site | `/para/agenda-pro/` | `/para/workpro/` |
| Projeto na Expo (EAS) | `EAS_PROJECT_ID` | `EAS_PROJECT_ID_WORKPRO` |
| Perfis de build (`eas.json`) | `development`, `development-simulator`, `preview`, `production` | `development-workpro`, `development-simulator-workpro`, `preview-workpro`, `production-workpro` |
| Perfil de envio (`eas submit`) | `production` | `production-workpro` |

No código: `import { VARIANT, IS_WORKPRO, BRAND, SPECIALTY_OPTIONS } from '../lib/variant'`
(em cor, prefira `colors.primary`). Orçamentos e faturas existem nos dois apps —
no AgendaPro ficam em Mais → Vendas; o WorkPro só põe isso no centro. Visão do
produto: [`docs/workpro.md`](../docs/workpro.md). Regras e formatos das APIs:
[`CONTRACT.md`](CONTRACT.md) (seção "WorkPro — orçamentos e faturas").

> **Marca:** existe a marca de ferramentas **WORKPRO** nos EUA. Consulte um
> advogado de marcas **antes de publicar o WorkPro nas lojas** (detalhes e onde
> trocar o nome em [`store/workpro/review-notes.md`](store/workpro/review-notes.md#nome-do-app)).

### Rodar cada variante

```bash
npx expo start                              # AgendaPro
APP_VARIANT=workpro npx expo start          # WorkPro (bash/macOS)
```

```powershell
$env:APP_VARIANT='workpro'; npx expo start  # WorkPro (PowerShell)
Remove-Item Env:APP_VARIANT                 # volta pro AgendaPro
```

Trocou de variante? Pare o Metro e rode com `--clear` (o `app.config` entra no
bundle e fica em cache). No Expo Go aparecem o nome e o ícone do Expo Go; nome,
ícone e splash do WorkPro só aparecem no development build (`development-workpro`).

Modo demonstração do WorkPro (profissional de obra com tabela de preços,
orçamentos, faturas e pedidos de exemplo, sem login):

```bash
npm run web:demo -- trial trades 8095 workpro   # plano, ramo, porta e variante
```

Sem o script, o equivalente no PowerShell é
`$env:APP_VARIANT='workpro'; $env:EXPO_PUBLIC_DEMO='1'; $env:EXPO_PUBLIC_DEMO_VERTICAL='trades'; npx expo start --web --clear --port 8095`.

### Ícones

`python scripts/make-icons.py workpro` regenera `assets/workpro/*` e
`store/workpro/play-icon-512.png` / `play-feature-graphic.png` (prancheta creme
com presilha dourada e check azul-marinho). Sem argumento, gera os dois apps;
`--out PASTA` grava em outro lugar pra conferir antes. Se faltar algum arquivo
do WorkPro, o `app.config.js` usa o do AgendaPro.

### EAS por variante

Cada app é um **projeto separado na Expo** (id, credenciais, número de build e
variáveis próprios). Os perfis `*-workpro` do `eas.json` já fixam
`APP_VARIANT=workpro` no build; mesmo assim, **use um terminal por app** e
deixe `APP_VARIANT=workpro` definido no terminal do WorkPro, porque `eas init`,
`eas env:*`, `eas credentials` e `eas submit` leem o `app.config.js` na sua
máquina pra descobrir o projeto.

Uma vez só, no terminal do WorkPro:

```powershell
$env:APP_VARIANT='workpro'
eas init                                    # cria o projeto "workpro" e mostra o id
$env:EAS_PROJECT_ID_WORKPRO='<id do workpro>'
eas env:create --name EAS_PROJECT_ID_WORKPRO --value "<id do workpro>" --environment production --environment preview --environment development --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<chave anon>" --environment production --environment preview --environment development --visibility plaintext
```

Ponha também `EAS_PROJECT_ID_WORKPRO=<id>` no `.env` local (development build do
WorkPro). As variáveis da Expo são **por projeto**: as do AgendaPro não valem no
WorkPro, por isso a chave anon é criada de novo acima.

| Perfil | Para quê | Comando |
|---|---|---|
| `development-workpro` | Development build do WorkPro, APK no Android | `eas build -p android --profile development-workpro` |
| `development-simulator-workpro` | Igual, para o simulador do iOS | `eas build -p ios --profile development-simulator-workpro` |
| `preview-workpro` | Teste com pessoas reais antes da loja | `eas build -p android --profile preview-workpro` |
| `production-workpro` | Loja (AAB e IPA, build sobe sozinho) | `eas build -p all --profile production-workpro` |

Envio: `eas submit -p ios --profile production-workpro` e
`eas submit -p android --profile production-workpro`. Antes, crie o app WorkPro
na App Store Connect (bundle id `com.brasilconnect.workpro`) e no Play Console e
troque `PREENCHER_ASC_APP_ID_WORKPRO` em `submit.production-workpro` pelo Apple
ID do app WorkPro (é outro número, diferente do AgendaPro). O `appleTeamId` é o
mesmo time. A conta de serviço do Google pode ser a mesma, desde que tenha acesso
aos dois apps no Play Console. Como no AgendaPro, o primeiro AAB do WorkPro vai à
mão no Play Console.

Os dois perfis de loja saem em modo companheiro (`EXPO_PUBLIC_PURCHASE_MODE_IOS`
e `_ANDROID` = `companion` no `base` do `eas.json`).

**Push do WorkPro:**
- iPhone: a EAS cuida da chave APNs no primeiro `eas build -p ios` do projeto
  WorkPro (pode reaproveitar a chave de push do time Apple).
- Android: no **mesmo** projeto do Firebase, adicione um segundo app Android com
  o pacote `com.brasilconnect.workpro` e baixe o `google-services.json` de novo:
  o arquivo novo traz os dois pacotes e serve pros dois apps. Suba como variável
  de arquivo `GOOGLE_SERVICES_JSON` **no projeto WorkPro** da Expo e envie a
  chave FCM v1 em `eas credentials` → Android → `production-workpro`.

### Banco e servidor do WorkPro

- Migration nova: `supabase/ag_app_documents.sql` — orçamentos e faturas
  (`ag_documents`, `ag_document_items`, `ag_document_events`), tabela de preços
  (`ag_catalog_items`), pedidos de orçamento (`ag_quote_requests`), numeração
  sem repetição (`ag_doc_counters` + `ag_next_doc_seq`), `ag_payments.document_id`
  e `method`, e o tipo de negócio `trades`. **NÃO aplicada ainda.** Aplicar
  depois das 7 `ag_app_*` (já em produção) e **antes** de publicar as rotas
  `api/agenda/documents.js`, `catalog.js`, `quote-requests.js`, `doc-public.js`
  e o cron. Sem ela, o cadastro do WorkPro falha (o banco recusa
  `vertical = 'trades'`) e a aba Vendas dá erro — o WorkPro não pode ir pra loja
  antes disso.
- Página do cliente: `https://brasilconnectusa.com/d/<token>` (`public/doc.html`,
  rewrite `/d/:token` já no `vercel.json`).
- Cron `/api/cron/agenda-documents`, `0 15 * * *` (já no `vercel.json`): fatura
  vencida vira "vencida", orçamento passa da validade e lembrete automático de
  pagamento (plano Pro). Usa o mesmo `CRON_SECRET`.
- Pagamento online da fatura (plano Pro) usa o Stripe Connect da profissional,
  o mesmo do sinal no cartão. Confira em `api/stripe/webhook.js` se precisa
  ligar algum evento novo no painel do Stripe.

### Checklist do WorkPro (além do checklist geral)

- [ ] Advogado de marcas consultado sobre "WorkPro" (ou nome trocado).
- [ ] `supabase/ag_app_documents.sql` aplicada; rotas de documentos, `doc-public`, `public/doc.html` e cron publicados.
- [ ] Projeto `workpro` na Expo; `EAS_PROJECT_ID_WORKPRO` no terminal, no `.env` e nas variáveis do projeto; `EXPO_PUBLIC_SUPABASE_ANON_KEY` também no projeto do WorkPro.
- [ ] App `com.brasilconnect.workpro` criado na App Store Connect e no Play Console; `ascAppId` do WorkPro no `eas.json`.
- [ ] Firebase com o segundo app Android, `GOOGLE_SERVICES_JSON` e chave FCM v1 no projeto WorkPro.
- [ ] Ícones conferidos (`python scripts/make-icons.py workpro`).
- [ ] Nenhum "AgendaPro" escrito fixo nas telas que o WorkPro mostra (use `BRAND.name`): `grep -rn "AgendaPro" app components lib --include=*.js`.
- [ ] Textos, notas de revisão, privacidade e capturas: [`store/workpro/`](store/workpro/).
- [ ] Conta de demonstração do WorkPro criada; link `/d/<token>` testado com aprovação por assinatura no Safari e no Chrome.
- [ ] Excluir conta apaga também documentos, tabela de preços, pedidos de orçamento e as fotos deles.
- [ ] Google Play com conta pessoal: teste fechado de 14 dias **também** para o WorkPro.

---

## Estrutura

```
agendapro/
  app/                    telas — cada arquivo é uma rota (expo-router)
    (auth)/login.js       entrar, criar conta, código por e-mail
    onboarding.js         primeiro cadastro do perfil
    (tabs)/               abas: hoje, agenda, vendas (WorkPro), clientes, financas, mais
    document/ price-book/ orçamento/fatura e tabela de preços (WorkPro)
    appointment/          detalhe e novo agendamento
    client/               ficha e edição da cliente
    services/ turnover/ recurring/ finance/ receipt/
    plans.js settings.js profile.js share.js reviews.js team.js waitlist.js …
  components/
    ui.js                 kit visual (Screen, Card, Button, Input, Badge…)
    pickers.js            DateField, TimeField
    Locked.js             cadeado de tela inteira por plano
    PlanBanner.js         aviso de teste acabando / pagamento pendente
    BiometricGate.js      trava com Face ID / digital
    PushManager.js        registra o celular para notificações
  lib/
    session.js            login + perfil + plano (useApp: can, limit, ent…)
    api.js                chamadas às APIs com o JWT (api, post, del)
    gate.js               ensureFeature, showError, openPlans
    format.js             datas (regra de horário), dinheiro, telefone
    theme.js              cores e espaçamentos da marca
    whatsapp.js           modelos de mensagem PT/EN/ES
    push.js calendar.js biometric.js dialog.js config.js supabase.js
  assets/                 ícone, ícone adaptável, splash, favicon (AgendaPro)
    workpro/              os mesmos, do WorkPro
  store/                  textos, notas de revisão, privacidade e artes das lojas (AgendaPro)
    workpro/              os mesmos, do WorkPro
  scripts/
    check.js              checagem de sintaxe e imports
    make-icons.py         gera os ícones (python scripts/make-icons.py [agendapro|workpro])
  app.config.js           nome, bundle id, permissões, plugins, variáveis (APP_VARIANT)
  eas.json                perfis de build e envio (EAS) dos dois apps
  CONTRACT.md             regras de construção do app
```

---

## Planos e recursos

A fonte única é [`api/_lib/agendaPlans.js`](../api/_lib/agendaPlans.js): o app lê
a matriz pelo `GET /api/agenda/me` (desenha cadeados e a tela de planos) e as
rotas bloqueiam no servidor com `requireFeature` / `requireLimit`. Mudou preço ou
recurso? Muda lá (e na página `/agenda/planos`). Resumo de hoje:

| Starter · US$ 19 | Pro · US$ 39 | Premium · US$ 79 |
|---|---|---|
| Agenda completa, agendamento online, serviços, horários e folgas, clientes, lembrete por e-mail, notificações no celular, mensagens prontas no WhatsApp, calendário do celular, sinal por Zelle/dinheiro, controle de pagamento, link e QR code, turnover (até 3 casas) | Tudo do Starter + sinal no cartão (Stripe), avaliações, galeria, clientes fixas, clientes sumidas, lista de espera, finanças, milhagem, mensagens em inglês e espanhol, turnover (até 15 casas) | Tudo do Pro + equipe (até 10), rota do dia da equipe, relatórios e CSV, recibos em PDF, página sem a marca BrasilConnect, turnover ilimitado |

- **Teste grátis:** 14 dias sem cartão, com tudo do Premium (cadastro pelo app).
  Vale o Premium inteiro até o fim do teste, mesmo se ela assinar um plano no
  meio; depois disso vale o plano assinado.
- **Plano inativo** (`tier: 'none'`): o app abre e mostra agenda e clientes, mas
  não cria nada novo, e a página pública não aceita agendamento.
- **Pagamento atrasado** (`past_due`): mantém o plano por 3 dias depois do fim do
  período e mostra aviso.

Detalhes do uso no código: [`CONTRACT.md`](CONTRACT.md#plano-e-recursos-fonte-única-api_libagendaplansjs).

---

## Banco de dados (Supabase)

Aplique no SQL Editor do Supabase, **nesta ordem**, antes de publicar as APIs
novas. Todos são idempotentes (pode rodar de novo sem estragar):

1. `supabase/ag_app_base.sql` — colunas do perfil (tipo de negócio, fuso, preferências do app) e fim do teste grátis
2. `supabase/ag_app_team.sql` — equipe e clientes fixas (as outras rotas fazem join com `ag_staff`)
3. `supabase/ag_app_agenda.sql` — pagamento, gorjeta, origem e anotação no agendamento
4. `supabase/ag_app_clients.sql` — ficha completa da cliente e lista de espera
5. `supabase/ag_app_setup.sql` — folgas parciais e horários livres (funções
   `ag_get_available_slots` e `ag_is_blocked`; enquanto não aplicar, as APIs
   tratam a falta da função como "não bloqueado")
6. `supabase/ag_app_finance.sql` — despesas e milhagem
7. `supabase/ag_app_push.sql` — tokens de notificação dos celulares

**As 7 já foram aplicadas em produção em 09/10/2026** (assim como
`ag_agendapro_operavel.sql` e `ag_turnover_ical.sql`). Ficam aqui pra outro
ambiente (ex.: um projeto Supabase de teste).

8. `supabase/ag_app_documents.sql` — orçamentos, faturas, tabela de preços,
   pedidos de orçamento e o tipo de negócio `trades` (WorkPro). **NÃO aplicada
   ainda**; aplicar depois das 7 acima (veja "Dois apps" → "Banco e servidor do
   WorkPro").

Migration nova: cabeçalho com `NAO APLICADO ainda` até aplicar, depois
`APLICADO em producao em <data>`.

### Variáveis na Vercel

As APIs do app usam as mesmas variáveis do site: `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM`,
`RESEND_API_KEY`, `CRON_SECRET`, `APP_URL`. Atenção a duas:

- `CRON_SECRET` — **obrigatória** para os crons do AgendaPro: sem ela as rotas
  respondem 401 e nada roda. A Vercel manda `Authorization: Bearer <CRON_SECRET>`
  sozinha.
- `EXPO_ACCESS_TOKEN` (servidor, **opcional**) — só se você ligar "Enhanced Push
  Security" no projeto da Expo (expo.dev → Project → Settings → Access tokens).
  Sem ela, o envio de push funciona normalmente.

### Crons (`vercel.json`)

| Rota | Quando (UTC) | O que faz |
|---|---|---|
| `/api/agenda/reminders` | `0 17 * * *` | Lembrete por e-mail das clientes de amanhã e resumo do dia seguinte por push |
| `/api/cron/ical-sync` | `15 * * * *` | Puxa as reservas novas das casas de turnover (Airbnb/Vrbo/Booking) |
| `/api/cron/agenda-recurring` | `30 9 * * *` | **Novo:** cria os agendamentos das clientes fixas até 6 semanas à frente (idempotente; só quem tem o recurso `recurring`) |
| `/api/cron/agenda-documents` | `0 15 * * *` | **Novo (WorkPro):** fatura vencida → vencida, orçamento fora da validade → expirado, lembrete automático de pagamento (recurso `payment_reminders`). Depende de `ag_app_documents.sql` |

Para rodar um cron à mão: `curl -H "Authorization: Bearer $CRON_SECRET" https://brasilconnectusa.com/api/cron/agenda-recurring`.

---

## Assinatura (como o app vende o plano)

O app **não tem compra dentro do app**. O comportamento depende do modo, por
plataforma (`EXPO_PUBLIC_PURCHASE_MODE_IOS` / `EXPO_PUBLIC_PURCHASE_MODE_ANDROID`,
lido em `lib/config.js` → `PURCHASE_MODE`):

- `companion` (**padrão e o que o `eas.json` usa nos builds de loja**, nos dois
  apps): sem preço, sem botão de compra e sem "assine no site". A tela "Meu
  plano" mostra o plano atual e o que cada plano inclui; a assinatura é feita
  na conta BrasilConnect, fora do app.
- `link`: a tela "Meu plano" mostra os preços, abre o checkout do Stripe no
  navegador (`POST /api/stripe/subscribe`) e o portal de cobrança
  (`POST /api/stripe/portal`) para trocar cartão, mudar de plano ou cancelar.
  Botão e link para compra fora do app são permitidos na **App Store dos EUA**
  (desde maio de 2025) e, segundo a regra atual, no **Google Play dos EUA** — só
  troque depois de confirmar com a revisão.

Nos dois modos, o webhook do Stripe atualiza o plano e, quando a usuária volta
para o app, a sessão recarrega o `/api/agenda/me` sozinha. O app é publicado só
nos EUA. Detalhes e plano B em
[`store/review-notes.md`](store/review-notes.md#assinatura-vendida-pelo-site) e,
para o WorkPro, em [`store/workpro/review-notes.md`](store/workpro/review-notes.md#assinatura-e-pagamentos).

### Configurar no painel do Stripe (modo de teste e depois live)

**Webhook** (Developers → Webhooks → Add endpoint):
`https://brasilconnectusa.com/api/stripe/webhook`, com o segredo de assinatura
em `STRIPE_WEBHOOK_SECRET`. Eventos que o AgendaPro precisa:

| Evento | O que o webhook faz |
|---|---|
| `checkout.session.completed` | Liga o plano assinado no checkout (`ag_providers.plan`, status, fim do período, id da assinatura) e confirma sinal pago no cartão |
| `customer.subscription.created` · `customer.subscription.updated` | Mantém plano e status em dia (troca de plano no portal, renovação). O plano sai do id do preço: preço fora dos três `STRIPE_PRICE_*` vira Starter |
| `customer.subscription.deleted` | Assinatura cancelada → `canceled` (app só leitura) |
| `customer.subscription.trial_will_end` | E-mail e push avisando que o teste está acabando |
| `invoice.payment_failed` | Marca `past_due` (aviso no app, 3 dias de tolerância) e manda push |

O mesmo endpoint já atende outros produtos do site (`account.updated`,
`payment_intent.succeeded`, `payment_intent.payment_failed`): não tire esses
eventos ao editar.

**Customer Portal** (Settings → Billing → Customer portal), usado pelo
`POST /api/stripe/portal`:
- ligar **trocar de plano** e colocar os **três preços** (`STRIPE_PRICE_STARTER`,
  `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM`) na lista de produtos que a cliente
  pode escolher;
- ligar **cancelar assinatura**;
- ligar atualizar forma de pagamento e ver faturas.

A configuração do portal é separada no modo de teste e no live: repita nos dois.

---

## Build e publicação (EAS)

Uma vez só:

```bash
npm install -g eas-cli
eas login                    # conta Expo do dono
cd agendapro
eas init                     # cria o projeto na Expo
```

Como o `app.config.js` é dinâmico, o `eas init` **não consegue gravar o
projectId sozinho**: ele mostra o id e o app lê esse id da variável
`EAS_PROJECT_ID` (`extra.eas.projectId`). **Sem ela não há push** (o celular não
gera o token) e o `eas build` não acha o projeto. Defina:

- no terminal onde você roda `eas build`/`eas submit` (o `app.config.js` é lido
  na sua máquina antes do envio): `export EAS_PROJECT_ID=<id>` (PowerShell:
  `$env:EAS_PROJECT_ID="<id>"`);
- no `.env` local, para o development build com `npx expo start --dev-client`;
- nas variáveis da Expo, para o build na nuvem:
  `eas env:create --name EAS_PROJECT_ID --value "<id>" --environment production --environment preview --environment development --visibility plaintext`.

O id não é segredo: se preferir, fixe o valor em `app.config.js` no lugar do
`process.env.EAS_PROJECT_ID` e pule os passos acima.

Variáveis do build: o `eas.json` já define `EXPO_PUBLIC_API_BASE`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_PURCHASE_MODE_IOS` e
`EXPO_PUBLIC_PURCHASE_MODE_ANDROID` (`companion`) e, em cada perfil, o
`APP_VARIANT`. A chave anon do Supabase entra pelo painel de variáveis da Expo,
nos três ambientes (no projeto de cada app):

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<chave anon>" --environment production --environment preview --environment development --visibility plaintext
```

(O `.env` local não vai para o servidor de build: ele está no `.gitignore`.)

### Perfis do `eas.json`

| Perfil | Para quê | Comando |
|---|---|---|
| `development` | App de desenvolvimento (precisa do `expo-dev-client`), distribuição interna, APK no Android | `eas build -p android --profile development` |
| `development-simulator` | Igual, para o simulador do iOS | `eas build -p ios --profile development-simulator` |
| `preview` | Teste com pessoas reais antes da loja: APK no Android, ad hoc no iPhone (registre os aparelhos com `eas device:create`) | `eas build -p android --profile preview` |
| `production` | Loja: AAB no Android, IPA no iOS. Número do build sobe sozinho (`autoIncrement`, versão gerenciada pela EAS) | `eas build -p all --profile production` |

Esses quatro montam o AgendaPro (`APP_VARIANT=agendapro`). Os do WorkPro têm o
mesmo nome com `-workpro` no fim — veja ["EAS por variante"](#eas-por-variante).

A versão que aparece na loja (`1.0.0`) vem do `app.config.js` (`version`). O
número do build (iOS `buildNumber` / Android `versionCode`) fica na EAS
(`appVersionSource: remote`); para começar de um número específico:
`eas build:version:set`.

### Enviar para as lojas

```bash
eas submit -p ios --profile production       # vai pro TestFlight / App Store Connect
eas submit -p android --profile production   # vai pro Google Play (faixa interna, rascunho)
```

Antes, troque os marcadores do bloco `submit.production` no `eas.json`
(`PREENCHER_ASC_APP_ID_AGENDAPRO` e `PREENCHER_APPLE_TEAM_ID`; o WorkPro tem o
bloco `submit.production-workpro`):

| Campo | Onde achar |
|---|---|
| `ios.ascAppId` | App Store Connect → seu app → App Information → **Apple ID** (número). Crie o app lá antes, com o bundle id `com.brasilconnect.agendapro`. |
| `ios.appleTeamId` | developer.apple.com → Account → Membership details → **Team ID** |
| `android.serviceAccountKeyPath` | JSON de uma conta de serviço do Google Cloud com acesso ao Play Console (Play Console → Users and permissions → convidar o e-mail da conta de serviço como "Release manager"). Guarde em `agendapro/secrets/` (fora do git) — ou suba direto na EAS com `eas credentials` e apague o campo. |

O Google exige que o **primeiro AAB seja enviado à mão** no Play Console
(Testing → Internal testing → Create release). Depois disso, o `eas submit` funciona.

---

## Credenciais de notificação (push)

O servidor manda push pela Expo (`api/_lib/agendaPush.js` → `exp.host`), que
entrega pela Apple e pelo Google. O app pede o token com o `projectId` da EAS.

- **iPhone (APNs):** a EAS cria a chave de push da Apple sozinha no primeiro
  `eas build -p ios` (responda "sim" quando perguntar sobre Push Notifications) ou
  depois em `eas credentials` → iOS → Push Notifications. Precisa da conta Apple
  Developer paga.
- **Android (FCM v1):**
  1. Crie um projeto no Firebase e adicione um app Android com o pacote
     `com.brasilconnect.agendapro`.
  2. Baixe o `google-services.json`. Ele é **opcional para o build** (sem ele o
     app compila, só não recebe push no Android) e **não vai para o git** (o
     `.gitignore` já ignora `google-services.json`, `GoogleService-Info.plist` e
     `secrets/`). O `app.config.js` só liga `android.googleServicesFile` se o
     arquivo existir em `agendapro/google-services.json` (build local) ou se a
     variável `GOOGLE_SERVICES_JSON` estiver definida. Como o build na nuvem da EAS
     não recebe arquivos ignorados pelo git, suba como variável do tipo arquivo:
     `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production --environment preview --environment development --visibility secret`.
  3. No Firebase → Project settings → Service accounts → gere uma chave privada
     (JSON) e suba na EAS: `eas credentials` → Android → production → Google
     Service Account → **Push Notifications (FCM V1)**.
- Teste: https://expo.dev/notifications com o token que aparece no banco
  (tabela de tokens de `ag_app_push.sql`).

---

## Checklist de publicação

**Código e configuração**
- [ ] Migrations aplicadas na ordem acima (base → team → agenda → clients → setup → finance → push → documents); APIs e `vercel.json` (crons `agenda-recurring` e `agenda-documents`) publicados na Vercel.
- [ ] `CRON_SECRET` na Vercel; `EXPO_ACCESS_TOKEN` só se ligar a segurança extra de push.
- [ ] Stripe: webhook com os 6 eventos do AgendaPro e Customer Portal com os 3 preços + cancelamento (seção "Assinatura").
- [ ] `EAS_PROJECT_ID` definido (terminal, `.env` e variáveis da Expo) ou fixo no `app.config.js`; `EXPO_PUBLIC_SUPABASE_ANON_KEY` nas variáveis da Expo.
- [ ] Push no Android: `google-services.json` (local ou variável de arquivo `GOOGLE_SERVICES_JSON` na EAS) e chave FCM v1 na EAS.
- [ ] Ícones conferidos (`python scripts/make-icons.py` regenera).
- [ ] Decidir iPad: com `supportsTablet: true` a Apple exige capturas de iPad e revisa no iPad.
- [ ] `node scripts/check.js` sem erro; testar num aparelho real: login, cadastro, criar agendamento, push de agendamento novo pela página pública, Face ID, calendário, foto, assinatura (Stripe em modo de teste), excluir conta.
- [ ] Se a Apple mandar e-mail "ITMS-91053 Missing API declaration", declarar as APIs em `ios.privacyManifests` no `app.config.js`.

**Lojas**
- [ ] Nome do app decidido (há risco de marca com "AgendaPro" — veja `store/review-notes.md`).
- [ ] App criado na App Store Connect e no Play Console; disponibilidade só nos EUA.
- [ ] Textos: `store/listing-pt-BR.md` e `store/listing-en-US.md`.
- [ ] Capturas: `store/screenshots-plan.md`; artes do Google Play já em `store/`.
- [ ] App Privacy e Data safety: `store/privacy-labels.md`.
- [ ] Site publicado com a política de privacidade atualizada (`/privacidade`, seção 11) e a página de exclusão `https://brasilconnectusa.com/excluir-conta.html` (campo "Delete account URL" do Google Play).
- [ ] Conta de demonstração criada e notas de revisão coladas: `store/review-notes.md`.
- [ ] Android com conta pessoal: teste fechado com 12 testadores por 14 dias antes da produção.
- [ ] TestFlight interno → revisão da Apple → lançamento.

## O que depende do dono

- **Conta Apple Developer** (US$ 99/ano). Como empresa, precisa do número
  D-U-N-S (gratuito, leva alguns dias); como pessoa física, o nome do vendedor na
  loja é o seu.
- **Conta Google Play Console** (US$ 25, uma vez). Conta pessoal exige o teste
  fechado de 14 dias.
- **Conta Expo** (gratuita serve para começar; o plano pago dá mais builds por mês
  e fila mais rápida).
- **Stripe em modo live** com os três preços (`STRIPE_PRICE_STARTER/PRO/PREMIUM`),
  o webhook apontando para produção com os eventos da seção "Assinatura" e o
  Customer Portal configurado (trocar entre os 3 preços e cancelar).
- **Firebase** (gratuito) para o push no Android.
- **Variáveis na Vercel**: as de sempre, com `CRON_SECRET` (sem ela os crons não
  rodam); `EXPO_ACCESS_TOKEN` opcional.
- **Variáveis na Expo/EAS**: `EAS_PROJECT_ID`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` e,
  para push no Android, `GOOGLE_SERVICES_JSON` (arquivo).
- **Decisões:** nome do app (marca), iPad sim ou não, número de WhatsApp de
  suporte (`SUPPORT_WHATSAPP` em `app/(tabs)/mais.js`).
