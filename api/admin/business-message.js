/**
 * POST /api/admin/business-message
 *
 * Admin manda mensagem livre pro dono de um negocio (pendente ou aprovado).
 * Usa template HTML branded e envia via Resend FROM oi@brasilconnectusa.com.
 *
 * Body: { business_id, message, subject? }
 * Headers: x-admin-secret
 *
 * Diferente de business-action.js (que faz approve/reject + email automatico),
 * este e pra perguntas/pedidos ad-hoc antes de decidir aprovar (ex: pedir
 * comprovante, confirmar telefone, pedir foto).
 */

import { createClient } from '@supabase/supabase-js'

const REPLY_FROM = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildHtml({ businessName, ownerName, message }) {
  const safeMsg  = escapeHtml(message).replace(/\n/g, '<br/>')
  const safeName = escapeHtml(ownerName || businessName || 'amigo(a)')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1F1C;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FAF7F0;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E5E1D6;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:40px 32px 28px;text-align:center;border-bottom:1px solid #E5E1D6;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:24px;color:#001a5e;letter-spacing:-0.01em;">
              Brasil<span style="color:#FFD700;">Connect</span>
            </div>
            <div style="font-size:10px;color:#009C3B;letter-spacing:3px;font-weight:600;margin-top:4px;">USA</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;">
            <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:#009C3B;margin-bottom:14px;">
              SOBRE SEU CADASTRO
            </div>
            <h1 style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1A1F1C;line-height:1.25;letter-spacing:-0.01em;">
              Olá, ${safeName}!
            </h1>
            <div style="margin:0 0 24px 0;font-size:15px;color:#4B4F4D;line-height:1.7;">
              ${safeMsg}
            </div>
            <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E1D6;font-size:13px;color:#6B6E68;line-height:1.6;">
              Pra responder, é só dar reply neste email — chega direto na gente.
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#073824;padding:24px 36px;text-align:center;color:#F1ECDF;">
            <div style="font-size:13px;opacity:0.85;">— Equipe BrasilConnect USA</div>
            <div style="font-size:11px;opacity:0.55;margin-top:8px;">
              <a href="https://brasilconnectusa.com" style="color:#F1ECDF;text-decoration:underline;opacity:0.75;">brasilconnectusa.com</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY nao configurado no Vercel' })
  }

  const { business_id, message, subject } = req.body || {}
  if (!business_id || !message) {
    return res.status(400).json({ error: 'business_id e message obrigatorios' })
  }
  const msg = String(message).trim()
  if (msg.length < 5)     return res.status(400).json({ error: 'Mensagem muito curta' })
  if (msg.length > 10000) return res.status(400).json({ error: 'Mensagem muito longa (max 10000 chars)' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const { data: biz, error: getErr } = await supabase
      .from('bc_businesses')
      .select('id, name, slug, submitted_email, owner_email, status')
      .eq('id', business_id)
      .single()

    if (getErr || !biz) return res.status(404).json({ error: 'Negocio nao encontrado' })

    const recipient = biz.owner_email || biz.submitted_email
    if (!recipient) return res.status(400).json({ error: 'Negocio sem email cadastrado' })

    const finalSubject = (subject && String(subject).trim()) || `Sobre o cadastro de ${biz.name} no BrasilConnect`

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    const result = await resend.emails.send({
      from:    REPLY_FROM,
      to:      [recipient],
      replyTo: 'oi@brasilconnectusa.com',
      subject: finalSubject,
      html:    buildHtml({ businessName: biz.name, ownerName: null, message: msg }),
      text:    `Olá!\n\n${msg}\n\n— Equipe BrasilConnect USA`,
    })

    if (result.error) throw new Error('Resend: ' + (result.error.message || JSON.stringify(result.error)))

    return res.status(200).json({
      success: true,
      sent_to: recipient,
      resend_id: result.data?.id || null,
    })
  } catch (e) {
    console.error('business-message error:', e.message)
    return res.status(500).json({ error: 'Erro ao enviar: ' + e.message })
  }
}
