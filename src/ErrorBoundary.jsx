import { Component } from 'react'

/**
 * Captura erros JS não tratados em qualquer descendente e mostra fallback
 * em vez de tela branca. Crítico em produção — bug de runtime de uma feature
 * não pode derrubar o app inteiro.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (typeof window !== 'undefined' && window.console) {
      console.error('[ErrorBoundary]', error, info?.componentStack)
    }
  }

  handleReload = () => {
    try { window.location.reload() } catch (_) {}
  }

  handleGoHome = () => {
    try { window.location.href = '/' } catch (_) {}
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        minHeight: '100vh', background: '#FAF7F0', color: '#1A1F1C',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
        <div style={{
          background: '#fff', border: '1px solid #E5E1D6', borderRadius: 16,
          padding: '36px 28px', maxWidth: 460, width: '100%', textAlign: 'center',
        }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>😬</div>
          <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 24, fontWeight: 700, color: '#001a5e', margin: '0 0 10px', letterSpacing: -0.3 }}>
            Algo travou aqui
          </h1>
          <p style={{ fontSize: 14, color: '#6B6E68', lineHeight: 1.6, margin: '0 0 22px' }}>
            Foi mal! Um erro inesperado aconteceu. Tenta atualizar a página — quase sempre resolve.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={this.handleReload}
              style={{
                background: '#009c3b', color: '#fff', border: 'none', borderRadius: 10,
                padding: '13px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ↻ Atualizar página
            </button>
            <button
              onClick={this.handleGoHome}
              style={{
                background: 'transparent', color: '#001a5e', border: '1.5px solid #E5E1D6',
                borderRadius: 10, padding: '11px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Voltar pra home
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 20, lineHeight: 1.5 }}>
            Se o problema persistir, escreve pra <a href="mailto:oi@brasilconnectusa.com" style={{ color: '#001a5e', fontWeight: 600 }}>oi@brasilconnectusa.com</a>
          </div>
        </div>
      </div>
    )
  }
}
