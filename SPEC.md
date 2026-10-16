# SPEC.md: App de participación y recuento para colegio electoral

Versión del documento: 0.1 · Estado: diseño cerrado, pendiente de construcción · Idioma de la interfaz: español (España)

## 1. Objetivo

Miniaplicación web, pensada sobre todo para móvil (mobile-first), alojada en un servidor propio, que permite al Jefe de Colegio y a los agentes electorales:

1. Registrar la **participación acumulada por mesa** en los cortes horarios de la jornada.
2. A partir de las 20:00, y cuando el administrador lo active, registrar el **recuento por mesa**.
3. Ver resúmenes limpios del colegio completo, pensados para hacer **pantallazos** y enviarlos por WhatsApp al grupo de jefes de colegio.

Es una **prueba piloto** con un solo colegio (Colegio Dulcinea, Alcalá de Henares). El modelo de datos debe dejar la puerta abierta a varios colegios, pero la interfaz del piloto es de un solo colegio.

Elecciones: **Generales (Congreso y Senado)**.

## 2. Alcance y fuera de alcance

Dentro: acceso por PIN, panel de administración, captura de participación, resumen y vista pantallazo, recuento del Congreso (0.5.y), recuento del Senado (0.6.y), histórico de cambios, copias de seguridad.

Fuera del piloto:
- Datos personales de votantes (no se almacena ninguno).
- Integración con sistemas oficiales.
- Publicación pública de resultados (todo es de acceso privado).
- Interfaz multi-colegio (solo el modelo de datos queda preparado).

## 3. Datos de partida: Colegio Dulcinea

Estructura territorial: **Distrito, Sección, Mesa**. Se identifica cada mesa como `Distrito-Sección-Mesa`.

Censo inicial (tomado de las elecciones europeas; **editable** desde el panel, porque variará):

| Mesa | Distrito | Sección | Mesa | Censo inicial |
|------|----------|---------|------|---------------|
| 4-2-A | 4 | 2 | A | 615 |
| 4-2-B | 4 | 2 | B | 623 |
| 4-3-A | 4 | 3 | A | 754 |
| 4-3-B | 4 | 3 | B | 821 |
| 5-18-U | 5 | 18 | U | 692 |
| 5-31-U | 5 | 31 | U | 676 |

Total de censo inicial: 4.181 electores. Son 6 mesas. Los datos de cada mesa se editan desde el panel y se siembran con un seed inicial (script idempotente).

## 4. Roles y acceso

| Rol | Acceso | Permisos |
|-----|--------|----------|
| **Administrador** (Jefe de Colegio) | Usuario + contraseña propia | Todo: gestión de mesas, censo, agentes, PIN, candidaturas, activar/cerrar recuento, introducir o corregir datos de cualquier mesa, ver histórico. |
| **Agente** | **PIN numérico de 6 dígitos** | Ve y edita solo su mesa (o sus mesas, si se le asignan varias). Introduce participación y, con el recuento abierto, resultados. |

Reglas del acceso por PIN:
- El administrador genera, regenera y revoca PIN desde el panel. El PIN se muestra en claro **solo en el momento de generarse** (para dárselo al agente). En base de datos no se guarda en claro: se guarda un HMAC con una clave secreta del servidor (determinista, para poder buscar al agente por PIN) con restricción de unicidad.
- Límite de intentos por IP y bloqueo temporal ante fallos repetidos, con **contadores separados por ámbito**: contraseña de administrador (login, pantalla de modo, cambio de contraseña: 5 fallos en 15 minutos, bloqueo de 5 minutos) y PIN de agentes (más permisivo, 15 fallos en 5 minutos, bloqueo de 5 minutos), porque los agentes de un colegio comparten IP pública. Un fallo de administrador nunca bloquea a los agentes ni al revés. El administrador puede **desbloquear una IP** desde el panel (Bloqueos).
- Sesión por cookie `HttpOnly`, `Secure`, `SameSite=Lax`, con caducidad larga durante la jornada (por ejemplo, 14 h) para que el agente no tenga que reintroducir el PIN.
- Un agente puede estar asignado a una o varias mesas; una mesa puede tener varios agentes.
- Revocar un PIN invalida sus sesiones activas.
- El administrador puede introducir datos en nombre de cualquier agente; el registro de cambios indica quién lo hizo realmente.

## 5. Modelo de datos (SQLite)

Todas las fechas en UTC (ISO 8601), mostradas en `Europe/Madrid`.

