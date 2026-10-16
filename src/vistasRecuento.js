// Vistas del recuento: formulario «clicker» (agente y administrador), lectura, confirmación de cierre,
// resultados y matriz por mesa (panel) y filas del pantallazo.
import { VACIO } from './participacion.js';
import { formatoPorcentaje2, sumaVotos } from './recuento.js';
import { crudo, html, recurso } from './vistas.js';
import { clase, insignia } from './vistasCandidaturas.js';

const SCRIPT = html`<script src="${recurso('/recuento.js')}" defer></script>`;
const nombreDe = (c) => c.siglas || c.nombre;

export const ESTADOS_MESA = { sin_iniciar: 'Sin iniciar', borrador: 'Borrador', cerrado: 'Cerrada' };

// Texto del comprobador de la suma (el mismo criterio que public/recuento.js).
export function textoCuadre({ suma, votantes }) {
  if (votantes === null) return { texto: 'Pon el total de votantes para comprobar la suma.', cuadra: false };
  if (suma === votantes) return { texto: '✓ Cuadra', cuadra: true };
  return { texto: suma < votantes ? `✗ Faltan ${votantes - suma}` : `✗ Sobran ${suma - votantes}`, cuadra: false };
}

// Valores del formulario como TEXTO ('' = sin rellenar) a partir de lo guardado.
export function valoresDeDatos({ cab, votos }) {
  const t = (v) => (v === null || v === undefined ? '' : String(v));
  return { votantes: t(cab?.votantes), blancos: t(cab?.votos_blancos), nulos: t(cab?.votos_nulos), votos: Object.fromEntries([...votos].map(([id, v]) => [id, t(v)])) };
}

const num = (t) => (/^\d+$/.test(String(t ?? '').trim()) ? Number(t) : null);

function clicker(c, valor) {
  const n = nombreDe(c);
  return html`<div class="clicker ${clase(c)}">
  <div class="clicker-cab">
    ${insignia(c)}
    <span class="clicker-textos">
      <span class="clicker-siglas">${n}</span>
      ${c.siglas ? html`<span class="clicker-nombre">${c.nombre}</span>` : ''}
    </span>
  </div>
  <div class="clicker-ctl">
    <button type="button" class="menos" data-delta="-1" aria-label="Restar un voto a ${n}" hidden>−</button>
    <input class="cuenta" name="v_${c.id}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${VACIO}" aria-label="Votos de ${n}" value="${valor}">
    <button type="button" class="mas" data-delta="1" aria-label="Sumar un voto a ${n}" hidden>+</button>
  </div>
</div>`;
}

function clickerNeutro(nombre, campo, valor) {
  return html`<div class="clicker neutro">
  <div class="clicker-cab"><span class="clicker-textos"><span class="clicker-siglas">${nombre}</span></span></div>
  <div class="clicker-ctl">
    <button type="button" class="menos" data-delta="-1" aria-label="Restar un voto a ${nombre}" hidden>−</button>
    <input class="cuenta" name="${campo}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${VACIO}" aria-label="${nombre}" value="${valor}">
    <button type="button" class="mas" data-delta="1" aria-label="Sumar un voto a ${nombre}" hidden>+</button>
  </div>
</div>`;
}

