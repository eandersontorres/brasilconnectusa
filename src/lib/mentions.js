// Mentions parser/renderer: transforma @username em links clicaveis
// Tambem extrai menciones de um texto pra criar notificacoes

// Regex: @ seguido de letras/numeros/underscore (3-30 chars)
const MENTION_RE = /(^|\s)@([a-zA-Z0-9_]{3,30})/g

export function extractMentions(text) {
  if (!text) return []
  const result = []
  let m
  const re = new RegExp(MENTION_RE.source, 'g')
  while ((m = re.exec(text)) !== null) {
    result.push(m[2].toLowerCase())
  }
  return [...new Set(result)]
}

// Renderiza texto com mentions clicaveis (retorna array de spans/links pra React)
export function renderTextWithMentions(text) {
  if (!text) return []
  const parts = []
  let last = 0
  const re = new RegExp(MENTION_RE.source, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index + m[1].length)
    if (before) parts.push({ type: 'text', value: before })
    parts.push({ type: 'mention', value: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
