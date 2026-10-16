// Vistas del recuento del Senado: pestañas Congreso | Senado, pantalla «sábana a sábana» (agente y administrador),
// formulario de totales (respaldo), lectura, confirmación de cierre, resultados y matriz por mesa (panel).
import { VACIO } from './participacion.js';
import { CELDAS, MAX_MARCAS, NOMBRE_MODO, formatoPct } from './senado.js';
import { crudo, html, recurso } from './vistas.js';

const SCRIPT_MODULO = html`<script type="module" src="${recurso('/senado.js')}"></script>`;
export const ESTADOS_MESA = { sin_iniciar: 'Sin iniciar', borrador: 'Borrador', cerrado: 'Cerrada' };

const claseCand = (c) => `cs-${c.id}`;
const claseLista = (l) => (l.candidatos[0] ? claseCand(l.candidatos[0]) : '');
const siglasDe = (c) => c.partido_siglas || c.agrupacion || c.nombre;

// Logo del partido o insignia con sus siglas sobre el color de la lista.
export function insigniaCandidato(c) {
  return c.tiene_logo
    ? html`<span class="marca marca-logo ${claseCand(c)}"><img src="/logos/${c.candidatura_id}?v=${c.logo_hash}" alt="" width="44" height="44" loading="lazy"></span>`
    : html`<span class="marca marca-insignia ${claseCand(c)}" aria-hidden="true">${siglasDe(c).slice(0, 4)}</span>`;
}
function insigniaLista(l) {
  const c = l.candidatos[0];
  return c ? insigniaCandidato(c) : '';
}

const num = (t) => (/^\d+$/.test(String(t ?? '').trim()) ? Number(t) : null);

// ---------- Pestañas Congreso | Senado ----------
// abiertos: { congreso, senado } (para el agente solo se enseñan los abiertos); activa: 'congreso' | 'senado'.
export function pestanas({ congresoUrl, senadoUrl, activa, congreso = true, senado = true }) {
  if (!congreso || !senado) return '';
  const p = (id, texto, url) => html`<a href="${url}" class="pestana${activa === id ? ' activa' : ''}"${activa === id ? crudo(' aria-current="page"') : ''}>${texto}</a>`;
  return html`<nav class="pestanas" aria-label="Elección">${p('congreso', 'Congreso', congresoUrl)}${p('senado', 'Senado', senadoUrl)}</nav>`;
}

// Campos ocultos con los contadores de la sábana (los actualiza public/senado.js; sin JavaScript no se puede contar).
function camposSabana({ candidatos, valores }) {
  const t = (v) => (v === undefined || v === '' ? '0' : v);
  return html`<input type="hidden" name="blancas" value="${t(valores.blancas)}">
  <input type="hidden" name="nulas" value="${t(valores.nulas)}">
  ${candidatos.map((c) => html`<input type="hidden" name="c_${c.id}" value="${t(valores.votos[c.id])}">`)}
  ${CELDAS.map((k) => html`<input type="hidden" name="m_${k.replace(':', '_')}" value="${t(valores.matriz[k])}">`)}`;
}

const panelesConflicto = html`<p class="conflicto" role="alert" data-conflicto hidden>Esta mesa ha sido modificada desde otro dispositivo.</p>
  <div class="botones-conflicto" data-conflicto-botones hidden>
    <button type="button" class="boton boton-sec" data-recargar>Descartar lo mío y recargar</button>
    <button type="button" class="boton" data-sumar-mio>Sumar mis papeletas pendientes</button>
  </div>
  <p class="aviso" role="status" data-borrador-viejo hidden>Hay papeletas sin enviar de este dispositivo y la mesa ha cambiado desde entonces.</p>
  <div class="botones-conflicto" data-borrador-viejo-botones hidden>
    <button type="button" class="boton boton-sec" data-descartar-local>Descartarlas</button>
    <button type="button" class="boton" data-aplicar-local>Sumarlas a lo guardado</button>
  </div>`;

