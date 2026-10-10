#!/usr/bin/env node
// Checagem rápida do app sem subir o bundler: sintaxe (JSX) de todo arquivo, se
// cada import resolve (arquivo relativo existe; pacote está instalado) e se os
// nomes importados de arquivos do app existem no arquivo de origem (o Metro não
// acusa isso: o nome vira undefined e a tela quebra só quando abre).
//   node scripts/check.js            → tudo
//   node scripts/check.js app/hours.js lib/x.js
const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

const ROOT = path.resolve(__dirname, '..')
const SKIP = new Set(['node_modules', '.expo', 'dist', 'web-build', 'assets', 'scripts'])

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.config\.js$/.test(name)) out.push(p)
  }
  return out
}

function resolveRel(from, spec) {
  const base = path.resolve(path.dirname(from), spec)
  const tries = [base, base + '.js', base + '.jsx', path.join(base, 'index.js')]
  return tries.find((t) => fs.existsSync(t) && fs.statSync(t).isFile())
}

const exportCache = new Map()
/** Nomes exportados por um arquivo do app (null = não deu pra saber, ex.: export *). */
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file)
  let names = new Set()
  try {
    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
    for (const n of ast.program.body) {
      if (n.type === 'ExportDefaultDeclaration') names.add('default')
      else if (n.type === 'ExportAllDeclaration') { names = null; break }
      else if (n.type === 'ExportNamedDeclaration') {
        const d = n.declaration
        if (d && d.id) names.add(d.id.name)
        if (d && d.declarations) for (const v of d.declarations) if (v.id && v.id.name) names.add(v.id.name)
        for (const sp of n.specifiers || []) names.add(sp.exported.name || sp.exported.value)
      }
    }
  } catch (_) { names = null }
  exportCache.set(file, names)
  return names
}

function pkgName(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => path.resolve(process.cwd(), f))
  : walk(ROOT)

let errors = 0
for (const file of files) {
  const rel = path.relative(ROOT, file)
  const code = fs.readFileSync(file, 'utf8')
  let ast
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  } catch (e) {
    console.log(`✗ ${rel}: ${e.message}`)
    errors++
    continue
  }
  const specs = []
  for (const node of ast.program.body) {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      specs.push(node.source.value)
    }
  }
  // require('x') e import('x') também contam
  const re = /(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(code))) specs.push(m[1])

  // import { a, b } from './x' → a e b precisam existir em x
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue
    const target = resolveRel(file, node.source.value)
    const names = target ? exportsOf(target) : null
    if (!names) continue
    for (const sp of node.specifiers) {
      const want = sp.type === 'ImportDefaultSpecifier' ? 'default' : sp.type === 'ImportSpecifier' ? (sp.imported.name || sp.imported.value) : null
      if (want && !names.has(want)) { console.log(`✗ ${rel}: "${want}" não é exportado por ${node.source.value}`); errors++ }
    }
  }

  for (const spec of specs) {
    if (spec.startsWith('.')) {
      if (!resolveRel(file, spec)) { console.log(`✗ ${rel}: import não encontrado "${spec}"`); errors++ }
    } else {
      const name = pkgName(spec)
      if (!fs.existsSync(path.join(ROOT, 'node_modules', name))) { console.log(`✗ ${rel}: pacote não instalado "${name}"`); errors++ }
    }
  }
  // Rota do expo-router precisa de export default
  if (rel.startsWith('app' + path.sep) && !/export\s+default/.test(code)) {
    console.log(`✗ ${rel}: tela sem export default`)
    errors++
  }
}

// A matriz de planos do modo demonstração é cópia de api/_lib/agendaPlans.js
if (!process.argv.slice(2).length) {
  try {
    const body = (f) => { const t = fs.readFileSync(f, 'utf8'); return t.slice(t.indexOf('export const TRIAL_DAYS')) }
    const srv = path.resolve(ROOT, '..', 'api', '_lib', 'agendaPlans.js')
    if (fs.existsSync(srv) && body(srv) !== body(path.join(ROOT, 'lib', 'demo', 'plans.js'))) {
      console.log('✗ lib/demo/plans.js: diferente de api/_lib/agendaPlans.js (copie a matriz de novo)')
      errors++
    }
    const calcBody = (f) => { const t = fs.readFileSync(f, 'utf8'); return t.slice(t.indexOf('export const UNITS')) }
    const calcSrv = path.resolve(ROOT, '..', 'api', '_lib', 'docCalc.js')
    if (fs.existsSync(calcSrv) && calcBody(calcSrv) !== calcBody(path.join(ROOT, 'lib', 'docCalc.js'))) {
      console.log('✗ lib/docCalc.js: diferente de api/_lib/docCalc.js (copie a conta de novo)')
      errors++
    }
  } catch (_) {}
}

console.log(errors ? `\n${errors} problema(s) em ${files.length} arquivo(s)` : `✓ ${files.length} arquivo(s) ok`)
process.exit(errors ? 1 : 0)
