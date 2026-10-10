/**
 * Equipe da profissional (Premium): profissionais ou equipes de limpeza, cada um
 * com sua cor na agenda e um link "rota do dia" sem senha.
 *
 * GET  /api/agenda/staff        com JWT: { staff: [...], limit, active_count, can_day_link }
 *      Sem plano com 'team' responde 402 { code: 'plan_required' } (app trata como "sem equipe").
 * POST /api/agenda/staff        com JWT
 *      Body: { action, ... }
 *        create        { name, color?, whatsapp?, email?, role?, members?, active? }
 *        update        { id, ...campos }   (so o que vier no corpo muda)
 *        delete        { id }   com agendamento marcado pela frente vira so "desativada"
 *        rotate_token  { id }   gera link novo; o antigo para de funcionar
 *
 * day_link_url so volta com o recurso 'team_day_link'. O token vale como senha:
 * quem tem o link ve endereco e observacoes das casas do dia.
 */
import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireProviderAuth } from '../_lib/providerAuth.js'
import { requireFeature, requireLimit, hasFeature, limitFor } from '../_lib/agendaPlans.js'

const COLS = 'id, provider_id, name, color, whatsapp, email, role, members, day_link_token, active, display_order, created_at, updated_at'
const ROLES = ['profissional', 'equipe']
const COLOR = /^#[0-9A-Fa-f]{6}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_ROWS = 50
const MAX_MEMBERS = 12

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null)
const newToken = () => randomBytes(18).toString('base64url')
const appUrl = () => String(process.env.APP_URL || 'https://brasilconnectusa.com').replace(/\/$/, '')

function shape(s, canLink) {
  return {
    id: s.id,
    name: s.name,
    color: s.color,
    whatsapp: s.whatsapp,
    email: s.email,
    role: s.role,
    members: Array.isArray(s.members) ? s.members : [],
    active: s.active,
    display_order: s.display_order,
    day_link_url: canLink && s.day_link_token ? `${appUrl()}/agenda/equipe?t=${s.day_link_token}` : null,
    created_at: s.created_at,
  }
}

