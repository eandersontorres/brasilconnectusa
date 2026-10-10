# AgendaPro — notas para a revisão da Apple e do Google

Este arquivo tem: (1) o que o dono precisa preparar antes de enviar, (2) o texto
pronto, em inglês, para colar em **App Review Information → Notes** (Apple) e em
**App content → App access** (Google Play), e (3) os pontos que costumam dar
rejeição e como o app responde a cada um.

Nunca coloque senha neste repositório. Usuário e senha da conta de demonstração
vão **só** nos campos da App Store Connect e do Play Console.

---

## Nome do app

Já existe uma empresa de software para salões chamada **AgendaPro** (Chile e
América Latina), com app nas duas lojas. Riscos:

- a App Store não aceita dois apps com o mesmo nome — por isso a sugestão de
  nome na loja é "AgendaPro BrasilConnect";
- risco de marca: mesmo com o sufixo, a outra empresa pode reclamar com a Apple
  ou o Google e o app sai do ar até resolver.

**Decisão do dono:** consultar um advogado de marcas ou trocar o nome do app
antes da primeira publicação (trocar depois custa caro: ícone, textos, página,
avaliações). Se trocar, o nome muda em `app.config.js` (`name`), nos textos de
`store/` e em `public/para/agenda-pro/index.html`.

---

## Antes de enviar (checklist do dono)

1. **Conta de demonstração**
   - Crie pelo próprio app (tela inicial → "Criar conta") com um e-mail que você
     controla, por exemplo `appreview@brasilconnectusa.com`, e uma senha forte
     gerada por você. Guarde no seu gerenciador de senhas.
   - Se o Supabase estiver com "Confirm email" ligado, confirme o e-mail antes.
   - Complete o cadastro do perfil (nome fictício, por exemplo "Studio Demo
     Boston", especialidade Cabeleireira).
   - Deixe o plano **ativo por 1 ano**, pra o teste grátis não acabar no meio da
     revisão. Rode no SQL Editor do Supabase (troque o e-mail):
     ```sql
     UPDATE public.ag_providers
        SET plan = 'premium', plan_status = 'active',
            current_period_end = now() + interval '1 year'
      WHERE owner_user_id = (SELECT id FROM auth.users WHERE email = 'appreview@brasilconnectusa.com');
     ```
   - Preencha dados de exemplo **fictícios** (nunca de cliente real): 4 ou 5
     serviços, horário de atendimento, 8 a 10 clientes com nomes inventados,
     agendamentos espalhados nesta semana e na próxima, 2 ou 3 despesas.
     Esses mesmos dados servem para as capturas de tela
     ([`screenshots-plan.md`](screenshots-plan.md)).
2. **Exclusão de conta**: confira que Mais → Configurações → Excluir conta
   funciona de ponta a ponta numa conta descartável (não na de demonstração):
   a assinatura do Stripe é cancelada, os dados `ag_*` somem, as fotos saem do
   Storage (bucket `uploads`, pastas `providers/<user_id>`, `receipts/<user_id>`
   e `requests/<provider_id>`) e, com "Apagar também meu login BrasilConnect" (vem
   marcado), o login some de Authentication → Users. A Apple testa isso.
3. **Disponibilidade só nos EUA** nas duas lojas (veja abaixo).
4. **Build de produção**: `eas build -p all --profile production`. Sai em modo
   companheiro (`EXPO_PUBLIC_PURCHASE_MODE_IOS` e `EXPO_PUBLIC_PURCHASE_MODE_ANDROID`
   = `companion` no `base` do `eas.json`): sem preço e sem botão de compra. Veja
   "Assinatura vendida pelo site" abaixo.
5. **Política de privacidade e página de exclusão no ar** (depois do deploy do
   site): https://brasilconnectusa.com/privacidade (seção 11, "Apps AgendaPro e WorkPro":
   dados das clientes, fotos, token de notificação, Face ID, calendário,
   exclusão pelo app, operadores) e https://brasilconnectusa.com/excluir-conta.html
   (pedido sem o app). Respostas das lojas em [`privacy-labels.md`](privacy-labels.md).

---

## Texto para colar — Apple (App Review Information → Notes)

Em "Sign-in required", marque a opção e preencha usuário e senha da conta de
demonstração. No campo **Notes**, cole:

