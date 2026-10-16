# Participación y recuento (tiroriro)

Miniaplicación web mobile-first para registrar la participación y el recuento por mesa en un colegio electoral (piloto: Colegio Dulcinea, Alcalá de Henares). Requisitos y hoja de ruta en [`SPEC.md`](SPEC.md); reglas de trabajo en [`CLAUDE.md`](CLAUDE.md).

Versión actual: ver `package.json` (también en el pie de la app y en `/version`).

## Desarrollo local

Requiere **Node.js 22 o superior** (y herramientas de compilación si `better-sqlite3` o `argon2` no tienen binario para tu sistema).

```bash
npm ci
npm test
# Variables mínimas (ver .env.example). COOKIE_SECURE=false solo para probar por http en local.
export SESSION_SECRET=$(openssl rand -hex 32) PIN_HMAC_SECRET=$(openssl rand -hex 32)
export ADMIN_USER=admin ADMIN_PASSWORD_INITIAL='una-contraseña-larga' COOKIE_SECURE=false
npm start
```

Después abre <http://localhost:3000>. Al arrancar se aplican las migraciones y el seed (también disponible como `npm run seed`). El seed es idempotente: solo crea lo que falta y nunca pisa censos ni contraseñas ya editados.

## Despliegue con Docker

1. Crea el archivo de entorno: `cp .env.example .env` y edítalo. **Rellena los secretos** (`openssl rand -hex 32`) y la contraseña inicial del administrador: la app se niega a arrancar con los valores de ejemplo.
   Da permisos al volumen de datos (el usuario del contenedor es `node`, uid 1000): `sudo chown -R 1000:1000 data`.
2. Comprueba que existe la red compartida con Nginx Proxy Manager:
   `docker network ls | grep npm_default`. Si NPM usa otro nombre de red, cámbialo en `docker-compose.yml`.
3. Levanta la app: `docker compose up -d --build`. El build ejecuta una comprobación de arranque (`scripts/comprobar-arranque.js`: better-sqlite3 con WAL, argon2, migraciones y seed) y se rompe si el entorno no puede ejecutar la app.
4. Verifica desde otro contenedor de la red o, tras configurar NPM, desde fuera:
   - `/healthz` devuelve `{"estado":"ok"}`.
   - `/version` devuelve la versión.
   - `/admin/login` permite entrar con `ADMIN_USER` y `ADMIN_PASSWORD_INITIAL`. Cambia la contraseña desde **Contraseña**.

La app no publica ningún puerto a Internet. La base de datos SQLite está en `./data/app.db` (volumen). Al actualizar de versión, `docker compose up -d --build` aplica las migraciones nuevas sin perder datos.

## Despliegue y actualización (scripts)

Imagen: `node:22-bookworm-slim` (Debian/glibc). No uses Alpine ni Node 20: `better-sqlite3` 13 exige Node 22.

```bash
scripts/deploy.sh              # avanza la rama actual (git fetch + --ff-only) y despliega
scripts/deploy.sh v0.2.2       # despliega una etiqueta (o commit) concreta; sirve también para volver atrás
scripts/smoke.sh               # prueba de humo de la imagen ya construida (tiroriro:local); muestra OK o el error
```

`deploy.sh` hace, en orden: valida el árbol git (`fetch`, sin cambios locales, `--ff-only` posible), **copia la base** a `data/copia-predeploy-AAAAMMDD-HHMMSS.db` (con `.backup` de SQLite), actualiza el código, ejecuta `docker compose up -d --build`, espera a `/healthz` (90 s; `ESPERA_S=…` para cambiarlo), muestra `/version` y, si algo falla, imprime los logs del contenedor y cómo volver atrás. Si estás en HEAD desacoplado por un despliegue con etiqueta, vuelve a la rama con `git checkout <rama>`.

`smoke.sh` comprueba sobre la imagen: versión de Node, usuario uid 1000, `sqlite3`, better-sqlite3/argon2/app (`comprobar-arranque.js`) y que `./data` es escribible. Un segfault (código 139) se señala expresamente.

