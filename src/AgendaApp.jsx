import { useState, useEffect, useMemo } from 'react'

/**
 * AgendaApp — visão da profissional do AgendaPro.
 * Renderizado dentro do App principal como uma aba.
 *
 * Modo demo (sem provider_id no localStorage) → mostra dados fake
 * Modo real → carrega dados do Supabase via /api/agenda/*
 *
 * View cliente está em /agenda/[slug] (página estática separada).
 */

const PALETTE = {
  paper: '#FAF7F0', paperEl: '#FFFFFF', paperSft: '#F1ECDF',
  green: '#009c3b', greenDk: '#006428', greenSft: '#E8EFEB',
  navy: '#1B2845', gold: '#B89968', goldDk: '#8C6D3D', goldSft: '#F5EFE0',
  ink: '#1A1F1C', inkSoft: '#4B4F4D', inkMuted: '#6B6E68', line: '#E5E1D6',
}

const FONT_SERIF = "'Fraunces', Georgia, serif"

const fmtUSD = (cents) => '$' + ((cents || 0) / 100).toFixed(2)
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const fmtDay  = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })

// ─── Dados de demo ──────────────────────────────────────────────────────
const DEMO = {
  provider: {
    id: 'demo-id', name: 'Ana Torres', slug: 'ana-torres',
    specialty: 'Cabeleireira', city: 'Round Rock', state: 'TX',
    plan: 'pro', plan_status: 'trialing', trial_ends_at: new Date(Date.now() + 11 * 24 * 3600e3).toISOString(),
  },
  services: [
    { id: 's1', name: 'Corte feminino', category: 'Cabelo',  duration_min: 60, price_cents: 6500, deposit_cents: 1500, active: true },
    { id: 's2', name: 'Coloração',       category: 'Cabelo',  duration_min: 120, price_cents: 14000, deposit_cents: 3000, active: true },
    { id: 's3', name: 'Escova',          category: 'Cabelo',  duration_min: 45, price_cents: 4500, deposit_cents: 0,    active: true },
    { id: 's4', name: 'Manicure',        category: 'Mãos',    duration_min: 45, price_cents: 3500, deposit_cents: 0,    active: true },
  ],
  appointments: [
    { id: 'a1', service_name: 'Corte feminino',  client_name: 'Mariana S.', client_whatsapp: '+15125550101', scheduled_for: new Date().setHours(10,0,0,0), duration_min: 60,  total_cents: 6500,  status: 'confirmed', deposit_paid: true },
    { id: 'a2', service_name: 'Coloração',        client_name: 'Larissa B.', client_whatsapp: '+15125550102', scheduled_for: new Date().setHours(14,0,0,0), duration_min: 120, total_cents: 14000, status: 'confirmed', deposit_paid: true },
    { id: 'a3', service_name: 'Manicure',         client_name: 'Carla N.',   client_whatsapp: '+15125550103', scheduled_for: new Date(Date.now() + 86400e3).setHours(11,0,0,0), duration_min: 45, total_cents: 3500, status: 'pending', deposit_paid: false },
    { id: 'a4', service_name: 'Escova',           client_name: 'Beatriz M.', client_whatsapp: '+15125550104', scheduled_for: new Date(Date.now() + 86400e3).setHours(16,30,0,0), duration_min: 45, total_cents: 4500, status: 'confirmed', deposit_paid: false },
  ],
  clients: [
    { id: 'c1', name: 'Mariana Silva',   whatsapp: '+15125550101', total_visits: 8, total_spent_cents: 52000, last_visit_at: new Date(Date.now() - 14*86400e3).toISOString() },
    { id: 'c2', name: 'Larissa Borges',  whatsapp: '+15125550102', total_visits: 5, total_spent_cents: 70000, last_visit_at: new Date(Date.now() - 30*86400e3).toISOString() },
    { id: 'c3', name: 'Carla Nogueira',  whatsapp: '+15125550103', total_visits: 12, total_spent_cents: 42000, last_visit_at: new Date(Date.now() - 7*86400e3).toISOString() },
    { id: 'c4', name: 'Beatriz Mendes',  whatsapp: '+15125550104', total_visits: 3, total_spent_cents: 13500, last_visit_at: new Date(Date.now() - 21*86400e3).toISOString() },
  ],
}

