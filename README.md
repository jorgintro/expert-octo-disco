# Participación y recuento (tiroriro)

Miniaplicación web mobile-first para registrar la participación y el recuento por mesa en un colegio electoral (piloto: Colegio Dulcinea, Alcalá de Henares). Requisitos y hoja de ruta en [`SPEC.md`](SPEC.md); reglas de trabajo en [`CLAUDE.md`](CLAUDE.md).

Versión actual: ver `package.json` (también en el pie de la app y en `/version`).

## Desarrollo local

Requiere Node.js 20 o superior (y herramientas de compilación si `better-sqlite3` o `argon2` no tienen binario para tu sistema).

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
3. Levanta la app: `docker compose up -d --build`.
4. Verifica desde otro contenedor de la red o, tras configurar NPM, desde fuera:
   - `/healthz` devuelve `{"estado":"ok"}`.
   - `/version` devuelve la versión.
   - `/admin/login` permite entrar con `ADMIN_USER` y `ADMIN_PASSWORD_INITIAL`. Cambia la contraseña desde **Contraseña**.

La app no publica ningún puerto a Internet. La base de datos SQLite está en `./data/app.db` (volumen). Al actualizar de versión, `docker compose up -d --build` aplica las migraciones nuevas sin perder datos.

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

## Uso del panel de administración (0.2)

- **Mesas y censo:** alta, edición (incluido el censo) y baja de mesas. La baja no borra: la mesa queda marcada como "de baja".
- **Agentes y PIN:** alta de agentes (nombre libre), asignación a una o varias mesas, y generación, regeneración o revocación del PIN de 6 dígitos. El PIN se muestra **una sola vez**, al generarlo; en la base de datos solo se guarda su HMAC. Dar de baja a un agente anula su PIN.
- Toda modificación queda registrada en la tabla `auditoria` (la pantalla de histórico llega en la 0.4).
