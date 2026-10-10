# AgendaPro app — pesquisa de produto e ideias de recursos

**Data:** 09/10/2026 · **Escopo:** app mobile completo do AgendaPro (Expo SDK 54), planos Starter US$19 / Pro US$39 / Premium US$79
**Base lida antes da pesquisa:** `api/_lib/agendaPlans.js` (matriz de recursos) e `docs/spec-agendapro-limpeza-mvp.md` (vertical de limpeza)
**Como ler:** seção 1 é o resumo; seção 3 é a lista priorizada; seção 5 são as 5 recomendações. As fontes estão numeradas no fim (ex.: [C2], [L1]).

> **Limites desta pesquisa.** Boa parte dos preços vem de agregadores (Capterra, CostBench, SchedulingKit, Fieldproxy), e alguns deles vendem produto concorrente. Os preços divergem entre fontes e mudam com frequência: confirme no site do fornecedor antes de usar em material público. Nada aqui é conselho jurídico ou tributário. Os pontos de loja, TCPA e impostos precisam de validação com advogado/contador antes de virar texto no app.

---

## 1. Resumo executivo

1. A matriz atual já cobre bem o básico de agenda, e o preço é agressivo: o Premium (US$79, até 10 pessoas) sai mais barato que o Booksy com 10 pessoas (~US$210) e que o Jobber Grow (US$199) [C1][C19].
2. Os buracos mais visíveis frente a Booksy, GlossGenius, Square e Jobber estão no dinheiro e na falta da cliente: cartão salvo com taxa de no-show, cobrança por link ou Tap to Pay, pacotes e cartão-presente [C3][C12][C14].
3. O segundo buraco é a comunicação automática com a cliente americana. Só 32% dos adultos nos EUA usam WhatsApp (54% entre latinos), e hoje o nosso lembrete automático é só por e-mail [D11][D12].
4. Na limpeza, Turno, ZenMaid e Jobber mostram o que separa uma agenda de um sistema do negócio: checklist com foto, orçamento aprovado online e cobrança consolidada [C20][C23][C27].
5. Nosso diferencial defensável é ser o "contador e tradutor de bolso" da brasileira. Isso cobre impostos trimestrais (1040-ES, 15,3% de self-employment tax, milhagem a 72,5¢/76¢), mensagens PT↔EN e tudo em português [D1][D2][D3].
6. Para a próxima versão, recomendo 5 apostas: proteção contra falta, SMS com consentimento TCPA, cobrança por link com controle de "quem está devendo", checklist com fotos e assistente de impostos.
7. Marketplace pelo BrasilConnect, clube de assinatura, Tap to Pay, WhatsApp via API e recepcionista com IA têm impacto alto, mas o esforço e o risco também são grandes. Ficam para as ondas seguintes.
8. Na Apple, desde maio/2025 o storefront dos EUA permite botão e link para compra externa, mas a Apple continua exigindo IAP para destravar recursos. Lançar como "app companheiro", sem botão de compra, é o caminho de menor risco [L1][L3][L9].
9. No Google Play (EUA), link externo e cobrança alternativa são permitidos desde 29/10/2025, mas exigem inscrição em programa e, a partir de out–dez/2026, relatório e pagamento de taxa (10% ou mais). O mesmo modelo "companheiro" evita tudo isso [L12][L13].
10. Para publicar é preciso exclusão de conta dentro do app (Apple 5.1.1(v)) e um link web para o Google. Também é preciso um development build do EAS, porque o push remoto não funciona no Expo Go Android desde o SDK 53 [L2][L17][L18].

---

## 2. Concorrentes

### 2.1 Preços de referência (US$/mês, salvo indicação)

| Concorrente | Foco | Entrada | Faixa / modelo | Observações |
|---|---|---|---|---|
| **Booksy Biz** | Beleza, barbearia | 29,99 | +20 por profissional extra; Boost = 30% da 1ª visita de cliente nova vinda do marketplace | Inclui ~2.000 SMS/mês [C1][C2][C4] |
| **Fresha** | Beleza, spa | 19,95 (solo) | 14,95 por profissional agendável; 20% (mín. US$6) na 1ª visita vinda do marketplace; cartão 2,19% + 20¢ | SMS em massa a US$0,02/SMS. Fontes divergem sobre a volta do plano grátis [C6] |
| **Vagaro** | Beleza, fitness | ~24–25 | +10 por usuário; SMS marketing +20; formulários +10; site +20; folha +34 + 5/func.; QuickBooks +30 | Marketplace com "Daily Deals" grátis [C8][C9] |
| **GlossGenius** (agora Genius AI) | Beleza solo/pequeno | 24 anual / 28 mensal | Gold 48/56; Platinum 148/168; cartão a 2,6% fixo | Créditos de SMS: 500 no Gold, 2.500 no Platinum. IA "Growth Analyst" [C10][C11][C13] |
| **Square Appointments** | Geral | 0 | Plus ~29 e Premium ~69 por local (há fonte com 49/149) | No-show protection a partir do Plus [C14][C15] |
| **Setmore** | Geral | 0 (4 usuários, 200 agend./mês) | Pro 5/usuário anual (12 mensal) | SMS no Pro [C16] |
| **Acuity** | Geral | 16 anual / 20 mensal | Standard 27 (SMS, pacotes, memberships); Premium 49 | Sem plano grátis [C17] |
| **Schedulicity** | Beleza, fitness | sob consulta (~23,99 segundo agregador) | Preço público pouco claro | [C18] |
| **Jobber** | Serviço de campo | 49 (Core, 1 usuário) | Connect 139 (até 5), Grow 199 (até 10), Plus 599–699; +29 por usuário | Client hub, orçamentos, "a caminho" [C19][C20][C21] |
| **Housecall Pro** | Serviço de campo | 79 (59 anual) | Essentials 189 (149), MAX 329 (299) | Checklists e GPS a partir do Essentials [C24] |
| **ZenMaid** | Limpeza residencial | 19 (até 40 agendamentos) | Pro 39 (ilimitado, checklists, GPS, folha); Pro Max 49 | Referência direta do spec [C23] |
| **BookingKoala** | Limpeza (site de reserva) | 27 | 57 / 197 (há fonte com 59/79) | Calculadora de preço e cupons [C25] |
| **Launch27** | Limpeza (site de reserva) | 75 | 150 / 299 | Cobrança automática da recorrência, gift card, divisão de pagamento [C26] |
| **Turno** | Turnover Airbnb | Grátis (1 imóvel, ou só faxineiras do marketplace) | US$10 por imóvel/mês (US$96/ano) com equipe própria | Checklist com foto e marketplace de faxineiras [C27][C28] |
| **Trinks** (BR) | Salão, barbearia, clínica | a partir de R$81 (Capterra) | Por recurso/porte | WhatsApp, clube de assinatura, IA 24h [C29][C30] |
| **AppBarber** (BR) | Barbearia | R$79,90 (1 prof.) | R$109,90 (2–5), R$164,50 (6–15), R$219,90 (15+); 30% off no anual | Vende plano por assinatura da Apple (IAP) na App Store [C31][C32] |
| **Gendo** (BR) | Salão | R$51,99 por usuário (GetApp) | Por usuário | Lembrete por SMS/WhatsApp, app próprio do salão [C33] |
| **Avec** (BR) | Marketplace do consumidor | Grátis para o consumidor | Avec+ (assinatura do consumidor, até 40% off) | Serviço a domicílio [C34] |
| **AgendaPro** | Brasileira autônoma nos EUA | **19** | **39 / 79** (equipe de até 10 já inclusa) | Único em português feito para os EUA |

**Leitura rápida:** nossa entrada (US$19) empata com ZenMaid Starter e Fresha solo, e fica abaixo de Booksy e GlossGenius. Com equipe, a vantagem é grande, porque ninguém cobra preço fixo por 10 pessoas com esse valor. O risco não é preço, é recurso: o cliente compara com Booksy e GlossGenius em "proteção contra falta" e "pagamento".

### 2.2 Recurso x quem tem: beleza e agenda

Legenda: **S** = tem · **P** = só em plano superior · **$** = cobrado à parte · **nc** = não confirmado nesta pesquisa (pode existir) · **não** = a fonte indica que não tem.

