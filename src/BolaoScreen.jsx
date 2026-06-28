import { useState, useEffect, useCallback, useMemo } from 'react'
import PushOptInBanner from './PushOptInBanner'
import { supabase } from './lib/supabase'
import { useAuth } from './AuthModal'
import { apiFetch } from './lib/apiFetch'
import { requireOnboarding } from './lib/onboardingGate'

// Header Authorization Bearer com o token da sessao atual do Supabase.
// Backend (api/bolao.js) usa pra setar bc_bolao_members.user_id.
// Sem sessao, retorna {} e a request fica "anonima" (user_id NULL).
async function getAuthHeader() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) return { Authorization: 'Bearer ' + session.access_token }
  } catch (_) {}
  return {}
}

// ── Paleta editorial ──────────────────────────────────────────────────────
const GREEN  = '#009c3b'   // Verde floresta
const BLUE   = '#002776'   // Navy quase preto
const YELLOW = '#ffdf00'   // Dourado claro (substitui o amarelo brilhante)
const GOLD   = '#FFD700'   // Dourado quente (acentos)
const NAVY_LIGHT = '#1e3a5f'
const CREAM  = '#FAF7F0'

// ── Memberships (multi-grupo via localStorage) ────────────────────────────
const MEMBERSHIPS_KEY = 'bolao_memberships'
const ACTIVE_KEY      = 'bolao_active_member_id'

function loadMemberships() {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(MEMBERSHIPS_KEY)
    if (raw) return JSON.parse(raw) || []
    // Migração silenciosa: chaves antigas (single membership) → array
    const oldId   = localStorage.getItem('bolao_member_id')
    const oldCode = localStorage.getItem('bolao_join_code')
    if (oldId && oldCode) {
      const item = {
        member_id:   oldId,
        join_code:   oldCode,
        state:       localStorage.getItem('bolao_member_state') || '',
        admin_email: localStorage.getItem('bolao_admin_email') || '',
        nickname:    '',
        group_name:  '',
        joined_at:   new Date().toISOString(),
      }
      localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify([item]))
      localStorage.setItem(ACTIVE_KEY, oldId)
      return [item]
    }
    return []
  } catch (_) { return [] }
}

function saveMembership({ group, member, isAdmin = false }) {
  if (typeof window === 'undefined') return
  try {
    const list = loadMemberships().filter(x => x.member_id !== member.id)
    list.unshift({
      member_id:   member.id,
      join_code:   group.join_code,
      group_id:    group.id,
      group_name:  group.name || '',
      nickname:    member.nickname || '',
      state:       member.state || '',
      admin_email: isAdmin ? (member.email || '') : '',
      joined_at:   new Date().toISOString(),
    })
    localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(list.slice(0, 10)))
    localStorage.setItem(ACTIVE_KEY, member.id)
  } catch (_) {}
}

function removeMembership(memberId) {
  if (typeof window === 'undefined') return
  try {
    const list = loadMemberships().filter(x => x.member_id !== memberId)
    localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(list))
    if (localStorage.getItem(ACTIVE_KEY) === memberId) localStorage.removeItem(ACTIVE_KEY)
  } catch (_) {}
}

function getActiveMembership() {
  if (typeof window === 'undefined') return null
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    if (!id) return null
    return loadMemberships().find(x => x.member_id === id) || null
  } catch (_) { return null }
}

// Limpa todas memberships locais — usado no logout do Supabase pra evitar
// que outra pessoa no mesmo navegador veja os boloes do usuario anterior.
function clearAllMemberships() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(MEMBERSHIPS_KEY)
    localStorage.removeItem(ACTIVE_KEY)
  } catch (_) {}
}

// Substitui as memberships locais pelas vindas do servidor (login Supabase).
// Mantem como ativa quem ja estava ativo (se ainda existir), senao primeira.
function replaceMemberships(serverList) {
  if (typeof window === 'undefined') return
  try {
    const list = (serverList || []).slice(0, 10)
    localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(list))
    const currentActive = localStorage.getItem(ACTIVE_KEY)
    const stillExists = list.find(m => m.member_id === currentActive)
    if (!stillExists && list.length > 0) {
      localStorage.setItem(ACTIVE_KEY, list[0].member_id)
    } else if (list.length === 0) {
      localStorage.removeItem(ACTIVE_KEY)
    }
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════════
//   Constantes — Estados USA, Bandeiras, Curiosidades, Histórico do Brasil
// ════════════════════════════════════════════════════════════════════════════

const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','D.C.'],['FL','Florida'],
  ['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],
  ['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],
  ['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
  ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],
  ['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],
  ['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],
  ['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
  ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
]

const COUNTRY_CODES = {
  'México': 'mx', 'África do Sul': 'za', 'Coreia do Sul': 'kr', 'Rep. Tcheca': 'cz',
  'Canadá': 'ca', 'Bósnia': 'ba', 'Qatar': 'qa', 'Suíça': 'ch',
  'Brasil': 'br', 'Marrocos': 'ma', 'Haiti': 'ht', 'Escócia': 'gb-sct',
  'EUA': 'us', 'Paraguai': 'py', 'Austrália': 'au', 'Turquia': 'tr',
  'Alemanha': 'de', 'Curaçau': 'cw', 'Costa do Marfim': 'ci', 'Equador': 'ec',
  'Holanda': 'nl', 'Japão': 'jp', 'Suécia': 'se', 'Tunísia': 'tn',
  'Bélgica': 'be', 'Egito': 'eg', 'Irã': 'ir', 'Nova Zelândia': 'nz',
  'Espanha': 'es', 'Cabo Verde': 'cv', 'Arábia Saudita': 'sa', 'Uruguai': 'uy',
  'França': 'fr', 'Senegal': 'sn', 'Iraque': 'iq', 'Noruega': 'no',
  'Argentina': 'ar', 'Argélia': 'dz', 'Áustria': 'at', 'Jordânia': 'jo',
  'Portugal': 'pt', 'Rep. Congo': 'cd', 'Uzbequistão': 'uz', 'Colômbia': 'co',
  'Inglaterra': 'gb-eng', 'Croácia': 'hr', 'Gana': 'gh', 'Panamá': 'pa',
}

const TITULOS_BRASIL = [
  { ano: 1958, sede: 'Suécia',     final: '5×2 Suécia',         astro: 'Pelé (17 anos)',    fato: 'Brasil é o único país a vencer Copa em todos os continentes que sediou.' },
  { ano: 1962, sede: 'Chile',      final: '3×1 Tchecoslováquia', astro: 'Garrincha',         fato: 'Garrincha foi artilheiro mesmo com Pelé lesionado já no 2º jogo.' },
  { ano: 1970, sede: 'México',     final: '4×1 Itália',         astro: 'Pelé, Tostão, Jair', fato: 'Brasil ganhou em definitivo a Taça Jules Rimet ao chegar ao 3º título.' },
  { ano: 1994, sede: 'EUA',        final: '0×0 (3×2 pen) Itália', astro: 'Romário, Bebeto',  fato: 'Em 1994 a final foi nos EUA — agora a Copa volta pra cá.' },
  { ano: 2002, sede: 'Coreia/Japão', final: '2×0 Alemanha',     astro: 'Ronaldo Fenômeno',  fato: 'Ronaldo marcou os 2 gols da final e fechou a Copa com 8 gols (artilheiro).' },
]

const LENDAS = [
  { nome: 'Pelé',           anos: '1958, 1962, 1970', detail: '3 vezes campeão mundial — único na história' },
  { nome: 'Garrincha',      anos: '1958, 1962',       detail: 'Campeão sem nunca perder com a seleção' },
  { nome: 'Romário',        anos: '1994',             detail: 'Bola de Ouro da Copa — 5 gols' },
  { nome: 'Ronaldo',        anos: '1994*, 2002',      detail: 'Artilheiro 2002 — 15 gols em Copas (recorde brasileiro)' },
  { nome: 'Ronaldinho',     anos: '2002',             detail: 'Gol histórico de falta vs Inglaterra nos QFs' },
  { nome: 'Cafu',           anos: '1994, 2002',       detail: 'Único brasileiro a jogar 3 finais de Copa' },
]

const CURIOSIDADES = [
  '🇧🇷 Brasil é o único país que disputou TODAS as 22 Copas do Mundo desde 1930.',
  '⚽ Maior goleada da história das Copas: Hungria 10×1 El Salvador (1982).',
  '🏆 5 títulos: Brasil é o único pentacampeão mundial.',
  '🎯 Pelé é o único jogador com 3 títulos mundiais.',
  '⚡ Cristiano Ronaldo e Messi nunca venceram Copa contra o Brasil em mata-mata.',
  '🥅 Maior número de gols numa Copa: Just Fontaine (França) — 13 gols em 1958.',
  '🇺🇸 Em 1994 nos EUA, Brasil quebrou jejum de 24 anos sem título.',
  '🌎 Copa 2026: 1ª com 48 seleções e 3 países-sede (USA, Canadá, México).',
  '⏱ Brasil tem média de gol mais rápida em estreias de Copa: 12 minutos.',
  '🎉 Final da Copa 2026 será em 19 de Julho de 2026 no MetLife Stadium (NJ).',
]

// ════════════════════════════════════════════════════════════════════════════
//   Componentes utilitários
// ════════════════════════════════════════════════════════════════════════════

function FlagImg({ team, size = 28 }) {
  const code = COUNTRY_CODES[team]
  if (!code) return <span style={{ fontSize: size * 0.7, lineHeight: 1 }}>🏳</span>
  return (
    <img
      src={'https://flagcdn.com/w40/' + code + '.png'}
      alt={team}
      style={{ width: size, height: 'auto', borderRadius: 2, display: 'block' }}
    />
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <div style={{
        width: 28, height: 28, border: '3px solid #e5e7eb',
        borderTopColor: GREEN, borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  )
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const colors  = { success: '#dcfce7', error: '#fee2e2', info: '#dbeafe' }
  const borders = { success: '#86efac', error: '#fca5a5', info: '#93c5fd' }
  const icons   = { success: '✅', error: '❌', info: 'ℹ️' }
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: colors[type], border: '1px solid ' + borders[type],
      borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 8,
      maxWidth: 'calc(100vw - 32px)', textAlign: 'center', lineHeight: 1.4,
    }}>
      {icons[type]} {msg}
    </div>
  )
}

function Input({ label, hint, ...props }) {
  return (
    <div>
      {label && (
        <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
          {label} {props.required && <span style={{ color: '#ef4444' }}>*</span>}
        </label>
      )}
      <input
        {...props}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          border: '1.5px solid #e5e7eb', fontSize: 15, outline: 'none',
          background: '#fff', boxSizing: 'border-box',
          ...(props.style || {}),
        }}
      />
      {hint && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function StateSelect({ value, onChange, required }) {
  return (
    <div>
      <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
        Estado nos EUA {required && <span style={{ color: '#ef4444' }}>*</span>}
      </label>
      <select
        value={value} onChange={e => onChange(e.target.value)} required={required}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          border: '1.5px solid #e5e7eb', fontSize: 15, outline: 'none',
          background: '#fff', boxSizing: 'border-box',
        }}
      >
        <option value="">Selecione seu estado…</option>
        {US_STATES.map(([code, name]) => (
          <option key={code} value={code}>{code} — {name}</option>
        ))}
      </select>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        Usado para o ranking estadual entre brasileiros do seu estado
      </div>
    </div>
  )
}

function Btn({ children, color = GREEN, outline = false, disabled, ...props }) {
  return (
    <button
      disabled={disabled}
      {...props}
      style={{
        width: '100%', padding: '13px 0', borderRadius: 10,
        background: outline ? '#fff' : (disabled ? '#9ca3af' : color),
        color: outline ? color : '#fff',
        border: outline ? '2px solid ' + color : 'none',
        fontSize: 15, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...(props.style || {}),
      }}
    >
      {children}
    </button>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function stateName(code) {
  const s = US_STATES.find(([c]) => c === code)
  return s ? s[1] : code
}

// ════════════════════════════════════════════════════════════════════════════
//   Hook: countdown
// ════════════════════════════════════════════════════════════════════════════
function useCountdown(targetDate) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!targetDate) return null
  const diff = new Date(targetDate).getTime() - now
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, expired: true }
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff / 3600000) % 24),
    m: Math.floor((diff / 60000) % 60),
    s: Math.floor((diff / 1000) % 60),
    expired: false,
  }
}

