# 🇧🇷 BrasilConnect USA — Como rodar

Dois jeitos de ver o site funcionando, do mais rápido pro mais completo.

## Opção 1 — Preview rápido (instantâneo, sem instalação)

**Dê dois cliques em `start-preview.bat`.**

Abre 6 abas no seu navegador padrão com as principais páginas estáticas:
- UTM Builder (admin)
- Guia de Chegada (lead magnet)
- Custo de vida em Austin
- Custo de vida em Miami
- Guia de CNH
- Página de Indicação

**Limitações:**
- Links internos podem não resolver (`/custo-de-vida/` vai 404)
- Cadastros na waitlist não salvam (precisa do API)
- Logos via Clearbit só carregam com internet

Use para sentir o tom do design, layout e tipografia.

---

## Opção 2 — Ambiente completo (Vite + APIs)

**Dê dois cliques em `start-dev.bat`.**

O script:
1. Verifica se Node.js está instalado (se não, mostra link para baixar)
2. Roda `npm install` se `node_modules` não existir
3. Instala Vercel CLI globalmente se não tiver
4. Avisa se faltar `.env.local` com chaves do Supabase/Resend
5. Sobe o dev server em `http://localhost:3000`
6. Abre o navegador automaticamente

URLs úteis no localhost:
- `/` — ComingSoon (lista de espera)
- `/?preview=brasil2026` — App completo (Remessas, Voos, Bolão, etc)
- `/custo-de-vida/` — 12 cidades
- `/guias/` — 6 guias passo a passo
- `/guia-chegada/` — Lead magnet
- `/indique/` — Programa de indicação
- `/admin/utm-builder` — UTM builder
- `/admin/waitlist` — Lista de espera (precisa ADMIN_SECRET)
- `/admin/analytics` — Dashboard (precisa ADMIN_SECRET)

**Para as APIs funcionarem 100%:**

Crie `.env.local` na raiz com (mínimo):
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
RESEND_API_KEY=re_xxxxx
ADMIN_SECRET=<gerar com: openssl rand -hex 32>
CRON_SECRET=<gerar com: openssl rand -hex 32>
```

Para parar o dev server, `Ctrl+C` na janela do terminal.

---

## Opção 3 — Deploy de verdade no Vercel

Para ver tudo em produção (com cron, domínio próprio, etc):

```
git add .
git commit -m "Fase 3 completa"
git push
```

Vercel faz deploy automático. As env vars vão em **Vercel → Settings → Environment Variables**.

---

## SQLs para rodar no Supabase

Antes do primeiro uso, rode esses arquivos no Supabase SQL Editor (na ordem):

1. `supabase/bc_waitlist.sql` — lista de espera
2. `supabase/bc_drip_log.sql` — tracking de drip emails
3. `supabase/bc_referrals.sql` — programa de indicação
4. `supabase/bc_affiliate_clicks_v2.sql` — colunas UTM no tracking de afiliados
5. `supabase/bc_businesses_schema.sql` — diretório de negócios (já existia)

---

## Regenerar landing pages SEO

Se editar `scripts/data/cities.json` ou `scripts/data/guides.json`:

```
node scripts/build-landing-pages.js
```

Regenera as 21 páginas + sitemap em segundos.
