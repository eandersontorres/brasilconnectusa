/**
 * GET /api/push/vapid
 * Retorna a VAPID public key (segura pra expor).
 * Usada pelo client pra fazer pushManager.subscribe()
 */
export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const key = process.env.VAPID_PUBLIC_KEY || null
  if (!key) {
    return res.status(503).json({
      error: 'Push notifications nao configuradas. Falta VAPID_PUBLIC_KEY no Vercel.',
      configured: false,
    })
  }
  return res.status(200).json({ public_key: key, configured: true })
}
