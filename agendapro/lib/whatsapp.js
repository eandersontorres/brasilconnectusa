// ════════════════════════════════════════════════════════════════════════════
//   WhatsApp: abre a conversa com a mensagem pronta (wa.me, sem custo de API).
//
//   openWhatsApp(phone, text)
//   const text = renderTemplate('reminder', 'en', { nome, data, hora, servico, profissional, link }, settings)
//
//   Mensagens prontas padrão em PT/EN/ES. A profissional pode reescrever cada uma
//   (salvas em app_settings.message_templates via saveSettings). Idioma diferente
//   de PT é recurso Pro (multilang_messages) — quem chama decide pelo can().
// ════════════════════════════════════════════════════════════════════════════
import { Linking, Platform } from 'react-native'
import { phoneDigits } from './format'

export const LANGS = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

// Variáveis: {nome} {data} {hora} {servico} {profissional} {link} {valor} {endereco}
export const DEFAULT_TEMPLATES = {
  confirm: {
    title: 'Confirmar horário',
    pt: 'Oi {nome}! Seu horário de {servico} está confirmado para {data} às {hora}. Qualquer coisa é só me chamar aqui. {profissional}',
    en: 'Hi {nome}! Your {servico} appointment is confirmed for {data} at {hora}. Just message me here if you need anything. {profissional}',
    es: '¡Hola {nome}! Tu cita de {servico} está confirmada para el {data} a las {hora}. Cualquier cosa, escríbeme por aquí. {profissional}',
  },
  reminder: {
    title: 'Lembrete',
    pt: 'Oi {nome}, passando pra lembrar do seu horário amanhã, {data} às {hora}. Te espero! {profissional}',
    en: 'Hi {nome}, just a reminder of your appointment tomorrow, {data} at {hora}. See you then! {profissional}',
    es: 'Hola {nome}, te recuerdo tu cita de mañana, {data} a las {hora}. ¡Te espero! {profissional}',
  },
  late: {
    title: 'Vou me atrasar',
    pt: 'Oi {nome}, tive um imprevisto e vou atrasar uns 15 minutos. Desculpa! Já estou a caminho. {profissional}',
    en: 'Hi {nome}, I am running about 15 minutes late. So sorry! I am on my way. {profissional}',
    es: 'Hola {nome}, voy con unos 15 minutos de retraso. ¡Disculpa! Ya voy en camino. {profissional}',
  },
  on_the_way: {
    title: 'Estou a caminho',
    pt: 'Oi {nome}, estou a caminho! Chego em breve. {profissional}',
    en: 'Hi {nome}, I am on my way! See you soon. {profissional}',
    es: 'Hola {nome}, ¡voy en camino! Llego pronto. {profissional}',
  },
  deposit: {
    title: 'Pedir o sinal',
    pt: 'Oi {nome}! Pra garantir seu horário de {data} às {hora}, o sinal é de {valor}. Assim que receber eu confirmo. Obrigada!',
    en: 'Hi {nome}! To hold your appointment on {data} at {hora}, the deposit is {valor}. I will confirm as soon as I receive it. Thank you!',
    es: '¡Hola {nome}! Para reservar tu cita del {data} a las {hora}, el depósito es de {valor}. Confirmo apenas lo reciba. ¡Gracias!',
  },
  review: {
    title: 'Pedir avaliação',
    pt: 'Oi {nome}, obrigada pela visita! Se puder, deixa sua avaliação aqui, me ajuda muito: {link}',
    en: 'Hi {nome}, thank you for coming! If you can, please leave a quick review here, it really helps: {link}',
    es: 'Hola {nome}, ¡gracias por tu visita! Si puedes, deja tu reseña aquí, me ayuda mucho: {link}',
  },
  comeback: {
    title: 'Chamar cliente sumida',
    pt: 'Oi {nome}, quanto tempo! Abri uns horários essa semana e lembrei de você. Quer agendar? {link}',
    en: 'Hi {nome}, it has been a while! I just opened some times this week and thought of you. Want to book? {link}',
    es: 'Hola {nome}, ¡cuánto tiempo! Abrí algunos horarios esta semana y me acordé de ti. ¿Quieres agendar? {link}',
  },
  slot_open: {
    title: 'Abriu um horário (lista de espera)',
    pt: 'Oi {nome}! Abriu um horário {data} às {hora}. Quer ficar com ele? Me responde aqui que eu reservo.',
    en: 'Hi {nome}! A spot just opened on {data} at {hora}. Do you want it? Reply here and I will hold it for you.',
    es: '¡Hola {nome}! Se abrió un horario el {data} a las {hora}. ¿Lo quieres? Respóndeme y te lo reservo.',
  },
  thanks: {
    title: 'Agradecer',
    pt: 'Obrigada pela preferência, {nome}! Foi um prazer te atender. Até a próxima!',
    en: 'Thank you so much, {nome}! It was a pleasure. See you next time!',
    es: '¡Muchas gracias, {nome}! Fue un placer atenderte. ¡Hasta la próxima!',
  },
}

