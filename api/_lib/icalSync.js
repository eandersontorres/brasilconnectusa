/**
 * Turnover de aluguel por temporada: sincroniza o calendario .ics de uma casa
 * com a agenda da profissional (tabela ag_appointments).
 *
 * Cada reserva vira uma limpeza no dia do checkout, no horario de checkout da casa.
 *   reserva nova              → cria a limpeza, ja confirmada
 *   reserva mudou de data     → move a limpeza (se ainda nao foi feita)
 *   casa mudou horario/valor  → atualiza as limpezas por vir
 *   reserva sumiu do feed     → cancela a limpeza, so de amanha em diante
 *                               (o Airbnb tira do feed as datas que ja passaram)
 *   reserva voltou pro feed   → reabre a limpeza que a sincronizacao cancelou
 * Limpeza concluida, ou cancelada pela propria profissional, nunca e mexida.
 *
 * Horarios seguem a convencao do AgendaPro: hora do relogio da profissional
 * guardada sem fuso (como se fosse UTC).
 */
import { fetchIcs, reservationsFromIcs } from './ical.js'
import { sendPushToProvider } from './agendaPush.js'

export const SYNC_CANCEL_REASON = 'Reserva saiu do calendário (cancelada ou alterada)'
const MAX_RESERVATIONS = 300
const HORIZON_DAYS = 365
const OPEN = ['pending', 'confirmed']

const dayKey = d => d.toISOString().slice(0, 10)

/**
 * Calcula o que mudar, sem tocar no banco.
 * feed:         { label, checkout_time, duration_min, price_cents }
 * reservations: saida de reservationsFromIcs
 * existing:     limpezas desse feed ja gravadas (a partir de ontem)
 * Retorna { inserts: [row], updates: [{ id, patch }], cancels: [id], reservations: n }
 */
export function planSync({ feed, reservations, existing, now = new Date() }) {
  const hhmm = String(feed.checkout_time || '11:00').slice(0, 5)
  // Data local mais atrasada dos EUA (UTC-10): nao cria limpeza de um dia que ja passou.
  const minDate = dayKey(new Date(now.getTime() - 10 * 3600 * 1000))
  const maxDate = dayKey(new Date(now.getTime() + HORIZON_DAYS * 86400000))
  // Cancelamento so de amanha em diante, contando pela data UTC (a mais adiantada).
  const todayUtc = dayKey(now)

  const wanted = reservations.filter(r => r.checkout >= minDate && r.checkout <= maxDate).slice(0, MAX_RESERVATIONS)
  const wantedUids = new Set(wanted.map(r => r.uid))
  const byUid = new Map(existing.filter(a => a.external_uid).map(a => [a.external_uid, a]))
  const used = new Set()
  const inserts = []
  const updates = []

  for (const r of wanted) {
    const desired = {
      client_name: feed.label,
      scheduled_for: r.checkout + 'T' + hhmm + ':00.000Z',
      duration_min: feed.duration_min,
      total_cents: feed.price_cents,
      ical_next_checkin: r.nextCheckin || null,
    }

    let a = byUid.get(r.uid)
    if (a && used.has(a.id)) a = null
    if (!a) {
      // O UID mudou mas a data e a mesma: adota a limpeza que ja existe em vez de duplicar
      a = existing.find(x => !used.has(x.id) && !wantedUids.has(x.external_uid)
        && String(x.scheduled_for).slice(0, 10) === r.checkout) || null
    }
    if (!a) { inserts.push({ external_uid: r.uid, ...desired }); continue }
    used.add(a.id)

    const reopen = a.status === 'canceled' && a.cancel_reason === SYNC_CANCEL_REASON
    if (!reopen && !OPEN.includes(a.status)) continue

    const patch = {}
    if (a.external_uid !== r.uid) patch.external_uid = r.uid
    if (a.client_name !== desired.client_name) patch.client_name = desired.client_name
    if (new Date(a.scheduled_for).getTime() !== new Date(desired.scheduled_for).getTime()) patch.scheduled_for = desired.scheduled_for
    if (a.duration_min !== desired.duration_min) patch.duration_min = desired.duration_min
    if (a.total_cents !== desired.total_cents) patch.total_cents = desired.total_cents
    if ((a.ical_next_checkin || null) !== desired.ical_next_checkin) patch.ical_next_checkin = desired.ical_next_checkin
    if (reopen) Object.assign(patch, { status: 'confirmed', canceled_at: null, cancel_reason: null })
    if (Object.keys(patch).length) updates.push({ id: a.id, patch })
  }

  const cancels = existing
    .filter(a => !used.has(a.id) && OPEN.includes(a.status) && String(a.scheduled_for).slice(0, 10) > todayUtc)
    .map(a => a.id)

  return { inserts, updates, cancels, reservations: wanted.length }
}

