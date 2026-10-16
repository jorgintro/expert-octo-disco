# Changelog

Formato de versión 0.X.y. La 1.0.0 solo se publica el día de las elecciones.

## 0.7.1 — Fase 0.7: kit del agente electoral

- **Kit del agente electoral** (apoderado/interventor, un único kit) en `/agente/kit` y `/admin/kit`: solo con sesión (PIN o administrador), con banner DEMO/REAL. Enlace «Kit» en la cabecera del agente y en el menú y la portada del administrador. No toca los datos de captura ni la base.
- **Checklist por fases de la jornada** (el día antes, antes de abrir, constitución, votación, cierre, escrutinio, después): cada punto es marcable y guarda la hora. El estado vive en el dispositivo (`localStorage` con `try/catch`, clave ligada al agente; sin él la página funciona pero no recuerda y lo avisa). «Copiar como texto» (hecho/pendiente con hora, para WhatsApp; marca DEMO) y «Reiniciar» con confirmación.
- **Guía de consejos** en secciones plegables: qué vigilar, qué anotar, incidencias habituales, cómo usar la app y consejos prácticos.
- **Contenido editable sin tocar código** en `content/checklist.json` y `content/guia.json`, validado al arrancar (ids, textos, claves, rol «solo»): un archivo mal formado impide el arranque con un mensaje claro. Entra en la imagen Docker.
- **Contenido pendiente de verificar**: los puntos con `[VERIFICAR]` (y `"verificar": true`, obligatorios a la vez) los filtra el servidor: el administrador los ve con la etiqueta «Pendiente de verificar»; los agentes no los reciben ni en el HTML. Se publican quitando la marca en el archivo. El contenido es un borrador: no cita normas.
- Hoja de estilos de impresión (sin PDF ni Word). Hoja de ruta actualizada en SPEC.md §10 y CLAUDE.md: 0.7.x kit, 0.8.x blog con Bludit, 0.9.x endurecimiento y simulacro.

## 0.6.2 — Fase 0.6, segunda mitad: pantallazo del Senado

- **Orden por votos**: en el pantallazo y en el panel `/admin/senado`, los candidatos van en una sola clasificación de mayor a menor número de votos (desempate: orden de la papeleta), recalculada en cada refresco; la matriz candidato × mesa conserva ese orden.
- **Pantallazo → Senado** (el selector ya existía): cabecera «Elecciones Generales · Senado», Provisional/Completo con mesas escrutadas n/N, marca de agua DEMO y franja SIN CONEXIÓN. Cada candidato con posición, partido o agrupación, votos, % sobre papeletas válidas y barra del color del partido (color y logo heredados), sin resaltar a los 4 primeros. Los **12 primeros** a la vista; el resto en un desplegable «Resto (n)», cerrado por defecto, en letra pequeña. Debajo, válidas, blancas, nulas y total de papeletas.
- **Estado de los desplegables** (Otros del Congreso, Resto del Senado) en `sessionStorage` por desplegable (`data-persistir`), con `try/catch`: el sondeo no los pliega, se conserva al cambiar de variante y en Modo captura.
- **Estadística de bloque**: papeletas válidas por número de marcas (3, 2, 1) con su % y voto en bloque frente a voto mixto (entre las papeletas de 2 o 3 marcas), solo con las mesas cerradas en modo sábana: «datos de n/N mesas», con las de totales excluidas e indicadas; sin datos, no aparece.
- **Texto de WhatsApp del Senado**: cabecera con colegio, mesas n/N y marcas DEMO y PROVISIONAL; los 12 primeros uno por línea; el resto **siempre** en una línea compacta; válidas, blancas, nulas y total; y la línea de bloque.
- **Agrupación normalizada**: sin espacios sobrantes ni dobles, comparada sin mayúsculas ni tildes; el formulario ofrece las existentes y una variante adopta la grafía de la que ya existe. Las guardadas se unifican al migrar (idempotente, auditado).
- **Pasar a modo totales conservando cifras** (solo administrador): copia votos por candidato, válidas, blancas y nulas al modo totales (editable), descarta la matriz de marcas («datos de bloque no disponibles»), con confirmación, elección de dejar la mesa cerrada o reabierta y auditoría con valores anteriores y nuevos. El agente no ve esta opción. El reinicio completo se mantiene.
- Prueba de que, al pasar de DEMO a REAL (se borra `demo.db`), un candidato (o candidatura) que solo tenía votos de prueba se puede borrar y uno con votos reales no.
- SPEC.md actualizado; sin cambios en la comprobación de arranque más allá de lo ya cubierto.

## 0.6.1 — Fase 0.6, primera mitad: recuento del Senado

