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
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>En