Hay dos bases SQLite (ver la sección 9 bis): **`app.db`** (configuración y captura real, con su auditoría) y **`demo.db`** (solo captura de prueba, su auditoría incluida). Las tablas de captura (`participacion`, `recuento_mesa` / `recuento_voto` del Congreso y `senado_mesa` / `senado_voto` / `senado_matriz` del Senado) existen en ambas con el mismo esquema y **sin claves foráneas** a `mesa`, `corte` ni `candidatura` (en `demo.db` esas tablas no existen): se referencian por id y la aplicación valida su existencia contra `app.db`.

- **colegio**: `id`, `nombre`, `municipio`.
- **mesa**: `id`, `colegio_id`, `distrito`, `seccion`, `letra`, `codigo` (ej. `4-2-A`, único por colegio), `censo` (entero ≥ 0), `activa`.
- **agente**: `id`, `nombre`, `pin_hmac` (único), `activo`, `creado_en`.
- **agente_mesa**: `agente_id`, `mesa_id` (relación N:M).
- **admin**: `id`, `usuario`, `password_hash` (argon2 o bcrypt).
- **corte**: `id`, `hora` (`HH:MM`), `orden`. Valores iniciales: 10:00, 12:00, 14:00, 16:00, 18:00, 20:00. Configurables.
- **participacion**: `id`, `mesa_id`, `corte_id`, `votantes_acumulados`, `introducido_por_tipo` (agente/admin), `introducido_por_id`, `actualizado_en`. Única por (`mesa_id`, `corte_id`).
- **candidatura**: `id`, `eleccion` (`congreso`/`senado`), `nombre`, `siglas`, `orden` (orden de la Junta Electoral Central, estable), `destacada` (bool, para la vista pantallazo), `activa`, `color` (corporativo) y `logo` (imagen subida desde el panel, opcional). Es configuración compartida por DEMO y REAL.
- **recuento_mesa**: `mesa_id`, `eleccion`, `votantes` (total de votantes declarado), `votos_blancos`, `votos_nulos`, `estado` (`borrador`/`cerrado`), `version` (control optimista de concurrencia), `introducido_por_tipo` (agente/admin), `introducido_por_id`, `actualizado_en`. Un campo vacío (`NULL`) significa «sin rellenar» y es distinto de 0.
- **recuento_voto**: `mesa_id`, `candidatura_id`, `votos`. Única por (`mesa_id`, `candidatura_id`).
- **candidato_senado**: `id`, `nombre`, `orden` (posición en la papeleta, 1..n, estable), `candidatura_id` (partido: una candidatura del Congreso, opcional; hereda color y logo), `agrupacion` (texto libre, solo sin partido: mismo texto = misma lista), `color` (propio, solo sin partido), `activo`. Sin «destacados». Configuración compartida por DEMO y REAL. La **lista** de un candidato es su partido, o su agrupación, o él solo.
- **senado_mesa**: `mesa_id`, `modo` (`sabana`/`totales`, fijado al guardar el primer dato), `validas`, `blancas`, `nulas`, `estado` (`borrador`/`cerrado`), `version`, `introducido_por_tipo/id`, `actualizado_en`. **senado_voto**: `mesa_id`, `candidato_id`, `votos`. **senado_matriz**: `mesa_id`, `marcas` (1..3), `mismo_partido` (0/1), `papeletas` (solo modo sábana; en totales queda vacía = «no disponible»). **Solo contadores: nunca se guarda el contenido de cada papeleta.**
- **ajuste**: clave-valor (por ejemplo `recuento_demo_abierto`/`recuento_real_abierto`, `recuento_*_activado`, `senado_demo_abierto`/`senado_real_abierto`, `senado_*_activado`, `zona_horaria`): el recuento tiene su propio estado por modo y en REAL arranca cerrado.
- **auditoria**: `id`, `fecha`, `actor_tipo`, `actor_id`, `accion`, `entidad`, `entidad_id`, `valor_anterior`, `valor_nuevo`. Se escribe en **toda** modificación de datos (incluidos cambios de censo, asignaciones y activación del recuento).

## 6. Reglas de validación

**Participación (por mesa)**
1. `votantes_acumulados` es entero ≥ 0 y ≤ `censo` de la mesa.
2. El acumulado no puede ser menor que el del corte anterior ya introducido, ni mayor que el del corte posterior ya introducido.
3. Se calcula el parcial de cada tramo (acumulado del corte menos el del corte anterior) y el porcentaje sobre censo.
4. Si el dato pasa de golpe un umbral de sospecha (un salto de más del 25 % del censo en un tramo, calculado sobre el parcial respecto al último corte anterior ya introducido, o respecto a 0 si no hay ninguno), la app pide confirmación explícita en dos pasos, sin bloquear. Vale también para el administrador.
5. Cualquier agente asignado a la mesa puede corregir las celdas de su mesa, **salvo las introducidas por el administrador**, que quedan bloqueadas para los agentes con un mensaje claro. Los agentes corrigen, no vacían. El administrador puede introducir, corregir y **vaciar** cualquier celda (el vaciado se audita). Todo cambio queda en auditoría.

