# Parceiros — Integração via API real

> Doc complementa `AUDITORIA_PARCERIAS.md` (links de afiliado) com a camada de **cotação real via API**.
> Atualizado em 2026-05-14.

---

## Arquitetura

```
                          ┌──────────────────────────────┐
   /api/remittance/quote ─┤ partners-remittance.js       │
   /api/remittance/...    │   (registry canônico)         │
                          └──────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
      Wise API (live)         estimateQuote()          /go/<id> redirect
      api.wise.com/v3/quotes  mid_rate × margin       (tracking + afiliado)

                          ┌──────────────────────────────┐
   /api/flights/search   ─┤ partners-airlines.js          │
   /api/flights/airlines  │   (códigos IATA + deep links) │
                          └──────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
       Amadeus (live)           Travelpayouts            deeplinks só
       (oauth + flight-offers)  (mês cached)             (fallback final)
```

---

## Endpoints novos

| Endpoint                          | Método | Status                  | Cache |
|-----------------------------------|--------|-------------------------|-------|
| `/api/remittance/providers`       | GET    | Pronto (lê do registry) | 10min |
| `/api/remittance/quote`           | GET    | Pronto (Wise live ou estimated) | 5min |
| `/api/flights/airlines`           | GET    | Pronto (lê do registry) | 1h    |
| `/api/flights/search`             | GET    | Pronto (Amadeus → TP → deeplinks) | 30min |

Arquivos:
- `api/_lib/partners-remittance.js` — registry remessa
- `api/_lib/partners-airlines.js` — registry cias aéreas
- `api/remittance/quote.js`
- `api/remittance/providers.js`
- `api/flights/search.js`
- `api/flights/airlines.js`

---

## Como ativar cada API

### 1. Wise Platform (remessas reais)

1. Criar conta business em <https://wise.com/business>
2. Ir em **Settings → API tokens**
3. Criar token com escopo `quotes:create` (não precisa de KYC pra simulação)
4. Vercel → Settings → Environment Variables → setar `WISE_API_TOKEN`
5. Redeploy
6. Testar:
   ```bash
   curl 'https://brasilconnectusa.com/api/remittance/quote?amount_usd=500' | jq
   ```
   Wise deve aparecer com `"source": "live"`. Os outros providers com `"source": "estimated"`.

**Custo**: gratuito pra simulação. Pra executar transferência real precisa do programa Wise Platform (gated, mas a gente não chega lá agora — só quote).

### 2. Amadeus Self-Service (voos reais)

1. Cadastro em <https://developers.amadeus.com/register>
2. Criar uma "New App" — copia `API Key` e `API Secret`
3. Vercel → setar `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_HOST=test.api.amadeus.com`
4. Redeploy
5. Testar:
   ```bash
   curl 'https://brasilconnectusa.com/api/flights/search?origin=MIA&destination=GRU&depart_date=2026-07-15&return_date=2026-07-30' | jq '.source, .cheapest'
   ```
   Deve responder `"source": "amadeus"` com `cheapest` preenchido.

**Limites do tier free**: 2.000 chamadas/mês. Suficiente pra MVP.
**Pra produção**: trocar `AMADEUS_HOST` pra `api.amadeus.com` e ativar o plano pago (~$0.01/quote).

### 3. Travelpayouts (já configurado)

Já existe em `.env.example` — `TRAVELPAYOUTS_TOKEN` + `TRAVELPAYOUTS_MARKER`. Continua sendo fallback se Amadeus estiver desligado ou falhar.

---

## Como o `quote` decide a fonte

```js
for each partner in registry:
  if partner.api.mode === 'live' && WISE_API_TOKEN set:
     → chama API real
  else:
     → estimateQuote(amount, midRate, partner.fx_margin, partner.flat_fee)
     → marca source: 'estimated'
```

Resultado vem ordenado por BRL recebido (maior é melhor). Frontend pode mostrar badge "💱 ao vivo" só nos `"source": "live"`.

---

## Margens FX usadas (estimadas — atualizar trimestral)

| Provider     | FX margin | Flat fee | Speed     |
|--------------|-----------|----------|-----------|
| Wise         | 0.45%     | $1.50    | minutos   |
| Remitly      | 1.50%     | $0       | 0–72h     |
| Paysend      | 2.00%     | $2.00    | 0–48h     |
| Xoom         | 2.50%     | $4.99    | 0–24h     |
| MoneyGram    | 3.00%     | $3.99    | 0–96h     |
| Western Union| 3.50%     | $0       | 0–96h     |

Fonte: comparação pública Monito + Wise comparison page.
Pra atualizar: editar `fx_margin` e `flat_fee_usd` em `api/_lib/partners-remittance.js`.

---

## Companhias aéreas no registry

LATAM, GOL, Azul, American, United, Delta, Copa, Air France, Iberia, TAP — todas com:
- código IATA + ICAO
- hubs nos EUA e no BR
- rotas diretas conhecidas
- aliança (oneworld / Star Alliance / SkyTeam)
- deep link de busca direta no site da cia (com tokens)
- classes de tarifa em português

Pra adicionar nova cia: editar `AIRLINES` em `api/_lib/partners-airlines.js`.

---

## Próximos passos (não bloqueia)

1. **Cache no Supabase**: persistir quotes em `bc_quote_cache` pra reduzir chamadas Amadeus
2. **Conversão atrelada**: tracking de qual provider o usuário escolheu depois da quote — joinar `bc_affiliate_clicks` com `quote_id`
3. **Histórico de FX margin**: tabela `bc_partner_fx_history` pra mostrar gráfico de margem ao longo do tempo
4. **API Wise transfer real**: depois que a quote estiver firme e o usuário quiser executar dentro do app (Wise Platform program)
