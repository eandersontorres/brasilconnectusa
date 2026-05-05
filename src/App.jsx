import { useState, useEffect, useCallback } from 'react'
import BolaoScreen from './BolaoScreen'
import NegociosScreen from './NegociosScreen'
import AgendaApp from './AgendaApp'
import AppShell from './AppShell'
import PushPrompt from './PushPrompt'
import FeedScreen from './FeedScreen'
import DiscoverScreen from './DiscoverScreen'

// ─── Constantes ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'wise',
    name: 'Wise',
    logoDomain: 'wise.com',
    color: '#00b9a5',
    fee_pct: 0.0067,
    fee_fixed: 0,       // taxa fixa em USD
    spread_pct: 0.005,
    label_fee: '~0.67% + câmbio interbancário',
    speed: 'Até 2 dias úteis',
    speedIcon: '🕐',
    promo: null,
    envKey: 'AFFILIATE_WISE_LINK',
    fallback: 'https://wise.com/send#payouts',
    minAmount: 1,
  },
  {
    id: 'remitly',
    name: 'Remitly',
    logoDomain: 'remitly.com',
    color: '#1565c0',
    fee_pct: 0.0,
    fee_fixed: 0,
    spread_pct: 0.025,
    label_fee: 'Taxa embutida no câmbio',
    speed: 'Em minutos',
    speedIcon: '⚡',
    promo: '1ª transferência grátis',
    envKey: 'AFFILIATE_REMITLY_LINK',
    fallback: 'https://www.remitly.com/us/en/brazil',
    minAmount: 1,
  },
  {
    id: 'western_union',
    name: 'Western Union',
    logoDomain: 'westernunion.com',
    color: '#f5a623',
    fee_pct: 0.0,
    fee_fixed: 0,
    spread_pct: 0.03,
    label_fee: 'Spread ~3% no câmbio',
    speed: 'Em minutos',
    speedIcon: '⚡',
    promo: null,
    envKey: 'AFFILIATE_WU_LINK',
    fallback: 'https://www.westernunion.com/us/en/send-money/app/start',
    minAmount: 1,
  },
  {
    id: 'moneygram',
    name: 'MoneyGram',
    logoDomain: 'moneygram.com',
    color: '#d62b2b',
    fee_pct: 0.0,
    fee_fixed: 1.99,    // taxa fixa típica
    spread_pct: 0.02,
    label_fee: '$1.99 + spread ~2%',
    speed: 'Em minutos',
    speedIcon: '⚡',
    promo: null,
    envKey: 'AFFILIATE_MONEYGRAM_LINK',
    fallback: 'https://www.moneygram.com/mgo/us/en/send-money/send-to/brazil/',
    minAmount: 1,
  },
  {
    id: 'paysend',
    name: 'PaySend',
    logoDomain: 'paysend.com',
    color: '#6d28d9',
    fee_pct: 0.0,
    fee_fixed: 2.0,     // taxa fixa ~$2
    spread_pct: 0.015,
    label_fee: '$2.00 + spread ~1.5%',
    speed: '1–2 dias úteis',
    speedIcon: '🕐',
    promo: '1ª transferência grátis',
    envKey: 'AFFILIATE_PAYSEND_LINK',
    fallback: 'https://paysend.com/en-us/send-money/to/brazil',
    minAmount: 10,
  },
]