// ---------- Formulario ----------
// base: URL base de la mesa (…/recuento o …/recuento/mesa/ID); acciones: base/guardar, base/cerrar.
export function formularioRecuento({ csrf, base, datos, valores, version, rol = 'agente' }) {
  const { mesa, candidaturas, cab, ultima } = datos;
  const hayDestacadas = candidaturas.some((c) => c.destacada);
  const principales = hayDestacadas ? candidaturas.filter((c) => c.destacada) : candidaturas;
  const otras = hayDestacadas ? candidaturas.filter((c) => !c.destacada) : [];
  const valor = (c) => valores.votos[c.id] ?? '';
  const suma = sumaVotos({ votos: new Map(candidaturas.map((c) => [c.id, num(valor(c))])), blancos: num(valores.blancos), nulos: num(valores.nulos) });
  const votantes = num(valores.votantes);
  const cuadre = textoCuadre({ suma, votantes });
  const sumaOtras = otras.reduce((a, c) => a + (num(valor(c)) ?? 0), 0);
  const estado = cab?.estado ?? 'sin_iniciar';
  const cerrada = estado === 'cerrado';

  return html`<form method="post" action="${base}/guardar" class="form-recuento" data-autoguardado="${base}/guardar" data-cerrar="${base}/cerrar" data-clave="${rol}:${mesa.id}" data-censo="${mesa.censo}">
  <input type="hidden" name="_csrf" value="${csrf}">
  <input type="hidden" name="version" value="${version}">
  <section class="tarjeta">
    <p class="estado-mesa ${estado}">${ESTADOS_MESA[estado]}</p>
    <p class="nota">Censo de la mesa: <strong>${mesa.censo}</strong> electores</p>
    ${ultima ? html`<p class="nota">Última participación informada: <strong>${ultima.valor}</strong> (${ultima.hora})</p>` : ''}
    <label for="votantes">Total de votantes de la mesa</label>
    <input id="votantes" name="votantes" class="campo-numero" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${VACIO}" value="${valores.votantes}">
  </section>
  <label class="casilla interruptor" data-teclear hidden><input type="checkbox" id="teclear"> Teclear números (en vez de «–» y «+»)</label>
  ${principales.map((c) => clicker(c, valor(c)))}
  ${otras.length > 0
    ? html`<details class="otros"${otras.some((c) => valor(c) !== '') ? crudo(' open') : ''}>
    <summary>Otros (${otras.length} candidaturas) · suma <strong data-suma-otros>${sumaOtras}</strong></summary>
    ${otras.map((c) => clicker(c, valor(c)))}
  </details>`
    : ''}
  ${clickerNeutro('Blancos', 'blancos', valores.blancos)}
  ${clickerNeutro('Nulos', 'nulos', valores.nulos)}
  <p class="conflicto" role="alert" data-conflicto hidden>Esta mesa ha sido modificada desde otro dispositivo.</p>
  <div class="botones-conflicto" data-conflicto-botones hidden>
    <button type="button" class="boton boton-sec" data-recargar>Recargar lo guardado</button>
    <button type="button" class="boton" data-sobrescribir>Mantener lo mío y sobrescribir</button>
  </div>
  <p class="aviso" role="status" data-borrador-viejo hidden>Hay cambios sin guardar de este dispositivo de una versión anterior de esta mesa.</p>
  <div class="botones-conflicto" data-borrador-viejo-botones hidden>
    <button type="button" class="boton boton-sec" data-descartar-local>Descartarlos</button>
    <button type="button" class="boton" data-aplicar-local>Aplicarlos</button>
  </div>
  <div class="botones-recuento">
    <button type="button" class="boton boton-sec" data-poner-ceros hidden>Poner 0 en las vacías</button>
    <button type="submit" class="boton boton-sec" data-guardar>${cerrada ? 'Guardar cambios' : 'Guardar borrador'}</button>
    ${cerrada ? '' : html`<button type="submit" class="boton" formaction="${base}/cerrar" data-cerrar-mesa>Cerrar mesa</button>`}
  </div>
  <div class="barra-suma" aria-label="Comprobación de la suma">
    <p class="bs-linea"><span class="bs-etq">Suma</span> <strong data-suma>${suma}</strong></p>
    <p class="bs-linea"><span class="bs-etq">Votantes</span> <strong data-votantes>${votantes ?? VACIO}</strong></p>
    <p class="bs-estado ${cuadre.cuadra ? 'cuadra' : 'no-cuadra'}" data-cuadra aria-live="polite">${cuadre.texto}</p>
    <p class="bs-guardado" data-guardado aria-live="polite">${cab ? `Versión guardada ${version}` : 'Sin guardar'}</p>
  </div>
</form>
${SCRIPT}`;
}