**Recuento del Congreso (por mesa)**
1. Votos por candidatura, blancos y nulos: enteros ≥ 0.
2. `votos a candidaturas + blancos + nulos = total de votantes de la mesa`.
3. Total de votantes ≤ censo.
4. Si el total de votantes difiere de la **última participación informada** de la mesa, se avisa con una advertencia (dentro de la confirmación de cierre), sin bloquear.
5. El estado `cerrado` bloquea la edición al agente; solo el administrador puede reabrir (conserva la autoría). Lo introducido por el administrador no lo edita el agente.
6. Cerrar la mesa exige todos los campos rellenados (0 incluido) y que la suma cuadre; se guarda borrador con datos parciales. Cerrar siempre pide confirmación.
7. Solo las mesas **cerradas** suman en totales; el % es sobre votos válidos (candidaturas + blancos), con 2 decimales.
8. **Apertura del recuento**: el administrador la abre y cierra a mano (auditado). En REAL exige al menos una candidatura activa y la participación informada de todas las mesas activas en el último corte (en DEMO no); antes de las 20:00 avisa sin bloquear. Una vez activado, la estructura de candidaturas (altas, orden, activa/destacada) queda bloqueada.
9. Interfaz del agente: «clicker» por candidatura (− resta un voto, + suma un voto) con logo y colores, opción de teclear, «Otros» desplegable, suma en vivo, autoguardado del borrador y tolerancia a la mala conexión.

**Recuento del Senado (0.6.y; Madrid)**
1. Se eligen 4 senadores y cada elector marca **hasta 3 nombres**. Más de 3 marcas = papeleta **nula**; sobre vacío o papeleta sin marcas = voto **en blanco**. Cada lista lleva 3 candidatos.
2. **Interruptor propio**, independiente del Congreso, a mano y auditado (`abrir_senado` / `cerrar_senado`), con estado separado por modo (en REAL arranca cerrado). Con el Senado cerrado, los agentes no ven su formulario. En REAL antes de las 20:00 avisa sin bloquear; **no** exige participación (eso es del Congreso). Hace falta al menos un candidato activo. Una vez activado, la estructura de candidatos (alta, borrado, orden y activo) queda bloqueada, como en el Congreso; nombre, partido, agrupación y color siguen editables (cambiar el partido no recalcula la estadística de bloque ya contada). No se borra un candidato con votos (reales o de demo): se desactiva.
3. **Dos modos por mesa; una mesa usa UNO cada vez**, fijado al guardar el primer dato. El agente no cambia de modo; solo el administrador puede **reiniciar** el Senado de una mesa (confirmación y auditoría) para cambiarlo.
   - **Sábana a sábana** (principal, agente): una papeleta a la vez. Toque en un candidato la marca o desmarca (máximo 3; no hay cuarta marca). «Lista completa» (una por partido de ≤ 3 candidatos) marca los de la lista y confirma; «Confirmar papeleta» (1 a 3 marcas); «En blanco» (solo sin marcas); «Nula» (más de 3 marcas u otros casos). Tras confirmar se limpia la selección. «Deshacer última» (solo la última, guardada en el dispositivo). Contadores siempre visibles (contadas, válidas, blancas, nulas y votos por candidato). Los contadores y la última papeleta viven en el dispositivo y al servidor llegan solo **contadores**, por lotes y con control de versión; tras un conflicto se pueden **sumar las papeletas pendientes** a lo guardado o descartarlas; si el servidor ya tiene exactamente lo enviado (respuesta perdida) no hay conflicto. Reglas de la papeleta en `public/papeleta.js`, compartidas con el servidor.
   - **Totales** (respaldo; administrador y agente que lo prefiera): votos por candidato, papeletas válidas, en blanco y nulas.
