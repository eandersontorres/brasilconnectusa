# Auditoria da plataforma · BrasilConnect USA · 28/09/2026

**Pergunta:** o que falta para usar tudo que está planejado: cada fonte de receita, cada recurso para negócios, cada recurso do app para usuários, e a configuração por trás.

**Método:** 4 varreduras do código (receita, negócios, app, infraestrutura) + checagens ao vivo em produção (Stripe, Supabase Advisors, leitura anônima do banco, rotas, crons). Cada linha traz o arquivo. O que não foi verificado ao vivo está marcado.

---

## Resumo: os 8 pontos que mais importam

| # | Achado | Impacto | Tipo |
|---|---|---|---|
| 1 | **Stripe em produção está em modo de teste** (`/api/stripe/status` → `mode: "test"`) | Nenhuma cobrança real acontece hoje, em nenhuma fonte | Painel |
| 2 | **Vazamento de dados de usuários**: a view `bc_onboarding_drip_candidates` (e-mail, nome, cidade) e a tabela `bc_onboarding_drip_log` (e-mails) são legíveis por qualquer pessoa com a chave pública do site. Confirmado ao vivo: 28 e 86 linhas | Privacidade/LGPD. Crítico | SQL pronto: `supabase/fix_2026_09_28_seguranca.sql` |
| 3 | **3 dos 5 crons devem estar falhando com 401**: `vercel.json` chama `?secret=__CRON__` literal e os handlers não leem o header `Authorization: Bearer` que o Vercel envia (`api/cron/drip.js:26`, `api/agenda/reminders.js`, `api/cron/moderation.js:138`) | Sem e-mails de onboarding, sem lembretes, sem moderação automática | Código (+ conferir em Vercel → Cron Jobs) |
| 4 | **O site promete 0% de comissão e o código cobra 2,5%** (`api/restaurant/order.js:129,172` → `application_fee_amount`) | Afirmação falsa sobre dinheiro. Risco de reembolso e reputação | Decisão + código |
| 5 | **AgendaPro é vendido com recursos que não existem**: lembrete por e-mail, SMS, reviews com selo, galeria, até 10 profissionais, relatórios, sem branding (`public/agenda/planos.html:441-480`). O checkout já cobra | Cobrar por algo que não entrega | Código (ou tirar do texto) |
| 6 | **Planos Pro do diretório ($9 / $19 / $29) não têm checkout nem preço no Stripe**. O `listing_plan` é escolhido pelo próprio cadastrante (`api/businesses/submit.js:36`) | A principal fonte de receita do plano de negócios não existe tecnicamente | Código + Stripe |
| 7 | **Fluxos quebrados**: `/negocio/:slug` → 404 (não existe `profile.html`); salvar perfil de profissional no `/assinante` → 405 (`api/agenda/provider.js:9` só aceita GET); fotos enviadas nunca aparecem (a view pública não tem `logo_url`/`gallery_urls`); `/api/events/list` não existe (`src/AppShell.jsx:594`) | Recursos que parecem prontos mas não funcionam | Código |
| 8 | **Preços divergem entre páginas**: Premium $79 em `/para/restaurant` e $29 em `/para/showcase`; AgendaPro Pro $49 em `/para/agenda-pro:238` e $39 em `/agenda/planos:454` | Confusão e disputa com cliente | Decisão |

---

## A. Fontes de receita

