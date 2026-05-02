# 🇧🇷 BrasilConnect USA — Checklist de Deploy

Use este checklist na primeira vez que for subir o site. Depois disso, é só `deploy.bat`.

---

## ANTES do deploy

### 1. Supabase — rodar os SQLs (5 min)

Acesse https://supabase.com/dashboard → seu projeto → SQL Editor → New query.
Cole e execute, na ordem, o conteúdo dos seguintes arquivos:

- [ ] `supabase/bc_waitlist.sql` (cria tabela bc_waitlist e views)
- [ ] `supabase/bc_drip_log.sql` (cria bc_drip_log + views de drip)
- [ ] `supabase/bc_referrals.sql` (cria bc_referral_codes, bc_referral_uses, funções e triggers)
- [ ] `supabase/bc_affiliate_clicks_v2.sql` (adiciona colunas UTM em bc_affiliate_clicks existente)

> Se for primeira vez no projeto, rode também `supabase/bc_businesses_schema.sql` e os SQLs do bolão.

### 2. Vercel — configurar env vars (10 min)

Acesse https://vercel.com/torresbee/brasilconnectusa/settings/environment-variables

Adicione cada variável (Production scope):

**Supabase:**
- [ ] `SUPABASE_URL` — seu Project URL (Supabase → Settings → API)
- [ ] `SUPABASE_SERVICE_KEY` — service_role key (NÃO expor no frontend)
- [ ] `VITE_SUPABASE_URL` — mesmo valor de SUPABASE_URL
- [ ] `VITE_SUPABASE_ANON_KEY` — anon public key

**Email:**
- [ ] `RESEND_API_KEY` — api key do Resend (resend.com → API Keys)
- [ ] `WAITLIST_FROM_EMAIL` — `BrasilConnect USA <oi@brasilconnectusa.com>` (precisa de domínio verificado no Resend)

**Cron + Admin:**
- [ ] `CRON_SECRET` — gerar com `openssl rand -hex 32`
- [ ] `ADMIN_SECRET` — gerar com `openssl rand -hex 32`

**Câmbio (já existente):**
- [ ] `EXCHANGE_RATE_API_KEY` — exchangerate-api.com

**Afiliados Tier 0 (Quick Wins) — preencher após cadastrar em cada programa:**
- [ ] `AFFILIATE_LEMONADE_LINK`
- [ ] `AFFILIATE_MINT_LINK`
- [ ] `AFFILIATE_MERCURY_LINK`
- [ ] `AFFILIATE_MYUS_LINK`
- [ ] `AFFILIATE_ZENBUSINESS_LINK`
- [ ] `AFFILIATE_CAPITALONE_LINK`

**Afiliados existentes (já cadastrados):**
- [ ] `AFFILIATE_WISE_LINK`
- [ ] `AFFILIATE_REMITLY_LINK`
- [ ] `AFFILIATE_WU_LINK`
- [ ] `AFFILIATE_KAYAK_LINK`
- [ ] `TRAVELPAYOUTS_TOKEN`
- [ ] `TRAVELPAYOUTS_MARKER`

### 3. Resend — verificar domínio (1 dia)

- [ ] Criar conta em resend.com
- [ ] Adicionar domínio `brasilconnectusa.com` (Domains → Add Domain)
- [ ] Adicionar os registros DNS no provedor (Cloudflare/GoDaddy/etc) — geralmente 3 registros TXT
- [ ] Aguardar verificação (até 24h, geralmente <1h)
- [ ] Sem domínio verificado, use `onboarding@resend.dev` temporariamente em `WAITLIST_FROM_EMAIL`

### 4. Domínio próprio (opcional, ~30 min)

- [ ] No Vercel: Settings → Domains → Add `brasilconnectusa.com`
- [ ] Vercel mostra os registros DNS pra apontar
- [ ] No provedor de DNS (onde comprou o domínio): adicionar A/CNAME conforme instruído
- [ ] Aguardar propagação (pode levar até 48h, geralmente <2h)

---

## DEPLOY

