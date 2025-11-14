@echo off
setlocal enabledelayedexpansion
title Frota - Auto Update + Auto Push

REM Vai para a pasta do script (raiz do projeto)
cd /d "%~dp0"

echo ==========================================
echo [1/3] Atualizando repositório...
echo ==========================================
where git >nul 2>&1 || (
  echo [ERRO] Git nao encontrado no PATH.
  goto :END
)

REM Garante que estamos em um repo Git
git rev-parse --is-inside-work-tree >nul 2>&1 || (
  echo [ERRO] Este diretorio nao é um repositorio Git valido.
  goto :END
)

REM Verifica usuario/e-mail Git configurados
set "GIT_USER_NAME="
set "GIT_USER_EMAIL="
for /f "usebackq delims=" %%N in (`git config --get user.name 2^>nul`) do set "GIT_USER_NAME=%%N"
for /f "usebackq delims=" %%E in (`git config --get user.email 2^>nul`) do set "GIT_USER_EMAIL=%%E"

if not defined GIT_USER_NAME (
  echo [ERRO] Nenhum usuario Git configurado.
  echo Configure com:
  echo   git config --global user.name "Seu Nome"
  echo   git config --global user.email "seu@email.com"
  goto :END
)

if not defined GIT_USER_EMAIL (
  echo [ERRO] Nenhum email Git configurado.
  echo Configure com:
  echo   git config --global user.email "seu@email.com"
  goto :END
)

REM Atualiza a branch local
git pull --rebase
if errorlevel 1 (
  echo [ERRO] Falha no git pull --rebase. Verifique conflitos antes de continuar.
  goto :END
)

REM ==========================================
REM [2/3] Instalar dependencias se necessario
REM ==========================================
set NEED_INSTALL=0
if not exist "node_modules\" set NEED_INSTALL=1

for /f "delims=" %%F in ('git diff --name-only HEAD@{1} HEAD 2^>nul') do (
  echo %%F | findstr /i "package.json package-lock.json" >nul && set NEED_INSTALL=1
)

if "%NEED_INSTALL%"=="1" (
  echo.
  echo Instalando dependencias...
  call npm ci || call npm install
) else (
  echo Dependencias OK.
)

REM ==========================================
REM [3/3] Iniciar aplicacao
REM ==========================================
echo.
echo ==========================================
echo Iniciando o servidor local (npm start)...
echo ==========================================
call npm start
goto :EOF

:END
echo.
echo Finalizado.
endlocal
