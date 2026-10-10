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
   Storage (bucket `uploads`, pastas `providers/<user_id>` e
   `receipts/<user_id>`) e, com "Apagar também meu login BrasilConnect" (vem
   marcado), o login some de Authentication → Users. A Apple testa isso.
3. **Disponibilidade só nos EUA** nas duas lojas (veja abaixo).
4. **Build de produção** com `EXPO_PUBLIC_EXTERNAL_PURCHASE=1` (já é o padrão do
   `eas.json`).
5. **Política de privacidade e página de exclusão no ar** (depois do deploy do
   site): https://brasilconnectusa.com/privacidade (seção 11, "App AgendaPro":
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

SUBSCRIPTIONS AND PAYMENTS (3.1.1)
The app has no in-app purchases. Subscriptions (Starter US$19, Pro US$39, Premium US$79 per month) are sold on our website, brasilconnectusa.com, through Stripe. The app is available only on the United States storefront, where apps may include buttons and links to external purchasing. The "Ver planos" / "Assinar" button opens our website in the browser. Payment of appointment deposits happens between the professional's clients and the professional (Zelle, cash, or the professional's own Stripe account), outside the app.

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

- **Apple (EUA):** desde maio de 2025, apps no storefront dos Estados Unidos
  podem ter botão e link para comprar fora do app (diretriz 3.1.1(a), depois da
  decisão Epic v. Apple), sem comissão. Por isso o app é publicado **só nos
  EUA** e o botão "Assinar" abre o checkout do Stripe no navegador.
- **Google Play (EUA):** desde o fim de outubro de 2025, por causa da decisão
  Epic v. Google, o Google Play passou a permitir link para pagamento fora do
  Play para usuários dos EUA. **Antes de enviar, confira no Play Console a regra
  em vigor** (Políticas → Pagamentos) e se é preciso declarar o link externo.
- **Como o app decide:** a variável de build `EXPO_PUBLIC_EXTERNAL_PURCHASE`
  (lida em `app.config.js` → `extra.externalPurchase` → `EXTERNAL_PURCHASE` em
  `lib/config.js`).
  - `1` (padrão, builds dos EUA): a tela de planos mostra o botão que abre o
    checkout no navegador.
  - `0`: some o botão e o link do portal; a tela de planos mostra só um texto
    ("Para assinar ou mudar de plano, entre na sua conta pelo site do
    BrasilConnect…"). Use `0` se a revisão pedir compra dentro do app.
    **Atenção:** fora dos EUA a Apple também não aceita texto que mande assinar
    no site (regra anti-steering). Para publicar em outros países, esse texto
    precisa ficar neutro (só o status do plano, sem convite) ou o app precisa de
    compra pela Apple.
  - A variável vale para o build inteiro (não muda por país em tempo de
    execução); por isso a disponibilidade fica restrita aos EUA.
- **Plano B, se a Apple exigir compra dentro do app:** gerar build com
  `EXPO_PUBLIC_EXTERNAL_PURCHASE=0` (o app passa a só mostrar o que a conta já
  tem, como um app "companion") ou implementar assinatura pela Apple (StoreKit,
  com comissão de 15% no Small Business Program). Decisão do dono.

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
