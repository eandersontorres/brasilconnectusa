/**
 * POST /api/alerts  → criar alerta
 * DELETE /api/alerts?id=xxx → cancelar alerta
 *
 * Body POST: { email, target_rate, direction: 'above'|'below' }
 */

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── POST: criar alerta ───────────────────────────────────────
  if (req.method === 'POST') {
    const { email, target_rate, direction } = req.body || {}

    if (!email || !target_rate || !direction) {
      return res.status(400).json({ error: 'email, target_rate e direction são obrigatórios' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email inválido' })
    }

    if (!['above', 'below'].includes(direction)) {
      return res.status(400).json({ error: 'direction deve ser "above" ou "below"' })
    }

    const rate = Number(target_rate)
    if (isNaN(rate) || rate <= 0 || rate > 20) {
      return res.status(400).json({ error: 'Taxa inválida (deve estar entre 0 e 20)' })
    }

    try {
      const supabase = getSupabase()

      // Verificar se já existe alerta ativo para esse email+taxa+direção
      const { data: existing } = await supabase
        .from('bc_rate_alerts')
        .select('id')
        .eq('email', email.toLowerCase())
        .eq('target_rate', rate)
        .eq('direction', direction)
        .eq('status', 'active')
        .single()

      if (existing) {
        return res.status(409).json({ error: 'Já existe um alerta ativo para esses parâmetros' })
      }

      const { data, error } = await supabase
        .from('bc_rate_alerts')
        .insert({
          email: email.toLowerCase(),
          target_rate: rate,
          direction,
          status: 'active',
          created_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error

      return res.status(201).json({ success: true, alert: data })
    } catch (e) {
      console.error('Alert create error:', e.message)
      return res.status(500).json({ error: 'Erro ao criar alerta' })
    }
  }

  // ── DELETE: cancelar alerta ──────────────────────────────────
  if (req.method === 'DELETE') {
    const alertId = req.query?.id
    if (!alertId) {
      return res.status(400).json({ error: 'id é obrigatório' })
    }

    try {
      const supabase = getSupabase()
      const { error } = await supabase
        .from('bc_rate_alerts')
        .update({ status: 'cancelled' })
        .eq('id', alertId)

      if (error) throw error
      return res.status(200).json({ success: true })
    } catch (e) {
      console.error('Alert delete error:', e.message)
      return res.status(500).json({ error: 'Erro ao cancelar alerta' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
