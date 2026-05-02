@echo off
chcp 65001 >nul
title BrasilConnect USA - Deploy para Vercel
color 0A

echo.
echo  ╔════════════════════════════════════════════════════════════════╗
echo  ║                                                                ║
echo  ║   🇧🇷 BrasilConnect USA — Deploy para producao                 ║
echo  ║                                                                ║
echo  ╚════════════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

REM ── 1. Verificar Node ─────────────────────────────────────────────
echo  [1/5] Verificando Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  ✗ Node.js nao instalado. Baixe em: https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo       ✓ Node OK

REM ── 2. Vercel CLI ─────────────────────────────────────────────────
echo.
echo  [2/5] Verificando Vercel CLI...
where vercel >nul 2>nul
if %errorlevel% neq 0 (
    echo       Instalando Vercel CLI globalmente...
    call npm install -g vercel
    if %errorlevel% neq 0 (
        color 0C
        echo  ✗ Falha ao instalar Vercel CLI.
        pause
        exit /b 1
    )
)
echo       ✓ Vercel CLI OK

REM ── 3. Confirmar projeto linkado ──────────────────────────────────
echo.
echo  [3/5] Verificando link com Vercel...
if not exist ".vercel\project.json" (
    color 0E
    echo       ⚠ Projeto nao linkado. Rodando vercel link...
    echo.
    call vercel link
    if %errorlevel% neq 0 (
        color 0C
        echo  ✗ Link cancelado.
        pause
        exit /b 1
    )
)
echo       ✓ Projeto linkado: brasilconnectusa

REM ── 4. Aviso sobre env vars ───────────────────────────────────────
echo.
echo  [4/5] Lembrete de variaveis de ambiente
echo.
echo       As env vars de producao moram no painel do Vercel:
echo       https://vercel.com/torresbee/brasilconnectusa/settings/environment-variables
echo.
echo       Variaveis essenciais para rodar tudo:
echo         - SUPABASE_URL
echo         - SUPABASE_SERVICE_KEY
echo         - VITE_SUPABASE_URL
echo         - VITE_SUPABASE_ANON_KEY
echo         - RESEND_API_KEY
echo         - ADMIN_SECRET
echo         - CRON_SECRET
echo         - AFFILIATE_*_LINK (links de afiliado)
echo.
echo       Ja estao configuradas? Pressione qualquer tecla para continuar.
echo       Se NAO, abra a URL acima primeiro, configure e volte.
echo.
pause >nul

REM ── 5. Confirmar e fazer deploy ───────────────────────────────────
echo.
echo  [5/5] Tudo pronto para deploy.
echo.
echo  Voce vai fazer deploy em PRODUCAO. Tem certeza?
echo  Se preferir um preview primeiro, escolha 'N' aqui e rode
echo  manualmente:  vercel  (sem o --prod)
echo.
set /p CONFIRMA="  Confirmar deploy de PRODUCAO? (S/N): "
if /i not "%CONFIRMA%"=="S" (
    echo.
    echo  Deploy cancelado.
    pause
    exit /b 0
)

echo.
echo ──────────────────────────────────────────────────────────────────
echo.
echo  🚀 Subindo para producao...
echo.
echo ──────────────────────────────────────────────────────────────────
echo.

call vercel --prod

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  ✗ Deploy falhou. Veja o erro acima.
    pause
    exit /b 1
)

echo.
echo ──────────────────────────────────────────────────────────────────
echo.
echo  ✓ Deploy concluido!
echo.
echo  Confira no painel: https://vercel.com/torresbee/brasilconnectusa
echo  URL final: https://brasilconnectusa.com
echo.
echo  Pos-deploy:
echo    1. Testar:  https://brasilconnectusa.com (deve mostrar Em Breve)
echo    2. Testar:  https://brasilconnectusa.com/?preview=brasil2026
echo    3. Testar:  https://brasilconnectusa.com/custo-de-vida/austin-tx/
echo    4. Cadastrar email de teste e confirmar email do Resend
echo    5. Submeter sitemap em https://search.google.com/search-console
echo.
pause
