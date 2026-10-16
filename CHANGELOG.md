# Changelog

Formato de versión 0.X.y. La 1.0.0 solo se publica el día de las elecciones.

## 0.3.2 — Fase 0.3, entrega 2: agentes y participación

- **Acceso de agentes por PIN:** la raíz `/` es la pantalla de PIN (6 dígitos, teclado numérico) con enlace discreto al acceso de administrador. Reutiliza el CSRF de entrada, la IP real (`TRUST_PROXY`) y el contador de intentos **del ámbito PIN** (15 fallos en 5 minutos, bloqueo de 5; separado del de administrador). Un acierto no reinicia el contador de la IP. Sesión de 14 h en cookie propia `sid_agente` (HttpOnly, Secure, SameSite=Lax); revocar o regenerar el PIN, o dar de baja al agente, la invalida.
- **Vista del agente:** solo ve y edita sus mesas activas (selector si tiene varias; cualquier otra mesa responde 403). Tarjeta del corte actual (el más reciente cuya hora ya pasó, o el primero antes de las 10:00; se puede elegir cualquier otro) con campo numérico grande y Guardar; histórico de la mesa con acumulado, parcial y % sobre censo.
- **Validaciones en servidor** (SPEC §6): entero >= 0 y <= censo, sin bajar respecto al corte anterior ni superar el siguiente ya introducido. Un salto de más del 25 % del censo en un tramo pide confirmación en dos pasos (sin bloquear). En REAL, guardar un corte que aún no ha llegado también pide confirmación; en DEMO no.
- **Correcciones y permisos:** cualquier agente de la mesa corrige las celdas de su mesa, salvo las introducidas por el administrador (bloqueadas para agentes con mensaje claro). Los agentes no vacían celdas. Reenviar el mismo dato es inocuo (sin cambios, sin auditoría). Todo cambio se audita en la base del modo (quién, cuándo, valor anterior y nuevo).
- **Administrador:** nueva pantalla «Participación» (tabla mesa × corte). Cada celda lleva a una ficha para introducir, corregir o **vaciar** (con confirmación y auditoría) el dato de cualquier mesa y corte; queda registrado como «introducido por administrador». Mismas validaciones y confirmaciones.
- **Modo:** todo lo anterior escribe en `demo.db` en DEMO y en `app.db` en REAL, con el banner visible en todas las pantallas.
- **Mala conexión:** `public/agente.js` (mejora progresiva, sin dependencias): envío con tiempo máximo y hasta 3 intentos, mensaje claro si falla, el valor escrito no se pierde y se guarda un borrador en el dispositivo. Sin JavaScript el formulario funciona igual.
- **`scripts/desbloquear.sh`** (+ `scripts/desbloquear.js`): libera los bloqueos por IP (administrador y PIN) desde el servidor sin depender del panel, aunque la app esté parada. Lo audita.
- **Corregido durante la fase:** la zona de agente ya no puede eliminar la sesión de otro rol si recibe su token en su cookie.
- La comprobación de arranque del build verifica además la pantalla de PIN y `public/agente.js`.

## 0.3.1 — Fase 0.3, entrega 1: modo DEMO / REAL

- **Datos separados:** `data/app.db` (configuración + captura real) y `data/demo.db` (solo captura de prueba y su auditoría, sin claves foráneas: referencia mesas y cortes de `app.db` por id). Migraciones nuevas: `002_bloqueo_ip.sql` y `migrations/captura/001_participacion.sql` (tabla `participacion`, aplicada a ambas bases).
- **Aislamiento estructural:** toda la captura pasa por `src/captura.js`; el gestor (`src/datos.js`) entrega a las rutas solo la captura del destino del modo (`req.captura`). Una captura obtenida antes de un cambio de modo deja de valer (nunca escribe en otro destino). Una prueba comprueba que ninguna ruta tiene SQL de captura.
- **Modo efectivo** = override manual o automático (`ELECTION_DATE`, por defecto 2026-11-29, hora de Madrid): DEMO antes, REAL desde las 00:00 de ese día, que anula los overrides fijados antes. Se evalúa en cada petición, sin cron, con reloj inyectable. Transiciones síncronas, atómicas e idempotentes (también ante peticiones simultáneas o caídas a medias).
- **Pantalla «Modo de trabajo»:** modo, motivo, fecha y hora del servidor en Madrid; cambio con contraseña y palabra (`DEMO`/`REAL`, o `DEMO EN JORNADA` desde el día de las elecciones); aviso de cuántos registros se pierden; «Reiniciar demo». Todo se audita en `app.db`.
- **Descarte automático:** entrar en DEMO parte de una demo vacía; salir a REAL elimina `demo.db`. El borrado usa una ruta constante y se niega a tocar `app.db`.
- **Señalización:** banner naranja «MODO DEMO - datos de prueba» en todas las pantallas; indicador discreto en REAL; `/healthz` y `/version` incluyen el modo.
- **Intentos por IP con contadores separados:** administrador (5 fallos en 15 min, bloqueo de 5 min; login, pantalla de modo y cambio de contraseña) y PIN de agentes (15 fallos en 5 min, bloqueo de 5 min; se usará en la 0.3.2). Nuevo panel «Bloqueos» con «Desbloquear IP».
- La comprobación de arranque del build ahora también verifica la zona horaria `Europe/Madrid` y el ciclo DEMO → REAL.
- `SPEC.md` (sección 9 bis, hoja de ruta 0.3.1/0.3.2, marca de agua DEMO en `/pantallazo`, lista de verificación del 29N) y `CLAUDE.md` actualizados.
- Variable nueva `ELECTION_DATE` (opcional). `demo.db` no se respalda; `scripts/deploy.sh` ya copiaba solo `app.db`.

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