// ---------- Solo lectura (mesa cerrada o del administrador, para un agente) ----------
export function vistaSoloLectura({ datos, mensaje }) {
  const { mesa, candidaturas, cab, votos } = datos;
  const estado = cab?.estado ?? 'sin_iniciar';
  const suma = sumaVotos({ votos, blancos: cab?.votos_blancos ?? null, nulos: cab?.votos_nulos ?? null });
  const fila = (nombre, valor, extra = '') => html`<tr><th scope="row">${nombre}</th><td class="num${valor === null ? ' vacia' : ''}">${valor ?? VACIO}</td></tr>`;
  return html`<section class="tarjeta">
  <p class="estado-mesa ${estado}">${ESTADOS_MESA[estado]}</p>
  <p class="aviso-bloqueo" role="alert">${mensaje}</p>
  <p class="nota">Censo de la mesa: <strong>${mesa.censo}</strong> electores</p>
</section>
<div class="tabla-scroll"><table class="tabla-simple">
  <thead><tr><th>Candidatura</th><th class="num">Votos</th></tr></thead>
  <tbody>
    ${candidaturas.map((c) => fila(nombreDe(c), votos.get(c.id) ?? null))}
    ${fila('Blancos', cab?.votos_blancos ?? null)}
    ${fila('Nulos', cab?.votos_nulos ?? null)}
  </tbody>
  <tfoot>
    ${fila('Suma', suma)}
    ${fila('Total de votantes', cab?.votantes ?? null)}
  </tfoot>
</table></div>`;
}

