# WorkPro — pesquisa de produto: orçamentos, faturas e o que falta

**Data:** 09/10/2026 · **Escopo:** WorkPro (variante `workpro` do app AgendaPro) para autônomos de serviço nos EUA: construção e reforma, handyman, marceneiro, pintor, eletricista, encanador, paisagismo, tradutor e afins. Planos Starter US$19 / Pro US$39 / Premium US$79.
**Base lida antes da pesquisa:** `agendapro/CONTRACT.md` (seção WorkPro, rodada 2), `api/_lib/agendaPlans.js` (matriz de recursos), `api/_lib/docCalc.js` (conta dos valores), `supabase/ag_app_documents.sql` (colunas e CHECKs) e `agendapro/lib/variant.js` (especialidades do cadastro).
**Como ler:** a seção 1 é o resumo, a 2 compara concorrentes, a 3 é a lista priorizada do que falta, a 4 reúne os riscos legais e fiscais e a 5 traz as 5 recomendações. As fontes estão numeradas no fim: [C] concorrentes e mercado, [J] jurídico, [F] fiscal e pagamentos, [T] tradução.

> **Limites desta pesquisa.** Boa parte dos preços vem de agregadores (Capterra, CostBench, Fieldproxy, PricingSaaS) e de blogs de concorrentes (Projul, QuoteIQ, OneCrew, Hearth), que têm interesse na comparação. Os números divergem entre fontes e mudam com frequência; confirme no site do fornecedor antes de usar em material público. **Nada aqui é conselho jurídico ou tributário.** A seção 4 é um panorama para orientar decisões de produto, não texto para colocar no app. Lei estadual de construção muda todo ano, então qualquer texto de contrato ou aviso precisa passar por advogado do estado antes de ir para produção.

---

## 1. Resumo executivo

1. **O v1 já cobre o básico que os concorrentes de entrada vendem.** Temos orçamento com itens, desconto e imposto; aprovação por link com assinatura desenhada; conversão em fatura (inteira, entrada ou etapas); cartão via Stripe (Pro); lembrete automático; e pedido de orçamento com fotos. No preço, o WorkPro briga com Joist (US$10–32) e Invoice Simple (US$7–22) e fica bem abaixo de Jobber (US$49+) e Housecall Pro (US$59–79+) [C1][C4][C6][C9].
2. **O Starter é generoso.** São 20 documentos por mês, contra 5 no Joist Basics e 3 no Invoice Simple Essentials [C1][C4]. O diferencial é juntar agenda, orçamento e fatura em português, com o documento saindo em inglês ou espanhol para o cliente. Nenhum concorrente grande tem interface em português.
3. **Para quem faz obra, os buracos mais visíveis são cinco:** markup de material (custo x preço), change orders (aditivos) assinados, opções bom/melhor/ótimo, pagamento por ACH e financiamento ao cliente. O Joist só libera change orders no plano Elite (US$32). O Jobber nem tem change order nativo: no fórum dele, usuários reclamam que editar o orçamento apaga a assinatura original [C2][C7].
4. **A assinatura do v1 é um bom começo, mas fraca como prova.** Hoje gravamos desenho, nome, IP e navegador. Faltam quatro coisas que pesam numa disputa: consentimento do consumidor para documento eletrônico, documento congelado no momento da assinatura (hash ou PDF), cópia enviada ao cliente e trilha de auditoria [J1].
5. **Contrato de reforma residencial tem regra estadual dura.** Exemplos: número da licença no orçamento (CA, FL); limite de entrada (CA: o menor entre US$1.000 e 10%; MA: 1/3); aviso de cancelamento em 3 dias quando o contrato é fechado na casa do cliente; avisos obrigatórios de lien (FL acima de US$2.500; TX) [J2]–[J8]. É risco e é oportunidade: um "pacote de contrato por estado" revisado por advogado protege a profissional brasileira, que muitas vezes trabalha com combinado verbal.
6. **ACH é o recurso de pagamento com melhor retorno por esforço.** Pela Stripe, ACH custa 0,8% com teto de US$5; o cartão custa 2,9% + 30¢. Numa fatura de US$10.000, são US$5 contra US$290,30 [F1].
7. **Sales tax é a área mais confusa.** Na maioria dos estados, quem faz reforma é o "consumidor final" do material: paga o imposto na compra e não cobra do cliente. No Texas, o reparo residencial não tem imposto sobre mão de obra, mas no contrato "separado" o imposto incide sobre o material. Em NJ, a mão de obra de reparo é tributada [F2]–[F6]. O app não deve escolher a alíquota sozinho; deve oferecer modos claros e um aviso.
8. **"Tradutor juramentado" é cargo público brasileiro.** Exige concurso e matrícula na Junta Comercial. Nos EUA não existe licença de tradutor: "certified translation" é uma declaração assinada pelo próprio tradutor. O USCIS exige tradução completa e certificação de competência e exatidão, sem notarização [T1][T2][T4]. A especialidade "Tradutor juramentado" no cadastro pode induzir o cliente a erro; sugiro renomear.
9. **Top 5 para a próxima versão:**
   1. assinatura com validade jurídica e documento congelado;
   2. change orders;
   3. markup de material e itens opcionais;
   4. ACH com "aprovar e pagar a entrada";
   5. modelos por especialidade com pacote de contrato por estado.
10. **Atalho de engenharia.** O `supabase/ag_app_documents.sql` ainda **não foi aplicado**. Hoje, acrescentar colunas para custo/markup, item opcional, change order, modo de imposto e hash da assinatura custa bem menos do que uma migração depois (lista na seção 5.6).

---

## 2. Concorrentes

### 2.1 Preço e posicionamento (US$/mês, salvo indicação)

| Concorrente | Foco | Entrada | Faixa / modelo | Taxas de pagamento | Observações |
|---|---|---|---|---|---|
| **Joist** | Orçamento e fatura para empreiteiro solo | 10 (Basics, 5 documentos/mês) | Pro 17 (ilimitado, contratos, e-sign, ordem de serviço); Elite 32 (change orders, relatórios, licença e seguro no documento). Na App Store: 7,99 / 14,99 / 31,99. Sync com QuickBooks +9,99 | À parte da assinatura (valor não confirmado) | Mostra financiamento ao cliente de graça no documento [C1][C2] |
| **Invoice Simple** | Fatura simples, qualquer ramo | 6,99 (3 faturas/mês) | Plus ~13,49–14,99 (10/mês); Premium 21,99 (ilimitado, assinatura do cliente, depósitos) | Stripe | Muitas reclamações de cobrança depois de cancelar [C4][C5] |
| **Jobber** | Serviço de campo | 49 (Core, 1 usuário) | Connect ~139; Grow a partir de 199 (itens opcionais só no Grow); +29 por usuário | Jobber Payments | Follow-up automático de orçamento e portal do cliente; sem change order nativo [C6][C7] |
| **Housecall Pro** | Serviço de campo | 59 anual / 79 mensal | Essentials 149/189; MAX 299/329 | Cartão 2,59%; ACH 1%; Klarna 4,99%; financiamento Wisetack 3,9% | Funciona melhor em serviço curto e repetido do que em projeto [C9][C10] |
| **Square Invoices** | Fatura grátis | 0 | Invoices Plus ~20 (parcelas por marco, pacotes no orçamento, conversão automática em fatura) | Online 3,3% + 30¢ (grátis) ou 2,9% + 30¢ (Plus); ACH 1% (mín. US$1) | Orçamento e contrato já no plano grátis [C11] |
| **QuickBooks** | Contabilidade | Solopreneur 0 (2 faturas) ou 20 | Simple Start 38; Essentials 75–85 (aumento em ago/2026) | Fatura no cartão 2,9%; ACH 1% (as fontes divergem sobre o teto de US$10) | O preferido do contador [C12] |
| **Wave** | Contabilidade e fatura grátis | 0 | Pro ~16–19 | Cartão 2,9% + 60¢; ACH 1% (mín. US$1) | [C13] |
| **Markate** | Serviço de campo + IA | ~39,95–49,95 | +5 por funcionário; muitos add-ons de 10; IA "Kate" cobrada por uso | — | Orçamento por foto, texto ou voz, com bom/melhor/ótimo (lançado em abr/2026) [C14][C22] |
| **Contractor Foreman** | Gestão de obra para pequeno | 49 (1 usuário) | 105 (3) / 166 (8) / 221 (15) / 332 (ilimitado) | Pagamento online | Change orders com aprovação, retenção, AIA G702/G703; nota 4,5 no Capterra [C15] |
| **Buildertrend** | Gestão de obra (remodeler) | ~299–499 (Essential, sem orçamento nem change order) | Advanced ~499–799; Complete ~799–1.099; onboarding caro | — | Grande demais para autônomo [C16] |
| **Jobkore** | Orçamento e fatura bilíngue EN/ES | 19 | — | Stripe | Prova de que existe espaço para "app no seu idioma" [C17] |
| **WorkPro hoje** | Autônomo brasileiro nos EUA | **19** (20 documentos/mês) | **39** (ilimitado, cartão, cobrança automática, etapas, fotos) / **79** (equipe, sem marca) | Stripe Connect (só cartão) | Único em português; agenda no mesmo app |