const FLIGHT_ORIGINS = [
  { code: 'ATL', city: 'Atlanta' },
  { code: 'AUS', city: 'Austin' },
  { code: 'BOS', city: 'Boston' },
  { code: 'BWI', city: 'Baltimore' },
  { code: 'CLE', city: 'Cleveland' },
  { code: 'CLT', city: 'Charlotte' },
  { code: 'CMH', city: 'Columbus' },
  { code: 'DCA', city: 'Washington (Reagan)' },
  { code: 'DEN', city: 'Denver' },
  { code: 'DFW', city: 'Dallas (DFW)' },
  { code: 'DTW', city: 'Detroit' },
  { code: 'EWR', city: 'Nova York (Newark)' },
  { code: 'FLL', city: 'Fort Lauderdale' },
  { code: 'IAD', city: 'Washington (Dulles)' },
  { code: 'IAH', city: 'Houston' },
  { code: 'IND', city: 'Indianapolis' },
  { code: 'JAX', city: 'Jacksonville' },
  { code: 'JFK', city: 'Nova York (JFK)' },
  { code: 'LAS', city: 'Las Vegas' },
  { code: 'LAX', city: 'Los Angeles' },
  { code: 'LGA', city: 'Nova York (LaGuardia)' },
  { code: 'MCI', city: 'Kansas City' },
  { code: 'MCO', city: 'Orlando' },
  { code: 'MIA', city: 'Miami' },
  { code: 'MKE', city: 'Milwaukee' },
  { code: 'MSP', city: 'Minneapolis' },
  { code: 'MSY', city: 'Nova Orleans' },
  { code: 'OAK', city: 'Oakland' },
  { code: 'ORD', city: 'Chicago (O’Hare)' },
  { code: 'PDX', city: 'Portland' },
  { code: 'PHL', city: 'Filadélfia' },
  { code: 'PHX', city: 'Phoenix' },
  { code: 'PIT', city: 'Pittsburgh' },
  { code: 'RDU', city: 'Raleigh-Durham' },
  { code: 'SAN', city: 'San Diego' },
  { code: 'SAT', city: 'San Antonio' },
  { code: 'SEA', city: 'Seattle' },
  { code: 'SFO', city: 'San Francisco' },
  { code: 'SJC', city: 'San Jose' },
  { code: 'SLC', city: 'Salt Lake City' },
  { code: 'STL', city: 'St. Louis' },
  { code: 'TPA', city: 'Tampa' },
]

const FLIGHT_DESTINATIONS = [
  { code: 'AJU', city: 'Aracaju' },
  { code: 'BEL', city: 'Belém' },
  { code: 'BPS', city: 'Porto Seguro' },
  { code: 'BSB', city: 'Brasília' },
  { code: 'CGB', city: 'Cuiabá' },
  { code: 'CGH', city: 'São Paulo (Congonhas)' },
  { code: 'CGR', city: 'Campo Grande' },
  { code: 'CNF', city: 'Belo Horizonte (Confins)' },
  { code: 'CWB', city: 'Curitiba' },
  { code: 'FLN', city: 'Florianópolis' },
  { code: 'FOR', city: 'Fortaleza' },
  { code: 'GIG', city: 'Rio de Janeiro (Galeão)' },
  { code: 'GRU', city: 'São Paulo (Guarulhos)' },
  { code: 'GYN', city: 'Goiânia' },
  { code: 'IGU', city: 'Foz do Iguaçu' },
  { code: 'IOS', city: 'Ilhéus' },
  { code: 'JPA', city: 'João Pessoa' },
  { code: 'MAO', city: 'Manaus' },
  { code: 'MCZ', city: 'Maceió' },
  { code: 'NAT', city: 'Natal' },
  { code: 'NVT', city: 'Navegantes' },
  { code: 'PMW', city: 'Palmas' },
  { code: 'POA', city: 'Porto Alegre' },
  { code: 'PVH', city: 'Porto Velho' },
  { code: 'RBR', city: 'Rio Branco' },
  { code: 'REC', city: 'Recife' },
  { code: 'SDU', city: 'Rio de Janeiro (Santos Dumont)' },
  { code: 'SLZ', city: 'São Luís' },
  { code: 'SSA', city: 'Salvador' },
  { code: 'THE', city: 'Teresina' },
  { code: 'VCP', city: 'Campinas (Viracopos)' },
  { code: 'VIX', city: 'Vitória' },
]

