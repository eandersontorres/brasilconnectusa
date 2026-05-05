/**
 * POST /api/waitlist
 *
 * Captura email para lista de espera. Envia email de boas-vindas via Resend,
 * cria código de indicação automaticamente e linka cookie de referral se houver.
 *
 * Body: { email, city?, source?, referralCode? }
 */

import { createClient } from '@supabase/supabase-js'
import { rateLimit } from './_lib/rateLimit.js'
import { Resend } from 'resend'

const FROM_EMAIL = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const _rl = rateLimit(req, { windowMs: 60000, max: 5 })
  if (_rl) return res.status(429).json({ error: 'Muitas requisicoes. Tenta de novo em ' + _rl.retryAfter + 's.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, city, source, referralCode } = req.body || {}

  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ error: 'Email inválido' })
  }

  const cleanEmail  = email.trim().toLowerCase()
  const cleanCity   = (city || '').trim().slice(0, 80) || null
  const cleanSource = (source || 'unknown').trim().slice(0, 40)

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
  const userAgent = req.headers['user-agent'] || null
  const referer = req.headers['referer'] || null

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Configuração ausente' })
  }

  let isNewSignup = false
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const { data: existing } = await supabase
      .from('bc_waitlist').select('id').eq('email', cleanEmail).maybeSingle()
    isNewSignup = !existing

    const { error } = await supabase.from('bc_waitlist').upsert({
      email: cleanEmail, city: cleanCity, source: cleanSource,
      ip_address: ip, user_agent: userAgent, referer,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' })

    if (error) {
      console.error('Waitlist insert error:', error.message)
      return res.status(500).json({ error: 'Erro ao salvar' })
    }

    // ── Garante código de referral para este email ───────────
    try {
      await supabase.rpc('bc_ensure_referral_code', { p_email: cleanEmail })
    } catch (e) { console.error('Referral code create error:', e.message) }

    // ── Linka indicação se foi indicado por alguém ───────────
    const refCode = parseRefFromCookie(req.headers.cookie) || (referralCode || '').trim().toUpperCase()
    if (isNewSignup && /^BRA-[A-Z0-9]{5}$/.test(refCode)) {
      try {
        const { data: existingClick } = await supabase
          .from('bc_referral_uses')
          .select('id')
          .eq('code', refCode)
          .eq('ip_address', ip)
          .eq('status', 'click')
          .order('clicked_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existingClick) {
          await supabase.from('bc_referral_uses').update({
            visitor_email: cleanEmail,
            status: 'signup',
            signed_up_at: new Date().toISOString(),
          }).eq('id', existingClick.id)
        } else {
          await supabase.from('bc_referral_uses').insert({
            code: refCode,
            visitor_email: cleanEmail,
            ip_address: ip,
            user_agent: userAgent,
            status: 'signup',
            signed_up_at: new Date().toISOString(),
          })
        }
      } catch (e) { console.error('Referral signup link error:', e.message) }
    }
  } catch (e) {
    console.error('Waitlist DB error:', e.message)
    return res.status(500).json({ error: 'Erro interno' })
  }

  // ── Envia email de boas-vindas + loga no drip ─────────────
  if (isNewSignup && process.env.RESEND_API_KEY) {
    sendWelcomeEmail(cleanEmail, cleanCity)
      .then(async (result) => {
        try {
          const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
          await supabase.from('bc_drip_log').insert({
            email: cleanEmail,
            email_step: 1,
            resend_id: result?.data?.id || null,
            status: 'sent',
          })
        } catch (e) { console.error('Drip log insert error:', e.message) }
      })
      .catch(err => console.error('Resend error:', err.message))
  }

  return res.status(200).json({ ok: true, isNew: isNewSignup })
}

