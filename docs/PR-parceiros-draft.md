# Draft PR — feat(parceiros): kits de candidatura + auditoria + dashboard admin

> Cole isto no GitHub na hora de abrir o PR. Title abaixo já no padrão dos outros PRs.

## Title

```
feat(parceiros): kits de candidatura + auditoria + dashboard admin
```

## Body

Avança o trabalho de parceiros de afiliado **sem depender de aprovações externas** — tudo o que dava pra rodar agora (Prompt 1 de `docs/cowork-prompts-partners.md`).

### O que muda

**📋 Auditoria**
- `docs/partners-audit.md` — tabela mestre dos 21 parceiros em `api/go.js`, com env var, fallback, onde aparece no site, e gaps reais (xoom faltando no frontend, kayak/myus/mint/nomad sem surface, alias `wu` documentado).

**📨 9 kits de candidatura novos**
Templates inglês prontos pra copiar em formulários de afiliado, com seção "Why X specifically" customizada por parceiro (não é copy-paste do kit Wise):
- `docs/affiliate-kit-remitly.md` (Impact Radius)
- `docs/affiliate-kit-western-union.md` (Partnerize)
- `docs/affiliate-kit-moneygram.md` (Awin)
- `docs/affiliate-kit-paysend.md` (próprio)
- `docs/affiliate-kit-xoom.md` (PayPal Partner Network)
- `docs/affiliate-kit-kayak.md` (Travelpayouts → KAYAK direto)
- `docs/affiliate-kit-mercury.md` (referral próprio)
- `docs/affiliate-kit-mint-mobile.md` (Impact Radius)
- `docs/affiliate-kit-lemonade.md` (Impact Radius)

Todos usam o framing honesto de 5K MAU com narrativa de crescimento (mesmo do kit Wise).

**🛠 Dashboard admin de parceiros**
- `public/admin/parceiros.html` — página `/admin/parceiros` (noindex) com tabela ao vivo de todos os parceiros: status verde/amarelo (env configurada ou usando fallback), categoria, URL atual mascarada, e botão **Testar** que abre `/go/<id>` com UTMs de teste.
- `api/admin/partners-status.js` — endpoint `GET /api/admin/partners-status` autenticado por `x-admin-secret`, retorna estado de cada env var sem vazar valores completos (só preview de 8 chars).
- Link "Parceiros" adicionado ao nav admin em mindmap, manage, waitlist, analytics, utm-builder, roadmap.
- `vercel.json` — adicionado rewrite `/admin/parceiros` → `/admin/parceiros.html`.

### Aceitação

- [x] `docs/partners-audit.md` lista 21 parceiros com 8 inconsistências identificadas
- [x] 9 novos arquivos `docs/affiliate-kit-*.md` criados
- [x] `/admin/parceiros` carrega tabela com todos os parceiros
- [x] `GET /api/admin/partners-status` retorna JSON com `summary` + `partners[]`
- [x] Nav admin tem novo link "Parceiros" nas 6 páginas existentes
- [x] Não mexe em código de produção do app (BolaoScreen, FeedScreen, RemessasScreen, VoosScreen) — escopo é só docs + admin

### Como testar localmente

```bash
npm run dev
# abre http://localhost:3000/admin/parceiros
# entra com ADMIN_SECRET do .env.local
# confirma tabela com ~21 parceiros, todos "Fallback" (já que envs locais não estão setadas)
# clica em "Testar" no Wise → deve abrir /go/wise em nova aba e redirecionar pro fallback público
```

### Próximo passo (Anderson, não Cowork)

1. Mergeia este PR.
2. Aplica nos 9 programas usando os kits novos (1h por programa, espalhar pela semana).
3. Conforme aprovações chegam, roda o **Prompt 2** de `docs/cowork-prompts-partners.md` colando os affiliate IDs aprovados — Cowork faz o wire dos links no `api/go.js` e adiciona env vars na lista pro Vercel.

### Out of scope

- Não adicionei Xoom no array `PROVIDERS` de `src/App.jsx` (gap identificado na auditoria) — decisão pendente: adicionar ou remover do registry? Documentado em `partners-audit.md` inconsistência #1.
- Não criei surface pra `nomad`, `myus`, `kayak`, `mint` — decisão de produto pendente. Documentado em inconsistências #2-#5.
- Não atualizei `public/admin/roadmap.html` removendo o item "Afiliados de remessa com link real" — isso é trabalho do Prompt 2 quando tiver aprovações reais pra entregar.