export const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES)

/** Texto do modelo no idioma, usando a versão da profissional quando houver. */
export function templateText(key, lang = 'pt', settings = {}) {
  const custom = settings?.message_templates?.[key]?.[lang]
  if (custom) return custom
  const def = DEFAULT_TEMPLATES[key]
  return def?.[lang] || def?.pt || ''
}

export function fillTemplate(text, vars = {}) {
  return String(text || '')
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : ''))
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export const renderTemplate = (key, lang, vars, settings) => fillTemplate(templateText(key, lang, settings), vars)

export function whatsappUrl(phone, text = '') {
  const d = phoneDigits(phone)
  const q = text ? `?text=${encodeURIComponent(text)}` : ''
  return d ? `https://wa.me/${d}${q}` : `https://wa.me/${q}`
}

export async function openWhatsApp(phone, text = '') {
  const url = whatsappUrl(phone, text)
  if (Platform.OS === 'web') { window.open(url, '_blank'); return true }
  try { await Linking.openURL(url); return true } catch (_) { return false }
}

export function callPhone(phone) {
  const d = phoneDigits(phone)
  if (d) Linking.openURL(`tel:+${d}`).catch(() => {})
}

export function sendSms(phone, text = '') {
  const d = phoneDigits(phone)
  const sep = Platform.OS === 'ios' ? '&' : '?'
  if (d) Linking.openURL(`sms:+${d}${text ? `${sep}body=${encodeURIComponent(text)}` : ''}`).catch(() => {})
}

// ════════════════════════════════════════════════════════════════════════════
//   Acréscimos da entrega clientes (não mudam nada acima).
//
//   const lang = messageLang(cliente.language, can('multilang_messages'))
//   const text = renderAny('birthday', lang, { nome: firstName(c.name), link }, settings)
//   msgDate(iso, 'en') → 'Tuesday, Oct 14' · msgTime(iso, 'pt') → '10h30'
//
//   Modelos extras ficam fora de DEFAULT_TEMPLATES pra não mudar o que outras telas
//   já listam. ALL_TEMPLATES = padrão + extras; renderAny/templateTextAll leem os dois.
// ════════════════════════════════════════════════════════════════════════════
export const EXTRA_TEMPLATES = {
  birthday: {
    title: 'Feliz aniversário',
    pt: 'Feliz aniversário, {nome}! Desejo um dia lindo e um ano cheio de coisas boas. Quando quiser se cuidar, é só agendar: {link} {profissional}',
    en: 'Happy birthday, {nome}! Wishing you a wonderful day and an amazing year ahead. Whenever you want to treat yourself, you can book here: {link} {profissional}',
    es: '¡Feliz cumpleaños, {nome}! Te deseo un día precioso y un año lleno de cosas buenas. Cuando quieras consentirte, agenda aquí: {link} {profissional}',
  },
  waitlist_added: {
    title: 'Entrou na lista de espera',
    pt: 'Oi {nome}! Coloquei você na minha lista de espera pra {servico}. Assim que abrir um horário eu te aviso por aqui. {profissional}',
    en: 'Hi {nome}! I added you to my waitlist for {servico}. As soon as a spot opens up I will let you know here. {profissional}',
    es: '¡Hola {nome}! Te anoté en mi lista de espera para {servico}. Apenas se abra un horario te aviso por aquí. {profissional}',
  },
  home_access: {
    title: 'Pedir endereço e acesso da casa',
    pt: 'Oi {nome}! Pra eu me organizar, pode me confirmar o endereço completo e se tem código do portão, alarme, chave ou pet em casa? Obrigada! {profissional}',
    en: 'Hi {nome}! To get organized, could you confirm the full address and let me know about any gate code, alarm, key or pets at home? Thank you! {profissional}',
    es: '¡Hola {nome}! Para organizarme, ¿me confirmas la dirección completa y si hay código del portón, alarma, llave o mascotas en casa? ¡Gracias! {profissional}',
  },
}

