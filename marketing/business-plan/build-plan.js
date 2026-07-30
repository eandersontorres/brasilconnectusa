const fs = require("fs");
const path = require("path");
const GLOBAL = require("child_process").execSync("npm root -g").toString().trim();
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageNumber, PageBreak, Header, Footer, VerticalAlign, TabStopType, TabStopPosition,
} = require(path.join(GLOBAL, "docx"));

// ---------- paleta (bandeira do Brasil, sóbria) ----------
const GREEN = "1F7A3D";
const GREEN_DEEP = "14532D";
const NAVY = "002776";
const GOLD = "C9A227";
const INK = "1A1A1A";
const MUTED = "6B7280";
const LINE = "D8DCE2";
const SOFT = "F3F6F4";
const CW = 9360; // largura útil (US Letter, margens 1")

// ---------- helpers ----------
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });

function P(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, ...opts.run })];
  return new Paragraph({ children: runs, spacing: { after: opts.after ?? 140, line: 276 }, alignment: opts.align });
}
function bullet(text, level = 0) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
  return new Paragraph({ numbering: { reference: "bul", level }, children: runs, spacing: { after: 60, line: 268 } });
}
function num(text, level = 0) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
  return new Paragraph({ numbering: { reference: "ord", level }, children: runs, spacing: { after: 60, line: 268 } });
}
const b = (t) => new TextRun({ text: t, bold: true });
const t = (t) => new TextRun({ text: t });
const tcolor = (txt, color) => new TextRun({ text: txt, color, bold: true });

const border = { style: BorderStyle.SINGLE, size: 1, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border };

function cell(content, { w, fill, head = false, align } = {}) {
  const paras = (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === "string"
      ? new Paragraph({
          alignment: align,
          spacing: { after: 0, line: 252 },
          children: [new TextRun({ text: c, bold: head, color: head ? "FFFFFF" : INK, size: head ? 19 : 19 })],
        })
      : c
  );
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders,
    shading: { fill: fill || (head ? GREEN_DEEP : "FFFFFF"), type: ShadingType.CLEAR },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    children: paras,
  });
}
function table(widths, rows) {
  return new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) =>
      new TableRow({
        tableHeader: i === 0,
        children: r.map((c, j) =>
          cell(c.text ?? c, { w: widths[j], fill: c.fill, head: i === 0 && !c.fill, align: c.align })
        ),
      })
    ),
  });
}

function calloutBox(title, lines, color = GREEN_DEEP, fill = SOFT) {
  const kids = [new Paragraph({ children: [new TextRun({ text: title, bold: true, color, size: 21 })], spacing: { after: 80 } })];
  lines.forEach((l) => kids.push(new Paragraph({ children: Array.isArray(l) ? l : [new TextRun({ text: l, size: 20 })], spacing: { after: 50, line: 264 } })));
  return new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [CW],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: CW, type: WidthType.DXA },
      borders: { top: { style: BorderStyle.SINGLE, size: 1, color: fill }, bottom: { style: BorderStyle.SINGLE, size: 1, color: fill },
        right: { style: BorderStyle.SINGLE, size: 1, color: fill }, left: { style: BorderStyle.SINGLE, size: 18, color } },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 130, bottom: 130, left: 180, right: 160 },
      children: kids,
    })] })],
  });
}
const spacer = (h = 120) => new Paragraph({ children: [], spacing: { after: h } });

// =====================================================================
//  CONTEÚDO
// =====================================================================
const children = [];

