/**
 * GET /api/cron/ical-sync
 *
 * Cron de hora em hora: sincroniza os calendarios .ics das casas (turnover de
 * Airbnb, Vrbo e Booking) das profissionais cujo plano libera o turnover
 * (api/_lib/agendaPlans.js). Depois de um rebaixamento de plano, so as casas
 * mais antigas dentro do limite continuam sincronizando.
 * Pega primeiro as casas sincronizadas ha mais tempo, ate 60 por execucao e
 * dentro de ~45s, com 6 downloads em paralelo. O que sobrar vai na proxima hora.
 *
 * Autenticacao: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron), header
 * `x-cron-secret` ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'
import { syncFeed } from '../_lib/icalSync.js'
import { hasFeature, limitFor } from '../_lib/agendaPlans.js'

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
    // Casas puladas (teste vencido, plano sem turnover, acima do limite) nao
    // sincronizam e ficam com last_synced_at antigo, sempre no topo da ordem.
    // Por isso a busca anda em paginas ate juntar MAX_PER_RUN casas liberadas,
    // em vez de cortar antes do filtro de plano (que travava a fila de todo mundo).
    const PAGE = 200
    const MAX_SCAN = 3000
    const allowed = new Map()   // provider_id → Set de feed ids dentro do limite (null = todas)
    const feeds = []
    for (let offset = 0; offset < MAX_SCAN && feeds.length < MAX_PER_RUN; offset += PAGE) {
      const { data: page, error } = await supabase.from('ag_ical_feeds')
        .select('id, provider_id, label, url, source, checkout_time, duration_min, price_cents, last_synced_at, ag_providers!inner(id, plan, plan_status, trial_ends_at, created_at, stripe_subscription_id, current_period_end, active)')
        .eq('active', true)
        .in('ag_providers.plan_status', ['trialing', 'active', 'past_due'])
        .eq('ag_providers.active', true)
        .or('last_synced_at.is.null,last_synced_at.lt."' + staleBefore + '"')
        .order('last_synced_at', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error) return res.status(500).json({ error: error.message })

      // Plano de cada profissional: libera turnover? quantas casas?
      for (const f of page || []) {
        if (allowed.has(f.provider_id)) continue
        const prov = f.ag_providers
        if (!hasFeature(prov, 'turnover_ical')) { allowed.set(f.provider_id, new Set()); continue }
        const max = limitFor(prov, 'ical_feeds')
        if (max === null) { allowed.set(f.provider_id, null); continue }
        const { data: oldest } = await supabase.from('ag_ical_feeds').select('id')
          .eq('provider_id', f.provider_id).eq('active', true)
          .order('created_at', { ascending: true }).limit(max)
        allowed.set(f.provider_id, new Set((oldest || []).map(x => x.id)))
      }
      for (const f of page || []) {
        const ok = allowed.get(f.provider_id)
        if ((ok === null || (ok && ok.has(f.id))) && feeds.length < MAX_PER_RUN) feeds.push(f)
      }
      if (!page || page.length < PAGE) break
      if (Date.now() - started > BUDGET_MS / 3) break
    }

    const queue = (feeds || []).slice()
    const totals = { feeds: 0, ok: 0, failed: 0, created: 0, updated: 0, canceled: 0, skipped: 0 }

    async function worker() {
      while (queue.length) {
        if (Date.now() - started > BUDGET_MS) { totals.skipped += queue.length; queue.length = 0; return }
        const f = queue.shift()
        const r = await syncFeed(supabase, f, { notify: true })
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
