# BrasilConnect Mobile — Design v1

> Documento de design da v1 do app mobile (iOS + Android). Wireframes baixa-fidelidade, arquitetura de informação e plano de navegação. **Ainda não é implementação** — é o blueprint que o código vai seguir.

---

## 1. Stack & infra

| Item | Escolha | Por quê |
|---|---|---|
| Framework | **Expo (managed) + React Native** | Reaproveita Supabase JS, tipos e lógica do web. Publica iOS + Android com um codebase. EAS Build resolve assinatura. |
| Linguagem | **JavaScript** (não TS) | Coerente com o resto do ecossistema BC/Clariva (DNA: Vite+React JS). |
| Navegação | **expo-router** (file-based) | Convergente com mental model do web (rotas = arquivos). Tabs + stack nativo. |
| Auth | **Supabase + magic link via deep link** | Mesmo `supabase-js` do web. Deep link `brasilconnect://auth/callback`. |
| Push | **expo-notifications + Supabase function** | Mesma fila do `PushOptInBanner` web; mobile só registra o `expo_push_token`. |
| Estado | `useState` / Context (sem Redux) | DNA Clariva — fetch direto, sem libs pesadas. |
| Tipografia | Cormorant Garamond (display) + Inter (UI) | Já é o DNA. `expo-font` carrega. |
| Distribuição | **EAS Build + EAS Submit** | Apple TestFlight + Google Play Internal Testing. |

---

## 2. Escopo da v1 (fechado)

✅ **Inclui** (nativo):
- Auth (magic link)
- Feed
- Comunidades (lista + detalhe + entrar/sair)
- Eventos (lista + RSVP + add-to-calendar)
- **Bolão** (palpite + ranking + push de jogo — crítico pra Copa 2026)
- Perfil + Settings
- Push notifications

🌐 **Inclui** (webview embedded):
- Remessas → abre `https://brasilconnect.com/app/remessas` em webview
- Voos → idem
- Marketplace → idem (browse-only via web; nativo vai pra v1.1)
- Discover "completão" → idem

⏳ **Fora da v1:**
- Marketplace nativo (browse + chat + criar anúncio com câmera → v1.1)
- Agenda

---

## 3. Arquitetura de informação

```
BrasilConnect Mobile
│
├── (auth) [stack, sem tab bar]
│   ├── /splash              → splash + decide rota inicial
│   ├── /welcome             → boas-vindas (logo + CTA)
│   └── /magic-link          → input email + "te mandamos um link"
│
└── (app) [bottom tab nav, 5 tabs]
    │
    ├── 🏠 Feed              (tab 1, default)
    │   ├── /feed                       → timeline
    │   ├── /feed/post/[id]             → detalhe post + comentários
    │   └── /feed/compose               → novo post (modal)
    │
    ├── 🌐 Comunidades       (tab 2)
    │   ├── /communities                → lista + busca
    │   └── /communities/[slug]         → detalhe (sobre + posts + membros)
    │
    ├── 🎉 Eventos           (tab 3)
    │   ├── /events                     → próximos eventos
    │   └── /events/[id]                → detalhe + RSVP + "Add to calendar"
    │
    ├── ⚽ Bolão              (tab 4)
    │   ├── /bolao                       → grupos + próximas partidas
    │   ├── /bolao/match/[id]            → palpite (1 tap, com countdown)
    │   ├── /bolao/group/[id]            → ranking do grupo
    │   └── /bolao/join                  → entrar via join code
    │
    └── 👤 Perfil            (tab 5)
        ├── /profile                    → minha conta
        ├── /profile/settings           → settings (push, idioma, etc)
        ├── /profile/notifications      → central de notifs in-app
        └── /profile/more               → links pra Remessas, Voos, Marketplace (webview)
```

**Notas sobre a navegação:**
- Bottom tab bar fixa em 5 tabs (regra HIG / Material — não passar disso).
- "Discover/Buscar" do web foi diluído: a busca vive como **search bar persistente no topo do Feed e Comunidades** (não merece tab própria).
- Câmbio/Remessas, Voos e Marketplace saíram da tab bar — viraram entradas no menu "Mais" do Perfil (webview). Razão: são uso esporádico, não recorrente. Recorrente é Feed, Eventos e Bolão.
- **Bolão entrou como tab dedicada** (substituindo Marketplace) por causa da Copa 2026 (jun/jul). Brasileiros nos EUA + Copa = pico de aquisição. Marketplace nativo volta na v1.1.