4. **Datos** (solo contadores): votos por candidato; papeletas válidas por número de marcas (1, 2, 3) cruzadas con «todas las marcas son del mismo partido» (con 1 marca siempre sí) —base de la estadística de bloque—; blancas; nulas.
5. **Validaciones** (servidor): enteros ≥ 0; votos de un candidato ≤ papeletas válidas; papeletas válidas ≤ suma de votos ≤ 3 × válidas; (válidas + blancas + nulas) ≤ censo de la mesa (esta última también bloquea guardar borradores). En sábana se comprueba además la coherencia matriz/votos. **Bloquean el cierre** las de totales; cerrar exige todo relleno (0 incluido). **Solo avisan** (dentro de la confirmación de cierre): si (válidas + blancas + nulas) difiere del total de votantes del Congreso de esa mesa o de la última participación informada. «Cerrar mesa» siempre con confirmación. Mesa cerrada: no la edita el agente; el administrador la reabre. Lo introducido por el administrador no lo edita el agente.
6. **Administrador** (panel `/admin/senado`, sin pantallazo hasta la 0.6.2): mesas escrutadas n/N, votos por candidato con % sobre papeletas válidas (no suman 100: cada elector marca hasta 3), votos por partido, blancas, nulas, «Provisional» mientras falten mesas, matriz candidato × mesa con ficha por mesa (introducir, corregir, cerrar, reabrir, reiniciar; marcado «introducido por administrador») y sondeo automático. Solo suman las mesas **cerradas**.
7. **Orden por votos**: en el pantallazo y en el panel los candidatos van en **una sola clasificación de mayor a menor número de votos** (no por lista ni por el orden de la papeleta); desempate por el orden de la papeleta; se recalcula en cada refresco. La matriz candidato × mesa del panel conserva ese orden. Sin resaltar a los 4 primeros ni marcar «electos».
8. **Agrupación normalizada**: se guarda sin espacios sobrantes ni dobles y se compara sin mayúsculas ni tildes («PP», « pp » y «Pp» son la misma); el formulario ofrece las agrupaciones existentes (lista desplegable) y, al guardar, una variante adopta la grafía de la existente. Las ya guardadas se unifican al migrar (idempotente, auditado).
9. **De sábana a totales conservando cifras** (solo administrador, ficha de la mesa): copia los contadores (votos por candidato, válidas, blancas, nulas) al modo totales, que pasa a ser editable; la matriz de marcas se descarta y la mesa queda con «datos de bloque no disponibles» (deja de contar en la estadística de bloque). Con confirmación y auditoría (`pasar_a_totales`, con la foto completa de antes y de después); una mesa cerrada queda cerrada o reabierta (borrador) según lo que se elija. El agente no ve esta opción. El reinicio completo se mantiene.

## 7. Pantallas

**Login**: campo único de PIN con teclado numérico grande (`inputmode="numeric"`). Enlace discreto a "Acceso administrador".

**Agente**
- Cabecera con colegio y mesa asignada (con selector si tiene varias).
- Tarjeta del **corte actual** (el más reciente cuya hora ya pasó, o el primero si es antes de las 10:00; se puede elegir cualquier otro). En REAL, si el corte elegido aún no ha llegado, se pide confirmación; en DEMO no. Campo numérico grande y botón "Guardar".
- Histórico de cortes de la mesa con acumulado, parcial y % sobre censo.
- Cuando el administrador abre el recuento: formulario del Congreso (una fila por candidatura, más blancos y nulos), con total y comprobación en vivo. Con ambos abiertos, **pestañas Congreso | Senado** en las pantallas de recuento de la mesa; el Senado es la pantalla de papeleta (sábana a sábana) o, como respaldo, el formulario de totales.

**Administrador**
- **Resumen** (`/admin/resumen`): tabla mesa × corte con acumulado, parcial del tramo y % sobre censo; fila de totales del colegio; y, por corte, cuántas mesas están informadas (ej. `4/6`) y cuáles faltan en el último corte. Se actualiza sola por sondeo (cada 5 s) y muestra la hora de la última actualización. Solo cuentan las mesas **activas**. El **total del colegio** en un corte suma lo informado en él y su % es sobre el **censo de las mesas informadas** en ese corte (con 4/6 mesas, dividir entre el censo de las 6 daría una participación artificialmente baja); por eso el total de un corte puede ser menor que el del anterior si informaron menos mesas, y siempre se indica `n/N mesas`. En 360 px el panel se desplaza horizontalmente dentro de su contenedor, con la columna de mesa fija.
- **Mesas**: alta/baja/edición de mesas, **censo editable**.
- **Agentes**: alta/baja, asignación a mesas, generar/regenerar/revocar PIN.
- **Cortes** (`/admin/cortes`): edición de la hora de cada corte (formato HH:MM, en orden estrictamente creciente; no se añaden ni se quitan cortes), auditada. Si el corte ya tiene datos (reales o de demo: la hora es configuración compartida por ambos modos) se avisa y se pide confirmación antes de cambiarla; los datos no se modifican, solo cambia la hora a la que se refieren.
- **Candidaturas** (Congreso): nombre, siglas, orden, destacada, activa, color y logo. **Candidatos del Senado** (`/admin/senado/candidatos`): nombre, orden, partido asociado, agrupación y color, activo.
- **Recuento del Senado** (`/admin/senado`): interruptor propio, resultados en clasificación por votos, matriz candidato × mesa (mismo orden) y fichas (ver sección 6).
- **Recuento**: botón para **abrir/cerrar el recuento** (la app avisa antes de las 20:00 pero no lo impide, para no depender del reloj del servidor), avance (mesas escrutadas, ej. 5/6) y resultados por mesa y totales.
- **Introducir datos como administrador**: acceso desde la tabla a cualquier celda.
- **Histórico** (`/admin/historico`): auditoría visible, paginada (25 por página) y filtrable por mesa, por actor (agente, administrador o sistema) y por tipo de acción, con la hora en `Europe/Madrid`. En REAL muestra `app.db`; en DEMO, la configuración de `app.db` más la captura de `demo.db` (etiquetada «DEMO»), sin la captura real. **Nunca muestra PIN ni contraseñas** (no se guardan en la auditoría y, además, se ocultan al mostrar).
- **Copias de seguridad**: botón para descargar copia de la base de datos.

