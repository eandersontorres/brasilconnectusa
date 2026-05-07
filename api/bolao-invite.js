/**
 * GET /bolao/<code>  →  reescrito pra /api/bolao-invite?code=<code>
 *
 * Renderiza HTML público com OG tags dinâmicas (preview no WhatsApp/IG/etc)
 * e CTA pra entrar no grupo. Quando clica em "Entrar", joga pra /app/bolao?join=<code>.
 *
 * - Scrapers (WhatsApp, Twitter, Slack, etc.) leem só o HTML inicial; precisam
 *   das OG tags renderizadas server-side.
 * - Usuários humanos veem a página e clicam pra entrar.
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const code = String(req.query.code || '').toUpperCase().trim()
  if (!code || !/^[A-Z0-9]{4,8}$/.test(code)) {
    return res.status(400).send(notFoundHtml('Código inválido', 'O link de convite parece estar incompleto.'))
  }

  let group = null
  let memberCount = 0
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    )

    const { data: g } = await supabase
      .from('bc_bolao_groups')
      .select('id, name, join_code, prize_title, prize_first, created_at')
      .eq('join_code', code)
      .maybeSingle()

    if (!g) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(404).send(notFoundHtml('Grupo não encontrado', 'Esse código de bolão não existe ou expirou. Confira com quem te convidou.'))
    }
    group = g

    const { count } = await supabase
      .from('bc_bolao_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', g.id)
    memberCount = count || 0
  } catch (e) {
    console.error('[bolao-invite] db:', e.message)
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
  return res.status(200).send(invitePageHtml({ group, memberCount }))
}

// ───────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}

function invitePageHtml({ group, memberCount }) {
  const groupName = escapeHtml(group.name)
  const code = escapeHtml(group.join_code)
  const ogTitle = `Você foi convidado pro Bolão Copa 2026: ${groupName}`
  const ogDesc = memberCount > 1
    ? `${memberCount} brasileiros já estão palpitando. Entre no grupo e dispute o ranking estadual e nacional dos EUA.`
    : `Bolão da Copa 2026 — entre, palpite e dispute o ranking estadual e nacional dos EUA.`
  const ogImage = 'https://brasilconnectusa.com/og-image.png'
  const url = `https://brasilconnectusa.com/bolao/${code}`
  const prizeLine = group.prize_title || group.prize_first
    ? `<div class="prize">🏆 ${escapeHtml(group.prize_title || group.prize_first)}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>${ogTitle}</title>
<meta name="description" content="${escapeHtml(ogDesc)}" />
<link rel="canonical" href="${url}" />

<meta property="og:type" content="website" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${escapeHtml(ogTitle)}" />
<meta property="og:description" content="${escapeHtml(ogDesc)}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:site_name" content="BrasilConnect USA" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
<meta name="twitter:description" content="${escapeHtml(ogDesc)}" />
<meta name="twitter:image" content="${ogImage}" />

<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;1,9..144,400&family=Sora:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

<style>
:root{--navy:#001a5e;--green:#009c3b;--gold:#FFD700;--cream:#FAF7F0;--ink:#1A1F1C;--muted:#6B6E68;--border:#E5E1D6;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Sora',sans-serif;background:var(--cream);color:var(--ink);min-height:100vh;}
a{text-decoration:none;color:inherit;}

.wrap{max-width:560px;margin:0 auto;padding:32px 20px 80px;}

.brand{text-align:center;margin-bottom:32px;}
.brand-logo{font-family:'Fraunces',serif;font-size:18px;font-weight:600;color:var(--navy);}
.brand-logo em{color:#B89968;font-style:normal;}

.hero{background:var(--navy);border-radius:24px;padding:40px 28px 32px;color:#fff;text-align:center;position:relative;overflow:hidden;}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 50% 0%,rgba(0,156,59,.18) 0%,transparent 60%);}
.hero-tag{position:relative;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:12px;}
.hero-ball{position:relative;font-size:64px;line-height:1;margin-bottom:16px;}
.hero-h1{position:relative;font-family:'Fraunces',serif;font-size:30px;font-weight:600;line-height:1.18;letter-spacing:-0.5px;margin-bottom:14px;}
.hero-h1 em{color:#FFD700;font-style:italic;}
.hero-sub{position:relative;font-size:14px;line-height:1.6;color:rgba(255,255,255,.65);max-width:380px;margin:0 auto;}

.card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:24px;margin-top:-20px;position:relative;z-index:1;box-shadow:0 12px 40px rgba(0,26,94,.12);}
.gname-tag{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;text-align:center;margin-bottom:6px;}
.gname{font-family:'Fraunces',serif;font-size:24px;font-weight:600;color:var(--navy);text-align:center;letter-spacing:-0.3px;line-height:1.2;}
.gcode{display:inline-flex;align-items:center;justify-content:center;background:var(--cream);border:1.5px dashed var(--border);border-radius:10px;padding:8px 16px;font-size:18px;font-weight:800;letter-spacing:6px;color:var(--ink);margin:14px auto 0;font-family:'Sora',monospace;}
.gcode-wrap{text-align:center;}

.prize{margin-top:14px;background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:1px solid #FDE68A;border-radius:10px;padding:10px 14px;font-size:13px;color:#78350F;font-weight:600;text-align:center;}

.metabox{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:18px;padding-top:18px;border-top:1px solid var(--border);}
.metaitem{text-align:center;}
.meta-num{font-family:'Fraunces',serif;font-size:24px;font-weight:600;color:var(--green);}
.meta-lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-top:2px;}

.cta{display:block;width:100%;background:var(--green);color:#fff;border:none;border-radius:14px;padding:18px;font-size:16px;font-weight:800;font-family:'Sora',sans-serif;cursor:pointer;margin-top:24px;transition:background .15s;text-align:center;}
.cta:hover{background:#00b34d;}
.cta-sub{text-align:center;font-size:12px;color:var(--muted);margin-top:10px;}

.feats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:24px;}
.feat{background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px 10px;text-align:center;}
.feat-ico{font-size:22px;margin-bottom:4px;}
.feat-lbl{font-size:11px;font-weight:600;color:var(--navy);line-height:1.3;}

.foot{text-align:center;margin-top:36px;font-size:12px;color:var(--muted);}
.foot a{color:var(--navy);font-weight:600;}

@media(max-width:420px){.hero{padding:32px 22px 28px;border-radius:20px;}.hero-h1{font-size:26px;}.gname{font-size:21px;}.gcode{letter-spacing:5px;font-size:17px;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><div class="brand-logo">Brasil<em>Connect</em></div></div>

  <div class="hero">
    <div class="hero-tag">⚽ Bolão Copa 2026</div>
    <div class="hero-ball">🏆</div>
    <h1 class="hero-h1">Você foi convidado<br/>pra <em>palpitar.</em></h1>
    <p class="hero-sub">Os jogos começam em <strong style="color:#fff;">11 de junho</strong>. O Brasil estreia <strong style="color:#fff;">13/jun</strong>. Não fica de fora.</p>
  </div>

  <div class="card">
    <div class="gname-tag">Você está entrando em</div>
    <div class="gname">${groupName}</div>
    <div class="gcode-wrap"><div class="gcode">${code}</div></div>
    ${prizeLine}
    <div class="metabox">
      <div class="metaitem">
        <div class="meta-num">${memberCount}</div>
        <div class="meta-lbl">${memberCount === 1 ? 'participante' : 'participantes'}</div>
      </div>
      <div class="metaitem">
        <div class="meta-num">48</div>
        <div class="meta-lbl">seleções</div>
      </div>
      <div class="metaitem">
        <div class="meta-num">5⭐</div>
        <div class="meta-lbl">do Brasil</div>
      </div>
    </div>
    <a class="cta" href="/app/bolao?join=${code}">Entrar no Bolão →</a>
    <div class="cta-sub">Gratuito · Sem mensalidade · Em português</div>
  </div>

  <div class="feats">
    <div class="feat"><div class="feat-ico">🇺🇸</div><div class="feat-lbl">Ranking<br/>do seu estado</div></div>
    <div class="feat"><div class="feat-ico">🌎</div><div class="feat-lbl">Ranking<br/>nacional EUA</div></div>
    <div class="feat"><div class="feat-ico">⚡</div><div class="feat-lbl">Resultados<br/>em tempo real</div></div>
  </div>

  <div class="foot">
    BrasilConnect USA — feito por brasileiros, pra brasileiros nos EUA.<br/>
    <a href="/">Ir pra home</a> · <a href="/app/bolao">Criar meu próprio bolão</a>
  </div>
</div>
</body>
</html>`
}

function notFoundHtml(title, msg) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(title)} — BrasilConnect</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#FAF7F0;color:#1A1F1C;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
.box{max-width:420px;text-align:center;background:#fff;border:1px solid #E5E1D6;border-radius:16px;padding:36px 28px;}
h1{font-size:22px;font-weight:700;margin:0 0 12px;color:#001a5e;}
p{font-size:14px;color:#6B6E68;line-height:1.6;margin:0 0 22px;}
a{display:inline-block;background:#009c3b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700;}</style>
</head><body><div class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p><a href="/">Voltar pra home</a></div></body></html>`
}