// ─── Componente principal ──────────────────────────────────────────────
export default function AgendaApp() {
  const [tab, setTab] = useState('home')
  const [data] = useState(DEMO)        // future: carregar de /api/agenda/* com provider_id
  const isDemo = true

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.eyebrow}>AGENDAPRO</div>
          <div style={S.greeting}>Oi, {data.provider.name.split(' ')[0]}.</div>
        </div>
        <div style={S.planBadge}>
          {data.provider.plan === 'starter' && 'STARTER'}
          {data.provider.plan === 'pro' && 'PRO'}
          {data.provider.plan === 'premium' && 'SALÃO'}
          {data.provider.plan_status === 'trialing' && ' · TRIAL'}
        </div>
      </div>

      {isDemo && (
        <div style={S.demoBanner}>
          Modo demo — dados de exemplo. Quando o cadastro estiver pronto, esta tela mostra os seus dados reais.
        </div>
      )}

      {/* Tab nav */}
      <div style={S.tabBar}>
        {[
          ['home',     'Início'],
          ['agenda',   'Agenda'],
          ['services', 'Serviços'],
          ['clients',  'Clientes'],
          ['plans',    'Planos'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ ...S.tabBtn, ...(tab === id ? S.tabBtnActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '20px 16px 80px' }}>
        {tab === 'home'     && <HomeView data={data} />}
        {tab === 'agenda'   && <AgendaView data={data} />}
        {tab === 'services' && <ServicesView data={data} />}
        {tab === 'clients'  && <ClientsView data={data} />}
        {tab === 'plans'    && <PlansView provider={data.provider} />}
      </div>
    </div>
  )
}

// ─── HOME ─────────────────────────────────────────────────────────────
function HomeView({ data }) {
  const today = data.appointments.filter(a => isSameDay(a.scheduled_for, Date.now()))
  const tomorrow = data.appointments.filter(a => isSameDay(a.scheduled_for, Date.now() + 86400e3))

  // Faturamento estimado (apenas demo — em prod usa view ag_revenue_monthly)
  const grossMonth = data.appointments.reduce((s, a) => s + a.total_cents, 0)
  const completed = data.appointments.filter(a => a.status === 'confirmed').length

  return (
    <>
      <div style={S.kpiRow}>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>FATURAMENTO MÊS</div>
          <div style={S.kpiValue}>{fmtUSD(grossMonth)}</div>
          <div style={S.kpiSub}>{completed} agendamentos</div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>HOJE</div>
          <div style={S.kpiValue}>{today.length}</div>
          <div style={S.kpiSub}>{today.length === 1 ? 'agendamento' : 'agendamentos'}</div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>AMANHÃ</div>
          <div style={S.kpiValue}>{tomorrow.length}</div>
          <div style={S.kpiSub}>{tomorrow.length === 1 ? 'agendamento' : 'agendamentos'}</div>
        </div>
      </div>

      <h3 style={S.sectionTitle}>Hoje</h3>
      {today.length === 0 ? (
        <p style={S.emptyState}>Sem agendamentos hoje.</p>
      ) : (
        today.map(a => <AppointmentCard key={a.id} apt={a} />)
      )}

      <h3 style={S.sectionTitle}>Amanhã</h3>
      {tomorrow.length === 0 ? (
        <p style={S.emptyState}>Sem agendamentos amanhã.</p>
      ) : (
        tomorrow.map(a => <AppointmentCard key={a.id} apt={a} />)
      )}
    </>
  )
}

function AppointmentCard({ apt }) {
  const cleaned = (apt.client_whatsapp || '').replace(/\D/g, '')
  const waUrl = cleaned ? `https://wa.me/${cleaned}` : null
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={S.aptTime}>{fmtTime(apt.scheduled_for)}</div>
          <div style={S.aptService}>{apt.service_name}</div>
          <div style={S.aptClient}>{apt.client_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={S.aptPrice}>{fmtUSD(apt.total_cents)}</div>
          <div style={apt.status === 'confirmed' ? S.statusOk : S.statusPending}>
            {apt.status === 'confirmed' ? 'Confirmado' : 'Pendente'}
          </div>
          {apt.deposit_paid && <div style={S.statusGold}>Depósito pago</div>}
        </div>
      </div>
      {waUrl && (
        <a href={waUrl} target="_blank" rel="noopener noreferrer" style={S.btnSecondary}>
          Mensagem no WhatsApp
        </a>
      )}
    </div>
  )
}