- **Candidatos del Senado** (panel → Más → *Candidatos Senado*): alta, edición, orden (posición en la papeleta), activo/inactivo, partido asociado (una candidatura del Congreso, de la que hereda color y logo), o, sin partido, agrupación y color propios. Sin candidatos fijos en el código ni en el seed. Configuración compartida por DEMO y REAL. No se borra un candidato con votos (solo se desactiva) ni una candidatura con candidatos del Senado asociados. Con el Senado activado, alta, borrado, orden y activo quedan bloqueados.
- **Apertura propia del Senado** (`/admin/senado`), independiente del Congreso, a mano, auditada y con estado separado por modo (REAL empieza cerrado). Aviso (sin bloqueo) en REAL antes de las 20:00. Con el Senado cerrado los agentes no ven su formulario.
- **Sábana a sábana** (agente): pestañas Congreso | Senado en la mesa; pantalla de papeleta con las listas por partido, toque para marcar o desmarcar (máximo 3), «Lista completa», «Confirmar papeleta», «En blanco», «Nula» y «Deshacer última»; contadores siempre visibles (contadas, válidas, blancas, nulas y votos por candidato). Contadores y última papeleta en el dispositivo; al servidor solo contadores, por lotes y con control de versión (conflicto: sumar las papeletas pendientes o descartarlas). Reglas de la papeleta compartidas entre navegador y servidor (`public/papeleta.js`).
- **Totales** (respaldo, administrador y agente que lo prefiera): votos por candidato, papeletas válidas, en blanco y nulas, con comprobación en vivo y autoguardado. Una mesa usa **un modo**, fijado al guardar el primer dato; solo el administrador puede reiniciar el Senado de una mesa (confirmación y auditoría) para cambiarlo.
- **Datos**: solo contadores (nunca el contenido de cada papeleta): votos por candidato; papeletas válidas por número de marcas × «mismo partido» (matriz para la estadística de bloque de la 0.6.2; «no disponible» en modo totales); blancas; nulas. Migraciones `004_senado.sql` (app.db) y `captura/003_senado.sql` (app.db y demo.db). Todo el SQL de captura sigue en `src/captura.js`; en DEMO solo se escribe en `demo.db`.
- **Validaciones en servidor**: enteros ≥ 0; votos de un candidato ≤ válidas; válidas ≤ suma de votos ≤ 3 × válidas; (válidas + blancas + nulas) ≤ censo. Avisos al cerrar si difiere del total de votantes del Congreso o de la última participación. Cerrar siempre con confirmación; mesa cerrada no editable por el agente; lo del administrador no lo edita el agente; el administrador reabre.
- **Administrador**: panel del Senado (mesas escrutadas n/N, votos por candidato con % sobre válidas y por partido, blancas, nulas, «Provisional», sondeo) y matriz candidato × mesa con ficha por mesa (introducir, corregir, cerrar, reabrir, reiniciar).
- **Histórico**: acciones y detalles del Senado legibles; autoguardados ocultos por defecto.
- `contarRegistrosDemo` cuenta también el recuento del Congreso y del Senado al avisar de lo que se pierde al salir de DEMO.
- SPEC.md (modelo del Senado y decisiones de la 0.6.2), CLAUDE.md y README actualizados. Sin pantallazo del Senado todavía (0.6.2).

## 0.5.2 — Desglose de «Otros» en el pantallazo de recuento

- **Pantallazo → Recuento**: la fila «Otros (n)» es ahora un desplegable (cerrado por defecto; flecha pequeña y discreta). Abierto, lista bajo la fila una línea compacta por candidatura no destacada (siglas, votos y %), en letra pequeña y sin logos, de más a menos votos y, con empate, por el orden de la candidatura. La fila sigue mostrando la suma; sin candidaturas pequeñas no aparece. Crece hacia abajo sin desbordar a 360–390 px.
- El estado abierto/cerrado se guarda en el dispositivo (`sessionStorage`, con `try/catch`): el sondeo no lo pliega y se conserva al cambiar de variante y volver. En «Modo captura» el desplegable se queda como esté y se puede seguir abriendo o cerrando tocando la fila.
- **Copiar como texto** (Recuento): `Otros: N votos (X %)` y, debajo, una línea con todas las pequeñas (`SIGLAS 1.234 · SIGLAS 987 · …`), esté o no abierto el desplegable. Se mantienen las marcas DEMO y PROVISIONAL.
- Los `scripts/*.sh` se versionan con permiso de ejecución en git (no hace falta `chmod` en el servidor).

## 0.5.1 — Fase 0.5: recuento del Congreso

