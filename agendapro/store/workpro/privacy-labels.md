# WorkPro — privacidade nas lojas

Respostas para **App Privacy** (App Store Connect → App Privacy) e **Data safety**
(Play Console → App content → Data safety) do WorkPro, com base no que o app e
as APIs fazem. O WorkPro tem tudo o que o AgendaPro coleta
([`../privacy-labels.md`](../privacy-labels.md)) **mais** orçamentos, faturas,
tabela de preços, pedidos de orçamento, fotos do trabalho e a assinatura do
cliente na aprovação. As categorias marcadas são as mesmas do AgendaPro, com
observações novas. Se um recurso novo passar a coletar outro dado, atualize este
arquivo, as duas lojas e a política de privacidade (seção 11).

## Resumo

- **O que entra pelo app:** dados da conta do profissional (nome, e-mail,
  telefone, cidade), dados da empresa que ele preenche (razão social, número de
  licença, endereço comercial, telefone, site, seguro), tabela de preços, dados
  dos clientes que ele registra (nome, telefone, e-mail, endereço, endereço da
  obra, observações), orçamentos e faturas (itens, valores, desconto, imposto,
  condições, recado, anotação interna), pagamentos que ele registra (valor,
  forma, data), fotos do trabalho anexadas aos documentos, agendamentos, status
  do plano e o token de notificação do aparelho.
- **O que entra pela web e aparece no app** (coletado nas páginas do site, não
  no app, mas declarado por cautela nas mesmas categorias):
  - **pedido de orçamento** feito pelo cliente final na página pública do
    profissional: nome, telefone, e-mail, endereço, o que precisa, descrição,
    data preferida, idioma e até 3 fotos; o IP vira um hash (anti-abuso), nunca
    o IP cru;
  - **aprovação do orçamento** na página `/d/<token>`: nome digitado, assinatura
    desenhada (imagem), data, IP e navegador do aparelho (registro da aprovação);
  - **pagamento online da fatura** (plano Pro): o cartão é digitado no checkout
    do Stripe, na conta Stripe do profissional; nós só recebemos o aviso de pago
    (valor e data), nunca o número do cartão.
- **Não coleta:** localização por GPS, contatos do celular, eventos do calendário
  (o app só **escreve** os compromissos no calendário do aparelho), Face ID ou
  digital (ficam no aparelho), número de cartão, dados de uso ou de falhas (sem
  SDK de analytics nem de crash).
- **Não rastreia** (sem IDFA, sem SDK de anúncios, sem cruzar dados com outras
  empresas) e **não vende** dados.
- **Tudo ligado à conta** do profissional, usado só para o app funcionar.
- **Criptografia em trânsito:** sim, todas as chamadas são HTTPS.
- **Exclusão:** no app (Mais → Configurações → Excluir conta), na hora: cancela a
  assinatura, apaga os dados (inclusive documentos, tabela de preços, pedidos de
  orçamento e assinaturas guardadas), as fotos do Storage e, com a opção marcada
  por padrão, o login BrasilConnect. Sem o app:
  https://brasilconnectusa.com/excluir-conta.html (até 30 dias).

Quem processa os dados por nós (operadores, não contam como "compartilhamento"):
Supabase (banco, login e fotos), Vercel (APIs e páginas), Stripe (assinatura e
pagamento online da fatura, no site), Resend (e-mail do documento, cobrança
automática e avisos), Expo Push Service + Apple APNs + Google FCM (notificações).

Quem vê o quê:
- **Fotos do trabalho** anexadas a um orçamento ou fatura aparecem para quem tem
  o link do documento (o cliente). Não ficam no diretório nem na página pública
  (a galeria da página é outro recurso). O app deve avisar ao anexar.
- **Link do documento** (`/d/<token>`): token longo e aleatório, sem campos
  internos (anotação interna e histórico não aparecem), página com noindex.
- **Assinatura do cliente:** só o profissional dono do documento vê no app (no
  detalhe do orçamento); a página pública mostra só que foi aprovado, por quem e
  quando.

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
| Contact Info | Name | **Sim** | Profissional, clientes, quem pede orçamento, nome digitado na aprovação |
| Contact Info | Email Address | **Sim** | Login; e-mail dos clientes (envio do documento e cobrança) |
| Contact Info | Phone Number | **Sim** | Profissional, empresa e clientes |
| Contact Info | Physical Address | **Sim** | Endereço comercial, endereço do cliente e da obra |
| Contact Info | Other User Contact Info | Não | |
| Health & Fitness | — | Não | |
| Financial Info | Payment Info | Não | Cartão só no checkout do Stripe, no navegador do cliente |
| Financial Info | Credit Info | Não | |
| Financial Info | Other Financial Info | **Sim** | Valores de orçamentos e faturas, pagamentos registrados, despesas, milhagem |
| Location | Precise / Coarse Location | Não | Sem GPS; endereços são digitados |
| Sensitive Info | — | Não | A assinatura desenhada não é dado biométrico no sentido da Apple (rosto/digital); fica em "Other User Content" |
| Contacts | — | Não | O app não lê a agenda de contatos do celular |
| User Content | Emails or Text Messages | Não | O WhatsApp sai do celular do próprio usuário; o e-mail do documento é gerado pelo servidor com o conteúdo do documento (já declarado) |
| User Content | Photos or Videos | **Sim** | Fotos do trabalho nos documentos, fotos dos pedidos de orçamento, foto do perfil/logo |
| User Content | Audio Data | Não | |
| User Content | Gameplay Content | Não | |
| User Content | Customer Support | Não | Suporte por e-mail, fora do app |
| User Content | Other User Content | **Sim** | Orçamentos, faturas, itens e condições, tabela de preços, pedidos de orçamento, assinatura do cliente na aprovação, agendamentos, observações |
| Browsing History | — | Não | |
| Search History | — | Não | A busca de clientes e documentos não é guardada |
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
| Delete account URL (campo obrigatório) | https://brasilconnectusa.com/excluir-conta.html |