function CountdownBlock({ targetDate, label, sub, gradient }) {
  const t = useCountdown(targetDate)
  if (!t) return null
  const cell = (n, lbl) => (
    <div style={{
      flex: 1, background: 'rgba(255,255,255,0.18)', borderRadius: 10,
      padding: '10px 4px', textAlign: 'center', minWidth: 0,
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{String(n).padStart(2, '0')}</div>
      <div style={{ fontSize: 9, opacity: 0.85, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{lbl}</div>
    </div>
  )
  return (
    <div style={{
      background: gradient || 'linear-gradient(135deg, ' + BLUE + ' 0%, #1e3a5f 100%)',
      borderRadius: 14, padding: '16px', color: '#fff', marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600 }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>{sub}</div>}
      {t.expired ? (
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 10 }}>🏁 Já começou!</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {cell(t.d, 'dias')}{cell(t.h, 'horas')}{cell(t.m, 'min')}{cell(t.s, 'seg')}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Curiosidades rotativas
// ════════════════════════════════════════════════════════════════════════════
function CuriosidadesRotativas() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * CURIOSIDADES.length))
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % CURIOSIDADES.length), 6000)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{
      background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
      border: '1px solid #FCD34D', borderRadius: 12, padding: '14px 16px',
      marginBottom: 12, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        💡 Você sabia?
      </div>
      <div key={idx} style={{
        fontSize: 14, color: '#78350F', lineHeight: 1.5, fontWeight: 500,
        animation: 'fadeIn .6s ease',
      }}>
        {CURIOSIDADES[idx]}
      </div>
      <style>{'@keyframes fadeIn { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }'}</style>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Galeria: títulos do Brasil
// ════════════════════════════════════════════════════════════════════════════
function GaleriaTitulos() {
  const [idx, setIdx] = useState(0)
  const t = TITULOS_BRASIL[idx]
  return (
    <div style={{
      background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 14,
      padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        🏆 5 vezes campeão
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        {TITULOS_BRASIL.map((tt, i) => (
          <button
            key={tt.ano}
            onClick={() => setIdx(i)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              background: i === idx ? GREEN : '#F3F4F6',
              color: i === idx ? '#fff' : '#374151',
              fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            {tt.ano}
          </button>
        ))}
      </div>

      <div key={idx} style={{ animation: 'slideIn .3s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: BLUE }}>{t.ano}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>📍 {t.sede}</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
          🏟 Final: {t.final}
        </div>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
          ⭐ Astro: {t.astro}
        </div>
        <div style={{
          fontSize: 12, color: '#6b7280', fontStyle: 'italic',
          background: '#F9FAFB', padding: '8px 10px', borderRadius: 8,
          borderLeft: '3px solid ' + GOLD,
        }}>
          {t.fato}
        </div>
      </div>
      <style>{'@keyframes slideIn { from { opacity: 0; transform: translateX(8px) } to { opacity: 1; transform: none } }'}</style>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Lendas em scroll horizontal
// ════════════════════════════════════════════════════════════════════════════
function LendasScroll() {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, padding: '0 2px' }}>
        ⚽ Lendas que jogaram pelo Brasil
      </div>
      <div style={{
        display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4,
        scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        <style>{'.lendas-scroll::-webkit-scrollbar { display: none }'}</style>
        {LENDAS.map(l => (
          <div key={l.nome} className="lendas-scroll" style={{
            flexShrink: 0, width: 180, background: '#fff',
            border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '12px 14px',
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>🌟</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: BLUE, marginBottom: 2 }}>{l.nome}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: GREEN, marginBottom: 6 }}>{l.anos}</div>
            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>{l.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Simulador "Caminho do Brasil"
// ════════════════════════════════════════════════════════════════════════════
function SimuladorBrasil() {
  const [open, setOpen] = useState(false)
  const fases = [
    { fase: 'Grupos',    desc: 'Brasil no Grupo C com Marrocos, Haiti e Escócia',           prob: 'muito alta' },
    { fase: 'Oitavas',   desc: 'Provável adversário: 2º lugar do Grupo D (EUA/Paraguai)',  prob: 'alta' },
    { fase: 'Quartas',   desc: 'Possível duelo com Argentina ou França',                    prob: 'média' },
    { fase: 'Semifinal', desc: 'Pode encontrar Inglaterra ou Espanha',                     prob: 'média' },
    { fase: 'Final 🏆',  desc: 'MetLife Stadium, New Jersey — 19 de Julho de 2026',         prob: 'sonho' },
  ]
  return (
    <div style={{
      background: 'linear-gradient(135deg, #009c3b 0%, #006428 100%)',
      borderRadius: 14, padding: '16px', color: '#fff', marginBottom: 12,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'transparent', border: 'none', color: '#fff',
          padding: 0, textAlign: 'left', cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600, marginBottom: 4 }}>
          🇧🇷 SIMULADOR
        </div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>
          Será que o Brasil chega na final? {open ? '▾' : '▸'}
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 14, animation: 'fadeIn .3s ease' }}>
          {fases.map((f, i) => (
            <div key={f.fase} style={{
              display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start',
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: 'rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{f.fase}</div>
                <div style={{ fontSize: 12, opacity: 0.88, lineHeight: 1.4, marginTop: 2 }}>{f.desc}</div>
                <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Chance: {f.prob}
                </div>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 8, fontStyle: 'italic' }}>
            * Caminho hipotético baseado nos grupos. Cada surpresa muda tudo!
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Compartilhar
// ════════════════════════════════════════════════════════════════════════════
async function shareNative({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return true } catch (_) {}
  }
  try {
    await navigator.clipboard.writeText(text + (url ? '\n' + url : ''))
    return 'copied'
  } catch (_) { return false }
}

// ════════════════════════════════════════════════════════════════════════════
//   Tabs com scroll
// ════════════════════════════════════════════════════════════════════════════
const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

function groupByPhaseAndGroup(matches) {
  const phases = {}
  for (const m of matches) {
    const key = m.phase === 'group' ? 'Grupo ' + m.group_name : phaseLabel(m.phase)
    if (!phases[key]) phases[key] = []
    phases[key].push(m)
  }
  return phases
}

function sortedGroupKeys(grouped) {
  return Object.keys(grouped).sort((a, b) => {
    const aIsGroup = a.startsWith('Grupo ')
    const bIsGroup = b.startsWith('Grupo ')
    if (aIsGroup && bIsGroup) {
      return GROUP_ORDER.indexOf(a.replace('Grupo ', '')) - GROUP_ORDER.indexOf(b.replace('Grupo ', ''))
    }
    if (aIsGroup) return -1
    if (bIsGroup) return 1
    return 0
  })
}

function phaseLabel(phase) {
  const map = { group: 'Fase de Grupos', r32: '16-avos de Final', r16: 'Oitavas de Final', qf: 'Quartas de Final', sf: 'Semifinal', final: 'Final' }
  return map[phase] || phase
}

function ScrollTabs({ keys, active, onSelect, color = BLUE }) {
  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 12,
      scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      <style>{'.scroll-tabs::-webkit-scrollbar { display: none }'}</style>
      {keys.map(key => (
        <button
          key={key}
          className="scroll-tabs"
          onClick={() => onSelect(key)}
          style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 20,
            fontSize: 12, fontWeight: 600, border: 'none',
            background: active === key ? color : '#f3f4f6',
            color: active === key ? '#fff' : '#374151',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {key}
        </button>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Home (com TODAS as features interativas)
// ════════════════════════════════════════════════════════════════════════════
function HomeView({ onCreateClick, onJoinClick, config, setToast, memberships, onPickMembership }) {
  const copaStart = config?.copa_start_date || '2026-06-11T19:00:00Z'
  const brasilFirst = config?.brasil_first_match || '2026-06-13T22:00:00Z'

  const handleShare = async () => {
    const r = await shareNative({
      title: 'Bolão Copa 2026 🇧🇷',
      text: '🏆 Bora montar nosso bolão da Copa 2026? É grátis e tem ranking nacional, por estado e por grupo!',
      url: 'https://brasilconnectusa.com',
    })
    if (r === 'copied') setToast({ msg: 'Link copiado! Cola no WhatsApp e chama o pessoal 🚀', type: 'success' })
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      {/* Meus bolões — mostrado quando user já participa de algum */}
      {memberships && memberships.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Meus bolões ({memberships.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {memberships.map(m => (
              <button key={m.member_id} onClick={() => onPickMembership(m)} style={{
                background: '#fff', border: '1.5px solid ' + GREEN, borderRadius: 12,
                padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: BLUE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.group_name || 'Bolão'}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {m.nickname ? `como ${m.nickname}` : 'membro'}{m.state ? ` · ${m.state}` : ''} · código {m.join_code}
                  </div>
                </div>
                <span style={{ fontSize: 18, color: GREEN, flexShrink: 0 }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, ' + BLUE + ' 0%, #1e3a5f 100%)',
        borderRadius: 14, padding: '24px 18px', marginBottom: 14, color: '#fff',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ fontSize: 40, marginBottom: 6 }}>⚽</div>
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Bolão Copa 2026</div>
        <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
          A Copa é aqui nos EUA! Monte seu bolão,<br />
          dispute com amigos e torça pelo Brasil 🇧🇷
        </div>
        <div style={{
          marginTop: 12, display: 'inline-block',
          background: YELLOW, color: '#000',
          fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
        }}>
          🏆 EUA · Canadá · México — Junho 2026
        </div>
      </div>

      {/* Countdown */}
      <CountdownBlock
        targetDate={copaStart}
        label="Faltam para a abertura da Copa"
        sub="11 de Junho de 2026 · México vs África do Sul"
        gradient={'linear-gradient(135deg, ' + GREEN + ' 0%, #006428 100%)'}
      />
      <CountdownBlock
        targetDate={brasilFirst}
        label="🇧🇷 1º jogo do Brasil"
        sub="13 de Junho · Brasil × Marrocos · MetLife Stadium NJ"
        gradient="linear-gradient(135deg, #FBBF24 0%, #D97706 100%)"
      />

      {/* CTAs principais */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <button onClick={onCreateClick} style={{
          background: GREEN, color: '#fff', border: 'none',
          borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer',
        }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>➕</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Criar meu bolão</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>Você é o admin · define o combinado</div>
        </button>

        <button onClick={onJoinClick} style={{
          background: '#fff', color: BLUE, border: '2px solid ' + BLUE,
          borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer',
        }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>🔗</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Entrar num bolão</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Tenho o código de convite</div>
        </button>
      </div>

      {/* Compartilhar */}
      <button onClick={handleShare} style={{
        width: '100%', background: '#fff', border: '1.5px dashed ' + GOLD,
        color: '#8C6D3D', borderRadius: 12, padding: '14px',
        fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 16,
      }}>
        📤 Convidar amigos pro Bolão
      </button>

      {/* Como funciona */}
      <div style={{
        background: '#f0fdf4', borderRadius: 12, padding: '14px 16px',
        border: '1px solid #bbf7d0', marginBottom: 14,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, marginBottom: 8 }}>
          📋 Como funciona
        </div>
        {[
          ['🎯', 'Placar exato: 3 pontos'],
          ['✅', 'Acertou só o vencedor (ou empate): 1 ponto'],
          ['🏆', '3 rankings: seu grupo, seu estado e nacional (USA)'],
          ['🎁', 'Cada admin define o combinado do próprio grupo'],
          ['⏰', 'Prazo: até 1 dia antes da Copa começar'],
        ].map(([icon, text]) => (
          <div key={text} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, lineHeight: 1.6 }}>{icon}</span>
            <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>

      {/* Conteúdo interativo */}
      <CuriosidadesRotativas />
      <GaleriaTitulos />
      <LendasScroll />
      <SimuladorBrasil />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   IdentityChoice — Compartilhado: escolher como aparecer no bolao
//   Opcoes:
//     - "username": usa @username (do profile) → ranking mostra @anderson_t
//     - "custom": apelido livre por bolao    → ranking mostra "Gremista42"
//   Se user nao tem username no profile, mostra so o custom.
// ════════════════════════════════════════════════════════════════════════════
function IdentityChoice({ profileUsername, nickname, setNickname, mode, setMode }) {
  const hasUsername = !!profileUsername

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
        Como você quer aparecer no ranking?
      </label>

      {hasUsername && (
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
          borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13,
          background: mode === 'username' ? '#ECFDF5' : '#fff',
          border: '1.5px solid ' + (mode === 'username' ? '#10B981' : '#E5E7EB'),
        }}>
          <input
            type="radio" name="bolao-identity" checked={mode === 'username'}
            onChange={() => { setMode('username'); setNickname('@' + profileUsername) }}
            style={{ marginTop: 2 }}
          />
          <span>
            <b>Meu @{profileUsername}</b>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              Aparece nos posts e no ranking — fica consistente em toda a plataforma.
            </div>
          </span>
        </label>
      )}

      <label style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
        borderRadius: 8, cursor: 'pointer', fontSize: 13,
        background: mode === 'custom' ? '#FEF3C7' : '#fff',
        border: '1.5px solid ' + (mode === 'custom' ? '#F59E0B' : '#E5E7EB'),
      }}>
        <input
          type="radio" name="bolao-identity" checked={mode === 'custom'}
          onChange={() => { setMode('custom'); setNickname('') }}
          style={{ marginTop: 2 }}
        />
        <span style={{ flex: 1 }}>
          <b>Apelido personalizado pra esse bolão</b>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, marginBottom: 6 }}>
            Tipo "Gremista42" — só aparece nesse bolão, não revela seu @username.
          </div>
          {mode === 'custom' && (
            <input
              type="text" value={nickname} onChange={e => setNickname(e.target.value.slice(0, 30))}
              placeholder="Ex: Gremista42" maxLength={30}
              autoFocus
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid #D1D5DB', fontSize: 13, outline: 'none',
                background: '#fff', boxSizing: 'border-box',
              }}
            />
          )}
        </span>
      </label>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Criar Grupo (com cadastro completo)
// ════════════════════════════════════════════════════════════════════════════
function CreateGroupView({ onBack, onCreated, setToast, prefill }) {
  const { user: viewerAuthUser } = useAuth()
  const [name, setName]       = useState('')
  // Pre-fill com dados do user logado + ultima membership. Email fica
  // bloqueado quando logado (admin_email tem que casar com o user_id).
  const [fullName, setFullName] = useState(prefill?.full_name || '')
  const [email, setEmail]     = useState(prefill?.email || '')
  const [state, setState]     = useState(prefill?.state || '')
  const [whatsapp, setWhatsapp] = useState(prefill?.whatsapp || '')
  // Identidade no ranking: 'username' (default se tem profile) ou 'custom'
  const [identityMode, setIdentityMode] = useState(prefill?.username ? 'username' : 'custom')
  const [nickname, setNickname] = useState(prefill?.username ? '@' + prefill.username : '')
  const [loading, setLoading] = useState(false)
  const emailLocked = !!prefill?.locked_email

  // Resolve nickname final: username escolhido vira "@user", custom vira o texto livre.
  function resolvedNickname() {
    if (identityMode === 'username' && prefill?.username) return '@' + prefill.username
    return nickname.trim()
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!name || !email || !fullName || !state) return
    const nick = resolvedNickname()
    if (!nick || nick.length < 2) return
    // Gate: se logado, exige profile completo antes de criar bolao
    if (viewerAuthUser && !(await requireOnboarding(viewerAuthUser))) return
    setLoading(true)
    try {
      const res = await apiFetch('/api/bolao?action=create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          name: name.trim(),
          admin_email: email.trim(),
          admin_full_name: fullName.trim(),
          admin_state: state,
          admin_whatsapp: whatsapp.trim() || null,
          admin_nickname: nick,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      saveMembership({ group: data.group, member: data.member, isAdmin: true })
      onCreated(data.group, data.member)
    } catch (err) {
      setToast({ msg: err.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const nickValid = identityMode === 'username' ? !!prefill?.username : (nickname.trim().length >= 2)
  const valid = name && email && fullName && state && nickValid

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
        ← Voltar
      </button>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Criar bolão ⚽</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Você vira o admin: define o combinado e recebe um código de convite.
      </div>
      {prefill && (
        <div style={{
          background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10,
          padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#166534',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>✓</span>
          <span>Preenchemos com seus dados. Pode editar se quiser.</span>
        </div>
      )}
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label="Nome do bolão" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Bolão dos amigos" required />
        <Input label="Seu nome completo" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="João Silva" required />
        <Input label="Seu e-mail" type="email" value={email}
          onChange={e => emailLocked ? null : setEmail(e.target.value)}
          placeholder="voce@email.com" required
          readOnly={emailLocked}
          style={emailLocked ? { background: '#f3f4f6', color: '#6b7280', cursor: 'not-allowed' } : {}}
          hint={emailLocked ? 'Email da sua conta — não pode ser alterado aqui' : 'Usado para login admin e notificações'} />
        <StateSelect value={state} onChange={setState} required />
        <Input label="WhatsApp (opcional)" type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 (555) 555-5555" hint="Para o admin te avisar do prêmio" />
        <IdentityChoice
          profileUsername={prefill?.username || null}
          nickname={nickname} setNickname={setNickname}
          mode={identityMode} setMode={setIdentityMode}
        />
        <Btn type="submit" disabled={loading || !valid}>
          {loading ? 'Criando…' : 'Criar bolão →'}
        </Btn>
        {!valid && (
          <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            Preencha todos os campos obrigatórios (*) para continuar
          </div>
        )}
      </form>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Entrar no Grupo (cadastro completo)
// ════════════════════════════════════════════════════════════════════════════
function JoinGroupView({ onBack, onJoined, setToast, prefilledCode, prefill }) {
  const { user: viewerAuthUser } = useAuth()
  const [code, setCode]         = useState(prefilledCode || '')
  const [nickname, setNickname] = useState(prefill?.username ? '@' + prefill.username : '')
  const [identityMode, setIdentityMode] = useState(prefill?.username ? 'username' : 'custom')
  const [fullName, setFullName] = useState(prefill?.full_name || '')
  const [email, setEmail]       = useState(prefill?.email || '')
  const [state, setState]       = useState(prefill?.state || '')
  const [whatsapp, setWhatsapp] = useState(prefill?.whatsapp || '')
  const [loading, setLoading]   = useState(false)
  const [groupPreview, setGroupPreview] = useState(null) // { name, member_count } se code válido
  const emailLocked = !!prefill?.locked_email

  // Quando vem com código pré-preenchido (deep-link /bolao/<code>), busca dados do grupo
  useEffect(() => {
    if (!prefilledCode) return
    let alive = true
    apiFetch('/api/bolao?action=group&code=' + prefilledCode)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (d.group) {
          setGroupPreview({
            name: d.group.name,
            memberCount: (d.members || []).length,
            prize: d.group.prize_title || d.group.prize_first || null,
          })
        } else {
          setGroupPreview({ error: 'Código de grupo não encontrado.' })
        }
      })
      .catch(() => { if (alive) setGroupPreview({ error: 'Não consegui buscar o grupo. Confira o código.' }) })
    return () => { alive = false }
  }, [prefilledCode])

  function resolvedNickname() {
    if (identityMode === 'username' && prefill?.username) return '@' + prefill.username
    return nickname.trim()
  }

  async function handleJoin(e) {
    e.preventDefault()
    const nick = resolvedNickname()
    if (!code || !nick || nick.length < 2 || !email || !fullName || !state) return
    // Gate: se logado, exige profile completo antes de entrar em bolao
    if (viewerAuthUser && !(await requireOnboarding(viewerAuthUser))) return
    setLoading(true)
    try {
      const res = await apiFetch('/api/bolao?action=join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          code: code.toUpperCase().trim(),
          nickname: nick,
          email: email.trim(),
          full_name: fullName.trim(),
          state,
          whatsapp: whatsapp.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      saveMembership({ group: data.group, member: data.member })
      onJoined(data.group, data.member)
    } catch (err) {
      setToast({ msg: err.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const nickValid = identityMode === 'username' ? !!prefill?.username : (nickname.trim().length >= 2)
  const valid = code && nickValid && email && fullName && state
  const isInvited = !!(prefilledCode && groupPreview && !groupPreview.error)

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
        ← Voltar
      </button>

      {isInvited ? (
        <div style={{
          background: 'linear-gradient(135deg, ' + GREEN + ' 0%, #006428 100%)',
          borderRadius: 14, padding: '20px 18px', marginBottom: 18, color: '#fff',
        }}>
          <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>🎉 Você foi convidado!</div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>{groupPreview.name}</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            {groupPreview.memberCount} {groupPreview.memberCount === 1 ? 'pessoa já entrou' : 'pessoas já entraram'} · Bolão Copa 2026
          </div>
          {groupPreview.prize && (
            <div style={{ marginTop: 10, fontSize: 12, background: 'rgba(255,255,255,0.18)', padding: '6px 10px', borderRadius: 8, display: 'inline-block' }}>
              🏆 {groupPreview.prize}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Entrar no bolão 🔗</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Digite o código que seu amigo te passou e seus dados.
          </div>
        </>
      )}

      {prefilledCode && groupPreview?.error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#991B1B', marginBottom: 14 }}>
          ⚠️ {groupPreview.error}
        </div>
      )}

      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!isInvited && (
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
              Código de convite <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text" value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXXX" maxLength={6} required
              style={{
                width: '100%', padding: '14px', borderRadius: 10,
                border: '1.5px solid #e5e7eb', fontSize: 24, fontWeight: 800,
                letterSpacing: 6, textAlign: 'center', outline: 'none',
                background: '#fff', boxSizing: 'border-box',
              }}
            />
          </div>
        )}
        <Input label="Seu nome completo" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="João Silva" required />
        <Input label="Seu e-mail" type="email" value={email}
          onChange={e => emailLocked ? null : setEmail(e.target.value)}
          placeholder="voce@email.com" required
          readOnly={emailLocked}
          style={emailLocked ? { background: '#f3f4f6', color: '#6b7280', cursor: 'not-allowed' } : {}}
          hint={emailLocked ? 'Email da sua conta — não pode ser alterado aqui' : 'Pra avisar quando palpites estiverem prestes a fechar'} />
        <StateSelect value={state} onChange={setState} required />
        <Input label="WhatsApp (opcional)" type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 (555) 555-5555" />
        <IdentityChoice
          profileUsername={prefill?.username || null}
          nickname={nickname} setNickname={setNickname}
          mode={identityMode} setMode={setIdentityMode}
        />
        <Btn type="submit" disabled={loading || !valid}>
          {loading ? 'Entrando…' : (isInvited ? `Entrar em ${groupPreview.name} →` : 'Entrar no grupo →')}
        </Btn>
        <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', lineHeight: 1.5, marginTop: 4 }}>
          Gratuito · Sem cobrança · Cancela quando quiser
        </div>
      </form>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Combinado do grupo (modal/edit) — antiga "Premiação"
// ════════════════════════════════════════════════════════════════════════════
// Limites sincronizados com backend (api/bolao.js update-prize). Trocar nos
// dois lugares juntos — divergencia causa truncamento silencioso no servidor.
const PRIZE_LIMITS = {
  title:       120,
  description: 3000,
  position:    300,   // 1º, 2º e 3º lugar (mesma faixa)
}

function CharCounter({ value, max }) {
  const len = (value || '').length
  const ratio = len / max
  const color = ratio >= 1 ? '#ef4444' : ratio >= 0.9 ? '#f59e0b' : '#9ca3af'
  const weight = ratio >= 0.9 ? 600 : 400
  return (
    <div style={{ fontSize: 11, color, fontWeight: weight, marginTop: 4, textAlign: 'right' }}>
      {len.toLocaleString('pt-BR')} / {max.toLocaleString('pt-BR')}
    </div>
  )
}

function PrizeEditor({ group, onClose, onSaved, setToast, adminEmail }) {
  const [title, setTitle]   = useState(group.prize_title || '')
  const [desc, setDesc]     = useState(group.prize_description || '')
  const [first, setFirst]   = useState(group.prize_first || '')
  const [second, setSecond] = useState(group.prize_second || '')
  const [third, setThird]   = useState(group.prize_third || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await apiFetch('/api/bolao?action=update-prize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: group.id, admin_email: adminEmail,
          prize_title: title, prize_description: desc,
          prize_first: first, prize_second: second, prize_third: third,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setToast({ msg: 'Combinado salvo!', type: 'success' })
      onSaved(data.prize)
      onClose()
    } catch (e) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px 32px', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, background: '#e5e7eb', borderRadius: 4, margin: '0 auto 16px' }} />
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>📋 Editar combinado do grupo</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Visível para todos os membros do grupo</div>
        <div style={{ fontSize: 11, color: '#92400E', background: '#FEF3C7', padding: '6px 10px', borderRadius: 6, marginBottom: 16, lineHeight: 1.5 }}>
          O combinado é entre os membros — a BrasilConnect não recebe nem repassa dinheiro. Sugerimos prêmios simbólicos (pizza, cerveja, troféu).
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Input label="Título do combinado" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Pizza pro vencedor!" maxLength={PRIZE_LIMITS.title} />
            <CharCounter value={title} max={PRIZE_LIMITS.title} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Descrição / regras</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5}
              maxLength={PRIZE_LIMITS.description}
              placeholder="Ex: Quem fizer mais pontos ganha uma pizza família. Em caso de empate, o desempate é pela quantidade de placares exatos. Combinado entregue até 1 semana após a final."
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 14, outline: 'none', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', minHeight: 90 }}
            />
            <CharCounter value={desc} max={PRIZE_LIMITS.description} />
          </div>
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Posições (opcional)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <Input label="🥇 1º lugar" value={first} onChange={e => setFirst(e.target.value)}
                  placeholder="Ex: Pizza família + cerveja" maxLength={PRIZE_LIMITS.position} />
                <CharCounter value={first} max={PRIZE_LIMITS.position} />
              </div>
              <div>
                <Input label="🥈 2º lugar" value={second} onChange={e => setSecond(e.target.value)}
                  placeholder="Ex: Hamburguer" maxLength={PRIZE_LIMITS.position} />
                <CharCounter value={second} max={PRIZE_LIMITS.position} />
              </div>
              <div>
                <Input label="🥉 3º lugar" value={third} onChange={e => setThird(e.target.value)}
                  placeholder="Ex: Refrigerante" maxLength={PRIZE_LIMITS.position} />
                <CharCounter value={third} max={PRIZE_LIMITS.position} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Btn outline color="#6b7280" onClick={onClose} type="button" style={{ flex: 1 }}>Cancelar</Btn>
            <Btn onClick={handleSave} disabled={saving} type="button" style={{ flex: 2 }}>{saving ? 'Salvando…' : 'Salvar combinado'}</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: GroupDashboard
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
//   CreatedSuccessView — celebração + share imediato após criar grupo
// ════════════════════════════════════════════════════════════════════════════
function CreatedSuccessView({ group, onContinue, setToast }) {
  const inviteUrl = 'https://brasilconnectusa.com/bolao/' + group.join_code
  const whatsappText = '🏆 Criei nosso Bolão Copa 2026!\n\n' +
    '⚽ Grupo: *' + group.name + '*\n' +
    '🔑 Código: *' + group.join_code + '*\n\n' +
    'Entra aqui: ' + inviteUrl
  const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(whatsappText)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setToast({ msg: 'Link copiado!', type: 'success' })
    } catch (_) {}
  }

  return (
    <div style={{ padding: '0 0 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginTop: 24, marginBottom: 8 }}>🎉</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>
        Bolão criado
      </div>
      <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 30, fontWeight: 700, color: BLUE, lineHeight: 1.2, margin: '0 16px 12px', letterSpacing: -0.3 }}>
        {group.name} <span style={{ color: GOLD }}>tá no ar!</span>
      </h1>
      <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.55, maxWidth: 360, margin: '0 auto 24px' }}>
        Agora chama a galera. Quanto mais brasileiros palpitarem, mais divertido (e mais alto o ranking nacional).
      </p>

      {/* Código grande */}
      <div style={{
        background: '#fff', border: '2px dashed #B89968', borderRadius: 14,
        padding: '18px 16px', maxWidth: 360, margin: '0 auto 18px',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#8C6D3D', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
          Código de convite
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: 8, color: BLUE, fontFamily: 'monospace' }}>
          {group.join_code}
        </div>
      </div>

      {/* CTAs */}
      <div style={{ maxWidth: 360, margin: '0 auto', padding: '0 4px' }}>
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: '#25D366', color: '#fff', borderRadius: 12, padding: '15px',
          fontSize: 15, fontWeight: 800, textDecoration: 'none', marginBottom: 10,
        }}>
          <span style={{ fontSize: 20 }}>💬</span> Chamar amigos no WhatsApp
        </a>

        <button onClick={handleCopy} style={{
          width: '100%', background: '#fff', color: BLUE, border: '1.5px solid ' + BLUE,
          borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 14,
        }}>
          📋 Copiar link de convite
        </button>

        <div style={{ marginBottom: 14 }}>
          <PushOptInBanner
            topic="bolao"
            title="Avisar dos jogos pelo celular?"
            description="A gente cobra os palpites quando faltar 1 dia pro prazo e avisa dos resultados ao vivo."
          />
        </div>

        <button onClick={onContinue} style={{
          width: '100%', background: 'none', color: '#6b7280', border: 'none',
          padding: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          Continuar pro painel do bolão →
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   CrossSellPanel — atalhos sutis pra outras features (câmbio, voos)
// ════════════════════════════════════════════════════════════════════════════
function CrossSellPanel() {
  const [rate, setRate] = useState(null)

  useEffect(() => {
    apiFetch('/api/rates').then(r => r.json()).then(d => {
      if (d?.success && d.mid_rate) setRate(d.mid_rate)
    }).catch(() => {})
  }, [])

  const utm = '?utm_source=app&utm_medium=bolao_dashboard'

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
        BrasilConnect também tem
      </div>
      <div>
        <a href={'/app/voos' + utm} style={{
          display: 'block', padding: '12px 14px', background: '#fff',
          border: '1px solid #e5e7eb', borderRadius: 12, textDecoration: 'none',
        }}>
          <div style={{ fontSize: 18, marginBottom: 2 }}>✈️</div>
          <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 17, fontWeight: 700, color: BLUE, lineHeight: 1, marginBottom: 2 }}>
            Pra Copa
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Voos EUA → Brasil</div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>Skyscanner, KAYAK</div>
        </a>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   InviteModal — WhatsApp share + QR + copiar link
// ════════════════════════════════════════════════════════════════════════════
function InviteModal({ group, inviteUrl, whatsappUrl, memberCount, onClose, onCopy, onNativeShare }) {
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=' + encodeURIComponent(inviteUrl)
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
        padding: '20px 22px 36px', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ width: 36, height: 4, background: '#e5e7eb', borderRadius: 4, margin: '0 auto 18px' }} />

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📤</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, marginBottom: 4 }}>Chama a galera!</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {memberCount === 1 ? 'Você é o primeiro do grupo.' : `${memberCount} já no grupo.`} Quanto mais brasileiros palpitarem, mais divertido.
          </div>
        </div>

        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: '#25D366', color: '#fff', borderRadius: 12, padding: '14px',
          fontSize: 15, fontWeight: 800, textDecoration: 'none', marginBottom: 10,
        }}>
          <span style={{ fontSize: 20 }}>💬</span> Compartilhar no WhatsApp
        </a>

        <button onClick={onNativeShare} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', background: '#fff', color: BLUE, border: '1.5px solid ' + BLUE,
          borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 18,
        }}>
          📱 Outras opções
        </button>

        {/* Link copiável */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            Ou cola o link em qualquer lugar
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              readOnly value={inviteUrl}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 9, border: '1.5px solid #e5e7eb',
                background: '#f9fafb', fontSize: 12, color: '#374151', fontFamily: 'monospace',
                outline: 'none',
              }}
              onFocus={e => e.target.select()}
            />
            <button onClick={onCopy} style={{
              background: BLUE, color: '#fff', border: 'none', borderRadius: 9,
              padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              Copiar
            </button>
          </div>
        </div>

        {/* QR code */}
        <div style={{
          background: '#FAF7F0', border: '1px solid #E5E1D6', borderRadius: 14,
          padding: 18, textAlign: 'center', marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8C6D3D', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            QR Code do grupo
          </div>
          <img
            src={qrUrl}
            alt={'QR code para entrar no grupo ' + group.name}
            width={200} height={200}
            style={{ display: 'block', margin: '0 auto', borderRadius: 8, background: '#fff', padding: 6 }}
          />
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10, lineHeight: 1.5 }}>
            Imprime e cola na geladeira, no escritório, na igreja —<br/>quem fotografa entra direto.
          </div>
        </div>

        <button onClick={onClose} style={{
          width: '100%', background: 'none', border: 'none', fontSize: 13,
          color: '#9ca3af', cursor: 'pointer', padding: 8,
        }}>Fechar</button>
      </div>
    </div>
  )
}

function GroupDashboard({ group, member, onPredict, onStandings, onLeave, onSwitch, setToast, refreshGroup, deadline }) {
  const [members, setMembers] = useState([])
  const [editPrize, setEditPrize] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [anonRanking, setAnonRanking] = useState(!!group.anonymous_ranking)
  const [anonBusy, setAnonBusy] = useState(false)
  // Admin do grupo ativo: derivado da membership salva (não global)
  const activeMembership = getActiveMembership()
  const adminEmailLocal = activeMembership && activeMembership.member_id === member?.id
    ? (activeMembership.admin_email || '')
    : ''
  const isAdmin = !!adminEmailLocal

  useEffect(() => {
    if (!group) return
    apiFetch('/api/bolao?action=group&code=' + group.join_code)
      .then(r => r.json())
      .then(d => { if (d.members) setMembers(d.members) })
      .catch(() => {})
  }, [group])

  const inviteUrl = 'https://brasilconnectusa.com/bolao/' + group.join_code
  const whatsappText = '🏆 Entrei no Bolão Copa 2026 do BrasilConnect — cole na gente!\n\n' +
    '⚽ Grupo: *' + group.name + '*\n' +
    '🔑 Código: *' + group.join_code + '*\n\n' +
    'Entra aqui: ' + inviteUrl
  const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(whatsappText)

  const handleShare = async () => {
    const r = await shareNative({ title: 'Bolão Copa 2026 — ' + group.name, text: whatsappText, url: inviteUrl })
    if (r === 'copied') setToast({ msg: 'Link copiado!', type: 'success' })
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setToast({ msg: 'Link copiado!', type: 'success' })
    } catch (_) {}
  }

  async function toggleAnonRanking() {
    const next = !anonRanking
    setAnonRanking(next)        // otimista
    setAnonBusy(true)
    try {
      const r = await apiFetch('/api/bolao?action=toggle-anonymous-ranking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ group_id: group.id, anonymous: next }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setToast({ msg: next ? 'Ranking anônimo ligado 🔒' : 'Nomes visíveis de novo', type: 'success' })
    } catch (e) {
      setAnonRanking(!next)     // reverte
      setToast({ msg: e.message || 'Erro ao salvar', type: 'error' })
    } finally {
      setAnonBusy(false)
    }
  }

  const deadlineDate = deadline ? new Date(deadline) : null
  const expired = deadlineDate && new Date() > deadlineDate
  const hasPrize = group.prize_title || group.prize_description || group.prize_first

  return (
    <div style={{ padding: '0 0 16px' }}>
      {editPrize && <PrizeEditor group={group} onClose={() => setEditPrize(false)} onSaved={() => refreshGroup()} setToast={setToast} adminEmail={adminEmailLocal} />}
      {showInvite && (
        <InviteModal
          group={group}
          inviteUrl={inviteUrl}
          whatsappUrl={whatsappUrl}
          memberCount={members.length}
          onClose={() => setShowInvite(false)}
          onCopy={handleCopyLink}
          onNativeShare={handleShare}
        />
      )}

      <div style={{ background: 'linear-gradient(135deg, ' + GREEN + ' 0%, #006428 100%)', borderRadius: 14, padding: '18px 16px', marginBottom: 14, color: '#fff' }}>
        <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>⚽ Seu bolão</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{group.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 14px', fontSize: 18, fontWeight: 800, letterSpacing: 4 }}>{group.join_code}</div>
          <button onClick={() => setShowInvite(true)} style={{ background: 'rgba(255,255,255,0.22)', border: 'none', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📤 Convidar amigos</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
          {member.nickname} {isAdmin && '· 👑 Admin'} · {members.length} participante{members.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Admin do grupo (mostra só pra quem NÃO é o admin) ──────── */}
      {!isAdmin && group.admin && (() => {
        const adminName = group.admin.full_name || group.admin.nickname || 'Admin'
        const waDigits = (group.admin.whatsapp || '').replace(/[^\d]/g, '')
        const hasWa = waDigits.length >= 10
        return (
          <div style={{
            background: '#F0FDF4', border: '1.5px solid #86EFAC',
            borderRadius: 12, padding: '12px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: GREEN, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>👑</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                Admin do grupo
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#14532D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {adminName}{group.admin.state ? ` · ${group.admin.state}` : ''}
              </div>
            </div>
            {hasWa && (
              <a
                href={`https://wa.me/${waDigits}?text=${encodeURIComponent('Oi! Te vi como admin do bolão "' + group.name + '" no BrasilConnect.')}`}
                target="_blank" rel="noopener noreferrer"
                style={{
                  background: '#25D366', color: '#fff', textDecoration: 'none',
                  padding: '7px 12px', borderRadius: 8,
                  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                💬 WhatsApp
              </a>
            )}
          </div>
        )
      })()}

      {deadlineDate && (
        <div style={{ background: expired ? '#FEE2E2' : '#FEF3C7', border: '1px solid ' + (expired ? '#FCA5A5' : '#FCD34D'), borderRadius: 10, padding: '10px 14px', fontSize: 12, color: expired ? '#991B1B' : '#92400E', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          {expired ? '🔒' : '⏰'}
          <div style={{ flex: 1 }}>
            <strong>{expired ? 'Palpites encerrados' : 'Você ainda pode editar palpites'}</strong>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {expired ? 'O prazo terminou em ' : 'Prazo até '}
              {deadlineDate.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      )}

      <div style={{ background: hasPrize ? '#FFFBEB' : '#F9FAFB', border: '1.5px solid ' + (hasPrize ? GOLD : '#e5e7eb'), borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>📋</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Combinado do grupo</div>
            {hasPrize ? (
              <>
                {group.prize_title && <div style={{ fontSize: 16, fontWeight: 800, color: '#78350F', marginBottom: 4 }}>{group.prize_title}</div>}
                {group.prize_description && <div style={{ fontSize: 13, color: '#78350F', lineHeight: 1.5, marginBottom: 6 }}>{group.prize_description}</div>}
                {(group.prize_first || group.prize_second || group.prize_third) && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {group.prize_first  && <div style={{ fontSize: 12, color: '#78350F' }}>🥇 {group.prize_first}</div>}
                    {group.prize_second && <div style={{ fontSize: 12, color: '#78350F' }}>🥈 {group.prize_second}</div>}
                    {group.prize_third  && <div style={{ fontSize: 12, color: '#78350F' }}>🥉 {group.prize_third}</div>}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
                {isAdmin ? 'Defina o combinado do seu grupo abaixo 👇' : 'Aguardando o admin definir o combinado…'}
              </div>
            )}
          </div>
        </div>
        {isAdmin && (
          <button onClick={() => setEditPrize(true)} style={{ marginTop: 10, width: '100%', background: 'transparent', border: '1px solid ' + GOLD, color: '#8C6D3D', borderRadius: 8, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ✏️ {hasPrize ? 'Editar combinado' : 'Definir combinado'}
          </button>
        )}
      </div>

      {/* ── Toggle: ranking anônimo (só admin) ───────────────────────── */}
      {isAdmin && (
        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 20, flexShrink: 0 }}>{anonRanking ? '🔒' : '👀'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Ranking anônimo</div>
            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>
              {anonRanking
                ? 'Ligado — só aparece "Participante #N" e a quantidade. Cada um vê só a própria posição.'
                : 'Desligado — todos veem os nomes no ranking e na lista de participantes.'}
            </div>
          </div>
          <button onClick={toggleAnonRanking} disabled={anonBusy} aria-label="Alternar ranking anônimo" style={{
            flexShrink: 0, width: 46, height: 26, borderRadius: 13, border: 'none',
            background: anonRanking ? GREEN : '#d1d5db', position: 'relative',
            cursor: anonBusy ? 'wait' : 'pointer', transition: 'background .2s', opacity: anonBusy ? 0.6 : 1,
          }}>
            <span style={{
              position: 'absolute', top: 3, left: anonRanking ? 23 : 3,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <button onClick={onPredict} style={{ background: '#fff', border: '2px solid ' + BLUE, borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>📝</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: BLUE }}>Fazer meus palpites</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{expired ? '🔒 Palpites travados' : 'Preveja os placares de todas as partidas'}</div>
        </button>
        <button onClick={onStandings} style={{ background: '#fff', border: '2px solid ' + GREEN, borderRadius: 12, padding: '16px', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🏆</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: GREEN }}>Ver ranking</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Grupo · Estado · Nacional (USA)</div>
        </button>
      </div>

      <CrossSellPanel />

      {members.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Participantes ({members.length})</div>
          {anonRanking ? (
            // Ranking anônimo: esconde nomes, mostra só a contagem (a propria pessoa fica visivel)
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔒</span>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.4 }}>
                <b style={{ color: '#374151' }}>{members.length} participante{members.length !== 1 ? 's' : ''}</b> nesse bolão.
                Os nomes estão ocultos (ranking anônimo ligado pelo admin).
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              {members.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < members.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: m.id === member.id ? GREEN : '#e5e7eb', color: m.id === member.id ? '#fff' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{m.nickname.charAt(0).toUpperCase()}</div>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: m.id === member.id ? 700 : 400 }}>{m.nickname}{m.id === member.id && <span style={{ color: GREEN, fontSize: 11 }}> (você)</span>}</span>
                  {m.state && <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{m.state}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button onClick={onSwitch} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: BLUE, cursor: 'pointer', display: 'block', width: '100%', textAlign: 'center', padding: 10, marginBottom: 6, fontWeight: 600 }}>
        ↩ Voltar / ver meus bolões
      </button>
      <button onClick={onLeave} style={{ background: 'none', border: 'none', fontSize: 11, color: '#9ca3af', cursor: 'pointer', display: 'block', width: '100%', textAlign: 'center', padding: 6 }}>
        Sair desse bolão
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Palpites
// ════════════════════════════════════════════════════════════════════════════
function PredictionsView({ member, onBack, setToast, deadline }) {
  const [matches, setMatches]         = useState([])
  const [myPreds, setMyPreds]         = useState({})
  const [saving, setSaving]           = useState({})
  const [loading, setLoading]         = useState(true)
  const [activeGroup, setActiveGroup] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [mRes, pRes] = await Promise.all([
        apiFetch('/api/bolao?action=matches'),
        apiFetch('/api/bolao?action=my-predictions&member_id=' + member.id),
      ])
      const mData = await mRes.json()
      const pData = await pRes.json()
      const matchList = mData.matches || []
      setMatches(matchList)
      if (matchList.length > 0) {
        const grouped = groupByPhaseAndGroup(matchList)
        const keys = sortedGroupKeys(grouped)
        setActiveGroup(keys[0])
      }
      const predMap = {}
      for (const p of (pData.predictions || [])) predMap[p.match_id] = { h: p.home_score, a: p.away_score }
      setMyPreds(predMap)
    } catch (e) {
      setToast({ msg: 'Erro ao carregar partidas', type: 'error' })
    } finally { setLoading(false) }
  }, [member.id, setToast])

  useEffect(() => { loadData() }, [loadData])

  const expired = deadline && new Date() > new Date(deadline)

  async function savePrediction(matchId, h, a) {
    if (h === '' || a === '' || isNaN(h) || isNaN(a)) return
    setSaving(s => ({ ...s, [matchId]: true }))
    try {
      const res = await apiFetch('/api/bolao?action=predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: member.id, match_id: matchId, home_score: Number(h), away_score: Number(a) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMyPreds(p => ({ ...p, [matchId]: { h: Number(h), a: Number(a) } }))
    } catch (err) {
      setToast({ msg: err.message, type: 'error' })
    } finally { setSaving(s => ({ ...s, [matchId]: false })) }
  }

  const grouped = groupByPhaseAndGroup(matches)
  const groupKeys = sortedGroupKeys(grouped)

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 12, cursor: 'pointer' }}>← Voltar ao grupo</button>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📝 Meus Palpites</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>Salvo automaticamente · palpites em verde estão registrados</div>

      {expired && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#991B1B', marginBottom: 14, fontWeight: 600 }}>
          🔒 Prazo encerrado — não é possível editar mais palpites.
        </div>
      )}

      {loading ? <Spinner /> : (
        <div>
          <ScrollTabs keys={groupKeys} active={activeGroup} onSelect={setActiveGroup} />
          {activeGroup && (grouped[activeGroup] || []).map(match => {
            const pred = myPreds[match.id] || {}
            const hasPred = pred.h !== undefined
            const isFinished = match.status === 'finished'
            const matchStarted = match.match_date && new Date() > new Date(match.match_date)
            const locked = expired || isFinished || matchStarted
            return (
              <div key={match.id} style={{ background: '#fff', borderRadius: 12, border: '1.5px solid ' + (hasPred ? '#86efac' : '#e5e7eb'), padding: '12px 14px', marginBottom: 10, opacity: isFinished ? 0.7 : 1 }}>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
                  {formatDate(match.match_date)}
                  {match.venue && ' · ' + match.venue.split(',')[0]}
                  {isFinished && <span style={{ color: '#ef4444', marginLeft: 6 }}>● Encerrado</span>}
                  {match.status === 'live' && <span style={{ color: '#f59e0b', marginLeft: 6 }}>● Ao vivo</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <FlagImg team={match.home_team} size={32} />
                    <div style={{ fontWeight: 600, fontSize: 11, color: '#111827', textAlign: 'center', lineHeight: 1.2 }}>{match.home_team}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <input type="number" min={0} max={30}
                      value={pred.h !== undefined ? pred.h : ''} disabled={locked}
                      onChange={e => setMyPreds(p => ({ ...p, [match.id]: { ...(p[match.id] || {}), h: e.target.value } }))}
                      onBlur={e => { const a = myPreds[match.id] && myPreds[match.id].a; if (e.target.value !== '' && a !== undefined && !locked) savePrediction(match.id, e.target.value, a) }}
                      style={{ width: 44, height: 44, textAlign: 'center', fontSize: 20, fontWeight: 700, borderRadius: 8, border: '1.5px solid ' + (hasPred ? '#86efac' : '#d1d5db'), background: hasPred ? '#f0fdf4' : '#f9fafb', outline: 'none' }}
                    />
                    <span style={{ fontSize: 18, color: '#9ca3af', fontWeight: 700 }}>–</span>
                    <input type="number" min={0} max={30}
                      value={pred.a !== undefined ? pred.a : ''} disabled={locked}
                      onChange={e => setMyPreds(p => ({ ...p, [match.id]: { ...(p[match.id] || {}), a: e.target.value } }))}
                      onBlur={e => { const h = myPreds[match.id] && myPreds[match.id].h; if (e.target.value !== '' && h !== undefined && !locked) savePrediction(match.id, h, e.target.value) }}
                      style={{ width: 44, height: 44, textAlign: 'center', fontSize: 20, fontWeight: 700, borderRadius: 8, border: '1.5px solid ' + (hasPred ? '#86efac' : '#d1d5db'), background: hasPred ? '#f0fdf4' : '#f9fafb', outline: 'none' }}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <FlagImg team={match.away_team} size={32} />
                    <div style={{ fontWeight: 600, fontSize: 11, color: '#111827', textAlign: 'center', lineHeight: 1.2 }}>{match.away_team}</div>
                  </div>
                </div>
                {saving[match.id] && <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 6 }}>Salvando…</div>}
                {isFinished && match.home_score !== null && (
                  <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
                    Resultado: {match.home_score} – {match.away_score}
                    {pred.h !== undefined && (() => {
                      const exact = pred.h === match.home_score && pred.a === match.away_score
                      // Mata-mata (phase != group): SÓ placar exato pontua.
                      // Fase de grupos: 3 (exato) / 1 (só vencedor) / 0.
                      const label = match.phase && match.phase !== 'group'
                        ? (exact ? '🎯 +3 pts' : '❌ 0 pts')
                        : (exact ? '🎯 +3 pts' : Math.sign(pred.h - pred.a) === Math.sign(match.home_score - match.away_score) ? '✅ +1 pt' : '❌ 0 pts')
                      return <span style={{ marginLeft: 8, fontWeight: 700, color: GREEN }}>{label}</span>
                    })()}
                  </div>
                )}
              </div>
            )
          })}
          {matches.length === 0 && <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0' }}>Nenhuma partida cadastrada ainda.</div>}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Standings com 3 abas (Grupo / Estado / Nacional)
// ════════════════════════════════════════════════════════════════════════════
function StandingsView({ group, member, onBack, setToast }) {
  const [tab, setTab]                 = useState('group')
  const [season, setSeason]           = useState('fase1') // fase1 = grupos · fase2 = mata-mata
  const [groupStand, setGroupStand]   = useState(null)
  const [stateStand, setStateStand]   = useState(null)
  const [globalStand, setGlobalStand] = useState(null)

  // Trocar de temporada invalida os 3 caches → re-fetch da aba ativa.
  useEffect(() => { setGroupStand(null); setStateStand(null); setGlobalStand(null) }, [season])

  const seasonParam = season === 'fase2' ? '&season=fase2' : ''

  useEffect(() => {
    if (tab === 'group' && !groupStand && group) {
      apiFetch('/api/bolao?action=standings&group_id=' + group.id + seasonParam).then(r => r.json()).then(d => setGroupStand(d.standings || [])).catch(() => setGroupStand([]))
    }
    if (tab === 'state' && !stateStand && member.state) {
      apiFetch('/api/bolao?action=standings-state&state=' + member.state + seasonParam).then(r => r.json()).then(d => setStateStand(d.standings || [])).catch(() => setStateStand([]))
    }
    if (tab === 'global' && !globalStand) {
      apiFetch('/api/bolao?action=standings-global' + seasonParam).then(r => r.json()).then(d => setGlobalStand(d.standings || [])).catch(() => setGlobalStand([]))
    }
  }, [tab, season, seasonParam, group, member, groupStand, stateStand, globalStand])

  const handleShare = async () => {
    const r = await shareNative({ title: 'Ranking do Bolão Copa 2026', text: '🏆 Confere meu ranking no Bolão Copa 2026! https://brasilconnectusa.com' })
    if (r === 'copied') setToast({ msg: 'Link copiado!', type: 'success' })
  }

  const standings = tab === 'group' ? groupStand : tab === 'state' ? stateStand : globalStand
  const loading = standings === null

  const tabConfig = [
    { id: 'group',  label: '👥 Meu Grupo',                       sub: group?.name },
    { id: 'state',  label: '🇺🇸 ' + (member.state || 'Estado'),   sub: stateName(member.state) },
    { id: 'global', label: '🌎 Nacional',                         sub: 'Todos os brasileiros nos USA' },
  ]

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 12, cursor: 'pointer' }}>← Voltar ao grupo</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>🏆 Rankings</div>
        <button onClick={handleShare} style={{ background: 'transparent', border: '1px solid ' + GREEN, color: GREEN, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📤 Compartilhar</button>
      </div>

      {/* Toggle de temporada: Fase de Grupos x Mata-mata (disputas separadas) */}
      <div style={{ display: 'flex', gap: 4, background: '#eef2ff', borderRadius: 10, padding: 3, marginBottom: 10 }}>
        {[{ id: 'fase1', label: '⚽ Fase de Grupos' }, { id: 'fase2', label: '🔥 Mata-mata' }].map(s => (
          <button key={s.id} onClick={() => setSeason(s.id)} style={{ flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: season === s.id ? '#fff' : 'transparent', color: season === s.id ? BLUE : '#6b7280', border: 'none', cursor: 'pointer', boxShadow: season === s.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {tabConfig.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: tab === t.id ? '#fff' : 'transparent', color: tab === t.id ? '#111827' : '#6b7280', border: 'none', cursor: 'pointer', boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12, textAlign: 'center' }}>
        {tabConfig.find(t => t.id === tab)?.sub} · {season === 'fase2' ? 'mata-mata: só placar exato vale (3 pts)' : 'pontos baseados em jogos encerrados'}
      </div>

      {loading ? <Spinner /> : standings.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 16px' }}>
          {tab === 'group' && 'Nenhum jogo encerrado ainda neste grupo.'}
          {tab === 'state' && 'Nenhum participante do seu estado ainda. Compartilhe e chame mais brasileiros!'}
          {tab === 'global' && 'Nenhum jogo encerrado ainda nacionalmente.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {standings.map((s, i) => {
            const medals = ['🥇', '🥈', '🥉']
            const isMe = s.member_id === member.id
            return (
              <div key={s.member_id} style={{ background: isMe ? '#f0fdf4' : '#fff', border: '1.5px solid ' + (isMe ? '#86efac' : '#e5e7eb'), borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 20, width: 30, textAlign: 'center', flexShrink: 0, fontWeight: 700, color: i < 3 ? undefined : '#9ca3af' }}>{medals[i] || (i + 1) + 'º'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: s.nickname ? undefined : '#9ca3af', fontStyle: s.nickname ? undefined : 'italic' }}>
                      {s.nickname || (isMe ? 'Você' : 'Participante ' + (i + 1) + 'º')}
                    </span>
                    {isMe && s.nickname && <span style={{ color: GREEN, fontSize: 10, fontWeight: 700 }}>(você)</span>}
                    {tab !== 'group' && s.state && <span style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>{s.state}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                    🎯 {s.exact} exatos · ✅ {s.correct} acertos · {s.played} palpites
                    {tab === 'global' && s.group_name && ' · ' + s.group_name}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: i === 0 ? '#f59e0b' : isMe ? GREEN : '#374151' }}>{s.total_pts}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>pts</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   APP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
// Estados onde o Bolão é bloqueado por regulação local (gambling laws estritas)
const BOLAO_BLOCKED_STATES = new Set(['HI', 'UT', 'WA'])

export default function BolaoScreen() {
  // Lê ?join=ABC123 da URL — convite via /bolao/<código> joga aqui
  const initialJoinCode = (() => {
    if (typeof window === 'undefined') return ''
    try {
      const c = new URLSearchParams(window.location.search).get('join') || ''
      return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    } catch (_) { return '' }
  })()

  const [view,    setView]    = useState(initialJoinCode ? 'join' : 'home')
  const [joinCode]            = useState(initialJoinCode)
  const [group,   setGroup]   = useState(null)
  const [member,  setMember]  = useState(null)
  const [toast,   setToast]   = useState(null)
  const [config,  setConfig]  = useState(null)
  const [memberships, setMemberships] = useState(() => loadMemberships())
  const { user: authUser } = useAuth()
  const [lastSyncedUserId, setLastSyncedUserId] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [acceptingTerms, setAcceptingTerms] = useState(false)

  // Carrega profile pra checar state + aceite dos termos
  useEffect(() => {
    if (!authUser?.id) { setProfile(null); setProfileLoaded(true); return }
    apiFetch('/api/profile').then(r => r.json()).then(d => {
      setProfile(d.profile || {})
      setProfileLoaded(true)
    }).catch(() => { setProfile({}); setProfileLoaded(true) })
  }, [authUser?.id])

  async function handleAcceptTerms() {
    setAcceptingTerms(true)
    try {
      const r = await apiFetch('/api/profile?action=accept-bolao-terms', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!r.ok) throw new Error()
      const d = await r.json()
      setProfile(d.profile || profile)
    } catch (e) {
      setToast({ msg: 'Erro ao registrar aceite. Tenta de novo.', type: 'error' })
    } finally {
      setAcceptingTerms(false)
    }
  }

  // Prefill do CreateGroupView/JoinGroupView quando user esta logado:
  //  - email vem do Supabase user (lockado — admin_email tem que casar)
  //  - username/display_name vem do profile (pra opcao "usar @username")
  //  - full_name, state, whatsapp vem da membership mais recente (cache local
  //    populado por my-memberships no login). Membros mais novos primeiro.
  const createPrefill = useMemo(() => {
    if (!authUser?.email) return null
    const latest = (memberships || []).find(m => m.email?.toLowerCase() === authUser.email.toLowerCase()) || memberships?.[0]
    return {
      email:        authUser.email,
      full_name:    profile?.full_name || latest?.full_name || '',
      username:     profile?.username || null,
      display_name: profile?.display_name || null,
      state:        profile?.state || latest?.state || '',
      whatsapp:     profile?.whatsapp || latest?.whatsapp || '',
      locked_email: true,
    }
  }, [authUser, memberships, profile])

  useEffect(() => {
    apiFetch('/api/bolao?action=config').then(r => r.json()).then(d => setConfig(d.config || {})).catch(() => setConfig({}))
  }, [])

  // ─── Sync com Supabase auth ────────────────────────────────────────────
  // Login:  busca memberships do servidor (auto-link de antigos anonimos por
  //         email) e substitui o localStorage. Faz cross-device funcionar.
  // Logout: limpa o localStorage pra outra pessoa no mesmo navegador nao
  //         ver os boloes do user anterior.
  useEffect(() => {
    if (authUser?.id) {
      if (authUser.id === lastSyncedUserId) return  // ja sincronizado
      ;(async () => {
        try {
          const res = await apiFetch('/api/bolao?action=my-memberships', {
            headers: { ...(await getAuthHeader()) },
          })
          if (!res.ok) return
          const data = await res.json()
          replaceMemberships(data.memberships || [])
          setMemberships(loadMemberships())
          setLastSyncedUserId(authUser.id)
          // Se ja estamos numa view de grupo mas o member nao esta mais na
          // lista (ex: trocou de conta), volta pra home
          const active = getActiveMembership()
          if (view === 'group' && member && !active) {
            setGroup(null); setMember(null); setView('home')
          }
        } catch (e) {
          console.error('bolao sync error:', e.message)
        }
      })()
    } else if (lastSyncedUserId) {
      // Logout — limpa tudo. lastSyncedUserId teve valor antes, agora user e null
      clearAllMemberships()
      setMemberships([])
      setGroup(null); setMember(null); setView('home')
      setLastSyncedUserId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id])

  function loadGroupForMembership(m, { silent = false } = {}) {
    apiFetch('/api/bolao?action=group&code=' + m.join_code).then(r => r.json()).then(d => {
      if (d.group) {
        setGroup(d.group)
        const me = (d.members || []).find(x => x.id === m.member_id)
        if (me) {
          const fullMe = { ...me, state: m.state || me.state }
          setMember(fullMe)
          setView('group')
        } else if (!silent) {
          setToast({ msg: 'Você não consta mais como membro desse bolão.', type: 'error' })
          removeMembership(m.member_id)
          setMemberships(loadMemberships())
        }
      }
    }).catch(() => { if (!silent) setToast({ msg: 'Erro ao carregar grupo.', type: 'error' }) })
  }

  useEffect(() => {
    // Se tem deep-link de convite, ignora sessão e força tela de join
    if (initialJoinCode) return
    const active = getActiveMembership()
    if (active) loadGroupForMembership(active, { silent: true })
  }, [initialJoinCode])

  function refreshGroup() {
    if (!group) return
    apiFetch('/api/bolao?action=group&code=' + group.join_code).then(r => r.json()).then(d => { if (d.group) setGroup(d.group) }).catch(() => {})
  }

  function handleCreated(g, m) {
    setMemberships(loadMemberships())
    setGroup(g); setMember(m); setView('created-success')
  }

  function handleJoined(g, m) {
    setMemberships(loadMemberships())
    setGroup(g); setMember(m); setView('group')
  }

  function handlePickMembership(m) {
    localStorage.setItem(ACTIVE_KEY, m.member_id)
    loadGroupForMembership(m)
  }

  function handleSwitch() {
    // Mantém a membership salva, só sai da view ativa
    setGroup(null); setMember(null); setView('home')
  }

  function handleLeave() {
    if (member?.id) {
      removeMembership(member.id)
      setMemberships(loadMemberships())
    }
    setGroup(null); setMember(null); setView('home')
  }

  // ─── Gate legal: bloqueio por estado + aceite dos termos ────────────────
  // Só aplica pra usuario logado e profile carregado (anonimos veem o bolao
  // normalmente — o aceite vem quando entram pra criar/joinar).
  if (authUser && profileLoaded) {
    if (profile?.state && BOLAO_BLOCKED_STATES.has(profile.state)) {
      return <BolaoBlockedView state={profile.state} />
    }
    if (!profile?.bolao_terms_accepted_at) {
      return <BolaoConsentView profile={profile} loading={acceptingTerms} onAccept={handleAcceptTerms} authUser={authUser} />
    }
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      <BolaoLegalBanner />
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {view === 'home'      && <HomeView onCreateClick={() => setView('create')} onJoinClick={() => setView('join')} config={config} setToast={setToast} memberships={memberships} onPickMembership={handlePickMembership} />}
      {view === 'create'    && <CreateGroupView onBack={() => setView('home')} onCreated={handleCreated} setToast={setToast} prefill={createPrefill} />}
      {view === 'created-success' && <CreatedSuccessView group={group} onContinue={() => setView('group')} setToast={setToast} />}
      {view === 'join'      && <JoinGroupView onBack={() => setView('home')} onJoined={handleJoined} setToast={setToast} prefilledCode={joinCode} prefill={createPrefill} />}
      {view === 'group'     && <GroupDashboard group={group} member={member} onPredict={() => setView('predict')} onStandings={() => setView('standings')} onLeave={handleLeave} onSwitch={handleSwitch} setToast={setToast} refreshGroup={refreshGroup} deadline={config?.predictions_deadline} />}
      {view === 'predict'   && <PredictionsView member={member} onBack={() => setView('group')} setToast={setToast} deadline={config?.predictions_deadline} />}
      {view === 'standings' && <StandingsView group={group} member={member} onBack={() => setView('group')} setToast={setToast} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Componentes de compliance legal
// ════════════════════════════════════════════════════════════════════════════

function BolaoLegalBanner() {
  return (
    <div style={{
      background: '#FEF3C7', border: '1px solid #FBBF24', borderRadius: 8,
      padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#78350F',
      display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.4,
    }}>
      <span style={{ fontSize: 14 }}>🎯</span>
      <span style={{ flex: 1 }}>
        Bolão grátis de habilidade (predição). Não é casino. Plataforma não aceita apostas nem repassa dinheiro. <a href="/termos#bolao" target="_blank" style={{ color: '#78350F', textDecoration: 'underline', fontWeight: 600 }}>Saiba mais →</a>
      </span>
    </div>
  )
}

function BolaoBlockedView({ state }) {
  const STATE_NAMES = { HI: 'Hawaii', UT: 'Utah', WA: 'Washington' }
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
      padding: 40, textAlign: 'center', maxWidth: 480, margin: '32px auto',
      fontFamily: "'Sora', -apple-system, sans-serif",
    }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
      <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 24, fontWeight: 600, margin: '0 0 12px', color: '#1a1a1a' }}>
        Bolão indisponível no seu estado
      </h2>
      <p style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.6, margin: '0 0 18px' }}>
        Por regulação local de <b>{STATE_NAMES[state] || state}</b>, o BrasilConnect não oferece o Bolão pra residentes desse estado.
      </p>
      <p style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.6, margin: '0 0 24px' }}>
        Você ainda pode usar todos os outros recursos do app — Feed, Comunidades, Marketplace, Câmbio, Voos e Negócios.
      </p>
      <a href="/app/feed" style={{
        display: 'inline-block', background: '#009C3B', color: '#fff',
        padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
        textDecoration: 'none',
      }}>← Voltar pro Feed</a>
    </div>
  )
}

function BolaoConsentView({ profile, loading, onAccept, authUser }) {
  const [checked, setChecked] = useState(false)
  const stateMissing = !profile?.state
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
      padding: 28, maxWidth: 560, margin: '24px auto',
      fontFamily: "'Sora', -apple-system, sans-serif",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#92400E',
        textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8,
      }}>Antes de começar</div>
      <h2 style={{
        fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 26, fontWeight: 600,
        margin: '0 0 16px', color: '#1a1a1a', lineHeight: 1.2,
      }}>Termos do Bolão BrasilConnect</h2>

      <ul style={{ paddingLeft: 18, margin: '0 0 18px', color: '#374151', fontSize: 14, lineHeight: 1.7 }}>
        <li>O Bolão é um <b>jogo de habilidade</b> (predição esportiva) <b>gratuito</b>.</li>
        <li>A BrasilConnect <b>não aceita apostas nem repassa dinheiro</b>. Qualquer prêmio é combinação entre você e os outros participantes do seu grupo.</li>
        <li>Indisponível pra residentes de <b>Hawaii, Utah e Washington</b> (regulação local).</li>
        <li>Você confirma ter <b>18 anos ou mais</b>.</li>
        <li>Você é responsável por cumprir as leis do seu estado.</li>
        <li>Se sentir que tem problema com jogo, ligue <a href="tel:1-800-426-2537" style={{ color: '#009C3B', fontWeight: 600 }}>1-800-GAMBLER</a>.</li>
      </ul>

      {stateMissing && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #FBBF24', borderRadius: 8,
          padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#78350F',
        }}>
          ⚠️ Você ainda não definiu seu estado. <a href="/app/settings" style={{ color: '#78350F', textDecoration: 'underline', fontWeight: 600 }}>Configure em Settings</a> antes de continuar.
        </div>
      )}

      <label style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: 12, background: '#F0FDF4', border: '1px solid #BBF7D0',
        borderRadius: 8, cursor: 'pointer', marginBottom: 16,
      }}>
        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
          style={{ marginTop: 2, accentColor: '#009C3B' }} />
        <span style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>
          Confirmo que tenho <b>18 anos ou mais</b>, li os termos acima e concordo. Entendo que a BrasilConnect não repassa dinheiro nem cobra comissão.
        </span>
      </label>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onAccept} disabled={!checked || loading || stateMissing} style={{
          flex: 1, background: '#009C3B', color: '#fff', border: 'none',
          padding: '12px 20px', borderRadius: 8, fontSize: 14, fontWeight: 700,
          cursor: (!checked || loading || stateMissing) ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: (!checked || loading || stateMissing) ? 0.5 : 1,
        }}>{loading ? 'Salvando…' : 'Continuar pro Bolão →'}</button>
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: '#9CA3AF', textAlign: 'center' }}>
        <a href="/termos#bolao" target="_blank" style={{ color: '#9CA3AF', textDecoration: 'underline' }}>
          Termos completos
        </a>
        {' · '}
        <a href="/privacidade" target="_blank" style={{ color: '#9CA3AF', textDecoration: 'underline' }}>
          Política de privacidade
        </a>
      </div>
    </div>
  )
}
