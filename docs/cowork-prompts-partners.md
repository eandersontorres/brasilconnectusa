# Prompts para Cowork — Pendências de Parceiros (Remessa + Voo)

> Como usar: abre Cowork, cola um dos prompts abaixo, deixa rodar. Cada prompt é auto-contido — o agente não tem memória da nossa conversa.

---

## ⚠️ O que humano precisa fazer (não delegável)

Antes de qualquer coisa, **você** precisa fazer essas coisas que nenhum agente pode fazer:

1. **Aplicar nos programas de afiliado** (Wise, Remitly, WU, KAYAK, etc.) — exigem W-9, dados bancários, verificação de identidade
2. **Receber aprovação e affiliate ID/link** de cada um (2-7 dias úteis por programa)
3. **Adicionar env vars no Vercel** com os links aprovados (Settings → Environment Variables)
4. **Redeploy** depois de adicionar as env vars

Use o kit pronto em [`docs/affiliate-kit-wise.md`](./affiliate-kit-wise.md) como template — o Prompt 1 abaixo gera kits semelhantes pros outros 9 parceiros.

---

## 🚀 Prompt 1 — Pra rodar AGORA (não depende de aprovações)

> Auditoria + kits de candidatura + dashboard admin. Tudo paralelizável, ~30min de trabalho do agente.

```
Você está trabalhando no projeto BrasilConnect USA (C:\Dev\brasilconnectusa) — plataforma para a comunidade brasileira nos EUA. Stack: Vite + React (SPA), Vercel serverless, Supabase. Idioma das mensagens ao usuário: português brasileiro.

Sua missão: avançar o trabalho de parceiros de afiliado (remessa + voo + viagem) sem depender de aprovações externas.

CONTEXTO ESSENCIAL — leia esses arquivos antes de começar:
- api/go.js — redirector central /go/<partner> com tracking
- api/_lib/partners-remittance.js — registry canônico dos parceiros de remessa
- docs/affiliate-kit-wise.md — kit de candidatura ao Wise (template a replicar)
- public/admin/roadmap.html — roadmap atual com pendências

PARCEIROS NO REGISTRY (api/go.js):
Remessa:        wise, remitly, western_union, moneygram, paysend, nomad, xoom
Voo:            kayak
Viagem (Fase 2): booking, expedia, undercover, klook, viator, getyourguide
Tier 0:         lemonade, mint, mercury, myus, zenbusiness, capitalone

ESTADO ATUAL: cada parceiro tem env var (ex: AFFILIATE_WISE_LINK) com fallback público. Se a env não existe no Vercel, /go/wise redireciona pra wise.com sem ID de afiliado — sem comissão.

ENTREGÁVEIS (3, em ordem):

═══════════════════════════════════════════════════════════════
ENTREGÁVEL 1: AUDITORIA DE ESTADO ATUAL
═══════════════════════════════════════════════════════════════

Crie docs/partners-audit.md com:
- Tabela de TODOS os parceiros listados em api/go.js
- Colunas: ID | Nome | Categoria (remessa/voo/viagem/tier0) | Env var name | Fallback URL | Onde aparece no site (grep public/ + src/)
- Identifica parceiros que aparecem em /remessas mas não em api/go.js (ou vice-versa) — inconsistências
- Identifica parceiros listados em api/_lib/partners-remittance.js que faltam em api/go.js

═══════════════════════════════════════════════════════════════
ENTREGÁVEL 2: KITS DE CANDIDATURA (9 arquivos novos)
═══════════════════════════════════════════════════════════════

Replica a estrutura de docs/affiliate-kit-wise.md para CADA parceiro abaixo, gerando UM arquivo por parceiro:

  docs/affiliate-kit-remitly.md       (rede: Impact Radius)
  docs/affiliate-kit-western-union.md (rede: Partnerize)
  docs/affiliate-kit-moneygram.md     (rede: Awin)
  docs/affiliate-kit-paysend.md       (próprio: paysend.com/affiliates)
  docs/affiliate-kit-xoom.md          (PayPal Partner Network)
  docs/affiliate-kit-kayak.md         (próprio: kayak.com/affiliates ou Travelpayouts)
  docs/affiliate-kit-mercury.md       (próprio: mercury.com/partners)
  docs/affiliate-kit-mint-mobile.md   (Impact Radius)
  docs/affiliate-kit-lemonade.md      (Impact Radius)

Cada kit deve ter:
- 11 seções iguais às do kit Wise (Site name, URL, descrições short/long, audience, traffic, promotion strategy, why this partner, methods checklist, compliance, contact, depois de enviar)
- Seção 8 "Why X specifically" CUSTOMIZADA — pesquisa o produto e escreve 3 razões reais por que esse parceiro faz sentido pro nicho brasileiro nos EUA
- Tráfego: usar 5,000 MAU honesto com framing de crescimento (mesmo do kit Wise)
- Idioma: inglês (formulários são em inglês), com notas em PT no topo do arquivo

═══════════════════════════════════════════════════════════════
ENTREGÁVEL 3: DASHBOARD ADMIN DE STATUS
═══════════════════════════════════════════════════════════════

Cria public/admin/parceiros.html — página admin (noindex) que mostra:
- Tabela de cada parceiro com colunas: ID | Categoria | Env configurada? (verde/vermelho) | URL atual (env ou fallback) | Botão "Testar /go/<id>"
- Adiciona endpoint api/admin/partners-status.js que retorna JSON do estado de cada env var (presente/ausente, primeiros 8 chars do valor — não vazar segredo)
- Link na nav admin (public/admin/roadmap.html, manage.html, etc) pra "Parceiros"
- Visual: usa css/premium.css que já existe (mesmo template das outras admin pages)
- Auth: header x-admin-secret igual aos outros endpoints admin

ACEITAÇÃO:
- `npx vite build` passa
- /admin/parceiros mostra tabela com todos os 18+ parceiros
- Pelo menos 9 novos arquivos docs/affiliate-kit-*.md criados
- docs/partners-audit.md identifica gaps reais

OPEN PR com título "feat(parceiros): kits de candidatura + auditoria + dashboard admin" no padrão dos PRs anteriores. NÃO mexe em código de produção do app (BolaoScreen, FeedScreen, etc) — escopo é só docs + admin.
```

