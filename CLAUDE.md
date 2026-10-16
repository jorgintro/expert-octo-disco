# CLAUDE.md: reglas del proyecto

Lee primero `SPEC.md`: es la fuente de verdad de requisitos, modelo de datos y hoja de ruta. Este archivo recoge las reglas de trabajo.

## Qué estamos construyendo

Miniaplicación web mobile-first, autoalojada, para que los agentes de un colegio electoral (piloto: Colegio Dulcinea, Alcalá de Henares, 6 mesas) registren la **participación acumulada por mesa** en cortes horarios y, desde las 20:00, el **recuento**. El administrador (Jefe de Colegio) gestiona todo y hace pantallazos de las vistas resumen para enviarlos por WhatsApp. Elecciones generales: Congreso (0.5.y) y Senado (0.6.y).

## Idioma

- Interfaz, textos de error, mensajes de commit y documentación: **español de España**.
- Identificadores de código: en inglés o español, pero de forma consistente. Preferencia: nombres del dominio en español (`mesa`, `censo`, `participacion`, `recuento`) tal como en `SPEC.md`.

## Stack (decidido, no cambiar sin avisar)

- **Node.js 22 (LTS)** con **SQLite** (`better-sqlite3`, modo WAL).
- Servidor ligero (Fastify o Express) con **HTML renderizado en servidor** y JavaScript mínimo en el cliente. **Sin paso de build** complejo ni frameworks pesados: debe ser fácil de leer y modificar.
- CSS propio sencillo, mobile-first (diseña para 360 px de ancho y escala hacia arriba).
- **Docker** (un contenedor, imagen base `node:22-bookworm-slim`: Debian/glibc, **no Alpine**) + `docker-compose.yml`, con la base de datos en el volumen `./data`.
- Despliegue detrás de **Nginx Proxy Manager** (HTTPS lo termina él) en `tiroriro.jdiaz.bid`. La app no publica su puerto a Internet.
- Dependencias: pocas y justificadas. Fija versiones y mantén `package-lock.json`.

## Versionado

- Formato **0.X.y** con X e y entre 1 y 100. **1.0.0 solo se publica el día de las elecciones**, nunca antes, aunque el producto parezca terminado.
- La versión vive en un único sitio (`package.json`) y se muestra en el pie de la app y en `/version`.
- Cada versión de la hoja de ruta (`SPEC.md`, sección 10) debe poder desplegarse y probarse por sí sola.
- Incrementa **y** para correcciones y pequeños ajustes dentro de una fase, y **X** al terminar una fase de la hoja de ruta.
- Mantén un `CHANGELOG.md` con una entrada por versión.

## Forma de trabajar (construcción escalonada)

1. Trabaja **una fase cada vez**, en el orden de la hoja de ruta. No adelantes funcionalidades de fases posteriores.
2. Antes de empezar una fase, resume en pocas líneas qué vas a hacer y qué criterio de "hecho" aplica.
3. Al terminar: ejecuta las pruebas, actualiza `CHANGELOG.md` y la versión, y explica cómo desplegarla y cómo verificarla a mano.
4. Si algo del `SPEC.md` es ambiguo o hay que tomar una decisión que no está cerrada, **pregunta** en lugar de inventar. Los puntos pendientes están en la sección 12 del spec.
5. Commits pequeños y descriptivos, en español.

## Reglas de dominio que no se pueden romper