## Modo de trabajo: DEMO / REAL (`ELECTION_DATE`)

Para practicar sin riesgo para los datos reales, la app trabaja en dos modos:

| | DEMO | REAL |
|---|------|------|
| Captura (participación, recuento) | `data/demo.db` (datos de prueba) | `data/app.db` (datos reales) |
| Configuración (mesas, censos, agentes, PIN...) | `data/app.db` | `data/app.db` |
| Banner | naranja fijo «MODO DEMO - datos de prueba» | indicador discreto |

- **Automático:** `ELECTION_DATE` (AAAA-MM-DD, hora de Madrid, por defecto `2026-11-29`). Antes de esa fecha la app está en DEMO; **desde las 00:00 de ese día pasa a REAL sola** y anula cualquier modo fijado a mano antes. Se evalúa al atender peticiones (no hay cron). Si cambias la fecha, edita `.env` y recrea el contenedor: `docker compose up -d --force-recreate`.
- **Manual:** panel → **Modo** (pantalla «Modo de trabajo»). Pasar a DEMO o REAL pide la contraseña de administrador y escribir `DEMO` o `REAL`. Desde el día de las elecciones, pasar a DEMO exige escribir `DEMO EN JORNADA` y queda en la auditoría. «Reiniciar demo» (solo en DEMO) vacía los datos de prueba.
- **Descarte:** al entrar en DEMO se parte de una `demo.db` vacía; al pasar a REAL se **elimina** `demo.db` (la pantalla avisa de cuántos registros se pierden). Nada de lo hecho en demo sobrevive ni toca los datos reales.
- **Copias de seguridad:** `scripts/deploy.sh` y las copias documentadas cubren solo `app.db`; `demo.db` no se respalda.
- `/healthz` y `/version` incluyen el modo (`{"estado":"ok","modo":"DEMO"}`).
- Hay una sola `demo.db` que ve toda la aplicación: si dos personas practican a la vez, comparten los mismos datos de prueba.

**Comprobación a primera hora del 29N:** el banner naranja ha desaparecido, `https://tiroriro.jdiaz.bid/version` devuelve `"modo":"REAL"` y en panel → Modo la hora del servidor es la de Madrid (de ella depende el cambio automático). Si algo falla, panel → Modo → «Pasar a REAL».

## Bloqueos de IP

Los intentos fallidos se cuentan por IP y **por separado**: contraseña de administrador (login, pantalla de modo y cambio de contraseña: 5 fallos en 15 minutos → bloqueo de 5 minutos) y PIN de agentes (15 fallos en 5 minutos → bloqueo de 5 minutos). Los agentes de un colegio comparten IP pública, y un fallo del administrador nunca los bloquea. Panel → **Bloqueos** muestra las IP bloqueadas y permite **desbloquear una IP** (por ámbito o todas). Si es el propio administrador el bloqueado, el bloqueo caduca solo a los 5 minutos (o se desbloquea desde otra red).

### Si te bloqueas tú: `scripts/desbloquear.sh`

Sin depender del panel (útil si es tu IP la bloqueada). Se ejecuta **en el servidor**, desde el directorio del repositorio:

```bash
scripts/desbloquear.sh                         # libera todas las IP, administrador y PIN
scripts/desbloquear.sh 203.0.113.5             # solo esa IP
scripts/desbloquear.sh --ambito admin          # solo bloqueos de contraseña de administrador
scripts/desbloquear.sh 203.0.113.5 --ambito pin
```

Muestra qué había bloqueado y cuántos registros elimina, y deja constancia en la auditoría (`origen: script`). Si la app está arrancada usa `docker compose exec`; si no (parada o en bucle de reinicios), usa un contenedor temporal con la misma imagen. Para saber tu IP, consulta `docker compose logs --tail 20 tiroriro` (campo `remoteAddress`) o la pantalla Bloqueos si aún puedes entrar.

## IP real del cliente (`TRUST_PROXY`)

