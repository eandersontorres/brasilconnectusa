# Western Union Affiliate Application Kit — BrasilConnect USA

> **Rede:** Partnerize (WU Partner Program). Acesso via https://partner.westernunion.com ou diretamente no Partnerize marketplace.
> Algumas regiões usam Awin pra WU — confirma qual rede aparece no checkout do programa. Se cair em Awin, mesmas respostas, só muda o portal de submissão.
> Use este kit em **inglês**.

---

## 0. Antes de começar (checklist pessoal)

- [ ] Email a usar: `oi@brasilconnectusa.com`
- [ ] Cria conta WU pessoal **antes** se ainda não tem
- [ ] Garante `/app#remessas` mostra WU listada
- [ ] Garante `/privacidade` e `/termos` acessíveis
- [ ] Partnerize pede website screenshot — manda print do `/app` com WU em destaque
- [ ] Tax form: W-9 pronto

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
BrasilConnect USA is the trusted digital hub for the 1.9 million Brazilians living in the United States. Founded in 2025, we serve immigrants who need practical, Portuguese-language information and tools to navigate American life: sending money home, finding Brazilian-owned businesses, accessing immigration guides, comparing flights to Brazil, and joining local community groups. Our flagship feature is /remessas — a side-by-side comparator of money transfer services tailored to the Brazil-USA corridor, where Western Union is featured as the leading option for cash pickup in Brazilian cities outside the major metros.
```

## 5. Audience description

```
Audience: Brazilians living in the United States (1st-generation immigrants, students, professionals on H1B/L1, undocumented workers, dual citizens).

Geographic concentration: Massachusetts, Florida, Texas, California, New Jersey, Georgia (top 6 states for Brazilian-American population).

Language: 95% Portuguese-only or Portuguese-preferred.

Primary financial need: sending USD to Brazilian relatives in BRL — recurring monthly transfers between $200 and $2,000, plus occasional larger transfers for property/emergencies.

Key WU-fit segment: ~30% of our users send to recipients in interior Brazil (Goiás, Pernambuco, Maranhão, interior Bahia and Minas) where neighborhood banks are scarce — these recipients prefer/need cash pickup at WU agentes (Banco do Brasil, lotéricas, Bradesco Express).
```

## 6. Monthly traffic (honest framing)

```
~5,000 monthly active users, with 60-80% month-over-month growth since launch in early 2026. Our user base is small but hyper-targeted: the Brazilian-American remittance market is one of WU's strongest corridors globally. We expect to cross 10K MAU by Q3 2026, driven by our 2026 FIFA World Cup engagement campaign (Bolão Copa) and ongoing SEO investment in city-specific landing pages. Full Google Analytics 4 access available on request once instrumentation is live (rolling out this quarter).
```

## 7. Content / Promotion strategy

```
Western Union is featured in three primary surfaces of BrasilConnect:

1. **Comparator page (/app#remessas)** — side-by-side comparison with Wise, Remitly, MoneyGram and others. WU is highlighted as the leading option for cash pickup in non-metro Brazil. Click-through via /go/western_union for tracking.

2. **Editorial content (/guia-chegada, /guias/conta-bancaria)** — guides for newcomers in Portuguese, recommending WU specifically for sending to relatives without bank accounts.

3. **Push notifications and email drip** — opt-in notifications when WU has a "zero fee on first 3 sends" or holiday promo (Dia das Mães, Christmas — biggest remittance moments).

We do NOT use coupon-stuffing, toolbar pop-ups, PPC bidding on brand terms, or black-hat tactics.
```

## 8. Why Western Union specifically

```
Western Union is the natural fit for our audience for three reasons:

1. **Cash pickup network is unbeatable for interior Brazil** — WU has agente locations in nearly every município through Banco do Brasil, Caixa, Bradesco Express, and lotéricas. For a Brazilian sender in Boston whose mother lives in a small town in Bahia, WU is the only realistic option that doesn't require the recipient to travel to a regional bank. Wise and Remitly don't compete here.

2. **Brand trust with older recipients** — many of our users send to parents/grandparents in Brazil who are 60+ and prefer in-person cash pickup over PIX or bank deposit. WU's brand has been in Brazil since the 1990s; older recipients trust the orange/black sign at the lotérica more than any app.

3. **Promo-driven first-time conversion** — WU consistently runs "$0 fee on first 3 sends" campaigns. This converts hesitant new immigrants who are nervous about sending their first remittance. Our /guia-chegada flow surfaces these promos at exactly that moment.

We want to be a long-term partner. WU isn't always the cheapest — but for the right recipient profile, it's the right choice, and we surface that nuance instead of just sorting by lowest FX margin.
```

## 9. Promotional methods

Marca:
- ✅ Comparison website / aggregator
- ✅ Content / blog (guides in Portuguese)
- ✅ Email marketing (opt-in only)
- ✅ Push notifications (web push, opt-in only)
- ✅ Social media (Instagram @brasilconnectusa)

Não marca:
- ❌ PPC bidding on brand terms
- ❌ Coupon / cashback site
- ❌ Toolbar / browser extension
- ❌ Adware
- ❌ Email to rented/purchased lists

## 10. Compliance / Disclosures

```
We disclose affiliate relationships in our footer and on /remessas via a "Como ganhamos dinheiro" link, in compliance with FTC 16 CFR Part 255. All affiliate links are marked rel="sponsored noopener". We comply with WU's brand guidelines and never imply official partnership beyond affiliate status.
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
| Payment method (Partnerize) | ACH ou PayPal |

---

## Depois de enviar

1. **Verifica email** do Partnerize (double opt-in)
2. **Espera 5-15 dias úteis** — Partnerize tem review humano; WU especificamente é mais lento que outros
3. **Se aprovado:** geram um `camref` (campaign reference). Link fica tipo `https://wu.prf.hn/click/camref:SEU_CAMREF/destination:https%3A%2F%2Fwww.westernunion.com%2F...`. Adiciona como env `AFFILIATE_WU_LINK` no Vercel
4. **Se rejeitado:** WU é seletivo com tráfego baixo. Pede feedback e tenta de novo em 90 dias com mais conteúdo e métricas GA4 prontas
5. **Após aprovação:** WU paga em CPA (geralmente $5-15 por primeira transação completada) — não por cliquey. Otimiza CTAs pra envio efetivo, não só clique
