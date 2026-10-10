#!/usr/bin/env node
// Abre o app no navegador em modo demonstração (dados de exemplo, sem login).
//   npm run web:demo                       → teste grátis, cabeleireira
//   npm run web:demo -- pro cleaning 8094  → plano, ramo e porta
const { spawn } = require('child_process')
const [plan = 'trial', vertical = 'services', port = '8094'] = process.argv.slice(2)
const env = { ...process.env, EXPO_PUBLIC_DEMO: '1', EXPO_PUBLIC_DEMO_PLAN: plan, EXPO_PUBLIC_DEMO_VERTICAL: vertical }
// --clear: no web o app.config (extra.demo) entra no bundle e o Metro guarda em cache
const child = spawn(`npx expo start --web --clear --port ${Number(port) || 8094}`, { stdio: 'inherit', env, shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
