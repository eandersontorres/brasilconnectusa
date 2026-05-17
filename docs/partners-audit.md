# Auditoria de Parceiros — BrasilConnect USA

> Snapshot do estado dos parceiros de afiliado registrados em `api/go.js`, cruzado com onde cada um aparece no site e onde aparece na fonte de verdade de remessas (`api/_lib/partners-remittance.js`).
>
> **Como usar:** sempre que um parceiro for aprovado, atualize a coluna "Status" e marque "Env configurada?". Esta tabela é a fonte de verdade humana — o dashboard `/admin/parceiros` é a versão automatizada via env vars.
>
> **Última varredura:** 2026-05-14 (gerada pelo agente)

---

## 📊 Tabela mestre — todos os parceiros em `api/go.js`

| # | ID                | Nome              | Categoria   | Env var                       | Fallback (sem afiliado)                                                                 | Onde aparece no site                                                                 | Status     |
|---|-------------------|-------------------|-------------|-------------------------------|------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|------------|
| 1 | `lemonade`        | Lemonade          | Tier 0      | `AFFILIATE_LEMONADE_LINK`     | `https://www.lemonade.com/`                                                              | `/guia-chegada` (seguro auto), `/guias/cnh` (seguro auto pós-CNH)                      | Pendente   |
| 2 | `mint`            | Mint Mobile       | Tier 0      | `AFFILIATE_MINT_LINK`         | `https://www.mintmobile.com/`                                                            | _(nenhum CTA ativo — usar em guia conta-bancaria/SIM-pre-SSN)_                         | Pendente   |
| 3 | `mercury`         | Mercury           | Tier 0      | `AFFILIATE_MERCURY_LINK`      | `https://mercury.com/`                                                                   | `/guias/conta-bancaria`, `/guias/abrir-llc`                                            | Pendente   |
| 4 | `myus`            | MyUS              | Tier 0      | `AFFILIATE_MYUS_LINK`         | `https://www.myus.com/`                                                                  | _(nenhum CTA ativo — gap)_                                                             | Pendente   |
| 5 | `zenbusiness`     | ZenBusiness       | Tier 0      | `AFFILIATE_ZENBUSINESS_LINK`  | `https://www.zenbusiness.com/`                                                           | `/guias/abrir-llc`                                                                     | Pendente   |
| 6 | `capitalone`      | Capital One       | Tier 0      | `AFFILIATE_CAPITALONE_LINK`   | `https://www.capitalone.com/`                                                            | `/guia-chegada`, `/guias/conta-bancaria`                                               | Pendente   |
| 7 | `wise`            | Wise              | Remessa     | `AFFILIATE_WISE_LINK`         | `https://wise.com/send`                                                                  | `/app` aba Remessas (RemessasScreen em `src/App.jsx`)                                  | Pendente   |
| 8 | `remitly`         | Remitly           | Remessa     | `AFFILIATE_REMITLY_LINK`      | `https://www.remitly.com/us/en/brazil`                                                   | `/app` aba Remessas                                                                    | Pendente   |
| 9 | `western_union`   | Western Union     | Remessa     | `AFFILIATE_WU_LINK`           | `https://www.westernunion.com/us/en/send-money/app/start`                                | `/app` aba Remessas                                                                    | Pendente   |
|10 | `wu` (alias)      | Western Union     | Remessa     | `AFFILIATE_WU_LINK`           | _(igual ao acima)_                                                                       | _(alias somente; nenhum link interno usa `/go/wu` hoje)_                              | Alias      |
|11 | `moneygram`       | MoneyGram         | Remessa     | `AFFILIATE_MONEYGRAM_LINK`    | `https://www.moneygram.com/mgo/us/en/send-money/send-to/brazil/`                         | `/app` aba Remessas                                                                    | Pendente   |
|12 | `paysend`         | Paysend           | Remessa     | `AFFILIATE_PAYSEND_LINK`      | `https://paysend.com/en-us/send-money/to/brazil`                                         | `/app` aba Remessas                                                                    | Pendente   |
|13 | `nomad`           | Nomad             | Remessa BR→US| `AFFILIATE_NOMAD_LINK`       | `https://www.nomadglobal.com/`                                                           | _(nenhum CTA ativo — direção inversa, sem surface dedicada)_                           | Pendente   |
|14 | `xoom`            | Xoom (PayPal)     | Remessa     | `AFFILIATE_XOOM_LINK`         | `https://www.xoom.com/brazil/send-money`                                                 | _(nenhum CTA ativo — em registry mas fora da RemessasScreen)_                          | Pendente   |
|15 | `kayak`           | KAYAK             | Voo         | `AFFILIATE_KAYAK_LINK`        | `https://www.kayak.com/`                                                                 | _(nenhum CTA ativo — VoosScreen existe mas usa Google Flights/widget interno)_         | Pendente   |
|16 | `booking`         | Booking.com       | Viagem F2   | `AFFILIATE_BOOKING_LINK`      | `https://www.booking.com/`                                                               | _(módulo Fase 2 — sem surface ainda)_                                                  | Fase 2     |
|17 | `expedia`         | Expedia           | Viagem F2   | `AFFILIATE_EXPEDIA_LINK`      | `https://www.expedia.com/`                                                               | _(módulo Fase 2)_                                                                      | Fase 2     |
|18 | `undercover`      | Undercover Tourist| Viagem F2   | `AFFILIATE_UNDERCOVER_LINK`   | `https://www.undercovertourist.com/`                                                     | _(módulo Fase 2)_                                                                      | Fase 2     |
|19 | `klook`           | Klook             | Viagem F2   | `AFFILIATE_KLOOK_LINK`        | `https://www.klook.com/`                                                                 | _(módulo Fase 2)_                                                                      | Fase 2     |
|20 | `viator`          | Viator (Tripadvisor)| Viagem F2 | `AFFILIATE_VIATOR_LINK`       | `https://www.viator.com/`                                                                | _(módulo Fase 2)_                                                                      | Fase 2     |
|21 | `getyourguide`    | GetYourGuide      | Viagem F2   | `AFFILIATE_GETYOURGUIDE_LINK` | `https://www.getyourguide.com/`                                                          | _(módulo Fase 2)_                                                                      | Fase 2     |