```
AgendaPro is a scheduling and business app for independent beauty, wellness and cleaning professionals working in the United States, most of them Brazilian immigrants. The interface is in Brazilian Portuguese.

DEMO ACCOUNT
Use the credentials in the Sign-In Information fields. On the first screen, keep "Entrar" selected and sign in with email and password. The demo account has an active Premium plan, so every feature is unlocked. You can also create a brand-new account ("Criar conta"): new accounts get a 14-day free trial with all features, and no payment information is requested.

WHERE THINGS ARE
- Hoje (Today) tab: today's appointments and earnings.
- Agenda tab: day/week calendar; the + button creates an appointment.
- Clientes tab: client list and client profile with history.
- Financas tab: payments, expenses and monthly profit.
- Mais (More) tab: business profile, booking page link and QR code, services, working hours, plans and settings.

ACCOUNT DELETION (5.1.1(v))
Mais > Configuracoes > Excluir conta. After typing EXCLUIR to confirm, the deletion happens immediately: any active subscription is canceled, the professional profile and all of its data (clients, appointments, finances, reviews) are deleted, the photos the user uploaded are removed from storage, and the login itself is deleted too. Deleting the login is checked by default; because the same login is shared with our community website, brasilconnectusa.com, the user may uncheck it to keep using the website. Users who no longer have the app can request deletion as explained at https://brasilconnectusa.com/excluir-conta.html

SUBSCRIPTIONS AND PAYMENTS
The app has no in-app purchases, no prices, no purchase buttons and no links to buy anything. The plan screen ("Meu plano") only shows the current plan and what each plan includes; the subscription, if any, is managed in the user's BrasilConnect account outside the app (guideline 3.1.3(f)). Appointment deposits and service payments are for real-world services performed outside the app (guideline 3.1.3(e)): the professional's clients pay the professional directly (Zelle, cash, or by card on our booking web page, into the professional's own Stripe account), outside the app.

PERMISSIONS
- Face ID: optional app lock that the user turns on in Settings. Biometric data never leaves the device.
- Calendar: optional. The app creates and updates events for the user's own appointments in the device calendar. Calendar data is not sent to our servers.
- Notifications: optional alerts about new bookings, new reviews, a summary of the next day and billing notices.
- Photos and camera: to upload a profile photo and photos of the user's work to her public booking page.

OTHER
No third-party or social login (email/password and email code only). No ads and no tracking. Client records are entered by the professional to run her business.

Contact: oi@brasilconnectusa.com
```

> O texto acima descreve o app atual: a opção "Apagar também meu login
> BrasilConnect" vem **marcada** por padrão e a rota
> `POST /api/agenda/me { action: 'delete_account', confirm: 'EXCLUIR', also_login }`
> cancela a assinatura no Stripe, apaga os dados `ag_*`, as fotos do Storage
> (`providers` e `receipts`; com `also_login`, também as pastas do site) e, com
> `also_login`, o login. Se um dia a opção voltar a vir desmarcada, ajuste o
> texto — a Apple entende "excluir conta" como apagar o login também.

## Texto para colar — Google Play (App content → App access)

Marque "All or some functionality is restricted" e crie uma instrução com o
e-mail e a senha da conta de demonstração. Em "Any other information", cole:

```
Sign in on the first screen with email and password ("Entrar"). The demo account has an active Premium plan, so every feature is unlocked. New accounts get a 14-day free trial with all features and no payment details. Account deletion: Mais > Configuracoes > Excluir conta (immediate; deletes the data, the uploaded photos and, by default, the login). Without the app: https://brasilconnectusa.com/excluir-conta.html The interface is in Brazilian Portuguese.
```

---

## Pontos de atenção na revisão

### Assinatura vendida pelo site

A assinatura é vendida **só no site** (Stripe). O app não tem compra dentro dele
e, nos builds de loja, também não mostra preço nem manda assinar no site.

- **Como o app decide:** `PURCHASE_MODE` em `lib/config.js`, **por plataforma**,
  lido de `EXPO_PUBLIC_PURCHASE_MODE_IOS` e `EXPO_PUBLIC_PURCHASE_MODE_ANDROID`
  (`app.config.js` → `extra.purchaseModeIos` / `extra.purchaseModeAndroid`).
  Valor ausente ou inválido vira `companion`; no preview web é sempre `link`. As
  telas usam `EXTERNAL_PURCHASE` (= `PURCHASE_MODE === 'link'`).
  - `companion` (**padrão nas lojas**; o `base` do `eas.json` usa nos dois
    apps): app companheiro. Sem preço, sem botão de compra e sem "assine no
    site". A tela "Meu plano" mostra o plano ativo, o que cada plano inclui e o
    botão "Atualizar meu plano"; o cadeado (`components/Locked.js`) mostra "Ver o
    que cada plano inclui" e o aviso do plano (`components/PlanBanner.js`) só
    "Detalhes".
  - `link`: a tela mostra os preços, "Assinar o …" abre o checkout do Stripe no
    navegador (`POST /api/stripe/subscribe`), "Gerenciar assinatura" abre o
    portal (`POST /api/stripe/portal`) e aparece "Já assinei pelo site".
  - O modo vale para o build inteiro (não muda por país em tempo de execução);
    o app sai **só nos EUA**.
