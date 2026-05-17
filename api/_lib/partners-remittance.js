/**
 * Registry canônico dos parceiros de remessa de dinheiro USA → Brasil.
 *
 * Fonte única de verdade — usada por:
 *   /api/remittance/providers   (lista pro frontend)
 *   /api/remittance/quote       (cotação agregada)
 *   /api/go                     (redirect com tracking de afiliado)
 *
 * Convenções:
 *   id           — slug minúsculo, usado em /go/<id>
 *   name         — exibido pro usuário
 *   country_iso  — origem do dinheiro (US fixo, mas deixamos campo aberto)
 *   payout       — métodos de saque no Brasil
 *   payin        — métodos de envio nos EUA
 *   speed_hours  — tempo médio de chegada (faixa)
 *   fx_margin    — % cobrada acima da mid-rate (estimativa pública)
 *   flat_fee_usd — taxa fixa em dólar
 *   api          — { mode: 'live' | 'estimated' | 'redirect' }
 *                  live      = chama API pública e retorna cotação real
 *                  estimated = calcula com base em mid-rate + margem conhecida
 *                  redirect  = só link de afiliado
 *   env          — variável de ambiente com o link de afiliado
 *
 * Margens FX são estimativas baseadas em comparação pública (Monito, Wise vs.).
 * Atualizar trimestralmente — os bancos mexem nisso o tempo todo.
 */