El bloqueo de intentos de login es por IP, así que la app debe conocer la IP real. La cadena es *cliente → Cloudflare → Nginx Proxy Manager → app* y `TRUST_PROXY` indica cuántos saltos son de confianza:

| Situación | `TRUST_PROXY` |
|-----------|---------------|
| Cloudflare con nube naranja + NPM (actual) | `2` |
| Solo NPM (DNS sin proxy de Cloudflare) | `1` |
| Acceso directo, sin proxy | `0` |

Además, la app solo confía en `X-Forwarded-*` si quien conecta con ella es una IP privada (la red Docker): un cliente que llegue directo no puede falsear su IP. Si pones un valor que no corresponde a tu cadena, la IP detectada será incorrecta (la de un proxy, o una falseable).

Comprobación: tras iniciar sesión (o fallar un login), `docker compose logs --tail 20 tiroriro` debe mostrar en `remoteAddress` tu IP pública, no una `172.x`. Las cookies de sesión llevan siempre el atributo `Secure`; el navegador las acepta porque accede por HTTPS.

Limitación: si alguien accede al servidor saltándose Cloudflare (a la IP de origen) puede falsear el primer salto de `X-Forwarded-For`. Para evitarlo, restringe en el cortafuegos los puertos 80/443 a las IP de Cloudflare.

## Configuración en Nginx Proxy Manager

Dominio: `tiroriro.jdiaz.bid` (DNS en Cloudflare apuntando al servidor).

En **Hosts → Proxy Hosts → Add Proxy Host**:

| Campo | Valor |
|-------|-------|
| Domain Names | `tiroriro.jdiaz.bid` |
| Scheme | `http` |
| Forward Hostname / IP | `tiroriro` (nombre del contenedor de la app) |
| Forward Port | `3000` |
| Block Common Exploits | activado |
| Websockets Support | no necesario |

En la pestaña **SSL**: solicita un certificado Let's Encrypt para el dominio y activa **Force SSL** (y, si quieres, HTTP/2). Si usas Cloudflare con proxy naranja, el modo SSL de Cloudflare debe ser *Full* o *Full (strict)*.

### Sobre `127.0.0.1`

La alternativa de publicar el puerto en `127.0.0.1:3000` (comentada en `docker-compose.yml`) **no funciona si NPM corre en un contenedor**, porque dentro del contenedor de NPM `127.0.0.1` es el propio NPM, no el host. Úsala solo si NPM corre directamente en el host. En el caso habitual (NPM en Docker) usa la red externa `npm_default` y el nombre del contenedor, como arriba.

## Copia de seguridad

Con la app en marcha (usa el `.backup` de SQLite, seguro con la base abierta):

```bash
docker compose exec tiroriro sqlite3 /app/data/app.db ".backup '/app/data/copia-$(date +%Y%m%d-%H%M).db'"
```

Las copias quedan en `./data` del servidor. Si tienes `sqlite3` en el host, también vale `sqlite3 data/app.db ".backup 'data/copia.db'"`. No copies el archivo `app.db` a mano mientras la app escribe (el modo WAL usa archivos auxiliares). La copia automática y la descarga desde el panel llegan en fases posteriores.

## Consultar la base de datos desde el contenedor

La imagen incluye el cliente `sqlite3`. Para mirar sin riesgo de modificar nada, usa `-readonly`:

```bash
docker compose exec tiroriro sqlite3 -readonly -header -column /app/data/app.db "SELECT codigo, censo, activa FROM mesa"
docker compose exec tiroriro sqlite3 -readonly -header -column /app/data/app.db "SELECT id, nombre, activo, pin_hmac IS NOT NULL AS con_pin FROM agente"
docker compose exec tiroriro sqlite3 -readonly -header -column /app/data/app.db "SELECT fecha, actor_tipo, accion, entidad, valor_anterior, valor_nuevo FROM auditoria ORDER BY id DESC LIMIT 20"
docker compose exec -it tiroriro sqlite3 -readonly /app/data/app.db      # consola interactiva
```

