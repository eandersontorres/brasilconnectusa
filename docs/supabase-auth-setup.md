# Customizar email de Magic Link (Supabase Auth)

Hoje o magic link sai do remetente padrão do Supabase (`noreply@mail.supabase.io`) com template genérico em inglês. Pra trocar por algo branded saindo de `oi@brasilconnectusa.com`, faz 2 coisas no dashboard do Supabase:

## 1. Custom SMTP (Resend)

Você já tem `RESEND_API_KEY` configurada na Vercel. Reaproveita:

1. Supabase Dashboard → **Project Settings** → **Authentication** → **SMTP Settings**
2. Liga o toggle **Enable Custom SMTP**
3. Preenche:
   - **Sender email**: `oi@brasilconnectusa.com`
   - **Sender name**: `BrasilConnect USA`
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: `<seu RESEND_API_KEY>` (mesmo valor da env var)
   - **Minimum interval**: 60 (anti-flood)
4. Salva

**Pré-requisito**: domínio `brasilconnectusa.com` precisa estar **verificado** no Resend (resend.com/domains com SPF + DKIM verde). Se não tá, configura primeiro lá.

## 2. Template HTML do Magic Link (+ código OTP)

> **IMPORTANTE — atualização 2026-05-17:** o app agora pede **código de 6 dígitos** como fluxo principal de login (menos fricção em mobile que clicar link). O magic link continua como **fallback** dentro do mesmo email. Precisa republicar o template.

1. Supabase Dashboard → **Authentication** → **Email Templates** → **Magic Link**
2. **Subject**: `Seu código de acesso ao BrasilConnect USA`
3. **Body**: cola o conteúdo atualizado de [`email-magic-link.html`](./email-magic-link.html)
4. Salva

O Supabase substitui automaticamente:
- `{{ .Token }}` — **código OTP de 6 dígitos** (NOVO — é o destaque visual agora)
- `{{ .ConfirmationURL }}` — link mágico (fallback, ainda funciona)
- `{{ .Email }}` — email do destinatário

## 3. Site URL e Redirect URLs

1. Supabase Dashboard → **Authentication** → **URL Configuration**
2. **Site URL**: `https://brasilconnectusa.com`
3. **Redirect URLs** (adicionar todas que o app pode mandar como `emailRedirectTo`):
   ```
   https://brasilconnectusa.com/app/feed
   https://brasilconnectusa.com/app/bolao
   https://brasilconnectusa.com/app/remessas
   https://brasilconnectusa.com/app/voos
   https://brasilconnectusa.com/app/agenda
   https://brasilconnectusa.com/app/discover
   https://brasilconnectusa.com/app
   http://localhost:3000/app/feed
   ```

Sem isso, o Supabase rejeita o redirect alegando "URL not allowed".

## 4. Teste

1. No app, abre o modal de login (botão "Entrar")
2. Digita um email NOVO (não cadastrado antes)
3. Confere a caixa: deve chegar de `oi@brasilconnectusa.com` com layout custom
4. Clica no link → cai em `/app/feed` logado

---

## Outras opções (opcional)

### Confirmação de cadastro (Sign Up)
Mesmo template, mas vá em **Email Templates → Confirm Signup**.

### Recuperação de senha (não usamos hoje, mas se ativar)
**Email Templates → Reset Password**.

### Nome do remetente customizado por idioma
Hoje usa só PT-BR. Se quiser EN também depois, dá pra fazer com 2 templates separados via custom hooks de auth (mais avançado).
