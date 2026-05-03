# Setup do Supabase Auth — Magic Link

Pra que o login do app funcione (botão "Entrar" no topo), você precisa configurar
algumas URLs no painel do Supabase. Sem isso, o magic link que chega no email não
consegue redirecionar de volta pro app.

## Passo a passo

### 1. Authentication → Providers

Acessa: <https://supabase.com/dashboard> → seu projeto → **Authentication** → **Providers**.

- ✅ Confirma que **Email** está habilitado (vem ligado por padrão)
- Pode desativar todos os outros providers (Google, GitHub, etc) se não quiser usar

### 2. Authentication → URL Configuration

Acessa: **Authentication** → **URL Configuration**.

**Site URL:**
```
https://brasilconnectusa.com
```

**Redirect URLs** (adiciona uma por linha):
```
https://brasilconnectusa.com/?preview=brasil2026
https://brasilconnectusa.com/**
http://localhost:3000/?preview=brasil2026
http://localhost:3000/**
```

> O `/**` é wildcard — permite qualquer subpath. Útil pra próximas features.

Clica em **Save**.

### 3. Authentication → Email Templates → Magic Link (opcional)

Personaliza o template do email pra português. Acessa **Authentication** → **Email Templates**
→ aba **Magic Link**.

**Subject (Assunto):**
```
Seu link de acesso ao BrasilConnect
```

**Body (HTML):**
```html
<h2>Olá!</h2>
<p>Clica no link abaixo pra entrar no BrasilConnect — sem precisar de senha:</p>
<p><a href="{{ .ConfirmationURL }}">Entrar no BrasilConnect →</a></p>
<p>Se você não pediu este email, pode ignorar — ninguém vai entrar na sua conta sem clicar no link.</p>
<p style="color:#999;font-size:12px;margin-top:30px;">
  BrasilConnect USA · Comunidade brasileira nos Estados Unidos
</p>
```

Clica em **Save changes**.

### 4. (Opcional) SMTP customizado

Por padrão, o Supabase manda do `noreply@mail.app.supabase.io`. Se quiser que apareça
`@brasilconnectusa.com`, configura SMTP custom:

- **Authentication** → **SMTP Settings** → **Enable Custom SMTP**
- Usa as credenciais do **Resend**, SendGrid ou similar (você já tem RESEND_API_KEY no Vercel)

Resend SMTP info:
- Host: `smtp.resend.com`
- Port: `465` (SSL) ou `587` (TLS)
- User: `resend`
- Password: sua RESEND_API_KEY
- Sender: `noreply@brasilconnectusa.com` (precisa ter domínio verificado no Resend)

## Como testar

1. Abre <https://brasilconnectusa.com/?preview=brasil2026>
2. Clica em **Entrar** (canto superior direito)
3. Coloca seu email → clica **Enviar link mágico**
4. Em ~30s chega um email
5. Clica no link → volta pro app autenticado
6. Se for primeiro login, abre o **OnboardingFlow** (5 steps)

## Variáveis de ambiente do Vercel

Confere se essas estão setadas em <https://vercel.com/torresbee/brasilconnectusa/settings/environment-variables>:

| Variável | Pra quê |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase (público) |
| `VITE_SUPABASE_ANON_KEY` | Chave pública (anon) |
| `SUPABASE_URL` | Mesma URL (uso server-side) |
| `SUPABASE_SERVICE_KEY` | **Chave secreta service role** — NUNCA expor no client |
| `ADMIN_SECRET` | Senha do painel /admin |
| `RESEND_API_KEY` | Pra enviar emails (alertas, drip, contato) |
| `WAITLIST_FROM_EMAIL` | Remetente padrão (ex: `BrasilConnect <oi@brasilconnectusa.com>`) |
| `CONTACT_NOTIFY_EMAIL` | Email que recebe notificação quando alguém preenche Fale Conosco |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Pra Stripe Checkout (planos AgendaPro) |
| `AFFILIATE_WISE_LINK`, `AFFILIATE_REMITLY_LINK`, etc | Links de afiliados |

## Troubleshooting

**Magic link não chega no email:**
- Confere spam
- Confere se Authentication → Providers → Email está habilitado
- Confere se a Site URL está correta
- Olha logs em Authentication → Logs

**"Invalid Redirect URL" quando clica no link:**
- Faltou adicionar `/?preview=brasil2026` na lista de Redirect URLs
- Use o wildcard `**` se quiser mais flexibilidade

**Login funciona mas onboarding não abre:**
- Confere se rodou o SQL `bc_profiles_onboarding.sql` no Supabase
- Olha console do browser pra erros de fetch em `/api/profile`