export const REMITTANCE_PARTNERS = [
  {
    id: 'wise',
    name: 'Wise',
    legal_name: 'Wise US Inc.',
    logo: 'https://logo.clearbit.com/wise.com',
    country_iso: 'US',
    payout: ['pix', 'bank_transfer'],
    payin: ['ach', 'debit_card', 'credit_card', 'wire'],
    speed_hours: [0.1, 24],
    fx_margin: 0.0045,        // ~0.45% — referência mid-market
    flat_fee_usd: 1.50,
    pct_fee: 0.0067,
    api: { mode: 'live', endpoint: 'https://api.wise.com/v3/quotes' },
    env: 'AFFILIATE_WISE_LINK',
    affiliate_program: 'Wise Affiliates (Partnerize)',
    notes: 'Mais transparente do mercado. Cobra fee separado da FX.',
  },
  {
    id: 'remitly',
    name: 'Remitly',
    legal_name: 'Remitly, Inc.',
    logo: 'https://logo.clearbit.com/remitly.com',
    country_iso: 'US',
    payout: ['pix', 'bank_transfer', 'cash_pickup'],
    payin: ['ach', 'debit_card', 'credit_card'],
    speed_hours: [0.1, 72],
    fx_margin: 0.015,         // ~1.5% — Economy tier
    flat_fee_usd: 0,
    pct_fee: 0,
    api: { mode: 'estimated' },  // Remitly não tem API pública de cotação
    env: 'AFFILIATE_REMITLY_LINK',
    affiliate_program: 'Remitly Partners (Impact Radius)',
    notes: 'Economy é grátis mas tem margem FX. Express custa $3.99 e chega em minutos.',
  },
  {
    id: 'xoom',
    name: 'Xoom (PayPal)',
    legal_name: 'Xoom Corporation',
    logo: 'https://logo.clearbit.com/xoom.com',
    country_iso: 'US',
    payout: ['pix', 'bank_transfer', 'cash_pickup'],
    payin: ['paypal', 'debit_card', 'credit_card', 'ach'],
    speed_hours: [0.1, 24],
    fx_margin: 0.025,         // ~2.5%
    flat_fee_usd: 4.99,
    pct_fee: 0,
    api: { mode: 'estimated' },
    env: 'AFFILIATE_XOOM_LINK',
    affiliate_program: 'PayPal Partner Network',
    notes: 'Útil pra quem já tem PayPal. Margem FX maior que Wise/Remitly.',
  },
  {
    id: 'western_union',
    name: 'Western Union',
    legal_name: 'Western Union Holdings, Inc.',
    logo: 'https://logo.clearbit.com/westernunion.com',
    country_iso: 'US',
    payout: ['pix', 'bank_transfer', 'cash_pickup'],
    payin: ['ach', 'debit_card', 'credit_card', 'cash'],
    speed_hours: [0.1, 96],
    fx_margin: 0.035,         // ~3.5%
    flat_fee_usd: 0,
    pct_fee: 0,
    api: { mode: 'estimated' },
    env: 'AFFILIATE_WU_LINK',
    affiliate_program: 'WU Partner Program (Partnerize)',
    notes: 'Maior rede de pickup em cash do Brasil. Margem FX maior em troca.',
  },
  {
    id: 'moneygram',
    name: 'MoneyGram',
    legal_name: 'MoneyGram International, Inc.',
    logo: 'https://logo.clearbit.com/moneygram.com',
    country_iso: 'US',
    payout: ['pix', 'bank_transfer', 'cash_pickup'],
    payin: ['debit_card', 'credit_card', 'ach', 'cash'],
    speed_hours: [0.1, 96],
    fx_margin: 0.030,
    flat_fee_usd: 3.99,
    pct_fee: 0,
    api: { mode: 'estimated' },
    env: 'AFFILIATE_MONEYGRAM_LINK',
    affiliate_program: 'MoneyGram Partners (Awin)',
    notes: 'Boa cobertura no interior. Promo de fee grátis em primeiro envio.',
  },
  {
    id: 'paysend',
    name: 'Paysend',
    legal_name: 'Paysend Limited',
    logo: 'https://logo.clearbit.com/paysend.com',
    country_iso: 'US',
    payout: ['pix', 'bank_transfer'],
    payin: ['debit_card', 'credit_card', 'ach'],
    speed_hours: [0.1, 48],
    fx_margin: 0.020,
    flat_fee_usd: 2.00,
    pct_fee: 0,
    api: { mode: 'estimated' },
    env: 'AFFILIATE_PAYSEND_LINK',
    affiliate_program: 'Paysend Affiliates',
    notes: 'Flat fee fixo de $2 independente do valor. Bom pra envios maiores.',
  },
  {
    id: 'nomad',
    name: 'Nomad',
    legal_name: 'Nomad Pagamentos S.A.',
    logo: 'https://logo.clearbit.com/nomadglobal.com',
    country_iso: 'BR',
    payout: ['nomad_usd_account', 'pix'],
    payin: ['pix', 'ted'],
    speed_hours: [0.1, 24],
    fx_margin: 0.012,
    flat_fee_usd: 0,
    pct_fee: 0,
    api: { mode: 'redirect' },  // direção contrária — BR→USA
    env: 'AFFILIATE_NOMAD_LINK',
    affiliate_program: 'Nomad Parceiros',
    notes: 'Direção BR→USA (conta dólar pra brasileiros). Outro caso de uso.',
    direction: 'BR_TO_US',
  },
]

export const PARTNER_BY_ID = Object.fromEntries(
  REMITTANCE_PARTNERS.map(p => [p.id, p])
)

/**
 * Retorna só os parceiros que enviam USA→BR (filtra Nomad, que é o inverso).
 */
export function getUsaToBrazilPartners() {
  return REMITTANCE_PARTNERS.filter(p => p.direction !== 'BR_TO_US')
}

/**
 * Calcula cotação estimada usando mid-rate + margem + fee conhecidos.
 * Retorna { brl_received, effective_rate, total_cost_usd }
 */
export function estimateQuote(partner, amountUsd, midRate) {
  const effectiveRate = midRate * (1 - (partner.fx_margin || 0))
  const fee = (partner.flat_fee_usd || 0) + (amountUsd * (partner.pct_fee || 0))
  const netUsd = amountUsd - fee
  const brlReceived = netUsd * effectiveRate
  return {
    brl_received: Math.round(brlReceived * 100) / 100,
    effective_rate: Math.round(effectiveRate * 10000) / 10000,
    fee_usd: Math.round(fee * 100) / 100,
    total_cost_usd: amountUsd,
  }
}
