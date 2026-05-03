# 🇧🇷 BrasilConnect USA — Status enquanto você dormia

Trabalhei nos módulos do histórico que você colou. Tudo construído com paleta premium, validado e pronto pra deploy.

---

## ✅ O que foi adicionado nesta sessão (depois do AgendaPro)

### Schemas SQL (rodar no Supabase)
- `bc_interests_schema.sql` — 26 interesses + 8 grupos família com threshold configurável
- `bc_profiles_schema.sql` — perfis com 4 camadas de privacidade + função `get_public_profile`
- `bc_push_subscriptions.sql` — Web Push subscriptions
- `bc_businesses_v2.sql` — adiciona listing_plan, leads, clicks, trigger de rating ao schema existente

### APIs (7 novas)
- `POST /api/businesses/list` + `/api/businesses/submit`
- `POST /api/interests/signup` (lógica de cold-start com threshold dinâmico)
- `POST /api/profile/update`
- `POST /api/push/subscribe` + `/api/push/notify` (com web-push)
- `POST /api/agenda/deposit` (Zelle confirmação manual)

### Páginas estáticas
- `/negocio/index.html` — diretório de negócios brasileiros, busca + filtros + form de cadastro
- `/grupos/index.html` — landing de grupos de interesse com 26 interesses, modal de signup com barra de progresso, grupos família com flag sensível
- `/viagem/index.html` — 3 abas: hotéis (9 cidades), parques (6 cidades com Disney/Universal/SeaWorld/etc), simulador completo de roteiro com cálculo automático

### PWA (instalável no celular)
- `public/manifest.json` — nome, ícones, shortcuts (Remessas, Agenda, Voos)
- `public/sw.js` — Service Worker com 3 estratégias (Network First p/ APIs, Cache First p/ assets, Stale While Revalidate p/ HTML)
- `public/offline.html` — fallback elegante com auto-retry
- `src/pwa.js` — utilitários (initPWA, subscribeToPush, showInstallPrompt)
- `src/main.jsx` — registra SW automaticamente
- `index.html` — link manifest + apple-touch-icon

### Componente React
- `src/ProfileApp.jsx` — 3 abas (Perfil/Privacidade/Notificações), seletor de cor de avatar, controle de privacidade por campo (público/comunidade/grupo/privado)

### Vercel + Sitemap
- 4 rotas novas no `vercel.json`: `/negocio`, `/negocio/:slug`, `/grupos`, `/viagem`
- Headers especiais pro `sw.js` (Service-Worker-Allowed) e `manifest.json`
- Sitemap regenerado com 4 URLs novas

---

## 📊 Resumo final do projeto

| Categoria | Total |
|---|---|
| Schemas SQL | 12 |
| APIs serverless | 30 |
| Páginas estáticas | 26 |
| Componentes React | 7 (App, AgendaApp, ComingSoon, ProfileApp, BolaoScreen, NegociosScreen, main) + pwa.js |
| Crons agendados | 3 (check-alerts, drip, agenda-reminders) |

---

## 🔧 Para o deploy funcionar 100%

**Rodar no Supabase SQL Editor (na ordem):**
1. `agenda_schema.sql` (do AgendaPro completo — 11 tabelas)
2. `bc_interests_schema.sql`
3. `bc_profiles_schema.sql`
4. `bc_push_subscriptions.sql`
5. `bc_businesses_v2.sql` (só se já rodou bc_businesses_schema.sql antes)

**Env vars adicionais no Vercel (alguns já existem):**
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PREMIUM`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` (gerar com `npx web-push generate-vapid-keys`)
- `VITE_VAPID_PUBLIC_KEY` (mesmo valor da public)
- `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`
- `INTEREST_THRESHOLD=10` (opcional — global)

**Deploy:**
```
vercel --prod
```

---

## 🚧 O que ainda falta (do histórico que você colou)

Esses precisam de Supabase Auth ativo + tempo extra:

- **AuthFlow.jsx** — Login/cadastro completo + onboarding em 4 passos
- **Dashboard.jsx** — visões profissional + admin com Recharts
- **AgendaPlans.jsx** — página editorial de planos com Stripe Checkout
- **GroupsApp.jsx** — app interno pra membros pagantes (já tem landing /grupos/)
- **ReviewsTab.jsx** — aba de reviews dentro do AgendaApp
- **Realtime no AgendaApp** — Supabase Realtime + push notifications
- **Página /guias/util/** — útil-links com simulador de custo de vida (versão SPA — já tem 6 guias estáticos SEO)

---

## 🎯 Próximos passos quando acordar

1. **Rodar os 4 SQLs novos** no Supabase (5 min)
2. **`vercel --prod`** pra subir tudo (1 min)
3. **Testar:**
   - `https://brasilconnectusa.com/negocio/` — diretório
   - `https://brasilconnectusa.com/grupos/` — interesses
   - `https://brasilconnectusa.com/viagem/` — simulador
   - Instalar como PWA (Chrome → menu → "Instalar app")
4. **Cadastrar 1 negócio teste** via `/negocio/#cadastro` pra ver fluxo
5. **Cadastrar email em 1 interesse** com threshold baixo (gêmeos = 4) e ver progresso

Bom descanso. ☕
