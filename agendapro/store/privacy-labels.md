# AgendaPro — privacidade nas lojas

Respostas para **App Privacy** (App Store Connect → App Privacy) e **Data safety**
(Play Console → App content → Data safety), com base no que o app e as APIs
fazem hoje. Se um recurso novo passar a coletar outro dado (por exemplo,
importar contatos do celular ou usar GPS na milhagem), atualize este arquivo, as
duas lojas e a política de privacidade.

## Resumo

- **O que entra:** dados da conta da profissional (nome, e-mail, telefone,
  cidade), dados do negócio que ela cadastra (serviços, preços, horários), dados
  das clientes que ela registra (nome, telefone, e-mail, endereço da casa,
  observações, aniversário), agendamentos, fotos que ela envia, registros
  financeiros que ela lança (pagamentos, gorjetas, despesas, milhas), status do
  plano e o token de notificação do aparelho.
- **Não coleta:** localização por GPS, contatos do celular, eventos do calendário
  (o app só **escreve** os agendamentos dela no calendário do aparelho), dados de
  Face ID ou digital (ficam no aparelho), número de cartão (o pagamento é no site,
  pelo Stripe), dados de uso ou de falhas (não há SDK de analytics nem de crash).
- **Não rastreia** (sem IDFA, sem SDK de anúncios, sem cruzar dados com outras
  empresas) e **não vende** dados.
- **Tudo ligado à conta** da profissional, usado só para o app funcionar.
- **Criptografia em trânsito:** sim, todas as chamadas são HTTPS.
- **Exclusão:** no app (Mais → Configurações → Excluir conta), na hora: cancela a
  assinatura, apaga os dados do AgendaPro, as fotos do Storage (perfil, galeria,
  comprovantes) e, com a opção marcada por padrão, o login BrasilConnect. Sem o
  app, por e-mail: https://brasilconnectusa.com/excluir-conta.html (até 30 dias).

Quem processa os dados por nós (operadores, não contam como "compartilhamento"
nas duas lojas): Supabase (banco, login e armazenamento das fotos), Vercel (APIs),
Stripe (assinatura e sinal no cartão, no site), Resend (e-mails de confirmação e
lembrete), Expo Push Service + Apple APNs + Google FCM (entrega das notificações).

Fotos enviadas para a página pública e a galeria ficam **públicas** (é o
objetivo); a política de privacidade já avisa (seção 11) e a tela de envio
também deve avisar.

---

## Apple — App Privacy

**"Do you or your third-party partners collect data from this app?"** → Yes.

Para cada tipo marcado abaixo, as respostas são as mesmas:
- Uso: **App Functionality** (só isso — não marque Analytics, Advertising nem
  Product Personalization).
- **Linked to the user's identity:** Yes.
- **Used for tracking:** No.

| Categoria | Tipo de dado | Coleta? | Observação |
|---|---|---|---|
| Contact Info | Name | **Sim** | Nome da profissional e das clientes que ela cadastra |
| Contact Info | Email Address | **Sim** | Login e e-mail das clientes (confirmação e lembrete) |
| Contact Info | Phone Number | **Sim** | WhatsApp da profissional e das clientes |
| Contact Info | Physical Address | **Sim** | Cidade/estado do negócio; endereço da casa da cliente (limpeza) |
| Contact Info | Other User Contact Info | Não | |
| Health & Fitness | — | Não | |
| Financial Info | Payment Info | Não | Cartão só no checkout do Stripe, no navegador |
| Financial Info | Credit Info | Não | |
| Financial Info | Other Financial Info | **Sim** | Pagamentos, gorjetas, despesas, milhagem, meta |
| Location | Precise / Coarse Location | Não | Sem GPS; cidade é digitada |
| Sensitive Info | — | Não | |
| Contacts | — | Não | O app não lê a agenda de contatos do celular |
| User Content | Emails or Text Messages | Não | Mensagens saem pelo WhatsApp da própria usuária |
| User Content | Photos or Videos | **Sim** | Foto do perfil e galeria (públicas na página) |
| User Content | Audio Data | Não | |
| User Content | Gameplay Content | Não | |
| User Content | Customer Support | Não | Suporte é por e-mail, fora do app |
| User Content | Other User Content | **Sim** | Agendamentos, observações das clientes, modelos de mensagem, respostas às avaliações |
| Browsing History | — | Não | |
| Search History | — | Não | A busca de clientes não é guardada |
| Identifiers | User ID | **Sim** | ID da conta |
| Identifiers | Device ID | **Sim** | Token de notificação (declarado por cautela) |
| Purchases | Purchase History | **Sim** | Plano e status da assinatura |
| Usage Data | — | Não | Sem analytics |
| Diagnostics | — | Não | Sem SDK de crash |
| Surroundings / Body | — | Não | |
| Other Data | — | Não | |

