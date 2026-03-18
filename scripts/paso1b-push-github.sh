#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 1b — Commit y push a GitHub
# Uso: bash paso1b-push-github.sh https://github.com/TU_USUARIO/iacc-ai-poc.git
# ═══════════════════════════════════════════════════════════════

set -e
REPO_URL=$1

if [ -z "$REPO_URL" ]; then
  echo "❌ Debes pasar la URL del repositorio como argumento."
  echo "   Uso: bash paso1b-push-github.sh https://github.com/TU_USUARIO/iacc-ai-poc.git"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

git add .
git commit -m "feat: IACC AI POC Lab — POCs 1-9 completos

- POC 1: LLM Observability con Langfuse
- POC 2: MCP Server (get_student_info, calculate_final_grade)
- POC 3: RAG multi-fuente (Excel + Jira Cloud + Wiki.js → ChromaDB)
- POC 4: Agente multi-herramienta (Claude Sonnet 4.6 + 4 tools)
- POC 5: LLM-as-Judge (evaluación automática en 4 dimensiones)
- POC 6: Prompt Experiments (3 variantes + Langfuse Datasets)
- POC 6b: Langfuse Prompt Management
- POC 7: Guardrails + RBAC (scope, injection, permisos, redacción)
- POC 8: Teams Bot (Bot Framework + lista blanca de usuarios)
- POC 9: AI Gateway LiteLLM (virtual keys, límites, alias de modelos)"

git branch -M main
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
git push -u origin main

echo ""
echo "✅ Código subido a GitHub: $REPO_URL"