- **Por que `companion`** (análise completa em `docs/agendapro-ideias.md`,
  seção 4):
  - **Apple:** a diretriz 3.1.3(f) dispensa a compra pela Apple num app grátis
    que é companheiro de uma ferramenta paga, "desde que não haja compra dentro
    do app nem chamadas para compra fora dele" — risco baixo e sem comissão. O
    botão e o link para comprar fora são permitidos no storefront dos EUA
    (3.1.1(a), desde maio de 2025, depois da decisão Epic v. Apple), mas
    desenvolvedores relatam que a App Review ainda trata o link como complemento
    da compra pela Apple em apps que não são "leitores", e a disputa judicial
    sobre a comissão continua (a Suprema Corte aceitou revisar o caso em junho
    de 2026). Só link, sem compra pela Apple, é o caminho com mais relatos de
    rejeição. Usuária com Apple ID da loja do Brasil também não tem a exceção
    dos EUA.
  - **Google Play (EUA):** desde o fim de outubro de 2025 (decisão Epic v.
    Google), o Play permite link e cobrança fora do Play nos EUA, mas pelo
    programa *External content links*, com relatório e taxa desde 01/10/2026.
    Sem link e sem compra no app, não é preciso entrar no programa nem reportar
    transação. **Antes de enviar, confira no Play Console** (Políticas →
    Pagamentos) que um app só de acesso, com a conta paga na web, não exige
    inscrição.
- **Quando trocar para `link`:** no iOS, só com confirmação por escrito da App
  Review; no Android, depois de inscrever o app no *External content links* e
  prever a taxa. A troca é por plataforma, no perfil do `eas.json` (ex.:
  `EXPO_PUBLIC_PURCHASE_MODE_ANDROID=link`). Fora dos EUA o `link` não pode ser
  usado (regra anti-steering da Apple).
- **Plano B, se a Apple exigir compra dentro do app mesmo assim:** assinatura
  pela Apple (StoreKit, por exemplo com RevenueCat ou `expo-iap`, comissão de 15%
  no Small Business Program), com o link do site como opção extra nos EUA.
  Decisão do dono.
- O teste grátis de 14 dias criado no app, sem cartão, é permitido: é criação de
  conta grátis, não compra.

### Exclusão de conta (Apple 5.1.1(v), Google "Data deletion")

- No app: Mais → Configurações → Excluir conta. Na hora: cancela a assinatura,
  apaga os dados do AgendaPro e as fotos do Storage e, com a opção de login
  marcada (padrão), o login BrasilConnect.
- Fora do app (o Google exige um link na web, campo "Delete account URL" do Data
  safety): https://brasilconnectusa.com/excluir-conta.html — explica o caminho no
  app, o pedido por e-mail (assunto "Excluir conta AgendaPro", do e-mail
  cadastrado), o que é apagado, o prazo (até 30 dias) e o que fica por obrigação
  legal. A página precisa estar no ar (deploy do site) antes de enviar o app.

### Login

Só e-mail com senha ou código por e-mail. Sem Google/Facebook no app, então a
regra "Sign in with Apple obrigatório" (4.8) não se aplica. **Se um dia entrar
login com Google no app, Sign in with Apple passa a ser obrigatório.**

### Permissões

| Permissão | Por quê | Quando pede |
|---|---|---|
| Face ID / digital | Trava opcional do app | Quando a usuária liga em Configurações |
| Calendário | Mandar os agendamentos pro calendário do celular | Quando liga a sincronização ou toca em "Adicionar ao calendário" |
| Notificações | Agendamento novo, avaliação nova, resumo do dia seguinte, aviso de cobrança | Depois do login (o ideal é uma frase explicando antes do pedido do sistema) |
| Fotos / câmera | Foto do perfil e galeria do trabalho | Ao tocar em "trocar foto" ou "adicionar foto" |

Os textos de permissão do iOS estão em `app.config.js` (`ios.infoPlist` e
plugins). Todos em português e dizendo o motivo — a Apple rejeita texto genérico.

### Conteúdo gerado por usuário (Apple 1.2)

As avaliações são escritas pelas clientes no site e aparecem na página pública
da profissional. No app, a profissional vê e responde as avaliações que ela
mesma recebeu. Recomendado: permitir ocultar uma avaliação ofensiva e ter um
caminho de denúncia (e-mail de suporte), para não cair na exigência de
moderação da diretriz 1.2.

### Marcas de terceiros

Airbnb, Vrbo, Booking.com e WhatsApp só aparecem na descrição, de forma
descritiva e com aviso de que não há vínculo. Não use essas marcas no nome, no
subtítulo, nas palavras-chave nem nas capturas de tela em destaque.

### Conta pessoal no Google Play

Conta de desenvolvedor **pessoal** criada depois de novembro de 2023 precisa
rodar um **teste fechado com pelo menos 12 testadores por 14 dias seguidos**
antes de liberar a produção. Conta de **organização** (precisa de D-U-N-S) não
tem essa exigência. Planeje isso no cronograma.
