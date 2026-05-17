/**
 * POST /api/admin/business-action
 *
 * Admin aprova ou rejeita um negocio pendente em bc_businesses.
 * Manda email automatico pro dono via Resend com template HTML branded.
 *
 * Body: { business_id, action, reason? }
 *   action: 'approve' | 'reject' | 'archive'
 *   reason: opcional (usado no email de rejeicao)
 *
 * Headers: x-admin-secret
 *
 * Resposta: { success, business: {...}, email_sent }
 */

import { createClient } from '@supabase/supabase-js'

const VALID_ACTIONS = new Set(['approve', 'reject', 'archive'])
const REPLY_FROM = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Template HTML branded — mesma paleta do magic link / contact-reply.
 * Variantes por action: 'approve' (verde) vs 'reject' (gold/aviso).
 */
function buildBusinessEmail({ action, businessName, reason, slug }) {
  const isApprove = action === 'approve'
  const eyebrow   = isApprove ? 'CADASTRO APROVADO' : 'CADASTRO NAO ACEITO'
  const eyebrowColor = isApprove ? '#009C3B' : '#92400E'
  const title     = isApprove ? 'Bem-vindo ao BrasilConnect! 🎉' : 'Seu cadastro precisa de ajustes'

  const bodyApprove = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.7;">
      Boas notícias! Seu negócio <strong style="color:#1A1F1C;">${escapeHtml(businessName)}</strong> foi aprovado e já está visível no diretório de negócios brasileiros nos EUA.
    </p>
    <div style="margin:18px 0 22px;background:#F0FDF4;border:2px solid #86EFAC;border-radius:12px;padding:16px;">
      <div style="font-size:11px;color:#166534;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:8px;">
        ✓ Próximos passos
      </div>
      <ol style="margin:0;padding-left:18px;font-size:13.5px;color:#14532D;line-height:1.7;">
        <li>Acesse seu painel em <strong>brasilconnectusa.com/assinante</strong> com este email pra editar fotos, horários e descrição</li>
        <li>Adicione cardápio (se for restaurante) ou portfolio (se for serviço)</li>
        <li>Compartilhe seu perfil pra trazer mais clientes</li>
      </ol>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 22px;">
      <tr>
        <td style="border-radius:12px;background:#009c3b;">
          <a href="https://brasilconnectusa.com/assinante" target="_blank"
            style="display:inline-block;padding:14px 32px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;">
            Acessar meu painel →
          </a>
        </td>
      </tr>
    </table>
  `

  const bodyReject = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#4B4F4D;line-height:1.7;">
      Recebemos seu cadastro pra <strong style="color:#1A1F1C;">${escapeHtml(businessName)}</strong>, mas não conseguimos aprovar dessa vez.
    </p>
    ${reason ? `
    <div style="margin:18px 0 22px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:14px;">
      <div style="font-size:11px;color:#92400E;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:6px;">
        Motivo
      </div>
      <div style="font-size:14px;color:#78350F;line-height:1.6;">
        ${escapeHtml(reason).replace(/\n/g, '<br/>')}
      </div>
    </div>
    ` : ''}
    <p style="margin:0 0 18px 0;font-size:14px;color:#4B4F4D;line-height:1.6;">
      Você pode <strong>refazer o cadastro</strong> em <a href="https://brasilconnectusa.com/negocio" style="color:#001a5e;">brasilconnectusa.com/negocio</a> corrigindo o ponto acima, ou responder este email pra conversar com a gente.
    </p>
  `

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
            <div style="text-transform:uppercase;letter-spacing:0.18em;font-size:11px;font-weight:600;color:${eyebrowColor};margin-bottom:14px;">
              ${eyebrow}
            </div>
            <h1 style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1A1F1C;line-height:1.25;letter-spacing:-0.01em;">
              ${title}
            </h1>
            ${isApprove ? bodyApprove : bodyReject}

            <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E1D6;font-size:13px;color:#6B6E68;line-height:1.6;">
              Pra qualquer dúvida, é só responder este email — chega direto na gente.
            </div>
          </td>
        </tr>

        <tr>
          <td style="background:#073824;padding:24px 36px;text-align:center;color:#F1ECDF;">
            <div style="font-size:13px;opacity:0.85;">— Equipe BrasilConnect USA</div>
            <div style="font-size:11px;opacity:0.55;margin-top:8px;">
              <a href="https://brasilconnectusa.com" style="color:#F1ECDF;text-decoration:underline;opacity:0.75;">brasilconnectusa.com</a>
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

function buildBusinessText({ action, businessName, reason }) {
  if (action === 'approve') {
    return `Bem-vindo ao BrasilConnect USA!

Seu negócio "${businessName}" foi aprovado e já está no diretório.

Próximos passos:
1. Acesse brasilconnectusa.com/assinante com este email
2. Adicione fotos, horários, descrição
3. Compartilhe seu perfil

— Equipe BrasilConnect USA`
  }
  return `Cadastro de "${businessName}" não aceito.
${reason ? `\nMotivo: ${reason}\n` : ''}
Você pode refazer em brasilconnectusa.com/negocio corrigindo o ponto acima.

— Equipe BrasilConnect USA`
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { business_id, action, reason } = req.body || {}
  if (!business_id || !VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'business_id e action (approve|reject|archive) obrigatorios' })
  }

  const update =
    action === 'approve'  ? { status: 'approved', active: true }  :
    action === 'reject'   ? { status: 'rejected', active: false } :
    action === 'archive'  ? { status: 'archived', active: false } :
    null

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    // Busca dados antes (pra ter email + nome pro template)
    const { data: before } = await supabase
      .from('bc_businesses')
      .select('id, name, slug, submitted_email, owner_email')
      .eq('id', business_id)
      .single()

    if (!before) return res.status(404).json({ error: 'Negocio nao encontrado' })

    const { data, error } = await supabase
      .from('bc_businesses')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', business_id)
      .select('id, name, slug, status, active')
      .single()

    if (error || !data) throw new Error(error?.message || 'Update falhou')

    // ─── Email (so pra approve/reject, nao pra archive) ──────────────
    let email_sent = false
    const recipientEmail = before.owner_email || before.submitted_email
    const shouldEmail = (action === 'approve' || action === 'reject') && recipientEmail && process.env.RESEND_API_KEY

    if (shouldEmail) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const subject = action === 'approve'
          ? `✓ ${before.name} foi aprovado no BrasilConnect`
          : `Sobre o cadastro de ${before.name} no BrasilConnect`

        const sendResult = await resend.emails.send({
          from:    REPLY_FROM,
          to:      [recipientEmail],
          replyTo: 'oi@brasilconnectusa.com',
          subject,
          html: buildBusinessEmail({ action, businessName: before.name || '(seu negócio)', reason, slug: before.slug }),
          text: buildBusinessText({ action, businessName: before.name || '(seu negócio)', reason }),
        })

        if (sendResult.error) {
          console.error('business-action email error:', sendResult.error)
        } else {
          email_sent = true
        }
      } catch (e) {
        // Email falhar nao bloqueia a aprovacao — log e segue
        console.error('business-action email exception:', e.message)
      }
    }

    return res.status(200).json({
      success: true,
      business: data,
      action,
      email_sent,
      email_to: shouldEmail ? recipientEmail : null,
    })
  } catch (e) {
    console.error('admin/business-action error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
