# WorkPro — notas para a revisão da Apple e do Google

Este arquivo tem: (1) o que o dono precisa preparar antes de enviar, (2) o texto
pronto, em inglês, para colar em **App Review Information → Notes** (Apple) e em
**App content → App access** (Google Play), e (3) os pontos que costumam dar
rejeição e como o app responde a cada um.

O WorkPro é o segundo app do projeto `agendapro/` (`APP_VARIANT=workpro`,
bundle id `com.brasilconnect.workpro`). Muita coisa vale igual ao AgendaPro
(veja [`../review-notes.md`](../review-notes.md)); aqui está o que muda.

Nunca coloque senha neste repositório. Usuário e senha da conta de demonstração
vão **só** nos campos da App Store Connect e do Play Console.

---

## Nome do app

Existe a marca de ferramentas **WORKPRO** nos Estados Unidos (ferramentas
manuais e elétricas, vendidas no varejo americano). É outra categoria de
produto, mas o público é parecido (quem trabalha com obra e reparo), então o
risco de confusão existe. Também pode haver apps com nome parecido nas lojas.

- A App Store não aceita dois apps com o mesmo nome — por isso a sugestão de
  nome na loja é "WorkPro BrasilConnect".
- Risco de marca: mesmo com o sufixo, o dono da marca pode reclamar com a Apple
  ou o Google e o app sai do ar até resolver.

**Decisão do dono:** consultar um advogado de marcas (busca no USPTO nas classes
de software, 9 e 42, e na de ferramentas, 8) **antes da primeira publicação**.
Trocar o nome depois custa caro (ícone, textos, página, avaliações). Se trocar,
o nome muda em:
- `app.config.js` → `VARIANTS.workpro` (`name`, e se quiser `slug`/`scheme`);
- `lib/variant.js` → `BRANDS.workpro.name`;
- `scripts/make-icons.py` → `STYLES['workpro']['title']` (arte do Google Play) e
  rodar `python scripts/make-icons.py workpro`;
- `store/workpro/*`, `public/para/workpro/index.html`, `public/para/index.html`,
  `public/privacidade.html` (seção 11) e `docs/workpro.md`.

O bundle id `com.brasilconnect.workpro` não aparece pra ninguém e pode ficar.

---

## Antes de enviar (checklist do dono)

1. **Backend no ar**: migration `supabase/ag_app_documents.sql` aplicada (depois
   das `ag_app_*` anteriores) e publicadas as rotas `api/agenda/documents.js`,
   `catalog.js`, `quote-requests.js`, `doc-public.js`, o cron
   `api/cron/agenda-documents.js` e a página `public/doc.html` com o rewrite
   `/d/:token` (já no `vercel.json`). Sem isso o app abre, mas Vendas dá erro.
2. **Conta de demonstração**
   - Crie pelo próprio app WorkPro (tela inicial → "Criar conta") com um e-mail
     que você controla, por exemplo `appreview-workpro@brasilconnectusa.com`, e
     uma senha forte gerada por você. Guarde no seu gerenciador de senhas. Não
     reaproveite a conta de demonstração do AgendaPro (o perfil é outro).
   - Se o Supabase estiver com "Confirm email" ligado, confirme o e-mail antes.
   - Complete o cadastro (nome fictício, por exemplo "Demo Handyman Services",
     especialidade Handyman).
   - Deixe o plano **ativo por 1 ano** (troque o e-mail):
     ```sql
     UPDATE public.ag_providers
        SET plan = 'premium', plan_status = 'active',
            current_period_end = now() + interval '1 year'
      WHERE owner_user_id = (SELECT id FROM auth.users WHERE email = 'appreview-workpro@brasilconnectusa.com');
     ```
   - Preencha dados **fictícios** (nunca de cliente real): Dados da empresa
     (nome, licença fictícia, endereço comercial genérico), 8 a 10 itens na
     Tabela de preços (o botão de exemplos da especialidade ajuda), 6 a 8
     clientes com nomes inventados, orçamentos em vários status (rascunho,
     enviado, aprovado, recusado), faturas paga, parcial e vencida, alguns
     agendamentos de visita técnica nesta semana e 1 pedido de orçamento feito
     pelo formulário da página pública. Esses dados servem também para as
     capturas ([`screenshots-plan.md`](screenshots-plan.md)).
   - **Não conecte o Stripe** na conta de demonstração (o build de loja usa as
     chaves de produção). Sem Stripe, a página da fatura mostra só as instruções
     de pagamento manual — isso está explicado no texto para a Apple.