Las fechas están en UTC. Si el contenedor no está arrancado, usa `docker compose run --rm --no-deps --entrypoint sqlite3 tiroriro -readonly -header -column /app/data/app.db "…"`.

## Resumen, pantallazo, histórico y cortes (0.4)

- **Resumen** (panel → *Resumen*): tabla mesa × corte con acumulado, parcial y %; totales; `n/N` mesas informadas por corte. Se actualiza sola cada 5 s (muestra la hora de la última actualización). Las mesas de baja no cuentan. El % del **total** es sobre el censo de las mesas informadas en ese corte.
- **Pantallazo** (panel → *Pantallazo*, o `/pantallazo`): vista limpia para enviar por WhatsApp.
  1. Elige la variante: **Participación** (mesas × cortes con datos) o **Último corte** (acumulado, parcial y % por mesa). **Recuento** (mesas escrutadas, destacadas con barras, «Otros», blancos, nulos y total).
  2. Para una captura limpia, pulsa **Modo captura** (oculta los controles; toca el título para volver) y haz el pantallazo en vertical.
  3. O pulsa **Copiar como texto** y pega en WhatsApp (el texto se puede revisar en «Ver el texto que se copia»).
  - Pone «PROVISIONAL» mientras al último corte con datos le falten mesas, y la hora de actualización (Madrid) en grande.
  - **En DEMO lleva una marca de agua «DEMO» sobre toda la captura**, y el texto copiado también va marcado: no se pueden confundir con datos reales.
  - Si se pierde la conexión, aparece una franja roja «SIN CONEXIÓN · los datos son de las HH:MM:SS» arriba de la captura.
- **Histórico** (panel → Más → *Histórico*): auditoría con hora de Madrid, filtrable por mesa, actor (agente, administrador, sistema) y acción; 25 por página. En REAL muestra lo de `app.db`; en DEMO, la configuración y la captura de la demo (con etiqueta DEMO). Nunca muestra PIN ni contraseñas.
- **Cortes** (panel → Más → *Cortes*): cambia la hora de cada corte (HH:MM, en orden creciente). Si el corte ya tiene datos —reales o de demo— pide confirmación antes: los datos no cambian, solo la hora a la que se refieren. Es configuración compartida por DEMO y REAL.

## Recuento del Senado (0.6.1)

1. **Candidatos** (panel → Más → *Candidatos Senado*): cárgalos cuando se publiquen las listas, en el orden de la papeleta. Si el candidato es de un partido que también se presenta al Congreso, elígelo en «Partido»: hereda su color y su logo y forma lista con los demás de ese partido. Si no, pon una «Agrupación» (los candidatos con el mismo texto forman una lista) y un color propio. La estructura se bloquea al abrir el Senado por primera vez.
2. **Abrir el Senado** (panel → *Recuento* → pestaña *Senado* → *Abrir*): interruptor propio, independiente del Congreso. En REAL avisa si aún no son las 20:00.
3. **Agentes**: con el Senado abierto, en su mesa aparece «Abrir el recuento del Senado». Cada papeleta: tocan los nombres marcados (hasta 3) y **Confirmar papeleta**; **Lista completa** marca y confirma los 3 de un partido; **En blanco** (sin marcas) y **Nula** (más de 3 marcas u otros casos); **Deshacer última** corrige la última papeleta. Los contadores se guardan en el móvil y se envían solos por lotes: si se corta la conexión no se pierde nada. Si un agente prefiere teclear totales, puede usar «Totales» antes de guardar el primer dato.
4. **Una mesa, un modo**: el primer dato fija «sábana» o «totales». Solo el administrador puede cambiarlo: ficha de la mesa → *Reiniciar el Senado de esta mesa…* (con confirmación; borra los contadores del Senado de esa mesa).
5. **Administrador**: *Recuento → Senado* muestra resultados (votos y % sobre papeletas válidas, que no suman 100 porque cada elector marca hasta 3), votos por partido y la matriz candidato × mesa; tocando una celda se abre la ficha de la mesa (introducir, corregir, cerrar, reabrir).
6. El pantallazo del Senado y el texto de WhatsApp llegarán en la 0.6.2. En DEMO todo va a `demo.db`.