// ---------- Confirmación de cierre ----------
export function bloqueConfirmarCierre({ csrf, base, datos, valores, version, avisos, suma, urlVolver, rol }) {
  const { mesa, candidaturas } = datos;
  const campos = [
    ['votantes', valores.votantes], ['blancos', valores.blancos], ['nulos', valores.nulos],
    ...candidaturas.map((c) => [`v_${c.id}`, valores.votos.get(c.id)]),
  ];
  return html`<section class="tarjeta confirmar" role="alert">
  <h2>¿Cerrar la mesa ${mesa.codigo}?</h2>
  <p>${rol === 'admin' ? 'Podrás reabrirla cuando quieras.' : 'Ya no podrás editarla: solo el administrador puede reabrirla.'}</p>
  <p class="bs-linea"><span class="bs-etq">Suma</span> <strong>${suma}</strong></p>
  <p class="bs-linea"><span class="bs-etq">Votantes</span> <strong>${valores.votantes}</strong></p>
  <p class="bs-estado cuadra">✓ Cuadra</p>
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
const celdaCand = (c) => html`<span class="celda-cand">${insignia(c)}<span class="celda-textos"><span class="celda-siglas">${nombreDe(c)}</span>${c.siglas ? html`<span class="celda-nombre">${c.nombre}</span>` : ''}</span></span>`;

export function resultadosRecuento(resumen) {
  const pie = (nombre, valor, pct) => html`<tr class="separada"><th scope="row">${nombre}</th><td class="num">${valor}</td><td class="num${pct === null ? ' vacia' : ''}">${pct === undefined ? '' : formatoPorcentaje2(pct)}</td></tr>`;
  return html`<div class="tabla-scroll"><table class="tabla-recuento">
  <thead><tr><th>Candidatura</th><th class="num">Votos</th><th class="num">% válidos</th></tr></thead>
  <tbody>
    ${resumen.candidaturas.map(
      (c) => html`<tr class="${clase(c.cand)}${c.cand.activa ? '' : ' inactiva'}"><th scope="row">${celdaCand(c.cand)}</th><td class="num">${c.votos}</td><td class="num${c.porcentaje === null ? ' vacia' : ''}">${formatoPorcentaje2(c.porcentaje)}</td></tr>`
    )}
    ${pie('Blancos', resumen.blancos, resumen.porcentajeBlancos)}
    ${pie('Nulos', resumen.nulos)}
  </tbody>
  <tfoot>
    <tr><th scope="row">Votos válidos</th><td class="num">${resumen.validos}</td><td></td></tr>
    <tr><th scope="row">Total de votantes</th><td class="num">${resumen.votantes}</td><td></td></tr>
  </tfoot>
</table></div>`;
}

// Candidaturas en filas y mesas en columnas (6): cada celda lleva a la ficha de la mesa.
export function matrizRecuento(resumen) {
  const ficha = (m) => `/admin/recuento/mesa/${m.id}`;
  const celda = (m, valor, estado) => html`<td class="num${valor === null || valor === undefined ? ' vacia' : ''}${estado === 'borrador' ? ' borrador' : ''}"><a class="celda${valor === null || valor === undefined ? ' vacia' : ''}" href="${ficha(m)}">${valor ?? VACIO}</a></td>`;
  const totalCerradas = (f) => resumen.mesas.reduce((a, x) => a + (x.estado === 'cerrado' ? f(x) ?? 0 : 0), 0);
  const fila = (etiqueta, claseFila, valorDe, total) => html`<tr class="${claseFila}"><th scope="row" class="fija">${etiqueta}</th><td class="num total">${total}</td>${resumen.mesas.map((x) => celda(x.mesa, valorDe(x) ?? null, x.estado))}</tr>`;
  return html`<div class="tabla-scroll"><table class="tabla-resumen tabla-matriz">
  <thead><tr><th class="fija">Candidatura</th><th class="num">Σ<span class="faltan">cerradas</span></th>${resumen.mesas.map((x) => html`<th class="num"><a href="${ficha(x.mesa)}">${x.mesa.codigo}</a><span class="faltan estado-${x.estado}">${ESTADOS_MESA[x.estado]}</span></th>`)}</tr></thead>
  <tbody>
    ${resumen.candidaturas.map((c) => fila(celdaCand(c.cand), clase(c.cand), (x) => x.votos.get(c.cand.id), c.votos))}
    ${fila('Blancos', 'neutra', (x) => x.cab?.votos_blancos, resumen.blancos)}
    ${fila('Nulos', 'neutra', (x) => x.cab?.votos_nulos, resumen.nulos)}
  </tbody>
  <tfoot>${fila('Votantes', 'neutra', (x) => x.cab?.votantes, totalCerradas((x) => x.cab?.votantes))}</tfoot>
</table></div>
<p class="nota">Σ = suma de las mesas <strong>cerradas</strong>. Las cifras en cursiva son de mesas en borrador (no suman). Toca una celda para abrir la ficha de la mesa.</p>`;
}

// ---------- /pantallazo (variante Recuento) ----------
const filaRec = ({ marca, nombre, votos, pct, claseExtra = '', barra = true }) => html`<div class="rec-fila ${claseExtra}">
  <span class="rec-marca">${marca ?? ''}</span>
  <span class="rec-siglas">${nombre}</span>
  <span class="rec-votos">${votos}</span>
  <span class="rec-pct${pct === null || pct === undefined ? ' vacia' : ''}">${pct === undefined ? '' : formatoPorcentaje2(pct)}</span>
  ${barra ? html`<svg class="rec-barra" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="fondo" width="100" height="4"/><rect class="relleno" width="${pct ?? 0}" height="4"/></svg>` : ''}
</div>`;

// «Otros» desplegable: la fila resumen es el <summary>; debajo, una línea compacta por candidatura pequeña.
function desgloseOtros(otros, sin) {
  const cabecera = filaRec({ nombre: html`Otros (${otros.cantidad})<span class="rec-flecha" aria-hidden="true"></span>`, votos: sin ? VACIO : otros.votos, pct: sin ? null : otros.porcentaje, claseExtra: 'gris' });
  return html`<details class="rec-otros">
  <summary>${cabecera}</summary>
  <ul class="rec-pequenas">
    ${otros.candidaturas.map((c) => html`<li><span class="rp-siglas">${nombreDe(c.cand)}</span><span class="rp-votos">${sin ? VACIO : c.votos}</span><span class="rp-pct">${sin ? '' : formatoPorcentaje2(c.porcentaje)}</span></li>`)}
  </ul>
</details>`;
}

export function tablaRecuento(resumen) {
  if (resumen.candidaturas.length === 0) return html`<p class="sin-datos">No hay candidaturas cargadas.</p>`;
  const sin = resumen.cerradas === 0;
  return html`<div class="rec-lista">
  ${resumen.destacadas.map((c) => filaRec({ marca: insignia(c.cand), nombre: nombreDe(c.cand), votos: sin ? VACIO : c.votos, pct: sin ? null : c.porcentaje, claseExtra: clase(c.cand) }))}
  ${resumen.otros ? desgloseOtros(resumen.otros, sin) : ''}
  ${filaRec({ nombre: 'Blancos', votos: sin ? VACIO : resumen.blancos, pct: sin ? null : resumen.porcentajeBlancos, claseExtra: 'gris' })}
  ${filaRec({ nombre: 'Nulos', votos: sin ? VACIO : resumen.nulos, barra: false })}
  ${filaRec({ nombre: 'Total de votantes', votos: sin ? VACIO : resumen.votantes, claseExtra: 'total', barra: false })}
</div>
<p class="rec-mesas">Mesas escrutadas <strong>${resumen.cerradas}/${resumen.totalMesas}</strong></p>`;
}
