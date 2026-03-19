@echo off
REM ═══════════════════════════════════════════════════════════════
REM POC 14 — Configurar MCP Server IACC en Kiro IDE (Windows)
REM Doble-click o ejecutar desde la raíz del proyecto:
REM   poc14\setup-kiro.bat
REM ═══════════════════════════════════════════════════════════════

node "%~dp0setup-kiro.js"
if %errorlevel% neq 0 (
  echo.
  echo ERROR: Asegurate de tener Node.js 20+ instalado.
  echo Descarga desde: https://nodejs.org
  pause
)
