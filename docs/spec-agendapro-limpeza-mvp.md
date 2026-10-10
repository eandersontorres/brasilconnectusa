# Spec — AgendaPro Limpeza (MVP)

**Status:** rascunho v1 · 2026-07-18
**Produto-mãe:** AgendaPro (BrasilConnect) — `public/agenda/*`, schema `ag_*` (`supabase/agenda_schema.sql`)
**Vertical:** gestão de schedule para donas de negócio de house cleaning na comunidade brasileira nos EUA

---

## 1. Problema

A "dona do schedule" brasileira gerencia 20–80 casas recorrentes, 1–4 equipes e dezenas de trocas de horário por semana usando caderno, planilha e WhatsApp. Os erros custam caro: equipe mandada pra casa errada, dia esquecido, duas casas distantes no mesmo dia queimando gasolina e hora paga.

As ferramentas de mercado (ZenMaid ~$49/mês, Jobber $39–250/mês, BookingKoala) são em inglês, assumem negócio formalizado e **não trazem cliente** — só organizam. Não existe oferta em português, com preço de entrada baixo e conectada a uma comunidade que gera demanda. House cleaning é uma das maiores ocupações de brasileiros em MA, CT, FL e NJ — exatamente a audiência do BrasilConnect.

## 2. Insight de produto central

O AgendaPro atual é **self-booking**: o cliente escolhe o horário no link público. Na limpeza é o inverso — **a dona controla o schedule**. Cliente final (muitas vezes americano) não escolhe slot; ele negocia uma recorrência ("toda quinta de manhã, quinzenal") e a dona encaixa na rota. O MVP portanto é *painel-first*, não *link-first*. O link público vira captação de lead (pedido de orçamento), não agendamento direto.

## 3. Metas

1. **Validar demanda:** 100 acessos e 20 cadastros na waitlist da landing `/para/limpeza` em 30 dias (canal: comunidade BC + grupos de WhatsApp/Facebook).
2. **Adoção:** 10 donas de schedule ativas (com ≥5 casas cadastradas) em 60 dias após lançar o painel.
3. **Monetização:** 5 assinaturas pagas em 90 dias (reusar billing Stripe do AgendaPro).
4. **Valor do core:** ≥70% dos agendamentos da semana gerados automaticamente pela recorrência (métrica de que o produto "preenche a agenda sozinho").

## 4. Não-metas (v1)

- **Otimização de rota de verdade (VRP/ordem ótima de paradas)** — agrupar por proximidade resolve 80% da dor; otimização é P2.
- **Marketplace consumidor** ("achar uma cleaner perto de mim") — outra iniciativa, outro lado do mercado; captação no v1 é o perfil público + comunidade.
- **Payroll / divisão de pagamento por faxineira** — complexidade legal/trabalhista; anotar valores é suficiente no v1.
- **App nativo** — PWA/mobile web como todo o BC; pasta `mobile/` é iniciativa separada.
- **Limpeza de Airbnb/turnover** (integração com calendário de reservas, nicho do Turno) — considerar depois.

## 5. Personas e user stories

**Dona do schedule (persona principal — paga a conta)**
- Como dona de schedule, quero cadastrar cada casa com endereço, tamanho, frequência e preço, para parar de depender do caderno.
- Como dona de schedule, quero que a agenda das próximas semanas se preencha sozinha a partir das recorrências, para só administrar exceções (pulou semana, remarcou).
- Como dona de schedule, quero atribuir cada casa a uma equipe e ver a semana em colunas por equipe, para saber se alguém está sobrecarregada.
- Como dona de schedule, quero ver as casas do dia num mapa, para perceber quando mandei uma equipe cruzar a cidade à toa.
- Como dona de schedule, ao encaixar um cliente novo, quero ver que dias já tenho casas perto daquele endereço, para oferecer o dia certo ("atendo seu bairro às quintas").
- Como dona de schedule, quero registrar pagamento (cash/Zelle/Venmo/cheque) por limpeza, para saber quem está devendo.

**Líder de equipe**
- Como líder de equipe, quero receber um link com a lista do dia (ordem, endereço com botão de navegação, observações da casa, portão/senha/pet), sem precisar de login.

**Cliente final (dona da casa — pode ser americana)**
- Como cliente, quero receber lembrete automático no dia anterior (WhatsApp/SMS, PT ou EN), para deixar a casa acessível.
- Como cliente em potencial, quero pedir orçamento pelo link público da empresa, para ser contatada.