| Fonte | Status | O que funciona | O que falta |
|---|---|---|---|
| **Assinatura AgendaPro** ($19/$39/$79, trial 14d) | Parcial | Checkout com trial (`api/stripe/subscribe.js:38-47`); webhook grava `plan`/`plan_status` (`api/stripe/webhook.js:55-95`); preços configurados no Stripe (teste) | **Código:** nenhum recurso é liberado/bloqueado por plano (`ag_provider_has_plan()` existe no SQL e ninguém chama); `checkout.session.completed` grava `active` mesmo em trial (`webhook.js:61`); "trocar plano" abre novo checkout e pode gerar 2ª assinatura (sem Billing Portal); schema usa plano `salao`, código usa `premium` (MRR da view não conta Premium); `.env.example` pede `STRIPE_PRICE_SALON`, código lê `STRIPE_PRICE_PREMIUM`. **Painel:** Stripe em modo live com os 3 preços. |
| **Planos Pro do diretório** ($29 Rest/Merc/Loja, $19 AgendaPro, $9 Divulgação) | Só interface | Texto em `public/para/index.html:169`, `public/negocio/index.html:228-240` | **Código:** checkout, webhook que grave `listing_plan`, bloqueio por plano (limite de 20 itens do Free não existe em `menu.js`), fechar o `listing_plan` vindo do cliente. **Stripe:** produtos/preços por módulo. **Decisão:** tabela única de preços. |
| **Pedidos online** (Stripe Connect Express) | Quase ponta a ponta | Onboarding Express (`api/restaurant/onboard.js:47-78`), status ao vivo, PaymentIntent com `transfer_data.destination` (repasse automático), webhook marca pago + push ao dono (`webhook.js:108-158`) | **Decisão:** 0% ou 2,5% (`order.js:129`). **Código:** sem handler de reembolso; `onboard.js` só compara `owner_email` do body (sem JWT). **Stripe:** webhook de Connect (`account.updated`) pode exigir endpoint/segredo próprio (suposição). |
| **Depósito AgendaPro** (Zelle/Stripe) | Parcial | Checkout comum confirma agendamento (`api/agenda/checkout.js`, `webhook.js:41-54`) | O dinheiro fica na conta da plataforma, sem repasse ao profissional (não usa Connect). Zelle: `deposit.js` exige `ADMIN_SECRET` e nenhuma tela chama. **Decisão:** a plataforma fica com parte? |
| **Enterprise** | Só lead | `api/enterprise-lead.js` grava e avisa por e-mail | **Decisão:** oferta e preço. Cobrança manual (fatura/link). |
| **Patrocínios / destaque pago** | Manual | CRUD admin (`api/admin/sponsors.js`), exibição no app, tracking de clique | Sem venda self-service (`bc_sponsors.sql:10` "admin cadastra manual"). "Topo da categoria" não tem quem venda nem tela de admin para marcar `featured`/`verified`. |
| **Afiliados** (remessas, voos, hotéis) | Tracking pronto, sem IDs | `/go/:partner` grava clique (`api/go.js`); 179 cliques ao vivo | **Contas:** aprovação em cada programa e as env vars `AFFILIATE_*_LINK` (hoje placeholders `SEU_ID`). **Código:** `/api/flights/search` gera link direto às companhias, sem marker do Travelpayouts (`api/_lib/partners-airlines.js:216`). Sem ID, cada clique é receita perdida. |
| **Loja (merch)** | Lista de espera | `/api/waitlist` com `source: loja:<peça>` | Amostras → fotos → checkout (Stripe ou print-on-demand). |
| **Indicação** | Custo, não receita | Cookie + qualificação por clique em afiliado (`api/go.js:98-115`) | Recompensa de US$10 (gift card) paga à mão; qualifica por clique em afiliado que ainda não paga comissão. **Decisão:** manter? |
| Bolão, classificados, Cleaner | Sem receita | — | Bolão encerrado (rotas redirecionam). Classificados grátis. Cleaner só lista de espera. |

---

## B. Recursos para os negócios (lado SaaS)

| Recurso | Status | Detalhe |
|---|---|---|
| Cadastro `/negocio` + aprovação admin + edição `/assinante` | Funciona | Aprovação/recusa com e-mail (`api/admin/business-action.js:155-221`). Admin **não é avisado** de cadastro novo. "48h" é promessa manual. |
| Página pública do negócio `/negocio/:slug` | **Quebrado (404)** | `vercel.json:90` aponta para `negocio/profile.html`, que não existe. |
| Fotos (logo, capa, galeria) | **Invisíveis** | Upload funciona (`api/upload.js`, sem login e sem limite), mas `bc_businesses_public` não expõe as URLs (`bc_businesses_v2.sql:125-133`); o diretório mostra só iniciais. |
| Restaurante: cardápio + pedidos | Funciona | Ver seção A. Modificadores ("ponto, sem cebola") prometidos em `/para/restaurant:118`: tabela existe, sem API nem tela. |
| Delivery | Parcial | Endereço + taxa fixa. Sem raio nem cálculo de frete. |
| Mercado/Loja: estoque | **Não existe** | Prometido em `/para/grocery:239` e `/para/retail:211`. |
| Estorno "pelo botão no painel" | **Não existe** | Prometido em `/para/restaurant:250`, `/para/retail:246`. |
| AgendaPro: link público + agendamento + depósito | Parcial | Perfil público sem reviews, galeria ou foto (`public/agenda/profile.html:107-138`). `book.js` não avisa profissional nem cliente. |
| AgendaPro: painel da profissional | **Demo** | `src/AgendaApp.jsx:57` `isDemo = true`; botões "Em breve". Salvar perfil → 405. Serviços e depósito exigem `ADMIN_SECRET`. Sem edição de horários. |
| AgendaPro: lembretes e-mail/SMS | **Não existe** | `api/agenda/reminders.js:33-36` só faz `console.log` e marca como enviado (`TODO: integrar Z-API`). |
| AgendaPro: reviews | Parcial | Token funciona (`request-review.js`, sem login), mas os reviews não aparecem em lugar nenhum. |
| Selo verificado / destaque / "Selo Pioneiro" | Parcial | Campos e ordenação existem; sem tela de admin para marcar. Pioneiro não existe. |
| Aviso de pedido novo ao dono | Parcial | Push só se o dono ativou push no app principal; `/assinante` só faz polling 30s com som com a aba aberta. Sem e-mail. |
| Cleaner | Lista de espera | Spec em `docs/spec-agendapro-limpeza-mvp.md`. |
| Clariva | Sem integração | Só menção em `mobile/DESIGN.md`. |

