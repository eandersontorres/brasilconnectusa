/**
 * Clientes fixas (recorrencia) do AgendaPro: regras em ag_recurring viram
 * agendamentos de verdade em ag_appointments num horizonte rolante (6 semanas).
 *
 *   occurrences(rule, '2026-10-01', '2026-11-30')     → ['2026-10-08', ...]  (funcao pura)
 *   await generateForRule(supabase, rule, { today })  → cria o que falta, idempotente
 *   await regenerate(supabase, rule, { today })       → apaga as futuras em aberto e gera de novo
 *
 * Regras:
 *   - frequencia conta a partir de anchor_date (primeira data, ja no dia da semana);
 *   - end_date e skip_dates (semanas puladas) ficam de fora;
 *   - dia bloqueado inteiro (ag_blocked_dates) nao recebe agendamento, nem o
 *     horario que sobrepoe uma folga parcial do dia (mesma regra de ag_is_blocked);
 *   - ocorrencia que ja existe nunca e recriada, nem se foi cancelada
 *     (UNIQUE recurring_id + occurrence_date, upsert com DO NOTHING);
 *   - pago (sinal ou pagamento registrado) nunca e apagado.
 *
 * Horarios seguem a convencao do AgendaPro: hora do relogio da profissional
 * guardada sem fuso (como se fosse UTC). "Hoje" vem do fuso ag_providers.timezone.
 */

export const FREQUENCIES = { weekly: 1, biweekly: 2, every3weeks: 3, every4weeks: 4 }
export const HORIZON_DAYS = 42
export const OPEN = ['pending', 'confirmed']
const MAX_OCCURRENCES = 400
const KEY = /^\d{4}-\d{2}-\d{2}$/

// ── Datas 'YYYY-MM-DD' (meio-dia UTC: sem surpresa de horario de verao) ──────
export const isDateKey = (s) => KEY.test(String(s || '')) && !Number.isNaN(new Date(String(s) + 'T12:00:00Z').getTime())
  && new Date(String(s) + 'T12:00:00Z').toISOString().slice(0, 10) === String(s)

export function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const weekdayOf = (key) => new Date(key + 'T12:00:00Z').getUTCDay()

export const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000)

/** Primeira data >= key que cai no dia da semana `dow` (0 = domingo). */
export function alignToWeekday(key, dow) {
  const back = (Number(dow) - weekdayOf(key) + 7) % 7
  return addDays(key, back)
}

/** 'HH:MM:SS' ou 'HH:MM' → 'HH:MM'. */
export const hhmm = (t) => String(t || '09:00').slice(0, 5)