// Resolve um texto digitado (ex: "Miami", "MIA", "Miami (MIA)") para o codigo IATA
function resolveAirport(input, list) {
  if (!input) return ''
  const txt = String(input).trim()
  // Se ja parece um codigo IATA puro
  if (/^[A-Za-z]{3}$/.test(txt)) {
    const upper = txt.toUpperCase()
    return list.some(a => a.code === upper) ? upper : ''
  }
  // Tenta extrair codigo entre parenteses: "Miami (MIA)"
  const parens = txt.match(/\(([A-Za-z]{3})\)/)
  if (parens) {
    const upper = parens[1].toUpperCase()
    if (list.some(a => a.code === upper)) return upper
  }
  // Match por nome de cidade (case-insensitive, comeca com)
  const lower = txt.toLowerCase()
  const exact = list.find(a => a.city.toLowerCase() === lower)
  if (exact) return exact.code
  const startsWith = list.find(a => a.city.toLowerCase().startsWith(lower))
  if (startsWith) return startsWith.code
  return ''
}

// ─── Logo do parceiro (Clearbit + fallback) ────────────────────────────────────

function ProviderLogo({ provider, size = 28 }) {
  const [errored, setErrored] = useState(false)
  const initials = provider.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  if (errored || !provider.logoDomain) {
    return (
      <span style={{
        width: size, height: size, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#F1ECDF', color: '#8C6D3D',
        fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 700,
        fontSize: size * 0.45, borderRadius: size * 0.18,
        border: '1px solid #E5E1D6', flexShrink: 0,
      }}>{initials}</span>
    )
  }
  return (
    <img
      src={`https://logo.clearbit.com/${provider.logoDomain}`}
      alt={provider.name}
      onError={() => setErrored(true)}
      style={{
        width: size, height: size, objectFit: 'contain',
        background: '#FAF7F0', borderRadius: size * 0.18,
        border: '1px solid #E5E1D6', padding: 4, flexShrink: 0,
      }}
    />
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function calcReceived(usd, provider, midRate) {
  if (!midRate || usd <= 0) return 0
  const afterFee = (usd - provider.fee_fixed) * (1 - provider.fee_pct)
  if (afterFee <= 0) return 0
  const effectiveRate = midRate * (1 - provider.spread_pct)
  return afterFee * effectiveRate
}

// Calcula quanto enviar em USD para chegar um valor em BRL
function calcSendAmount(brl, provider, midRate) {
  if (!midRate || brl <= 0) return 0
  const effectiveRate = midRate * (1 - provider.spread_pct)
  if (effectiveRate <= 0) return 0
  // received_brl = (usd - fee_fixed) * (1 - fee_pct) * effectiveRate
  // usd = brl / (effectiveRate * (1 - fee_pct)) + fee_fixed
  const usd = brl / (effectiveRate * (1 - provider.fee_pct)) + provider.fee_fixed
  return usd
}

function fmtBRL(val) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtUSD(val) {
  return Number(val).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// ─── Componentes de UI ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <div style={{
        width: 32, height: 32, border: '3px solid #e5e7eb',
        borderTopColor: '#009c3b', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  const colors = { success: '#dcfce7', error: '#fee2e2', info: '#dbeafe' }
  const borders = { success: '#86efac', error: '#fca5a5', info: '#93c5fd' }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' }

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: colors[type] || colors.info,
      border: `1px solid ${borders[type] || borders.info}`,
      borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
      maxWidth: 'calc(100vw - 32px)',
    }}>
      {icons[type]} {msg}
    </div>
  )
}

// ─── Provider Detail Modal ─────────────────────────────────────────────────────

