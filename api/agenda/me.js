/**
 * A profissional logada + o que o plano dela libera. Primeira chamada do app.
 *
 * GET  /api/agenda/me   com JWT
 *      → { user, provider|null, entitlements }
 *        provider null = logou mas ainda nao criou o perfil (app manda pro cadastro)
 * POST /api/agenda/me   com JWT
 *      Body: { action: 'settings', settings: {...} }
 *        mescla preferencias do app em ag_providers.app_settings (chaves conhecidas)
 *      Body: { action: 'vertical', vertical: 'services'|'cleaning', timezone? }
 *      Body: { action: 'delete_account', confirm: 'EXCLUIR', also_login?: boolean }
 *        exclusao de conta dentro do app (exigencia da App Store / Google Play):
 *        cancela a assinatura no Stripe, apaga todos os dados ag_* da profissional
 *        e o perfil, e os arquivos dela no Storage ('uploads': providers, receipts);
 *        com also_login, apaga tambem o login BrasilConnect (bc_profiles + auth) e os
 *        arquivos do site — menos quando o login e dono de negocio no diretorio
 *        (bc_businesses): ai o login fica e volta login_kept: 'business'.
 *        → { ok, subscription_canceled, deleted: { tabela: linhas }, files_deleted, login_deleted, login_error?, login_kept?, warnings }
 *
 * O perfil e achado pelo owner_user_id do login; pelo e-mail, so perfil ainda sem dono.
 */
import { createClient } from '@supabase/supabase-js'
import { requireAuthOnly } from '../_lib/businessAuth.js'
import { PROVIDER_COLS } from '../_lib/providerAuth.js'
import { entitlementsFor } from '../_lib/agendaPlans.js'

// Ordem de exclusao: filhas antes das maes (varias FKs antigas nao tem ON DELETE CASCADE:
// ag_payments, ag_subscriptions, ag_reviews → ag_appointments, ag_appointments → ag_services/ag_clients).
// Tabela que ainda nao existe no banco e ignorada.
export const DELETE_ORDER = [
  'ag_push_tokens',
  'ag_review_tokens',
  'ag_reviews',
  'ag_payments',
  'ag_subscriptions',
  'ag_waitlist',
  'ag_expenses',
  'ag_mileage',
  'ag_appointments',
  'ag_recurring',
  'ag_staff',
  'ag_ical_feeds',
  'ag_clients',
  'ag_services',
  'ag_availability',
  'ag_blocked_dates',
]

// Pastas do bucket 'uploads' (api/upload.js grava em <pasta>/<user_id>/<arquivo>).
// As do AgendaPro (foto/galeria do perfil, recibos de despesa) saem sempre; as do
// site BrasilConnect (negocio, cardapio, comunidades...) so quando o login tambem sai.
export const AGENDA_UPLOAD_FOLDERS = ['providers', 'receipts']
export const SITE_UPLOAD_FOLDERS = ['businesses', 'menu', 'communities', 'posts', 'misc']

/** Apaga os arquivos do usuario nas pastas indicadas. Best effort: erro vira aviso. */
async function wipeUploads(supabase, userId, folders, warnings) {
  let removed = 0
  if (!userId || !folders.length || !supabase.storage) return removed
  const bucket = supabase.storage.from('uploads')
  for (const folder of folders) {
    const prefix = `${folder}/${userId}`
    try {
      // Lista tudo antes (paginado) e depois remove em lotes de 100
      const paths = []
      for (let offset = 0; offset < 5000; offset += 100) {
        const { data, error } = await bucket.list(prefix, { limit: 100, offset })
        if (error) { warnings.push(`storage ${folder}: ${error.message}`); break }
        const files = (data || []).filter(f => f?.name && f.id !== null)   // id null = subpasta
        paths.push(...files.map(f => `${prefix}/${f.name}`))
        if (!data || data.length < 100) break
      }
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100)
        const { error } = await bucket.remove(batch)
        if (error) { warnings.push(`storage ${folder}: ${error.message}`); break }
        removed += batch.length
      }
    } catch (e) {
      warnings.push(`storage ${folder}: ${e.message}`)
    }
  }
  return removed
}

