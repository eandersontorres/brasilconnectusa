/**
 * GET /api/cron/ical-sync
 *
 * Cron de hora em hora: sincroniza os calendarios .ics das casas (turnover de
 * Airbnb, Vrbo e Booking) das profissionais com plano em teste ou ativo.
 * Pega primeiro as casas sincronizadas ha mais tempo, ate 60 por execucao e
 * dentro de ~45s, com 6 downloads em paralelo. O que sobrar vai na proxima hora.
 *
 * Autenticacao: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron), header
 * `x-cron-secret` ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'
import { syncFeed } from '../_lib/icalSync.js'

const MAX_PER_RUN = 60
const CONCURRENCY = 6
const BUDGET_MS = 45_000
// Nao repete casa sincronizada ha menos de 30 min (botao "Sincronizar agora" ou execucao anterior)
const MIN_AGE_MS = 30 * 60 * 1000

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  const started = Date.now()
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const staleBefore = new Date(started - MIN_AGE_MS).toISOString()
    const { data: feeds, error } = await supabase.from('ag_ical_feeds')
      .select('id, provider_id, label, url, source, checkout_time, duration_min, price_cents, last_synced_at, ag_providers!inner(plan_status, active)')
      .eq('active', true)
      .in('ag_providers.plan_status', ['trialing', 'active'])
      .eq('ag_providers.active', true)
      .or('last_synced_at.is.null,last_synced_at.lt."' + staleBefore + '"')
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(MAX_PER_RUN)
    if (error) return res.status(500).json({ error: error.message })

    const queue = (feeds || []).slice()
    const totals = { feeds: 0, ok: 0, failed: 0, created: 0, updated: 0, canceled: 0, skipped: 0 }

    async function worker() {
      while (queue.length) {
        if (Date.now() - started > BUDGET_MS) { totals.skipped += queue.length; queue.length = 0; return }
        const f = queue.shift()
        const r = await syncFeed(supabase, f)
        totals.feeds++
        if (r.ok) {
          totals.ok++
          totals.created += r.created
          totals.updated += r.updated
          totals.canceled += r.canceled
        } else {
          totals.failed++
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    return res.status(200).json({ ok: true, ...totals, ms: Date.now() - started })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