/** Campos editaveis. Em `partial`, so o que veio no corpo. */
function readFields(body, partial) {
  const out = {}
  if (!partial || body.name !== undefined) {
    const name = clip(body.name, 60)
    if (!name) return { error: 'Escreva o nome (ex.: Ana ou Equipe da Maria)' }
    out.name = name
  }
  if (!partial || body.color !== undefined) {
    const color = String(body.color || '#1F4D3F').trim()
    if (!COLOR.test(color)) return { error: 'Cor inválida' }
    out.color = color.toUpperCase()
  }
  if (!partial || body.whatsapp !== undefined) {
    const digits = String(body.whatsapp || '').replace(/\D/g, '').slice(0, 15)
    if (digits && digits.length < 10) return { error: 'WhatsApp incompleto. Coloque o número com DDD.' }
    out.whatsapp = digits ? (digits.length === 10 ? '1' + digits : digits) : null
  }
  if (!partial || body.email !== undefined) {
    const email = clip(body.email, 120)
    if (email && !EMAIL.test(email)) return { error: 'E-mail inválido' }
    out.email = email ? email.toLowerCase() : null
  }
  if (!partial || body.role !== undefined) {
    out.role = ROLES.includes(body.role) ? body.role : 'profissional'
  }
  if (!partial || body.members !== undefined) {
    const list = Array.isArray(body.members) ? body.members : []
    out.members = list.map((m) => clip(typeof m === 'object' && m ? m.name : m, 40)).filter(Boolean).slice(0, MAX_MEMBERS)
  }
  if (!partial || body.active !== undefined) out.active = body.active !== false
  // Profissional individual nao tem lista de membros
  if (out.role === 'profissional') out.members = []
  return { fields: out }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireProviderAuth(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
    const provider = auth.provider
    res.setHeader('Cache-Control', 'private, no-store')

    const canLink = hasFeature(provider, 'team_day_link')
    const listAll = async () => {
      const { data, error } = await supabase.from('ag_staff').select(COLS)
        .eq('provider_id', provider.id)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(MAX_ROWS)
      if (error) throw new Error(error.message)
      return data || []
    }
    const activeCount = async (exceptId) => {
      let q = supabase.from('ag_staff').select('id', { count: 'exact', head: true })
        .eq('provider_id', provider.id).eq('active', true)
      if (exceptId) q = q.neq('id', exceptId)
      const { count, error } = await q
      if (error) throw new Error(error.message)
      return count || 0
    }

    if (req.method === 'GET') {
      const gate = requireFeature(provider, 'team')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const rows = await listAll()
      return res.status(200).json({
        staff: rows.map((s) => shape(s, canLink)),
        limit: limitFor(provider, 'staff'),
        active_count: rows.filter((s) => s.active).length,
        can_day_link: canLink,
      })
    }

    const body = req.body || {}
    const action = body.action

    const reply = async (id, status = 200, extra = {}) => {
      const { data } = await supabase.from('ag_staff').select(COLS).eq('id', id).eq('provider_id', provider.id).maybeSingle()
      return res.status(status).json({ ok: true, staff: data ? shape(data, canLink) : null, ...extra })
    }

    if (action === 'create') {
      const gate = requireFeature(provider, 'team')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const read = readFields(body, false)
      if (read.error) return res.status(400).json({ error: read.error })

      if (read.fields.active) {
        const lim = requireLimit(provider, 'staff', await activeCount())
        if (!lim.ok) return res.status(lim.status).json(lim.body)
      }
      const rows = await listAll()
      if (rows.length >= MAX_ROWS) return res.status(400).json({ error: 'Você já tem muitas pessoas cadastradas. Exclua quem não trabalha mais.' })
      if (rows.some((s) => s.name.toLowerCase() === read.fields.name.toLowerCase())) {
        return res.status(409).json({ error: 'Já existe alguém com esse nome na equipe' })
      }
      const order = rows.reduce((m, s) => Math.max(m, s.display_order || 0), 0) + 1

      const { data: saved, error } = await supabase.from('ag_staff')
        .insert({ provider_id: provider.id, ...read.fields, display_order: order, day_link_token: newToken() })
        .select('id').single()
      if (error) return res.status(500).json({ error: error.message })
      return reply(saved.id, 201)
    }

    if (!body.id) return res.status(400).json({ error: 'id é obrigatório' })
    const { data: member } = await supabase.from('ag_staff').select(COLS)
      .eq('id', body.id).eq('provider_id', provider.id).maybeSingle()
    if (!member) return res.status(404).json({ error: 'Pessoa da equipe não encontrada' })

    if (action === 'update') {
      const gate = requireFeature(provider, 'team')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const read = readFields(body, true)
      if (read.error) return res.status(400).json({ error: read.error })
      // Lista de nomes sem `role` no corpo: so vale se ja for equipe
      if (read.fields.members && read.fields.role === undefined && member.role === 'profissional') read.fields.members = []

      if (read.fields.active === true && !member.active) {
        const lim = requireLimit(provider, 'staff', await activeCount(member.id))
        if (!lim.ok) return res.status(lim.status).json(lim.body)
      }
      if (read.fields.name && read.fields.name.toLowerCase() !== member.name.toLowerCase()) {
        const rows = await listAll()
        if (rows.some((s) => s.id !== member.id && s.name.toLowerCase() === read.fields.name.toLowerCase())) {
          return res.status(409).json({ error: 'Já existe alguém com esse nome na equipe' })
        }
      }
      if (body.display_order !== undefined) {
        const n = Math.round(Number(body.display_order))
        if (Number.isFinite(n)) read.fields.display_order = Math.min(Math.max(n, 0), 1000)
      }
      // Link perdido em perfil antigo: cria na hora
      if (!member.day_link_token) read.fields.day_link_token = newToken()

      const { error } = await supabase.from('ag_staff')
        .update({ ...read.fields, updated_at: new Date().toISOString() })
        .eq('id', member.id).eq('provider_id', provider.id)
      if (error) return res.status(500).json({ error: error.message })
      return reply(member.id)
    }

    if (action === 'rotate_token') {
      const gate = requireFeature(provider, 'team_day_link')
      if (!gate.ok) return res.status(gate.status).json(gate.body)
      const { error } = await supabase.from('ag_staff')
        .update({ day_link_token: newToken(), updated_at: new Date().toISOString() })
        .eq('id', member.id).eq('provider_id', provider.id)
      if (error) return res.status(500).json({ error: error.message })
      return reply(member.id)
    }

    if (action === 'delete') {
      // Agendamento marcado pela frente: so desativa, pra agenda nao perder quem vai
      const pivot = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
      const { count, error: cErr } = await supabase.from('ag_appointments')
        .select('id', { count: 'exact', head: true })
        .eq('provider_id', provider.id).eq('staff_id', member.id)
        .in('status', ['pending', 'confirmed']).gte('scheduled_for', pivot)
      if (cErr) return res.status(500).json({ error: cErr.message })

      if ((count || 0) > 0) {
        const { error } = await supabase.from('ag_staff')
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq('id', member.id).eq('provider_id', provider.id)
        if (error) return res.status(500).json({ error: error.message })
        return reply(member.id, 200, { deactivated: true, future_count: count })
      }

      const { error } = await supabase.from('ag_staff').delete().eq('id', member.id).eq('provider_id', provider.id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, deleted: true })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