export const ALL_TEMPLATES = { ...DEFAULT_TEMPLATES, ...EXTRA_TEMPLATES }
export const ALL_TEMPLATE_KEYS = Object.keys(ALL_TEMPLATES)

/** Igual a templateText, mas conhece também os modelos extras. */
export function templateTextAll(key, lang = 'pt', settings = {}) {
  const custom = settings?.message_templates?.[key]?.[lang]
  if (custom) return custom
  const def = ALL_TEMPLATES[key]
  return def?.[lang] || def?.pt || ''
}

/** Texto padrão (sem a versão da profissional). */
export const defaultTemplateText = (key, lang = 'pt') => ALL_TEMPLATES[key]?.[lang] || ALL_TEMPLATES[key]?.pt || ''

export const renderAny = (key, lang, vars, settings) => fillTemplate(templateTextAll(key, lang, settings), vars)

/** Idioma da mensagem: o da cliente se o plano libera, senão português. */
export function messageLang(lang, canMultilang) {
  return canMultilang && (lang === 'en' || lang === 'es') ? lang : 'pt'
}

/** Primeiro nome pra mensagem ficar próxima: 'Maria da Silva' → 'Maria'. */
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

// Datas e horas no idioma da mensagem (regra de horário: getters UTC)
const MSG_DAYS = {
  pt: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
}
const MSG_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n) => String(n).padStart(2, '0')

/** ISO de parede ou 'YYYY-MM-DD' → 'terça, 14/10' · 'Tuesday, Oct 14' · 'martes 14/10'. */
export function msgDate(isoOrKey, lang = 'pt') {
  const key = String(isoOrKey || '').slice(0, 10)
  const d = new Date(key + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return ''
  const wd = d.getUTCDay(), day = d.getUTCDate(), m = d.getUTCMonth()
  if (lang === 'en') return `${MSG_DAYS.en[wd]}, ${MSG_MONTHS_EN[m]} ${day}`
  if (lang === 'es') return `${MSG_DAYS.es[wd]} ${p2(day)}/${p2(m + 1)}`
  return `${MSG_DAYS.pt[wd]}, ${p2(day)}/${p2(m + 1)}`
}

/** ISO de parede ou 'HH:MM' → '10h30' (pt) · '10:30 AM' (en) · '10:30' (es). */
export function msgTime(isoOrHhmm, lang = 'pt') {
  const s = String(isoOrHhmm || '')
  let h, mi
  if (/^\d{1,2}:\d{2}$/.test(s)) [h, mi] = s.split(':').map(Number)
  else {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    h = d.getUTCHours(); mi = d.getUTCMinutes()
  }
  if (lang === 'en') return `${h % 12 || 12}:${p2(mi)} ${h < 12 ? 'AM' : 'PM'}`
  if (lang === 'es') return `${p2(h)}:${p2(mi)}`
  return mi ? `${h}h${p2(mi)}` : `${h}h`
}

/** Variáveis que a profissional pode usar nos modelos (tela Mensagens prontas). */
export const TEMPLATE_VARS = [
  { key: 'nome', label: 'Nome da cliente' },
  { key: 'data', label: 'Dia' },
  { key: 'hora', label: 'Hora' },
  { key: 'servico', label: 'Serviço' },
  { key: 'profissional', label: 'Seu nome' },
  { key: 'link', label: 'Link' },
  { key: 'valor', label: 'Valor' },
  { key: 'endereco', label: 'Endereço' },
]

/** Dados de exemplo pra prévia do modelo, no idioma. */
export function sampleVars(lang = 'pt', { profissional, link } = {}) {
  return {
    nome: 'Maria',
    data: msgDate('2026-10-14', lang),
    hora: msgTime('10:30', lang),
    servico: 'Escova',
    profissional: profissional || 'Ana',
    link: link || 'brasilconnectusa.com/agenda/ana',
    valor: '$40',
    endereco: '123 Main St, Boston, MA',
  }
}