**Vista pantallazo** (`/pantallazo`, solo administrador, aunque se podrá compartir un enlace de solo lectura con token en una versión posterior)
- Pantalla limpia, sin menús, tipografía grande, buen contraste, ancho pensado para captura de móvil en vertical: cabe entera en 360 px sin desplazamiento horizontal.
- Título con colegio y tipo de elección (`Elecciones Generales`) y **hora de actualización** muy visible (hora de Madrid): la de generación de la pantalla, que se refresca por sondeo (10 s). Si el sondeo falla, aparece arriba, dentro de la captura, una franja roja «SIN CONEXIÓN · los datos son de las HH:MM:SS» para que un pantallazo con datos viejos no engañe.
- Variantes seleccionables: **Participación** (mesas en filas, cortes en columnas —solo los que ya tienen algún dato, con cabeceras abreviadas 10h, 12h…—, con fila de total del colegio, de mesas informadas y % sobre censo), **Último corte** (compacta: último corte con datos, acumulado, parcial y % por mesa, y total), **Recuento** (candidaturas destacadas con barras, «Otros», blancos, nulos, total de votantes, mesas escrutadas y «Provisional»; con marca de agua DEMO y copia como texto) y **Senado** (ver más abajo).
- **Variante Senado**: cabecera «Elecciones Generales · Senado», Provisional/Completo con mesas escrutadas n/N y marca DEMO. **Clasificación única por votos**: posición, candidato, partido o agrupación, votos y % sobre papeletas válidas, con barra del color del partido (color y logo heredados del partido; sin partido, su color). Los **12 primeros** se muestran uno a uno; el resto va en un desplegable «Resto (n)», cerrado por defecto y en letra pequeña, con su estado en `sessionStorage` (el sondeo no lo pliega y se mantiene en Modo captura); con 12 o menos no aparece. Debajo: papeletas válidas, en blanco, nulas y total. **Estadística de bloque** (solo mesas **cerradas en modo sábana**, con «datos de n/N mesas escrutadas» e indicando las de totales excluidas; sin datos, no aparece): papeletas válidas por número de marcas (3, 2, 1) con su %, y **voto en bloque** (todas las marcas del mismo partido o agrupación) frente a **voto mixto**, calculado entre las papeletas de **2 o 3 marcas** (con 1 marca no hay nada que mezclar). **Texto de WhatsApp**: cabecera (colegio, Senado, mesas n/N, marcas DEMO y PROVISIONAL), los 12 primeros uno por línea (`1. Nombre (Partido): votos (%)`), el resto SIEMPRE en una línea compacta (`Resto (n): NOMBRE 123 · NOMBRE 98 · …`) esté o no abierto el desplegable, la línea de válidas, blancas, nulas y total, y la de bloque.
- Marca de estado: «Provisional" mientras el último corte con datos no tenga todas las mesas informadas; «Completo» cuando las tiene todas. Las mesas de baja no cuentan.
- Los controles (selector de variante, **Copiar como texto**, **Modo captura**) van debajo del lienzo; «Modo captura» los oculta para hacer una captura limpia y se sale tocando el título. «Copiar como texto» genera un resumen en texto plano apto para WhatsApp (en DEMO, marcado al principio y al final con «*** DEMO - DATOS DE PRUEBA, NO SON REALES ***»).
- **Marca de agua "DEMO"**: en modo DEMO, toda captura de esta vista llevará una marca de agua "DEMO" bien visible (diagonal, sobre el contenido y dentro de la propia imagen de la pantalla), para que un pantallazo de datos de prueba no pueda confundirse con datos reales en el grupo de WhatsApp. En REAL no hay marca de agua. (Requisito para la 0.4.y.)

## 7 bis. Kit del agente electoral (0.7.x)

