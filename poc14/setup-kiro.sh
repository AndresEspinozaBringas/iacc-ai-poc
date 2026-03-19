#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# POC 14 — Configurar MCP Server IACC en Kiro IDE
# Ejecutar una vez después de clonar el proyecto
# ═══════════════════════════════════════════════════════════════

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$PROJECT_DIR/.kiro/settings"
MCP_FILE="$MCP_DIR/mcp.json"
SERVER_JS="$PROJECT_DIR/poc14/server.js"
ENV_FILE="$PROJECT_DIR/.env"

echo "🔧 Configurando MCP Server IACC para Kiro..."
echo "   Proyecto: $PROJECT_DIR"

# ── Verificar que Node.js esté instalado ────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ Node.js no está instalado. Instala desde https://nodejs.org"
  exit 1
fi

# ── Verificar que las dependencias estén instaladas ─────────────
if [ ! -d "$PROJECT_DIR/poc14/node_modules" ]; then
  echo "📦 Instalando dependencias de poc14..."
  cd "$PROJECT_DIR/poc14" && npm install --silent
fi

# ── Crear directorio si no existe ──────────────────────────────
mkdir -p "$MCP_DIR"

# ── Generar mcp.json con rutas absolutas correctas ─────────────
cat > "$MCP_FILE" <<EOF
{
  "mcpServers": {
    "iacc-context": {
      "command": "node",
      "args": ["--env-file=$ENV_FILE", "$SERVER_JS"],
      "env": {
        "CHROMADB_URL": "http://localhost:8000"
      },
      "disabled": false,
      "autoApprove": [
        "search_technical_docs",
        "get_api_contracts",
        "get_related_stories",
        "get_coding_standards",
        "get_jira_issue",
        "query_jira"
      ]
    }
  }
}
EOF

echo "   ✅ $MCP_FILE generado"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ MCP Server IACC configurado."
echo ""
echo "⚠️  REQUISITO: asegúrate de tener el archivo .env con:"
echo "   JIRA_BASE_URL=https://iaccsa.atlassian.net"
echo "   JIRA_EMAIL=tu@iacc.cl"
echo "   JIRA_API_TOKEN=..."
echo ""
echo "▶  Recarga Kiro para que detecte el servidor:"
echo "   Cmd+Shift+P → Reload Window"
echo ""
echo "🧪 Prueba en el chat de Kiro:"
echo '   "¿Qué dice el ticket CA-248?"'
echo '   "¿Qué endpoints tiene el módulo de matrícula?"'