## Recuento del Congreso y candidaturas (0.5)

1. **Candidaturas** (panel → Más → *Candidaturas*): crea todas las de la circunscripción de Madrid con su posición en el orden de la Junta Electoral Central, marca las destacadas (PP, PSOE, VOX, Frente Amplio, Podemos), elige color y sube el logo (PNG, JPEG o WebP). La estructura se bloquea al activar el recuento.
2. **Abrir el recuento** (panel → *Recuento* → *Abrir*): en REAL pide antes la participación informada de todas las mesas en el último corte y avisa si aún no son las 20:00. Se puede cerrar y reabrir; los borradores se conservan.
3. **Agentes**: en su mesa aparece «Abrir el recuento». Con **+** y **−** suman o restan un voto a la candidatura que se canta; «Teclear números» permite escribir la cifra. Indican el total de votantes; la barra muestra si la suma cuadra. El borrador se guarda solo; «Cerrar mesa» pide confirmación y bloquea la edición.
4. **Administrador**: en *Recuento* ve resultados y la matriz candidaturas × mesas; tocando una celda abre la ficha de la mesa para introducir, corregir, cerrar o reabrir.
5. **Pantallazo → Recuento** y **Copiar como texto** para WhatsApp. En DEMO todo va a `demo.db` y lleva marca DEMO.

## Uso con agentes y participación (0.3)

- **Agentes:** entran en la raíz (`https://tiroriro.jdiaz.bid/`) con su PIN de 6 dígitos. Ven solo sus mesas. Para cada corte introducen el **acumulado** de votantes de la mesa (el parcial de cada tramo y el % sobre censo se calculan). El corte actual es el más reciente cuya hora ya pasó; pueden elegir otro. Pueden corregir sus datos, salvo los introducidos por el administrador. Si falla la conexión, el dato escrito no se pierde (se conserva también en el dispositivo) y se puede reintentar.
- **Validaciones:** el acumulado debe ser un entero entre 0 y el censo, sin bajar respecto al corte anterior ni superar el siguiente ya introducido. Si un tramo supera el 25 % del censo, o (en REAL) el corte aún no ha llegado, se pide confirmación.
- **Administrador → Participación:** tabla mesa × corte; al tocar una celda se introduce, corrige o **vacía** el dato (queda como «introducido por administrador», con una `A`, y los agentes ya no pueden tocarlo; si lo vacías, vuelven a poder). Plan B: el administrador puede introducirlo todo si falla un agente o la red.
- **Modo:** en DEMO todo esto se guarda en `demo.db` (se descarta al pasar a REAL); en REAL, en `app.db`. El banner naranja avisa en todas las pantallas.
- La auditoría de la captura vive en la base del modo (`demo.db` o `app.db`); la pantalla de histórico llega en la 0.4. Para consultarla ahora: `docker compose exec tiroriro sqlite3 -readonly -header -column /app/data/app.db "SELECT * FROM auditoria WHERE entidad = 'participacion' ORDER BY id DESC LIMIT 20"` (en DEMO, sustituye `app.db` por `demo.db`).

## Uso del panel de administración (0.2)

- **Modo y Bloqueos:** ver las secciones anteriores.
- **Mesas y censo:** alta, edición (incluido el censo) y baja de mesas. La baja no borra: la mesa queda marcada como "de baja".
- **Agentes y PIN:** alta de agentes (nombre libre), asignación a una o varias mesas, y generación, regeneración o revocación del PIN de 6 dígitos. El PIN se muestra **una sola vez**, al generarlo; en la base de datos solo se guarda su HMAC. Dar de baja a un agente anula su PIN.
- Toda modificación queda registrada en la tabla `auditoria` (la pantalla de histórico llega en la 0.4).
