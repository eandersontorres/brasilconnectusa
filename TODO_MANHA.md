# 📋 Pra fazer de manhã (Anderson)

> Tudo pronto enquanto você dormiu. 4 sessões grandes implementadas — só falta deploy + setup das novas envs/SQLs.

## 🚀 Passo 1 — Deploy (PowerShell, ~2min)

```powershell
cd C:\Dev\brasilconnectusa
Remove-Item -Force .git\index.lock -ErrorAction SilentlyContinue
git add -A
git commit -m "feat: noite produtiva — push topics, hooks reais, geocoding, restaurant fase 1, compliance, notif in-app, mentions, moderacao"
git push origin main
```

Vercel deploya automático em ~1 min.

## 🗄️ Passo 2 — Rodar SQLs no Supabase (~5min total)

Abre Supabase → SQL Editor → cola e Run cada um na ordem:

```
1.  supabase/fix_bc_profiles_user_id.sql        (se ainda não rodou)
2.  supabase/bc_enterprise_leads.sql             (leads Enterprise)
3.  supabase/bc_profiles_radius.sql              (cidade + raio)
4.  supabase/bc_servicos_nacional.sql            (21 categorias)
5.  supabase/bc_storage_bucket.sql               (upload fotos)
6.  supabase/bc_restaurant_schema.sql            (Restaurant Fase 1)
7.  supabase/bc_geocode_cache.sql                (cache geocoding)
8.  supabase/bc_push_topics.sql                  (tópicos push)
9.  supabase/bc_push_email.sql                   (push por email)
10. supabase/bc_notifications.sql                (notif in-app)
11. supabase/bc_moderation.sql                   (moderação)
```

## 🔑 Passo 3 — Env vars no Vercel (Settings → Environment Variables)

```
STRIPE_SECRET_KEY            sk_test_... (já tem)
STRIPE_PUBLISHABLE_KEY       pk_test_... ← NOVA pra Restaurant
STRIPE_PRICE_STARTER         price_... (já tem)
STRIPE_PRICE_PRO             price_... (já tem)
STRIPE_PRICE_PREMIUM         price_... (já tem)
STRIPE_WEBHOOK_SECRET        whsec_... (já tem)

VAPID_PUBLIC_KEY             ← gera com `npx web-push generate-vapid-keys`
VAPID_PRIVATE_KEY            ← mesmo comando
VAPID_SUBJECT                mailto:oi@brasilconnectusa.com

(já existentes: SUPABASE_*, RESEND_API_KEY, ADMIN_SECRET)
```

Depois de adicionar: **Deployments → último → ⋯ → Redeploy** (sem Build Cache).

## 🔔 Passo 4 — Stripe Webhook (Dashboard → Webhooks → Edit)

Adicionar novos eventos no endpoint existente:
- ✅ `account.updated` (Restaurant Connect)
- ✅ `payment_intent.succeeded` (Restaurant order)
- ✅ `payment_intent.payment_failed` (Restaurant order)

(já tem: checkout.session.completed, customer.subscription.*, invoice.payment_failed)

## 🧪 Passo 5 — Testes manuais (quando tiver tempo)

| Feature | Teste rápido |
|---|---|
| Push topics | `/?preview=brasil2026` → 🔕 → marca tópicos → "Ativar alertas" → vira 🔔 verde |
| Restaurant onboarding | `/assinante` → Meu Negócio → "Ativar pedidos →" → completa Stripe |
| Cardápio | `/assinante` → Cardápio → cria item com foto |
| Pedido | `/negocio/{slug}/cardapio` → adiciona item → checkout `4242...` → vê tracker `/pedido/{id}` |
| Bolão admin | `/admin/manage` → Bolão Copa → salva placar 1×0 |
| Moderação | `/admin/manage` → Moderação → tem denúncias? Dispensa/Apaga |
| Notif in-app | Faça um comentário em post de outro user → ele vê sino com badge |
| Filtro raio | Onboarding com cidade Boston → feed deve filtrar comunidades a 10mi de Boston |
| Termos/Privacidade | `brasilconnectusa.com/termos` e `/privacidade` devem abrir |

## 📦 O que foi entregue na noite (resumo)

### Compliance (✅)
- `api/_lib/rateLimit.js` — helper in-memory aplicado em /contact, /enterprise-lead, /waitlist, /geocode
- `vercel.json` — CSP + X-Frame-Options + HSTS + Permissions-Policy
- `public/termos.html` + `public/privacidade.html` — pages LGPD-friendly em /termos e /privacidade

