import { useState, useEffect } from 'react'
import { C, FONT } from './lib/colors'

// ════════════════════════════════════════════════════════════════════════════
//   OnboardingFlow — wizard 5 steps (estilo Nextdoor)
//   Step 1: Nome completo + nickname
//   Step 2: Estado USA + cidade
//   Step 3: Escolha mínima de 3 comunidades de interesse
//   Step 4: Foto de perfil (skip permitido)
//   Step 5: Diretrizes da comunidade ("Eu entendo")
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

// ════════════════════════════════════════════════════════════════════════════
//   ProgressBar
// ════════════════════════════════════════════════════════════════════════════
function ProgressBar({ current, total }) {
  const pct = (current / total) * 100
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: i < current ? C.green : C.line,
          transition: 'background .25s',
        }} />
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Step 1: Nome
// ════════════════════════════════════════════════════════════════════════════
function StepName({ data, setData, onNext }) {
  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink, marginBottom: 8, lineHeight: 1.2 }}>
        Como você se chama?
      </div>
      <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 24, lineHeight: 1.5 }}>
        Use o nome real que seus amigos brasileiros conhecem. Cria mais confiança na comunidade.
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
          Nome completo
        </label>
        <input
          type="text" value={data.full_name || ''}
          onChange={e => setData({ ...data, full_name: e.target.value })}
          placeholder="João Silva" autoFocus
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            border: '1.5px solid ' + C.line, fontSize: 15, outline: 'none',
            background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans,
            color: C.ink,
          }}
        />
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
          Apelido (como aparece nos posts)
        </label>
        <input
          type="text" value={data.display_name || ''}
          onChange={e => setData({ ...data, display_name: e.target.value })}
          placeholder="João"
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            border: '1.5px solid ' + C.line, fontSize: 15, outline: 'none',
            background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans,
            color: C.ink,
          }}
        />
      </div>
      <button onClick={onNext} disabled={!data.full_name || data.full_name.trim().length < 2}
        style={{
          width: '100%', padding: '13px 0', borderRadius: 10,
          background: (!data.full_name || data.full_name.trim().length < 2) ? C.inkLight : C.navy,
          color: C.white, fontSize: 15, fontWeight: 600, border: 'none',
          cursor: (!data.full_name || data.full_name.trim().length < 2) ? 'default' : 'pointer',
          fontFamily: FONT.sans,
        }}>
        Próximo →
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Step 2: Localização
// ════════════════════════════════════════════════════════════════════════════
function StepLocation({ data, setData, onBack, onNext }) {
  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink, marginBottom: 8, lineHeight: 1.2 }}>
        Onde você mora nos EUA?
      </div>
      <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 24, lineHeight: 1.5 }}>
        Vamos te conectar com brasileiros do seu estado e cidade. Pode mudar depois.
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
          Estado
        </label>
        <select value={data.state || ''}
          onChange={e => setData({ ...data, state: e.target.value })}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            border: '1.5px solid ' + C.line, fontSize: 15, outline: 'none',
            background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans,
            color: C.ink,
          }}>
          <option value="">Selecione seu estado…</option>
          {US_STATES.map(([code, name]) => (
            <option key={code} value={code}>{code} — {name}</option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
          Cidade (opcional)
        </label>
        <input type="text" value={data.city || ''}
          onChange={e => setData({ ...data, city: e.target.value })}
          placeholder="Boston, Austin, Miami…"
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            border: '1.5px solid ' + C.line, fontSize: 15, outline: 'none',
            background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans,
            color: C.ink,
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={{
          padding: '13px 22px', borderRadius: 10, background: 'transparent',
          color: C.inkSoft, border: '1.5px solid ' + C.line,
          fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
        }}>← Voltar</button>
        <button onClick={onNext} disabled={!data.state}
          style={{
            flex: 1, padding: '13px 0', borderRadius: 10,
            background: !data.state ? C.inkLight : C.navy,
            color: C.white, fontSize: 15, fontWeight: 600, border: 'none',
            cursor: !data.state ? 'default' : 'pointer', fontFamily: FONT.sans,
          }}>Próximo →</button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Step 3: Interesses (mínimo 3)
// ════════════════════════════════════════════════════════════════════════════
function StepInterests({ data, setData, onBack, onNext, allCommunities }) {
  const selected = data.interests || []

  function toggle(slug) {
    if (selected.includes(slug)) {
      setData({ ...data, interests: selected.filter(s => s !== slug) })
    } else {
      setData({ ...data, interests: [...selected, slug] })
    }
  }

  // Pega comunidades de interesse + state do user + general
  const interestCommunities = allCommunities.filter(c => c.type === 'interest')
  const stateCommunities = allCommunities.filter(c => c.type === 'state' && c.geo_state === data.state)
  const cityCommunities  = allCommunities.filter(c => c.type === 'city' && c.geo_state === data.state)
  const general          = allCommunities.filter(c => c.type === 'general')

  const recommended = [...general, ...stateCommunities, ...cityCommunities]

  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink, marginBottom: 8, lineHeight: 1.2 }}>
        Escolha pelo menos 3 comunidades
      </div>
      <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 16, lineHeight: 1.5 }}>
        Vamos personalizar seu feed. Quanto mais você seguir, mais relevante vai ficar.
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Recomendadas pra você
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
        {recommended.map(c => (
          <CommunityChip key={c.id} community={c} selected={selected.includes(c.slug)} onToggle={() => toggle(c.slug)} />
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Por interesse
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        {interestCommunities.map(c => (
          <CommunityChip key={c.id} community={c} selected={selected.includes(c.slug)} onToggle={() => toggle(c.slug)} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={{
          padding: '13px 22px', borderRadius: 10, background: 'transparent',
          color: C.inkSoft, border: '1.5px solid ' + C.line,
          fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
        }}>← Voltar</button>
        <button onClick={onNext} disabled={selected.length < 3}
          style={{
            flex: 1, padding: '13px 0', borderRadius: 10,
            background: selected.length < 3 ? C.inkLight : C.navy,
            color: C.white, fontSize: 15, fontWeight: 600, border: 'none',
            cursor: selected.length < 3 ? 'default' : 'pointer', fontFamily: FONT.sans,
          }}>
          {selected.length < 3 ? 'Escolha ao menos ' + (3 - selected.length) + ' a mais' : `Continuar (${selected.length} selecionadas) →`}
        </button>
      </div>
    </div>
  )
}

function CommunityChip({ community, selected, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      padding: '8px 14px', borderRadius: 20,
      background: selected ? C.green : C.white,
      color: selected ? C.white : C.ink,
      border: '1.5px solid ' + (selected ? C.green : C.line),
      fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
      transition: 'all .15s',
    }}>
      {selected && '✓ '}
      {community.name}
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Step 4: Foto (opcional)
// ════════════════════════════════════════════════════════════════════════════
function StepPhoto({ data, setData, onBack, onNext, onSkip }) {
  const initial = (data.full_name || '?').charAt(0).toUpperCase()

  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink, marginBottom: 8, lineHeight: 1.2 }}>
        Adicione uma foto
      </div>
      <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 24, lineHeight: 1.5 }}>
        Posts com foto recebem 3x mais respostas. Pode pular se preferir.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        {data.avatar_url ? (
          <img src={data.avatar_url} alt="" style={{
            width: 120, height: 120, borderRadius: '50%', objectFit: 'cover',
            border: '3px solid ' + C.green,
          }} />
        ) : (
          <div style={{
            width: 120, height: 120, borderRadius: '50%', background: C.green,
            color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT.serif, fontSize: 48, fontWeight: 600,
          }}>{initial}</div>
        )}
        <div style={{ fontSize: 12, color: C.inkMuted, textAlign: 'center', maxWidth: 320, lineHeight: 1.4 }}>
          Cole a URL de uma foto sua (ou suba pra um serviço como Imgur e cole o link aqui).
        </div>
        <input type="url" value={data.avatar_url || ''}
          onChange={e => setData({ ...data, avatar_url: e.target.value })}
          placeholder="https://..."
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 8,
            border: '1.5px solid ' + C.line, fontSize: 13, outline: 'none',
            background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans,
            color: C.ink,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={{
          padding: '13px 22px', borderRadius: 10, background: 'transparent',
          color: C.inkSoft, border: '1.5px solid ' + C.line,
          fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
        }}>← Voltar</button>
        <button onClick={onSkip} style={{
          padding: '13px 22px', borderRadius: 10, background: 'transparent',
          color: C.inkSoft, border: '1.5px solid ' + C.line,
          fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
        }}>Pular</button>
        <button onClick={onNext} style={{
          flex: 1, padding: '13px 0', borderRadius: 10, background: C.navy,
          color: C.white, fontSize: 15, fontWeight: 600, border: 'none',
          cursor: 'pointer', fontFamily: FONT.sans,
        }}>Próximo →</button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   Step 5: Diretrizes
// ════════════════════════════════════════════════════════════════════════════
function StepGuidelines({ onBack, onAccept, loading }) {
  const guidelines = [
    { icon: '🤝', title: 'Seja prestativo',  desc: 'Mantenha posts e conversas construtivos, mesmo quando opiniões diferem.' },
    { icon: '👥', title: 'Respeite',           desc: 'Lembre-se que do outro lado tem outro brasileiro tentando viver bem nos EUA.' },
    { icon: '🚫', title: 'Não cause dano',     desc: 'Não compartilhe informações falsas ou que possam prejudicar a comunidade.' },
    { icon: '🌎', title: 'Todos são bem-vindos', desc: 'Brasileiros de todos os estados, religiões, orientações e origens. Sem discriminação.' },
  ]

  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: 26, fontWeight: 600, color: C.ink, marginBottom: 8, lineHeight: 1.25 }}>
        Última coisa! Vamos manter o BrasilConnect um lugar legal pra todos.
      </div>

      <div style={{ marginTop: 20, marginBottom: 28 }}>
        {guidelines.map(g => (
          <div key={g.title} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>{g.icon}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{g.title}</span>
            </div>
            <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5, paddingLeft: 28 }}>
              {g.desc}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onBack} style={{
          padding: '13px 22px', borderRadius: 10, background: 'transparent',
          color: C.inkSoft, border: '1.5px solid ' + C.line,
          fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.sans,
        }}>← Voltar</button>
        <button onClick={onAccept} disabled={loading} style={{
          flex: 1, padding: '13px 0', borderRadius: 10,
          background: loading ? C.inkLight : C.green,
          color: C.white, fontSize: 15, fontWeight: 700, border: 'none',
          cursor: loading ? 'default' : 'pointer', fontFamily: FONT.sans,
        }}>
          {loading ? 'Finalizando…' : 'Eu entendo →'}
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//   OnboardingFlow — wizard principal
// ════════════════════════════════════════════════════════════════════════════
export default function OnboardingFlow({ user, onComplete }) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(false)
  const [allCommunities, setAllCommunities] = useState([])
  const [error, setError] = useState(null)

  // Busca comunidades pra mostrar no Step 3
  useEffect(() => {
    fetch('/api/social?action=communities')
      .then(r => r.json())
      .then(d => setAllCommunities(d.communities || []))
      .catch(() => {})
  }, [])

  // Carrega perfil existente (caso usuário tenha começado e parado)
  useEffect(() => {
    if (!user?.id) return
    fetch('/api/profile?user_id=' + user.id)
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          setData({
            full_name:    d.profile.full_name    || '',
            display_name: d.profile.display_name || '',
            state:        d.profile.state        || '',
            city:         d.profile.city         || '',
            avatar_url:   d.profile.avatar_url   || '',
            interests:    d.profile.interests    || [],
          })
          if (d.profile.onboarding_step > 0) setStep(Math.min(d.profile.onboarding_step + 1, 5))
        }
      })
      .catch(() => {})
  }, [user])

  async function saveStep(stepNum, payload) {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/profile?action=onboarding-step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, step: stepNum, data: payload }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao salvar')
    } catch (e) {
      setError(e.message); throw e
    } finally { setLoading(false) }
  }

  async function handleNext1() {
    try {
      await saveStep(1, { email: user.email, full_name: data.full_name, display_name: data.display_name || data.full_name.split(' ')[0] })
      setStep(2)
    } catch (_) {}
  }

  async function handleNext2() {
    try {
      await saveStep(2, { state: data.state, city: data.city, country: 'USA' })
      setStep(3)
    } catch (_) {}
  }

  async function handleNext3() {
    try {
      await saveStep(3, { interests: data.interests })
      // Auto-join nas comunidades selecionadas
      if (Array.isArray(data.interests)) {
        for (const slug of data.interests) {
          const comm = allCommunities.find(c => c.slug === slug)
          if (comm) {
            fetch('/api/social?action=join', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: user.id, community_id: comm.id }),
            }).catch(() => {})
          }
        }
      }
      setStep(4)
    } catch (_) {}
  }

  async function handleNext4(skipped) {
    try {
      await saveStep(4, skipped ? {} : { avatar_url: data.avatar_url })
      setStep(5)
    } catch (_) {}
  }

  async function handleAccept() {
    setLoading(true); setError(null)
    try {
      await fetch('/api/profile?action=accept-guidelines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      await fetch('/api/profile?action=complete-onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      onComplete && onComplete()
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(11,25,40,0.85)', zIndex: 3000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: 16, overflowY: 'auto', fontFamily: FONT.sans,
    }}>
      <div style={{
        background: C.white, borderRadius: 16, padding: '24px',
        maxWidth: 480, width: '100%', marginTop: 32, marginBottom: 32,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: 18, fontWeight: 600, color: C.navy }}>
            Brasil<em style={{ color: C.gold, fontStyle: 'normal', fontWeight: 600 }}>Connect</em>
          </div>
          <div style={{ fontSize: 12, color: C.inkMuted }}>
            Passo {step} de 5
          </div>
        </div>

        <ProgressBar current={step} total={5} />

        {step === 1 && <StepName       data={data} setData={setData} onNext={handleNext1} />}
        {step === 2 && <StepLocation   data={data} setData={setData} onBack={() => setStep(1)} onNext={handleNext2} />}
        {step === 3 && <StepInterests  data={data} setData={setData} onBack={() => setStep(2)} onNext={handleNext3} allCommunities={allCommunities} />}
        {step === 4 && <StepPhoto      data={data} setData={setData} onBack={() => setStep(3)} onNext={() => handleNext4(false)} onSkip={() => handleNext4(true)} />}
        {step === 5 && <StepGuidelines onBack={() => setStep(4)} onAccept={handleAccept} loading={loading} />}

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 8,
            background: '#FEE2E2', color: '#991B1B', fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {loading && step < 5 && (
          <div style={{ textAlign: 'center', fontSize: 12, color: C.inkMuted, marginTop: 12 }}>
            Salvando…
          </div>
        )}
      </div>
    </div>
  )
}
