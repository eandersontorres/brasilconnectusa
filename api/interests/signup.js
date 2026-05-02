import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { email, interest_id, state, city } = req.body || {}
  if (!email || !interest_id || !state) return res.status(400).json({ error: 'email, interest_id, state obrigatórios' })
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    // Insere ou ignora se já existe
    await supabase.from('bc_interest_waitlist').upsert({
      email: email.toLowerCase(), interest_id, state: state.toUpperCase(), city, ip_address: ip
    }, { onConflict: 'email,interest_id,state' })

    // Pega config do interesse
    const { data: cfg } = await supabase.from('bc_interest_config').select('*').eq('interest_id', interest_id).single()
    if (!cfg) return res.status(404).json({ error: 'Interesse desconhecido' })

    // Threshold efetivo: tabela > env por interesse > env global > default 10
    let threshold = cfg.threshold || 10
    if (cfg.threshold_overrides && cfg.threshold_overrides[state.toUpperCase()]) {
      threshold = cfg.threshold_overrides[state.toUpperCase()]
    }
    const envOverride = process.env[`INTEREST_THRESHOLD_${interest_id}`]
    if (envOverride) threshold = parseInt(envOverride)
    else if (process.env.INTEREST_THRESHOLD) threshold = parseInt(process.env.INTEREST_THRESHOLD)

    // Conta quantas pessoas estão esperando
    const { count: waiting } = await supabase
      .from('bc_interest_waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('interest_id', interest_id).eq('state', state.toUpperCase()).eq('notified', false)

    let groupCreated = false
    // Se atingiu o threshold, cria grupo
    if (waiting >= threshold) {
      // Verifica se já não foi criado
      const { data: existing } = await supabase.from('bc_groups')
        .select('id').eq('interest_id', interest_id).eq('state', state.toUpperCase()).maybeSingle()

      if (!existing) {
        await supabase.from('bc_groups').insert({
          interest_id, state: state.toUpperCase(),
          name: `${cfg.name} · ${state.toUpperCase()}`,
          description: cfg.description,
        })
        // Marca todos como notified
        await supabase.from('bc_interest_waitlist').update({ notified: true })
          .eq('interest_id', interest_id).eq('state', state.toUpperCase())
        groupCreated = true
      }
    }

    return res.status(200).json({
      ok: true, threshold, waiting, group_created: groupCreated, position: waiting
    })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