function ProviderDetail({ provider, amount, midRate, isUSD, onClose, onSend }) {
  const usdAmount = isUSD ? amount : calcSendAmount(amount, provider, midRate)
  const brlAmount = isUSD ? calcReceived(amount, provider, midRate) : amount
  const effectiveRate = midRate * (1 - provider.spread_pct)
  const feeAmount = provider.fee_fixed + (usdAmount * provider.fee_pct)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 1000, display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div
        style={{
          background: '#fff', borderRadius: '20px 20px 0 0',
          padding: '24px 20px 40px', width: '100%', maxWidth: 480,
          margin: '0 auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div style={{
          width: 36, height: 4, background: '#e5e7eb', borderRadius: 4,
          margin: '0 auto 20px',
        }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <ProviderLogo provider={provider} size={40} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1F1C' }}>{provider.name}</div>
            <div style={{ fontSize: 12, color: '#6B6E68' }}>{provider.speed}</div>
          </div>
          {provider.promo && (
            <div style={{
              marginLeft: 'auto',
              background: '#F5EFE0', color: '#8C6D3D',
              fontSize: 10, fontWeight: 600, padding: '4px 10px',
              borderRadius: 20, border: '1px solid #B89968',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {provider.promo}
            </div>
          )}
        </div>

        {/* Breakdown */}
        <div style={{
          background: '#f9fafb', borderRadius: 12,
          padding: '16px', marginBottom: 20,
          border: '1px solid #e5e7eb',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Detalhamento
          </div>
          {[
            ['Você envia', fmtUSD(usdAmount)],
            ['Taxa do serviço', `− ${fmtUSD(feeAmount)}`],
            ['Câmbio aplicado', `R$ ${effectiveRate.toFixed(4)}/USD`],
            ['Taxa de mercado', `R$ ${midRate.toFixed(4)}/USD`],
            ['Spread (custo câmbio)', `${(provider.spread_pct * 100).toFixed(1)}%`],
          ].map(([label, value]) => (
            <div key={label} style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 13, padding: '5px 0',
              borderBottom: '1px solid #f3f4f6',
            }}>
              <span style={{ color: '#6b7280' }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value}</span>
            </div>
          ))}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 10, paddingTop: 10,
            borderTop: '2px solid #e5e7eb',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#4B4F4D' }}>Destinatário recebe</span>
            <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 22, fontWeight: 700, color: '#1A1F1C' }}>
              {fmtBRL(brlAmount)}
            </span>
          </div>
        </div>

        <button
          onClick={() => { onSend(provider); onClose() }}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 10,
            background: '#1A1F1C', color: '#FAF7F0',
            fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          Enviar com {provider.name} →
        </button>
      </div>
    </div>
  )
}

// ─── Tela: Remessas ────────────────────────────────────────────────────────────

