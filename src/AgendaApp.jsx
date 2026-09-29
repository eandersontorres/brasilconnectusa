/**
 * AgendaApp — entrada do AgendaPro dentro do app.
 *
 * Antes esta tela mostrava dados de exemplo ("modo demo") com botoes que nao
 * faziam nada. A gestao real da agenda (servicos, horarios, agendamentos, sinal
 * e plano) fica no Painel do Assinante, aba "Profissional". Aqui so apontamos
 * pra la, sem numeros inventados.
 *
 * View da cliente: /agenda/[slug] (pagina estatica).
 */

const PALETTE = {
  paper: '#FAF7F0', paperEl: '#FFFFFF',
  greenDeep: '#1F4D3F', goldDk: '#8C6D3D',
  ink: '#1A1F1C', inkSoft: '#4B4F4D', inkMuted: '#6B6E68', line: '#E5E1D6',
}

const FONT_DISPLAY = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const FONT_TEXT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

const STEPS = [
  ['Crie seu perfil', 'Nome, especialidade, cidade e WhatsApp.'],
  ['Cadastre serviços e horários', 'Duração, preço, sinal e os dias em que você atende.'],
  ['Divulgue seu link', 'A cliente escolhe o horário e você recebe o aviso por e-mail.'],
]

export default function AgendaApp() {
  return (
    <div style={S.wrap}>
      <div style={S.inner}>
        <div style={S.eyebrow}>AGENDAPRO</div>
        <h1 style={S.title}>Sua agenda online, no seu link.</h1>
        <p style={S.lede}>
          Serviços, horários, agendamentos e sinal ficam no Painel do Assinante, na aba Profissional.
        </p>

        <div style={S.actions}>
          <a href="/assinante" style={S.btnPrimary}>Abrir meu painel</a>
          <a href="/agenda/planos" style={S.btnSecondary}>Ver planos</a>
        </div>

        <div style={S.card}>
          {STEPS.map(([title, text], i) => (
            <div key={title} style={{ ...S.step, borderTop: i === 0 ? 'none' : '1px solid ' + PALETTE.line }}>
              <div style={S.stepNum}>{String(i + 1).padStart(2, '0')}</div>
              <div>
                <div style={S.stepTitle}>{title}</div>
                <div style={S.stepText}>{text}</div>
              </div>
            </div>
          ))}
        </div>

        <p style={S.fine}>Starter $19, Pro $39 ou Premium $79 por mês. Os primeiros 14 dias são grátis.</p>
      </div>
    </div>
  )
}

const S = {
  wrap: { fontFamily: FONT_TEXT, color: PALETTE.ink, background: PALETTE.paper, minHeight: '100%' },
  inner: { maxWidth: 560, margin: '0 auto', padding: '36px 20px 96px' },
  eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: PALETTE.goldDk, marginBottom: 10 },
  title: { fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, margin: '0 0 12px' },
  lede: { fontSize: 16, lineHeight: 1.55, color: PALETTE.inkSoft, margin: '0 0 22px' },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 },
  btnPrimary: {
    background: PALETTE.greenDeep, color: '#fff', textDecoration: 'none',
    padding: '13px 22px', borderRadius: 999, fontSize: 15, fontWeight: 600,
  },
  btnSecondary: {
    background: 'transparent', color: PALETTE.ink, textDecoration: 'none',
    border: '1px solid ' + PALETTE.line, padding: '13px 22px', borderRadius: 999, fontSize: 15, fontWeight: 600,
  },
  card: { background: PALETTE.paperEl, border: '1px solid ' + PALETTE.line, borderRadius: 16, padding: '6px 20px' },
  step: { display: 'flex', gap: 16, alignItems: 'flex-start', padding: '16px 0' },
  stepNum: { fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', color: PALETTE.inkMuted, paddingTop: 2 },
  stepTitle: { fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' },
  stepText: { fontSize: 14, lineHeight: 1.5, color: PALETTE.inkSoft, marginTop: 2 },
  fine: { fontSize: 13, color: PALETTE.inkMuted, marginTop: 18 },
}
