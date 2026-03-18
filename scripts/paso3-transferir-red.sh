#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 3 — Transferir backups por red local (ejecutar en destino)
# Solo si NO usas AirDrop ni USB
# Uso: bash paso3-transferir-red.sh IP_ORIGEN USUARIO_ORIGEN [RUTA_PROYECTO_ORIGEN]
# Ejemplo: bash paso3-transferir-red.sh 192.168.1.100 andres
# ═══════════════════════════════════════════════════════════════

IP_ORIGEN=$1
USUARIO_ORIGEN=$2
RUTA_ORIGEN="${3:-iacc-ai-poc}"   # ruta relativa al home del equipo origen

if [ -z "$IP_ORIGEN" ] || [ -z "$USUARIO_ORIGEN" ]; then
  echo "❌ Uso: bash paso3-transferir-red.sh IP_ORIGEN USUARIO_ORIGEN [RUTA_PROYECTO]"
  echo ""
  echo "💡 Para saber la IP del equipo origen:"
  echo "   Ajustes del Sistema → Wi-Fi → Detalles → Dirección IP"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PROJECT_DIR/backups"

echo "📡 Copiando backups desde $USUARIO_ORIGEN@$IP_ORIGEN (~/$RUTA_ORIGEN/backups/)..."
scp -r "$USUARIO_ORIGEN@$IP_ORIGEN:~/$RUTA_ORIGEN/backups/" "$PROJECT_DIR/"

echo ""
echo "✅ Archivos recibidos en $PROJECT_DIR/backups/:"
ls -lh "$PROJECT_DIR/backups/"
