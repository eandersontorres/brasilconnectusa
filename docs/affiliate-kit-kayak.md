# KAYAK Affiliate Application Kit — BrasilConnect USA

> **Programa:** KAYAK direto (https://www.kayak.com/affiliates) OU via Travelpayouts (https://www.travelpayouts.com — agregador que inclui KAYAK, Skyscanner, e outros).
> Recomendado: começar com **Travelpayouts** (aprovação rápida + integração de white-label) e migrar pra KAYAK direto depois se métricas justificarem.
> Use este kit em **inglês**.

---

## 0. Antes de começar (checklist pessoal)

- [ ] Email a usar: `oi@brasilconnectusa.com`
- [ ] Decide: aplicar KAYAK direto ou Travelpayouts (Travelpayouts é estrategicamente melhor pra começar)
- [ ] Tem screenshot da feature de voos do `/app` (tab "Voos" / VoosScreen) pronto
- [ ] Tax form: W-9 (Travelpayouts) ou W-9 (KAYAK)

> ⚠️ **Gap conhecido:** `/app#voos` (VoosScreen) hoje usa `/api/flights/search` direto (Travelpayouts/Aviasales) sem CTA explícito pra KAYAK. Para gerar tráfego no /go/kayak, precisa adicionar um botão "Comparar mais opções no KAYAK" nos resultados. Ver task técnica no PR de aprovação.

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
BrasilConnect USA is the trusted digital hub for the 1.9 million Brazilians living in the United States. Founded in 2025, we serve immigrants who need practical, Portuguese-language information and tools to navigate American life: sending money home, finding Brazilian-owned businesses, accessing immigration guides, comparing flights to Brazil, and joining local community groups. Our /voos feature lets users compare USA→Brazil flights from 40+ US origins to 31+ Brazilian destinations, with KAYAK featured as the meta-search backend for users who want to deep-dive comparisons before booking.
```

## 5. Audience description

```
Audience: Brazilians living in the United States (1st-generation immigrants, students, professionals on H1B/L1, undocumented workers, dual citizens).

Geographic concentration: Massachusetts, Florida, Texas, California, New Jersey, Georgia (top 6 states for Brazilian-American population).

Language: 95% Portuguese-only or Portuguese-preferred.

Primary travel need: 1-3 round trips to Brazil per year per user. Highest concentration: December (Christmas/family), June-July (Festas Juninas + school break), September (independence holidays).

Average ticket: $700-$1,400 RT for economy USA→Brazil, $1,800-$3,500 for premium/business — meaningful basket sizes.

KAYAK-fit segment: 100% of /voos visitors. Every flight search on BrasilConnect is a high-intent KAYAK query equivalent.
```

## 6. Monthly traffic (honest framing)

```
~5,000 monthly active users, with 60-80% month-over-month growth since launch in early 2026. Of those, approximately 35-40% engage with /voos (flight search) — meaning ~1,700-2,000 flight-intent sessions per month. Our user base is small but hyper-targeted: Brazilians actively planning trips home. We expect to cross 10K MAU by Q3 2026, with the 2026 FIFA World Cup driving outsized travel-intent during the tournament window. Full Google Analytics 4 access available on request once instrumentation is live (rolling out this quarter).
```

## 7. Content / Promotion strategy

```
KAYAK is featured in three primary surfaces of BrasilConnect:

1. **/app#voos comparator** — flight search results from 40+ US origins to 31+ Brazilian destinations. KAYAK is featured as the "compare more options" CTA when a user wants to explore beyond our default results. Click-through via /go/kayak with origin/destination/dates pre-filled when possible.

2. **Editorial content (/guias/voos-baratos-brasil, planned)** — Portuguese guide on cheapest months/days to fly USA→Brazil, with KAYAK widget embedded for live search.

3. **Push notifications and email drip** — opt-in price alerts on saved routes (e.g., MIA→GIG), with deep links to KAYAK when prices drop.

We do NOT use coupon-stuffing, toolbar pop-ups, PPC bidding on KAYAK brand terms, or black-hat tactics.
```

## 8. Why KAYAK specifically

```
KAYAK is the natural fit for our audience for three reasons:

1. **Comprehensive Brazil airline coverage** — KAYAK aggregates LATAM, Azul, GOL, Avianca, American, Delta, United, Copa, and others — covering the full USA-Brazil corridor including secondary routes (MIA→FOR, ORD→GIG, ATL→SSA). Most affiliate-friendly metasearch competitors drop coverage on secondary Brazilian cities; KAYAK doesn't.

2. **Brazilian airline trust** — Brazilians in the US prefer to book on Brazilian carriers (LATAM, Azul, GOL) for the inflight experience and brand familiarity. KAYAK's display of these carriers alongside US legacy carriers builds confidence in our search — we don't have to apologize for missing options.

3. **Price-tracking is the killer feature for our DEC/JUN spike audience** — Brazilians plan trips home 4-8 weeks in advance and obsessively monitor prices. KAYAK's price prediction and tracking features keep users engaged in the funnel longer, which is exactly when conversion happens.

We want to make KAYAK the default "go deeper" tool for Brazilian-American flight search.
```

## 9. Promotional methods

Marca:
- ✅ Comparison website / aggregator
- ✅ Meta-search integration / widget
- ✅ Content / blog (guides in Portuguese)
- ✅ Email marketing (opt-in only)
- ✅ Push notifications (price alerts, opt-in only)
- ✅ Social media (Instagram @brasilconnectusa)

Não marca:
- ❌ PPC bidding on KAYAK brand terms
- ❌ Coupon / cashback site
- ❌ Toolbar / browser extension
- ❌ Adware
- ❌ Email to rented/purchased lists

## 10. Compliance / Disclosures

```
We disclose affiliate relationships in our footer and on /voos via a "Como ganhamos dinheiro" link, in compliance with FTC 16 CFR Part 255. All affiliate links are marked rel="sponsored noopener". We never display KAYAK-branded results as our own; the source is always attributed.
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
| Payment | Wire ou ACH — net-30 padrão na indústria |

---

## Depois de enviar

### Via Travelpayouts (recomendado pra começar)
1. **Aprovação em 1-3 dias úteis** — Travelpayouts é o mais permissivo
2. Geram tracking links com `?marker=SEU_MARKER`. Adiciona como `AFFILIATE_KAYAK_LINK` no Vercel
3. Travelpayouts paga em CPA (comissão por booking confirmado) — geralmente $5-25 por flight booking

### Via KAYAK direto
1. **Aprovação em 7-21 dias** — KAYAK direto é seletivo, geralmente exige >50K MAU
2. Provavelmente vão pedir pra você esperar e re-aplicar quando atingir tráfego mínimo
3. Se aprovar, gerenciam via portal próprio com revenue share

**Recomendação prática:** Aplica Travelpayouts agora, integra `/go/kayak` via Travelpayouts marker, e re-aplica direto KAYAK em Q1 2027 quando tráfego justificar.