const isMissingTable = (err) => !!err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|could not find the table/i.test(err.message || ''))
const isMissingColumn = (err) => !!err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''))
const isFkError = (err) => !!err && (err.code === '23503' || /foreign key constraint/i.test(err.message || ''))

/** Tabela ag_* citada num erro de FK ("... on table \"ag_x\"" / "referenced from table \"ag_x\""). */
export function fkTableFromError(err) {
  const txt = `${err?.message || ''} ${err?.details || ''}`
  const m = txt.match(/referenced from table "(ag_[a-z0-9_]+)"/i) || txt.match(/on table "(ag_[a-z0-9_]+)"\s*$/i)
  return m ? m[1] : null
}

/**
 * Apaga as linhas da profissional numa tabela. Se outra tabela ag_* ainda aponta
 * pra elas (FK sem cascade, criada depois desta lista), apaga essa primeiro e tenta de novo.
 */
async function wipeTable(supabase, table, providerId, deleted, warnings, depth = 0) {
  const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('provider_id', providerId)
  if (!error) { deleted[table] = (deleted[table] || 0) + (count || 0); return true }
  if (isMissingTable(error) || isMissingColumn(error)) return true
  if (isFkError(error) && depth < 4) {
    const child = fkTableFromError(error)
    if (child && child !== table) {
      await wipeTable(supabase, child, providerId, deleted, warnings, depth + 1)
      return wipeTable(supabase, table, providerId, deleted, warnings, depth + 1)
    }
  }
  warnings.push(`${table}: ${error.message}`)
  return false
}

/**
 * Negocios do diretorio BrasilConnect ligados ao login (owner_user_id) ou ao
 * e-mail dele (owner_email). → { count } ou { error }.
 */
async function businessesOf(supabase, user) {
  const emails = [...new Set([String(user?.email || '').trim(), String(user?.email || '').toLowerCase().trim()].filter(Boolean))]
  let count = 0
  const byUser = await supabase.from('bc_businesses').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id)
  if (byUser.error && !isMissingTable(byUser.error)) return { error: byUser.error.message }
  count += byUser.count || 0
  if (emails.length) {
    const byEmail = await supabase.from('bc_businesses').select('id', { count: 'exact', head: true }).in('owner_email', emails)
    if (byEmail.error && !isMissingTable(byEmail.error)) return { error: byEmail.error.message }
    count += byEmail.count || 0
  }
  return { count }
}

export const LOGIN_KEPT_BUSINESS = 'Seu login BrasilConnect continua porque ele é dono de um negócio no diretório. Transfira ou apague o negócio no painel e depois peça ao suporte para apagar o login.'