// ---------- CAPA ----------
children.push(
  new Paragraph({ spacing: { before: 2200, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Brasil", bold: true, size: 64, color: NAVY }), new TextRun({ text: "Connect", bold: true, size: 64, color: GREEN })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: "USA", bold: true, size: 32, color: GOLD, characterSpacing: 60 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 60 },
    children: [new TextRun({ text: "Plano de Negócios", size: 40, color: INK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
    children: [new TextRun({ text: "Documento interno de estratégia", italics: true, size: 24, color: MUTED })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1600, after: 0 },
    children: [new TextRun({ text: "A plataforma da comunidade brasileira nos Estados Unidos", size: 22, color: GREEN_DEEP })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 },
    children: [new TextRun({ text: "brasilconnectusa.com", size: 20, color: MUTED })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400 },
    children: [new TextRun({ text: "Versão 1.0 · Junho de 2026 · Confidencial", size: 18, color: MUTED })] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------- SUMÁRIO ----------
children.push(
  new Paragraph({ children: [new TextRun({ text: "Índice", bold: true, size: 30, color: GREEN_DEEP })], spacing: { after: 160 } }),
  new TableOfContents("Sumário", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------- 1. SUMÁRIO EXECUTIVO ----------
children.push(H1("1. Sumário Executivo"));
children.push(P([
  b("BrasilConnect USA"), t(" é uma plataforma digital (web + PWA instalável) que reúne, num só lugar, tudo que o brasileiro recém-chegado ou já estabelecido nos EUA precisa: encontrar negócios da comunidade, contratar serviços, se informar (guias de imigração, ITIN, LLC, CNH, conta bancária, custo de vida por cidade), se conectar em grupos de interesse e — do outro lado — uma camada de "),
  b("SaaS para os próprios negócios brasileiros"), t(" venderem online sem comissão abusiva."),
]));
children.push(P([
  t("O modelo é "), b("two-sided marketplace + SaaS"), t(": de um lado, milhões de consumidores brasileiros buscando confiança e idioma; do outro, milhares de pequenos negócios (restaurantes, mercados, salões, prestadores) que hoje dependem do Instagram, do boca-a-boca e de plataformas americanas que cobram até 30% por pedido. A BrasilConnect cobra "),
  b("assinatura fixa baixa e 0% de comissão"), t(", ficando entre o negócio e o cliente final em português."),
]));
children.push(spacer(40));
children.push(calloutBox("Tese central", [
  [t("“A comunidade brasileira nos EUA já é grande, gasta em dólar e quer ser atendida em português por quem ela confia. Hoje ela está espalhada por dezenas de grupos de WhatsApp e Facebook. A BrasilConnect organiza essa demanda e a oferta num produto só — e monetiza a oferta (os negócios), não a comunidade.”")],
], GREEN_DEEP, SOFT));
children.push(spacer(60));
children.push(H3("O que já está no ar (não é só ideia)"));
children.push(bullet([b("Diretório de negócios"), t(" com 5 módulos verticais (Restaurante, Mercado, Loja, AgendaPro, Divulgação).")]));
children.push(bullet([b("Pedidos online com pagamento"), t(" via Stripe Connect — o dinheiro cai direto na conta do negócio, sem comissão da plataforma.")]));
children.push(bullet([b("AgendaPro"), t(" — agendamento de serviços com planos pagos (Starter/Pro/Premium) e trial de 14 dias.")]));
children.push(bullet([b("Conteúdo SEO"), t(" — guias de chegada e páginas de custo de vida por cidade (porta de entrada orgânica).")]));
children.push(bullet([b("Engajamento"), t(" — Grupos de interesse, módulo Viagem, Bolão da Copa 2026, Marketplace (venda & troca), notificações push.")]));
children.push(spacer(40));
children.push(P([t("Este documento é um "), b("plano interno de estratégia"), t(": serve para alinhar prioridades, modelo de receita, métricas e os próximos 90 dias — não é um material de captação. As projeções financeiras são "), b("cenários ilustrativos"), t(" baseados em premissas explícitas que precisam ser validadas com dados reais de tração.")]));

// ---------- 2. PROBLEMA & OPORTUNIDADE ----------
children.push(H1("2. Problema & Oportunidade"));
children.push(H2("2.1 A dor do consumidor brasileiro"));
children.push(bullet([b("Fragmentação."), t(" A vida do brasileiro nos EUA hoje acontece em dezenas de grupos de WhatsApp/Facebook por cidade — informação dispersa, repetida e sem curadoria.")]));
children.push(bullet([b("Confiança e idioma."), t(" Recém-chegado não domina inglês nem o sistema (ITIN, crédito, seguro, escola). Quer ser atendido por quem fala a língua e já passou pelo mesmo.")]));
children.push(bullet([b("Descoberta ruim."), t(" Achar “restaurante brasileiro perto de mim”, “contador que faz imposto de brasileiro”, “cabeleireira que faz escova” é difícil e depende de indicação.")]));
children.push(H2("2.2 A dor do pequeno negócio brasileiro"));
children.push(bullet([b("Comissão alta das plataformas americanas."), t(" DoorDash/Uber Eats cobram 15–30% por pedido — inviável na margem de um restaurante pequeno.")]));
children.push(bullet([b("Dependência de Instagram."), t(" Sem catálogo, sem checkout, sem agenda — vendas no “me chama no direct”.")]));
children.push(bullet([b("Ferramentas em inglês e caras."), t(" Square, Toast, Booksy etc. são em inglês, com onboarding complexo e mensalidades altas para quem está começando.")]));
children.push(spacer(40));
children.push(calloutBox("A oportunidade", [
  [b("Capturar a demanda no idioma e converter a oferta em assinantes.")],
  [t("Ser o “lugar default” onde o brasileiro nos EUA procura negócio, serviço e informação — e onde o negócio brasileiro monta sua presença digital completa por uma fração do custo das alternativas americanas.")],
], NAVY, "EEF1F8"));

// ---------- 3. MERCADO ----------
children.push(H1("3. Mercado-Alvo"));
children.push(P([t("A comunidade brasileira nos EUA é estimada em "), b("~1,9 milhão de pessoas"), t(" (estimativas do Itamaraty/MRE; algumas fontes apontam números maiores ao incluir indocumentados e segunda geração). É uma população "), b("concentrada geograficamente"), t(", o que facilita densidade de oferta cidade a cidade — chave para um marketplace local.")]));
children.push(spacer(20));
children.push(H3("Praças prioritárias (concentração brasileira)"));
children.push(table([3120, 3120, 3120], [
  ["Região", "Hubs", "Por que priorizar"],
  ["Flórida", "Orlando, Miami, Tampa", "Maior densidade; turismo + residentes"],
  ["Nordeste", "Boston, NY/NJ, Connecticut", "Comunidade antiga e estabelecida"],
  ["Texas", "Austin, Dallas, Houston, Round Rock", "Crescimento recente; lab TorresBee"],
  ["Geórgia", "Atlanta", "Hub emergente do Sul"],
  ["Califórnia", "LA", "Volume alto, oferta dispersa"],
]));
children.push(spacer(40));
children.push(H2("3.1 Dimensionamento (TAM / SAM / SOM)"));
children.push(P([t("Os números abaixo são "), b("ilustrativos"), t(", para enquadrar a ordem de grandeza — não substituem pesquisa primária. Premissas declaradas em cada linha.")]));
children.push(table([2200, 2400, 2360, 2400], [
  ["Camada", "Definição", "Base estimada", "Premissa de receita anual"],
  ["TAM", "Todo brasileiro adulto nos EUA + negócios brasileiros", "~1,9M pessoas / ~50–80k negócios", "Gasto comunitário em serviços/comida no idioma"],
  ["SAM", "Negócios nas praças prioritárias com presença digital fraca", "~15–25k negócios", "Assinatura média US$ 20–30/mês"],
  ["SOM (3 anos)", "Negócios assináveis em 8–10 cidades-foco", "~2–4k negócios pagantes", { text: "US$ 0,7–1,4M ARR (ver §8)", fill: "FFF8E1" }],
]));
children.push(spacer(30));
children.push(calloutBox("Leitura estratégica", [
  [t("O ativo defensável não é o software — é a "), b("densidade local de oferta + base de consumidores no idioma"), t(". Vencer cidade a cidade (começando onde já há relação, ex. Texas/Round Rock) cria efeito de rede local que plataformas americanas genéricas não replicam em português.")],
]));

// ---------- 4. PRODUTO ----------
children.push(H1("4. Produto & Módulos"));
children.push(P([t("A plataforma combina "), b("camada de comunidade"), t(" (gratuita, gera tráfego e retenção) com "), b("camada de negócios"), t(" (monetizada). Tudo roda em web responsiva + PWA instalável, em português.")]));
children.push(H2("4.1 Camada de negócios (monetizável)"));
children.push(table([2100, 4000, 3260], [
  ["Módulo", "Para quem", "Ferramentas"],
  ["🍽️ Restaurante", "Restaurante, padaria, food truck", "Cardápio + pedidos online + pagamento (0% comissão)"],
  ["🛒 Mercado", "Mercearia, açougue, importados", "Catálogo com estoque + pedidos"],
  ["🛍️ Loja (Retail)", "Roupas, artesanato, suplementos", "Vitrine + pedidos, sem maquininha extra"],
  ["📅 AgendaPro", "Salão, estética, saúde, personal", "Agendamento + lembretes (e-mail/SMS) + reviews"],
  ["📣 Divulgação", "Advogado, contador, igreja, escola", "Perfil público no diretório (sem loja/agenda)"],
]));
children.push(spacer(40));
children.push(H2("4.2 Camada de comunidade (aquisição & retenção)"));
children.push(bullet([b("Guias SEO"), t(" — chegada, imigração, ITIN, abrir LLC, conta bancária, CNH, escola, plano de saúde.")]));
children.push(bullet([b("Custo de vida por cidade"), t(" — páginas otimizadas (Orlando, Miami, Austin, Boston, NY…) que capturam busca orgânica de quem vai mudar.")]));
children.push(bullet([b("Grupos de interesse"), t(" — 26 interesses, conecta a comunidade dentro da plataforma.")]));
children.push(bullet([b("Viagem, Bolão da Copa 2026, Marketplace"), t(" — ganchos sazonais e de engajamento que trazem e prendem usuário.")]));
children.push(bullet([b("Notificações push + magic link"), t(" — canal próprio de re-engajamento, sem depender de algoritmo de rede social.")]));
children.push(spacer(30));
children.push(calloutBox("Lógica do funil", [
  [t("Comunidade e SEO trazem o "), b("consumidor de graça"), t(" → consumidor procura negócios → negócios percebem demanda e se cadastram → negócio vira "), b("assinante pagante"), t(" para destravar loja/agenda/destaque. A comunidade é o motor de aquisição; o negócio é a receita.")],
]));

// ---------- 5. MODELO DE RECEITA ----------
children.push(H1("5. Modelo de Receita"));
children.push(P([t("Princípio: "), b("monetizar o negócio, nunca cobrar comissão do que ele vende."), t(" O Stripe leva apenas a taxa de cartão (~2,9% + 30¢) direto; 100% da venda vai para a conta do negócio. A BrasilConnect ganha em "), b("assinatura recorrente"), t(".")]));
children.push(H2("5.1 Linhas de receita"));
children.push(table([2400, 1700, 5260], [
  ["Linha", "Preço", "Observação"],
  ["Listagem de negócio — Pro", "US$ 9–29/mês", "$29 Restaurante/Mercado/Retail · $19 AgendaPro · $9 Divulgação. Free para sempre como isca."],
  ["AgendaPro (standalone)", "US$ 19–79/mês", "Starter $19 · Pro $39 (+SMS) · Premium $79 (até 10 profissionais). Trial 14 dias."],
  ["Enterprise", "Sob medida", "Redes, multi-estado, white-label, account manager, API."],
  ["Pedidos online", "0% comissão", "Receita indireta: destrava o plano Pro (ancora a assinatura)."],
  [{ text: "Futuro: destaques & ads", fill: "FFF8E1" }, { text: "A definir", fill: "FFF8E1" }, { text: "Topo de busca, selo verificado, spot na newsletter, leads patrocinados.", fill: "FFF8E1" }],
]));
children.push(spacer(40));
children.push(H2("5.2 Por que “0% de comissão” é a arma"));
children.push(bullet([b("Mensagem de marketing imbatível"), t(" contra DoorDash/Uber Eats (15–30%). Fala direto na margem do dono.")]));
children.push(bullet([b("Receita previsível"), t(" (MRR) em vez de depender do volume de pedidos de cada negócio.")]));
children.push(bullet([b("Alinhamento"), t(": a plataforma cresce quando o negócio cresce, sem “taxar” o sucesso dele.")]));
children.push(spacer(20));
children.push(H2("5.3 Alavancas de monetização futura (sem quebrar o princípio)"));
children.push(bullet("Destaque pago no feed/busca da cidade (visibilidade, não comissão)."));
children.push(bullet("Selo “Verificado” + reviews com selo BrasilConnect (confiança como produto)."));
children.push(bullet("Newsletter e push patrocinados por negócio (mídia própria sobre audiência fiel)."));
children.push(bullet("Add-ons: SMS, multi-unidade, relatórios financeiros, domínio próprio/white-label."));

// ---------- 6. DIFERENCIAIS ----------
children.push(H1("6. Diferenciais Competitivos"));
children.push(table([2600, 3380, 3380], [
  ["Concorrente", "O que faz", "Onde a BrasilConnect ganha"],
  ["DoorDash / Uber Eats", "Delivery com 15–30% comissão", "0% comissão + público brasileiro + idioma"],
  ["Square / Toast / Booksy", "POS/agenda em inglês, caro", "Em português, barato, vertical-específico, onboarding simples"],
  ["Grupos de Facebook/WhatsApp", "Onde a comunidade já está", "Curadoria, busca, checkout, agenda, perfil real — não só conversa"],
  ["Instagram do negócio", "Vitrine sem checkout", "Catálogo + pagamento + pedidos + reviews num link só"],
]));
children.push(spacer(40));
children.push(calloutBox("Fosso (moat) em três camadas", [
  [b("1. Idioma + confiança"), t(" — atender em português com curadoria da comunidade é difícil de copiar por um player americano.")],
  [b("2. Densidade local"), t(" — oferta + demanda concentradas por cidade criam efeito de rede que cresce com cada cadastro.")],
  [b("3. Dado proprietário"), t(" — base de consumidores e negócios com canal direto (push, e-mail) reduz custo de aquisição ao longo do tempo.")],
]));

// ---------- 7. GO-TO-MARKET ----------
children.push(H1("7. Estratégia de Go-to-Market"));
children.push(H2("7.1 Sequência: cidade a cidade"));
children.push(num([b("Ancorar numa praça."), t(" Começar onde já há relação e densidade (ex.: Texas / Round Rock–Austin, com o lab TorresBee como caso âncora).")]));
children.push(num([b("Plantar oferta primeiro."), t(" Cadastrar manualmente os negócios brasileiros âncora da cidade (restaurantes, mercados, salões) — mesmo no Free — para a plataforma “nascer cheia”.")]));
children.push(num([b("Puxar consumidor com SEO + comunidade."), t(" Guias e custo-de-vida ranqueiam; grupos e bolão dão motivo recorrente para voltar.")]));
children.push(num([b("Converter oferta em pagante."), t(" Quando o negócio vê demanda real, vende-se o Pro (loja/agenda/destaque).")]));
children.push(num([b("Repetir na próxima cidade"), t(" com o playbook validado.")]));
children.push(spacer(30));
children.push(H2("7.2 Canais de aquisição"));
children.push(table([3000, 6360], [
  ["Canal", "Tática"],
  ["SEO / conteúdo", "Guias e páginas de custo de vida por cidade; capturam intenção de quem vai mudar ou chegou agora."],
  ["Comunidade orgânica", "Grupos de interesse, bolão sazonal, marketplace — geram visita recorrente e indicação."],
  ["Indicação (referral)", "Módulo “Indique” — brasileiro indica brasileiro; CAC baixíssimo."],
  ["Parcerias locais", "Consulados, igrejas, associações, influencers brasileiros por cidade."],
  ["Vendas diretas (oferta)", "Outreach manual a negócios âncora em cada nova praça (o ‘plantar oferta’ acima)."],
]));
children.push(spacer(30));
children.push(calloutBox("Vantagem de custo de aquisição", [
  [t("Como a "), b("comunidade gratuita"), t(" e o "), b("SEO"), t(" trazem o consumidor, o CAC do lado da demanda tende a zero. O esforço pago concentra-se em "), b("ativar negócios"), t(" — e cada negócio ativado atrai mais consumidores, que atraem mais negócios.")],
]));

// ---------- 8. PROJEÇÕES ----------
children.push(H1("8. Projeções Financeiras (cenário ilustrativo)"));
children.push(P([b("Aviso: "), t("os números abaixo são um "), b("modelo de premissas"), t(", não previsão. Servem para testar a lógica da unidade econômica e definir metas. Devem ser recalibrados assim que houver dados reais de conversão e churn.")]));
children.push(spacer(20));
children.push(H2("8.1 Premissas-base"));
children.push(bullet([b("Ticket médio de assinatura: "), t("US$ 24/mês (mistura de planos $9–$79).")]));
children.push(bullet([b("Churn mensal alvo: "), t("4–6% (PME tende a churn mais alto; mitigar com loja/agenda “grudentas”).")]));
children.push(bullet([b("Custo de servir: "), t("baixo — stack serverless (Vercel + Supabase + Stripe + Resend); custo marginal por negócio quase nulo.")]));
children.push(bullet([b("Receita = só assinatura"), t(" (pedidos são 0% comissão; upside de ads/destaque não modelado aqui).")]));
children.push(spacer(20));
children.push(H2("8.2 Trajetória de assinantes pagantes"));
children.push(table([2400, 1740, 1740, 1740, 1740], [
  ["Marco", "Negócios pagantes", "ARPU/mês", "MRR", "ARR aprox."],
  ["Fim Ano 1", "150", "US$ 24", "US$ 3,6k", "US$ 43k"],
  ["Fim Ano 2", "800", "US$ 25", "US$ 20k", "US$ 240k"],
  [{ text: "Fim Ano 3", fill: "FFF8E1" }, { text: "2.500", fill: "FFF8E1" }, { text: "US$ 26", fill: "FFF8E1" }, { text: "US$ 65k", fill: "FFF8E1" }, { text: "US$ 780k", fill: "FFF8E1" }],
]));
children.push(spacer(20));
children.push(P([t("A ponte entre Ano 1 e Ano 3 é "), b("densidade por cidade"), t(": ~250–300 negócios pagantes em cada uma de 8–10 praças. O gargalo não é tecnológico (a plataforma já comporta), é "), b("ativação de oferta e retenção"), t(".")]));
children.push(spacer(20));
children.push(H2("8.3 Sensibilidade (o que move o resultado)"));
children.push(bullet([b("Conversão Free→Pro"), t(": cada +1 ponto percentual sobre a base gratuita move o ARR de forma direta.")]));
children.push(bullet([b("Churn"), t(": reduzir de 6% para 4% ao mês ≈ +50% no valor de vida (LTV) do assinante.")]));
children.push(bullet([b("Mix de plano"), t(": empurrar AgendaPro Pro/Premium e Restaurante Pro eleva o ARPU sem novos clientes.")]));

// ---------- 9. MÉTRICAS ----------
children.push(H1("9. Métricas & KPIs"));
children.push(H2("9.1 North Star"));
children.push(calloutBox("Métrica-Norte", [
  [b("Negócios ativos pagantes por cidade."), t(" Captura os dois lados ao mesmo tempo: só há negócio pagante onde há consumidor suficiente; e quanto mais negócio, mais consumidor. É o melhor termômetro de saúde do marketplace local.")],
], GOLD, "FBF6E7"));
children.push(spacer(30));
children.push(H2("9.2 KPIs por estágio do funil"));
children.push(table([2400, 3480, 3480], [
  ["Estágio", "Métrica", "Por que importa"],
  ["Aquisição", "Visitantes orgânicos / cidade; cadastros", "Eficiência do SEO + comunidade"],
  ["Ativação (oferta)", "% negócios que completam perfil + publicam loja/agenda", "Sinaliza valor percebido"],
  ["Receita", "Conversão Free→Pro; MRR; ARPU", "Motor financeiro"],
  ["Retenção", "Churn mensal; nº de pedidos/agendamentos por negócio", "Uso = retenção; negócio que vende não cancela"],
  ["Engajamento (demanda)", "Usuários ativos; push opt-in; recorrência", "Garante demanda para a oferta"],
]));
children.push(spacer(20));
children.push(P([t("Regra prática: "), b("um negócio que recebe pedidos/agendamentos pela plataforma não cancela."), t(" Por isso a meta operacional nº 1 é levar volume real (pedido/booking) para dentro de cada assinante — não só vender o plano.")]));

// ---------- 10. ROADMAP ----------
children.push(H1("10. Roadmap (Now / Next / Later)"));
children.push(H2("Now — próximos 90 dias"));
children.push(bullet("Fechar o loop de retenção: garantir que pedidos e agendamentos cheguem (push + e-mail funcionando ponta a ponta)."));
children.push(bullet("Eventos com RSVP + lembrete push (T-24h) e DM usuário-a-usuário — aumentam recorrência da comunidade."));
children.push(bullet("Conversão: instrumentar o funil Free→Pro e medir onde o negócio trava."));
children.push(bullet("Plantar oferta na 1ª praça-foco (cadastro manual dos negócios âncora)."));
children.push(H2("Next — 3 a 9 meses"));
children.push(bullet("Landing pages estaduais/por cidade (SEO local) + playbook replicável de cidade."));
children.push(bullet("Restaurant Fase 2 (delivery) e melhorias de loja/estoque."));
children.push(bullet("Camada de monetização secundária: destaque pago + selo verificado."));
children.push(bullet("LGPD/cookie banner, 2FA admin, hardening de conta."));
children.push(H2("Later — 9 a 24 meses"));
children.push(bullet("Enterprise/white-label para redes e franquias brasileiras."));
children.push(bullet("App nativo (se o PWA mostrar teto de engajamento)."));
children.push(bullet("Expansão para novas verticais (serviços profissionais, imobiliária, educação)."));
children.push(bullet("Marketplace de leads / serviços patrocinados."));

// ---------- 11. RISCOS ----------
children.push(H1("11. Riscos & Mitigações"));
children.push(table([3100, 3130, 3130], [
  ["Risco", "Impacto", "Mitigação"],
  ["Lado da oferta frio (poucos negócios)", "Marketplace vazio não retém consumidor", "Plantar oferta manualmente por cidade antes de divulgar; Free como isca"],
  ["Churn alto de PME", "Corrói MRR", "Tornar a ferramenta ‘grudenta’: pedidos/agenda que o negócio passa a depender"],
  ["Dependência de um fundador", "Gargalo de execução", "Documentar playbook de cidade; automatizar onboarding"],
  ["Plataformas americanas reagirem", "Competição de preço", "Fosso de idioma/comunidade; foco em nicho que eles não atendem bem"],
  ["Conteúdo SEO commoditizar", "Queda de aquisição orgânica", "Comunidade + dado proprietário + canal push reduzem dependência de SEO"],
  ["Regulatório (pagamentos, dados, imigração)", "Risco legal/compliance", "Stripe Connect (KYC terceirizado); LGPD; não dar aconselhamento jurídico, só informação"],
]));

// ---------- 12. PRÓXIMOS PASSOS ----------
children.push(H1("12. Próximos Passos (90 dias)"));
children.push(num([b("Escolher e travar a praça-foco nº 1"), t(" e listar os 50 negócios âncora a cadastrar.")]));
children.push(num([b("Instrumentar o funil"), t(" (visitante → cadastro → perfil completo → Pro) para enxergar conversão real.")]));
children.push(num([b("Fechar o loop de pedido/agendamento + notificação"), t(" — provar que o negócio recebe valor mensurável.")]));
children.push(num([b("Definir meta de North Star"), t(": X negócios ativos pagantes na praça-foco em 90 dias.")]));
children.push(num([b("Recalibrar as projeções"), t(" do §8 com os primeiros números reais de conversão e churn.")]));
children.push(spacer(60));
children.push(new Paragraph({
  border: { top: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 8 } },
  spacing: { before: 200 },
  children: [new TextRun({ text: "BrasilConnect USA — documento interno de estratégia. Os números financeiros são cenários ilustrativos sujeitos a validação. Confidencial.", italics: true, size: 17, color: MUTED })],
}));

// =====================================================================
//  DOC
// =====================================================================
const doc = new Document({
  creator: "BrasilConnect USA",
  title: "Plano de Negócios — BrasilConnect USA",
  description: "Documento interno de estratégia",
  styles: {
    default: { document: { run: { font: "Calibri", size: 21, color: INK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Calibri", color: GREEN_DEEP },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREEN, space: 6 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Calibri", color: NAVY },
        paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 21, bold: true, font: "Calibri", color: INK },
        paragraph: { spacing: { before: 160, after: 70 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bul", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { run: { color: GREEN }, paragraph: { indent: { left: 460, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 920, hanging: 260 } } } },
      ] },
      { reference: "ord", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { run: { bold: true, color: GREEN_DEEP }, paragraph: { indent: { left: 460, hanging: 320 } } } },
      ] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: LINE, space: 4 } },
      children: [
        new TextRun({ text: "BrasilConnect USA", bold: true, size: 16, color: GREEN_DEEP }),
        new TextRun({ text: "\tPlano de Negócios · Estratégia interna", size: 16, color: MUTED }),
      ] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Confidencial · ", size: 16, color: MUTED }),
        new TextRun({ text: "Página ", size: 16, color: MUTED }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
        new TextRun({ text: " de ", size: 16, color: MUTED }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, "BrasilConnect_Plano_de_Negocios.docx");
  fs.writeFileSync(out, buf);
  console.log("OK ->", out, "(" + buf.length + " bytes)");
});
