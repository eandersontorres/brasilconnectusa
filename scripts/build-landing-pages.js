#!/usr/bin/env node
/**
 * Gera as páginas estáticas do Módulo 02:
 *   - 12 páginas /custo-de-vida/[cidade].html
 *   - 6 páginas /guias/[tema].html
 *   - 1 página índice /custo-de-vida/index.html
 *   - 1 página índice /guias/index.html
 *   - sitemap.xml atualizado
 *
 * Uso: node scripts/build-landing-pages.js
 */

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PUB  = path.join(ROOT, 'public')

const cities  = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/cities.json'), 'utf8')).cities
const guides  = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/guides.json'), 'utf8')).guides

const SITE_URL = 'https://brasilconnectusa.com'

// ── Helpers ────────────────────────────────────────────────────────────
const fmt = (n) => '$' + n.toLocaleString('en-US')
const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))

// ── Header / Footer compartilhados ─────────────────────────────────────
function renderHead({ title, description, canonical, jsonLd, robots = 'index, follow, max-image-preview:large' }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="canonical" href="${canonical}">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${robots}">
  <meta name="theme-color" content="#0F5132">
  <meta name="author" content="BrasilConnect USA">

  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="BrasilConnect USA">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${SITE_URL}/og-image.png">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- Premium design system -->
  <link rel="stylesheet" href="/css/premium.css">

  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XXXXXXXXXX',{anonymize_ip:true});</script>

  <!-- Meta Pixel -->
  <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','XXXXXXXXXXXXXXX');fbq('track','PageView');</script>

  <!-- BC tracking helper -->
  <script src="/js/site.js" defer></script>

  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>` : ''}
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a class="logo" href="/">
        <img src="/img/logo.svg" alt="BrasilConnect USA" />
      </a>
      <nav class="site-nav">
        <a href="/custo-de-vida/">Custo de Vida</a>
        <a href="/guias/">Guias</a>
        <a href="/?preview=brasil2026">App</a>
      </nav>
    </div>
  </header>
`
}

function renderFooter() {
  return `
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="footer-logo">
            <img src="/img/logo.svg" alt="BrasilConnect USA" />
          </div>
          <p class="footer-tagline">A plataforma para brasileiros nos EUA — feita por brasileiros, para brasileiros.</p>
        </div>
        <div>
          <h4>Cidades</h4>
          ${cities.slice(0, 6).map(c => `<a href="/custo-de-vida/${c.slug}/">${c.name}, ${c.stateCode}</a>`).join('')}
        </div>
        <div>
          <h4>Guias</h4>
          ${guides.map(g => `<a href="/guias/${g.slug}/">${g.shortTitle}</a>`).join('')}
        </div>
        <div>
          <h4>Sobre</h4>
          <a href="/">Início</a>
          <a href="/custo-de-vida/">Todas as cidades</a>
          <a href="/guias/">Todos os guias</a>
        </div>
      </div>
      <div class="footer-bottom">
        © 2026 BrasilConnect USA · Todos os direitos reservados.
      </div>
    </div>
  </footer>
</body>
</html>`
}

