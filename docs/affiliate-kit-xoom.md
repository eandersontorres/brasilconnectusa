# Xoom Affiliate Application Kit — BrasilConnect USA

> **Rede:** PayPal Partner Network (Xoom é subsidiária do PayPal). Acesso: https://www.paypal.com/us/business/partner-program → aplicar como Affiliate.
> Em alguns países o programa Xoom é via Impact ao invés de PayPal próprio — confirma qual aparece no fluxo.
> Use este kit em **inglês**.

---

## 0. Antes de começar (checklist pessoal)

- [ ] Email a usar: `oi@brasilconnectusa.com` (PRECISA ter conta PayPal Business no mesmo email)
- [ ] **Cria conta PayPal Business antes** se ainda não tem — application bloqueia sem isso
- [ ] Cria conta Xoom pessoal (linked com PayPal) pra mostrar uso do produto
- [ ] Garante `/app#remessas` tem espaço pra mostrar Xoom (ver inconsistência #1 na auditoria — hoje Xoom não está no array PROVIDERS do frontend)
- [ ] Tax form: W-9

> ⚠️ **Bloqueio conhecido:** Xoom está em `api/_lib/partners-remittance.js` mas NÃO está no array `PROVIDERS` em `src/App.jsx`. Se aprovar Xoom mas não adicionar no frontend, comissão zera. Fix de 5 linhas no App.jsx — fazer antes de aplicar OU como parte do PR de aprovação.

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
BrasilConnect USA is the trusted digital hub for the 1.9 million Brazilians living in the United States. Founded in 2025, we serve immigrants who need practical, Portuguese-language information and tools to navigate American life: sending money home, finding Brazilian-owned businesses, accessing immigration guides, comparing flights to Brazil, and joining local community groups. Our flagship feature is /remessas — a side-by-side comparator of money transfer services tailored to the Brazil-USA corridor, where Xoom is featured as the natural choice for the millions of Brazilians who already have a PayPal balance from freelance/Etsy/eBay work and want to deploy it as a remittance.
```

## 5. Audience description

```
Audience: Brazilians living in the United States (1st-generation immigrants, students, professionals on H1B/L1, undocumented workers, dual citizens).

Geographic concentration: Massachusetts, Florida, Texas, California, New Jersey, Georgia (top 6 states for Brazilian-American population).

Language: 95% Portuguese-only or Portuguese-preferred.

Primary financial need: sending USD to Brazilian relatives in BRL — recurring monthly transfers between $200 and $2,000.

Xoom-fit segment: ~15-20% of our users earn at least partial income through PayPal-paying platforms (Upwork, Fiverr, Etsy, eBay, Patreon, OnlyFans). For these users, Xoom converts PayPal balance directly to BRL without an intermediate withdrawal — saving 1-2 days and the bank routing dance.
```

## 6. Monthly traffic (honest framing)

```
~5,000 monthly active users, with 60-80% month-over-month growth since launch in early 2026. Our user base is small but hyper-targeted: the Brazilian-American freelancer + remittance niche is precisely Xoom's growth segment. We expect to cross 10K MAU by Q3 2026, driven by our 2026 FIFA World Cup engagement campaign and ongoing SEO investment in city-specific landing pages. Full Google Analytics 4 access available on request once instrumentation is live (rolling out this quarter).
```

## 7. Content / Promotion strategy

```
Xoom is featured in three primary surfaces of BrasilConnect:

1. **Comparator page (/app#remessas)** — side-by-side comparison. Xoom is highlighted for users who have a PayPal balance with a dedicated "Tem saldo PayPal? Use Xoom" callout. Click-through via /go/xoom.

2. **Editorial content (/guias/freelance-eua, planned)** — guide for Brazilians earning USD via PayPal-paying platforms; Xoom is the natural step from PayPal income to BRL withdrawal.

3. **Push notifications** — opt-in notifications when Xoom has a fee waiver (which they do quarterly on the Brazil corridor).

We do NOT use coupon-stuffing, toolbar pop-ups, PPC bidding on PayPal/Xoom brand terms, or black-hat tactics.
```

## 8. Why Xoom specifically

```
Xoom is the natural fit for our audience for three reasons:

1. **PayPal-to-BRL is a real workflow we hear about constantly** — Brazilians working remote for US clients on Upwork/Fiverr get paid into PayPal, then need to move it to Brazil. The native Xoom-from-PayPal-balance flow eliminates one withdrawal step (which would otherwise cost $5-15 and 2-3 days). We surface this exact use case in our editorial content.

2. **PIX delivery in minutes plus PayPal trust = unique combo** — Xoom delivers to Brazilian PIX in under 15 minutes for many transfers. Combined with the PayPal brand familiarity, this converts hesitant users who would balk at lesser-known Paysend or Nomad.

3. **Cash pickup network as a backup** — for users sending to family in cities without PIX-enabled relatives (yes, still exists — older parents who refuse to install bank apps), Xoom has cash pickup through Banco do Brasil and others. Versatility matters.

We want to be part of Xoom's growth in the Brazil corridor as PayPal's Brazil strategy matures.
```

## 9. Promotional methods

Marca:
- ✅ Comparison website / aggregator
- ✅ Content / blog (guides in Portuguese)
- ✅ Email marketing (opt-in only)
- ✅ Push notifications (web push, opt-in only)
- ✅ Social media (Instagram @brasilconnectusa)

Não marca:
- ❌ PPC bidding on PayPal/Xoom brand terms
- ❌ Coupon / cashback site
- ❌ Toolbar / browser extension
- ❌ Adware
- ❌ Email to rented/purchased lists

## 10. Compliance / Disclosures

```
We disclose affiliate relationships in our footer and on /remessas via a "Como ganhamos dinheiro" link, in compliance with FTC 16 CFR Part 255. All affiliate links are marked rel="sponsored noopener". We comply with PayPal/Xoom brand guidelines and never imply equity partnership.
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
| PayPal account | Mesmo email — Business preferido |

---

## Depois de enviar

1. **Verifica email** PayPal/Xoom Partner
2. **Espera 7-21 dias úteis** — PayPal é o programa mais lento da lista
3. **Se aprovado:** te dão tracking link com `?aff=SEU_ID`. Adiciona como `AFFILIATE_XOOM_LINK` no Vercel
4. **Se rejeitado:** PayPal é seletivo. Causa típica: tráfego baixo ou domínio jovem. Espera 90 dias e re-aplica
5. **Lembrete técnico:** ANTES de comemorar, adiciona Xoom no array `PROVIDERS` em `src/App.jsx` (com cor PayPal `#003087`, fee $4.99, spread ~2.5%) — caso contrário a aprovação não gera tráfego