---

## 4. Wireframes

### 4.1 Auth flow

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│                     │    │                     │    │                     │
│                     │    │   ← Voltar          │    │     ✉                │
│                     │    │                     │    │                     │
│    BrasilConnect    │    │   Entrar            │    │   Confira seu       │
│    ───────          │    │                     │    │   email             │
│                     │    │   Email             │    │                     │
│   Comunidade        │    │   ┌───────────────┐ │    │   Mandamos um link  │
│   brasileira nos    │    │   │ voce@email.com│ │    │   pra voce@email.com│
│   EUA, num app.     │    │   └───────────────┘ │    │                     │
│                     │    │                     │    │   Toca no link no   │
│                     │    │   ┌───────────────┐ │    │   email pra entrar. │
│   [Entrar / Criar]  │    │   │ Receber link →│ │    │                     │
│                     │    │   └───────────────┘ │    │   [Reenviar email]  │
│                     │    │                     │    │                     │
│   ───── Termos ──── │    │   Sem senha. Só link│    │                     │
│                     │    │   mágico no email.  │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
   /welcome                  /magic-link                /magic-link/sent
```

### 4.2 Feed (tab principal)

```
┌─────────────────────────────────────┐
│ ☰  BrasilConnect          🔔  👤   │ ← header: logo + notifs + avatar
├─────────────────────────────────────┤
│  🔍 Buscar posts, pessoas...        │ ← search bar (toca pra expandir)
├─────────────────────────────────────┤
│                                     │
│  📍 Brasileiros em Austin           │ ← chip "comunidade"
│  ┌───────────────────────────────┐  │
│  │ 👤 Maria Silva    · 2h         │  │
│  │ Alguém conhece dentista que    │  │
│  │ aceita Delta Dental aqui em    │  │
│  │ Round Rock?                    │  │
│  │                                │  │
│  │ 💬 7   ❤️ 12   ↗ Compartilhar │  │
│  └───────────────────────────────┘  │
│                                     │
│  🎉 Eventos esta semana             │ ← chip "evento"
│  ┌───────────────────────────────┐  │
│  │ Festa Junina BC Austin         │  │
│  │ 📅 Sáb 21 · 19h · Zilker Park │  │
│  │ 👥 47 confirmados              │  │
│  │ [Vou]  [Talvez]                │  │
│  └───────────────────────────────┘  │
│                                     │
│  💼 Vagas                            │ ← chip "vaga"
│  ┌───────────────────────────────┐  │
│  │ Garçom – TorresBee Round Rock  │  │
│  │ 📍 Round Rock TX · $18–22/h    │  │
│  │ Postado por @torresbee · 1d    │  │
│  └───────────────────────────────┘  │
│                                     │
│ ─────────────────────────────────── │
│ │🏠│🌐│🎉│🛍│👤│                    │ ← bottom tabs
└─────────────────────────────────────┘
                          [ + ]         ← FAB "Novo post" canto inf. dir.