Zona de ayuda para quien actúa en el colegio como **agente electoral** (apoderado o interventor: un único kit, con etiquetas «Solo apoderado» / «Solo interventor» únicamente donde la diferencia cambie el punto; el administrador aportará esas diferencias).

- **Acceso**: agentes con PIN (`/agente/kit`) y administrador (`/admin/kit`). No es público: sin sesión se redirige al login. Banner DEMO/REAL como en el resto de pantallas.
- **Checklist** por fases de la jornada (el día antes, antes de abrir, constitución de la mesa, votación, cierre, escrutinio, después del escrutinio). Cada punto es marcable y guarda la hora a la que se marcó. El estado vive **en el dispositivo** (`localStorage`, con `try/catch`; sin él la página funciona, pero no recuerda) y va **ligado al agente** (clave por identificador de agente, que sigue a su PIN): dos agentes en el mismo móvil no se mezclan. Botones: **Copiar como texto** (hecho/pendiente con hora, apto para WhatsApp) y **Reiniciar** (con confirmación). No toca la base de datos ni los datos de captura.
- **Guía** de consejos en secciones plegables: qué vigilar, qué anotar, incidencias habituales, cómo usar esta app y consejos prácticos.
- **Contenido** en `content/checklist.json` y `content/guia.json`, editable sin tocar código, validado al arrancar (un archivo mal formado impide el arranque con un mensaje claro) y renderizado en el servidor. Sin editor dentro de la app.
- **Contenido pendiente de verificar**: todo punto que dependa de una norma o de instrucciones del partido lleva `"verificar": true` y el texto `[VERIFICAR]`. Solo lo ve el administrador, con la etiqueta «pendiente de verificar»; el servidor lo **filtra antes de renderizar**, de modo que a un agente no le llega ni en el HTML. Se publica quitando la marca en el archivo. No se citan artículos ni normas sin verificar.
- Sin PDF ni Word: solo hoja de estilos de impresión.

## 8. Requisitos no funcionales

- **Móvil primero**: probado en pantallas de 360 px de ancho; botones y campos grandes; sin dependencias de hover.
- **Rendimiento**: unas pocas decenas de usuarios; SQLite es suficiente (modo WAL activado).
- **Disponibilidad**: debe seguir funcionando con conexión móvil mala; reintentos al guardar y mensaje claro de éxito o fallo. Datos de formulario no se pierden si falla el envío.
- **Tiempo real ligero**: el resumen del administrador se actualiza por sondeo (polling) cada pocos segundos; sin websockets en el piloto.
- **Seguridad**: HTTPS (lo termina Nginx Proxy Manager), cabeceras de seguridad, validación en servidor de todo dato, consultas parametrizadas, protección CSRF en las operaciones con sesión, límite de intentos de login, secretos solo por variables de entorno.
- **Privacidad**: no se almacenan datos de votantes. Sobre los agentes, solo nombre y PIN (hash). La base de datos y las copias no se exponen públicamente.
- **Accesibilidad**: etiquetas en los campos, contraste suficiente, foco visible.

## 9. Despliegue

- Servidor: PC con Debian, Docker y **Nginx Proxy Manager**; dominio `tiroriro.jdiaz.bid` gestionado en Cloudflare.
- Un contenedor para la app, orquestado con `docker-compose.yml`, con la base de datos en un volumen persistente (`./data`).
- La app escucha en un puerto interno sin publicarlo hacia fuera; Nginx Proxy Manager hace el proxy inverso con certificado, hacia el contenedor por la red de Docker compartida (o el puerto enlazado a `127.0.0.1`).
- Variables de entorno: `PORT`, `DATA_DIR`, `SESSION_SECRET`, `PIN_HMAC_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD_INITIAL`, `TZ=Europe/Madrid`, `ELECTION_DATE` (AAAA-MM-DD, por defecto `2026-11-29`), `TRUST_PROXY` (saltos de proxy: 2 con Cloudflare + Nginx Proxy Manager) y `COOKIE_SECURE`.
- Runtime: **Node.js 22 (LTS)**. Imagen base `node:22-bookworm-slim` (Debian, glibc; no Alpine). El build ejecuta una comprobación de arranque (better-sqlite3 con WAL y argon2) para que un módulo nativo incompatible rompa el build y no el despliegue.
- Endpoint de salud `/healthz` y versión visible en el pie de la app y en `/version`.
- Copia de seguridad: comando documentado (`sqlite3 .backup`) y copia automática periódica durante la jornada al volumen, más descarga manual desde el panel. Las copias cubren **solo `app.db`**; `demo.db` no se respalda.

## 9 bis. Modo de trabajo: DEMO / REAL

