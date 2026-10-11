/**
 * Assistente — custo das chamadas ao Claude Haiku 5.5.
 * Preço em US$ por milhão de tokens (prompt até 100K tokens).
 */
export const PRICES = {
  input: 0.10,
  output: 0.50,
  cache_read: 0.01,
  cache_write: 0.125, // cache de 5 min
}

export function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0 }
}

/** Soma o usage de uma resposta da API no acumulador (muta e devolve). */
export function addUsage(acc, u) {
  const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
  acc.input_tokens += n(u?.input_tokens)
  acc.output_tokens += n(u?.output_tokens)
  acc.cache_read_input_tokens += n(u?.cache_read_input_tokens)
  acc.cache_creation_input_tokens += n(u?.cache_creation_input_tokens)
  acc.calls += 1
  return acc
}

/** Custo em US$, arredondado em 6 casas (cabe em numeric(10,6)). */
export function costUsd(u) {
  if (!u) return 0
  const usd = (
    (u.input_tokens || 0) * PRICES.input +
    (u.output_tokens || 0) * PRICES.output +
    (u.cache_read_input_tokens || 0) * PRICES.cache_read +
    (u.cache_creation_input_tokens || 0) * PRICES.cache_write
  ) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}