```

**Interações:**
- Pull-to-refresh no topo.
- Tap no card → detalhe.
- Long-press no card → menu (reportar, silenciar autor).
- FAB com `+` abre modal de novo post.

### 4.3 Comunidades (tab 2)

```
┌─────────────────────────────────────┐
│ Comunidades              + Criar    │
├─────────────────────────────────────┤
│  🔍 Buscar comunidades...           │
├─────────────────────────────────────┤
│  Por perto                          │
│  ┌────────┐ ┌────────┐ ┌────────┐  │
│  │  🏞    │ │  ⚽    │ │  💼   │  │  ← cards horizontais scrolláveis
│  │ Austin │ │ Futebol│ │ Tech  │  │
│  │ 1.2k   │ │ 340    │ │ 850   │  │
│  └────────┘ └────────┘ └────────┘  │
│                                     │
│  Minhas comunidades  (3)            │
│  ┌───────────────────────────────┐  │
│  │ 🏞 Brasileiros em Austin   ›  │  │
│  │    1.247 membros · 12 novos   │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 🍔 Comida Brasileira TX    ›  │  │
│  │    412 membros                │  │
│  └───────────────────────────────┘  │
│                                     │
│  Descobrir                          │
│  ┌───────────────────────────────┐  │
│  │ 💼 Mulheres na Tech US     ›  │  │
│  │    [+ Entrar]                 │  │
│  └───────────────────────────────┘  │
│                                     │
│ │🏠│🌐│🎉│🛍│👤│                    │
└─────────────────────────────────────┘
```

### 4.4 Detalhe de comunidade

```
┌─────────────────────────────────────┐
│ ←                            ⋮     │
├─────────────────────────────────────┤
│         🏞                          │
│    Brasileiros em Austin            │ ← hero compacto
│    1.247 membros · pública          │
│                                     │
│    [ + Entrar ]                     │ ← CTA primário
├─────────────────────────────────────┤
│  [ Posts ] [ Sobre ] [ Membros ]    │ ← tab pills
├─────────────────────────────────────┤
│  📌 Fixado                          │
│  ┌───────────────────────────────┐  │
│  │ Boas-vindas! Leiam as regras  │  │
│  │ antes de postar.              │  │
│  └───────────────────────────────┘  │
│                                     │
│  Posts recentes                     │
│  ┌───────────────────────────────┐  │
│  │ 👤 João · 3h                  │  │
│  │ Dica de mecânico confiável?   │  │
│  │ 💬 4  ❤️ 8                    │  │
│  └───────────────────────────────┘  │
│  ...                                │
└─────────────────────────────────────┘
```

### 4.5 Eventos (tab 3)

```
┌─────────────────────────────────────┐
│ Eventos                     + Criar │
├─────────────────────────────────────┤
│  [ Próximos ] [ Meus ] [ Passados ] │
├─────────────────────────────────────┤
│  Esta semana                        │
│  ┌───────────────────────────────┐  │
│  │  SAT  │ Festa Junina BC       │  │
│  │  21   │ 19h · Zilker Park     │  │
│  │  JUN  │ 47 vão                │  │
│  │       │ [ Vou ] [ Talvez ]    │  │
│  └───────────────────────────────┘  │
│                                     │
│  Próximas semanas                   │
│  ┌───────────────────────────────┐  │
│  │  SUN  │ Pelada Brasileira     │  │
│  │  29   │ 16h · Field 3         │  │
│  │  JUN  │ 12 vão                │  │
│  └───────────────────────────────┘  │
│                                     │
│ │🏠│🌐│🎉│🛍│👤│                    │
└─────────────────────────────────────┘
```

### 4.6 Bolão (tab 4)

```
┌─────────────────────────────────────┐
│ Bolão                       + Grupo │ ← + Grupo abre /bolao/join
├─────────────────────────────────────┤
│  Meu grupo                          │
│  ┌───────────────────────────────┐  │
│  │  Brasileiros Austin TX     ▾  │  │ ← switcher de grupo ativo
│  │  47 participantes · #3 lugar  │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  Próximo jogo                       │
│  ┌───────────────────────────────┐  │
│  │  🇧🇷 BRA  vs  ARG 🇦🇷         │  │
│  │  Sáb 14 jun · 16h  · ⏱ 2d 4h │  │
│  │                                │  │
│  │  Seu palpite:                  │  │
│  │  ┌───┐   ┌───┐                 │  │
│  │  │ 2 │ x │ 1 │   [ Salvar ]    │  │ ← steppers + 1 tap
│  │  └───┘   └───┘                 │  │
│  └───────────────────────────────┘  │
│                                     │
│  Próximas (3)                       │
│  ┌───────────────────────────────┐  │
│  │ 🇫🇷 FRA vs ESP 🇪🇸  · Dom 15  ›│  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 🇮🇹 ITA vs POR 🇵🇹  · Seg 16  ›│  │
│  └───────────────────────────────┘  │
│                                     │
│  Ranking do grupo                   │
│  1. @rafa        148 pts           │
│  2. @julia        137 pts          │
│  3. @você         122 pts  ⭐       │
│  [ Ver ranking completo → ]         │
│                                     │
│ │🏠│🌐│🎉│⚽│👤│                    │
└─────────────────────────────────────┘
```

**Interações nativas que justificam ser tab (não webview):**
- Push notification "Jogo em 1h, ainda dá pra palpitar" (expo-notifications).
- Palpite via stepper de 1 toque + haptic feedback no salvar.
- Countdown ao vivo até o kickoff.
- Compartilhar grupo via link nativo (`brasilconnect://bolao/join?code=ABC123`).

### 4.7 Perfil (tab 5)

