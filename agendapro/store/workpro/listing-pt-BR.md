# WorkPro — textos da loja (pt-BR)

Cole cada bloco no campo indicado da App Store Connect (localização
"Português (Brasil)") e do Google Play Console (idioma "Português (Brasil) – pt-BR").
Os limites de caracteres estão entre parênteses e foram conferidos.

O WorkPro é o segundo app do mesmo projeto do AgendaPro (`APP_VARIANT=workpro`,
bundle id `com.brasilconnect.workpro`): mesma conta, mesma assinatura e mesmo
backend. Cada app tem a sua ficha nas lojas.

> **Antes de publicar:** existe a marca de ferramentas **WORKPRO** nos EUA.
> Consulte um advogado de marcas antes da primeira publicação — veja
> [`review-notes.md`](review-notes.md#nome-do-app).

> **Modo da assinatura:** os builds de loja saem em modo **companheiro**
> (`EXPO_PUBLIC_PURCHASE_MODE_IOS/ANDROID=companion` no `eas.json`): o app não
> mostra preço nem botão de compra. Por isso a descrição abaixo fala dos planos
> **sem preço e sem convite para assinar**. Se um dia o build for para o modo
> `link`, use o bloco "Planos com preço" no fim deste arquivo.

---

## Nome do app (30) · App Store e Google Play

```
WorkPro BrasilConnect
```
(21 caracteres)

Alternativa, se o nome acima já estiver em uso na loja:

```
WorkPro: orçamento e fatura
```
(27 caracteres)

O nome que aparece embaixo do ícone no celular continua "WorkPro" (vem do
`app.config.js`).

## Subtítulo (30) · só App Store

```
Orçamento, fatura e agenda
```
(26 caracteres)

## Texto promocional (170) · só App Store

Pode ser trocado a qualquer hora, sem nova versão.

```
Conta nova tem 14 dias com tudo liberado, sem cartão. Orçamento aprovado com assinatura, fatura em PDF e link e cobrança automática, pro profissional brasileiro nos EUA.
```
(169 caracteres)

## Descrição curta (80) · só Google Play

```
Orçamento, fatura e agenda pro profissional brasileiro de serviços nos EUA
```
(74 caracteres)

## Palavras-chave (100) · só App Store

Separadas por vírgula, sem espaço. Não repita palavras do nome e do subtítulo
(a Apple já indexa "workpro", "orçamento", "fatura", "agenda") e não use marcas
de terceiros (Zelle, Stripe, WhatsApp…), que dão rejeição.

```
invoice,estimate,quote,handyman,reforma,construção,pintor,eletricista,encanador,marceneiro,recibo
```
(97 caracteres / 99 bytes)

## Descrição completa (até 4000) · App Store e Google Play

```
O WorkPro é o app de orçamento e fatura do profissional brasileiro de serviços nos Estados Unidos. Construção e reforma, handyman, marceneiro, pintor, eletricista, encanador, drywall, pisos, paisagismo, tradutor juramentado, contador: monte o orçamento na frente do cliente, mande pelo WhatsApp e receba a aprovação com assinatura, tudo pelo celular.

O app é em português. O orçamento e a fatura que o cliente recebe saem em inglês, português ou espanhol, do jeito que você escolher.

TESTE GRÁTIS DE 14 DIAS
Crie sua conta no app e use tudo liberado por 14 dias, sem cartão.

ORÇAMENTO EM MINUTOS
• Itens da sua tabela de preços: serviço, mão de obra, material e taxas
• Quantidade por hora, dia, ft², m², página, palavra, visita ou projeto
• Desconto, sales tax só nos itens tributáveis e entrada (deposit) pedida na aprovação
• Validade, condições, garantia e recado pro cliente
• Envie por WhatsApp, e-mail ou link
• O cliente abre no celular e aprova com assinatura na tela, ou recusa dizendo o motivo
• Aviso no seu celular quando o cliente abre, aprova ou recusa

FATURA (INVOICE) SEM PLANILHA
• Orçamento aprovado vira fatura em um toque
• Fatura em PDF e por link, com número em sequência e vencimento
• Registre pagamento por Zelle, dinheiro, cheque, Venmo ou cartão, inteiro ou em parte
• Veja quem pagou, quem está devendo e o que já venceu
• Fatura de entrada e por etapa da obra (Pro)

RECEBA MAIS RÁPIDO (PRO)
• O cliente paga a fatura no cartão pelo link e o dinheiro cai na sua conta Stripe
• Cobrança automática por e-mail quando a fatura vence, sem você precisar cobrar
• Fotos de antes e depois no orçamento e na fatura
• Documentos ilimitados (no Starter são 20 por mês)

PEDIDOS DE ORÇAMENTO
• Formulário na sua página pro cliente pedir orçamento, com fotos do serviço
• O pedido chega no app com aviso no celular e vira orçamento em um toque

AGENDA E CLIENTES
• Visitas técnicas e serviços na agenda do dia e da semana
• Ficha do cliente com endereço, histórico, orçamentos e faturas
• Mensagens prontas pro WhatsApp e lembrete por e-mail
• Seus compromissos no calendário do iPhone ou do Android

VENDAS NUM OLHAR
• Orçamentos em aberto, valor a receber, vencido e recebido no mês
• Quantos dos seus orçamentos são aprovados

DINHEIRO E EQUIPE
• Despesas, lucro do mês, milhagem e reserva pro imposto (Pro)
• Equipe de até 10 pessoas, relatórios e arquivo CSV pro contador (Premium)
• Orçamentos, faturas e página só com a sua marca (Premium)

SEGURANÇA E PRIVACIDADE
• Abra o app com Face ID ou digital
• Mesma conta do AgendaPro e do site BrasilConnect
• Exclua sua conta quando quiser, direto no app

PLANOS
• Starter: orçamentos e faturas (20 por mês), tabela de preços, pedidos de orçamento, agenda, clientes, página online, lembretes e mensagens prontas
• Pro: tudo do Starter + pagamento da fatura no cartão, cobrança automática, entrada e etapas, fotos no documento, documentos ilimitados, finanças e mensagens em inglês e espanhol
• Premium: tudo do Pro + equipe, relatórios, recibos em PDF e documentos sem a marca BrasilConnect

Sem comissão do BrasilConnect sobre o seu serviço. Se o plano não estiver ativo, você continua vendo seus clientes, orçamentos e faturas.

Dúvidas ou sugestões: oi@brasilconnectusa.com

Zelle, Venmo, Stripe e WhatsApp são marcas de seus respectivos donos. O WorkPro não tem vínculo com essas empresas.
```

## Novidades da versão 1.0 (4000)

```
Primeira versão do WorkPro! Orçamento com aprovação e assinatura do cliente, fatura em PDF e link, controle de quem pagou, tabela de preços, pedidos de orçamento pela sua página, agenda e clientes. Comece com 14 dias grátis, tudo liberado e sem cartão.
```

### Planos com preço (só se o build sair em modo `link`)

Troque o bloco PLANOS da descrição por este e acrescente a frase da assinatura.
Não use em modo companheiro (diretriz 3.1.3(f) da Apple: sem convite para
comprar fora do app).

```
PLANOS
• Starter (US$ 19/mês): orçamentos e faturas (20 por mês), tabela de preços, pedidos de orçamento, agenda, clientes, página online, lembretes e mensagens prontas
• Pro (US$ 39/mês): tudo do Starter + pagamento da fatura no cartão, cobrança automática, entrada e etapas, fotos no documento, documentos ilimitados, finanças e mensagens em inglês e espanhol
• Premium (US$ 79/mês): tudo do Pro + equipe, relatórios, recibos em PDF e documentos sem a marca BrasilConnect

A assinatura é feita no site brasilconnectusa.com. Cancele quando quiser.
```

---

## Classificação e categoria

| Campo | App Store | Google Play |
|---|---|---|
| Categoria principal | Negócios (Business) | Negócios (Business) |
| Categoria secundária | Produtividade (Productivity) | — |
| Classificação etária | 4+ (responder "Nenhum" em todas as perguntas do questionário) | Livre / Everyone (questionário IARC; veja abaixo) |
| Tipo de app | — | App (não jogo), gratuito para baixar |
| Contém anúncios | — | Não |
| Compras dentro do app | Não (modo companheiro: a assinatura não é vendida no app) | Não |

Questionário IARC (Google Play), respostas sugeridas: sem violência, sem
conteúdo sexual, sem linguagem imprópria, sem drogas, sem apostas. "Compartilha
a localização do usuário?": não. "Permite compras digitais?": não. "Os usuários
podem interagir ou trocar conteúdo?": o app não tem chat nem rede social; o
cliente final só vê o orçamento ou a fatura que o profissional mandou e aprova
ou recusa → **não**. Se a página pública mostrar avaliações respondidas pelo
profissional (recurso do plano Pro), responda **sim** (interação limitada): a
classificação continua Livre.

Questionário de idade da Apple: sem acesso livre à web, sem conteúdo médico, sem
apostas, sem concursos → 4+.

## URLs e contato

| Campo | Valor |
|---|---|
| URL de suporte | https://brasilconnectusa.com/para/workpro/#suporte |
| URL de marketing | https://brasilconnectusa.com/para/workpro/ |
| Política de privacidade | https://brasilconnectusa.com/privacidade |
| Exclusão de conta (Google Play, Data safety) | https://brasilconnectusa.com/excluir-conta.html |
| E-mail de contato (Google Play) | oi@brasilconnectusa.com |
| Site (Google Play) | https://brasilconnectusa.com/para/workpro/ |
| Copyright (App Store) | © 2026 BrasilConnect — trocar pelo nome legal da empresa que publica |

## Disponibilidade

Publicar **só na loja dos Estados Unidos** (App Store Connect → Pricing and
Availability → somente United States; Play Console → Países/regiões → Estados
Unidos). O público é o profissional brasileiro que mora e trabalha nos EUA, e a
regra de assinatura vendida fora do app vale para o storefront americano
(detalhes em [`review-notes.md`](review-notes.md#assinatura-e-pagamentos)).

Idioma principal da ficha: português (Brasil). A ficha em inglês
([`listing-en-US.md`](listing-en-US.md)) aparece para quem usa o celular em inglês.
