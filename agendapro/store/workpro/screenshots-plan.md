# WorkPro — plano das capturas de tela

8 telas, na ordem em que aparecem na loja. As **3 primeiras** são as que a
pessoa vê no resultado da busca: elas vendem o app. Cada imagem tem um título
curto em cima (fundo azul-marinho da marca) e a tela do app embaixo.

As capturas **não podem repetir as do AgendaPro** (risco de "app duplicado" na
revisão, veja [`review-notes.md`](review-notes.md#dois-apps-do-mesmo-código-apple-43--google-repetitive-content)):
o WorkPro abre por Vendas, orçamento e fatura, não por agenda de salão.

## Tamanhos exigidos

Iguais aos do AgendaPro ([`../screenshots-plan.md`](../screenshots-plan.md#tamanhos-exigidos)):

| Loja | Tipo | Tamanho (retrato) | Quantidade |
|---|---|---|---|
| App Store | iPhone 6,9" (obrigatório) | **1320 x 2868** (também aceita 1290 x 2796 ou 1260 x 2736) | 3 a 10 |
| App Store | iPhone 6,5" | **1284 x 2778** ou 1242 x 2688 (se não enviar, a Apple reduz as de 6,9") | 3 a 10 |
| App Store | iPad 13" | 2064 x 2752 ou 2048 x 2732 — **só se o app continuar com `supportsTablet: true`** | 3 a 10 |
| Google Play | Celular | **1080 x 1920** (9:16) | 4 a 8 |
| Google Play | Ícone de alta resolução | 512 x 512 PNG — já gerado em `store/workpro/play-icon-512.png` | 1 |
| Google Play | Gráfico de destaque | 1024 x 500 — já gerado em `store/workpro/play-feature-graphic.png` | 1 |

Formato: PNG ou JPEG, sem transparência. Android com tela comprida: monte a arte
em 1080 x 1920 com o título em cima e a tela reduzida embaixo.

## As 8 telas

| # | Tela do app | Título PT | Título EN | O que precisa aparecer |
|---|---|---|---|---|
| 1 | Vendas (aba) | **Orçamento e fatura na palma da mão** | **Estimates and invoices in your pocket** | Resumo no topo (a receber, vencido, recebido no mês, taxa de aprovação) e a lista com status coloridos: rascunho, enviado, visto, aprovado, pago, vencido |
| 2 | Editor do orçamento | **Orçamento pronto na frente do cliente** | **Build the estimate on the job site** | 4 ou 5 itens (mão de obra por hora, material, drywall em ft²), desconto, sales tax, total e entrada pedida |
| 3 | Detalhe do orçamento aprovado | **O cliente aprova com assinatura** | **Clients approve with an e-signature** | Selo "Aprovado", nome e assinatura do cliente, linha do tempo (enviado → visto → aprovado) e o botão de gerar fatura |
| 4 | Detalhe da fatura | **Saiba quem pagou e quem está devendo** | **Know who paid and who owes** | Fatura com pagamento parcial por Zelle, saldo, vencimento e o botão de registrar pagamento |
| 5 | Gerar fatura do orçamento | **Entrada e etapas da obra em um toque** | **Deposits and progress billing in one tap** | Escolha "entrada" ou "etapas" com 30% / 40% / 30% (recurso Pro) |
| 6 | Tabela de preços | **Seus preços salvos, orçamento em segundos** | **Your price book, estimates in seconds** | Itens por tipo (serviço, mão de obra, material, taxa) com unidade e preço |
| 7 | Pedidos de orçamento | **Pedidos de orçamento com fotos** | **Quote requests with photos** | 2 ou 3 pedidos novos com foto, serviço e endereço; botão de transformar em orçamento |
| 8 | Hoje / Agenda | **Visitas e serviços na sua agenda** | **Site visits and jobs on your calendar** | Dia com visita técnica, serviço em andamento e a receber do dia |

Reserva (se quiser trocar a 8): **Cobrança automática** — "Lembrete de pagamento
sem você cobrar" / "Automatic payment reminders" (linha do tempo da fatura com
"lembrete enviado").

Para tradutor juramentado e contador verem o app "deles", uma segunda leva pode
trocar os itens da tela 2 por "Tradução juramentada — página" e "Declaração de
imposto — projeto". Teste no Play Console (Store listing experiments).

## Dados das capturas

- Use a **conta de demonstração** com dados fictícios
  ([`review-notes.md`](review-notes.md#antes-de-enviar-checklist-do-dono)) ou o
  **modo demonstração** num development build (nunca no build de loja):
  `EXPO_PUBLIC_DEMO=1`, `EXPO_PUBLIC_DEMO_VERTICAL=trades`, `APP_VARIANT=workpro`.
  No navegador, para rascunho das artes: `npm run web:demo -- trial trades 8095 workpro`.
- Nunca use nome, telefone, endereço ou foto de cliente real. Fotos do trabalho:
  fotos próprias ou de banco de imagens com licença comercial (as do modo
  demonstração vêm de `placehold.co` e não servem para a loja).
- Documentos em **inglês** nas capturas (o cliente americano é o caso mais
  comum); a interface do app continua em português.
- Valores realistas para obra pequena: US$ 450 a US$ 6.800, sales tax de 6,25%
  só no material.

## Como capturar

1. iPhone: simulador **iPhone 16 Pro Max** (1320 x 2868) e **iPhone 11 Pro Max**
   (1242 x 2688), com o development build do WorkPro
   (`eas build -p ios --profile development-simulator-workpro`). Barra de status
   limpa:
   ```
   xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
   xcrun simctl io booted screenshot vendas.png
   ```
2. Android: emulador Pixel com o development build do WorkPro
   (`eas build -p android --profile development-workpro`) e o modo demonstração
   da barra de status:
   ```
   adb shell settings put global sysui_demo_allowed 1
   adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
   adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
   adb exec-out screencap -p > vendas.png
   ```
3. Monte as artes (Figma ou Canva) num modelo único: fundo `#1B2845`, título em
   `#FAF7F0` (fonte do sistema, negrito, 2 linhas no máximo), detalhe dourado
   `#B8943B`, captura com cantos arredondados. Exporte primeiro em 1320 x 2868 e
   reduza para os outros tamanhos.
4. Versão em inglês: mesma arte, só troca o título.

## Cuidados

- Não mostre a tela "Meu plano" nas capturas.
- App Store: a captura precisa mostrar **o app**. A página que o cliente abre no
  navegador (`/d/<token>`) pode aparecer só no Google Play, ou como detalhe
  pequeno dentro de uma arte cujo foco é a tela do app.
- Não use marcas de terceiros (Zelle, Stripe, WhatsApp…) nos títulos das
  capturas; na tela do app elas podem aparecer como forma de pagamento.
- Não use a logo da marca de ferramentas WORKPRO nem ferramentas com marca
  visível nas fotos.
- Telas de recursos Pro ou Premium podem aparecer: a descrição já diz qual plano
  libera cada recurso.
- Vídeo de prévia (opcional): 15 a 30 s — criar orçamento, cliente aprova,
  vira fatura, pagamento registrado.