**Status:**
- **Pendente** = env var não existe no Vercel; `/go/<id>` resolve pro fallback público sem ID de afiliado, então não geramos comissão.
- **Aprovado** = afiliado aprovado e env var configurada — comissão rolando.
- **Alias** = entrada redundante (ex: `wu` → mesmo destino de `western_union`); existe pra resiliência se algum link interno usar grafia alternativa.
- **Fase 2** = parceiro registrado pro módulo 11 (Viagem); ainda sem surface no produto, deixar pendente até esse módulo entrar no roadmap.

---

## 🔀 Inconsistências encontradas

### 1. Xoom está no registry de remessas mas não aparece na RemessasScreen do app

**Onde:** `api/_lib/partners-remittance.js` lista `xoom` como provider (linhas 64-79), mas o array `PROVIDERS` em `src/App.jsx` (linhas 27-113) só tem **5 providers**: `wise`, `remitly`, `western_union`, `moneygram`, `paysend`.

**Impacto:** A página `/app#remessas` não mostra Xoom — usuário com PayPal não vê a opção, e o endpoint `/api/remittance/quote` retorna Xoom mas o frontend ignora.

**Sugestão:** Adicionar Xoom ao array `PROVIDERS` em `src/App.jsx` antes da próxima sprint de remessas (cores PayPal: `#003087`, fee ~$4.99, spread ~2.5%), OU remover do registry caso a decisão seja não mostrar.

### 2. Nomad é direção inversa (BR→USA) e não tem surface dedicada

**Onde:** `partners-remittance.js` linha 132-148 marca Nomad com `direction: 'BR_TO_US'`, e a função `getUsaToBrazilPartners()` (linha 158) filtra ele fora corretamente. Mas não há nenhuma surface no produto que use Nomad — nem como conta dólar pra novos imigrantes, nem em guia de saída de USA.

**Impacto:** O env var existe e o `/go/nomad` redireciona, mas nenhum CTA aponta pra lá. Comissão zerada por design (sem tráfego).

**Sugestão:** Decidir se Nomad fica como reserva (deixar pendente sem aplicar) ou se vai entrar no `/guia-chegada` como opção de conta dólar pra brasileiros que querem manter USD após retorno.

### 3. KAYAK registrado mas sem surface