---

## C. Recursos do app para os usuários

| Recurso | Status | O que falta |
|---|---|---|
| Login e-mail+senha, código por e-mail | Funciona | Sem "esqueci a senha" (código serve de alternativa). |
| Login Google | Desligado | `AuthModal.jsx:22` flag `false`. **Painel:** provider Google no Supabase + OAuth client no Google Cloud. |
| Onboarding, perfil, configurações | Funciona | Sem perfil público de outros usuários; **sem exclusão de conta** (LGPD). |
| Feed, votos, filtro por raio, comunidades | Funciona | Recarregar `/app/community/<slug>` pode dar 404 (`/app/:tab` só cobre 1 segmento — suposição). |
| Comentários e detalhe do post | **Só interface** | API existe (`api/social.js:685`); telas mostram "em breve" (`FeedScreen.jsx:681`). Como notificações in-app só nascem de comentários, **o sino nunca recebe nada**. |
| Eventos | Parcial | RSVP existe na API e no mobile; web só lista. `/api/events/list` **não existe** → bloco de eventos da barra lateral sempre vazio. Sem lembrete T-24h (sem cron). |
| Mensagens diretas | Não existe | Prioridade alta no `TODO_MANHA.md`. |
| Grupos de interesse (26) | Lista de espera | Ao bater a meta cria `bc_groups`, mas não avisa ninguém. **Decisão:** modelo pago? |
| Marketplace (classificados) | MVP | Contato só por WhatsApp; a tela de login promete "chat direto". |
| Push por tópicos | Parcial | Infra pronta (1 inscrição ao vivo). Tópicos `events`, `cambio`, `community` não têm quem envie; só pedidos de restaurante disparam. |
| Remessas, voos, alertas de câmbio, Viagem | Funcionam (estimativas) | **Contas:** `WISE_API_TOKEN`, `EXCHANGE_RATE_API_KEY`, `TRAVELPAYOUTS_*`. Link de cancelar alerta está quebrado (`id=UNSUBSCRIBE` literal, `check-alerts.js:68`). |
| Negócios por raio dentro do app | Escondido | `src/lib/features.js` `SHOW_BUSINESS = false`. |
| Guias (7), custo de vida (13 cidades), guia de chegada | Funcionam | Sitemap sem `/loja` e `/indique`; `indique` e `agenda/planos` com `noindex` (provavelmente indevido). |
| PWA / offline | Funciona | Botão de "instalar" não encontrado (suposição). |
| App Expo | Protótipo v0.1.0 | Telas: welcome, login por link, feed, comunidades, eventos (RSVP), perfil (sem ação). Sem postar, comentar, marketplace, push. **Domínio da API padrão é `brasilconnect.com`** (`mobile/app.config.js:51`), não `brasilconnectusa.com`. Sem `eas.json`. **Contas:** Apple Developer, Google Play, EAS. |
| Bolão | Encerrado | `BolaoScreen.jsx` não é importado; `api/bolao.js` segue no ar. **Decisão:** arquivar ou nova edição. |

---

## D. Infraestrutura, configuração, segurança, conformidade

### Variáveis de ambiente usadas pelo código e ausentes do `.env.example`
`STRIPE_PRICE_PREMIUM` (example tem `STRIPE_PRICE_SALON`), `CONTACT_NOTIFY_EMAIL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VAPID_EMAIL`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `INTEREST_THRESHOLD`. *Não consegui listar as variáveis configuradas no Vercel (o conector não tem acesso ao escopo `eandersontorres-projects`).*