Permite practicar con datos de prueba sin riesgo para los datos reales, y que el día de las elecciones la app esté en modo REAL sin intervención.

**Datos separados**
- `data/app.db`: configuración (colegio, mesas, censos, cortes, agentes y PIN, candidaturas, administrador, ajustes) y captura **real** (participación, recuento, auditoría real).
- `data/demo.db`: **solo** captura de prueba y su auditoría. Referencia mesas, cortes y candidaturas de `app.db` por id.
- La configuración es la misma y se edita igual en ambos modos; sus cambios se auditan **siempre en `app.db`**. Los agentes usan sus PIN reales también en DEMO.
- **Estructural, no por comprobaciones dispersas:** todo el acceso a las tablas de captura pasa por una única capa (`Captura`) que el gestor de datos ata al destino según el modo (DEMO → `demo.db`, REAL → `app.db`). En DEMO no existe ningún camino de código hacia la captura real.

**Modo efectivo** = override manual si existe y sigue vigente; si no, automático:
- `ELECTION_DATE` (AAAA-MM-DD, zona `Europe/Madrid`; por defecto `2026-11-29`). Antes de esa fecha el modo automático es DEMO; desde las 00:00 de ese día (Madrid), REAL.
- Al llegar esa fecha se **anula** cualquier override manual fijado antes de ella y pasa a REAL. Un override fijado ese día o después sí se respeta. Se evalúa al atender peticiones, sin cron; el reloj se inyecta para poder probarlo.
- Esta es la única funcionalidad que depende del reloj del servidor (el recuento no): por eso la pantalla muestra la hora del servidor en Madrid y la lista de verificación (sección 11) incluye comprobarla.

**Transiciones** (atómicas e idempotentes aunque lleguen peticiones simultáneas): entrar en DEMO parte de una `demo.db` vacía; salir de DEMO a REAL elimina `demo.db`. Nada de lo hecho en la demo sobrevive. La ruta de borrado es una constante que apunta solo a `demo.db`, con una comprobación que impide borrar `app.db`.

**Pantalla de administración "Modo de trabajo"**
- Muestra el modo efectivo, por qué (manual o automático), la fecha de elecciones y la hora del servidor en Madrid.
- Pasar a DEMO o a REAL exige la contraseña de administrador y teclear la palabra `DEMO` o `REAL`. Al salir de DEMO se indica cuántos registros de prueba se perderán.
- Desde el día de las elecciones, pasar a DEMO exige la confirmación reforzada `DEMO EN JORNADA`; pasar a REAL a mano nunca la exige. Todo cambio de modo y toda anulación de override se audita en `app.db`.
- "Reiniciar demo" (solo visible en DEMO) borra `demo.db` y la recrea vacía.

**Señalización:** banner fijo naranja "MODO DEMO - datos de prueba" en todas las pantallas (administración y agente); en REAL, un indicador discreto. `/healthz` y `/version` incluyen el modo. Los agentes no eligen ni cambian el modo. Las capturas de `/pantallazo` en DEMO llevan marca de agua "DEMO" (sección 7).

## 10. Hoja de ruta por versiones

Formato de versión: **0.X.y** (X e y de 1 a 100). Solo la versión del día de las elecciones será **1.0.0**. Cada versión debe poder desplegarse y probarse por sí sola.