// ── Página de Cidade ───────────────────────────────────────────────────
function renderCityPage(c) {
  const title = `Custo de vida em ${c.name}, ${c.stateCode} para brasileiros — 2026`
  const desc  = `Quanto custa morar em ${c.name}, ${c.state} como brasileiro: aluguel, mercado, transporte, saúde e custo total para solteiros, casais e famílias. Atualizado 2026.`
  const url   = `${SITE_URL}/custo-de-vida/${c.slug}/`

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description: desc,
      url,
      author: { '@type': 'Organization', name: 'BrasilConnect USA' },
      publisher: { '@type': 'Organization', name: 'BrasilConnect USA', logo: { '@type': 'ImageObject', url: `${SITE_URL}/img/logo.svg` } },
      datePublished: '2026-04-30',
      dateModified: '2026-04-30',
      inLanguage: 'pt-BR',
      mainEntityOfPage: url,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: c.faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    }
  ]

  const relatedGuides = (c.relatedGuides || []).map(s => guides.find(g => g.slug === s)).filter(Boolean)
  const otherCities = cities.filter(o => o.slug !== c.slug).slice(0, 4)

  return renderHead({ title, description: desc, canonical: url, jsonLd }) + `
  <main>
    <section class="hero">
      <div class="container-narrow">
        <div class="eyebrow">Custo de Vida · ${escapeHtml(c.state)}</div>
        <h1>Custo de vida em ${escapeHtml(c.name)}, ${escapeHtml(c.stateCode)} para brasileiros</h1>
        <p class="lede">${escapeHtml(c.intro)}</p>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <div class="stats-grid">
          <div class="card-stat">
            <div class="label">Aluguel · 1 quarto</div>
            <div class="value">${fmt(c.rent1br)}<span style="font-size:0.85rem;color:var(--ink-muted);font-weight:400">/mês</span></div>
            <div class="sub">média mensal</div>
          </div>
          <div class="card-stat">
            <div class="label">Aluguel · 2 quartos</div>
            <div class="value">${fmt(c.rent2br)}<span style="font-size:0.85rem;color:var(--ink-muted);font-weight:400">/mês</span></div>
            <div class="sub">média mensal</div>
          </div>
          <div class="card-stat">
            <div class="label">Salário médio</div>
            <div class="value">${fmt(c.salaryAvg)}<span style="font-size:0.85rem;color:var(--ink-muted);font-weight:400">/ano</span></div>
            <div class="sub">profissionais qualificados</div>
          </div>
          <div class="card-stat">
            <div class="label">Mercado · família</div>
            <div class="value">${fmt(c.groceriesFamily)}<span style="font-size:0.85rem;color:var(--ink-muted);font-weight:400">/mês</span></div>
            <div class="sub">4 pessoas</div>
          </div>
        </div>
      </div>
    </section>

    <section class="section-prose">
      <div class="container-narrow prose">
        <h2>Pontos-chave de morar em ${escapeHtml(c.name)} como brasileiro</h2>
        <ul>
          ${c.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join('\n          ')}
        </ul>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Onde os brasileiros moram em ${escapeHtml(c.name)}</h2>
        <div class="related-grid">
          ${c.neighborhoods.map(n => `
          <div class="related-card">
            <div class="related-eyebrow">Bairro</div>
            <div class="related-title">${escapeHtml(n.name)}</div>
            <div class="related-desc">${escapeHtml(n.desc)}</div>
          </div>`).join('')}
        </div>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Custo total mensal</h2>
        <p>Estimativa para vida em padrão classe média, em bairros com boa qualidade. Inclui moradia, mercado, transporte, saúde e contas básicas.</p>
        <table class="data">
          <thead>
            <tr>
              <th>Composição familiar</th>
              <th>Custo mensal</th>
              <th>Anual aproximado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Solteiro(a)</td>
              <td>${fmt(c.totals.single)}</td>
              <td>${fmt(c.totals.single * 12)}</td>
            </tr>
            <tr>
              <td>Casal sem filhos</td>
              <td>${fmt(c.totals.couple)}</td>
              <td>${fmt(c.totals.couple * 12)}</td>
            </tr>
            <tr>
              <td>Família com 2 filhos</td>
              <td>${fmt(c.totals.family4)}</td>
              <td>${fmt(c.totals.family4 * 12)}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted" style="font-size:0.85rem;">Valores são estimativas baseadas em médias de mercado em 2026. O custo real varia conforme bairro, escolas e estilo de vida. Não inclui poupança, viagens ou despesas extraordinárias.</p>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Detalhamento de gastos</h2>
        <table class="data">
          <thead>
            <tr><th>Categoria</th><th>Solteiro</th><th>Família 4</th></tr>
          </thead>
          <tbody>
            <tr><td>Aluguel (1 quarto vs. casa)</td><td>${fmt(c.rent1br)}</td><td>${fmt(c.rentHouse)}</td></tr>
            <tr><td>Mercado e alimentação</td><td>${fmt(c.groceriesSingle)}</td><td>${fmt(c.groceriesFamily)}</td></tr>
            <tr><td>Transporte (carro + seguro + gas)</td><td>${fmt(c.transportCar)}</td><td>${fmt(c.transportCar + 280)}</td></tr>
            <tr><td>Saúde (plano)</td><td>${fmt(c.healthSingle)}</td><td>${fmt(c.healthSingle * 3)}</td></tr>
            <tr><td>Internet, celular, luz, gás</td><td>$280</td><td>$420</td></tr>
            <tr><td>Lazer, comida fora</td><td>$320</td><td>$680</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Perguntas frequentes</h2>
        ${c.faqs.map(f => `
        <details class="faq-item">
          <summary>${escapeHtml(f.q)}</summary>
          <p>${escapeHtml(f.a)}</p>
        </details>`).join('')}
      </div>
    </section>

    ${relatedGuides.length > 0 ? `
    <section>
      <div class="container-narrow">
        <h2>Guias úteis para quem mora em ${escapeHtml(c.name)}</h2>
        <div class="related-grid">
          ${relatedGuides.map(g => `
          <a class="related-card" href="/guias/${g.slug}/">
            <div class="related-eyebrow">Guia passo a passo</div>
            <div class="related-title">${escapeHtml(g.shortTitle)}</div>
            <div class="related-desc">${escapeHtml(g.intro.slice(0, 110))}…</div>
          </a>`).join('')}
        </div>
      </div>
    </section>` : ''}

    <section>
      <div class="container-narrow">
        <h2>Outras cidades</h2>
        <div class="related-grid">
          ${otherCities.map(o => `
          <a class="related-card" href="/custo-de-vida/${o.slug}/">
            <div class="related-eyebrow">${escapeHtml(o.state)}</div>
            <div class="related-title">${escapeHtml(o.name)}, ${escapeHtml(o.stateCode)}</div>
            <div class="related-desc">A partir de ${fmt(o.totals.single)}/mês para solteiros</div>
          </a>`).join('')}
        </div>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <div class="cta-section">
          <h2>Quer ser avisado quando o app estiver pronto?</h2>
          <p class="lede">Cadastre seu email e receba uma mensagem assim que lançarmos a plataforma com mais ferramentas para brasileiros nos EUA.</p>
          <a href="/" class="btn btn-primary">Entrar na lista de espera →</a>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}`
}