- **No se almacenan datos personales de votantes.** Del agente solo nombre y PIN (como HMAC).
- La **participación es acumulada** por mesa y corte. El parcial de cada tramo se calcula, no se introduce.
- Validaciones de participación: ≤ censo, sin decrecer respecto al corte anterior, sin superar el corte posterior ya introducido.
- Validación del Congreso: `candidaturas + blancos + nulos = total de votantes` y total ≤ censo.
- El Senado **no** se valida con esa suma (cada elector marca hasta 3 nombres); su modelo se acuerda antes de implementarlo.
- El **censo es editable** desde el panel; los valores del seed (las 6 mesas) son solo el punto de partida.
- Las candidaturas son **configurables** desde el panel (nombre, siglas, orden, destacada, activa); no las incluyas fijas en el código.
- El administrador puede introducir o corregir datos de cualquier mesa. **Toda modificación** escribe en la tabla de auditoría (quién, cuándo, valor anterior y nuevo).
- Todas las horas se guardan en UTC y se muestran en `Europe/Madrid`. La hora de actualización debe ser visible en la vista pantallazo.
- El recuento lo activa el administrador a mano; **no dependas del reloj para bloquear el recuento**. El modo DEMO/REAL **sí** usa el reloj (`ELECTION_DATE`) y puede forzarse a mano.
- **Nunca escribir en datos reales en modo DEMO.** Las tablas de captura (participación, recuento y su auditoría) se tocan solo a través de la capa de captura (`src/captura.js`), que el gestor de datos ata al destino según el modo (DEMO → `data/demo.db`, REAL → `data/app.db`). Las rutas no abren conexiones ni escriben SQL sobre esas tablas. La configuración y su auditoría van siempre a `app.db`. `demo.db` solo contiene captura de prueba, se descarta al pasar a REAL y no se respalda.

## Seguridad

- PIN de 6 dígitos para agentes: se guarda solo un HMAC (con `PIN_HMAC_SECRET`), único; se muestra en claro únicamente al generarlo. Límite de intentos y bloqueo temporal por IP, con contadores **separados** para el PIN de agentes y para la contraseña de administrador (los agentes comparten IP pública): un fallo de uno nunca bloquea al otro.
- Contraseña de administrador con argon2 o bcrypt.
- Cookies de sesión `HttpOnly`, `Secure`, `SameSite=Lax`; protección CSRF en operaciones con sesión.
- Validación **siempre en servidor**; consultas parametrizadas; cabeceras de seguridad.
- Secretos únicamente por variables de entorno. Nunca en el repositorio. Aporta un `.env.example`.

## Calidad y pruebas

- Pruebas automáticas para la lógica de validación (participación y recuento), el control de acceso por rol y el cálculo de parciales y porcentajes.
- Comprueba manualmente cada pantalla a 360 px de ancho.
- La app debe tolerar mala conexión móvil: mensajes claros de éxito o fallo, y no perder lo escrito en el formulario si falla el envío.
- Un seed idempotente crea el colegio, las 6 mesas con su censo, los 6 cortes (10, 12, 14, 16, 18, 20) y el administrador inicial.

## Estructura sugerida del repositorio

```
/
├── SPEC.md
├── CLAUDE.md
├── CHANGELOG.md
├── README.md            (instalación, despliegue, copias de seguridad)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── src/                 (servidor, rutas, vistas, lógica de dominio)
├── migrations/          (SQL versionado)
├── public/              (CSS y JS mínimo del cliente)
├── scripts/             (seed, copia de seguridad)
├── tests/
└── data/                (volumen: app.db y, solo en modo DEMO, demo.db; en .gitignore)
```

## Despliegue

- `docker compose up -d --build` debe bastar para levantar la app.
- Endpoint `/healthz` (para comprobaciones) y `/version`.
- El build de Docker ejecuta `scripts/comprobar-arranque.js` (better-sqlite3 con WAL, argon2, migraciones y seed): un módulo nativo incompatible debe romper el **build**, no el despliegue. `scripts/smoke.sh` repite la prueba sobre la imagen construida y `scripts/deploy.sh` despliega con copia previa de la base.
- Documenta en `README.md` la configuración del proxy host en Nginx Proxy Manager (dominio, esquema `http`, host y puerto del contenedor, certificado SSL, forzar HTTPS) y la copia de seguridad (`sqlite3 data/app.db ".backup ..."`; `demo.db` no se respalda).

## Qué NO hacer

- No generar PDF ni Word como parte de la app.
- No añadir registro público, cuentas de votantes ni publicación abierta de resultados.
- No introducir servicios externos (analítica, CDN, fuentes remotas) sin consultarlo: la app debe funcionar en un servidor propio sin depender de terceros.
- No publicar la versión 1.0.0 antes del día de las elecciones.

## Primera tarea

Empieza por la fase **0.1.y** (esqueleto, Docker, `/healthz`, `/version`, página inicial mobile-first y guía de despliegue detrás de Nginx Proxy Manager). Detente al terminar y espera confirmación antes de pasar a la 0.2.y.
