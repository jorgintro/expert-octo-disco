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
- Límite de intentos por IP y bloqueo temporal ante fallos repetidos (por ejemplo, 5 fallos y 5 minutos de bloqueo).
- Sesión por cookie `HttpOnly`, `Secure`, `SameSite=Lax`, con caducidad larga durante la jornada (por ejemplo, 14 h) para que el agente no tenga que reintroducir el PIN.
- Un agente puede estar asignado a una o varias mesas; una mesa puede tener varios agentes.
- Revocar un PIN invalida sus sesiones activas.
- El administrador puede introducir datos en nombre de cualquier agente; el registro de cambios indica quién lo hizo realmente.

## 5. Modelo de datos (SQLite)

Todas las fechas en UTC (ISO 8601), mostradas en `Europe/Madrid`.

- **colegio**: `id`, `nombre`, `municipio`.
- **mesa**: `id`, `colegio_id`, `distrito`, `seccion`, `letra`, `codigo` (ej. `4-2-A`, único por colegio), `censo` (entero ≥ 0), `activa`.
- **agente**: `id`, `nombre`, `pin_hmac` (único), `activo`, `creado_en`.
- **agente_mesa**: `agente_id`, `mesa_id` (relación N:M).
- **admin**: `id`, `usuario`, `password_hash` (argon2 o bcrypt).
- **corte**: `id`, `hora` (`HH:MM`), `orden`. Valores iniciales: 10:00, 12:00, 14:00, 16:00, 18:00, 20:00. Configurables.
- **participacion**: `id`, `mesa_id`, `corte_id`, `votantes_acumulados`, `introducido_por_tipo` (agente/admin), `introducido_por_id`, `actualizado_en`. Única por (`mesa_id`, `corte_id`).
- **candidatura**: `id`, `eleccion` (`congreso`/`senado`), `nombre`, `siglas`, `orden`, `destacada` (bool, para la vista pantallazo), `activa`.
- **recuento_mesa**: `mesa_id`, `eleccion`, `votos_blancos`, `votos_nulos`, `estado` (`borrador`/`cerrado`), `actualizado_en`, `introducido_por`.
- **recuento_voto**: `mesa_id`, `candidatura_id`, `votos`. Única por (`mesa_id`, `candidatura_id`).
- **ajuste**: clave-valor (por ejemplo `recuento_abierto`, `senado_abierto`, `zona_horaria`).
- **auditoria**: `id`, `fecha`, `actor_tipo`, `actor_id`, `accion`, `entidad`, `entidad_id`, `valor_anterior`, `valor_nuevo`. Se escribe en **toda** modificación de datos (incluidos cambios de censo, asignaciones y activación del recuento).

## 6. Reglas de validación

**Participación (por mesa)**
1. `votantes_acumulados` es entero ≥ 0 y ≤ `censo` de la mesa.
2. El acumulado no puede ser menor que el del corte anterior ya introducido, ni mayor que el del corte posterior ya introducido.
3. Se calcula el parcial de cada tramo (acumulado del corte menos el del corte anterior) y el porcentaje sobre censo.
4. Si el dato pasa de golpe un umbral de sospecha (por ejemplo, un salto de más del 25 % del censo en un tramo), la app pide confirmación explícita, sin bloquear.
5. Un agente puede corregir su propio dato; el cambio queda en auditoría.

**Recuento del Congreso (por mesa)**
1. Votos por candidatura, blancos y nulos: enteros ≥ 0.
2. `votos a candidaturas + blancos + nulos = total de votantes de la mesa`.
3. Total de votantes ≤ censo.
4. Si el total de votantes difiere de la última participación acumulada (corte de las 20:00), se avisa con una advertencia, sin bloquear.
5. El estado `cerrado` bloquea la edición al agente; solo el administrador puede reabrir.

**Recuento del Senado (0.6.y)**
- Cada elector puede marcar hasta 3 nombres, así que los votos van **por candidato** y la suma no cuadra con el total de votantes.
- Validaciones: votos por candidato ≥ 0; ningún candidato supera el total de votantes de la mesa; blancos y nulos ≥ 0; el total de votantes ≤ censo.
- Se definirán con el administrador el modelo exacto y los candidatos antes de implementarlo.

## 7. Pantallas

**Login**: campo único de PIN con teclado numérico grande (`inputmode="numeric"`). Enlace discreto a "Acceso administrador".

**Agente**
- Cabecera con colegio y mesa asignada (con selector si tiene varias).
- Tarjeta del **corte actual** (el más reciente que corresponda por hora, con posibilidad de elegir otro): campo numérico grande y botón "Guardar".
- Histórico de cortes de la mesa con acumulado, parcial y % sobre censo.
- Cuando el administrador abre el recuento: formulario del Congreso (una fila por candidatura, más blancos y nulos), con total y comprobación en vivo.

