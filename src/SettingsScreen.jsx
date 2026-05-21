import { useState, useEffect, useCallback } from 'react'
import { C, FONT } from './lib/colors'
import { useAuth } from './AuthModal'
import { apiFetch } from './lib/apiFetch'
import { SHOW_BUSINESS } from './lib/features'

// ════════════════════════════════════════════════════════════════════════════
//   SettingsScreen — página de configurações (inspirado no Nextdoor)
//
//   Lista de itens. Cada item ou:
//     - Tem painel inline que expande quando aberto (Conta, Localização)
//     - Linka pra página externa (Negocio, Termos, Privacidade)
//     - Dispara ação (Sair)
// ════════════════════════════════════════════════════════════════════════════

const VALID_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR']

// ─── Ícones monocromáticos (Lucide-style, 22x22, currentColor) ──────────────
const ICON_PROPS = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
}
const Icons = {
  user:    <svg {...ICON_PROPS}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  pin:     <svg {...ICON_PROPS}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  bell:    <svg {...ICON_PROPS}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  users:   <svg {...ICON_PROPS}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  store:   <svg {...ICON_PROPS}><path d="M2 7l1-4h18l1 4M3 7v13h18V7M3 7h18M9 22V12h6v10"/></svg>,
  help:    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  fileText:<svg {...ICON_PROPS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  lock:    <svg {...ICON_PROPS}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  logout:  <svg {...ICON_PROPS}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
}

export default function SettingsScreen({ onNavigate }) {
  const { user, signOut } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openPanel, setOpenPanel] = useState(null) // null | 'conta' | 'local'

  const loadProfile = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const r = await apiFetch('/api/profile?user_id=' + user.id)
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
          icon={Icons.user} label="Conta" sub={profile?.full_name || profile?.display_name || user.email}
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
          icon={Icons.pin} label="Localização" sub={profile?.city ? `${profile.city} / ${profile.state || '—'}` : 'Não definida'}
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
          icon={Icons.bell} label="Notificações" sub="Push, email, alertas"
          onClick={() => window.dispatchEvent(new CustomEvent('bc-open-push-prompt'))}
        />

        {/* MINHAS COMUNIDADES */}
        <Row
          icon={Icons.users} label="Minhas comunidades" sub="Ver, entrar, sair"
          onClick={() => onNavigate && onNavigate('comunidades')}
        />

        {/* MEU NEGÓCIO — escondido por feature flag até lançar essa parte */}
        {SHOW_BUSINESS && (
          <Row
            icon={Icons.store} label="Meu negócio" sub="Painel do assinante, cardápio, pedidos"
            onClick={() => { window.location.href = '/assinante' }}
          />
        )}

        {/* AJUDA */}
        <Row
          icon={Icons.help} label="Ajuda e suporte" sub="Mande mensagem pra equipe"
          onClick={() => { window.location.href = '/#contato' }}
        />

        <SectionDivider />

        {/* TERMOS / PRIVACIDADE */}
        <Row
          icon={Icons.fileText} label="Termos de uso"
          onClick={() => { window.location.href = '/termos' }}
          subtle
        />
        <Row
          icon={Icons.lock} label="Política de privacidade"
          onClick={() => { window.location.href = '/privacidade' }}
          subtle
        />

        <SectionDivider />

        {/* SAIR */}
        <Row
          icon={Icons.logout} label="Sair"
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
  const iconColor = danger ? '#991B1B' : (subtle ? C.inkMuted : C.inkSoft)
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
        justifyContent: 'center', flexShrink: 0, color: iconColor,
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
//   ContaPanel — edita full_name, username, display_name, bio, whatsapp, instagram
// ────────────────────────────────────────────────────────────────────────────
const USERNAME_RX_SETTINGS = /^[a-z0-9_]{3,20}$/

function ContaPanel({ user, profile, loading, onSaved }) {
  const [fullName, setFullName] = useState(profile.full_name || '')
  const [username, setUsername] = useState(profile.username || '')
  const [displayName, setDisplayName] = useState(profile.display_name || '')
  const [bio, setBio] = useState(profile.bio || '')
  const [whatsapp, setWhatsapp] = useState(profile.whatsapp || '')
  const [instagram, setInstagram] = useState(profile.instagram || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [unameStatus, setUnameStatus] = useState('idle') // idle|checking|available|taken|invalid
  const [unameReason, setUnameReason] = useState('')

  // Re-popula campos se profile mudar (ex: salvou em outro lugar)
  useEffect(() => {
    setUsername(profile.username || '')
  }, [profile.username])

  // Debounced check de disponibilidade. Pula se for o username atual do user.
  useEffect(() => {
    const u = (username || '').trim().toLowerCase()
    if (!u) { setUnameStatus('idle'); setUnameReason(''); return }
    if (u === (profile.username || '').toLowerCase()) {
      setUnameStatus('available'); setUnameReason(''); return
    }
    if (!USERNAME_RX_SETTINGS.test(u)) {
      setUnameStatus('invalid')
      setUnameReason('use 3-20 caracteres, só letras minúsculas, números e _')
      return
    }
    setUnameStatus('checking'); setUnameReason('')
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch('/api/profile?action=check-username&u=' + encodeURIComponent(u))
        const d = await r.json()
        if (d.available) { setUnameStatus('available'); setUnameReason('') }
        else { setUnameStatus('taken'); setUnameReason(d.reason || 'já está em uso') }
      } catch (_) { setUnameStatus('idle') }
    }, 400)
    return () => clearTimeout(t)
  }, [username, profile.username])

  async function handleSave() {
    setError(null); setSaving(true)
    try {
      // Não envia username se status inválido (deixa só os outros campos passarem)
      const payload = {
        user_id: user.id,
        email: user.email,
        full_name: fullName.trim(),
        display_name: displayName.trim(),
        bio: bio.trim(),
        whatsapp: whatsapp.trim(),
        instagram: instagram.trim().replace(/^@/, ''),
      }
      const u = username.trim().toLowerCase()
      if (u && (unameStatus === 'available' || u === (profile.username || '').toLowerCase())) {
        payload.username = u
      } else if (u && unameStatus !== 'available') {
        throw new Error('Resolva o username antes de salvar')
      }

      const r = await apiFetch('/api/profile?action=upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Erro')
      onSaved(d.profile)
    } catch (e) {
      setError(e.message || 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  const unameBorderColor =
    unameStatus === 'available' ? '#10B981' :
    unameStatus === 'taken' || unameStatus === 'invalid' ? '#EF4444' :
    C.line

  return (
    <PanelWrap>
      {loading ? <div style={{ color: C.inkMuted, fontSize: 13 }}>Carregando…</div> : (
        <>
          <Field label="Email" sub="Não pode ser alterado aqui (use o link mágico)">
            <input value={user.email} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
          </Field>
          <Field label="Nome completo" sub="Privado. Só você e administradores veem.">
            <input value={fullName} onChange={e => setFullName(e.target.value)} maxLength={80} style={inputStyle} placeholder="Seu nome" />
          </Field>
          <Field label="@username" sub="Nome público — aparece em posts e comentários. Pode trocar (afeta @menções).">
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 14, color: C.inkMuted, pointerEvents: 'none',
              }}>@</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                maxLength={20}
                style={{ ...inputStyle, paddingLeft: 26, borderColor: unameBorderColor }}
                placeholder="seu_username"
                autoComplete="off"
              />
            </div>
            <div style={{ fontSize: 11, marginTop: 4, minHeight: 14 }}>
              {unameStatus === 'checking'  && <span style={{ color: C.inkMuted }}>Verificando…</span>}
              {unameStatus === 'available' && username !== (profile.username || '') && <span style={{ color: '#10B981', fontWeight: 600 }}>✓ disponível</span>}
              {unameStatus === 'taken'     && <span style={{ color: '#EF4444' }}>✗ {unameReason}</span>}
              {unameStatus === 'invalid'   && <span style={{ color: '#EF4444' }}>{unameReason}</span>}
            </div>
          </Field>
          <Field label="Como te chamar" sub="Mostrado junto com @username em alguns lugares (opcional)">
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={40} style={inputStyle} placeholder="João" />
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
      const r = await apiFetch('/api/profile?action=upsert', {
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
