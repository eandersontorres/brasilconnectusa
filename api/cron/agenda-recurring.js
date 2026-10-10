/**
 * GET /api/cron/agenda-recurring
 *
 * Cron diario: empurra pra frente o horizonte das clientes fixas (recorrencia).
 * Pra cada regra ativa de profissional com o recurso 'recurring', cria os
 * agendamentos que faltam ate hoje + 6 semanas (no fuso da profissional).
 * Idempotente: rodar duas vezes nao duplica nada. Pega primeiro as regras
 * geradas ha mais tempo, dentro de ~45s; o que sobrar vai na proxima execucao.
 *
 * Fila sem trava: regra de quem nao tem o recurso no plano nunca avanca
 * generated_until e ficaria sempre no topo. Por isso a busca ja tira no banco
 * o teste gratis vencido e a regra terminada, e o resto (ex.: desceu pro
 * Starter) e pulado sem ocupar lugar no lote: le a pagina seguinte ate juntar
 * MAX_RULES regras com trabalho de verdade.
 *
 * Autenticacao: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron), header
 * `x-cron-secret` ou `?secret=` (chamadas manuais).
 */
import { createClient } from '@supabase/supabase-js'
import { hasFeature } from '../_lib/agendaPlans.js'
import { HORIZON_DAYS, addDays, blockedDays, generateForRule, wallNow } from '../_lib/recurring.js'

const MAX_RULES = 2000        // regras com trabalho a fazer por execucao
const PAGE_SIZE = 1000
const MAX_SCAN = 20000        // linhas lidas no maximo (contando as puladas)
const SCAN_BUDGET_MS = 15_000 // tempo maximo lendo paginas antes de gerar
const CONCURRENCY = 4
const BUDGET_MS = 45_000

const RULE_COLS = 'id, provider_id, client_id, service_id, staff_id, frequency, day_of_week, start_time, duration_min, price_cents, anchor_date, end_date, skip_dates, active, notes, generated_until'
const PROV_COLS = 'id, active, plan, plan_status, current_period_end, trial_ends_at, stripe_subscription_id, created_at, timezone'

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  const started = Date.now()
  const totals = { providers: 0, rules: 0, created: 0, failed: 0, skipped_plan: 0, up_to_date: 0, left: 0 }
  let supabase = null
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    const now = new Date()
    const utcToday = now.toISOString().slice(0, 10)

    // Agrupa por profissional: um "hoje", uma lista de folgas e uma busca de clientes por profissional
    const byProvider = new Map()
    let picked = 0
    let scanned = 0
    for (let from = 0; picked < MAX_RULES && scanned < MAX_SCAN; from += PAGE_SIZE) {
      if (from && Date.now() - started > SCAN_BUDGET_MS) break
      const { data: page, error } = await supabase.from('ag_recurring')
        .select(`${RULE_COLS}, ag_providers!inner(${PROV_COLS})`)
        .eq('active', true)
        // Terminou ha mais de um dia (em qualquer fuso): nao tem mais o que gerar
        .or(`end_date.is.null,end_date.gte.${addDays(utcToday, -1)}`)
        .eq('ag_providers.active', true)
        .in('ag_providers.plan_status', ['trialing', 'active', 'past_due'])
        // Teste gratis vencido (o status continua 'trialing' sem assinatura) fica fora ja aqui
        .or(`plan_status.neq.trialing,trial_ends_at.is.null,trial_ends_at.gt.${utcToday}`, { referencedTable: 'ag_providers' })
        .order('generated_until', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const rows = page || []
      scanned += rows.length

      for (const r of rows) {
        if (picked >= MAX_RULES) break
        const p = r.ag_providers
        if (!p) continue
        let g = byProvider.get(p.id)
        if (!g) {
          const allowed = hasFeature(p, 'recurring', now)
          const wall = allowed ? wallNow(p.timezone || 'America/New_York', now) : null
          g = { provider: p, allowed, wall, until: wall ? addDays(wall.key, HORIZON_DAYS) : null, rules: [] }
          byProvider.set(p.id, g)
        }
        // Sem o recurso no plano: nao gera e nao ocupa lugar no lote
        if (!g.allowed) { totals.skipped_plan++; continue }
        const { ag_providers, ...rule } = r
        // Ja gerada ate o horizonte (salva hoje pelo app) ou terminou: nada a fazer
        const done = rule.generated_until && String(rule.generated_until).slice(0, 10) >= g.until
        const ended = rule.end_date && String(rule.end_date).slice(0, 10) < g.wall.key
        if (done || ended) { totals.up_to_date++; continue }
        g.rules.push(rule)
        picked++
      }
      if (rows.length < PAGE_SIZE) break
    }

    const queue = [...byProvider.values()].filter((g) => g.rules.length)
    async function worker() {
      while (queue.length) {
        if (Date.now() - started > BUDGET_MS) { totals.left += queue.reduce((n, g) => n + g.rules.length, 0); queue.length = 0; return }
        const { provider, wall, until, rules: todo } = queue.shift()
        totals.providers++

        let blocked, clients
        try {
          blocked = await blockedDays(supabase, provider.id, wall.key, until)
          const ids = [...new Set(todo.map((r) => r.client_id))]
          const { data, error: cErr } = await supabase.from('ag_clients').select('id, name, whatsapp, email')
            .eq('provider_id', provider.id).in('id', ids)
          if (cErr) throw new Error(cErr.message)
          clients = new Map((data || []).map((c) => [c.id, c]))
        } catch (_) {
          totals.failed += todo.length
          continue
        }

        for (const rule of todo) {
          const client = clients.get(rule.client_id)
          if (!client) { totals.failed++; continue }
          const r = await generateForRule(supabase, rule, { today: wall.key, nowHHMM: wall.hhmm, blocked, client })
          totals.rules++
          if (r.ok) totals.created += r.created || 0
          else totals.failed++
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    await logRun(supabase, totals, Date.now() - started, null)
    return res.status(200).json({ ok: true, ...totals, ms: Date.now() - started })
  } catch (e) {
    if (supabase) await logRun(supabase, totals, Date.now() - started, e.message)
    return res.status(500).json({ error: e.message })
  }
}

/** Registro em bc_cron_logs (mesma tabela do check-alerts). Falha aqui nao derruba o cron. */
async function logRun(supabase, totals, ms, error) {
  try {
    await supabase.from('bc_cron_logs').insert({
      job_name: 'agenda-recurring',
      alerts_checked: totals.rules,
      alerts_triggered: totals.created,
      duration_ms: ms,
      error: error ? String(error).slice(0, 500) : (totals.failed ? `${totals.failed} regra(s) com erro` : null),
      ran_at: new Date().toISOString(),
    })
  } catch (_) {}
}
