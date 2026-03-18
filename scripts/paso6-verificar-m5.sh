#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 6 — Verificar que todo funciona en MacBook M5
# Ejecutar como prueba final después del traslado
# ═══════════════════════════════════════════════════════════════

echo "🧪 Verificación completa del entorno IACC AI POC"
echo "═══════════════════════════════════════════════════"

# ── Docker ────────────────────────────────────────────────────
echo ""
echo "1️⃣  Docker services:"
docker compose -f ~/langfuse-poc/docker-compose.yml ps --format "table {{.Name}}\t{{.Status}}"

# ── ChromaDB ──────────────────────────────────────────────────
echo ""
echo "2️⃣  ChromaDB:"
HEARTBEAT=$(curl -s http://localhost:8000/api/v2/heartbeat)
if echo "$HEARTBEAT" | grep -q "nanosecond_heartbeat"; then
  echo "   ✅ API responde"
  # Contar documentos en la colección
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

# ── .env ──────────────────────────────────────────────────────
echo ""
echo "4️⃣  Variables de entorno (.env):"
ENV_FILE=~/langfuse-poc/.env
VARS=("ANTHROPIC_API_KEY" "LANGFUSE_SECRET_KEY" "LANGFUSE_PUBLIC_KEY" "JIRA_BASE_URL" "JIRA_EMAIL" "JIRA_API_TOKEN" "WIKIJS_BASE_URL" "WIKIJS_API_TOKEN")
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
echo "5️⃣  Dependencias Node.js:"
for dir in rag poc4 poc5 poc6; do
  if [ -d "$HOME/langfuse-poc/$dir/node_modules" ]; then
    echo "   ✅ $dir/node_modules"
  else
    echo "   ❌ $dir/node_modules — ejecuta: cd ~/$dir && npm install"
  fi
done

# ── Resumen ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
if [ "$ALL_OK" = true ]; then
  echo "✅ Todo listo. Prueba el agente con:"
  echo "   cd ~/langfuse-poc/poc4 && npm run agent"
else
  echo "⚠️  Revisa los items marcados con ❌ antes de continuar."
fi
