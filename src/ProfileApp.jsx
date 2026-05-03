import { useState } from 'react'

const PALETTE = { paper:'#F7F3ED', paperEl:'#FFFFFF', green:'#2A7A4F', gold:'#B89968', goldDk:'#8C6D3D', ink:'#1A2B3C', inkSoft:'#4B4F4D', inkMuted:'#6B6E68', line:'#E2E8F0' }
const FONT_SERIF = "'Fraunces', Georgia, serif"

const PRIVACY_LEVELS = [
  { id:'public',    label:'Público',    desc:'Qualquer pessoa na internet vê' },
  { id:'community', label:'Comunidade', desc:'Membros logados do BrasilConnect' },
  { id:'group',    label:'Grupo',      desc:'Só membros dos meus grupos' },
  { id:'private',  label:'Privado',    desc:'Só eu' },
]

const PRIVACY_FIELDS = [
  { key:'full_name', label:'Nome completo', default:'community' },
  { key:'city',      label:'Cidade',         default:'community' },
  { key:'state',     label:'Estado',         default:'public' },
  { key:'bio',       label:'Bio',            default:'community' },
  { key:'whatsapp',  label:'WhatsApp',       default:'group' },
  { key:'instagram', label:'Instagram',      default:'group' },
]

const COLORS = ['#2A7A4F','#1B2845','#B89968','#8C6D3D','#7C3F3F','#3F5F7C','#4A6741','#5C3F7C','#A87654','#3D6B5C']

