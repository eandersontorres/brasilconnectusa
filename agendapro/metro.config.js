// ════════════════════════════════════════════════════════════════════════════
//   Metro config — força o bundler a resolver SÓ em agendapro/node_modules.
//   Sem isso, ele subiria pro repo raiz e pegaria react@18 do web (Vite).
// ════════════════════════════════════════════════════════════════════════════
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
config.resolver.disableHierarchicalLookup = true

module.exports = config
