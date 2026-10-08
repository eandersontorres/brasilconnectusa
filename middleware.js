/**
 * Vercel Routing Middleware — protege as paginas internas no servidor.
 * Senha no navegador nao impede ninguem de abrir o arquivo; aqui o HTML so sai
 * depois da senha certa.
 *
 * 1) /admin/plano, /admin/roadmap e /admin/utm-builder
 *    HTTP Basic. Usuario: qualquer um. Senha: ADMIN_SECRET (a mesma do painel admin).
 *
 * 2) /investidores (plano de crescimento e rodada anjo)
 *    Tela de senha propria, pensada pra quem recebe o link pelo WhatsApp.
 *    Senha: INVESTOR_PASSWORD. ADMIN_SECRET tambem entra, pro dono abrir sem
 *    precisar de outra senha. Investidor nunca recebe a senha de admin.
 *    Depois do login fica um cookie HttpOnly por 30 dias. Trocar a senha
 *    derruba todos os cookies antigos. ?sair=1 encerra o acesso.
 *
 * Sem senha configurada, nega tudo.
 */
export const config = {
  matcher: [
    '/admin/plano', '/admin/plano.html',
    '/admin/roadmap', '/admin/roadmap.html',
    '/admin/utm-builder', '/admin/utm-builder.html',
    '/investidores', '/investidores/:path*',
  ],
}

const INV_PATH = '/investidores'
const INV_COOKIE = 'bc_inv'
const INV_MAX_AGE = 60 * 60 * 24 * 30

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Equivalente ao next() do @vercel/functions: segue pro arquivo estatico.
const passThrough = () => new Response(null, { headers: { 'x-middleware-next': '1' } })

export default async function middleware(request) {
  const url = new URL(request.url)
  if (url.pathname === INV_PATH || url.pathname.startsWith(INV_PATH + '/')) {
    return investorGate(request, url)
  }
  return adminBasic(request)
}

// ── /admin/* : HTTP Basic com ADMIN_SECRET ─────────────────────────────────
function adminBasic(request) {
  const secret = process.env.ADMIN_SECRET || ''
  const header = request.headers.get('authorization') || ''

  if (secret && header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      const password = decoded.slice(decoded.indexOf(':') + 1)
      if (safeEqual(password, secret)) return passThrough()
    } catch (_) { /* header malformado: cai no 401 */ }
  }

  return new Response('Área restrita. Use a senha de admin.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="BrasilConnect Admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

// ── /investidores : tela de senha + cookie ─────────────────────────────────
function investorSecrets() {
  return [process.env.INVESTOR_PASSWORD, process.env.ADMIN_SECRET]
    .map(s => String(s || ''))
    .filter(Boolean)
}

async function tokenFor(password) {
  const data = new TextEncoder().encode('bc-investidores|' + (process.env.ADMIN_SECRET || '') + '|' + password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

async function investorGate(request, url) {
  const secrets = investorSecrets()

  // Sair: apaga o cookie e volta pra tela de senha
  if (url.searchParams.has('sair')) {
    return loginPage({ notice: 'Você saiu da área de investidores.' }, 200, [
      `${INV_COOKIE}=; Path=${INV_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    ])
  }

  if (request.method === 'POST') {
    let password = ''
    try {
      const form = await request.formData()
      password = String(form.get('senha') || '')
    } catch (_) { /* corpo invalido: senha vazia */ }

    const match = password && secrets.find(s => safeEqual(password, s))
    if (!match) {
      // Freia tentativa por forca bruta
      await new Promise(r => setTimeout(r, 700))
      return loginPage({ error: secrets.length ? 'Senha incorreta. Confira a senha que você recebeu junto com o link.' : 'Área ainda não configurada.' }, 401)
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: INV_PATH,
        'Set-Cookie': `${INV_COOKIE}=${await tokenFor(match)}; Path=${INV_PATH}; Max-Age=${INV_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const cookie = readCookie(request, INV_COOKIE)
  if (cookie && secrets.length) {
    for (const s of secrets) {
      if (safeEqual(cookie, await tokenFor(s))) return passThrough()
    }
  }
  return loginPage({}, 200)
}

function loginPage({ error, notice }, status, cookies = []) {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  })
  for (const c of cookies) headers.append('Set-Cookie', c)

  const msg = error
    ? `<p class="msg err" role="alert">${error}</p>`
    : notice ? `<p class="msg" role="status">${notice}</p>` : ''

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Área de investidores · BrasilConnect</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  :root { --bg: #FAF7F0; --card: #FFFFFF; --ink: #17241F; --muted: #5B6862; --line: #DED8CA; --brand: #1F4D3F; --on-brand: #FAF7F0; --err: #B42318; color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0F1714; --card: #16211C; --ink: #ECF0EC; --muted: #9EABA4; --line: #2B3A33; --brand: #7CCBA2; --on-brand: #0F1714; --err: #F97066; color-scheme: dark; }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 400 16px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif; }
  .card { width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px 24px; }
  .logo { display: flex; align-items: center; gap: 10px; font: 600 20px/1 Georgia, serif; }
  .logo svg { width: 26px; height: 26px; flex: none; }
  .logo em { font-style: italic; font-weight: 400; color: var(--brand); }
  h1 { font-size: 22px; line-height: 1.2; letter-spacing: -.02em; margin: 26px 0 6px; }
  p { margin: 0 0 18px; color: var(--muted); font-size: 15px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; font: inherit; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--ink); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  button { width: 100%; margin-top: 14px; font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; padding: 13px 16px; border: 0; border-radius: 10px; background: var(--brand); color: var(--on-brand); cursor: pointer; }
  .msg { font-size: 14px; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 0 0 16px; }
  .msg.err { color: var(--err); border-color: var(--err); }
  .foot { margin: 18px 0 0; font-size: 12px; }
</style>
</head>
<body>
  <main class="card">
    <div class="logo">
      <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="11" fill="#009C3B"/><path d="M 14 18 L 50 32 L 14 46" fill="none" stroke="#FFDF00" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="32" r="7" fill="#002776"/></svg>
      <span>Brasil<em>Connect</em></span>
    </div>
    <h1>Área de investidores</h1>
    <p>Plano de crescimento e rodada anjo. Use a senha que você recebeu junto com o link.</p>
    ${msg}
    <form method="post" action="${INV_PATH}">
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Entrar</button>
    </form>
    <p class="foot">Material confidencial para sócios e investidores convidados.</p>
  </main>
</body>
</html>`
  return new Response(html, { status, headers })
}
