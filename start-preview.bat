@echo off
chcp 65001 >nul
title BrasilConnect USA - Preview rapido
color 0A

echo.
echo  ╔════════════════════════════════════════════════════════════════╗
echo  ║                                                                ║
echo  ║   🇧🇷 BrasilConnect USA — Preview rapido                       ║
echo  ║                                                                ║
echo  ╚════════════════════════════════════════════════════════════════╝
echo.
echo  Abrindo paginas estaticas no navegador padrao...
echo.
echo  Estas paginas funcionam 100%% offline. Para o app React e as APIs,
echo  use start-dev.bat (precisa de Node.js instalado).
echo.
echo ──────────────────────────────────────────────────────────────────
echo.

set "BASE=%~dp0public"

echo  [1/6] Abrindo Admin UTM Builder...
start "" "%BASE%\admin\utm-builder.html"
timeout /t 1 /nobreak >nul

echo  [2/6] Abrindo Lead Magnet "Guia de Chegada"...
start "" "%BASE%\guia-chegada\index.html"
timeout /t 1 /nobreak >nul

echo  [3/6] Abrindo Custo de Vida em Austin...
start "" "%BASE%\custo-de-vida\austin-tx\index.html"
timeout /t 1 /nobreak >nul

echo  [4/6] Abrindo Custo de Vida em Miami...
start "" "%BASE%\custo-de-vida\miami-fl\index.html"
timeout /t 1 /nobreak >nul

echo  [5/6] Abrindo Guia de CNH...
start "" "%BASE%\guias\cnh\index.html"
timeout /t 1 /nobreak >nul

echo  [6/6] Abrindo Pagina de Indicacao...
start "" "%BASE%\indique\index.html"

echo.
echo ──────────────────────────────────────────────────────────────────
echo.
echo  ✓ 6 abas abertas no navegador.
echo.
echo  Outras paginas que voce pode abrir manualmente:
echo.
echo    - public\custo-de-vida\index.html (lista das 12 cidades)
echo    - public\guias\index.html (lista dos 6 guias)
echo    - public\admin\waitlist.html (lista de espera, precisa do API)
echo    - public\admin\analytics.html (analytics, precisa do API)
echo.
echo  Limitacoes do modo preview:
echo.
echo    - Links internos (/custo-de-vida/, /guias/) podem nao resolver
echo    - Cadastros na waitlist nao salvam (precisa do API)
echo    - Logos via Clearbit so carregam com internet
echo.
echo  Para o ambiente completo: start-dev.bat
echo.
pause