// ───────────────────────────────────────────────────────────────────────
// Email de boas-vindas — paleta premium + bloco de indicação
// ───────────────────────────────────────────────────────────────────────
async function sendWelcomeEmail(toEmail, city) {
  const resend = new Resend(process.env.RESEND_API_KEY)

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BrasilConnect USA — Você está na lista</title>
</head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1F1C;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FAF7F0;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E5E1D6;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:40px 32px 32px;text-align:center;border-bottom:1px solid #E5E1D6;">
            <img src="https://brasilconnectusa.com/img/logo-mark.svg" alt="BrasilConnect" width="56" height="56" style="display:block;margin:0 auto;border:0;" />
            <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:22px;color:#0F5132;margin-top:14px;letter-spacing:-0.01em;">Brasil <span style="color:#1B2845;">Connect</span></div>
            <div style="font-size:10px;color:#8C6D3D;letter-spacing:3px;font-weight:600;margin-top:2px;">USA</div>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 36px;">
            <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:#8C6D3D;margin-bottom:12px;">CONFIRMADO</div>
            <h1 style="margin:0 0 20px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#1A1F1C;line-height:1.2;letter-spacing:-0.01em;">Você está na lista.</h1>
            <p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">
              Obrigado por se cadastrar na lista de espera do <strong style="color:#1A1F1C;">BrasilConnect USA</strong>.
            </p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">
              Estamos construindo a plataforma completa para brasileiros nos EUA — remessas, câmbio, voos, negócios e comunidade — em um só lugar.
            </p>
            ${city ? `<p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">Vimos que você mora em <strong style="color:#1A1F1C;">${escapeHtml(city)}</strong>. Vamos focar bastante no conteúdo da sua cidade.</p>` : ''}
            <p style="margin:0 0 28px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">
              Assim que lançarmos, você está entre os primeiros a saber.
            </p>

            <!-- Programa de Indicação -->
            <div style="background:#F5EFE0;border:1px solid #B89968;border-radius:12px;padding:22px;margin-bottom:18px;">
              <div style="text-transform:uppercase;letter-spacing:0.16em;font-size:10px;font-weight:600;color:#8C6D3D;margin-bottom:6px;">PROGRAMA DE INDICAÇÃO</div>
              <div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#1A1F1C;margin-bottom:8px;">Indique 3 brasileiros, ganhe US$ 10 em Amazon</div>
              <div style="font-size:13px;color:#4B4F4D;line-height:1.55;margin-bottom:14px;">
                Cada pessoa que clicar no seu link e usar um dos parceiros recomendados (Mercury, Lemonade, Mint, MyUS, ZenBusiness ou Capital One) conta como qualificada. 3 = US$ 10 de gift card no seu email.
              </div>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr><td style="border-radius:10px;background:#1A1F1C;">
                  <a href="https://brasilconnectusa.com/indique/?email=${encodeURIComponent(toEmail)}" style="display:inline-block;padding:11px 22px;color:#FAF7F0;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.01em;">Pegar meu link de indicação →</a>
                </td></tr>
              </table>
            </div>

            <!-- Conteúdo já disponível -->
            <div style="margin-top:24px;padding-top:24px;border-top:1px solid #E5E1D6;">
              <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:#8C6D3D;margin-bottom:14px;">JÁ DISPONÍVEL</div>
              <a href="https://brasilconnectusa.com/custo-de-vida/" style="display:block;padding:18px;background:#FAF7F0;border:1px solid #E5E1D6;border-radius:10px;text-decoration:none;margin-bottom:10px;">
                <div style="font-family:Georgia,serif;font-weight:600;color:#1A1F1C;font-size:16px;margin-bottom:3px;">Custo de vida em 12 cidades</div>
                <div style="font-size:13px;color:#6B6E68;">Austin, Miami, Boston, NY e mais — comparativo completo</div>
              </a>
              <a href="https://brasilconnectusa.com/guia-chegada/" style="display:block;padding:18px;background:#FAF7F0;border:1px solid #E5E1D6;border-radius:10px;text-decoration:none;margin-bottom:10px;">
                <div style="font-family:Georgia,serif;font-weight:600;color:#1A1F1C;font-size:16px;margin-bottom:3px;">Guia de chegada — primeiros 90 dias</div>
                <div style="font-size:13px;color:#6B6E68;">Checklist completo do que fazer em qual ordem</div>
              </a>
              <a href="https://brasilconnectusa.com/guias/" style="display:block;padding:18px;background:#FAF7F0;border:1px solid #E5E1D6;border-radius:10px;text-decoration:none;">
                <div style="font-family:Georgia,serif;font-weight:600;color:#1A1F1C;font-size:16px;margin-bottom:3px;">Guias passo a passo</div>
                <div style="font-size:13px;color:#6B6E68;">CNH, conta bancária, ITIN, plano de saúde, abrir LLC</div>
              </a>
            </div>

            <p style="margin:32px 0 0 0;font-size:13px;color:#8C8E89;line-height:1.6;">
              Você não vai receber spam. As próximas mensagens trazem conteúdos úteis enquanto preparamos o lançamento.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#073824;padding:28px 36px;text-align:center;color:#F1ECDF;">
            <div style="font-size:13px;opacity:0.75;">Feito por brasileiros, para brasileiros</div>
            <div style="font-size:11px;opacity:0.5;margin-top:6px;">© 2026 BrasilConnect USA</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    'Você está na lista.',
    '',
    'Obrigado por se cadastrar na lista de espera do BrasilConnect USA.',
    'Estamos construindo a plataforma completa para brasileiros nos EUA — em um só lugar.',
    city ? `Vimos que você mora em ${city}. Vamos focar bastante no conteúdo da sua cidade.` : '',
    '',
    'PROGRAMA DE INDICAÇÃO: indique 3 brasileiros e ganhe US$ 10 em Amazon Gift Card.',
    `Pegue seu link: https://brasilconnectusa.com/indique/?email=${encodeURIComponent(toEmail)}`,
    '',
    'Já disponível:',
    '· Custo de vida em 12 cidades: https://brasilconnectusa.com/custo-de-vida/',
    '· Guia de chegada (90 dias): https://brasilconnectusa.com/guia-chegada/',
    '· Guias passo a passo: https://brasilconnectusa.com/guias/',
    '',
    '— BrasilConnect USA',
  ].filter(Boolean).join('\n')

  return await resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: 'Você está na lista — BrasilConnect USA',
    html,
    text,
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}

function parseRefFromCookie(cookieHeader) {
  if (!cookieHeader) return null
  const match = String(cookieHeader).match(/bc_ref=([A-Z0-9-]+)/i)
  return match ? match[1].toUpperCase() : null
}