**Privacy Policy URL:** https://brasilconnectusa.com/privacidade

---

## Google Play — Data safety

### Perguntas gerais

| Pergunta | Resposta |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Which of the following methods of account creation does your app support? | Username and password (e-mail e senha) + "Other" (código por e-mail) |
| Do you provide a way for users to request that their data is deleted? | Yes — no app e pela URL https://brasilconnectusa.com/excluir-conta.html |
| Delete account URL (campo obrigatório) | https://brasilconnectusa.com/excluir-conta.html (página só sobre o AgendaPro: caminho no app, pedido por e-mail, o que é apagado, prazo de até 30 dias e o que fica por obrigação legal) |

### Tipos de dado

Para todos os itens marcados: **Collected = Yes, Shared = No**, não é processado
de forma efêmera. "Required/Optional" e finalidades conforme a tabela.

| Categoria | Tipo | Coleta | Obrigatório? | Finalidades |
|---|---|---|---|---|
| Personal info | Name | Sim | Obrigatório | App functionality, Account management |
| Personal info | Email address | Sim | Obrigatório | App functionality, Account management |
| Personal info | User IDs | Sim | Obrigatório | App functionality, Account management |
| Personal info | Address | Sim | Opcional | App functionality |
| Personal info | Phone number | Sim | Opcional | App functionality |
| Personal info | Race, political, religion, sexual orientation, other | Não | | |
| Financial info | User payment info | Não | | |
| Financial info | Purchase history | Sim | Obrigatório | App functionality |
| Financial info | Credit score | Não | | |
| Financial info | Other financial info | Sim | Opcional | App functionality |
| Health and fitness | — | Não | | |
| Messages | Emails, SMS, other in-app messages | Não | | |
| Photos and videos | Photos | Sim | Opcional | App functionality |
| Photos and videos | Videos | Não | | |
| Audio | — | Não | | |
| Files and docs | — | Não | | |
| Calendar | Calendar events | Não | | O app escreve no calendário do aparelho; nada vai pro servidor |
| Contacts | — | Não | | |
| App activity | Other user-generated content | Sim | Opcional | App functionality |
| App activity | App interactions, search history, installed apps, other actions | Não | | |
| Web browsing | — | Não | | |
| App info and performance | Crash logs, diagnostics, other | Não | | |
| Device or other IDs | Device or other IDs | Sim | Opcional | App functionality (notificações) |
| Location | — | Não | | |

### Compartilhamento

"Shared" = **No** em tudo. Pelas regras do Google, não contam como
compartilhamento: operadores que processam em nosso nome (lista no resumo) e
ações que a própria usuária inicia (abrir o WhatsApp com a mensagem pronta,
mandar o link da página).

---

## Onde a política de privacidade cobre cada ponto

`public/privacidade.html`, seção 11 "App AgendaPro (para profissionais)"
(`/privacidade#agendapro`), atualizada em 09/10/2026, e a página
`public/excluir-conta.html`:

1. Dados das clientes que a profissional cadastra; ela é a responsável
   (controladora) e nós o operador → "Dados das suas clientes".
2. Foto do perfil e galeria são públicas; comprovantes de despesa não aparecem
   na página → "Fotos".
3. Token de notificação, para quê e como desligar → "O que o app usa do seu celular".
4. Face ID / digital só no aparelho, nada enviado → idem.
5. Calendário: o app só escreve os agendamentos, não lê nem envia outros eventos → idem.
6. Exclusão pelo app (Mais → Configurações → Excluir conta), o que é apagado
   (dados, fotos, login marcado por padrão) e a assinatura cancelada →
   `/privacidade#agendapro-excluir`; sem o app → `/excluir-conta.html`.
7. Operadores: Supabase, Vercel, Stripe, Resend, Expo/Apple/Google → "Quem
   processa esses dados por nós" (Expo também entrou na seção 4).

Se algo mudar no app (dado novo, operador novo, outro caminho de exclusão),
atualize a seção 11, a `excluir-conta.html` e as respostas acima.
