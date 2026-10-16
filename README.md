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

## Uso del panel de administración (0.2)

- **Mesas y censo:** alta, edición (incluido el censo) y baja de mesas. La baja no borra: la mesa queda marcada como "de baja".
- **Agentes y PIN:** alta de agentes (nombre libre), asignación a una o varias mesas, y generación, regeneración o revocación del PIN de 6 dígitos. El PIN se muestra **una sola vez**, al generarlo; en la base de datos solo se guarda su HMAC. Dar de baja a un agente anula su PIN.
- Toda modificación queda registrada en la tabla `auditoria` (la pantalla de histórico llega en la 0.4).
