/**
 * GET  /api/bolao?action=matches                         → listar partidas
 * GET  /api/bolao?action=group&code=XXXXXX               → buscar grupo por código
 * GET  /api/bolao?action=standings&group_id=UUID         → ranking do grupo
 * GET  /api/bolao?action=my-predictions&member_id=UUID   → palpites do membro
 * POST /api/bolao?action=create-group  body: { name, admin_email }
 * POST /api/bolao?action=join          body: { code, nickname, email }
 * POST /api/bolao?action=predict       body: { member_id, match_id, home_score, away_score }
 */

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

// Gera código de convite de 6 caracteres
function genJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// Calcula pontos: placar exato = 3 pts, vencedor/empate correto = 1 pt
function calcPoints(pred_home, pred_away, real_home, real_away) {
  if (real_home === null || real_away === null) return 0

  if (pred_home === real_home && pred_away === real_away) return 3

  const predResult = Math.sign(pred_home - pred_away)
  const realResult = Math.sign(real_home - real_away)
  if (predResult === realResult) return 1

  return 0
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query?.action

  // ── GET: listar partidas ─────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'matches') {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('bc_copa_matches')
        .select('*')
        .order('match_date', { ascending: true })

      if (error) throw error
      return res.status(200).json({ success: true, matches: data })
    } catch (e) {
      console.error('bolao/matches error:', e.message)
      return res.status(500).json({ error: 'Erro ao buscar partidas' })
    }
  }

  // ── GET: buscar grupo por código ─────────────────────────────────────────────
  if (req.method === 'GET' && action === 'group') {
    const { code } = req.query
    if (!code) return res.status(400).json({ error: 'code é obrigatório' })

    try {
      const supabase = getSupabase()
      const { data: group, error } = await supabase
        .from('bc_bolao_groups')
        .select('id, name, join_code, created_at')
        .eq('join_code', code.toUpperCase())
        .single()

      if (error || !group) return res.status(404).json({ error: 'Grupo não encontrado' })

      const { data: members } = await supabase
        .from('bc_bolao_members')
        .select('id, nickname, joined_at')
        .eq('group_id', group.id)
        .order('joined_at', { ascending: true })

      return res.status(200).json({ success: true, group, members: members || [] })
    } catch (e) {
      console.error('bolao/group error:', e.message)
      return res.status(500).json({ error: 'Erro ao buscar grupo' })
    }
  }

  // ── GET: ranking do grupo ────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'standings') {
    const { group_id } = req.query
    if (!group_id) return res.status(400).json({ error: 'group_id é obrigatório' })

    try {
      const supabase = getSupabase()

      const { data: members } = await supabase
        .from('bc_bolao_members')
        .select('id, nickname')
        .eq('group_id', group_id)

      const { data: matches } = await supabase
        .from('bc_copa_matches')
        .select('id, home_score, away_score, status')
        .eq('status', 'finished')

      const finishedIds = (matches || []).map(m => m.id)

      // Buscar todos os palpites do grupo para as partidas finalizadas
      let predictions = []
      if (finishedIds.length > 0) {
        const memberIds = (members || []).map(m => m.id)
        const { data: preds } = await supabase
          .from('bc_bolao_predictions')
          .select('member_id, match_id, home_score, away_score')
          .in('member_id', memberIds)
          .in('match_id', finishedIds)

        predictions = preds || []
      }

      const matchMap = {}
      for (const m of (matches || [])) matchMap[m.id] = m

      const standings = (members || []).map(member => {
        const myPreds = predictions.filter(p => p.member_id === member.id)
        let total_pts = 0, exact = 0, correct = 0

        for (const p of myPreds) {
          const match = matchMap[p.match_id]
          if (!match) continue
          const pts = calcPoints(p.home_score, p.away_score, match.home_score, match.away_score)
          total_pts += pts
          if (pts === 3) exact++
          else if (pts === 1) correct++
        }

        return {
          member_id: member.id,
          nickname: member.nickname,
          total_pts,
          exact,
          correct,
          played: myPreds.length,
        }
      }).sort((a, b) => b.total_pts - a.total_pts || b.exact - a.exact)

      return res.status(200).json({ success: true, standings })
    } catch (e) {
      console.error('bolao/standings error:', e.message)
      return res.status(500).json({ error: 'Erro ao calcular standings' })
    }
  }

  // ── GET: meus palpites ───────────────────────────────────────────────────────
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

  // ── POST: criar grupo ────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'create-group') {
    const { name, admin_email } = req.body || {}
    if (!name || !admin_email) {
      return res.status(400).json({ error: 'name e admin_email são obrigatórios' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(admin_email)) {
      return res.status(400).json({ error: 'Email inválido' })
    }

    try {
      const supabase = getSupabase()

      // Gerar código único
      let join_code, attempts = 0
      do {
        join_code = genJoinCode()
        const { data: existing } = await supabase
          .from('bc_bolao_groups')
          .select('id').eq('join_code', join_code).single()
        if (!existing) break
        attempts++
      } while (attempts < 10)

      const { data: group, error } = await supabase
        .from('bc_bolao_groups')
        .insert({ name: name.trim(), admin_email: admin_email.toLowerCase(), join_code })
        .select()
        .single()

      if (error) throw error

      // Criar o admin como 1º membro
      const { data: member, error: mErr } = await supabase
        .from('bc_bolao_members')
        .insert({ group_id: group.id, nickname: 'Admin', email: admin_email.toLowerCase() })
        .select()
        .single()

      if (mErr) throw mErr

      return res.status(201).json({ success: true, group, member })
    } catch (e) {
      console.error('bolao/create-group error:', e.message)
      return res.status(500).json({ error: 'Erro ao criar grupo' })
    }
  }

  // ── POST: entrar no grupo ────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'join') {
    const { code, nickname, email } = req.body || {}
    if (!code || !nickname) {
      return res.status(400).json({ error: 'code e nickname são obrigatórios' })
    }

    try {
      const supabase = getSupabase()

      const { data: group, error: gErr } = await supabase
        .from('bc_bolao_groups')
        .select('id, name, join_code')
        .eq('join_code', code.toUpperCase())
        .single()

      if (gErr || !group) return res.status(404).json({ error: 'Código de grupo inválido' })

      // Checar se nickname já existe no grupo
      const { data: existing } = await supabase
        .from('bc_bolao_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('nickname', nickname.trim())
        .single()

      if (existing) {
        return res.status(409).json({ error: 'Este apelido já está sendo usado neste grupo' })
      }

      const { data: member, error: mErr } = await supabase
        .from('bc_bolao_members')
        .insert({
          group_id: group.id,
          nickname: nickname.trim(),
          email: email ? email.toLowerCase() : null,
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

  // ── POST: submeter palpite ───────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'predict') {
    const { member_id, match_id, home_score, away_score } = req.body || {}
    if (!member_id || !match_id || home_score === undefined || away_score === undefined) {
      return res.status(400).json({ error: 'member_id, match_id, home_score e away_score são obrigatórios' })
    }

    const h = Number(home_score)
    const a = Number(away_score)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0 || h > 30 || a > 30) {
      return res.status(400).json({ error: 'Placar inválido' })
    }

    try {
      const supabase = getSupabase()

      // Verificar se a partida ainda não foi encerrada
      const { data: match } = await supabase
        .from('bc_copa_matches')
        .select('status')
        .eq('id', match_id)
        .single()

      if (match?.status === 'finished') {
        return res.status(400).json({ error: 'Esta partida já foi encerrada. Não é possível alterar o palpite.' })
      }

      // Upsert: criar ou atualizar palpite
      const { data, error } = await supabase
        .from('bc_bolao_predictions')
        .upsert({
          member_id,
          match_id,
          home_score: h,
          away_score: a,
        }, { onConflict: 'member_id,match_id' })
        .select()
        .single()

      if (error) throw error
      return res.status(200).json({ success: true, prediction: data })
    } catch (e) {
      console.error('bolao/predict error:', e.message)
      return res.status(500).json({ error: 'Erro ao salvar palpite' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