### Notificações in-app (✅)
- `supabase/bc_notifications.sql` — tabela
- `api/notifications.js` — GET/POST com mark-read + create
- `api/_lib/notify.js` — helper que cria notif + dispara push junto
- `src/NotificationBell.jsx` — sino com badge de unread + dropdown lista
- **Pendente:** plugar `<NotificationBell user={user} />` no AppShell.jsx (precisa do user object da auth)

### Mentions (✅)
- `src/lib/mentions.js` — extractMentions + renderTextWithMentions
- `api/social.js` — `extractMentionUsernames()` server-side
- Hook em `create-comment`: notifica autor do post + autor do parent + mentioned users

### Moderação (✅)
- `supabase/bc_moderation.sql` — status nos reports + tabela banned_users
- `api/admin/reports.js` — GET/POST resolve com option de deletar conteúdo
- Tab "Moderação" no `/admin/manage` com botões Dispensar / Marcar revisado / Apagar

### Geocoding & Filtro Raio (✅)
- `supabase/bc_geocode_cache.sql` — cache + lat/lng em comunidades
- `api/geocode.js` — Nominatim + cache + endpoint público
- `api/profile.js` — auto-geocode em onboarding
- `api/social.js` feed — filtro Haversine
- `api/businesses/list.js` — mesmo filtro Haversine
- `api/_lib/cityPresets.js` — 50+ cidades classificadas
- `api/suggest-radius.js` — endpoint que recomenda raio
- `src/OnboardingFlow.jsx` — onBlur na cidade auto-sugere raio

### Push topics + hooks reais (✅)
- `supabase/bc_push_topics.sql` + `bc_push_email.sql`
- `api/push/subscribe.js` — POST/PATCH/GET/DELETE com tópicos
- `src/PushPrompt.jsx` — modal com 6 checkboxes
- `api/_lib/push.js` — helper `sendPushTo({user_id, user_email, topic, ...})`
- Hook em `webhook.js` payment_intent.succeeded → push pro dono
- Hook em `restaurant/orders.js` update-status → push pro cliente

## 🧰 Pra próxima sessão (quando voltar)

| Prioridade | Item | Esforço |
|---|---|---|
| 🔥 Alta | Plugar `<NotificationBell />` no AppShell.jsx | 30min |
| 🔥 Alta | Eventos RSVP funcional + lembrete push T-24h | 1.5h |
| 🔥 Alta | Sistema DM (mensagens diretas user-user) | 2h |
| 🟡 Média | LGPD cookie banner pop-up | 1h |
| 🟡 Média | 2FA admin (TOTP) | 2h |
| 🟡 Média | Restaurant Fase 2 — Delivery | 2-3 dias |
| 🟡 Média | Marketing landing pages /florida /texas /etc | 2 dias |
| 🟢 Baixa | Atualizar mind map admin com tudo novo | 30min |
| 🟢 Baixa | Stories tipo Instagram (24h) | 4h |
| 🟢 Baixa | Mapa interativo de negócios (Mapbox/Leaflet) | 3h |

## ⚠️ Coisas pra ficar de olho

1. **File truncation:** continuamos batendo no limite de Edit em arquivos grandes. Pra arquivos > 500 linhas, **sempre** abro com Read + uso bash heredoc/python pra evitar corromper.

2. **Testes E2E manuais:** ainda não rodei o fluxo completo de Restaurant ponta a ponta porque preciso do Stripe ativado por você. Quando ativar, manda print do primeiro pedido teste pra eu confirmar tudo funcionando.

3. **Backfill de geocoding:** depois que rodar bc_geocode_cache.sql, chama uma vez:
   ```bash
   curl -X POST "https://brasilconnectusa.com/api/admin/geocode-backfill?limit=20" \
     -H "x-admin-secret: SUA_ADMIN_SECRET"
   ```
   Roda 2-3 vezes pra geocodar todas as comunidades de cidade existentes.

4. **NotificationBell precisa de user com id**: hoje `App.jsx` não passa user pra ele. Quando você quiser ativar, eu integro com o useAuth() do AuthModal — tem que passar `<NotificationBell user={user} />` num lugar visível (talvez no AppShell topbar).

Bom dia quando acordar! 🌅 Manda print se algo quebrar.
