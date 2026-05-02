/**
 * GET /api/cron/drip
 *
 * Cron diário que envia o próximo email do drip campaign para usuários
 * da waitlist conforme dias desde cadastro:
 *   D+0  → Email 1: Boas-vindas (já enviado por /api/waitlist na hora do cadastro)
 *   D+3  → Email 2: 5 erros comuns de brasileiros recém chegados
 *   D+7  → Email 3: Quanto você economiza em remessas
 *   D+14 → Email 4: Guia de chegada nos EUA (lead magnet)
 *   D+21 → Email 5: Custo de vida em 12 cidades — qual escolher
 *
 * Autenticação: header `x-cron-secret` ou query param `?secret=` igual a CRON_SECRET
 *
 * Limita a 80 emails por execução (Resend free tier = 100/dia).
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const FROM_EMAIL = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'
const SITE_URL = 'https://brasilconnectusa.com'
const MAX_PER_RUN = 80

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY ausente' })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars ausentes' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  const resend = new Resend(process.env.RESEND_API_KEY)

  // ── Buscar candidatos via view ──────────────────────────────
  const { data: candidates, error } = await supabase
    .from('bc_drip_candidates')
    .select('*')
    .not('next_step_due', 'is', null)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('Drip query error:', error.message)
    return res.status(500).json({ error: error.message })
  }

  if (!candidates || candidates.length === 0) {
    return res.status(200).json({ ok: true, processed: 0, message: 'Nenhum email pendente' })
  }

  let sent = 0
  let failed = 0
  const errors = []

  for (const c of candidates) {
    const step = c.next_step_due
    const tpl = TEMPLATES[step]
    if (!tpl) {
      errors.push({ email: c.email, error: `Step ${step} sem template` })
      continue
    }

    try {
      const { html, text, subject } = tpl({ email: c.email, city: c.city })
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: c.email,
        subject,
        html,
        text,
      })

      // Log no Supabase
      await supabase.from('bc_drip_log').insert({
        email: c.email,
        email_step: step,
        resend_id: result.data?.id || null,
        status: 'sent',
      })
      sent++
    } catch (e) {
      failed++
      errors.push({ email: c.email, step, error: e.message })
      // Loga falha no Supabase também
      await supabase.from('bc_drip_log').insert({
        email: c.email,
        email_step: step,
        status: 'failed',
        error_message: e.message?.slice(0, 200),
      })
    }
  }

  return res.status(200).json({
    ok: true,
    processed: candidates.length,
    sent,
    failed,
    errors: errors.slice(0, 10), // só primeiros 10 pra resposta não inflar
  })
}

// ────────────────────────────────────────────────────────────────────────
// Templates ── helpers compartilhados
// ────────────────────────────────────────────────────────────────────────
const COLORS = {
  paper:    '#FAF7F0',
  paperEl:  '#FFFFFF',
  paperSft: '#F1ECDF',
  green:    '#0F5132',
  greenDk:  '#073824',
  navy:     '#1B2845',
  gold:     '#B89968',
  goldDk:   '#8C6D3D',
  goldSft:  '#F5EFE0',
  ink:      '#1A1F1C',
  inkSoft:  '#4B4F4D',
  inkMuted: '#6B6E68',
  line:     '#E5E1D6',
}

function shellHtml({ kicker, title, bodyHtml, ctaUrl, ctaLabel, footerNote }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.ink};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLORS.paper};padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${COLORS.paperEl};border:1px solid ${COLORS.line};border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid ${COLORS.line};">
            <img src="https://brasilconnectusa.com/img/logo-mark.svg" alt="BrasilConnect" width="48" height="48" style="display:block;margin:0 auto;border:0;" />
            <div style="font-family:Georgia,serif;font-weight:700;font-size:18px;color:${COLORS.green};margin-top:10px;">Brasil <span style="color:${COLORS.navy};">Connect</span></div>
            <div style="font-size:9px;color:${COLORS.goldDk};letter-spacing:3px;font-weight:600;margin-top:1px;">USA</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 32px;">
            <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:${COLORS.goldDk};margin-bottom:12px;">${escapeHtml(kicker)}</div>
            <h1 style="margin:0 0 20px 0;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:${COLORS.ink};line-height:1.2;letter-spacing:-0.01em;">${escapeHtml(title)}</h1>
            ${bodyHtml}
            ${ctaUrl ? `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px 0;">
              <tr><td style="border-radius:10px;background:${COLORS.ink};">
                <a href="${ctaUrl}" style="display:inline-block;padding:13px 26px;color:${COLORS.paper};text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.01em;">${escapeHtml(ctaLabel || 'Ver mais')}</a>
              </td></tr>
            </table>` : ''}
            ${footerNote ? `<p style="margin:32px 0 0 0;font-size:13px;color:${COLORS.inkMuted};line-height:1.6;">${footerNote}</p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:${COLORS.greenDk};padding:24px 32px;text-align:center;color:${COLORS.paperSft};">
            <div style="font-size:13px;opacity:0.75;">Feito por brasileiros, para brasileiros</div>
            <div style="font-size:11px;opacity:0.5;margin-top:6px;">© 2026 BrasilConnect USA</div>
            <div style="font-size:11px;opacity:0.5;margin-top:8px;">Cancelar inscrição: responda este email com "remover"</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function block(p) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:${COLORS.inkSoft};line-height:1.65;">${p}</p>`
}

function callout(title, text) {
  return `<div style="background:${COLORS.goldSft};border-left:3px solid ${COLORS.gold};padding:14px 18px;border-radius:6px;margin:16px 0;">
    <div style="font-weight:600;color:${COLORS.goldDk};font-size:13px;margin-bottom:4px;">${title}</div>
    <div style="font-size:14px;color:${COLORS.inkSoft};line-height:1.55;">${text}</div>
  </div>`
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}

// ────────────────────────────────────────────────────────────────────────
// Templates dos 5 emails
// ────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  // Email 1 — boas-vindas (enviado pelo /api/waitlist na hora do cadastro)
  // Aqui é só fallback caso algum cron precise reenviar
  1: ({ city }) => ({
    subject: 'Você está na lista — BrasilConnect USA',
    html: shellHtml({
      kicker: 'CONFIRMADO',
      title: 'Você está na lista.',
      bodyHtml: [
        block('Obrigado por se cadastrar na lista de espera do <strong>BrasilConnect USA</strong>.'),
        block('Estamos construindo a plataforma completa para brasileiros nos EUA — remessas, câmbio, voos, negócios e comunidade — em um só lugar.'),
        city ? block(`Vimos que você mora em <strong>${escapeHtml(city)}</strong>. Vamos focar no conteúdo da sua cidade.`) : '',
        block('Nas próximas semanas, vamos enviar conteúdos úteis enquanto preparamos o lançamento.'),
      ].join(''),
      ctaUrl: `${SITE_URL}/custo-de-vida/`,
      ctaLabel: 'Ver custo de vida em 12 cidades',
    }),
    text: `Você está na lista do BrasilConnect USA. Acesse: ${SITE_URL}/custo-de-vida/`,
  }),

  // Email 2 — D+3 — 5 erros comuns
  2: ({ city }) => ({
    subject: '5 erros que brasileiros cometem no primeiro mês nos EUA',
    html: shellHtml({
      kicker: 'DIA 3 · ERROS COMUNS',
      title: '5 erros que custam caro nos primeiros 30 dias',
      bodyHtml: [
        block('Existe uma curva de aprendizado que praticamente todo brasileiro recém-chegado paga. A boa notícia: a maioria desses erros é evitável.'),
        block('<strong>1. Usar banco brasileiro para receber salário americano.</strong> A maioria dos bancos brasileiros não permite ou cobra absurdamente. Abra conta americana logo no primeiro mês — Mercury aceita pessoa jurídica em poucos dias mesmo sem SSN.'),
        block('<strong>2. Mandar dinheiro pra família via TED bancária.</strong> Bancos como Chase escondem 3-5% no spread cambial. Wise e Remitly cobram menos de 1% e o dinheiro chega em minutos.'),
        block('<strong>3. Achar que escola pública americana exige status migratório.</strong> Não exige. Plyler v. Doe (Suprema Corte 1982) garante educação a toda criança vivendo nos EUA, independente do status dos pais.'),
        block('<strong>4. Ignorar credit score nos primeiros meses.</strong> Sem credit score, financiar carro custa 18-25%/ano vs. 4-8% com bom histórico. Capital One Secured Card resolve em 6 meses.'),
        block('<strong>5. Demorar para tirar a Driver License americana.</strong> CNH brasileira só vale por 30-90 dias após chegada. Multar é caro e prejudica histórico.'),
        callout('Próximo email em 4 dias', 'Vamos falar sobre quanto você pode economizar usando o serviço de remessa certo — números reais comparando 5 alternativas.'),
      ].join(''),
      ctaUrl: `${SITE_URL}/guias/`,
      ctaLabel: 'Ver guias passo a passo',
    }),
    text: `5 erros comuns de brasileiros recém-chegados:\n1. Banco brasileiro para salário americano\n2. TED em vez de Wise/Remitly\n3. Achar que escola exige status\n4. Ignorar credit score\n5. Atrasar a Driver License\n\nGuias completos: ${SITE_URL}/guias/`,
  }),

  // Email 3 — D+7 — Remessas
  3: ({ city }) => ({
    subject: 'Quanto você economiza usando o serviço certo de remessa',
    html: shellHtml({
      kicker: 'DIA 7 · REMESSAS',
      title: 'Mandar $1.000 pro Brasil pode custar $20 ou $80',
      bodyHtml: [
        block('A diferença entre o serviço de remessa mais barato e o mais caro pode chegar a 6% do valor enviado. Em uma remessa mensal de $2.000, isso é $120 por mês — $1.440 por ano.'),
        block('<strong>Comparação real, $1.000 USD para o Brasil em 30/abr/2026:</strong>'),
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid ${COLORS.line};border-radius:8px;margin:14px 0;font-size:14px;">
          <tr style="background:${COLORS.paperSft};">
            <td style="padding:10px 14px;font-weight:600;color:${COLORS.ink};border-bottom:1px solid ${COLORS.line};">Serviço</td>
            <td style="padding:10px 14px;font-weight:600;color:${COLORS.ink};border-bottom:1px solid ${COLORS.line};text-align:right;">Recebido (R$)</td>
          </tr>
          <tr><td style="padding:10px 14px;color:${COLORS.inkSoft};">Wise</td><td style="padding:10px 14px;text-align:right;font-family:Georgia,serif;font-weight:700;color:${COLORS.ink};">R$ 5.012</td></tr>
          <tr><td style="padding:10px 14px;color:${COLORS.inkSoft};">Remitly (1ª grátis)</td><td style="padding:10px 14px;text-align:right;font-family:Georgia,serif;font-weight:700;color:${COLORS.ink};">R$ 4.987</td></tr>
          <tr><td style="padding:10px 14px;color:${COLORS.inkSoft};">PaySend</td><td style="padding:10px 14px;text-align:right;font-family:Georgia,serif;font-weight:700;color:${COLORS.ink};">R$ 4.945</td></tr>
          <tr><td style="padding:10px 14px;color:${COLORS.inkSoft};">MoneyGram</td><td style="padding:10px 14px;text-align:right;font-family:Georgia,serif;font-weight:700;color:${COLORS.ink};">R$ 4.870</td></tr>
          <tr><td style="padding:10px 14px;color:${COLORS.inkSoft};">Western Union</td><td style="padding:10px 14px;text-align:right;font-family:Georgia,serif;font-weight:700;color:${COLORS.ink};">R$ 4.840</td></tr>
          <tr><td style="padding:10px 14px;color:${COLORS.inkSoft};">Banco tradicional (TED)</td><td style="padding:10px 14px;text-align:right;font-family:Georgia,serif;font-weight:700;color:${COLORS.ink};">R$ 4.620</td></tr>
        </table>`,
        block('A diferença entre Wise e Banco tradicional: <strong>R$ 392</strong> em uma única remessa de $1.000.'),
        block('<strong>Dicas para economizar mais:</strong> (a) sempre compare antes de enviar — taxas mudam diariamente, (b) primeiras transferências costumam ter promoção (Remitly e PaySend grátis na primeira), (c) evite enviar valores muito pequenos — taxa fixa pesa mais.'),
        callout('Em breve', 'Em 7 dias você vai receber nosso guia gratuito completo de chegada nos EUA — todos os passos dos primeiros 90 dias em um documento.'),
      ].join(''),
      ctaUrl: `${SITE_URL}/?preview=brasil2026`,
      ctaLabel: 'Comparar remessas em tempo real',
    }),
    text: `Mandar $1.000 pode custar $20 ou $80 dependendo do serviço.\n\nWise: R$ 5.012\nRemitly: R$ 4.987\nMoneyGram: R$ 4.870\nWestern Union: R$ 4.840\nBanco TED: R$ 4.620\n\nDiferença: R$ 392 em uma única remessa.`,
  }),

  // Email 4 — D+14 — Lead magnet
  4: ({ city }) => ({
    subject: 'Seu guia completo de chegada nos EUA — gratuito',
    html: shellHtml({
      kicker: 'DIA 14 · GUIA GRATUITO',
      title: 'Os primeiros 90 dias nos EUA, em um só lugar',
      bodyHtml: [
        block('Como prometido, aqui está nosso <strong>Guia de Chegada nos EUA</strong> — checklist completo dos primeiros 90 dias, baseado nos erros e acertos de centenas de brasileiros que vieram antes de você.'),
        block('<strong>O que tem no guia:</strong>'),
        `<ul style="padding-left:20px;color:${COLORS.inkSoft};font-size:15px;line-height:1.85;">
          <li>Semana 1: documentação essencial (SSN, ITIN, ID estadual)</li>
          <li>Semana 2: conta bancária + cartão de crédito secured</li>
          <li>Semana 3: Driver License e seguro de carro</li>
          <li>Mês 1: matrícula escolar e plano de saúde</li>
          <li>Mês 2: construir credit score (estratégias práticas)</li>
          <li>Mês 3: consolidação financeira e planejamento de longo prazo</li>
          <li>Anexos: lista de documentos por estado, checklist de mudança, contatos úteis</li>
        </ul>`,
        block('Acesse pelo link abaixo. Imprima ou salve em PDF — é um material de referência que você vai consultar muitas vezes nos primeiros meses.'),
        callout('Próximo email em 7 dias', 'Vamos te ajudar a escolher entre as 12 cidades americanas com maior comunidade brasileira — comparando custo de vida, salário médio e qualidade de vida.'),
      ].join(''),
      ctaUrl: `${SITE_URL}/guia-chegada/`,
      ctaLabel: 'Acessar o guia completo →',
    }),
    text: `Como prometido, seu Guia de Chegada nos EUA está pronto.\n\nAcesse: ${SITE_URL}/guia-chegada/\n\nConteúdo: documentação, conta bancária, CNH, escola, saúde, credit score e planejamento dos primeiros 90 dias.`,
  }),

  // Email 5 — D+21 — Custo de vida
  5: ({ city }) => ({
    subject: city ? `Vale a pena morar em ${city}? Compare com 11 outras cidades` : 'Qual cidade dos EUA tem melhor custo-benefício para brasileiros?',
    html: shellHtml({
      kicker: 'DIA 21 · CUSTO DE VIDA',
      title: 'Onde morar como brasileiro nos EUA',
      bodyHtml: [
        block('Não existe resposta única, mas existem padrões claros. Comparamos 12 cidades com forte presença brasileira para ajudar você a decidir — ou validar se sua cidade atual é a melhor para o seu momento.'),
        block('<strong>Resumo das comparações:</strong>'),
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid ${COLORS.line};border-radius:8px;margin:14px 0;font-size:13px;">
          <tr style="background:${COLORS.paperSft};">
            <td style="padding:10px 12px;font-weight:600;color:${COLORS.ink};border-bottom:1px solid ${COLORS.line};">Cidade</td>
            <td style="padding:10px 12px;font-weight:600;color:${COLORS.ink};border-bottom:1px solid ${COLORS.line};text-align:right;">Família 4/mês</td>
            <td style="padding:10px 12px;font-weight:600;color:${COLORS.ink};border-bottom:1px solid ${COLORS.line};text-align:right;">Salário/ano</td>
          </tr>
          <tr><td style="padding:8px 12px;color:${COLORS.inkSoft};">Houston, TX</td><td style="padding:8px 12px;text-align:right;font-family:Georgia,serif;font-weight:600;">$6.000</td><td style="padding:8px 12px;text-align:right;color:${COLORS.inkMuted};">$71.000</td></tr>
          <tr><td style="padding:8px 12px;color:${COLORS.inkSoft};">Atlanta, GA</td><td style="padding:8px 12px;text-align:right;font-family:Georgia,serif;font-weight:600;">$6.300</td><td style="padding:8px 12px;text-align:right;color:${COLORS.inkMuted};">$72.000</td></tr>
          <tr><td style="padding:8px 12px;color:${COLORS.inkSoft};">Orlando, FL</td><td style="padding:8px 12px;text-align:right;font-family:Georgia,serif;font-weight:600;">$6.300</td><td style="padding:8px 12px;text-align:right;color:${COLORS.inkMuted};">$58.000</td></tr>
          <tr><td style="padding:8px 12px;color:${COLORS.inkSoft};">Miami, FL</td><td style="padding:8px 12px;text-align:right;font-family:Georgia,serif;font-weight:600;">$7.400</td><td style="padding:8px 12px;text-align:right;color:${COLORS.inkMuted};">$65.000</td></tr>
          <tr><td style="padding:8px 12px;color:${COLORS.inkSoft};">Boston, MA</td><td style="padding:8px 12px;text-align:right;font-family:Georgia,serif;font-weight:600;">$8.000</td><td style="padding:8px 12px;text-align:right;color:${COLORS.inkMuted};">$89.000</td></tr>
          <tr><td style="padding:8px 12px;color:${COLORS.inkSoft};">New York, NY</td><td style="padding:8px 12px;text-align:right;font-family:Georgia,serif;font-weight:600;">$10.500</td><td style="padding:8px 12px;text-align:right;color:${COLORS.inkMuted};">$95.000</td></tr>
        </table>`,
        block('<strong>Padrões que descobrimos:</strong> (a) Texas e Geórgia têm o melhor custo-benefício para profissões qualificadas, (b) Flórida compensa parcialmente o custo alto pela ausência de income tax estadual, (c) Boston e NY só fazem sentido com salário ≥ $100k em finanças, tech ou saúde.'),
        callout('Foi nosso último email programado', 'Você não vai mais receber emails até nosso lançamento oficial — provavelmente no segundo semestre de 2026. Se quiser dar feedback ou pedir um conteúdo específico, é só responder este email.'),
      ].join(''),
      ctaUrl: `${SITE_URL}/custo-de-vida/`,
      ctaLabel: 'Comparativo completo das 12 cidades',
    }),
    text: `Comparativo de custo de vida em 6 cidades brasileiras top:\nHouston: $6k/mês família · $71k/ano\nAtlanta: $6.3k · $72k\nOrlando: $6.3k · $58k\nMiami: $7.4k · $65k\nBoston: $8k · $89k\nNY: $10.5k · $95k\n\nVer todas: ${SITE_URL}/custo-de-vida/`,
  }),
}
