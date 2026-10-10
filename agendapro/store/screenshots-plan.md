# AgendaPro — plano das capturas de tela

8 telas, na ordem em que aparecem na loja. As **3 primeiras** são as que a
pessoa vê no resultado da busca: elas vendem o app. Cada imagem tem um título
curto em cima (fundo verde da marca) e a tela do app embaixo.

## Tamanhos exigidos

| Loja | Tipo | Tamanho (retrato) | Quantidade |
|---|---|---|---|
| App Store | iPhone 6,9" (obrigatório) | **1320 x 2868** (também aceita 1290 x 2796 ou 1260 x 2736) | 3 a 10 |
| App Store | iPhone 6,5" | **1284 x 2778** ou 1242 x 2688 (se não enviar, a Apple reduz as de 6,9") | 3 a 10 |
| App Store | iPad 13" | 2064 x 2752 ou 2048 x 2732 — **só se o app continuar com `supportsTablet: true`** | 3 a 10 |
| Google Play | Celular | **1080 x 1920** (9:16). Regras: 320 a 3840 px por lado, lado maior no máximo 2x o menor | 4 a 8 (mínimo 2; com 4 ou mais em 1080 px o app pode aparecer nas recomendações) |
| Google Play | Ícone de alta resolução | 512 x 512 PNG — já gerado em `store/play-icon-512.png` | 1 |
| Google Play | Gráfico de destaque | 1024 x 500 — já gerado em `store/play-feature-graphic.png` | 1 |

Formato: PNG ou JPEG, sem transparência. Celulares Android modernos têm tela
mais comprida que 2:1 (ex.: 1080 x 2400): não envie a captura crua; monte a
arte em 1080 x 1920 com o título em cima e a tela reduzida embaixo.

## As 8 telas

| # | Tela do app | Título PT | Título EN | O que precisa aparecer |
|---|---|---|---|---|
| 1 | Hoje | **Seu dia inteiro num olhar** | **Your whole day at a glance** | 4 ou 5 atendimentos do dia, o total previsto e um confirmado/aguardando sinal |
| 2 | Agenda (semana) | **Clientes marcam sozinhas, 24h** | **Clients book themselves, 24/7** | Semana cheia, cores por status, um agendamento "online" novo |
| 3 | Ficha da cliente | **Cada cliente com histórico e mensagem pronta** | **Every client's history, one tap to message** | Histórico de visitas, total gasto, observação, botão de mensagem |
| 4 | Mensagens prontas | **Mensagem pronta em português, inglês ou espanhol** | **Ready-to-send messages in 3 languages** | Modelo "lembrete" com o seletor PT / EN / ES |
| 5 | Finanças | **Lucro do mês e reserva pro imposto** | **Monthly profit and tax savings** | Recebido, despesas, lucro, meta do mês e % do imposto |
| 6 | Link e QR code | **Sua página de agendamento com QR code** | **Your booking page and QR code** | QR grande, link da página, botão compartilhar |
| 7 | Turnover (limpeza) | **Limpeza do checkout criada sozinha** | **Turnover cleanings, created for you** | 2 ou 3 casas com a próxima limpeza (sem logo de Airbnb/Vrbo na arte) |
| 8 | Equipe / clientes fixas | **Equipe com cor na agenda e rota do dia** | **Color-coded team and daily routes** | Agenda com 2 ou 3 cores de equipe ou a lista de clientes fixas |

Reserva (se quiser trocar a 8): **Clientes sumidas** — "Chame de volta quem
sumiu" / "Win back clients who stopped coming".

Para quem faz limpeza ver o app "dela" logo de cara, uma segunda ordem possível
é 1 → 7 → 2 → 3… Teste as duas no Play Console (Store listing experiments).

## Como capturar

1. Use a **conta de demonstração** com dados fictícios
   ([`review-notes.md`](review-notes.md#antes-de-enviar-checklist-do-dono)).
   Nunca use nome, telefone ou foto de cliente real.
2. iPhone: simulador **iPhone 16 Pro Max** (gera 1320 x 2868) e **iPhone 11 Pro
   Max** (1242 x 2688). Barra de status limpa:
   ```
   xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
   xcrun simctl io booted screenshot hoje.png
   ```
3. Android: emulador Pixel com o modo demonstração da barra de status:
   ```
   adb shell settings put global sysui_demo_allowed 1
   adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
   adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
   adb exec-out screencap -p > hoje.png
   ```
4. Monte as artes (Figma ou Canva) num modelo único: fundo `#1F4D3F`, título
   em `#FAF7F0` (fonte do sistema, negrito, 2 linhas no máximo), detalhe dourado
   `#B8943B`, captura com cantos arredondados. Exporte primeiro em 1320 x 2868 e
   reduza para os outros tamanhos.
5. Versão em inglês: mesma arte, só troca o título (a interface do app continua em
   português — está dito na descrição em inglês).

## Cuidados

- Não mostre a tela de planos com o botão de assinatura nas capturas (evita
  discussão na revisão sobre compra fora do app).
- Não use marcas de terceiros (Airbnb, WhatsApp…) nos títulos das capturas.
- Telas de recursos Pro ou Premium podem aparecer: a descrição já diz qual plano
  libera cada recurso.
- Vídeo de prévia (opcional): 15 a 30 s, gravado no simulador, mesma ordem das
  capturas.
