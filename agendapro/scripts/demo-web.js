#!/usr/bin/env node
// Abre o app no navegador em modo demonstração (dados de exemplo, sem login).
//   npm run web:demo                                 → AgendaPro, teste grátis, cabeleireira
//   npm run web:demo -- pro cleaning 8094            → plano, ramo e porta
//   npm run web:demo -- trial trades 8095 workpro    → WorkPro (Silva Remodeling, orçamentos e faturas)
//   npm run web:demo -- starter "" 8095 workpro      → WorkPro no Starter (ramo vazio = trades)
// Argumentos na ordem: [plano] [ramo] [porta] [variante]
//   plano:    trial (padrão) | starter | pro | premium | none
//   ramo:     services (padrão no AgendaPro) | cleaning | trades (padrão no WorkPro)
//   porta:    8094 (padrão)
//   variante: agendapro (padrão) | workpro  → APP_VARIANT (marca, cores e abas)
const { spawn } = require('child_process')
const PLANS = ['trial', 'starter', 'pro', 'premium', 'none']
const VERTICALS = ['services', 'cleaning', 'trades']
const VARIANTS = ['agendapro', 'workpro']

const [planArg, verticalArg, portArg, variantArg] = process.argv.slice(2)
const variant = VARIANTS.includes(variantArg) ? variantArg : (process.env.APP_VARIANT === 'workpro' ? 'workpro' : 'agendapro')
const plan = PLANS.includes(planArg) ? planArg : 'trial'
const vertical = VERTICALS.includes(verticalArg) ? verticalArg : (variant === 'workpro' ? 'trades' : 'services')
const port = Number(portArg) || 8094
for (const [name, val, list] of [['plano', planArg, PLANS], ['ramo', verticalArg, VERTICALS], ['variante', variantArg, VARIANTS]]) {
  if (val && !list.includes(val)) console.warn(`[demo] ${name} "${val}" não existe (use ${list.join(' | ')}). Usando o padrão.`)
}

const env = { ...process.env, APP_VARIANT: variant, EXPO_PUBLIC_DEMO: '1', EXPO_PUBLIC_DEMO_PLAN: plan, EXPO_PUBLIC_DEMO_VERTICAL: vertical }
console.log(`[demo] ${variant === 'workpro' ? 'WorkPro' : 'AgendaPro'} · plano ${plan} · ramo ${vertical} · porta ${port}`)
// --clear: no web o app.config (extra.demo) entra no bundle e o Metro guarda em cache
const child = spawn(`npx expo start --web --clear --port ${port}`, { stdio: 'inherit', env, shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