---

## 🔧 Prompt 2 — Pra rodar DEPOIS que você tiver os affiliate IDs aprovados

> Wiring final dos links + verificação de tracking. Roda quando você tiver pelo menos 1 affiliate ID em mãos.

```
Você está trabalhando no projeto BrasilConnect USA. Acabei de receber aprovação dos seguintes programas de afiliado:

[ANDERSON: cola aqui os parceiros aprovados + affiliate ID/link de cada um]
Exemplo:
  Wise → https://wise.com/invite/u/andersonk?utm_source=brasilconnect
  Remitly → https://remit.ly/abc123
  KAYAK → https://www.kayak.com/in?affid=brasilconnectusa

Sua missão: garantir que esses links estão wired corretamente no projeto e funcionando.

PASSOS:

1. Pra cada parceiro aprovado, verifica em api/go.js qual o nome da env var (ex: AFFILIATE_WISE_LINK)
2. Atualiza o FALLBACK em api/go.js trocando o link genérico pelo affiliate link real (assim mesmo se a env do Vercel falhar, o link real é usado)
3. Verifica se o partner aparece em api/_lib/partners-remittance.js — se sim, atualiza fx_margin e flat_fee_usd com valores ATUAIS pesquisando os pricing pages oficiais (web search)
4. Roda `curl -I http://localhost:3000/go/<partner>` localmente (com `npm run dev` em background) e confirma que retorna 302 com Location apontando pro link novo
5. Atualiza docs/partners-audit.md (criado no Prompt 1) marcando os parceiros agora "live"
6. Atualiza public/admin/roadmap.html removendo o item "Afiliados de remessa com link real" do bloco PENDÊNCIA — mover pra ENTREGUE com data de hoje
7. Open PR "feat(parceiros): wire links de afiliado aprovados (<lista>)"

INSTRUÇÕES PRA ANDERSON ADICIONAR NO VERCEL (incluir no PR description):
- Settings → Environment Variables
- Adicionar pra Production + Preview + Development:
    AFFILIATE_<X>_LINK = <link>
- Após adicionar TODAS, fazer Redeploy do último deploy SEM Build Cache

NÃO MEXE em outros parceiros que não estão na lista de aprovados — fallback genérico continua válido até aprovação.
```

---

## 📋 Ordem recomendada

1. **Hoje:** roda Prompt 1 no Cowork → te entrega 9 kits + auditoria + dashboard
2. **Esta semana:** você abre os formulários e aplica usando cada kit (1h por aplicação)
3. **2-7 dias depois:** conforme aprovações chegam, roda Prompt 2 pra cada lote (pode rodar quantas vezes precisar)

## 💡 Dica

Roda o Prompt 1 com `isolation: worktree` ativado no Cowork — assim ele cria uma branch limpa e o trabalho fica isolado do que você tá fazendo na main.
