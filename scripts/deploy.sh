#!/usr/bin/env bash
# Despliegue en el servidor: copia previa de la base, actualización del código, build y comprobación.
#
# Uso:
#   scripts/deploy.sh              avanza la rama actual (git fetch + merge --ff-only) y despliega
#   scripts/deploy.sh v0.2.2       despliega esa etiqueta (o commit) de git; también sirve para volver atrás
#
# Variables opcionales: ESPERA_S (segundos máximos esperando a /healthz, 90 por defecto)
#                       SIN_COPIA=1 (continúa aunque no se pueda copiar la base; no recomendado)
set -Eeuo pipefail

cd "$(dirname "$0")/.."

SERVICIO=tiroriro
DB=data/app.db
ESPERA_S="${ESPERA_S:-90}"
REF="${1:-}"

ETAPA="comprobaciones previas"
DESPLEGANDO=0
PREV_COMMIT=""
COPIA=""

info() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# Ejecuta una petición HTTP contra la app desde dentro del contenedor (el puerto no se publica).
en_contenedor() {
  docker compose exec -T "$SERVICIO" node -e "fetch('http://127.0.0.1:3000$1').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
}

fallo() {
  local rc=$?
  trap - ERR
  {
    printf '\nFALLO en la etapa «%s» (código %s)\n' "$ETAPA" "$rc"
    if [ "$DESPLEGANDO" = 1 ]; then
      printf '\n--- Últimas líneas del log de %s ---\n' "$SERVICIO"
      docker compose logs --tail 60 "$SERVICIO" || true
      printf '\n--- Estado de los contenedores ---\n'
      docker compose ps || true
      printf '\nSi el log termina en «exited with code 139» o falla better-sqlite3/argon2, ejecuta scripts/smoke.sh\n'
    fi
    if [ -n "$PREV_COMMIT" ]; then
      printf '\n--- Cómo volver atrás ---\n'
      printf '1) Código anterior (commit %s):\n' "$PREV_COMMIT"
      printf '     scripts/deploy.sh %s\n' "$PREV_COMMIT"
      printf '   (para volver después a la rama: git checkout <rama>)\n'
      if [ -n "$COPIA" ] && [ -f "$COPIA" ]; then
        printf '2) Solo si la versión nueva ya migró la base y la anterior no la entiende, restaura la copia:\n'
        printf '     docker compose stop\n'
        printf '     cp %s %s && rm -f %s-wal %s-shm\n' "$COPIA" "$DB" "$DB" "$DB"
        printf '     scripts/deploy.sh %s\n' "$PREV_COMMIT"
      fi
    fi
  } >&2
  exit "$rc"
}
trap fallo ERR

# ---------- Comprobaciones previas ----------
command -v git >/dev/null || die "git no está instalado."
command -v docker >/dev/null || die "docker no está instalado."
docker compose version >/dev/null 2>&1 || die "Falta el plugin «docker compose»."
[ -f .env ] || die "Falta el archivo .env (cp .env.example .env y rellénalo)."
[ -f docker-compose.yml ] || die "Ejecuta el script desde el repositorio (no se encuentra docker-compose.yml)."
if [ -n "$REF" ]; then
  [[ "$REF" =~ ^[A-Za-z0-9._/-]+$ && "$REF" != -* ]] || die "Etiqueta o commit no válido: «$REF»."
fi

# ---------- Código: obtener y validar (aún no se toca nada) ----------
ETAPA="obtención y validación del código (git)"
info "Comprobando el código"
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Hay cambios locales sin confirmar en archivos versionados. Confírmalos o guárdalos (git stash) y repite."
fi
PREV_COMMIT="$(git rev-parse --short HEAD)"
git fetch --tags --prune origin
if [ -n "$REF" ]; then
  git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null || die "No existe la etiqueta o commit «$REF» (¿está subido a origin?)."
