/**
 * /api/unsubscribe?k=<u|w|a>&id=<uuid>&t=<hmac>
 *
 * GET  → pagina pedindo confirmacao (leitores automaticos de e-mail abrem links;
 *        por isso o GET nao descadastra sozinho).
 * POST → descadastra. Tambem atende o "one-click" do Gmail/Outlook
 *        (header List-Unsubscribe-Post), que faz POST direto na URL.
 *
 * Efeito:
 *   - grava o e-mail em bc_email_optouts (crons de marketing pulam quem esta la)
 *   - cancela os alertas de cambio ativos daquele e-mail
 */
import { createClient } from '@supabase/supabase-js'
import { verifyUnsubToken } from './_lib/unsubscribe.js'

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>${title} · BrasilConnect USA</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAF7F0;color:#1A1F1C;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;box-sizing:border-box}
  .card{max-width:440px;width:100%;background:#fff;border:1px solid #E5E1D6;border-radius:16px;padding:36px 32px;text-align:center}
  h1{font-size:24px;letter-spacing:-.02em;margin:0 0 12px}
  p{font-size:15px;line-height:1.6;color:#4B4F4D;margin:0 0 20px}
  button{font:inherit;font-weight:600;font-size:15px;padding:13px 24px;border:none;border-radius:10px;background:#1F4D3F;color:#FAF7F0;cursor:pointer}
  a{color:#1F4D3F}
</style></head><body><div class="card">${body}</div></body></html>`
}

async function resolveEmail(supabase, kind, id) {
  if (kind === 'u') {
    const { data, error } = await supabase.auth.admin.getUserById(id)
    return error ? null : (data?.user?.email || null)
  }
  const table = kind === 'w' ? 'bc_waitlist' : 'bc_rate_alerts'
  const { data } = await supabase.from(table).select('email').eq('id', id).maybeSingle()
  return data?.email || null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const kind = String(req.query.k || '')
  const id = String(req.query.id || '')
  const token = String(req.query.t || '')

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')

  if (!verifyUnsubToken(kind, id, token)) {
    return res.status(400).send(page('Link inválido', `
      <h1>Link inválido</h1>
      <p>Este link de descadastro não é válido ou está incompleto. Abra o link direto do e-mail mais recente que você recebeu.</p>
      <p><a href="https://brasilconnectusa.com/">Voltar ao site</a></p>`))
  }

  if (req.method === 'GET') {
    return res.status(200).send(page('Cancelar inscrição', `
      <h1>Cancelar inscrição</h1>
      <p>Você vai parar de receber e-mails de novidades, lembretes e alertas de câmbio da BrasilConnect USA. E-mails sobre a sua conta e os seus pedidos continuam chegando.</p>
      <form method="POST"><button type="submit">Confirmar cancelamento</button></form>`))
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const email = await resolveEmail(supabase, kind, id)
    if (!email) {
      return res.status(404).send(page('Cadastro não encontrado', `
        <h1>Cadastro não encontrado</h1>
        <p>Não achamos um cadastro ligado a este link. Se continuar recebendo e-mails, escreva para oi@brasilconnectusa.com.</p>`))
    }
    const clean = String(email).trim().toLowerCase()

    const { error } = await supabase.from('bc_email_optouts')
      .upsert({ email: clean, source: `link:${kind}` }, { onConflict: 'email' })
    if (error) throw error

    await supabase.from('bc_rate_alerts').update({ status: 'cancelled' }).eq('email', clean).eq('status', 'active')

    return res.status(200).send(page('Inscrição cancelada', `
      <h1>Inscrição cancelada</h1>
      <p>Pronto. Você não vai mais receber e-mails de novidades, lembretes nem alertas de câmbio.</p>
      <p><a href="https://brasilconnectusa.com/">Voltar ao site</a></p>`))
  } catch (e) {
    console.error('[unsubscribe] erro:', e.message)
    return res.status(500).send(page('Erro', `
      <h1>Não deu certo agora</h1>
      <p>Tente de novo em alguns minutos. Se o erro continuar, escreva para oi@brasilconnectusa.com.</p>`))
  }
}
