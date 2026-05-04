/**
 * GET  /api/bolao?action=matches                              → listar partidas
 * GET  /api/bolao?action=group&code=XXXXXX                    → buscar grupo por código
 * GET  /api/bolao?action=standings&group_id=UUID              → ranking do grupo
 * GET  /api/bolao?action=standings-state&state=TX             → ranking por estado (USA)
 * GET  /api/bolao?action=standings-global                     → ranking nacional (USA)
 * GET  /api/bolao?action=my-predictions&member_id=UUID        → palpites do membro
 * GET  /api/bolao?action=config                               → deadlines, datas chave
 * POST /api/bolao?action=create-group  body: { name, admin_email, admin_full_name, admin_state, admin_whatsapp? }
 * POST /api/bolao?action=join          body: { code, nickname, email, state, full_name, whatsapp? }
 * POST /api/bolao?action=predict       body: { member_id, match_id, home_score, away_score }
 * POST /api/bolao?action=update-prize  body: { group_id, admin_email, prize_title, prize_description, prize_first?, prize_second?, prize_third? }
 */

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

// Gera código de convite de 6 caracteres (sem ambíguos)
function genJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// Lista de estados válidos (USPS)
const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR'
])

function calcPoints(pred_home, pred_away, real_home, real_away) {
  if (real_home === null || real_away === null) return 0
  if (pred_home === real_home && pred_away === real_away) return 3
  const predResult = Math.sign(pred_home - pred_away)
  const realResult = Math.sign(real_home - real_away)
  if (predResult === realResult) return 1
  return 0
}

