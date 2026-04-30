import { useState, useEffect, useCallback } from 'react'

// ─── Helpers ────────────────────────────────────────────────────────────────

const GREEN  = '#009c3b'
const BLUE   = '#002776'
const YELLOW = '#ffdf00'

// ─── Bandeiras por seleção ──────────────────────────────────────────────────
const FLAGS = {
  // Grupo A
  'México': '🇲🇽', 'África do Sul': '🇿🇦', 'Coreia do Sul': '🇰🇷', 'Rep. Tcheca': '🇨🇿',
  // Grupo B
  'Canadá': '🇨🇦', 'Bósnia': '🇧🇦', 'Qatar': '🇶🇦', 'Suíça': '🇨🇭',
  // Grupo C
  'Brasil': '🇧🇷', 'Marrocos': '🇲🇦', 'Haiti': '🇭🇹', 'Escócia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  // Grupo D
  'EUA': '🇺🇸', 'Paraguai': '🇵🇾', 'Austrália': '🇦🇺', 'Turquia': '🇹🇷',
  // Grupo E
  'Alemanha': '🇩🇪', 'Curaçau': '🇨🇼', 'Costa do Marfim': '🇨🇮', 'Equador': '🇪🇨',
  // Grupo F
  'Holanda': '🇳🇱', 'Japão': '🇯🇵', 'Suécia': '🇸🇪', 'Tunísia': '🇹🇳',
  // Grupo G
  'Bélgica': '🇧🇪', 'Egito': '🇪🇬', 'Irã': '🇮🇷', 'Nova Zelândia': '🇳🇿',
  // Grupo H
  'Espanha': '🇪🇸', 'Cabo Verde': '🇨🇻', 'Arábia Saudita': '🇸🇦', 'Uruguai': '🇺🇾',
  // Grupo I
  'França': '🇫🇷', 'Senegal': '🇸🇳', 'Iraque': '🇮🇶', 'Noruega': '🇳🇴',
  // Grupo J
  'Argentina': '🇦🇷', 'Argélia': '🇩🇿', 'Áustria': '🇦🇹', 'Jordânia': '🇯🇴',
  // Grupo K
  'Portugal': '🇵🇹', 'Rep. Congo': '🇨🇩', 'Uzbequistão': '🇺🇿', 'Colômbia': '🇨🇴',
  // Grupo L
  'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Croácia': '🇭🇷', 'Gana': '🇬🇭', 'Panamá': '🇵🇦',
}

function flag(team) { return FLAGS[team] ? `${FLAGS[team]} ` : '' }

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <div style={{
        width: 28, height: 28, border: '3px solid #e5e7eb',
        borderTopColor: GREEN, borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const colors = { success: '#dcfce7', error: '#fee2e2', info: '#dbeafe' }
  const borders = { success: '#86efac', error: '#fca5a5', info: '#93c5fd' }
  const icons   = { success: '✅', error: '❌', info: 'ℹ️' }
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: colors[type], border: `1px solid ${borders[type]}`,
      borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
      maxWidth: 'calc(100vw - 32px)',
    }}>
      {icons[type]} {msg}
    </div>
  )
}