export async function deleteAccount({ supabase, user, provider, alsoLogin }) {
  const deleted = {}
  const warnings = []
  let subscriptionCanceled = false

  // 0. Login com negocio no diretorio: o login (e os arquivos do site) ficam.
  //    Apagar o login deixaria o negocio orfao, e quem criasse conta com o mesmo
  //    e-mail podia assumir pedidos e configuracoes dele.
  let loginKept = null
  if (alsoLogin) {
    const biz = await businessesOf(supabase, user)
    if (biz.error) { loginKept = 'check_failed'; console.error('delete_account bc_businesses:', biz.error) }
    else if (biz.count > 0) loginKept = 'business'
  }
  if (!provider && loginKept) {
    return {
      status: 409,
      body: {
        error: loginKept === 'business'
          ? LOGIN_KEPT_BUSINESS
          : 'Não conseguimos conferir sua conta agora, então nada foi apagado. Tente de novo em instantes ou fale com o suporte.',
      },
    }
  }
  const wipeLogin = alsoLogin && !loginKept

  if (provider) {
    // 1. Assinatura: cancela antes de apagar (senao o cartao continua sendo cobrado)
    if (provider.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
        await stripe.subscriptions.cancel(provider.stripe_subscription_id)
        subscriptionCanceled = true
      } catch (e) {
        const gone = e?.code === 'resource_missing' || e?.statusCode === 404 || /canceled|no such subscription/i.test(e?.message || '')
        if (!gone) {
          return { status: 502, body: { error: 'Não conseguimos cancelar sua assinatura agora, então nada foi apagado. Tente de novo em instantes ou fale com o suporte.' } }
        }
      }
    }

    // 2. Dados do AgendaPro
    for (const table of DELETE_ORDER) {
      await wipeTable(supabase, table, provider.id, deleted, warnings)
    }

    // 3. Perfil (com FK desconhecida, apaga a tabela filha e tenta de novo)
    let provErr = null
    for (let i = 0; i < 4; i++) {
      const { error } = await supabase.from('ag_providers').delete().eq('id', provider.id)
      provErr = error
      if (!error) break
      const child = isFkError(error) ? fkTableFromError(error) : null
      if (!child) break
      await wipeTable(supabase, child, provider.id, deleted, warnings)
    }
    if (provErr) {
      console.error('delete_account ag_providers:', provErr.message, warnings)
      return { status: 500, body: { error: 'Apagamos parte dos dados, mas o perfil não saiu. Tente de novo ou fale com o suporte.', warnings } }
    }
    deleted.ag_providers = 1
  }

  // 4. Arquivos no Storage (fotos, recibos). Best effort: nunca derruba a exclusao.
  let filesDeleted = 0
  try {
    const folders = [
      ...(provider || alsoLogin ? AGENDA_UPLOAD_FOLDERS : []),
      ...(wipeLogin ? SITE_UPLOAD_FOLDERS : []),
    ]
    filesDeleted = await wipeUploads(supabase, user?.id, folders, warnings)
  } catch (e) {
    warnings.push(`storage: ${e.message}`)
  }

  // 5. Login BrasilConnect (opcional). Falha aqui nao desfaz o que ja foi apagado.
  //    Igual a exclusao pelo admin: bc_profiles sai antes do auth (sem FK, ficaria orfao).
  let loginDeleted = false
  let loginError = null
  if (wipeLogin) {
    try {
      const { error: profErr } = await supabase.from('bc_profiles').delete().eq('user_id', user.id)
      if (profErr && !isMissingTable(profErr)) {
        loginError = `bc_profiles: ${profErr.message}`
      } else {
        const { error } = await supabase.auth.admin.deleteUser(user.id)
        if (error) loginError = error.message
        else loginDeleted = true
      }
    } catch (e) {
      loginError = e.message
    }
    if (loginError) console.error('delete_account login:', loginError)
  }

  const loginMsg = loginKept === 'business'
    ? LOGIN_KEPT_BUSINESS
    : (loginKept || loginError) ? 'Não conseguimos apagar o login agora. Escreva pro suporte que a gente apaga.' : null

  return {
    status: 200,
    body: {
      ok: true,
      subscription_canceled: subscriptionCanceled,
      deleted,
      files_deleted: filesDeleted,
      login_deleted: loginDeleted,
      ...(loginMsg ? { login_error: loginMsg } : {}),
      ...(loginKept === 'business' ? { login_kept: 'business' } : {}),
      warnings,
    },
  }
}