// ---------- Sábana a sábana ----------
export function pantallaSabana({ csrf, base, datos, valores, version, rol = 'agente' }) {
  const { mesa, listas, cab, ultima } = datos;
  const estado = cab?.estado ?? 'sin_iniciar';
  const candidatos = listas.flatMap((l) => l.candidatos);
  return html`<form method="post" action="${base}/guardar" class="form-senado sabana" data-modo="sabana" data-autoguardado="${base}/guardar" data-cerrar="${base}/cerrar" data-clave="${rol}:${mesa.id}" data-censo="${mesa.censo}">
  <input type="hidden" name="_csrf" value="${csrf}">
  <input type="hidden" name="version" value="${version}">
  <input type="hidden" name="modo" value="sabana">
  ${camposSabana({ candidatos, valores })}
  <section class="tarjeta">
    <p class="estado-mesa ${estado}">${ESTADOS_MESA[estado]}</p>
    <p class="nota">Modo <strong>sábana a sábana</strong> · censo de la mesa: <strong>${mesa.censo}</strong> electores${ultima ? html` · última participación informada: <strong>${ultima.valor}</strong> (${ultima.hora})` : ''}</p>
    <p class="nota">Cada papeleta lleva hasta ${MAX_MARCAS} nombres. Toca los marcados y pulsa <strong>Confirmar papeleta</strong>.</p>
  </section>
  <div class="contadores-senado" aria-label="Contadores en vivo" aria-live="polite">
    <p><span class="cs-etq">Contadas</span><strong data-contadas>0</strong></p>
    <p><span class="cs-etq">Válidas</span><strong data-validas>0</strong></p>
    <p><span class="cs-etq">Blancas</span><strong data-blancas>0</strong></p>
    <p><span class="cs-etq">Nulas</span><strong data-nulas>0</strong></p>
  </div>
  <noscript><p class="error">Esta pantalla necesita JavaScript. Si no funciona en tu móvil, avisa al Jefe de Colegio: puede introducir los totales.</p></noscript>
  ${listas.map((l) => html`<section class="lista-senado ${claseLista(l)}" data-lista="${l.clave}">
    <header class="lista-cab">
      ${insigniaLista(l)}
      <h2>${l.nombre}</h2>
      ${l.candidatos.length <= MAX_MARCAS ? html`<button type="button" class="boton boton-sec boton-lista" data-lista-completa="${l.clave}" hidden>Lista completa</button>` : ''}
    </header>
    ${l.candidatos.map((c) => html`<button type="button" class="cand-senado ${claseCand(c)}" data-candidato="${c.id}" data-lista="${l.clave}" aria-pressed="false" hidden>
      <span class="cs-marca" aria-hidden="true"></span>
      <span class="cs-nombre">${c.nombre}</span>
      <span class="cs-votos" data-votos="${c.id}" aria-label="Votos">0</span>
    </button>`)}
  </section>`)}
  <p class="conflicto-marcas" role="status" data-mensaje hidden></p>
  ${panelesConflicto}
  <div class="botones-recuento">
    <button type="submit" class="boton boton-sec" data-guardar>Guardar ahora</button>
    ${estado === 'cerrado' ? '' : html`<button type="submit" class="boton" formaction="${base}/cerrar" data-cerrar-mesa>Cerrar mesa</button>`}
  </div>
  <div class="barra-papeleta" aria-label="Papeleta actual">
    <p class="bp-marcas" data-resumen-marcas aria-live="polite">Papeleta vacía</p>
    <div class="bp-botones">
      <button type="button" class="boton" data-confirmar hidden disabled>Confirmar papeleta</button>
      <button type="button" class="boton boton-sec" data-blanca hidden>En blanco</button>
      <button type="button" class="boton boton-sec" data-nula hidden>Nula</button>
      <button type="button" class="boton boton-sec" data-deshacer hidden disabled>Deshacer última</button>
    </div>
    <p class="bs-guardado" data-guardado aria-live="polite">${cab ? `Versión guardada ${version}` : 'Sin guardar'}</p>
  </div>
</form>
${SCRIPT_MODULO}`;
}