**Administrador**
- **Resumen**: tabla mesa × corte (acumulado y % sobre censo), con totales del colegio y mesas pendientes de cada corte.
- **Mesas**: alta/baja/edición de mesas, **censo editable**.
- **Agentes**: alta/baja, asignación a mesas, generar/regenerar/revocar PIN.
- **Cortes**: edición de horas.
- **Candidaturas**: nombre, siglas, orden, destacada, activa (por elección).
- **Recuento**: botón para **abrir/cerrar el recuento** (la app avisa antes de las 20:00 pero no lo impide, para no depender del reloj del servidor), avance (mesas escrutadas, ej. 5/6) y resultados por mesa y totales.
- **Introducir datos como administrador**: acceso desde la tabla a cualquier celda.
- **Histórico**: auditoría filtrable.
- **Copias de seguridad**: botón para descargar copia de la base de datos.

**Vista pantallazo** (`/pantallazo`, solo administrador, aunque se podrá compartir un enlace de solo lectura con token en una versión posterior)
- Pantalla limpia, sin menús, tipografía grande, buen contraste, ancho pensado para captura de móvil.
- Título con colegio, tipo de elección y **hora de actualización** bien visible.
- Variantes seleccionables: **Participación** (tabla mesa × corte, total colegio y %), **Último corte** (compacta), **Recuento** (candidaturas destacadas, mesas escrutadas, blancos, nulos y total).
- Marca de estado: "Provisional" mientras haya mesas pendientes.

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
- Variables de entorno: `PORT`, `DATA_DIR`, `SESSION_SECRET`, `PIN_HMAC_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD_INITIAL`, `TZ=Europe/Madrid`.
- Endpoint de salud `/healthz` y versión visible en el pie de la app y en `/version`.
- Copia de seguridad: comando documentado (`sqlite3 .backup`) y copia automática periódica durante la jornada al volumen, más descarga manual desde el panel.

## 10. Hoja de ruta por versiones

Formato de versión: **0.X.y** (X e y de 1 a 100). Solo la versión del día de las elecciones será **1.0.0**. Cada versión debe poder desplegarse y probarse por sí sola.

| Versión | Contenido | Criterio de "hecho" |
|---------|-----------|---------------------|
| **0.1.y** | Esqueleto: servidor, Docker, `/healthz`, `/version`, página de inicio mobile-first, despliegue detrás de Nginx Proxy Manager. | La URL pública responde por HTTPS mostrando la versión. |
| **0.2.y** | Modelo de datos, migraciones, seed de las 6 mesas y los 6 cortes, login de administrador, CRUD de mesas (censo editable), agentes y generación de PIN. | El administrador crea un agente, le asigna una mesa y obtiene su PIN. |
| **0.3.y** | Acceso de agentes por PIN, límite de intentos, captura de participación por cortes con validaciones, el administrador puede introducir datos por cualquier mesa. | Un agente guarda su dato desde el móvil; las validaciones rechazan datos incoherentes. |
| **0.4.y** | Panel resumen (mesa × corte, parciales, %), vista pantallazo con variantes y hora de actualización, histórico de cambios. | Se hace un pantallazo legible en un móvil de 360 px. |
| **0.5.y** | Candidaturas configurables, modo recuento del Congreso (abrir/cerrar), validación de la suma, avance de mesas escrutadas y totales, variante pantallazo de recuento. | Una mesa completa su recuento y el total del colegio se actualiza. |
| **0.6.y** | Recuento del Senado según el modelo acordado. | Una mesa registra el Senado y el resumen lo refleja. |
| **0.7.y y siguientes** | Endurecimiento: copias automáticas, pruebas de carga y de móvil con mala conexión, revisión de seguridad, ajustes de usabilidad y simulacro completo con datos ficticios. | Simulacro completo sin errores y restauración de copia probada. |
| **1.0.0** | Versión final del día de las elecciones: congelación de funcionalidad, datos de prueba eliminados, secretos rotados, censo real cargado. | Lista de verificación previa a la jornada completada. |

## 11. Lista de verificación previa a la jornada (para 1.0.0)

- [ ] Censo real de cada mesa revisado.
- [ ] Datos de prueba y simulacro borrados.
- [ ] Contraseña de administrador y secretos cambiados.
- [ ] PIN generados y entregados a los agentes.
- [ ] Candidaturas del Congreso (y Senado) cargadas y ordenadas.
- [ ] Copia de seguridad probada y restauración verificada.
- [ ] Hora del servidor correcta (`Europe/Madrid`).
- [ ] Acceso desde datos móviles comprobado.
- [ ] Plan B documentado: el administrador introduce todo si falla un agente o la red.

## 12. Decisiones cerradas y pendientes

Cerradas: elecciones generales (Congreso y Senado), 6 mesas del Colegio Dulcinea, censo de europeas editable, cortes a las 10, 12, 14, 16, 18 y 20, participación acumulada, acceso por PIN con administración que puede introducir datos, Congreso en 0.5.y y Senado en 0.6.y, candidaturas configurables desde el panel, despliegue Docker + Nginx Proxy Manager, versionado 0.X.y hasta 1.0.0.

Pendientes (se resuelven antes de la fase indicada):
- Modelo exacto del Senado y lista de candidatos (antes de 0.6.y).
- Si se quiere enlace de solo lectura con token para compartir la vista pantallazo (después de 0.4.y).
- Lista de candidaturas del Congreso que se quieren destacar (antes de 0.5.y).
