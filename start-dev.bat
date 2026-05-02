@echo off
chcp 65001 >nul
title BrasilConnect USA - Dev server
color 0A

echo.
echo  ╔════════════════════════════════════════════════════════════════╗
echo  ║                                                                ║
echo  ║   🇧🇷 BrasilConnect USA — Ambiente de desenvolvimento          ║
echo  ║                                                                ║
echo  ╚════════════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

REM ── 1. Verificar Node.js ──────────────────────────────────────────
echo  [1/4] Verificando Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  ✗ Node.js nao esta instalado.
    echo.
    echo  Baixe em: https://nodejs.org/  (escolha a versao LTS)
    echo  Apos instalar, rode este script novamente.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set NODE_VERSION=%%v
echo       ✓ Node %NODE_VERSION%

REM ── 2. Instalar dependencias se faltar node_modules ───────────────
echo.
echo  [2/4] Verificando dependencias do projeto...
if not exist "node_modules" (
    echo       Pasta node_modules nao encontrada. Rodando npm install...
    echo       (isso demora 1-3 minutos na primeira vez)
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo  ✗ npm install falhou. Verifique sua conexao.
        pause
        exit /b 1
    )
) else (
    echo       ✓ node_modules ja existe
)

REM ── 3. Verificar Vercel CLI ───────────────────────────────────────
echo.
echo  [3/4] Verificando Vercel CLI...
where vercel >nul 2>nul
if %errorlevel% neq 0 (
    echo       Vercel CLI nao encontrado. Instalando globalmente...
    call npm install -g vercel
    if %errorlevel% neq 0 (
        color 0E
        echo.
        echo  ⚠ Nao consegui instalar Vercel CLI globalmente.
        echo  Tente manualmente: npm install -g vercel
        echo  Continuando com Vite puro (APIs nao vao funcionar)...
        echo.
        timeout /t 3 /nobreak >nul
        goto VITE_ONLY
    )
)
echo       ✓ Vercel CLI disponivel

REM ── 4. Verificar .env.local ───────────────────────────────────────
echo.
echo  [4/4] Verificando .env.local...
if not exist ".env.local" (
    color 0E
    echo       ⚠ .env.local nao existe.
    echo       Algumas APIs (waitlist, drip, referral) nao vao funcionar
    echo       sem as chaves de Supabase / Resend.
    echo.
    echo       Para configurar:
    echo       1. Copie .env.example para .env.local
    echo       2. Preencha SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
    echo.
    echo       Pressione qualquer tecla para continuar mesmo assim...
    pause >nul
    color 0A
) else (
    echo       ✓ .env.local existe
)

REM ── Subir dev server ──────────────────────────────────────────────
echo.
echo ──────────────────────────────────────────────────────────────────
echo.
echo  🚀 Iniciando dev server em http://localhost:3000
echo.
echo  Em alguns segundos seu navegador deve abrir automaticamente.
echo  Para parar o servidor: Ctrl+C nesta janela.
echo.
echo  URLs uteis:
echo    http://localhost:3000/                       (ComingSoon)
echo    http://localhost:3000/?preview=brasil2026    (App real)
echo    http://localhost:3000/custo-de-vida/         (12 cidades)
echo    http://localhost:3000/guias/                 (6 guias)
echo    http://localhost:3000/guia-chegada/          (lead magnet)
echo    http://localhost:3000/admin/utm-builder      (UTM builder)
echo    http://localhost:3000/admin/waitlist         (admin waitlist)
echo    http://localhost:3000/admin/analytics        (analytics)
echo.
echo ──────────────────────────────────────────────────────────────────
echo.

REM Aguardar 3s e abrir o navegador
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

call vercel dev
goto END

:VITE_ONLY
echo.
echo  Iniciando apenas Vite (sem APIs)...
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173"
call npm run dev

:END
echo.
echo  Servidor encerrado.
pause
