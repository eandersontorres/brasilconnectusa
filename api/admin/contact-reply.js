/**
 * POST /api/admin/contact-reply
 *
 * Admin responde uma mensagem do Fale Conosco.
 * Envia email HTML branded via Resend FROM oi@brasilconnectusa.com
 * + atualiza bc_contact_messages com status='replied' + reply_notes + replied_at.
 *
 * Body: { message_id, reply_text, subject? }
 * Headers: x-admin-secret
 */

import { createClient } from '@supabase/supabase-js'

const REPLY_FROM = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Embrulha o texto da resposta no template HTML branded (mesmo visual
 * do magic link — header + corpo + footer com paleta BrasilConnect).
 * Quebras de linha (\n) viram <br/> pra preservar formatacao do textarea.
 */
function buildReplyHtml({ recipientName, replyText, originalMessage }) {
  const safeName  = escapeHtml(recipientName || 'amigo(a)')
  const safeReply = escapeHtml(replyText).replace(/\n/g, '<br/>')
  const safeOrig  = escapeHtml(originalMessage || '').replace(/\n/g, '<br/>')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BrasilConnect USA</title>
</head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1F1C;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FAF7F0;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E5E1D6;border-radius:16px;overflow:hidden;">

        <!-- Header com logo -->
        <tr>
          <td style="padding:40px 32px 28px;text-align:center;border-bottom:1px solid #E5E1D6;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:24px;color:#001a5e;letter-spacing:-0.01em;">
              Brasil<span style="color:#FFD700;">Connect</span>
            </div>
            <div style="font-size:10px;color:#009C3B;letter-spacing:3px;font-weight:600;margin-top:4px;">USA</div>
          </td>
        </tr>

        <!-- Corpo -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:#009C3B;margin-bottom:14px;">
              RESPOSTA DA NOSSA EQUIPE
            </div>

            <h1 style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1A1F1C;line-height:1.25;letter-spacing:-0.01em;">
              Olá, ${safeName}!
            </h1>

            <div style="margin:0 0 24px 0;font-size:15px;color:#4B4F4D;line-height:1.7;">
              ${safeReply}
            </div>

            ${originalMessage ? `
            <div style="margin-top:28px;padding-top:18px;border-top:1px dashed #E5E1D6;">
              <div style="font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
                Sua mensagem original
              </div>
              <div style="font-size:13px;color:#6B6E68;line-height:1.6;background:#FAF7F0;border-left:3px solid #E5E1D6;padding:10px 14px;border-radius:4px;font-style:italic;">
                ${safeOrig}
              </div>
            </div>
            ` : ''}

            <div style="margin-top:28px;padding-top:18px;border-top:1px solid #E5E1D6;font-size:13px;color:#6B6E68;line-height:1.6;">
              Pra continuar a conversa, é só responder este email — chega direto na gente.
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#073824;padding:24px 36px;text-align:center;color:#F1ECDF;">
            <div style="font-size:13px;opacity:0.85;">— Equipe BrasilConnect USA</div>
            <div style="font-size:11px;opacity:0.55;margin-top:8px;">
              <a href="https://brasilconnectusa.com" style="color:#F1ECDF;text-decoration:underline;opacity:0.75;">brasilconnectusa.com</a>
              ·
              <a href="https://brasilconnectusa.com/privacidade" style="color:#F1ECDF;text-decoration:underline;opacity:0.75;">Privacidade</a>
            </div>
            <div style="font-size:10px;opacity:0.4;margin-top:10px;">© ${new Date().getFullYear()} BrasilConnect USA</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildReplyText({ recipientName, replyText }) {
  // Versao plain text pra clients que nao renderizam HTML
  return `Olá, ${recipientName || 'amigo(a)'}!

${replyText}

— Equipe BrasilConnect USA
https://brasilconnectusa.com`
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth
  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Resend obrigatorio
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY nao configurado no Vercel' })
  }

  const { message_id, reply_text, subject } = req.body || {}
  if (!message_id || !reply_text) {
    return res.status(400).json({ error: 'message_id e reply_text sao obrigatorios' })
  }
  if (String(reply_text).trim().length < 5) {
    return res.status(400).json({ error: 'Resposta muito curta' })
  }
  if (String(reply_text).length > 10000) {
    return res.status(400).json({ error: 'Resposta muito longa (max 10000 chars)' })
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    // Busca mensagem original
    const { data: msg, error: getErr } = await supabase
      .from('bc_contact_messages')
      .select('id, name, email, reason, message, status')
      .eq('id', message_id)
      .single()
    if (getErr || !msg) return res.status(404).json({ error: 'Mensagem nao encontrada' })

    // Monta email
    const replyText = String(reply_text).trim()
    const finalSubject = (subject && String(subject).trim()) || `Re: BrasilConnect (${msg.reason})`
    const html = buildReplyHtml({
      recipientName: msg.name,
      replyText,
      originalMessage: msg.message,
    })
    const text = buildReplyText({ recipientName: msg.name, replyText })

    // Envia via Resend
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    const sendResult = await resend.emails.send({
      from:    REPLY_FROM,
      to:      [msg.email],
      replyTo: 'oi@brasilconnectusa.com',
      subject: finalSubject,
      html,
      text,
    })

    if (sendResult.error) {
      throw new Error('Resend: ' + (sendResult.error.message || JSON.stringify(sendResult.error)))
    }

    // Atualiza status no banco
    await supabase
      .from('bc_contact_messages')
      .update({
        status:      'replied',
        reply_notes: replyText,
        replied_at:  new Date().toISOString(),
      })
      .eq('id', message_id)

    return res.status(200).json({
      success: true,
      message_id: msg.id,
      sent_to: msg.email,
      resend_id: sendResult.data?.id || null,
    })
  } catch (e) {
    console.error('contact-reply error:', e.message)
    return res.status(500).json({ error: 'Erro ao enviar resposta: ' + e.message })
  }
}