// Cache em memória do deadline (expira após 5min)
let _deadlineCache = { value: null, expires: 0 }
async function getDeadline(supabase) {
  if (_deadlineCache.expires > Date.now()) return _deadlineCache.value
  const { data } = await supabase.from('bc_bolao_config').select('value').eq('key', 'predictions_deadline').single()
  const value = data?.value || '2026-06-10T23:59:00Z'
  _deadlineCache = { value, expires: Date.now() + 5 * 60 * 1000 }
  return value
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const action = req.query?.action

  // ══ GET: configs (deadline + datas) ═════════════════════════════════════════
  if (req.method === 'GET' && action === 'config') {
    try {
      const supabase = getSupabase()
      const { data } = await supabase.from('bc_bolao_config').select('key, value')
      const config = {}
      for (const row of data || []) config[row.key] = row.value
      return res.status(200).json({ success: true, config })
    } catch (e) {
      console.error('bolao/config error:', e.message)
      return res.status(500).json({ error: 'Erro ao carregar config' })
    }
  }

  // ══ GET: matches ════════════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'matches') {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_copa_matches').select('*').order('match_date', { ascending: true })
      if (error) throw error
      return res.status(200).json({ success: true, matches: data })
    } catch (e) {
      console.error('bolao/matches error:', e.message)
      return res.status(500).json({ error: 'Erro ao buscar partidas' })
    }
  }

  // ══ GET: group por code ═════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'group') {
    const { code } = req.query
    if (!code) return res.status(400).json({ error: 'code é obrigatório' })

    try {
      const supabase = getSupabase()
      const { data: group, error } = await supabase
        .from('bc_bolao_groups')
        .select('id, name, join_code, admin_email, prize_title, prize_description, prize_first, prize_second, prize_third, created_at')
        .eq('join_code', code.toUpperCase())
        .single()

      if (error || !group) return res.status(404).json({ error: 'Grupo não encontrado' })

      const { data: members } = await supabase
        .from('bc_bolao_members')
        .select('id, nickname, state, joined_at')
        .eq('group_id', group.id)
        .order('joined_at', { ascending: true })

      // não vazar admin_email para o cliente
      const safeGroup = { ...group, admin_email: undefined, has_admin: !!group.admin_email }
      return res.status(200).json({ success: true, group: safeGroup, members: members || [] })
    } catch (e) {
      console.error('bolao/group error:', e.message)
      return res.status(500).json({ error: 'Erro ao buscar grupo' })
    }
  }

  // ══ GET: standings por GRUPO ═══════════════════════════════════════════════
  if (req.method === 'GET' && action === 'standings') {
    const { group_id } = req.query
    if (!group_id) return res.status(400).json({ error: 'group_id é obrigatório' })

    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_bolao_global_standings')
        .select('member_id, nickname, state, total_pts, exact_count, correct_count, played')
        .eq('group_id', group_id)
        .order('total_pts', { ascending: false })
      if (error) throw error

      const standings = (data || []).map(s => ({
        member_id: s.member_id,
        nickname: s.nickname,
        state: s.state,
        total_pts: s.total_pts,
        exact: s.exact_count,
        correct: s.correct_count,
        played: s.played,
      }))
      return res.status(200).json({ success: true, standings })
    } catch (e) {
      console.error('bolao/standings error:', e.message)
      return res.status(500).json({ error: 'Erro ao calcular standings' })
    }
  }

  // ══ GET: standings por ESTADO ══════════════════════════════════════════════
  if (req.method === 'GET' && action === 'standings-state') {
    const { state } = req.query
    if (!state || !VALID_STATES.has(state.toUpperCase())) {
      return res.status(400).json({ error: 'Estado inválido' })
    }
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_bolao_global_standings')
        .select('member_id, nickname, state, group_name, total_pts, exact_count, correct_count, played')
        .eq('state', state.toUpperCase())
        .order('total_pts', { ascending: false })
        .limit(100)
      if (error) throw error

      const standings = (data || []).map(s => ({
        member_id: s.member_id,
        nickname: s.nickname,
        state: s.state,
        group_name: s.group_name,
        total_pts: s.total_pts,
        exact: s.exact_count,
        correct: s.correct_count,
        played: s.played,
      }))
      return res.status(200).json({ success: true, standings, state: state.toUpperCase() })
    } catch (e) {
      console.error('bolao/standings-state error:', e.message)
      return res.status(500).json({ error: 'Erro ao calcular ranking do estado' })
    }
  }

  // ══ GET: standings GLOBAL (país, USA) ══════════════════════════════════════
  if (req.method === 'GET' && action === 'standings-global') {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_bolao_global_standings')
        .select('member_id, nickname, state, group_name, total_pts, exact_count, correct_count, played')
        .order('total_pts', { ascending: false })
        .limit(100)
      if (error) throw error

      const standings = (data || []).map(s => ({
        member_id: s.member_id,
        nickname: s.nickname,
        state: s.state,
        group_name: s.group_name,
        total_pts: s.total_pts,
        exact: s.exact_count,
        correct: s.correct_count,
        played: s.played,
      }))
      return res.status(200).json({ success: true, standings })
    } catch (e) {
      console.error('bolao/standings-global error:', e.message)
      return res.status(500).json({ error: 'Erro ao calcular ranking global' })
    }
  }

  // ══ GET: my-predictions ═════════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'my-predictions') {
    const { member_id } = req.query
    if (!member_id) return res.status(400).json({ error: 'member_id é obrigatório' })
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_bolao_predictions')
        .select('match_id, home_score, away_score')
        .eq('member_id', member_id)
      if (error) throw error
      return res.status(200).json({ success: true, predictions: data || [] })
    } catch (e) {
      console.error('bolao/my-predictions error:', e.message)
      return res.status(500).json({ error: 'Erro ao buscar palpites' })
    }
  }

  // ══ POST: create-group ═════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'create-group') {
    const { name, admin_email, admin_full_name, admin_state, admin_whatsapp, admin_nickname } = req.body || {}

    if (!name || !admin_email || !admin_full_name || !admin_state) {
      return res.status(400).json({ error: 'name, admin_email, admin_full_name e admin_state são obrigatórios' })
    }
    if (!isValidEmail(admin_email)) return res.status(400).json({ error: 'Email inválido' })
    if (!VALID_STATES.has(String(admin_state).toUpperCase())) return res.status(400).json({ error: 'Estado (USA) inválido' })

    try {
      const supabase = getSupabase()

      let join_code, attempts = 0
      do {
        join_code = genJoinCode()
        const { data: existing } = await supabase
          .from('bc_bolao_groups').select('id').eq('join_code', join_code).maybeSingle()
        if (!existing) break
        attempts++
      } while (attempts < 10)

      const { data: group, error } = await supabase
        .from('bc_bolao_groups')
        .insert({
          name: String(name).trim(),
          admin_email: String(admin_email).toLowerCase().trim(),
          join_code,
        })
        .select()
        .single()
      if (error) throw error

      const { data: member, error: mErr } = await supabase
        .from('bc_bolao_members')
        .insert({
          group_id: group.id,
          nickname: String(admin_nickname || admin_full_name).trim().slice(0, 30),
          email: String(admin_email).toLowerCase().trim(),
          full_name: String(admin_full_name).trim(),
          state: String(admin_state).toUpperCase(),
          country: 'USA',
          whatsapp: admin_whatsapp ? String(admin_whatsapp).trim() : null,
        })
        .select()
        .single()
      if (mErr) throw mErr

      return res.status(201).json({ success: true, group, member })
    } catch (e) {
      console.error('bolao/create-group error:', e.message)
      return res.status(500).json({ error: 'Erro ao criar grupo' })
    }
  }

  // ══ POST: join ═════════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'join') {
    const { code, nickname, email, state, full_name, whatsapp } = req.body || {}

    if (!code || !nickname || !email || !state || !full_name) {
      return res.status(400).json({ error: 'code, nickname, email, full_name e state são obrigatórios' })
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Email inválido' })
    if (!VALID_STATES.has(String(state).toUpperCase())) return res.status(400).json({ error: 'Estado (USA) inválido' })

    try {
      const supabase = getSupabase()
      const { data: group, error: gErr } = await supabase
        .from('bc_bolao_groups')
        .select('id, name, join_code')
        .eq('join_code', String(code).toUpperCase())
        .single()
      if (gErr || !group) return res.status(404).json({ error: 'Código de grupo inválido' })

      const { data: existing } = await supabase
        .from('bc_bolao_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('nickname', String(nickname).trim())
        .maybeSingle()
      if (existing) return res.status(409).json({ error: 'Este apelido já está em uso neste grupo' })

      const { data: member, error: mErr } = await supabase
        .from('bc_bolao_members')
        .insert({
          group_id: group.id,
          nickname: String(nickname).trim().slice(0, 30),
          email: String(email).toLowerCase().trim(),
          full_name: String(full_name).trim(),
          state: String(state).toUpperCase(),
          country: 'USA',
          whatsapp: whatsapp ? String(whatsapp).trim() : null,
        })
        .select()
        .single()
      if (mErr) throw mErr

      return res.status(201).json({ success: true, group, member })
    } catch (e) {
      console.error('bolao/join error:', e.message)
      return res.status(500).json({ error: 'Erro ao entrar no grupo' })
    }
  }

  // ══ POST: predict ═══════════════════════════════════════════════════════════
  if (req.method === 'POST' && action === 'predict') {
    const { member_id, match_id, home_score, away_score } = req.body || {}
    if (!member_id || !match_id || home_score === undefined || away_score === undefined) {
      return res.status(400).json({ error: 'member_id, match_id, home_score e away_score são obrigatórios' })
    }

    const h = Number(home_score), a = Number(away_score)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0 || h > 30 || a > 30) {
      return res.status(400).json({ error: 'Placar inválido (0–30)' })
    }

    try {
      const supabase = getSupabase()

      // 1) Deadline global — não pode mexer em palpite após 1 dia antes da Copa
      const deadline = await getDeadline(supabase)
      if (new Date() > new Date(deadline)) {
        return res.status(403).json({
          error: 'Prazo encerrado: palpites foram travados 1 dia antes do início da Copa.',
        })
      }

      // 2) Por partida — não pode palpitar partida que já começou
      const { data: match } = await supabase
        .from('bc_copa_matches')
        .select('status, match_date')
        .eq('id', match_id)
        .single()

      if (match?.status === 'finished' || match?.status === 'live') {
        return res.status(400).json({ error: 'Esta partida já começou. Não é possível alterar o palpite.' })
      }
      if (match?.match_date && new Date() > new Date(match.match_date)) {
        return res.status(400).json({ error: 'Esta partida já começou. Não é possível alterar o palpite.' })
      }

      const { data, error } = await supabase
        .from('bc_bolao_predictions')
        .upsert(
          { member_id, match_id, home_score: h, away_score: a },
          { onConflict: 'member_id,match_id' }
        )
        .select()
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, prediction: data })
    } catch (e) {
      console.error('bolao/predict error:', e.message)
      return res.status(500).json({ error: 'Erro ao salvar palpite' })
    }
  }

  // ══ POST: update-prize (admin do grupo) ═════════════════════════════════════
  if (req.method === 'POST' && action === 'update-prize') {
    const { group_id, admin_email, prize_title, prize_description, prize_first, prize_second, prize_third } = req.body || {}
    if (!group_id || !admin_email) return res.status(400).json({ error: 'group_id e admin_email obrigatórios' })

    try {
      const supabase = getSupabase()

      const { data: group, error: gErr } = await supabase
        .from('bc_bolao_groups')
        .select('id, admin_email')
        .eq('id', group_id)
        .single()
      if (gErr || !group) return res.status(404).json({ error: 'Grupo não encontrado' })

      if (String(group.admin_email).toLowerCase() !== String(admin_email).toLowerCase()) {
        return res.status(403).json({ error: 'Apenas o admin do grupo pode editar a premiação' })
      }

      const update = {
        prize_title:       prize_title ? String(prize_title).slice(0, 100) : null,
        prize_description: prize_description ? String(prize_description).slice(0, 1000) : null,
        prize_first:       prize_first ? String(prize_first).slice(0, 200) : null,
        prize_second:      prize_second ? String(prize_second).slice(0, 200) : null,
        prize_third:       prize_third ? String(prize_third).slice(0, 200) : null,
        prize_updated_at:  new Date().toISOString(),
      }

      const { data, error } = await supabase
        .from('bc_bolao_groups')
        .update(update)
        .eq('id', group_id)
        .select('id, prize_title, prize_description, prize_first, prize_second, prize_third, prize_updated_at')
        .single()
      if (error) throw error

      return res.status(200).json({ success: true, prize: data })
    } catch (e) {
      console.error('bolao/update-prize error:', e.message)
      return res.status(500).json({ error: 'Erro ao salvar premiação' })
    }
  }

  // POST: set-result (admin global) — view recalcula auto
  if (req.method === 'POST' && action === 'set-result') {
    const adminSecret = req.headers['x-admin-secret']
    if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { match_id, home_score, away_score, status } = req.body || {}
    if (!match_id || home_score === undefined || away_score === undefined) {
      return res.status(400).json({ error: 'match_id, home_score e away_score obrigatorios' })
    }
    const h = Number(home_score), a = Number(away_score)
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 50 || a > 50) {
      return res.status(400).json({ error: 'Placar invalido (0-50)' })
    }
    try {
      const supabase = getSupabase()
      const newStatus = status || 'finished'
      const { data: match, error } = await supabase
        .from('bc_copa_matches')
        .update({ home_score: h, away_score: a, status: newStatus })
        .eq('id', match_id)
        .select('id, home_team, away_team, home_score, away_score, status, match_date')
        .single()
      if (error) throw error
      if (!match) return res.status(404).json({ error: 'Partida nao encontrada' })
      const { count: affected } = await supabase
        .from('bc_bolao_predictions')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', match_id)
      return res.status(200).json({
        success: true, match, predictions_affected: affected || 0,
        message: (affected || 0) + ' palpites recalculados.',
      })
    } catch (e) {
      console.error('bolao/set-result error:', e.message)
      return res.status(500).json({ error: 'Erro: ' + e.message })
    }
  }

  // GET: admin-matches (lista todas com contagem de palpites)
  if (req.method === 'GET' && action === 'admin-matches') {
    const adminSecret = req.headers['x-admin-secret']
    if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_copa_matches')
        .select('id, phase, group_name, home_team, away_team, match_date, venue, home_score, away_score, status')
        .order('match_date', { ascending: true })
      if (error) throw error
      const { data: counts } = await supabase.from('bc_bolao_predictions').select('match_id')
      const pcMap = {}
      ;(counts || []).forEach(p => { pcMap[p.match_id] = (pcMap[p.match_id] || 0) + 1 })
      const matches = (data || []).map(m => ({ ...m, predictions_count: pcMap[m.id] || 0 }))
      return res.status(200).json({ success: true, matches })
    } catch (e) {
      console.error('bolao/admin-matches error:', e.message)
      return res.status(500).json({ error: 'Erro: ' + e.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
