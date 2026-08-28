@echo off
chcp 65001 >nul
REM Lanceur rapide Windows — double-clic dans l'Explorateur.
REM Pour un démarrage SANS fenêtre de console, double-clique
REM   sur "LMU-Telemetrie.exe" (démarre entièrement en arrière-plan).
REM Ce script est la voie sources / Node et affiche volontairement une fenêtre
REM (au premier lancement il télécharge éventuellement Node.js + DuckDB et peut
REM poser des questions).
cd /d "%~dp0"
title Pont LMU Télémétrie
echo ============================================================
echo   Analyseur de télémétrie LMU  (Windows)
echo ------------------------------------------------------------
echo   Lit ta télémétrie enregistrée
echo   (UserData\Telemetry\*.duckdb) et ouvre l'analyse
echo   dans une fenêtre d'application (adresse : http://localhost:8777)
echo.
echo   Laisse cette fenêtre ouverte pendant que tu
echo   utilises l'app. Pour quitter : ferme la fenêtre.
echo ============================================================
echo.

REM ============================================================
REM  S'assurer que Node.js est disponible (présent ? sinon installer/télécharger)
REM ============================================================
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "node\node.exe" set "NODE_EXE=%CD%\node\node.exe"

if not defined NODE_EXE (
  echo Node.js est introuvable.
  echo.
  REM 1^) Essai via winget ^(installation réelle, éventuellement avec demande admin^)
  where winget >nul 2>nul && (
    echo Installation de Node.js LTS via winget...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  )
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

  REM 2^) Secours : télécharger Node.js LTS portable ^(sans admin, dans .\node^)
  if not defined NODE_EXE (
    echo Téléchargement de Node.js LTS portable ^(une seule fois^)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $i=Invoke-RestMethod 'https://nodejs.org/dist/index.json'; $lts=($i.Where({$_.lts -ne $false},'First')[0]).version; $u='https://nodejs.org/dist/'+$lts+'/node-'+$lts+'-win-x64.zip'; Write-Host ('Node.js '+$lts); Invoke-WebRequest $u -OutFile 'node.zip'; Expand-Archive 'node.zip' -DestinationPath '_nodetmp' -Force; $d=(Get-ChildItem '_nodetmp' -Directory)[0]; Move-Item $d.FullName 'node' -Force; Remove-Item 'node.zip' -Force; Remove-Item '_nodetmp' -Recurse -Force"
    if exist "node\node.exe" set "NODE_EXE=%CD%\node\node.exe"
  )
)

if not defined NODE_EXE (
  echo.
  echo ERREUR : impossible de préparer Node.js.
  echo Installe-le manuellement depuis https://nodejs.org puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

REM ============================================================
REM  S'assurer que la CLI DuckDB est présente (incluse dans la release ; sinon télécharger)
REM ============================================================
if not exist "duckdbcli\duckdb.exe" (
  echo Téléchargement de la CLI DuckDB ^(une seule fois^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest 'https://github.com/duckdb/duckdb/releases/download/v1.4.0/duckdb_cli-windows-amd64.zip' -OutFile 'duckdb_cli.zip'; Expand-Archive 'duckdb_cli.zip' -DestinationPath 'duckdbcli' -Force; Remove-Item 'duckdb_cli.zip' } catch { Write-Host $_; exit 1 }"
  if errorlevel 1 (
    echo ERREUR lors du téléchargement de la CLI DuckDB. Vérifie ta connexion Internet.
    pause
    exit /b 1
  )
)

REM ============================================================
REM  Démarrer le pont (ouvre le navigateur automatiquement)
REM ============================================================
"%NODE_EXE%" lmu-bridge.js

echo.
echo Le pont a été arrêté.
pause >nul
