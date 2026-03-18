#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 2 — Exportar datos Docker (ejecutar en el equipo origen)
# Genera 2 archivos de backup en <proyecto>/backups/
# ═══════════════════════════════════════════════════════════════

set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_PROJECT="$(basename "$PROJECT_DIR")"
cd "$PROJECT_DIR"
mkdir -p backups

echo "🐳 Verificando que Docker está corriendo..."
docker compose ps --format "table {{.Name}}\t{{.Status}}"
echo ""

# ── 1. ChromaDB (embeddings RAG: 2.865 documentos) ──────────────────────────
echo "📦 Exportando ChromaDB (embeddings RAG)..."
docker run --rm \
  -v "${DOCKER_PROJECT}_langfuse_chroma_data":/data \
  -v "$PROJECT_DIR/backups":/backup \
  alpine tar czf /backup/chroma_backup.tar.gz -C /data .
echo "   ✅ chroma_backup.tar.gz guardado"

# ── 2. PostgreSQL (traces, scores, proyectos Langfuse) ───────────────────────
echo "📦 Exportando PostgreSQL (historial Langfuse)..."
docker exec "${DOCKER_PROJECT}-postgres-1" \
  pg_dumpall -U postgres > "$PROJECT_DIR/backups/postgres_backup.sql"
echo "   ✅ postgres_backup.sql guardado"

# ── Resumen ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "📊 Archivos generados en $PROJECT_DIR/backups/"
ls -lh "$PROJECT_DIR/backups/"
echo ""
echo "✅ Listo para transferir al equipo destino."
echo "   Opción A — AirDrop: abre Finder → carpeta backups/ → AirDrop"
echo "   Opción B — USB:     copia la carpeta backups/ al pendrive"
echo "   Opción C — Red:     ver instrucciones en paso3-transferir-red.sh"