/** Data e hora do relogio no fuso da profissional agora. */
export function wallNow(timezone = 'America/New_York', now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now)
    const get = (t) => (parts.find((p) => p.type === t) || {}).value
    const h = get('hour') === '24' ? '00' : get('hour')
    return { key: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${h}:${get('minute')}` }
  } catch (_) {
    // Fuso invalido: usa o horario de Nova York aproximado (UTC-5)
    const d = new Date(now.getTime() - 5 * 3600e3)
    return { key: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16) }
  }
}

export const todayIn = (timezone, now) => wallNow(timezone, now).key

/** ISO de parede: '2026-10-13' + '10:00' → '2026-10-13T10:00:00.000Z'. */
export const wallIso = (key, time) => `${key}T${hhmm(time)}:00.000Z`

/**
 * Datas da regra entre fromKey e toKey (inclusive), em ordem.
 * rule: { frequency, day_of_week, anchor_date, end_date?, skip_dates? }
 */
export function occurrences(rule, fromKey, toKey, { max = MAX_OCCURRENCES } = {}) {
  const step = FREQUENCIES[rule && rule.frequency]
  if (!step || !isDateKey(rule.anchor_date) || !isDateKey(fromKey) || !isDateKey(toKey)) return []
  const dow = Number.isInteger(Number(rule.day_of_week)) ? Number(rule.day_of_week) : weekdayOf(rule.anchor_date)
  const first = alignToWeekday(rule.anchor_date, dow)
  const end = rule.end_date && isDateKey(rule.end_date) && rule.end_date < toKey ? rule.end_date : toKey
  const skip = new Set((rule.skip_dates || []).map((s) => String(s).slice(0, 10)))

  const period = step * 7
  let k = 0
  if (fromKey > first) k = Math.ceil(diffDays(first, fromKey) / period)
  const out = []
  for (let d = addDays(first, k * period); d <= end && out.length < max; d = addDays(d, period)) {
    if (!skip.has(d)) out.push(d)
  }
  return out
}

/**
 * Proximas `n` datas a partir de hoje (sem contar folgas no horario da regra).
 * Com nowHHMM, hoje so entra se o horario ainda nao passou (como generateForRule).
 */
export function nextDates(rule, today, n = 3, blocked = null, nowHHMM = null) {
  if (!rule || rule.active === false) return []
  const time = hhmm(rule.start_time)
  const list = occurrences(rule, today, addDays(today, 7 * 4 * (n + 2)), { max: n + 20 })
  return list
    .filter((d) => d !== today || !nowHHMM || time >= nowHHMM)
    .filter((d) => !isBlockedAt(blocked, d, rule.start_time, rule.duration_min))
    .slice(0, n)
}

const toMin = (t) => { const [h, m] = hhmm(t).split(':').map(Number); return (h || 0) * 60 + (m || 0) }

/** Hora de folga 'HH:MM[:SS]' → minutos do dia; null se vazia ou invalida ('24:00' = 1440). */
const blockMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''))
  if (!m) return null
  const v = Number(m[1]) * 60 + Number(m[2])
  return v <= 1440 ? v : null
}

/**
 * O horario [time, time + duracao) da data `key` cai em folga? Dia inteiro ou
 * sobreposicao com bloqueio parcial (pode haver varios no dia). Horario que
 * passa da meia-noite olha tambem o dia seguinte. Funcao pura.
 * blocked: retorno de blockedDays/blocksFromRows (um Set simples so ve dia inteiro).
 */
export function isBlockedAt(blocked, key, time, durationMin = 60) {
  if (!blocked) return false
  const start = toMin(time)
  const end = start + Math.max(Number(durationMin) || 60, 1)
  for (let off = 0; off * 1440 < end; off++) {
    const day = off ? addDays(key, off) : key
    if (blocked.has(day)) return true
    const parts = (blocked.partial && blocked.partial.get(day)) || []
    for (const [s, e] of parts) {
      if (s + off * 1440 < end && e + off * 1440 > start) return true
    }
  }
  return false
}

/**
 * Datas da regra que batem com outro agendamento (mesmo horario). Pessoas
 * diferentes da equipe atendendo ao mesmo tempo nao contam. Funcao pura.
 * appointments: [{ id, scheduled_for, duration_min, client_name, staff_id, recurring_id, status }]
 */
export function conflictsFor(rule, dates, appointments, max = 10) {
  const start = toMin(rule.start_time)
  const end = start + (Number(rule.duration_min) || 60)
  const wanted = new Set(dates)
  const out = []
  for (const a of appointments || []) {
    const d = String(a.scheduled_for).slice(0, 10)
    if (!wanted.has(d) || (rule.id && a.recurring_id === rule.id)) continue
    if (a.status && !OPEN.includes(a.status)) continue
    if (rule.staff_id && a.staff_id && rule.staff_id !== a.staff_id) continue
    const aStart = toMin(String(a.scheduled_for).slice(11, 16))
    const aEnd = aStart + (Number(a.duration_min) || 60)
    if (aStart < end && start < aEnd) {
      out.push({ date: d, time: String(a.scheduled_for).slice(11, 16), client_name: a.client_name || '', appointment_id: a.id })
    }
  }
  return out.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time)).slice(0, max)
}

/**
 * Folgas da profissional entre duas datas (uma leitura so; checar cada horario
 * com isBlockedAt, sem rpc por ocorrencia). Inclui o dia seguinte a toKey
 * (horario que passa da meia-noite). Formato em blocksFromRows.
 * Le com '*' pra aceitar folga de um dia (date) ou periodo (date + end_date).
 */
export async function blockedDays(supabase, providerId, fromKey, toKey) {
  const lastKey = addDays(toKey, 1)
  const { data, error } = await supabase.from('ag_blocked_dates').select('*')
    .eq('provider_id', providerId)
    .gte('date', addDays(fromKey, -120))
    .lte('date', lastKey)
    .limit(1000)
  if (error) throw new Error(error.message)
  return blocksFromRows(data, fromKey, lastKey)
}

/**
 * Linhas de ag_blocked_dates → Set('YYYY-MM-DD') com os dias inteiros e, em
 * `.partial`, Map('YYYY-MM-DD' → [[inicioMin, fimMin], ...]) com as folgas
 * parciais (full_day = false, [start_time, end_time)). Funcao pura.
 */
export function blocksFromRows(rows, fromKey, toKey) {
  const out = new Set()
  out.partial = new Map()
  for (const b of rows || []) {
    const start = String(b.date).slice(0, 10)
    if (b.full_day === false) {
      // Parcial vale so no proprio dia; sem inicio/fim validos, ignora (como ag_is_blocked)
      const s = blockMin(b.start_time)
      const e = blockMin(b.end_time)
      if (!isDateKey(start) || start < fromKey || start > toKey || s == null || e == null || s >= e) continue
      if (!out.partial.has(start)) out.partial.set(start, [])
      out.partial.get(start).push([s, e])
      continue
    }
    const last = String(b.end_date || b.date_to || b.date).slice(0, 10)
    if (!isDateKey(start) || !isDateKey(last)) continue
    for (let d = start, i = 0; d <= last && i < 400; d = addDays(d, 1), i++) {
      if (d >= fromKey && d <= toKey) out.add(d)
    }
  }
  return out
}

/**
 * Agendamento ja tem dinheiro registrado? Esse nunca e apagado nem alterado.
 * Conta sinal, valor, gorjeta sozinha e qualquer registro de pagamento (paid_at).
 */
export const hasMoney = (a) => !!a.deposit_paid || Number(a.paid_cents || 0) > 0
  || Number(a.tip_cents || 0) > 0 || !!a.paid_at

/**
 * Cria as ocorrencias que faltam no horizonte. Idempotente.
 * opts: { horizonDays, today, nowHHMM, timezone, blocked (Set), client (linha de ag_clients), now }
 * → { ok, created, dates, until } ou { ok: false, error }
 */
export async function generateForRule(supabase, rule, opts = {}) {
  try {
    if (!rule || rule.active === false) return { ok: true, created: 0, dates: 0, until: null }
    const wall = wallNow(opts.timezone, opts.now || new Date())
    const today = opts.today || wall.key
    const nowHHMM = opts.nowHHMM || (today === wall.key ? wall.hhmm : '00:00')
    const until = addDays(today, opts.horizonDays || HORIZON_DAYS)
    const time = hhmm(rule.start_time)

    let dates = occurrences(rule, today, until)
    // Hoje, so se o horario ainda nao passou
    dates = dates.filter((d) => d !== today || time >= nowHHMM)
    // Folga: dia inteiro ou parcial que sobrepoe o horario da regra
    const blocked = opts.blocked || await blockedDays(supabase, rule.provider_id, today, until)
    dates = dates.filter((d) => !isBlockedAt(blocked, d, time, rule.duration_min))

    let created = 0
    if (dates.length) {
      let client = opts.client || null
      if (!client) {
        const { data, error } = await supabase.from('ag_clients').select('id, name, whatsapp, email')
          .eq('id', rule.client_id).eq('provider_id', rule.provider_id).maybeSingle()
        if (error) throw new Error(error.message)
        client = data
      }
      if (!client) throw new Error('Cliente da recorrência não encontrada')

      const stamp = new Date().toISOString()
      const rows = dates.map((d) => ({
        provider_id: rule.provider_id,
        client_id: client.id,
        client_name: client.name || 'Cliente',
        client_whatsapp: client.whatsapp || null,
        client_email: client.email || null,
        client_notes: rule.notes || null,
        service_id: rule.service_id || null,
        staff_id: rule.staff_id || null,
        recurring_id: rule.id,
        occurrence_date: d,
        scheduled_for: wallIso(d, time),
        duration_min: rule.duration_min || 60,
        total_cents: rule.price_cents || 0,
        deposit_cents: 0,
        status: 'confirmed',
        confirmed_at: stamp,
        source: 'recurring',
      }))
      // DO NOTHING no conflito: nao duplica nem recria ocorrencia cancelada
      const ins = await supabase.from('ag_appointments')
        .upsert(rows, { onConflict: 'recurring_id,occurrence_date', ignoreDuplicates: true })
        .select('id')
      if (ins.error) throw new Error(ins.error.message)
      created = ins.data ? ins.data.length : 0
    }

    await supabase.from('ag_recurring').update({ generated_until: until })
      .eq('id', rule.id).eq('provider_id', rule.provider_id)
    return { ok: true, created, dates: dates.length, until }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300), created: 0 }
  }
}

/**
 * Apaga as ocorrencias futuras ainda em aberto (pendente/confirmado) da regra.
 * Passado (inclusive o horario de hoje que ja passou), concluido, cancelado e o
 * que ja tem pagamento ficam.
 * opts: { today, nowHHMM, timezone, onlyDate } → { ok, deleted, kept }
 */
export async function clearFutureOpen(supabase, rule, opts = {}) {
  const wall = wallNow(opts.timezone)
  const today = opts.today || wall.key
  const nowHHMM = opts.nowHHMM || (today === wall.key ? wall.hhmm : '00:00')
  let q = supabase.from('ag_appointments').select('*')
    .eq('provider_id', rule.provider_id).eq('recurring_id', rule.id)
    .in('status', OPEN)
    .gte('scheduled_for', wallIso(today, nowHHMM))
  if (opts.onlyDate) q = q.eq('occurrence_date', opts.onlyDate)
  const { data, error } = await q.limit(1000)
  if (error) return { ok: false, error: error.message, deleted: 0, kept: 0 }

  let ids = (data || []).filter((a) => !hasMoney(a)).map((a) => a.id)
  // Linha em ag_payments (FK sem cascade) segura o agendamento: fica, nao derruba o lote
  if (ids.length) {
    const pays = await supabase.from('ag_payments').select('appointment_id').in('appointment_id', ids).limit(1000)
    if (pays.error) return { ok: false, error: pays.error.message, deleted: 0, kept: 0 }
    const paid = new Set((pays.data || []).map((p) => p.appointment_id))
    ids = ids.filter((id) => !paid.has(id))
  }
  const kept = (data || []).length - ids.length
  if (!ids.length) return { ok: true, deleted: 0, kept }
  const del = await supabase.from('ag_appointments').delete()
    .in('id', ids).eq('provider_id', rule.provider_id).eq('recurring_id', rule.id).in('status', OPEN)
  if (del.error) return { ok: false, error: del.error.message, deleted: 0, kept }
  return { ok: true, deleted: ids.length, kept }
}

/**
 * Mudanca que nao mexe nas datas (horario, duracao, valor, servico, equipe,
 * observacoes): aplica nas futuras em aberto sem apagar nada.
 * changes: { start_time?, duration_min?, price_cents?, service_id?, staff_id?, notes? }
 */
export async function updateFutureOpen(supabase, rule, changes, opts = {}) {
  const base = {}
  if ('duration_min' in changes) base.duration_min = changes.duration_min
  if ('price_cents' in changes) base.total_cents = changes.price_cents
  if ('service_id' in changes) base.service_id = changes.service_id
  if ('staff_id' in changes) base.staff_id = changes.staff_id
  if ('notes' in changes) base.client_notes = changes.notes
  const moveTime = 'start_time' in changes
  if (!moveTime && !Object.keys(base).length) return { ok: true, updated: 0 }

  const wall = wallNow(opts.timezone)
  const today = opts.today || wall.key
  const nowHHMM = opts.nowHHMM || (today === wall.key ? wall.hhmm : '00:00')
  const { data, error } = await supabase.from('ag_appointments').select('*')
    .eq('provider_id', rule.provider_id).eq('recurring_id', rule.id)
    .in('status', OPEN).gte('scheduled_for', wallIso(today, nowHHMM))
    .limit(1000)
  if (error) return { ok: false, error: error.message, updated: 0 }
  const rows = (data || []).filter((a) => !hasMoney(a))
  if (!rows.length) return { ok: true, updated: 0 }

  if (!moveTime) {
    const up = await supabase.from('ag_appointments').update(base)
      .in('id', rows.map((a) => a.id)).eq('provider_id', rule.provider_id)
    if (up.error) return { ok: false, error: up.error.message, updated: 0 }
    return { ok: true, updated: rows.length }
  }
  // Horario novo: mantem o dia de cada uma (pode ter sido remarcada) e troca a hora
  let updated = 0
  for (const a of rows) {
    const patch = { ...base, scheduled_for: wallIso(String(a.scheduled_for).slice(0, 10), changes.start_time) }
    const up = await supabase.from('ag_appointments').update(patch).eq('id', a.id).eq('provider_id', rule.provider_id)
    if (!up.error) updated++
  }
  return { ok: true, updated }
}

/** Regra mudou: tira as futuras em aberto e gera de novo com os dados atuais. */
export async function regenerate(supabase, rule, opts = {}) {
  const cleared = await clearFutureOpen(supabase, rule, opts)
  if (!cleared.ok) return { ok: false, error: cleared.error, created: 0, deleted: 0 }
  const gen = await generateForRule(supabase, rule, opts)
  return { ...gen, deleted: cleared.deleted, kept: cleared.kept }
}