### Banco (Supabase, verificado ao vivo)
- Todas as tabelas usadas existem ao vivo. RPC `increment_geocode_hits` não tem SQL no repo (erro engolido em `api/geocode.js:61`).
- Sem migrations versionadas: 6 no histórico, o resto foi rodado à mão. Adotar `supabase/migrations/`.
- Vários SQL do repo têm `DISABLE ROW LEVEL SECURITY`; ao vivo o RLS está ligado. Rodar esses arquivos de novo expõe as tabelas.
- 46 tabelas com RLS sem policy: **correto**, porque nem o app nem as páginas leem tabelas direto (tudo passa por `api/` com a service key).
- Leaked-password protection desligada (painel).

### Segurança das APIs
| Item | Situação |
|---|---|
| `api/profile.js`, `api/social.js`, `api/notifications.js` | **Protegidas** nas escritas (JWT via `requireAuthOnly`, `user_id` sobrescrito). Leituras `feed` e `my-communities` aceitam `user_id` na query sem login (exposição leve). |
| `api/upload.js` | Sem login, sem limite. Qualquer um sobe arquivo. |
| `api/agenda/request-review.js` | Sem login. |
| `api/restaurant/onboard.js` | Só compara `owner_email` do body. Negócio sem `owner_email` → qualquer pessoa vira dona. |
| `api/agenda/provider?email=` | Devolve WhatsApp, plano e e-mail de qualquer profissional; usado como "login" em `planos.html:632`. |
| `api/agenda/services.js`, `deposit.js`, `api/push/notify.js` | Exigem `ADMIN_SECRET` → a profissional não consegue operar sozinha. |
| Admin | Segredo único compartilhado em `x-admin-secret`, sem auditoria, CORS `*`. **`/admin/plano`, `/admin/roadmap`, `/admin/utm-builder` abrem sem senha** (só `noindex`). Trocar por login Supabase + lista de admins. |
| Rate limit | Só em memória, em 5 endpoints. Faltam login, upload, social, book, order. |

### Crons (`vercel.json:162-183`)
`check-alerts` e `onboarding-reminders` aceitam Bearer e funcionam. `drip`, `agenda/reminders` e `moderation` só aceitam `x-cron-secret`/`?secret=` → **401** a menos que `CRON_SECRET` seja literalmente `__CRON__`. Sinal: `bc_agent_log` tem 2 linhas com moderação agendada a cada 5 min. `*/5` exige Vercel Pro. Conferir em **Vercel → Settings → Cron Jobs**. Correção: ler `Authorization: Bearer` nos 3 handlers e tirar `?secret=` das URLs.

### E-mail (Resend)
Remetentes `oi@`, `noreply@`, `alertas@`, `admin@brasilconnectusa.com` (domínio precisa estar verificado, não conferido). **Descadastro não funciona**: drip e onboarding pedem "responda com remover" (sem link, sem `List-Unsubscribe`, sem endereço físico → não atende CAN-SPAM); link de cancelar alertas está quebrado.

### Conformidade
Privacidade/termos (04/05/2026) não mencionam push, SMS/WhatsApp, e-mail marketing nem pedidos de restaurante. Sem banner de cookies. GA4 e Pixel estão como placeholders (`app.html:88-113`): **antes de ativar, precisa de consentimento**. Sem exclusão de conta. SMS/WhatsApp: exigirá consentimento explícito no agendamento (TCPA).

### Observabilidade
Nenhum analytics nem monitor de erro ativo (sem GA, Pixel, Vercel Analytics, Sentry). Erros só no log da Vercel. Sem alerta de cron falhando.

### SEO
`og-image.svg` em 26 páginas: WhatsApp/Facebook/X não renderizam SVG → gerar PNG 1200×630. Sitemap com `lastmod` de maio.

---

## E. Plano de ação priorizado