export default function ProfileApp() {
  const [tab, setTab] = useState('perfil')
  const [profile, setProfile] = useState({
    full_name:'Anderson Torres', display_name:'Anderson T.',
    bio:'Brasileiro em Round Rock TX há 4 anos. Tech & viagem.',
    city:'Round Rock', state:'TX', whatsapp:'', instagram:'',
    avatar_color:'#2A7A4F', email:'eanderson.torres@gmail.com',
  })
  const [privacy, setPrivacy] = useState(Object.fromEntries(PRIVACY_FIELDS.map(f => [f.key, f.default])))
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const initials = (profile.display_name || profile.full_name || '?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()

  async function save() {
    setSaving(true); setSavedMsg('')
    try {
      const r = await fetch('/api/profile/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, privacy })
      })
      if (!r.ok) throw new Error()
      setSavedMsg('✓ Salvo!')
      setTimeout(() => setSavedMsg(''), 2500)
    } catch (e) { setSavedMsg('✗ Erro ao salvar') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ fontFamily:"'Sora', sans-serif", color: PALETTE.ink, background: PALETTE.paper, minHeight:'100%' }}>
      <div style={{ padding:'20px 16px 8px' }}>
        <div style={{ textTransform:'uppercase', letterSpacing:'0.16em', fontSize:10, fontWeight:600, color: PALETTE.goldDk, marginBottom:4 }}>MEU PERFIL</div>
        <div style={{ fontFamily: FONT_SERIF, fontSize:26, fontWeight:700 }}>Como você aparece na plataforma</div>
      </div>

      <div style={{ display:'flex', gap:4, padding:'0 12px', borderBottom:`1px solid ${PALETTE.line}` }}>
        {[['perfil','Perfil'],['privacidade','Privacidade'],['notif','Notificações']].map(([id,lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background:'transparent', border:'none', padding:'12px 14px', fontSize:13, cursor:'pointer',
            fontFamily:'inherit', color: tab===id ? PALETTE.ink : PALETTE.inkMuted,
            fontWeight: tab===id ? 600 : 500,
            borderBottom: `2px solid ${tab===id ? PALETTE.green : 'transparent'}`
          }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:'20px 16px 80px' }}>
        {tab === 'perfil' && <>
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:18 }}>
            <div style={{ width:64, height:64, borderRadius:'50%', background: profile.avatar_color, color: PALETTE.paper, display:'flex', alignItems:'center', justifyContent:'center', fontFamily: FONT_SERIF, fontSize:24, fontWeight:700 }}>{initials}</div>
            <div>
              <div style={{ fontWeight:600 }}>{profile.display_name || profile.full_name}</div>
              <div style={{ fontSize:12, color: PALETTE.inkMuted }}>Cor do avatar:</div>
              <div style={{ display:'flex', gap:6, marginTop:4 }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setProfile(p => ({...p, avatar_color: c}))} style={{ width:18, height:18, borderRadius:'50%', background: c, border: profile.avatar_color===c ? `2px solid ${PALETTE.ink}` : 'none', cursor:'pointer' }} />
                ))}
              </div>
            </div>
          </div>
          {[
            ['full_name', 'Nome completo'],
            ['display_name', 'Como aparecer (ex: Anderson T.)'],
            ['bio', 'Bio (até 160 chars)'],
            ['city', 'Cidade'],
            ['state', 'Estado (ex: TX)'],
            ['whatsapp', 'WhatsApp (opcional)'],
            ['instagram', 'Instagram (opcional)'],
          ].map(([k, lbl]) => (
            <Field key={k} label={lbl} value={profile[k]} onChange={v => setProfile(p => ({...p, [k]: v}))} />
          ))}
        </>}

        {tab === 'privacidade' && <>
          <p style={{ fontSize:13, color: PALETTE.inkMuted, marginBottom:18 }}>Defina quem vê cada campo do seu perfil. Grupos sensíveis (família, atípicos, saúde) <strong>nunca aparecem publicamente</strong> independente da configuração.</p>
          {PRIVACY_FIELDS.map(f => (
            <div key={f.key} style={{ background: PALETTE.paperEl, border:`1px solid ${PALETTE.line}`, borderRadius:10, padding:14, marginBottom:10 }}>
              <div style={{ fontWeight:600, marginBottom:8 }}>{f.label}</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {PRIVACY_LEVELS.map(lv => (
                  <button key={lv.id} onClick={() => setPrivacy(p => ({...p, [f.key]: lv.id}))} style={{
                    padding:'6px 12px', fontSize:11, borderRadius:999, fontFamily:'inherit', cursor:'pointer',
                    background: privacy[f.key] === lv.id ? PALETTE.ink : 'transparent',
                    color: privacy[f.key] === lv.id ? PALETTE.paper : PALETTE.ink,
                    border: `1px solid ${privacy[f.key] === lv.id ? PALETTE.ink : PALETTE.line}`,
                  }}>{lv.label}</button>
                ))}
              </div>
              <div style={{ fontSize:11, color: PALETTE.inkMuted, marginTop:6 }}>{PRIVACY_LEVELS.find(l => l.id === privacy[f.key])?.desc}</div>
            </div>
          ))}
        </>}

        {tab === 'notif' && <>
          <p style={{ fontSize:13, color: PALETTE.inkMuted, marginBottom:14 }}>Configurar notificações por email e push (em breve).</p>
          <div style={{ background: PALETTE.paperEl, border:`1px solid ${PALETTE.line}`, borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, color: PALETTE.inkSoft }}>Notificações estão ativas por padrão. Em breve você poderá desativar tipos específicos.</div>
          </div>
        </>}

        <button onClick={save} disabled={saving} style={{
          width:'100%', padding:'14px', marginTop:18, background: PALETTE.ink, color: PALETTE.paper,
          border:'none', borderRadius:10, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
          opacity: saving ? 0.6 : 1
        }}>{saving ? 'Salvando…' : 'Salvar perfil'}</button>
        {savedMsg && <p style={{ textAlign:'center', marginTop:10, fontSize:13, color: savedMsg.startsWith('✓') ? '#065F46' : '#9F2D2D' }}>{savedMsg}</p>}
      </div>
    </div>
  )
}

function Field({ label, value, onChange }) {
  return (
    <div style={{ marginBottom:10 }}>
      <label style={{ display:'block', fontSize:11, color: PALETTE.inkMuted, textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:600, marginBottom:4 }}>{label}</label>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} style={{
        width:'100%', padding:'10px 12px', border:`1px solid ${PALETTE.line}`,
        borderRadius:8, fontFamily:'inherit', fontSize:14, boxSizing:'border-box',
        background: PALETTE.paperEl
      }} />
    </div>
  )
}