else
  git symbolic-ref -q HEAD >/dev/null \
    || die "Estás en HEAD desacoplado (por un despliegue anterior con etiqueta). Vuelve a una rama: git checkout <rama>"
  git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 \
    || die "La rama actual no tiene rama remota asociada (git branch -u origin/<rama>)."
  git merge-base --is-ancestor HEAD '@{u}' \
    || die "No se puede avanzar con --ff-only: la rama local y la remota han divergido. Revísalo a mano."
fi

# ---------- Copia previa de la base ----------
ETAPA="copia previa de la base"
info "Copia de seguridad previa"
if [ ! -f "$DB" ]; then
  echo "No existe $DB todavía (primer despliegue): no hay nada que copiar."
else
  NOMBRE="copia-predeploy-$(date +%Y%m%d-%H%M%S).db"
  COPIA="data/$NOMBRE"
  SQL=".backup '/app/data/$NOMBRE'"
  # .backup de SQLite es seguro con la base en uso. Primero con la app en marcha, luego con
  # sqlite3 del host y, por último, con un contenedor efímero de la misma imagen.
  if docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICIO" \
     && docker compose exec -T "$SERVICIO" sqlite3 /app/data/app.db "$SQL"; then
    :
  elif command -v sqlite3 >/dev/null 2>&1 && sqlite3 "$DB" ".backup '$COPIA'"; then
    :
  elif docker compose run --rm --no-deps --entrypoint sqlite3 "$SERVICIO" /app/data/app.db "$SQL"; then
    :
  else
    COPIA=""
    [ "${SIN_COPIA:-}" = 1 ] || die "No se pudo copiar la base de datos. Abortado sin tocar nada (SIN_COPIA=1 para continuar sin copia)."
    echo "AVISO: continuando SIN copia de la base (SIN_COPIA=1)." >&2
  fi
  if [ -n "$COPIA" ]; then
    [ -s "$COPIA" ] || die "La copia $COPIA no se ha creado o está vacía. Abortado."
    echo "Copia creada: $COPIA ($(du -h "$COPIA" | cut -f1))"
  fi
fi

# ---------- Código: aplicar ----------
ETAPA="actualización del código (git)"
info "Actualizando el código"
if [ -n "$REF" ]; then
  git checkout --quiet --detach "$REF"
else
  git merge --ff-only '@{u}'
fi
NUEVO_COMMIT="$(git rev-parse --short HEAD)"
if [ "$PREV_COMMIT" = "$NUEVO_COMMIT" ]; then
  echo "Código sin cambios ($NUEVO_COMMIT); se reconstruye igualmente."
else
  echo "Código: $PREV_COMMIT → $NUEVO_COMMIT"
fi

# ---------- Build y arranque ----------
ETAPA="construcción y arranque (docker compose up -d --build)"
DESPLEGANDO=1
info "Construyendo y arrancando (el build ejecuta la comprobación de arranque)"
docker compose up -d --build

# ---------- Comprobación ----------
ETAPA="espera de /healthz"
info "Esperando a /healthz (máximo ${ESPERA_S} s)"
LIMITE=$((SECONDS + ESPERA_S))
until en_contenedor /healthz >/dev/null 2>&1; do
  CID="$(docker compose ps -q "$SERVICIO" 2>/dev/null || true)"
  if [ -n "$CID" ]; then
    REINICIOS="$(docker inspect -f '{{.RestartCount}}' "$CID" 2>/dev/null || echo 0)"
    if [ "${REINICIOS:-0}" -ge 3 ]; then
      printf '\nEl contenedor se reinicia en bucle (%s reinicios).\n' "$REINICIOS" >&2
      false
    fi
  fi
  if [ "$SECONDS" -ge "$LIMITE" ]; then
    printf '\n/healthz no respondió en %s s.\n' "$ESPERA_S" >&2
    false
  fi
  printf '.'
  sleep 2
done
printf '\n'

ETAPA="lectura de /version"
VERSION="$(en_contenedor /version)"
info "Despliegue correcto"
echo "/healthz → ok"
echo "/version → $VERSION"
docker compose ps
[ -z "$COPIA" ] || echo "Copia previa de la base: $COPIA"
echo "Comprueba también desde fuera: https://tiroriro.jdiaz.bid/version"