3. **Exclusão de conta**: numa conta descartável (não na de demonstração),
   confira Mais → Configurações → Excluir conta de ponta a ponta: assinatura
   cancelada, dados `ag_*` apagados **incluindo** `ag_documents`,
   `ag_document_items`, `ag_document_events`, `ag_catalog_items`,
   `ag_quote_requests` e `ag_doc_counters` (lista `DELETE_ORDER` em
   `api/agenda/me.js`), fotos removidas do Storage (bucket `uploads`: fotos do
   trabalho em `providers/<user_id>`, fotos dos pedidos de orçamento em
   `requests/<provider_id>`) e, com a opção marcada (padrão), o login removido.
   A Apple testa isso.
4. **Página do documento no ar**: abra um link `https://brasilconnectusa.com/d/<token>`
   de um orçamento da conta de demonstração no Safari e no Chrome do Android,
   aprove com assinatura e confira que o status muda no app. O revisor faz esse
   caminho.
5. **Disponibilidade só nos EUA** nas duas lojas.
6. **Build de produção** do WorkPro: `eas build -p all --profile production-workpro`
   (sai em modo companheiro: `EXPO_PUBLIC_PURCHASE_MODE_IOS/ANDROID=companion`
   no `eas.json`). Envio: `eas submit --profile production-workpro` com
   `APP_VARIANT=workpro` no terminal (veja o README, seção "Dois apps").
7. **Política de privacidade e página de exclusão no ar**:
   https://brasilconnectusa.com/privacidade (seção 11 cobre AgendaPro e WorkPro:
   documentos, assinatura do cliente, pedidos de orçamento, fotos do trabalho) e
   https://brasilconnectusa.com/excluir-conta.html. Respostas das lojas em
   [`privacy-labels.md`](privacy-labels.md).
8. **Conferir os nomes dos botões** citados no texto abaixo no build final
   (ex.: "Enviar", "Registrar pagamento") e ajustar se mudaram.
9. **Nenhum "AgendaPro" escrito fixo nas telas do WorkPro.** Telas
   compartilhadas (Configurações, Meu plano, Perfil, Link e QR code, Equipe,
   Mais, avisos de permissão) devem usar `BRAND.name` de `lib/variant.js`.
   Busca rápida: `grep -rn "AgendaPro" app components lib --include=*.js`. Um
   revisor que vê "AgendaPro" dentro do WorkPro reforça a leitura de app
   duplicado (4.3).

---

## Texto para colar — Apple (App Review Information → Notes)

Em "Sign-in required", marque a opção e preencha usuário e senha da conta de
demonstração. No campo **Notes**, cole:

```
WorkPro is an estimate, invoice and scheduling app for independent service professionals working in the United States (construction and remodeling, handyman, carpenters, painters, electricians, plumbers, certified translators, accountants), most of them Brazilian immigrants. The interface is in Brazilian Portuguese; the estimates and invoices sent to clients can be in English, Portuguese or Spanish.

WorkPro shares the account system and backend with our other app, AgendaPro, but it is a different product for a different audience: AgendaPro is client self-booking for beauty and cleaning professionals; WorkPro is estimates, client approval with e-signature and invoicing for trades and professional services, with its own home tabs, onboarding and features.

DEMO ACCOUNT
Use the credentials in the Sign-In Information fields. On the first screen keep "Entrar" selected and sign in with email and password. The demo account has an active Premium plan, so every feature is unlocked, and it contains fictional clients, estimates and invoices. You can also create a new account ("Criar conta"): new accounts get a 14-day free trial with all features, and no payment information is requested.

WHERE THINGS ARE
- Hoje (Today): today's jobs and money to collect.
- Agenda: day/week calendar of site visits and jobs.
- Vendas (Sales): estimates ("Orcamentos") and invoices ("Faturas"); the + button creates a new one.
- Clientes: client list and client profile with history.
- Mais (More): price book ("Tabela de precos"), quote requests ("Pedidos de orcamento"), business details ("Dados da empresa"), finances, plan and settings.

HOW TO TEST AN ESTIMATE
1. Vendas > + > Orcamento. Pick a client, add items from the price book and save.
2. Tap "Enviar" (Send) and choose the link option to copy or share the client link.
3. Open the link in Safari (https://brasilconnectusa.com/d/...). This is the web page the client sees: approve it by typing a name and signing with your finger, or decline it.
4. Back in the app, the estimate shows as approved. Turn it into an invoice ("fatura") and record a payment ("Registrar pagamento"), for example Zelle or cash.

SUBSCRIPTIONS AND PAYMENTS
The app has no in-app purchases, no prices, no purchase buttons and no links to buy anything. The plan screen only shows the current plan and what each plan includes; the subscription, if any, is managed in the user's BrasilConnect account outside the app.
Invoices are for real-world services performed outside the app (construction, repairs, translations...), guideline 3.1.3(e). The professional's client pays the professional directly: by Zelle, cash or check, recorded manually in the app, or, if the professional connected her own Stripe account (Pro plan), by card on the public invoice web page in the browser. The demo account has no Stripe account connected, so the card button does not appear there.

ACCOUNT DELETION (5.1.1(v))
Mais > Configuracoes > Excluir conta. After typing EXCLUIR to confirm, the deletion happens immediately: any active subscription is canceled, the professional profile and all of its data (clients, appointments, estimates, invoices, price book, quote requests, finances) are deleted, the photos the user uploaded are removed from storage, and the login itself is deleted too. Deleting the login is checked by default; because the same login is shared with our website, brasilconnectusa.com, and our AgendaPro app, the user may uncheck it to keep using them. Users who no longer have the app can request deletion as explained at https://brasilconnectusa.com/excluir-conta.html

PERMISSIONS
- Camera and photos: before/after job photos on estimates and invoices, and the profile photo or logo.
- Notifications: optional alerts when a client views, approves or declines an estimate, when an invoice is paid and when a new quote request arrives.
- Calendar: optional. The app writes the user's own jobs to the device calendar. Calendar data is not sent to our servers.
- Face ID: optional app lock that the user turns on in Settings. Biometric data never leaves the device.

OTHER
Email/password and email code sign-in only (no third-party login). No ads and no tracking. Client records and documents are entered by the professional to run her business. The client's approval signature is drawn by the client on the public web page, not in the app; the app only displays it to the professional.

Contact: oi@brasilconnectusa.com
```

> O texto acima pressupõe que a rota `POST /api/agenda/me { action: 'delete_account' }`
> apaga também as tabelas de documentos e as fotos dos documentos (entrega
> docs-api, `api/agenda/me.js`). Se não apagar, corrija antes de enviar — a Apple
> entende "excluir conta" como apagar tudo, inclusive o login.

## Texto para colar — Google Play (App content → App access)

Marque "All or some functionality is restricted" e crie uma instrução com o
e-mail e a senha da conta de demonstração. Em "Any other information", cole:

```
Sign in on the first screen with email and password ("Entrar"). The demo account has an active Premium plan, so every feature is unlocked. New accounts get a 14-day free trial with all features and no payment details. Estimates and invoices: Vendas tab, + button. The client link (https://brasilconnectusa.com/d/...) opens the web page where the client approves with a signature. Account deletion: Mais > Configuracoes > Excluir conta (immediate; deletes the data, the uploaded photos and, by default, the login). Without the app: https://brasilconnectusa.com/excluir-conta.html The interface is in Brazilian Portuguese.
```

---

## Pontos de atenção na revisão

### Dois apps do mesmo código (Apple 4.3 / Google "Repetitive content")

A Apple rejeita "vários bundle ids do mesmo app" (diretriz 4.3, spam) e o
Google tem regra parecida (conteúdo repetitivo). O WorkPro e o AgendaPro saem do
mesmo projeto, então:

- o WorkPro precisa **parecer e funcionar** como outro produto: abas próprias
  (Hoje, Agenda, **Vendas**, Clientes, Mais), cadastro com especialidades de obra
  e serviço técnico, ícone e cor próprios, e o centro do app em orçamento e
  fatura (não em agendamento online);
- o texto para a Apple já explica a diferença no segundo parágrafo;
- capturas e descrição não podem repetir as do AgendaPro;
- se mesmo assim a Apple recusar por 4.3, o plano B é responder no Resolution
  Center mostrando as telas exclusivas (Vendas, orçamento, página de aprovação)
  e, em último caso, publicar só um app com as duas especialidades.