```
┌─────────────────────────────────────┐
│                                  ⚙ │
├─────────────────────────────────────┤
│         👤                          │
│       Maria Silva                   │
│    @maria · Austin, TX              │
│                                     │
│    [ Editar perfil ]                │
├─────────────────────────────────────┤
│  📊 Minha atividade                 │
│  ┌───┬───┬───┐                      │
│  │ 12│ 3 │ 47│                      │
│  │pos│com│∋  │                      │
│  └───┴───┴───┘                      │
├─────────────────────────────────────┤
│  Mais                               │
│  💵 Câmbio & Remessas         ›    │ ← abre webview
│  ✈️ Voos pro Brasil           ›    │ ← abre webview
│  🛍 Marketplace               ›    │ ← abre webview (v1.1 nativo)
├─────────────────────────────────────┤
│  Conta                              │
│  🔔 Notificações              ›    │
│  ⚙ Configurações              ›    │
│  💬 Feedback                  ›    │
│  ❓ Ajuda                     ›    │
│  ↳ Sair                            │
└─────────────────────────────────────┘
```

---

## 5. Native wins (onde mobile > web)

Coisas que **só fazem sentido pelo fato de ser nativo** — vale priorizar essas pra justificar o app existir:

| Feature | Detalhe |
|---|---|
| **Push notifications** | "Novo post na sua comunidade", "Evento amanhã", "Mensagem no marketplace". Web push iOS é ruim — esse é o killer feature. |
| **Add to calendar** | Botão no detalhe do evento usa `expo-calendar` → cria evento no iOS Calendar / Google Calendar. |
| **Deep linking** | Link de email do magic link abre app direto. Compartilhar evento abre tela do evento. |
| **Câmera + galeria** | Avatar do perfil + futuras fotos no marketplace (v1.1) usam `expo-image-picker`. |
| **Localização** | "Eventos perto de mim" pede `expo-location` (com permission prompt nativo, melhor UX que web). |
| **Haptics** | Feedback tátil em RSVP, curtir post — pequeno mas faz parecer "app de verdade". |

---

## 6. Design system (tokens)

Reaproveitando o DNA do web (`src/lib/colors.js`):

```js
// mobile/lib/theme.js (esboço)
export const colors = {
  navy: '#001a5e',          // primary
  green: '#009c3b',          // success / CTA
  gold: '#FFD700',           // badge / acento (logo)
  paper: '#FAFAF9',          // background
  white: '#FFFFFF',
  text: '#0B1928',
  textMuted: '#6B7280',
  border: '#E5E7EB',
}

export const fonts = {
  serif: 'CormorantGaramond_500Medium',  // headlines
  sans:  'Inter_400Regular',              // UI
  sansBold: 'Inter_700Bold',
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const radius  = { sm: 6, md: 10, lg: 14, full: 999 }
```

---

## 7. Plano de implementação (depois do design aprovado)

1. **Semana 1** — Scaffold Expo + expo-router, design tokens, Supabase client, splash + auth (magic link via deep link). ✅ feito
2. **Semana 2** — Tab bar + Feed (read-only, sem compose).
3. **Semana 3** — Comunidades (lista + detalhe + entrar/sair).
4. **Semana 4** — Eventos + RSVP + add-to-calendar.
5. **Semana 5** — Bolão parte 1: grupos, multi-membership, listagem de partidas, palpite.
6. **Semana 6** — Bolão parte 2: ranking, countdown ao vivo, deep link de join, integração com API de jogos.
7. **Semana 7** — Perfil + Settings + webview pra Remessas/Voos/Marketplace.
8. **Semana 8** — Push notifications end-to-end (com foco em "jogo em 1h" do Bolão).
9. **Semana 9** — Polimento, ícones, splash screens, EAS Build + TestFlight + Play Internal.

> **Janela crítica:** se quiser o Bolão nas lojas antes da Copa 2026 (kickoff jun/2026), a release precisa estar submetida até **fim de maio**, considerando 1-2 semanas de review da Apple/Google + buffer.

---

## 8. Decisões em aberto (precisa input)

- [ ] **Nome do app nas lojas:** "BrasilConnect" ou "Brasil Connect USA"?
- [ ] **Bundle ID:** `com.brasilconnect.app` ou outro?
- [ ] **App icon:** vamos reusar a marca BC do web ou desenhar versão app-icon dedicada (mais bold)?
- [ ] **Splash:** logo no centro + verde-Brasil de fundo, ou foto-mood de fundo?
- [ ] **Onboarding:** mostrar 3 slides de "o que tem aqui" antes do login na 1ª vez, ou ir direto pro welcome?
- [ ] **i18n:** PT-BR only na v1, ou já preparar EN tb (alguns filhos de brasileiros nos EUA não falam PT)?