// ---------- Totales (respaldo) ----------
export function formularioTotales({ csrf, base, datos, valores, version, rol = 'agente' }) {
  const { mesa, listas, cab, ultima } = datos;
  const estado = cab?.estado ?? 'sin_iniciar';
  const cerrada = estado === 'cerrado';
  const campo = (nombre, etiqueta, valor, extra = '') => html`<div class="fila-total">
    <label for="f_${nombre}">${etiqueta}</label>
    <input id="f_${nombre}" name="${nombre}" class="campo-numero cuenta-total" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${VACIO}" value="${valor ?? ''}">
  </div>`;
  const suma = Object.values(valores.votos).reduce((a, v) => a + (num(v) ?? 0), 0);
  const validas = num(valores.validas);
  return html`<form method="post" action="${base}/guardar" class="form-senado totales" data-modo="totales" data-autoguardado="${base}/guardar" data-cerrar="${base}/cerrar" data-clave="${rol}:${mesa.id}" data-censo="${mesa.censo}">
  <input type="hidden" name="_csrf" value="${csrf}">
  <input type="hidden" name="version" value="${version}">
  <input type="hidden" name="modo" value="totales">
  <section class="tarjeta">
    <p class="estado-mesa ${estado}">${ESTADOS_MESA[estado]}</p>
    <p class="nota">Modo <strong>totales</strong> · censo de la mesa: <strong>${mesa.censo}</strong> electores${ultima ? html` · última participación informada: <strong>${ultima.valor}</strong> (${ultima.hora})` : ''}</p>
    ${campo('validas', 'Papeletas válidas (con al menos una marca)', valores.validas)}
    ${campo('blancas', 'Papeletas en blanco', valores.blancas)}
    ${campo('nulas', 'Papeletas nulas', valores.nulas)}
  </section>
  ${listas.map((l) => html`<section class="tarjeta lista-totales ${claseLista(l)}">
    <header class="lista-cab">${insigniaLista(l)}<h2>${l.nombre}</h2></header>
    ${l.candidatos.map((c) => campo(`c_${c.id}`, c.nombre, valores.votos[c.id]))}
  </section>`)}
  ${panelesTotales}
  <div class="botones-recuento">
    <button type="submit" class="boton boton-sec" data-guardar>${cerrada ? 'Guardar cambios' : 'Guardar borrador'}</button>
    ${cerrada ? '' : html`<button type="submit" class="boton" formaction="${base}/cerrar" data-cerrar-mesa>Cerrar mesa</button>`}
  </div>
  <div class="barra-suma" aria-label="Comprobación">
    <p class="bs-linea"><span class="bs-etq">Suma de votos</span> <strong data-suma>${suma}</strong></p>
    <p class="bs-linea"><span class="bs-etq">Válidas</span> <strong data-validas-v>${validas ?? VACIO}</strong></p>
    <p class="bs-estado no-cuadra" data-cuadra aria-live="polite">${validas === null ? 'Pon las papeletas válidas para comprobar la suma.' : ''}</p>
    <p class="bs-guardado" data-guardado aria-live="polite">${cab ? `Versión guardada ${version}` : 'Sin guardar'}</p>
  </div>
</form>
${SCRIPT_MODULO}`;
}
const panelesTotales = html`<p class="conflicto" role="alert" data-conflicto hidden>Esta mesa ha sido modificada desde otro dispositivo.</p>
  <div class="botones-conflicto" data-conflicto-botones hidden>
    <button type="button" class="boton boton-sec" data-recargar>Recargar lo guardado</button>
    <button type="button" class="boton" data-sobrescribir>Mantener lo mío y sobrescribir</button>
  </div>
  <p class="aviso" role="status" data-borrador-viejo hidden>Hay cambios sin guardar de este dispositivo de una versión anterior de esta mesa.</p>
  <div class="botones-conflicto" data-borrador-viejo-botones hidden>
    <button type="button" class="boton boton-sec" data-descartar-local>Descartarlos</button>
    <button type="button" class="boton" data-aplicar-local>Aplicarlos</button>
  </div>`;

// Elección de modo en una mesa sin datos (el modo se fija al guardar el primer dato).
export function elegirModo({ base, modoActual, predeterminado }) {
  const otro = predeterminado === 'sabana' ? 'totales' : 'sabana';
  return html`<p class="nota modo-elegir">Modo: <strong>${NOMBRE_MODO[predeterminado]}</strong>. Se fija al guardar el primer dato. <a href="${base}?modo=${otro}">Usar «${NOMBRE_MODO[otro]}»</a></p>`;
}