### Tipos de dado

Para todos os itens marcados: **Collected = Yes, Shared = No**, não é processado
de forma efêmera. "Required/Optional" e finalidades conforme a tabela.

| Categoria | Tipo | Coleta | Obrigatório? | Finalidades |
|---|---|---|---|---|
| Personal info | Name | Sim | Obrigatório | App functionality, Account management |
| Personal info | Email address | Sim | Obrigatório | App functionality, Account management |
| Personal info | User IDs | Sim | Obrigatório | App functionality, Account management |
| Personal info | Address | Sim | Opcional | App functionality (empresa, cliente, obra) |
| Personal info | Phone number | Sim | Opcional | App functionality |
| Personal info | Race, political, religion, sexual orientation, other | Não | | |
| Financial info | User payment info | Não | | Cartão só no checkout do Stripe, no navegador |
| Financial info | Purchase history | Sim | Obrigatório | App functionality (plano da assinatura) |
| Financial info | Credit score | Não | | |
| Financial info | Other financial info | Sim | Opcional | App functionality (orçamentos, faturas, pagamentos registrados, despesas) |
| Health and fitness | — | Não | | |
| Messages | Emails, SMS, other in-app messages | Não | | O app não lê mensagens; o e-mail do documento é gerado pelo servidor |
| Photos and videos | Photos | Sim | Opcional | App functionality (fotos do trabalho, fotos dos pedidos de orçamento, perfil) |
| Photos and videos | Videos | Não | | |
| Audio | — | Não | | |
| Files and docs | — | Não | | O PDF do documento é gerado no aparelho a partir de dados já declarados |
| Calendar | Calendar events | Não | | O app escreve no calendário do aparelho; nada vai pro servidor |
| Contacts | — | Não | | |
| App activity | Other user-generated content | Sim | Opcional | App functionality (documentos, tabela de preços, pedidos, assinatura do cliente) |
| App activity | App interactions, search history, installed apps, other actions | Não | | |
| Web browsing | — | Não | | |
| App info and performance | Crash logs, diagnostics, other | Não | | |
| Device or other IDs | Device or other IDs | Sim | Opcional | App functionality (notificações) |
| Location | — | Não | | |

### Compartilhamento

"Shared" = **No** em tudo. Pelas regras do Google, não contam como
compartilhamento: operadores que processam em nosso nome (lista no resumo) e
transferências que o próprio usuário inicia (mandar o orçamento ou a fatura pro
cliente por WhatsApp, e-mail ou link; abrir o WhatsApp com a mensagem pronta).

### Financial features (App content)

Declaração separada do Data safety: o app **não** oferece serviço financeiro
(não guarda nem movimenta dinheiro; registra pagamentos e gera link de pagamento
hospedado pelo Stripe na conta do próprio profissional). Confira as opções em
vigor no Play Console antes de responder.

---

## Onde a política de privacidade cobre cada ponto

`public/privacidade.html`, seção 11 "Apps AgendaPro e WorkPro (para
profissionais)" (`/privacidade#agendapro`), e a página
`public/excluir-conta.html`:

1. Dados dos clientes que o profissional cadastra; ele é o responsável
   (controlador) e nós o operador → "Dados das suas clientes".
2. Orçamentos, faturas e o link do documento; quem vê o quê → "Orçamentos e
   faturas (WorkPro)".
3. Assinatura do cliente na aprovação (nome, desenho, data, IP, navegador) → idem.
4. Pedidos de orçamento pela página pública (dados e fotos do cliente, IP em
   hash) → idem.
5. Fotos do trabalho nos documentos (visíveis pra quem tem o link) → "Fotos".
6. Pagamento online da fatura pelo Stripe, sem o número do cartão → "Orçamentos
   e faturas (WorkPro)" e "Quem processa esses dados por nós".
7. Token de notificação, Face ID, calendário, câmera → "O que o app usa do seu
   celular".
8. Exclusão pelo app e o que é apagado (inclui documentos e pedidos) →
   `/privacidade#agendapro-excluir`; sem o app → `/excluir-conta.html`.

Se algo mudar (dado novo, operador novo, outro caminho de exclusão), atualize a
seção 11, a `excluir-conta.html` e as respostas acima.
