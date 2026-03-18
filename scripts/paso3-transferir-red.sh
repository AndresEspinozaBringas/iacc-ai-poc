#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PASO 3 — Transferir por red local (ejecutar en MacBook M5)
# Solo si NO usas AirDrop ni USB
# Uso: bash paso3-transferir-red.sh IP_DEL_M1 USUARIO_DEL_M1
# Ejemplo: bash paso3-transferir-red.sh 192.168.1.100 andres
# ═══════════════════════════════════════════════════════════════

IP_M1=$1
USUARIO_M1=$2

if [ -z "$IP_M1" ] || [ -z "$USUARIO_M1" ]; then
  echo "❌ Uso: bash paso3-transferir-red.sh IP_DEL_M1 USUARIO_DEL_M1"
  echo ""
  echo "💡 Para saber la IP del M1:"
  echo "   En el M1 → Ajustes del Sistema → Wi-Fi → Detalles → Dirección IP"
  exit 1
fi

mkdir -p ~/langfuse-poc/backups

echo "📡 Copiando backups desde M1 ($USUARIO_M1@$IP_M1)..."
scp -r "$USUARIO_M1@$IP_M1:~/langfuse-poc/backups/" ~/langfuse-poc/

echo ""
echo "✅ Archivos recibidos:"
ls -lh ~/langfuse-poc/backups/