| Recurso | Booksy | Fresha | Vagaro | GlossGenius | Square | Acuity/Setmore | Trinks | AppBarber | **AgendaPro hoje** |
|---|---|---|---|---|---|---|---|---|---|
| Agendamento online 24h | S | S | S | S | S | S | S | S | **S** |
| Marketplace que traz cliente nova | S (30% na 1ª visita) | S (20%) | S (Daily Deals) | nc | nc | nc | S (app do consumidor) | nc | **não** (só página própria) |
| Lembrete automático por SMS | S (2.000/mês) | $ (por uso) | $ (SMS marketing) | P (créditos) | S | P | S | S (canal nc) | **não** (e-mail + WhatsApp manual) |
| WhatsApp automático | nc | nc | nc | nc | nc | nc | S | nc | **não** (1 toque, manual) |
| Sinal / pré-pagamento | S | nc | nc | S | S | nc | S | S (pagamento online) | **S** (Zelle no Starter, cartão no Pro) |
| Cartão salvo + taxa de no-show | S | nc | nc | S | P (Plus) | nc | nc | nc | **não** |
| Tap to Pay no celular | nc | nc | nc | S | S | nc | maquininha integrada | nc | **não** |
| Pacotes | S | nc | nc | S | P | P (Acuity) | S | S | **não** |
| Assinatura / clube da cliente | S | nc | nc | S | não (só fatura recorrente) | P (Acuity) | S | S (clube) | **não** |
| Cartão-presente | S | nc | nc | S | S | nc | nc | nc | **não** |
| Promoção para horário vago | S (flash sale, happy hour) | S (smart pricing) | S (Daily Deals) | nc | nc | nc | S (promoções) | S (promoções) | **parcial** (lista de espera) |
| Fidelidade / indicação | "volte a agendar" automático | nc | nc | nc | $ (Loyalty) | nc | S (pontos) | S | **parcial** (clientes sumidas) |
| Formulários / termo assinado | nc | nc | $ (US$10) | P (Gold) | nc | S (Acuity) | nc | nc | **não** |
| Lista de espera | S | nc | nc | P | S | nc | nc | S | **P** (Pro) |
| IA (recepcionista ou analista) | nc | nc | nc | S | não (só de terceiros) | nc | S (Trinks IA 24h) | nc | **não** |
| Interface em português | não | não | não | não | não | não | S (Brasil) | S (Brasil) | **S (EUA)** |

Fontes da tabela: [C1]–[C18], [C29]–[C33], [C35].

### 2.3 Recurso x quem tem: limpeza e serviço de campo

| Recurso | Jobber | Housecall Pro | ZenMaid | BookingKoala | Launch27 | Turno | **AgendaPro hoje** |
|---|---|---|---|---|---|---|---|
| Orçamento online com aprovação | S (client hub, sinal na aprovação, itens opcionais) | S | nc | S (calculadora no site) | S (formulário de reserva) | nc | **não** (está no spec como P1) |
| Checklist com fotos | parcial (formulário com foto, sem antes/depois dedicado) | P (Essentials) | P (Pro) | nc | nc | S | **não** |
| Aviso "estou a caminho" | S (1 clique) | nc | nc | nc | nc | nc | **parcial** (modelo de WhatsApp de atraso) |
| Portal da cliente (pedir, aprovar, pagar) | S | nc | nc | S | S (portais de cliente, faxineira e escritório) | S (app do anfitrião) | **parcial** (página pública) |
| Pagamento online / cobrança automática | S (2,9% + 30¢; ACH 1%) | S (a partir de 2,59%) | S (Stripe/Square) | S | S (cobra a recorrência sozinho) | S (paga a faxineira sozinho) | **parcial** (sinal no cartão + registro manual) |
| GPS / ponto da equipe | nc | P | P | nc | nc | nc | **não** (link da rota do dia sem login) |
| Folha / divisão por faxineira | nc | nc | P | nc | S (comissão e split) | S (pagamento automático) | **não** (não-meta v1 no spec) |
| Calendário Airbnb/Vrbo (iCal) | nc | nc | nc | nc | nc | S (+20 PMS) | **S** |
| Marketplace de faxineiras | não | não | não | não | não | S | **não** |
| Gift card / cupom | nc | nc | nc | S (cupom) | S (gift card) | nc | **não** |
| Integração contábil | P (QuickBooks no Connect) | P (Essentials) | nc | nc | S (Zapier) | nc | **P** (CSV no Premium) |

Fontes: [C19]–[C28].

**Conclusão da comparação:** o AgendaPro já tem duas coisas raras: turnover via iCal (que só o Turno faz bem) e equipe barata. Faltam três blocos que todo concorrente sério oferece:
1. Proteger e receber dinheiro: cartão salvo, link de pagamento, Tap to Pay.
2. Falar sozinho com a cliente no canal dela: SMS para americanas, WhatsApp para brasileiras.
3. Provar o serviço: checklist com fotos.

---

## 3. Novos recursos priorizados

### 3.1 Contexto da usuária (por que a priorização ficou assim)

- **Tamanho e geografia.** O Itamaraty estima cerca de 2,07 milhões de brasileiros nos EUA (2025), com as maiores jurisdições em Nova York (~500 mil), Boston (~440 mil) e Miami (~400 mil). O censo americano conta menos (~725 mil nascidos no Brasil), porque mede outra coisa [D13].
- **Trabalho.** Serviço doméstico é a ocupação mais comum da brasileira imigrante nos EUA, qualquer que seja a escolaridade [D15]. Isso confirma a aposta na limpeza do spec.
- **Canal.** A brasileira vive no WhatsApp, mas a cliente americana não: só 32% dos adultos nos EUA usam o app (Pew 2025), contra 54% entre latinos [D11][D12]. Lembrete só por WhatsApp não alcança metade da carteira de quem atende americana.
- **Dinheiro informal.** Zelle não tem proteção de compra nem estorno [M15]. Venmo cobra 1,9% + 10¢ no perfil de negócio (2,29% + 10¢ no Tap to Pay) [M13], e Cash App Business cobra 2,6% + 15¢ [M14]. Cartão via plataforma (2,7% + 5¢ presencial no Stripe [M3]) passa a ser competitivo e protege contra calote.
- **Impostos.** Os pagamentos estimados de 2026 vencem em 15/04, 15/06 e 15/09/2026 e em 15/01/2027. Há obrigação de pagar quando o imposto previsto passa de US$1.000. O self-employment tax é 15,3% sobre 92,35% do lucro, com teto do Social Security de US$184.500 em 2026 [D3][D4][D5].
- **Milhagem.** O IRS fixou 72,5¢/milha para 2026 e, segundo a imprensa contábil, subiu para 76¢ a partir de 01/07/2026 [D1][D2]. A milhagem já existe no Pro, mas a taxa precisa variar por data.
- **"No tax on tips".** Dedução de até US$25 mil em gorjetas. Cosmetologistas, manicures, cabeleireiras e massagistas estão na lista final (10/04/2026), mas a dedução **exige SSN válido**: quem só tem ITIN não pode usar [D6][D7][D8]. Se faxina entra na lista ainda precisa ser verificado.
- **1099-K / 1099-NEC.** O limite federal do 1099-K voltou a US$20 mil **e** 200 transações (alguns estados usam US$600). O 1099-NEC sobe para US$2.000 a partir de 2026 [D9][D10]. Isso afeta quem paga ajudante.
- **Licença e seguro.** A licença de cosmetologia com ITIN depende do estado: CA, NV e VT têm caminho confirmado, e em MA há projeto (H.451) [D18][D19][D20]. Para limpeza, seguro de responsabilidade civil custa ~US$44–48/mês e o bond ~US$100–250/ano [D16][D17].
- **No-show.** Benchmarks de fornecedores apontam ~20–25% de falta em salão. Sinal derruba a falta para ~5–7%, e lembrete por SMS reduz ~29–39% [D21][D22]. São números de fornecedores: use como direção, não como promessa.
- **Sazonalidade.** O turnover de Airbnb concentra demanda no verão, com julho como pico nos EUA, e em poucos sábados. No inverno, a agenda esvazia [D23].
- **Privacidade.** Em dez/2025, o Itamaraty contava ~2,6 mil brasileiros presos nos EUA por questão migratória [D14]. A confiança no app depende de coletar o mínimo: nunca perguntar status migratório e não guardar SSN/ITIN.

### 3.2 Critérios

- **Impacto:** Alto, Médio ou Baixo, medido em dinheiro a mais ou tempo a menos para a profissional, retenção e motivo para fazer upgrade.
- **Evidência:** quantos concorrentes oferecem e quanto a dor aparece na pesquisa.
- **Esforço:** P até 1 semana; M de 1 a 3 semanas; G mais de 3 semanas **ou** dependência de aprovação externa (Apple, Meta, operadoras).
- **Plano:** Starter organiza e não perde cliente; Pro faz ganhar e proteger dinheiro; Premium serve equipe e escala. Itens com custo variável (SMS, WhatsApp API, IA) vêm com **cota por plano + pacote extra** para proteger a margem.

### 3.3 Visão geral