// Preferencias que o app pode gravar. Qualquer outra chave e ignorada.
const SETTINGS = {
  monthly_goal_cents:  v => clampInt(v, 0, 100000000),
  tax_reserve_pct:     v => clampInt(v, 0, 60),
  default_language:    v => (['pt', 'en', 'es'].includes(v) ? v : 'pt'),
  message_templates:   v => (v && typeof v === 'object' && !Array.isArray(v) ? cleanTemplates(v) : {}),
  reactivation_days:   v => clampInt(v, 14, 365),
  mileage_rate_cents:  v => clampInt(v, 0, 500),
  week_starts_monday:  v => !!v,
  calendar_sync:       v => !!v,
  notify_new_booking:  v => v !== false,
  notify_cancellation: v => v !== false,
  notify_review:       v => v !== false,
  notify_daily_summary: v => !!v,
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

// { confirm: { pt: '...', en: '...' }, ... } → textos curtos, so idiomas conhecidos
function cleanTemplates(obj) {
  const out = {}
  for (const [key, val] of Object.entries(obj).slice(0, 30)) {
    if (!/^[a-z0-9_]{1,40}$/.test(key) || !val || typeof val !== 'object') continue
    const t = {}
    for (const lang of ['pt', 'en', 'es']) {
      if (typeof val[lang] === 'string') t[lang] = val[lang].slice(0, 1000)
    }
    if (Object.keys(t).length) out[key] = t
  }
  return out
}

const TIMEZONES = /^(America|Pacific)\/[A-Za-z_]+(\/[A-Za-z_]+)?$/

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    const auth = await requireAuthOnly(req, supabase)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

    const user = auth.user
    const email = String(user.email || '').toLowerCase().trim()

    let { data: provider } = await supabase.from('ag_providers').select(PROVIDER_COLS)
      .eq('owner_user_id', user.id).maybeSingle()
    if (!provider && email) {
      // Pelo e-mail so perfil SEM dono. Perfil com owner_user_id de outro login
      // (e-mail trocado, login apagado) nao passa pra quem cadastrar o mesmo e-mail.
      const byEmail = await supabase.from('ag_providers').select(PROVIDER_COLS)
        .eq('email', email).is('owner_user_id', null).maybeSingle()
      provider = byEmail.data || null
      if (provider) {
        // Liga ao login so se continuar sem dono (outra requisicao pode ter ligado antes)
        const { data: claimed, error: cErr } = await supabase.from('ag_providers')
          .update({ owner_user_id: user.id }).eq('id', provider.id).is('owner_user_id', null).select('id')
        if (cErr) return res.status(500).json({ error: cErr.message })
        if (claimed?.length) provider.owner_user_id = user.id
        else provider = null
      }
    }

    res.setHeader('Cache-Control', 'private, no-store')

    if (req.method === 'GET') {
      return res.status(200).json({
        user: { id: user.id, email: user.email },
        provider: provider ? publicSafe(provider) : null,
        entitlements: entitlementsFor(provider),
      })
    }

    const b = req.body || {}

    // Exclusao vem antes da checagem de perfil: quem so tem o login tambem pode apagar
    if (b.action === 'delete_account') {
      if (b.confirm !== 'EXCLUIR') return res.status(400).json({ error: 'Digite EXCLUIR para confirmar.' })
      const alsoLogin = b.also_login === true
      if (!provider && !alsoLogin) return res.status(404).json({ error: 'Você não tem perfil de profissional para excluir.' })
      // Perfil achado pelo e-mail mas ligado a outro login: nao apaga dado alheio
      if (provider?.owner_user_id && provider.owner_user_id !== user.id) {
        return res.status(403).json({ error: 'Esse perfil está ligado a outro login. Fale com o suporte.' })
      }
      const r = await deleteAccount({ supabase, user, provider, alsoLogin })
      return res.status(r.status).json(r.body)
    }

    if (!provider) return res.status(404).json({ error: 'Crie seu perfil de profissional primeiro.' })

    if (b.action === 'settings') {
      const input = b.settings && typeof b.settings === 'object' ? b.settings : {}
      const next = { ...(provider.app_settings || {}) }
      for (const [k, fn] of Object.entries(SETTINGS)) {
        if (Object.prototype.hasOwnProperty.call(input, k)) next[k] = fn(input[k])
      }
      const { data, error } = await supabase.from('ag_providers')
        .update({ app_settings: next, updated_at: new Date().toISOString() })
        .eq('id', provider.id).select(PROVIDER_COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, provider: publicSafe(data), entitlements: entitlementsFor(data) })
    }

    if (b.action === 'vertical') {
      const patch = { updated_at: new Date().toISOString() }
      if (['services', 'cleaning'].includes(b.vertical)) patch.vertical = b.vertical
      if (typeof b.timezone === 'string' && TIMEZONES.test(b.timezone)) patch.timezone = b.timezone
      const { data, error } = await supabase.from('ag_providers')
        .update(patch).eq('id', provider.id).select(PROVIDER_COLS).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true, provider: publicSafe(data), entitlements: entitlementsFor(data) })
    }

    return res.status(400).json({ error: 'Ação inválida' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// O app nao precisa dos ids internos do Stripe
function publicSafe(p) {
  const { stripe_customer_id, stripe_subscription_id, stripe_account_id, ...rest } = p
  return {
    ...rest,
    has_subscription: !!stripe_subscription_id,
    stripe_connected: !!stripe_account_id,
    app_settings: p.app_settings || {},
  }
}
