/**
 * GET /api/cron/onboarding-reminders
 *
 * Cron diario que manda emails de lembrete pra usuarios que criaram conta
 * mas nao completaram o onboarding:
 *   D+1  → Email 1: Quase la, falta 1 minuto
 *   D+4  → Email 2: Veja o que a comunidade ta discutindo
 *   D+10 → Email 3: Ultimo lembrete (depois para)
 *
 * Dependencias:
 *   - SQL: supabase/bc_onboarding_drip.sql (view + tabela de log)
 *   - View bc_onboarding_drip_candidates decide o proximo step por user
 *   - bc_onboarding_drip_log.UNIQUE(user_id, email_step) garante 1 envio
 *
 * Autenticacao: header `x-cron-secret` ou query `?secret=` = CRON_SECRET
 *
 * Limita a 50 emails por execucao (resto vai no proximo dia).
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { shellHtml, block, callout, escapeHtml } from '../_lib/emailShell.js'

const FROM_EMAIL = process.env.WAITLIST_FROM_EMAIL || 'BrasilConnect USA <oi@brasilconnectusa.com>'
const SITE_URL = 'https://brasilconnectusa.com'
const MAX_PER_RUN = 50

export default async function handler(req, res) {
  // Aceita 3 formatos de auth pra cobrir Vercel Cron (Authorization Bearer)
  // + chamadas manuais (x-cron-secret) + query string (legado)
  const auth = req.headers['authorization'] || ''
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const secret = bearerSecret || req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY ausente' })
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars ausentes' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { data: candidates, error } = await supabase
    .from('bc_onboarding_drip_candidates')
    .select('*')
    .not('next_step_due', 'is', null)
    .order('signed_up_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('Onboarding drip query error:', error.message)
    return res.status(500).json({ error: error.message })
  }

  if (!candidates || candidates.length === 0) {
    return res.status(200).json({ ok: true, processed: 0, message: 'Nenhum email pendente' })
  }

  let sent = 0
  let failed = 0
  const errors = []

  for (const c of candidates) {
    const step = c.next_step_due
    const tpl = TEMPLATES[step]
    if (!tpl) {
      errors.push({ email: c.email, error: `Step ${step} sem template` })
      continue
    }

    try {
      const { html, text, subject } = tpl({ email: c.email, city: c.city, full_name: c.full_name })
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: c.email,
        subject,
        html,
        text,
      })

      await supabase.from('bc_onboarding_drip_log').insert({
        user_id: c.user_id,
        email: c.email,
        email_step: step,
        resend_id: result.data?.id || null,
        status: 'sent',
      })
      sent++
    } catch (e) {
      failed++
      errors.push({ email: c.email, step, error: e.message })
      await supabase.from('bc_onboarding_drip_log').insert({
        user_id: c.user_id,
        email: c.email,
        email_step: step,
        status: 'failed',
        error_message: e.message?.slice(0, 200),
      })
    }
  }

  return res.status(200).json({
    ok: true,
    processed: candidates.length,
    sent,
    failed,
    errors: errors.slice(0, 10),
  })
}

// ────────────────────────────────────────────────────────────────────────
// Templates dos 3 emails de onboarding
// ────────────────────────────────────────────────────────────────────────

const APP_URL = `${SITE_URL}/app/feed`

function greeting(full_name) {
  const first = (full_name || '').trim().split(' ')[0]
  return first ? `Oi, ${escapeHtml(first)}!` : 'Oi!'
}

const TEMPLATES = {
  // Email 1 — D+1 — lembrete amistoso
  1: ({ full_name }) => ({
    subject: 'Falta 1 minuto pra completar seu perfil',
    html: shellHtml({
      kicker: 'BEM-VINDO',
      title: 'Quase lá! Falta só completar seu perfil',
      bodyHtml: [
        block(`${greeting(full_name)} Você criou conta na BrasilConnect ontem, mas ainda não preencheu seu perfil.`),
        block('Leva <strong>1 minuto</strong>. Ao completar, você desbloqueia:'),
        `<ul style="padding-left:20px;color:#4B4F4D;font-size:15px;line-height:1.85;margin:0 0 16px 0;">
          <li>💬 Postar e comentar nas comunidades brasileiras</li>
          <li>⚽ Criar ou entrar em bolões da Copa 2026</li>
          <li>🏷️ Anunciar no marketplace e ver contatos completos</li>
          <li>🔔 Notificações de eventos brasileiros perto de você</li>
        </ul>`,
        callout('Privacidade primeiro', 'Você escolhe @username público e pode esconder seu nome real. Quem decide o que aparece é você.'),
      ].join(''),
      ctaUrl: APP_URL,
      ctaLabel: 'Completar perfil agora →',
    }),
    text: `Quase lá! Falta só completar seu perfil na BrasilConnect (1 minuto).\n\nDepois disso, você pode postar, criar bolão da Copa, anunciar no marketplace e receber notificações de eventos.\n\nCompletar: ${APP_URL}`,
  }),

  // Email 2 — D+4 — prova social + segunda tentativa
  2: ({ full_name }) => ({
    subject: 'Veja o que a comunidade brasileira tá discutindo',
    html: shellHtml({
      kicker: 'COMUNIDADE ATIVA',
      title: 'Posts que tão bombando essa semana',
      bodyHtml: [
        block(`${greeting(full_name)} Enquanto seu perfil tá pausado, olha o que outros brasileiros estão trocando na plataforma:`),
        `<div style="background:#F1ECDF;border-radius:8px;padding:14px 18px;margin:14px 0;">
          <div style="font-size:13px;color:#4B4F4D;line-height:1.7;">
            • <strong>"Apps essenciais pra brasileiro recém-chegado nos EUA"</strong> — 7 indicações práticas<br>
            • <strong>"Cartões de crédito com aprovação mais fácil"</strong> — Capital One, Discover e mais<br>
            • <strong>"Onde achar produtos brasileiros em Boston"</strong> — lista por região<br>
            • <strong>"Brasil x Marrocos 13/jun"</strong> — mapeando onde assistir em cada cidade
          </div>
        </div>`,
        block('Pra ler, comentar e participar, é só completar seu perfil. <strong>1 minuto</strong> e tá pronto.'),
        callout('Próximo email em 6 dias', 'Esse é o segundo de 3 lembretes. Depois disso paramos — sem stress.'),
      ].join(''),
      ctaUrl: APP_URL,
      ctaLabel: 'Voltar pra plataforma →',
    }),
    text: `Veja o que tá rolando na BrasilConnect:\n• Apps essenciais pra brasileiro recém-chegado\n• Cartões de crédito com aprovação fácil\n• Produtos brasileiros em Boston\n• Brasil x Marrocos 13/jun — onde assistir\n\nPra participar, completa seu perfil: ${APP_URL}`,
  }),

  // Email 3 — D+10 — último toque, honesto
  3: ({ full_name }) => ({
    subject: 'Última lembrança — completa em 1 minuto?',
    html: shellHtml({
      kicker: 'ÚLTIMO TOQUE',
      title: 'Não vamos mais te incomodar',
      bodyHtml: [
        block(`${greeting(full_name)} Esse é o último email automático que vamos te enviar sobre completar seu perfil.`),
        block('Se mudar de ideia, sua conta continua salva — é só voltar e completar quando quiser. Sem deadline, sem perda.'),
        block('Se não interessa mais, sem stress: pode ignorar esse email e a gente para por aqui.'),
        callout('Por que insistimos?', 'Porque comunidade só funciona com gente real. Cada brasileiro que completa o perfil ajuda a próxima pessoa a chegar e se sentir em casa.'),
      ].join(''),
      ctaUrl: APP_URL,
      ctaLabel: 'Completar perfil',
      footerNote: 'Esse é o último lembrete. Boa sorte na sua jornada nos EUA 🇧🇷',
    }),
    text: `Esse é o último email automático sobre completar seu perfil.\n\nSe quiser voltar: ${APP_URL}\n\nSe não, sem stress — a gente para por aqui. Boa sorte na sua jornada nos EUA 🇧🇷`,
  }),
}