| # | Recurso novo (fora da matriz atual) | Onda | Esforço | Impacto | Plano sugerido | Dependência principal |
|---|---|---|---|---|---|---|
| 1 | Proteção contra falta (cartão salvo, taxa, política, remarcar pelo link) | 1 | M | Alto | Pro | Stripe Connect (já usado no sinal) |
| 2 | Lembrete e confirmação por SMS com consentimento | 1 | M/G | Alto | Starter (cota) → Premium | Twilio + registro 10DLC |
| 3 | Cobrança por link, "quem está devendo" e fatura mensal do anfitrião | 1 | M | Alto | Pro (Starter vê "em aberto") | Stripe Payment Links/Checkout |
| 4 | Checklist de limpeza com fotos antes/depois e relatório | 1 | M | Alto (limpeza) | Pro; equipe no Premium | Supabase Storage |
| 5 | Assistente de impostos trimestrais | 1 | M | Alto | Pro (datas no Starter) | Tabela anual do IRS, revisão de contador |
| 6 | Tradutor e redator de mensagens PT↔EN/ES | 1 | P | Médio/Alto | Pro (cota pequena no Starter) | LLM no servidor |
| 7 | Pacotes e cartão-presente | 2 | M | Médio/Alto | Pro | Stripe ou registro manual |
| 8 | Orçamento online com calculadora e aprovação | 2 | M | Alto (limpeza) | Starter (pedido) / Pro (calculadora + sinal) | Página pública |
| 9 | Promoções para horário vago + aniversário | 2 | M | Médio | Pro | Lista de espera e modelos |
| 10 | Fichas, termos e contratos assinados | 2 | M | Médio | Pro | expo-print, assinatura na tela |
| 11 | Indicação e fidelidade | 2 | M | Médio | Pro | Página pública |
| 12 | Modo offline (leitura + fila de ações) | 2 | M | Médio | Todos | AsyncStorage ou expo-sqlite |
| 13 | Mapa do dia + sugestão de encaixe (já no spec) | 2 | M | Médio/Alto (limpeza) | Pro; por equipe no Premium | Geocoding + mapa |
| 14 | Documentos do negócio e lembretes de renovação | 2 | P | Médio | Starter | Storage; parceria de seguro |
| 15 | Tap to Pay no celular | 3 | G | Alto | Pro | Stripe Terminal + entitlement da Apple |
| 16 | WhatsApp automático (API oficial) | 3 | G | Médio/Alto | Pro (add-on) | Meta Business + templates |
| 17 | Clube de assinatura da cliente (cobrança recorrente) | 3 | G | Médio | Premium | Stripe Billing em conta conectada |
| 18 | Pagamento de ajudantes + check-in na casa | 3 | M | Médio | Premium | Localização; aviso 1099-NEC |
| 19 | Marketplace BrasilConnect ("encontre uma profissional brasileira") | 3 | G | Alto se tracionar | Listagem para todos; destaque Pro/Premium | SEO, moderação, avaliações |
| 20 | Widget de tela inicial | 3 | M | Baixo/Médio | Todos | Expo SDK 55+ |
| 21 | Recepcionista com IA (responde e agenda 24h) | 3 | G | Médio/Alto | Premium (add-on) | LLM + canal de mensagem |

**Onda 1** = próxima versão · **Onda 2** = 1 a 3 meses · **Onda 3** = 3 a 6+ meses.

### 3.4 Detalhe de cada recurso

#### 1. Proteção contra falta — Onda 1 · M · Alto · **Pro**
- **Problema que resolve:** a cliente some e o horário fica vazio. Hoje temos sinal, mas não temos cartão salvo nem taxa de cancelamento tardio.
- **Por que importa para a brasileira nos EUA:** quem cobra por Zelle não tem como cobrar a falta depois, e a profissional sem inglês fluente evita confronto. Uma regra automática ("cancelou com menos de 24h, cobra 50%") faz a cobrança por ela.
- **Evidência:** Booksy cobra taxa com cartão salvo e diz que as faltas caíram 20% em um mês [C3]. A GlossGenius permite regra por tipo de cliente [C12]. No Square, isso vem a partir do Plus [C15]. Benchmarks: sinal leva a falta a ~5–7% [D22].
- **Como fazer:**
  - Na página pública, a cliente aceita a política e salva o cartão (SetupIntent na conta conectada da profissional).
  - No app, a profissional marca "faltou" e escolhe cobrar a taxa, cobrar o valor cheio ou perdoar.
  - O lembrete leva um link "remarcar/cancelar" que respeita a política. Remarcar é melhor que faltar.
- **Dependências:** Stripe Connect (já usado em `deposit_stripe`); texto da política em PT/EN/ES; a chave nova `no_show_protection` (pro) em `agendaPlans.js`.
- **Riscos:** chargebacks. Guardar o aceite da política, com data, IP e texto da versão, e mostrar a política no lembrete.

#### 2. Lembrete e confirmação por SMS com consentimento — Onda 1 · M/G · Alto · **Starter com cota**
- **Problema que resolve:** a cliente americana não abre WhatsApp e ignora e-mail. A profissional perde tempo mandando mensagem uma por uma.
- **Por que importa:** 68% dos adultos nos EUA não usam WhatsApp [D11]. O SMS é o canal padrão de Booksy (2.000/mês inclusos), Square e GlossGenius [C2][C11][C14].
- **Como fazer:**
  - Fase 1: lembrete 24h antes e na manhã do dia, com "Responda C para confirmar ou R para remarcar", que atualiza o status da agenda. Opt-out por STOP.
  - Fase 2: "estou a caminho" automático para a limpeza e caixa de entrada de respostas (two-way).
- **Cota sugerida (nova chave `sms_monthly` em `LIMITS`):** Starter 100, Pro 500, Premium 1.500, com pacotes extras.
  - Custo estimado de ~US$0,011–0,013 por segmento (Twilio US$0,0083 + ~US$0,003 de operadora) [M4][M6].
  - **Atenção:** acento (ã, ç) força a codificação UCS-2, que divide a mensagem a cada 70 caracteres em vez de 160. Lembrete em PT sai 2–3x mais caro. Mandar em inglês para cliente americana, ou texto curto sem acento, corta o custo.
- **Dependências:** Twilio ou similar. No modelo **10DLC**, cada profissional sem EIN vira uma marca "sole proprietor": US$4,50 de registro + US$15 de verificação da campanha + ~US$2/mês. A verificação exige celular dos EUA (não VoIP) e endereço dos EUA. O limite é 1 msg/segundo e 1 número por campanha [M5]. Avaliar também número toll-free verificado da plataforma (não pesquisado aqui).
- **Regras (TCPA):**
  - Lembrete é mensagem informativa, mas precisa de consentimento prévio. Usar um checkbox no agendamento e na ficha, com texto claro e registro da data.
  - Opt-out deve ser honrado em tempo razoável, no máximo 10 dias úteis (vigente desde 11/04/2025) [M9].
  - A FCC aprovou em 30/09/2026 que o opt-out passa a valer por **categoria** (sair do marketing não tira o lembrete de horário). A empresa pode indicar um canal exclusivo de opt-out, como responder STOP. Entra em vigor 30 dias após a publicação no Federal Register, ainda pendente no começo de out/2026 [M7][M8].
  - Mensagem de **marketing** exige consentimento por escrito à parte. Verificar leis estaduais mais rígidas (ex.: Flórida).

#### 3. Cobrança por link, "quem está devendo" e fatura mensal do anfitrião — Onda 1 · M · Alto · **Pro**
- **Problema que resolve:** dinheiro na rua. A dona do schedule de limpeza não sabe quem pagou, e o anfitrião de Airbnb costuma pagar o mês fechado.
- **Por que importa:** o spec já pede "registro de pagamento por visita + lista em aberto" (P1). Hoje temos `payments_log` manual. Jobber, Housecall Pro e Launch27 cobram online e automatizam a cobrança [C19][C24][C26].
- **Como fazer:**
  - Botão "cobrar" na visita gera um link Stripe (Checkout/Payment Link na conta conectada) para mandar por WhatsApp ou SMS. O pagamento cai e a visita fica paga sozinha.
  - Tela "Em aberto" (Starter vê a lista; o Pro manda cobrança em 1 toque).
  - Fatura mensal por cliente ou anfitrião, juntando as visitas, em PDF (`expo-print` já instalado) com link de pagamento. Lembrete automático de fatura vencida.
- **Dependências:** Stripe Connect. A taxa online é ~2,9% + 30¢ e o Connect pode ter custo por conta ativa e por repasse [M3]. Definir se a plataforma cobra *application fee*.
- **Regra de loja:** pagamento de serviço consumido fora do app (a limpeza, o corte) **deve** usar meio que não seja IAP (Apple 3.1.3(e)) [L1]. Não há conflito com a loja.