Dois cliques em `deploy.bat`. Ele vai:
1. Verificar Node + Vercel CLI
2. Avisar se faltar env vars
3. Pedir confirmação antes de subir produção
4. Mostrar URL final

**Alternativa (manual):**
```
cd "C:\Users\AndersonTorres\OneDrive - TorresBee\Documents\Claude\Projects\Brasil connect"
vercel --prod
```

---

## DEPOIS do deploy

### 5. Testes funcionais (15 min)

- [ ] Abrir `https://brasilconnectusa.com/` → deve aparecer "Em Breve"
- [ ] Cadastrar um email de teste, conferir se recebe o email de confirmação do Resend (verificar caixa de spam também)
- [ ] Conferir no Supabase se o registro entrou em `bc_waitlist` e `bc_drip_log`
- [ ] Abrir `https://brasilconnectusa.com/?preview=brasil2026` → deve abrir o app real (Remessas, Voos, etc)
- [ ] Abrir `https://brasilconnectusa.com/custo-de-vida/austin-tx/` → landing SEO carrega
- [ ] Abrir `https://brasilconnectusa.com/guia-chegada/` → lead magnet carrega
- [ ] Abrir `https://brasilconnectusa.com/admin/utm-builder` → ferramenta carrega (sem auth)
- [ ] Abrir `https://brasilconnectusa.com/admin/waitlist` → entrar com `ADMIN_SECRET` → deve listar o cadastro de teste
- [ ] Testar redirect: `https://brasilconnectusa.com/go/wise?campaign=teste` → redireciona para Wise

### 6. SEO e Indexação (10 min)

- [ ] Submeter `https://brasilconnectusa.com/sitemap.xml` no Google Search Console
- [ ] Submeter o mesmo no Bing Webmaster Tools
- [ ] Solicitar indexação manual das páginas principais (URL Inspection → Request indexing)

### 7. Substituir placeholders de tracking (5 min)

No `index.html` (raiz) e nas 21 páginas geradas em `public/`:
- [ ] Substituir `G-XXXXXXXXXX` pelo Measurement ID real do GA4
- [ ] Substituir `XXXXXXXXXXXXXXX` pelo Pixel ID real do Meta

Atalho: edite o `scripts/build-landing-pages.js` (procurar por `G-XXXXXXXXXX` e `XXXXXXXXXXXXXXX`), substitua e rode `node scripts/build-landing-pages.js`. Depois faça deploy de novo.

Para o `index.html` da raiz e o `ComingSoon.jsx`, edite manualmente.

### 8. Cron de drip (1 min)

- [ ] No painel Vercel → Settings → Cron Jobs → confirmar que `/api/cron/drip` está agendado pra rodar diariamente 14:00 UTC
- [ ] No `vercel.json` o path está como `/api/cron/drip?secret=__CRON__`. Substituir `__CRON__` pelo valor real de CRON_SECRET ou refatorar pra usar header (mais seguro)

---

## Aprovações imediatas pós-lançamento

- [ ] Lemonade Affiliates — aprovação em ~1 dia
- [ ] Mint Mobile Affiliates — ~2 dias
- [ ] Mercury Bank Referral — instantâneo
- [ ] MyUS — ~1 dia
- [ ] ZenBusiness — ~3 dias
- [ ] Capital One — via Bankrate ou FlexOffers

Cada um aprovado, atualizar a env var correspondente no Vercel e redeploy não é necessário (env vars atualizam automaticamente).

---

## Em caso de problemas

**Site retorna 404 após deploy:** verificar se `vercel.json` está correto e se o build do Vite foi sucesso (Vercel Dashboard → Deployments → último deploy → Build Logs).

**APIs retornam 500:** geralmente env var faltando. Ver Vercel → Functions → logs em tempo real.

**Email não chega:** Resend dashboard mostra logs de envio. Verificar se domínio foi verificado de verdade. Spam folder.

**Sitemap não submetido:** Google Search Console pode levar até 7 dias pra rastrear. Forçar via "Request indexing" em URLs específicas.