**Leitura rápida.** Nossa entrada (US$19) fica entre o Joist Pro (US$17) e o Invoice Simple Premium (US$21,99). Esses dois concorrentes não têm agenda nem português. Contra Jobber e Housecall Pro, a diferença é de 2,5 a 4 vezes no preço. O risco não está no preço, está nos recursos: quem faz obra compara change order, markup e ACH, e hoje perdemos nesses três.

### 2.2 Recurso x quem tem

Legenda: **S** = tem · **P** = só em plano superior · **nc** = não confirmado nesta pesquisa (pode existir) · **não** = a fonte indica que não tem.

| Recurso | Joist | Invoice Simple | Jobber | Housecall Pro | Square | Contractor Foreman | Markate | **WorkPro v1** |
|---|---|---|---|---|---|---|---|---|
| Orçamento aprovado online com assinatura | P (Pro) | P (Premium) | S | nc | S | S | nc | **S** |
| Change order assinado | P (Elite) | nc | não (contorno manual) | nc | nc | S | nc | **não** |
| Markup de material (custo → preço) | S | nc | nc | S (tabela e calculadora) | nc | nc | nc | **não** |
| Itens opcionais / bom-melhor-ótimo | nc (só seções) | nc | P (Grow) | nc | P (pacotes no Plus) | nc | S (IA) | **não** |
| Fatura por etapa ou parcelas | nc | nc | S (cronograma no aceite) | nc | P (Plus) | S (AIA) | nc | **P (Pro)** |
| Retenção (retainage) | nc | nc | nc | nc | nc | S | nc | **não** |
| ACH | nc | nc | nc | S (1%) | S (1%) | nc | nc | **não** |
| Financiamento ao cliente | S | nc | nc | S (Wisetack) | nc | nc | nc | **não** |
| Follow-up automático de orçamento | nc | nc | S | nc | nc | nc | nc | **não** (só lembrete de fatura) |
| Lembrete automático de fatura vencida | S | nc | nc | nc | nc | nc | nc | **P (Pro)** |
| Contrato e termos | P (Pro) | nc | nc | nc | S | nc | nc | Campo de termos livre |
| Licença e seguro no documento | P (Elite) | nc | nc | nc | nc | nc | nc | **S** (campos do perfil) |
| Orçamento por foto ou voz com IA | nc | nc | nc (fórum relata erro de escopo) | nc | nc | nc | S | **não** |
| Interface em português | não | não | não | não | não | não | não | **S** |

Fontes da tabela: [C1][C2][C3][C4][C7][C10][C11][C14][C15].

### 2.3 O que os usuários mais valorizam e do que mais reclamam

**Valorizam**
- **Rapidez no celular e documento com cara profissional.** É o elogio mais comum ao Joist e ao Invoice Simple [C3][C5].
- **Fluxo lógico de pedido → orçamento → serviço → fatura, com pagamento fácil para o cliente.** É o principal elogio ao Jobber [C8].
- **Link de pagamento na fatura.** Uma base de 3,7 milhões de faturas de empreiteiros mostra 79,6% das faturas com link pagas, contra 56,1% sem link, e mediana de 8 dias contra 15 [C21]. A fonte é um fornecedor do setor, mas a direção bate com o resto do mercado.
- **Clientes e itens salvos**, para repetir orçamento em segundos [C5].
- **Aviso automático de fatura vencida e integração com a contabilidade** [C3].

**Reclamam**
- **Cobrança depois de cancelar**, cancelamento só por telefone e aumentos de preço (Invoice Simple, Housecall Pro) [C5][C10].
- **Suporte fraco e sistema fora do ar**, que bloqueia fatura e pagamento (Joist) [C3].
- **Orçamento sem histórico, sem "desfazer" e sem bom/melhor/ótimo**, além de falta de agenda (Joist) [C3].
- **Pouca personalização do orçamento e da fatura**, e dificuldade de dividir um orçamento em vários serviços ou um serviço em várias faturas (Jobber) [C8].
- **Pagar à parte por usuário e por add-on** (Jobber, Housecall Pro, Markate) [C8][C10][C14].
- **Change order que apaga a assinatura original** do orçamento (fórum do Jobber) [C7].

**Contexto de inadimplência.** Segundo pesquisa da Intuit de 2025 (relatada por terceiro), 56% das pequenas empresas dos EUA têm faturas em aberto, com média de US$17.500 por empresa. Na base de 3,7 milhões de faturas, só 15,5% declaram prazo de pagamento. Entre subcontratados de obra, 92% bancaram folha esperando pagamento em 2025 [C21].

**Lições para o WorkPro:**
- cancelamento honesto e fácil;
- nada de add-on escondido;
- histórico de versões do orçamento;
- change order que preserva a assinatura original;
- prazo de pagamento sempre visível na fatura.

---

## 3. O que falta no WorkPro v1 (lista priorizada)

**Escala.**
- **Esforço** (1 dev): **P** = até 3 dias · **M** = 1 a 2 semanas · **G** = 3 semanas ou mais, ou depende de terceiro ou de revisão jurídica.
- **Impacto:** efeito esperado em conversão, retenção ou receita da profissional.
- **Onda:** 1 = próxima versão · 2 = seguinte · 3 = depois.