**Onde:** `api/go.js` linha 39 (`kayak`), `.env.example` linha 35. Mas o tab `/app#voos` (VoosScreen) usa o endpoint `/api/flights/search` (Travelpayouts/Aviasales) — não tem CTA pra `/go/kayak`.

**Impacto:** Mesmo se KAYAK afiliado for aprovado, não há tráfego pra ele.

**Sugestão:** No VoosScreen, adicionar um CTA "Comparar mais opções" abaixo dos resultados que aponte pra `/go/kayak?campaign=app_voos&utm_source=app&utm_medium=voos` (ver Entregável 2 — `affiliate-kit-kayak.md`).

### 4. MyUS sem surface

**Onde:** `api/go.js` linha 24, `.env.example` linha 55. Não há nenhum guia que mencione MyUS hoje.

**Impacto:** Idêntico aos outros — env var ociosa.

**Sugestão:** Criar um guia `/guias/comprar-eua-receber-brasil` (caixa postal americana pra família no Brasil) e usar `/go/myus` como CTA principal. Ou remover do registry até que a surface exista.

### 5. Mint Mobile sem surface

**Onde:** `api/go.js` linha 22. Não há CTA pra `/go/mint` nas guides atuais.

**Impacto:** Env var ociosa.

**Sugestão:** Adicionar bloco "Linha pré-paga antes do SSN" no `/guias/conta-bancaria` ou `/guia-chegada` apontando pra `/go/mint?campaign=guia_chegada_mint`.

### 6. Alias `wu` sem uso interno

**Onde:** `api/go.js` linha 32 duplica `wu` → `AFFILIATE_WU_LINK`. Nenhum link em `public/` ou `src/` usa `/go/wu` (todos usam `/go/western_union`).

**Impacto:** Inofensivo — defensivo contra erros de digitação. Pode ficar.

### 7. `western_union` em `partners-remittance.js` × só `western_union` no go.js

**Onde:** Consistente — ambos usam `western_union` como `id` canônico. O `wu` é só alias em `go.js`.

**Sem ação necessária.**

### 8. Parceiros de Viagem (Fase 2) registrados mas sem surface

`booking`, `expedia`, `undercover`, `klook`, `viator`, `getyourguide` — todos registrados em `go.js` e `.env.example` mas sem CTA em lugar nenhum porque o módulo 11 (Viagem) ainda não foi construído.

**Sem ação necessária** até o módulo 11 entrar na sprint. Manter envs pendentes.

---

## ✅ Resumo executivo

| Métrica | Valor |
|---|---|
| Parceiros registrados em `api/go.js` | 21 (20 únicos + 1 alias) |
| Em `partners-remittance.js` (registry de remessa) | 7 |
| Em `src/App.jsx` PROVIDERS (RemessasScreen) | 5 |
| Tier 0 (quick wins) | 6 |
| Remessa | 7 (8 contando alias) |
| Voo | 1 (KAYAK) |
| Viagem Fase 2 | 6 |
| **Com surface real no site hoje** | 6 (lemonade, capitalone, mercury, zenbusiness, wise, remitly, wu, moneygram, paysend — alguns sobrepondo) |
| **Com surface mas sem env aprovada** | 9 (todos os pendentes acima) |
| **Sem surface e sem env** | 6 (Fase 2) + 4 (kayak, myus, mint, nomad) = 10 |

**Prioridade humana imediata (Anderson):**
1. Aplicar nos 9 programas da lista do Prompt 2 (kits prontos em `docs/affiliate-kit-*.md`).
2. Decidir destino de `xoom` em `src/App.jsx` (adicionar ou remover do registry).
3. Decidir destino de `nomad`, `kayak`, `myus`, `mint` (criar surface ou parquear).

---

## 🔗 Arquivos relacionados

- [`api/go.js`](../api/go.js) — registry runtime + redirect tracking
- [`api/_lib/partners-remittance.js`](../api/_lib/partners-remittance.js) — registry de remessa (subset usado pelo agregador)
- [`src/App.jsx`](../src/App.jsx) — PROVIDERS array da RemessasScreen (subset visual)
- [`.env.example`](../.env.example) — todas as env vars esperadas
- [`docs/affiliate-kit-wise.md`](./affiliate-kit-wise.md) — kit template
- [`docs/affiliate-kit-*.md`](./) — kits derivados por parceiro
- [`public/admin/parceiros.html`](../public/admin/parceiros.html) — dashboard ao vivo do estado das envs
