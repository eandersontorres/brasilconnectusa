/**
 * Helper compartilhado de captura de lead.
 *
 * Centraliza:
 *   1. Upsert em bc_waitlist (com source/city/UTM)
 *   2. RPC bc_ensure_referral_code (gera código de indicação)
 *   3. Envia email de boas-vindas via Resend (se RESEND_API_KEY estiver setada)
 *   4. Log em bc_drip_log (step 1) — pra cron de drip não reenviar
 *
 * Usado por: /api/waitlist e /api/bolao (create-group, join).
 *
 * Não bloqueia: erros são logados mas não propagam — captura de lead é
 * complementar ao fluxo principal (criar grupo, etc).
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const FROM_EMAIL = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'

/**
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.city]   - cidade ou estado (ex: "Austin" ou "TX")
 * @param {string} [params.source] - origem do lead (ex: 'bolao_create', 'bolao_join', 'waitlist_hero')
 * @param {string} [params.ip]
 * @param {string} [params.userAgent]
 * @param {string} [params.referer]
 * @param {Object} [params.supabase] - client opcional (se já tem um, reaproveita)
 * @returns {Promise<{ ok: boolean, isNew: boolean }>}
 */
export async function captureLead({ email, city, source, ip, userAgent, referer, supabase }) {
  if (!email || !email.includes('@')) return { ok: false, isNew: false }

  const cleanEmail  = String(email).trim().toLowerCase()
  const cleanCity   = (city || '').trim().slice(0, 80) || null
  const cleanSource = (source || 'unknown').trim().slice(0, 40)

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { ok: false, isNew: false }
  }

  const sb = supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )

  let isNew = false
  try {
    const { data: existing } = await sb
      .from('bc_waitlist').select('id').eq('email', cleanEmail).maybeSingle()
    isNew = !existing

    const { error } = await sb.from('bc_waitlist').upsert({
      email: cleanEmail,
      city: cleanCity,
      source: cleanSource,
      ip_address: ip || null,
      user_agent: userAgent || null,
      referer: referer || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' })
    if (error) console.error('[captureLead] waitlist upsert:', error.message)

    try { await sb.rpc('bc_ensure_referral_code', { p_email: cleanEmail }) }
    catch (e) { console.error('[captureLead] referral code:', e.message) }
  } catch (e) {
    console.error('[captureLead] db:', e.message)
    return { ok: false, isNew: false }
  }

  // Email de boas-vindas — fire-and-forget, só pra novos
  if (isNew && process.env.RESEND_API_KEY) {
    sendWelcomeEmail(cleanEmail, cleanCity, cleanSource)
      .then(async (result) => {
        try {
          await sb.from('bc_drip_log').insert({
            email: cleanEmail,
            email_step: 1,
            resend_id: result?.data?.id || null,
            status: 'sent',
          })
        } catch (e) { console.error('[captureLead] drip log:', e.message) }
      })
      .catch(err => console.error('[captureLead] resend:', err.message))
  }

  return { ok: true, isNew }
}

// ───────────────────────────────────────────────────────────────────────
// Email de boas-vindas — varia o título/CTA conforme source
// ───────────────────────────────────────────────────────────────────────
async function sendWelcomeEmail(toEmail, city, source) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const isBolao = source && source.startsWith('bolao_')

  const heroTitle = isBolao
    ? 'Bora pro Bolão da Copa!'
    : 'Você está na lista.'
  const heroSub = isBolao
    ? 'Você entrou no Bolão Copa 2026 — o maior bolão da comunidade brasileira nos EUA.'
    : 'Obrigado por se cadastrar na lista de espera do BrasilConnect USA.'
  const ctaPrimary = isBolao
    ? { url: 'https://brasilconnectusa.com/app/bolao', label: 'Voltar pro Bolão →' }
    : { url: 'https://brasilconnectusa.com/', label: 'Conhecer o BrasilConnect →' }
  const subjectLine = isBolao
    ? 'Bora pro Bolão Copa 2026 — BrasilConnect USA'
    : 'Você está na lista — BrasilConnect USA'

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${heroTitle}</title></head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1F1C;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FAF7F0;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E5E1D6;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:40px 32px 32px;text-align:center;border-bottom:1px solid #E5E1D6;">
          <img src="https://brasilconnectusa.com/img/logo-mark.svg" alt="BrasilConnect" width="56" height="56" style="display:block;margin:0 auto;border:0;" />
          <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:22px;color:#0F5132;margin-top:14px;letter-spacing:-0.01em;">Brasil <span style="color:#1B2845;">Connect</span></div>
          <div style="font-size:10px;color:#8C6D3D;letter-spacing:3px;font-weight:600;margin-top:2px;">USA</div>
        </td></tr>
        <tr><td style="padding:40px 36px;">
          <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:#8C6D3D;margin-bottom:12px;">${isBolao ? 'BOLÃO COPA 2026' : 'CONFIRMADO'}</div>
          <h1 style="margin:0 0 20px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#1A1F1C;line-height:1.2;letter-spacing:-0.01em;">${heroTitle}</h1>
          <p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">${heroSub}</p>
          ${city ? `<p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">Vimos que você está em <strong style="color:#1A1F1C;">${escapeHtml(city)}</strong>. Vamos focar bastante no conteúdo da sua região.</p>` : ''}
          <p style="margin:0 0 28px 0;font-size:15px;color:#4B4F4D;line-height:1.65;">${isBolao ? 'O Brasil joga primeiro dia <strong>13/jun</strong>. Faça seus palpites e dispute o ranking estadual e nacional.' : 'Estamos construindo a plataforma completa para brasileiros nos EUA — remessas, câmbio, voos, negócios e comunidade — em um só lugar.'}</p>

          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;">
            <tr><td style="border-radius:10px;background:#009c3b;">
              <a href="${ctaPrimary.url}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.01em;">${ctaPrimary.label}</a>
            </td></tr>
          </table>

          <div style="background:#F5EFE0;border:1px solid #B89968;border-radius:12px;padding:22px;margin-bottom:18px;">
            <div style="text-transform:uppercase;letter-spacing:0.16em;font-size:10px;font-weight:600;color:#8C6D3D;margin-bottom:6px;">PROGRAMA DE INDICAÇÃO</div>
            <div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#1A1F1C;margin-bottom:8px;">Indique 3 brasileiros, ganhe US$ 10 em Amazon</div>
            <div style="font-size:13px;color:#4B4F4D;line-height:1.55;margin-bottom:14px;">Cada pessoa que clicar no seu link e usar um dos parceiros recomendados conta como qualificada. 3 = US$ 10 de gift card no seu email.</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr><td style="border-radius:10px;background:#1A1F1C;">
                <a href="https://brasilconnectusa.com/indique/?email=${encodeURIComponent(toEmail)}" style="display:inline-block;padding:11px 22px;color:#FAF7F0;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.01em;">Pegar meu link de indicação →</a>
              </td></tr>
            </table>
          </div>

          <div style="margin-top:24px;padding-top:24px;border-top:1px solid #E5E1D6;">
            <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:#8C6D3D;margin-bottom:14px;">EXPLORE TAMBÉM</div>
            <a href="https://brasilconnectusa.com/app/remessas" style="display:block;padding:18px;background:#FAF7F0;border:1px solid #E5E1D6;border-radius:10px;text-decoration:none;margin-bottom:10px;">
              <div style="font-family:Georgia,serif;font-weight:600;color:#1A1F1C;font-size:16px;margin-bottom:3px;">Comparador de remessas — ao vivo</div>
              <div style="font-size:13px;color:#6B6E68;">Wise, Remitly, Western Union — quem entrega mais BRL agora</div>
            </a>
            <a href="https://brasilconnectusa.com/app/voos" style="display:block;padding:18px;background:#FAF7F0;border:1px solid #E5E1D6;border-radius:10px;text-decoration:none;margin-bottom:10px;">
              <div style="font-family:Georgia,serif;font-weight:600;color:#1A1F1C;font-size:16px;margin-bottom:3px;">Voos pra Copa</div>
              <div style="font-size:13px;color:#6B6E68;">Skyscanner, KAYAK e Expedia — melhor preço EUA → Brasil</div>
            </a>
            <a href="https://brasilconnectusa.com/guia-chegada/" style="display:block;padding:18px;background:#FAF7F0;border:1px solid #E5E1D6;border-radius:10px;text-decoration:none;">
              <div style="font-family:Georgia,serif;font-weight:600;color:#1A1F1C;font-size:16px;margin-bottom:3px;">Guia de chegada — primeiros 90 dias</div>
              <div style="font-size:13px;color:#6B6E68;">Checklist completo do que fazer em qual ordem</div>
            </a>
          </div>

          <p style="margin:32px 0 0 0;font-size:13px;color:#8C8E89;line-height:1.6;">Você não vai receber spam. As próximas mensagens trazem conteúdos úteis ${isBolao ? 'e atualizações do Bolão.' : 'enquanto preparamos o lançamento.'}</p>
        </td></tr>
        <tr><td style="background:#073824;padding:28px 36px;text-align:center;color:#F1ECDF;">
          <div style="font-size:13px;opacity:0.75;">Feito por brasileiros, para brasileiros</div>
          <div style="font-size:11px;opacity:0.5;margin-top:6px;">© 2026 BrasilConnect USA</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    heroTitle,
    '',
    heroSub,
    city ? `Vimos que você está em ${city}.` : '',
    '',
    isBolao ? 'O Brasil joga primeiro dia 13/jun. Faça seus palpites e dispute o ranking estadual e nacional.' : 'Estamos construindo a plataforma completa para brasileiros nos EUA — em um só lugar.',
    '',
    `${ctaPrimary.label}: ${ctaPrimary.url}`,
    '',
    'PROGRAMA DE INDICAÇÃO: indique 3 brasileiros e ganhe US$ 10 em Amazon Gift Card.',
    `Pegue seu link: https://brasilconnectusa.com/indique/?email=${encodeURIComponent(toEmail)}`,
    '',
    'Explore também:',
    '· Comparador de remessas: https://brasilconnectusa.com/app/remessas',
    '· Voos pra Copa: https://brasilconnectusa.com/app/voos',
    '· Guia de chegada (90 dias): https://brasilconnectusa.com/guia-chegada/',
    '',
    '— BrasilConnect USA',
  ].filter(Boolean).join('\n')

  return await resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: subjectLine,
    html,
    text,
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}