### Assinatura e pagamentos

- **Modo companheiro** (padrão de loja, `EXPO_PUBLIC_PURCHASE_MODE_IOS/ANDROID=companion`,
  lido em `lib/config.js` → `PURCHASE_MODE`): sem preço, sem botão de compra,
  sem "assine no site". A tela "Meu plano" mostra o plano atual e o que cada
  plano inclui, sem preço.
  O cadeado (`components/Locked.js`) também não convida a comprar nesse modo.
- **Argumento:** diretriz 3.1.3(f) (app gratuito companheiro de uma ferramenta
  paga). Atenção: hoje orçamentos e faturas **só existem no app** (o painel web
  ainda não tem documentos), o que enfraquece o "companheiro de ferramenta web".
  A base mais firme é a regra do **storefront dos EUA** (3.1.1(a), desde maio de
  2025: link e botão para compra fora do app permitidos) — por isso o app sai
  **só nos EUA**. Se a Apple insistir, as opções são: modo `link` (só EUA),
  painel web de documentos ou assinatura pela Apple (StoreKit). Decisão do dono.
- **Pagamento de fatura** (cliente final → profissional) é pagamento de serviço
  feito no mundo real (3.1.3(e)): não pode e não precisa usar compra da Apple. O
  checkout é página do Stripe no navegador, na conta Stripe da própria
  profissional (Stripe Connect), recurso do plano Pro.
- **Google Play:** responda a declaração **Financial features** (App content)
  dizendo que o app não oferece serviço financeiro (ele não guarda nem movimenta
  dinheiro: registra pagamentos e gera link de pagamento hospedado pelo Stripe).
  Confira as opções em vigor no Play Console antes de responder.

### Página pública do documento (`/d/<token>`)

- O link é o único acesso do cliente: o token é longo e aleatório e funciona como
  senha. A página não mostra campos internos (anotação interna, histórico) e não
  deve ser indexada (noindex).
- O revisor abre esse link; ele precisa funcionar em Safari e Chrome no celular,
  com aprovação por assinatura, recusa com motivo e, se houver Stripe, o botão de
  pagar.
- Não escreva "validade jurídica garantida" em lugar nenhum (loja, app, página):
  a assinatura registra nome, data, IP e o desenho; o efeito legal depende do
  contrato e do estado.

### Exclusão de conta (Apple 5.1.1(v), Google "Data deletion")

Mesmo caminho do AgendaPro: Mais → Configurações → Excluir conta (na hora) e,
fora do app, https://brasilconnectusa.com/excluir-conta.html. No WorkPro a
exclusão precisa levar também documentos, tabela de preços, pedidos de orçamento
e as fotos deles (checklist, item 3).

### Login

Só e-mail com senha ou código por e-mail, igual ao AgendaPro. **Se um dia entrar
login com Google no app, Sign in with Apple passa a ser obrigatório (4.8).**

### Permissões

| Permissão | Por quê | Quando pede |
|---|---|---|
| Câmera / fotos | Fotos de antes e depois no orçamento e na fatura; foto do perfil ou logo | Ao tocar em "adicionar foto" |
| Notificações | Orçamento visto, aprovado ou recusado; fatura paga; pedido de orçamento novo; agendamento novo | Depois do login (o ideal é uma frase explicando antes do pedido do sistema) |
| Calendário | Mandar os serviços pro calendário do celular | Quando liga a sincronização ou toca em "Adicionar ao calendário" |
| Face ID / digital | Trava opcional do app | Quando o usuário liga em Configurações |

Os textos de permissão do iOS do WorkPro estão em `app.config.js`
(`VARIANTS.workpro.photosText` e `cameraText`, mais os de calendário e Face ID
com o nome do app).

### Marcas de terceiros

Zelle, Venmo, Stripe e WhatsApp só aparecem na descrição, de forma descritiva e
com aviso de que não há vínculo. Não use essas marcas (nem WORKPRO estilizado
como a marca de ferramentas) no ícone, no subtítulo, nas palavras-chave ou nas
capturas em destaque.

### Conta pessoal no Google Play

Conta de desenvolvedor **pessoal** precisa de **teste fechado com pelo menos 12
testadores por 14 dias seguidos** antes da produção — **para cada app novo**,
então o WorkPro faz o seu próprio teste fechado. Conta de **organização**
(D-U-N-S) não tem essa exigência.
