# Participación y recuento (tiroriro)

Miniaplicación web mobile-first para registrar la participación y el recuento por mesa en un colegio electoral (piloto: Colegio Dulcinea, Alcalá de Henares). Requisitos y hoja de ruta en [`SPEC.md`](SPEC.md); reglas de trabajo en [`CLAUDE.md`](CLAUDE.md).

Versión actual: ver `package.json` (también en el pie de la app y en `/version`).

## Desarrollo local

Requiere Node.js 20 o superior.

```bash
npm ci
npm test
PORT=3000 npm start
```

Después abre <http://localhost:3000>.

## Despliegue con Docker

1. Crea el archivo de entorno: `cp .env.example .env` y edítalo.
2. Comprueba que existe la red compartida con Nginx Proxy Manager:
   `docker network ls | grep npm_default`. Si NPM usa otro nombre de red, cámbialo en `docker-compose.yml`.
3. Levanta la app: `docker compose up -d --build`.
4. Verifica desde otro contenedor de la red o, tras configurar NPM, desde fuera:
   - `/healthz` devuelve `{"estado":"ok"}`.
   - `/version` devuelve la versión.

La app no publica ningún puerto a Internet. La base de datos (a partir de la fase 0.2) vivirá en el volumen `./data`.

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

A partir de la fase 0.2 (hay base de datos):

```bash
sqlite3 data/app.db ".backup 'data/copia-$(date +%Y%m%d-%H%M).db'"
```