#### 4. Checklist de limpeza com fotos antes/depois e relatório — Onda 1 · M · Alto (limpeza) · **Pro**; equipe preenche no **Premium**
- **Problema que resolve:** briga de "não limpou direito", dano que já existia, anfitrião que quer prova, equipe que esquece etapa.
- **Por que importa:** a cliente americana e o anfitrião de Airbnb cobram padrão de qualidade, e a dona do schedule não está na casa. A foto resolve a discussão sem precisar de inglês.
- **Evidência:** o Turno tem checklist com fotos e relato de problema/estoque [C27][C28]. ZenMaid traz checklists no Pro [C23] e Housecall Pro no Essentials [C24]. O Jobber só tem foto em formulário, e usuários pedem antes/depois por visita [C22], uma lacuna que podemos ocupar.
- **Como fazer:**
  - Modelos de checklist por tipo (padrão, profunda, mudança, turnover) com itens por cômodo.
  - Foto obrigatória opcional por item. Botão "reportar problema" (dano, falta de produto, item quebrado, roupa de cama).
  - Ao concluir, gera relatório com fotos (link ou PDF) para a cliente ou o anfitrião.
  - No Premium, a equipe preenche pelo link da rota do dia (`team_day_link`), sem login.
- **Dependências:** `expo-image-picker` e `expo-image-manipulator` já instalados (comprimir antes de subir); Supabase Storage com cota por plano.
- **Risco:** foto dentro da casa da cliente é dado sensível. Definir retenção (ex.: 90 dias) e não expor em página pública.

#### 5. Assistente de impostos trimestrais — Onda 1 · M · Alto · **Pro** (o Starter recebe só os avisos de data)
- **Problema que resolve:** a autônoma descobre em abril que deve milhares de dólares, com multa por não ter pago o estimado. A "reserva pro imposto" atual é um número solto.
- **Por que importa:** quem vem do Brasil não conhece 1040-ES, self-employment tax nem safe harbor. É o tipo de dúvida que circula nos grupos de WhatsApp. Não encontrei esse recurso em nenhum concorrente de agenda pesquisado. Existe em apps de contabilidade para autônomos, que ficaram fora do escopo.
- **Como fazer:**
  - Calendário dos vencimentos (próximo: **15/01/2027**) com push 7 dias e 1 dia antes [D3][D4].
  - Estimativa: lucro (receita − despesas − milhagem) × 92,35% × 15,3% de SE tax + estimativa simples de imposto de renda. Sugere quanto separar por semana.
  - Explica o "porto seguro" (pagar 100% do imposto do ano anterior, ou 110% se a renda passou de US$150 mil) [D3].
  - Milhagem com taxa automática por data: 72,5¢ até 30/06/2026 e 76¢ desde 01/07/2026, a confirmar no IRS [D1][D2].
  - Despesas nas categorias do Schedule C. Relatório de gorjetas, com aviso de que a dedução "no tax on tips" exige SSN e não vale para ITIN [D6][D8].
  - Alerta de 1099-K (US$20 mil e 200 transações no federal; alguns estados usam US$600) e de 1099-NEC ao pagar ajudante acima de US$2.000 [D9][D10].
  - Pacote anual para o contador (CSV/PDF) e link para o IRS Direct Pay.
  - Glossário em português.
- **Dependências:** tabela de parâmetros por ano no servidor (taxas, datas, tetos), atualizada uma vez por ano e revisada por contador. Integra com `finance` e `mileage`. Opcional: indicação de contador brasileiro pelo diretório do BrasilConnect (possível receita de parceria).
- **Riscos:** responsabilidade por cálculo errado. Mostrar como "estimativa educativa, não é conselho fiscal" e nunca prometer valor exato. Não pedir nem guardar SSN/ITIN.

#### 6. Tradutor e redator de mensagens PT↔EN/ES — Onda 1 · P · Médio/Alto · **Pro** (Starter com ~10/mês)
- **Problema que resolve:** a cliente americana manda "Can we push to Thursday and skip the fridge this time?" e a profissional trava. Ela também precisa responder reclamação, explicar a política ou cobrar com educação.
- **Por que importa:** o idioma é barreira número 1 com cliente americana. Já temos `multilang_messages` (modelos prontos), mas não temos tradução livre nem redação.
- **Como fazer:** a profissional cola a mensagem recebida, vê a tradução em PT e uma sugestão de resposta em EN, no tom certo (educado e firme). Escreve em PT e recebe em EN. Um botão "copiar" e outro "abrir no WhatsApp/SMS".
- **Dependências:** chamada de LLM pela API do servidor (custo de centavos por mensagem) e cota mensal por plano.
- **Risco:** baixo. Não mandar nada sozinho: a profissional sempre revisa.

#### 7. Pacotes e cartão-presente — Onda 2 · M · Médio/Alto · **Pro**
- **Problema que resolve:** fluxo de caixa irregular e cliente que some. O cartão-presente vende na época de presente (Dia das Mães, Natal) e traz cliente nova.
- **Evidência:** Booksy, GlossGenius e Square têm pacotes e gift cards [C2][C10][C14][C35]. Launch27 vende gift card de limpeza [C26]. Trinks e AppBarber vivem de pacotes e clube [C29][C31].
- **Como fazer:**
  - Pacote: "4 limpezas quinzenais" ou "5 escovas", com saldo na ficha da cliente e baixa automática ao concluir.
  - Cartão-presente: código ou QR, venda pela página pública (Stripe) ou registro manual (Zelle), resgate no agendamento.
- **Riscos:** a lei federal limita a validade de cartão-presente, e há regras estaduais de saldo não usado. Revisar com advogado antes de permitir prazo de validade.

#### 8. Orçamento online com calculadora e aprovação — Onda 2 · M · Alto (limpeza) · **Starter** (pedido) / **Pro** (calculadora + aprovação com sinal)
- **Problema que resolve:** na limpeza, a cliente não escolhe horário, pede preço. Hoje isso vira um vai-e-vem no WhatsApp.
- **Evidência:** o spec já prevê o formulário de orçamento EN/PT (P1). O client hub do Jobber aprova orçamento online, cobra sinal e oferece itens opcionais [C20]. O BookingKoala tem calculadora por tamanho da casa e área atendida [C25].
- **Como fazer:**
  - Formulário na página pública (quartos, banheiros, tipo, frequência, extras como forno e geladeira).
  - Faixa de preço calculada pelas regras da profissional; ela revisa e envia.
  - A cliente aprova pelo link e paga o sinal, e a recorrência já nasce criada.

#### 9. Promoções para horário vago + aniversário — Onda 2 · M · Médio · **Pro**
- **Problema que resolve:** buraco na agenda (terça de manhã, inverno no turnover) e cliente que esquece de voltar.
- **Evidência:** Booksy tem flash sale, desconto de última hora e happy hour [C5]. A Fresha ajusta preço sozinha em horário fraco ou de pico [C7]. A Vagaro tem Daily Deals no marketplace [C9].
- **Como fazer:** "Encher a semana": o app mostra os vagos dos próximos 7 dias e gera uma oferta (ex.: 15% off terça 9h–12h). A oferta aparece na página pública com selo, vai para a lista de espera e gera mensagem pronta para a cliente fixa. Mensagem de aniversário com cupom.
- **Riscos:** mensagem de marketing por SMS exige consentimento por escrito (seção 4.5). Enviar pelo WhatsApp pessoal da profissional, em 1 toque, é o caminho de menor risco.

#### 10. Fichas, termos e contratos assinados — Onda 2 · M · Médio · **Pro**
- **Problema que resolve:**
  - Na estética, lash e massagem: anamnese, alergia, teste de mecha e autorização de foto.
  - Na limpeza: contrato de serviço (escopo, frequência, cancelamento, chaves e alarme, pets, quebra).
  - Em geral: política de cancelamento aceita.
- **Evidência:** a GlossGenius tem formulários e waivers no Gold [C11], a Vagaro cobra US$10/mês por formulários [C8] e o Acuity tem intake forms [C17].
- **Como fazer:** modelos prontos em PT/EN. A cliente preenche pelo link e assina com o dedo. O PDF fica salvo na ficha (`expo-print` e `react-native-svg` já instalados).
- **Risco:** modelo de contrato não substitui advogado. Deixar isso claro e permitir editar.

#### 11. Indicação e fidelidade — Onda 2 · M · Médio · **Pro**
- **Problema que resolve:** a profissional brasileira cresce no boca a boca, mas não recompensa quem indica.
- **Evidência:** Trinks e AppBarber têm programa de fidelidade [C30][C31], o Square Loyalty é pago à parte e o client hub do Jobber inclui "indique amigos" [C20].
- **Como fazer:** cartão fidelidade digital (a cada N visitas, 1 brinde) e link de indicação com crédito para as duas partes. O painel mostra quem trouxe quem. Usa a reativação (`reactivation`) que já existe.

#### 12. Modo offline (leitura + fila) — Onda 2 · M · Médio · **todos os planos**
- **Problema que resolve:** porão, casa grande, sinal ruim e plano de dados limitado. A faxineira precisa ver o endereço, o código do portão e o checklist sem internet.
- **Como fazer:**
  - Fase 1: cache somente leitura da agenda de hoje e amanhã e das fichas usadas (AsyncStorage já instalado).
  - Fase 2: fila de ações (concluir, marcar pago, foto) que sincroniza quando a conexão volta, talvez com `expo-sqlite`, um pacote novo.
