#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 2 — Exportar datos Docker (ejecutar en MacBook M1)
# Genera 2 archivos de backup en ~/langfuse-poc/backups/
# ═══════════════════════════════════════════════════════════════

set -e
cd ~/langfuse-poc
mkdir -p backups

echo "🐳 Verificando que Docker está corriendo..."
docker compose ps --format "table {{.Name}}\t{{.Status}}"
echo ""

# ── 1. ChromaDB (embeddings RAG: 2.865 documentos) ──────────────────────────
echo "📦 Exportando ChromaDB (embeddings RAG)..."
docker run --rm \
  -v langfuse-poc_langfuse_chroma_data:/data \
  -v ~/langfuse-poc/backups:/backup \
  alpine tar czf /backup/chroma_backup.tar.gz -C /data .
echo "   ✅ chroma_backup.tar.gz guardado"

# ── 2. PostgreSQL (traces, scores, proyectos Langfuse) ───────────────────────
echo "📦 Exportando PostgreSQL (historial Langfuse)..."
docker exec langfuse-poc-postgres-1 \
  pg_dumpall -U postgres > ~/langfuse-poc/backups/postgres_backup.sql
echo "   ✅ postgres_backup.sql guardado"

# ── Resumen ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "📊 Archivos generados en ~/langfuse-poc/backups/"
ls -lh ~/langfuse-poc/backups/
echo ""
echo "✅ Listo para transferir al MacBook M5."
echo "   Opción A — AirDrop: abre Finder → carpeta backups/ → AirDrop"
echo "   Opción B — USB:     copia la carpeta backups/ al pendrive"
echo "   Opción C — Red:     ver instrucciones en paso3-transferir.sh"
