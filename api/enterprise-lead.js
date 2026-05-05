/**
 * POST /api/enterprise-lead
 * Body: { name, email, whatsapp, company, sector, team_size, interest, message }
 * Salva lead Enterprise no Supabase + envia email pra equipe via Resend
 */
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from './_lib/rateLimit.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const _rl = rateLimit(req, { windowMs: 60000, max: 3 })
  if (_rl) return res.status(429).json({ error: 'Muitas requisicoes. Tenta de novo em ' + _rl.retryAfter + 's.' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const whatsapp = String(body.whatsapp || '').trim()
    const company = String(body.company || '').trim()
    const sector = String(body.sector || '').trim()
    const team_size = String(body.team_size || '').trim()
    const interest = String(body.interest || '').trim()
    const message = String(body.message || '').trim().slice(0, 2000)

    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email sao obrigatorios' })
    }
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Email invalido' })
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { data, error } = await supabase
      .from('bc_enterprise_leads')
      .insert([{
        name, email, whatsapp, company, sector, team_size, interest, message,
        source_url: req.headers.referer || '/agenda/planos',
        status: 'new',
      }])
      .select()
      .single()

    if (error) {
      console.error('insert lead error:', error.message)
      return res.status(500).json({ error: 'Erro ao salvar' })
    }

    // Notifica equipe via Resend (best effort)
    if (process.env.RESEND_API_KEY) {
      const notifyTo = process.env.CONTACT_NOTIFY_EMAIL || 'oi@brasilconnectusa.com'
      const fromAddr = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect <oi@brasilconnectusa.com>'
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [notifyTo],
            reply_to: email,
            subject: '[Enterprise Lead] ' + name + ' - ' + (company || sector || 'sem empresa'),
            html: '<h2>Novo lead Enterprise</h2>'
              + '<p><b>Nome:</b> ' + name + '</p>'
              + '<p><b>Email:</b> ' + email + '</p>'
              + (whatsapp ? '<p><b>WhatsApp:</b> ' + whatsapp + '</p>' : '')
              + (company ? '<p><b>Empresa:</b> ' + company + '</p>' : '')
              + (sector ? '<p><b>Setor:</b> ' + sector + '</p>' : '')
              + (team_size ? '<p><b>Tamanho da equipe:</b> ' + team_size + '</p>' : '')
              + (interest ? '<p><b>Interesse principal:</b> ' + interest + '</p>' : '')
              + (message ? '<p><b>Mensagem:</b><br>' + message.replace(/\n/g, '<br>') + '</p>' : '')
              + '<hr><p style="font-size:12px;color:#999;">Veja todos em /admin/manage</p>',
          }),
        }).catch(e => console.error('resend error:', e.message))
      } catch (e) {
        console.error('email notify failed:', e.message)
      }
    }

    return res.status(200).json({ success: true, id: data.id })
  } catch (e) {
    console.error('enterprise-lead error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
