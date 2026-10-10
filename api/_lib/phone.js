/**
 * Telefone/WhatsApp no formato unico das fichas do AgendaPro: '+' + digitos.
 * Usado pela ficha (clients.js), pelo agendamento manual (appointments.js) e pelo
 * agendamento online (book.js), pra mesma cliente nao virar duas fichas.
 *
 *   '(512) 555-0101' → '+15125550101'   (10 digitos = EUA)
 *   '1 512 555 0101' → '+15125550101'
 *   '+55 11 98765-4321' / '5511987654321' → '+5511987654321'
 *   '11 98765-4321' (11 digitos sem o 1 dos EUA) → '+5511987654321' (Brasil sem +55)
 * Com '+' na frente, os digitos sao usados como vieram. Vazio/invalido → null.
 */
export function normalizePhone(input) {
  const raw = String(input ?? '').trim()
  let d = raw.replace(/\D/g, '')
  if (!d) return null
  if (raw.startsWith('+')) return d.length >= 8 && d.length <= 15 ? '+' + d : null
  if (d.startsWith('00')) d = d.slice(2)                         // 00 55 ... (discagem internacional)
  if (d.length === 10) d = '1' + d                               // EUA sem DDI
  else if (d.length === 11 && !d.startsWith('1')) d = '55' + d   // celular do Brasil sem +55
  else if (d.length === 11 && /^1[01]/.test(d)) d = '55' + d     // DDD 10/11: nao existe codigo de area 0xx/1xx nos EUA
  if (d.length < 11 || d.length > 15) return null
  return '+' + d
}