| # | O que falta | Esforço | Impacto | Plano sugerido | Onda |
|---|---|---|---|---|---|
| 1 | Assinatura com validade jurídica (ESIGN/UETA) e documento congelado | M | Alto | Todos | 1 |
| 2 | Change orders (aditivos) assinados | M | Alto | Pro | 1 |
| 3 | Markup e custo de materiais | P–M | Alto | Starter (markup) / Pro (relatório de margem) | 1 |
| 4 | Itens opcionais e bom/melhor/ótimo | M | Alto | Pro | 1 |
| 5 | Pagamento por ACH na fatura | M | Alto | Pro | 1 |
| 6 | "Aprovar e pagar a entrada" + follow-up automático de orçamento | P | Alto | Pro | 1 |
| 7 | Modelos por especialidade (itens, unidades, termos, etapas) | P | Alto | Starter | 1 |
| 8 | Pacote de contrato por estado (avisos, limites, cancelamento) | G (jurídico) | Alto | Starter | 1→2 (estado a estado) |
| 9 | Licença e seguro com rótulo por estado + certificado de seguro anexo | P | Médio | Starter | 1 (junto do #8) |
| 10 | Cobrança escalonada (cadência, multa contratual, extrato, carta final) | P–M | Alto | Pro | 2 |
| 11 | Modos de sales tax + duas alíquotas + certificado de isenção | M | Médio–Alto | Starter | 2 |
| 12 | Financiamento ao cliente (Klarna via Stripe, depois Wisetack) | P / G | Médio (alto em reforma) | Pro | 2 |
| 13 | Histórico de versões do orçamento | P–M | Médio | Starter | 2 (sai quase de graça com o #1) |
| 14 | Horas e materiais (apontamento de horas, foto do recibo → fatura) | M | Médio–Alto (handyman) | Pro | 2 |
| 15 | Retenção (retainage) e fatura de liberação | P | Médio | Pro | 2 |
| 16 | IA: orçamento por voz e foto em português → documento em inglês | M–G | Alto (diferencial) | Premium ou créditos | 2–3 |
| 17 | Kit do tradutor (contagem, certificado, notarização, urgência, entrega) | M | Alto no nicho | Starter/Pro | 2 |
| 18 | Subcontratados: W-9, pagamentos e relatório para 1099-NEC | M | Médio | Premium | 3 |
| 19 | Portal do cliente (todos os documentos num link) | M | Médio | Pro | 3 |
| 20 | Exportação para QuickBooks | M–G | Médio | Premium | 3 |
| 21 | Lien: lembretes de prazo e, mais tarde, lien waivers | G + jurídico | Médio (sub) / Baixo (handyman) | Premium | 3 |
| 22 | Repassar a taxa do cartão ao cliente (surcharge) | P técnico, risco legal alto | Baixo | Não recomendo | — |

### 3.1 Assinatura com validade jurídica e documento congelado

**Por quê.** ESIGN e UETA dão validade à assinatura eletrônica quando três coisas se provam: houve intenção de assinar; a assinatura está ligada ao registro; e o registro pode ser guardado e reproduzido com exatidão. Para consumidor, há uma exigência a mais: antes de usar registro eletrônico, é preciso o consentimento dele, depois de avisos sobre o direito a cópia em papel, como retirar o consentimento e o que ele precisa ter para acessar e guardar o documento [J1]. Joist e Invoice Simple vendem e-sign como recurso pago [C1][C4], e esta é a base do contrato (#8) e do change order (#2).

**O que o v1 já tem.** `accepted_name`, `accepted_signature` (PNG), `accepted_ip`, `accepted_user_agent`, `accepted_at` e eventos de visualização.

**O que fazer:**
- **Consentimento:** caixa no `doc-public` antes de assinar, com texto curto nos 3 idiomas e link para a versão completa. A versão completa cobre cópia em papel sem custo, como retirar o consentimento e o que é preciso para guardar (navegador e e-mail). Gravar `consent_at` e `consent_text_version`.
- **Intenção explícita:** o botão diz o que está sendo assinado. Exemplo: "Aprovar e assinar o orçamento Q-0007 de $4,850.00".
- **Congelar:** no aceite, o servidor gera um snapshot canônico (campos, itens, termos e opções escolhidas) e o PDF. Grava `signed_hash` (SHA-256), `signed_snapshot` (jsonb) e `signed_pdf_url`. Depois do aceite, `update` responde 409 e orienta criar uma revisão (#13) ou um change order (#2).
- **Cópia:** e-mail automático com o PDF para o cliente e para a profissional. Assim, o registro continua "guardado e reproduzível" mesmo se a conta for excluída (ver 4.14).
- **Trilha de auditoria:** última página do PDF com um "certificado de assinatura": enviado em, visto em (IP e navegador), consentiu em, assinou em, hash do documento.
- **Identidade, opcional para valores altos:** código de 6 dígitos por e-mail ou SMS antes de assinar.
- **Contra-assinatura e vários assinantes:** a assinatura da profissional fica salva no perfil e entra no documento. O app aceita mais de um assinante: o homestead no Texas exige os dois cônjuges [J6] e Massachusetts pede assinatura datada de todas as partes [J7].

### 3.2 Change orders (aditivos)

**Por quê.** Em obra, o escopo muda. Advogados do setor contam que, sem aditivo assinado, o empreiteiro acaba "comendo" centenas ou milhares de dólares de trabalho extra para conseguir o cheque final. A recomendação é que cada aditivo diga escopo, preço, prazo e forma de pagamento, e mostre o total acumulado [C20].

**Concorrentes.** O Joist cobra o plano Elite por isso. O Jobber não tem o recurso: editar o orçamento apaga a assinatura [C2][C7]. O Contractor Foreman tem aprovação pelo portal e leva o aditivo para a fatura [C15].

**Como:**
- `ag_documents.kind = 'change_order'` (o CHECK atual só aceita `quote` e `invoice`). Acrescentar `parent_id`, que aponta para o orçamento aceito, e numeração própria (`CO-0003`).
- `schedule_days_delta`: dias acrescentados ao prazo. Os status seguem os do orçamento.
- **Itens de crédito:** aditivo pode reduzir o valor, mas hoje há `CHECK (quantity > 0)` e `unit_price_cents >= 0`. Sugiro um `kind = 'credit'` cujo total entra negativo no `docCalc`.
- **Mesma assinatura do 3.1.** No aceite, o app mostra um resumo corrido: valor original, aditivos aceitos, total atual, pago e saldo.
- **Faturamento:** a profissional escolhe na hora se o aditivo vira fatura própria, entra na próxima etapa ou é redistribuído entre as etapas restantes.
- **Mensagem pronta no WhatsApp:** "Oi, Fulano! Segue o aditivo nº 2 (troca do piso): +$1,200 e +2 dias. Pode aprovar por aqui antes de eu começar?"

### 3.3 Markup e custo de materiais

**Por quê.** O markup comum de material fica entre 15% e 25%, e muita gente confunde markup com margem: 20% de markup dá só 16,7% de margem [C19]. O Joist espalha o markup pelos itens sem mostrar ao cliente [C2]. A calculadora do Housecall Pro recomenda embutir o markup no preço [C19]. Na JLC, um remodelador conta que oferece duas opções ao cliente: "você compra sem markup e assume o risco, ou eu compro com 15–35% e assumo a garantia" [C19].

**Como:**
- `cost_cents` e `markup_bps` em `ag_catalog_items` e `ag_document_items`. São campos **internos**: nunca saem no `doc-public` nem no PDF.
- `doc_defaults.markup_bps_by_kind`, por exemplo `{ material: 2000, labor: 0 }`.
- **No editor:** a profissional digita custo e % de markup e o app calcula o preço, ou digita o preço e vê a margem.
- **Resumo interno do documento:** custo total, preço, lucro bruto e margem. Relatório de margem por obra em Finanças (Pro).
- **`docCalc`:** `unit_price_cents` continua sendo a verdade. Quando custo e markup vierem juntos, o servidor recalcula o preço (segue a regra "o servidor sempre recalcula").
- **Item "material fornecido pelo cliente":** preço zero, com observação sobre garantia.

**Cuidado.** No contrato "separado" do Texas, o imposto incide sobre o preço do material combinado com o cliente, já com markup [F3].

### 3.4 Itens opcionais e bom/melhor/ótimo

**Por quê.** No plano Grow, o Jobber tem add-ons "recomendados" que o cliente marca no portal; o total e a entrada se recalculam sozinhos [C7]. O Square Plus tem pacotes no orçamento [C11], e o Markate gera os 3 níveis com IA [C14]. Uma avaliação do Joist pede exatamente esse recurso [C3]. É o caminho mais direto para aumentar o ticket médio.

**Como:**
- Campos em `ag_document_items`: `optional` (bool), `selected` (bool) e `group_key` (para "escolha 1 de 3").
- O `doc-public` mostra checkbox ou radio. O aceite grava a seleção, e o servidor recalcula total e entrada.
- No PDF, os itens não escolhidos aparecem em cinza.

### 3.5 Pagamento por ACH

**Por quê.** Na Stripe, ACH Direct Debit custa 0,8% com teto de US$5; o cartão custa 2,9% + 30¢ [F1]. Housecall Pro, Square, QuickBooks e Wave cobram cerca de 1% no ACH [C10][C11][C12][C13]. Na prática:
- fatura de US$2.500: US$72,80 no cartão contra US$5 no ACH;
- fatura de US$10.000: US$290,30 contra US$5.

**Como:**
- O checkout do `doc-public` passa a oferecer `us_bank_account` (com verificação instantânea da conta) além de cartão, na conta conectada da profissional.
- **Pagamento assíncrono:** o ACH confirma em alguns dias úteis e pode voltar. O webhook trata os estados `processing` → `succeeded`/`failed`, e a fatura mostra "pagamento em processamento". Nunca marcar como paga nem emitir recibo antes do `succeeded`.
- **Regra opcional:** "acima de $X, só ACH" ou "cartão até $Y".
- **Texto para o cliente:** "Pay by bank transfer, no fee".

**Zelle.** Não tem API. Continua como instrução de pagamento (já existe), com um botão "copiar dados do Zelle". O Zelle tag passou de 1 milhão de pequenas empresas, e construção está entre as maiores categorias [F9].

### 3.6 "Aprovar e pagar a entrada" + follow-up automático de orçamento

**Por quê.** O Jobber troca o botão do e-mail por "Review & Pay Deposit" quando há entrada, manda follow-up automático para quem não respondeu e arquiva o orçamento depois de 90 dias [C7]. No v1, a entrada vira uma fatura separada pelo `convert`, e o cron só lembra fatura.

**Como:**
- **Entrada no aceite:** se `deposit_cents > 0` e a Stripe estiver ligada, o checkout da entrada abre logo depois da assinatura e cria a fatura de entrada sozinho (`convert mode=deposit`).
- **Follow-up:** o cron lembra em D+3 e D+7 se o orçamento estiver `sent` ou `viewed` sem resposta. A cadência é configurável e tem limite de envios.
- **Push:** "Fulano abriu seu orçamento 3 vezes".

**Cuidados.** Respeitar o limite de entrada por estado (CA, MA) e o direito de cancelamento em 3 dias quando o contrato é fechado na casa do cliente [J2][J4][J7].

### 3.7 Modelos por especialidade

Hoje, `catalog seed { specialty }` cria itens de exemplo. A proposta é transformar isso num **pacote por especialidade**: itens, unidades, markup padrão, termos, etapas sugeridas, itens opcionais e mensagem de envio. É o que mais reduz o tempo até o primeiro orçamento enviado.

| Especialidade | Estrutura sugerida | Itens típicos | Termos típicos |
|---|---|---|---|
| Handyman | Por hora, com mínimo | Visita/deslocamento, hora (mínimo de 1–2 h), material com markup | Garantia da mão de obra (ex.: 90 dias); material comprado fica com o cliente |
| Construção e reforma | Etapas + aditivos | Demolição, mão de obra por fase, material, licença (permit), descarte | Mudança só com change order assinado; prazo depende de inspeção e clima; quem tira a licença |
| Marceneiro | Entrada para material sob medida | Projeto e medição, material, fabricação, instalação | Peça sob medida não tem devolução; desenho aprovado vale como especificação |
| Pintor | ft² ou cômodo | Preparo, demãos, tinta (linha da tinta como bom/melhor/ótimo) | Cor aprovada por escrito; retoque em X dias |
| Paisagismo / manutenção | Recorrente | Visita mensal, extras | Fatura mensal automática (a recorrência já existe na agenda) |
| Tradutor | Página, palavra ou documento | Ver 3.17 | Certificado de tradução; prazo; política de revisão |
| Fotógrafo | Pacote | Sessão, edição, entrega, álbum | Licença de uso das imagens; prazo de entrega |

Observação: em Massachusetts, a entrada pode passar de 1/3 quando cobre o custo real de material especial ou sob medida [J7]. Isso serve de argumento para a marcenaria.

### 3.8 Pacote de contrato por estado

**O que é.** Ao criar o orçamento, o app pergunta o estado da obra (do `job_address`) e se ela é residencial. A partir disso, acrescenta os blocos obrigatórios e trava o que não pode.

| Estado | O que o documento precisa ter (panorama, a validar) | Trava no app |
|---|---|---|
| **CA** | Número da licença da CSLB em orçamento, contrato e anúncio [J3]. Contrato escrito acima de US$500 com nome, endereço e licença [J3]. Entrada máxima: o menor entre US$1.000 e 10% do contrato (exceção para quem tem blanket bond na CSLB) [J4]. Aviso de cancelamento de 3 dias úteis (5 para idosos; 7 em reparo após desastre) [J2] | Bloquear entrada acima do limite; licença obrigatória |
| **FL** | Número da licença em contrato, proposta e fatura (fonte secundária). Aviso de lien do §713.015 em contrato residencial acima de US$2.500, de até 4 unidades: 12 pt, maiúsculas e negrito, na 1ª página ou em página assinada [J5]. Aviso do Homeowners' Construction Recovery Fund (§489.1425) acima de US$2.500 [J5] | Inserir os avisos automaticamente |
| **MA** | Registro HIC na 1ª página. Contrato escrito acima de US$1.000. Aviso de cancelamento de 3 dias. Alerta em negrito para não assinar com campos em branco. Entrada de até 1/3 (ou o custo real de material especial). Pagamento final só depois da conclusão aceita [J7] | Travas de entrada e de pagamento final |
| **NJ** | NJHIC# em contrato, anúncio e correspondência. Contrato escrito acima de US$500. Aviso de cancelamento de 3 dias úteis (fonte secundária). Seguro de US$500 mil por ocorrência [J8] | NJHIC# obrigatório |
| **TX** | Sem licença estadual de empreiteiro geral (encanador, eletricista e HVAC têm) [J3]. Disclosure statement do §53.255 antes de assinar contrato residencial [J6]. **Homestead:** contrato escrito e assinado antes de começar, assinado pelos dois cônjuges e registrado no condado; se faltar algo, todos na obra podem perder o direito de lien [J6] | Pergunta "é homestead?"; se sim, 2 assinantes |
| **Todos (federal)** | **FTC Cooling-Off Rule** para venda fechada na casa do cliente (a partir de US$25) ou em local temporário (a partir de US$130): recibo **no mesmo idioma da negociação**, aviso em negrito de no mínimo 10 pt perto da assinatura e o "Notice of Cancellation" em 2 vias [J2] | Se a conversa foi em português, o aviso sai em português (o v1 já gera documento em pt/en/es) |

**Como implementar:**
- `ag_documents.contract_pack` (ex.: `'ca_hic_v1'`), com textos versionados num `api/_lib/contractPacks.js` e revisão jurídica por estado.
- O `doc-public` mostra os blocos e o PDF inclui o Notice of Cancellation em 2 vias.
- Consentimento e assinatura seguem o 3.1.

**Plano.** Starter: proteção básica não deveria ter cadeado, e isso vira argumento de venda. Comece pelos estados com mais usuários na base. O código é M; o esforço grande está na revisão jurídica.

### 3.9 Licença e seguro no documento

- **Rótulo por estado:** "CSLB Lic. #", "NJHIC #", "MA HIC Reg. #", com data de validade.
- **Certificado de seguro (COI):** anexar em PDF.
- **Verificação:** link para a consulta no site do órgão.

O Joist só coloca licença e seguro no plano Elite [C1]. Em CA e FL, o número da licença é obrigatório em proposta e anúncio [J3].

### 3.10 Cobrança escalonada

**Por quê.** Ver os números de inadimplência e de link de pagamento na seção 2.3 [C21].

**Como:**
- **Cadência configurável:** 3 dias antes, no vencimento, +3, +7, +15 e +30. Vai por e-mail automático e com texto pronto para WhatsApp e SMS.
- **Multa e juros:** só quando a cláusula estiver nos termos aceitos no orçamento. O app copia a cláusula para a fatura e aplica a multa como item "late fee" com um toque; nada é automático.
- **Extrato do cliente:** todas as faturas em aberto num link.
- **Carta de cobrança final:** modelo pronto, mais um link para o guia de small claims do estado.
- **"Cliente prometeu pagar dia X":** pausa os lembretes até essa data.

**Cuidados.** Multa e juros precisam estar no contrato assinado e respeitar o teto do estado [J12]. Nunca ameaçar lien sem base legal (ver 4.6). Pelo meu entendimento, quem cobra a própria dívida em nome próprio geralmente fica fora do FDCPA, que mira cobradores terceirizados. Não pesquisei a fundo: confirmar com advogado.

### 3.11 Modos de sales tax

**Hoje.** Há uma alíquota (`tax_rate_bps`) e uma flag `taxable` por item. Isso já resolve "imposto só no material" (basta marcar só o material como tributável), mas a profissional não sabe disso.

**Proposta.** Campo `tax_mode` com quatro opções:

| Modo | Quando costuma se aplicar (ver 4.8) |
|---|---|
| `none_lump_sum` (preço global) | O imposto do material já foi pago na compra |
| `materials_only` | Contrato separado no Texas |
| `all` | Reparo em NJ; reparo não residencial no Texas |
| `exempt` | Com número do certificado (ex.: ST-8 em NJ) |

Opcionalmente, duas alíquotas (estadual + local). O app mostra um texto de ajuda com o panorama por estado e "confirme com seu contador". **Não escolher o modo automaticamente.**

### 3.12 Financiamento ao cliente

| Opção | Custo para a profissional | Limite | Observação |
|---|---|---|---|
| Klarna via Stripe Checkout | 5,99% + 30¢ por venda [F1] | Definido pela Klarna | Quase sem código se o checkout já existe |
| Wisetack (API embutida) | 3,9% por obra; mais caro em promoção de 0% [C18] | US$25 mil por obra | Payout em 1–3 dias; é o parceiro do Housecall Pro; LendingClub e U.S. Bank como financiadores [C10][C18] |
| Hearth | Assinatura anual (as fontes divergem: ~US$1.500–6.000/ano) | US$250 mil | Só compensa com volume alto [C18] |
| GreenSky | 7–15% em produtos promocionais | US$100 mil | Histórico de ação do CFPB em 2021 [C18] |

**Plano em fases:**
- **Fase 0:** Klarna como meio de pagamento em fatura acima de $X (Pro), com a taxa exibida à profissional antes de ligar.
- **Fase 1:** parceria com a Wisetack e "a partir de $Y/mês" no orçamento. Atenção: editar o orçamento depois da aprovação do crédito pode exigir nova análise (comportamento relatado na integração de outro software) [C18].

**Cuidados.** A BrasilConnect não deve ser credora nem intermediar crédito por conta própria; usar parceiro licenciado. Remuneração por indicação precisa de revisão de advogado. Isso é inferência minha, não pesquisei a fundo.

### 3.13 Histórico de versões

Avaliação do Joist: o orçamento não tem histórico, então não dá para desfazer edição [C3]. Com o 3.1, cada envio gera uma revisão (rev. 1, 2, 3) com diferenças visíveis. O cliente sempre vê a última, e a assinatura fica presa à revisão assinada.

### 3.14 Horas e materiais (T&M)

Para handyman e reparos:
- **Apontamento de horas** por serviço, com cronômetro.
- **Foto do recibo da loja** (Home Depot, Lowe's) vira item de material com markup.
- **"Ticket do dia"** assinado pelo cliente, como os guias de change order recomendam para trabalho por tempo e material [C20].
- A fatura sai direto do apontamento.

### 3.15 Retenção (retainage)

**Contexto.** Em obra, o comum é reter 5–10% de cada pagamento. Em residencial pequeno, quase sempre vale o que o contrato disser. A Califórnia limitou a retenção privada a 5% a partir de 01/01/2026 (SB 61), mas exclui residencial não misto de até 4 andares. Nova York limita a 5% em contratos privados acima de US$150 mil [J9]. O recurso importa quando a brasileira trabalha como subcontratada de um GC.

**Como:**
- `retainage_bps` no orçamento ou na etapa.
- Cada fatura de etapa mostra "retido" e o líquido a pagar.
- No fim, uma "fatura de liberação da retenção".
- Relatório de retenções a receber.

### 3.16 IA: orçamento por voz e foto em português → documento em inglês

**Por quê.** O Markate lançou em abr/2026 a "Kate": foto, texto ou áudio viram orçamento com 3 níveis em cerca de 1 minuto, cobrado por uso [C14][C22]. Apps em espanhol, como Cotizza e Jobkore, usam o mesmo argumento: "você trabalha no seu idioma, o cliente recebe em inglês" [C17]. Para a brasileira que escreve inglês com insegurança, este é o diferencial mais forte do produto.

**Como:**
- A profissional grava um áudio em português e manda fotos.
- A Claude API recebe a tabela de preços dela, as unidades e o modelo da especialidade.
- Sai um rascunho com itens, descrições em inglês profissional e opções bom/melhor/ótimo, com os itens de baixa confiança marcados.
- **Sempre há revisão humana antes de enviar.**
- Também "traduzir descrição", item a item.

**Plano.** Custa por uso, então Premium ou créditos. Um guia de 2026 alerta que IA sem revisão do dono erra, e o fórum do Jobber relata orçamento gerado com escopo errado [C7][C22].

### 3.17 Kit do tradutor

**Contexto** [T1][T2][T3]:
- O USCIS (8 CFR 103.2(b)(3)) exige tradução completa (inclusive carimbos e selos) e certificação do tradutor de que ela está completa e exata e de que ele é competente no par de idiomas. **Não exige notarização** nem lista de tradutores aprovados.
- Preço típico de documento civil certificado: US$25–35 por página (faixa geral de US$25–100). A "página" costuma ter até 250 palavras.
- Por palavra: US$0,10–0,16. Urgência acrescenta 25–50%. Mínimo comum: US$50–55.

**O que falta:**
- **Unidade "documento"**, para certidão a preço fixo. Página e palavra já existem.
- **Contador:** a tradutora sobe o PDF ou a foto do original, e o app conta páginas (e palavras, quando houver texto ou OCR) e sugere a quantidade.
- **Itens prontos:** tradução certificada (por página), urgência (% sobre a tradução), notarização da declaração (taxa), cópia física e envio, intermediação de apostila (taxa de serviço + taxa do órgão).
- **Certificado de tradução gerado** no modelo aceito pelo USCIS: competência no par de idiomas, declaração de tradução completa e exata, nome, assinatura, data e contato. Vai anexo à entrega.
- **Entrega amarrada ao pagamento:** o PDF traduzido fica anexo à fatura e o download libera depois do pagamento.

**Avisos dentro do app** (ver 4.12):
- não se apresentar como "tradutor juramentado" ou "sworn translator" sem matrícula numa Junta Comercial;
- não preencher formulário de imigração nem dar orientação legal.

### 3.18 a 3.22 (onda 3)

- **Subcontratados e 1099.** Cadastro do sub com W-9 (TIN criptografado, só os últimos 4 dígitos visíveis) e pagamentos por obra, que entram como despesa em Finanças. Alerta "Fulano passou de US$2.000 este ano", que é o novo limite do 1099-NEC para pagamentos de 2026 [F8]. Exportação CSV para o contador; não enviar 1099 ao IRS pelo app na primeira fase.
- **Portal do cliente.** Um link com todos os orçamentos, aditivos, faturas e recibos daquele cliente, como o "client hub" do Jobber [C7].
- **QuickBooks.** O Premium já exporta CSV. O próximo passo é o formato de importação do QuickBooks Online e, depois, a API. O Joist cobra US$9,99/mês pelo sync [C1].
- **Lien.** Primeira fase: só lembretes de prazo, calculados a partir das datas da obra, mais links para os formulários oficiais. Não gerar lien waiver sem revisão jurídica, porque o formulário errado pode não valer ou abrir mão de direitos (ver 4.6).
- **Surcharge de cartão.** Não recomendo agora: Connecticut e Massachusetts proíbem, o Colorado limita a 2% e débito nunca pode [J13]. A alternativa sem risco é "desconto para pagamento por ACH ou Zelle" no orçamento.

---

## 4. Riscos legais e fiscais (panorama, com fontes)

> Cada item diz **onde o risco aparece no produto** e **o que fazer**. Os textos finais precisam de revisão por advogado ou contador do estado.

### 4.1 Assinatura eletrônica (ESIGN / UETA)
- **Regra:** a assinatura vale quando há intenção, vínculo com o registro e registro que pode ser guardado e reproduzido. Para consumidor, há consentimento prévio com avisos (cópia em papel, retirada sem custo, requisitos técnicos). A UETA permite provar a autoria "de qualquer forma", e e-mail, IP, data e hora e trilha de auditoria são a prática comum [J1].
- **No produto:** o aceite do orçamento, o change order e o contrato.
- **O que fazer:** seção 3.1. Nunca deixar alterar um documento assinado.

### 4.2 Venda fechada na casa do cliente (FTC Cooling-Off e leis estaduais)
- **Regra:** venda a partir de US$25 na casa do cliente (ou US$130 em local temporário) dá 3 dias úteis para cancelar com reembolso integral. O recibo sai no idioma da negociação, com aviso em negrito de 10 pt e "Notice of Cancellation" em 2 vias [J2].
- **Regras estaduais mais duras:** a CA dá 5 dias a idosos e 7 em reparo pós-desastre, e desde 2025 aceita reclamação na CSLB quando falta o aviso (AB 1327). Massachusetts exige o aviso de 3 dias no contrato [J2][J7].
- **No produto:** o handyman orça na casa do cliente e ele assina no celular dela; o "aprovar e pagar a entrada" cobra no mesmo minuto.
- **O que fazer:** perguntar "assinado na casa do cliente?", gerar o aviso no idioma do documento e deixar o reembolso fácil.

### 4.3 Conteúdo obrigatório do contrato de reforma
- **CA:** contrato escrito acima de US$500 com licença [J3]. **FL:** avisos dos §713.015 e §489.1425 acima de US$2.500 [J5]. **MA:** contrato da 142A acima de US$1.000 com HIC, aviso de 3 dias e alerta de campos em branco [J7]. **NJ:** NJHIC# e contrato escrito acima de US$500 [J8]. **TX:** disclosure do §53.255 e formalidades do homestead [J6].
- **No produto:** o campo de termos livre deixa a profissional enviar um contrato "incompleto" sem saber.
- **O que fazer:** seção 3.8, estado a estado, sempre com revisão jurídica.

### 4.4 Licença no orçamento e no anúncio
- **Regra:** a CA exige o número da licença em contratos, propostas e todo tipo de anúncio, inclusive eletrônico, com multa de US$100–1.000 na primeira infração. A FL exige em propostas e faturas. No TX, o encanador mostra o número do responsável até na fatura [J3].
- **No produto:** a página pública `/agenda/<slug>`, o PDF do orçamento e o anúncio no BrasilConnect contam como "anúncio" e "proposta".
- **O que fazer:** seção 3.9; em CA, FL e NJ, não deixar publicar sem o número.

### 4.5 Entrada (down payment)
- **Regra:** CA: o menor entre US$1.000 e 10% (ex.: obra de US$3.200 → no máximo US$320) [J4]. MA: até 1/3 ou o custo real de material especial [J7]. NJ: a agência de consumidor trata "mais de 1/3 antes de começar" como sinal de alerta, sem teto em lei confirmado [J8].
- **No produto:** `doc_defaults.deposit_pct` e o convert `mode=deposit`.
- **O que fazer:** validar o percentual contra o estado da obra e explicar o motivo do bloqueio.

### 4.6 Lien: avisos, prazos e waivers
- **Prazos:** curtos e fatais. Em CA, o aviso preliminar de 20 dias vale para subs e fornecedores, e o direct contractor tem 90 dias para registrar o lien. Na FL, o Notice to Owner sai em até 45 dias, e todos têm 90 dias para registrar. No TX residencial, sub manda aviso mensal [J11].
- **Lien waiver:** CA, AZ, NV e TX aparecem de forma consistente como estados com formulário estatutário; a FL tem formulário opcional; outros estados divergem entre as fontes. Waiver incondicional assinado com retenção pendente pode abrir mão de direitos [J10][J15].
- **No produto:** a tentação de "gerar waiver" a cada pagamento recebido.
- **O que fazer:** só lembretes de prazo e links oficiais na onda 3.

### 4.7 Retenção
- **Regra:** a lei estadual quase sempre exclui residencial pequeno, então vale o contrato. A CA (SB 61, 2026) limita a 5% em obra privada, com exclusões. NY limita a 5% acima de US$150 mil [J9].
- **No produto:** seção 3.15. Não travar percentuais; mostrar aviso quando passar de 5%.

### 4.8 Sales tax em serviço x material (panorama, sem conselho)
- **Regra geral:** quem melhora imóvel costuma ser consumidor final do material e paga o imposto na compra. A mão de obra de construção geralmente não é tributada, mas pelo menos 18 estados tributam algum serviço de melhoria (contagem de 2015) [F2].
- **TX:** reparo e reforma residencial não tributa a mão de obra. No preço global, a empreiteira paga o imposto na compra e não cobra o cliente; no contrato separado, cobra imposto sobre o preço do material. Reparo de imóvel **não residencial** é tributado sobre o total [F3].
- **FL:** a empreiteira é consumidora final do material em contrato de imóvel e não destaca imposto ao cliente. Já venda com instalação de bem que continua "móvel" (carpete, eletrodoméstico, persiana) é tributada [F4].
- **NJ:** material é tributado na compra. A mão de obra de reparo, manutenção e instalação é tributada; a de melhoria de capital fica isenta com o certificado ST-8 do proprietário [F5].
- **NY:** melhoria de capital não tem imposto na fatura; reparo e manutenção pagam imposto sobre o total [F6].
- **No produto:** um único `tax_rate_bps` com padrão salvo pode aplicar a regra errada em toda obra.
- **O que fazer:** seção 3.11, com aviso e sem padrão automático.

### 4.9 Repassar a taxa do cartão (surcharge)
- **Regra:** CT e MA proíbem (em MA há projeto de lei em andamento). O CO permite até 2%, nunca no débito. NY permite até o custo, com o preço total mostrado antes. As bandeiras limitam (Visa, 3%). Débito não pode em lugar nenhum [J13].
- **No produto:** pedido comum de quem paga 2,9% numa fatura grande.
- **O que fazer:** oferecer "desconto para ACH ou Zelle" em vez de surcharge.

### 4.10 Multa e juros por atraso
- **Regra:** não há teto federal. O limite estadual (usura) varia, e a cláusula precisa estar no contrato assinado, não só na fatura. 1,5% ao mês (18% ao ano) é comum, mas pode passar do teto em alguns estados [J12].
- **No produto:** seção 3.10. Multa só com cláusula aceita, aplicada com um toque da profissional.

### 4.11 Pagamentos, 1099-K e 1099-NEC
- **1099-K:** para apps e redes de terceiros, o limite voltou a US$20 mil **e** 200 transações por ano (OBBBA, jul/2025; confirmado pela IRS Fact Sheet 2025-08). Segundo a mesma fonte, pagamento com **cartão** não tem limite mínimo. A renda é tributável com ou sem formulário [F7].
- **1099-NEC:** o limite sobe para US$2.000 em pagamentos de 2026 a subcontratados, com envio até 01/02/2027. Pagamento por cartão ou app vai no 1099-K do processador. Quem paga reparo da própria casa geralmente não emite 1099 [F8].
- **Taxas que importam:** disputa na Stripe custa US$15 [F1]; Venmo Business cobra 1,9% + 10¢ [F9].
- **No produto:** Finanças (reserva para imposto), o cadastro de subs (onda 3) e a explicação "por que recebi um 1099-K".
- **O que fazer:** textos educativos com "confirme com seu contador"; nunca calcular imposto devido como se fosse conselho.

### 4.12 Tradutor: título, certificação, notarização, apostila e "notario"
- **Título:** "tradutor público e intérprete comercial" (juramentado) depende de concurso nacional (Lei 14.195/2021; primeiro exame nacional em 2026, pelo Cebraspe) e de matrícula na Junta Comercial [T4]. Nos EUA, qualquer tradutor pode "certificar"; a certificação da ATA é voluntária e mede competência por par de idiomas [T2].
- **No produto:** a especialidade "Tradutor juramentado" em `lib/variant.js` e a vitrine do perfil.
- **O que fazer:** renomear para "Tradutor (tradução certificada)" e mostrar o título "juramentado" só para quem informar matrícula.
- **USCIS:** certificação de competência e exatidão; notarização só quando outro órgão pedir [T1].
- **Documento indo para o Brasil:** em geral precisa de apostila no país de origem **e** tradução juramentada feita por tradutor matriculado no Brasil. Uma "certified translation" feita nos EUA costuma não servir lá [T5].
- **"Notario" e consultoria de imigração:** na CA, traduzir "notary public" como "notario" num anúncio é infração (até US$1.000 por dia). Preencher formulário de imigração exige registro e bond de immigration consultant (B&P 22440). Em NY, quem anuncia em outro idioma precisa avisar que não é advogado [J14].
- **No produto:** os textos de perfil e de serviço da tradutora; o app não deve sugerir "ajuda com formulários do USCIS".

### 4.13 Financiamento ao cliente
- **Regra:** o crédito ao consumidor é regulado. A Wisetack origina por bancos parceiros, sujeito a análise de crédito [C18].
- **O que fazer:** não oferecer crédito próprio. Exibir o parceiro, a taxa cobrada da profissional e o aviso "sujeito a aprovação". Remuneração por indicação precisa de revisão jurídica (inferência minha).

### 4.14 Guarda de documentos x exclusão de conta
- **Regra:** ESIGN e UETA pedem que o registro continue reproduzível para quem tem direito a ele pelo prazo exigido [J1]. A loja exige exclusão de conta dentro do app (o delete do `me.js` apaga os documentos).
- **O que fazer:** mandar o PDF assinado por e-mail ao cliente no ato da assinatura (3.1) e explicar na política de privacidade o que acontece com os links públicos quando a conta é excluída.

### 4.15 Dados sensíveis
- W-9/TIN dos subs e fotos de documentos pessoais (certidões, passaportes) enviados à tradutora são dados de alto risco.
- **Boa prática** (não é requisito pesquisado aqui): bucket privado com URL assinada de curta duração, criptografia do TIN, exclusão programada de anexos de tradução depois da entrega e nunca expor anexos no `doc-public` sem token.

---

## 5. Top 5 para a próxima versão

### 5.1 Assinatura com validade jurídica e documento congelado
- **Entra:** consentimento ESIGN, intenção no botão, snapshot com hash e PDF, cópia por e-mail aos dois lados, certificado de auditoria, contra-assinatura, vários assinantes e bloqueio de edição depois do aceite.
- **Por que agora:** é a fundação do change order e do contrato. Corrigir depois que existirem milhares de documentos assinados sem hash é pior.
- **Plano:** todos. **Esforço:** M.
- **Medir:** % de orçamentos aceitos com consentimento registrado; disputas reportadas.

### 5.2 Change orders
- **Entra:** `kind = 'change_order'` ligado ao orçamento, itens de crédito, dias a mais no prazo, resumo corrido (original + aditivos = total atual) e destino na fatura (própria, próxima etapa ou redistribuída).
- **Por que agora:** é o recurso que Joist cobra no Elite e que o Jobber não tem [C2][C7], e é o que mais evita prejuízo em obra [C20].
- **Plano:** Pro. **Esforço:** M.
- **Medir:** % de obras com aditivo; valor médio dos aditivos; upgrades para o Pro.

### 5.3 Orçamento que vende mais: markup e itens opcionais
- **Entra:** custo e markup internos (com margem no resumo), markup padrão por tipo de item, itens opcionais e grupos bom/melhor/ótimo escolhidos pelo cliente no link.
- **Por que agora:** aumenta o ticket e o lucro sem cliente novo; os dois mexem no mesmo editor e no mesmo `docCalc`.
- **Plano:** markup no Starter; opcionais e relatório de margem no Pro. **Esforço:** M (os dois juntos).
- **Medir:** ticket médio por orçamento; % de orçamentos com opcional escolhido; margem média declarada.

### 5.4 Dinheiro mais rápido: ACH, "aprovar e pagar a entrada" e follow-up
- **Entra:** ACH no checkout da fatura (com estado "em processamento"), entrada cobrada logo depois da assinatura e follow-up automático de orçamento em D+3 e D+7.
- **Por que agora:** ACH economiza até US$285 numa fatura de US$10 mil [F1], e follow-up e link de pagamento são o que mais acelera o recebimento [C7][C21].
- **Plano:** Pro. **Esforço:** M.
- **Medir:** dias até o pagamento; % pago online; participação de ACH x cartão; taxa de aceite (`acceptance_rate` já existe no summary).

### 5.5 Modelos por especialidade + pacote de contrato por estado
- **Entra:**
  - o `seed { specialty }` vira um pacote completo (itens, unidades, markup, termos, etapas, opcionais), incluindo o kit básico do tradutor (unidade "documento", itens de urgência e notarização, certificado);
  - licença e seguro com rótulo por estado;
  - na primeira fase, 2 ou 3 estados com contrato revisado por advogado (avisos obrigatórios, Notice of Cancellation no idioma do documento, trava de entrada).
- **Por que agora:** é o que leva a profissional ao primeiro orçamento enviado no primeiro dia e transforma "app de fatura" em "app que me protege". Nenhum concorrente de entrada faz isso.
- **Plano:** Starter. **Esforço:** P para os modelos; G para o jurídico.
- **Medir:** tempo do cadastro ao primeiro orçamento enviado; % de documentos com pacote de estado; conversão do teste para pago.

**Logo depois (onda 2):** cobrança escalonada, modos de sales tax, financiamento (Klarna, depois Wisetack), IA de voz e foto PT→EN, horas e materiais, retenção e o kit completo do tradutor.
**Depois (onda 3):** subcontratados e 1099, portal do cliente, QuickBooks e lien.

### 5.6 Antes de aplicar `supabase/ag_app_documents.sql` (sugestão para o dono da fundação)

Como o SQL ainda não foi aplicado, vale incluir já:
- **`ag_documents`:** `kind` com `'change_order'` no CHECK, mais os status correspondentes; `parent_id`, `schedule_days_delta`, `revision`, `tax_mode`, `retainage_bps`, `contract_pack`, `signed_hash`, `signed_snapshot` (jsonb), `signed_pdf_url`, `consent_at`, `consent_text_version`.
- **`ag_document_items`:** `cost_cents`, `markup_bps`, `optional`, `selected`, `group_key`, e um `kind` `'credit'` (ou outra forma de linha negativa, compatível com os CHECKs de valor).
- **`ag_catalog_items`:** `cost_cents`, `markup_bps`.
- **Tabela de assinantes** (`ag_document_signers`: nome, e-mail, papel, assinatura, IP, navegador, data), para o caso de vários assinantes.

---

## Fontes

### Concorrentes e mercado [C]
- **[C1] Joist (preços e planos):** [OneCrew, jul/2026](https://www.getonecrew.com/post/joist-pricing) · [fieldservicesoftware.io](https://fieldservicesoftware.io/software/joist/) · [App Pricing Lab (App Store, mar/2026)](https://apppricinglab.com/iap/apple/592163563)
- **[C2] Joist (recursos):** [Change orders](https://support.joistapp.com/en/articles/9212730-change-orders) · [Markup](https://support.joistapp.com/en/articles/9212934-how-do-i-add-markup-to-my-estimate-or-invoice) · [PricingSaaS, mudanças fev/2026](https://pricingsaas.com/companies/joist/diffs/2026W08)
- **[C3] Joist (avaliações):** [Capterra](https://capterra.com/p/230138/Joist/reviews/) · [Trustpilot](https://ca.trustpilot.com/review/joist.com)
- **[C4] Invoice Simple (preços):** [Página oficial](https://www.invoicesimple.com/pricing) · [App Pricing Lab](https://apppricinglab.com/iap/apple/694831622)
- **[C5] Invoice Simple (avaliações):** [Trustpilot](https://au.trustpilot.com/review/invoicesimple.com?page=5) · [Software Finder](https://softwarefinder.com/accounting-software/invoice-simple/reviews)
- **[C6] Jobber (preços):** [OneCrew](https://www.getonecrew.com/post/jobber-pricing) · [Fieldproxy](https://www.fieldproxy.ai/fsm-software-pricing/jobber) · [PricingSaaS 2026Q2](https://pricingsaas.com/companies/jobber/diffs/2026Q2)
- **[C7] Jobber (recursos):** [Itens opcionais](https://help.getjobber.com/hc/en-us/articles/360049853114) · [Orçamentos](https://getjobber.com/features/quotes) · [Fórum: change orders](https://community.getjobber.com/discussions/quoting/change-orders/1000) · [Fórum: orçamento com IA](https://community.getjobber.com/discussions/quoting/jobber-ai-quote-linked-to-chatgpt/7465)
- **[C8] Jobber (avaliações):** [Capterra](https://www.capterra.com/p/127994/Jobber/reviews/?page=2) · [G2](https://www.g2.com/products/jobber/)
- **[C9] Housecall Pro (preços):** [Fieldproxy (verificado em jun/2026)](https://www.fieldproxy.ai/fsm-software-pricing/housecall-pro) · [Projul](https://projul.com/blog/housecall-pro-pricing-analysis-2026)
- **[C10] Housecall Pro (taxas, reclamações, financiamento):** [BuyerSprint](https://buyersprint.com/2026/04/18/housecall-pro-pricing-2026/) · [SoftwareOne (Consumer Financing / Wisetack)](https://platform.softwareone.com/product/consumer-financing/PCP-9553-9960)
- **[C11] Square Invoices:** [Press release do Invoices Plus](https://square.com/us/en/press/invoices-plus) · [Wise: review do Square Invoices](https://wise.com/us/blog/square-invoices-review)
- **[C12] QuickBooks:** [NerdWallet](https://www.nerdwallet.com/article/small-business/quickbooks-pricing) · [Intuit: taxa de ACH](https://quickbooks.intuit.com/learn-support/en-us/payments/what-is-quickbooks-ach-fees/00/1270297) · [AuditFriendly: aumento de ago/2026](https://auditfriendly.co/answers/quickbooks-online-price-increase-2026)
- **[C13] Wave:** [Merchant Maverick](https://www.merchantmaverick.com/reviews/wave-payments-review/) · [CostBench](https://www.costbench.com/software/invoicing/wave/)
- **[C14] Markate:** [PricingSaaS](https://pricingsaas.com/companies/markate) · [Kate AI Estimator](https://www.markate.com/solutions/kate-ai-estimator) · [QuoteIQ (concorrente)](https://myquoteiq.com/compare/markate/)
- **[C15] Contractor Foreman:** [ERPResearch](https://erpresearch.com/erp-add-ons/construction/contractor-foreman/pricing) · [Dupple, jul/2026](https://dupple.com/reviews/contractor-foreman) · [Capterra](https://capterra.com/p/166113/Contractor-Foreman/reviews/)
- **[C16] Buildertrend:** [OneCrew](https://www.getonecrew.com/post/buildertrend-pricing) · [CostBench](https://costbench.com/software/construction-management/buildertrend/) · [Projul](https://projul.com/blog/buildertrend-pricing-analysis-2026/)
- **[C17] Apps bilíngues:** [Jobkore (G2)](https://www.g2.com/sellers/jobkore)
- **[C18] Financiamento:** [ContractorToolStack: Wisetack x GreenSky](https://contractortoolstack.com/compare/wisetack-vs-greensky/) · [Hearth: Wisetack x Hearth (concorrente)](https://gethearth.com/wisetack-vs-hearth/) · [Wisetack + LendingClub](https://www.wisetack.com/press/wisetack-partners-with-lendingclub-to-expand-home-improvement-financing) · [GoSite: Wisetack em orçamentos](https://help.gosite.com/en/knowledge-base/overview-1)
- **[C19] Markup:** [Housecall Pro: calculadora de markup para handyman](https://www.housecallpro.com/handyman/templates-calculators/handyman-service-markup-calculator/) · [JLC: allowances e markup](https://www.jlconline.com/business/sales-marketing/allowances-and-markup-in-contracts/) · [Vertical Rent](https://www.verticalrent.com/calculators/materials-markup)
- **[C20] Change orders (boas práticas):** [JLC: Change Order? Get It in Writing](https://www.jlconline.com/remodeling/change-order-get-it-in-writing) · [Fine Homebuilding](https://www.finehomebuilding.com/how-to/departments/commentary/change-orders-can-help-avoid-dreaded-lawsuits.aspx) · [JLC: Making Change Orders Work for You](https://www.jlconline.com/business/legal/making-change-orders-work-for-you_o/)
- **[C21] Inadimplência:** [Tofu: 3,7 milhões de faturas](https://tofu.com/blog/invoice-payment-terms) · [Siteline 2026](https://www.siteline.com/blog/youre-not-behind-the-whole-industry-is-built-this-way) · [Agiled (pesquisa Intuit 2025)](https://agiled.app/statistics/late-payment-statistics)
- **[C22] IA em orçamento:** [Lançamento da Kate (Markate), abr/2026](https://norfolkdailynews.com/online_features/press_releases/markate-launches-kate-ai-estimator-close-jobs-in-60-seconds-or-less/article_1d873f51-add8-5576-9d1b-6486c32b1804.html) · [SimplyWise: IA para estimar obra (2026)](https://www.simplywise.com/blog/how-to-use-ai-estimate-construction-2026/)

### Jurídico [J]
- **[J1] ESIGN / UETA:** [Michigan Bar Journal](https://www.michbar.org/file/barjournal/article/documents/pdf4article293.pdf) · [BlueInk: ESIGN Act](https://www.blueink.com/electronic-signature-law/esign-act) · [15 U.S.C. § 7001 (texto oficial)](https://www.law.cornell.edu/uscode/text/15/7001)
- **[J2] Cancelamento em 3 dias:** [16 CFR 429.1](https://www.law.cornell.edu/cfr/text/16/429.1) · [FTC: Cooling-Off Rule](https://www.ftc.gov/legal-library/browse/rules/cooling-period-sales-made-home-or-other-locations) · [Georgia Consumer Protection (limites de US$25/US$130)](https://consumered.georgia.gov/node/13146) · [CA AB 1327 (2025)](https://calmatters.digitaldemocracy.org/bills/ca_202520260ab1327)
- **[J3] Licença no orçamento e no anúncio:** [CSLB: guia de anúncios](https://www2.cslb.ca.gov/Resources/GuidesAndPublications/AdvertisingGuidelines.pdf) · [Licenciamento no Texas](https://www.levelset.com/blog/texas-licensing-guide/) · [22 TAC § 367.10 (encanador no TX)](https://www.law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-367-10)
- **[J4] Entrada na CA:** [CSLB: What You Should Know](https://WWW.CSLB.CA.GOV/Resources/GuidesAndPublications/WYSKPamphlet.pdf) · [Cal. B&P § 7159.5](https://law.justia.com/codes/california/code-bpc/division-3/chapter-9/article-10/section-7159-5)
- **[J5] Florida:** [Fla. Stat. § 713.015](https://www.flsenate.gov/laws/statutes/2024/713.015) · [Douglas Firm: cláusulas obrigatórias em contrato residencial](https://douglasfirm.com/construction-contracting-mandatory-provisions-residential-contracts/)
- **[J6] Texas:** [Tex. Prop. Code § 53.255](https://texas.public.law/statutes/tex._prop._code_section_53.255) · [Levelset: homestead](https://www.levelset.com/blog/texas-homestead-lien-rules-requirements/)
- **[J7] Massachusetts:** [Mass.gov: cláusulas obrigatórias](https://www.mass.gov/info-details/required-contract-terms-in-a-home-improvement-contract) · [Mass.gov: modelo de contrato](https://www.mass.gov/info-details/home-improvement-contract-sample-language)
- **[J8] New Jersey:** [NJ Consumer Affairs: contratar empreiteiro](https://www.njconsumeraffairs.gov:443/News/Consumer%20Briefs/hiring-home-improvement-contractors.pdf) · [Cinderblock: número de registro em NJ](https://cinderblock.com/blog/new-jersey-contractor-registration-number-requirements/)
- **[J9] Retenção:** [Buchalter: CA SB 61](https://www.buchalter.com/insights/effective-january-1-2026-california-sb-61-caps-retention-at-5-on-private-construction-projects/) · [Foley: CA SB 61](https://www.foley.com/p/102luoj/no-more-10-retainage-california-mandates-5-retention-cap-on-private-constructi) · [ContractorMag: retainage](https://www.contractormag.com/management/law/article/20873333/the-tide-is-turning-on-retainage)
- **[J10] Lien waivers por estado:** [Ezel: regras de lien waiver](https://ezel.ai/surveys/mechanics-lien-waiver-rules) · [Corpay: condicional x incondicional](https://www.corpay.com/en-IE/resources/blog/construction-lien-waiver)
- **[J11] Prazos de lien:** [Ezel: Califórnia](https://ezel.ai/surveys/mechanics-lien-deadlines/california) · [Levelset: Notice to Owner na FL](https://www.levelset.com/blog/nto-too-late-lose-lien-45-days/) · [Ezel: Texas](https://ezel.ai/surveys/mechanics-lien-deadlines/texas)
- **[J12] Multa e juros:** [Business.com](https://www.business.com/articles/charging-interest-and-late-fees) · [InvoiceMaker: limites estaduais](https://invoicemaker.com/invoice-late-fees/)
- **[J13] Surcharge de cartão:** [Connecticut DCP](https://portal.ct.gov/dcp/knowledge-base/articles/surcharge-faqs/what-is-the-connecticut-surcharge-law) · [AGG: Colorado](https://www.agg.com/news-insights/publications/colorado-opens-the-door-to-surcharging-five-key-takeaways/) · [PaymentCloud: regras por estado](https://paymentcloudinc.com/blog/credit-card-surcharge-laws-by-state/) · [Nickel: Massachusetts](https://www.nickel.com/surcharge-laws/massachusetts)
- **[J14] "Notario" e consultoria de imigração:** [Cal. B&P § 6126.7](https://law.justia.com/codes/california/code-bpc/division-3/chapter-4/article-7/section-6126-7) · [Cal. Gov. Code § 8223](https://california.public.law/codes/government_code_section_8223) · [NY Exec. Law § 135-B](https://nysenate.gov/legislation/laws/EXC/135-B)
- **[J15] Retenção e waiver na prática:** [Dupple (Contractor Foreman, com notas sobre waivers)](https://dupple.com/reviews/contractor-foreman) · [Kegler Brown: "Oops, I Forgot to Read the Release!"](https://keglerbrown.com/publications/oops-i-forgot-to-read-the-release)

### Fiscal e pagamentos [F]
- **[F1] Stripe:** [stripe.com/pricing (consultado em 09/10/2026)](https://stripe.com/pricing): cartão 2,9% + 30¢; ACH 0,8% com teto de US$5; Invoicing 0,4%; disputa US$15; Klarna 5,99% + 30¢
- **[F2] Sales tax na construção:** [Avalara](https://www.avalara.com/blog/en/north-america/2023/01/sales-tax-requirements-for-construction-contractors.html) · [Sales Tax Institute](https://www.salestaxinstitute.com/sales_tax_faqs/contractors_purchases_sales_tax)
- **[F3] Texas:** [Comptroller, publicação 94-116](https://comptroller.texas.gov/taxes/publications/94-116.php)
- **[F4] Florida:** [HBK CPA](https://hbkcpa.com/florida-sales-tax-overview-for-contractors/) · [Florida Sales Tax: guia de construção, 2026](https://www.floridasalestax.com/florida-tax-law-blog/2026/june/florida-sales-tax-comprehensive-guide-constructi/)
- **[F5] New Jersey:** [NJ Treasury, publicação SU-2](https://nj.gov/treasury/taxation/pdf/pubs/sales/su2.pdf)
- **[F6] New York:** [NY Tax: contractors e repair persons](https://www.tax.ny.gov/pubs_and_bulls/publications/sales/contractors.htm)
- **[F7] 1099-K:** [Beancount (OBBBA, 2026)](https://beancount.io/blog/2026/05/08/form-1099-k-2026-threshold-reverts-20000-200-transactions-obbba-payment-app-reporting-guide) · [Credit Karma](https://www.creditkarma.com/tax/library/irs-forms/1099-k-threshold/)
- **[F8] 1099-NEC:** [Patriot Software](https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/) · [LegalClarity: homeowner e 1099](https://legalclarity.org/can-a-homeowner-1099-a-contractor-rules-and-exceptions/)
- **[F9] Venmo e Zelle:** [NerdWallet: Venmo Business](https://www.nerdwallet.com/article/small-business/venmo-business) · [Zelle: adoção do Zelle tag](https://www.zelle.com/press-releases/zelle-tag-adoption-tops-1-million-small-businesses-across-america-enroll-rate-nearly)

### Tradução [T]
- **[T1] USCIS:** [8 CFR 103.2 (texto oficial)](https://www.law.cornell.edu/cfr/text/8/103.2) · [CI Law Group](https://cilawgroup.com/news/2019/09/21/what-are-uscis-requirements-for-certified-foreign-language-translations/) · [Immihelp](https://www.immihelp.com/what-is-a-certified-translation-for-uscis)
- **[T2] ATA:** [Certified translation x certified translator](https://www.atanet.org/client-assistance/certified-translation-vs-certified-translator/) · [What is a certified translation](https://www.atanet.org/certification/what-is-a-certified-translation/)
- **[T3] Preços:** [Translayte (jul/2026)](https://translayte.com/blog/cost-of-translation-usa) · [World-Link: guia de preços 2026](https://world-link-inc.com/how-much-does-certified-translation-cost-2026-complete-pricing-guide/) · [Beancount: contabilidade do tradutor freelancer](https://beancount.io/blog/2026/07/16/freelance-translator-interpreter-bookkeeping-guide)
- **[T4] Tradutor público no Brasil:** [Edital DREI/MEMP nº 3/2026](https://www.gov.br/memp/pt-br/acesso-a-informacao/editais/sei_58025327_edital_3.pdf) · [Governo do ES: exame nacional](https://www.es.gov.br/Noticia/ministerio-do-empreendedorismo-anuncia-exame-nacional-de-tradutores-e-interpretes-publicos)
- **[T5] Apostila e Brasil:** [Brazil Counsel: notarização e apostila](https://www.brazilcounsel.com/blog/notarization-and-apostille-of-documents-for-use-in-brazil) · [CNB/SP: regra do CNJ sobre apostila (2017)](https://cnbsp.org.br/2017/01/24/cnj-fixa-regra-para-o-apostilamento-de-documentos-em-lingua-estrangeira/)