// ---------- Solo lectura ----------
export function vistaSoloLecturaSenado({ datos, mensaje }) {
  const { mesa, listas, cab, votos, matriz } = datos;
  const estado = cab?.estado ?? 'sin_iniciar';
  const fila = (nombre, valor) => html`<tr><th scope="row">${nombre}</th><td class="num${valor === null || valor === undefined ? ' vacia' : ''}">${valor ?? VACIO}</td></tr>`;
  const contadas = (cab?.validas ?? 0) + (cab?.blancas ?? 0) + (cab?.nulas ?? 0);
  return html`<section class="tarjeta">
  <p class="estado-mesa ${estado}">${ESTADOS_MESA[estado]}</p>
  ${mensaje ? html`<p class="aviso-bloqueo" role="alert">${mensaje}</p>` : ''}
  <p class="nota">Censo de la mesa: <strong>${mesa.censo}</strong> electores${cab ? html` · modo <strong>${NOMBRE_MODO[cab.modo]}</strong>` : ''}</p>
</section>
<div class="tabla-scroll"><table class="tabla-simple">
  <thead><tr><th>Candidato</th><th class="num">Votos</th></tr></thead>
  <tbody>
    ${listas.flatMap((l) => l.candidatos.map((c) => fila(`${c.nombre} (${l.nombre})`, votos.get(c.id) ?? null)))}
  </tbody>
  <tfoot>
    ${fila('Papeletas válidas', cab?.validas ?? null)}
    ${fila('En blanco', cab?.blancas ?? null)}
    ${fila('Nulas', cab?.nulas ?? null)}
    ${fila('Papeletas contadas', cab ? contadas : null)}
  </tfoot>
</table></div>
${cab?.modo === 'sabana' ? tablaMarcas(matriz) : html`<p class="nota">Modo totales: no hay desglose por número de marcas.</p>`}`;
}

// Papeletas válidas por número de marcas y por «mismo partido» (solo modo sábana).
export function tablaMarcas(matriz) {
  const v = (k) => matriz.get(k) ?? 0;
  return html`<h2>Papeletas válidas por marcas</h2>
<div class="tabla-scroll"><table class="tabla-simple">
  <thead><tr><th>Marcas</th><th class="num">Mismo partido</th><th class="num">Partidos distintos</th></tr></thead>
  <tbody>
    <tr><th scope="row">1</th><td class="num">${v('1:1')}</td><td class="num">${VACIO}</td></tr>
    <tr><th scope="row">2</th><td class="num">${v('2:1')}</td><td class="num">${v('2:0')}</td></tr>
    <tr><th scope="row">3</th><td class="num">${v('3:1')}</td><td class="num">${v('3:0')}</td></tr>
  </tbody>
</table></div>`;
}

