// Gera public/og-image.png (1200x630) a partir de public/og-image.svg.
// WhatsApp, Facebook e X nao mostram SVG como imagem de compartilhamento.
// Uso: node scripts/build-og-image.mjs   (precisa do pacote sharp instalado)
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../public/og-image.svg', import.meta.url))
const out = fileURLToPath(new URL('../public/og-image.png', import.meta.url))
const info = await sharp(readFileSync(src), { density: 96 })
  .resize(1200, 630)
  .png({ compressionLevel: 9, palette: true })
  .toFile(out)
console.log('og-image.png', info.width + 'x' + info.height, Math.round(info.size / 1024) + ' KB')
