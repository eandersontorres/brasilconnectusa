// ════════════════════════════════════════════════════════════════════════════
//   Cadeado por plano.
//
//   Tela inteira:   <Locked feature="finance">…conteúdo…</Locked>   (components/Locked.js)
//   Antes de ação:  if (!(await ensureFeature(app, 'recurring'))) return
//   Erro da API:    catch (e) { showError(e) }   → 402 vira convite pro plano certo
// ════════════════════════════════════════════════════════════════════════════
import { router } from 'expo-router'
import { confirm, notify } from './dialog'

const PLAN_NAMES = { starter: 'Starter', pro: 'Pro', premium: 'Premium' }

export function featureInfo(ent, key) {
  const f = ent?.catalog?.features?.[key]
  return {
    key,
    label: f?.label || key,
    desc: f?.desc || '',
    min: f?.min || 'pro',
    minName: PLAN_NAMES[f?.min] || 'Pro',
  }
}

export function openPlans(feature) {
  router.push(feature ? { pathname: '/plans', params: { feature } } : '/plans')
}

/** Mostra convite pro plano e devolve false quando o recurso está bloqueado. */
export async function ensureFeature(app, key) {
  if (app.can(key)) return true
  const f = featureInfo(app.ent, key)
  const msg = app.ent.tier === 'none'
    ? `Seu plano não está ativo. ${f.label} volta quando o plano estiver ativo.`
    : `${f.label} faz parte do plano ${f.minName}.${f.desc ? '\n\n' + f.desc : ''}`
  const go = await confirm('Recurso do plano ' + f.minName, msg, { ok: 'Ver planos', cancel: 'Agora não' })
  if (go) openPlans(key)
  return false
}

/** Mostra o erro da API do jeito certo (plano, limite, sem internet, genérico). */
export async function showError(e, fallbackTitle = 'Não deu certo') {
  if (e?.code === 'plan_required' || e?.code === 'limit_reached') {
    const go = await confirm(e.code === 'limit_reached' ? 'Limite do plano' : 'Recurso de outro plano', e.message, { ok: 'Ver planos', cancel: 'Agora não' })
    if (go) openPlans(e.feature || null)
    return
  }
  notify(fallbackTitle, e?.message || 'Tente de novo em instantes.')
}