- **Por que em todos os planos:** é confiabilidade, não recurso premium. Ajuda a avaliação na loja.

#### 13. Mapa do dia + sugestão de encaixe — Onda 2 · M · Médio/Alto (limpeza com equipe) · **Pro**; por equipe no **Premium**
- **Problema que resolve:** casas longe no mesmo dia queimam gasolina e horas pagas.
- **Situação:** já está no spec (P1, "o uau da demo"), mas não entrou em `FEATURES`. Inclui alerta de dispersão (>10 mi) e a dica "você já atende a ≤5 mi daqui às quintas".
- **Dependências:** geocoding (Nominatim com cache, ou Mapbox) e um mapa no app (`react-native-maps`, pacote novo).

#### 14. Documentos do negócio e lembretes de renovação — Onda 2 · P · Médio · **Starter**
- **Problema que resolve:** licença de cosmetologia, seguro de responsabilidade civil e bond vencem sem aviso. Cliente comercial ou anfitrião pede o certificado de seguro (COI).
- **Como fazer:** um cofre com foto e PDF do documento e data de validade, push 30 e 7 dias antes, e botão "mandar certificado de seguro". Conteúdo educativo: quanto custa o seguro (~US$44–48/mês) e o bond (~US$100–250/ano) [D16][D17].
- **Receita possível:** indicação de seguradora para pequeno negócio (o BC já tem kits de afiliado).
- **Cuidado:** não pedir documento de identidade nem número de SSN/ITIN.

#### 15. Tap to Pay no celular — Onda 3 · G · Alto · **Pro**
- **Problema que resolve:** receber cartão na hora, sem maquininha. A cliente americana nem sempre tem Zelle.
- **Evidência:** GlossGenius e Square já oferecem [C10][C14], e até o Venmo Business tem Tap to Pay [M13].
- **Dependências:**
  - SDK Stripe Terminal React Native, que suporta Tap to Pay no iPhone [M1][M2].
  - **Entitlement da Apple:** primeiro só para desenvolvimento, depois um pedido separado para produção.
  - Aparelho físico (iPhone XS ou mais novo; iPad não tem leitor NFC) e development build.
  - Não está disponível em Porto Rico.
  - Custo de ~2,7% + 5¢. Uma fonte indica +10¢ por autorização no Tap to Pay, a confirmar no Stripe [M3].
- **Por que na onda 3:** depende de aprovação da Apple e do link de pagamento (item 3) já funcionando.

#### 16. WhatsApp automático (API oficial) — Onda 3 · G · Médio/Alto · **Pro (add-on)**
- **Problema que resolve:** o lembrete para cliente brasileira sai sozinho, sem a profissional tocar em nada. Hoje os modelos são de 1 toque (`whatsapp_templates`).
- **Dependências:**
  - Verificação do Meta Business e um parceiro (BSP).
  - Templates "utility" aprovados por idioma.
  - Um número do AgendaPro que envia em nome da profissional (o template nomeia o negócio).
- **Custos:**
  - A cobrança é por mensagem desde 01/07/2025. O utility nos EUA custa ~US$0,0034–0,006, conforme a fonte (agregadores) [M10].
  - Desde 01/10/2026, segundo parceiros, até a mensagem de serviço dentro da janela de 24h passa a ser cobrada, com franquia das primeiras 1.000 por número/mês [M11][M12].
- **Por que na onda 3:** o SMS (item 2) atende a cliente americana, que é onde o canal falta. Para a brasileira, o 1 toque já funciona.

#### 17. Clube de assinatura da cliente — Onda 3 · G · Médio · **Premium**
- **Problema que resolve:** receita previsível ("limpeza quinzenal por US$X/mês" ou "unhas ilimitadas").
- **Evidência:** a Trinks tem clube de assinaturas [C29]. Barbearia por assinatura é tendência no Brasil, e a brasileira conhece o modelo. Launch27 cobra a recorrência sozinho [C26].
- **Dependências:** Stripe Billing na conta conectada, cobrança automática, falha de cartão e pausa. Depende dos itens 1 e 3.

#### 18. Pagamento de ajudantes + check-in na casa — Onda 3 · M · Médio · **Premium**
- **Problema que resolve:** no fim da semana, a dona do schedule calcula na mão quanto deve a cada ajudante (diária, % por casa, gorjeta).
- **Evidência:** ZenMaid tem folha e GPS no Pro [C23]. Launch27 tem split de receita e comissão [C26].
- **Como fazer (sem virar folha de pagamento, que é não-meta no spec):** relatório "quanto pagar a quem" por período e check-in/check-out com localização opcional (`expo-location`, pacote novo). Aviso quando um ajudante passa de US$2.000 no ano, por causa do 1099-NEC [D10].
- **Risco:** classificação de trabalhador (empregado vs. autônomo) é tema legal. O app só informa, não orienta.

#### 19. Marketplace BrasilConnect — Onda 3 · G · Alto se tracionar · listagem para **todos**; destaque **Pro/Premium**
- **Problema que resolve:** o produto organiza, mas não traz cliente. O spec chama isso de dor central ("as ferramentas de mercado não trazem cliente").
- **Evidência:** Booksy cobra 30% da 1ª visita (Boost) [C4], Fresha 20% [C6] e Turno tem marketplace de faxineiras [C28]. Profissionais reclamam dessas comissões.
- **Diferencial possível:** "sem comissão na 1ª visita" e audiência da comunidade (BrasilConnect), em PT e EN. O perfil público com avaliações (`reviews`, `gallery`) já é a semente.
- **Por que na onda 3:** mercado de dois lados, que exige SEO por cidade e serviço, moderação, antifraude e massa crítica de profissionais. Antes disso, uma versão simples: diretório estático por cidade, gerado a partir dos perfis ativos.

#### 20. Widget de tela inicial — Onda 3 · M · Baixo/Médio · **todos**
- **Problema que resolve:** ver "próxima cliente" e "agenda de hoje" sem abrir o app.
- **Dependências:**
  - No iOS, o `expo-widgets` oficial ainda é alfa e só funciona a partir do **SDK 55**. Nosso app está no SDK 54 [L19].
  - No Android não há pacote oficial do Expo; usar `react-native-android-widget` ou Jetpack Glance [L20].
  - Nenhum dos dois roda no Expo Go.
- **Por que na onda 3:** depende de upgrade de SDK e não gera receita direta.

#### 21. Recepcionista com IA — Onda 3 · G · Médio/Alto · **Premium (add-on)**
- **Problema que resolve:** responder "tem horário sábado?" às 23h, em inglês, e agendar sozinho.
- **Evidência:** a GlossGenius (agora Genius AI, avaliada em US$1,15 bi) lança agentes de recepção e marketing [C13]. A Trinks IA agenda e responde 24h [C29].
- **Por que na onda 3:** precisa dos canais automáticos (itens 2 e 16), de regras de disponibilidade confiáveis e de guardrails. O item 6 (tradutor) é o primeiro passo barato no mesmo caminho.

### 3.5 Chaves sugeridas para `agendaPlans.js` (proposta, não aplicada)

| Chave | Plano mínimo | Limite novo |
|---|---|---|
| `no_show_protection` | pro | — |
| `sms_reminders` | starter | `sms_monthly`: starter 100 · pro 500 · premium 1500 |
| `payment_links`, `invoices` | pro | — (o Starter vê "em aberto") |
| `cleaning_checklist` | pro (equipe preenchendo: premium) | `photo_storage_mb` por plano |
| `tax_assistant` | pro (avisos de data no starter) | — |
| `translator` | pro | `ai_messages_monthly`: starter 10 · pro 200 · premium 1000 |
| `packages`, `gift_cards`, `promotions`, `forms`, `loyalty` | pro | — |
| `quotes` / `quote_calculator` | starter / pro | — |
| `day_map` | pro (por equipe: premium) | — |
| `docs_vault`, `offline` | starter | — |
| `tap_to_pay`, `whatsapp_auto` | pro (add-on de mensagens) | `whatsapp_monthly` |
| `memberships`, `staff_pay`, `ai_receptionist` | premium | — |

---

## 4. Riscos e regras de loja

### 4.1 Apple: como vender a assinatura do AgendaPro

**O que dizem as diretrizes hoje** (App Review Guidelines, "Last Updated: June 8, 2026" [L1]):
- **3.1.1:** para destravar recursos ou funcionalidades (assinatura, versão completa), é preciso usar compra dentro do app (IAP).
- **3.1.1(a):** os entitlements de link externo **não são necessários** para incluir botões, links externos ou outras chamadas para compra em apps do **storefront dos EUA**.
- **3.1.3:** a proibição de incentivar outro meio de pagamento não vale para o storefront dos EUA. Fora dos EUA, as restrições antigas continuam.
- **3.1.3(e):** bens e serviços consumidos fora do app (o horário, a limpeza) **devem** usar meio que não seja IAP. Sinal, link de pagamento e Tap to Pay podem seguir.
- **3.1.3(f):** app gratuito que é companheiro de uma ferramenta web paga não precisa de IAP, "desde que não haja compra dentro do app nem chamadas para compra fora dele".

