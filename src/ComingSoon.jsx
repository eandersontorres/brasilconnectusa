import { useState } from 'react'

/**
 * Página "Em Breve" — premium palette (verde profundo / navy / ouro envelhecido)
 * Renderizada para o público enquanto a Fase 3 não termina.
 * App real disponível em ?preview=brasil2026
 */

const FEATURES = [
  { letter: 'A', title: 'Remessas',   desc: 'Compare Wise, Remitly, Western Union e mais — economize até $200/mês' },
  { letter: 'B', title: 'Câmbio',     desc: 'Alertas de cotação dólar/real direto no seu WhatsApp' },
  { letter: 'C', title: 'Voos',       desc: 'Passagens para o Brasil em tempo real, com alerta de promoção' },
  { letter: 'D', title: 'Negócios',   desc: 'Diretório de empresas brasileiras nos EUA' },
  { letter: 'E', title: 'Bolão',      desc: 'Bolões da comunidade — Copa, eleições, e outros' },
  { letter: 'F', title: 'Comunidade', desc: 'Grupos de interesse, eventos e indicações' },
]

export default function ComingSoon() {
  const [email, setEmail]   = useState('')
  const [city, setCity]     = useState('')
  const [status, setStatus] = useState('idle')
  const [errMsg, setErrMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !email.includes('@')) {
      setErrMsg('Email inválido')
      setStatus('error')
      return
    }
    setStatus('loading')
    setErrMsg('')
    try {
      // Lê código de referral do cookie (setado por /r/CODIGO)
      const refMatch = document.cookie.match(/bc_ref=([A-Z0-9-]+)/i)
      const referralCode = refMatch ? refMatch[1] : null

      const r = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, city, source: 'coming_soon', referralCode })
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao cadastrar')
      }
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setErrMsg(err.message || 'Erro ao cadastrar')
    }
  }

  return (
    <div style={S.page}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <main style={S.container}>
        {/* Logo */}
        <div style={S.logoWrap}>
          <img src="/img/logo.svg" alt="BrasilConnect USA" style={S.logo} />
        </div>

        {/* Hero */}
        <div style={S.eyebrow}>EM CONSTRUÇÃO · LANÇAMENTO 2º SEMESTRE 2026</div>
        <h1 style={S.title}>
          A plataforma para brasileiros nos&nbsp;EUA — em&nbsp;um&nbsp;só&nbsp;lugar.
        </h1>
        <p style={S.tagline}>
          Estamos construindo a ferramenta completa que ajuda você a economizar nas remessas, encontrar voos, conectar-se com a comunidade e dominar a burocracia americana.
        </p>

        {/* Form */}
        {status !== 'success' ? (
          <form onSubmit={handleSubmit} style={S.form}>
            <div style={S.formLabel}>Avise-me quando lançar</div>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              style={S.input}
              disabled={status === 'loading'}
            />
            <input
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Cidade onde mora (opcional)"
              style={S.input}
              disabled={status === 'loading'}
            />
            <button
              type="submit"
              style={{ ...S.button, opacity: status === 'loading' ? 0.55 : 1 }}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Cadastrando…' : 'Entrar para a lista de espera'}
            </button>
            {status === 'error' && <p style={S.error}>{errMsg}</p>}
            <p style={S.privacy}>Nada de spam. Você só recebe um aviso quando lançarmos.</p>
          </form>
        ) : (
          <div style={S.success}>
            <div style={S.successKicker}>CONFIRMADO</div>
            <h2 style={S.successTitle}>Você está na lista.</h2>
            <p style={S.successText}>
              Vamos avisar você assim que lançarmos. Em breve você recebe um email de confirmação.
            </p>
            <p style={{ ...S.successText, marginTop: 16, fontSize: 14 }}>
              <strong style={{ color: PALETTE.ink }}>Indique 3 brasileiros</strong> e receba um Amazon Gift Card de US$ 10.
            </p>
            <a
              href={`/indique/?email=${encodeURIComponent(email)}`}
              style={{ ...S.shareBtn, background: PALETTE.ink, color: PALETTE.paper, border: 'none' }}
            >
              Pegar meu link de indicação →
            </a>
          </div>
        )}

        {/* Features */}
        <div style={S.featuresWrap}>
          <div style={S.featuresKicker}>O QUE ESTÁ VINDO</div>
          <div style={S.features}>
            {FEATURES.map(f => (
              <div key={f.title} style={S.feature}>
                <div style={S.featureLetter}>{f.letter}</div>
                <div style={S.featureBody}>
                  <div style={S.featureName}>{f.title}</div>
                  <div style={S.featureDesc}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Conteúdo já disponível */}
        <div style={S.contentTeaser}>
          <div style={S.contentKicker}>JÁ DISPONÍVEL ENQUANTO O APP NÃO LANÇA</div>
          <div style={S.contentLinks}>
            <a href="/custo-de-vida/" style={S.contentLink}>
              <div style={S.contentLinkTitle}>Custo de vida em 12 cidades</div>
              <div style={S.contentLinkDesc}>Austin, Miami, Boston, NY e mais — comparativo completo</div>
            </a>
            <a href="/guia-chegada/" style={S.contentLink}>
              <div style={S.contentLinkTitle}>Guia de chegada — 90 dias</div>
              <div style={S.contentLinkDesc}>Checklist completo dos primeiros 90 dias nos EUA</div>
            </a>
            <a href="/guias/" style={S.contentLink}>
              <div style={S.contentLinkTitle}>Guias passo a passo</div>
              <div style={S.contentLinkDesc}>CNH, conta bancária, ITIN, plano de saúde, abrir LLC</div>
            </a>
          </div>
        </div>

        {/* Footer */}
        <footer style={S.footer}>
          <div style={S.footerLine}>Feito por brasileiros, para brasileiros</div>
          <div style={S.copyright}>© 2026 BrasilConnect USA</div>
        </footer>
      </main>
    </div>
  )
}

// ── Estilos: paleta premium ─────────────────────────────────────────────
const PALETTE = {
  paper: '#FAF7F0',
  paperSoft: '#F1ECDF',
  paperElevated: '#FFFFFF',
  brandGreen: '#0F5132',
  brandGreenDark: '#073824',
  brandNavy: '#1B2845',
  brandGold: '#B89968',
  brandGoldDark: '#8C6D3D',
  brandGoldSoft: '#F5EFE0',
  ink: '#1A1F1C',
  inkSoft: '#4B4F4D',
  inkMuted: '#6B6E68',
  line: '#E5E1D6',
}

const FONT_SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const FONT_SANS  = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

const S = {
  page: { minHeight: '100vh', background: PALETTE.paper, fontFamily: FONT_SANS, color: PALETTE.ink, padding: '32px 16px' },
  container: { maxWidth: 720, margin: '0 auto', padding: '0 8px' },
  logoWrap: { textAlign: 'center', marginBottom: 56 },
  logo: { height: 48, width: 'auto' },
  eyebrow: { textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 11, fontWeight: 600, color: PALETTE.brandGoldDark, marginBottom: 20 },
  title: { fontFamily: FONT_SERIF, fontSize: 'clamp(2.1rem, 5vw, 3.1rem)', fontWeight: 700, margin: '0 0 20px 0', color: PALETTE.ink, textAlign: 'center', lineHeight: 1.15, letterSpacing: '-0.01em' },
  tagline: { fontSize: '1.05rem', color: PALETTE.inkSoft, textAlign: 'center', maxWidth: 560, margin: '0 auto 48px auto', lineHeight: 1.65 },

  form: { background: PALETTE.paperElevated, border: `1px solid ${PALETTE.line}`, borderRadius: 16, padding: '32px 28px', marginBottom: 56 },
  formLabel: { fontFamily: FONT_SERIF, fontWeight: 600, fontSize: '1.4rem', marginBottom: 18, color: PALETTE.ink, textAlign: 'center' },
  input: { width: '100%', padding: '14px 16px', fontSize: 15, border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 12, boxSizing: 'border-box', fontFamily: FONT_SANS, outline: 'none', background: PALETTE.paper, color: PALETTE.ink },
  button: { width: '100%', padding: '14px 16px', fontSize: 14, fontWeight: 600, letterSpacing: '0.02em', background: PALETTE.ink, color: PALETTE.paper, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: FONT_SANS, transition: 'background 0.15s' },
  privacy: { fontSize: 12, color: PALETTE.inkMuted, marginTop: 14, marginBottom: 0, textAlign: 'center' },
  error: { color: '#9F2D2D', fontSize: 13, marginTop: 12, marginBottom: 0, textAlign: 'center' },

  success: { background: PALETTE.paperElevated, border: `1px solid ${PALETTE.brandGold}`, borderRadius: 16, padding: '36px 28px', marginBottom: 56, textAlign: 'center' },
  successKicker: { textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 11, fontWeight: 600, color: PALETTE.brandGoldDark, marginBottom: 8 },
  successTitle: { fontFamily: FONT_SERIF, color: PALETTE.ink, margin: '0 0 12px 0', fontSize: '1.8rem', fontWeight: 600 },
  successText: { color: PALETTE.inkSoft, margin: 0, fontSize: 15, lineHeight: 1.6 },
  shareBtn: { display: 'inline-block', padding: '12px 24px', textDecoration: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, letterSpacing: '0.01em', marginTop: 12 },

  featuresWrap: { marginBottom: 48 },
  featuresKicker: { textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 11, fontWeight: 600, color: PALETTE.brandGoldDark, marginBottom: 18, textAlign: 'center' },
  features: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 },
  feature: { display: 'flex', alignItems: 'flex-start', gap: 14, background: PALETTE.paperElevated, border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: 18 },
  featureLetter: { width: 36, height: 36, flexShrink: 0, background: PALETTE.brandGoldSoft, color: PALETTE.brandGoldDark, fontFamily: FONT_SERIF, fontWeight: 700, fontSize: 18, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  featureBody: { flex: 1 },
  featureName: { fontWeight: 600, fontSize: 15, color: PALETTE.ink, marginBottom: 3 },
  featureDesc: { fontSize: 13, color: PALETTE.inkMuted, lineHeight: 1.5 },

  contentTeaser: { marginBottom: 56 },
  contentKicker: { textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 11, fontWeight: 600, color: PALETTE.brandGoldDark, marginBottom: 18, textAlign: 'center' },
  contentLinks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 },
  contentLink: { display: 'block', background: PALETTE.paperElevated, border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: 22, textDecoration: 'none', transition: 'border-color 0.15s' },
  contentLinkTitle: { fontFamily: FONT_SERIF, fontSize: '1.15rem', fontWeight: 600, color: PALETTE.ink, marginBottom: 4 },
  contentLinkDesc: { fontSize: 13, color: PALETTE.inkMuted, lineHeight: 1.5 },

  footer: { paddingTop: 32, borderTop: `1px solid ${PALETTE.line}`, textAlign: 'center' },
  footerLine: { fontSize: 13, color: PALETTE.inkMuted },
  copyright: { fontSize: 11, color: PALETTE.inkMuted, marginTop: 6, opacity: 0.7 },
}
