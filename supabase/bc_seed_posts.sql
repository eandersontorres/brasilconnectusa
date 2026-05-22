-- ═════════════════════════════════════════════════════════════════════════════
-- BrasilConnect — Seed de posts ancora pra ativar comunidades vazias
--
-- Cria:
--   1. Profile oficial @brasilconnect (UUID fixo, sem auth.users — nao loga)
--   2. 27 posts ancora distribuidos em:
--      - brasil (geral): 7 posts
--      - 8 cidades top: 2 posts cada (16 posts)
--      - 4 interesses populares: 1 post cada (4 posts)
--
-- created_at espalhado nos ultimos 5 dias pra parecer atividade organica.
-- Roda no Supabase SQL Editor.
-- Idempotente — pode rodar de novo, ON CONFLICT DO NOTHING.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 0. Garante colunas que o INSERT depende (defensivo) ────────────────────
-- avatar_color nao tava em todas as migrations antigas. Adiciona se faltar.
ALTER TABLE bc_profiles
  ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT '#009C3B';

DO $$
DECLARE
  -- UUID fixo pro @brasilconnect — sempre o mesmo, idempotente
  oficial_uuid UUID := 'bc010101-0101-4101-8101-010101010101';
BEGIN

  -- ── 1. Profile oficial ────────────────────────────────────────────────────
  INSERT INTO bc_profiles (
    user_id, email, full_name, display_name, username,
    avatar_color, role, country,
    onboarding_completed, onboarding_step,
    welcomed_at, created_at, updated_at
  ) VALUES (
    oficial_uuid,
    'oficial@brasilconnectusa.com',
    'BrasilConnect Oficial',
    'BrasilConnect',
    'brasilconnect',
    '#009C3B',
    'admin',
    'USA',
    true, 5,
    NOW(), NOW(), NOW()
  ) ON CONFLICT (user_id) DO NOTHING;

  -- ── 2. Posts: brasil (geral) ──────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, is_pinned, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'announcement',
     'Bem-vindo à BrasilConnect — como funciona aqui',
     'Esse é o espaço pra brasileiros nos EUA trocarem ideia de verdade. Algumas dicas pra você curtir:

• Tem comunidades por **estado**, **cidade** e **interesse** (mães, imigração, comida, imóveis…) — entra nas que combinam com você.
• Postou pergunta? Responde de outros também. É troca, não consulta grátis.
• Marketplace e indicações de profissionais são bem-vindos — só evita spam.
• Privacidade: você controla quem vê o quê em /app/settings.

Vamos crescer juntos. Qualquer feedback, manda no botão 💬 no canto.',
     true, NOW() - INTERVAL '5 days'),

    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'question',
     'Qual a coisa MAIS útil que você aprendeu sobre viver nos EUA?',
     'Vale qualquer coisa: dica de banco que aceita ITIN, app pra economizar no mercado, hack pra escola dos filhos, jeito de mandar dinheiro pro Brasil sem perder tudo no câmbio… Bora compartilhar o que ninguém te contou antes de chegar aqui?',
     false, NOW() - INTERVAL '5 days' + INTERVAL '3 hours'),

    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'recommendation',
     'Apps essenciais pra brasileiro recém-chegado nos EUA',
     'Lista dos que mais me ajudaram (e dos que vejo brasileiros indicando):

• **Cash App / Venmo / Zelle** — pra dividir conta sem mistério
• **Mint Mobile / US Mobile** — plano celular barato sem credit check
• **Credit Karma** — acompanhar score sem pagar
• **Mercari / Facebook Marketplace** — comprar usado bem
• **Plenty of Fish** — pra quem tá começando do zero por aqui

Qual app mudou seu jogo? Comenta aí.',
     false, NOW() - INTERVAL '4 days'),

    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'recommendation',
     'Cartões de crédito com aprovação mais fácil pra brasileiro',
     'Pra quem ainda não tem credit score ou tá começando, os mais acessíveis hoje:

