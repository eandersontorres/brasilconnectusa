import { createClient } from '@supabase/supabase-js'
import { normalizeModule } from '../_lib/modules.js'
function slugify(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') }
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { name, category, city, state, phone, whatsapp, website, description, address, hours, submitted_email, listing_plan, module: moduleInput } = req.body || {}
  if (!name || !category || !city || !state || !submitted_email) {
    return res.status(400).json({ error: 'name, category, city, state e submitted_email obrigatórios' })
  }
  // Validacao de email — previne payloads maliciosos (XSS via admin UI, etc)
  const emailStr = String(submitted_email).trim()
  if (!/^[^\s@<>"'`\\;()]+@[^\s@<>"'`\\;()]+\.[^\s@<>"'`\\;()]{2,}$/.test(emailStr) || emailStr.length > 254) {
    return res.status(400).json({ error: 'Email inválido' })
  }
  // Se cliente nao mandou module valido, deriva da categoria
  const module_ = normalizeModule(moduleInput, category)
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const baseSlug = slugify(name)
    let slug = baseSlug, i = 0
    while (true) {
      const { data: ex } = await supabase.from('bc_businesses').select('id').eq('slug', slug).maybeSingle()
      if (!ex) break
      i++; slug = `${baseSlug}-${i}`
      if (i > 20) break
    }
    // owner_email = submitted_email no cadastro (mesma pessoa). Sem isso,
    // /assinante nao acha o negocio depois de aprovado (procura por
    // owner_email enquanto submit so preenchia submitted_email).
    const emailLower = String(submitted_email).toLowerCase().trim()
    const { data, error } = await supabase.from('bc_businesses').insert({
      slug, name, category, module: module_, city, state, phone, whatsapp, website, description, address, hours,
      submitted_email: emailLower,
      owner_email: emailLower,
      listing_plan: listing_plan || 'free', status: 'pending', active: false
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    await supabase.from('bc_business_leads').insert({ business_id: data.id, source_email: submitted_email, type: 'submission' })
    return res.status(200).json({ ok: true, slug, message: 'Cadastro recebido. Aprovação em até 48h.' })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}
