# Wise Affiliate Application Kit — BrasilConnect USA

> Aplicação inicial pra calibrar com Wise antes de Remitly/WU. Cole cada bloco no campo correspondente do formulário em wise.com/us/affiliates (ou Partnerize, dependendo da rede que aparecer no checkout).

---

## 0. Antes de começar (checklist pessoal)

- [ ] Email a usar na aplicação: `oi@brasilconnectusa.com` (não usar pessoal)
- [ ] Cria conta Wise pessoal **antes** se ainda não tem (eles verificam que você usa o produto)
- [ ] Garante que `brasilconnectusa.com/remessas` está no ar e mostra Wise listada
- [ ] Garante que `/privacidade` e `/termos` estão acessíveis (algumas redes verificam)
- [ ] Se eles pedirem screenshot/print, manda dashboard do GA4 — se ainda não tem GA4, fala "rolling out Q2 2026"

---

## 1. Website / Project name

```
BrasilConnect USA
```

## 2. Website URL

```
https://brasilconnectusa.com
```

## 3. Site description — SHORT (≤280 chars, pra campos curtos)

```
BrasilConnect USA is a digital platform serving the 1.9M Brazilian diaspora in the United States. We help newcomers and established immigrants with money remittance, business directory, immigration guides, travel, and community — all in Portuguese.
```

## 4. Site description — LONG (1 paragraph, pra "About your site")

```
BrasilConnect USA is the trusted digital hub for the 1.9 million Brazilians living in the United States. Founded in 2025, we serve immigrants who need practical, Portuguese-language information and tools to navigate American life: sending money home, finding Brazilian-owned businesses, accessing immigration guides, comparing flights to Brazil, and joining local community groups. Our flagship feature is /remessas — a side-by-side comparator of money transfer services tailored to the Brazil-USA corridor, where Wise consistently ranks as one of the most cost-effective options for our audience.
```

## 5. Audience description (Demographics / ICP)

```
Audience: Brazilians living in the United States (1st-generation immigrants, students, professionals on H1B/L1, undocumented workers, dual citizens).

Geographic concentration: Massachusetts, Florida, Texas, California, New Jersey, Georgia (top 6 states for Brazilian-American population).

Language: 95% Portuguese-only or Portuguese-preferred.

Primary financial need: sending USD to Brazilian relatives in BRL — recurring monthly transfers between $200 and $2,000, plus occasional larger transfers for property/emergencies.

High-intent niche: this is not a generic finance audience. Every visitor on /remessas has remittance intent right now.
```

## 6. Monthly traffic (honest framing)

```
~5,000 monthly active users, with 60-80% month-over-month growth since launch in early 2026. Our user base is small but hyper-targeted: the Brazilian-American remittance market is precisely Wise's ICP for this corridor. We expect to cross 10K MAU by Q3 2026, driven by our 2026 FIFA World Cup engagement campaign (Bolão Copa) and ongoing SEO investment in city-specific landing pages (custo-de-vida/[city]). Full Google Analytics 4 access available on request once instrumentation is live (rolling out this quarter).
```

> 💡 Se eles tiverem um campo numérico fixo: coloca **5,000** sem inflar. O texto acima explica o crescimento.

## 7. Content / Promotion strategy (como você vai promover Wise)

```
Wise is featured in three primary surfaces of BrasilConnect:

1. **Comparator page (/remessas)** — side-by-side comparison of remittance providers (rate, fees, delivery time, savings vs. bank). Wise is one of 8 providers compared. Click-through goes via our centralized redirect /go/wise so we can track conversion.

2. **Editorial content (/guias/abrir-llc, /guias/conta-bancaria)** — Portuguese-language guides for newcomers, where Wise is mentioned as the recommended option for opening a multi-currency account before getting a US SSN.

3. **Push notifications and email drip** — opt-in notifications when Wise has a promotional rate or when the user signals remittance intent (e.g., signs up but hasn't sent yet).

We do NOT use coupon-stuffing, toolbar pop-ups, paid search bidding on "Wise" branded keywords, or any black-hat tactics.
```

## 8. Why Wise specifically (the "pitch" field)

```
Wise is the natural fit for our audience for three reasons:

1. **Transparency aligns with our brand** — our entire /remessas comparator exists to show the true cost of remittance (mid-market rate vs. hidden FX spread). Wise's pricing model is the only one that doesn't require us to "translate" hidden costs for the user.

2. **Corridor strength** — USD→BRL is one of Wise's strongest corridors. Brazilians in the US sending to relatives in São Paulo, Goiás, Minas already encounter Wise organically; we accelerate adoption.

3. **Use case fit** — many of our users are early-stage immigrants who can't open a traditional US bank account (no SSN yet). Wise's multi-currency account solves their immediate problem in a way no traditional bank can.

We want to be a long-term partner, not a one-time placement.
```

## 9. Promotional methods (multi-select if it's a checklist)

Marca:
- ✅ Comparison website / aggregator
- ✅ Content / blog (guides in Portuguese)
- ✅ Email marketing (opt-in only — no rented lists)
- ✅ Push notifications (web push, opt-in only)
- ✅ Social media (Instagram @brasilconnectusa, growing)

Não marca:
- ❌ PPC bidding on brand terms
- ❌ Coupon / cashback site
- ❌ Toolbar / browser extension
- ❌ Adware

## 10. Compliance / Disclosures

```
We disclose affiliate relationships in our footer and on /remessas via a "Como ganhamos dinheiro" (How we make money) link, in compliance with FTC 16 CFR Part 255 (Brazilian users in the US are subject to US disclosure rules).
```

## 11. Contact info (pra preencher)

| Campo | Valor |
|---|---|
| Contact name | Anderson Torres |
| Email | `oi@brasilconnectusa.com` |
| Country | United States |
| State | Texas |
| Company | BrasilConnect USA (sole proprietorship / LLC — usa o que for verdade hoje) |
| Tax form | W-9 se você é US resident (mais comum). W-8BEN se for non-resident. |

---

## Depois de enviar

1. **Confirma o email** que eles mandarem (verificação de email)
2. **Espera 2-7 dias úteis** — Wise tem um humano revisando, não é instantâneo
3. **Se aprovado:** vão te dar um affiliate link ou ID. Você adiciona como env var no Vercel (ex: `WISE_AFFILIATE_ID`) e atualiza `/go/wise` no [api/affiliate.js](../api/affiliate.js) (ou onde estiver o redirect) pra incluir o ID
4. **Se rejeitado:** pede feedback no reply. Provavelmente vão citar tráfego. Aí você espera os 60 dias e tenta de novo.

Quando passar, repete o processo pra Remitly (via Impact) e Western Union (via Partnerize) usando esse mesmo kit com pequenos ajustes na seção 8 ("Why X specifically").
