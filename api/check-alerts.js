/**
 * GET /api/check-alerts
 * Executado pelo cron do Vercel a cada 30 minutos.
 * Verifica a taxa atual e envia emails para alertas que foram atingidos.
 *
 * Protegido por CRON_SECRET no header Authorization.
 */

const { createClient } = await import('@supabase/supabase-js')

const FALLBACK_RATE = 5.10

async function getCurrentRate() {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY
  if (!apiKey) return FALLBACK_RATE

  try {
    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/BRL`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return FALLBACK_RATE
    const data = await res.json()
    return data.result === 'success' ? data.conversion_rate : FALLBACK_RATE
  } catch {
    return FALLBACK_RATE
  }
}

async function sendAlertEmail(email, targetRate, direction, currentRate) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log(`[email skip] RESEND_API_KEY não configurado. Alerta p/ ${email}`)
    return true
  }

  const dirLabel = direction === 'above' ? 'acima de' : 'abaixo de'
  const emoji = direction === 'above' ? '📈' : '📉'

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <span style="font-size:32px">${emoji}</span>
        <h1 style="color:#009c3b;margin:8px 0 4px">Alerta de Câmbio Atingido!</h1>
        <p style="color:#6b7280;margin:0">BrasilConnect</p>
      </div>

      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
        <p style="margin:0 0 8px;color:#374151;font-size:14px">O câmbio está agora</p>
        <p style="margin:0;font-size:32px;font-weight:700;color:#009c3b">R$ ${currentRate.toFixed(4)}</p>
        <p style="margin:8px 0 0;color:#6b7280;font-size:13px">
          ${emoji} ${dirLabel} sua meta de R$ ${targetRate.toFixed(2)}
        </p>
      </div>

      <p style="color:#374151;font-size:14px;line-height:1.6;margin-bottom:20px">
        Este é o momento que você estava esperando! Compare as melhores opções para enviar seu dinheiro:
      </p>

      <a href="https://brasilconnectusa.com"
         style="display:block;text-align:center;background:#009c3b;color:#fff;
                text-decoration:none;padding:14px;border-radius:10px;
                font-weight:600;font-size:15px;margin-bottom:20px">
        Comparar taxas agora →
      </a>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
      <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
        Você recebeu este email porque criou um alerta no BrasilConnect.<br>
        <a href="https://brasilconnectusa.com/api/alerts?id=UNSUBSCRIBE&email=${encodeURIComponent(email)}"
           style="color:#9ca3af">Cancelar alertas</a>
      </p>
    </div>
  `

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: 'BrasilConnect <alertas@brasilconnectusa.com>',
      to: [email],
      subject: `${emoji} Câmbio ${dirLabel} R$${targetRate.toFixed(2)} — Agora está R$${currentRate.toFixed(4)}`,
      html,
    }),
  })

  return emailRes.ok
}

export default async function handler(req, res) {
  // Verificar autenticação do cron
  const authHeader = req.headers.authorization || ''
  const cronSecret = process.env.CRON_SECRET

  // Vercel passa o secret automaticamente no header Bearer quando configurado no vercel.json
  // Também aceitar via query param para testes manuais
  const providedSecret = authHeader.replace('Bearer ', '') || req.query?.secret
  if (cronSecret && providedSecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startTime = Date.now()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // Buscar taxa atual
  const currentRate = await getCurrentRate()

  // Buscar todos os alertas ativos
  const { data: alerts, error: fetchError } = await supabase
    .from('bc_rate_alerts')
    .select('*')
    .eq('status', 'active')

  if (fetchError) {
    console.error('Error fetching alerts:', fetchError.message)
    return res.status(500).json({ error: 'Erro ao buscar alertas' })
  }

  if (!alerts || alerts.length === 0) {
    return res.status(200).json({
      ok: true,
      message: 'Nenhum alerta ativo',
      current_rate: currentRate,
      checked: 0,
      triggered: 0,
    })
  }

  let triggered = 0
  const triggeredAlerts = []

  for (const alert of alerts) {
    const shouldTrigger =
      (alert.direction === 'above' && currentRate >= alert.target_rate) ||
      (alert.direction === 'below' && currentRate <= alert.target_rate)

    if (!shouldTrigger) continue

    triggered++
    triggeredAlerts.push(alert.id)

    // Tentar enviar email
    const emailSent = await sendAlertEmail(
      alert.email,
      alert.target_rate,
      alert.direction,
      currentRate
    )

    // Marcar alerta como disparado
    await supabase
      .from('bc_rate_alerts')
      .update({
        status: emailSent ? 'triggered' : 'trigger_failed',
        triggered_at: new Date().toISOString(),
        triggered_rate: currentRate,
      })
      .eq('id', alert.id)
  }

  // Salvar log do cron
  await supabase.from('bc_cron_logs').insert({
    job_name: 'check-alerts',
    current_rate: currentRate,
    alerts_checked: alerts.length,
    alerts_triggered: triggered,
    duration_ms: Date.now() - startTime,
    ran_at: new Date().toISOString(),
  })

  return res.status(200).json({
    ok: true,
    current_rate: currentRate,
    checked: alerts.length,
    triggered,
    triggered_ids: triggeredAlerts,
    duration_ms: Date.now() - startTime,
  })
}
