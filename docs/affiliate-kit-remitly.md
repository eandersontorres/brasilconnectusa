# Remitly Affiliate Application Kit — BrasilConnect USA

> **Rede:** Impact Radius (formerly Impact). Acesso: https://app.impact.com/ → criar conta de publisher → procurar "Remitly".
> Algumas vezes Remitly aceita aplicação direta também via https://www.remitly.com/us/en/partner.
> Use este kit em **inglês** (campos são em inglês) — notas em PT são só pra você não se perder.

---

## 0. Antes de começar (checklist pessoal)

- [ ] Email a usar: `oi@brasilconnectusa.com` (não usar pessoal)
- [ ] Cria conta Remitly pessoal **antes** se ainda não tem (eles checam histórico de uso/recebimento)
- [ ] Garante que `brasilconnectusa.com/app#remessas` carrega e mostra Remitly listada
- [ ] Garante que `/privacidade` e `/termos` estão acessíveis
- [ ] Se eles pedirem screenshot do site, manda printscreen do `/app` com Remitly destacado na lista
- [ ] Impact pede tax form na aprovação — tem W-9 pronto

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
BrasilConnect USA is the trusted digital hub for the 1.9 million Brazilians living in the United States. Founded in 2025, we serve immigrants who need practical, Portuguese-language information and tools to navigate American life: sending money home, finding Brazilian-owned businesses, accessing immigration guides, comparing flights to Brazil, and joining local community groups. Our flagship feature is /remessas — a side-by-side comparator of money transfer services tailored to the Brazil-USA corridor, where Remitly is featured as a top option for users prioritizing speed and zero-fee Economy transfers.
```

## 5. Audience description

```
Audience: Brazilians living in the United States (1st-generation immigrants, students, professionals on H1B/L1, undocumented workers, dual citizens).

Geographic concentration: Massachusetts, Florida, Texas, California, New Jersey, Georgia (top 6 states for Brazilian-American population).

Language: 95% Portuguese-only or Portuguese-preferred.

Primary financial need: sending USD to Brazilian relatives in BRL — recurring monthly transfers between $200 and $2,000, plus occasional larger transfers for property/emergencies.

High-intent niche: this is not a generic finance audience. Every visitor on /remessas has remittance intent right now.
```

## 6. Monthly traffic (honest framing)

```
~5,000 monthly active users, with 60-80% month-over-month growth since launch in early 2026. Our user base is small but hyper-targeted: the Brazilian-American remittance market is precisely Remitly's ICP — first-generation immigrants sending recurring transfers home. We expect to cross 10K MAU by Q3 2026, driven by our 2026 FIFA World Cup engagement campaign (Bolão Copa) and ongoing SEO investment in city-specific landing pages (custo-de-vida/[city]). Full Google Analytics 4 access available on request once instrumentation is live (rolling out this quarter).
```

> 💡 Em campo numérico fixo: **5,000**. Texto explica crescimento.

## 7. Content / Promotion strategy

```
Remitly is featured in three primary surfaces of BrasilConnect:

1. **Comparator page (/app#remessas)** — side-by-side comparison of remittance providers (rate, fees, delivery time, savings vs. bank). Remitly is one of the providers compared. Click-through goes via our centralized redirect /go/remitly so we can track conversion and ensure compliance.

2. **Editorial content (/guias/conta-bancaria, /guia-chegada)** — Portuguese-language guides for newcomers, where Remitly is recommended for first transfers because Economy is free and Express arrives in minutes — both critical for new immigrants who need to send money urgently but don't have a US bank account yet.

3. **Push notifications and email drip** — opt-in notifications when Remitly has a promotional rate (e.g., "$0 fee + boosted FX for first 3 sends") or when the user signals remittance intent (signs up but hasn't sent yet).

We do NOT use coupon-stuffing, toolbar pop-ups, paid search bidding on "Remitly" branded keywords, or any black-hat tactics. All affiliate placements are clearly labeled as sponsored.
```

## 8. Why Remitly specifically (the "pitch" field)

```
Remitly is the natural fit for our audience for three reasons:

1. **First-transfer promo aligns with new-immigrant moment** — most of our users arrive in the US and need to send money home within their first 30 days. Remitly's "first send free + boosted FX" promo converts this intent better than competitors. We surface it explicitly in /guia-chegada.

2. **PIX delivery in minutes is a killer feature for Brazil** — Brazilians don't accept slow transfers anymore (PIX is instant). Remitly's Express tier delivers to Brazilian bank accounts and PIX in under 15 minutes — that's the only delivery time that matches user expectation for emergency sends (medical bills, rent for family).

3. **Cash pickup network in Brazil interior** — many of our users have parents/relatives in Goiás, Bahia, interior Minas where no nearby bank branch exists. Remitly's cash pickup partners (Banco do Brasil, Caixa, etc.) solve this — and that's a story Wise can't tell.

We want to be a long-term partner, not a one-time placement.
```

## 9. Promotional methods

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
- ❌ Email to rented/purchased lists

## 10. Compliance / Disclosures

```
We disclose affiliate relationships in our footer and on /remessas via a "Como ganhamos dinheiro" (How we make money) link, in compliance with FTC 16 CFR Part 255. All affiliate links are marked rel="sponsored noopener". We do not target users under 18 and our content is informational, not financial advice.
```

## 11. Contact info

| Campo | Valor |
|---|---|
| Contact name | Anderson Torres |
| Email | `oi@brasilconnectusa.com` |
| Country | United States |
| State | Texas |
| Company | BrasilConnect USA (sole proprietorship / LLC) |
| Tax form | W-9 (US resident) or W-8BEN (non-resident) |
| Payment method (Impact) | ACH preferido — eles oferecem PayPal/Wire também |

---

## Depois de enviar

1. **Verifica email** que Impact mandar — eles fazem double opt-in
2. **Espera 3-10 dias úteis** — Impact tem review automatizado + humano se tráfego < 10K MAU
3. **Se aprovado:** Impact te dá um `irclickid` template (ex: `https://www.remitly.com/?irclickid={click_id}`). Adiciona como env `AFFILIATE_REMITLY_LINK` no Vercel
4. **Se rejeitado:** geralmente é tráfego ou domínio jovem. Pede feedback e tenta de novo em 60 dias com mais conteúdo publicado
5. **Após aprovação:** Impact tem painel de relatórios — checa CR mensal e otimiza posições no comparador
