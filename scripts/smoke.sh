#!/usr/bin/env bash
# Prueba de humo de la imagen Docker ya construida. Muestra OK o el error.
# Uso (en el servidor, tras `docker compose build`):  scripts/smoke.sh [imagen]
# Por defecto prueba la imagen tiroriro:local (la que construye docker-compose.yml).
set -uo pipefail

cd "$(dirname "$0")/.."
IMAGEN="${1:-tiroriro:local}"
FALLOS=0

paso() {
  local nombre="$1"; shift
  local salida rc
  salida="$("$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '  ok     %s\n' "$nombre"
    [ -n "${MOSTRAR:-}" ] && printf '%s\n' "$salida" | sed 's/^/           /'
  else
    FALLOS=$((FALLOS + 1))
    printf '  ERROR  %s (código de salida %s)\n' "$nombre" "$rc"
    [ "$rc" -eq 139 ] && printf '         139 = segfault: módulo nativo incompatible con el Node de la imagen\n'
    printf '%s\n' "$salida" | sed 's/^/         /'
  fi
}

echo "Prueba de humo de la imagen: $IMAGEN"

if ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
  echo "ERROR: la imagen $IMAGEN no existe. Constrúyela primero con: docker compose build"
  exit 1
fi

paso "versión de Node (debe ser 22)"   docker run --rm --entrypoint node "$IMAGEN" -e "console.log(process.version); process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
paso "usuario del contenedor (uid 1000)" docker run --rm --entrypoint sh "$IMAGEN" -c 'test "$(id -u)" = 1000 && id'
paso "cliente sqlite3 presente"         docker run --rm --entrypoint sqlite3 "$IMAGEN" --version
paso "better-sqlite3, argon2 y app"     docker run --rm --entrypoint node "$IMAGEN" scripts/comprobar-arranque.js --exigir-cli

# El volumen ./data debe ser escribible por el usuario del contenedor (uid 1000).
mkdir -p data
paso "escritura en ./data (volumen)"    docker run --rm -v "$PWD/data:/app/data" --entrypoint sh "$IMAGEN" -c 'touch /app/data/.smoke && rm /app/data/.smoke'

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "OK: la imagen $IMAGEN supera la prueba de humo"
else
  echo "ERROR: $FALLOS comprobación(es) fallida(s). No despliegues esta imagen."
  echo "       Si falla la escritura en ./data:  sudo chown -R 1000:1000 data"
  exit 1
fi
