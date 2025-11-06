@echo off
setlocal enabledelayedexpansion
title Frota - Auto Update + Auto Push (identificacao sem config)

cd /d "%~dp0"
where git >nul 2>&1 || (echo [ERRO] Git nao encontrado no PATH.& goto :END)
where npm >nul 2>&1 || (echo [ERRO] Node/NPM nao encontrado no PATH.& goto :END)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

REM Tentar pegar identidade configurada no Git
set GIT_USER=
set GIT_EMAIL=
for /f "usebackq delims=" %%a in (`git config user.name 2^>nul`) do set GIT_USER=%%a
for /f "usebackq delims=" %%a in (`git config user.email 2^>nul`) do set GIT_EMAIL=%%a

REM Se nao houver configuracao, montar identidade temporaria p/ este commit
if not defined GIT_USER  set "TMP_USER=%USERNAME% (%COMPUTERNAME%)"
if not defined GIT_EMAIL set "TMP_EMAIL=%USERNAME%@%COMPUTERNAME%.local"

echo ==========================================
echo [1/4] git pull --rebase
echo ==========================================
git pull --rebase

REM Detectar alteracoes locais
set CHANGES=
for /f "delims=" %%i in ('git status --porcelain') do set CHANGES=1

if defined CHANGES (
  echo.
  echo ==========================================
  echo [2/4] Enviando alteracoes locais...
  echo ==========================================
  git add .

  REM Montar mensagem padrao com origem/branch/data
  set MSG1=Atualizacao automatica: sincronizacao local
  set MSG2=Origem: %USERNAME%@%COMPUTERNAME%
  if defined GIT_USER if defined GIT_EMAIL (
    set MSG3=Git: %GIT_USER% <%GIT_EMAIL%>
  ) else (
    set MSG3=Git: (sem config) %TMP_USER% <%TMP_EMAIL%>
  )
  set MSG4=Branch: %BRANCH%
  set MSG5=DataHora: %DATE% %TIME%

  REM Commit usando identidade configurada OU temporaria (sem salvar no gitconfig)
  if defined GIT_USER (
    git commit -m "%MSG1%" -m "%MSG2%" -m "%MSG3%" -m "%MSG4%" -m "%MSG5%"
  ) else (
    git -c user.name="%TMP_USER%" -c user.email="%TMP_EMAIL%" ^
        commit -m "%MSG1%" -m "%MSG2%" -m "%MSG3%" -m "%MSG4%" -m "%MSG5%"
  )

  if errorlevel 1 (
    echo [AVISO] Nao foi possivel criar o commit (talvez nada novo apos git add).
  ) else (
    git push origin "%BRANCH%"
    if errorlevel 1 (echo [ERRO] Falha no push. Verifique credenciais/acesso.) else (echo [OK] Push concluido.)
  )
) else (
  echo.
  echo [2/4] Nenhuma alteracao local para enviar.
)

echo.
echo ==========================================
echo [3/4] Verificando dependencias...
echo ==========================================
set NEED_INSTALL=0
if not exist "node_modules\" set NEED_INSTALL=1
for /f "delims=" %%F in ('git diff --name-only HEAD@{1} HEAD 2^>nul') do (
  echo %%F | findstr /i "package.json package-lock.json" >nul && set NEED_INSTALL=1
)
if exist "package-lock.json" (
  for /f "tokens=1" %%H in ('
    certutil -hashfile "package-lock.json" SHA256 ^| find /i /v "hash" ^| find /i /v "certutil"
  ') do set CUR_HASH=%%H
  if exist ".deps.sha" (
    set /p OLD_HASH=<.deps.sha
    if /i not "!CUR_HASH!"=="!OLD_HASH!" set NEED_INSTALL=1
  ) else (
    set NEED_INSTALL=1
  )
)

if %NEED_INSTALL%==1 (
  echo Instalando dependencias...
  if exist "package-lock.json" (
    call npm ci || (echo [AVISO] npm ci falhou, tentando npm install... & call npm install)
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
  echo Dependencias OK.
)

echo.
echo ==========================================
echo [4/4] Iniciando a aplicacao (npm start)...
echo ==========================================
call npm start
goto :EOF

:END
echo.
echo Finalizado.
endlocal
