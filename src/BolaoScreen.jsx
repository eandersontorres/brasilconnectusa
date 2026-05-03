import { useState, useEffect, useCallback, useMemo } from 'react'

// ── Paleta editorial ──────────────────────────────────────────────────────
const GREEN  = '#009c3b'   // Verde floresta
const BLUE   = '#002776'   // Navy quase preto
const YELLOW = '#ffdf00'   // Dourado claro (substitui o amarelo brilhante)
const GOLD   = '#FFD700'   // Dourado quente (acentos)
const NAVY_LIGHT = '#1e3a5f'
const CREAM  = '#FAF7F0'

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
  const map = { group: 'Fase de Grupos', r32: 'Oitavas', r16: 'Oitavas de Final', qf: 'Quartas de Final', sf: 'Semifinal', final: 'Final' }
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
function HomeView({ onCreateClick, onJoinClick, config, setToast }) {
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
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>Você é o admin · escolhe a premiação</div>
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
          ['🎁', 'Cada admin define a premiação do próprio grupo'],
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
//   View: Criar Grupo (com cadastro completo)
// ════════════════════════════════════════════════════════════════════════════
function CreateGroupView({ onBack, onCreated, setToast }) {
  const [name, setName]       = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail]     = useState('')
  const [state, setState]     = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate(e) {
    e.preventDefault()
    if (!name || !email || !fullName || !state) return
    setLoading(true)
    try {
      const res = await fetch('/api/bolao?action=create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          admin_email: email.trim(),
          admin_full_name: fullName.trim(),
          admin_state: state,
          admin_whatsapp: whatsapp.trim() || null,
          admin_nickname: fullName.trim().split(' ')[0],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      localStorage.setItem('bolao_member_id', data.member.id)
      localStorage.setItem('bolao_group_id', data.group.id)
      onCreated(data.group, data.member)
    } catch (err) {
      setToast({ msg: err.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const valid = name && email && fullName && state

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
        ← Voltar
      </button>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Criar bolão ⚽</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Você vira o admin: define a premiação e recebe um código de convite.
      </div>
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label="Nome do bolão" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Bolão da TorresBee" required />
        <Input label="Seu nome completo" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="João Silva" required />
        <Input label="Seu e-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com" required hint="Usado para login admin e notificações" />
        <StateSelect value={state} onChange={setState} required />
        <Input label="WhatsApp (opcional)" type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 (555) 555-5555" hint="Para o admin te avisar do prêmio" />
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
function JoinGroupView({ onBack, onJoined, setToast, prefilledCode }) {
  const [code, setCode]         = useState(prefilledCode || '')
  const [nickname, setNickname] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail]       = useState('')
  const [state, setState]       = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleJoin(e) {
    e.preventDefault()
    if (!code || !nickname || !email || !fullName || !state) return
    setLoading(true)
    try {
      const res = await fetch('/api/bolao?action=join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.toUpperCase().trim(),
          nickname: nickname.trim(),
          email: email.trim(),
          full_name: fullName.trim(),
          state,
          whatsapp: whatsapp.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      localStorage.setItem('bolao_member_id', data.member.id)
      localStorage.setItem('bolao_group_id', data.group.id)
      onJoined(data.group, data.member)
    } catch (err) {
      setToast({ msg: err.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const valid = code && nickname && email && fullName && state

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
        ← Voltar
      </button>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Entrar no bolão 🔗</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Digite o código e seus dados completos.
      </div>
      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <Input label="Seu nome completo" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="João Silva" required />
        <Input label="Apelido no ranking" type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Ex: João" required hint="Como vai aparecer pros outros" />
        <Input label="Seu e-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com" required />
        <StateSelect value={state} onChange={setState} required />
        <Input label="WhatsApp (opcional)" type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 (555) 555-5555" />
        <Btn type="submit" disabled={loading || !valid}>
          {loading ? 'Entrando…' : 'Entrar no grupo →'}
        </Btn>
      </form>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: Premiação (modal/edit)
// ════════════════════════════════════════════════════════════════════════════
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
      const res = await fetch('/api/bolao?action=update-prize', {
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
      setToast({ msg: 'Premiação salva!', type: 'success' })
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
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>🏆 Editar Premiação</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>Visível para todos os membros do grupo</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Título da premiação" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Pizza pro vencedor!" />
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>Descrição / regras</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
              placeholder="Ex: Quem fizer mais pontos ganha uma pizza família e uma cerveja."
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 14, outline: 'none', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Posições (opcional)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input label="🥇 1º lugar" value={first} onChange={e => setFirst(e.target.value)} placeholder="Ex: Pizza família + cerveja" />
              <Input label="🥈 2º lugar" value={second} onChange={e => setSecond(e.target.value)} placeholder="Ex: Hamburguer" />
              <Input label="🥉 3º lugar" value={third} onChange={e => setThird(e.target.value)} placeholder="Ex: Refrigerante" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Btn outline color="#6b7280" onClick={onClose} type="button" style={{ flex: 1 }}>Cancelar</Btn>
            <Btn onClick={handleSave} disabled={saving} type="button" style={{ flex: 2 }}>{saving ? 'Salvando…' : 'Salvar premiação'}</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   View: GroupDashboard
// ════════════════════════════════════════════════════════════════════════════
function GroupDashboard({ group, member, onPredict, onStandings, onLeave, setToast, refreshGroup, deadline }) {
  const [members, setMembers] = useState([])
  const [editPrize, setEditPrize] = useState(false)
  const [adminEmailLocal] = useState(() => localStorage.getItem('bolao_admin_email') || '')
  const isAdmin = !!adminEmailLocal

  useEffect(() => {
    if (!group) return
    fetch('/api/bolao?action=group&code=' + group.join_code)
      .then(r => r.json())
      .then(d => { if (d.members) setMembers(d.members) })
      .catch(() => {})
  }, [group])

  const shareText = '🏆 Participe do nosso bolão da Copa 2026!\nGrupo: ' + group.name + '\nCódigo: *' + group.join_code + '*\n\nEntra aqui: https://brasilconnectusa.com'

  const handleShare = async () => {
    const r = await shareNative({ title: 'Bolão Copa 2026', text: shareText })
    if (r === 'copied') setToast({ msg: 'Link copiado!', type: 'success' })
  }

  const deadlineDate = deadline ? new Date(deadline) : null
  const expired = deadlineDate && new Date() > deadlineDate
  const hasPrize = group.prize_title || group.prize_description || group.prize_first

  return (
    <div style={{ padding: '0 0 16px' }}>
      {editPrize && <PrizeEditor group={group} onClose={() => setEditPrize(false)} onSaved={() => refreshGroup()} setToast={setToast} adminEmail={adminEmailLocal} />}

      <div style={{ background: 'linear-gradient(135deg, ' + GREEN + ' 0%, #006428 100%)', borderRadius: 14, padding: '18px 16px', marginBottom: 14, color: '#fff' }}>
        <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>⚽ Seu bolão</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{group.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 14px', fontSize: 18, fontWeight: 800, letterSpacing: 4 }}>{group.join_code}</div>
          <button onClick={handleShare} style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📤 Convidar</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>
          {member.nickname} {isAdmin && '· 👑 Admin'} · {members.length} participante{members.length !== 1 ? 's' : ''}
        </div>
      </div>

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
          <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>🏆</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Premiação</div>
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
                {isAdmin ? 'Defina a premiação do seu grupo abaixo 👇' : 'Aguardando o admin definir a premiação…'}
              </div>
            )}
          </div>
        </div>
        {isAdmin && (
          <button onClick={() => setEditPrize(true)} style={{ marginTop: 10, width: '100%', background: 'transparent', border: '1px solid ' + GOLD, color: '#8C6D3D', borderRadius: 8, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ✏️ {hasPrize ? 'Editar premiação' : 'Definir premiação'}
          </button>
        )}
      </div>

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

      {members.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Participantes ({members.length})</div>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            {members.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < members.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: m.id === member.id ? GREEN : '#e5e7eb', color: m.id === member.id ? '#fff' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{m.nickname.charAt(0).toUpperCase()}</div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: m.id === member.id ? 700 : 400 }}>{m.nickname}{m.id === member.id && <span style={{ color: GREEN, fontSize: 11 }}> (você)</span>}</span>
                {m.state && <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{m.state}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={onLeave} style={{ background: 'none', border: 'none', fontSize: 12, color: '#9ca3af', cursor: 'pointer', display: 'block', width: '100%', textAlign: 'center', padding: 8 }}>
        Sair do grupo / trocar de bolão
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
        fetch('/api/bolao?action=matches'),
        fetch('/api/bolao?action=my-predictions&member_id=' + member.id),
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
      const res = await fetch('/api/bolao?action=predict', {
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
                    {pred.h !== undefined && (
                      <span style={{ marginLeft: 8, fontWeight: 700, color: GREEN }}>
                        {pred.h === match.home_score && pred.a === match.away_score ? '🎯 +3 pts' : Math.sign(pred.h - pred.a) === Math.sign(match.home_score - match.away_score) ? '✅ +1 pt' : '❌ 0 pts'}
                      </span>
                    )}
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
  const [groupStand, setGroupStand]   = useState(null)
  const [stateStand, setStateStand]   = useState(null)
  const [globalStand, setGlobalStand] = useState(null)

  useEffect(() => {
    if (tab === 'group' && !groupStand && group) {
      fetch('/api/bolao?action=standings&group_id=' + group.id).then(r => r.json()).then(d => setGroupStand(d.standings || [])).catch(() => setGroupStand([]))
    }
    if (tab === 'state' && !stateStand && member.state) {
      fetch('/api/bolao?action=standings-state&state=' + member.state).then(r => r.json()).then(d => setStateStand(d.standings || [])).catch(() => setStateStand([]))
    }
    if (tab === 'global' && !globalStand) {
      fetch('/api/bolao?action=standings-global').then(r => r.json()).then(d => setGlobalStand(d.standings || [])).catch(() => setGlobalStand([]))
    }
  }, [tab, group, member, groupStand, stateStand, globalStand])

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

      <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {tabConfig.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: tab === t.id ? '#fff' : 'transparent', color: tab === t.id ? '#111827' : '#6b7280', border: 'none', cursor: 'pointer', boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12, textAlign: 'center' }}>
        {tabConfig.find(t => t.id === tab)?.sub} · pontos baseados em jogos encerrados
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
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nickname}</span>
                    {isMe && <span style={{ color: GREEN, fontSize: 10, fontWeight: 700 }}>(você)</span>}
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
export default function BolaoScreen() {
  const [view,    setView]    = useState('home')
  const [group,   setGroup]   = useState(null)
  const [member,  setMember]  = useState(null)
  const [toast,   setToast]   = useState(null)
  const [config,  setConfig]  = useState(null)

  useEffect(() => {
    fetch('/api/bolao?action=config').then(r => r.json()).then(d => setConfig(d.config || {})).catch(() => setConfig({}))
  }, [])

  useEffect(() => {
    const mid  = localStorage.getItem('bolao_member_id')
    const code = localStorage.getItem('bolao_join_code')
    if (!mid || !code) return
    fetch('/api/bolao?action=group&code=' + code).then(r => r.json()).then(d => {
      if (d.group) {
        setGroup(d.group)
        const me = (d.members || []).find(m => m.id === mid)
        if (me) {
          const fullMe = { ...me, state: localStorage.getItem('bolao_member_state') || me.state }
          setMember(fullMe)
          setView('group')
        }
      }
    }).catch(() => {})
  }, [])

  function refreshGroup() {
    if (!group) return
    fetch('/api/bolao?action=group&code=' + group.join_code).then(r => r.json()).then(d => { if (d.group) setGroup(d.group) }).catch(() => {})
  }

  function handleCreated(g, m) {
    localStorage.setItem('bolao_join_code', g.join_code)
    localStorage.setItem('bolao_member_id', m.id)
    localStorage.setItem('bolao_admin_email', m.email || '')
    localStorage.setItem('bolao_member_state', m.state || '')
    setGroup(g); setMember(m); setView('group')
  }

  function handleJoined(g, m) {
    localStorage.setItem('bolao_join_code', g.join_code)
    localStorage.setItem('bolao_member_id', m.id)
    localStorage.setItem('bolao_member_state', m.state || '')
    localStorage.removeItem('bolao_admin_email')
    setGroup(g); setMember(m); setView('group')
  }

  function handleLeave() {
    ['bolao_member_id','bolao_group_id','bolao_join_code','bolao_admin_email','bolao_member_state'].forEach(k => localStorage.removeItem(k))
    setGroup(null); setMember(null); setView('home')
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {view === 'home'      && <HomeView onCreateClick={() => setView('create')} onJoinClick={() => setView('join')} config={config} setToast={setToast} />}
      {view === 'create'    && <CreateGroupView onBack={() => setView('home')} onCreated={handleCreated} setToast={setToast} />}
      {view === 'join'      && <JoinGroupView onBack={() => setView('home')} onJoined={handleJoined} setToast={setToast} />}
      {view === 'group'     && <GroupDashboard group={group} member={member} onPredict={() => setView('predict')} onStandings={() => setView('standings')} onLeave={handleLeave} setToast={setToast} refreshGroup={refreshGroup} deadline={config?.predictions_deadline} />}
      {view === 'predict'   && <PredictionsView member={member} onBack={() => setView('group')} setToast={setToast} deadline={config?.predictions_deadline} />}
      {view === 'standings' && <StandingsView group={group} member={member} onBack={() => setView('group')} setToast={setToast} />}
    </div>
  )
}
