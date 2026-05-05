/**
 * Rate limiting in-memory simples.
 * Funciona bem em Vercel pra um nivel inicial — cada serverless instance tem seu proprio cache,
 * mas pra abuso real (10k req/s) precisaria de Upstash Redis.
 *
 * Uso:
 *   import { rateLimit } from '../_lib/rateLimit.js'
 *   const limited = rateLimit(req, { windowMs: 60000, max: 30 })
 *   if (limited) return res.status(429).json({ error: 'Muitas requisicoes. Tenta de novo em 1min.' })
 */
const buckets = new Map()

function getKey(req) {
  // Vercel: x-forwarded-for | x-real-ip
  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '0.0.0.0').split(',')[0].trim()
  // Path agrupa por endpoint (evita 1 user esgotar tudo)
  const path = (req.url || '').split('?')[0]
  return ip + ':' + path
}

function cleanOld() {
  const now = Date.now()
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k)
  }
}

export function rateLimit(req, { windowMs = 60_000, max = 30 } = {}) {
  if (buckets.size > 5000) cleanOld()
  const key = getKey(req)
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return null  // ok
  }
  bucket.count++
  if (bucket.count > max) {
    return { retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return null
}