**Admin BrasilConnect**
- Como admin, quero ver métricas do vertical (donas ativas, casas, MRR) no painel existente.

## 6. Modelo de dados

Reaproveita o schema `ag_*` (providers, clients, appointments, payments, subscriptions, reviews e billing Stripe continuam valendo). Novidades em migration `supabase/agenda_limpeza_schema.sql`:

```sql
-- ag_providers: marcar o vertical
ALTER TABLE ag_providers ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT 'services';
  -- 'services' (AgendaPro atual) | 'cleaning' → liga o dashboard de limpeza

-- ag_teams — equipes da dona do schedule
CREATE TABLE ag_teams (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id  UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,            -- 'Equipe da Maria'
  color        TEXT DEFAULT '#0F5132',   -- cor nos calendários e pins do mapa
  members      JSONB DEFAULT '[]',       -- [{name, whatsapp}] — sem login no v1
  day_link_token TEXT UNIQUE,            -- token do link "rota do dia" sem senha
  active       BOOLEAN DEFAULT TRUE
);

-- ag_clients: casa = cliente com endereço geocodificado
ALTER TABLE ag_clients
  ADD COLUMN IF NOT EXISTS address_line TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT, ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6), ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS home_notes TEXT,       -- portão, alarme, pets, produtos
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'pt'; -- idioma dos lembretes: 'pt' | 'en' | 'es'

-- ag_recurring_jobs — o coração do vertical
CREATE TABLE ag_recurring_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id   UUID NOT NULL REFERENCES ag_providers(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES ag_clients(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES ag_teams(id),
  frequency     TEXT NOT NULL,           -- 'weekly' | 'biweekly' | 'every4weeks' | 'once'
  day_of_week   INT CHECK (day_of_week BETWEEN 0 AND 6),
  window_start  TIME,                    -- janela, não slot exato ('manhã' = 08:00)
  duration_min  INT DEFAULT 120,
  price_cents   INT NOT NULL,
  anchor_date   DATE NOT NULL,           -- referência p/ calcular quinzenal/mensal
  active        BOOLEAN DEFAULT TRUE,
  notes         TEXT
);

-- ag_appointments: ligação com equipe e recorrência
ALTER TABLE ag_appointments
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES ag_teams(id),
  ADD COLUMN IF NOT EXISTS recurring_job_id UUID REFERENCES ag_recurring_jobs(id),
  ADD COLUMN IF NOT EXISTS visit_order INT;  -- ordem da parada no dia (arrastar no v1.1)
```

**Geração da agenda:** função `ag_generate_recurring(provider_id, until_date)` materializa `ag_appointments` a partir dos `ag_recurring_jobs` num horizonte rolante de 6 semanas, idempotente (não duplica, não recria cancelados). Rodada por cron (Vercel cron ou pg_cron) + ao salvar/editar uma recorrência.

**Geocoding:** mesmo padrão do `bc_geocode_cache` (Nominatim com cache eterno), estendido para endereço completo (`address_norm + zip`). Proximidade no v1 = distância haversine em SQL, sem API de rotas.

## 7. Telas (padrão visual BC, HTML estático + Supabase fetch)

| Tela | Rota | Descrição |
|---|---|---|
| Landing do vertical | `/para/limpeza/` | Mesmo padrão de `/para/agenda-pro/`; CTA → waitlist (`bc_waitlist`) na Fase 0, cadastro na Fase 1 |
| Painel semana | `/agenda/limpeza.html` | Grade seg–sáb × equipes (cards coloridos por equipe); ações: concluir, pular semana, remarcar, marcar pago |
| Casas | aba do painel | Lista/cadastro de casas com endereço (autocomplete de zip), recorrência e equipe no mesmo formulário |
| Mapa do dia | aba do painel | Leaflet + OpenStreetMap (zero custo de API), pins na cor da equipe, aviso quando uma equipe tem paradas >10 mi entre si |
| Rota do dia (equipe) | `/agenda/equipe.html?t=TOKEN` | Mobile, sem login: paradas em ordem, botão "Navegar" (deep link Google/Apple Maps), notas da casa |
| Perfil público | `/agenda/{slug}` (existente) | Ganha formulário "Pedir orçamento" (EN/PT) no lugar do self-booking quando `vertical='cleaning'` |

## 8. Requisitos

