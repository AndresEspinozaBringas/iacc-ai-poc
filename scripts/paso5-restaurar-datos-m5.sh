#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 5 — Restaurar datos en MacBook M5
# Ejecutar DESPUÉS de paso4 y DESPUÉS de crear el .env
# Asume que los backups están en ~/langfuse-poc/backups/
# ═══════════════════════════════════════════════════════════════

set -e
cd ~/langfuse-poc

# ── Verificar que existen los backups ───────────────────────────────────────
echo "🔍 Verificando archivos de backup..."

if [ ! -f "backups/chroma_backup.tar.gz" ]; then
  echo "❌ No se encontró backups/chroma_backup.tar.gz"
  echo "   Copia los backups desde el M1 (AirDrop / USB / scp)"
  echo "   y colócalos en ~/langfuse-poc/backups/"
  exit 1
fi

if [ ! -f "backups/postgres_backup.sql" ]; then
  echo "❌ No se encontró backups/postgres_backup.sql"
  exit 1
fi

echo "   ✅ Backups encontrados:"
ls -lh backups/

# ── Verificar que Docker está corriendo ────────────────────────────────────
echo ""
echo "🐳 Verificando servicios Docker..."
docker compose ps --format "table {{.Name}}\t{{.Status}}"

# ── 1. Restaurar ChromaDB ──────────────────────────────────────────────────
echo ""
echo "📥 Restaurando ChromaDB (embeddings RAG)..."
docker run --rm \
  -v langfuse-poc_langfuse_chroma_data:/data \
  -v ~/langfuse-poc/backups:/backup \
  alpine tar xzf /backup/chroma_backup.tar.gz -C /data
echo "   ✅ ChromaDB restaurado"

# ── 2. Restaurar PostgreSQL ────────────────────────────────────────────────
echo ""
echo "📥 Restaurando PostgreSQL (historial Langfuse)..."

# Esperar que postgres esté listo
echo "   Esperando que PostgreSQL esté disponible..."
until docker exec langfuse-poc-postgres-1 pg_isready -U postgres &>/dev/null; do
  sleep 2
done

docker exec -i langfuse-poc-postgres-1 \
  psql -U postgres < backups/postgres_backup.sql > /dev/null 2>&1
echo "   ✅ PostgreSQL restaurado"

# ── 3. Reiniciar servicios para que lean los datos nuevos ─────────────────
echo ""
echo "🔄 Reiniciando servicios Langfuse..."
docker compose restart langfuse-worker langfuse-web
sleep 10

# ── Verificación final ─────────────────────────────────────────────────────
echo ""
echo "🔍 Verificando restauración..."

# Test ChromaDB
CHROMA_OK=$(curl -s http://localhost:8000/api/v2/heartbeat | grep -c "nanosecond_heartbeat" || true)
if [ "$CHROMA_OK" -gt 0 ]; then
  echo "   ✅ ChromaDB responde OK"
else
  echo "   ⚠️  ChromaDB no responde — espera 30 segundos y verifica con: curl http://localhost:8000/api/v2/heartbeat"
fi

# Test Langfuse
LANGFUSE_OK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/public/health)
if [ "$LANGFUSE_OK" = "200" ]; then
  echo "   ✅ Langfuse responde OK"
else
  echo "   ⚠️  Langfuse no responde aún — espera 30 segundos y abre http://localhost:3000"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Restauración completada."
echo ""
echo "🔗 Verifica en el navegador:"
echo "   http://localhost:3000 → deberías ver tus traces y scores históricos"
echo ""
echo "🧪 Prueba rápida del agente:"
echo "   cd ~/langfuse-poc/poc4 && npm run agent"