- **Candidaturas** (panel → Más → *Candidaturas*): alta, edición, orden (número de posición de la Junta Electoral Central), activa/inactiva, destacada, color corporativo y **logo subido desde el panel** (PNG, JPEG o WebP validado por sus primeros bytes). No hay candidaturas fijas en el código. No se borra una candidatura con votos. Configuración compartida por DEMO y REAL. Con el recuento activado, la estructura queda bloqueada.
- **Apertura del recuento** (`/admin/recuento`): se abre y cierra a mano, con estado propio por modo (en REAL empieza cerrado) y auditoría. En REAL exige la participación informada de todas las mesas activas en el último corte y avisa (sin bloquear) si es antes de las 20:00. En DEMO se puede abrir sin requisitos.
- **Formulario del agente** (solo con el recuento abierto): «clicker» por candidatura (− resta un voto, + suma uno) con logo y colores, opción «Teclear números», «Otros» desplegable, blancos, nulos y total de votantes, suma en vivo contra el total, «sin rellenar» distinto de 0, «Poner 0 en las vacías», autoguardado del borrador, control de versión (conflicto con opción de recargar o sobrescribir) y borrador local si falla la conexión. «Cerrar mesa» solo si todo es válido y siempre con confirmación (incluye el aviso si el total difiere de la última participación informada).
- **Validaciones en servidor**: enteros ≥ 0; candidaturas + blancos + nulos = votantes; votantes ≤ censo. Mesa cerrada no editable por el agente; el administrador puede reabrirla. Lo introducido por el administrador no lo edita el agente.
- **Administrador**: resultados (votos y % sobre válidos, mesas escrutadas n/N, provisional) y matriz candidaturas × mesas con ficha por mesa para introducir, corregir, cerrar y reabrir (marcado «introducido por administrador»); actualización automática.
- **Pantallazo → Recuento**: destacadas con barras, «Otros», blancos, nulos, total, mesas escrutadas, «Provisional», marca de agua DEMO y franja SIN CONEXIÓN; «Copiar como texto» también para el recuento.
- **Datos**: nuevas migraciones (`candidatura` en `app.db`; `recuento_mesa`/`recuento_voto` en `app.db` y `demo.db`). Toda la escritura de captura sigue en `src/captura.js`; en DEMO el recuento va solo a `demo.db`. Auditoría de cada cambio (solo diferencias; el autoguardado no aparece en el histórico salvo `?auto=1`).
- Ficheros estáticos con `Cache-Control: no-cache` + ETag y `?v=<versión>` en las URLs de CSS y JS.
- La comprobación de arranque del build verifica además los nuevos recursos, rutas protegidas y el aislamiento del recuento demo.

## 0.4.1 — Fase 0.4: panel resumen y vista pantallazo

- **Panel resumen** (`/admin/resumen`): tabla mesa × corte con acumulado, parcial y % sobre censo, fila de totales, mesas informadas por corte (`4/6`) y mesas pendientes del último corte. Se actualiza sola cada 5 s con la hora de la última actualización. Cada celda lleva a la ficha de edición.
- **Vista `/pantallazo`** (solo administrador), pensada para capturas verticales a 360 px: sin menús, tipografía grande, colegio y tipo de elección, hora de actualización muy visible (Madrid), marca «Provisional»/«Completo». Variantes **Participación** (cortes con datos, cabeceras abreviadas, total, mesas informadas y %; cabe entera sin desplazar) y **Último corte** (acumulado, parcial y % por mesa); selector con **Recuento** preparado para la 0.5. Sondeo cada 10 s y franja roja «SIN CONEXIÓN» dentro de la captura si falla.
- **Marca de agua «DEMO»** teselada y grande sobre todo el lienzo en modo DEMO, más sello «DEMO · DATOS DE PRUEBA»; en REAL no aparece nada con la palabra DEMO.
- **Copiar como texto** (resumen en texto plano para WhatsApp, marcado en DEMO) y **Modo captura** (oculta los controles).
- **Total del colegio** y «Provisional» definidos en SPEC §7: el % total es sobre el censo de las mesas informadas en ese corte.
- **Histórico de cambios** (`/admin/historico`): auditoría legible, filtrable por mesa, actor y acción, paginada, en hora de Madrid. En DEMO incluye la captura de demo (etiquetada) y oculta la real. Nunca muestra PIN ni contraseñas (redacción defensiva).
- **Edición de cortes** (`/admin/cortes`): cambia la hora de cada corte con validación (HH:MM, orden creciente), auditoría y aviso con confirmación si el corte ya tiene datos (reales o de demo).
- Menú de administración reorganizado con un «Más» plegable.
- La comprobación de arranque del build verifica además los nuevos recursos y que las pantallas nuevas exigen sesión de administrador.

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
