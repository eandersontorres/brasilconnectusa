import { useState, useEffect, useCallback } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'

// ════════════════════════════════════════════════════════════════════════════
//   SettingsScreen — página de configurações (inspirado no Nextdoor)
//
//   Lista de itens. Cada item ou:
//     - Tem painel inline que expande quando aberto (Conta, Localização)
//     - Linka pra página externa (Negocio, Termos, Privacidade)
//     - Dispara ação (Sair)
// ════════════════════════════════════════════════════════════════════════════

const VALID_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR']

export default function SettingsScreen({ onNavigate }) {
  const { user, signOut } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openPanel, setOpenPanel] = useState(null) // null | 'conta' | 'local'

  const loadProfile = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const r = await fetch('/api/profile?user_id=' + user.id)
      const d = await r.json()
      setProfile(d.profile || {})
    } catch (_) { setProfile({}) }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { loadProfile() }, [loadProfile])

  if (!user) return null

  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, padding: '4px 0 24px' }}>
      <h1 style={{
        fontFamily: FONT.serif, fontSize: 28, fontWeight: 600, color: C.ink,
        margin: '0 0 20px 0', letterSpacing: '-0.01em',
      }}>Configurações</h1>

      <div style={{
        background: C.white, border: '1px solid ' + C.line, borderRadius: 14,
        overflow: 'hidden',
      }}>
        {/* CONTA */}
        <Row
          icon="👤" label="Conta" sub={profile?.full_name || profile?.display_name || user.email}
          expanded={openPanel === 'conta'}
          onClick={() => setOpenPanel(openPanel === 'conta' ? null : 'conta')}
        />
        {openPanel === 'conta' && profile !== null && (
          <ContaPanel
            user={user}
            profile={profile}
            loading={loading}
            onSaved={(updated) => { setProfile(updated); setOpenPanel(null) }}
          />
        )}

        {/* LOCALIZAÇÃO */}
        <Row
          icon="📍" label="Localização" sub={profile?.city ? `${profile.city} / ${profile.state || '—'}` : 'Não definida'}
          expanded={openPanel === 'local'}
          onClick={() => setOpenPanel(openPanel === 'local' ? null : 'local')}
        />
        {openPanel === 'local' && profile !== null && (
          <LocalPanel
            user={user}
            profile={profile}
            onSaved={(updated) => { setProfile(updated); setOpenPanel(null) }}
          />
        )}

        {/* NOTIFICAÇÕES */}
        <Row
          icon="🔔" label="Notificações" sub="Push, email, alertas"
          onClick={() => window.dispatchEvent(new CustomEvent('bc-open-push-prompt'))}
        />

        {/* MINHAS COMUNIDADES */}
        <Row
          icon="🌐" label="Minhas comunidades" sub="Ver, entrar, sair"
          onClick={() => onNavigate && onNavigate('comunidades')}
        />

        {/* MEU NEGÓCIO */}
        <Row
          icon="🏪" label="Meu negócio" sub="Painel do assinante, cardápio, pedidos"
          onClick={() => { window.location.href = '/assinante' }}
        />

        {/* AJUDA */}
        <Row
          icon="❓" label="Ajuda e suporte" sub="Mande mensagem pra equipe"
          onClick={() => { window.location.href = '/#contato' }}
        />

        <SectionDivider />

        {/* TERMOS / PRIVACIDADE */}
        <Row
          icon="📄" label="Termos de uso"
          onClick={() => { window.location.href = '/termos' }}
          subtle
        />
        <Row
          icon="🔒" label="Política de privacidade"
          onClick={() => { window.location.href = '/privacidade' }}
          subtle
        />

        <SectionDivider />

        {/* SAIR */}
        <Row
          icon="🚪" label="Sair"
          danger
          onClick={async () => {
            if (!confirm('Sair da sua conta?')) return
            await signOut()
            onNavigate && onNavigate('feed')
          }}
        />
      </div>

      <div style={{
        textAlign: 'center', fontSize: 11, color: C.inkMuted, marginTop: 18,
      }}>
        Logado como <b>{user.email}</b> · BrasilConnect USA · © 2026
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Row — linha clicável com ícone, label e chevron
// ────────────────────────────────────────────────────────────────────────────
function Row({ icon, label, sub, expanded, onClick, danger, subtle }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14, width: '100%',
      padding: '16px 18px', background: 'transparent',
      border: 'none', borderBottom: '1px solid ' + C.line,
      cursor: 'pointer', textAlign: 'left', fontFamily: FONT.sans,
      transition: 'background 0.12s ease',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = C.paper }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{
        width: 32, height: 32, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 18, flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: danger ? '#991B1B' : (subtle ? C.inkSoft : C.ink),
        }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 1 }}>{sub}</div>
        )}
      </div>
      <span style={{
        fontSize: 18, color: C.inkMuted, flexShrink: 0,
        transform: expanded ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.15s ease',
      }}>›</span>
    </button>
  )
}