// ---------- Confirmación de cierre ----------
export function bloqueConfirmarCierreSenado({ csrf, base, datos, valores, version, avisos, suma, contadas, urlVolver, rol }) {
  const { mesa, candidatos } = datos;
  const t = (v) => (v === null || v === undefined ? '' : String(v));
  const campos = [
    ['modo', valores.modo], ['validas', t(valores.validas)], ['blancas', t(valores.blancas)], ['nulas', t(valores.nulas)],
    ...candidatos.map((c) => [`c_${c.id}`, t(valores.votos.get(c.id))]),
    ...(valores.matriz ? CELDAS.map((k) => [`m_${k.replace(':', '_')}`, t(valores.matriz.get(k))]) : []),
  ];
  return html`<section class="tarjeta confirmar" role="alert">
  <h2>¿Cerrar la mesa ${mesa.codigo}?</h2>
  <p>${rol === 'admin' ? 'Podrás reabrirla cuando quieras.' : 'Ya no podrás editarla: solo el administrador puede reabrirla.'}</p>
  <p class="bs-linea"><span class="bs-etq">Papeletas contadas</span> <strong>${contadas}</strong></p>
  <p class="bs-linea"><span class="bs-etq">Válidas</span> <strong>${valores.validas}</strong></p>
  <p class="bs-linea"><span class="bs-etq">Suma de votos</span> <strong>${suma}</strong></p>
  ${avisos.length > 0 ? html`<ul>${avisos.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
  <form method="post" action="${base}/cerrar" class="formulario">
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="version" value="${version}">
    <input type="hidden" name="confirmar" value="1">
    ${campos.map(([nombre, v]) => html`<input type="hidden" name="${nombre}" value="${v ?? ''}">`)}
    <button type="submit" class="boton">Sí, cerrar la mesa</button>
  </form>
  <p><a class="boton boton-sec" href="${urlVolver}">No, volver</a></p>
</section>`;
}

// ---------- Panel del administrador ----------
const celdaCand = (c) => html`<span class="celda-cand">${insigniaCandidato(c)}<span class="celda-textos"><span class="celda-siglas">${c.nombre}</span><span class="celda-nombre">${siglasDe(c)}</span></span></span>`;

export function resultadosSenado(resumen) {
  const pct = (p) => formatoPct(p);
  return html`<div class="tabla-scroll"><table class="tabla-recuento">
  <thead><tr><th>Candidato</th><th class="num">Votos</th><th class="num">% válidas</th></tr></thead>
  <tbody>
    ${resumen.candidatos.map((c) => html`<tr class="${claseCand(c.cand)}${c.cand.activo ? '' : ' inactiva'}"><th scope="row">${celdaCand(c.cand)}</th><td class="num">${c.votos}</td><td class="num${c.porcentaje === null ? ' vacia' : ''}">${pct(c.porcentaje)}</td></tr>`)}
  </tbody>
  <tfoot>
    <tr><th scope="row">Papeletas válidas</th><td class="num">${resumen.validas}</td><td></td></tr>
    <tr><th scope="row">En blanco</th><td class="num">${resumen.blancas}</td><td></td></tr>
    <tr><th scope="row">Nulas</th><td class="num">${resumen.nulas}</td><td></td></tr>
    <tr><th scope="row">Papeletas contadas</th><td class="num">${resumen.contadas}</td><td></td></tr>
  </tfoot>
</table></div>
<h2>Por partido</h2>
<div class="tabla-scroll"><table class="tabla-recuento">
  <thead><tr><th>Partido</th><th class="num">Votos</th><th class="num">% válidas</th></tr></thead>
  <tbody>
    ${resumen.partidos.map((l) => html`<tr class="${claseLista(l)}"><th scope="row"><span class="celda-cand">${insigniaLista(l)}<span class="celda-textos"><span class="celda-siglas">${l.nombre}</span><span class="celda-nombre">${l.candidatos.length} candidato${l.candidatos.length === 1 ? '' : 's'}</span></span></span></th><td class="num">${l.votos}</td><td class="num${l.porcentaje === null ? ' vacia' : ''}">${pct(l.porcentaje)}</td></tr>`)}
  </tbody>
</table></div>
<p class="nota">Cada elector marca hasta ${MAX_MARCAS} nombres: los % se calculan sobre las <strong>papeletas válidas</strong> y no suman 100.</p>`;
}

export function matrizSenado(resumen) {
  const ficha = (m) => `/admin/senado/mesa/${m.id}`;
  const celda = (m, valor, estado) => html`<td class="num${valor === null || valor === undefined ? ' vacia' : ''}${estado === 'borrador' ? ' borrador' : ''}"><a class="celda${valor === null || valor === undefined ? ' vacia' : ''}" href="${ficha(m)}">${valor ?? VACIO}</a></td>`;
  const fila = (etiqueta, claseFila, valorDe, total) => html`<tr class="${claseFila}"><th scope="row" class="fija">${etiqueta}</th><td class="num total">${total}</td>${resumen.mesas.map((x) => celda(x.mesa, valorDe(x) ?? null, x.estado))}</tr>`;
  return html`<div class="tabla-scroll"><table class="tabla-resumen tabla-matriz">
  <thead><tr><th class="fija">Candidato</th><th class="num">Σ<span class="faltan">cerradas</span></th>${resumen.mesas.map((x) => html`<th class="num"><a href="${ficha(x.mesa)}">${x.mesa.codigo}</a><span class="faltan estado-${x.estado}">${ESTADOS_MESA[x.estado]}</span></th>`)}</tr></thead>
  <tbody>
    ${resumen.candidatos.map((c) => fila(celdaCand(c.cand), claseCand(c.cand), (x) => x.votos.get(c.cand.id), c.votos))}
    ${fila('Válidas', 'neutra', (x) => x.cab?.validas, resumen.validas)}
    ${fila('Blancas', 'neutra', (x) => x.cab?.blancas, resumen.blancas)}
    ${fila('Nulas', 'neutra', (x) => x.cab?.nulas, resumen.nulas)}
  </tbody>
</table></div>
<p class="nota">Σ = suma de las mesas <strong>cerradas</strong>. Las cifras en cursiva son de mesas en borrador (no suman). Toca una celda para abrir la ficha de la mesa.</p>`;
}
