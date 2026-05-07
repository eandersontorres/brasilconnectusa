# Auditoria de Parcerias — 2026-05-07

> Status real dos links de afiliado em produção (`brasilconnectusa.com`).
> Gerado a partir de `GET /api/rates` e `GET /go/<partner>` na produção.

---

## 🐛 Bugs encontrados e corrigidos no PR #1 (commit `04258ca`)

### 1. Click no comparador da landing abria 405 Method Not Allowed (CRÍTICO)
- **Causa:** `public/landing.html` chamava `window.open('/api/track?provider=...')` (GET), mas `/api/track` só aceita POST.
- **Impacto:** Cada clique no comparador da landing abria nova aba com erro 405 — zero conversão de afiliados via landing.
- **Fix:** Trocado por `/go/<provider>?utm_source=landing&...` (faz 302 + tracking server-side).

### 2. `/api/go` não conhecia 4 dos 8 provedores de remessa
- **Faltavam:** `moneygram`, `paysend`, `nomad`, `xoom`.
- **Impacto:** Mesmo após o fix #1, esses 4 dariam 404 "Parceiro desconhecido".
- **Fix:** Adicionados ao mapa `PARTNERS` em `api/go.js`, com fallbacks pra site oficial.

### 3. `handleSend` do app `/app/remessas` ia direto pro env var
- **Antes:** `window.open(affiliateLinks[envKey] || fallback)` — sem tracking, sem UTMs.
- **Depois:** `window.open('/go/<id>?utm_source=app&...')` — tracking unificado com a landing.

---

## 📊 Estado real das env vars na Vercel

| Provider          | Env var                    | Status produção                                |
|-------------------|----------------------------|------------------------------------------------|
| Wise              | `AFFILIATE_WISE_LINK`      | ⚠️ **placeholder** (`wise.com/invite/placeholder`) |
| Remitly           | `AFFILIATE_REMITLY_LINK`   | ⚠️ **placeholder**                              |
| Western Union     | `AFFILIATE_WU_LINK`        | ⚠️ **placeholder**                              |
| KAYAK             | `AFFILIATE_KAYAK_LINK`     | ⚠️ **placeholder**                              |
| MoneyGram         | `AFFILIATE_MONEYGRAM_LINK` | ❌ não setada (fallback site oficial)           |
| PaySend           | `AFFILIATE_PAYSEND_LINK`   | ❌ não setada                                   |
| Nomad             | `AFFILIATE_NOMAD_LINK`     | ❌ não setada                                   |
| Xoom              | `AFFILIATE_XOOM_LINK`      | ❌ não setada                                   |
| Lemonade          | `AFFILIATE_LEMONADE_LINK`  | ❌ não setada (fallback `lemonade.com`)         |
| Mint Mobile       | `AFFILIATE_MINT_LINK`      | ❌ não setada                                   |
| Mercury           | `AFFILIATE_MERCURY_LINK`   | ❌ não setada                                   |
| MyUS              | `AFFILIATE_MYUS_LINK`      | ❌ não setada                                   |
| ZenBusiness       | `AFFILIATE_ZENBUSINESS_LINK` | ❌ não setada                                 |
| Capital One       | `AFFILIATE_CAPITALONE_LINK` | ❌ não setada                                  |
| Booking           | `AFFILIATE_BOOKING_LINK`   | ❌ não setada                                   |
| Expedia           | `AFFILIATE_EXPEDIA_LINK`   | ❌ não setada                                   |
| Undercover Tourist| `AFFILIATE_UNDERCOVER_LINK`| ❌ não setada                                   |
| Klook             | `AFFILIATE_KLOOK_LINK`     | ❌ não setada                                   |
| Viator            | `AFFILIATE_VIATOR_LINK`    | ❌ não setada                                   |
| GetYourGuide      | `AFFILIATE_GETYOURGUIDE_LINK` | ❌ não setada                                |

---

## ✅ Próximos passos (precisam ação tua na Vercel)

### Prioridade 1 — Remessas (caminho de monetização principal)
Cadastrar e configurar afiliados reais nas env vars que **já estão setadas mas com placeholder**:

1. **Wise** — programa Wise Affiliates (Partnerize). Link real começa com `https://wise.prf.hn/click/camref:...`
2. **Remitly** — Impact Radius. Link com `irclickid=`
3. **Western Union** — programa via Partnerize. Link com `wu.prf.hn`
4. **KAYAK** — Travelpayouts ou direto. Link `kayak.com/in?a=ID&url=...`

Pra atualizar:
```
Vercel dashboard → projeto brasilconnectusa → Settings → Environment Variables
→ editar cada AFFILIATE_*_LINK com a URL real do programa
→ Redeploy
```

### Prioridade 2 — Remessas adicionais (4 ainda sem env var)
Cadastrar e setar:
- `AFFILIATE_MONEYGRAM_LINK` — MoneyGram tem programa via Awin
- `AFFILIATE_PAYSEND_LINK` — programa próprio
- `AFFILIATE_NOMAD_LINK` — programa Nomad parceiros
- `AFFILIATE_XOOM_LINK` — programa PayPal Partner Network (Xoom é PayPal)

Enquanto não cadastra, `/go/<id>` já funciona — só vai pro site oficial sem comissão.

### Prioridade 3 — Tier 0 quick wins (`paid_acquisition_playbook.docx` menciona)
Lemonade, Mint Mobile, Mercury, MyUS, ZenBusiness, Capital One — todos com programas conhecidos (Impact, Partnerize, CJ Affiliate). Setar quando der.

### Prioridade 4 — Viagem
Booking, Expedia (via Travelpayouts), Klook, Viator, GetYourGuide, Undercover Tourist. Mais complexo — Travelpayouts agrega a maioria.

---

## 🔗 Como testar quando atualizar uma env var

```bash
# Antes do redeploy:
curl -sX GET -D - -o /dev/null https://brasilconnectusa.com/go/wise | grep -i location:
# Deve retornar a URL configurada (placeholder ou real)
```

---

## 🗂️ Arquivos relevantes

- [api/go.js](api/go.js) — redirector central com tracking, mapa de parceiros
- [api/rates.js](api/rates.js) — retorna mid_rate + affiliate_links (frontend usa pra mostrar)
- [api/track.js](api/track.js) — endpoint POST-only de logging (não chamar via window.open)
- [src/App.jsx:432](src/App.jsx) — `RemessasScreen.handleSend()`
- [public/landing.html](public/landing.html) — `renderRes()` no script inline
- [.env.example](.env.example) — todos os env vars documentados