function Input({ label, ...props }) {
  return (
    <div>
      {label && (
        <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
          {label}
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
        border: outline ? `2px solid ${color}` : 'none',
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

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']
const PHASE_ORDER = ['group','r32','r16','qf','sf','final']

function groupByPhaseAndGroup(matches) {
  const phases = {}
  for (const m of matches) {
    const key = m.phase === 'group' ? `Grupo ${m.group_name}` : phaseLabel(m.phase)
    if (!phases[key]) phases[key] = []
    phases[key].push(m)
  }
  return phases
}

function sortedGroupKeys(grouped) {
  return Object.keys(grouped).sort((a, b) => {
    // Fase de grupos: ordenar A-L
    const aIsGroup = a.startsWith('Grupo ')
    const bIsGroup = b.startsWith('Grupo ')
    if (aIsGroup && bIsGroup) {
      const ai = GROUP_ORDER.indexOf(a.replace('Grupo ', ''))
      const bi = GROUP_ORDER.indexOf(b.replace('Grupo ', ''))
      return ai - bi
    }
    // Fases eliminatórias depois dos grupos
    if (aIsGroup) return -1
    if (bIsGroup) return 1
    return 0
  })
}

function phaseLabel(phase) {
  const map = { group: 'Fase de Grupos', r32: 'Oitavas', r16: 'Oitavas de Final', qf: 'Quartas de Final', sf: 'Semifinal', final: 'Final' }
  return map[phase] || phase
}

// ─── View: Home ──────────────────────────────────────────────────────────────

function HomeView({ onCreateClick, onJoinClick }) {
  return (
    <div style={{ padding: '0 0 16px' }}>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BLUE} 0%, #1e3a5f 100%)`,
        borderRadius: 14, padding: '24px 18px', marginBottom: 20, color: '#fff',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚽</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          Bolão Copa 2026
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
          A Copa é aqui nos EUA! Monte seu bolão,<br />
          dispute com amigos e torça pelo Brasil. 🇧🇷
        </div>
        <div style={{
          marginTop: 14, display: 'inline-block',
          background: YELLOW, color: '#000',
          fontSize: 11, fontWeight: 700, padding: '4px 12px',
          borderRadius: 20,
        }}>
          🏆 EUA • Canadá • México — Junho 2026
        </div>
      </div>

      {/* Opções */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={onCreateClick}
          style={{
            background: GREEN, color: '#fff', border: 'none',
            borderRadius: 12, padding: '18px 16px', textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>➕</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Criar meu bolão</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
            Gere um link de convite e chame os amigos
          </div>
        </button>

        <button
          onClick={onJoinClick}
          style={{
            background: '#fff', color: BLUE, border: `2px solid ${BLUE}`,
            borderRadius: 12, padding: '18px 16px', textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>🔗</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Entrar num bolão</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            Tenho o código de convite de um grupo
          </div>
        </button>
      </div>

      {/* Info */}
      <div style={{
        marginTop: 20, background: '#f0fdf4', borderRadius: 12,
        padding: '14px 16px', border: '1px solid #bbf7d0',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: GREEN, marginBottom: 8 }}>
          Como funciona o bolão
        </div>
        {[
          ['⚽', 'Placar exato: 3 pontos'],
          ['✅', 'Acertou o vencedor ou empate: 1 ponto'],
          ['🏆', 'Quem fizer mais pontos no fim ganha!'],
        ].map(([icon, text]) => (
          <div key={text} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 14 }}>{icon}</span>
            <span style={{ fontSize: 13, color: '#374151' }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── View: Criar Grupo ────────────────────────────────────────────────────────

function CreateGroupView({ onBack, onCreated, setToast }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate(e) {
    e.preventDefault()
    if (!name || !email) return
    setLoading(true)
    try {
      const res = await fetch('/api/bolao?action=create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), admin_email: email.trim() }),
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

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
        ← Voltar
      </button>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Criar bolão ⚽</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Você receberá um código de convite para compartilhar.
      </div>
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Nome do bolão" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Bolão do Trabalho" required />
        <Input label="Seu e-mail (para resultados)" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com" required />
        <Btn type="submit" disabled={loading || !name || !email}>
          {loading ? 'Criando…' : 'Criar bolão →'}
        </Btn>
      </form>
    </div>
  )
}

// ─── View: Entrar no Grupo ─────────────────────────────────────────────────────

function JoinGroupView({ onBack, onJoined, setToast }) {
  const [code, setCode]         = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleJoin(e) {
    e.preventDefault()
    if (!code || !nickname) return
    setLoading(true)
    try {
      const res = await fetch('/api/bolao?action=join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase().trim(), nickname: nickname.trim(), email }),
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

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
        ← Voltar
      </button>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Entrar no bolão 🔗</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Digite o código que você recebeu do organizador.
      </div>
      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
            Código de convite
          </label>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXXX"
            maxLength={6}
            required
            style={{
              width: '100%', padding: '14px', borderRadius: 10,
              border: '1.5px solid #e5e7eb', fontSize: 24, fontWeight: 800,
              letterSpacing: 6, textAlign: 'center', outline: 'none',
              background: '#fff', boxSizing: 'border-box',
            }}
          />
        </div>
        <Input label="Seu apelido" type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Ex: Anderson" required />
        <Input label="Seu e-mail (opcional)" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com" />
        <Btn type="submit" disabled={loading || !code || !nickname}>
          {loading ? 'Entrando…' : 'Entrar no grupo →'}
        </Btn>
      </form>
    </div>
  )
}

// ─── View: Grupo Dashboard ─────────────────────────────────────────────────────

function GroupDashboard({ group, member, onPredict, onStandings, onLeave }) {
  const [members, setMembers] = useState([])

  useEffect(() => {
    if (!group) return
    fetch(`/api/bolao?action=group&code=${group.join_code}`)
      .then(r => r.json())
      .then(d => { if (d.members) setMembers(d.members) })
      .catch(() => {})
  }, [group])

  const shareText = `Participe do nosso bolão da Copa 2026!\nCódigo: *${group?.join_code}*\n🇧🇷 BrasilConnect: https://brasilconnectusa.com`

  return (
    <div style={{ padding: '0 0 16px' }}>
      {/* Header do grupo */}
      <div style={{
        background: `linear-gradient(135deg, ${GREEN} 0%, #006428 100%)`,
        borderRadius: 14, padding: '18px 16px', marginBottom: 16, color: '#fff',
      }}>
        <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>SEU BOLÃO</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>⚽ {group?.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <div style={{
            background: 'rgba(255,255,255,0.2)', borderRadius: 8,
            padding: '6px 14px', fontSize: 18, fontWeight: 800, letterSpacing: 4,
          }}>
            {group?.join_code}
          </div>
          <button
            onClick={() => {
              if (navigator.share) navigator.share({ text: shareText })
              else { navigator.clipboard.writeText(shareText); }
            }}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none',
              borderRadius: 8, padding: '6px 12px', color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            📤 Convidar
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          Você: <strong style={{ opacity: 1 }}>{member?.nickname}</strong> · {members.length} participante{members.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onPredict}
          style={{
            background: '#fff', border: `2px solid ${BLUE}`, borderRadius: 12,
            padding: '16px', textAlign: 'left', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 4 }}>📝</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: BLUE }}>Fazer meus palpites</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Preveja os placares de todas as partidas
          </div>
        </button>

        <button
          onClick={onStandings}
          style={{
            background: '#fff', border: `2px solid ${GREEN}`, borderRadius: 12,
            padding: '16px', textAlign: 'left', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 4 }}>🏆</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: GREEN }}>Ver ranking</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Classificação do grupo com pontuação
          </div>
        </button>
      </div>

      {/* Lista de membros */}
      {members.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            Participantes ({members.length})
          </div>
          <div style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden',
          }}>
            {members.map((m, i) => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                borderBottom: i < members.length - 1 ? '1px solid #f3f4f6' : 'none',
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: m.id === member?.id ? GREEN : '#e5e7eb',
                  color: m.id === member?.id ? '#fff' : '#6b7280',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                }}>
                  {m.nickname.charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: 14, fontWeight: m.id === member?.id ? 600 : 400 }}>
                  {m.nickname}
                  {m.id === member?.id && <span style={{ color: GREEN, fontSize: 11 }}> (você)</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onLeave}
        style={{
          background: 'none', border: 'none', fontSize: 12, color: '#9ca3af',
          marginTop: 20, cursor: 'pointer', display: 'block', width: '100%',
          textAlign: 'center', padding: 8,
        }}
      >
        Sair do grupo / trocar de bolão
      </button>
    </div>
  )
}

// ─── View: Palpites ────────────────────────────────────────────────────────────

function PredictionsView({ member, groupId, onBack, setToast }) {
  const [matches, setMatches]         = useState([])
  const [myPreds, setMyPreds]         = useState({})   // match_id → {h, a}
  const [saving, setSaving]           = useState({})
  const [loading, setLoading]         = useState(true)
  const [activeGroup, setActiveGroup] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [mRes, pRes] = await Promise.all([
        fetch('/api/bolao?action=matches'),
        fetch(`/api/bolao?action=my-predictions&member_id=${member.id}`),
      ])
      const mData = await mRes.json()
      const pData = await pRes.json()

      const matchList = mData.matches || []
      setMatches(matchList)

      if (matchList.length > 0) {
        const grouped = groupByPhaseAndGroup(matchList)
        setActiveGroup(Object.keys(grouped)[0])
      }

      const predMap = {}
      for (const p of (pData.predictions || [])) {
        predMap[p.match_id] = { h: p.home_score, a: p.away_score }
      }
      setMyPreds(predMap)
    } catch (e) {
      setToast({ msg: 'Erro ao carregar partidas', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [member.id, setToast])

  useEffect(() => { loadData() }, [loadData])

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
    } finally {
      setSaving(s => ({ ...s, [matchId]: false }))
    }
  }

  const grouped = groupByPhaseAndGroup(matches)
  const groupKeys = sortedGroupKeys(grouped)

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 12, cursor: 'pointer' }}>
        ← Voltar ao grupo
      </button>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>📝 Meus Palpites</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
        Salvo automaticamente ao sair do campo. Palpites salvos ficam em verde.
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Tabs de grupos */}
          <div style={{
            display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2,
            marginBottom: 16, scrollbarWidth: 'none',
          }}>
            {groupKeys.map(key => (
              <button
                key={key}
                onClick={() => setActiveGroup(key)}
                style={{
                  flexShrink: 0, padding: '6px 12px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600, border: 'none',
                  background: activeGroup === key ? BLUE : '#f3f4f6',
                  color: activeGroup === key ? '#fff' : '#374151',
                  cursor: 'pointer',
                }}
              >
                {key}
              </button>
            ))}
          </div>

          {/* Partidas do grupo selecionado */}
          {activeGroup && (grouped[activeGroup] || []).map(match => {
            const pred = myPreds[match.id] || {}
            const hasPred = pred.h !== undefined
            const isFinished = match.status === 'finished'

            return (
              <div key={match.id} style={{
                background: '#fff', borderRadius: 12,
                border: `1.5px solid ${hasPred ? '#86efac' : '#e5e7eb'}`,
                padding: '12px 14px', marginBottom: 10,
                opacity: isFinished ? 0.7 : 1,
              }}>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
                  {formatDate(match.match_date)}
                  {match.venue && ` · ${match.venue.split(',')[0]}`}
                  {isFinished && <span style={{ color: '#ef4444', marginLeft: 6 }}>● Encerrado</span>}
                  {match.status === 'live' && <span style={{ color: '#f59e0b', marginLeft: 6 }}>● Ao vivo</span>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Casa */}
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div style={{ fontSize: 20, lineHeight: 1 }}>{FLAGS[match.home_team] || '🏳️'}</div>
                    <div style={{ fontWeight: 600, fontSize: 12, marginTop: 2, color: '#111827' }}>
                      {match.home_team}
                    </div>
                  </div>

                  {/* Inputs de placar */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <input
                      type="number" min={0} max={30}
                      value={pred.h !== undefined ? pred.h : ''}
                      disabled={isFinished}
                      onChange={e => setMyPreds(p => ({ ...p, [match.id]: { ...(p[match.id] || {}), h: e.target.value } }))}
                      onBlur={e => {
                        const a = myPreds[match.id]?.a
                        if (e.target.value !== '' && a !== undefined) savePrediction(match.id, e.target.value, a)
                      }}
                      style={{
                        width: 44, height: 40, textAlign: 'center', fontSize: 20,
                        fontWeight: 700, borderRadius: 8,
                        border: `1.5px solid ${hasPred ? '#86efac' : '#e5e7eb'}`,
                        background: hasPred ? '#f0fdf4' : '#fff',
                        outline: 'none',
                      }}
                    />
                    <span style={{ fontSize: 16, color: '#9ca3af', fontWeight: 700 }}>–</span>
                    <input
                      type="number" min={0} max={30}
                      value={pred.a !== undefined ? pred.a : ''}
                      disabled={isFinished}
                      onChange={e => setMyPreds(p => ({ ...p, [match.id]: { ...(p[match.id] || {}), a: e.target.value } }))}
                      onBlur={e => {
                        const h = myPreds[match.id]?.h
                        if (e.target.value !== '' && h !== undefined) savePrediction(match.id, h, e.target.value)
                      }}
                      style={{
                        width: 44, height: 40, textAlign: 'center', fontSize: 20,
                        fontWeight: 700, borderRadius: 8,
                        border: `1.5px solid ${hasPred ? '#86efac' : '#e5e7eb'}`,
                        background: hasPred ? '#f0fdf4' : '#fff',
                        outline: 'none',
                      }}
                    />
                  </div>

                  {/* Visitante */}
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 20, lineHeight: 1 }}>{FLAGS[match.away_team] || '🏳️'}</div>
                    <div style={{ fontWeight: 600, fontSize: 12, marginTop: 2, color: '#111827' }}>
                      {match.away_team}
                    </div>
                  </div>
                </div>

                {saving[match.id] && (
                  <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 4 }}>
                    Salvando…
                  </div>
                )}

                {isFinished && match.home_score !== null && (
                  <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 6 }}>
                    Resultado: {FLAGS[match.home_team]} {match.home_score} – {match.away_score} {FLAGS[match.away_team]}
                    {pred.h !== undefined && (
                      <span style={{ marginLeft: 8, fontWeight: 700, color: GREEN }}>
                        {pred.h === match.home_score && pred.a === match.away_score ? '🎯 +3 pts' :
                          Math.sign(pred.h - pred.a) === Math.sign(match.home_score - match.away_score) ? '✅ +1 pt' : '❌ 0 pts'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {matches.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0' }}>
              Nenhuma partida cadastrada ainda.<br />
              <span style={{ fontSize: 12 }}>O administrador deve adicionar as partidas no Supabase.</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── View: Ranking ─────────────────────────────────────────────────────────────

function StandingsView({ group, member, onBack }) {
  const [standings, setStandings] = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (!group) return
    fetch(`/api/bolao?action=standings&group_id=${group.id}`)
      .then(r => r.json())
      .then(d => { setStandings(d.standings || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [group])

  return (
    <div style={{ padding: '0 0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', marginBottom: 12, cursor: 'pointer' }}>
        ← Voltar ao grupo
      </button>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>🏆 Ranking — {group?.name}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
        Pontuação baseada nas partidas encerradas
      </div>

      {loading ? <Spinner /> : standings.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0' }}>
          Nenhuma partida encerrada ainda. O ranking aparece quando os resultados forem confirmados.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {standings.map((s, i) => {
            const medals = ['🥇', '🥈', '🥉']
            const isMe = s.member_id === member?.id
            return (
              <div key={s.member_id} style={{
                background: isMe ? '#f0fdf4' : '#fff',
                border: `1.5px solid ${isMe ? '#86efac' : '#e5e7eb'}`,
                borderRadius: 12, padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>
                  {medals[i] || `${i + 1}º`}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>
                    {s.nickname}
                    {isMe && <span style={{ color: GREEN, fontSize: 11, marginLeft: 6 }}>(você)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    🎯 {s.exact} exatos · ✅ {s.correct} acertos · {s.played} palpites
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: i === 0 ? '#f59e0b' : isMe ? GREEN : '#374151' }}>
                    {s.total_pts}
           