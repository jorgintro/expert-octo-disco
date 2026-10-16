#!/usr/bin/env bash
# Libera los bloqueos por IP (administrador y PIN de agentes) SIN depender del panel.
# Úsalo en el servidor si te bloqueas tú. Funciona aunque la app esté parada o en bucle de reinicios.
#
# Uso:
#   scripts/desbloquear.sh                       libera todas las IP, administrador y PIN
#   scripts/desbloquear.sh 203.0.113.5           libera solo esa IP
#   scripts/desbloquear.sh --ambito admin        libera solo los bloqueos de contraseña de administrador
#   scripts/desbloquear.sh 203.0.113.5 --ambito pin
set -euo pipefail

cd "$(dirname "$0")/.."
SERVICIO=tiroriro

command -v docker >/dev/null || { echo "ERROR: docker no está instalado." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: falta el plugin «docker compose»." >&2; exit 1; }

if docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICIO"; then
  docker compose exec -T "$SERVICIO" node scripts/desbloquear.js "$@"
else
  echo "La app no está en marcha: se usa un contenedor temporal con la misma imagen." >&2
  docker compose run --rm --no-deps --entrypoint node "$SERVICIO" scripts/desbloquear.js "$@"
fi
