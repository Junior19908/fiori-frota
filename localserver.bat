@echo off
setlocal enabledelayedexpansion
title Frota - Atualizar e Iniciar

REM 1) ir para a pasta do .bat (raiz do projeto)
cd /d "%~dp0"

echo ==========================================
echo  Atualizando codigo (git pull --rebase)...
echo ==========================================
where git >nul 2>&1 || (echo [ERRO] Git nao encontrado no PATH.& goto :END)
git pull --rebase

REM 2) decidir se precisa instalar deps:
REM    - se node_modules nao existe
REM    - se package.json ou package-lock.json mudaram no pull
REM    - se o hash do package-lock.json mudou desde a ultima execucao
set NEED_INSTALL=0
if not exist "node_modules\" set NEED_INSTALL=1

for /f "delims=" %%F in ('git diff --name-only HEAD@{1} HEAD 2^>nul') do (
  echo %%F | findstr /i "package.json package-lock.json" >nul && set NEED_INSTALL=1
)

REM 2.1) checar hash do package-lock (evita falso-positivo quando nao houve pull)
if exist "package-lock.json" (
  for /f "tokens=1" %%H in ('
    certutil -hashfile "package-lock.json" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"
  ') do set CUR_HASH=%%H
  if exist ".deps.sha" (
    set /p OLD_HASH=<.deps.sha
    if /i not "!CUR_HASH!"=="!OLD_HASH!" set NEED_INSTALL=1
  ) else (
    REM primeira execucao: gravar hash depois do install
    set NEED_INSTALL=1
  )
)

if %NEED_INSTALL%==1 (
  echo.
  echo ==========================================
  echo  Instalando dependencias do projeto...
  echo ==========================================
  where npm >nul 2>&1 || (echo [ERRO] Node/NPM nao encontrado no PATH.& goto :END)

  if exist "package-lock.json" (
    REM instala exatamente o que esta travado no lockfile
    call npm ci
  ) else (
    call npm install
  )

  if exist "package-lock.json" (
    for /f "tokens=1" %%H in ('
      certutil -hashfile "package-lock.json" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"
    ') do set CUR_HASH=%%H
    > ".deps.sha" echo !CUR_HASH!
  )
) else (
  echo.
  echo [OK] Dependencias ja estao atualizadas.
)

echo.
echo ==========================================
echo  Iniciando a aplicacao (npm start)...
echo ==========================================
call npm start
goto :EOF

:END
echo.
echo Finalizado.
endlocal
