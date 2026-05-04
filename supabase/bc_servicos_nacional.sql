-- ════════════════════════════════════════════════════════════════════════
-- Categorias "Servicos Nacional" — comunidades pra profissionais que
-- atendem brasileiros em qualquer estado dos USA (online ou multi-cidade).
-- Criadas como comunidades type='national' (sem geo_state).
-- ════════════════════════════════════════════════════════════════════════

-- Garante que tipo 'national' existe (se constraint estiver definida)
-- Tabela bc_communities ja deve ter coluna 'type' livre

INSERT INTO bc_communities (slug, name, type, geo_state, geo_city, description, icon, is_official)
VALUES
  -- Saude mental e bem-estar
  ('terapia-online',          'Terapia Online',                'national', NULL, NULL, 'Psicólogos brasileiros que atendem online em qualquer estado',                  '🧠', true),
  ('coach-financeiro',        'Coach Financeiro',              'national', NULL, NULL, 'Educação financeira pra brasileiros nos EUA — taxes, investimentos, dívidas',  '💰', true),
  ('coach-motivacional',      'Coach de Carreira',             'national', NULL, NULL, 'Mentoria pra carreira, mudança profissional, próximo passo',                    '🚀', true),
  ('nutricao-online',         'Nutrição Online',               'national', NULL, NULL, 'Nutricionistas brasileiras com plano alimentar adaptado pros EUA',              '🥗', true),

  -- Juridico
  ('advogados-imigracao',     'Advogados de Imigração',        'national', NULL, NULL, 'Visto, green card, cidadania, asilo — atendimento em PT',                       '⚖️', true),
  ('advogados-trabalhista',   'Advogados Trabalhista',         'national', NULL, NULL, 'Direitos do trabalhador nos EUA, processos, demissão',                          '👔', true),
  ('advogados-familia',       'Advogados de Família',          'national', NULL, NULL, 'Divórcio, custódia, pensão internacional Brasil-EUA',                           '👨‍👩‍👧', true),

  -- Tributario / contabil
  ('contadores-tax',          'Contadores / Tax Brasileiros',  'national', NULL, NULL, 'IRS, ITIN, declaração USA + Brasil, LLC, S-Corp',                               '📊', true),
  ('aberturas-llc',           'Abertura de LLC / EIN',         'national', NULL, NULL, 'Especialistas em abrir empresa, banco, EIN pra brasileiros',                    '🏢', true),

  -- Traducao
  ('traducao-juramentada',    'Tradução Juramentada',          'national', NULL, NULL, 'Tradutores certificados USCIS — diplomas, certidões, contratos',                '📜', true),
  ('traducao-simultanea',     'Tradução / Intérprete',         'national', NULL, NULL, 'Tradução de documentos comuns + intérprete pra consultas/audiências',           '🗣️', true),

  -- Educacao
  ('aulas-ingles',            'Aulas de Inglês',               'national', NULL, NULL, 'Professores brasileiros — conversação, ESL, prova de cidadania, TOEFL',         '🇺🇸', true),
  ('aulas-portugues-pais',    'Aulas de Português pros Filhos', 'national', NULL, NULL, 'Manter o português vivo nos filhos nascidos nos EUA',                          '🇧🇷', true),
  ('aulas-musica',            'Aulas de Música',               'national', NULL, NULL, 'Piano, violão, canto, bateria — online ou presencial',                          '🎸', true),
  ('aulas-reforco',           'Reforço Escolar / Tutoria',     'national', NULL, NULL, 'Matemática, ciências, escrita — pros filhos na escola americana',               '📚', true),

  -- Profissoes liberais
  ('marketing-digital',       'Marketing Digital',             'national', NULL, NULL, 'Social media, ads, sites, branding pra negócios brasileiros',                  '📱', true),
  ('design-grafico',          'Design Gráfico',                'national', NULL, NULL, 'Logo, identidade visual, materiais gráficos, posts',                            '🎨', true),
  ('fotografia-eventos',      'Fotografia de Eventos',         'national', NULL, NULL, 'Casamentos, aniversários, ensaios — em qualquer cidade',                        '📸', true),
  ('desenvolvimento-web',     'Desenvolvedores',               'national', NULL, NULL, 'Sites, apps, automação pra negócios brasileiros',                              '💻', true),

  -- Eventos / artistas
  ('djs-musicos',             'DJs e Músicos',                 'national', NULL, NULL, 'Pra eventos brasileiros — festas, casamentos, confraternizações',               '🎧', true),
  ('chefs-personal',          'Chefs Personal / Buffet',       'national', NULL, NULL, 'Comida brasileira pra eventos, jantar privado, marmita gourmet',                '👨‍🍳', true)
ON CONFLICT (slug) DO NOTHING;

-- Verificacao
SELECT type, COUNT(*) AS total
FROM bc_communities
WHERE is_official = true
GROUP BY type
ORDER BY type;