### P0 — sem isso não lança
| # | Requisito | Critérios de aceitação (resumo) |
|---|---|---|
| P0.1 | Landing `/para/limpeza` + waitlist | Página no ar, cadastro cai em `bc_waitlist` com `source='limpeza'` |
| P0.2 | Cadastro de casas com endereço geocodificado | Salvar casa → lat/lng preenchidos via cache; erro de geocode não bloqueia o cadastro |
| P0.3 | Recorrência gera agenda sozinha | Dado job quinzenal às quintas, quando a geração roda, existem visitas nas quintas corretas por 6 semanas, sem duplicar em re-execução |
| P0.4 | Equipes + atribuição | CRUD de equipes; toda visita herda a equipe do job; troca pontual não altera o job |
| P0.5 | Painel semana por equipe | Visão seg–sáb filtra por equipe; ações concluir/pular/remarcar/pago funcionam e pular semana não desativa a recorrência |
| P0.6 | Lembrete WhatsApp 24h (reuso do AgendaPro) | Cliente com `language='en'` recebe template em inglês |
| P0.7 | Billing reusado | Trial + planos Stripe atuais funcionam com `vertical='cleaning'`; painel limpeza exige plano com equipes (≥ 'pro') p/ >1 equipe |

### P1 — fast-follow
- **Mapa do dia** (Leaflet) com pins por equipe e alerta de dispersão. *(Sobe pra P0 se o esforço couber no primeiro ciclo — é o "uau" da demo.)*
- **Sugestão de encaixe:** ao cadastrar casa nova, mostrar "você já atende a ≤5 mi daqui: qui (Equipe A), sáb (Equipe B)".
- **Link rota do dia** para a equipe (token, sem login).
- **Registro de pagamento** por visita (cash/Zelle/Venmo/cheque) + lista "em aberto".
- **Formulário de orçamento** EN/PT no perfil público.

### P2 — considerações futuras (guiam arquitetura, não serão construídas)
- Ordem ótima de paradas (API de direções); `visit_order` já existe pra isso.
- Portal/login da faxineira, payroll por equipe.
- Marketplace de captação (cliente busca cleaner) — o perfil público com reviews já planta a semente.
- ~~Turnover Airbnb (sincronizar com iCal de reservas).~~ **Feito em 09/10/2026**: seção "Turnover de Airbnb, Vrbo e Booking" no painel; tabela `ag_ical_feeds`, sincronização em `api/_lib/icalSync.js` e cron `api/cron/ical-sync` de hora em hora (migration `supabase/ag_turnover_ical.sql`).

## 9. Métricas de sucesso

**Leading (avaliar em 30 dias da landing / do painel):**
- Waitlist ≥20 cadastros (meta) / ≥50 (stretch).
- Ativação: % de cadastradas que criam ≥5 casas → meta 50%.
- ≥70% das visitas da semana geradas por recorrência (query em `ag_appointments.recurring_job_id`).

**Lagging (90 dias):**
- 5 assinaturas pagas; churn mensal <10%; retenção semanal (dona abre o painel ≥2×/semana) >60%.
- Registrar tudo no `ag_platform_metrics` (adicionar corte por `vertical`).

## 10. Fases

| Fase | Escopo | Estimativa |
|---|---|---|
| **0 — Validação** | Landing + waitlist + divulgar na comunidade | 1–2 dias, dá pra fazer já |
| **1 — Core** | Migration, casas, recorrências, equipes, painel semana, lembretes, billing | ~2 semanas |
| **2 — Mapa & proximidade** | Mapa do dia, sugestão de encaixe, link da equipe | ~1 semana |
| **3 — Dinheiro & captação** | Pagamentos por visita, orçamento EN/PT, admin metrics | ~1 semana |

Sem deadline externo; Fase 0 primeiro pra não construir duas semanas de produto antes do primeiro sinal de demanda.

## 11. Perguntas em aberto

- **[Anderson/marca]** Nome: "AgendaPro Limpeza"? Marca própria ("LimpaPro", "CleanConnect")? Afeta landing e slug — **bloqueia Fase 0**.
- **[Anderson/produto]** Preço: manter $19/$39/$79 do AgendaPro (equipes a partir do plano do meio) ou tabela própria do vertical? Não bloqueia (trial primeiro).
- **[Eng]** Nominatim aguenta geocoding de endereço completo (rate limit 1 req/s) — suficiente no v1 com cache, ou já ir de Mapbox free tier? Resolver na Fase 1.
- **[Anderson/pesquisa]** Validar com 2–3 donas de schedule reais (conhecidas da comunidade) se o fluxo "recorrência + equipe + mapa" bate com a operação delas antes da Fase 1 — melhor insumo possível pro MVP.