**Linha do tempo:**
- **30/04/2025:** a juíza Gonzalez Rogers considera a Apple em desacato.
- **01–02/05/2025:** a Apple atualiza as diretrizes para os EUA [L3].
- **11/12/2025:** o 9º Circuito mantém o desacato e as restrições a telas de aviso, mas permite que a Apple peça alguma comissão baseada em custos reais [L4].
- **06/05/2026:** a Suprema Corte nega suspender a decisão [L5].
- **30/06/2026:** a Suprema Corte aceita revisar o desacato (só essa questão) [L6].
- **Ago/2026:** a Apple propõe 15% (10% em renovações e 5% no Small Business Program) para compras via link. Até o tribunal decidir, a cobrança é 0% [L7][L8].

**O ponto que pega:** desenvolvedores relatam que a App Review continua dizendo que as mudanças não alteraram *quando* o IAP é exigido. Para apps que não são "leitores", o link externo nos EUA **complementa** o IAP, mas não o substitui [L9][L10]. A pergunta exata ("app não-leitor pode ter só checkout web no storefront dos EUA?") segue sem resposta oficial no fórum da Apple [L11]. A AppBarber, concorrente brasileira, vende o plano por assinatura da Apple [C32].

| Opção | Como funciona | Risco de rejeição | Custo | Recomendação |
|---|---|---|---|---|
| **A. App companheiro** | App grátis, login com conta. Teste de 14 dias e assinatura **só na web** (página `/agenda/planos`). No iOS, nenhum preço, botão ou "assine no site". A tela de planos mostra o que está incluído e o status | Baixo (3.1.3(f)) | 0% | **Usar no lançamento** |
| A+. Companheiro + link só nos EUA | Igual à A, com botão "Assinar no site" para o storefront dos EUA | Médio: a exceção dos EUA em 3.1.3 conflita com o texto de 3.1.3(f) | 0% hoje (comissão pode vir) | Só com confirmação por escrito da App Review |
| B. IAP + link opcional nos EUA | Assinatura pela Apple (RevenueCat ou `expo-iap`) e, nos EUA, também link para o Stripe com outro preço | Baixo | 15% no IAP (Small Business Program); link 0% por enquanto | Fase 2, se a conversão no app importar |
| C. Só link externo, sem IAP | Botão leva ao Stripe | Alto (relatos de rejeição; status legal em disputa) | 0% hoje | Evitar |

**Implicações práticas para o app:**
- Criar um modo de compra por plataforma (ex.: `PURCHASE_MODE` em `lib/config.js`) que esconde preço e CTA no iOS na opção A. O texto do bloqueio também precisa mudar: hoje `requireFeature` responde "Assine para usar…", e no iOS isso deve virar "Esse recurso faz parte do plano Pro" sem chamada de compra.
- Parte das usuárias pode ter Apple ID da loja do Brasil. Nesse storefront a exceção dos EUA **não** vale. Se o app for publicado também no storefront BR, a opção A é obrigatória lá. Vale medir quantas usuárias estão nesse caso.
- Teste grátis criado no app sem cartão é permitido (criação de conta grátis). Só a compra precisa seguir a opção escolhida.

### 4.2 Google Play (EUA): cobrança alternativa e links

- **6/10/2025:** a Suprema Corte nega o pedido do Google para suspender a injunção do caso Epic [L12].
- **29/10/2025:** o Google para de exigir o Play Billing nos EUA e passa a permitir link externo e cobrança alternativa [L16]. Segundo a imprensa, a injunção vale até 01/11/2027.
- **Programas:**
  - *External content links* (ECL) e *alternative billing* nos EUA. Quem já usava link teve de se inscrever até 28/01/2026.
  - A página do ECL, atualizada em 22/07/2026, diz que o relatório e o pagamento de taxa começam em **01/10/2026**, com prazo de **01/12/2026** para pagar a taxa de downloads [L13][L14].
  - As taxas citadas são 10% para assinatura e para o primeiro US$1 mi e até 20% em outros casos.
  - Desde 30/06/2026, segundo a imprensa, a estrutura passou a 10% de serviço + 5% só para quem usa Play Billing. A parte dos EUA dependia de aprovação judicial [L15].
- **Recomendação:** no Android, usar a mesma **opção A**: app sem compra e sem link de compra, assinatura na web. Assim não é preciso entrar em nenhum programa nem reportar transação. Confirmar na política de Pagamentos do Play que um app só de acesso (conta já paga na web) não exige inscrição. Se mais tarde quisermos o botão "Assinar", inscrever no ECL e prever a taxa na margem.

### 4.3 Exclusão de conta (obrigatória nas duas lojas)

- **Apple 5.1.1(v)** [L1][L2]:
  - Se o app cria conta, a exclusão tem de ser iniciada **dentro do app**, em lugar fácil (Configurações).
  - Exclui a conta e os dados pessoais. **Só desativar não basta.**
  - Pode ter confirmação ou nova autenticação, mas não pode exigir e-mail, telefone ou chat.
  - Se depender de site, o link deve ir direto para a página de exclusão.
  - Pode levar tempo, desde que avise o prazo e confirme no fim.
  - Se houver assinatura da Apple, é preciso avisar que a cobrança continua até ela cancelar.
  - Informar o que fica retido por lei.
- **Google Play** [L17]: caminho dentro do app **e** um link web, informado no formulário Data safety do Play Console, onde dê para pedir a exclusão sem reinstalar o app. As perguntas de exclusão do Data safety são obrigatórias.
- **No nosso caso:**
  - O contrato já prevê `POST /api/agenda/me { action: 'delete_account' }`. Falta conferir se a tela de configurações chama essa ação e se existe uma página pública (ex.: `/agenda/excluir-conta`) para o Google.
  - Na exclusão, cancelar a assinatura do Stripe e desconectar a conta Connect.
  - Avisar que a lista de clientes e o histórico também serão apagados, e oferecer exportar o CSV antes.
  - Registros financeiros que precisem ser guardados (ex.: cobranças processadas) devem ser listados no aviso.

### 4.4 Push no Expo SDK 54

- Desde o SDK 53, o push remoto não funciona no **Expo Go Android**, e é preciso **development build**. Notificação local continua funcionando no Expo Go. A doc do SDK 54 foi revisada em 22/07/2026 [L18].
- Na prática:
  - Criar perfis `development` e `preview` no `eas.json` e testar push em aparelho físico.
  - Subir a credencial **FCM V1** (Android) e a chave **APNs** (iOS) no EAS.
  - No Android 13+, pedir a permissão em tempo de execução, senão o token vem mas a notificação não aparece.
- O mesmo vale para Tap to Pay, widgets e Stripe Terminal: nada disso roda no Expo Go. Migrar o time para dev build agora evita retrabalho.

### 4.5 Outros riscos

| Risco | O que diz a regra / a fonte | Mitigação |
|---|---|---|
| Login social | Apple 4.8: se usar login do Google ou Facebook como conta principal, precisa oferecer uma opção equivalente com privacidade (ex.: Sign in with Apple) [L1] | Hoje o app usa só e-mail, senha e código, então está ok. Se o login Google do site vier para o app, incluir Sign in with Apple junto |
| App "embrulho de site" | Apple 4.2: o app precisa ir além de um site reempacotado [L1] | As telas são nativas. Evitar WebView para fluxos centrais |
| SMS e TCPA | Consentimento prévio; opt-out em até 10 dias úteis; opt-out por categoria aprovado em 30/09/2026, vigente 30 dias após publicação [M7][M8][M9] | Checkbox de consentimento com registro, STOP automático, categorias separadas (lembrete ≠ marketing), horário comercial |
| WhatsApp API | Preço mudou em 01/07/2025 e de novo em 01/10/2026 (serviço passa a ser cobrado) [M10][M11][M12] | Tratar como add-on com cota. Revisar custo a cada trimestre (o Meta só muda preço no 1º dia do trimestre) |
| Taxa extra no Tap to Pay | Fontes divergem sobre +10¢ por autorização [M3] | Confirmar no painel do Stripe antes de precificar |
| Cálculo de imposto | Taxas mudam no meio do ano (milhagem 2026) e regras dependem de SSN/ITIN [D2][D8] | Tabela anual no servidor, aviso de "estimativa", revisão por contador |
| Privacidade da comunidade | Clima de fiscalização migratória [D14]; as lojas exigem declarar dados (rótulos de privacidade da Apple, Data safety do Google) | Coletar o mínimo; nunca status migratório, SSN ou ITIN; fotos de casas com retenção curta; declarar contatos de clientes, fotos e localização (se houver check-in) |
| Licença profissional | A exigência de SSN/ITIN varia por estado [D18][D19][D20] | Nunca exigir número de licença no cadastro; o campo é opcional |
| Comissão futura da Apple e do Google | Apple: comissão de link em definição no tribunal [L7][L8]. Google: taxa de ECL em vigor desde out/2026 [L13] | Opção A não depende disso. Rever se migrar para A+/B |