// ─── AGENDA ───────────────────────────────────────────────────────────
function AgendaView({ data }) {
  const [selected, setSelected] = useState(new Date().toISOString().slice(0, 10))
  const apts = data.appointments
    .filter(a => isSameDay(a.scheduled_for, new Date(selected).getTime()))
    .sort((x, y) => x.scheduled_for - y.scheduled_for)

  return (
    <>
      <div style={S.card}>
        <label style={S.kpiLabel}>SELECIONAR DIA</label>
        <input type="date" value={selected} onChange={e => setSelected(e.target.value)}
          style={S.dateInput} />
      </div>
      <h3 style={S.sectionTitle}>{new Date(selected).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</h3>
      {apts.length === 0
        ? <p style={S.emptyState}>Sem agendamentos neste dia.</p>
        : apts.map(a => <AppointmentCard key={a.id} apt={a} />)}
    </>
  )
}

// ─── SERVIÇOS ─────────────────────────────────────────────────────────
function ServicesView({ data }) {
  return (
    <>
      <div style={S.toolbar}>
        <h3 style={{ ...S.sectionTitle, margin: 0 }}>{data.services.length} serviços</h3>
        <button style={S.btnPrimary} onClick={() => alert('Em breve: adicionar serviço')}>+ Novo serviço</button>
      </div>
      {data.services.map(s => (
        <div key={s.id} style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={S.aptService}>{s.name}</div>
              <div style={S.aptClient}>{s.category} · {s.duration_min} min</div>
              {s.deposit_cents > 0 && <div style={S.statusGold}>Depósito: {fmtUSD(s.deposit_cents)}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={S.aptPrice}>{fmtUSD(s.price_cents)}</div>
              <div style={s.active ? S.statusOk : S.statusPending}>{s.active ? 'Ativo' : 'Inativo'}</div>
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

// ─── CLIENTES ─────────────────────────────────────────────────────────
function ClientsView({ data }) {
  const sorted = useMemo(() => [...data.clients].sort((a, b) => b.total_spent_cents - a.total_spent_cents), [data.clients])
  return (
    <>
      <h3 style={S.sectionTitle}>{sorted.length} clientes</h3>
      {sorted.map(c => (
        <div key={c.id} style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={S.aptService}>{c.name}</div>
              <div style={S.aptClient}>{c.total_visits} visitas · última {new Date(c.last_visit_at).toLocaleDateString('pt-BR')}</div>
            </div>
            <div style={S.aptPrice}>{fmtUSD(c.total_spent_cents)}</div>
          </div>
        </div>
      ))}
    </>
  )
}

// ─── PLANOS ───────────────────────────────────────────────────────────
function PlansView({ provider }) {
  const PLANS = [
    { id: 'starter', name: 'Starter', price: 19,  features: ['1 profissional', 'Página pública', 'Até 50 clientes'] },
    { id: 'pro',     name: 'Pro',     price: 39,  features: ['Tudo do Starter', 'Lembretes WhatsApp', 'Cobrar depósito Stripe', 'Analytics'], featured: true },
    { id: 'premium', name: 'Premium', price: 79,  features: ['Tudo do Pro', 'Até 10 profissionais', 'Relatórios financeiros'] },
  ]
  return (
    <>
      <h3 style={S.sectionTitle}>Plano atual: {provider.plan?.toUpperCase()} ({provider.plan_status})</h3>
      {provider.plan_status === 'trialing' && provider.trial_ends_at && (
        <div style={S.demoBanner}>
          Trial termina em {new Date(provider.trial_ends_at).toLocaleDateString('pt-BR')}.
        </div>
      )}
      {PLANS.map(p => (
        <div key={p.id} style={{ ...S.card, ...(p.featured ? S.cardFeatured : {}) }}>
          {p.featured && <div style={S.featuredBadge}>MAIS POPULAR</div>}
          <div style={S.aptService}>{p.name}</div>
          <div style={{ ...S.aptPrice, fontSize: 28, marginTop: 8 }}>${p.price}<span style={{ fontSize: 14, color: PALETTE.inkMuted, fontWeight: 400 }}>/mês</span></div>
          <ul style={S.featureList}>
            {p.features.map(f => <li key={f} style={S.featureItem}>✓ {f}</li>)}
          </ul>
          <button style={p.id === provider.plan ? S.btnSecondary : S.btnPrimary} onClick={() => alert('Em breve: assinar via Stripe')}>
            {p.id === provider.plan ? 'Plano atual' : 'Assinar'}
          </button>
        </div>
      ))}
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────
function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

// ─── Estilos ──────────────────────────────────────────────────────────
const S = {
  wrap: { fontFamily: "'Sora', 'Inter', -apple-system, sans-serif", color: PALETTE.ink, background: PALETTE.paper, minHeight: '100%' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 16px 8px', gap: 12 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: '0.16em', fontSize: 10, fontWeight: 600, color: PALETTE.goldDk, marginBottom: 4 },
  greeting: { fontFamily: FONT_SERIF, fontSize: 26, fontWeight: 700, color: PALETTE.ink, lineHeight: 1.1 },
  planBadge: { background: PALETTE.greenSft, color: PALETTE.green, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', padding: '5px 10px', borderRadius: 999, border: `1px solid ${PALETTE.green}` },

  demoBanner: { background: PALETTE.goldSft, color: PALETTE.goldDk, fontSize: 13, padding: '10px 14px', borderRadius: 8, margin: '12px 16px', borderLeft: `3px solid ${PALETTE.gold}` },

  tabBar: { display: 'flex', gap: 4, padding: '0 12px', borderBottom: `1px solid ${PALETTE.line}`, overflowX: 'auto' },
  tabBtn: { background: 'transparent', border: 'none', color: PALETTE.inkMuted, padding: '12px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', borderBottom: '2px solid transparent', whiteSpace: 'nowrap' },
  tabBtnActive: { color: PALETTE.ink, fontWeight: 600, borderBottomColor: PALETTE.green },

  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 },
  kpiCard: { background: PALETTE.paperEl, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: '14px 12px' },
  kpiLabel: { fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', color: PALETTE.inkMuted, textTransform: 'uppercase', marginBottom: 6 },
  kpiValue: { fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 700, color: PALETTE.ink, lineHeight: 1.1 },
  kpiSub: { fontSize: 11, color: PALETTE.inkMuted, marginTop: 4 },

  sectionTitle: { fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, color: PALETTE.ink, margin: '24px 0 12px 0' },

  card: { background: PALETTE.paperEl, border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: 16, marginBottom: 10 },
  cardFeatured: { borderColor: PALETTE.gold, position: 'relative' },
  featuredBadge: { position: 'absolute', top: -10, left: 12, background: PALETTE.gold, color: PALETTE.paper, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', padding: '3px 10px', borderRadius: 999 },

  aptTime: { fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 700, color: PALETTE.ink },
  aptService: { fontWeight: 600, color: PALETTE.ink, fontSize: 15, marginTop: 2 },
  aptClient: { fontSize: 13, color: PALETTE.inkMuted, marginTop: 2 },
  aptPrice: { fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 700, color: PALETTE.ink },
  statusOk: { fontSize: 10, color: '#065F46', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 4 },
  statusPending: { fontSize: 10, color: PALETTE.goldDk, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 4 },
  statusGold: { fontSize: 10, color: PALETTE.goldDk, fontWeight: 600, marginTop: 4 },

  emptyState: { color: PALETTE.inkMuted, fontStyle: 'italic', fontSize: 14, padding: '12px 4px' },

  btnPrimary: { display: 'inline-block', padding: '10px 18px', background: PALETTE.ink, color: PALETTE.paper, border: 'none', borderRadius: 8, fontFamily: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer', textDecoration: 'none', marginTop: 12, textAlign: 'center' },
  btnSecondary: { display: 'inline-block', padding: '10px 18px', background: 'transparent', color: PALETTE.ink, border: `1px solid ${PALETTE.line}`, borderRadius: 8, fontFamily: 'inherit', fontWeight: 500, fontSize: 13, cursor: 'pointer', textDecoration: 'none', marginTop: 12, textAlign: 'center' },

  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  dateInput: { padding: '10px 12px', border: `1px solid ${PALETTE.line}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 14, marginTop: 8, width: '100%', boxSizing: 'border-box' },

  featureList: { listStyle: 'none', padding: 0, margin: '12px 0' },
  featureItem: { fontSize: 13, color: PALETTE.inkSoft, padding: '4px 0' },
}