// ── Página de Guia ─────────────────────────────────────────────────────
function renderGuidePage(g) {
  const title = `${g.title} — BrasilConnect USA`
  const desc = g.metaDesc
  const url = `${SITE_URL}/guias/${g.slug}/`

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: g.shortTitle,
      description: g.metaDesc,
      url,
      totalTime: g.timeEstimate,
      estimatedCost: { '@type': 'MonetaryAmount', currency: 'USD', value: g.cost },
      step: g.steps.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: s.title,
        text: s.body
      }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: g.faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    }
  ]

  const otherGuides = guides.filter(o => o.slug !== g.slug).slice(0, 3)

  return renderHead({ title, description: desc, canonical: url, jsonLd }) + `
  <main>
    <section class="hero">
      <div class="container-narrow">
        <div class="eyebrow">Guia passo a passo</div>
        <h1>${escapeHtml(g.title)}</h1>
        <p class="lede">${escapeHtml(g.intro)}</p>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <div class="stats-grid">
          <div class="card-stat">
            <div class="label">Dificuldade</div>
            <div class="value" style="font-size:1.4rem;">${escapeHtml(g.difficulty)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Tempo estimado</div>
            <div class="value" style="font-size:1.4rem;">${escapeHtml(g.timeEstimate)}</div>
          </div>
          <div class="card-stat">
            <div class="label">Custo</div>
            <div class="value" style="font-size:1.4rem;">${escapeHtml(g.cost)}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="section-prose">
      <div class="container-narrow prose">
        <h2>Pré-requisitos</h2>
        <ul>
          ${g.prereqs.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
        </ul>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Passo a passo</h2>
        ${g.steps.map((s, i) => `
        <div class="card" style="margin-bottom:14px;">
          <div class="eyebrow" style="color:var(--brand-gold-dark);font-size:0.7rem;">Passo ${i + 1}</div>
          <h3 style="margin-top:8px;margin-bottom:10px;">${escapeHtml(s.title)}</h3>
          <p style="margin:0;color:var(--ink-soft);">${escapeHtml(s.body)}</p>
        </div>`).join('')}
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Documentos necessários</h2>
        <table class="data">
          <thead>
            <tr><th>Documento</th><th>Observações</th></tr>
          </thead>
          <tbody>
            ${g.documentsTable.map(d => `<tr><td>${escapeHtml(d.doc)}</td><td>${escapeHtml(d.notes)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    ${g.stateNotes ? `
    <section>
      <div class="container-narrow">
        <h2>Notas por estado</h2>
        ${g.stateNotes.map(s => `
        <div class="callout">
          <strong>${escapeHtml(s.state)}:</strong> ${escapeHtml(s.note)}
        </div>`).join('')}
      </div>
    </section>` : ''}

    <section class="section-prose">
      <div class="container-narrow prose">
        <h2>Erros comuns a evitar</h2>
        <ul>
          ${g.commonErrors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
        </ul>
      </div>
    </section>

    ${g.partnerSlots && g.partnerSlots.length > 0 ? `
    <section>
      <div class="container-narrow">
        <h2>Parceiros recomendados</h2>
        <p class="muted" style="font-size:0.85rem;">Estas indicações são parcerias de afiliados. Recebemos comissão sem custo extra para você quando finaliza pelo nosso link.</p>
        ${g.partnerSlots.map(p => `
        <a class="partner-card" href="/go/${p.partner}?campaign=${escapeHtml(p.campaign)}" rel="sponsored noopener" target="_blank">
          <div class="logo-box">
            <img src="https://logo.clearbit.com/${p.partner === 'mercury' ? 'mercury.com' : p.partner === 'lemonade' ? 'lemonade.com' : p.partner === 'capitalone' ? 'capitalone.com' : p.partner === 'zenbusiness' ? 'zenbusiness.com' : p.partner + '.com'}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.display='none'" />
          </div>
          <div class="partner-info">
            <div class="partner-name">${escapeHtml(p.name)}</div>
            <div class="partner-desc">${escapeHtml(p.desc)}</div>
          </div>
          <div class="partner-arrow">→</div>
        </a>`).join('')}
      </div>
    </section>` : ''}

    <section>
      <div class="container-narrow">
        <h2>Perguntas frequentes</h2>
        ${g.faqs.map(f => `
        <details class="faq-item">
          <summary>${escapeHtml(f.q)}</summary>
          <p>${escapeHtml(f.a)}</p>
        </details>`).join('')}
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Outros guias</h2>
        <div class="related-grid">
          ${otherGuides.map(o => `
          <a class="related-card" href="/guias/${o.slug}/">
            <div class="related-eyebrow">Guia</div>
            <div class="related-title">${escapeHtml(o.shortTitle)}</div>
            <div class="related-desc">${escapeHtml(o.intro.slice(0, 110))}…</div>
          </a>`).join('')}
        </div>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <div class="cta-section">
          <h2>Quer ser avisado quando o app estiver pronto?</h2>
          <p class="lede">Cadastre seu email e receba uma mensagem assim que lançarmos a plataforma completa.</p>
          <a href="/" class="btn btn-primary">Entrar na lista de espera →</a>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}`
}

// ── Página índice de Cidades ───────────────────────────────────────────
function renderCitiesIndex() {
  const title = 'Custo de vida nos EUA para brasileiros — 12 cidades comparadas | BrasilConnect USA'
  const desc = 'Veja o custo de vida em 12 cidades americanas para brasileiros: Austin, Miami, Boston, NY, Houston e mais. Aluguel, salário e custo total para solteiros e famílias.'
  const url = `${SITE_URL}/custo-de-vida/`

  return renderHead({ title, description: desc, canonical: url }) + `
  <main>
    <section class="hero">
      <div class="container-narrow">
        <div class="eyebrow">Custo de vida</div>
        <h1>Quanto custa morar nos EUA como brasileiro</h1>
        <p class="lede">Comparativo de 12 cidades americanas com forte presença brasileira. Aluguel, salário, custo total mensal por composição familiar — tudo atualizado para 2026.</p>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <table class="data">
          <thead>
            <tr>
              <th>Cidade</th>
              <th>Solteiro/mês</th>
              <th>Família 4/mês</th>
              <th>Salário médio</th>
            </tr>
          </thead>
          <tbody>
            ${cities.map(c => `
            <tr style="cursor:pointer;" onclick="window.location='/custo-de-vida/${c.slug}/'">
              <td><a href="/custo-de-vida/${c.slug}/">${escapeHtml(c.name)}, ${escapeHtml(c.stateCode)}</a></td>
              <td>${fmt(c.totals.single)}</td>
              <td>${fmt(c.totals.family4)}</td>
              <td>${fmt(c.salaryAvg)}/ano</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <h2>Todas as cidades</h2>
        <div class="related-grid">
          ${cities.map(c => `
          <a class="related-card" href="/custo-de-vida/${c.slug}/">
            <div class="related-eyebrow">${escapeHtml(c.state)}</div>
            <div class="related-title">${escapeHtml(c.name)}, ${escapeHtml(c.stateCode)}</div>
            <div class="related-desc">A partir de ${fmt(c.totals.single)}/mês · Salário médio ${fmt(c.salaryAvg)}/ano</div>
          </a>`).join('')}
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}`
}

// ── Página índice de Guias ─────────────────────────────────────────────
function renderGuidesIndex() {
  const title = 'Guias passo a passo para brasileiros nos EUA | BrasilConnect USA'
  const desc = 'Guias completos para brasileiros: como tirar CNH americana, abrir conta sem SSN, conseguir ITIN, matricular filhos, contratar plano de saúde e abrir LLC.'
  const url = `${SITE_URL}/guias/`

  return renderHead({ title, description: desc, canonical: url }) + `
  <main>
    <section class="hero">
      <div class="container-narrow">
        <div class="eyebrow">Guias passo a passo</div>
        <h1>Guias para brasileiros nos EUA</h1>
        <p class="lede">Burocracia americana descomplicada — passo a passo, com documentos necessários, custos esperados e os erros mais comuns para evitar.</p>
      </div>
    </section>

    <section>
      <div class="container-narrow">
        <div class="related-grid">
          ${guides.map(g => `
          <a class="related-card" href="/guias/${g.slug}/">
            <div class="related-eyebrow">${escapeHtml(g.difficulty)} · ${escapeHtml(g.timeEstimate)}</div>
            <div class="related-title">${escapeHtml(g.shortTitle)}</div>
            <div class="related-desc">${escapeHtml(g.intro.slice(0, 140))}…</div>
          </a>`).join('')}
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}`
}

// ── Sitemap ────────────────────────────────────────────────────────────
function renderSitemap() {
  const today = new Date().toISOString().slice(0, 10)
  const urls = [
    { loc: `${SITE_URL}/`,                     priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE_URL}/custo-de-vida/`,       priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/guias/`,               priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/guia-chegada/`,        priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE_URL}/agenda/`,               priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/negocio/`,              priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/grupos/`,               priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/viagem/`,               priority: '0.9', changefreq: 'weekly' },
    ...cities.map(c => ({ loc: `${SITE_URL}/custo-de-vida/${c.slug}/`, priority: '0.8', changefreq: 'monthly' })),
    ...guides.map(g => ({ loc: `${SITE_URL}/guias/${g.slug}/`, priority: '0.8', changefreq: 'monthly' })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`
}

// ── Build ──────────────────────────────────────────────────────────────

// ── Build ──────────────────────────────────────────────────────────────
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }) }
function write(p, content) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content); console.log('  ' + path.relative(ROOT, p)) }

console.log('\n🇧🇷 BrasilConnect USA — Build de landing pages\n')

console.log('Cidades:')
cities.forEach(c => {
  write(path.join(PUB, 'custo-de-vida', c.slug, 'index.html'), renderCityPage(c))
})

console.log('\nGuias:')
guides.forEach(g => {
  write(path.join(PUB, 'guias', g.slug, 'index.html'), renderGuidePage(g))
})

console.log('\nÍndices:')
write(path.join(PUB, 'custo-de-vida', 'index.html'), renderCitiesIndex())
write(path.join(PUB, 'guias', 'index.html'), renderGuidesIndex())

console.log('\nSitemap:')
write(path.join(PUB, 'sitemap.xml'), renderSitemap())

console.log(`\n✅ ${cities.length} cidades + ${guides.length} guias + 2 índices + sitemap = ${cities.length + guides.length + 3} arquivos\n`)