| Versión | Contenido | Criterio de "hecho" |
|---------|-----------|---------------------|
| **0.1.y** | Esqueleto: servidor, Docker, `/healthz`, `/version`, página de inicio mobile-first, despliegue detrás de Nginx Proxy Manager. | La URL pública responde por HTTPS mostrando la versión. |
| **0.2.y** | Modelo de datos, migraciones, seed de las 6 mesas y los 6 cortes, login de administrador, CRUD de mesas (censo editable), agentes y generación de PIN. | El administrador crea un agente, le asigna una mesa y obtiene su PIN. |
| **0.3.1** | Modo DEMO / REAL (sección 9 bis): `demo.db` separada, modo automático por `ELECTION_DATE` y manual desde el panel, banner, contadores de intentos separados (admin / PIN) y desbloqueo de IP. | En DEMO nada se escribe en los datos reales; el día de las elecciones la app pasa sola a REAL. |
| **0.3.2** | Acceso de agentes por PIN, captura de participación por cortes con validaciones, el administrador puede introducir, corregir y vaciar datos de cualquier mesa y corte. | Un agente guarda su dato desde el móvil; las validaciones rechazan datos incoherentes. |
| **0.4.y** | Panel resumen (mesa × corte, parciales, %), vista pantallazo con variantes y hora de actualización, histórico de cambios. | Se hace un pantallazo legible en un móvil de 360 px. |
| **0.5.y** | Candidaturas configurables, modo recuento del Congreso (abrir/cerrar), validación de la suma, avance de mesas escrutadas y totales, variante pantallazo de recuento. | Una mesa completa su recuento y el total del colegio se actualiza. |
| **0.6.1** | Recuento del Senado, primera mitad: candidatos configurables, interruptor propio, modo «sábana a sábana» y modo «totales», datos (incluida la matriz de marcas), validaciones, panel de administración y fichas de mesa. | Una mesa registra el Senado en sábana y el administrador lo ve en su panel. |
| **0.6.2** | Recuento del Senado, segunda mitad: variante «Senado» del pantallazo (clasificación por votos, 12 primeros y «Resto»), texto de WhatsApp, estadística de bloque, agrupación normalizada y paso de sábana a totales conservando cifras. | El pantallazo del Senado se lee bien en un móvil de 360 px. |
| **0.7.x** | Kit del agente electoral (apoderado/interventor), dentro de la app: checklist interactivo por fases de la jornada (estado en el dispositivo, ligado al agente) y guía de consejos, con contenido editable en `content/` (sección 7 bis). **0.7.1**: kit completo con contenido de borrador; el contenido legal o de partido se marca `[VERIFICAR]` y solo lo ve el administrador hasta que se quite la marca. | Un agente marca el checklist en el móvil y copia el estado como texto para WhatsApp; los puntos `[VERIFICAR]` no le llegan. |
| **0.8.x** | Blog con Bludit, en un stack separado (`blog/`, su propio compose y script de despliegue), sin puertos al host, publicado solo a través de Nginx Proxy Manager, sin compartir base de datos, sesiones ni cookies con la app y sin mostrar datos de ella. Lo edita solo el administrador. Su ubicación (subdominio o ruta) y su contenido se cierran al empezar la fase. | El blog responde por HTTPS y la app no se ve afectada. |
| **0.9.x** | Endurecimiento y simulacro (**obligatorio; no se recorta ni se retrasa por el blog**): copias automáticas de `app.db`, de los logos y de los datos del blog, con retención y restauración probada; lista de verificación técnica del 29N; cortafuegos; pruebas de móvil con mala conexión; revisión de seguridad; simulacro completo con agentes y datos ficticios. Congelación de despliegues desde 24 h antes del 29N. | Simulacro completo sin errores y restauración de copia probada. |
| **1.0.0** | Versión final del día de las elecciones: congelación de funcionalidad, datos de prueba eliminados, secretos rotados, censo real cargado. | Lista de verificación previa a la jornada completada. |

## 11. Lista de verificación previa a la jornada (para 1.0.0)

- [ ] Censo real de cada mesa revisado.
- [ ] Datos de prueba y simulacro borrados.
- [ ] Contraseña de administrador y secretos cambiados.
- [ ] PIN generados y entregados a los agentes.
- [ ] Candidaturas del Congreso (y Senado) cargadas, ordenadas y con logo; sin candidaturas de prueba.
- [ ] Recuento en REAL cerrado hasta tener la participación informada de todas las mesas.
- [ ] Candidatos del Senado cargados en el orden de la papeleta, con su partido o agrupación, y sin candidatos de prueba; Senado cerrado hasta tener los datos del cierre.
- [ ] Copia de seguridad probada y restauración verificada.
- [ ] Hora del servidor correcta (`Europe/Madrid`).
- [ ] A primera hora del 29N: comprobar que el banner dice REAL (sin banner naranja), que `/version` devuelve `"modo":"REAL"` y que la hora del servidor en la pantalla "Modo de trabajo" es la de Madrid.
- [ ] Acceso desde datos móviles comprobado.
- [ ] Plan B documentado: el administrador introduce todo si falla un agente o la red.

## 12. Decisiones cerradas y pendientes

Cerradas: elecciones generales (Congreso y Senado), 6 mesas del Colegio Dulcinea, censo de europeas editable, cortes a las 10, 12, 14, 16, 18 y 20, participación acumulada, acceso por PIN con administración que puede introducir datos, Congreso en 0.5.y y Senado en 0.6.y, candidaturas configurables desde el panel, despliegue Docker + Nginx Proxy Manager, versionado 0.X.y hasta 1.0.0, definición de «total del colegio» y de «Provisional» (sección 7), modo DEMO / REAL con `demo.db` separada (sección 9 bis), contadores de intentos separados para administrador y agentes.

Pendientes (se resuelven antes de la fase indicada):
- Lista de candidatos del Senado (la cargará el administrador cuando se publique; antes de la jornada).
- Si se quiere enlace de solo lectura con token para compartir la vista pantallazo (después de 0.4.y).
