#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 1 — Subir código a GitHub (ejecutar en el equipo origen)
# ═══════════════════════════════════════════════════════════════

set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "📁 Creando .gitignore..."
cat > .gitignore << 'EOF'
# Credenciales — NUNCA subir
.env

# Dependencias Node (se instalan con npm install)
node_modules/
*/node_modules/

# Backups de datos (se transfieren por AirDrop/USB)
*.tar.gz
*.sql

# macOS
.DS_Store

# Logs
*.log
EOF

echo "🔧 Inicializando repositorio git..."
git init
git add .
git status

echo ""
echo "✅ Archivos listos para commitear."
echo ""
echo "⚠️  ANTES DE CONTINUAR:"
echo "   1. Ve a https://github.com/new"
echo "   2. Crea un repositorio llamado: iacc-ai-poc"
echo "   3. NO inicialices con README ni .gitignore"
echo "   4. Copia la URL del repositorio (ej: https://github.com/TU_USUARIO/iacc-ai-poc.git)"
echo ""
echo "📋 Luego ejecuta PASO 1b con tu URL de GitHub:"
echo "   bash $PROJECT_DIR/scripts/paso1b-push-github.sh https://github.com/TU_USUARIO/iacc-ai-poc.git"