/**
 * Baixa o .ics (ou usa `text`, quando quem chama ja baixou), aplica o plano e
 * grava o resultado no feed. Nunca lanca: devolve { ok, ... } ou { ok: false, error }.
 * feed precisa de: id, provider_id, url, source, label, checkout_time, duration_min, price_cents
 * notify: avisa a profissional no celular sobre limpezas novas/canceladas (o cron
 * liga; o "Sincronizar agora" e o cadastro da casa nao precisam avisar).
 */
export async function syncFeed(supabase, feed, { text = null, now = new Date(), notify = false } = {}) {
  const stamp = now.toISOString()
  try {
    const ics = text || await fetchIcs(feed.url)
    const reservations = reservationsFromIcs(ics, feed.source)

    const since = new Date(now.getTime() - 36 * 3600 * 1000).toISOString()
    const { data: existing, error } = await supabase.from('ag_appointments')
      .select('id, external_uid, client_name, scheduled_for, status, cancel_reason, duration_min, total_cents, ical_next_checkin')
      .eq('ical_feed_id', feed.id)
      .gte('scheduled_for', since)
      .limit(1000)
    if (error) throw new Error(error.message)

    const plan = planSync({ feed, reservations, existing: existing || [], now })

    let created = 0
    if (plan.inserts.length) {
      const rows = plan.inserts.map(r => ({
        provider_id: feed.provider_id,
        ical_feed_id: feed.id,
        service_id: null,
        source: 'ical',
        status: 'confirmed',
        confirmed_at: stamp,
        deposit_cents: 0,
        ...r,
      }))
      // DO NOTHING no conflito: duas sincronizacoes ao mesmo tempo nao duplicam
      const ins = await supabase.from('ag_appointments')
        .upsert(rows, { onConflict: 'ical_feed_id,external_uid', ignoreDuplicates: true })
        .select('id')
      if (ins.error) throw new Error(ins.error.message)
      created = ins.data ? ins.data.length : 0
    }

    let updated = 0
    for (const u of plan.updates) {
      const up = await supabase.from('ag_appointments').update(u.patch).eq('id', u.id).eq('ical_feed_id', feed.id)
      if (!up.error) updated++
    }

    let canceled = 0
    if (plan.cancels.length) {
      const c = await supabase.from('ag_appointments')
        .update({ status: 'canceled', canceled_at: stamp, cancel_reason: SYNC_CANCEL_REASON })
        .in('id', plan.cancels).eq('ical_feed_id', feed.id).in('status', OPEN)
        .select('id')
      if (c.error) throw new Error(c.error.message)
      canceled = c.data ? c.data.length : 0
    }

    await supabase.from('ag_ical_feeds').update({
      last_synced_at: stamp, last_status: 'ok', last_error: null, reservations_count: plan.reservations,
    }).eq('id', feed.id)

    if (notify && (created || canceled)) await notifySync(supabase, feed, { created, canceled })

    return { ok: true, created, updated, canceled, reservations: plan.reservations }
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300)
    await supabase.from('ag_ical_feeds').update({ last_synced_at: stamp, last_status: 'error', last_error: msg }).eq('id', feed.id)
    return { ok: false, error: msg }
  }
}

// Um aviso por casa e por sincronizacao (nao um por reserva). Best effort.
async function notifySync(supabase, feed, { created, canceled }) {
  try {
    const label = feed.label || 'Casa'
    if (created) {
      await sendPushToProvider(supabase, feed.provider_id, {
        kind: 'new_booking',
        title: created === 1 ? 'Nova limpeza de turnover' : `${created} limpezas novas de turnover`,
        body: `${label}: reserva nova no calendário da casa.`,
        data: { type: 'agenda' },
      })
    }
    if (canceled) {
      await sendPushToProvider(supabase, feed.provider_id, {
        kind: 'cancellation',
        title: canceled === 1 ? 'Limpeza cancelada' : `${canceled} limpezas canceladas`,
        body: `${label}: a reserva saiu do calendário da casa.`,
        data: { type: 'agenda' },
      })
    }
  } catch (_) {}
}