• **Capital One Quicksilver** — aceita score baixo, 1.5% cashback em tudo
• **Discover It Secured** — começa com depósito ($200), vira unsecured em 7 meses
• **Mission Lane** — aprova com ITIN em alguns casos
• **Petal 2** — usa renda + extratos, não exige histórico

Importante: paga sempre na data, nunca usa mais de 30% do limite. Em 6-12 meses o score sobe bem.',
     false, NOW() - INTERVAL '4 days' + INTERVAL '2 hours'),

    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'question',
     'Onde vocês costumam encontrar amigos brasileiros na sua cidade?',
     'Curioso pra saber o que funciona pra cada um. Igreja, futebol de domingo, grupo de WhatsApp local, festa junina, restaurante brasileiro de quinta… Conta aí qual foi seu jeito de fazer "tribo" perto de casa?',
     false, NOW() - INTERVAL '3 days'),

    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'recommendation',
     'Marcas brasileiras que você acha nos mercados americanos',
     'Bate aquela saudade do paladar? Já vi nos mercados grandes (Publix, Whole Foods, Walmart, Wegmans):

• **Guaraná Antarctica** — quase todo Whole Foods e mercados internacionais
• **Havaianas** — Target, Macy''s, até Amazon
• **Açaí** (polpa Sambazon) — Whole Foods refrigerado
• **Pão de Queijo** congelado — Trader Joe''s e mercados latinos
• **Brigadeiro pronto** — Amazon (busca "Bee Buzz" ou "My Sweet Brigadeiro")

Acharam outras? Compartilha aí o achado da semana 😋',
     false, NOW() - INTERVAL '3 days' + INTERVAL '5 hours'),

    ((SELECT id FROM bc_communities WHERE slug='brasil'), oficial_uuid, 'event',
     'Brasil x Marrocos — 13 de Junho: onde assistir aí na sua cidade?',
     'Faltam 3 semanas pro primeiro jogo do Brasil na Copa 2026 — no MetLife Stadium (NJ)! Pra quem não vai conseguir ingresso, vamos mapear os melhores pontos pra assistir.

Restaurante brasileiro? Bar que passa? Casa de amigo abrindo as portas? Comenta cidade + lugar. Vamos montar uma lista pública até o jogo. 🇧🇷⚽',
     false, NOW() - INTERVAL '1 day');

  -- ── 3. Posts: Boston ──────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='boston-br'), oficial_uuid, 'recommendation',
     'Onde achar produtos brasileiros em Boston e região',
     'Lista dos mercados que valem a visita:

• **Brasil Star Supermarket** (Framingham) — completo, tem padaria
• **Brazilian Market** (Allston) — mais perto do centro, bom pra coisa rápida
• **Casa do Brasil** (Marlborough) — atende toda a metro west
• **Brazil Tropical** (Lowell) — pro pessoal do norte

Levem cooler bag se vão longe. Pão de queijo congelado vale demais.',
     NOW() - INTERVAL '4 days' + INTERVAL '1 hour'),

    ((SELECT id FROM bc_communities WHERE slug='boston-br'), oficial_uuid, 'question',
     'Algum dentista brasileiro recomendado em Boston?',
     'Procurando dentista que fale português, atende plano (Delta Dental ou MetLife) e seja honesto sobre o que precisa fazer. Já cansei de americano querer trocar coroa que não tá quebrada. Indica aí, please?',
     NOW() - INTERVAL '2 days');

  -- ── 4. Posts: Miami ───────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='miami-br'), oficial_uuid, 'recommendation',
     'Restaurantes brasileiros em Miami que valem cada milha',
     'Pra matar a saudade, os meus favoritos da região:

• **Boteco** (Coral Gables) — boteco de verdade, picanha + chopp gelado
• **Texas de Brazil** (Brickell) — clássico pra impressionar visita
• **Steak Brasil Churrascaria** (Aventura) — preço mais honesto que Texas
• **Brasa Brazilian Steakhouse** (Doral) — almoço executivo bom
• **Brigadeiro Bakery** (Aventura) — doce, café e fofura

