const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");

// ---------- Brand palette ----------
const NAVY = "001A5E";
const NAVY2 = "0A2548";
const GREEN = "009C3B";
const GREENL = "00B34D";
const GOLD = "FFD700";
const GOLDL = "FFDF00";
const CREAM = "FAF7F0";
const CREAMD = "F1ECDF";
const INK = "1A1F1C";
const MUTED = "6B6E68";
const WHITE = "FFFFFF";
const BORDER = "E5E1D6";

const HEAD = "Georgia";        // proxy serif for Fraunces (premium/editorial)
const BODY = "Calibri";        // proxy sans for Sora

const W = 13.333, H = 7.5;

let pres = new pptxgen();
pres.defineLayout({ name: "BC", width: W, height: H });
pres.layout = "BC";
pres.author = "BrasilConnect USA";
pres.title = "BrasilConnect USA — Investor Deck";

// ---------- icon helper ----------
async function icon(IconComponent, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
const shadow = () => ({ type: "outer", color: "000000", blur: 9, offset: 3, angle: 90, opacity: 0.12 });

// shorthand
function txt(slide, text, o) { slide.addText(text, o); }
function rect(slide, o) { slide.addShape(pres.shapes.RECTANGLE, o); }
function rrect(slide, o) { slide.addShape(pres.shapes.ROUNDED_RECTANGLE, o); }
function oval(slide, o) { slide.addShape(pres.shapes.OVAL, o); }

// footer on light slides
function footerLight(slide, n) {
  txt(slide, "BrasilConnect USA", { x: 0.55, y: 7.02, w: 4, h: 0.3, fontFace: BODY, fontSize: 9, color: MUTED, align: "left", margin: 0 });
  txt(slide, "Confidencial — material para investidor", { x: 4.5, y: 7.02, w: 5, h: 0.3, fontFace: BODY, fontSize: 9, color: MUTED, align: "center", margin: 0 });
  txt(slide, String(n).padStart(2, "0"), { x: 12.3, y: 7.02, w: 0.5, h: 0.3, fontFace: HEAD, fontSize: 9, color: MUTED, align: "right", margin: 0 });
}
function footerDark(slide, n) {
  txt(slide, "BrasilConnect USA", { x: 0.55, y: 7.02, w: 4, h: 0.3, fontFace: BODY, fontSize: 9, color: "9AA3C0", align: "left", margin: 0 });
  txt(slide, "Confidencial — material para investidor", { x: 4.5, y: 7.02, w: 5, h: 0.3, fontFace: BODY, fontSize: 9, color: "9AA3C0", align: "center", margin: 0 });
  txt(slide, String(n).padStart(2, "0"), { x: 12.3, y: 7.02, w: 0.5, h: 0.3, fontFace: HEAD, fontSize: 9, color: GOLDL, align: "right", margin: 0 });
}
// eyebrow label on light slide
function eyebrow(slide, text, color = GREEN) {
  txt(slide, text.toUpperCase(), { x: 0.55, y: 0.5, w: 8, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color, align: "left", margin: 0 });
}
function title(slide, text, color = NAVY) {
  txt(slide, text, { x: 0.5, y: 0.82, w: 12.3, h: 1.0, fontFace: HEAD, fontSize: 33, bold: true, color, align: "left", margin: 0 });
}

(async () => {
  // ===== preload icons =====
  const I = {
    money: await icon(fa.FaMoneyBillWave, "#" + GREEN),
    users: await icon(fa.FaUsers, "#" + GREEN),
    store: await icon(fa.FaStore, "#" + GREEN),
    plane: await icon(fa.FaPlaneDeparture, "#" + GREEN),
    cal: await icon(fa.FaCalendarCheck, "#" + GREEN),
    pass: await icon(fa.FaPassport, "#" + GREEN),
    tag: await icon(fa.FaTags, "#" + GREEN),
    trophy: await icon(fa.FaTrophy, "#" + GREEN),
    utensils: await icon(fa.FaUtensils, "#" + GREEN),
    bell: await icon(fa.FaBell, "#" + GREEN),
    // gold (for dark slides)
    moneyG: await icon(fa.FaMoneyBillWave, "#" + GOLDL),
    trophyG: await icon(fa.FaTrophy, "#" + GOLDL),
    globeG: await icon(fa.FaGlobeAmericas, "#" + GOLDL),
    usersG: await icon(fa.FaUsers, "#" + GOLDL),
    chartG: await icon(fa.FaChartLine, "#" + GOLDL),
    rocketG: await icon(fa.FaRocket, "#" + GOLDL),
    seedG: await icon(fa.FaSeedling, "#" + GOLDL),
    // misc
    check: await icon(fa.FaCheckCircle, "#" + GREEN),
    x: await icon(fa.FaTimesCircle, "#C0392B"),
    heart: await icon(fa.FaHeart, "#" + GREEN),
    code: await icon(fa.FaCode, "#" + GREEN),
    bullhorn: await icon(fa.FaBullhorn, "#" + GREEN),
    handshake: await icon(fa.FaHandshake, "#" + GREEN),
    shield: await icon(fa.FaShieldAlt, "#" + GREEN),
    mobile: await icon(fa.FaMobileAlt, "#" + GREEN),
    search: await icon(fa.FaSearch, "#" + GREEN),
  };

  // helper: card with icon, title, body
  function iconCard(slide, x, y, w, h, iconData, head, body, opts = {}) {
    rrect(slide, { x, y, w, h, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.1, shadow: shadow() });
    const cs = 0.62;
    oval(slide, { x: x + 0.28, y: y + 0.28, w: cs, h: cs, fill: { color: "EAF5EE" }, line: { type: "none" } });
    slide.addImage({ data: iconData, x: x + 0.28 + cs * 0.22, y: y + 0.28 + cs * 0.22, w: cs * 0.56, h: cs * 0.56 });
    txt(slide, head, { x: x + 0.28, y: y + 1.0, w: w - 0.56, h: 0.4, fontFace: HEAD, fontSize: opts.headSize || 15, bold: true, color: NAVY, align: "left", margin: 0 });
    txt(slide, body, { x: x + 0.28, y: y + 1.42, w: w - 0.56, h: h - 1.6, fontFace: BODY, fontSize: opts.bodySize || 11.5, color: MUTED, align: "left", valign: "top", margin: 0, lineSpacingMultiple: 1.05 });
  }

  // =========================================================
  // SLIDE 1 — CAPA
  // =========================================================
  let s = pres.addSlide();
  s.background = { color: NAVY };
  // ambient glows
  oval(s, { x: 8.5, y: -1.5, w: 7, h: 7, fill: { color: GREEN, transparency: 86 }, line: { type: "none" } });
  oval(s, { x: -2, y: 4.5, w: 6, h: 6, fill: { color: GOLD, transparency: 92 }, line: { type: "none" } });
  // logo badge
  rrect(s, { x: 0.85, y: 0.7, w: 1.05, h: 1.05, fill: { color: GREEN }, line: { type: "none" }, rectRadius: 0.16 });
  s.addImage({ path: "logo.png", x: 0.9, y: 0.75, w: 0.95, h: 0.95, rounding: false });
  txt(s, "BRASILCONNECT USA", { x: 2.1, y: 0.92, w: 8, h: 0.4, fontFace: BODY, fontSize: 14, bold: true, charSpacing: 3, color: WHITE, margin: 0 });
  txt(s, "A casa digital da comunidade brasileira nos EUA", { x: 2.1, y: 1.32, w: 9, h: 0.4, fontFace: BODY, fontSize: 12, color: "9AA3C0", margin: 0 });

  txt(s, [
    { text: "O super-app que conecta ", options: { color: WHITE } },
    { text: "1,9 milhão", options: { color: GOLDL } },
    { text: " de", options: { color: WHITE } },
  ], { x: 0.85, y: 2.7, w: 11.6, h: 0.95, fontFace: HEAD, fontSize: 40, bold: true, margin: 0 });
  txt(s, "brasileiros nos Estados Unidos.", { x: 0.85, y: 3.55, w: 11.6, h: 0.9, fontFace: HEAD, fontSize: 40, bold: true, color: WHITE, margin: 0 });

  txt(s, "Remessas, comunidade, negócios, viagem e imigração — em português, num só lugar. Produto construído, no ar e pronto para escalar.",
    { x: 0.85, y: 4.6, w: 8.4, h: 1.0, fontFace: BODY, fontSize: 14.5, color: "C7CDE0", margin: 0, lineSpacingMultiple: 1.15 });

  // bottom strip
  rect(s, { x: 0, y: 6.75, w: W, h: 0.75, fill: { color: NAVY2 }, line: { type: "none" } });
  // flag accent
  rect(s, { x: 0, y: 6.75, w: W / 3, h: 0.06, fill: { color: GREEN }, line: { type: "none" } });
  rect(s, { x: W / 3, y: 6.75, w: W / 3, h: 0.06, fill: { color: GOLD }, line: { type: "none" } });
  rect(s, { x: (2 * W) / 3, y: 6.75, w: W / 3, h: 0.06, fill: { color: WHITE }, line: { type: "none" } });
  txt(s, "Rodada Seed · 2026", { x: 0.85, y: 6.92, w: 6, h: 0.4, fontFace: BODY, fontSize: 12, bold: true, color: GOLDL, margin: 0 });
  txt(s, "brasilconnectusa.com", { x: 7.3, y: 6.92, w: 5.2, h: 0.4, fontFace: BODY, fontSize: 12, color: "9AA3C0", align: "right", margin: 0 });

  // =========================================================
  // SLIDE 2 — O PROBLEMA
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "O problema");
  title(s, "Viver longe do Brasil é caro, confuso e solitário");
  txt(s, "O brasileiro nos EUA resolve a vida em apps gringos que não falam a língua dele — e em grupos de WhatsApp desorganizados, cheios de golpe.",
    { x: 0.55, y: 1.78, w: 8.2, h: 0.7, fontFace: BODY, fontSize: 14, color: MUTED, margin: 0, lineSpacingMultiple: 1.1 });

  const probs = [
    [I.money, "Remessas caras e opacas", "Mandar dinheiro pra família vira um quebra-cabeça de taxas escondidas e câmbio ruim, espalhado em 8 apps diferentes."],
    [I.search, "Serviços impossíveis de achar", "Contador, advogado de imigração, dentista brasileiro: tudo no boca a boca e em grupos perdidos do Facebook."],
    [I.shield, "Golpes e desconfiança", "Marketplaces informais sem moderação. Aluguel, carro e serviços viram terreno fértil pra fraude."],
    [I.heart, "Solidão e falta de comunidade", "Recém-chegado não sabe onde encontrar gente do seu estado, eventos ou quem já passou pela mesma burocracia."],
  ];
  const px = [0.55, 6.95], py = [2.55, 4.78];
  probs.forEach((p, i) => {
    iconCard(s, px[i % 2], py[Math.floor(i / 2)], 5.8, 2.05, p[0], p[1], p[2]);
  });
  footerLight(s, 2);

  // =========================================================
  // SLIDE 3 — MERCADO / OPORTUNIDADE
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  oval(s, { x: 9.5, y: -2, w: 7, h: 7, fill: { color: GREEN, transparency: 88 }, line: { type: "none" } });
  txt(s, "A OPORTUNIDADE", { x: 0.6, y: 0.55, w: 8, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: GOLDL, margin: 0 });
  txt(s, "Uma diáspora grande, conectada e que move bilhões", { x: 0.55, y: 0.9, w: 12, h: 1.0, fontFace: HEAD, fontSize: 31, bold: true, color: WHITE, margin: 0 });

  const stats = [
    ["~1,9M", "brasileiros vivendo nos EUA", "5ª maior comunidade de imigrantes; concentrada em FL, MA, NJ, CA, GA."],
    ["US$ 2–3 bi", "em remessas EUA → Brasil por ano", "EUA são a maior origem de remessas para o Brasil."],
    ["US$ 40 bi+", "em poder de consumo anual estimado", "Moradia, comida, serviços, viagem e envio de dinheiro."],
  ];
  stats.forEach((st, i) => {
    const x = 0.6 + i * 4.08;
    rrect(s, { x, y: 2.25, w: 3.78, h: 2.55, fill: { color: NAVY2 }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
    txt(s, st[0], { x: x + 0.3, y: 2.55, w: 3.2, h: 0.9, fontFace: HEAD, fontSize: 40, bold: true, color: GOLDL, margin: 0 });
    txt(s, st[1], { x: x + 0.3, y: 3.5, w: 3.25, h: 0.6, fontFace: BODY, fontSize: 13, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 1.0 });
    txt(s, st[2], { x: x + 0.3, y: 4.1, w: 3.25, h: 0.6, fontFace: BODY, fontSize: 10.5, color: "9AA3C0", margin: 0, lineSpacingMultiple: 1.05 });
  });

  rrect(s, { x: 0.6, y: 5.15, w: 12.15, h: 1.35, fill: { color: "11224F" }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
  s.addImage({ data: I.chartG, x: 0.95, y: 5.55, w: 0.55, h: 0.55 });
  txt(s, [
    { text: "E está crescendo.  ", options: { bold: true, color: GOLDL } },
    { text: "A imigração brasileira para os EUA acelerou na última década e a comunidade é jovem e digital — mas os serviços feitos para ela não acompanharam. O espaço está aberto.", options: { color: "C7CDE0" } },
  ], { x: 1.7, y: 5.4, w: 10.8, h: 0.95, fontFace: BODY, fontSize: 13, valign: "middle", margin: 0, lineSpacingMultiple: 1.1 });
  txt(s, "Estimativas: Itamaraty / MRE, Banco Mundial (Migration & Remittances), análise própria. Números arredondados.", { x: 0.6, y: 6.58, w: 12, h: 0.3, fontFace: BODY, fontSize: 8.5, italic: true, color: "6E789C", margin: 0 });

  // =========================================================
  // SLIDE 4 — A SOLUÇÃO
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "A solução");
  title(s, "Um só app para toda a vida do brasileiro nos EUA");
  // left text
  txt(s, "BrasilConnect USA é o super-app da comunidade: tudo que o gringo resolve em dez apps diferentes, o brasileiro resolve aqui — em português, com gente de confiança e taxas justas.",
    { x: 0.55, y: 1.85, w: 5.1, h: 1.6, fontFace: BODY, fontSize: 14.5, color: INK, margin: 0, lineSpacingMultiple: 1.25 });

  const pillars = [
    [I.money, "Economiza dinheiro", "Compara remessas e câmbio em tempo real e leva pro melhor parceiro."],
    [I.users, "Cria pertencimento", "Grupos por interesse e por estado, eventos e perfis verificados."],
    [I.store, "Move a economia local", "Diretório e marketplace de negócios brasileiros, com pedidos online."],
    [I.mobile, "Sempre no bolso", "PWA instalável, push em português e onboarding guiado."],
  ];
  pillars.forEach((p, i) => {
    const y = 1.85 + i * 1.22;
    rrect(s, { x: 6.0, y, w: 6.75, h: 1.05, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.08, shadow: shadow() });
    oval(s, { x: 6.28, y: y + 0.22, w: 0.6, h: 0.6, fill: { color: "EAF5EE" }, line: { type: "none" } });
    s.addImage({ data: p[0], x: 6.28 + 0.15, y: y + 0.37, w: 0.3, h: 0.3 });
    txt(s, p[1], { x: 7.1, y: y + 0.15, w: 5.4, h: 0.4, fontFace: HEAD, fontSize: 15, bold: true, color: NAVY, margin: 0 });
    txt(s, p[2], { x: 7.1, y: y + 0.55, w: 5.45, h: 0.45, fontFace: BODY, fontSize: 11.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.0 });
  });
  // tagline card bottom-left
  rrect(s, { x: 0.55, y: 4.0, w: 5.1, h: 2.55, fill: { color: NAVY }, line: { type: "none" }, rectRadius: 0.1, shadow: shadow() });
  rect(s, { x: 0.55, y: 4.0, w: 0.12, h: 2.55, fill: { color: GOLD }, line: { type: "none" } });
  txt(s, "“", { x: 0.8, y: 3.95, w: 1, h: 0.8, fontFace: HEAD, fontSize: 54, bold: true, color: GREENL, margin: 0 });
  txt(s, "O brasileiro nos EUA não precisa de mais um app.\nPrecisa de um lugar que seja dele.",
    { x: 0.9, y: 4.75, w: 4.5, h: 1.4, fontFace: HEAD, fontSize: 17, italic: true, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 1.15 });
  footerLight(s, 4);

  // =========================================================
  // SLIDE 5 — O PRODUTO JÁ ESTÁ CONSTRUÍDO
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "O produto · já no ar");
  title(s, "Não é uma ideia. É um produto pronto.");
  txt(s, "9 módulos funcionando, integrados a pagamentos, e-mail e push. Construído enxuto — pronto para escalar com capital.",
    { x: 0.55, y: 1.78, w: 9, h: 0.5, fontFace: BODY, fontSize: 14, color: MUTED, margin: 0 });

  const mods = [
    [I.money, "Câmbio & Remessas", "Comparador ao vivo + parceiros"],
    [I.store, "Diretório de negócios", "Negócios brasileiros por raio/cidade"],
    [I.utensils, "Restaurant Connect", "Cardápio + pedidos online, comissão %"],
    [I.users, "Grupos & Comunidade", "26 interesses + ranking por estado"],
    [I.cal, "AgendaPro", "Booking de serviços com depósito"],
    [I.tag, "Marketplace", "Venda & troca com moderação"],
    [I.plane, "Viagem", "Voos, hotéis, parques e roteiros"],
    [I.pass, "Imigração & Guias", "Conteúdo SEO + guias práticos"],
    [I.trophy, "Bolões & Gamificação", "Engajamento e retenção da comunidade"],
  ];
  const gx = 0.55, gy = 2.45, cw = 4.0, ch = 1.32, gapx = 0.13, gapy = 0.13;
  mods.forEach((m, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = gx + col * (cw + gapx), y = gy + row * (ch + gapy);
    rrect(s, { x, y, w: cw, h: ch, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.08, shadow: shadow() });
    rect(s, { x, y, w: 0.1, h: ch, fill: { color: GREEN }, line: { type: "none" } });
    oval(s, { x: x + 0.3, y: y + 0.32, w: 0.66, h: 0.66, fill: { color: "EAF5EE" }, line: { type: "none" } });
    s.addImage({ data: m[0], x: x + 0.3 + 0.17, y: y + 0.32 + 0.17, w: 0.32, h: 0.32 });
    txt(s, m[1], { x: x + 1.12, y: y + 0.28, w: cw - 1.3, h: 0.4, fontFace: HEAD, fontSize: 14, bold: true, color: NAVY, margin: 0 });
    txt(s, m[2], { x: x + 1.12, y: y + 0.7, w: cw - 1.3, h: 0.5, fontFace: BODY, fontSize: 10.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.0 });
  });
  footerLight(s, 5);

  // =========================================================
  // SLIDE 6 — MONETIZAÇÃO
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "Modelo de negócio");
  title(s, "Cinco fontes de receita, um só público");
  txt(s, "Receita diversificada: transacional, recorrente e por performance. Cada módulo monetiza de um jeito.",
    { x: 0.55, y: 1.78, w: 9.5, h: 0.5, fontFace: BODY, fontSize: 14, color: MUTED, margin: 0 });

  const streams = [
    [I.money, "Afiliados de remessa & finanças", "Comissão por cliente que envia dinheiro ou abre conta via parceiros (Wise, Remitly, Western Union…)."],
    [I.store, "Assinaturas de negócios", "Planos Starter / Pro / Premium para negócios brasileiros aparecerem e venderem mais."],
    [I.utensils, "Restaurant Connect", "Comissão percentual por pedido — fração da taxa de gigantes como DoorDash (15–30%). Volume na comunidade."],
    [I.cal, "AgendaPro & sponsors", "Fee sobre booking de serviços + posições patrocinadas no feed e diretório."],
    [I.plane, "Afiliados de viagem", "Comissão em voos, hotéis, ingressos de parques e passeios."],
  ];
  // 5 cards: 3 top, 2 bottom (wider)
  streams.forEach((st, i) => {
    let x, y, w;
    if (i < 3) { x = 0.55 + i * 4.08; y = 2.45; w = 3.8; }
    else { x = 0.55 + (i - 3) * 6.18 + (i === 4 ? 0 : 0); y = 4.55; w = 5.9; }
    if (i >= 3) { x = 0.55 + (i - 3) * 6.28; }
    rrect(s, { x, y, w, h: i < 3 ? 1.92 : 1.78, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.09, shadow: shadow() });
    oval(s, { x: x + 0.28, y: y + 0.26, w: 0.6, h: 0.6, fill: { color: "EAF5EE" }, line: { type: "none" } });
    s.addImage({ data: st[0], x: x + 0.28 + 0.15, y: y + 0.26 + 0.15, w: 0.3, h: 0.3 });
    txt(s, st[1], { x: x + 1.0, y: y + 0.28, w: w - 1.2, h: 0.55, fontFace: HEAD, fontSize: 14, bold: true, color: NAVY, margin: 0, valign: "middle" });
    txt(s, st[2], { x: x + 0.28, y: y + 0.98, w: w - 0.56, h: i < 3 ? 0.85 : 0.7, fontFace: BODY, fontSize: 11, color: MUTED, margin: 0, lineSpacingMultiple: 1.05 });
  });
  footerLight(s, 6);

  // =========================================================
  // SLIDE 7 — POR QUE AGORA (COPA 2026)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  oval(s, { x: -2, y: -2, w: 7, h: 7, fill: { color: GREEN, transparency: 88 }, line: { type: "none" } });
  oval(s, { x: 9, y: 3, w: 6.5, h: 6.5, fill: { color: GOLD, transparency: 92 }, line: { type: "none" } });
  txt(s, "POR QUE AGORA", { x: 0.6, y: 0.55, w: 8, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: GOLDL, margin: 0 });
  txt(s, "A comunidade cresceu — os serviços não", { x: 0.55, y: 0.9, w: 12, h: 1.0, fontFace: HEAD, fontSize: 30, bold: true, color: WHITE, margin: 0 });

  s.addImage({ data: I.globeG, x: 0.65, y: 2.2, w: 0.7, h: 0.7 });
  txt(s, "A diáspora brasileira nos EUA está maior, mais jovem e mais digital do que nunca — mas ainda resolve a vida em apps gringos e grupos de WhatsApp. A janela para se tornar a plataforma de referência está aberta agora.",
    { x: 1.6, y: 2.15, w: 11, h: 1.1, fontFace: BODY, fontSize: 15, color: "C7CDE0", margin: 0, lineSpacingMultiple: 1.2 });

  const whys = [
    [I.globeG, "Diáspora em alta", "A imigração brasileira para os EUA acelerou na última década. Mais gente chegando significa mais demanda por tudo que oferecemos."],
    [I.usersG, "Espaço em aberto", "Nenhum incumbente atende a comunidade por inteiro. Quem ocupar esse lugar primeiro vira o padrão — e o efeito de rede protege."],
    [I.rocketG, "Infra pronta", "Pagamentos, remessas digitais e parcerias de afiliados maduras tornam viável hoje o que era caro e complexo há 5 anos."],
  ];
  whys.forEach((w2, i) => {
    const x = 0.6 + i * 4.08;
    rrect(s, { x, y: 3.6, w: 3.78, h: 2.85, fill: { color: NAVY2 }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
    oval(s, { x: x + 0.3, y: 3.9, w: 0.7, h: 0.7, fill: { color: "12244F" }, line: { color: "2C3F6E", width: 1 } });
    s.addImage({ data: w2[0], x: x + 0.3 + 0.19, y: 3.9 + 0.19, w: 0.32, h: 0.32 });
    txt(s, w2[1], { x: x + 0.3, y: 4.72, w: 3.2, h: 0.45, fontFace: HEAD, fontSize: 16, bold: true, color: GOLDL, margin: 0 });
    txt(s, w2[2], { x: x + 0.3, y: 5.18, w: 3.25, h: 1.15, fontFace: BODY, fontSize: 11.5, color: "C7CDE0", margin: 0, lineSpacingMultiple: 1.1 });
  });
  footerDark(s, 7);

  // =========================================================
  // SLIDE 8 — GO-TO-MARKET
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "Go-to-market");
  title(s, "Crescimento em comunidade: viral, orgânico, barato");
  const gtm = [
    [I.trophy, "1. Gancho", "Bolão Copa grátis", "Atrai usuários em massa via convite de amigos e disputa por estado."],
    [I.bullhorn, "2. Alcance", "SEO + conteúdo", "Guias de imigração, custo de vida e câmbio capturam quem busca no Google."],
    [I.handshake, "3. Indicação", "Programa “Indique”", "Cada usuário traz outro; recompensa e ranking ampliam o boca a boca."],
    [I.heart, "4. Retenção", "Comunidade & push", "Grupos, eventos e notificações em PT mantêm o usuário voltando."],
  ];
  gtm.forEach((g, i) => {
    const x = 0.55 + i * 3.12;
    rrect(s, { x, y: 2.3, w: 2.92, h: 3.5, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.1, shadow: shadow() });
    oval(s, { x: x + 1.06, y: 2.65, w: 0.8, h: 0.8, fill: { color: "EAF5EE" }, line: { type: "none" } });
    s.addImage({ data: g[0], x: x + 1.06 + 0.22, y: 2.65 + 0.22, w: 0.36, h: 0.36 });
    txt(s, g[1], { x: x + 0.15, y: 3.6, w: 2.62, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: GREEN, align: "center", margin: 0 });
    txt(s, g[2], { x: x + 0.15, y: 3.92, w: 2.62, h: 0.5, fontFace: HEAD, fontSize: 15.5, bold: true, color: NAVY, align: "center", margin: 0 });
    txt(s, g[3], { x: x + 0.2, y: 4.5, w: 2.52, h: 1.2, fontFace: BODY, fontSize: 11, color: MUTED, align: "center", margin: 0, lineSpacingMultiple: 1.12 });
    if (i < 3) txt(s, "→", { x: x + 2.82, y: 3.7, w: 0.5, h: 0.6, fontFace: BODY, fontSize: 24, bold: true, color: GOLD, align: "center", margin: 0 });
  });
  // bottom band: flywheel note
  rrect(s, { x: 0.55, y: 6.05, w: 12.2, h: 0.78, fill: { color: NAVY }, line: { type: "none" }, rectRadius: 0.08 });
  txt(s, [
    { text: "CAC baixo, efeito de rede.  ", options: { bold: true, color: GOLDL } },
    { text: "Quanto mais brasileiros entram, mais valioso o app fica para o próximo — comunidade é o fosso.", options: { color: WHITE } },
  ], { x: 0.9, y: 6.05, w: 11.5, h: 0.78, fontFace: BODY, fontSize: 13, valign: "middle", margin: 0 });
  footerLight(s, 8);

  // =========================================================
  // SLIDE 9 — VANTAGEM COMPETITIVA
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "Vantagem competitiva");
  title(s, "Ninguém atende essa comunidade por inteiro");
  txt(s, "Apps gringos não falam português nem conhecem a dor do imigrante. Grupos de WhatsApp não escalam nem monetizam. Nós unimos os dois.",
    { x: 0.55, y: 1.78, w: 12, h: 0.5, fontFace: BODY, fontSize: 14, color: MUTED, margin: 0 });

  // comparison table
  const rows = [
    ["", "Apps gringos\n(DoorDash, Zelle…)", "Grupos de\nWhatsApp/FB", "BrasilConnect"],
    ["Em português, pensado pro BR", false, "meio", true],
    ["Tudo num lugar só", false, false, true],
    ["Confiança & moderação", "meio", false, true],
    ["Comissão justa no restaurante", false, "n/a", true],
    ["Monetiza & escala", true, false, true],
  ];
  const tx = 0.55, tyTop = 2.5, colW = [4.3, 2.85, 2.7, 2.4], rowH = 0.66;
  let cx = tx;
  // header row
  rows[0].forEach((c, ci) => {
    const isBC = ci === 3;
    rect(s, { x: cx, y: tyTop, w: colW[ci], h: 0.86, fill: { color: isBC ? NAVY : (ci === 0 ? CREAM : CREAMD) }, line: { color: BORDER, width: 1 } });
    if (c) txt(s, c, { x: cx + 0.1, y: tyTop, w: colW[ci] - 0.2, h: 0.86, fontFace: HEAD, fontSize: ci === 0 ? 12 : 13, bold: true, color: isBC ? GOLDL : NAVY, align: ci === 0 ? "left" : "center", valign: "middle", margin: 0, lineSpacingMultiple: 0.95 });
    cx += colW[ci];
  });
  // body rows
  for (let r = 1; r < rows.length; r++) {
    const y = tyTop + 0.86 + (r - 1) * rowH;
    cx = tx;
    rows[r].forEach((c, ci) => {
      const isBC = ci === 3;
      rect(s, { x: cx, y, w: colW[ci], h: rowH, fill: { color: isBC ? "EAF5EE" : (r % 2 ? WHITE : CREAMD) }, line: { color: BORDER, width: 1 } });
      if (ci === 0) {
        txt(s, c, { x: cx + 0.18, y, w: colW[ci] - 0.3, h: rowH, fontFace: BODY, fontSize: 12, bold: true, color: INK, align: "left", valign: "middle", margin: 0 });
      } else {
        const cell = c;
        const cy = y + rowH / 2 - 0.16;
        const ccx = cx + colW[ci] / 2 - 0.16;
        if (cell === true) s.addImage({ data: I.check, x: ccx, y: cy, w: 0.32, h: 0.32 });
        else if (cell === false) s.addImage({ data: I.x, x: ccx, y: cy, w: 0.32, h: 0.32 });
        else txt(s, cell === "meio" ? "parcial" : cell, { x: cx, y, w: colW[ci], h: rowH, fontFace: BODY, fontSize: 10.5, italic: true, color: MUTED, align: "center", valign: "middle", margin: 0 });
      }
      cx += colW[ci];
    });
  }
  footerLight(s, 9);

  // =========================================================
  // SLIDE 10 — TRAÇÃO / ESTADO ATUAL
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  oval(s, { x: 9, y: -2, w: 7, h: 7, fill: { color: GREEN, transparency: 88 }, line: { type: "none" } });
  txt(s, "ONDE ESTAMOS", { x: 0.6, y: 0.55, w: 8, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: GOLDL, margin: 0 });
  txt(s, "Pré-lançamento — com o difícil já feito", { x: 0.55, y: 0.9, w: 12, h: 0.9, fontFace: HEAD, fontSize: 31, bold: true, color: WHITE, margin: 0 });

  const tnums = [
    ["9", "módulos no ar e integrados"],
    ["100%", "do produto core construído"],
    ["1", "fundador — produto inteiro feito"],
    ["$0", "de capital externo até hoje"],
  ];
  tnums.forEach((t, i) => {
    const x = 0.6 + i * 3.06;
    rrect(s, { x, y: 2.15, w: 2.82, h: 1.7, fill: { color: NAVY2 }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
    txt(s, t[0], { x: x + 0.2, y: 2.32, w: 2.45, h: 0.8, fontFace: HEAD, fontSize: 34, bold: true, color: GOLDL, align: "left", margin: 0 });
    txt(s, t[1], { x: x + 0.22, y: 3.18, w: 2.45, h: 0.55, fontFace: BODY, fontSize: 11, color: "C7CDE0", margin: 0, lineSpacingMultiple: 1.05 });
  });

  // checklist done
  txt(s, "Já entregue", { x: 0.6, y: 4.2, w: 6, h: 0.4, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, margin: 0 });
  const done = [
    "Plataforma web + PWA instalável (iOS/Android)",
    "Pagamentos (Stripe), e-mail (Resend) e push integrados",
    "Auth por magic link + onboarding com drip de e-mails",
    "Painel admin: analytics, moderação, leads, waitlist",
  ];
  done.forEach((d, i) => {
    const y = 4.7 + i * 0.46;
    s.addImage({ data: I.check, x: 0.62, y: y + 0.02, w: 0.26, h: 0.26 });
    txt(s, d, { x: 1.0, y, w: 5.8, h: 0.4, fontFace: BODY, fontSize: 12.5, color: "C7CDE0", valign: "middle", margin: 0 });
  });
  // right card: what capital unlocks
  rrect(s, { x: 7.0, y: 4.2, w: 5.75, h: 2.5, fill: { color: "11224F" }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
  rect(s, { x: 7.0, y: 4.2, w: 0.12, h: 2.5, fill: { color: GOLD }, line: { type: "none" } });
  txt(s, "O que falta é combustível", { x: 7.3, y: 4.4, w: 5.2, h: 0.5, fontFace: HEAD, fontSize: 16, bold: true, color: GOLDL, margin: 0 });
  txt(s, "O produto está pronto. O capital acelera aquisição na janela da Copa, ativa as parcerias de remessa que já estão integradas e financia o time para escalar.",
    { x: 7.3, y: 4.95, w: 5.2, h: 1.7, fontFace: BODY, fontSize: 13, color: "C7CDE0", margin: 0, lineSpacingMultiple: 1.25 });
  footerDark(s, 10);

  // =========================================================
  // SLIDE 11 — ROADMAP
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "Roadmap");
  title(s, "Os próximos 18 meses");
  const phases = [
    ["Agora", "Lançar na Copa", ["Aquisição viral via Bolão", "Ativar afiliados de remessa", "Onboarding dos primeiros negócios"], GREEN],
    ["6 meses", "Provar receita", ["Restaurant Connect ao vivo", "Assinaturas de negócios", "Primeiras cidades-âncora (FL, MA)"], GOLD],
    ["12 meses", "Escalar comunidade", ["Eventos & DM entre usuários", "App nas lojas (iOS/Android)", "Expansão geográfica EUA"], NAVY],
    ["18 meses", "Aprofundar receita", ["Fintech própria / carteira", "Marketplace de serviços", "Métricas para a Série A"], NAVY],
  ];
  // timeline line
  rect(s, { x: 0.9, y: 2.55, w: 11.5, h: 0.05, fill: { color: BORDER }, line: { type: "none" } });
  phases.forEach((p, i) => {
    const x = 0.55 + i * 3.12;
    oval(s, { x: x + 0.32, y: 2.42, w: 0.32, h: 0.32, fill: { color: p[3] }, line: { color: WHITE, width: 2 } });
    rrect(s, { x, y: 3.0, w: 2.92, h: 3.4, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.1, shadow: shadow() });
    rect(s, { x, y: 3.0, w: 2.92, h: 0.62, fill: { color: p[3] }, line: { type: "none" } });
    txt(s, p[0], { x: x + 0.2, y: 3.0, w: 2.5, h: 0.62, fontFace: BODY, fontSize: 12, bold: true, charSpacing: 1, color: p[3] === GOLD ? NAVY : WHITE, valign: "middle", margin: 0 });
    txt(s, p[1], { x: x + 0.2, y: 3.78, w: 2.55, h: 0.6, fontFace: HEAD, fontSize: 16, bold: true, color: NAVY, margin: 0 });
    txt(s, p[2].map((b, k) => ({ text: b, options: { bullet: { indent: 12 }, breakLine: true, paraSpaceAfter: 6 } })),
      { x: x + 0.22, y: 4.42, w: 2.55, h: 1.9, fontFace: BODY, fontSize: 11, color: MUTED, margin: 0 });
  });
  footerLight(s, 11);

  // =========================================================
  // SLIDE 12 — TIME
  // =========================================================
  s = pres.addSlide();
  s.background = { color: CREAM };
  eyebrow(s, "Time");
  title(s, "Quem está construindo");
  // founder card
  rrect(s, { x: 0.55, y: 2.3, w: 6.0, h: 4.2, fill: { color: WHITE }, line: { color: BORDER, width: 1 }, rectRadius: 0.1, shadow: shadow() });
  oval(s, { x: 0.95, y: 2.7, w: 1.5, h: 1.5, fill: { color: NAVY }, line: { type: "none" } });
  txt(s, "AT", { x: 0.95, y: 2.7, w: 1.5, h: 1.5, fontFace: HEAD, fontSize: 36, bold: true, color: GOLDL, align: "center", valign: "middle", margin: 0 });
  txt(s, "Anderson Torres", { x: 2.7, y: 2.85, w: 3.6, h: 0.5, fontFace: HEAD, fontSize: 20, bold: true, color: NAVY, margin: 0 });
  txt(s, "Fundador & Desenvolvedor", { x: 2.7, y: 3.35, w: 3.6, h: 0.4, fontFace: BODY, fontSize: 12.5, bold: true, color: GREEN, margin: 0 });
  txt(s, "[Adicione 2–3 linhas de bio: sua experiência, por que você é a pessoa certa para resolver isso, e sua conexão com a comunidade brasileira nos EUA.]",
    { x: 0.95, y: 4.5, w: 5.2, h: 1.8, fontFace: BODY, fontSize: 12.5, italic: true, color: MUTED, margin: 0, lineSpacingMultiple: 1.25 });

  // why-us card
  rrect(s, { x: 6.85, y: 2.3, w: 5.9, h: 4.2, fill: { color: NAVY }, line: { type: "none" }, rectRadius: 0.1, shadow: shadow() });
  txt(s, "Por que esse time", { x: 7.2, y: 2.6, w: 5.2, h: 0.5, fontFace: HEAD, fontSize: 18, bold: true, color: GOLDL, margin: 0 });
  const whyteam = [
    "Construiu sozinho um produto completo e em produção — execução comprovada com pouco recurso.",
    "Domínio técnico ponta a ponta: produto, backend, pagamentos e crescimento.",
    "Faz parte da comunidade que atende — entende a dor de verdade.",
  ];
  whyteam.forEach((d, i) => {
    const y = 3.35 + i * 1.0;
    s.addImage({ data: I.check, x: 7.2, y: y + 0.02, w: 0.3, h: 0.3 });
    txt(s, d, { x: 7.65, y, w: 4.85, h: 0.95, fontFace: BODY, fontSize: 13, color: "C7CDE0", margin: 0, valign: "top", lineSpacingMultiple: 1.15 });
  });
  txt(s, "[Próximos hires com a rodada: crescimento/marketing e parcerias.]",
    { x: 7.2, y: 6.05, w: 5.3, h: 0.4, fontFace: BODY, fontSize: 10.5, italic: true, color: "8A93B5", margin: 0 });
  footerLight(s, 12);

  // =========================================================
  // SLIDE 13 — THE ASK
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  oval(s, { x: -2, y: 3, w: 7, h: 7, fill: { color: GREEN, transparency: 88 }, line: { type: "none" } });
  oval(s, { x: 9.5, y: -2, w: 6.5, h: 6.5, fill: { color: GOLD, transparency: 92 }, line: { type: "none" } });
  txt(s, "A OFERTA", { x: 0.6, y: 0.55, w: 8, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: GOLDL, margin: 0 });
  txt(s, "Buscamos uma rodada seed", { x: 0.55, y: 0.9, w: 12, h: 0.9, fontFace: HEAD, fontSize: 32, bold: true, color: WHITE, margin: 0 });

  // big ask number
  rrect(s, { x: 0.6, y: 2.1, w: 4.55, h: 4.35, fill: { color: NAVY2 }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
  s.addImage({ data: I.seedG, x: 0.95, y: 2.4, w: 0.6, h: 0.6 });
  txt(s, "Captação", { x: 0.95, y: 3.05, w: 3.8, h: 0.4, fontFace: BODY, fontSize: 12, bold: true, charSpacing: 1, color: "9AA3C0", margin: 0 });
  txt(s, "US$ 750K", { x: 0.9, y: 3.4, w: 3.9, h: 1.0, fontFace: HEAD, fontSize: 48, bold: true, color: GOLDL, margin: 0 });
  txt(s, "rodada seed (SAFE)", { x: 0.95, y: 4.4, w: 3.8, h: 0.4, fontFace: BODY, fontSize: 13, color: WHITE, margin: 0 });
  rect(s, { x: 0.95, y: 4.95, w: 3.5, h: 0.02, fill: { color: "24345E" }, line: { type: "none" } });
  txt(s, "Pista de ~18 meses para chegar a métricas de Série A.", { x: 0.95, y: 5.15, w: 3.85, h: 1.0, fontFace: BODY, fontSize: 12.5, color: "C7CDE0", margin: 0, lineSpacingMultiple: 1.2 });
  txt(s, "[valores sugeridos — ajustar]", { x: 0.95, y: 6.05, w: 3.8, h: 0.3, fontFace: BODY, fontSize: 9, italic: true, color: "6E789C", margin: 0 });

  // use of funds
  txt(s, "Uso dos recursos", { x: 5.5, y: 2.1, w: 7, h: 0.5, fontFace: HEAD, fontSize: 18, bold: true, color: WHITE, margin: 0 });
  const funds = [
    ["Marketing & aquisição", 40, "Aproveitar a janela da Copa + canais pagos e parcerias."],
    ["Time", 35, "Crescimento/marketing e parcerias; suporte à comunidade."],
    ["Produto & engenharia", 15, "App nas lojas, fintech/carteira e novos módulos."],
    ["Operação & jurídico", 10, "Infra, compliance (KYC/pagamentos) e reserva."],
  ];
  funds.forEach((f, i) => {
    const y = 2.75 + i * 0.95;
    txt(s, f[0], { x: 5.5, y, w: 4.5, h: 0.35, fontFace: BODY, fontSize: 13.5, bold: true, color: WHITE, margin: 0 });
    txt(s, f[1] + "%", { x: 11.7, y, w: 1.0, h: 0.35, fontFace: HEAD, fontSize: 15, bold: true, color: GOLDL, align: "right", margin: 0 });
    rect(s, { x: 5.5, y: y + 0.38, w: 7.2, h: 0.16, fill: { color: "1B2C55" }, line: { type: "none" } });
    rect(s, { x: 5.5, y: y + 0.38, w: 7.2 * (f[1] / 40), h: 0.16, fill: { color: i === 0 ? GREENL : (i === 1 ? GREEN : "2E66B0") }, line: { type: "none" } });
    txt(s, f[2], { x: 5.5, y: y + 0.56, w: 7.2, h: 0.35, fontFace: BODY, fontSize: 10.5, color: "9AA3C0", margin: 0 });
  });
  footerDark(s, 13);

  // =========================================================
  // SLIDE 14 — FECHAMENTO
  // =========================================================
  s = pres.addSlide();
  s.background = { color: NAVY };
  oval(s, { x: 8, y: -2, w: 8, h: 8, fill: { color: GREEN, transparency: 86 }, line: { type: "none" } });
  oval(s, { x: -2.5, y: 3.5, w: 7, h: 7, fill: { color: GOLD, transparency: 92 }, line: { type: "none" } });
  rrect(s, { x: 0.85, y: 0.9, w: 1.05, h: 1.05, fill: { color: GREEN }, line: { type: "none" }, rectRadius: 0.16 });
  s.addImage({ path: "logo.png", x: 0.9, y: 0.95, w: 0.95, h: 0.95 });

  txt(s, "Vamos construir a casa digital", { x: 0.85, y: 2.5, w: 11.5, h: 0.95, fontFace: HEAD, fontSize: 40, bold: true, color: WHITE, margin: 0 });
  txt(s, [
    { text: "de 1,9 milhão de brasileiros — ", options: { color: WHITE } },
    { text: "juntos.", options: { color: GOLDL } },
  ], { x: 0.85, y: 3.4, w: 11.5, h: 0.95, fontFace: HEAD, fontSize: 40, bold: true, margin: 0 });

  txt(s, "Produto pronto. Mercado enorme. Timing único. Falta você.",
    { x: 0.85, y: 4.6, w: 10, h: 0.5, fontFace: BODY, fontSize: 16, color: "C7CDE0", margin: 0 });

  // contact band
  rrect(s, { x: 0.85, y: 5.4, w: 11.6, h: 1.25, fill: { color: NAVY2 }, line: { color: "24345E", width: 1 }, rectRadius: 0.1 });
  rect(s, { x: 0.85, y: 5.4, w: 0.12, h: 1.25, fill: { color: GOLD }, line: { type: "none" } });
  txt(s, "Anderson Torres · Fundador", { x: 1.2, y: 5.62, w: 6, h: 0.4, fontFace: HEAD, fontSize: 16, bold: true, color: WHITE, margin: 0 });
  txt(s, "[seu e-mail]  ·  [seu telefone/WhatsApp]", { x: 1.2, y: 6.05, w: 7, h: 0.4, fontFace: BODY, fontSize: 12.5, color: "9AA3C0", margin: 0 });
  txt(s, "brasilconnectusa.com", { x: 7.5, y: 5.8, w: 4.6, h: 0.5, fontFace: HEAD, fontSize: 17, bold: true, color: GOLDL, align: "right", margin: 0 });

  await pres.writeFile({ fileName: "BrasilConnectUSA_Investidor_Deck.pptx" });
  console.log("OK deck escrito");
})();
