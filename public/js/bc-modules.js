/**
 * BrasilConnect — Taxonomia de modulos do painel do assinante.
 *
 * 1 negocio = 1 modulo. Modulo define quais tabs aparecem no /assinante
 * e quais features cada plano libera.
 *
 * Usado em:
 *   - /negocio (cadastro)              -> mostrar qual modulo vai ser ativado
 *   - /assinante (painel)              -> renderizar tabs dinamicas
 *   - /api/businesses/submit, /update  -> validar + persistir
 *
 * Carrega via <script src="/js/bc-modules.js"></script>
 * (UMD-ish: window.BC_MODULES + helpers)
 */
(function (root) {
  'use strict'

  // ─── Modulos canonicos ────────────────────────────────────────────────
  const MODULES = {
    restaurant: {
      key: 'restaurant',
      label: 'Restaurante',
      emoji: '🍽️',
      tagline: 'Cardápio online + pedidos com pagamento.',
      blurb: 'Aceite pedidos pela web com cardápio, modificadores e pagamento via Stripe. Sem comissão por pedido — você paga só o plano mensal. O que vender é seu.',
      tabs: [
        { key: 'negocio',  label: 'Meu Negócio' },
        { key: 'cardapio', label: 'Cardápio' },
        { key: 'pedidos',  label: 'Pedidos', badge: true },
      ],
      features: {
        free:    ['Perfil público', 'Cardápio com até 20 itens'],
        pro:     ['Cardápio ilimitado', 'Modificadores', 'Pedidos online sem comissão', 'Stripe Connect'],
        premium: ['Tudo do Pro', 'Destaque na busca', 'Badge verificado', 'Analytics'],
      },
    },

    grocery: {
      key: 'grocery',
      label: 'Mercado',
      emoji: '🛒',
      tagline: 'Catálogo de produtos + pedidos sem comissão.',
      blurb: 'Coloque seu mercado online — produtos com foto, preço e estoque, pedidos com entrega ou retirada. Sem comissão por venda. Mesmo motor do Cardápio, otimizado pra mercearia.',
      tabs: [
        { key: 'negocio',  label: 'Meu Negócio' },
        { key: 'cardapio', label: 'Catálogo' },
        { key: 'pedidos',  label: 'Pedidos', badge: true },
      ],
      features: {
        free:    ['Perfil público', 'Catálogo com até 30 itens'],
        pro:     ['Catálogo ilimitado', 'Pedidos online sem comissão', 'Stripe Connect'],
        premium: ['Tudo do Pro', 'Destaque na busca', 'Badge verificado', 'Analytics'],
      },
    },

    retail: {
      key: 'retail',
      label: 'Loja (Retail)',
      emoji: '🛍️',
      tagline: 'Vitrine de produtos + pedidos sem comissão.',
      blurb: 'Vitrine pra lojas físicas — roupas, artesanato, importados. Cliente vê estoque, faz pedido com pagamento online. Sem comissão por venda — só mensalidade.',
      tabs: [
        { key: 'negocio',  label: 'Meu Negócio' },
        { key: 'cardapio', label: 'Catálogo' },
        { key: 'pedidos',  label: 'Pedidos', badge: true },
      ],
      features: {
        free:    ['Perfil público', 'Catálogo com até 20 itens'],
        pro:     ['Catálogo ilimitado', 'Pedidos online sem comissão', 'Stripe Connect'],
        premium: ['Tudo do Pro', 'Destaque na busca', 'Badge verificado', 'Analytics'],
      },
    },

    agenda_pro: {
      key: 'agenda_pro',
      label: 'AgendaPro',
      emoji: '📅',
      tagline: 'Agendamento online com calendário.',
      blurb: 'Pra profissionais que vendem horários — cabeleireira, massagista, dentista, personal. Cliente vê disponibilidade e agenda direto no seu calendário. Sem comissão por agendamento.',
      tabs: [
        { key: 'negocio',      label: 'Meu Negócio' },
        { key: 'profissional', label: 'Profissional (AgendaPro)' },
      ],
      features: {
        free:    ['Perfil público', 'Até 20 agendamentos/mês'],
        pro:     ['Agendamentos ilimitados', 'Lembretes por SMS/email', 'Pagamento online sem comissão'],
        premium: ['Tudo do Pro', 'Multi-profissional', 'Reviews pós-atendimento', 'Analytics'],
      },
    },

    showcase: {
      key: 'showcase',
      label: 'Divulgação',
      emoji: '📣',
      tagline: 'Só perfil — sem loja, sem agenda.',
      blurb: 'Pra quem quer só aparecer no diretório com fotos, contato e descrição. Ideal pra escritórios de advocacia, contadores, igrejas, imobiliárias e qualquer negócio que não vende online.',
      tabs: [
        { key: 'negocio', label: 'Meu Negócio' },
      ],
      features: {
        free:    ['Perfil público', 'Telefone + WhatsApp', 'Aprovação em 48h'],
        pro:     ['Logo, fotos, galeria', 'Descrição completa', 'Instagram/Facebook'],
        premium: ['Tudo do Pro', 'Badge verificado', 'Destaque no topo', 'Analytics'],
      },
    },
  }

  // ─── Categoria atual -> modulo padrao ────────────────────────────────
  // Categorias livres continuam existindo; mapeamento abaixo so define
  // o DEFAULT no cadastro. Pessoa pode trocar depois.
  const CATEGORY_TO_MODULE = {
    restaurante:   'restaurant',
    mercado:       'grocery',
    beleza:        'agenda_pro',
    saude:         'agenda_pro',
    educacao:      'agenda_pro',
    juridico:      'showcase',
    contabilidade: 'showcase',
    igreja:        'showcase',
    imoveis:       'showcase',
    transporte:    'showcase',
  }

  function categoryToModule(category) {
    return CATEGORY_TO_MODULE[String(category || '').toLowerCase()] || 'showcase'
  }

  function isValidModule(m) {
    return !!MODULES[m]
  }

  function getModule(m) {
    return MODULES[m] || MODULES.showcase
  }

  function getTabs(m) {
    return getModule(m).tabs
  }

  // ─── Expose ───────────────────────────────────────────────────────────
  const api = {
    MODULES,
    CATEGORY_TO_MODULE,
    categoryToModule,
    isValidModule,
    getModule,
    getTabs,
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) {
    root.BC_MODULES = api
  }
})(typeof window !== 'undefined' ? window : null)
