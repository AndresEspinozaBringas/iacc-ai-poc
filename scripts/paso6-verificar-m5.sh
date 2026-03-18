#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 6 — Verificar que todo funciona en el equipo destino
# Ejecutar como prueba final después del traslado
# ═══════════════════════════════════════════════════════════════

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🧪 Verificación completa del entorno IACC AI POC"
echo "═══════════════════════════════════════════════════"

# ── Docker ────────────────────────────────────────────────────
echo ""
echo "1️⃣  Docker services:"
docker compose -f "$PROJECT_DIR/docker-compose.yml" ps --format "table {{.Name}}\t{{.Status}}"

# ── ChromaDB ──────────────────────────────────────────────────
echo ""
echo "2️⃣  ChromaDB:"
HEARTBEAT=$(curl -s http://localhost:8000/api/v2/heartbeat)
if echo "$HEARTBEAT" | grep -q "nanosecond"; then
  echo "   ✅ API responde"
  DOCS=$(curl -s "http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections" 2>/dev/null)
  echo "   ℹ️  Colecciones: $DOCS" | head -c 200
else
  echo "   ❌ No responde en http://localhost:8000"
fi

# ── Langfuse ──────────────────────────────────────────────────
echo ""
echo "3️⃣  Langfuse:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/public/health)
if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✅ Responde en http://localhost:3000"
else
  echo "   ❌ No responde (código HTTP: $HTTP_CODE)"
fi

# ── LiteLLM ───────────────────────────────────────────────────
echo ""
echo "4️⃣  LiteLLM Gateway:"
LITELLM_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-iacc-master-2026}")
if [ "$LITELLM_CODE" = "200" ]; then
  echo "   ✅ Responde en http://localhost:4000"
  echo "   🔗 Dashboard: http://localhost:4000/ui"
else
  echo "   ⚠️  No responde (código HTTP: $LITELLM_CODE)"
fi

# ── .env ──────────────────────────────────────────────────────
echo ""
echo "5️⃣  Variables de entorno (.env):"
ENV_FILE="$PROJECT_DIR/.env"
VARS=("ANTHROPIC_API_KEY" "LANGFUSE_SECRET_KEY" "LANGFUSE_PUBLIC_KEY" "JIRA_BASE_URL" "JIRA_EMAIL" "JIRA_API_TOKEN" "WIKIJS_BASE_URL" "WIKIJS_API_TOKEN" "LITELLM_MASTER_KEY")
ALL_OK=true
for VAR in "${VARS[@]}"; do
  if grep -q "^${VAR}=" "$ENV_FILE" 2>/dev/null; then
    echo "   ✅ $VAR"
  else
    echo "   ❌ $VAR — falta en .env"
    ALL_OK=false
  fi
done

# ── Node modules ──────────────────────────────────────────────
echo ""
echo "6️⃣  Dependencias Node.js:"
for dir in rag poc4 poc5 poc6 poc6b poc7 poc8 poc9; do
  if [ -f "$PROJECT_DIR/$dir/package.json" ]; then
    if [ -d "$PROJECT_DIR/$dir/node_modules" ]; then
      echo "   ✅ $dir/node_modules"
    else
      echo "   ❌ $dir/node_modules — ejecuta: cd $PROJECT_DIR/$dir && npm install"
      ALL_OK=false
    fi
  fi
done

# ── Resumen ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
if [ "$ALL_OK" = true ]; then
  echo "✅ Todo listo. Prueba el agente con:"
  echo "   cd $PROJECT_DIR/poc4 && npm run agent"
else
  echo "⚠️  Revisa los items marcados con ❌ antes de continuar."
fi
