/**
 * POST /api/admin/user-email
 *
 * Envia email branded (HTML + text) para 1 ou varios usuarios.
 *
 * Body modos suportados:
 *   { user_id, subject, body }            → 1 user (busca email no bc_profiles)
 *   { email,   subject, body }            → 1 email direto
 *   { user_ids: [uuid...], subject, body} → N users selecionados (bulk)
 *   { filter: { state?, role?, onboarded?, banned? }, subject, body }
 *                                         → bulk via filtro (use com cuidado)
 *
 * Headers: x-admin-secret
 *
 * Retorna: { sent, failed, results: [...] }
 */

import { createClient } from '@supabase/supabase-js'

const FROM_EMAIL = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'
const MAX_BULK = 500

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildHtml({ recipientName, body }) {
  const safeName = escapeHtml(recipientName || 'amigo(a)')
  const safeBody = escapeHtml(body).replace(/\n/g, '<br/>')

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
            <h1 style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1A1F1C;line-height:1.25;letter-spacing:-0.01em;">
              Olá, ${safeName}!
            </h1>
            <div style="margin:0 0 24px 0;font-size:15px;color:#4B4F4D;line-height:1.7;">
              ${safeBody}
            </div>
            <div style="margin-top:28px;padding-top:18px;border-top:1px solid #E5E1D6;font-size:13px;color:#6B6E68;line-height:1.6;">
              Pra responder, é só dar reply neste email — chega direto na gente.
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#073824;padding:24px 36px;text-align:center;color:#F1ECDF;">
            <div style="font-size:13px;opacity:0.85;">— Equipe BrasilConnect USA</div>
            <div style="font-size:11px;opacity:0.55;margin-top:8px;">
              <a href="https://brasilconnectusa.com" style="color:#F1ECDF;text-decoration:underline;opacity:0.75;">brasilconnectusa.com</a>
              ·
              <a href="https://brasilconnectusa.com/privacidade" style="color:#F1ECDF;text-decoration:underline;opacity:0.75;">Privacidade</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildText({ recipientName, body }) {
  return `Olá, ${recipientName || 'amigo(a)'}!

${body}

— Equipe BrasilConnect USA
https://brasilconnectusa.com`
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const adminSecret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY nao configurado' })
  }

  const { user_id, user_ids, email, filter, subject, body } = req.body || {}
  if (!subject || !body) return res.status(400).json({ error: 'subject e body obrigatorios' })
  if (String(body).trim().length < 5) return res.status(400).json({ error: 'body muito curto' })
  if (String(body).length > 20000) return res.status(400).json({ error: 'body muito longo (max 20000 chars)' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  try {
    // ─── Monta lista de destinatarios ─────────────────────────────────
    let recipients = [] // [{email, name, user_id}]

    if (user_id) {
      const { data } = await supabase.from('bc_profiles').select('user_id, email, full_name, display_name').eq('user_id', user_id).maybeSingle()
      if (!data?.email) return res.status(404).json({ error: 'profile/email nao encontrado' })
      recipients = [{ email: data.email, name: data.full_name || data.display_name, user_id: data.user_id }]
    } else if (email) {
      recipients = [{ email: String(email).trim(), name: null, user_id: null }]
    } else if (Array.isArray(user_ids) && user_ids.length) {
      const { data } = await supabase.from('bc_profiles')
        .select('user_id, email, full_name, display_name')
        .in('user_id', user_ids)
      recipients = (data || []).filter(r => r.email).map(r => ({
        email: r.email, name: r.full_name || r.display_name, user_id: r.user_id,
      }))
    } else if (filter && typeof filter === 'object') {
      let q = supabase.from('bc_profiles').select('user_id, email, full_name, display_name').not('email', 'is', null)
      if (filter.state) q = q.eq('state', filter.state)
      if (filter.role)  q = q.eq('role', filter.role)
      if (filter.onboarded === true)  q = q.eq('onboarding_completed', true)
      if (filter.onboarded === false) q = q.eq('onboarding_completed', false)
      const { data } = await q.limit(MAX_BULK)
      recipients = (data || []).map(r => ({
        email: r.email, name: r.full_name || r.display_name, user_id: r.user_id,
      }))
      if (filter.banned === true || filter.banned === false) {
        const { data: bans } = await supabase.from('bc_banned_users').select('user_id')
        const bannedSet = new Set((bans || []).map(b => b.user_id))
        recipients = recipients.filter(r => filter.banned ? bannedSet.has(r.user_id) : !bannedSet.has(r.user_id))
      }
    } else {
      return res.status(400).json({ error: 'forneca user_id, email, user_ids ou filter' })
    }

    if (recipients.length === 0) return res.status(400).json({ error: 'nenhum destinatario resolvido' })
    if (recipients.length > MAX_BULK) {
      return res.status(400).json({ error: `bulk excede limite (max ${MAX_BULK}, tentou ${recipients.length})` })
    }

    // Filtra banidos sempre (a menos que filter.banned=true seja explicito)
    const wantsBanned = filter?.banned === true
    if (!wantsBanned) {
      const { data: bans } = await supabase.from('bc_banned_users').select('user_id')
      const bannedSet = new Set((bans || []).map(b => b.user_id))
      recipients = recipients.filter(r => !r.user_id || !bannedSet.has(r.user_id))
    }

    // ─── Envia via Resend (em sequencia leve, sem floodar) ────────────
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    const results = []
    let sent = 0, failed = 0
    for (const r of recipients) {
      try {
        const html = buildHtml({ recipientName: r.name, body })
        const text = buildText({ recipientName: r.name, body })
        const out = await resend.emails.send({
          from:    FROM_EMAIL,
          to:      [r.email],
          replyTo: 'oi@brasilconnectusa.com',
          subject,
          html,
          text,
        })
        if (out.error) {
          failed++
          results.push({ email: r.email, ok: false, error: out.error.message || 'unknown' })
        } else {
          sent++
          results.push({ email: r.email, ok: true, resend_id: out.data?.id || null })
        }
      } catch (sendErr) {
        failed++
        results.push({ email: r.email, ok: false, error: sendErr.message })
      }
      // Pequeno respiro pra nao bater rate limit do Resend em bulk grande
      if (recipients.length > 10) await new Promise(rsv => setTimeout(rsv, 80))
    }

    return res.status(200).json({
      success: true,
      sent,
      failed,
      total: recipients.length,
      results,
    })
  } catch (e) {
    console.error('admin/user-email error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