### P0 · Esta semana (segurança e verdade com o cliente)
1. **Rodar `supabase/fix_2026_09_28_seguranca.sql`** e ligar leaked-password protection. *(Painel · 10 min)*
2. **Crons:** aceitar `Authorization: Bearer` em `drip`, `agenda/reminders`, `moderation`; tirar `?secret=` do `vercel.json`. Conferir execuções no painel. *(Código)*
3. **Decidir 0% ou 2,5%** e alinhar `order.js` (+ `platform_fee_pct` default no schema) com o texto. *(Decisão + código)*
4. **Tirar das páginas de venda o que não existe** (ou marcar "em breve"): SMS, lembretes, reviews com selo, galeria, multi-profissional, relatórios, sem branding, estoque, modificadores, estorno pelo painel, chat no marketplace. *(Conteúdo)*
5. **Fechar `listing_plan`** no cadastro (server-side, sempre `free`). *(Código, 1 linha)*
6. **Proteger `/admin/plano`, `/admin/roadmap`, `/admin/utm-builder`** (Vercel Password Protection ou mover para o esquema `x-admin-secret`). *(Painel/código)*
7. Consertar o link de cancelar alertas e colocar link real de descadastro + endereço físico nos e-mails. *(Código)*

### P1 · Próximas 2–4 semanas (destravar receita)
8. **Stripe em modo live** com os 3 preços do AgendaPro; corrigir `SALON→PREMIUM` e `salao→premium`; Billing Portal para trocar plano; `trial_will_end`. *(Painel + código)*
9. **Bloqueio por recurso e plano** no AgendaPro (usar `ag_provider_has_plan`). *(Código)*
10. **Fazer o AgendaPro operável pela profissional**: `provider.js` aceitar POST autenticado, serviços/horários/depósito sem `ADMIN_SECRET`, `AgendaApp` sair do demo. *(Código)*
11. **Lembretes reais**: e-mail via Resend agora (cron já existe); WhatsApp/SMS depois (conta Z-API ou Twilio + consentimento). *(Código + conta)*
12. **Checkout dos planos Pro do diretório** + webhook + limites do Free. *(Stripe + código)*
13. **Corrigir fluxos quebrados**: `/negocio/:slug` (criar `profile.html`), fotos na view pública, `/api/events/list`, `SHOW_BUSINESS` no app. *(Código)*
14. **IDs de afiliado**: cadastrar em Partnerize/Impact/Awin/Travelpayouts e preencher `AFFILIATE_*_LINK`; usar marker em `flights/search`. *(Contas + env)*
15. Autenticar `upload.js`, `request-review.js`, `onboard.js` (JWT) e reduzir o que `provider?email=` devolve. *(Código)*
16. Avisos: e-mail ao dono em pedido/agendamento novo; e-mail ao admin em cadastro novo. *(Código)*

### P2 · 1–3 meses (produto e escala)
17. Comentários + detalhe do post (destrava as notificações), RSVP na web, DMs.
18. Admin com login Supabase + papel admin; tela para `featured`/`verified`; auditoria de ações.
19. Migrations versionadas; remover `DISABLE ROW LEVEL SECURITY` do repo; criar `increment_geocode_hits`.
20. Analytics + Sentry + alerta de cron; **banner de cookies antes de GA4/Pixel**; política de privacidade atualizada (push, WhatsApp, pedidos, exclusão de conta).
21. App Expo: corrigir domínio da API, `eas.json`, contas Apple/Google, push; publicar.
22. Patrocínio self-service (Stripe Billing) e mídia kit; Enterprise com oferta/preço.
23. Loja: amostras, fotos, checkout. Grupos de interesse: decidir modelo pago e avisar quando abrir.
24. OG image em PNG; sitemap com `/loja` e `/indique`; revisar `noindex` de `planos` e `indique`.

---

## F. Decisões que só você pode tomar
1. Comissão nos pedidos: **0%** (como prometido) ou **2,5%** (como codificado)?
2. Tabela de preços única: Premium $29 ou $79? AgendaPro Pro $39 ou $49?
3. Depósito do AgendaPro: repasse integral ao profissional ou a plataforma fica com uma parte?
4. Indicação: manter o gift card de US$10 antes de haver receita de afiliado?
5. Grupos de interesse: pago ou grátis?
6. Bolão: arquivar ou nova edição?
7. Lembretes: WhatsApp (Z-API) ou SMS (Twilio)? Ambos exigem consentimento e custo por mensagem.

## G. O que este relatório não conseguiu ver
- Variáveis configuradas no Vercel (403 no conector). Se reautorizar o conector, dá para cruzar com o inventário acima.
- Painéis do Stripe (webhook de Connect), Resend (domínio verificado) e Supabase Auth (provider Google).
- Se os crons de fato falham: não disparei o endpoint para não enviar e-mail real. Conferir em Vercel → Cron Jobs.
- A alegação inicial de que qualquer um editaria o perfil de outro usuário **foi verificada e descartada**: as escritas exigem token.
