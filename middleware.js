/**
 * Vercel Routing Middleware — protege as paginas internas que so tinham `noindex`.
 *
 * /admin/plano, /admin/roadmap e /admin/utm-builder tem conteudo no proprio HTML
 * (plano de negocios, metas de receita, nomes de env vars). A protecao precisa ser
 * no servidor: senha no navegador nao impede ninguem de abrir o arquivo.
 *
 * Login: HTTP Basic. Usuario: qualquer um. Senha: ADMIN_SECRET (a mesma do painel admin).
 * Sem ADMIN_SECRET configurado, nega tudo.
 */
export const config = {
  matcher: [
    '/admin/plano', '/admin/plano.html',
    '/admin/roadmap', '/admin/roadmap.html',
    '/admin/utm-builder', '/admin/utm-builder.html',
  ],
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export default function middleware(request) {
  const secret = process.env.ADMIN_SECRET || ''
  const header = request.headers.get('authorization') || ''

  if (secret && header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      const password = decoded.slice(decoded.indexOf(':') + 1)
      if (safeEqual(password, secret)) {
        // Equivalente ao next() do @vercel/functions: segue pro arquivo estatico.
        return new Response(null, { headers: { 'x-middleware-next': '1' } })
      }
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