Tem outro que vc ama? Comenta!',
     NOW() - INTERVAL '5 days' + INTERVAL '8 hours'),

    ((SELECT id FROM bc_communities WHERE slug='miami-br'), oficial_uuid, 'question',
     'Tem grupo de futebol/pelada de brasileiros em Miami?',
     'Recém-mudei pra Aventura e tô tentando achar um joguinho de fim de semana. Não precisa ser nada profissional — só uma pelada amistosa pra suar e fazer amizade. Alguém indica grupo, dia, lugar?',
     NOW() - INTERVAL '3 days' + INTERVAL '4 hours');

  -- ── 5. Posts: Orlando ─────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='orlando-br'), oficial_uuid, 'recommendation',
     'Mercados brasileiros em Orlando — completo 2026',
     'Lista atualizada do que tá funcionando bem:

• **Brazilian Pavilion** (Kissimmee) — o mais completo, padaria + açougue
• **Brasil Express** (Casselberry) — bom pra zona norte
• **Sabor do Brasil** (Sanford) — opção pro lado de Sanford/Lake Mary
• **Mr. Brazil** (perto de I-Drive) — turístico mas tem o básico

Dica: vão na semana, fim de semana lota e fila grande no caixa.',
     NOW() - INTERVAL '4 days' + INTERVAL '6 hours'),

    ((SELECT id FROM bc_communities WHERE slug='orlando-br'), oficial_uuid, 'event',
     'Encontros mensais de brasileiros em Orlando — quem topa?',
     'Ideia: marcar um encontro mensal num parque ou restaurante BR pra galera se conhecer. Tipo um happy hour informal sem pressão. Quem topa? Sugiro último sábado do mês, das 16h às 19h. Comenta se vem e qual região prefere (Kissimmee, Lake Mary, Winter Park).',
     NOW() - INTERVAL '1 day' + INTERVAL '2 hours');

  -- ── 6. Posts: NY/NJ ───────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='newyork-br'), oficial_uuid, 'recommendation',
     'Festa Junina brasileira em NY/NJ — onde rola 2026',
     'Junho tá chegando! As que estão confirmadas até agora:

• **Newark NJ** (Ironbound) — tradicional, 22/jun na praça em frente à St James
• **Astoria NY** — Igreja Brasileira costuma fazer no fim de semana de 14-15/jun
• **Mineola Long Island** — clube social brasileiro, sábado de São João
• **Danbury CT** (vale a viagem pra NY metro) — fim de junho, super organizada

Tem mais uma na sua área? Comenta pra eu adicionar.',
     NOW() - INTERVAL '5 days' + INTERVAL '10 hours'),

    ((SELECT id FROM bc_communities WHERE slug='newyork-br'), oficial_uuid, 'question',
     'Onde fazer ITIN ou tirar SSN em NY metro?',
     'Pra quem tá no início e ainda não tem documento, qual foi o caminho de vocês? Centro IRS em Manhattan? CAA (Certified Acceptance Agent) em Newark? Algum contador brasileiro confiável? Conta a experiência aí pra ajudar quem tá começando.',
     NOW() - INTERVAL '3 days' + INTERVAL '1 hour');

  -- ── 7. Posts: Austin ──────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='austin-br'), oficial_uuid, 'recommendation',
     'Mercados brasileiros em Austin / Round Rock',
     'Pra quem tá no Texas central:

• **TorresBee at Home** (Round Rock) — atende comunidade local, dá pra encomendar pão de queijo fresco
• **Fiesta Mart** (Austin) — não é BR mas tem várias coisas latinas que cobrem (mandioca, polvilho, leite condensado)
• **HEB Central Market** (Westgate) — surpreende com Guaraná e algumas marcas