---

## 5. Top 5 recomendações para a próxima versão

**Antes de tudo (bloqueia a publicação, não é recurso):**
1. Lançar como **app companheiro**, sem preço nem botão de compra no iOS nem no Android, com assinatura na web. O modo de compra deve ser configurável por plataforma.
2. **Exclusão de conta** no app + página web de exclusão (Google).
3. **Development build do EAS** com FCM V1 e APNs, para o push funcionar.

**Os 5 recursos:**

1. **Proteção contra falta (Pro)**: cartão salvo na página pública, política aceita, taxa de cancelamento tardio ou falta em 1 toque, e link "remarcar" no lembrete. Fecha o maior buraco frente a Booksy, GlossGenius e Square, e é argumento direto de upgrade do Starter para o Pro. *Esforço M, Stripe Connect já existe.*
2. **Lembrete e confirmação por SMS com consentimento TCPA (Starter com cota)**: "responda C para confirmar", STOP automático e opt-out por categoria. Alcança a cliente americana que não usa WhatsApp. Cota de 100/500/1.500 por plano, com pacote extra. *Esforço M/G por causa do registro 10DLC. Mandar em inglês evita o custo dobrado do acento.*
3. **Cobrança por link + "quem está devendo" + fatura mensal do anfitrião (Pro)**: tira o dinheiro da rua, alimenta Finanças sozinho e prepara o terreno para o Tap to Pay. *Esforço M.*
4. **Checklist de limpeza com fotos antes/depois e relatório (Pro; equipe no Premium)**: prova o serviço para a cliente americana e o anfitrião de Airbnb sem depender de inglês. O Jobber deixa essa lacuna aberta. Junto com o turnover iCal que já temos, nos coloca na frente do Turno para quem tem equipe própria. *Esforço M, pacotes de câmera já instalados.*
5. **Assistente de impostos trimestrais (Pro; avisos de data no Starter)**: vencimentos do 1040-ES com push (próximo: 15/01/2027), estimativa do self-employment tax, milhagem com taxa por data, alertas de 1099-K e 1099-NEC, aviso de SSN/ITIN no "no tax on tips" e pacote para o contador. Nenhum concorrente de agenda pesquisado oferece isso, e é a dor que mais diferencia a brasileira imigrante. *Esforço M, exige revisão de contador.*

**Bônus barato para a mesma versão:** o **tradutor e redator de mensagens PT↔EN** (item 6, esforço P). Ataca a barreira de idioma com pouco código e abre caminho para a recepcionista com IA depois.

**O que não fazer agora:** marketplace, clube de assinatura, WhatsApp API, recepcionista com IA, widget (exige SDK 55) e Tap to Pay (exige entitlement da Apple). Todos ficam para as ondas 2 e 3, depois que os itens acima mostrarem uso.

---

## 6. Fontes

Acesso em 09/10/2026, salvo indicação. A data entre parênteses é a de publicação ou atualização, quando a fonte mostra.

### Lojas, regras e plataforma
- [L1] Apple — App Review Guidelines (Last Updated: June 8, 2026) — https://developer.apple.com/app-store/review/guidelines/
- [L2] Apple — Offering account deletion in your app — https://developer.apple.com/support/offering-account-deletion-in-your-app/
- [L3] Michael Tsai — App Review Guidelines Updated for Epic Anti-Steering (02/05/2025) — https://mjtsai.com/blog/2025/05/02/app-review-guidelines-updated-for-epic-anti-steering
- [L4] Fenwick — Ninth Circuit Largely Upholds Ruling in Epic v. Apple (dez/2025) — https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple
- [L5] The Next Web — Supreme Court nega suspensão no caso Apple x Epic (06/05/2026) — https://thenextweb.com/news/supreme-court-apple-epic-contempt-stay-denial
- [L6] Daring Fireball — Supreme Court aceita revisar o desacato (30/06/2026) — https://daringfireball.net/linked/2026/06/30/scotus-apple-epic
- [L7] iPhone in Canada — Apple propõe 15% em compras fora da App Store (14/08/2026) — https://www.iphoneincanada.ca/2026/08/14/apple-proposes-15-cut-purchases-outside-app-store/
- [L8] Courthouse News — comissão de compras via link segue na corte distrital (2026) — https://www.courthousenews.com/apples-fight-over-commissions-for-linked-out-app-store-purchases-continues-in-district-court/
- [L9] Superwall — External checkout: confirmed Apple's rules for iOS (2025) — https://superwall.com/blog/external-checkout-a-b-testing-and-trial-toggles-confirmed-apples-rules-for-ios
- [L10] Purchasely — Implementing web payment for US customers — https://docs.purchasely.com/docs/implementing-web-payment-for-us-customers
- [L11] Apple Developer Forums — "Can a non-reader iOS app offer web-only subscription checkout on the US storefront?" — https://developer.apple.com/forums/thread/841132
- [L12] Engadget — Supreme Court denies Google's request to pause Play Store changes (out/2025) — https://engadget.com/big-tech/supreme-court-denies-googles-request-to-pause-play-store-changes-while-it-appeals-epic-case-121502132.html
- [L13] Google Play Console Help — External content links program (EUA; atualização de 22/07/2026) — https://support.google.com/googleplay/android-developer/answer/16470497?hl=en
- [L14] Google Play Console Help — Alternative billing para usuários nos EUA — https://support.google.com/googleplay/android-developer/answer/13821247?hl=en
- [L15] Adapty — What Google Play's new billing rules mean for subscriptions (jun/2026) — https://adapty.io/blog/google-play-billing-changes-subscriptions-fees
- [L16] Neon Pay — The latest on alternative payments for Android in the U.S. — https://www.neonpay.com/blog/the-latest-on-alternative-payments-for-android-in-the-u-s
- [L17] Google Play — Understanding Google Play's app-account deletion requirements — https://support.google.com/googleplay/android-developer/answer/13327111
- [L18] Expo — Notifications, SDK 54 (modificado em 22/07/2026) — https://docs.expo.dev/versions/v54.0.0/sdk/notifications/
- [L19] Expo — expo-widgets (alpha, iOS) — https://docs.expo.dev/versions/latest/sdk/widgets/
- [L20] react-native-android-widget — https://github.com/sAleksovski/react-native-android-widget

### Pagamentos e mensagens
- [M1] Stripe — Tap to Pay (docs) — https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay
- [M2] Stripe Support — Tap to Pay on iPhone or Android and Stripe Terminal — https://support.stripe.com/questions/tap-to-pay-on-iphone-or-android-and-stripe-terminal
- [M3] Beancount — Tap to Pay no celular: custo para o lojista (20/09/2026) — https://beancount.io/blog/2026/09/20/tap-to-pay-iphone-android-no-terminal-merchant-cost-guide
- [M4] Twilio — SMS pricing, United States — https://www.twilio.com/en-us/sms/pricing/usa
- [M5] Twilio Support — Comparison between Starter, Low Volume Standard and Standard registration for A2P 10DLC — https://support.twilio.com/hc/en-us/articles/4407882914971
- [M6] Telnyx — Twilio vs Telnyx SMS pricing (taxas de operadora) — https://telnyx.com/resources/twilio-telnyx-sms-pricing
- [M7] Troutman Pepper — FCC revises TCPA revocation of consent rules (17/09/2026) — https://www.troutman.com/insights/fcc-revises-tcpa-revocation-of-consent-rules-that-were-set-to-go-into-effect-in-january/
- [M8] Manatt — FCC Replaces "Revoke All" Rule (set/2026) — https://www.manatt.com/insights/newsletters/client-alert/fcc-replaces-revoke-all-rule-and-permits-callers-to-designate-an-exclusive-revocation-method
- [M9] Nixon Peabody — FCC partially delays new TCPA consent revocation rules (11/04/2025) — https://nixonpeabody.com/insights/alerts/2025/04/11/fcc-partially-delays-new-tcpa-consent-revocation-rules
- [M10] Meta — Pricing on the WhatsApp Business Platform (atualizado em 30/03/2026) — https://developers.facebook.com/docs/whatsapp/pricing
- [M11] respond.io — WhatsApp pricing change 2026 — https://respond.io/blog/whatsapp-pricing-change-2026
- [M12] YCloud — WhatsApp service messages will no longer be free (2026) — https://www.ycloud.com/blog/whatsapp-service-messages-24-hour-window-pricing
- [M13] Venmo Help — Business profile fees — https://help.venmo.com/hc/en-us/articles/1500003204302-Business-Profile-Fees-
- [M14] Cash App Help — Cash App Business fees — https://cash.app/help/6521-cash-app-business-fees
- [M15] Georgia Banking Company — Zelle para pequenas empresas — https://georgiabanking.com/Zelle-small-business

