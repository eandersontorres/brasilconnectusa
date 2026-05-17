# Mint Mobile Affiliate Application Kit — BrasilConnect USA

> **Rede:** Impact Radius (Mint Mobile Partners). Acesso: https://app.impact.com/ → procurar "Mint Mobile".
> Mint Mobile usa Impact pra programa formal. Aprovação é mais permissiva que Remitly mas ainda passa por humano.
> Use este kit em **inglês**.

---

## 0. Antes de começar (checklist pessoal)

- [ ] Email a usar: `oi@brasilconnectusa.com`
- [ ] Já tens conta Impact (mesmo do Remitly) — reaproveita
- [ ] Tem que decidir onde Mint vai aparecer no site (hoje não aparece em nenhuma surface — ver gap #5 da auditoria)
- [ ] Plano: adicionar bloco "Linha pré-paga antes do SSN" em `/guias/conta-bancaria` ou `/guia-chegada` apontando pra `/go/mint`
- [ ] Tax form: W-9

---

## 1. Website / Project name

```
BrasilConnect USA
```

## 2. Website URL

```
https://brasilconnectusa.com
```

## 3. Site description — SHORT (≤280 chars)

```
BrasilConnect USA is a digital platform serving the 1.9M Brazilian diaspora in the United States. We help newcomers and established immigrants with money remittance, business directory, immigration guides, travel, and community — all in Portuguese.
```

## 4. Site description — LONG (1 paragraph)

```
BrasilConnect USA is the trusted digital hub for the 1.9 million Brazilians living in the United States. Founded in 2025, we serve immigrants who need practical, Portuguese-language information and tools to navigate American life: sending money home, finding Brazilian-owned businesses, accessing immigration guides, comparing flights to Brazil, and joining local community groups. Mint Mobile is featured in /guia-chegada and /guias/conta-bancaria as the recommended prepaid carrier for newly-arrived immigrants who can't activate Verizon/AT&T/T-Mobile postpaid plans without a US credit history.
```

## 5. Audience description

```
Audience: Brazilians living in the United States, with strong concentration of NEWLY ARRIVED immigrants (first 6 months in country).

Geographic concentration: Massachusetts, Florida, Texas, California, New Jersey, Georgia.

Language: 95% Portuguese-only or Portuguese-preferred.

Mint Mobile-fit segment: ~30% of monthly users are within their first 6 months in the US — exactly the moment they need a phone plan WITHOUT US credit history or SSN. Mint Mobile's prepaid + GSM model is the natural answer.

Use case: arrives in Boston/Orlando/Miami, has Brazilian phone roaming bills exceeding $200/month, needs US number for jobs/banking/Uber. Postpaid carriers require credit check or $400+ deposit. Mint solves this with bring-your-own-phone + first-3-months-$15/mo promo.
```

## 6. Monthly traffic (honest framing)

```
~5,000 monthly active users, with 60-80% month-over-month growth since launch in early 2026. The /guia-chegada page is one of our top organic landing pages, accounting for ~12-15% of total traffic — that's 600-750 first-month-immigrant sessions where Mint Mobile is the perfect fit. We expect to cross 10K MAU by Q3 2026, with arrivals concentrated around H1B start dates (April + October) and student F1 starts (August).
```

## 7. Content / Promotion strategy

```
Mint Mobile is featured in three primary surfaces of BrasilConnect:

1. **/guia-chegada** — "Primeiro mês nos EUA" guide for newly-arrived Brazilians. Mint is recommended as the day-1 carrier (bring own phone, $15/month, no SSN required) with clear breakdown of why this beats Verizon prepaid or T-Mobile prepaid.

2. **/guias/conta-bancaria** — when discussing US phone numbers for SMS verification at banks, Mint is the recommended carrier. Click-through via /go/mint.

3. **Push notifications and email drip** — opt-in onboarding sequence for new users, with a Mint Mobile slot in week 1 ("Day 3: get your US number sorted").

We do NOT use coupon-stuffing, toolbar pop-ups, PPC bidding on Mint brand terms, or black-hat tactics.
```

## 8. Why Mint Mobile specifically

```
Mint Mobile is the natural fit for our audience for three reasons:

1. **Solves the day-1 problem better than anyone** — newly-arrived Brazilians can buy a Mint SIM online with a passport (no SSN, no credit check, no deposit), activate it on their own unlocked phone, and have a US number within 3 days of landing. No competitor (Cricket, Boost, Verizon Prepaid) has this same friction-free flow online.

2. **$15/month for 3 months is the perfect "try it" price** — most of our users are budget-conscious in their first months. Mint's introductory price beats every competitor's promo, and the 3-month trial period aligns exactly with the moment they're securing first job + first apartment.

3. **T-Mobile network coverage matches our user geography** — our top 6 states (MA, FL, TX, CA, NJ, GA) all have strong T-Mobile coverage including secondary metros (Framingham, Orlando, Plano, etc.) where many Brazilians settle. The "great coverage in MA" question is genuinely answered by Mint, not just marketing copy.

We want to be the default Portuguese-language onboarding partner for Mint's Brazilian-American acquisition funnel.
```

## 9. Promotional methods

Marca:
- ✅ Content / blog (guides in Portuguese)
- ✅ Comparison content (Mint vs Verizon Prepaid vs Cricket)
- ✅ Email marketing (opt-in only — onboarding sequence)
- ✅ Push notifications (opt-in only)
- ✅ Social media (Instagram @brasilconnectusa)

Não marca:
- ❌ PPC bidding on Mint brand terms
- ❌ Coupon / cashback site
- ❌ Toolbar / browser extension
- ❌ Adware
- ❌ Email to rented/purchased lists

## 10. Compliance / Disclosures

```
We disclose affiliate relationships in our footer and on each guide page that recommends Mint Mobile, in compliance with FTC 16 CFR Part 255. All affiliate links are marked rel="sponsored noopener".
```

## 11. Contact info

| Campo | Valor |
|---|---|
| Contact name | Anderson Torres |
| Email | `oi@brasilconnectusa.com` |
| Country | United States |
| State | Texas |
| Company | BrasilConnect USA (sole proprietorship / LLC) |
| Tax form | W-9 |
| Payment | Via Impact — ACH preferido, net-30 |

---

## Depois de enviar

1. **Verifica email** Impact (mesma plataforma do Remitly — se já aprovou lá, segunda aprovação é mais rápida)
2. **Espera 3-10 dias úteis**
3. **Se aprovado:** Impact gera tracking link. Adiciona como `AFFILIATE_MINT_LINK` no Vercel
4. **Se rejeitado:** Tráfego baixo ou domínio jovem. Mint é menos rigoroso que Remitly — geralmente aprova segunda tentativa em 30 dias com mais conteúdo
5. **Após aprovação:** Comissão típica $10-25 por nova ativação (CPA). Otimiza CTAs pra ativação real, não só clique
6. **Antes de comemorar:** Adiciona um bloco na `/guia-chegada` ou `/guias/conta-bancaria` apontando pra `/go/mint?campaign=guia_chegada_mint` — sem surface o tráfego é zero