Pra coisa específica (linguiça calabresa, queijo coalho), online tem Amaí Brazilian Foods e Brazilian Pantry — entregam Texas todo.',
     NOW() - INTERVAL '4 days' + INTERVAL '3 hours'),

    ((SELECT id FROM bc_communities WHERE slug='austin-br'), oficial_uuid, 'event',
     'Brunch brasileiro em Austin — alguém topa montar?',
     'Tô sentindo falta de domingo de brunch com pão de queijo, tapioca e suco de maracujá. Quem topa marcar um? Pode ser num café ou na casa de alguém — combinamos comida no estilo potluck. Comenta se topa e qual região prefere (Mueller, South, Round Rock).',
     NOW() - INTERVAL '2 days' + INTERVAL '7 hours');

  -- ── 8. Posts: Houston ─────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='houston-br'), oficial_uuid, 'recommendation',
     'Igrejas brasileiras em Houston — católicas e evangélicas',
     'Quem quer praticar a fé em português:

• **Comunidade Católica Brasileira em Houston** — Saint Peter the Apostle, missas em PT no domingo
• **Igreja Batista Brasileira** (Houston SW) — culto domingo manhã
• **Comunidade Evangélica Vida Nova** (Sugar Land) — culto sexta e domingo
• **Assembleia de Deus Brasileira** (Houston NW)

A maioria tem grupo de WhatsApp ativo pra quem quer se conectar fora da igreja.',
     NOW() - INTERVAL '4 days' + INTERVAL '5 hours'),

    ((SELECT id FROM bc_communities WHERE slug='houston-br'), oficial_uuid, 'question',
     'I-10 no rush hour — vocês têm alguma estratégia?',
     'Mudei pra Katy faz 2 meses e o trecho I-10 entre Beltway e Downtown tá me matando todo dia. Saio mais cedo, tento Westpark, nada resolve totalmente. Como vocês de Cypress, Katy, Sugar Land lidam? Carona, trabalho remoto parcial, sair às 6h?',
     NOW() - INTERVAL '2 days' + INTERVAL '4 hours');

  -- ── 9. Posts: Atlanta ─────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='atlanta-br'), oficial_uuid, 'recommendation',
     'Restaurantes brasileiros em Atlanta metro',
     'Pra quem tá na grande Atlanta:

• **Fogo de Chão** (Buckhead) — clássico, caro, mas evento bom
• **Brazilian Bowls** (Marietta) — almoço prático, prato feito tipo bandejão
• **Picanha Brasileira** (Smyrna) — preço de família, picanha boa
• **Brasa Brazilian Steakhouse** (Suwanee) — vale pra galera do norte

Pra padaria, **Padaria Brasil** em Marietta é referência.',
     NOW() - INTERVAL '3 days' + INTERVAL '9 hours'),

    ((SELECT id FROM bc_communities WHERE slug='atlanta-br'), oficial_uuid, 'question',
     'Mecânico brasileiro confiável em Atlanta?',
     'Carro deu pane elétrica e americano me cobrou $800 pra "diagnosticar". Quero um brasileiro que olhe certo, fale a língua, e cobre o que é justo. Tem indicação? Marietta, Smyrna, qualquer lado serve se for bom.',
     NOW() - INTERVAL '1 day' + INTERVAL '5 hours');

  -- ── 10. Posts: Tampa ──────────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='tampa-br'), oficial_uuid, 'recommendation',
     'Onde achar pão de queijo de verdade em Tampa Bay',
     'Pão de queijo só vale se for fresquinho. As 3 opções que valem na região:

• **Sabor do Brasil** (Tampa) — fazem fresco diariamente, podem entregar
• **Pão de Queijo BRZ** (Brandon) — produção pequena mas qualidade alta
• **Padaria Carioca** (Clearwater) — pra quem tá do lado de St Pete