function SectionDivider() {
  return <div style={{ height: 8, background: C.paper }} />
}

// ────────────────────────────────────────────────────────────────────────────
//   ContaPanel — edita full_name, display_name, bio, whatsapp, instagram
// ────────────────────────────────────────────────────────────────────────────
function ContaPanel({ user, profile, loading, onSaved }) {
  const [fullName, setFullName] = useState(profile.full_name || '')
  const [displayName, setDisplayName] = useState(profile.display_name || '')
  const [bio, setBio] = useState(profile.bio || '')
  const [whatsapp, setWhatsapp] = useState(profile.whatsapp || '')
  const [instagram, setInstagram] = useState(profile.instagram || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    setError(null); setSaving(true)
    try {
      const r = await fetch('/api/profile?action=upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          email: user.email,
          full_name: fullName.trim(),
          display_name: displayName.trim(),
          bio: bio.trim(),
          whatsapp: whatsapp.trim(),
          instagram: instagram.trim().replace(/^@/, ''),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      onSaved(d.profile)
    } catch (e) {
      setError(e.message || 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  return (
    <PanelWrap>
      {loading ? <div style={{ color: C.inkMuted, fontSize: 13 }}>Carregando…</div> : (
        <>
          <Field label="Email" sub="Não pode ser alterado aqui (use o link mágico)">
            <input value={user.email} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
          </Field>
          <Field label="Nome completo">
            <input value={fullName} onChange={e => setFullName(e.target.value)} maxLength={80} style={inputStyle} placeholder="Seu nome" />
          </Field>
          <Field label="Display name" sub="Aparece nos posts e comentários">
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={40} style={inputStyle} placeholder="Apelido público" />
          </Field>
          <Field label="Bio" sub="Curta, aparece no perfil (até 200 chars)">
            <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={200} rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} placeholder="Conta um pouco sobre você" />
          </Field>
          <Field label="WhatsApp">
            <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} maxLength={20} style={inputStyle} placeholder="+1 555 555 5555" />
          </Field>
          <Field label="Instagram">
            <input value={instagram} onChange={e => setInstagram(e.target.value)} maxLength={30} style={inputStyle} placeholder="@seuhandle" />
          </Field>
          {error && <ErrorBox msg={error} />}
          <SaveBar saving={saving} onSave={handleSave} />
        </>
      )}
    </PanelWrap>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   LocalPanel — city, state
// ────────────────────────────────────────────────────────────────────────────
function LocalPanel({ user, profile, onSaved }) {
  const [city, setCity] = useState(profile.city || '')
  const [state, setState] = useState(profile.state || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    setError(null); setSaving(true)
    try {
      const r = await fetch('/api/profile?action=upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          email: user.email,
          city: city.trim(),
          state: state.trim().toUpperCase().slice(0, 2),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      onSaved(d.profile)
    } catch (e) {
      setError(e.message || 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  return (
    <PanelWrap>
      <Field label="Cidade">
        <input value={city} onChange={e => setCity(e.target.value)} maxLength={60} style={inputStyle} placeholder="Boston" />
      </Field>
      <Field label="Estado (2 letras)" sub="USPS, ex: MA, FL, TX">
        <select value={state} onChange={e => setState(e.target.value)} style={inputStyle}>
          <option value="">Selecione</option>
          {VALID_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <div style={{ fontSize: 11, color: C.inkMuted, marginTop: -6, marginBottom: 4 }}>
        Sua localização é usada pra mostrar comunidades, eventos e negócios perto de você.
      </div>
      {error && <ErrorBox msg={error} />}
      <SaveBar saving={saving} onSave={handleSave} />
    </PanelWrap>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//   Componentes auxiliares (panel layout)
// ────────────────────────────────────────────────────────────────────────────
function PanelWrap({ children }) {
  return (
    <div style={{
      padding: '18px 20px', background: C.paper, borderBottom: '1px solid ' + C.line,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>{children}</div>
  )
}

function Field({ label, sub, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {sub && <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div style={{
      background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
      padding: '10px 12px', borderRadius: 8, fontSize: 13,
    }}>{msg}</div>
  )
}

function SaveBar({ saving, onSave }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button onClick={onSave} disabled={saving} style={{
        background: C.green, color: C.white, border: 'none',
        padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700,
        cursor: saving ? 'wait' : 'pointer', fontFamily: FONT.sans,
        opacity: saving ? 0.6 : 1,
      }}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid ' + C.line, fontSize: 14, outline: 'none',
  background: C.white, boxSizing: 'border-box', fontFamily: FONT.sans, color: C.ink,
}
