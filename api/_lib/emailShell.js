/**
 * Helper compartilhado de templates de email branded BrasilConnect.
 *
 * Usado por:
 *   - api/cron/drip.js                  (drip da waitlist pre-launch)
 *   - api/cron/onboarding-reminders.js  (lembretes pra completar profile)
 *   - futuros (bolao reminders, etc)
 */

export const COLORS = {
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

export function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}

export function block(p) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:${COLORS.inkSoft};line-height:1.65;">${p}</p>`
}

export function callout(title, text) {
  return `<div style="background:${COLORS.goldSft};border-left:3px solid ${COLORS.gold};padding:14px 18px;border-radius:6px;margin:16px 0;">
    <div style="font-weight:600;color:${COLORS.goldDk};font-size:13px;margin-bottom:4px;">${title}</div>
    <div style="font-size:14px;color:${COLORS.inkSoft};line-height:1.55;">${text}</div>
  </div>`
}

export function shellHtml({ kicker, title, bodyHtml, ctaUrl, ctaLabel, footerNote }) {
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