### Dores, impostos e comunidade
- [D1] IRS — IRS sets 2026 business standard mileage rate at 72.5 cents per mile (29/12/2025) — https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents
- [D2] Journal of Accountancy — IRS raises standard mileage rates for remainder of 2026 (jul/2026) — https://www.journalofaccountancy.com/news/2026/jul/irs-raises-standard-mileage-rates-for-remainder-of-2026/
- [D3] NerdWallet — Estimated quarterly taxes, 2025 and 2026 due dates — https://www.nerdwallet.com/taxes/learn/estimated-quarterly-taxes
- [D4] Kiplinger — When are estimated tax payments due in 2026? — https://www.kiplinger.com/taxes/tax-deadline/602538/when-estimated-tax-payments-due
- [D5] Journal of Accountancy — Social Security wage base and COLA announced for 2026 (out/2025) — https://www.journalofaccountancy.com/news/2025/oct/social-security-wage-base-and-cola-announced-for-2026/
- [D6] IRS — What the "No Tax on Tips" deduction means for you — https://www.irs.gov/newsroom/what-the-no-tax-on-tips-deduction-means-for-you
- [D7] IRS — Treasury, IRS issue final regulations listing occupations… (10/04/2026) — https://www.irs.gov/newsroom/treasury-irs-issue-final-regulations-listing-occupations-where-workers-customarily-and-regularly-receive-tips-under-the-one-big-beautiful-bill
- [D8] TaxAct — OBBB limits tax credits for ITIN filers without SSNs — https://blog.taxact.com/obbb-limits-tax-credits-for-itin-filers-without-ssn/
- [D9] Bankrate — 1099-K tax rules for Venmo, Cash App, PayPal — https://www.bankrate.com/taxes/1099-k-tax-rules-what-you-need-to-know-if-you-get-paid-via-venmo-cash-app-or-paypal/
- [D10] Credit Karma — 1099-K threshold — https://www.creditkarma.com/tax/library/irs-forms/1099-k-threshold/
- [D11] Pew Research Center — Americans' social media use 2025 (20/11/2025; dado de 32% citado via cobertura secundária) — https://www.pewresearch.org/internet/2025/11/20/americans-social-media-use-2025/
- [D12] The Latino Newsletter — WhatsApp's power and perils for U.S. Latinos (relatório DDIA) — https://thelatinonewsletter.org/p/whatsapp-power-and-perils-us-latinos
- [D13] Universidade do Intercâmbio — cidades com mais brasileiros no exterior (dados do Relatório Consular do Itamaraty 2025) — https://www.universidadedointercambio.com/cidades-com-mais-brasileiros-no-exterior/
- [D14] Metrópoles — Itamaraty diz que 2,6 mil brasileiros estão presos nos EUA (dez/2025) — https://www.metropoles.com/colunas/igor-gadelha/itamaraty-diz-que-26-mil-brasileiros-estao-presos-no-eua
- [D15] UMass Boston — pôster sobre condições de trabalho de faxineiras brasileiras em MA (2014) — https://scholarworks.umb.edu/ocp_posters/263
- [D16] Insureon — Steps to get your cleaning business bonded and insured — https://www.insureon.com/blog/steps-to-get-your-cleaning-business-bonded-and-insured-and-how-much-it-costs
- [D17] ZenMaid Magazine — Cleaning business insurance & bonding — https://www.zenmaid.com/magazine/cleaning-business-insurance-bonding/
- [D18] California Board of Barbering and Cosmetology — aviso sobre ITIN — https://www.barbercosmo.ca.gov/forms_pubs/important_tin_notice_top_sc.pdf
- [D19] NCSL — Professional and occupational licenses for immigrants — https://www.ncsl.org/immigration/professional-and-occupational-licenses-for-immigrants
- [D20] Massachusetts H.451 (2025–2026) — https://app.azure.legiplex.com/ma/legislature/2025/2025-r/bills/h451
- [D21] SchedulingKit — Appointment no-show statistics (2026) — https://schedulingkit.com/hub/scheduling/appointment-no-show-statistics
- [D22] SimplyBook.me — How much do no-shows really cost? — https://simplybook.me/blog/cost-of-no-shows
- [D23] RedAwning — Airbnb cleaner, Myrtle Beach (sazonalidade do turnover) — https://redawning.com/pm/post/airbnb-cleaner-myrtle-beach · WorkWave — Airbnb e negócio de limpeza — https://insights.workwave.com/industry/cleaning-services/how-your-cleaning-business-can-earn-more-revenue-with-airbnb/

### Concorrentes
- [C1] Capterra — Booksy Biz pricing 2026 — https://www.capterra.com/p/142741/Booksy/pricing/
- [C2] Koalendar — Booksy pricing (jun/2026) — https://koalendar.com/blog/booksy-pricing
- [C3] Booksy — No-Show Protection — https://biz.booksy.com/en-us/features/no-show-protection
- [C4] Booksy — Boost — https://biz.booksy.com/features/boost
- [C5] Booksy — Marketing tools — https://biz.booksy.com/en-us/features/marketing-tools
- [C6] Pabau — Fresha review (jul/2026) — https://pabau.com/blog/fresha-review/
- [C7] Fresha — Enable Smart pricing — https://www.fresha.com/help-center/knowledge-base/marketing/101321-enable-smart-pricing
- [C8] Software Advice — Vagaro 2026 — https://www.softwareadvice.com/scheduling/vagaro-profile/
- [C9] Vagaro — Daily Deals — https://www.vagaro.com/en-au/learn/6-tips-for-perfect-daily-deals-promotions
- [C10] GlossGenius — Pricing — https://glossgenius.com/pricing
- [C11] CostBench — GlossGenius pricing 2026 (jul–ago/2026) — https://www.costbench.com/software/salon-spa/glossgenius/
- [C12] GlossGenius — No-show protection — https://glossgenius.com/no-shows-protection-card-on-file
- [C13] Techstars — GlossGenius becomes Genius AI (jul/2026) — https://www.techstars.com/blog/startup-spotlight/glossgenius-becomes-genius-ai-inside-the-dollar115b-bet-on-the-physical-economy
- [C14] Square — Appointments — https://www.square.com/us/en/appointments
- [C15] CostBench — Square Appointments (ago/2026) — https://www.costbench.com/software/salon-spa/square-appointments/
- [C16] Toolradar — Setmore pricing — https://toolradar.com/tools/setmore/pricing
- [C17] Koalendar — Acuity Scheduling pricing 2026 — https://koalendar.com/blog/acuity-scheduling-pricing
- [C18] CostBench — Schedulicity — https://costbench.com/software/gym-management/schedulicity/
- [C19] Fieldproxy — Jobber pricing 2026 — https://www.fieldproxy.ai/fsm-software-pricing/jobber
- [C20] Jobber — Client hub — https://getjobber.com/features/client-hub/
- [C21] Jobber — Customer communication — https://getjobber.com/features/customer-communication-management/
- [C22] Jobber Community — pedido de fotos antes/depois por visita — https://community.getjobber.com/discussions/customer-management-and-self-serve/needed-feature-add-before--after-photos-for-individual-visits/7153
- [C23] Toolradar — ZenMaid pricing (30/05/2026) — https://toolradar.com/tools/zenmaid/pricing
- [C24] Fieldproxy — Housecall Pro pricing 2026 (verificado em 05/06/2026) — https://www.fieldproxy.ai/fsm-software-pricing/housecall-pro
- [C25] CostBench — BookingKoala — https://costbench.com/software/cleaning-service-software/bookingkoala/
- [C26] Launch27 — Pricing — https://launch27.com/pricing
- [C27] Capterra — Turno — https://www.capterra.com/p/166734/Turno/
- [C28] STR Specialist — Turno review (2026) — https://strspecialist.com/reviews/turno-cleaning-marketplace-review
- [C29] Trinks — Negócios — https://negocios.trinks.com/
- [C30] Capterra — Trinks — https://www.capterra.com/p/252863/Trinks/
- [C31] AppBarber — site (planos e recursos) — https://www.appbarber.com.br/
- [C32] App Store — AppBarber PRO — https://apps.apple.com/app/id1602535418
- [C33] GetApp — Gendo — https://www.getapp.com/all-software/a/gendo/
- [C34] App Store — Avec — https://apps.apple.com/br/app/avec/id1394288142
- [C35] Square Help (AU) — Create and manage packages with Square Appointments — https://api.squareup.com/help/au/en/article/8268-create-and-manage-packages-with-square-appointments