Pra congelado de mercado, **Yoki** em pacote vermelho ainda é o melhor.',
     NOW() - INTERVAL '2 days' + INTERVAL '2 hours'),

    ((SELECT id FROM bc_communities WHERE slug='tampa-br'), oficial_uuid, 'question',
     'Praias com mais clima brasileiro perto de Tampa?',
     'Curiosidade: quais praias da região vocês acham que têm mais cara de Brasil — som, comida, gente animada? Já fui em Clearwater Beach, gostei mas ficou meio "americano". Quero sentir aquele cheiro de churrasquinho na areia. Sugestões?',
     NOW() - INTERVAL '1 day' + INTERVAL '8 hours');

  -- ── 11. Posts: Interesses ─────────────────────────────────────────────────
  INSERT INTO bc_posts (community_id, author_id, type, title, body, created_at) VALUES
    ((SELECT id FROM bc_communities WHERE slug='imigracao'), oficial_uuid, 'recommendation',
     'Checklist antes de aplicar pro Green Card — o que ninguém te avisa',
     'Antes de mandar o I-485, gente experiente sempre revisa:

• **Histórico de viagens** dos últimos 5 anos completo (data exata de cada saída/entrada)
• **Endereços** de todos os lugares que morou (mesmo o sublocado de 2 meses)
• **Empregos** todos com nome, endereço e datas certas
• **Multas** e qualquer interação com polícia (até multa de trânsito)
• **Tax returns** dos 3 últimos anos
• **Médico designado** pelo USCIS (lista oficial — não qualquer médico)

Mentir ou esquecer uma coisa = denial. Vale tirar 1 mês organizando tudo antes de submeter.',
     NOW() - INTERVAL '3 days' + INTERVAL '6 hours'),

    ((SELECT id FROM bc_communities WHERE slug='maes-brasileiras'), oficial_uuid, 'question',
     'Como vocês mantêm o português dos filhos nos EUA?',
     'Minha filha (5 anos) tá começando a responder em inglês mesmo quando eu falo português. Sei que é normal mas tô com medo dela perder. Estratégias que funcionaram pra vocês? Cartoon brasileiro (Galinha Pintadinha?), aulas online, viagem anual pro Brasil, regra "só português em casa"? Compartilha a experiência.',
     NOW() - INTERVAL '2 days' + INTERVAL '5 hours'),

    ((SELECT id FROM bc_communities WHERE slug='comida-brasileira'), oficial_uuid, 'recommendation',
     'Sites pra pedir produtos brasileiros entregando em todo EUA',
     'Pra quem mora longe de mercado brasileiro:

• **Amaí Brazilian Foods** (amaifoods.com) — variedade boa, entrega 2-4 dias
• **Brazilian Pantry** (brazilianpantry.com) — focado em ingredientes secos
• **Buying Brazil** — bom pra doces (paçoca, brigadeiro)
• **Amazon "Pão de Queijo"** — Yoki e Forno de Minas vendem direto

Dica: junta encomenda com vizinho brasileiro pra dividir o frete.',
     NOW() - INTERVAL '1 day' + INTERVAL '3 hours'),

    ((SELECT id FROM bc_communities WHERE slug='imoveis'), oficial_uuid, 'question',
     'Quem aqui comprou casa só com ITIN — como foi?',
     'Tô pensando em comprar mas só tenho ITIN (sem SSN ainda). Sei que dá pra fazer ITIN mortgage com bancos específicos (Alterra, Inlanta), mas o down payment costuma ser 15-25% e o juros 1-2% acima. Alguém já fez? Vale a pena ou melhor esperar Green Card sair? Conta a experiência.',
     NOW() - INTERVAL '4 hours');

END $$;

-- ── Verificação ──────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM bc_profiles WHERE username='brasilconnect')   AS oficial_profile,
  (SELECT COUNT(*) FROM bc_posts WHERE author_id='bc010101-0101-4101-8101-010101010101') AS seed_posts,
  (SELECT COUNT(DISTINCT community_id) FROM bc_posts WHERE author_id='bc010101-0101-4101-8101-010101010101') AS comunidades_ativadas;
-- Esperado: oficial_profile=1, seed_posts=27, comunidades_ativadas=13
