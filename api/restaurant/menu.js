/**
 * /api/restaurant/menu
 *
 * GET  ?action=list&business_id=UUID                              -> categorias + items (dono)
 * GET  ?action=public&business_slug=SLUG                          -> menu publico (cliente)
 *
 * POST ?action=save-category   { business_id, owner_email, category }
 * POST ?action=delete-category { business_id, owner_email, category_id }
 * POST ?action=save-item       { business_id, owner_email, item }
 * POST ?action=delete-item     { business_id, owner_email, item_id }
 * POST ?action=toggle-available{ business_id, owner_email, item_id, available }
 * POST ?action=reorder-items   { business_id, owner_email, item_ids: [UUID,...] }
 */
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

async function checkOwnership(supabase, business_id, owner_email) {
  const { data: biz, error } = await supabase
    .from('bc_businesses')
    .select('id, owner_email, slug, name')
    .eq('id', business_id)
    .single()
  if (error || !biz) return { error: 'Negocio nao encontrado', status: 404 }
  const ownerOnRecord = (biz.owner_email || '').toLowerCase().trim()
  const requested = String(owner_email || '').toLowerCase().trim()
  if (!ownerOnRecord || ownerOnRecord !== requested) {
    return { error: 'Email nao bate com o dono cadastrado', status: 403 }
  }
  return { biz }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const action = req.query?.action
  const supabase = getSupabase()

  try {
    // GET list (dono)
    if (req.method === 'GET' && action === 'list') {
      const { business_id } = req.query
      if (!business_id) return res.status(400).json({ error: 'business_id obrigatorio' })

      const { data: categories } = await supabase
        .from('bc_menu_categories')
        .select('*')
        .eq('business_id', business_id)
        .order('display_order', { ascending: true })

      const { data: items } = await supabase
        .from('bc_menu_items')
        .select('*')
        .eq('business_id', business_id)
        .order('display_order', { ascending: true })

      return res.status(200).json({
        success: true,
        categories: categories || [],
        items: items || [],
      })
    }

    // GET public (cliente)
    if (req.method === 'GET' && action === 'public') {
      const { business_slug } = req.query
      if (!business_slug) return res.status(400).json({ error: 'business_slug obrigatorio' })

      const { data: biz } = await supabase
        .from('bc_businesses')
        .select('id, name, slug, accepts_orders, stripe_charges_enabled, prep_time_min, min_order_cents, pickup_only, delivery_fee_cents')
        .eq('slug', business_slug)
        .single()
      if (!biz) return res.status(404).json({ error: 'Negocio nao encontrado' })
      if (!biz.accepts_orders) return res.status(404).json({ error: 'Negocio nao aceita pedidos online' })

      const { data: categories } = await supabase
        .from('bc_menu_categories')
        .select('id, name, description, display_order')
        .eq('business_id', biz.id)
        .eq('active', true)
        .order('display_order', { ascending: true })

      const { data: items } = await supabase
        .from('bc_menu_items')
        .select('id, category_id, name, description, price_cents, photo_url, available, is_featured, ingredients, allergens, is_vegetarian, is_gluten_free, is_spicy, prep_time_min, display_order')
        .eq('business_id', biz.id)
        .eq('available', true)
        .order('display_order', { ascending: true })

      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')
      return res.status(200).json({
        success: true,
        business: biz,
        categories: categories || [],
        items: items || [],
      })
    }

    // POST save-category (create + update)
    if (req.method === 'POST' && action === 'save-category') {
      const { business_id, owner_email, category } = req.body || {}
      if (!business_id || !owner_email || !category) return res.status(400).json({ error: 'business_id, owner_email, category obrigatorios' })
      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const payload = {
        business_id,
        name: String(category.name || '').slice(0, 100),
        description: category.description ? String(category.description).slice(0, 500) : null,
        display_order: Number.isInteger(category.display_order) ? category.display_order : 0,
        active: category.active !== false,
        updated_at: new Date().toISOString(),
      }
      if (!payload.name) return res.status(400).json({ error: 'Nome obrigatorio' })

      let result
      if (category.id) {
        result = await supabase.from('bc_menu_categories').update(payload).eq('id', category.id).eq('business_id', business_id).select().single()
      } else {
        result = await supabase.from('bc_menu_categories').insert(payload).select().single()
      }
      if (result.error) throw result.error
      return res.status(200).json({ success: true, category: result.data })
    }

    // POST delete-category
    if (req.method === 'POST' && action === 'delete-category') {
      const { business_id, owner_email, category_id } = req.body || {}
      if (!business_id || !owner_email || !category_id) return res.status(400).json({ error: 'campos obrigatorios' })
      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const { error } = await supabase.from('bc_menu_categories').delete().eq('id', category_id).eq('business_id', business_id)
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    // POST save-item (create + update)
    if (req.method === 'POST' && action === 'save-item') {
      const { business_id, owner_email, item } = req.body || {}
      if (!business_id || !owner_email || !item) return res.status(400).json({ error: 'campos obrigatorios' })
      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const payload = {
        business_id,
        category_id: item.category_id || null,
        name: String(item.name || '').slice(0, 200),
        description: item.description ? String(item.description).slice(0, 1000) : null,
        price_cents: Number.isInteger(item.price_cents) ? Math.max(0, item.price_cents) : 0,
        photo_url: item.photo_url ? String(item.photo_url).slice(0, 500) : null,
        available: item.available !== false,
        is_featured: !!item.is_featured,
        prep_time_min: Number.isInteger(item.prep_time_min) ? item.prep_time_min : null,
        ingredients: item.ingredients ? String(item.ingredients).slice(0, 500) : null,
        allergens: Array.isArray(item.allergens) ? item.allergens.slice(0, 10) : null,
        is_vegetarian: !!item.is_vegetarian,
        is_gluten_free: !!item.is_gluten_free,
        is_spicy: !!item.is_spicy,
        display_order: Number.isInteger(item.display_order) ? item.display_order : 0,
        updated_at: new Date().toISOString(),
      }
      if (!payload.name) return res.status(400).json({ error: 'Nome obrigatorio' })
      if (payload.price_cents === 0) return res.status(400).json({ error: 'Preco obrigatorio' })

      let result
      if (item.id) {
        result = await supabase.from('bc_menu_items').update(payload).eq('id', item.id).eq('business_id', business_id).select().single()
      } else {
        result = await supabase.from('bc_menu_items').insert(payload).select().single()
      }
      if (result.error) throw result.error
      return res.status(200).json({ success: true, item: result.data })
    }

    // POST delete-item
    if (req.method === 'POST' && action === 'delete-item') {
      const { business_id, owner_email, item_id } = req.body || {}
      if (!business_id || !owner_email || !item_id) return res.status(400).json({ error: 'campos obrigatorios' })
      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const { error } = await supabase.from('bc_menu_items').delete().eq('id', item_id).eq('business_id', business_id)
      if (error) throw error
      return res.status(200).json({ success: true })
    }

    // POST toggle-available (rapido, sem reload)
    if (req.method === 'POST' && action === 'toggle-available') {
      const { business_id, owner_email, item_id, available } = req.body || {}
      if (!business_id || !owner_email || !item_id) return res.status(400).json({ error: 'campos obrigatorios' })
      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const { data, error } = await supabase
        .from('bc_menu_items')
        .update({ available: !!available, updated_at: new Date().toISOString() })
        .eq('id', item_id)
        .eq('business_id', business_id)
        .select('id, available')
        .single()
      if (error) throw error
      return res.status(200).json({ success: true, item: data })
    }

    // POST activate-orders (so libera quando Stripe esta pronto)
    if (req.method === 'POST' && action === 'activate-orders') {
      const { business_id, owner_email, accepts_orders } = req.body || {}
      if (!business_id || !owner_email) return res.status(400).json({ error: 'campos obrigatorios' })
      const auth = await checkOwnership(supabase, business_id, owner_email)
      if (auth.error) return res.status(auth.status).json({ error: auth.error })

      const { data: biz } = await supabase
        .from('bc_businesses')
        .select('stripe_charges_enabled, stripe_account_id')
        .eq('id', business_id)
        .single()
      if (accepts_orders && !biz?.stripe_charges_enabled) {
        return res.status(400).json({ error: 'Stripe nao esta pronto. Termina o setup primeiro.' })
      }

      const { error } = await supabase
        .from('bc_businesses')
        .update({ accepts_orders: !!accepts_orders })
        .eq('id', business_id)
      if (error) throw error
      return res.status(200).json({ success: true, accepts_orders: !!accepts_orders })
    }

    return res.status(405).json({ error: 'Action invalida ou metodo errado' })
  } catch (e) {
    console.error('restaurant/menu error:', e.message)
    return res.status(500).json({ error: 'Erro: ' + e.message })
  }
}
