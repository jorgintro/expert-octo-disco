# Changelog

Formato de versión 0.X.y. La 1.0.0 solo se publica el día de las elecciones.

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
