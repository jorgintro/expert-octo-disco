# Changelog

Formato de versión 0.X.y. La 1.0.0 solo se publica el día de las elecciones.

## 0.2.2 — Corrección de despliegue (Node 22 / Debian)

- **Corregido:** la 0.2.1 entraba en bucle con código 139 (segfault) porque `better-sqlite3` 13 exige Node >= 22 y la imagen era `node:20-alpine`. La imagen pasa a `node:22-bookworm-slim` (Debian, glibc) en las dos etapas; las herramientas de compilación solo están en la etapa de build; sigue el cliente `sqlite3` y el usuario `node` (uid 1000).
- `engines.node >= 22`; CLAUDE.md y SPEC.md actualizados (Node 22 LTS).
- El build ejecuta `scripts/comprobar-arranque.js` (better-sqlite3 en memoria y en disco con WAL, argon2, migraciones, seed y `/healthz`): un fallo así rompe el build.
- `scripts/smoke.sh`: prueba de humo de la imagen ya construida (OK o error).
- `scripts/deploy.sh`: copia previa de la base, `git fetch` + `--ff-only` (o etiqueta/commit como argumento), `docker compose up -d --build`, espera a `/healthz`, muestra `/version` y, si falla, logs y cómo volver atrás.
- IP real del cliente: `TRUST_PROXY` (por defecto 2: Cloudflare + NPM). Sustituye al `trustProxy: true`, que permitía falsear `X-Forwarded-For` y saltarse el bloqueo por IP. Se exige que el proxy inmediato sea una IP privada.
- CSRF en el login de administrador (token firmado + cookie `csrf_login`).
- `HEALTHCHECK` con el `fetch` de Node (la imagen no incluye wget ni curl).
- README: variable `TRUST_PROXY`, despliegue con scripts y consultas a la base desde el contenedor.

## 0.2.1 — Fase 0.2: modelo de datos y administración

- SQLite (`better-sqlite3`, WAL, claves foráneas) con migraciones SQL versionadas (`migrations/001_inicial.sql`).
- Seed idempotente: colegio, 6 mesas (censo 4.181), 6 cortes y administrador inicial; no pisa datos editados.
- Login de administrador (argon2, sesiones en servidor, cookie `HttpOnly`/`Secure`/`SameSite=Lax`, CSRF, bloqueo por IP tras 5 fallos durante 5 minutos).
- Panel: CRUD de mesas con censo editable (baja lógica), agentes con asignación a mesas, generación/regeneración/revocación de PIN (6 dígitos, solo HMAC en base de datos) y cambio de contraseña.
- Auditoría de toda modificación; los PIN y contraseñas nunca se registran.
- La app no arranca con secretos ausentes, de ejemplo o demasiado cortos.
- `Dockerfile` en dos etapas con cliente `sqlite3` para las copias de seguridad.
- Nuevas variables: `COOKIE_SECURE` (opcional). Los secretos pasan a ser obligatorios.

## 0.1.1 — Fase 0.1: esqueleto

- Servidor Fastify con `/healthz` y `/version`.
- Página de inicio mobile-first (360 px) con la versión en el pie.
- Cabeceras de seguridad básicas.
- `Dockerfile` y `docker-compose.yml` (red externa `npm_default`, puerto interno 3000).
- Guía de despliegue detrás de Nginx Proxy Manager en el `README.md`.
- Pruebas automáticas de los endpoints.
