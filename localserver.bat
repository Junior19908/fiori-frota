@echo off
setlocal enabledelayedexpansion
title Frota - Auto Update + Auto Push

cd /d "%~dp0"

echo ==========================================
echo [1/4] Atualizando repositório...
echo ==========================================
where git >nul 2>&1 || (echo [ERRO] Git nao encontrado no PATH.& goto :END)
git pull --rebase

REM ==========================================
REM [2/4] Detectar e enviar alterações locais
REM ==========================================
for /f "delims=" %%i in ('git status --porcelain') do set CHANGES=1

if defined CHANGES (
  echo.
  echo ==========================================
  echo  Detectadas alteracoes locais!
  echo  Enviando para o repositório remoto...
  echo ==========================================

  REM Evita commits vazios
  git add .
  git commit -m "Atualizacao automatica: sincronizacao local"
  git push origin main

  echo.
  echo [OK] Alteracoes enviadas com sucesso.
) else (
  echo.
  echo Nenhuma alteracao local detectada.
)

REM ==========================================
REM [3/4] Instalar dependencias se necessario
REM ==========================================
set NEED_INSTALL=0
if not exist "node_modules\" set NEED_INSTALL=1

for /f "delims=" %%F in ('git diff --name-only HEAD@{1} HEAD 2^>nul') do (
  echo %%F | findstr /i "package.json package-lock.json" >nul && set NEED_INSTALL=1
)

if %NEED_INSTALL%==1 (
  echo.
  echo Instalando dependencias...
  call npm ci || call npm install
) else (
  echo Dependencias OK.
)

REM ==========================================
REM [4/4] Iniciar aplicacao
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