function RemessasScreen({ affiliateLinks }) {
  const [isUSD, setIsUSD] = useState(true)          // true = digita USD, false = digita BRL
  const [amount, setAmount] = useState(500)
  const [rateData, setRateData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null) // provider detail modal

  const fetchRate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/rates')
      if (!res.ok) throw new Error('Erro ao buscar taxa')
      const data = await res.json()
      setRateData(data)
    } catch (e) {
      setError('Não foi possível carregar a taxa ao vivo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRate() }, [fetchRate])

  const midRate = rateData?.mid_rate || 0

  async function handleSend(provider) {
    try {
      await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.id, amount_usd: isUSD ? amount : calcSendAmount(amount, provider, midRate) }),
      })
    } catch (_) {}
    const link = affiliateLinks[provider.envKey] || provider.fallback
    window.open(link, '_blank', 'noopener')
  }

  // Ordena por melhor valor recebido (ou menor valor a enviar no modo BRL)
  const sorted = [...PROVIDERS].sort((a, b) => {
    if (isUSD) {
      return calcReceived(amount, b, midRate) - calcReceived(amount, a, midRate)
    } else {
      return calcSendAmount(amount, a, midRate) - calcSendAmount(amount, b, midRate)
    }
  })

  const QUICK_AMOUNTS_USD = [100, 300, 500, 1000]
  const QUICK_AMOUNTS_BRL = [500, 1000, 2000, 5000]

  return (
    <div style={{ padding: '0 0 16px' }}>
      {expandedId && (
        <ProviderDetail
          provider={PROVIDERS.find(p => p.id === expandedId)}
          amount={amount}
          midRate={midRate}
          isUSD={isUSD}
          onClose={() => setExpandedId(null)}
          onSend={handleSend}
        />
      )}

      {/* Cabeçalho taxa */}
      <div style={{
        background: 'linear-gradient(135deg, #009c3b 0%, #006428 100%)',
        borderRadius: 14, padding: '20px 18px', marginBottom: 16, color: '#fff',
      }}>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
          Taxa de câmbio ao vivo (USD → BRL)
        </div>
        {loading ? (
          <div style={{ fontSize: 28, fontWeight: 700 }}>Carregando…</div>
        ) : error ? (
          <div style={{ fontSize: 14, color: '#fca5a5' }}>{error}</div>
        ) : (
          <>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>
              R$ {midRate.toFixed(4)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {rateData?.source === 'exchangerate-api' ? '● Taxa real' : '○ Estimativa'} • Atualizado agora
              </div>
              <button
                onClick={fetchRate}
                style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none',
                  borderRadius: 6, padding: '3px 8px', color: '#fff',
                  fontSize: 11, cursor: 'pointer',
                }}
              >
                ↺ Atualizar
              </button>
            </div>
          </>
        )}
      </div>

      {/* Toggle USD ↔ BRL + Input de valor */}
      <div style={{ marginBottom: 16 }}>
        {/* Toggle */}
        <div style={{
          display: 'flex', background: '#f3f4f6', borderRadius: 10,
          padding: 3, marginBottom: 10,
        }}>
          {[
            { val: true,  label: 'Envio em USD 🇺🇸' },
            { val: false, label: 'Chegada em BRL 🇧🇷' },
          ].map(opt => (
            <button
              key={String(opt.val)}
              onClick={() => { setIsUSD(opt.val); setAmount(opt.val ? 500 : 2500) }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: isUSD === opt.val ? '#fff' : 'transparent',
                color: isUSD === opt.val ? '#111827' : '#6b7280',
                border: 'none',
                boxShadow: isUSD === opt.val ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                transition: 'all .15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10,
          padding: '10px 14px',
        }}>
          <span style={{ fontSize: 16, color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>
            {isUSD ? '$' : 'R$'}
          </span>
          <input
            type="number"
            value={amount}
            min={isUSD ? 1 : 10}
            onChange={e => setAmount(Math.max(isUSD ? 1 : 10, Number(e.target.value)))}
            style={{
              border: 'none', outline: 'none', fontSize: 22, fontWeight: 700,
              width: '100%', color: '#111827', background: 'transparent',
            }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>
            {isUSD ? 'USD' : 'BRL'}
          </span>
        </div>

        {/* Quick amounts */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {(isUSD ? QUICK_AMOUNTS_USD : QUICK_AMOUNTS_BRL).map(v => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              style={{
                flex: 1, fontSize: 12, padding: '6px 0', borderRadius: 7,
                background: amount === v ? '#009c3b' : '#f3f4f6',
                color: amount === v ? '#fff' : '#374151',
                fontWeight: 500, border: 'none',
              }}
            >
              {isUSD ? `$${v}` : `R$${v}`}
            </button>
          ))}
        </div>
      </div>

      {/* Label */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, fontWeight: 500 }}>
        {isUSD
          ? `Comparando quanto chega no Brasil para ${fmtUSD(amount)} enviados`
          : `Comparando quanto você precisa enviar para chegarem ${fmtBRL(amount)}`
        }
      </div>

      {/* Cards provedores */}
      {loading ? <Spinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((p, idx) => {
            const received = isUSD
              ? calcReceived(amount, p, midRate)
              : amount
            const sendUsd = isUSD
              ? amount
              : calcSendAmount(amount, p, midRate)

            const isBest = idx === 0
            const isInvalid = received <= 0 || sendUsd < p.minAmount

            return (
              <div
                key={p.id}
                style={{
                  background: '#FFFFFF',
                  border: isBest ? '1.5px solid #B89968' : '1px solid #E5E1D6',
                  borderRadius: 14, padding: '14px 16px',
                  position: 'relative',
                  opacity: isInvalid ? 0.5 : 1,
                }}
              >
                {isBest && !isInvalid && (
                  <div style={{
                    position: 'absolute', top: -10, left: 14,
                    background: '#1A1F1C', color: '#FAF7F0',
                    fontSize: 9, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                  }}>
                    Melhor opção
                  </div>
                )}

                {/* Promo badge */}
                {p.promo && (
                  <div style={{
                    position: 'absolute', top: -10, right: 14,
                    background: '#F5EFE0', color: '#8C6D3D',
                    fontSize: 9, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                    border: '1px solid #B89968',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {p.promo}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <ProviderLogo provider={p} size={36} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1F1C', marginBottom: 2 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#6B6E68', marginBottom: 4 }}>{p.label_fee}</div>
                      <div style={{ fontSize: 11, color: '#8C8E89' }}>{p.speed}</div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    {isUSD ? (
                      <>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 22, fontWeight: 700, color: '#1A1F1C' }}>
                          {isInvalid ? '—' : fmtBRL(received)}
                        </div>
                        <div style={{ fontSize: 10, color: '#8C8E89', textTransform: 'uppercase', letterSpacing: '0.06em' }}>recebido no Brasil</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 22, fontWeight: 700, color: '#1A1F1C' }}>
                          {isInvalid ? '—' : fmtUSD(sendUsd)}
                        </div>
                        <div style={{ fontSize: 10, color: '#8C8E89', textTransform: 'uppercase', letterSpacing: '0.06em' }}>você envia</div>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {/* Detalhes */}
                  <button
                    onClick={() => setExpandedId(p.id)}
                    style={{
                      padding: '9px 16px', borderRadius: 8,
                      background: 'transparent', color: '#1A1F1C',
                      fontSize: 12, fontWeight: 500, border: '1px solid #E5E1D6',
                      cursor: 'pointer',
                    }}
                  >
                    Ver detalhes
                  </button>
                  {/* Enviar */}
                  <button
                    onClick={() => handleSend(p)}
                    disabled={isInvalid}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8,
                      background: isInvalid ? '#E5E1D6' : '#1A1F1C',
                      color: isInvalid ? '#8C8E89' : '#FAF7F0',
                      fontSize: 13, fontWeight: 600, border: 'none', cursor: isInvalid ? 'default' : 'pointer',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Enviar com {p.name} →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div style={{
        marginTop: 16, fontSize: 11, color: '#9ca3af',
        lineHeight: 1.5, textAlign: 'center', padding: '0 8px',
      }}>
        ⓘ Links são de afiliados. Recebemos comissão quando você completa uma transferência —
        sem custo adicional para você. Taxas são estimativas e podem variar.
      </div>
    </div>
  )
}

// ─── Tela: Alertas ─────────────────────────────────────────────────────────────

function AlertasScreen() {
  const [email, setEmail] = useState('')
  const [targetRate, setTargetRate] = useState('')
  const [direction, setDirection] = useState('above')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !targetRate) return

    setLoading(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          target_rate: Number(targetRate),
          direction,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar alerta')

      setToast({ msg: `Alerta criado! Vamos avisar quando chegar R$${targetRate}`, type: 'success' })
      setEmail('')
      setTargetRate('')
    } catch (err) {
      setToast({ msg: err.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #002776 0%, #1e40af 100%)',
        borderRadius: 14, padding: '20px 18px', marginBottom: 20, color: '#fff',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>🔔 Alertas de Câmbio</div>
        <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
          Te avisamos por email quando o dólar chegar na taxa que você quer.
          Gratuito e sem cadastro.
        </div>
      </div>

      {/* Formulário */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
            Seu e-mail
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="voce@email.com"
            required
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              border: '1.5px solid #e5e7eb', fontSize: 15, outline: 'none',
              background: '#fff', boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 6 }}>
            Avisar quando o câmbio estiver
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[
              { value: 'above', label: '↑ Acima de' },
              { value: 'below', label: '↓ Abaixo de' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDirection(opt.value)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 9,
                  border: `1.5px solid ${direction === opt.value ? '#002776' : '#e5e7eb'}`,
                  background: direction === opt.value ? '#eff6ff' : '#fff',
                  color: direction === opt.value ? '#002776' : '#6b7280',
                  fontWeight: direction === opt.value ? 600 : 400,
                  fontSize: 13,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, color: '#6b7280', fontWeight: 500 }}>R$</span>
            <input
              type="number"
              step="0.01"
              value={targetRate}
              onChange={e => setTargetRate(e.target.value)}
              placeholder="5.50"
              required
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 10,
                border: '1.5px solid #e5e7eb', fontSize: 18, fontWeight: 600,
                outline: 'none', background: '#fff',
              }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !email || !targetRate}
          style={{
            padding: '13px 0', borderRadius: 10,
            background: loading ? '#9ca3af' : '#009c3b',
            color: '#fff', fontSize: 15, fontWeight: 600,
            opacity: !email || !targetRate ? 0.5 : 1,
            border: 'none',
          }}
        >
          {loading ? 'Criando alerta…' : 'Criar alerta gratuito'}
        </button>
      </form>

      {/* Como funciona */}
      <div style={{
        marginTop: 24, background: '#f9fafb', borderRadius: 12,
        padding: '16px', border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#374151' }}>
          Como funciona
        </div>
        {[
          ['1', 'Informe sua taxa alvo e e-mail'],
          ['2', 'Verificamos o câmbio a cada 30 minutos'],
          ['3', 'Quando atingir, você recebe um email na hora'],
        ].map(([n, text]) => (
          <div key={n} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', background: '#002776',
              color: '#fff', fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{n}</div>
            <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tela: Voos ────────────────────────────────────────────────────────────────

function VoosScreen({ affiliateLinks }) {
  // Texto livre digitado pelo usuario (ex: "Miami (MIA)" ou "Salvador")
  const [originText, setOriginText] = useState('Austin (AUS)')
  const [destinationText, setDestinationText] = useState('São Paulo (Guarulhos) (GRU)')
  const [departDate, setDepartDate] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [flights, setFlights] = useState(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)

  // Codigos IATA resolvidos a partir do texto
  const origin = resolveAirport(originText, FLIGHT_ORIGINS)
  const destination = resolveAirport(destinationText, FLIGHT_DESTINATIONS)

  async function handleSearch(e) {
    e.preventDefault()
    if (!departDate) return
    if (!origin) {
      setToast({ msg: 'Aeroporto de origem inválido. Escolha da lista.', type: 'error' })
      return
    }
    if (!destination) {
      setToast({ msg: 'Aeroporto de destino inválido. Escolha da lista.', type: 'error' })
      return
    }
    setLoading(true)
    setFlights(null)
    try {
      const params = new URLSearchParams({ origin, destination, depart_date: departDate })
      if (returnDate) params.append('return_date', returnDate)
      const res = await fetch(`/api/flights?${params}`)
      if (!res.ok) throw new Error('Erro ao buscar voos')
      const data = await res.json()
      setFlights(data)
    } catch (err) {
      setToast({ msg: 'Erro ao buscar voos. Tente novamente.', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleFlightClick(provider_id, link) {
    try {
      await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: `flight_${provider_id}` }),
      })
    } catch (_) {}
    window.open(link, '_blank', 'noopener')
  }

  const minDate = new Date().toISOString().split('T')[0]

  return (
    <div style={{ padding: '0 0 16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)',
        borderRadius: 14, padding: '20px 18px', marginBottom: 20, color: '#fff',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>✈️ Voos para o Brasil</div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>Encontre as melhores tarifas de volta pro Brasil</div>
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <datalist id="dl-origins">
          {FLIGHT_ORIGINS.map(o => (
            <option key={o.code} value={`${o.city} (${o.code})`} />
          ))}
        </datalist>
        <datalist id="dl-destinations">
          {FLIGHT_DESTINATIONS.map(d => (
            <option key={d.code} value={`${d.city} (${d.code})`} />
          ))}
        </datalist>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', display: 'block', marginBottom: 5 }}>
              Origem
            </label>
            <input
              type="text"
              list="dl-origins"
              value={originText}
              onChange={e => setOriginText(e.target.value)}
              placeholder="Cidade ou código (ex: MIA)"
              autoComplete="off"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: `1.5px solid ${origin || !originText ? '#e5e7eb' : '#fca5a5'}`,
                fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', display: 'block', marginBottom: 5 }}>
              Destino
            </label>
            <input
              type="text"
              list="dl-destinations"
              value={destinationText}
              onChange={e => setDestinationText(e.target.value)}
              placeholder="Cidade ou código (ex: GRU)"
              autoComplete="off"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: `1.5px solid ${destination || !destinationText ? '#e5e7eb' : '#fca5a5'}`,
                fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', display: 'block', marginBottom: 5 }}>
              Ida
            </label>
            <input
              type="date"
              value={departDate}
              min={minDate}
              onChange={e => setDepartDate(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: '1.5px solid #e5e7eb', fontSize: 14, background: '#fff', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', display: 'block', marginBottom: 5 }}>
              Volta (opcional)
            </label>
            <input
              type="date"
              value={returnDate}
              min={departDate || minDate}
              onChange={e => setReturnDate(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: '1.5px solid #e5e7eb', fontSize: 14, background: '#fff', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !departDate}
          style={{
            padding: '13px 0', borderRadius: 10,
            background: loading ? '#9ca3af' : '#1e3a5f',
            color: '#fff', fontSize: 15, fontWeight: 600,
            border: 'none', cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Buscando voos…' : 'Buscar voos'}
        </button>
      </form>

      {loading && <Spinner />}

      {flights && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
            Resultados para {origin} → {destination}
          </div>
          {flights.results?.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '24px 0' }}>
              Nenhum voo encontrado para essa data.
            </div>
          )}
          {flights.results?.map((f, i) => {
            const hasPrice = f.price != null && f.price > 0
            const stopsLabel = f.stops == null
              ? 'Compare em tempo real abaixo'
              : (f.stops === 0 ? 'Voo direto' : (f.stops === 1 ? '1 escala' : `${f.stops} escalas`))
            return (
              <div key={i} style={{
                background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12,
                padding: '14px 16px', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{f.airline}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{stopsLabel}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {hasPrice ? (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 18, color: '#009c3b' }}>
                          a partir de {fmtUSD(f.price)}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>por pessoa</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>
                        Veja preços ao vivo →
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {f.links?.map(link => (
                    <button
                      key={link.provider}
                      onClick={() => handleFlightClick(link.provider, link.url)}
                      style={{
                        flex: '1 1 100px', padding: '8px 10px', borderRadius: 8,
                        background: '#f3f4f6', color: '#374151',
                        fontSize: 12, fontWeight: 600, border: '1px solid #e5e7eb',
                        cursor: 'pointer',
                      }}
                    >
                      Ver no {link.provider}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
            Comparamos preços nos principais sites em tempo real pra você.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── App Principal (usa AppShell responsivo) ──────────────────────────────

export default function App() {
  const [tab, setTab] = useState('feed')
  const [affiliateLinks, setAffiliateLinks] = useState({})

  useEffect(() => {
    fetch('/api/rates')
      .then(r => r.json())
      .then(d => { if (d.affiliate_links) setAffiliateLinks(d.affiliate_links) })
      .catch(() => {})
  }, [])

  return (
    <>
      <AppShell tab={tab} setTab={setTab}>
        {tab === 'feed'     && <FeedScreen onNavigate={setTab} />}
        {tab === 'discover' && <DiscoverScreen onNavigate={setTab} />}
        {tab === 'remessas' && <RemessasScreen affiliateLinks={affiliateLinks} />}
        {tab === 'voos'     && <VoosScreen affiliateLinks={affiliateLinks} />}
        {tab === 'agenda'   && <AgendaApp />}
        {tab === 'negocios' && <NegociosScreen />}
        {tab === 'bolao'    && <BolaoScreen />}
      </AppShell>
      <PushPrompt />
    </>
  )
}
