#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 4 — Configurar equipo destino desde cero
# Uso: bash paso4-configurar-m5.sh https://github.com/TU_USUARIO/iacc-ai-poc.git [directorio_destino]
# Ejemplo: bash paso4-configurar-m5.sh https://github.com/AndresEspinozaBringas/iacc-ai-poc.git
# ═══════════════════════════════════════════════════════════════

set -e
REPO_URL=$1
CLONE_DIR="${2:-$HOME/iacc-ai-poc}"   # destino configurable, por defecto ~/iacc-ai-poc

if [ -z "$REPO_URL" ]; then
  echo "❌ Debes pasar la URL del repositorio."
  echo "   Uso: bash paso4-configurar-m5.sh https://github.com/TU_USUARIO/iacc-ai-poc.git"
  exit 1
fi

# ── 1. Verificar requisitos ──────────────────────────────────────────────────
echo "🔍 Verificando requisitos..."

if ! command -v node &> /dev/null; then
  echo "❌ Node.js no está instalado."
  echo "   Instala desde: https://nodejs.org (v20 LTS)"
  exit 1
fi
echo "   ✅ Node.js: $(node --version)"

if ! command -v docker &> /dev/null; then
  echo "❌ Docker no está instalado."
  echo "   Instala Docker Desktop desde: https://www.docker.com/products/docker-desktop"
  exit 1
fi
echo "   ✅ Docker: $(docker --version | cut -d' ' -f3)"

if ! command -v git &> /dev/null; then
  echo "❌ Git no está instalado. Ejecuta: xcode-select --install"
  exit 1
fi
echo "   ✅ Git: $(git --version | cut -d' ' -f3)"

# ── 2. Clonar repositorio ───────────────────────────────────────────────────
echo ""
echo "📥 Clonando repositorio en $CLONE_DIR..."
git clone "$REPO_URL" "$CLONE_DIR"
cd "$CLONE_DIR"

# ── 3. Instalar dependencias Node en cada POC ──────────────────────────────
echo ""
echo "📦 Instalando dependencias Node.js..."

for dir in rag poc4 poc5 poc6 poc6b poc7 poc8 poc9; do
  if [ -f "$CLONE_DIR/$dir/package.json" ]; then
    echo "   → $dir/"
    cd "$CLONE_DIR/$dir" && npm install --silent
    cd "$CLONE_DIR"
  fi
done

# ── 4. Levantar servicios Docker ────────────────────────────────────────────
echo ""
echo "🐳 Levantando servicios Docker..."
echo "   (La primera vez descarga las imágenes — puede tardar 5-10 min)"
cd "$CLONE_DIR"
docker compose up -d

echo ""
echo "⏳ Esperando que los servicios estén listos..."
sleep 15
docker compose ps --format "table {{.Name}}\t{{.Status}}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Configuración base completada en: $CLONE_DIR"
echo ""
echo "⚠️  PRÓXIMO PASO OBLIGATORIO:"
echo "   Crea el archivo .env con tus credenciales:"
echo "   nano $CLONE_DIR/.env"
echo ""
echo "   Contenido mínimo del .env:"
echo "   ANTHROPIC_API_KEY=sk-ant-..."
echo "   LANGFUSE_SECRET_KEY=sk-lf-..."
echo "   LANGFUSE_PUBLIC_KEY=pk-lf-..."
echo "   LANGFUSE_BASE_URL=http://localhost:3000"
echo "   JIRA_BASE_URL=https://iaccsa.atlassian.net"
echo "   JIRA_EMAIL=tu@email.com"
echo "   JIRA_API_TOKEN=..."
echo "   WIKIJS_BASE_URL=https://wiki.iacc.cl"
echo "   WIKIJS_API_TOKEN=..."
echo "   LITELLM_MASTER_KEY=sk-iacc-master-2026"
echo "   LITELLM_BASE_URL=http://localhost:4000"
echo ""
echo "   Luego ejecuta el paso 5:"
echo "   bash $CLONE_DIR/scripts/paso5-restaurar-datos-m5.sh"
